import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PromptSummaryView } from '@apm/types';

const usePrompts = vi.fn();
vi.mock('@/lib/api/hooks', () => ({ usePrompts: (...a: unknown[]) => usePrompts(...a) }));

import { PromptsList } from './PromptsList';

const row = (o: Partial<PromptSummaryView> = {}): PromptSummaryView => ({
  name: 'implementation',
  latest_version: 2,
  version_count: 2,
  builtin: true,
  summary: 'Implement the feature',
  updated_at: '2026-06-01',
  where_defs: 3,
  where_runs: 12,
  ...o,
});

beforeEach(() => usePrompts.mockReset());

describe('PromptsList', () => {
  it('lists a prompt with where-used counts and a row link to its detail page', () => {
    usePrompts.mockReturnValue({ data: [row()], isLoading: false, isError: false });
    const { container } = render(<PromptsList />);
    expect(screen.getByText('implementation')).toBeTruthy();
    expect(container.textContent).toContain('3 defs');
    expect(container.textContent).toContain('12 runs');
    const link = container.querySelector('a[href="/prompts/implementation"]');
    expect(link).not.toBeNull();
  });

  it('shows an empty state when there are no prompts', () => {
    usePrompts.mockReturnValue({ data: [], isLoading: false, isError: false });
    render(<PromptsList />);
    expect(screen.getByText('No prompts yet.')).toBeTruthy();
  });
});
