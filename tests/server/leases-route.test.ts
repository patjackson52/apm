import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
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
import { startServer } from '../../src/server/serve.js';

const clock = fixedClock('2026-06-03T12:00:00.000Z');
let dir: string; let server: http.Server; let base: string; let wiId: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'apm-leases-'));
  initProject(dir, clock);
  const s = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
  const ctx = { storage: s, clock };
  const wi = work.create(ctx, { type: 'feature', title: 'F', agent: 'claude' });
  wiId = wi.id;
  workflow.attachRun(ctx, { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
  lease.acquire(ctx, { workItem: wi.id, agent: 'claude', ttl: '30m' });
  blocker.create(ctx, { workItem: wi.id, type: 'missing_dependency', reason: 'x', agent: 'claude' });
  s.close();
  server = startServer({ dir, clock, port: 0 });
  await new Promise<void>((r) => server.on('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); rmSync(dir, { recursive: true, force: true }); });

const get = async (p: string) => { const r = await fetch(base + p); return { status: r.status, body: (await r.json()) as any, headers: r.headers }; };

describe('GET /api/leases (enriched)', () => {
  it('returns enriched active leases', async () => {
    const { status, body } = await get('/api/leases');
    expect(status).toBe(200); expect(body.ok).toBe(true);
    const l = body.data.items[0];
    expect(l.agent_type).toBe('agent');
    expect(l.current_step).toBe('brainstorm');
    expect(l.ttl).toBe('30m');
    expect(l.ttl_seconds).toBe(1800);
  });

  it('?work-item= filters', async () => {
    expect((await get(`/api/leases?work-item=${wiId}`)).body.data.items.length).toBe(1);
    expect((await get('/api/leases?work-item=WI-9999')).body.data.items.length).toBe(0);
  });

  it('carries SECURITY_HEADERS and rejects non-GET', async () => {
    const { headers } = await get('/api/leases');
    expect(headers.get('content-security-policy')).toContain("default-src 'none'");
    const r = await fetch(base + '/api/leases', { method: 'POST' });
    expect(r.status).toBe(405);
  });
});

describe('enriched status + blockers', () => {
  it('/api/status active_leases + open_blockers are enriched', async () => {
    const { body } = await get('/api/status');
    expect(body.data.active_leases[0].agent_type).toBe('agent');
    expect(body.data.active_leases[0].current_step).toBe('brainstorm');
    expect(body.data.active_leases[0].ttl).toBe('30m');
    expect(body.data.open_blockers[0].current_step).toBe('brainstorm');
  });

  it('/api/blockers carries current_step', async () => {
    const { body } = await get('/api/blockers');
    expect(body.data[0].current_step).toBe('brainstorm');
  });
});
