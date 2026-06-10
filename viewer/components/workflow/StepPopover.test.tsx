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

describe('StepPopover structured dispatch', () => {
  it('renders the layered ComposedPrompt + Open prompt link when a dispatch is provided', () => {
    const dispatch = {
      step_id: 'brainstorm', step_type: 'agent_prompt', status: 'completed',
      prompt_name: 'brainstorm_feature_v1', prompt_version: 2, latest_version: 2,
      body: 'Explore approaches', scaffold: { allowed_action: 'Produce a decision', required_context: [], do_not: ['write code'], when_done: ['apm step complete'] },
      raw: 'WORK_ITEM:\nWI-1', at: '2026-06-01',
    };
    render(<StepPopover step={{ id: 'brainstorm', type: 'agent_prompt' }} overlay={overlay} dispatch={dispatch as never} onClose={() => {}} />);
    expect(screen.getByText('Explore approaches')).toBeTruthy();
    expect(screen.getByText('Dispatched prompt')).toBeTruthy();
    expect(screen.getByRole('link', { name: /open prompt/i }).getAttribute('href')).toBe('/prompts/brainstorm_feature_v1');
  });
});

describe('StepPopover', () => {
  // Radix portals the dialog Content to document.body, so query `document`/`screen`
  // (not the render `container`) to see the portaled markup.
  it('is an ARIA dialog showing plain-text fields (failure_reason not executed)', () => {
    render(<StepPopover step={{ id: 'impl', type: 'agent_execution' }} overlay={overlay} onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('failed')).toBeTruthy();
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy(); // literal text, not a node
    expect(document.querySelector('dialog script, [role="dialog"] script')).toBeNull();
  });

  it('renders the dispatch prompt as plain text (no markdown/HTML sink)', () => {
    const withPrompt: StepOverlay = {
      status: 'running', reviewers: [], startedAt: '2026-01-01', completedAt: null,
      dispatchPrompt: 'WORK_ITEM:\nWI-1\n\nALLOWED_ACTION:\n<script>alert(2)</script>',
    };
    render(<StepPopover step={{ id: 'brainstorm', type: 'agent_prompt' }} overlay={withPrompt} onClose={() => {}} />);
    expect(screen.getByText(/WORK_ITEM:/)).toBeTruthy();
    expect(document.querySelector('[role="dialog"] script')).toBeNull();
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toContain('<script>alert(2)</script>');
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

  it('fires onClose on Escape (Radix dismiss)', () => {
    const onClose = vi.fn();
    render(<StepPopover step={{ id: 'x', type: 'manual' }} overlay={overlay} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fires onClose when the Close button is pressed', () => {
    const onClose = vi.fn();
    render(<StepPopover step={{ id: 'x', type: 'manual' }} overlay={overlay} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exposes an accessible name via the Radix dialog title (the step id)', () => {
    render(<StepPopover step={{ id: 'design', type: 'agent_prompt' }} overlay={overlay} onClose={() => {}} />);
    // Radix wires aria-labelledby from <Dialog.Title> → the dialog is named "design".
    expect(screen.getByRole('dialog', { name: /design/ })).toBeTruthy();
  });
});

// Focus trap, focus restore, and Tab cycling are now provided by Radix Dialog
// (FocusScope + DismissableLayer) rather than hand-rolled, so they're no longer
// unit-tested here — Radix owns and tests that behavior.
