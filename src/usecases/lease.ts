import Database from 'better-sqlite3';
import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { toLeaseView, type LeaseView, type Page } from '../domain/entities.js';

export function parseTtlSeconds(ttl: string): number {
  const m = /^(\d+)([smh])$/.exec(ttl);
  if (!m) throw new ApmError('E_VALIDATION', `invalid ttl: ${ttl}`, [{ field: 'ttl', problem: 'format Ns|Nm|Nh', got: ttl }]);
  const n = Number(m[1]);
  return m[2] === 's' ? n : m[2] === 'm' ? n * 60 : n * 3600;
}

function addSeconds(iso: string, secs: number): string {
  return new Date(new Date(iso).getTime() + secs * 1000).toISOString();
}

export interface AcquireArgs { workItem: string; agent: string; session?: string; ttl: string; }

export interface AcquireResourceArgs {
  resourceType: 'work_item' | 'slot' | 'integration';
  resourceKey: string;
  workItem?: string | null;
  agent: string;
  session?: string;
  ttl: string;
}

export function acquireResource(ctx: Ctx, a: AcquireResourceArgs): LeaseView {
  const secs = parseTtlSeconds(a.ttl);
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    if (a.workItem && !r.workItems.byId(a.workItem)) throw new ApmError('E_NOT_FOUND', `${a.workItem} not found`);
    r.agents.ensure(a.agent);
    // lazy-heal expired active leases on THIS resource only
    tx.run("UPDATE leases SET status='expired' WHERE resource_type=? AND resource_key=? AND status='active' AND expires_at <= ?",
      a.resourceType, a.resourceKey, tx.now());
    const id = tx.allocateId('LEASE');
    try {
      tx.run(
        "INSERT INTO leases (id, resource_type, resource_key, work_item_id, agent_id, session_id, status, acquired_at, expires_at, heartbeat_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)",
        id, a.resourceType, a.resourceKey, a.workItem ?? null, a.agent, a.session ?? null, tx.now(), addSeconds(tx.now(), secs), tx.now(),
      );
    } catch (e: any) {
      if (
        (e instanceof Database.SqliteError && /UNIQUE/i.test(e.message)) ||
        e.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        /UNIQUE/i.test(String(e.message))
      ) {
        throw new ApmError('E_LEASE_CONFLICT', `${a.resourceType}:${a.resourceKey} is already leased`);
      }
      throw e;
    }
    tx.appendEvent({ actorId: a.agent, eventType: 'lease.acquired', entityType: 'lease', entityId: id, payload: { resource_type: a.resourceType, resource_key: a.resourceKey, work_item: a.workItem ?? null } });
    return toLeaseView(tx.get('SELECT * FROM leases WHERE id=?', id));
  });
}

export function acquire(ctx: Ctx, a: AcquireArgs): LeaseView {
  return acquireResource(ctx, { resourceType: 'work_item', resourceKey: a.workItem, workItem: a.workItem, agent: a.agent, session: a.session, ttl: a.ttl });
}

export function heartbeat(ctx: Ctx, leaseId: string, ttl: string): LeaseView {
  const secs = parseTtlSeconds(ttl);
  return ctx.storage.transaction('immediate', (tx) => {
    const row = tx.get('SELECT * FROM leases WHERE id=?', leaseId) as any;
    if (!row) throw new ApmError('E_NOT_FOUND', `${leaseId} not found`);
    if (row.status !== 'active' || row.expires_at <= tx.now()) throw new ApmError('E_LEASE_CONFLICT', 'LEASE_LOST');
    tx.run('UPDATE leases SET expires_at=?, heartbeat_at=? WHERE id=?', addSeconds(tx.now(), secs), tx.now(), leaseId);
    return toLeaseView(tx.get('SELECT * FROM leases WHERE id=?', leaseId));
  });
}

export function release(ctx: Ctx, leaseId: string): LeaseView {
  return ctx.storage.transaction('immediate', (tx) => {
    const row = tx.get('SELECT * FROM leases WHERE id=?', leaseId) as any;
    if (!row) throw new ApmError('E_NOT_FOUND', `${leaseId} not found`);
    if (row.status === 'active') {
      tx.run("UPDATE leases SET status='released' WHERE id=?", leaseId);
      tx.appendEvent({ actorId: row.agent_id, eventType: 'lease.released', entityType: 'lease', entityId: leaseId });
    }
    return toLeaseView(tx.get('SELECT * FROM leases WHERE id=?', leaseId));
  });
}

export function expireStale(ctx: Ctx): { expired: number } {
  return ctx.storage.transaction('immediate', (tx) => {
    const before = (tx.get("SELECT count(*) c FROM leases WHERE status='active' AND expires_at <= ?", tx.now()) as { c: number }).c;
    tx.run("UPDATE leases SET status='expired' WHERE status='active' AND expires_at <= ?", tx.now());
    return { expired: before };
  });
}

export interface ListArgs { agent?: string; session?: string; mine?: boolean; }
export function list(ctx: Ctx, a: ListArgs): Page<LeaseView> {
  if (a.mine && !a.agent) throw new ApmError('E_VALIDATION', '--mine requires --agent');
  return ctx.storage.transaction('deferred', (tx) => {
    const where = ["status='active'"]; const params: unknown[] = [];
    if (a.agent) { where.push('agent_id=?'); params.push(a.agent); }
    if (a.session) { where.push('session_id=?'); params.push(a.session); }
    const rows = tx.all(`SELECT * FROM leases WHERE ${where.join(' AND ')} ORDER BY id`, ...params) as any[];
    return { items: rows.map(toLeaseView), page: { total: rows.length, limit: rows.length, offset: 0, has_more: false } };
  });
}
