import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as workflow from '../../src/usecases/workflow.js';
import * as work from '../../src/usecases/work.js';

let dir: string;
let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apm-wf-'));
  initProject(dir, clock);
  storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});
const ctx = () => ({ storage, clock });

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

describe('workflow usecases', () => {
  it('list returns seeded feature_delivery', () => {
    const defs = workflow.list(ctx());
    expect(defs.some((d: any) => d.name === 'feature_delivery')).toBe(true);
  });

  it('show finds by name', () => {
    const d = workflow.show(ctx(), 'feature_delivery');
    expect(d.name).toBe('feature_delivery');
    expect(d.status).toBe('active');
  });

  it('register inserts a new workflow', () => {
    const d = workflow.register(ctx(), TINY_YAML);
    expect(d.name).toBe('tiny');
    expect(d.version).toBe(1);
  });

  it('register rejects duplicate name+version with E_CONFLICT', () => {
    workflow.register(ctx(), TINY_YAML);
    expect(() => workflow.register(ctx(), TINY_YAML)).toThrowError(/E_CONFLICT|already/i);
  });

  it('attachRun creates a run with first step pending', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const run = workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    expect(run.id).toMatch(/^WR-/);
    expect(run.current_step).toBe('brainstorm');
    expect(run.status).toBe('running');
    expect(run.work_item).toBe(wi.id);
    expect(run.workflow).toBe('feature_delivery');
  });

  it('attaching a second run to the same work item → E_PRECONDITION', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    expect(() =>
      workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' }),
    ).toThrowError(/E_PRECONDITION|already/i);
  });

  it('runsForWorkItem lists runs', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    const runs = workflow.runsForWorkItem(ctx(), wi.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].work_item).toBe(wi.id);
  });

  it('cancelRun sets status to cancelled', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const run = workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    const cancelled = workflow.cancelRun(ctx(), run.id);
    expect(cancelled.status).toBe('cancelled');
  });
});
