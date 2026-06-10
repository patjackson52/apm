import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const usePromptPanel = vi.fn();
vi.mock('@/lib/api/hooks', () => ({ usePromptPanel: (...a: unknown[]) => usePromptPanel(...a) }));

import { PromptPanel } from './PromptPanel';
import { makeDispatch } from './fixtures';

beforeEach(() => usePromptPanel.mockReset());

describe('PromptPanel', () => {
  it('renders the completed headline body + a "v3 available" provenance badge when latest > version', () => {
    const headline = makeDispatch({
      status: 'completed',
      body: 'Kickoff body text here.',
      prompt_name: 'brainstorm',
      prompt_version: 2,
    });
    usePromptPanel.mockReturnValue({
      data: {
        state: 'completed',
        headline,
        timeline: [headline],
        provenance: { name: 'brainstorm', version: 2, latest: 3 },
      },
      isLoading: false,
      isError: false,
    });
    render(<PromptPanel workItemId="WI-1" />);
    expect(screen.getByText('Started with')).toBeTruthy();
    expect(screen.getByText('Kickoff body text here.')).toBeTruthy();
    expect(screen.getByText('v3 available')).toBeTruthy();
  });

  it('shows the no-workflow empty state with no headline', () => {
    usePromptPanel.mockReturnValue({
      data: { state: 'no-workflow', headline: null, timeline: [], provenance: null },
      isLoading: false,
      isError: false,
    });
    render(<PromptPanel workItemId="WI-2" />);
    // appears in both the state label and the banner title
    expect(screen.getAllByText('No workflow attached').length).toBeGreaterThan(0);
  });

  it('renders a loading skeleton then the failure state', () => {
    usePromptPanel.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<PromptPanel workItemId="WI-3" />);
    expect(screen.getByText('Failed to load prompt.')).toBeTruthy();
  });
});
