import { RecordRuntimeInput, RecordRuntimeOutput } from '../../types/index.js';
import { IntentQueries } from '../../store/queries/intent.js';
import { RuntimeQueries } from '../../store/queries/runtime.js';
import { assertIntentExists } from '../../utils/validate-intent.js';
import { hash } from '../../utils/hash.js';
import { logger } from '../../utils/logger.js';
import { sanitizer } from '../../utils/sanitizer.js';
import { SnapshotBuilder } from '../../engines/runtime/snapshot.js';
import { getMaxSnapshotsPerIntent } from '../../config.js';

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
      assertIntentExists(this.intentQueries, input.memory_id);

      const timestamp = Date.now();
      const snapshotId = hash.generateUniqueId(`${input.memory_id}-${input.function_name}`);

      const snapshot = this.snapshotBuilder.build({
        id: snapshotId,
        intent_id: input.memory_id,
        recorded_at: timestamp,
        function_name: input.function_name,
        file_path: input.file_path ?? 'unknown',
        arguments: this.safeJsonStringify(sanitizer.sanitize(input.arguments)),
        return_value: input.return_value !== undefined ? this.safeJsonStringify(sanitizer.sanitize(input.return_value)) : null,
        duration_ms: input.duration_ms,
        success: input.success === true ? 1 : 0
      });

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
   * Safely stringifies an object to JSON.
   * Handles circular references by returning a placeholder.
   * @param obj The object to stringify.
   * @returns The JSON string or a placeholder.
   */
  private safeJsonStringify(obj: unknown): string {
    try {
      return JSON.stringify(obj);
    } catch (error) {
      return JSON.stringify({ error: 'Circular reference or non-serializable data' });
    }
  }
}
