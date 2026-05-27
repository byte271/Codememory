import { IntentQueries } from '../store/queries/intent.js';
import { RuntimeQueries } from '../store/queries/runtime.js';
import { CodememoryError, CODEMEMORY_ERROR_CODES } from './errors.js';

/**
 * Ensures a memory_id exists before attaching runtime or failure rows.
 *
 * @param intentQueries Query accessor for intent_records.
 * @param memoryId      The memory_id from tool input.
 * @throws CodememoryError  When no intent row exists.
 */
export function assertIntentExists(intentQueries: IntentQueries, memoryId: string): void {
  if (!intentQueries.exists(memoryId)) {
    throw new CodememoryError(
      CODEMEMORY_ERROR_CODES.INTENT_NOT_FOUND,
      `No intent record found for memory_id: ${memoryId}`
    );
  }
}

/**
 * When a snapshot_id is supplied, ensures it exists and belongs to the intent.
 *
 * @param runtimeQueries Query accessor for runtime_snapshots.
 * @param memoryId       Intent memory_id from tool input.
 * @param snapshotId     Optional snapshot to link.
 * @throws CodememoryError   When snapshot is missing or mismatched.
 */
export function assertSnapshotBelongsToIntent(
  runtimeQueries: RuntimeQueries,
  memoryId: string,
  snapshotId: string | undefined
): void {
  if (!snapshotId) return;

  const snapshot = runtimeQueries.getSnapshotById(snapshotId);
  if (!snapshot) {
    throw new CodememoryError(
      CODEMEMORY_ERROR_CODES.SNAPSHOT_NOT_FOUND,
      `No runtime snapshot found for snapshot_id: ${snapshotId}`
    );
  }
  if (snapshot.intent_id !== memoryId) {
    throw new CodememoryError(
      CODEMEMORY_ERROR_CODES.SNAPSHOT_INTENT_MISMATCH,
      `snapshot_id ${snapshotId} belongs to intent ${snapshot.intent_id}, not ${memoryId}`
    );
  }
}
