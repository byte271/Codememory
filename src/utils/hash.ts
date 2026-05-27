import { createHash, randomBytes } from 'crypto';

/**
 * Hash utility for generating memory and snapshot IDs.
 * Follows Rule 05: NEVER create a file longer than 300 lines.
 */
export const hash = {
  /**
   * Generates a deterministic SHA256-based ID from content and a timestamp.
   * Given the same inputs, this always returns the same 64-character hex
   * string, making it safe to use as a stable content-addressed identifier.
   *
   * Use for intent records where `generated_code` differentiates revisions.
   * Do not use for high-frequency runtime rows — use {@link generateUniqueId}.
   *
   * @param content   The primary content to hash (prompt, function name, etc.).
   * @param timestamp Unix epoch in milliseconds.
   * @returns         A 64-character hex string.
   */
  generateMemoryId(content: string, timestamp: number): string {
    return createHash('sha256')
      .update(`${content}-${timestamp}`)
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
