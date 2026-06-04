import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes }: { nodes: { id: string }[] }) => (
    <div data-testid="rf">
      {nodes.map((n) => (
        <div key={n.id} data-testid="rfnode">{n.id}</div>
      ))}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}));

import { WorkflowGraph } from './WorkflowGraph';

const steps = [
  { id: 'brainstorm', type: 'agent_prompt' },
  { id: 'design', type: 'agent_prompt' },
  { id: 'design_review', type: 'review_gate' },
  { id: 'impl', type: 'agent_execution' },
  { id: 'loop', type: 'integration_loop' },
  { id: 'man', type: 'manual' },
  { id: 'complete', type: 'terminal' },
];
const edges = [
  { from: 'brainstorm', to: 'design' },
  { from: 'design', to: 'design_review' },
  { from: 'design_review', to: 'impl' },
  { from: 'impl', to: 'loop' },
  { from: 'loop', to: 'man' },
  { from: 'man', to: 'complete' },
];

describe('WorkflowGraph', () => {
  it('renders one node per step incl integration_loop/manual (no crash)', () => {
    render(<WorkflowGraph steps={steps} edges={edges} />);
    expect(screen.getAllByTestId('rfnode')).toHaveLength(7);
  });
  it('renders a legend covering all step types', () => {
    render(<WorkflowGraph steps={steps} edges={edges} />);
    expect(screen.getByText('Integration Loop')).toBeTruthy();
    expect(screen.getByText('Manual')).toBeTruthy();
    expect(screen.getByText('Terminal')).toBeTruthy();
  });
});
