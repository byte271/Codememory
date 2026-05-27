import { QueryMemoryInput, QueryMemoryOutput, IntentRecord } from '../../types/index.js';
import { IntentQueries } from '../../store/queries/intent.js';
import { IntentSearchEngine } from '../../engines/intent/search.js';
import { DatabaseManager } from '../../store/database.js';
import { logger } from '../../utils/logger.js';
import { CodememoryError, CODEMEMORY_ERROR_CODES } from '../../utils/errors.js';
import { MAX_QUERY_LENGTH } from '../../config.js';

/**
 * Tool for general purpose memory search.
 *
 * v0.2: Supports both filtered queries (file_path, since, status) and
 * natural-language FTS5 search (query). When `query` is provided, FTS5
 * full-text search is used; `file_path` narrows results within matches.
 * When `query` is absent, behavior is identical to v0.1 filtered queries.
 *
 * Follows Rule 14: Every MCP tool must return structured JSON. No plain text responses.
 */
export class QueryMemoryTool {
  private queries: IntentQueries;
  private search: IntentSearchEngine;

  /**
   * Initializes the tool with intent queries and FTS5 search engine.
   * @param queries   The filtered intent queries.
   * @param dbManager DatabaseManager for the FTS5 search engine.
   */
  constructor(queries: IntentQueries, dbManager: DatabaseManager) {
    this.queries = queries;
    this.search = new IntentSearchEngine(dbManager);
  }

  /**
   * Executes the query_memory tool.
   *
   * Two modes:
   *   1. FTS5 search (when `query` is set) — natural-language search across
   *      prompts and generated code, optionally filtered by file_path.
   *   2. Filtered query (v0.1 behavior) — exact filters on file_path, since,
   *      status, and limit.
   *
   * @param input The search criteria.
   * @returns The matching records and total count.
   */
  public async execute(input: QueryMemoryInput): Promise<QueryMemoryOutput> {
    try {
      // ── FTS5 full-text search path (v0.2) ──────────────────────────
      if (input.query && input.query.trim().length > 0) {
        // Enforce max query length to prevent CPU DoS via FTS5 on massive input
        if (input.query.length > MAX_QUERY_LENGTH) {
          throw new CodememoryError(
            CODEMEMORY_ERROR_CODES.INPUT_TOO_LARGE,
            `query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`
          );
        }
        const limit = input.limit ?? 10;
        let searchResults = this.search.search(
          input.query,
          limit,
          input.file_path
        );

        // Apply post-FTS5 filters that the search engine doesn't support
        // (since and status are not indexable by FTS5).
        if (input.status) {
          const filterStatus = input.status;
          searchResults = searchResults.filter(
            r => r.record.status === filterStatus
          );
        }
        if (input.since) {
          const filterSince = input.since;
          searchResults = searchResults.filter(
            r => r.record.created_at >= filterSince
          );
        }

        const records = searchResults.map(r => r.record);
        return {
          records,
          total: records.length,
          search_results: searchResults,
        };
      }

      // ── Filtered query path (v0.1 behavior) ────────────────────────
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
