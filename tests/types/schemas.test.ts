import { describe, it, expect } from 'vitest';
import {
  envelopeSchema, pageSchema,
  WorkItemViewSchema, BlockerViewSchema, EnrichedBlockerViewSchema,
} from '@apm/types';
import { z } from 'zod';

describe('@apm/types schemas', () => {
  it('envelopeSchema validates the {ok,data,error,meta} shape', () => {
    const s = envelopeSchema(z.object({ x: z.number() }));
    expect(s.safeParse({ ok: true, data: { x: 1 }, error: null, meta: { api_version: 1, command: 'c', ts: 't' } }).success).toBe(true);
    expect(s.safeParse({ ok: true, data: { x: 1 }, error: null }).success).toBe(false); // missing meta
  });

  it('pageSchema validates { items, page }', () => {
    const s = pageSchema(z.string());
    expect(s.safeParse({ items: ['a'], page: { total: 1, limit: 10, offset: 0, has_more: false } }).success).toBe(true);
    expect(s.safeParse({ items: ['a'] }).success).toBe(false);
  });

  it('base vs enriched blocker are discriminated', () => {
    const base = {
      id: 'BLK-1', work_item: 'WI-1', type: 'review_disagreement', reason: 'x', status: 'open',
      question: null, options: [], resolution: null, answer: null, choice: null,
      answered_by: null, answered_at: null, resolved_at: null, created_at: 't',
    };
    expect(BlockerViewSchema.safeParse(base).success).toBe(true);
    // base (no current_step) FAILS enriched
    expect(EnrichedBlockerViewSchema.safeParse(base).success).toBe(false);
    // enriched passes
    expect(EnrichedBlockerViewSchema.safeParse({ ...base, current_step: 'design' }).success).toBe(true);
  });

  it('WorkItemView accepts the derived "active" status', () => {
    const base = {
      id: 'WI-1', type: 'feature', title: 'T', description: null, status: 'active',
      priority: 5, estimate: null, parent: null, depends_on: [], blocker_ids: [], artifact_ids: [],
      active_run: null, lease: 'LEASE-1', created_by: null, created_at: 't', updated_at: 't', completed_at: null,
    };
    expect(WorkItemViewSchema.safeParse(base).success).toBe(true);
    expect(WorkItemViewSchema.safeParse({ ...base, status: 'ready', lease: null }).success).toBe(true);
  });
});
