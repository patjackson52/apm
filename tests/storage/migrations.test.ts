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
});
