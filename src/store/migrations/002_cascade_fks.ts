import { Database } from 'better-sqlite3';

/**
 * Rebuilds child tables so foreign keys use ON DELETE CASCADE / SET NULL.
 * SQLite cannot alter FK actions in place; this migration copies rows safely.
 *
 * Follows Rule 08: schema changes require a migration file.
 *
 * @param db The better-sqlite3 database instance.
 */
export function up(db: Database): void {
  db.pragma('foreign_keys = OFF');

  db.exec(`
    CREATE TABLE runtime_snapshots_new (
      id            TEXT PRIMARY KEY,
      intent_id     TEXT NOT NULL REFERENCES intent_records(id) ON DELETE CASCADE,
      recorded_at   INTEGER NOT NULL,
      function_name TEXT NOT NULL,
      file_path     TEXT NOT NULL,
      arguments     TEXT,
      return_value  TEXT,
      duration_ms   INTEGER,
      success       INTEGER NOT NULL
    );

    INSERT INTO runtime_snapshots_new
      SELECT id, intent_id, recorded_at, function_name, file_path,
             arguments, return_value, duration_ms, success
      FROM runtime_snapshots;

    DROP TABLE runtime_snapshots;
    ALTER TABLE runtime_snapshots_new RENAME TO runtime_snapshots;

    CREATE TABLE failures_new (
      id            TEXT PRIMARY KEY,
      intent_id     TEXT NOT NULL REFERENCES intent_records(id) ON DELETE CASCADE,
      snapshot_id   TEXT REFERENCES runtime_snapshots(id) ON DELETE SET NULL,
      failed_at     INTEGER NOT NULL,
      error_type    TEXT NOT NULL,
      error_message TEXT NOT NULL,
      stack_trace   TEXT,
      call_chain    TEXT,
      repair_status TEXT DEFAULT 'unresolved'
    );

    INSERT INTO failures_new
      SELECT id, intent_id, snapshot_id, failed_at, error_type, error_message,
             stack_trace, call_chain, repair_status
      FROM failures;

    DROP TABLE failures;
    ALTER TABLE failures_new RENAME TO failures;

    CREATE INDEX IF NOT EXISTS idx_runtime_intent ON runtime_snapshots(intent_id);
    CREATE INDEX IF NOT EXISTS idx_failures_intent ON failures(intent_id);
  `);

  db.pragma('foreign_keys = ON');
}

/**
 * Rollback: restores v1-style tables without explicit ON DELETE actions.
 * @param db The better-sqlite3 database instance.
 */
export function down(db: Database): void {
  db.pragma('foreign_keys = OFF');

  db.exec(`
    CREATE TABLE runtime_snapshots_old (
      id            TEXT PRIMARY KEY,
      intent_id     TEXT REFERENCES intent_records(id),
      recorded_at   INTEGER NOT NULL,
      function_name TEXT NOT NULL,
      file_path     TEXT NOT NULL,
      arguments     TEXT,
      return_value  TEXT,
      duration_ms   INTEGER,
      success       INTEGER NOT NULL
    );

    INSERT INTO runtime_snapshots_old
      SELECT id, intent_id, recorded_at, function_name, file_path,
             arguments, return_value, duration_ms, success
      FROM runtime_snapshots;

    DROP TABLE runtime_snapshots;
    ALTER TABLE runtime_snapshots_old RENAME TO runtime_snapshots;

    CREATE TABLE failures_old (
      id            TEXT PRIMARY KEY,
      intent_id     TEXT REFERENCES intent_records(id),
      snapshot_id   TEXT REFERENCES runtime_snapshots(id),
      failed_at     INTEGER NOT NULL,
      error_type    TEXT NOT NULL,
      error_message TEXT NOT NULL,
      stack_trace   TEXT,
      call_chain    TEXT,
      repair_status TEXT DEFAULT 'unresolved'
    );

    INSERT INTO failures_old
      SELECT id, intent_id, snapshot_id, failed_at, error_type, error_message,
             stack_trace, call_chain, repair_status
      FROM failures;

    DROP TABLE failures;
    ALTER TABLE failures_old RENAME TO failures;

    CREATE INDEX IF NOT EXISTS idx_runtime_intent ON runtime_snapshots(intent_id);
    CREATE INDEX IF NOT EXISTS idx_failures_intent ON failures(intent_id);
  `);

  db.pragma('foreign_keys = ON');
}
