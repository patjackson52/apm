import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const replace = vi.fn();
let params = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace }),
  usePathname: () => '/work/WI-1',
}));

const useWorkArtifacts = vi.fn();
const useDecisions = vi.fn();
const useAdrs = vi.fn();
vi.mock('@/lib/api/hooks', () => ({
  useWorkArtifacts: (...a: unknown[]) => useWorkArtifacts(...a),
  useDecisions: (...a: unknown[]) => useDecisions(...a),
  useAdrs: (...a: unknown[]) => useAdrs(...a),
  // PromptPanel is now mounted above the tabs — stub its hook to a benign empty state.
  usePromptPanel: () => ({ data: { state: 'no-workflow', headline: null, timeline: [], provenance: null }, isLoading: false, isError: false }),
}));

import { WorkDetailTabs } from './WorkDetailTabs';

const art = (id: string, type: string, version: number, root: string) => ({
  id, type, title: type + ' ' + version, version, status: 'draft', root,
  supersedes: null, created_by: 'a', created_at: '2026-01-0' + version + 'T00:00:00Z',
  body: '## H', work_item: 'WI-1', metadata: null,
});

beforeEach(() => {
  params = new URLSearchParams();
  replace.mockClear();
  useWorkArtifacts.mockReturnValue({ data: { items: [art('S2', 'spec', 2, 'S'), art('S1', 'spec', 1, 'S')] }, isLoading: false, isError: false });
  useDecisions.mockReturnValue({ data: [], isLoading: false, isError: false });
  useAdrs.mockReturnValue({ data: { items: [] }, isLoading: false, isError: false });
});

describe('WorkDetailTabs', () => {
  it('renders tabs and the overview panel by default', () => {
    render(<WorkDetailTabs id="WI-1" />);
    expect(screen.getByRole('tab', { name: 'Spec' })).toBeTruthy();
    expect(screen.getByText('Overview of WI-1.')).toBeTruthy();
  });

  it('changing tab calls router.replace with ?tab=', () => {
    render(<WorkDetailTabs id="WI-1" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Spec' }));
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('tab=spec'));
  });

  it('spec tab shows the latest version + a version timeline', () => {
    params = new URLSearchParams('tab=spec');
    render(<WorkDetailTabs id="WI-1" />);
    expect(screen.getByText('S2')).toBeTruthy(); // IdChip of latest version
    expect(screen.getByRole('navigation', { name: 'Version history' })).toBeTruthy();
  });

  it('decisions tab shows empty state', () => {
    params = new URLSearchParams('tab=decisions');
    render(<WorkDetailTabs id="WI-1" />);
    expect(screen.getByText('No decisions yet.')).toBeTruthy();
  });
});
