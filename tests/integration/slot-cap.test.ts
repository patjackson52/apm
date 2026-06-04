import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as wf from '../../src/usecases/workflow.js';
import * as next from '../../src/usecases/next.js';
import * as policy from '../../src/usecases/policy.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-03T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-slot-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('slot cap', () => {
  it('parallel_work_enabled=false serializes to one concurrent dispatch', () => {
    policy.create(ctx(), { scopeType: 'global', policyJson: JSON.stringify({ parallel_work_enabled: false }) });
    const a = work.create(ctx(), { type: 'feature', title: 'A', agent: 'x' });
    const b = work.create(ctx(), { type: 'feature', title: 'B', agent: 'x' });
    wf.attachRun(ctx(), { workItem: a.id, workflow: 'feature_delivery', agent: 'x' });
    wf.attachRun(ctx(), { workItem: b.id, workflow: 'feature_delivery', agent: 'x' });

    const r1 = next.next(ctx(), { agent: 'agentA', capabilities: [], match: 'any', acquire: true, session: 'SA' });
    const r2 = next.next(ctx(), { agent: 'agentB', capabilities: [], match: 'any', acquire: true, session: 'SB' });
    expect(r1.status).toBe('dispatched');
    expect(r2.status).toBe('idle');
  });

  it('default allows multiple concurrent dispatches (cap 4)', () => {
    const a = work.create(ctx(), { type: 'feature', title: 'A', agent: 'x' });
    const b = work.create(ctx(), { type: 'feature', title: 'B', agent: 'x' });
    wf.attachRun(ctx(), { workItem: a.id, workflow: 'feature_delivery', agent: 'x' });
    wf.attachRun(ctx(), { workItem: b.id, workflow: 'feature_delivery', agent: 'x' });
    const r1 = next.next(ctx(), { agent: 'agentA', capabilities: [], match: 'any', acquire: true, session: 'SA' });
    const r2 = next.next(ctx(), { agent: 'agentB', capabilities: [], match: 'any', acquire: true, session: 'SB' });
    expect(r1.status).toBe('dispatched');
    expect(r2.status).toBe('dispatched');
  });
});
