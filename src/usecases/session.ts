import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { toSessionView, type SessionView } from '../domain/entities.js';

function liveSession(tx: any, agent: string): any | undefined {
  return tx.get("SELECT * FROM sessions WHERE agent_id=? AND status IN ('active','idle')", agent);
}

export function start(ctx: Ctx, agent: string): SessionView {
  return ctx.storage.transaction('immediate', (tx) => {
    repos(tx).agents.ensure(agent);
    const existing = liveSession(tx, agent);
    if (existing) return toSessionView(existing);
    const id = tx.allocateId('S');
    tx.run("INSERT INTO sessions (id, agent_id, status, started_at, last_seen_at) VALUES (?, ?, 'active', ?, ?)", id, agent, tx.now(), tx.now());
    tx.appendEvent({ actorId: agent, eventType: 'session.started', entityType: 'session', entityId: id });
    return toSessionView(tx.get('SELECT * FROM sessions WHERE id=?', id));
  });
}

export function resolveCurrent(ctx: Ctx, agent: string): string {
  return start(ctx, agent).id; // start returns existing live session if any
}

export function show(ctx: Ctx, id: string): SessionView {
  return ctx.storage.transaction('deferred', (tx) => {
    const row = tx.get('SELECT * FROM sessions WHERE id=?', id);
    if (!row) throw new ApmError('E_NOT_FOUND', `${id} not found`);
    return toSessionView(row);
  });
}

export function summarize(ctx: Ctx, id: string, body: string): SessionView {
  return ctx.storage.transaction('immediate', (tx) => {
    const row = tx.get('SELECT * FROM sessions WHERE id=?', id);
    if (!row) throw new ApmError('E_NOT_FOUND', `${id} not found`);
    tx.run('UPDATE sessions SET context_summary=?, last_seen_at=? WHERE id=?', body, tx.now(), id);
    tx.appendEvent({ actorId: (row as any).agent_id, eventType: 'session.summarized', entityType: 'session', entityId: id });
    return toSessionView(tx.get('SELECT * FROM sessions WHERE id=?', id));
  });
}

export function end(ctx: Ctx, id: string): SessionView {
  return ctx.storage.transaction('immediate', (tx) => {
    const row = tx.get('SELECT * FROM sessions WHERE id=?', id);
    if (!row) throw new ApmError('E_NOT_FOUND', `${id} not found`);
    tx.run("UPDATE sessions SET status='ended', ended_at=? WHERE id=?", tx.now(), id);
    tx.appendEvent({ actorId: (row as any).agent_id, eventType: 'session.ended', entityType: 'session', entityId: id });
    return toSessionView(tx.get('SELECT * FROM sessions WHERE id=?', id));
  });
}

/** List all sessions (newest agent panel). */
export function list(ctx: Ctx): SessionView[] {
  return ctx.storage.transaction('deferred', (tx) =>
    (tx.all('SELECT * FROM sessions ORDER BY id') as any[]).map(toSessionView));
}
