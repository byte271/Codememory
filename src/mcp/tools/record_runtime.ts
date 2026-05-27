import { RecordRuntimeInput, RecordRuntimeOutput } from '../../types/index.js';
import { IntentQueries } from '../../store/queries/intent.js';
import { RuntimeQueries } from '../../store/queries/runtime.js';
import { assertIntentExists } from '../../utils/validate-intent.js';
import { hash } from '../../utils/hash.js';
import { logger } from '../../utils/logger.js';
import { sanitizer } from '../../utils/sanitizer.js';
import { SnapshotBuilder } from '../../engines/runtime/snapshot.js';
import { getMaxSnapshotsPerIntent, MAX_LABEL_LENGTH, MAX_PATH_LENGTH, MAX_ARGUMENTS_LENGTH } from '../../config.js';
import { CodememoryError, CODEMEMORY_ERROR_CODES } from '../../utils/errors.js';

/**
 * Tool to record code runtime execution.
 * Follows Rule 14: Every MCP tool must return structured JSON. No plain text responses.
 */
export class RecordRuntimeTool {
  private intentQueries: IntentQueries;
  private queries: RuntimeQueries;
  private snapshotBuilder: SnapshotBuilder;

  /**
   * Initializes the tool with intent and runtime queries.
   * @param intentQueries Used to verify memory_id exists before insert.
   * @param queries       Runtime snapshot persistence.
   */
  constructor(intentQueries: IntentQueries, queries: RuntimeQueries) {
    this.intentQueries = intentQueries;
    this.queries = queries;
    this.snapshotBuilder = new SnapshotBuilder();
  }

  /**
   * Executes the record_runtime tool.
   * @param input The input parameters for the tool.
   * @returns The output containing the snapshot_id.
   */
  public async execute(input: RecordRuntimeInput): Promise<RecordRuntimeOutput> {
    try {
      // ── Input size validation (DoS guard) ─────────────────────────
      this.validateInput(input);

      assertIntentExists(this.intentQueries, input.memory_id);

      const timestamp = Date.now();
      const snapshotId = hash.generateUniqueId(`${input.memory_id}-${input.function_name}`);

      // Cap arguments array to prevent memory exhaustion
      const cappedArgs = Array.isArray(input.arguments)
        ? input.arguments.slice(0, MAX_ARGUMENTS_LENGTH)
        : [];

      const snapshot = this.snapshotBuilder.build({
        id: snapshotId,
        intent_id: input.memory_id,
        recorded_at: timestamp,
        function_name: input.function_name.slice(0, MAX_LABEL_LENGTH),
        file_path: (input.file_path ?? 'unknown').slice(0, MAX_PATH_LENGTH),
        arguments: this.safeJsonStringify(sanitizer.sanitize(cappedArgs)),
        return_value: input.return_value !== undefined ? this.safeJsonStringify(sanitizer.sanitize(input.return_value)) : null,
        duration_ms: input.duration_ms,
        success: input.success === true ? 1 : 0
      });

      // Wrap insert + prune in a transaction so the snapshot count never
      // temporarily exceeds the configured limit due to a partial write.
      const db = this.queries.getDb();
      db.transaction(() => {
        this.queries.insertSnapshot(snapshot);
        const pruned = this.queries.pruneSnapshots(
          input.memory_id,
          getMaxSnapshotsPerIntent()
        );
        if (pruned > 0) {
          logger.info('Pruned old runtime snapshots', {
            memoryId: input.memory_id,
            pruned,
            maxKeep: getMaxSnapshotsPerIntent(),
          });
        }
      })();

      logger.info('Recorded runtime', { snapshotId, memoryId: input.memory_id });

      return {
        snapshot_id: snapshotId,
        status: 'recorded'
      };
    } catch (error) {
      logger.error('Failed to record runtime', error, { 
        input,
        timestamp: Date.now(),
        rule: 'Rule 06 compliance'
      });
      throw error;
    }
  }

  /**
   * Validates input sizes to prevent DoS via massive payloads.
   * @throws CodememoryError(INPUT_TOO_LARGE) when any field exceeds its limit.
   */
  private validateInput(input: RecordRuntimeInput): void {
    if (input.function_name.length > MAX_LABEL_LENGTH) {
      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.INPUT_TOO_LARGE,
        `function_name exceeds maximum length of ${MAX_LABEL_LENGTH} characters`
      );
    }
    if (input.file_path && input.file_path.length > MAX_PATH_LENGTH) {
      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.INPUT_TOO_LARGE,
        `file_path exceeds maximum length of ${MAX_PATH_LENGTH} characters`
      );
    }
  }

  /**
   * Safely stringifies an object to JSON.
   * Handles circular references and undefined by returning a placeholder.
   * @param obj The object to stringify.
   * @returns The JSON string or a placeholder.
   */
  private safeJsonStringify(obj: unknown): string {
    if (obj === undefined) return 'null';
    try {
      return JSON.stringify(obj) ?? 'null';
    } catch (error) {
      return JSON.stringify({ error: 'Circular reference or non-serializable data' });
    }
  }
}
