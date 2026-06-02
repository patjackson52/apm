import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as session from '../../src/usecases/session.js';
import * as lease from '../../src/usecases/lease.js';

let dir: string; let storage: SqliteStorage; const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-int-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('plan 2 integration', () => {
  it('create -> ready -> session -> lease -> release lifecycle', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'Offline', estimate: 'M', agent: 'claude' });
    work.update(ctx(), wi.id, { status: 'ready' }, 'claude');
    const s = session.start(ctx(), 'claude');
    const l = lease.acquire(ctx(), { workItem: wi.id, agent: 'claude', session: s.id, ttl: '30m' });
    expect(work.show(ctx(), wi.id).status).toBe('active');
    const held = lease.list(ctx(), { agent: 'claude' });
    expect(held.items).toHaveLength(1);
    lease.release(ctx(), l.id);
    expect(work.show(ctx(), wi.id).status).toBe('ready');
    session.end(ctx(), s.id);
    expect(session.show(ctx(), s.id).status).toBe('ended');
  });
});
