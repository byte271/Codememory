import { logger } from '../../utils/logger.js';
import { sanitizer } from '../../utils/sanitizer.js';

/** Result returned by onRecord so failures can link to the execution row. */
export interface RuntimeRecordResult {
  snapshot_id?: string;
}

/** Maximum retry attempts for fire-and-forget recording operations. */
const MAX_RETRIES = 3;
/** Base backoff in milliseconds (exponential: delay * 2^attempt). */
const RETRY_BASE_MS = 100;

/**
 * Retries an async operation with exponential backoff.
 * Only retries on transient errors (SQLITE_BUSY, network).
 * Permanent errors (validation, not-found) are re-thrown immediately.
 *
 * @param fn      The async operation to retry.
 * @param label   Human-readable label for log messages.
 * @param context Extra context for log messages.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  label: string,
  context: Record<string, unknown>
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isTransient =
        typeof error === 'object' &&
        error !== null &&
        ((error as { code?: string }).code === 'SQLITE_BUSY' ||
         (error as { code?: string }).code === 'SQLITE_BUSY_SNAPSHOT');

      if (!isTransient || attempt === MAX_RETRIES - 1) {
        throw error;
      }

      const delay = RETRY_BASE_MS * Math.pow(2, attempt);
      logger.warn(
        `Retrying ${label} after transient error (attempt ${attempt + 1}/${MAX_RETRIES})`,
        { ...context, delay, code: (error as { code?: string }).code }
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * Proxy-based function observer for runtime instrumentation.
 * Records function calls, return values, and failures into Codememory's memory layer.
 * Follows Rule 03: NEVER write a function without a JSDoc comment.
 */
export class RuntimeObserver {
  private memoryId: string;
  private filePath: string;
  private onRecord: (data: Record<string, unknown>) => Promise<RuntimeRecordResult | void>;
  private onFailure: (data: Record<string, unknown>) => Promise<void>;

  /**
   * @param memoryId  Intent memory_id snapshots and failures attach to.
   * @param onRecord  Persists executions; may return snapshot_id for failure linking.
   * @param onFailure Persists failure records (e.g. log_failure).
   * @param filePath  Source file path for runtime rows (defaults to 'unknown').
   */
  constructor(
    memoryId: string,
    onRecord: (data: Record<string, unknown>) => Promise<RuntimeRecordResult | void>,
    onFailure: (data: Record<string, unknown>) => Promise<void>,
    filePath = 'unknown'
  ) {
    this.memoryId = memoryId;
    this.filePath = filePath;
    this.onRecord = onRecord;
    this.onFailure = onFailure;
  }

  /**
   * Wraps a function with a Proxy that records executions and failures.
   * - Sync functions: records on return or on throw.
   * - Async functions: records when the Promise settles.
   * - Fire-and-forget recording does NOT block the caller.
   *
   * @param fn           The function to observe.
   * @param functionName Friendly name used in stored records.
   * @returns            The wrapped function, type-compatible with the original.
   */
  public observe<T extends (...args: unknown[]) => unknown>(fn: T, functionName: string): T {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Proxy `apply` trap needs stable ref
    const observer = this;

    return new Proxy(fn, {
      apply(target: T, thisArg: unknown, argArray: unknown[]) {
        const start = Date.now();
        let result: unknown;

        try {
          result = target.apply(thisArg, argArray);
        } catch (error) {
          // Synchronous throw
          const duration = Date.now() - start;
          observer.recordFailure(functionName, argArray, error, duration);
          throw error;
        }

        // Async path (Promise or thenable)
        if (result !== null && typeof result === 'object' && 'then' in result &&
            typeof (result as { then: unknown }).then === 'function') {
          return Promise.resolve(result).then(
            (value) => {
              const duration = Date.now() - start;
              observer.recordSuccess(functionName, argArray, value, duration);
              return value;
            },
            (error: unknown) => {
              const duration = Date.now() - start;
              observer.recordFailure(functionName, argArray, error, duration);
              throw error;
            }
          );
        }

        // Sync success
        const duration = Date.now() - start;
        observer.recordSuccess(functionName, argArray, result, duration);
        return result;
      }
    }) as T;
  }

  /**
   * Records a successful function execution.
   * Fire-and-forget with retry: does not block the caller. Transient
   * errors (e.g. SQLITE_BUSY) are retried up to 3 times with exponential
   * backoff before giving up.
   */
  private recordSuccess(
    functionName: string,
    args: unknown[],
    returnValue: unknown,
    durationMs: number
  ): void {
    retryWithBackoff(
      () =>
        this.onRecord({
          memory_id: this.memoryId,
          function_name: functionName,
          file_path: this.filePath,
          arguments: sanitizer.sanitize(args),
          return_value: sanitizer.sanitize(returnValue),
          duration_ms: durationMs,
          success: true,
        }),
      'recordSuccess',
      { functionName }
    ).catch((err) =>
      logger.error('Failed to record success after retries', err, { functionName })
    );
  }

  /**
   * Records a failure event.
   *
   * NOTE: Snapshot recording (onRecord) and failure logging (onFailure)
   * are separate MCP tool calls and therefore not atomic. If onRecord
   * succeeds but onFailure fails, a snapshot exists with no linked failure
   * record. This is a known design limitation — see Rule 14 tool boundaries.
   *
   * Both calls are retried individually with exponential backoff on
   * transient errors (e.g. SQLITE_BUSY).
   *
   * @param functionName Name of the function that failed.
   * @param args         Arguments passed to the function.
   * @param error        The caught error.
   * @param durationMs   Time elapsed before the failure.
   */
  private recordFailure(
    functionName: string,
    args: unknown[],
    error: unknown,
    durationMs: number
  ): void {
    const errorObj = error instanceof Error ? error : new Error(String(error));

    void (async () => {
      let snapshotId: string | undefined;
      try {
        const recordResult = await retryWithBackoff(
          () =>
            this.onRecord({
              memory_id: this.memoryId,
              function_name: functionName,
              file_path: this.filePath,
              arguments: sanitizer.sanitize(args),
              duration_ms: durationMs,
              success: false,
            }),
          'recordFailure snapshot',
          { functionName }
        );
        snapshotId = recordResult?.snapshot_id;
      } catch (err) {
        logger.error('Failed to record failed execution snapshot after retries', err, { functionName });
      }

      try {
        await retryWithBackoff(
          () =>
            this.onFailure({
              memory_id: this.memoryId,
              snapshot_id: snapshotId,
              error_type: errorObj.name,
              error_message: errorObj.message,
              stack_trace: errorObj.stack ?? '',
              call_chain: [functionName],
            }),
          'recordFailure log',
          { functionName, snapshotId }
        );
      } catch (err) {
        logger.error('Failed to log failure after retries', err, { functionName, snapshotId });
      }
    })().catch((err) => logger.error('Failure recording pipeline error', err, { functionName }));
  }
}
