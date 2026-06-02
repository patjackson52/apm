import { describe, it, expect } from 'vitest';
import { buildContract } from '../../src/domain/contract.js';
import type { StepDef } from '../../src/domain/workflow.js';

const ctxIds = { workItem: 'WI-1', run: 'WR-1', session: 'S-1' };

describe('buildContract', () => {
  it('agent_prompt with outputs → create-artifact action + resolved when_done', () => {
    const step: StepDef = { id: 'design', type: 'agent_prompt', outputs: [{ artifact_type: 'design' }], next: ['x'] };
    const c = buildContract(step, [{ id: 'ART-1', version: 2, type: 'spec', title: 'Spec', one_line: 'Spec' }], ctxIds);
    expect(c.allowed_action).toMatch(/design/i);
    expect(c.when_done[0]).toContain('apm step complete WR-1 design');
    expect(c.when_done[0]).toContain('--artifact-type design');
    expect(c.next_actions[0].cmd).toBe('apm step complete');
  });

  it('review_gate → review action listing reviewers', () => {
    const step: StepDef = { id: 'design_review', type: 'review_gate', reviewers: ['architecture', 'security'], next: ['x'] };
    const c = buildContract(step, [], ctxIds);
    expect(c.allowed_action).toMatch(/review/i);
    expect(c.when_done.join(' ')).toMatch(/apm step review WR-1 design_review --reviewer architecture/);
  });

  it('integration → manual stub action', () => {
    const step: StepDef = { id: 'pr_create', type: 'integration', action: 'github_create_pr', next: ['x'] };
    const c = buildContract(step, [], ctxIds);
    expect(c.allowed_action).toMatch(/manual|github_create_pr/i);
    expect(c.when_done[0]).toContain('apm step complete WR-1 pr_create');
  });

  it('multi-output agent_prompt lists extra creates before the complete', () => {
    const step = { id: 'brainstorm', type: 'agent_prompt', outputs: [{ artifact_type: 'decision' }, { artifact_type: 'spec' }], next: ['x'] } as any;
    const c = buildContract(step, [], { workItem: 'WI-1', run: 'WR-1', session: 'S-1' });
    expect(c.when_done.at(-1)).toContain('apm step complete WR-1 brainstorm');
    expect(c.when_done.at(-1)).toContain('--artifact-type decision');
    expect(c.when_done.some((l: string) => l.includes('apm artifact create') && l.includes('--type spec'))).toBe(true);
  });

  it('caps do_not at 3 entries', () => {
    const step: StepDef = { id: 'design', type: 'agent_prompt', outputs: [{ artifact_type: 'design' }], next: ['x'] };
    const c = buildContract(step, [], ctxIds);
    expect(c.do_not.length).toBeLessThanOrEqual(3);
  });
});
