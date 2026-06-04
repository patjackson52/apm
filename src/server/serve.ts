import http from 'node:http';
import path from 'node:path';
import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';
import { SqliteStorage } from '../storage/sqlite.js';
import { findProjectDb, type Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { ok, fail, buildMeta } from '../format/envelope.js';
import { matchRoute, type Route } from './router.js';
import { serveFile } from './files.js';
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
import * as events from '../usecases/events.js';
import * as session from '../usecases/session.js';

const num = (q: URLSearchParams, k: string): number | undefined => {
  const v = q.get(k); return v == null ? undefined : parseInt(v, 10);
};
const str = (q: URLSearchParams, k: string): string | undefined => q.get(k) ?? undefined;

/** Read-only GET route table — thin adapters over existing usecases. */
export const ROUTES: Route[] = [
  { method: 'GET', pattern: '/api/status', run: ({ ctx }) => enrich.enrichedStatus(ctx) },
  { method: 'GET', pattern: '/api/events', run: ({ ctx, query }) => events.list(ctx, { entityType: str(query, 'entity-type'), entityId: str(query, 'entity-id'), limit: num(query, 'limit'), offset: num(query, 'offset') }) },
  { method: 'GET', pattern: '/api/sessions', run: ({ ctx }) => session.list(ctx) },
  { method: 'GET', pattern: '/api/leases', run: ({ ctx, query }) => enrich.listEnrichedLeases(ctx, { workItem: str(query, 'work-item'), agent: str(query, 'agent') }) },
  { method: 'GET', pattern: '/api/work', run: ({ ctx, query }) => work.list(ctx, { status: str(query, 'status'), type: str(query, 'type'), limit: num(query, 'limit'), offset: num(query, 'offset') }) },
  { method: 'GET', pattern: '/api/work/:id', run: ({ ctx, params }) => work.show(ctx, params.id) },
  { method: 'GET', pattern: '/api/work/:id/children', run: ({ ctx, params }) => work.children(ctx, params.id) },
  { method: 'GET', pattern: '/api/work/:id/blockers', run: ({ ctx, params }) => work.blockers(ctx, params.id) },
  { method: 'GET', pattern: '/api/work/:id/artifacts', run: ({ ctx, params, query }) => artifact.list(ctx, { workItem: params.id, limit: num(query, 'limit'), offset: num(query, 'offset') }) },
  { method: 'GET', pattern: '/api/work/:id/runs', run: ({ ctx, params }) => workflow.runsForWorkItem(ctx, params.id) },
  { method: 'GET', pattern: '/api/artifacts/:id', run: ({ ctx, params }) => artifact.show(ctx, params.id) },
  { method: 'GET', pattern: '/api/workflows', run: ({ ctx }) => workflow.list(ctx) },
  { method: 'GET', pattern: '/api/workflows/:nameOrId', run: ({ ctx, params }) => workflow.show(ctx, params.nameOrId) },
  { method: 'GET', pattern: '/api/runs/:id/steps', run: ({ ctx, params }) => step.listForRun(ctx, params.id) },
  { method: 'GET', pattern: '/api/decisions', run: ({ ctx, query }) => decision.list(ctx, str(query, 'work-item')) },
  { method: 'GET', pattern: '/api/adr', run: ({ ctx }) => adr.list(ctx) },
  { method: 'GET', pattern: '/api/adr/:id', run: ({ ctx, params }) => adr.show(ctx, params.id) },
  { method: 'GET', pattern: '/api/blockers', run: ({ ctx, query }) => enrich.listEnrichedBlockers(ctx, str(query, 'work-item')) },
  { method: 'GET', pattern: '/api/gates', run: ({ ctx, query }) => enrich.listEnrichedGates(ctx, { workItem: str(query, 'work-item') }) },
  { method: 'GET', pattern: '/api/files', raw: (rc, res) => serveFile(rc.projectRoot, rc.query.get('path'), res, SECURITY_HEADERS) },
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
  return (req, res) => {
    const cmd = `${req.method ?? 'GET'} ${req.url ?? '/'}`;
    const failOut = (code: 'E_NOT_FOUND' | 'E_VALIDATION' | 'E_INTERNAL', msg: string) =>
      writeJson(res, httpStatusFor(new ApmError(code, msg)), fail(new ApmError(code, msg), buildMeta(cmd, clock)));

    // Anti-DNS-rebind: only localhost Host headers (IPv4 loopback only; an IPv6 `::1` Host would be rejected — intentional, server binds 127.0.0.1)
    const host = String(req.headers.host ?? '').split(':')[0];
    if (host !== 'localhost' && host !== '127.0.0.1') { writeJson(res, 403, fail(new ApmError('E_VALIDATION', 'forbidden host'), buildMeta(cmd, clock))); return; }

    // No CORS preflight — same-origin only, read-only API
    if (req.method === 'OPTIONS') { writeJson(res, 405, fail(new ApmError('E_VALIDATION', 'method not allowed'), buildMeta(cmd, clock))); return; }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const m = matchRoute(ROUTES, req.method ?? 'GET', url.pathname);
    if ('status' in m) {
      if (m.status === 404) return failOut('E_NOT_FOUND', `no route ${url.pathname}`);
      writeJson(res, 405, fail(new ApmError('E_VALIDATION', 'method not allowed'), buildMeta(cmd, clock))); return;
    }

    if (m.route.raw) {
      try {
        const projectRoot = path.dirname(path.dirname(findProjectDb(dir)));
        m.route.raw({ projectRoot, query: url.searchParams }, res);
      } catch (e) {
        const apm = e instanceof ApmError ? e : new ApmError('E_INTERNAL', String((e as Error)?.message ?? e));
        writeJson(res, httpStatusFor(apm), fail(apm, buildMeta(cmd, clock)));
      }
      return;
    }
    let storage: SqliteStorage | undefined;
    try {
      storage = new SqliteStorage(findProjectDb(dir), clock);
      const ctx: Ctx = { storage, clock };
      const data = m.route.run!({ ctx, params: m.params, query: url.searchParams });
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
