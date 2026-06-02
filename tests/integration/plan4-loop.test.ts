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
import * as artifact from '../../src/usecases/artifact.js';
import * as lease from '../../src/usecases/lease.js';
import * as next from '../../src/usecases/next.js';

// Outputs required per step id in feature_delivery
const STEP_OUTPUTS: Record<string, string[]> = {
  brainstorm: ['decision', 'spec'],
  design: ['design'],
  planning: ['plan'],
  implementation: ['work_log'],
};

// Steps that are review_gate and their reviewers
const REVIEW_GATE_REVIEWERS: Record<string, string[]> = {
  design_review: ['architecture', 'security', 'simplicity'],
};

// Integration/integration_loop steps — just complete
const INTEGRATION_STEPS = new Set(['pr_create', 'pr_monitor', 'merge']);

let dir: string;
let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apm-loop-'));
  initProject(dir, clock);
  storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
});

afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const ctx = () => ({ storage, clock });

describe('plan4 loop integration', () => {
  it('TEST A — autonomous loop drives feature_delivery to completion via next', () => {
    // Setup
    const wi = work.create(ctx(), { type: 'feature', title: 'Loop feature', agent: 'claude' });
    const run = wf.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });

    let guard = 0;

    for (;;) {
      if (++guard > 50) throw new Error('loop did not drain within 50 iterations');

      const r = next.next(ctx(), {
        agent: 'claude',
        capabilities: [],
        match: 'any',
        acquire: true,
        session: 'S-1',
      });

      if (r.status === 'drained') break;

      if (r.status === 'idle') {
        throw new Error(`unexpected idle in single-agent loop: reason=${r.reason}`);
      }

      // dispatched
      const stepData = r.data.step as { id: string; type: string };
      const stepId = stepData.id;
      const stepType = stepData.type;
      const leaseObj = r.data.lease as { id: string } | null;

      if (stepType === 'review_gate') {
        // Submit pass verdicts for all reviewers
        const reviewers = REVIEW_GATE_REVIEWERS[stepId];
        if (!reviewers) throw new Error(`Unknown review_gate step: ${stepId}`);
        for (const reviewer of reviewers) {
          step.review(ctx(), {
            run: run.id,
            step: stepId,
            reviewer,
            verdict: 'pass',
            agent: 'claude',
          });
        }
      } else if (INTEGRATION_STEPS.has(stepId)) {
        step.complete(ctx(), { run: run.id, step: stepId, agent: 'claude' });
      } else {
        // agent_prompt or agent_execution — create required output artifacts first
        const outputs = STEP_OUTPUTS[stepId] ?? [];
        for (const artType of outputs) {
          artifact.create(ctx(), {
            workItem: wi.id,
            type: artType as any,
            title: `${artType} for ${stepId}`,
            body: `body of ${artType}`,
            agent: 'claude',
          });
        }
        step.complete(ctx(), { run: run.id, step: stepId, agent: 'claude' });
      }

      // Release the lease so next iteration can acquire cleanly
      if (leaseObj) {
        lease.release(ctx(), leaseObj.id);
      }
    }

    // Assert work item and run are completed
    const finalWork = work.show(ctx(), wi.id);
    expect(finalWork.status).toBe('completed');

    const runs = wf.runsForWorkItem(ctx(), wi.id);
    expect(runs[0].status).toBe('completed');
  });

  it('TEST B — concurrency: lease exclusivity prevents double-dispatch', () => {
    // Setup
    const dbPath = join(dir, '.apm', 'apm.db');
    const storageA = new SqliteStorage(dbPath, clock);
    const storageB = new SqliteStorage(dbPath, clock);
    const ctxA = () => ({ storage: storageA, clock });
    const ctxB = () => ({ storage: storageB, clock });

    try {
      const wi = work.create(ctxA(), { type: 'feature', title: 'Concurrent feature', agent: 'agentA' });
      wf.attachRun(ctxA(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'agentA' });

      // agentA acquires
      const r1 = next.next(ctxA(), {
        agent: 'agentA',
        capabilities: [],
        match: 'any',
        acquire: true,
        session: 'SA',
      });
      expect(r1.status).toBe('dispatched');
      expect(r1.data.lease).toBeTruthy();

      // agentB tries to acquire the same item — should be idle/all_leased
      const r2 = next.next(ctxB(), {
        agent: 'agentB',
        capabilities: [],
        match: 'any',
        acquire: true,
        session: 'SB',
      });
      expect(r2.status).toBe('idle');
      if (r2.status === 'idle') {
        expect(r2.reason).toBe('all_leased');
      }

      // Exactly one active lease on the item
      const activeLeaseCount = storageA.transaction('deferred', (tx) => {
        const row = tx.get<{ c: number }>(
          "SELECT count(*) c FROM leases WHERE work_item_id=? AND status='active'",
          wi.id,
        );
        return row?.c ?? 0;
      });
      expect(activeLeaseCount).toBe(1);
    } finally {
      storageA.close();
      storageB.close();
    }
  });
});
