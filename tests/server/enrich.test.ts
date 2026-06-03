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
import { formatTtl, enrichLease, enrichBlocker } from '../../src/server/enrich.js';
import type { LeaseView } from '../../src/domain/entities.js';

const clock = fixedClock('2026-06-03T12:00:00.000Z');

describe('formatTtl', () => {
  it.each([
    [0, 'expired'], [-5, 'expired'], [45, '45s'], [90, '1m'],
    [3599, '59m'], [5400, '1h30m'], [7260, '2h01m'], [3600, '1h00m'],
  ])('%i -> %s', (s, out) => expect(formatTtl(s as number)).toBe(out as string));
});

describe('enrichers', () => {
  let dir: string; let s: SqliteStorage; let wiId: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apm-enrich-'));
    initProject(dir, clock);
    s = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
    const ctx = { storage: s, clock };
    const wi = work.create(ctx, { type: 'feature', title: 'F', agent: 'claude' });
    wiId = wi.id;
    workflow.attachRun(ctx, { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    lease.acquire(ctx, { workItem: wi.id, agent: 'claude', ttl: '30m' });
  });
  afterEach(() => { s.close(); rmSync(dir, { recursive: true, force: true }); });

  it('enrichLease adds agent_type, current_step (active run step), ttl/ttl_seconds', () => {
    const ctx = { storage: s, clock };
    const base = lease.list(ctx, { agent: 'claude' }).items[0];
    const ev = s.transaction('deferred', (tx) => enrichLease(base, tx, clock));
    expect(ev.agent_type).toBe('agent');
    expect(ev.current_step).toBe('brainstorm'); // first step of feature_delivery
    expect(ev.ttl_seconds).toBe(1800);
    expect(ev.ttl).toBe('30m');
  });

  it('missing agent -> agent_type null; work item with no active run -> current_step null', () => {
    const ctx = { storage: s, clock };
    const noRunWi = work.create(ctx, { type: 'feature', title: 'NR', agent: 'claude' });
    const base: LeaseView = {
      id: 'LEASE-x', work_item: noRunWi.id, agent: 'ghost', session: null,
      status: 'active', acquired_at: clock.now(),
      expires_at: '2026-06-03T12:00:30.000Z', heartbeat_at: null,
    };
    const ev = s.transaction('deferred', (tx) => enrichLease(base, tx, clock));
    expect(ev.agent_type).toBeNull();
    expect(ev.current_step).toBeNull();
    expect(ev.ttl_seconds).toBe(30);
    expect(ev.ttl).toBe('30s');
  });

  it('enrichBlocker adds current_step from the active run', () => {
    const ctx = { storage: s, clock };
    const blk = blocker.create(ctx, { workItem: wiId, type: 'missing_dependency', reason: 'x', agent: 'claude' });
    const base = blocker.show(ctx, blk.id);
    const ev = s.transaction('deferred', (tx) => enrichBlocker(base, tx));
    expect(ev.current_step).toBe('brainstorm');
  });
});
