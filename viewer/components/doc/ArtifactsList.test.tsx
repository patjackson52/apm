import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ArtifactView } from '@apm/types';

const useArtifacts = vi.fn();
vi.mock('@/lib/api/hooks', () => ({ useArtifacts: (f?: unknown) => useArtifacts(f) }));

import { ArtifactsList } from './ArtifactsList';

const a = (over: Partial<ArtifactView>): ArtifactView => ({
  id: 'ART-1', type: 'spec', title: 'A spec', version: 1, status: 'approved',
  root: 'ART-1', supersedes: null, created_by: 'claude', created_at: '2026-06-01T00:00:00Z',
  body: null, work_item: 'WI-8', metadata: null, ...over,
});

beforeEach(() => useArtifacts.mockReset());

describe('ArtifactsList', () => {
  it('renders artifacts grouped by type with links to the detail route', () => {
    useArtifacts.mockReturnValue({
      data: { items: [a({ id: 'ART-1', type: 'spec', title: 'A spec' }), a({ id: 'ART-2', type: 'plan', title: 'A plan' })], page: { total: 2, limit: 50, offset: 0, has_more: false } },
      isLoading: false, isError: false,
    });
    render(<ArtifactsList />);
    expect(screen.getByText('A spec')).toBeTruthy();
    expect(screen.getByText('A plan')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'A spec' }).getAttribute('href')).toBe('/artifacts/ART-1');
  });

  it('shows an empty state instead of loading forever', () => {
    useArtifacts.mockReturnValue({ data: { items: [], page: { total: 0, limit: 50, offset: 0, has_more: false } }, isLoading: false, isError: false });
    render(<ArtifactsList />);
    expect(screen.getByText(/no artifacts yet/i)).toBeTruthy();
  });

  it('shows a failure state on error', () => {
    useArtifacts.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<ArtifactsList />);
    expect(screen.getByText(/failed to load/i)).toBeTruthy();
  });
});
