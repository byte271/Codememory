import { DatabaseManager } from '../../store/database.js';
import { IntentRecord, IntentSearchResult } from '../../types/index.js';
import { logger } from '../../utils/logger.js';

/**
 * FTS5-backed full-text search over intent prompts and generated code.
 * Provides semantic-like search without cloud dependencies (Rule 02).
 *
 * Uses SQLite's built-in FTS5 engine with content-sync triggers so the index
 * stays current without application-level maintenance.
 */
export class IntentSearchEngine {
  private manager: DatabaseManager;

  /**
   * @param manager DatabaseManager providing the FTS5-backed connection.
   */
  constructor(manager: DatabaseManager) {
    this.manager = manager;
  }

  /**
   * Searches intents by natural-language query against prompt and code.
   *
   * Returns results ranked by FTS5 bm25 score with a matched snippet.
   * When `filePath` is provided, results are filtered to that file only,
   * so agents can scope searches to the current working file.
   *
   * @param query    Natural-language search terms.
   * @param limit     Maximum results (1–50, default 10).
   * @param filePath  Optional file path filter.
   * @returns         Ranked search results with snippets.
   */
  public search(
    query: string,
    limit = 10,
    filePath?: string
  ): IntentSearchResult[] {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    // Escape FTS5 syntax characters so natural-language queries don't
    // trigger unexpected operators (AND, OR, NEAR, *, etc.).
    // We wrap each non-trivial term in double-quotes to force exact matching
    // while still benefiting from FTS5's tokenization.
    const escapedQuery = this.escapeFts5(query);

    // If all terms were stripped (e.g. query was just "AND OR *"), return
    // early rather than sending FTS5 an empty MATCH that could error.
    if (escapedQuery === '""' || escapedQuery.trim().length === 0) {
      return [];
    }

    try {
      if (filePath) {
        const rows = this.manager.prepare(`
          SELECT
            i.id, i.created_at, i.file_path, i.prompt, i.generated,
            i.ai_tool, i.language, i.status,
            i.parent_intent_id, i.replacement_reason,
            snippet(intent_fts, 2, '<mark>', '</mark>', '…', 40) AS snippet,
            rank
          FROM intent_fts
          JOIN intent_records i ON intent_fts.rowid = i.rowid
          WHERE intent_fts MATCH ?
            AND i.file_path = ?
          ORDER BY rank
          LIMIT ?
        `).all(escapedQuery, filePath, safeLimit) as FullTextRow[];

        return rows.map(r => this.mapRow(r));
      }

      const rows = this.manager.prepare(`
        SELECT
          i.id, i.created_at, i.file_path, i.prompt, i.generated,
          i.ai_tool, i.language, i.status,
          i.parent_intent_id, i.replacement_reason,
          snippet(intent_fts, 2, '<mark>', '</mark>', '…', 40) AS snippet,
          rank
        FROM intent_fts
        JOIN intent_records i ON intent_fts.rowid = i.rowid
        WHERE intent_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(escapedQuery, safeLimit) as FullTextRow[];

      return rows.map(r => this.mapRow(r));
    } catch (error) {
      logger.error('FTS5 search failed', error, { query, filePath });
      return [];
    }
  }

  /**
   * Escapes a user query for safe FTS5 MATCH usage.
   * Strips FTS5 syntax characters and wraps terms in quotes to prevent
   * accidental operator interpretation (AND, OR, NEAR, NOT, *, parentheses).
   *
   * @param raw User-supplied natural language query.
   * @returns   FTS5-safe query string.
   */
  private escapeFts5(raw: string): string {
    // Remove FTS5 special characters, keeping alphanumeric, spaces, and basic punctuation.
    // The \b word-boundary on operator strip already handles trailing punctuation
    // (e.g. "AND," or "OR.") because , and . are non-word characters.
    const cleaned = raw
      .replace(/["*()^~:]/g, ' ')   // strip FTS5 syntax chars
      .replace(/\b(AND|OR|NOT|NEAR)\b/gi, ' ') // strip FTS5 operators
      .replace(/\s+/g, ' ')          // collapse whitespace
      .trim();

    if (cleaned.length === 0) return '""';

    // Wrap each word in quotes for exact token matching
    const terms = cleaned.split(' ').filter(t => t.length > 0);
    return terms.map(t => `"${t}"`).join(' ');
  }

  /**
   * Maps a raw FTS5 join row into a typed search result.
   */
  private mapRow(row: FullTextRow): IntentSearchResult {
    const record: IntentRecord = {
      id: row.id,
      created_at: row.created_at,
      file_path: row.file_path,
      prompt: row.prompt,
      generated: row.generated,
      ai_tool: row.ai_tool,
      language: row.language,
      status: row.status as IntentRecord['status'],
      parent_intent_id: row.parent_intent_id,
      replacement_reason: row.replacement_reason,
    };
    return {
      record,
      score: typeof row.rank === 'number' ? row.rank : 0,
      snippet: row.snippet ?? '',
    };
  }
}

/** Shape of rows returned by the FTS5 + intent_records join query. */
interface FullTextRow {
  id: string;
  created_at: number;
  file_path: string;
  prompt: string;
  generated: string;
  ai_tool: string;
  language: string;
  status: string;
  parent_intent_id: string | null;
  replacement_reason: string;
  snippet: string | null;
  rank: number;
}
