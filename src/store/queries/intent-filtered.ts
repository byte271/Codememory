import type Database from 'better-sqlite3';
import { DatabaseManager } from '../database.js';
import { IntentRecord } from '../../types/index.js';
import { CodememoryError, CODEMEMORY_ERROR_CODES } from '../../utils/errors.js';

/** Bit flags describing which optional filters are active. */
type FilterFlags = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const FILTER_SQL: Record<FilterFlags, string> = {
  0: 'SELECT * FROM intent_records WHERE 1=1 ORDER BY created_at DESC LIMIT ?',
  1: 'SELECT * FROM intent_records WHERE file_path = ? ORDER BY created_at DESC LIMIT ?',
  2: 'SELECT * FROM intent_records WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?',
  3: 'SELECT * FROM intent_records WHERE file_path = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?',
  4: 'SELECT * FROM intent_records WHERE status = ? ORDER BY created_at DESC LIMIT ?',
  5: 'SELECT * FROM intent_records WHERE file_path = ? AND status = ? ORDER BY created_at DESC LIMIT ?',
  6: 'SELECT * FROM intent_records WHERE created_at >= ? AND status = ? ORDER BY created_at DESC LIMIT ?',
  7: 'SELECT * FROM intent_records WHERE file_path = ? AND created_at >= ? AND status = ? ORDER BY created_at DESC LIMIT ?',
};

const COUNT_FILTER_SQL: Record<FilterFlags, string> = {
  0: 'SELECT COUNT(*) as total FROM intent_records WHERE 1=1',
  1: 'SELECT COUNT(*) as total FROM intent_records WHERE file_path = ?',
  2: 'SELECT COUNT(*) as total FROM intent_records WHERE created_at >= ?',
  3: 'SELECT COUNT(*) as total FROM intent_records WHERE file_path = ? AND created_at >= ?',
  4: 'SELECT COUNT(*) as total FROM intent_records WHERE status = ?',
  5: 'SELECT COUNT(*) as total FROM intent_records WHERE file_path = ? AND status = ?',
  6: 'SELECT COUNT(*) as total FROM intent_records WHERE created_at >= ? AND status = ?',
  7: 'SELECT COUNT(*) as total FROM intent_records WHERE file_path = ? AND created_at >= ? AND status = ?',
};

/**
 * Cached prepared statements for intent filter combinations.
 * Eight fixed templates replace dynamic SQL composition (Phase 3 perf).
 */
export class IntentFilteredQueries {
  private readonly stmts = new Map<FilterFlags, Database.Statement>();
  private readonly countStmts = new Map<FilterFlags, Database.Statement>();

  /**
   * @param manager Database manager whose prepare() cache backs statements.
   */
  constructor(manager: DatabaseManager) {
    for (const flag of [0, 1, 2, 3, 4, 5, 6, 7] as FilterFlags[]) {
      this.stmts.set(flag, manager.prepare(FILTER_SQL[flag]));
      this.countStmts.set(flag, manager.prepare(COUNT_FILTER_SQL[flag]));
    }
  }

  /**
   * Runs a cached filtered query for the given filter combination.
   *
   * @param flags  Bit mask: 1=file_path, 2=since, 4=status.
   * @param params Bind parameters in template order, then limit.
   * @returns Matching intent records, newest first.
   */
  public query(flags: FilterFlags, params: unknown[]): IntentRecord[] {
    const stmt = this.stmts.get(flags);
    if (!stmt) {
      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.INVALID_QUERY,
        `Invalid intent filter flags: ${flags}`
      );
    }
    return stmt.all(...params) as IntentRecord[];
  }

  /**
   * Counts rows matching the filter without applying LIMIT.
   *
   * @param flags  Bit mask: 1=file_path, 2=since, 4=status.
   * @param params Bind parameters in template order (no limit).
   * @returns Total matching intent records.
   */
  public count(flags: FilterFlags, params: unknown[]): number {
    const stmt = this.countStmts.get(flags);
    if (!stmt) {
      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.INVALID_QUERY,
        `Invalid intent filter flags: ${flags}`
      );
    }
    const row = stmt.get(...params) as { total: number };
    return row.total;
  }

  /**
   * Computes the filter flag bitmask from filter options without building
   * bind parameters or validating limit (used by both query and count paths).
   *
   * @param options Filter fields from query_memory.
   * @returns The bitmask flag value.
   */
  private static computeFlags(options: {
    file_path?: string;
    since?: number;
    status?: string;
  }): FilterFlags {
    let flags = 0;
    if (options.file_path) flags |= 1;
    if (options.since !== undefined) {
      if (!Number.isFinite(options.since) || options.since < 0) {
        throw new CodememoryError(
          CODEMEMORY_ERROR_CODES.INVALID_QUERY,
          'Invalid since: must be a non-negative epoch milliseconds value'
        );
      }
      flags |= 2;
    }
    if (options.status) flags |= 4;
    return flags as FilterFlags;
  }

  /**
   * Computes the filter flag bitmask and ordered bind parameters.
   *
   * @param options Filter fields from query_memory.
   * @returns Flags and parameters including trailing limit.
   */
  public static buildParams(options: {
    file_path?: string;
    since?: number;
    status?: string;
    limit?: number;
  }): { flags: FilterFlags; params: unknown[] } {
    const flags = IntentFilteredQueries.computeFlags(options);
    const params: unknown[] = [];

    if (options.file_path) params.push(options.file_path);
    if (options.since !== undefined) params.push(options.since);
    if (options.status) params.push(options.status);

    const limit = options.limit ?? 10;
    if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.INVALID_QUERY,
        'Invalid limit: must be between 1 and 500'
      );
    }
    params.push(Math.floor(limit));

    return { flags, params };
  }

  /**
   * Bind parameters for count queries (same filters, no limit).
   *
   * @param options Filter fields from query_memory.
   * @returns Flags and count bind parameters.
   */
  public static buildCountParams(options: {
    file_path?: string;
    since?: number;
    status?: string;
    limit?: number;
  }): { flags: FilterFlags; params: unknown[] } {
    const flags = IntentFilteredQueries.computeFlags(options);
    const params: unknown[] = [];

    if (options.file_path) params.push(options.file_path);
    if (options.since !== undefined) params.push(options.since);
    if (options.status) params.push(options.status);

    return { flags, params };
  }
}
