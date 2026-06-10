import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes }: { nodes: { id: string; data: { status?: string; isCurrent?: boolean; onSelect?: () => void } }[] }) => (
    <div>
      {nodes.map((n) => (
        <button key={n.id} data-testid="rfnode" data-status={n.data.status ?? ''} data-current={String(!!n.data.isCurrent)} onClick={() => n.data.onSelect?.()}>{n.id}</button>
      ))}
    </div>
  ),
  Background: () => null, Controls: () => null, Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}));

const useWorkflow = vi.fn();
const useRuns = vi.fn();
const useRunSteps = vi.fn();
vi.mock('@/lib/api/hooks', () => ({
  useWorkflow: (...a: unknown[]) => useWorkflow(...a),
  useRuns: (...a: unknown[]) => useRuns(...a),
  useRunSteps: (...a: unknown[]) => useRunSteps(...a),
  usePromptPanel: () => ({ data: { state: 'no-workflow', headline: null, timeline: [], provenance: null }, isLoading: false, isError: false }),
}));
const inertMutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false, error: null, data: undefined };
vi.mock('@/lib/api/mutations', () => ({
  useRunNext: () => inertMutation,
  useStepAction: () => inertMutation,
}));

import { RunGraph } from './RunGraph';

beforeEach(() => {
  useWorkflow.mockReturnValue({
    data: { id: 'WD-1', name: 'Feature Delivery', version: 1, status: 'active', applies_to: ['feature'],
      steps: [{ id: 'design', type: 'agent_prompt' }, { id: 'design_review', type: 'review_gate' }],
      edges: [{ from: 'design', to: 'design_review' }] },
    isLoading: false, isError: false,
  });
  useRuns.mockReturnValue({
    data: [
      { id: 'WR-1', work_item: 'WI-1', workflow: 'feature_delivery', status: 'running', current_step: 'design_review', started_at: '2026-01-01', completed_at: null },
      { id: 'WR-0', work_item: 'WI-1', workflow: 'feature_delivery', status: 'completed', current_step: null, started_at: '2025-12-01', completed_at: '2025-12-02' },
    ],
    isLoading: false, isError: false,
  });
  useRunSteps.mockReturnValue({
    data: [
      { id: 'sr1', run_id: 'WR-1', step_id: 'design_review', parent_step_run_id: null, role: null, status: 'running', verdict: null, review_round: 1, started_at: '2026-01-02', completed_at: null, output_artifact_id: null, failure_reason: null },
      { id: 'sr2', run_id: 'WR-1', step_id: 'design_review', parent_step_run_id: 'sr1', role: 'security', status: 'completed', verdict: 'reject', review_round: 1, started_at: '2026-01-02', completed_at: null, output_artifact_id: null, failure_reason: null },
    ],
    isLoading: false, isError: false,
  });
});

describe('RunGraph', () => {
  it('selects the latest run and flags its current step', () => {
    render(<RunGraph workflowId="WD-1" workItemId="WI-1" />);
    const current = screen.getByText('design_review').closest('button')!;
    expect(current.getAttribute('data-current')).toBe('true'); // WR-1 is latest by started_at
    expect(current.getAttribute('data-status')).toBe('running');
  });

  it('opens the step popover on node select', () => {
    render(<RunGraph workflowId="WD-1" workItemId="WI-1" />);
    fireEvent.click(screen.getByText('design_review'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('security: reject (round 1)')).toBeTruthy();
  });
});
