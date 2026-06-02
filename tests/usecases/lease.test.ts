import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as lease from '../../src/usecases/lease.js';
import { parseTtlSeconds } from '../../src/usecases/lease.js';

let dir: string; let storage: SqliteStorage;
// clock fixed; expiry math uses an injected `now` epoch via the clock string
const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-lease-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); work.create({ storage, clock }, { type: 'task', title: 'A', agent: 'claude' }); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('lease usecases', () => {
  it('parses ttl strings to seconds', () => {
    expect(parseTtlSeconds('30m')).toBe(1800);
    expect(parseTtlSeconds('2h')).toBe(7200);
    expect(parseTtlSeconds('45s')).toBe(45);
  });

  it('acquires a lease and projects work item status to active', () => {
    const l = lease.acquire(ctx(), { workItem: 'WI-1', agent: 'claude', ttl: '30m' });
    expect(l.id).toBe('LEASE-1'); expect(l.status).toBe('active'); expect(l.work_item).toBe('WI-1');
    expect(work.show(ctx(), 'WI-1').status).toBe('active');
    expect(work.show(ctx(), 'WI-1').lease).toBe('LEASE-1');
  });

  it('rejects a second active lease on the same item', () => {
    lease.acquire(ctx(), { workItem: 'WI-1', agent: 'claude', ttl: '30m' });
    expect(() => lease.acquire(ctx(), { workItem: 'WI-1', agent: 'other', ttl: '30m' })).toThrowError(/lease/i);
  });

  it('releases a lease (idempotent)', () => {
    work.update(ctx(), 'WI-1', { status: 'ready' }, 'claude');
    const l = lease.acquire(ctx(), { workItem: 'WI-1', agent: 'claude', ttl: '30m' });
    lease.release(ctx(), l.id);
    lease.release(ctx(), l.id); // no throw
    expect(work.show(ctx(), 'WI-1').status).toBe('ready'); // computed back to stored status
  });

  it('lists leases held by an agent', () => {
    lease.acquire(ctx(), { workItem: 'WI-1', agent: 'claude', ttl: '30m' });
    const held = lease.list(ctx(), { agent: 'claude' });
    expect(held.items.map((l) => l.id)).toEqual(['LEASE-1']);
  });

  it('rejects --mine without --agent', () => {
    expect(() => lease.list(ctx(), { mine: true })).toThrowError(/--mine requires --agent/i);
  });

  it('--mine + --agent returns that agent\'s leases', () => {
    lease.acquire(ctx(), { workItem: 'WI-1', agent: 'claude', ttl: '30m' });
    const held = lease.list(ctx(), { mine: true, agent: 'claude' });
    expect(held.items.map((l) => l.id)).toEqual(['LEASE-1']);
  });

  it('heartbeat extends expiry', () => {
    const before = lease.acquire(ctx(), { workItem: 'WI-1', agent: 'claude', ttl: '30m' });
    // before.expires_at = 12:30 (30m from 12:00)
    const after = lease.heartbeat(ctx(), before.id, '60m');
    // after.expires_at = 13:00 (60m from 12:00)
    expect(new Date(after.expires_at).getTime()).toBeGreaterThan(new Date(before.expires_at).getTime());
  });

  it('expireStale marks expired leases and work item reverts to stored status', () => {
    // set item to ready, acquire with 30m ttl → expires at 12:30
    work.update(ctx(), 'WI-1', { status: 'ready' }, 'claude');
    lease.acquire(ctx(), { workItem: 'WI-1', agent: 'claude', ttl: '30m' });

    // open a second storage on the same db with a clock set to 13:00 (after expiry)
    const laterClock = fixedClock('2026-06-02T13:00:00.000Z');
    const laterStorage = new SqliteStorage(join(dir, '.apm', 'apm.db'), laterClock);
    const laterCtx = { storage: laterStorage, clock: laterClock };
    try {
      const result = lease.expireStale(laterCtx);
      expect(result).toEqual({ expired: 1 });
      // work item status should revert to stored status 'ready' (not 'active')
      expect(work.show(laterCtx, 'WI-1').status).toBe('ready');
    } finally {
      laterStorage.close();
    }
  });
});
