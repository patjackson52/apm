import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as workflow from '../../src/usecases/workflow.js';
import * as gate from '../../src/usecases/gate.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-gate-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

// Workflow with a human_gate step
const GATE_YAML = `
id: gate_wf
version: 1
name: gate_wf
applies_to: [feature]
status: active
steps:
  - id: approve
    type: human_gate
    next: [finish]
  - id: finish
    type: terminal
`;

describe('gate.list', () => {
  it('returns open human_gate blockers', () => {
    workflow.register(ctx(), GATE_YAML);
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'gate_wf', agent: 'claude' });

    const gates = gate.list(ctx(), { workItem: wi.id });
    expect(gates).toHaveLength(1);
    expect(gates[0].type).toBe('human_gate');
  });

  it('returns empty list when no open gates', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    expect(gate.list(ctx(), { workItem: wi.id })).toHaveLength(0);
  });
});

describe('gate.answer', () => {
  it('answering advances the workflow and unblocks the work item', () => {
    workflow.register(ctx(), GATE_YAML);
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'gate_wf', agent: 'claude' });

    const gates = gate.list(ctx(), { workItem: wi.id });
    expect(gates).toHaveLength(1);

    const run = gate.answer(ctx(), gates[0].id, { choice: 'approve', note: 'LGTM', agent: 'claude' });

    // Should advance to terminal → run completed
    expect(run.status).toBe('completed');

    // Work item should be completed (terminal step completes it)
    const wiView = work.show(ctx(), wi.id);
    expect(wiView.status).toBe('completed');
    expect(wiView.status).not.toBe('blocked');
  });

  it('rejects answering a non-human_gate blocker', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    // Create a non-human_gate blocker via storage directly
    const blockerId = storage.transaction('immediate', (tx) => {
      const id = tx.allocateId('BLK');
      tx.run(
        "INSERT INTO blockers (id, work_item_id, blocker_type, reason, status, created_at) VALUES (?, ?, 'step_failure', 'x', 'open', ?)",
        id, wi.id, tx.now(),
      );
      return id;
    });

    expect(() => gate.answer(ctx(), blockerId, { choice: 'ok', agent: 'claude' }))
      .toThrowError(/E_PRECONDITION|not a human_gate/i);
  });

  it('rejects answering a resolved gate', () => {
    workflow.register(ctx(), GATE_YAML);
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'gate_wf', agent: 'claude' });

    const gates = gate.list(ctx(), { workItem: wi.id });
    gate.answer(ctx(), gates[0].id, { choice: 'approve', agent: 'claude' });

    expect(() => gate.answer(ctx(), gates[0].id, { choice: 'approve', agent: 'claude' }))
      .toThrowError(/E_PRECONDITION|not open/i);
  });
});
