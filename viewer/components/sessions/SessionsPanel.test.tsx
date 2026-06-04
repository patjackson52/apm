import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const useSessions = vi.fn();
vi.mock('@/lib/api/hooks', () => ({ useSessions: () => useSessions() }));

import { SessionsPanel } from './SessionsPanel';

beforeEach(() => useSessions.mockReset());

describe('SessionsPanel', () => {
  it('renders context_summary via sanitized Markdown (injected script inert)', () => {
    useSessions.mockReturnValue({ data: [
      { id: 'S-1', agent: 'claude', status: 'active', context_summary: '## Did\n\n<script>alert(1)</script> built WI-35', started_at: '2026-06-04T00:00:00.000Z', last_seen_at: null, ended_at: null },
    ], isLoading: false, isError: false });
    const { container } = render(<SessionsPanel />);
    expect(screen.getByText('claude')).toBeTruthy();
    expect(container.querySelector('h2')).not.toBeNull(); // markdown heading rendered
    expect(container.querySelector('script')).toBeNull(); // injected script not executed
  });
  it('shows empty state', () => {
    useSessions.mockReturnValue({ data: [], isLoading: false, isError: false });
    render(<SessionsPanel />);
    expect(screen.getByText('No sessions yet.')).toBeTruthy();
  });
});
