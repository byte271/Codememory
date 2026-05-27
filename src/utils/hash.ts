import { createHash, randomBytes } from 'crypto';

/**
 * Hash utility for generating memory and snapshot IDs.
 * Follows Rule 05: NEVER create a file longer than 300 lines.
 */
export const hash = {
  /**
   * Generates a deterministic SHA256-based ID from content alone.
   * Given the same input, this always returns the same 64-character hex
   * string, making it safe to use as a stable content-addressed identifier.
   *
   * Use for intent records where `generated_code` differentiates revisions.
   * Do not use for high-frequency runtime rows — use {@link generateUniqueId}.
   *
   * Content-addressable: same input always produces the same ID so
   * capture_intent is naturally idempotent (SQLITE_CONSTRAINT on
   * duplicate PRIMARY KEY returns duplicate: true).
   *
   * @param content The primary content to hash (prompt, function name, etc.).
   * @returns       A 64-character hex string.
   */
  generateMemoryId(content: string): string {
    return createHash('sha256')
      .update(content)
      .digest('hex');
  },

  /**
   * Generates a unique SHA256-based ID for append-only records (snapshots, failures).
   * Millisecond timestamps alone collide under burst traffic (benchmarks, hooks);
   * a random nonce guarantees uniqueness without a central sequence allocator.
   *
   * @param content Domain prefix (memory_id, function name, etc.) for traceability.
   * @returns       A 64-character hex string.
   */
  generateUniqueId(content: string): string {
    const nonce = randomBytes(8).toString('hex');
    return createHash('sha256')
      .update(`${content}-${Date.now()}-${nonce}`)
      .digest('hex');
  },
};
