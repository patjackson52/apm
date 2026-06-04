import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const useSearch = vi.fn();
vi.mock('@/lib/api/hooks', () => ({ useSearch: (...a: unknown[]) => useSearch(...a) }));

import { SearchResults } from './SearchResults';

beforeEach(() => useSearch.mockReset());

describe('SearchResults', () => {
  it('groups results by kind with highlighted, XSS-safe text', () => {
    useSearch.mockReturnValue({ data: [
      { kind: 'work_item', id: 'WI-3', title: 'Alpha Feature', snippet: null, work_item: 'WI-3' },
      { kind: 'artifact', id: 'ART-9', title: 'Spec', snippet: '<script>alert(1)</script> alpha needle', work_item: 'WI-3' },
    ], isLoading: false, isError: false });
    const { container } = render(<SearchResults q="alpha" />);
    expect(screen.getByText('Work items')).toBeTruthy();
    expect(screen.getByText('Artifacts')).toBeTruthy();
    expect(container.querySelector('a[href="/work/WI-3"]')).not.toBeNull();
    expect(container.querySelector('mark')).not.toBeNull(); // 'alpha' highlighted
    expect(container.querySelector('script')).toBeNull();   // injected script inert
  });
  it('shows an empty state', () => {
    useSearch.mockReturnValue({ data: [], isLoading: false, isError: false });
    render(<SearchResults q="zzz" />);
    expect(screen.getByText(/No results for/)).toBeTruthy();
  });
  it('prompts when q is blank', () => {
    useSearch.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    render(<SearchResults q="" />);
    expect(screen.getByText(/Type a query/)).toBeTruthy();
  });
});
