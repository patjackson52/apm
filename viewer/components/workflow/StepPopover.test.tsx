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

  it('renders the dispatch prompt as plain text (no markdown/HTML sink)', () => {
    const withPrompt: StepOverlay = {
      status: 'running', reviewers: [], startedAt: '2026-01-01', completedAt: null,
      dispatchPrompt: 'WORK_ITEM:\nWI-1\n\nALLOWED_ACTION:\n<script>alert(2)</script>',
    };
    const { container } = render(<StepPopover step={{ id: 'brainstorm', type: 'agent_prompt' }} overlay={withPrompt} onClose={() => {}} />);
    expect(screen.getByText(/WORK_ITEM:/)).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toContain('<script>alert(2)</script>');
  });

  it('omits the dispatch-prompt section when none was built', () => {
    render(<StepPopover step={{ id: 'impl', type: 'agent_execution' }} overlay={overlay} onClose={() => {}} />);
    expect(screen.queryByText('Dispatch prompt')).toBeNull();
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

  it('restores focus to the activating trigger on unmount', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    const { unmount } = render(
      <StepPopover step={{ id: 's1', type: 'manual' }} overlay={overlay} onClose={() => {}} />,
    );
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('traps Tab from the last focusable back to the first', () => {
    render(<StepPopover step={{ id: 's1', type: 'manual' }} overlay={overlay} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])',
    );
    expect(focusables.length).toBeGreaterThan(0);
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('traps Shift+Tab from the first focusable to the last', () => {
    render(<StepPopover step={{ id: 's1', type: 'manual' }} overlay={overlay} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])',
    );
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
