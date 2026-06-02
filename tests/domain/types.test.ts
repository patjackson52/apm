import { describe, it, expect } from 'vitest';
import {
  WORK_ITEM_STATUSES,
  WORK_ITEM_TYPES,
  ARTIFACT_STATUSES,
  ESTIMATES,
  STEP_TYPES,
} from '../../src/domain/types.js';

describe('enums', () => {
  it('work item statuses exclude the computed `active`', () => {
    expect(WORK_ITEM_STATUSES).toEqual(['draft', 'ready', 'blocked', 'completed', 'cancelled']);
    expect(WORK_ITEM_STATUSES).not.toContain('active');
  });

  it('covers all spec work item types', () => {
    expect(WORK_ITEM_TYPES).toContain('feature');
    expect(WORK_ITEM_TYPES).toContain('human_gate');
    expect(WORK_ITEM_TYPES).toHaveLength(10);
  });

  it('artifact statuses follow the spec lifecycle', () => {
    expect(ARTIFACT_STATUSES).toEqual(['draft', 'review', 'approved', 'superseded', 'archived']);
  });

  it('estimates are the t-shirt scale', () => {
    expect(ESTIMATES).toEqual(['XS', 'S', 'M', 'L', 'XL']);
  });

  it('lists every workflow step type', () => {
    expect(STEP_TYPES).toEqual([
      'agent_prompt', 'agent_execution', 'review_gate', 'human_gate',
      'decision', 'decompose', 'integration', 'integration_loop', 'manual', 'terminal',
    ]);
  });
});
