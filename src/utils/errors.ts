/** Machine-readable error codes returned in MCP JSON responses. */
export const CODEMEMORY_ERROR_CODES = {
  INTENT_NOT_FOUND: 'intent_not_found',
  SNAPSHOT_NOT_FOUND: 'snapshot_not_found',
  SNAPSHOT_INTENT_MISMATCH: 'snapshot_intent_mismatch',
  DUPLICATE_INTENT: 'duplicate_intent',
  MISSING_REPAIR_TARGET: 'missing_repair_target',
  INVALID_QUERY: 'invalid_query',
} as const;

export type CodememoryErrorCode = (typeof CODEMEMORY_ERROR_CODES)[keyof typeof CODEMEMORY_ERROR_CODES];

/**
 * Validation and domain errors with stable codes for MCP clients (Rule 14).
 */
export class CodememoryError extends Error {
  public readonly code: CodememoryErrorCode;

  /**
   * @param code    Stable identifier for programmatic handling.
   * @param message Human-readable explanation.
   */
  constructor(code: CodememoryErrorCode, message: string) {
    super(message);
    this.name = 'CodememoryError';
    this.code = code;
  }
}

/**
 * Serializes an error into the structured JSON shape MCP tools return on failure.
 *
 * @param error Caught value from tool execution.
 * @returns Structured payload with code when available.
 */
export function formatToolError(error: unknown): { error: { code: string; message: string } } {
  if (error instanceof CodememoryError) {
    return { error: { code: error.code, message: error.message } };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { error: { code: 'internal_error', message } };
}
