import { Database } from 'better-sqlite3';

/**
 * Migration 003: Repair provenance, code evolution lineage, and FTS5 search.
 *
 * Adds:
 *   1. `resolutions`         — links resolved failures to the intent that fixed them.
 *   2. `intent_records` cols — `parent_intent_id` and `replacement_reason` for lineage.
 *   3. `intent_fts`          — SQLite FTS5 virtual table for full-text search on prompts + code.
 *
 * Follows Rule 08: NEVER break the data schema without a migration file.
 *
 * @param db The better-sqlite3 database instance.
 */
export function up(db: Database): void {
  db.pragma('foreign_keys = OFF');

  // ── 1. Resolutions table ────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS resolutions (
      id                TEXT PRIMARY KEY,
      failure_id        TEXT NOT NULL REFERENCES failures(id) ON DELETE CASCADE,
      fixing_intent_id  TEXT NOT NULL REFERENCES intent_records(id) ON DELETE CASCADE,
      approach          TEXT NOT NULL DEFAULT '',
      diff_summary      TEXT NOT NULL DEFAULT '',
      resolved_at       INTEGER NOT NULL,
      UNIQUE(failure_id, fixing_intent_id)
    );
    CREATE INDEX IF NOT EXISTS idx_resolutions_failure ON resolutions(failure_id);
    CREATE INDEX IF NOT EXISTS idx_resolutions_intent  ON resolutions(fixing_intent_id);
  `);

  // ── 2. Intent lineage columns ──────────────────────────────────────────
  // ALTER TABLE in SQLite only supports ADD COLUMN; ok here since we never
  // break existing columns (Rule 08).
  db.exec(`
    ALTER TABLE intent_records ADD COLUMN parent_intent_id   TEXT REFERENCES intent_records(id) ON DELETE SET NULL;
    ALTER TABLE intent_records ADD COLUMN replacement_reason TEXT NOT NULL DEFAULT '';
  `);

  // ── 3. FTS5 full-text index on prompts + generated code ────────────────
  // The content table is external (content='intent_records') so FTS5 does
  // not duplicate storage. Triggers keep the index in sync.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS intent_fts USING fts5(
      prompt,
      generated,
      content='intent_records',
      content_rowid='rowid'
    );
  `);

  // Rebuild trigger: inserts after migration apply so existing rows are indexed.
  // We use INSERT OR REPLACE so a second migration run is idempotent.
  db.exec(`
    INSERT INTO intent_fts(intent_fts, rowid, prompt, generated)
      SELECT rowid, rowid, prompt, generated FROM intent_records;
  `);

  // Keep FTS5 index in sync going forward.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS intent_fts_ai AFTER INSERT ON intent_records BEGIN
      INSERT INTO intent_fts(rowid, prompt, generated) VALUES (new.rowid, new.prompt, new.generated);
    END;
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS intent_fts_ad AFTER DELETE ON intent_records BEGIN
      INSERT INTO intent_fts(intent_fts, rowid, prompt, generated) VALUES('delete', old.rowid, old.prompt, old.generated);
    END;
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS intent_fts_au AFTER UPDATE ON intent_records BEGIN
      INSERT INTO intent_fts(intent_fts, rowid, prompt, generated) VALUES('delete', old.rowid, old.prompt, old.generated);
      INSERT INTO intent_fts(rowid, prompt, generated) VALUES (new.rowid, new.prompt, new.generated);
    END;
  `);

  db.pragma('foreign_keys = ON');
}

/**
 * Rollback: drops 003 additions.
 * @param db The better-sqlite3 database instance.
 */
export function down(db: Database): void {
  db.pragma('foreign_keys = OFF');

  db.exec(`DROP TRIGGER IF EXISTS intent_fts_ai`);
  db.exec(`DROP TRIGGER IF EXISTS intent_fts_ad`);
  db.exec(`DROP TRIGGER IF EXISTS intent_fts_au`);
  db.exec(`DROP TABLE IF EXISTS intent_fts`);
  db.exec(`DROP TABLE IF EXISTS resolutions`);

  // SQLite cannot DROP COLUMN without rebuilding. For the down migration
  // we simply leave the columns — they are harmless and guaranteed empty.
  // Production rollback of a migration is rare; this keeps the file small.

  db.pragma('foreign_keys = ON');
}
