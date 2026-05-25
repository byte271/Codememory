import { LogFailureInput, LogFailureOutput, FailureRecord } from '../../types/index.js';
import { IntentQueries } from '../../store/queries/intent.js';
import { RuntimeQueries } from '../../store/queries/runtime.js';
import { assertIntentExists, assertSnapshotBelongsToIntent } from '../../utils/validate-intent.js';
import { hash } from '../../utils/hash.js';
import { logger } from '../../utils/logger.js';

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
      assertIntentExists(this.intentQueries, input.memory_id);
      assertSnapshotBelongsToIntent(this.queries, input.memory_id, input.snapshot_id);

      const timestamp = Date.now();
      const failureId = hash.generateUniqueId(`${input.memory_id}-failure`);

      const record: FailureRecord = {
        id: failureId,
        intent_id: input.memory_id,
        snapshot_id: input.snapshot_id || null,
        failed_at: timestamp,
        error_type: input.error_type,
        error_message: input.error_message,
        stack_trace: input.stack_trace,
        call_chain: JSON.stringify(input.call_chain),
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
}
