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

// ── v0.2.0: Input size limits to prevent DoS and DB bloat ──────────────
// All MCP tool string inputs are capped at these limits. Override via env.

/** Max prompt length for capture_intent (default 64KB). */
export const MAX_PROMPT_LENGTH = 65_536;

/** Max generated_code length for capture_intent (default 256KB). */
export const MAX_CODE_LENGTH = 262_144;

/** Max file_path length (default 1024 chars). */
export const MAX_PATH_LENGTH = 1_024;

/** Max ai_tool / language / function_name length (default 256 chars). */
export const MAX_LABEL_LENGTH = 256;

/** Max error_type length for log_failure (default 256 chars). */
export const MAX_ERROR_TYPE_LENGTH = 256;

/** Max error_message length for log_failure (default 4KB). */
export const MAX_ERROR_MESSAGE_LENGTH = 4_096;

/** Max stack_trace length for log_failure (default 32KB). */
export const MAX_STACK_TRACE_LENGTH = 32_768;

/** Max call_chain array elements for log_failure (default 50). */
export const MAX_CALL_CHAIN_LENGTH = 50;

/** Max call_chain element string length (default 256 chars each). */
export const MAX_CALL_CHAIN_ELEMENT_LENGTH = 256;

/** Max approach / diff_summary length for log_resolution (default 4KB each). */
export const MAX_PROVENANCE_FIELD_LENGTH = 4_096;

/** Max arguments array elements for record_runtime (default 100). */
export const MAX_ARGUMENTS_LENGTH = 100;

/** Max FTS5 query length (default 1KB). */
export const MAX_QUERY_LENGTH = 1_024;

/** Max replacement_reason length (default 512 chars). */
export const MAX_REPLACEMENT_REASON_LENGTH = 512;

/** Max array elements processed by sanitizer (breadth DoS guard). */
export const MAX_SANITIZER_ARRAY_LENGTH = 1_000;

/** Max object keys processed by sanitizer (breadth DoS guard). */
export const MAX_SANITIZER_OBJECT_KEYS = 500;

/**
 * Truncates a string to maxLen, appending a truncation marker when cut.
 * Pass-through for strings within limits.
 */
export function truncate(value: string, maxLen: number): string {
  return value.length > maxLen ? value.slice(0, maxLen) + '…' : value;
}
