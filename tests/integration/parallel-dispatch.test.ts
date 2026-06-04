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

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-03T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-pd-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('claim-walk dispatch', () => {
  it('two agents on two ready items each get a different item (no idle)', () => {
    const a = work.create(ctx(), { type: 'feature', title: 'A', agent: 'agentA' });
    const b = work.create(ctx(), { type: 'feature', title: 'B', agent: 'agentA' });
    wf.attachRun(ctx(), { workItem: a.id, workflow: 'feature_delivery', agent: 'agentA' });
    wf.attachRun(ctx(), { workItem: b.id, workflow: 'feature_delivery', agent: 'agentA' });

    const r1 = next.next(ctx(), { agent: 'agentA', capabilities: [], match: 'any', acquire: true, session: 'SA' });
    const r2 = next.next(ctx(), { agent: 'agentB', capabilities: [], match: 'any', acquire: true, session: 'SB' });

    expect(r1.status).toBe('dispatched');
    expect(r2.status).toBe('dispatched');
    if (r1.status === 'dispatched' && r2.status === 'dispatched') {
      expect(r1.data.work_item).not.toBe(r2.data.work_item);
    }
  });
});
