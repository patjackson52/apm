import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as lease from '../../src/usecases/lease.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-03T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-lr-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('resource leases', () => {
  it('acquires a non-work-item resource lease (integration)', () => {
    const l = lease.acquireResource(ctx(), { resourceType: 'integration', resourceKey: 'main', agent: 'agentA', ttl: '10m' });
    expect(l.status).toBe('active');
  });

  it('rejects a second active lease on the same resource', () => {
    lease.acquireResource(ctx(), { resourceType: 'integration', resourceKey: 'main', agent: 'agentA', ttl: '10m' });
    expect(() => lease.acquireResource(ctx(), { resourceType: 'integration', resourceKey: 'main', agent: 'agentB', ttl: '10m' }))
      .toThrowError(/lease/i);
  });

  it('allows distinct resource keys of the same type concurrently', () => {
    lease.acquireResource(ctx(), { resourceType: 'slot', resourceKey: 'slot-1', agent: 'agentA', ttl: '10m' });
    const l2 = lease.acquireResource(ctx(), { resourceType: 'slot', resourceKey: 'slot-2', agent: 'agentB', ttl: '10m' });
    expect(l2.status).toBe('active');
  });
});
