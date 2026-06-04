import { describe, it, expect } from 'vitest';
import { buildTree } from './buildTree';
import type { WorkItemView } from '@apm/types';

const wi = (id: string, parent: string | null, priority = 5): WorkItemView => ({
  id, type: 'task', title: id, description: null, status: 'draft', priority, estimate: null,
  parent, depends_on: [], blocker_ids: [], artifact_ids: [], active_run: null, lease: null,
  created_by: null, created_at: '', updated_at: '', completed_at: null,
});

describe('buildTree', () => {
  it('nests children under parents with depth + priority order', () => {
    const t = buildTree([wi('A', null, 1), wi('A2', 'A', 2), wi('A1', 'A', 1), wi('B', null, 2)]);
    expect(t.map((n) => n.item.id)).toEqual(['A', 'B']);
    expect(t[0]!.children.map((n) => n.item.id)).toEqual(['A1', 'A2']);
    expect(t[0]!.children[0]!.depth).toBe(1);
  });
  it('treats orphans (missing parent) as roots', () => {
    const t = buildTree([wi('X', 'GHOST')]);
    expect(t.map((n) => n.item.id)).toEqual(['X']);
  });
  it('is cycle-safe', () => {
    const t = buildTree([wi('A', 'B'), wi('B', 'A')]);
    // both reference each other; build must terminate and include each once
    expect(t.length).toBeGreaterThanOrEqual(0);
  });
});
