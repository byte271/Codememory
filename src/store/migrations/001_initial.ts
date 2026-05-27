import { Database } from 'better-sqlite3';

/**
 * Initial migration to create the core tables for Codememory.
 * Follows Rule 08: NEVER break the data schema without a migration file.
 * @param db The better-sqlite3 database instance.
 */
export function up(db: Database): void {
  db.exec(`
    -- Every AI-generated code block gets a record
    CREATE TABLE IF NOT EXISTS intent_records (
      id            TEXT PRIMARY KEY,   -- memory_id (SHA256 of content+timestamp)
      created_at    INTEGER NOT NULL,
      file_path     TEXT NOT NULL,
      prompt        TEXT NOT NULL,      -- What the developer asked for
      generated     TEXT NOT NULL,      -- What AI produced
      ai_tool       TEXT NOT NULL,      -- "claude_code" | "cursor" | "copilot" | "other"
      language      TEXT NOT NULL,
      status        TEXT DEFAULT 'active'  -- active | deprecated | replaced
    );

    -- Every function execution gets recorded
    CREATE TABLE IF NOT EXISTS runtime_snapshots (
      id            TEXT PRIMARY KEY,
      intent_id     TEXT REFERENCES intent_records(id),
      recorded_at   INTEGER NOT NULL,
      function_name TEXT NOT NULL,
      file_path     TEXT NOT NULL,
      arguments     TEXT,              -- JSON, sanitized
      return_value  TEXT,              -- JSON, sanitized
      duration_ms   INTEGER,
      success       INTEGER NOT NULL   -- 1 = success, 0 = failure
    );

    -- Failures get their own table with full context
    CREATE TABLE IF NOT EXISTS failures (
      id            TEXT PRIMARY KEY,
      intent_id     TEXT REFERENCES intent_records(id),
      snapshot_id   TEXT REFERENCES runtime_snapshots(id),
      failed_at     INTEGER NOT NULL,
      error_type    TEXT NOT NULL,
      error_message TEXT NOT NULL,
      stack_trace   TEXT,
      call_chain    TEXT,              -- JSON array of function calls
      repair_status TEXT DEFAULT 'unresolved'  -- unresolved | in_progress | resolved
    );

    -- Index for fast lookups
    CREATE INDEX IF NOT EXISTS idx_intent_file ON intent_records(file_path);
    CREATE INDEX IF NOT EXISTS idx_runtime_intent ON runtime_snapshots(intent_id);
    CREATE INDEX IF NOT EXISTS idx_failures_intent ON failures(intent_id);
  `);
}

/**
 * Rollback for the initial migration.
 * @param db The better-sqlite3 database instance.
 */
export function down(db: Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_failures_intent;
    DROP INDEX IF EXISTS idx_runtime_intent;
    DROP INDEX IF EXISTS idx_intent_file;
    DROP TABLE IF EXISTS failures;
    DROP TABLE IF EXISTS runtime_snapshots;
    DROP TABLE IF EXISTS intent_records;
  `);
}
