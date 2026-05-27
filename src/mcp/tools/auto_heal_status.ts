import {
  AutoHealStatusInput,
  AutoHealStatusOutput,
} from '../../types/index.js';
import { AutoHealEngine } from '../../engines/heal/auto-heal.js';
import { RuntimeQueries } from '../../store/queries/runtime.js';
import { logger } from '../../utils/logger.js';
import { CodememoryError, CODEMEMORY_ERROR_CODES } from '../../utils/errors.js';

/**
 * Tool to check the status of an auto-heal task (v0.3.0).
 *
 * Returns the current state of an auto-heal task along with the
 * original failure context so the AI agent can decide whether to
 * use the generated patch or take a different approach.
 *
 * Follows Rule 14: Every MCP tool must return structured JSON.
 */
export class AutoHealStatusTool {
  private engine: AutoHealEngine;
  private runtimeQueries: RuntimeQueries;

  /**
   * @param engine         Auto-heal engine for task lookup.
   * @param runtimeQueries Failure lookup.
   */
  constructor(engine: AutoHealEngine, runtimeQueries: RuntimeQueries) {
    this.engine = engine;
    this.runtimeQueries = runtimeQueries;
  }

  /**
   * Executes the auto_heal_status tool.
   *
   * @param input The task ID to check.
   * @returns     Task status with failure context.
   */
  public async execute(input: AutoHealStatusInput): Promise<AutoHealStatusOutput> {
    try {
      const task = this.engine.getTask(input.task_id);
      if (!task) {
        throw new CodememoryError(
          CODEMEMORY_ERROR_CODES.FAILURE_NOT_FOUND,
          `Auto-heal task not found: ${input.task_id}`
        );
      }

      const failure = this.runtimeQueries.getFailureById(task.failure_id);
      if (!failure) {
        throw new CodememoryError(
          CODEMEMORY_ERROR_CODES.FAILURE_NOT_FOUND,
          `Failure for auto-heal task not found: ${task.failure_id}`
        );
      }

      return { task, failure };
    } catch (error) {
      logger.error('Failed to get auto-heal status', error, {
        input,
        timestamp: Date.now(),
        rule: 'Rule 06 compliance',
      });
      throw error;
    }
  }
}
