import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';

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
    const db = new Database(join(dir, '.apm', 'apm.db'));
    try {
      const ver = db.pragma('user_version', { simple: true }) as number;
      expect(ver).toBeGreaterThanOrEqual(2);
    } finally { db.close(); }
  });
});
