import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as wf from '../../src/usecases/workflow.js';
import * as next from '../../src/usecases/next.js';

let dir: string; let storage: SqliteStorage; const clock = fixedClock('2026-06-03T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-act-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('workflow.activate (rec #6)', () => {
  it('activates a draft work item: attaches default workflow + promotes to ready + becomes dispatchable', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'A', agent: 'claude' });
    const res = wf.activate(ctx(), { ids: [wi.id], agent: 'claude' });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ id: wi.id, status: 'activated' });
    expect(res.items[0].run).toMatch(/^WR-/);
    // dispatchable now
    const n = next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any' });
    expect(n.status).toBe('dispatched');
    expect(n.data.work_item).toBe(wi.id);
  });

  it('is idempotent: an already-active item reports already_active with no duplicate run', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'A', agent: 'claude' });
    wf.activate(ctx(), { ids: [wi.id], agent: 'claude' });
    const again = wf.activate(ctx(), { ids: [wi.id], agent: 'claude' });
    expect(again.items[0].status).toBe('already_active');
    const runs = wf.runsForWorkItem(ctx(), wi.id);
    expect(runs).toHaveLength(1);
  });

  it('activates multiple ids in one call', () => {
    const a = work.create(ctx(), { type: 'feature', title: 'A', agent: 'claude' });
    const b = work.create(ctx(), { type: 'feature', title: 'B', agent: 'claude' });
    const res = wf.activate(ctx(), { ids: [a.id, b.id], agent: 'claude' });
    expect(res.items.map((i) => i.status)).toEqual(['activated', 'activated']);
  });

  it('skips unknown ids and terminal items with a reason', () => {
    const done = work.create(ctx(), { type: 'feature', title: 'D', agent: 'claude' });
    work.update(ctx(), done.id, { status: 'cancelled' }, 'claude');
    const res = wf.activate(ctx(), { ids: ['WI-9999', done.id], agent: 'claude' });
    expect(res.items[0]).toMatchObject({ id: 'WI-9999', status: 'skipped', reason: 'not_found' });
    expect(res.items[1]).toMatchObject({ id: done.id, status: 'skipped', reason: 'terminal' });
  });

  it('honors a custom --workflow', () => {
    wf.register(ctx(), { id: 'mini', version: 1, name: 'mini', applies_to: ['task'], status: 'active',
      steps: [{ id: 'do', type: 'manual', next: ['end'] }, { id: 'end', type: 'terminal' }] } as any);
    const t = work.create(ctx(), { type: 'task', title: 'T', agent: 'claude' });
    const res = wf.activate(ctx(), { ids: [t.id], workflow: 'mini', agent: 'claude' });
    expect(res.items[0].status).toBe('activated');
    expect(wf.runsForWorkItem(ctx(), t.id)[0].workflow).toBe('mini');
  });
});
