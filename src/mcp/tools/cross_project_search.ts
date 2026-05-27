import {
  CrossProjectSearchInput,
  CrossProjectSearchOutput,
} from '../../types/index.js';
import { CrossProjectGraph } from '../../engines/knowledge/cross-project.js';
import { logger } from '../../utils/logger.js';

/**
 * Tool to search across projects for shared knowledge (v0.3.0).
 *
 * Breaks down project silos — searches failures, resolutions, and
 * patterns learned in OTHER projects that match the current query.
 * Transforms Codememory into a personal, private programming brain
 * that learns across all your projects.
 *
 * Follows Rule 14: Every MCP tool must return structured JSON.
 */
export class CrossProjectSearchTool {
  private graph: CrossProjectGraph;

  /**
   * @param graph Cross-project knowledge graph engine.
   */
  constructor(graph: CrossProjectGraph) {
    this.graph = graph;
  }

  /**
   * Executes the cross_project_search tool.
   *
   * @param input Search query and options.
   * @returns     Matched results across projects.
   */
  public async execute(
    input: CrossProjectSearchInput
  ): Promise<CrossProjectSearchOutput> {
    try {
      const result = this.graph.searchAcrossProjects(
        input.query,
        input.limit ?? 5
      );

      return result;
    } catch (error) {
      logger.error('Failed to search across projects', error, {
        input,
        timestamp: Date.now(),
        rule: 'Rule 06 compliance',
      });
      throw error;
    }
  }
}
