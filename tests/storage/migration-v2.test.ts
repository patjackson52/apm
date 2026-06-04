import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import { MIGRATIONS, runMigrations } from '../../src/storage/migrations.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-03T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-mig-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });

describe('migration v2 — resource leases', () => {
  it('adds resource_type/resource_key columns and makes work_item_id nullable', () => {
    const db = new Database(join(dir, '.apm', 'apm.db'));
    try {
      const cols = db.prepare("PRAGMA table_info('leases')").all() as Array<{ name: string; notnull: number }>;
      const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
      expect(byName.resource_type).toBeTruthy();
      expect(byName.resource_key).toBeTruthy();
      expect(byName.work_item_id.notnull).toBe(0);
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='leases'").all() as Array<{ name: string }>;
      const names = idx.map((i) => i.name);
      expect(names).toContain('ux_active_resource');
      expect(names).not.toContain('ux_active_lease');
    } finally { db.close(); }
  });

  it('backfills resource_type/resource_key for pre-existing work-item leases', () => {
    // Use a separate temp DB to simulate a v1-shaped database with an existing lease row.
    const v1dir = mkdtempSync(join(tmpdir(), 'apm-mig-v1-'));
    const dbPath = join(v1dir, 'v1.db');
    try {
      // 1. Open raw DB and apply only migration v1.
      const raw = new Database(dbPath);
      raw.pragma('foreign_keys = ON');
      const stamp = '2026-06-03T00:00:00.000Z';
      MIGRATIONS[0].up(raw, stamp); // runs schema.sql (v1 shape)
      raw.pragma('user_version = 1');

      // 2. Insert minimal rows satisfying FKs, then a v1-shaped lease row.
      raw.prepare(
        "INSERT INTO agents (id, name, type, created_at) VALUES (?, ?, ?, ?)"
      ).run('AGT-1', 'test-agent', 'ai', stamp);
      raw.prepare(
        "INSERT INTO sequences (prefix, next_value) VALUES (?, ?)"
      ).run('WI', 1);
      raw.prepare(
        "INSERT INTO work_items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run('WI-1', 'task', 'Test task', 'ready', stamp, stamp);

      // v1 leases shape: no resource_type/resource_key columns.
      raw.prepare(
        `INSERT INTO leases (id, work_item_id, agent_id, session_id, status, acquired_at, expires_at, heartbeat_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('LEASE-1', 'WI-1', 'AGT-1', null, 'active', stamp, '2026-06-03T01:00:00.000Z', null);

      raw.close();

      // 3. Run migrations on the raw DB (v1→v2).
      const raw2 = new Database(dbPath);
      runMigrations(raw2, stamp);
      raw2.close();

      // 4. Re-open and assert backfill.
      const verify = new Database(dbPath);
      try {
        const row = verify.prepare("SELECT resource_type, resource_key, work_item_id FROM leases WHERE id = ?").get('LEASE-1') as
          { resource_type: string; resource_key: string; work_item_id: string };
        expect(row).toBeTruthy();
        expect(row.resource_type).toBe('work_item');
        expect(row.resource_key).toBe('WI-1');
        expect(row.work_item_id).toBe('WI-1');
      } finally { verify.close(); }
    } finally {
      rmSync(v1dir, { recursive: true, force: true });
    }
  });
});
