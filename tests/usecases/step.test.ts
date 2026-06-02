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
import { reopenReviewer } from '../../src/domain/advance.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-step-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

// A tiny workflow (no review_gate) for basic step tests
const TINY_YAML = `
id: tiny
version: 1
name: tiny
applies_to: [feature]
status: active
steps:
  - id: start
    type: agent_prompt
    next: [done]
  - id: done
    type: terminal
`;

// A workflow with a review_gate
const REVIEW_YAML = `
id: review_wf
version: 1
name: review_wf
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

function setupWorkflow(yamlStr: string) {
  workflow.register(ctx(), yamlStr);
  const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
  // Parse name from yaml
  const nameMatch = yamlStr.match(/^name:\s*(\S+)/m);
  const wfName = nameMatch![1];
  const run = workflow.attachRun(ctx(), { workItem: wi.id, workflow: wfName, agent: 'claude' });
  return { wi, run };
}

describe('step.fail', () => {
  it('marks step failed, blocks work item, inserts blocker', () => {
    const { wi, run } = setupWorkflow(TINY_YAML);
    expect(run.current_step).toBe('start');

    const result = step.fail(ctx(), { run: run.id, step: 'start', reason: 'agent crashed', agent: 'claude' });
    expect(result.status).toBe('running');

    const wiView = work.show(ctx(), wi.id);
    expect(wiView.status).toBe('blocked');

    // blocker should exist
    const blockerIds = storage.transaction('deferred', (tx) => {
      return tx.all<{ id: string }>("SELECT id FROM blockers WHERE work_item_id=? AND blocker_type='step_failure' AND status='open'", wi.id);
    });
    expect(blockerIds).toHaveLength(1);
  });

  it('rejects fail on wrong step', () => {
    const { run } = setupWorkflow(TINY_YAML);
    expect(() => step.fail(ctx(), { run: run.id, step: 'done', reason: 'x', agent: 'claude' }))
      .toThrowError(/E_CONFLICT|not the current/i);
  });
});

describe('step.retry', () => {
  it('requires an open step_failure blocker (E_PRECONDITION without prior fail)', () => {
    const { run } = setupWorkflow(TINY_YAML);
    expect(() => step.retry(ctx(), { run: run.id, step: 'start', agent: 'claude' }))
      .toThrowError(/E_PRECONDITION|no open step_failure/i);
  });

  it('resolves blocker, creates fresh pending step, unblocks work item', () => {
    const { wi, run } = setupWorkflow(TINY_YAML);
    step.fail(ctx(), { run: run.id, step: 'start', reason: 'oops', agent: 'claude' });

    const result = step.retry(ctx(), { run: run.id, step: 'start', agent: 'claude' });
    expect(result.current_step).toBe('start');

    const wiView = work.show(ctx(), wi.id);
    expect(wiView.status).toBe('ready');

    // blocker should be resolved
    const openBlockers = storage.transaction('deferred', (tx) =>
      tx.all("SELECT id FROM blockers WHERE work_item_id=? AND status='open'", wi.id));
    expect(openBlockers).toHaveLength(0);
  });
});

describe('step.review — all pass advances', () => {
  it('all reviewers pass → advances to next step', () => {
    const { run } = setupWorkflow(REVIEW_YAML);
    // complete prep step (no required outputs)
    // First need to complete prep — but prep is agent_prompt with no outputs defined
    // so just complete it
    const r1 = step.complete(ctx(), { run: run.id, step: 'prep', agent: 'claude' });
    expect(r1.current_step).toBe('gate');

    // Submit arch pass
    step.review(ctx(), { run: run.id, step: 'gate', reviewer: 'arch', verdict: 'pass', agent: 'claude' });
    const r2 = step.review(ctx(), { run: run.id, step: 'gate', reviewer: 'security', verdict: 'pass', agent: 'claude' });

    // Should advance to terminal → run completed
    expect(r2.status).toBe('completed');
  });

  it('reject verdict blocks work item with review_disagreement', () => {
    const { wi, run } = setupWorkflow(REVIEW_YAML);
    step.complete(ctx(), { run: run.id, step: 'prep', agent: 'claude' });

    step.review(ctx(), { run: run.id, step: 'gate', reviewer: 'arch', verdict: 'reject', agent: 'claude' });

    const wiView = work.show(ctx(), wi.id);
    expect(wiView.status).toBe('blocked');

    const disagreementBlockers = storage.transaction('deferred', (tx) =>
      tx.all("SELECT id FROM blockers WHERE work_item_id=? AND blocker_type='review_disagreement' AND status='open'", wi.id));
    expect(disagreementBlockers).toHaveLength(1);
  });

  it('reject + resolve blocker reopens reviewer child (new round)', () => {
    const { wi, run } = setupWorkflow(REVIEW_YAML);
    step.complete(ctx(), { run: run.id, step: 'prep', agent: 'claude' });

    step.review(ctx(), { run: run.id, step: 'gate', reviewer: 'arch', verdict: 'reject', agent: 'claude' });

    // Find the blocker and resolve it — this should reopen the reviewer
    const disagreementBlocker = storage.transaction('deferred', (tx) =>
      tx.get<{ id: string }>("SELECT id FROM blockers WHERE work_item_id=? AND blocker_type='review_disagreement' AND status='open'", wi.id));
    expect(disagreementBlocker).toBeTruthy();

    // Resolve it (simulating blocker.resolve behavior — we test blocker.ts separately)
    // For now just verify the reviewer child can be reopened via reopenReviewer
    storage.transaction('immediate', (tx) => {
      // Find main step run
      const mainStep = tx.get<{ id: string }>(
        "SELECT id FROM workflow_step_runs WHERE workflow_run_id=? AND step_id='gate' AND parent_step_run_id IS NULL",
        run.id,
      );
      reopenReviewer(tx, mainStep!.id, 'arch');
    });

    // New pending round 2 child should exist
    const round2 = storage.transaction('deferred', (tx) =>
      tx.get<{ review_round: number }>(
        "SELECT review_round FROM workflow_step_runs WHERE workflow_run_id=? AND step_id='gate' AND role='arch' AND status='pending' ORDER BY review_round DESC LIMIT 1",
        run.id,
      ));
    expect(round2?.review_round).toBe(2);
  });

  it('rejects invalid reviewer role (E_VALIDATION)', () => {
    const { run } = setupWorkflow(REVIEW_YAML);
    step.complete(ctx(), { run: run.id, step: 'prep', agent: 'claude' });

    expect(() => step.review(ctx(), { run: run.id, step: 'gate', reviewer: 'bogus_role', verdict: 'pass', agent: 'claude' }))
      .toThrowError(/E_VALIDATION|not valid/i);
  });
});
