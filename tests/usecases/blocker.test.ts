import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as workflow from '../../src/usecases/workflow.js';
import * as step from '../../src/usecases/step.js';
import * as blocker from '../../src/usecases/blocker.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-blk-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

// review_gate workflow
const REVIEW_YAML = `
id: review_blk_wf
version: 1
name: review_blk_wf
applies_to: [feature]
status: active
steps:
  - id: prep
    type: agent_prompt
    next: [gate]
  - id: gate
    type: review_gate
    reviewers: [arch, security]
    pass_policy: all_required
    next: [finish]
  - id: finish
    type: terminal
`;

describe('blocker.create', () => {
  it('creates a generic blocker and blocks work item', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const b = blocker.create(ctx(), { workItem: wi.id, type: 'dependency', reason: 'waiting for X', agent: 'claude' });
    expect(b).toMatchObject({ type: 'dependency', status: 'open', reason: 'waiting for X' });

    const wiView = work.show(ctx(), wi.id);
    expect(wiView.status).toBe('blocked');
  });

  it('rejects human_gate type (use gate.answer)', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    expect(() => blocker.create(ctx(), { workItem: wi.id, type: 'human_gate', reason: 'x', agent: 'claude' }))
      .toThrowError(/E_VALIDATION|human_gate/i);
  });
});

describe('blocker.resolve', () => {
  it('resolves a blocker and unblocks work item when no others remain', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const b = blocker.create(ctx(), { workItem: wi.id, type: 'dependency', reason: 'waiting for X', agent: 'claude' });

    const resolved = blocker.resolve(ctx(), b.id, { resolution: 'X is done', agent: 'claude' });
    expect(resolved.status).toBe('resolved');

    const wiView = work.show(ctx(), wi.id);
    expect(wiView.status).toBe('ready');
  });

  it('does not unblock if other open blockers remain', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const b1 = blocker.create(ctx(), { workItem: wi.id, type: 'dependency', reason: 'A', agent: 'claude' });
    blocker.create(ctx(), { workItem: wi.id, type: 'dependency', reason: 'B', agent: 'claude' });

    blocker.resolve(ctx(), b1.id, { agent: 'claude' });

    // Still blocked (b2 is still open)
    const wiView = work.show(ctx(), wi.id);
    expect(wiView.status).toBe('blocked');
  });

  it('resolve on review_disagreement reopens the reviewer child (new round)', () => {
    workflow.register(ctx(), REVIEW_YAML);
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const run = workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'review_blk_wf', agent: 'claude' });
    step.complete(ctx(), { run: run.id, step: 'prep', agent: 'claude' });

    // arch rejects, security passes → all complete → disagreement blocker created
    step.review(ctx(), { run: run.id, step: 'gate', reviewer: 'arch', verdict: 'reject', agent: 'claude' });
    step.review(ctx(), { run: run.id, step: 'gate', reviewer: 'security', verdict: 'pass', agent: 'claude' });

    const disagreementBlocker = storage.transaction('deferred', (tx) =>
      tx.get<{ id: string }>("SELECT id FROM blockers WHERE work_item_id=? AND blocker_type='review_disagreement' AND status='open'", wi.id));
    expect(disagreementBlocker).toBeTruthy();

    // Resolve the disagreement blocker → should reopen arch reviewer
    blocker.resolve(ctx(), disagreementBlocker!.id, { resolution: 'discussed', agent: 'claude' });

    // arch should have a new pending round-2 child
    const round2 = storage.transaction('deferred', (tx) =>
      tx.get<{ review_round: number }>(
        "SELECT review_round FROM workflow_step_runs WHERE workflow_run_id=? AND step_id='gate' AND role='arch' AND status='pending' ORDER BY review_round DESC LIMIT 1",
        run.id,
      ));
    expect(round2?.review_round).toBe(2);

    // Work item should be unblocked
    expect(work.show(ctx(), wi.id).status).toBe('ready');
  });

  it('rejects resolving an already-resolved blocker', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const b = blocker.create(ctx(), { workItem: wi.id, type: 'dependency', reason: 'x', agent: 'claude' });
    blocker.resolve(ctx(), b.id, { agent: 'claude' });
    expect(() => blocker.resolve(ctx(), b.id, { agent: 'claude' }))
      .toThrowError(/E_PRECONDITION|not open/i);
  });
});

describe('blocker.list', () => {
  it('lists only open blockers for a work item', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const b1 = blocker.create(ctx(), { workItem: wi.id, type: 'dependency', reason: 'A', agent: 'claude' });
    const b2 = blocker.create(ctx(), { workItem: wi.id, type: 'dependency', reason: 'B', agent: 'claude' });
    blocker.resolve(ctx(), b1.id, { agent: 'claude' });

    const open = blocker.list(ctx(), wi.id);
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(b2.id);
  });
});
