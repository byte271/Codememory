import {
  AutoHealTriggerInput,
  AutoHealTriggerOutput,
} from '../../types/index.js';
import { AutoHealEngine } from '../../engines/heal/auto-heal.js';
import { RuntimeQueries } from '../../store/queries/runtime.js';
import { logger } from '../../utils/logger.js';
import { CodememoryError, CODEMEMORY_ERROR_CODES } from '../../utils/errors.js';

/**
 * Tool to trigger autonomous self-healing for a failure (v0.3.0).
 *
 * When called, queues an auto-heal task that generates a patch
 * from historical memory and proven fixes. The task is processed
 * by the background worker or can be manually triggered.
 *
 * Follows Rule 14: Every MCP tool must return structured JSON.
 */
export class AutoHealTriggerTool {
  private engine: AutoHealEngine;
  private runtimeQueries: RuntimeQueries;

  /**
   * @param engine         Auto-heal engine for task management.
   * @param runtimeQueries Failure validation.
   */
  constructor(engine: AutoHealEngine, runtimeQueries: RuntimeQueries) {
    this.engine = engine;
    this.runtimeQueries = runtimeQueries;
  }

  /**
   * Executes the auto_heal_trigger tool.
   *
   * @param input The failure to auto-heal.
   * @returns     The queued task info.
   */
  public async execute(input: AutoHealTriggerInput): Promise<AutoHealTriggerOutput> {
    try {
      // Validate failure exists and is unresolved
      const failure = this.runtimeQueries.getFailureById(input.failure_id);
      if (!failure) {
        throw new CodememoryError(
          CODEMEMORY_ERROR_CODES.FAILURE_NOT_FOUND,
          `Failure not found: ${input.failure_id}`
        );
      }

      if (failure.repair_status === 'resolved') {
        throw new CodememoryError(
          CODEMEMORY_ERROR_CODES.DUPLICATE_INTENT,
          `Failure ${input.failure_id} is already resolved`
        );
      }

      const task = this.engine.queueTask(input.failure_id);

      const startedAt = Date.now();

      // Immediately execute the task (synchronous for direct MCP calls)
      const completed = await this.engine.executeTask(task.id);

      return {
        task_id: completed.id,
        status: completed.status,
        estimated_ms: Date.now() - startedAt,
      };
    } catch (error) {
      logger.error('Failed to trigger auto-heal', error, {
        input,
        timestamp: Date.now(),
        rule: 'Rule 06 compliance',
      });
      throw error;
    }
  }
}
