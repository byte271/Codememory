import Database from 'better-sqlite3';
import { join } from 'path';
import * as initialMigration from './migrations/001_initial.js';
import * as cascadeMigration from './migrations/002_cascade_fks.js';
import * as provenanceMigration from './migrations/003_provenance_fts_lineage.js';
import { logger } from '../utils/logger.js';

/**
 * Migration interface for database versioning.
 */
interface Migration {
  up: (db: Database.Database) => void;
  down: (db: Database.Database) => void;
}

/**
 * Database manager for Codememory.
 * Manages SQLite connection, migrations, and statement caching.
 *
 * Follows Rule 02: NEVER use cloud dependencies in v1. SQLite only.
 * Follows Rule 08: NEVER break the data schema without a migration file.
 */
export class DatabaseManager {
  private db: Database.Database;
  private migrations: Migration[] = [initialMigration, cascadeMigration, provenanceMigration];
  /** Cached prepared statements — avoids re-compiling SQL on every call. */
  private stmtCache = new Map<string, Database.Statement>();

  /**
   * Initializes the database connection and runs all pending migrations.
   * Uses WAL journal mode for better concurrent read performance.
   *
   * @param dbPath Optional path to the SQLite database file.
   *               Defaults to `codememory.db` in the current working directory.
   */
  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? join(process.cwd(), 'codememory.db');
    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    // synchronous=FULL ensures no committed transactions are lost on power
    // failure. WAL mode keeps this safe from corruption regardless.
    this.db.pragma('synchronous = FULL');
    // Retry up to 5 s when another writer holds the lock (WAL single-writer).
    this.db.pragma('busy_timeout = 5000');
    // Auto-checkpoint WAL every 1000 pages (≈4 MB) to prevent unbounded growth.
    this.db.pragma('wal_autocheckpoint = 1000');
    this.runMigrations();
  }

  /**
   * Returns a cached prepared statement for the given SQL.
   * Compiles the statement on first use and reuses it on subsequent calls.
   * This avoids the overhead of re-parsing SQL on every query.
   *
   * @param sql The SQL string to prepare.
   * @returns The cached prepared statement.
   */
  public prepare(sql: string): Database.Statement {
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  /**
   * Runs all pending migrations in a single transaction.
   * If any migration fails, the whole batch is rolled back.
   */
  private runMigrations(): void {
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          version INTEGER NOT NULL,
          applied_at INTEGER NOT NULL
        )
      `);

      const row = this.db.prepare(
        'SELECT MAX(version) as version FROM _migrations'
      ).get() as { version: number | null };
      const currentVersion = row?.version ?? 0;

      this.migrations.forEach((migration, index) => {
        const version = index + 1;
        if (version > currentVersion) {
          migration.up(this.db);
          this.db
            .prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)')
            .run(version, Date.now());
          logger.info(`Applied migration v${version}`);
        }
      });
    })();
  }

  /**
   * Returns the raw database instance for direct use by query classes.
   * Query classes should call prepare() on this manager rather than on
   * the raw db to benefit from statement caching.
   *
   * @returns The better-sqlite3 database instance.
   */
  public getDb(): Database.Database {
    return this.db;
  }

  /**
   * Closes the database connection safely.
   * Checkpoints the WAL file first to ensure all committed data is
   * flushed to the main database file before closing.
   *
   * Follows Rule 06: Logs closure errors.
   */
  public close(): void {
    try {
      // RESTART checkpoints without blocking on active readers — safer than
      // FULL which can hang indefinitely under concurrent read load.
      // Any uncheckpointed data remains in the WAL file and is recovered on
      // next open, so data integrity is preserved.
      this.db.pragma('wal_checkpoint(RESTART)');
      this.stmtCache.clear();
      this.db.close();
    } catch (error) {
      logger.error('Failed to close database connection', error);
      throw error;
    }
  }
}
