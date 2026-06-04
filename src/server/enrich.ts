import type { Clock } from '../domain/clock.js';
import type { Tx } from '../storage/storage.js';
import type { Ctx } from '../cli/run.js';
import { repos } from '../storage/repos.js';
import { toLeaseView, toRunView, type LeaseView, type BlockerView } from '../domain/entities.js';
import * as status from '../usecases/status.js';
import * as blocker from '../usecases/blocker.js';
import * as gate from '../usecases/gate.js';

/** Serve-layer enriched views. Domain LeaseView/BlockerView + CLI output stay unchanged. */
export type EnrichedLeaseView = LeaseView & {
  agent_type: string | null;
  current_step: string | null;
  ttl: string;
  ttl_seconds: number;
};
export type EnrichedBlockerView<T extends BlockerView = BlockerView> = T & { current_step: string | null };

/** Human remaining-time string. Pure. */
export function formatTtl(remainingSeconds: number): string {
  const n = Math.floor(remainingSeconds);
  if (n <= 0) return 'expired';
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m`;
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  return `${h}h${String(m).padStart(2, '0')}m`;
}

/** Per-request memo so a batch of leases/blockers on the same work item / agent hits the db once. */
export interface EnrichCache { steps: Map<string, string | null>; agents: Map<string, string | null>; }
export const newCache = (): EnrichCache => ({ steps: new Map(), agents: new Map() });

/** current_step of the work item's active run (null if none / terminal). */
function currentStepFor(tx: Tx, workItemId: string, cache: EnrichCache): string | null {
  const hit = cache.steps.get(workItemId);
  if (hit !== undefined) return hit;
  const row = repos(tx).runs.activeForWorkItem(workItemId);
  const v = row ? toRunView(row, '').current_step : null;
  cache.steps.set(workItemId, v);
  return v;
}

/** agents.type for the agent id (null if the agent row is missing). */
function agentTypeFor(tx: Tx, agentId: string, cache: EnrichCache): string | null {
  const hit = cache.agents.get(agentId);
  if (hit !== undefined) return hit;
  const v = repos(tx).agents.byId(agentId)?.type ?? null;
  cache.agents.set(agentId, v);
  return v;
}

/** Seconds until the lease expires (can be <= 0). `now` from the injected Clock (ISO string). */
function remainingSeconds(expiresAt: string, clock: Clock): number {
  return Math.floor((Date.parse(expiresAt) - Date.parse(clock.now())) / 1000);
}

export function enrichLease(base: LeaseView, tx: Tx, clock: Clock, cache: EnrichCache = newCache()): EnrichedLeaseView {
  const ttl_seconds = remainingSeconds(base.expires_at, clock);
  return {
    ...base,
    agent_type: agentTypeFor(tx, base.agent, cache),
    current_step: base.work_item ? currentStepFor(tx, base.work_item, cache) : null,
    ttl: formatTtl(ttl_seconds),
    ttl_seconds,
  };
}

export function enrichBlocker<T extends BlockerView>(base: T, tx: Tx, cache: EnrichCache = newCache()): EnrichedBlockerView<T> {
  return { ...base, current_step: currentStepFor(tx, base.work_item, cache) };
}

export function enrichLeases(items: LeaseView[], tx: Tx, clock: Clock): EnrichedLeaseView[] {
  const cache = newCache();
  return items.map((l) => enrichLease(l, tx, clock, cache));
}

export function enrichBlockers<T extends BlockerView>(items: T[], tx: Tx): EnrichedBlockerView<T>[] {
  const cache = newCache();
  return items.map((b) => enrichBlocker(b, tx, cache));
}

// ---- serve-layer view-builders (each owns one deferred read tx) ----

/** Active, non-expired leases (optional work-item / agent filter), enriched. Powers GET /api/leases. */
export function listEnrichedLeases(ctx: Ctx, f: { workItem?: string; agent?: string } = {}): { items: EnrichedLeaseView[] } {
  return ctx.storage.transaction('deferred', (tx) => {
    const now = ctx.clock.now();
    let sql = "SELECT * FROM leases WHERE status='active' AND expires_at > ?";
    const args: unknown[] = [now];
    if (f.workItem) { sql += ' AND work_item_id=?'; args.push(f.workItem); }
    if (f.agent) { sql += ' AND agent_id=?'; args.push(f.agent); }
    sql += ' ORDER BY id';
    const rows = tx.all<any>(sql, ...args);
    return { items: enrichLeases(rows.map(toLeaseView), tx, ctx.clock) };
  });
}

/** Open blockers (optional work-item filter), each + current_step. */
export function listEnrichedBlockers(ctx: Ctx, workItem?: string | null): EnrichedBlockerView[] {
  const base = blocker.list(ctx, workItem ?? null);
  return ctx.storage.transaction('deferred', (tx) => enrichBlockers(base, tx));
}

/** Human gates (BlockerView + gate fields), each + current_step. */
export function listEnrichedGates(ctx: Ctx, args: { workItem?: string } = {}): EnrichedBlockerView[] {
  const base = gate.list(ctx, args);
  return ctx.storage.transaction('deferred', (tx) => enrichBlockers(base, tx));
}

/** Global status with enriched active_leases + open_blockers (current_step). Same shape as status.status. */
export function enrichedStatus(ctx: Ctx): ReturnType<typeof status.status> {
  const base = status.status(ctx);
  return ctx.storage.transaction('deferred', (tx) => ({
    ...base,
    active_leases: enrichLeases(base.active_leases, tx, ctx.clock),
    open_blockers: enrichBlockers(base.open_blockers, tx),
  }));
}
