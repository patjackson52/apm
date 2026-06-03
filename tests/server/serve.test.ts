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
import * as step from '../../src/usecases/step.js';
import * as artifact from '../../src/usecases/artifact.js';
import { startServer } from '../../src/server/serve.js';

let dir: string; let server: http.Server; let base: string;
const clock = fixedClock('2026-06-03T12:00:00.000Z');

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'apm-serve-'));
  initProject(dir, clock);
  // seed a run with artifacts + step_runs
  const s = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
  const ctx = { storage: s, clock };
  const wi = work.create(ctx, { type: 'feature', title: 'F', agent: 'claude' });
  workflow.attachRun(ctx, { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
  artifact.create(ctx, { workItem: wi.id, type: 'decision', title: 'D', body: 'dbody', agent: 'claude' });
  artifact.create(ctx, { workItem: wi.id, type: 'spec', title: 'S', body: '# spec body', agent: 'claude' });
  const run = workflow.runsForWorkItem(ctx, wi.id)[0];
  step.complete(ctx, { run: run.id, step: 'brainstorm', agent: 'claude' });
  artifact.create(ctx, { workItem: wi.id, type: 'design', title: 'Dz', body: 'dz', agent: 'claude' });
  step.complete(ctx, { run: run.id, step: 'design', agent: 'claude' });
  s.close();

  server = startServer({ dir, clock, port: 0 });
  await new Promise<void>((r) => server.on('listening', () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${(addr as any).port}`;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

const get = async (p: string) => { const r = await fetch(base + p); return { status: r.status, body: (await r.json()) as any }; };

describe('apm serve', () => {
  it('binds to 127.0.0.1', () => {
    expect((server.address() as any).address).toBe('127.0.0.1');
  });

  it('GET /api/status → envelope with counts', async () => {
    const { status, body } = await get('/api/status');
    expect(status).toBe(200); expect(body.ok).toBe(true);
    expect(body.data.work.by_status).toBeTruthy();
  });

  it('GET /api/workflows/feature_delivery → steps + edges', async () => {
    const { body } = await get('/api/workflows/feature_delivery');
    expect(body.data.steps).toHaveLength(9);
    expect(body.data.edges).toContainEqual({ from: 'brainstorm', to: 'design' });
  });

  it('GET /api/work/WI-1/runs then /api/runs/:id/steps → step_runs', async () => {
    const runs = await get('/api/work/WI-1/runs');
    const runId = runs.body.data[0].id;
    const steps = await get(`/api/runs/${runId}/steps`);
    expect(steps.status).toBe(200);
    const ids = steps.body.data.map((s: any) => s.step_id);
    expect(ids).toContain('brainstorm');
    expect(ids).toContain('design_review');
  });

  it('GET /api/artifacts/:id → body present', async () => {
    const list = await get('/api/work/WI-1/artifacts');
    const specId = list.body.data.items.find((a: any) => a.type === 'spec').id;
    const art = await get(`/api/artifacts/${specId}`);
    expect(art.body.data.body).toBe('# spec body');
  });

  it('404 for unknown id, ok:false', async () => {
    const { status, body } = await get('/api/work/WI-999');
    expect(status).toBe(404); expect(body.ok).toBe(false); expect(body.error.code).toBe('E_NOT_FOUND');
  });

  it('405 for POST on a known path', async () => {
    const r = await fetch(base + '/api/status', { method: 'POST' });
    expect(r.status).toBe(405);
  });

  it('403 for a non-localhost Host header (anti DNS-rebind)', async () => {
    const port = (server.address() as any).port;
    const code: number = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/api/status', method: 'GET', headers: { host: 'evil.com' } }, (res) => { resolve(res.statusCode ?? 0); res.resume(); });
      req.end();
    });
    expect(code).toBe(403);
  });
});
