import { Database } from 'better-sqlite3';

/**
 * Migration 004: v0.3.0 features — Projects, Auto-Heal, Predictive Guard,
 * and Cross-Project Knowledge Graph.
 *
 * Adds:
 *   1. `projects`            — registered project roots for cross-project memory.
 *   2. `project_id` on `intent_records` — scopes intents to a project.
 *   3. `auto_heal_tasks`     — background self-healing task queue.
 *   4. `guard_rules`         — known failure patterns for predictive warnings.
 *   5. `guard_predictions`   — guard rule hit log for analytics.
 *
 * Follows Rule 08: NEVER break the data schema without a migration file.
 *
 * @param db The better-sqlite3 database instance.
 */
export function up(db: Database): void {
  db.pragma('foreign_keys = OFF');

  // ── 1. Projects table ──────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      root_path   TEXT NOT NULL UNIQUE,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_projects_root ON projects(root_path);
  `);

  // ── 2. Auto-Heal tasks ─────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_heal_tasks (
      id              TEXT PRIMARY KEY,
      failure_id      TEXT NOT NULL REFERENCES failures(id) ON DELETE CASCADE,
      status          TEXT NOT NULL DEFAULT 'pending',
      patch_code      TEXT,
      test_results    TEXT,
      pr_url          TEXT,
      error_log       TEXT,
      created_at      INTEGER NOT NULL,
      started_at      INTEGER,
      completed_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_autoheal_failure ON auto_heal_tasks(failure_id);
    CREATE INDEX IF NOT EXISTS idx_autoheal_status ON auto_heal_tasks(status);
  `);

  // ── 3. Guard rules (predictive safety barriers) ────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS guard_rules (
      id              TEXT PRIMARY KEY,
      error_pattern   TEXT NOT NULL,
      error_type      TEXT NOT NULL,
      suggestion      TEXT NOT NULL,
      file_pattern    TEXT DEFAULT '',
      project_id      TEXT REFERENCES projects(id) ON DELETE CASCADE,
      hit_count       INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_guard_error_type ON guard_rules(error_type);
    CREATE INDEX IF NOT EXISTS idx_guard_project ON guard_rules(project_id);
  `);

  // ── 4. Guard predictions log ───────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS guard_predictions (
      id              TEXT PRIMARY KEY,
      intent_id       TEXT REFERENCES intent_records(id) ON DELETE CASCADE,
      rule_id         TEXT REFERENCES guard_rules(id) ON DELETE CASCADE,
      confidence      REAL NOT NULL DEFAULT 0.0,
      was_accurate    INTEGER DEFAULT 0,
      created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_guardpred_intent ON guard_predictions(intent_id);
    CREATE INDEX IF NOT EXISTS idx_guardpred_rule ON guard_predictions(rule_id);
  `);

  // ── 5. Add project_id to intent_records ────────────────────────────────
  const columns = db.prepare('PRAGMA table_info(intent_records)').all() as { name: string }[];
  const columnNames = new Set(columns.map((c) => c.name));
  if (!columnNames.has('project_id')) {
    db.exec(`ALTER TABLE intent_records ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_intent_project ON intent_records(project_id)`);
  }

  // ── 6. Guard rules FTS index for pattern matching ──────────────────────
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS guard_rules_fts USING fts5(
      error_pattern,
      suggestion,
      content='guard_rules',
      content_rowid='rowid'
    );
  `);

  // Rebuild FTS index from existing guard_rules rows
  db.exec(`
    INSERT INTO guard_rules_fts(guard_rules_fts, rowid, error_pattern, suggestion)
      SELECT rowid, rowid, error_pattern, suggestion FROM guard_rules;
  `);

  // Sync triggers for guard_rules FTS
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS guard_rules_fts_ai AFTER INSERT ON guard_rules BEGIN
      INSERT INTO guard_rules_fts(rowid, error_pattern, suggestion) VALUES (new.rowid, new.error_pattern, new.suggestion);
    END;
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS guard_rules_fts_ad AFTER DELETE ON guard_rules BEGIN
      INSERT INTO guard_rules_fts(guard_rules_fts, rowid, error_pattern, suggestion) VALUES('delete', old.rowid, old.error_pattern, old.suggestion);
    END;
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS guard_rules_fts_au AFTER UPDATE ON guard_rules BEGIN
      INSERT INTO guard_rules_fts(guard_rules_fts, rowid, error_pattern, suggestion) VALUES('delete', old.rowid, old.error_pattern, old.suggestion);
      INSERT INTO guard_rules_fts(rowid, error_pattern, suggestion) VALUES (new.rowid, new.error_pattern, new.suggestion);
    END;
  `);

  db.pragma('foreign_keys = ON');
}

/**
 * Rollback: removes v0.3.0 additions.
 * @param db The better-sqlite3 database instance.
 */
export function down(db: Database): void {
  db.pragma('foreign_keys = OFF');

  db.exec(`DROP TRIGGER IF EXISTS guard_rules_fts_ai`);
  db.exec(`DROP TRIGGER IF EXISTS guard_rules_fts_ad`);
  db.exec(`DROP TRIGGER IF EXISTS guard_rules_fts_au`);
  db.exec(`DROP TABLE IF EXISTS guard_rules_fts`);
  db.exec(`DROP TABLE IF EXISTS guard_predictions`);
  db.exec(`DROP TABLE IF EXISTS guard_rules`);
  db.exec(`DROP TABLE IF EXISTS auto_heal_tasks`);
  db.exec(`DROP TABLE IF EXISTS projects`);

  // SQLite cannot DROP COLUMN — project_id on intent_records is harmless.

  db.pragma('foreign_keys = ON');
}
