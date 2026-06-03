import { describe, it, expect } from 'vitest';
import { groupByRoot } from './versions';
import type { ArtifactView } from '@apm/types';

const mk = (id: string, root: string, version: number): ArtifactView => ({
  id, type: 'spec', title: 't', version, status: 'draft', root,
  supersedes: null, created_by: 'a', created_at: '2026-01-01', body: null, work_item: 'WI-1',
});

describe('groupByRoot', () => {
  it('groups by root and sorts versions desc', () => {
    const m = groupByRoot([mk('A1', 'A', 1), mk('A2', 'A', 2), mk('B1', 'B', 1)]);
    expect(m.get('A')!.map((a) => a.id)).toEqual(['A2', 'A1']);
    expect(m.get('B')!.map((a) => a.id)).toEqual(['B1']);
  });
});
