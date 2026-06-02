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
import * as artifact from '../../src/usecases/artifact.js';
import * as decision from '../../src/usecases/decision.js';
import * as blocker from '../../src/usecases/blocker.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apm-fd-'));
  initProject(dir, clock);
  storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});
const ctx = () => ({ storage, clock });

/** Assert the run invariant: active run → exactly one pending main step OR terminal. */
function assertInvariant(runView: { status: string; current_step: string | null }): void {
  if (runView.status === 'completed' || runView.status === 'cancelled') return;
  expect(runView.current_step).not.toBeNull();
}

describe('feature_delivery e2e workflow', () => {
  it('drives feature_delivery from attach → complete with all steps', () => {
    // 1. Create work item and attach the feature_delivery workflow
    const wi = work.create(ctx(), { type: 'feature', title: 'Offline mode', agent: 'claude' });
    const run1 = workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    expect(run1.current_step).toBe('brainstorm');
    assertInvariant(run1);

    // work.show should reflect active_run
    expect(work.show(ctx(), wi.id).active_run).toBe(run1.id);

    // work.current returns brainstorm step
    const cur1 = work.current(ctx(), wi.id);
    expect(cur1.run).toBe(run1.id);
    expect(cur1.step?.id).toBe('brainstorm');
    expect(cur1.step?.type).toBe('agent_prompt');

    // 2. brainstorm requires: decision + spec outputs
    artifact.create(ctx(), { workItem: wi.id, type: 'decision', title: 'Decision: approach', body: 'use REST', agent: 'claude' });
    artifact.create(ctx(), { workItem: wi.id, type: 'spec', title: 'Spec: offline mode', body: 'spec body', agent: 'claude' });

    const run2 = step.complete(ctx(), { run: run1.id, step: 'brainstorm', agent: 'claude' });
    expect(run2.current_step).toBe('design');
    assertInvariant(run2);

    // work.current now shows design step with required artifact = spec
    const cur2 = work.current(ctx(), wi.id);
    expect(cur2.step?.id).toBe('design');
    expect(cur2.required_context.some((a) => a.type === 'spec')).toBe(true);

    // 3. design step: create design artifact, then complete
    artifact.create(ctx(), { workItem: wi.id, type: 'design', title: 'Design doc', body: 'design body', agent: 'claude' });
    const run3 = step.complete(ctx(), { run: run1.id, step: 'design', agent: 'claude' });
    expect(run3.current_step).toBe('design_review');
    assertInvariant(run3);

    // 4. design_review: review_gate — 3 reviewers must pass
    const run4a = step.review(ctx(), { run: run1.id, step: 'design_review', reviewer: 'architecture', verdict: 'pass', agent: 'claude' });
    assertInvariant(run4a);
    expect(run4a.current_step).toBe('design_review'); // not yet all passed

    const run4b = step.review(ctx(), { run: run1.id, step: 'design_review', reviewer: 'security', verdict: 'pass', agent: 'claude' });
    assertInvariant(run4b);
    expect(run4b.current_step).toBe('design_review'); // not yet all passed

    const run4c = step.review(ctx(), { run: run1.id, step: 'design_review', reviewer: 'simplicity', verdict: 'pass', agent: 'claude' });
    expect(run4c.current_step).toBe('planning');
    assertInvariant(run4c);

    // 5. planning: create plan artifact
    artifact.create(ctx(), { workItem: wi.id, type: 'plan', title: 'Implementation plan', body: 'plan body', agent: 'claude' });
    const run5 = step.complete(ctx(), { run: run1.id, step: 'planning', agent: 'claude' });
    expect(run5.current_step).toBe('implementation');
    assertInvariant(run5);

    // 6. implementation: create work_log artifact
    artifact.create(ctx(), { workItem: wi.id, type: 'work_log', title: 'Work log', body: 'did the work', agent: 'claude' });
    const run6 = step.complete(ctx(), { run: run1.id, step: 'implementation', agent: 'claude' });
    expect(run6.current_step).toBe('pr_create');
    assertInvariant(run6);

    // 7. pr_create (integration — manual stub): just complete
    const run7 = step.complete(ctx(), { run: run1.id, step: 'pr_create', agent: 'claude' });
    expect(run7.current_step).toBe('pr_monitor');
    assertInvariant(run7);

    // 8. pr_monitor (integration_loop — manual stub): just complete
    const run8 = step.complete(ctx(), { run: run1.id, step: 'pr_monitor', agent: 'claude' });
    expect(run8.current_step).toBe('merge');
    assertInvariant(run8);

    // 9. merge (integration — manual stub): just complete → advances to 'complete' (terminal)
    const run9 = step.complete(ctx(), { run: run1.id, step: 'merge', agent: 'claude' });
    // terminal step: run is now completed
    expect(run9.status).toBe('completed');
    expect(run9.current_step).toBe(null);

    // 10. Assert final state
    const finalWork = work.show(ctx(), wi.id);
    expect(finalWork.status).toBe('completed');
    expect(finalWork.active_run).toBeNull();

    // blocker view should show no blockers
    const bView = work.blockers(ctx(), wi.id);
    expect(bView.open_blockers).toHaveLength(0);
    expect(bView.unmet_dependencies).toHaveLength(0);
  });

  it('review reject blocks, blocker.resolve reopens that reviewer, re-review pass advances', () => {
    // Setup through brainstorm and design
    const wi = work.create(ctx(), { type: 'feature', title: 'Test feature', agent: 'claude' });
    const run = workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });

    // Complete brainstorm
    artifact.create(ctx(), { workItem: wi.id, type: 'decision', title: 'D', body: 'x', agent: 'claude' });
    artifact.create(ctx(), { workItem: wi.id, type: 'spec', title: 'S', body: 'x', agent: 'claude' });
    step.complete(ctx(), { run: run.id, step: 'brainstorm', agent: 'claude' });

    // Complete design
    artifact.create(ctx(), { workItem: wi.id, type: 'design', title: 'Design', body: 'x', agent: 'claude' });
    step.complete(ctx(), { run: run.id, step: 'design', agent: 'claude' });

    // Now at design_review — architecture pass, security reject
    step.review(ctx(), { run: run.id, step: 'design_review', reviewer: 'architecture', verdict: 'pass', agent: 'claude' });
    const afterReject = step.review(ctx(), { run: run.id, step: 'design_review', reviewer: 'security', verdict: 'reject', agent: 'claude' });

    // Work item should be blocked
    const wiBlocked = work.show(ctx(), wi.id);
    expect(wiBlocked.status).toBe('blocked');
    expect(wiBlocked.blocker_ids.length).toBeGreaterThan(0);

    // Run is still on design_review
    expect(afterReject.current_step).toBe('design_review');

    // Resolve the review_disagreement blocker → reopens security reviewer
    const openBlockers = work.blockers(ctx(), wi.id);
    expect(openBlockers.open_blockers.length).toBeGreaterThan(0);
    const reviewBlocker = openBlockers.open_blockers.find((b) => b.type === 'review_disagreement');
    expect(reviewBlocker).toBeTruthy();

    blocker.resolve(ctx(), reviewBlocker!.id, { resolution: 'addressed concerns', agent: 'claude' });

    // Work item should be unblocked
    const wiUnblocked = work.show(ctx(), wi.id);
    expect(wiUnblocked.status).toBe('ready');

    // Now re-review security with pass — still need simplicity
    const afterSecurityPass = step.review(ctx(), { run: run.id, step: 'design_review', reviewer: 'security', verdict: 'pass', agent: 'claude' });
    expect(afterSecurityPass.current_step).toBe('design_review'); // still waiting on simplicity

    // simplicity pass → should advance to planning
    const afterAllPass = step.review(ctx(), { run: run.id, step: 'design_review', reviewer: 'simplicity', verdict: 'pass', agent: 'claude' });
    expect(afterAllPass.current_step).toBe('planning');
  });
});
