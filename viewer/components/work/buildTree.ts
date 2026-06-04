import type { WorkItemView } from '@apm/types';

export interface TreeNode { item: WorkItemView; children: TreeNode[]; depth: number }

/**
 * Build a work-item tree from a flat list, grouping by `parent`. Roots = items
 * whose parent is null or not present in the set (orphans become roots).
 * Children are ordered by priority then id. Cycle-safe (a visited set prevents
 * an item that is its own ancestor from looping).
 */
export function buildTree(items: WorkItemView[]): TreeNode[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const childrenOf = new Map<string | null, WorkItemView[]>();
  for (const i of items) {
    const key = i.parent && byId.has(i.parent) ? i.parent : null;
    const list = childrenOf.get(key) ?? [];
    list.push(i);
    childrenOf.set(key, list);
  }
  const sortKey = (a: WorkItemView, b: WorkItemView) =>
    a.priority - b.priority || a.id.localeCompare(b.id);

  const build = (parentId: string | null, depth: number, seen: Set<string>): TreeNode[] => {
    const kids = (childrenOf.get(parentId) ?? []).slice().sort(sortKey);
    const out: TreeNode[] = [];
    for (const item of kids) {
      if (seen.has(item.id)) continue; // cycle guard
      const next = new Set(seen).add(item.id);
      out.push({ item, children: build(item.id, depth + 1, next), depth });
    }
    return out;
  };
  return build(null, 0, new Set());
}
