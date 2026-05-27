/**
 * Structured logger for Codememory.
 * Follows Rule 06: NEVER silently catch errors. Every error must be logged with full context.
 *
 * Log level is controlled by LOG_LEVEL: silent | error | warn | info (default: info).
 */

type LogLevel = 'silent' | 'error' | 'warn' | 'info';

const LEVEL_RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
};

/**
 * Resolves the active log level from LOG_LEVEL env (defaults to info).
 */
function resolveLogLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  if (raw === 'silent' || raw === 'error' || raw === 'warn' || raw === 'info') {
    return raw;
  }
  return 'info';
}

let cachedLevel: LogLevel | undefined;

/**
 * @returns Current minimum log level.
 */
function getLogLevel(): LogLevel {
  if (cachedLevel === undefined) {
    cachedLevel = resolveLogLevel();
  }
  return cachedLevel;
}

/**
 * @param level Level required for the message to emit.
 * @returns True when the message should be written.
 */
function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[getLogLevel()] >= LEVEL_RANK[level];
}

/**
 * Writes a JSON log line to the given stream.
 */
function writeLog(
  stream: 'log' | 'warn' | 'error',
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): void {
  if (!shouldLog(level)) return;
  const line = JSON.stringify({
    level,
    message,
    context,
    timestamp: new Date().toISOString(),
  });
  if (stream === 'error') console.error(line);
  else if (stream === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  /**
   * Logs an info message.
   * @param message The message to log.
   * @param context Additional context.
   */
  info(message: string, context?: Record<string, unknown>): void {
    writeLog('log', 'info', message, context);
  },

  /**
   * Logs an error message.
   * @param message The message to log.
   * @param error The error object.
   * @param context Additional context.
   */
  error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    // Prefix error property keys to avoid silently overwriting user context
    // keys that happen to have the same name (e.g. name, message, stack).
    const errorContext = error instanceof Error
      ? { errorName: error.name, errorMessage: error.message, errorStack: error.stack }
      : { error };

    writeLog('error', 'error', message, { ...context, ...errorContext });
  },

  /**
   * Logs a warning message.
   * @param message The message to log.
   * @param context Additional context.
   */
  warn(message: string, context?: Record<string, unknown>): void {
    writeLog('warn', 'warn', message, context);
  },
};
