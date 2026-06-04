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

let dir: string;
let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apm-dg-'));
  initProject(dir, clock);
  storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});
const ctx = () => ({ storage, clock });

// Smallest workflow that reaches terminal: a single agent_prompt step → terminal.
// (Mirrors the `prep`→`done` shape from step-types.test.ts, minus the review gate.)
const TINY_YAML = `
id: tiny_wf
version: 1
name: tiny_wf
applies_to: [feature]
status: active
steps:
  - id: prep
    type: agent_prompt
    next: [done]
  - id: done
    type: terminal
`;

describe('terminal completion re-validates dependencies', () => {
  it('REFUSES terminal completion when a depends_on target is incomplete', () => {
    workflow.register(ctx(), TINY_YAML);

    // D depends on P; P left incomplete (draft).
    const P = work.create(ctx(), { type: 'feature', title: 'prereq', agent: 'claude' });
    const D = work.create(ctx(), { type: 'feature', title: 'dependent', agent: 'claude' });
    work.link(ctx(), D.id, P.id, 'claude');

    const run = workflow.attachRun(ctx(), { workItem: D.id, workflow: 'tiny_wf', agent: 'claude' });

    // Completing `prep` advances to `done` (terminal) → would complete D, but P is unmet.
    expect(() =>
      step.complete(ctx(), { run: run.id, step: 'prep', agent: 'claude' }),
    ).toThrow(/dependenc/i);

    // D must NOT be completed.
    expect(work.show(ctx(), D.id).status).not.toBe('completed');
  });

  it('positive control: once the dependency is satisfied, terminal completion SUCCEEDS', () => {
    workflow.register(ctx(), TINY_YAML);

    const P = work.create(ctx(), { type: 'feature', title: 'prereq', agent: 'claude' });
    const D = work.create(ctx(), { type: 'feature', title: 'dependent', agent: 'claude' });
    work.link(ctx(), D.id, P.id, 'claude');

    // Satisfy the dependency (cancelled counts as satisfied).
    work.cancel(ctx(), P.id, 'claude');

    const run = workflow.attachRun(ctx(), { workItem: D.id, workflow: 'tiny_wf', agent: 'claude' });

    expect(() =>
      step.complete(ctx(), { run: run.id, step: 'prep', agent: 'claude' }),
    ).not.toThrow();

    expect(work.show(ctx(), D.id).status).toBe('completed');
  });
});
