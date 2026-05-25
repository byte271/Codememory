/**
 * Sanitizer utility for Codememory.
 * Handles circular references, special object types, and sensitive data redaction.
 * Follows Rule 05: NEVER create a file longer than 300 lines. Split into modules.
 */

const SENSITIVE_KEYS = ['password', 'secret', 'token', 'auth', 'cookie', 'bearer', 'credential'];

/**
 * Returns true when a property name should be redacted (avoids false positives like "monkey").
 *
 * @param key Object property name.
 */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (lower === 'key' || lower.endsWith('_key') || lower.endsWith('-key')) {
    return true;
  }
  if (lower === 'apikey' || lower === 'api_key') {
    return true;
  }
  return SENSITIVE_KEYS.some(sk => lower.includes(sk));
}
const MAX_DEPTH = 10;
const MAX_STRING_LENGTH = 2048;

/**
 * Serializes an Error object into a plain object with its useful properties.
 * Error properties (message, stack, name) are non-enumerable and would be
 * lost by Object.entries(), so we extract them explicitly.
 */
function serializeError(err: Error): Record<string, unknown> {
  return {
    __type: 'Error',
    name: err.name,
    message: err.message,
    stack: err.stack?.slice(0, 500) ?? '',
  };
}

/**
 * Recursively sanitizes a value, stripping sensitive keys and handling
 * circular references, Error objects, and non-serializable types.
 *
 * @param data    The value to sanitize.
 * @param seen    WeakSet tracking visited objects to detect cycles.
 * @param depth   Current recursion depth — stops at MAX_DEPTH.
 * @returns       A sanitized, JSON-safe representation of the value.
 */
function sanitizeValue(data: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > MAX_DEPTH) return '[Max depth reached]';

  // Primitives pass through directly
  if (data === null || data === undefined) return data;
  if (typeof data === 'boolean' || typeof data === 'number') return data;
  if (typeof data === 'bigint') return data.toString();
  if (typeof data === 'symbol') return data.toString();
  if (typeof data === 'function') return '[Function]';

  if (typeof data === 'string') {
    return data.length > MAX_STRING_LENGTH
      ? data.slice(0, MAX_STRING_LENGTH) + '...[truncated]'
      : data;
  }

  // Object types — check for cycles first
  if (typeof data === 'object') {
    if (seen.has(data as object)) return '[Circular]';
    seen.add(data as object);

    // Error instances: extract non-enumerable properties explicitly
    if (data instanceof Error) {
      return serializeError(data);
    }

    // Date: preserve as ISO string
    if (data instanceof Date) {
      return data.toISOString();
    }

    // RegExp: preserve as string representation
    if (data instanceof RegExp) {
      return data.toString();
    }

    // Arrays
    if (Array.isArray(data)) {
      return data.map(item => sanitizeValue(item, seen, depth + 1));
    }

    // Plain objects and class instances
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const isSensitive = isSensitiveKey(key);
      sanitized[key] = isSensitive ? '[REDACTED]' : sanitizeValue(value, seen, depth + 1);
    }
    return sanitized;
  }

  return String(data);
}

export const sanitizer = {
  /**
   * Sanitizes data for safe storage:
   * - Redacts sensitive keys (password, token, key, auth, etc.)
   * - Handles circular references (replaces with '[Circular]')
   * - Serializes Error objects with name/message/stack
   * - Converts Date → ISO string, RegExp → string, BigInt → string
   * - Truncates strings longer than 2048 characters
   * - Stops recursion at depth 10
   *
   * @param data The data to sanitize.
   * @returns A sanitized, JSON-safe representation.
   */
  sanitize(data: unknown): unknown {
    return sanitizeValue(data, new WeakSet(), 0);
  },
};
