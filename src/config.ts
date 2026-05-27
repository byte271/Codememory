/**
 * Runtime configuration from environment variables.
 * Keeps cloud-free defaults suitable for local SQLite usage (Rule 02).
 *
 * v0.3.0: Added auto-heal, dashboard, and guard configuration options.
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

// ── v0.3.0: Auto-Heal configuration ──────────────────────────────────────

/**
 * Polling interval in milliseconds for the auto-heal background worker.
 * Default: 30 seconds (30000).
 *
 * Override with CODEMEMORY_AUTOHEAL_POLL_MS.
 */
export function getAutoHealPollMs(): number {
  const raw = process.env.CODEMEMORY_AUTOHEAL_POLL_MS;
  if (!raw) return 30_000;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 5_000 ? parsed : 30_000;
}

/**
 * Maximum concurrent auto-heal tasks. Keeps resource usage bounded when
 * many failures pile up. Default: 3.
 *
 * Override with CODEMEMORY_AUTOHEAL_MAX_CONCURRENT.
 */
export function getAutoHealMaxConcurrent(): number {
  const raw = process.env.CODEMEMORY_AUTOHEAL_MAX_CONCURRENT;
  if (!raw) return 3;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

/**
 * Whether the auto-heal worker is enabled. Default: true.
 *
 * Override with CODEMEMORY_AUTOHEAL_ENABLED (set to "false" or "0" to disable).
 */
export function isAutoHealEnabled(): boolean {
  const raw = process.env.CODEMEMORY_AUTOHEAL_ENABLED;
  if (!raw) return true;
  return raw !== 'false' && raw !== '0';
}

// ── v0.3.0: Dashboard configuration ──────────────────────────────────────

/**
 * TCP port for the Behavioral Time Machine dashboard. Default: 4210.
 *
 * Override with CODEMEMORY_DASHBOARD_PORT.
 */
export function getDashboardPort(): number {
  const raw = process.env.CODEMEMORY_DASHBOARD_PORT;
  if (!raw) return 4210;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 65536 ? parsed : 4210;
}

/**
 * Whether the dashboard web UI is enabled. Default: false (opt-in for security).
 *
 * Override with CODEMEMORY_DASHBOARD_ENABLED (set to "true" or "1" to enable).
 */
export function isDashboardEnabled(): boolean {
  const raw = process.env.CODEMEMORY_DASHBOARD_ENABLED;
  return raw === 'true' || raw === '1';
}

// ── v0.3.0: Predictive Guard configuration ───────────────────────────────

/**
 * Minimum confidence threshold for guard warnings to be surfaced.
 * Warnings below this threshold are filtered out. Default: 0.3.
 *
 * Override with CODEMEMORY_GUARD_CONFIDENCE_THRESHOLD (0.0–1.0).
 */
export function getGuardConfidenceThreshold(): number {
  const raw = process.env.CODEMEMORY_GUARD_CONFIDENCE_THRESHOLD;
  if (!raw) return 0.3;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.3;
}

// ── v0.2.0: Input size limits to prevent DoS and DB bloat ──────────────

export const MAX_PROMPT_LENGTH = 65_536;
export const MAX_CODE_LENGTH = 262_144;
export const MAX_PATH_LENGTH = 1_024;
export const MAX_LABEL_LENGTH = 256;
export const MAX_ERROR_TYPE_LENGTH = 256;
export const MAX_ERROR_MESSAGE_LENGTH = 4_096;
export const MAX_STACK_TRACE_LENGTH = 32_768;
export const MAX_CALL_CHAIN_LENGTH = 50;
export const MAX_CALL_CHAIN_ELEMENT_LENGTH = 256;
export const MAX_PROVENANCE_FIELD_LENGTH = 4_096;
export const MAX_ARGUMENTS_LENGTH = 100;
export const MAX_QUERY_LENGTH = 1_024;
export const MAX_REPLACEMENT_REASON_LENGTH = 512;
export const MAX_SANITIZER_ARRAY_LENGTH = 1_000;
export const MAX_SANITIZER_OBJECT_KEYS = 500;

/**
 * Truncates a string to maxLen, appending a truncation marker when cut.
 * Pass-through for strings within limits.
 */
export function truncate(value: string, maxLen: number): string {
  return value.length > maxLen ? value.slice(0, maxLen) + '…' : value;
}
