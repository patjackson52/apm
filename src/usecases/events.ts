import type { Ctx } from '../cli/run.js';
import { toEventView, type EventView, type Page } from '../domain/entities.js';

export interface EventsFilter { entityType?: string; entityId?: string; limit?: number; offset?: number; }

/** Read the audit/activity feed, newest-first, optionally scoped to an entity. */
export function list(ctx: Ctx, f: EventsFilter = {}): Page<EventView> {
  const limit = f.limit ?? 50;
  const offset = f.offset ?? 0;
  return ctx.storage.transaction('deferred', (tx) => {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.entityType) { where.push('entity_type=?'); params.push(f.entityType); }
    if (f.entityId) { where.push('entity_id=?'); params.push(f.entityId); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (tx.get(`SELECT count(*) c FROM events ${clause}`, ...params) as { c: number }).c;
    const rows = tx.all(`SELECT * FROM events ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, ...params, limit, offset) as any[];
    return {
      items: rows.map(toEventView),
      page: { total, limit, offset, has_more: offset + rows.length < total },
    };
  });
}
