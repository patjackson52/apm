import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as workflow from '../../src/usecases/workflow.js';
import * as artifact from '../../src/usecases/artifact.js';
import * as lease from '../../src/usecases/lease.js';
import * as blocker from '../../src/usecases/blocker.js';
import * as session from '../../src/usecases/session.js';
import { startServer } from '../../src/server/serve.js';
import {
  envelopeSchema, pageSchema,
  WorkItemViewSchema, RunViewSchema, StepRunViewSchema, ArtifactViewSchema,
  DecisionViewSchema, BlockerViewSchema, EnrichedBlockerViewSchema, WorkBlockersSchema,
  LeaseViewSchema, WorkflowDefSummarySchema, WorkflowDefViewSchema, StatusViewSchema, EventViewSchema, SessionViewSchema, ProjectViewSchema, SearchResultViewSchema,
} from '@apm/types';

const clock = fixedClock('2026-06-03T12:00:00.000Z');
let dir: string; let server: http.Server; let base: string; let wiId: string; let runId: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'apm-contract-'));
  initProject(dir, clock);
  const s = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
  const ctx = { storage: s, clock };
  const wi = work.create(ctx, { type: 'feature', title: 'F', agent: 'claude' });
  wiId = wi.id;
  const run = workflow.attachRun(ctx, { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
  runId = run.id;
  artifact.create(ctx, { workItem: wi.id, type: 'decision', title: 'D', body: 'x', agent: 'claude' });
  artifact.create(ctx, { workItem: wi.id, type: 'spec', title: 'S', body: 'x', agent: 'claude' });
  lease.acquire(ctx, { workItem: wi.id, agent: 'claude', ttl: '30m' });
  blocker.create(ctx, { workItem: wi.id, type: 'missing_dependency', reason: 'x', agent: 'claude' });
  session.start(ctx, 'claude');
  s.close();
  server = startServer({ dir, clock, port: 0 });
  await new Promise<void>((r) => server.on('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); rmSync(dir, { recursive: true, force: true }); });

async function check(path: string, dataSchema: z.ZodTypeAny) {
  const res = await fetch(base + path);
  const json = await res.json();
  const parsed = envelopeSchema(dataSchema).safeParse(json);
  if (!parsed.success) {
    throw new Error(`${path} failed contract: ${JSON.stringify(parsed.error.issues.slice(0, 4))}`);
  }
  expect(parsed.success).toBe(true);
}

describe('apm serve ↔ @apm/types contract', () => {
  it('/api/status', () => check('/api/status', StatusViewSchema));
  it('/api/work (page)', () => check('/api/work', pageSchema(WorkItemViewSchema)));
  it('/api/work/:id', () => check(`/api/work/${wiId}`, WorkItemViewSchema));
  it('/api/work/:id/children (page)', () => check(`/api/work/${wiId}/children`, pageSchema(WorkItemViewSchema)));
  it('/api/work/:id/blockers (base WorkBlockers)', () => check(`/api/work/${wiId}/blockers`, WorkBlockersSchema));
  it('/api/work/:id/artifacts (page)', () => check(`/api/work/${wiId}/artifacts`, pageSchema(ArtifactViewSchema)));
  it('/api/work/:id/runs (array)', () => check(`/api/work/${wiId}/runs`, z.array(RunViewSchema)));
  it('/api/runs/:id/steps (array)', () => check(`/api/runs/${runId}/steps`, z.array(StepRunViewSchema)));
  it('/api/workflows (lean list)', () => check('/api/workflows', z.array(WorkflowDefSummarySchema)));
  it('/api/workflows/:id (full)', () => check('/api/workflows/feature_delivery', WorkflowDefViewSchema));
  it('/api/decisions (array)', () => check('/api/decisions', z.array(DecisionViewSchema)));
  it('/api/adr (page)', () => check('/api/adr', pageSchema(ArtifactViewSchema)));
  it('/api/blockers (enriched array)', () => check('/api/blockers', z.array(EnrichedBlockerViewSchema)));
  it('/api/gates (enriched array)', () => check('/api/gates', z.array(EnrichedBlockerViewSchema)));
  it('/api/leases ({items}, no page wrapper)', () => check('/api/leases', z.object({ items: z.array(LeaseViewSchema) }).strict()));
  it('/api/events (page)', () => check('/api/events', pageSchema(EventViewSchema)));
  it('/api/sessions (array)', () => check('/api/sessions', z.array(SessionViewSchema)));
  it('/api/projects (array)', () => check('/api/projects', z.array(ProjectViewSchema)));
  it('/api/search (array) finds the seeded work item', async () => {
    const res = await (await fetch(base + '/api/search?q=F')).json();
    expect(z.array(SearchResultViewSchema).safeParse(res.data).success).toBe(true);
    expect(res.data.some((r: any) => r.kind === 'work_item')).toBe(true);
  });
  it('/api/search blank q -> [] ; SQL wildcards/injection escaped (no match-all, no 500)', async () => {
    expect((await (await fetch(base + '/api/search?q=')).json()).data).toEqual([]);
    const pct = await (await fetch(base + '/api/search?q=%25')).json(); // q='%'
    const inj = await (await fetch(base + "/api/search?q=' OR 1=1 --")).json();
    expect(pct.ok).toBe(true); expect(inj.ok).toBe(true);
    expect(Array.isArray(pct.data)).toBe(true); expect(Array.isArray(inj.data)).toBe(true);
    expect(pct.data.length).toBe(0); // '%' is escaped -> literal, matches nothing
  });
  it('?project=bogus / ../etc -> default project data (switch-by-id, no path injection)', async () => {
    const def = await (await fetch(base + '/api/work')).json();
    const bogus = await (await fetch(base + '/api/work?project=bogus')).json();
    const trav = await (await fetch(base + '/api/work?project=../etc/passwd')).json();
    expect(bogus.ok).toBe(true); expect(trav.ok).toBe(true);
    expect(bogus.data.items.map((w: any) => w.id)).toEqual(def.data.items.map((w: any) => w.id));
    expect(trav.data.items.map((w: any) => w.id)).toEqual(def.data.items.map((w: any) => w.id));
  });
});
