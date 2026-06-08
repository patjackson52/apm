import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as prompt from '../../src/usecases/prompt.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-pmt-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('prompt usecases', () => {
  it('create rejects a name that already exists', () => {
    prompt.create(ctx(), { name: 'dup', body: 'one' });
    expect(() => prompt.create(ctx(), { name: 'dup', body: 'two' })).toThrow(/already exists/i);
  });

  it('create rejects an invalid name', () => {
    expect(() => prompt.create(ctx(), { name: 'bad name/slash', body: 'x' })).toThrow(/invalid prompt name/i);
  });

  it('revise creates the next version; show resolves latest and a specific version', () => {
    prompt.create(ctx(), { name: 'p', body: 'v1' });
    const v2 = prompt.revise(ctx(), { name: 'p', body: 'v2' });
    expect(v2.version).toBe(2);
    expect(prompt.show(ctx(), 'p').body).toBe('v2');
    expect(prompt.show(ctx(), 'p', 1).body).toBe('v1');
  });

  it('revise rejects an unknown name', () => {
    expect(() => prompt.revise(ctx(), { name: 'nope', body: 'x' })).toThrow(/not found/i);
  });
});
