import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-03T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-dd-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('dedup on create', () => {
  it('refuses a duplicate-titled sibling without force', () => {
    const parent = work.create(ctx(), { type: 'feature', title: 'P', agent: 'x' });
    work.create(ctx(), { type: 'task', title: 'Add OAuth', parent: parent.id, agent: 'x' });
    expect(() => work.create(ctx(), { type: 'task', title: 'add  oauth', parent: parent.id, agent: 'x' }))
      .toThrowError(/E_DUPLICATE|duplicate/i);
  });
  it('allows duplicate with force', () => {
    const parent = work.create(ctx(), { type: 'feature', title: 'P', agent: 'x' });
    work.create(ctx(), { type: 'task', title: 'Add OAuth', parent: parent.id, agent: 'x' });
    const dup = work.create(ctx(), { type: 'task', title: 'Add OAuth', parent: parent.id, agent: 'x', force: true });
    expect(dup.id).toBeTruthy();
  });
  it('allows same title under different parents', () => {
    const p1 = work.create(ctx(), { type: 'feature', title: 'P1', agent: 'x' });
    const p2 = work.create(ctx(), { type: 'feature', title: 'P2', agent: 'x' });
    work.create(ctx(), { type: 'task', title: 'Add OAuth', parent: p1.id, agent: 'x' });
    const ok = work.create(ctx(), { type: 'task', title: 'Add OAuth', parent: p2.id, agent: 'x' });
    expect(ok.id).toBeTruthy();
  });
});
