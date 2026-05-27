import { DatabaseManager } from '../../store/database.js';
import {
  Resolution,
  FailureRecord,
  IntentRecord,
  ProvenanceRecord,
} from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { CodememoryError, CODEMEMORY_ERROR_CODES } from '../../utils/errors.js';

/**
 * Repair provenance engine — teaches agents what fixed a bug last time.
 *
 * When a failure is resolved, Codememory records the resolution (which intent
 * fixed it and how). Later, when `get_repair_brief` encounters a failure with
 * a similar error shape, it searches for past proven fixes so the AI agent
 * can apply a known-working approach instead of guessing.
 *
 * Follows Rule 02: SQLite only, no cloud embeddings.
 * Follows Rule 03: every function has a JSDoc comment.
 */
export class RepairProvenance {
  private manager: DatabaseManager;

  /**
   * @param manager DatabaseManager providing the connection + statement cache.
   */
  constructor(manager: DatabaseManager) {
    this.manager = manager;
  }

  /**
   * Records a resolution linking a failure to the intent that fixed it.
   * Also updates the failure's repair_status to 'resolved'.
   *
   * Wrapped in a transaction so the INSERT and UPDATE are atomic — a
   * partial write (resolution without status update) cannot occur.
   *
   * The UPDATE is conditional (WHERE repair_status = 'unresolved') to
   * prevent a TOCTOU race where two concurrent log_resolution calls both
   * pass the pre-check. The first caller wins; the second sees zero
   * affected rows and the transaction rolls back.
   *
   * @param resolution The resolution to persist.
   * @throws CodememoryError when the failure was already resolved by a
   *         concurrent caller (detected atomically inside the transaction).
   */
  public record(resolution: Resolution): void {
    const insertStmt = this.manager.prepare(`
      INSERT INTO resolutions (id, failure_id, fixing_intent_id, approach, diff_summary, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const updateStmt = this.manager.prepare(
      "UPDATE failures SET repair_status = 'resolved' WHERE id = ? AND repair_status = 'unresolved'"
    );

    const db = this.manager.getDb();
    db.transaction(() => {
      insertStmt.run(
        resolution.id,
        resolution.failure_id,
        resolution.fixing_intent_id,
        resolution.approach,
        resolution.diff_summary,
        resolution.resolved_at,
      );
      const updateResult = updateStmt.run(resolution.failure_id);
      if (updateResult.changes === 0) {
        throw new CodememoryError(
          CODEMEMORY_ERROR_CODES.DUPLICATE_INTENT,
          `Failure ${resolution.failure_id} was already resolved by a concurrent call`
        );
      }
    })();

    logger.info('Recorded resolution', {
      resolutionId: resolution.id,
      failureId: resolution.failure_id,
    });
  }

  /**
   * Finds proven fixes whose error shape matches the given failure.
   *
   * Matching strategy (local, no ML):
   *   1. Exact error_type match → highest relevance.
   *   2. Substring match on error_message keywords → medium relevance.
   *   3. Returns up to 3 results, ordered by recency.
   *
   * @param errorType    The current error type (e.g. "TypeError").
   * @param errorMessage The current error message.
   * @param limit        Maximum proven fixes to return (default 3).
   * @returns            Resolved failures with their fixing intents.
   */
  public findSimilarFixes(
    errorType: string,
    errorMessage: string,
    limit = 3
  ): ProvenanceRecord[] {
    const safeLimit = Math.max(1, Math.min(5, Math.floor(limit)));

    // Extract meaningful keywords for substring matching
    const keywords = this.extractKeywords(errorMessage);

    // Tier 1: exact error_type match
    const exactMatches = this.queryExactType(errorType, safeLimit * 2);
    if (exactMatches.length >= safeLimit) return exactMatches.slice(0, safeLimit);

    // Tier 2: add substring matches on message keywords
    const combined = new Map<string, ProvenanceRecord>();
    for (const m of exactMatches) combined.set(m.resolution.id, m);

    for (const kw of keywords) {
      if (combined.size >= safeLimit) break;
      const subMatches = this.queryMessageContains(kw, safeLimit);
      for (const m of subMatches) {
        if (!combined.has(m.resolution.id)) {
          combined.set(m.resolution.id, m);
        }
      }
    }

    // Return newest-first
    return [...combined.values()]
      .sort((a, b) => b.resolution.resolved_at - a.resolution.resolved_at)
      .slice(0, safeLimit);
  }

  /**
   * Queries resolutions where the linked failure has the given error_type.
   */
  private queryExactType(
    errorType: string,
    limit: number
  ): ProvenanceRecord[] {
    const rows = this.manager.prepare(`
      SELECT
        r.id          AS res_id,   r.failure_id, r.fixing_intent_id,
        r.approach,   r.diff_summary, r.resolved_at,
        f.id          AS fail_id,  f.intent_id    AS fail_intent_id,
        f.snapshot_id,             f.failed_at,
        f.error_type,              f.error_message,
        f.stack_trace,             f.call_chain,
        f.repair_status,
        i.id          AS int_id,   i.created_at,  i.file_path,
        i.prompt,     i.generated, i.ai_tool,     i.language,
        i.status,     i.parent_intent_id,          i.replacement_reason
      FROM resolutions r
      JOIN failures f         ON r.failure_id = f.id
      JOIN intent_records i   ON r.fixing_intent_id = i.id
      WHERE f.error_type = ?
        AND f.repair_status = 'resolved'
      ORDER BY r.resolved_at DESC
      LIMIT ?
    `).all(errorType, limit) as ProvenanceRow[];

    return rows.map(r => this.mapRow(r, 'exact_type'));
  }

  /**
   * Queries resolutions where the failure message contains a keyword.
   */
  private queryMessageContains(
    keyword: string,
    limit: number
  ): ProvenanceRecord[] {
    // Escape LIKE wildcards so '%' and '_' in keywords don't act as
    // pattern operators (e.g. "100%" shouldn't match "1000").
    const escaped = keyword.replace(/%/g, '\\%').replace(/_/g, '\\_');
    const rows = this.manager.prepare(`
      SELECT
        r.id          AS res_id,   r.failure_id, r.fixing_intent_id,
        r.approach,   r.diff_summary, r.resolved_at,
        f.id          AS fail_id,  f.intent_id    AS fail_intent_id,
        f.snapshot_id,             f.failed_at,
        f.error_type,              f.error_message,
        f.stack_trace,             f.call_chain,
        f.repair_status,
        i.id          AS int_id,   i.created_at,  i.file_path,
        i.prompt,     i.generated, i.ai_tool,     i.language,
        i.status,     i.parent_intent_id,          i.replacement_reason
      FROM resolutions r
      JOIN failures f         ON r.failure_id = f.id
      JOIN intent_records i   ON r.fixing_intent_id = i.id
      WHERE f.error_message LIKE ? ESCAPE '\\'
        AND f.repair_status = 'resolved'
      ORDER BY r.resolved_at DESC
      LIMIT ?
    `).all(`%${escaped}%`, limit) as ProvenanceRow[];

    return rows.map(r => this.mapRow(r, 'message_keyword'));
  }

  /**
   * Extracts significant keywords from an error message.
   * Removes common noise words to focus on meaningful terms.
   */
  private extractKeywords(message: string): string[] {
    const noise = new Set([
      'the', 'a', 'an', 'is', 'at', 'of', 'to', 'in', 'and', 'or', 'not',
      'for', 'on', 'with', 'was', 'it', 'be', 'has', 'have', 'that',
    ]);
    return message
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter(w => w.length > 2 && !noise.has(w))
      .slice(0, 5); // top 5 meaningful words
  }

  /**
   * Maps a raw join row into a ProvenanceRecord.
   */
  private mapRow(
    row: ProvenanceRow,
    matchContext: string
  ): ProvenanceRecord {
    const resolution: Resolution = {
      id: row.res_id,
      failure_id: row.failure_id,
      fixing_intent_id: row.fixing_intent_id,
      approach: row.approach,
      diff_summary: row.diff_summary,
      resolved_at: row.resolved_at,
    };

    const failure: FailureRecord = {
      id: row.fail_id,
      intent_id: row.fail_intent_id,
      snapshot_id: row.snapshot_id,
      failed_at: row.failed_at,
      error_type: row.error_type,
      error_message: row.error_message,
      stack_trace: row.stack_trace,
      call_chain: row.call_chain,
      repair_status: row.repair_status,
    };

    const intent: IntentRecord = {
      id: row.int_id,
      created_at: row.created_at,
      file_path: row.file_path,
      prompt: row.prompt,
      generated: row.generated,
      ai_tool: row.ai_tool,
      language: row.language,
      status: row.status,
      parent_intent_id: row.parent_intent_id,
      replacement_reason: row.replacement_reason,
    };

    return { resolution, intent, failure, match_context: matchContext };
  }
}

/** Shape of rows returned by the provenance join query. */
interface ProvenanceRow {
  res_id: string;
  failure_id: string;
  fixing_intent_id: string;
  approach: string;
  diff_summary: string;
  resolved_at: number;
  fail_id: string;
  fail_intent_id: string;
  snapshot_id: string | null;
  failed_at: number;
  error_type: string;
  error_message: string;
  stack_trace: string | null;
  call_chain: string | null;
  repair_status: 'unresolved' | 'in_progress' | 'resolved';
  int_id: string;
  created_at: number;
  file_path: string;
  prompt: string;
  generated: string;
  ai_tool: string;
  language: string;
  status: 'active' | 'deprecated' | 'replaced';
  parent_intent_id: string | null;
  replacement_reason: string;
}
