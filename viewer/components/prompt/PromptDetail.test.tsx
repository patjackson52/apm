import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PromptDetailView } from '@apm/types';

const usePrompt = vi.fn();
const usePromptUsage = vi.fn();
vi.mock('@/lib/api/hooks', () => ({
  usePrompt: (...a: unknown[]) => usePrompt(...a),
  usePromptUsage: (...a: unknown[]) => usePromptUsage(...a),
}));

import { PromptDetail } from './PromptDetail';

const detail = (): PromptDetailView => ({
  name: 'implementation',
  latest_version: 3,
  version_count: 3,
  builtin: true,
  summary: 'Implement the feature',
  updated_at: '2026-06-01',
  where_defs: 2,
  where_runs: 120,
  versions: [
    { version: 1, body: 'the quick fox', created_at: '2026-05-01' },
    { version: 2, body: 'the slow fox', created_at: '2026-05-15' },
    { version: 3, body: 'the slow brown fox', created_at: '2026-06-01' },
  ],
});

beforeEach(() => {
  usePrompt.mockReset();
  usePromptUsage.mockReset();
});

describe('PromptDetail', () => {
  it('shows version history, a summarized where-used line, and paginated info (not a raw list of all runs)', () => {
    usePrompt.mockReturnValue({ data: detail(), isLoading: false, isError: false });
    usePromptUsage.mockReturnValue({
      data: {
        items: [{ run: 'WR-1', work_item: 'WI-1', version: 3, status: 'completed', at: '2026-06-02' }],
        page: { total: 120, limit: 20, offset: 0, has_more: true },
      },
      isLoading: false,
      isError: false,
    });
    const { container } = render(<PromptDetail name="implementation" />);

    // version history present
    expect(screen.getByText('v1')).toBeTruthy();
    expect(screen.getByText('v3')).toBeTruthy();

    // summarized where-used line, not 120 rows
    expect(container.textContent).toContain('2 workflow defs');
    expect(container.textContent).toContain('120 dispatched runs');
    expect(container.querySelectorAll('.wu-row').length).toBe(1);

    // paginated info reflects the total
    expect(container.textContent).toContain('of 120');
  });

  it('word-diffs the two compared versions (del + add highlighted)', () => {
    usePrompt.mockReturnValue({ data: detail(), isLoading: false, isError: false });
    usePromptUsage.mockReturnValue({
      data: { items: [], page: { total: 0, limit: 20, offset: 0, has_more: false } },
      isLoading: false,
      isError: false,
    });
    const { container } = render(<PromptDetail name="implementation" />);
    expect(container.querySelector('.diff-add')).not.toBeNull();
    expect(container.querySelector('.diff-del')).not.toBeNull();
  });
});
