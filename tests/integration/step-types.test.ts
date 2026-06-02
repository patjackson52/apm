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
import * as decision from '../../src/usecases/decision.js';
import * as gate from '../../src/usecases/gate.js';
import * as blocker from '../../src/usecases/blocker.js';

let dir: string;
let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apm-st-'));
  initProject(dir, clock);
  storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});
const ctx = () => ({ storage, clock });

// ── I1: abstain causes review_disagreement (non-pass stuck-state fix) ─────────

const ABSTAIN_YAML = `
id: abstain_wf
version: 1
name: abstain_wf
applies_to: [feature]
status: active
steps:
  - id: prep
    type: agent_prompt
    next: [gate]
  - id: gate
    type: review_gate
    reviewers: [arch, sec]
    pass_policy: all_required
    next: [done]
  - id: done
    type: terminal
`;

describe('I1 — abstain in review_gate creates review_disagreement blocker', () => {
  it('abstain + pass → blocker created; resolve reopens abstainer; re-review pass → advances', () => {
    workflow.register(ctx(), ABSTAIN_YAML);
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const run = workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'abstain_wf', agent: 'claude' });

    step.complete(ctx(), { run: run.id, step: 'prep', agent: 'claude' });

    // arch abstains, sec passes → all roles complete, but not all pass → blocker
    step.review(ctx(), { run: run.id, step: 'gate', reviewer: 'arch', verdict: 'abstain', agent: 'claude' });
    const afterSec = step.review(ctx(), { run: run.id, step: 'gate', reviewer: 'sec', verdict: 'pass', agent: 'claude' });

    // run still on gate (not advanced)
    expect(afterSec.current_step).toBe('gate');

    // work item is blocked
    const wiBlocked = work.show(ctx(), wi.id);
    expect(wiBlocked.status).toBe('blocked');

    // a review_disagreement blocker exists
    const blkRow = storage.transaction('deferred', (tx) =>
      tx.get<{ id: string; reason: string }>(
        "SELECT id, reason FROM blockers WHERE work_item_id=? AND blocker_type='review_disagreement' AND status='open'",
        wi.id,
      ));
    expect(blkRow).toBeTruthy();
    expect(blkRow!.reason).toMatch(/arch/); // non-passing role listed

    // Resolve the blocker → reopens arch for re-review
    blocker.resolve(ctx(), blkRow!.id, { resolution: 'arch reconsidered', agent: 'claude' });

    // work item unblocked
    expect(work.show(ctx(), wi.id).status).toBe('ready');

    // arch has a new pending round-2 child
    const round2 = storage.transaction('deferred', (tx) =>
      tx.get<{ review_round: number }>(
        "SELECT review_round FROM workflow_step_runs WHERE workflow_run_id=? AND step_id='gate' AND role='arch' AND status='pending' ORDER BY review_round DESC LIMIT 1",
        run.id,
      ));
    expect(round2?.review_round).toBe(2);

    // arch re-reviews with pass → all pass → advance to terminal
    const afterReview = step.review(ctx(), { run: run.id, step: 'gate', reviewer: 'arch', verdict: 'pass', agent: 'claude' });
    expect(afterReview.status).toBe('completed');
  });
});

// ── I2: decision and decompose step types ──────────────────────────────────────

const DECISION_WORKFLOW_OBJ = {
  id: 'decision_wf',
  version: 1,
  name: 'decision_wf',
  applies_to: ['feature'],
  status: 'active',
  steps: [
    { id: 'decide', type: 'decision', next: ['split'] },
    { id: 'split', type: 'decompose', may_create_work_items: true, next: ['done'] },
    { id: 'done', type: 'terminal' },
  ],
};

describe('I2-A — decision step auto-accept (confidence >= threshold)', () => {
  it('creates decision with confidence 95, completes decide → auto-accepts → advances to split; complete split → done', () => {
    // Default policy: auto_accept_recommendations.confidence_threshold = 90
    // confidence 95 >= 90 → auto-accept
    workflow.register(ctx(), DECISION_WORKFLOW_OBJ);
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const run = workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'decision_wf', agent: 'claude' });
    expect(run.current_step).toBe('decide');

    // Create a decision with recommendation + high confidence
    decision.create(ctx(), {
      workItem: wi.id,
      question: 'Use postgres or sqlite?',
      options: ['postgres', 'sqlite'],
      recommendation: 'postgres',
      confidence: 95,
      agent: 'claude',
    });

    // Complete the decide step → auto-accept triggered → advances to split
    const afterDecide = step.complete(ctx(), { run: run.id, step: 'decide', agent: 'claude' });
    expect(afterDecide.current_step).toBe('split');
    expect(afterDecide.status).toBe('running');

    // Verify decision was auto-accepted (decided)
    const decisions = storage.transaction('deferred', (tx) =>
      tx.all<any>('SELECT * FROM decisions WHERE work_item_id=?', wi.id));
    expect(decisions).toHaveLength(1);
    expect(decisions[0].status).toBe('decided');
    expect(decisions[0].decision).toBe('postgres');

    // Create a child work item under parent (decompose permission)
    work.create(ctx(), { type: 'task', title: 'Subtask A', agent: 'claude', parentId: wi.id });

    // Complete split → advances to done (terminal) → run completed
    const afterSplit = step.complete(ctx(), { run: run.id, step: 'split', agent: 'claude' });
    expect(afterSplit.status).toBe('completed');

    // Work item completed
    expect(work.show(ctx(), wi.id).status).toBe('completed');
  });
});

describe('I2-B — decision step below threshold creates human_gate blocker', () => {
  it('decision confidence 50 → completing decide creates human_gate blocker; gate.answer records choice → advances to split', () => {
    // Default policy: auto_accept_recommendations.confidence_threshold = 90
    // confidence 50 < 90 → human_gate blocker
    workflow.register(ctx(), DECISION_WORKFLOW_OBJ);
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const run = workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'decision_wf', agent: 'claude' });
    expect(run.current_step).toBe('decide');

    decision.create(ctx(), {
      workItem: wi.id,
      question: 'Use postgres or sqlite?',
      options: ['postgres', 'sqlite'],
      recommendation: 'postgres',
      confidence: 50,
      agent: 'claude',
    });

    // Complete the decide step → below threshold → human_gate blocker, not advanced
    const afterDecide = step.complete(ctx(), { run: run.id, step: 'decide', agent: 'claude' });
    expect(afterDecide.current_step).toBe('decide'); // still on decide (blocked)
    expect(afterDecide.status).toBe('running');      // run still running

    // Work item is blocked
    expect(work.show(ctx(), wi.id).status).toBe('blocked');

    // A human_gate blocker exists
    const blkRow = storage.transaction('deferred', (tx) =>
      tx.get<{ id: string; question: string }>(
        "SELECT id, question FROM blockers WHERE work_item_id=? AND blocker_type='human_gate' AND status='open'",
        wi.id,
      ));
    expect(blkRow).toBeTruthy();
    expect(blkRow!.question).toBe('Use postgres or sqlite?');

    // Answer the gate with chosen option → records decision + advances to split
    const afterAnswer = gate.answer(ctx(), blkRow!.id, { choice: 'sqlite', agent: 'human:alice' });
    expect(afterAnswer.current_step).toBe('split');
    expect(afterAnswer.status).toBe('running');

    // Decision is now decided with the chosen option
    const decs = storage.transaction('deferred', (tx) =>
      tx.all<any>('SELECT * FROM decisions WHERE work_item_id=?', wi.id));
    expect(decs[0].status).toBe('decided');
    expect(decs[0].decision).toBe('sqlite');

    // Work item unblocked (ready)
    expect(work.show(ctx(), wi.id).status).toBe('ready');

    // Complete split → terminal
    const afterSplit = step.complete(ctx(), { run: run.id, step: 'split', agent: 'claude' });
    expect(afterSplit.status).toBe('completed');
  });
});
