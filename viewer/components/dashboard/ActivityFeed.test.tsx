import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const useEvents = vi.fn();
vi.mock('@/lib/api/hooks', () => ({ useEvents: (...a: unknown[]) => useEvents(...a) }));

import { ActivityFeed } from './ActivityFeed';

beforeEach(() => useEvents.mockReset());

describe('ActivityFeed', () => {
  it('renders event rows with a plain-text payload (injected markup not executed)', () => {
    useEvents.mockReturnValue({
      data: { items: [
        { id: 'EV-1', actor: 'claude', event_type: 'work.created', entity_type: 'work_item', entity_id: 'WI-3', payload: { note: '<script>alert(1)</script>' }, created_at: '2026-06-04T00:00:00.000Z' },
      ], page: { total: 1, limit: 30, offset: 0, has_more: false } },
      isLoading: false, isError: false,
    });
    const { container } = render(<ActivityFeed />);
    expect(screen.getByText('work.created')).toBeTruthy();
    expect(screen.getByText('WI-3')).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>'); // literal text
  });
  it('shows an empty state', () => {
    useEvents.mockReturnValue({ data: { items: [], page: { total: 0, limit: 30, offset: 0, has_more: false } }, isLoading: false, isError: false });
    render(<ActivityFeed />);
    expect(screen.getByText('No activity yet.')).toBeTruthy();
  });
});
