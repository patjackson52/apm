import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}));

import { StepNode, type StepFlowNode } from './StepNode';
import type { NodeProps } from '@xyflow/react';

function renderNode(type: string, onSelect?: () => void) {
  const props = { data: { id: 's1', type, onSelect } } as unknown as NodeProps<StepFlowNode>;
  return render(<StepNode {...props} />);
}

describe('StepNode', () => {
  it('renders label + id for known and previously-missing types', () => {
    renderNode('integration_loop');
    expect(screen.getByText('Integration Loop')).toBeTruthy();
    expect(screen.getByText('s1')).toBeTruthy();
  });

  it('renders an unknown type via the neutral fallback (no crash)', () => {
    renderNode('weird_future_type');
    expect(screen.getByText('Step')).toBeTruthy();
  });

  it('fires onSelect on Enter (read-only keyboard select)', () => {
    const onSelect = vi.fn();
    renderNode('manual', onSelect);
    fireEvent.keyDown(screen.getByRole('group'), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
