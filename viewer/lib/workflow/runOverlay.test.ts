import { describe, it, expect } from 'vitest';
import { buildOverlay } from './runOverlay';
import type { StepRunView } from '@apm/types';

const sr = (o: Partial<StepRunView> & { id: string; step_id: string }): StepRunView => ({
  run_id: 'WR-1', parent_step_run_id: null, role: null, status: 'completed',
  verdict: null, review_round: 1, started_at: '2026-01-01', completed_at: null,
  output_artifact_id: null, failure_reason: null, dispatch_prompt: null, ...o,
});

describe('buildOverlay', () => {
  it('collects review_gate reviewer fan-in and preserves a null verdict', () => {
    const m = buildOverlay([
      sr({ id: 'sr1', step_id: 'design_review', status: 'running', started_at: null }),
      sr({ id: 'sr2', step_id: 'design_review', parent_step_run_id: 'sr1', role: 'security', verdict: 'reject' }),
      sr({ id: 'sr3', step_id: 'design_review', parent_step_run_id: 'sr1', role: 'arch', verdict: null, status: 'running' }),
    ]);
    const o = m.get('design_review')!;
    expect(o.status).toBe('running');
    expect(o.reviewers).toEqual([
      { role: 'security', verdict: 'reject', round: 1 },
      { role: 'arch', verdict: null, round: 1 },
    ]);
  });

  it('picks the latest main by round then started_at (null sorts last)', () => {
    const m = buildOverlay([
      sr({ id: 'a', step_id: 'design', review_round: 1, status: 'failed' }),
      sr({ id: 'b', step_id: 'design', review_round: 2, status: 'completed' }),
    ]);
    expect(m.get('design')!.status).toBe('completed');
    expect(m.get('design')!.stepRunId).toBe('b');
  });

  it('carries failureReason and artifactId from the main', () => {
    const m = buildOverlay([sr({ id: 'x', step_id: 'impl', status: 'failed', failure_reason: 'boom', output_artifact_id: 'ART-9' })]);
    expect(m.get('impl')).toMatchObject({ failureReason: 'boom', artifactId: 'ART-9' });
  });

  it('carries the dispatch prompt from the main step run', () => {
    const m = buildOverlay([sr({ id: 'x', step_id: 'brainstorm', dispatch_prompt: 'WORK_ITEM:\nWI-1' })]);
    expect(m.get('brainstorm')!.dispatchPrompt).toBe('WORK_ITEM:\nWI-1');
  });
});
