import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';
import { SqliteStorage } from '../storage/sqlite.js';
import { findProjectDb, type Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { ok, fail, buildMeta } from '../format/envelope.js';
import { matchRoute, type Route } from './router.js';
import { serveFile, serveBlob } from './files.js';
import { loadRegistry, ensureRegistered, resolveProjectDir, listProjects } from './registry.js';
import { httpStatusFor } from './httpError.js';
import * as enrich from './enrich.js';
import * as work from '../usecases/work.js';
import * as artifact from '../usecases/artifact.js';
import * as workflow from '../usecases/workflow.js';
import * as step from '../usecases/step.js';
import * as status from '../usecases/status.js';
import * as decision from '../usecases/decision.js';
import * as adr from '../usecases/adr.js';
import * as blocker from '../usecases/blocker.js';
import * as gate from '../usecases/gate.js';
import * as nextRun from '../usecases/next.js';
import * as events from '../usecases/events.js';
import * as session from '../usecases/session.js';
import * as search from '../usecases/search.js';
import * as image from '../usecases/image.js';
import * as prompt from '../usecases/prompt.js';
import * as workPrompt from '../usecases/workPrompt.js';

const num = (q: URLSearchParams, k: string): number | undefined => {
  const v = q.get(k); return v == null ? undefined : parseInt(v, 10);
};
const str = (q: URLSearchParams, k: string): string | undefined => q.get(k) ?? undefined;

/** Read-only GET route table — thin adapters over existing usecases. */
export const ROUTES: Route[] = [
  { method: 'GET', pattern: '/api/status', run: ({ ctx }) => enrich.enrichedStatus(ctx) },
  { method: 'GET', pattern: '/api/events', run: ({ ctx, query }) => events.list(ctx, { entityType: str(query, 'entity-type'), entityId: str(query, 'entity-id'), limit: num(query, 'limit'), offset: num(query, 'offset') }) },
  { method: 'GET', pattern: '/api/sessions', run: ({ ctx }) => session.list(ctx) },
  { method: 'GET', pattern: '/api/search', run: ({ ctx, query }) => search.query(ctx, { q: str(query, 'q') ?? '', limit: num(query, 'limit') }) },
  { method: 'GET', pattern: '/api/leases', run: ({ ctx, query }) => enrich.listEnrichedLeases(ctx, { workItem: str(query, 'work-item'), agent: str(query, 'agent') }) },
  { method: 'GET', pattern: '/api/work', run: ({ ctx, query }) => work.list(ctx, { status: str(query, 'status'), type: str(query, 'type'), limit: num(query, 'limit'), offset: num(query, 'offset') }) },
  { method: 'GET', pattern: '/api/work/:id', run: ({ ctx, params }) => work.show(ctx, params.id) },
  { method: 'GET', pattern: '/api/work/:id/children', run: ({ ctx, params }) => work.children(ctx, params.id) },
  { method: 'GET', pattern: '/api/work/:id/blockers', run: ({ ctx, params }) => work.blockers(ctx, params.id) },
  { method: 'GET', pattern: '/api/work/:id/artifacts', run: ({ ctx, params, query }) => artifact.list(ctx, { workItem: params.id, limit: num(query, 'limit'), offset: num(query, 'offset') }) },
  { method: 'GET', pattern: '/api/work/:id/runs', run: ({ ctx, params }) => workflow.runsForWorkItem(ctx, params.id) },
  { method: 'GET', pattern: '/api/artifacts', run: ({ ctx, query }) => artifact.listAll(ctx, { limit: num(query, 'limit'), offset: num(query, 'offset'), type: str(query, 'type') }) },
  { method: 'GET', pattern: '/api/work/:id/prompt-panel', run: ({ ctx, params }) => workPrompt.promptPanel(ctx, params.id) },
  { method: 'GET', pattern: '/api/artifacts/:id', run: ({ ctx, params }) => artifact.show(ctx, params.id) },
  { method: 'GET', pattern: '/api/prompts', run: ({ ctx }) => prompt.listSummaries(ctx) },
  { method: 'GET', pattern: '/api/prompts/:name', run: ({ ctx, params }) => prompt.detail(ctx, params.name) },
  { method: 'GET', pattern: '/api/prompts/:name/usage', run: ({ ctx, params, query }) => prompt.usage(ctx, params.name, num(query, 'limit'), num(query, 'offset')) },
  { method: 'GET', pattern: '/api/prompts/:name/versions/:v', run: ({ ctx, params }) => {
    const p = prompt.show(ctx, params.name, parseInt(params.v, 10));
    return { version: p.version, body: p.body, created_at: p.created_at };
  } },
  { method: 'GET', pattern: '/api/workflows', run: ({ ctx }) => workflow.list(ctx) },
  { method: 'GET', pattern: '/api/workflows/:nameOrId', run: ({ ctx, params }) => workflow.show(ctx, params.nameOrId) },
  { method: 'GET', pattern: '/api/runs/:id/steps', run: ({ ctx, params }) => step.listForRun(ctx, params.id) },
  { method: 'GET', pattern: '/api/decisions', run: ({ ctx, query }) => decision.list(ctx, str(query, 'work-item')) },
  { method: 'GET', pattern: '/api/adr', run: ({ ctx }) => adr.list(ctx) },
  { method: 'GET', pattern: '/api/adr/:id', run: ({ ctx, params }) => adr.show(ctx, params.id) },
  { method: 'GET', pattern: '/api/blockers', run: ({ ctx, query }) => enrich.listEnrichedBlockers(ctx, str(query, 'work-item')) },
  { method: 'GET', pattern: '/api/gates', run: ({ ctx, query }) => enrich.listEnrichedGates(ctx, { workItem: str(query, 'work-item') }) },
  { method: 'GET', pattern: '/api/files', raw: (rc, res) => serveFile(rc.projectRoot, rc.query.get('path'), res, SECURITY_HEADERS) },
  { method: 'GET', pattern: '/api/blob/:sha', raw: (rc, res) => serveBlob(rc.projectRoot, rc.params.sha, res, SECURITY_HEADERS) },
  { method: 'GET', pattern: '/api/work/:id/images', run: ({ ctx, params, query }) => image.list(ctx, { workItem: params.id, limit: num(query, 'limit'), offset: num(query, 'offset') }) },
  { method: 'GET', pattern: '/api/images/:id', run: ({ ctx, params }) => image.show(ctx, params.id) },
  { method: 'GET', pattern: '/api/images/:id/versions', run: ({ ctx, params }) => ({ items: image.versions(ctx, params.id) }) },
  // --- Writes (WI-42; guarded by the CSRF/Origin check above). Wire to existing usecases. ---
  { method: 'POST', pattern: '/api/gates/:blocker/answer', run: ({ ctx, params, body }) => gate.answer(ctx, params.blocker, body as gate.AnswerGateArgs) },
  { method: 'POST', pattern: '/api/work/:id/next', run: ({ ctx, body }) => nextRun.next(ctx, { capabilities: [], match: 'any', ...(body as Partial<nextRun.NextArgs>), acquire: true } as nextRun.NextArgs) },
  { method: 'POST', pattern: '/api/runs/:run/steps/:step/complete', run: ({ ctx, params, body }) => step.complete(ctx, { run: params.run, step: params.step, ...(body as object) } as step.CompleteArgs) },
  { method: 'POST', pattern: '/api/runs/:run/steps/:step/fail', run: ({ ctx, params, body }) => step.fail(ctx, { run: params.run, step: params.step, ...(body as object) } as step.FailArgs) },
  { method: 'POST', pattern: '/api/runs/:run/steps/:step/retry', run: ({ ctx, params, body }) => step.retry(ctx, { run: params.run, step: params.step, ...(body as object) } as step.RetryArgs) },
];

/** Security response headers applied to every response (JSON + files). */
export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;

function writeJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}

export interface ServeOptions { dir: string; clock?: Clock; port?: number; }

/** Build the node:http request listener (read-only, single project at `dir`). */
export function createListener(dir: string, clock: Clock): http.RequestListener {
  const registry = ensureRegistered(loadRegistry(process.env.APM_HOME ?? os.homedir()), path.dirname(path.dirname(findProjectDb(dir))));
  // Per-listener CSRF token. Writes must echo it in `X-APM-CSRF`; the custom header
  // forces a CORS preflight for any cross-origin caller, which we deny (no CORS).
  const csrfToken = randomUUID();
  const isLocalOrigin = (o: string | undefined): boolean => !o || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
  return async (req, res) => {
    const cmd = `${req.method ?? 'GET'} ${req.url ?? '/'}`;
    const failOut = (code: 'E_NOT_FOUND' | 'E_VALIDATION' | 'E_INTERNAL', msg: string) =>
      writeJson(res, httpStatusFor(new ApmError(code, msg)), fail(new ApmError(code, msg), buildMeta(cmd, clock)));

    // Anti-DNS-rebind: only localhost Host headers (IPv4 loopback only; an IPv6 `::1` Host would be rejected — intentional, server binds 127.0.0.1)
    const host = String(req.headers.host ?? '').split(':')[0];
    if (host !== 'localhost' && host !== '127.0.0.1') { writeJson(res, 403, fail(new ApmError('E_VALIDATION', 'forbidden host'), buildMeta(cmd, clock))); return; }

    // No CORS preflight — same-origin only.
    if (req.method === 'OPTIONS') { writeJson(res, 405, fail(new ApmError('E_VALIDATION', 'method not allowed'), buildMeta(cmd, clock))); return; }

    // CSRF/Origin guard for writes (read paths unaffected).
    if (req.method !== 'GET') {
      if (req.headers['x-apm-csrf'] !== csrfToken) { writeJson(res, 403, fail(new ApmError('E_VALIDATION', 'bad or missing CSRF token'), buildMeta(cmd, clock))); return; }
      if (!isLocalOrigin(req.headers.origin)) { writeJson(res, 403, fail(new ApmError('E_VALIDATION', 'forbidden origin'), buildMeta(cmd, clock))); return; }
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const projectDir = resolveProjectDir(registry, url.searchParams.get('project'), dir);

    // CSRF token (read-only; the viewer fetches it and echoes it on writes).
    if (url.pathname === '/api/csrf') {
      if (req.method !== 'GET') { writeJson(res, 405, fail(new ApmError('E_VALIDATION', 'method not allowed'), buildMeta(cmd, clock))); return; }
      writeJson(res, 200, ok({ token: csrfToken }, buildMeta(cmd, clock))); return;
    }

    // Project registry list (needs the per-listener registry + dir, so handled here).
    if (url.pathname === '/api/projects') {
      if (req.method !== 'GET') { writeJson(res, 405, fail(new ApmError('E_VALIDATION', 'method not allowed'), buildMeta(cmd, clock))); return; }
      const currentRoot = path.dirname(path.dirname(findProjectDb(projectDir)));
      writeJson(res, 200, ok(listProjects(registry, currentRoot), buildMeta(cmd, clock))); return;
    }

    const m = matchRoute(ROUTES, req.method ?? 'GET', url.pathname);
    if ('status' in m) {
      if (m.status === 404) return failOut('E_NOT_FOUND', `no route ${url.pathname}`);
      writeJson(res, 405, fail(new ApmError('E_VALIDATION', 'method not allowed'), buildMeta(cmd, clock))); return;
    }

    if (m.route.raw) {
      try {
        const projectRoot = path.dirname(path.dirname(findProjectDb(projectDir)));
        m.route.raw({ projectRoot, params: m.params, query: url.searchParams }, res);
      } catch (e) {
        const apm = e instanceof ApmError ? e : new ApmError('E_INTERNAL', String((e as Error)?.message ?? e));
        writeJson(res, httpStatusFor(apm), fail(apm, buildMeta(cmd, clock)));
      }
      return;
    }
    const readBody = (): Promise<unknown> => new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        const s = Buffer.concat(chunks).toString('utf8');
        if (!s) return resolve({});
        try { resolve(JSON.parse(s)); } catch { reject(new ApmError('E_VALIDATION', 'invalid JSON body')); }
      });
      req.on('error', reject);
    });
    let storage: SqliteStorage | undefined;
    try {
      const body = req.method === 'GET' ? undefined : await readBody();
      storage = new SqliteStorage(findProjectDb(projectDir), clock);
      const ctx: Ctx = { storage, clock };
      const data = m.route.run!({ ctx, params: m.params, query: url.searchParams, body });
      writeJson(res, 200, ok(data, buildMeta(cmd, clock)));
    } catch (e) {
      const apm = e instanceof ApmError ? e : new ApmError('E_INTERNAL', String((e as Error)?.message ?? e));
      writeJson(res, httpStatusFor(apm), fail(apm, buildMeta(cmd, clock)));
    } finally {
      storage?.close();
    }
  };
}

/** Start a read-only HTTP server bound to 127.0.0.1. */
export function startServer(opts: ServeOptions): http.Server {
  const server = http.createServer(createListener(opts.dir, opts.clock ?? systemClock));
  server.listen(opts.port ?? 7842, '127.0.0.1');
  return server;
}
