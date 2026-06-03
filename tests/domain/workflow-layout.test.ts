import { describe, it, expect } from 'vitest';
import { titleCase, layoutSteps, edgesOf } from '../../src/domain/workflow.js';
import { FEATURE_DELIVERY } from '../../src/workflows/feature_delivery.js';

describe('workflow layout helpers (pure)', () => {
  it('titleCase sentence-cases a step id', () => {
    expect(titleCase('design_review')).toBe('Design review');
    expect(titleCase('brainstorm')).toBe('Brainstorm');
    expect(titleCase('pr_create')).toBe('Pr create');
  });

  it('layoutSteps lays the linear chain into one lane with x/y/label', () => {
    const steps = layoutSteps(FEATURE_DELIVERY);
    expect(steps).toHaveLength(9);
    expect(steps[0]).toMatchObject({ id: 'brainstorm', x: 0, y: 0, label: 'Brainstorm' });
    expect(steps[1]).toMatchObject({ id: 'design', x: 220, y: 0 });
    // every step has numeric layout + a label; original StepDef fields preserved
    for (const s of steps) {
      expect(typeof s.x).toBe('number');
      expect(s.y).toBe(0);
      expect(typeof s.label).toBe('string');
      expect(s.type).toBeTruthy();
    }
    // ordered along next[0]
    expect(steps.map((s) => s.id)).toEqual([
      'brainstorm', 'design', 'design_review', 'planning', 'implementation',
      'pr_create', 'pr_monitor', 'merge', 'complete',
    ]);
    // review_gate keeps its reviewers
    const review = steps.find((s) => s.id === 'design_review')!;
    expect(review.reviewers).toEqual(['architecture', 'security', 'simplicity']);
  });

  it('edgesOf derives directed edges from next[]', () => {
    const edges = edgesOf(FEATURE_DELIVERY);
    expect(edges).toContainEqual({ from: 'brainstorm', to: 'design' });
    expect(edges).toContainEqual({ from: 'merge', to: 'complete' });
    // terminal step has no outgoing edge
    expect(edges.find((e) => e.from === 'complete')).toBeUndefined();
  });

  it('layoutSteps is deterministic', () => {
    expect(layoutSteps(FEATURE_DELIVERY)).toEqual(layoutSteps(FEATURE_DELIVERY));
  });
});
