import type { Tx } from './storage.js';
import type { WorkItemType, Estimate } from '../domain/types.js';

export interface NewWorkItem {
  type: WorkItemType; title: string; description: string | null;
  priority: number; estimate: Estimate | null; parentId: string | null; createdBy: string | null;
}

export function repos(tx: Tx) {
  const now = tx.now();
  return {
    agents: {
      /** Ensure an agent row exists (id == name in V1). Idempotent. Returns the id. */
      ensure(name: string): string {
        const existing = tx.get<{ id: string }>('SELECT id FROM agents WHERE id=?', name);
        if (!existing) {
          tx.run('INSERT INTO agents (id, name, type, created_at) VALUES (?, ?, ?, ?)', name, name, name.startsWith('human:') ? 'human' : 'agent', now);
        }
        return name;
      },
    },
    workItems: {
      insert(w: NewWorkItem): string {
        const id = tx.allocateId('WI');
        tx.run(
          `INSERT INTO work_items (id, type, title, description, status, priority, estimate, parent_id, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
          id, w.type, w.title, w.description, w.priority, w.estimate, w.parentId, w.createdBy, now, now,
        );
        tx.appendEvent({ actorId: w.createdBy, eventType: 'work_item.created', entityType: 'work_item', entityId: id, payload: { type: w.type, title: w.title } });
        return id;
      },
      byId(id: string): any | undefined { return tx.get('SELECT * FROM work_items WHERE id=?', id); },
      children(id: string): any[] { return tx.all('SELECT * FROM work_items WHERE parent_id=? ORDER BY id', id); },
      setStatus(id: string, status: string, actor: string | null, completedAt?: string | null) {
        tx.run('UPDATE work_items SET status=?, updated_at=?, completed_at=COALESCE(?, completed_at) WHERE id=?', status, now, completedAt ?? null, id);
        tx.appendEvent({ actorId: actor, eventType: 'work_item.status', entityType: 'work_item', entityId: id, payload: { status } });
      },
      update(id: string, fields: Record<string, unknown>, actor: string | null) {
        const cols = Object.keys(fields);
        if (cols.length === 0) return;
        tx.run(`UPDATE work_items SET ${cols.map((c) => `${c}=?`).join(', ')}, updated_at=? WHERE id=?`, ...cols.map((c) => fields[c]), now, id);
        tx.appendEvent({ actorId: actor, eventType: 'work_item.updated', entityType: 'work_item', entityId: id, payload: fields });
      },
    },
    links: {
      add(source: string, target: string, linkType: string) {
        const id = `${source}_${target}_${linkType}`;
        tx.run('INSERT OR IGNORE INTO work_item_links (id, source_work_item_id, target_work_item_id, link_type, created_at) VALUES (?, ?, ?, ?, ?)',
          id, source, target, linkType, now);
      },
      dependsOn(source: string): string[] {
        return tx.all<{ target_work_item_id: string }>(
          "SELECT target_work_item_id FROM work_item_links WHERE source_work_item_id=? AND link_type='depends_on' ORDER BY target_work_item_id", source,
        ).map((r) => r.target_work_item_id);
      },
    },
  };
}
