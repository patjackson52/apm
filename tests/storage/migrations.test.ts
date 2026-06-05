import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, CURRENT_VERSION } from '../../src/storage/migrations.js';

describe('migrations', () => {
  it('applies the schema and sets user_version', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(db.pragma('user_version', { simple: true })).toBe(CURRENT_VERSION);
    const tables = db.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table' AND name='work_items'").get() as any;
    expect(tables.c).toBe(1);
    db.close();
  });

  it('is idempotent — running twice is a no-op', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(CURRENT_VERSION);
    db.close();
  });

  it('seeds the sequences table empty (allocator inserts lazily)', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const rows = db.prepare('SELECT count(*) c FROM sequences').get() as any;
    expect(rows.c).toBe(0);
    db.close();
  });

  it('records applied_at from the provided timestamp', () => {
    const db = new Database(':memory:');
    runMigrations(db, '2026-06-02T12:00:00.000Z');
    const row = db.prepare('SELECT applied_at FROM schema_migrations WHERE version=1').get() as any;
    expect(row.applied_at).toBe('2026-06-02T12:00:00.000Z');
    db.close();
  });

  it('a fresh database has the dispatch_prompt column on workflow_step_runs', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const cols = db.prepare('PRAGMA table_info(workflow_step_runs)').all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === 'dispatch_prompt')).toBe(true);
    db.close();
  });

  it('migration v2 adds dispatch_prompt to a pre-v2 database', () => {
    const db = new Database(':memory:');
    // Simulate a database created before the column existed: user_version=1, no dispatch_prompt.
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)');
    db.exec("INSERT INTO schema_migrations (version, applied_at) VALUES (1, 'x')");
    db.exec('CREATE TABLE workflow_step_runs (id TEXT PRIMARY KEY, workflow_run_id TEXT, step_id TEXT, status TEXT, review_round INTEGER, created_at TEXT)');
    db.pragma('user_version = 1');

    runMigrations(db, '2026-06-02T12:00:00.000Z');

    const cols = db.prepare('PRAGMA table_info(workflow_step_runs)').all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === 'dispatch_prompt')).toBe(true);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    db.close();
  });
});
