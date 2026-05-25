import { QueryMemoryInput, QueryMemoryOutput, IntentRecord } from '../../types/index.js';
import { IntentQueries } from '../../store/queries/intent.js';
import { logger } from '../../utils/logger.js';

/**
 * Tool for general purpose memory search.
 * Follows Rule 14: Every MCP tool must return structured JSON. No plain text responses.
 */
export class QueryMemoryTool {
  private queries: IntentQueries;

  /**
   * Initializes the tool with intent queries.
   * @param queries The queries to use.
   */
  constructor(queries: IntentQueries) {
    this.queries = queries;
  }

  /**
   * Executes the query_memory tool. Honors all filter fields:
   * file_path, since (epoch ms), status, and limit. Delegates to the
   * IntentQueries.getFiltered method so filtering happens at the SQL layer.
   * @param input The search criteria.
   * @returns The matching records and total count.
   */
  public async execute(input: QueryMemoryInput): Promise<QueryMemoryOutput> {
    try {
      const filter = {
        file_path: input.file_path,
        since: input.since,
        status: input.status,
        limit: input.limit,
      };

      const records: IntentRecord[] = this.queries.getFiltered(filter);
      const total = this.queries.countFiltered(filter);

      return {
        records,
        total,
      };
    } catch (error) {
      logger.error('Failed to query memory', error, {
        input,
        timestamp: Date.now(),
        rule: 'Rule 06 compliance',
      });
      throw error;
    }
  }
}
