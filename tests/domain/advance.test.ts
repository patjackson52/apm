import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import { attachRun } from '../../src/usecases/workflow.js';
import * as step from '../../src/usecases/step.js';
import * as artifact from '../../src/usecases/artifact.js';
import * as work from '../../src/usecases/work.js';

let dir: string;
let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apm-adv-'));
  initProject(dir, clock);
  storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});
const ctx = () => ({ storage, clock });

describe('advance engine', () => {
  it('attaching feature_delivery creates a run with brainstorm pending', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const run = attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    expect(run.current_step).toBe('brainstorm');
    expect(work.show(ctx(), wi.id).active_run).toBe(run.id);
  });

  it('completing brainstorm (with required outputs) advances to design', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const run = attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    // brainstorm outputs decision + spec
    artifact.create(ctx(), { workItem: wi.id, type: 'decision', title: 'D', body: 'x', agent: 'claude' });
    artifact.create(ctx(), { workItem: wi.id, type: 'spec', title: 'S', body: 'x', agent: 'claude' });
    const r = step.complete(ctx(), { run: run.id, step: 'brainstorm', agent: 'claude' });
    expect(r.current_step).toBe('design');
  });

  it('blocks completing brainstorm when a required output is missing', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const run = attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    artifact.create(ctx(), { workItem: wi.id, type: 'decision', title: 'D', body: 'x', agent: 'claude' });
    // missing spec
    expect(() => step.complete(ctx(), { run: run.id, step: 'brainstorm', agent: 'claude' })).toThrowError(/spec|required/i);
  });
});
