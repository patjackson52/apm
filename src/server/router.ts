import type { Ctx } from '../cli/run.js';

export interface RouteCtx { ctx: Ctx; params: Record<string, string>; query: URLSearchParams; }
export type RouteRun = (rc: RouteCtx) => unknown;
export type RawRun = (rc: { projectRoot: string; query: URLSearchParams }, res: import('node:http').ServerResponse) => void;
export interface Route { method: string; pattern: string; run?: RouteRun; raw?: RawRun; }

export type MatchResult =
  | { route: Route; params: Record<string, string> }
  | { status: 404 | 405 };

/** Match a pattern like `/api/work/:id` against a pathname; returns params or null. */
export function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const pp = pattern.split('/');
  const sp = pathname.split('/');
  if (pp.length !== sp.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    const seg = pp[i];
    if (seg.startsWith(':')) {
      if (sp[i] === '') return null;
      params[seg.slice(1)] = decodeURIComponent(sp[i]);
    } else if (seg !== sp[i]) {
      return null;
    }
  }
  return params;
}

/** Match method+path against the route table. 404 if no path matches; 405 if path matches but method doesn't. */
export function matchRoute(routes: Route[], method: string, pathname: string): MatchResult {
  let pathMatched = false;
  for (const r of routes) {
    const params = matchPattern(r.pattern, pathname);
    if (params) {
      if (r.method === method) return { route: r, params };
      pathMatched = true;
    }
  }
  return { status: pathMatched ? 405 : 404 };
}
