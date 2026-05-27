import { Database } from 'better-sqlite3';

/**
 * Migration 005: v0.3.5 — LAN Relay & Team Neural Link.
 *
 * Adds:
 *   1. `peer_nodes`          — discovered LAN peers and their relay addresses.
 *   2. `shared_briefs`       — repair briefs received from peers.
 *   3. `relay_pairing_key`   — table storing the pre-shared encryption key.
 *   4. `last_sync_at`        — column on peer_nodes for incremental sync.
 *
 * Follows Rule 08: NEVER break the data schema without a migration file.
 *
 * @param db The better-sqlite3 database instance.
 */
export function up(db: Database): void {
  db.pragma('foreign_keys = OFF');

  // ── 1. Peer nodes table ────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS peer_nodes (
      id              TEXT PRIMARY KEY,
      hostname        TEXT NOT NULL,
      address         TEXT NOT NULL,
      port            INTEGER NOT NULL,
      last_seen_at    INTEGER NOT NULL,
      last_sync_at    INTEGER,
      is_online       INTEGER NOT NULL DEFAULT 1,
      project_name    TEXT,
      discovered_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_peernodes_online ON peer_nodes(is_online);
    CREATE INDEX IF NOT EXISTS idx_peernodes_address ON peer_nodes(address, port);
  `);

  // ── 2. Shared briefs table ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS shared_briefs (
      id              TEXT PRIMARY KEY,
      peer_id         TEXT NOT NULL,
      failure_id      TEXT NOT NULL,
      error_type      TEXT NOT NULL,
      error_pattern   TEXT NOT NULL,
      suggestion      TEXT NOT NULL,
      approach        TEXT,
      diff_summary    TEXT,
      project_name    TEXT,
      shared_at       INTEGER NOT NULL,
      applied         INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sharedbriefs_peer ON shared_briefs(peer_id);
    CREATE INDEX IF NOT EXISTS idx_sharedbriefs_error ON shared_briefs(error_type);
    CREATE INDEX IF NOT EXISTS idx_sharedbriefs_applied ON shared_briefs(applied);
  `);

  // ── 3. Relay pairing key table ──────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS relay_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  db.pragma('foreign_keys = ON');
}

/**
 * Rollback: removes v0.3.5 relay additions.
 * @param db The better-sqlite3 database instance.
 */
export function down(db: Database): void {
  db.pragma('foreign_keys = OFF');

  db.exec(`DROP TABLE IF EXISTS shared_briefs`);
  db.exec(`DROP TABLE IF EXISTS peer_nodes`);
  db.exec(`DROP TABLE IF EXISTS relay_config`);

  db.pragma('foreign_keys = ON');
}
