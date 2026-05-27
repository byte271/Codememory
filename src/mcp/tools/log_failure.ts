import { LogFailureInput, LogFailureOutput, FailureRecord } from '../../types/index.js';
import { IntentQueries } from '../../store/queries/intent.js';
import { RuntimeQueries } from '../../store/queries/runtime.js';
import { assertIntentExists, assertSnapshotBelongsToIntent } from '../../utils/validate-intent.js';
import { hash } from '../../utils/hash.js';
import { logger } from '../../utils/logger.js';
import { CodememoryError, CODEMEMORY_ERROR_CODES } from '../../utils/errors.js';
import {
  MAX_ERROR_TYPE_LENGTH,
  MAX_ERROR_MESSAGE_LENGTH,
  MAX_STACK_TRACE_LENGTH,
  MAX_CALL_CHAIN_LENGTH,
  MAX_CALL_CHAIN_ELEMENT_LENGTH,
} from '../../config.js';

/**
 * Tool to log runtime failures.
 * Follows Rule 14: Every MCP tool must return structured JSON. No plain text responses.
 */
export class LogFailureTool {
  private intentQueries: IntentQueries;
  private queries: RuntimeQueries;

  /**
   * Initializes the tool with intent and runtime queries.
   * @param intentQueries Used to verify memory_id exists before insert.
   * @param queries       Failure persistence and snapshot validation.
   */
  constructor(intentQueries: IntentQueries, queries: RuntimeQueries) {
    this.intentQueries = intentQueries;
    this.queries = queries;
  }

  /**
   * Executes the log_failure tool.
   * @param input The input parameters for the tool.
   * @returns The output containing the failure_id.
   */
  public async execute(input: LogFailureInput): Promise<LogFailureOutput> {
    try {
      // ── Input size validation (DoS guard) ─────────────────────────
      this.validateInput(input);

      assertIntentExists(this.intentQueries, input.memory_id);
      assertSnapshotBelongsToIntent(this.queries, input.memory_id, input.snapshot_id);

      const timestamp = Date.now();
      const failureId = hash.generateUniqueId(`${input.memory_id}-failure`);

      // Cap call_chain array to prevent memory exhaustion from massive inputs.
      const cappedChain = input.call_chain
        .slice(0, MAX_CALL_CHAIN_LENGTH)
        .map(el => el.slice(0, MAX_CALL_CHAIN_ELEMENT_LENGTH));

      const record: FailureRecord = {
        id: failureId,
        intent_id: input.memory_id,
        snapshot_id: input.snapshot_id || null,
        failed_at: timestamp,
        error_type: input.error_type.slice(0, MAX_ERROR_TYPE_LENGTH),
        error_message: input.error_message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
        stack_trace: input.stack_trace.slice(0, MAX_STACK_TRACE_LENGTH),
        call_chain: JSON.stringify(cappedChain),
        repair_status: 'unresolved'
      };

      this.queries.insertFailure(record);

      logger.info('Logged failure', { failureId, memoryId: input.memory_id });

      return {
        failure_id: failureId,
        status: 'logged'
      };
    } catch (error) {
      logger.error('Failed to log failure', error, { 
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
  private validateInput(input: LogFailureInput): void {
    if (input.error_type.length > MAX_ERROR_TYPE_LENGTH) {
      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.INPUT_TOO_LARGE,
        `error_type exceeds maximum length of ${MAX_ERROR_TYPE_LENGTH} characters`
      );
    }
    if (input.error_message.length > MAX_ERROR_MESSAGE_LENGTH) {
      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.INPUT_TOO_LARGE,
        `error_message exceeds maximum length of ${MAX_ERROR_MESSAGE_LENGTH} characters`
      );
    }
    if (input.stack_trace.length > MAX_STACK_TRACE_LENGTH) {
      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.INPUT_TOO_LARGE,
        `stack_trace exceeds maximum length of ${MAX_STACK_TRACE_LENGTH} characters`
      );
    }
  }
}
