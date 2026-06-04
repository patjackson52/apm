import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StepPopover } from './StepPopover';
import type { StepOverlay } from '@/lib/workflow/runOverlay';

const overlay: StepOverlay = {
  status: 'failed',
  reviewers: [{ role: 'security', verdict: 'reject', round: 1 }],
  failureReason: '<script>alert(1)</script>',
  artifactId: 'ART-9',
  startedAt: '2026-01-01',
  completedAt: null,
};

describe('StepPopover', () => {
  it('is an ARIA dialog showing plain-text fields (failure_reason not executed)', () => {
    const { container } = render(<StepPopover step={{ id: 'impl', type: 'agent_execution' }} overlay={overlay} onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('failed')).toBeTruthy();
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy(); // literal text, not a node
    expect(container.querySelector('script')).toBeNull();
  });

  it('links to the artifact via an opaque same-origin path', () => {
    render(<StepPopover step={{ id: 'impl', type: 'agent_execution' }} overlay={overlay} onClose={() => {}} />);
    const link = screen.getByRole('link', { name: 'ART-9' });
    expect(link.getAttribute('href')).toBe('/artifacts/ART-9');
  });

  it('fires onClose on Escape', () => {
    const onClose = vi.fn();
    render(<StepPopover step={{ id: 'x', type: 'manual' }} overlay={overlay} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
