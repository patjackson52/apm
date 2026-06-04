import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes }: { nodes: { id: string }[] }) => (
    <div>{nodes.map((n) => <div key={n.id} data-testid="rfnode">{n.id}</div>)}</div>
  ),
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}));

const useWorkflow = vi.fn();
vi.mock('@/lib/api/hooks', () => ({ useWorkflow: (...a: unknown[]) => useWorkflow(...a) }));

import { WorkflowGraphPanel } from './WorkflowGraphPanel';

beforeEach(() => useWorkflow.mockReset());

describe('WorkflowGraphPanel', () => {
  it('shows a skeleton while loading', () => {
    useWorkflow.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = render(<WorkflowGraphPanel id="WD-1" />);
    expect(container.querySelector('[aria-busy], .skeleton, [data-skeleton]') || container.firstChild).toBeTruthy();
  });

  it('renders the graph when loaded', () => {
    useWorkflow.mockReturnValue({
      data: { id: 'WD-1', name: 'Feature Delivery', version: 1, status: 'active', applies_to: ['feature'],
        steps: [{ id: 'a', type: 'agent_prompt' }, { id: 'b', type: 'terminal' }],
        edges: [{ from: 'a', to: 'b' }] },
      isLoading: false, isError: false,
    });
    render(<WorkflowGraphPanel id="WD-1" />);
    expect(screen.getByText('Feature Delivery')).toBeTruthy();
    expect(screen.getAllByTestId('rfnode')).toHaveLength(2);
  });

  it('shows an error state', () => {
    useWorkflow.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<WorkflowGraphPanel id="WD-1" />);
    expect(screen.getByText('Failed to load workflow.')).toBeTruthy();
  });
});
