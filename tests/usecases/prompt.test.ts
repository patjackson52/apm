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

  it('listSummaries returns latest-per-name with derived summary', () => {
    prompt.create(ctx(), { name: 'a', body: 'A one\nA two' });
    prompt.revise(ctx(), { name: 'a', body: 'A three' });
    const a = prompt.listSummaries(ctx()).find((x) => x.name === 'a')!;
    expect(a).toMatchObject({ latest_version: 2, version_count: 2, summary: 'A three' });
  });

  it('detail returns versions newest-first', () => {
    prompt.create(ctx(), { name: 'a', body: 'v1' });
    prompt.revise(ctx(), { name: 'a', body: 'v2' });
    expect(prompt.detail(ctx(), 'a').versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it('usage returns a paginated (empty) page for an unused prompt', () => {
    prompt.create(ctx(), { name: 'a', body: 'x' });
    const u = prompt.usage(ctx(), 'a', 20, 0);
    expect(u.items).toEqual([]);
    expect(u.page).toMatchObject({ total: 0, limit: 20, offset: 0, has_more: false });
  });
});
