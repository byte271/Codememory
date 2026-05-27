import { DatabaseManager } from '../database.js';
import { FailureRecord } from '../../types/index.js';
import { RuntimeQueries } from './runtime.js';

/**
 * Failure-table API surface. Delegates to {@link RuntimeQueries} so production
 * and tests share one implementation path (no duplicated SQL).
 */
export class FailureQueries {
  private runtime: RuntimeQueries;

  /**
   * @param manager The DatabaseManager instance (provides connection + stmt cache).
   */
  constructor(manager: DatabaseManager) {
    this.runtime = new RuntimeQueries(manager);
  }

  /**
   * Retrieves a failure record by its ID.
   * @param id The failure ID.
   * @returns The failure record, or undefined if not found.
   */
  public getById(id: string): FailureRecord | undefined {
    return this.runtime.getFailureById(id);
  }

  /**
   * Updates the repair_status of a failure record.
   * @param id The failure ID.
   * @param status The new repair status.
   */
  public updateStatus(id: string, status: FailureRecord['repair_status']): void {
    this.runtime.updateFailureStatus(id, status);
  }

  /**
   * Returns the count of unresolved failures for a given intent.
   * @param intentId The memory ID of the intent.
   * @returns The number of unresolved failures.
   */
  public countUnresolved(intentId: string): number {
    return this.runtime.countUnresolvedFailures(intentId);
  }

  /**
   * Inserts a new failure record into the database.
   * @param record The failure record to insert.
   */
  public insert(record: FailureRecord): void {
    this.runtime.insertFailure(record);
  }
}
