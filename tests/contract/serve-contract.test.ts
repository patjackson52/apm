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
  LeaseViewSchema, WorkflowDefSummarySchema, WorkflowDefViewSchema, StatusViewSchema, EventViewSchema, SessionViewSchema,
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
});
