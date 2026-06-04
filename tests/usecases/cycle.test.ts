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
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-cyc-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('transitive cycle detection', () => {
  it('rejects A->B->C->A', () => {
    const A = work.create(ctx(), { type: 'task', title: 'A', agent: 'x' });
    const B = work.create(ctx(), { type: 'task', title: 'B', agent: 'x' });
    const C = work.create(ctx(), { type: 'task', title: 'C', agent: 'x' });
    work.link(ctx(), A.id, B.id, 'x'); // A depends on B
    work.link(ctx(), B.id, C.id, 'x'); // B depends on C
    expect(() => work.link(ctx(), C.id, A.id, 'x')).toThrowError(/cycl/i); // C depends on A → cycle
  });

  it('still allows a valid linear chain and a diamond', () => {
    const A = work.create(ctx(), { type: 'task', title: 'A', agent: 'x' });
    const B = work.create(ctx(), { type: 'task', title: 'B', agent: 'x' });
    const C = work.create(ctx(), { type: 'task', title: 'C', agent: 'x' });
    const D = work.create(ctx(), { type: 'task', title: 'D', agent: 'x' });
    work.link(ctx(), D.id, B.id, 'x'); // D depends on B
    work.link(ctx(), D.id, C.id, 'x'); // D depends on C
    work.link(ctx(), B.id, A.id, 'x'); // B depends on A
    expect(() => work.link(ctx(), C.id, A.id, 'x')).not.toThrow(); // C depends on A — diamond, no cycle
  });
});
