/**
 * Runtime configuration from environment variables.
 * Keeps cloud-free defaults suitable for local SQLite usage (Rule 02).
 */

const DEFAULT_MAX_SNAPSHOTS = 200;

/**
 * Maximum runtime snapshots retained per intent. Older rows are pruned
 * after each insert when the count exceeds this limit.
 *
 * Override with CODEMEMORY_MAX_SNAPSHOTS_PER_INTENT (positive integer).
 */
export function getMaxSnapshotsPerIntent(): number {
  const raw = process.env.CODEMEMORY_MAX_SNAPSHOTS_PER_INTENT;
  if (!raw) return DEFAULT_MAX_SNAPSHOTS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_SNAPSHOTS;
}
