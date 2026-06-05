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
  {
    // Persist the agent-format dispatch contract on each step run (for reference + viewer UI).
    // schema.sql already declares the column for fresh DBs (applied at v1), so the ALTER is
    // guarded and only fires for databases created before this column existed.
    version: 2,
    up: (db, stamp) => {
      const cols = db.prepare('PRAGMA table_info(workflow_step_runs)').all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'dispatch_prompt')) {
        db.exec('ALTER TABLE workflow_step_runs ADD COLUMN dispatch_prompt TEXT');
      }
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(2, stamp);
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
