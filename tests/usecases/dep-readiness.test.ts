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
import { repos } from '../../src/storage/repos.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-03T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-dep-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('dependency readiness', () => {
  it('a cancelled dependency does not appear as an unmet dependency', () => {
    const dep = work.create(ctx(), { type: 'task', title: 'dep', agent: 'x' });
    const d = work.create(ctx(), { type: 'task', title: 'd', agent: 'x' });
    work.link(ctx(), d.id, dep.id, 'x');
    work.cancel(ctx(), dep.id, 'x');
    const res = work.blockers(ctx(), d.id);
    expect(res.unmet_dependencies).toEqual([]); // cancelled satisfies
  });

  it('promotes a draft dependent to dispatchable once its prerequisite completes (no cascade policy)', () => {
    // mini workflow: a single manual step (stays pending so the run is dispatchable).
    wf.register(ctx(), { id: 'mini', version: 1, name: 'mini', applies_to: ['task'], status: 'active',
      steps: [{ id: 'do', type: 'manual', next: ['end'] }, { id: 'end', type: 'terminal' }] } as any);

    const prereq = work.create(ctx(), { type: 'task', title: 'prereq', agent: 'x' });
    const dep = work.create(ctx(), { type: 'task', title: 'dep', agent: 'x' });
    work.link(ctx(), dep.id, prereq.id, 'x'); // dep depends on prereq

    // Attach a running run to the dependent, then force it back to draft to
    // simulate the race the self-heal fixes: a running run on a still-draft item.
    // attachRun normally promotes draft→ready; we undo that via the low-level
    // setStatus repo (work.update would reject the ready→draft transition).
    wf.attachRun(ctx(), { workItem: dep.id, workflow: 'mini', agent: 'x' });
    storage.transaction('immediate', (tx) => repos(tx).workItems.setStatus(dep.id, 'draft', 'x'));
    expect(work.show(ctx(), dep.id).status).toBe('draft');

    // Prereq incomplete → dependent has an unmet dep and must NOT be dispatched.
    expect(work.blockers(ctx(), dep.id).unmet_dependencies).toEqual([prereq.id]);
    const before = next.next(ctx(), { agent: 'x', capabilities: [], match: 'any', acquire: true });
    expect(before.status).not.toBe('dispatched');

    // Complete the prereq directly (no cascade policy enabled).
    work.update(ctx(), prereq.id, { status: 'ready' }, 'x');
    work.update(ctx(), prereq.id, { status: 'completed' }, 'x');

    // Readiness layer: dep now has no unmet dependencies.
    expect(work.blockers(ctx(), dep.id).unmet_dependencies).toEqual([]);

    // Self-heal: next --acquire promotes the still-draft dep to ready and dispatches it.
    const n = next.next(ctx(), { agent: 'x', capabilities: [], match: 'any', acquire: true });
    expect(n.status).toBe('dispatched');
    expect((n as any).data.work_item).toBe(dep.id);
    // Stored status was promoted draft→ready inside the acquire tx (a draft would
    // not be dispatched). The acquire also took a lease, so work.show derives
    // 'active' from the live lease — assert the persisted status directly.
    const stored = storage.transaction('deferred', (tx) =>
      repos(tx).workItems.byId(dep.id).status);
    expect(stored).toBe('ready');
  });
});
