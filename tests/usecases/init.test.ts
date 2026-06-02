import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { fixedClock } from '../../src/domain/clock.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('initProject', () => {
  it('creates .apm with a db and config', () => {
    const res = initProject(dir, fixedClock('2026-06-02T12:00:00.000Z'));
    expect(res.created).toBe(true);
    expect(existsSync(join(dir, '.apm', 'apm.db'))).toBe(true);
    expect(existsSync(join(dir, '.apm', 'config.yaml'))).toBe(true);
    expect(readFileSync(join(dir, '.apm', 'config.yaml'), 'utf8')).toMatch(/capabilities:/);
  });

  it('is idempotent — second run reports already-initialized', () => {
    initProject(dir, fixedClock('2026-06-02T12:00:00.000Z'));
    const res = initProject(dir, fixedClock('2026-06-02T12:00:00.000Z'));
    expect(res.created).toBe(false);
  });

  it('uses the injected storage factory with the resolved db path', () => {
    const calls: string[] = [];
    const clock = fixedClock('2026-06-02T12:00:00.000Z');
    const res = initProject(dir, clock, (path, c) => {
      calls.push(path);
      return new SqliteStorage(path, c);
    });
    expect(res.created).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(res.dbPath);
    expect(isAbsolute(res.dbPath)).toBe(true);
  });
});
