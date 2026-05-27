import {
  GetCodeLineageInput,
  GetCodeLineageOutput,
} from '../../types/index.js';
import { LineageEngine } from '../../engines/intent/lineage.js';
import { logger } from '../../utils/logger.js';

/**
 * Tool to retrieve the full code evolution lineage for an intent.
 *
 * Traces the `parent_intent_id` chain to show the AI agent what was tried
 * before, why each generation failed, and how each failure was resolved.
 * This prevents code-looping — the agent sees its own trajectory.
 *
 * Follows Rule 14: Every MCP tool must return structured JSON. No plain text responses.
 */
export class GetCodeLineageTool {
  private lineage: LineageEngine;

  /**
   * @param lineage The code lineage engine.
   */
  constructor(lineage: LineageEngine) {
    this.lineage = lineage;
  }

  /**
   * Executes the get_code_lineage tool.
   *
   * Returns the full generational tree: root intent → failures → resolution →
   * next intent → ... → requested intent. Includes depth and total failure
   * counts for quick context.
   *
   * @param input The lineage input containing the memory_id.
   * @returns     The full lineage output.
   */
  public async execute(
    input: GetCodeLineageInput
  ): Promise<GetCodeLineageOutput> {
    try {
      return this.lineage.trace(input.memory_id);
    } catch (error) {
      logger.error('Failed to get code lineage', error, {
        input,
        timestamp: Date.now(),
        rule: 'Rule 06 compliance',
      });
      throw error;
    }
  }
}
