import { DatabaseManager } from '../database.js';
import { RuntimeSnapshot, FailureRecord } from '../../types/index.js';

/**
 * Queries for the runtime_snapshots and failures tables.
 * Uses DatabaseManager's statement cache for all SQL operations.
 * Follows Rule 03: NEVER write a function without a JSDoc comment.
 */
export class RuntimeQueries {
  private manager: DatabaseManager;

  /**
   * @param manager The DatabaseManager instance (provides connection + stmt cache).
   */
  constructor(manager: DatabaseManager) {
    this.manager = manager;
  }

  /**
   * Inserts a new runtime snapshot into the database.
   * @param snapshot The snapshot to insert.
   */
  public insertSnapshot(snapshot: RuntimeSnapshot): void {
    this.manager.prepare(`
      INSERT INTO runtime_snapshots (id, intent_id, recorded_at, function_name, file_path, arguments, return_value, duration_ms, success)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.id,
      snapshot.intent_id,
      snapshot.recorded_at,
      snapshot.function_name,
      snapshot.file_path,
      snapshot.arguments,
      snapshot.return_value,
      snapshot.duration_ms,
      snapshot.success
    );
  }

  /**
   * Inserts a new failure record into the database.
   * @param failure The failure record to insert.
   */
  public insertFailure(failure: FailureRecord): void {
    this.manager.prepare(`
      INSERT INTO failures (id, intent_id, snapshot_id, failed_at, error_type, error_message, stack_trace, call_chain, repair_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      failure.id,
      failure.intent_id,
      failure.snapshot_id,
      failure.failed_at,
      failure.error_type,
      failure.error_message,
      failure.stack_trace,
      failure.call_chain,
      failure.repair_status
    );
  }

  /**
   * Retrieves all runtime snapshots for a given intent, ordered oldest first.
   * @param intentId The memory ID of the intent.
   * @returns An array of runtime snapshots.
   */
  public getSnapshotsByIntentId(intentId: string): RuntimeSnapshot[] {
    return this.manager.prepare(
      'SELECT * FROM runtime_snapshots WHERE intent_id = ? ORDER BY recorded_at ASC'
    ).all(intentId) as RuntimeSnapshot[];
  }

  /**
   * Retrieves all failure records for a given intent, newest first.
   * @param intentId The memory ID of the intent.
   * @returns An array of failure records.
   */
  public getFailuresByIntentId(intentId: string): FailureRecord[] {
    return this.manager.prepare(
      'SELECT * FROM failures WHERE intent_id = ? ORDER BY failed_at DESC'
    ).all(intentId) as FailureRecord[];
  }

  /**
   * Retrieves a failure record by its ID.
   * @param id The failure ID.
   * @returns The failure record, or undefined if not found.
   */
  public getFailureById(id: string): FailureRecord | undefined {
    return this.manager.prepare(
      'SELECT * FROM failures WHERE id = ?'
    ).get(id) as FailureRecord | undefined;
  }

  /**
   * Retrieves a runtime snapshot by its ID.
   * @param id The snapshot ID.
   * @returns The snapshot, or undefined if not found.
   */
  public getSnapshotById(id: string): RuntimeSnapshot | undefined {
    return this.manager.prepare(
      'SELECT * FROM runtime_snapshots WHERE id = ?'
    ).get(id) as RuntimeSnapshot | undefined;
  }

  /**
   * Updates the repair_status of a failure record.
   * @param id The failure ID.
   * @param status The new repair status.
   */
  public updateFailureStatus(id: string, status: FailureRecord['repair_status']): void {
    this.manager.prepare(
      'UPDATE failures SET repair_status = ? WHERE id = ?'
    ).run(status, id);
  }

  /**
   * Returns the count of unresolved failures for a given intent.
   * @param intentId The memory ID of the intent.
   * @returns The number of unresolved failures.
   */
  public countUnresolvedFailures(intentId: string): number {
    const row = this.manager.prepare(
      `SELECT COUNT(*) as count FROM failures WHERE intent_id = ? AND repair_status = 'unresolved'`
    ).get(intentId) as { count: number };
    return row.count;
  }

  /**
   * Deletes an intent and cascades to snapshots/failures (migration v2).
   * @param intentId The memory ID to delete.
   */
  public deleteIntentCascade(intentId: string): void {
    this.manager.prepare('DELETE FROM intent_records WHERE id = ?').run(intentId);
  }

  /**
   * Removes the oldest snapshots for an intent when count exceeds maxKeep.
   * Preserves the newest rows so repair briefs stay relevant under load.
   *
   * @param intentId The memory_id whose snapshot history to trim.
   * @param maxKeep  Maximum snapshots to retain (must be > 0).
   * @returns Number of rows deleted.
   */
  public pruneSnapshots(intentId: string, maxKeep: number): number {
    const countRow = this.manager.prepare(
      'SELECT COUNT(*) as total FROM runtime_snapshots WHERE intent_id = ?'
    ).get(intentId) as { total: number };

    const excess = countRow.total - maxKeep;
    if (excess <= 0) return 0;

    const result = this.manager.prepare(`
      DELETE FROM runtime_snapshots
      WHERE id IN (
        SELECT id FROM runtime_snapshots
        WHERE intent_id = ?
        ORDER BY recorded_at ASC
        LIMIT ?
      )
    `).run(intentId, excess);

    return result.changes;
  }
}
