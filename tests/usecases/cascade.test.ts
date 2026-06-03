import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as wf from '../../src/usecases/workflow.js';
import * as step from '../../src/usecases/step.js';
import * as policy from '../../src/usecases/policy.js';
import * as next from '../../src/usecases/next.js';
import { repos } from '../../src/storage/repos.js';

let dir: string; let storage: SqliteStorage; const clock = fixedClock('2026-06-03T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-casc-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

// complete a work item directly through its lifecycle (draft->ready->completed)
function completeItem(id: string) {
  work.update(ctx(), id, { status: 'ready' }, 'claude');
  work.update(ctx(), id, { status: 'completed' }, 'claude');
}
function enableCascade(scopeId: string) {
  policy.create(ctx(), { scopeType: 'work_item', scopeId, policyJson: JSON.stringify({ auto_activate_dependents: true }) } as any);
}

describe('auto-activate-dependents cascade (rec #4, flag-gated)', () => {
  it('links.dependents is the reverse of dependsOn', () => {
    const p = work.create(ctx(), { type: 'feature', title: 'P', agent: 'claude' });
    const d = work.create(ctx(), { type: 'feature', title: 'D', agent: 'claude' });
    work.link(ctx(), d.id, p.id, 'claude'); // d depends on p
    const got = storage.transaction('deferred', (tx) => repos(tx).links.dependents(p.id));
    expect(got).toEqual([d.id]);
  });

  it('OFF by default: completing a prerequisite does NOT activate its dependent', () => {
    const p = work.create(ctx(), { type: 'feature', title: 'P', agent: 'claude' });
    const d = work.create(ctx(), { type: 'feature', title: 'D', agent: 'claude' });
    work.link(ctx(), d.id, p.id, 'claude');
    completeItem(p.id);
    const res = wf.cascadeActivateDependents(ctx(), p.id, 'claude');
    expect(res.activated).toEqual([]);
    expect(work.show(ctx(), d.id).status).toBe('draft');
  });

  it('ON (policy flag): completing the prerequisite auto-activates the draft dependent → dispatchable', () => {
    const p = work.create(ctx(), { type: 'feature', title: 'P', agent: 'claude' });
    const d = work.create(ctx(), { type: 'feature', title: 'D', agent: 'claude' });
    work.link(ctx(), d.id, p.id, 'claude');
    enableCascade(p.id);
    completeItem(p.id);
    const res = wf.cascadeActivateDependents(ctx(), p.id, 'claude');
    expect(res.activated).toEqual([d.id]);
    expect(work.show(ctx(), d.id).status).toBe('ready');
    // d now has a running run and is dispatchable
    const n = next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any' });
    expect(n.status).toBe('dispatched');
    expect(n.data.work_item).toBe(d.id);
  });

  it('only activates when ALL deps complete', () => {
    const p1 = work.create(ctx(), { type: 'feature', title: 'P1', agent: 'claude' });
    const p2 = work.create(ctx(), { type: 'feature', title: 'P2', agent: 'claude' });
    const d = work.create(ctx(), { type: 'feature', title: 'D', agent: 'claude' });
    work.link(ctx(), d.id, p1.id, 'claude');
    work.link(ctx(), d.id, p2.id, 'claude');
    enableCascade(p1.id); enableCascade(p2.id);
    completeItem(p1.id);
    expect(wf.cascadeActivateDependents(ctx(), p1.id, 'claude').activated).toEqual([]); // p2 still open
    expect(work.show(ctx(), d.id).status).toBe('draft');
    completeItem(p2.id);
    expect(wf.cascadeActivateDependents(ctx(), p2.id, 'claude').activated).toEqual([d.id]);
  });

  it('does not touch non-draft dependents', () => {
    const p = work.create(ctx(), { type: 'feature', title: 'P', agent: 'claude' });
    const d = work.create(ctx(), { type: 'feature', title: 'D', agent: 'claude' });
    work.link(ctx(), d.id, p.id, 'claude');
    enableCascade(p.id);
    work.update(ctx(), d.id, { status: 'cancelled' }, 'claude');
    completeItem(p.id);
    expect(wf.cascadeActivateDependents(ctx(), p.id, 'claude').activated).toEqual([]);
  });

  it('fires from the workflow-driven completion path (step.complete → terminal)', () => {
    // P runs a minimal manual→terminal workflow; D depends on P and auto-activates when P completes.
    wf.register(ctx(), { id: 'mini', version: 1, name: 'mini', applies_to: ['feature'], status: 'active',
      steps: [{ id: 'do', type: 'manual', next: ['end'] }, { id: 'end', type: 'terminal' }] } as any);
    const p = work.create(ctx(), { type: 'feature', title: 'P', agent: 'claude' });
    const d = work.create(ctx(), { type: 'feature', title: 'D', agent: 'claude' });
    work.link(ctx(), d.id, p.id, 'claude');
    enableCascade(p.id);
    const run = wf.attachRun(ctx(), { workItem: p.id, workflow: 'mini', agent: 'claude' });
    step.complete(ctx(), { run: run.id, step: 'do', agent: 'claude' }); // → terminal → P completed → cascade
    expect(work.show(ctx(), p.id).status).toBe('completed');
    expect(work.show(ctx(), d.id).status).toBe('ready');
  });
});
