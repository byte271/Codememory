/**
 * Detects SQLite UNIQUE / PRIMARY KEY constraint errors from better-sqlite3.
 *
 * @param error Caught database error.
 * @returns True when the error is a uniqueness violation.
 */
export function isSqliteUniqueConstraint(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  return code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE';
}
