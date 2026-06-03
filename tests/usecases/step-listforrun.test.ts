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

let dir: string;
let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apm-slr-'));
  initProject(dir, clock);
  storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});
const ctx = () => ({ storage, clock });

/** Drive a fresh feature_delivery run up to the design_review gate. Returns runId. */
function driveToReview(): string {
  const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
  const run = workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
  artifact.create(ctx(), { workItem: wi.id, type: 'decision', title: 'D', body: 'x', agent: 'claude' });
  artifact.create(ctx(), { workItem: wi.id, type: 'spec', title: 'S', body: 'x', agent: 'claude' });
  step.complete(ctx(), { run: run.id, step: 'brainstorm', agent: 'claude' });
  artifact.create(ctx(), { workItem: wi.id, type: 'design', title: 'Dz', body: 'x', agent: 'claude' });
  step.complete(ctx(), { run: run.id, step: 'design', agent: 'claude' });
  return run.id;
}

describe('step.listForRun', () => {
  it('returns main-path step_runs plus the review_gate reviewer children', () => {
    const runId = driveToReview();
    const rows = step.listForRun(ctx(), runId);

    const byStep = (id: string) => rows.filter((s) => s.step_id === id);
    // completed main-path steps
    expect(byStep('brainstorm')[0]).toMatchObject({ status: 'completed', parent_step_run_id: null });
    expect(byStep('design')[0]).toMatchObject({ status: 'completed', parent_step_run_id: null });

    // the review_gate main step + its 3 reviewer children
    const gateMain = rows.find((s) => s.step_id === 'design_review' && s.parent_step_run_id === null)!;
    expect(gateMain).toBeTruthy();
    const children = rows.filter((s) => s.parent_step_run_id === gateMain.id);
    expect(children).toHaveLength(3);
    expect(children.map((c) => c.role).sort()).toEqual(['architecture', 'security', 'simplicity']);
    for (const c of children) {
      expect(c.status).toBe('pending');
      expect(c.verdict).toBeNull();
    }
  });

  it('reflects a submitted reviewer verdict', () => {
    const runId = driveToReview();
    step.review(ctx(), { run: runId, step: 'design_review', reviewer: 'architecture', verdict: 'pass', agent: 'claude' });
    const arch = step.listForRun(ctx(), runId).find((s) => s.role === 'architecture')!;
    expect(arch.status).toBe('completed');
    expect(arch.verdict).toBe('pass');
  });

  it('carries failure_reason on a failed step', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'G', agent: 'claude' });
    const run = workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    step.fail(ctx(), { run: run.id, step: 'brainstorm', reason: 'tests failing', agent: 'claude' });
    const bs = step.listForRun(ctx(), run.id).find((s) => s.step_id === 'brainstorm')!;
    expect(bs.status).toBe('failed');
    expect(bs.failure_reason).toBe('tests failing');
  });

  it('throws E_NOT_FOUND for an unknown run', () => {
    expect(() => step.listForRun(ctx(), 'WR-999')).toThrowError(/not found/i);
  });
});
