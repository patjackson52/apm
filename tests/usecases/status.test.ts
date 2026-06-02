import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as wf from '../../src/usecases/workflow.js';
import * as blocker from '../../src/usecases/blocker.js';
import { repos } from '../../src/storage/repos.js';
import { status } from '../../src/usecases/status.js';

let dir: string;
let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apm-status-'));
  initProject(dir, clock);
  storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const ctx = () => ({ storage, clock });

describe('status usecase', () => {
  it('returns empty status on empty project', () => {
    const s = status(ctx());
    expect(s.work.by_status).toEqual({});
    expect(s.ready_count).toBe(0);
    expect(s.active_leases).toHaveLength(0);
    expect(s.open_blockers).toHaveLength(0);
    expect(s.awaiting_human).toHaveLength(0);
    expect(s.active_runs).toHaveLength(0);
  });

  it('counts work items by status', () => {
    // creates as draft
    work.create(ctx(), { type: 'feature', title: 'F1', agent: 'claude' });
    work.create(ctx(), { type: 'task', title: 'T1', agent: 'claude' });
    // move one to ready
    const wi3 = work.create(ctx(), { type: 'task', title: 'T2', agent: 'claude' });
    work.update(ctx(), wi3.id, { status: 'ready' }, 'claude');

    const s = status(ctx());
    expect(s.work.by_status['draft']).toBe(2);
    expect(s.work.by_status['ready']).toBe(1);
    expect(s.ready_count).toBe(1);
  });

  it('reports active runs', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const run = wf.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });

    const s = status(ctx());
    expect(s.active_runs).toHaveLength(1);
    expect(s.active_runs[0].id).toBe(run.id);
    expect(s.active_runs[0].workflow).toBe('feature_delivery');
  });

  it('reports open blockers and awaiting_human', () => {
    const wi = work.create(ctx(), { type: 'task', title: 'T', agent: 'claude' });
    // technical blocker via usecase
    blocker.create(ctx(), { workItem: wi.id, type: 'technical', reason: 'stuck', agent: 'claude' });
    // human_gate blocker inserted directly (usecase blocks direct creation — they come from workflow advance)
    storage.transaction('immediate', (tx) => {
      repos(tx).blockers.insert({ workItemId: wi.id, type: 'human_gate', reason: 'needs approval', question: 'approve?', optionsJson: '["yes","no"]' });
    });

    const s = status(ctx());
    expect(s.open_blockers).toHaveLength(2);
    expect(s.awaiting_human).toHaveLength(1);
    expect(s.awaiting_human[0].reason).toBe('needs approval');
  });
});
