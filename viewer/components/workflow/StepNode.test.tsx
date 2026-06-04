import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}));

import { StepNode, type StepFlowNode } from './StepNode';
import type { NodeProps } from '@xyflow/react';

function renderNode(data: Partial<StepFlowNode['data']> & { id: string; type: string }) {
  const props = { data } as unknown as NodeProps<StepFlowNode>;
  return render(<StepNode {...props} />);
}

describe('StepNode (WI-32 base)', () => {
  it('renders label + id for known and previously-missing types', () => {
    renderNode({ id: 's1', type: 'integration_loop' });
    expect(screen.getByText('Integration Loop')).toBeTruthy();
    expect(screen.getByText('s1')).toBeTruthy();
  });
  it('unknown type uses the neutral fallback', () => {
    renderNode({ id: 's1', type: 'weird' });
    expect(screen.getByText('Step')).toBeTruthy();
  });
  it('fires onSelect on Enter', () => {
    const onSelect = vi.fn();
    renderNode({ id: 's1', type: 'manual', onSelect });
    fireEvent.keyDown(screen.getByRole('group'), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
  it('renders identically (no overlay classes) when no overlay data', () => {
    const { container } = renderNode({ id: 's1', type: 'manual' });
    expect(container.querySelector('[class*="rs_"]')).toBeNull();
    expect(container.querySelector('[class*="current"]')).toBeNull();
    expect(container.querySelector('[class*="reviewers"]')).toBeNull();
  });
});

describe('StepNode (WI-33 overlay)', () => {
  it('applies a status tint and current ring', () => {
    const { container } = renderNode({ id: 's1', type: 'agent_execution', status: 'failed', isCurrent: true });
    expect(container.querySelector('[class*="rs_failed"]')).not.toBeNull();
    expect(container.querySelector('[class*="current"]')).not.toBeNull();
  });
  it('renders reviewer badges incl. a distinct null-verdict (pending) badge', () => {
    renderNode({
      id: 'dr', type: 'review_gate',
      reviewers: [{ role: 'security', verdict: 'reject', round: 1 }, { role: 'arch', verdict: null, round: 1 }],
    });
    expect(screen.getByLabelText('security: reject')).toBeTruthy();
    expect(screen.getByLabelText('arch: pending')).toBeTruthy();
  });
});
