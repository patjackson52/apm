import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as wf from '../../src/usecases/workflow.js';
import * as artifact from '../../src/usecases/artifact.js';
import * as next from '../../src/usecases/next.js';

let dir: string; let storage: SqliteStorage; const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-next-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('next usecase', () => {
  it('drained when no runs exist', () => {
    const r = next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any' });
    expect(r.status).toBe('drained');
    expect(next.nextExitCode(r)).toBe(3);
  });

  it('dispatches the pending step with a resolved contract', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const run = wf.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    const r = next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any' });
    expect(r.status).toBe('dispatched');
    expect(r.data.work_item).toBe(wi.id);
    expect(r.data.step.id).toBe('brainstorm');
    expect(r.data.when_done.at(-1)).toContain(`apm step complete ${run.id} brainstorm`);
    expect(r.data.when_done.some((c: string) => c.includes('apm artifact create') && c.includes('--type spec'))).toBe(true);
    expect(r.data.prompt_name).toBe('brainstorm_feature_v1');
    expect(r.data.prompt_body).toBeTruthy(); // stored body resolved + inlined
    expect(next.nextExitCode(r)).toBe(0);
  });

  it('--acquire takes a lease and a second acquire conflicts', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    wf.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    const r1 = next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any', acquire: true, session: 'S-x' });
    expect(r1.status).toBe('dispatched'); expect(r1.data.lease).toBeTruthy();
    // a different agent acquiring the same item now conflicts (item is live-leased) -> idle all_leased
    const r2 = next.next(ctx(), { agent: 'other', capabilities: [], match: 'any', acquire: true });
    expect(r2.status).toBe('idle');
  });

  it('drain reason=complete + zero counts when no work items exist at all', () => {
    const r = next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any' });
    expect(r.status).toBe('drained');
    expect((r as any).reason).toBe('complete');
    expect((r as any).counts).toMatchObject({ draft: 0, ready: 0, running_runs: 0 });
    expect((r as any).data.reason).toBe('complete');
  });

  it('drain reason=backlog + counts when draft work exists but nothing is activated', () => {
    work.create(ctx(), { type: 'feature', title: 'A', agent: 'claude' });
    work.create(ctx(), { type: 'feature', title: 'B', agent: 'claude' });
    const r = next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any' });
    expect(r.status).toBe('drained');
    expect((r as any).reason).toBe('backlog');
    expect((r as any).counts.draft).toBe(2);
    expect((r as any).counts.running_runs).toBe(0);
  });

  it('--acquire drain appends a next.drained event with reason+counts; peek does not', () => {
    work.create(ctx(), { type: 'feature', title: 'A', agent: 'claude' });
    // peek (no acquire) — must NOT write an event (deferred/read tx)
    next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any' });
    const afterPeek = storage.transaction('deferred', (tx) =>
      tx.all<any>("SELECT * FROM events WHERE event_type='next.drained'"));
    expect(afterPeek.length).toBe(0);
    // acquire drain — appends one event scoped to the agent
    next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any', acquire: true });
    const evs = storage.transaction('deferred', (tx) =>
      tx.all<any>("SELECT * FROM events WHERE event_type='next.drained'"));
    expect(evs.length).toBe(1);
    expect(evs[0].entity_id).toBe('claude');
    const payload = JSON.parse(evs[0].payload_json);
    expect(payload.reason).toBe('backlog');
    expect(payload.counts.draft).toBe(1);
  });

  it('idle awaiting_human when the only run is human-gate blocked', () => {
    // build a tiny workflow with a human_gate first step
    wf.register(ctx(), { id: 'hg', version: 1, name: 'hg', applies_to: ['task'], status: 'active',
      steps: [{ id: 'gate', type: 'human_gate', next: ['done'] }, { id: 'done', type: 'terminal' }] } as any);
    const wi = work.create(ctx(), { type: 'task', title: 'G', agent: 'claude' });
    wf.attachRun(ctx(), { workItem: wi.id, workflow: 'hg', agent: 'claude' });
    const r = next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any' });
    expect(r.status).toBe('idle');
    expect(r.reason).toBe('awaiting_human');
    expect(next.nextExitCode(r)).toBe(20);
  });
});
