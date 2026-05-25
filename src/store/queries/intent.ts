import { DatabaseManager } from '../database.js';
import { IntentRecord } from '../../types/index.js';
import { IntentFilteredQueries } from './intent-filtered.js';

/**
 * Queries for the intent_records table.
 * Uses DatabaseManager's statement cache for all SQL operations.
 * Follows Rule 03: NEVER write a function without a JSDoc comment.
 */
export class IntentQueries {
  private manager: DatabaseManager;
  private filtered: IntentFilteredQueries;

  /**
   * @param manager The DatabaseManager instance (provides connection + stmt cache).
   */
  constructor(manager: DatabaseManager) {
    this.manager = manager;
    this.filtered = new IntentFilteredQueries(manager);
  }

  /**
   * Inserts a new intent record into the database.
   * @param record The intent record to insert.
   */
  public insert(record: IntentRecord): void {
    this.manager.prepare(`
      INSERT INTO intent_records (id, created_at, file_path, prompt, generated, ai_tool, language, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.created_at,
      record.file_path,
      record.prompt,
      record.generated,
      record.ai_tool,
      record.language,
      record.status
    );
  }

  /**
   * Retrieves an intent record by its memory ID.
   * @param id The memory ID of the record.
   * @returns The intent record, or undefined if not found.
   */
  public getById(id: string): IntentRecord | undefined {
    return this.manager.prepare(
      'SELECT * FROM intent_records WHERE id = ?'
    ).get(id) as IntentRecord | undefined;
  }

  /**
   * Returns whether an intent record exists for the given memory_id.
   * Used to reject orphan runtime rows before insert.
   *
   * @param id The memory_id to check.
   * @returns True when a matching intent row exists.
   */
  public exists(id: string): boolean {
    const row = this.manager.prepare(
      'SELECT 1 AS ok FROM intent_records WHERE id = ?'
    ).get(id) as { ok: number } | undefined;
    return row !== undefined;
  }

  /**
   * Retrieves all intent records for a specific file path, newest first.
   * @param filePath The file path to query.
   * @returns An array of intent records.
   */
  public getByFilePath(filePath: string): IntentRecord[] {
    return this.manager.prepare(
      'SELECT * FROM intent_records WHERE file_path = ? ORDER BY created_at DESC'
    ).all(filePath) as IntentRecord[];
  }

  /**
   * Retrieves intent records with optional filtering.
   * Composes WHERE clauses dynamically based on provided options.
   *
   * @param options Filters: file_path, since (epoch ms), status, limit (default 10).
   * @returns Matching records, newest first.
   */
  public getFiltered(options: {
    file_path?: string;
    since?: number;
    status?: string;
    limit?: number;
  }): IntentRecord[] {
    const { flags, params } = IntentFilteredQueries.buildParams(options);
    return this.filtered.query(flags, params);
  }

  /**
   * Counts intent records matching the same filters as getFiltered (ignores limit).
   *
   * @param options Filters: file_path, since (epoch ms), status.
   * @returns Total rows matching the filter.
   */
  public countFiltered(options: {
    file_path?: string;
    since?: number;
    status?: string;
    limit?: number;
  }): number {
    const { flags, params } = IntentFilteredQueries.buildCountParams(options);
    return this.filtered.count(flags, params);
  }
}
