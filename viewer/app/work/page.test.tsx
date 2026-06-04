import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithClient } from '@/test/renderWithClient';

let params = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/work',
}));

const useWorkItems = vi.fn();
vi.mock('@/lib/api/hooks', () => ({ useWorkItems: (...a: unknown[]) => useWorkItems(...a) }));

import Page from './page';

beforeEach(() => { params = new URLSearchParams(); useWorkItems.mockReset(); });

describe('work route', () => {
  it('renders the heading and a table of items', () => {
    useWorkItems.mockReturnValue({ data: { items: [
      { id: 'WI-3', type: 'milestone', title: 'M1', description: null, status: 'completed', priority: 1, estimate: null, parent: null, depends_on: [], blocker_ids: [], artifact_ids: [], active_run: null, lease: null, created_by: null, created_at: '', updated_at: '', completed_at: null },
    ] }, isLoading: false, isError: false });
    renderWithClient(<Page />);
    expect(screen.getByRole('heading', { name: 'Work items' })).toBeInTheDocument();
    expect(screen.getByText('M1')).toBeInTheDocument();
    expect(screen.getByText('WI-3')).toBeInTheDocument();
  });

  it('passes limit:200 to avoid tree truncation', () => {
    useWorkItems.mockReturnValue({ data: { items: [] }, isLoading: false, isError: false });
    renderWithClient(<Page />);
    expect(useWorkItems).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
  });
});
