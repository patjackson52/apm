import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const schemaSql = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');

/** Ordered migrations. Migration 1 is the full V1 schema. */
const MIGRATIONS: Array<{ version: number; up: (db: Database.Database, stamp: string) => void }> = [
  {
    version: 1,
    up: (db, stamp) => {
      db.exec(schemaSql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(1, stamp);
    },
  },
  // v2: generalize leases to resource leases (resource_type + resource_key columns,
  // nullable work_item_id). SQLite cannot drop NOT NULL via ALTER, so we rebuild the
  // table. schema.sql stays at the OLD v1 shape so v2 always migrates old→new —
  // no index-name collision and no IF EXISTS guards needed.
  {
    version: 2,
    up: (db, stamp) => {
      db.exec(`
        CREATE TABLE leases_new (
          id TEXT PRIMARY KEY,
          resource_type TEXT NOT NULL DEFAULT 'work_item',
          resource_key TEXT NOT NULL,
          work_item_id TEXT,
          agent_id TEXT NOT NULL,
          session_id TEXT,
          status TEXT NOT NULL CHECK (status IN ('active','released','expired')),
          acquired_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          heartbeat_at TEXT,
          FOREIGN KEY(work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT,
          FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
          FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE RESTRICT
        );
        INSERT INTO leases_new (id, resource_type, resource_key, work_item_id, agent_id, session_id, status, acquired_at, expires_at, heartbeat_at)
          SELECT id, 'work_item', work_item_id, work_item_id, agent_id, session_id, status, acquired_at, expires_at, heartbeat_at FROM leases;
        DROP TABLE leases;
        ALTER TABLE leases_new RENAME TO leases;
        CREATE UNIQUE INDEX ux_active_resource ON leases(resource_type, resource_key) WHERE status='active';
        CREATE INDEX ix_leases_wi ON leases(work_item_id, status);
        CREATE INDEX ix_leases_expiry ON leases(status, expires_at);
      `);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(2, stamp);
    },
  },
];

export const CURRENT_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Apply pending migrations in one transaction, gated on PRAGMA user_version. */
export function runMigrations(db: Database.Database, now?: string): void {
  const stamp = now ?? new Date(0).toISOString();
  db.pragma('foreign_keys = ON');
  const current = db.pragma('user_version', { simple: true }) as number;
  const pending = MIGRATIONS.filter((m) => m.version > current);
  if (pending.length === 0) return;
  const apply = db.transaction(() => {
    for (const m of pending) {
      m.up(db, stamp);
      db.pragma(`user_version = ${m.version}`);
    }
  });
  apply.immediate();
}
