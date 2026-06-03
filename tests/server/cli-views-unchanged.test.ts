import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as workflow from '../../src/usecases/workflow.js';
import * as lease from '../../src/usecases/lease.js';
import * as blocker from '../../src/usecases/blocker.js';

const clock = fixedClock('2026-06-03T12:00:00.000Z');
let dir: string; let s: SqliteStorage;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apm-cliview-'));
  initProject(dir, clock);
  s = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
  const ctx = { storage: s, clock };
  const wi = work.create(ctx, { type: 'feature', title: 'F', agent: 'claude' });
  workflow.attachRun(ctx, { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
  lease.acquire(ctx, { workItem: wi.id, agent: 'claude', ttl: '30m' });
  blocker.create(ctx, { workItem: wi.id, type: 'missing_dependency', reason: 'x', agent: 'claude' });
});
afterEach(() => { s.close(); rmSync(dir, { recursive: true, force: true }); });

describe('regression: enrichment is serve-only (CLI usecases unchanged)', () => {
  it('lease.list items carry NO enriched fields', () => {
    const item = lease.list({ storage: s, clock }, { agent: 'claude' }).items[0] as Record<string, unknown>;
    expect('agent_type' in item).toBe(false);
    expect('current_step' in item).toBe(false);
    expect('ttl' in item).toBe(false);
    expect('ttl_seconds' in item).toBe(false);
  });

  it('blocker.list items carry NO current_step', () => {
    const b = blocker.list({ storage: s, clock }, null)[0] as Record<string, unknown>;
    expect('current_step' in b).toBe(false);
  });
});
