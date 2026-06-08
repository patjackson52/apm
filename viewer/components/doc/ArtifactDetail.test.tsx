import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ArtifactView } from '@apm/types';

const useArtifact = vi.fn();
const useAdr = vi.fn();
vi.mock('@/lib/api/hooks', () => ({ useArtifact: (id: string) => useArtifact(id), useAdr: (id: string) => useAdr(id) }));

import { ArtifactDetail } from './ArtifactDetail';

const doc = (over: Partial<ArtifactView> = {}): ArtifactView => ({
  id: 'ART-157', type: 'work_log', title: 'WI-36 Work Log', version: 1, status: 'draft',
  root: 'ART-157', supersedes: null, created_by: 'claude', created_at: '2026-06-04T00:00:00Z',
  body: '# Work log\n\nDid the thing.', work_item: 'WI-36', metadata: null, ...over,
});

beforeEach(() => { useArtifact.mockReset(); useAdr.mockReset(); });

describe('ArtifactDetail', () => {
  it('renders an artifact via /api/artifacts (the route that was 404ing)', () => {
    useArtifact.mockReturnValue({ data: doc(), isLoading: false, isError: false });
    render(<ArtifactDetail id="ART-157" />);
    expect(useArtifact).toHaveBeenCalledWith('ART-157');
    expect(screen.getByText('WI-36 Work Log')).toBeTruthy();
  });

  it('routes ADR ids to the dedicated /api/adr endpoint', () => {
    useAdr.mockReturnValue({ data: doc({ id: 'ADR-2', type: 'adr', title: 'Use SQLite', status: 'accepted' }), isLoading: false, isError: false });
    render(<ArtifactDetail id="ADR-2" />);
    expect(useAdr).toHaveBeenCalledWith('ADR-2');
    expect(useArtifact).not.toHaveBeenCalled();
    expect(screen.getByText('Use SQLite')).toBeTruthy();
  });

  it('shows a not-found message (not a crash) for a missing id', () => {
    useArtifact.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<ArtifactDetail id="ART-999" />);
    expect(screen.getByText(/not found/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /back to artifacts/i })).toBeTruthy();
  });
});
