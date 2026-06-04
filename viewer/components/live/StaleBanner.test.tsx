import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const useLiveStatus = vi.fn();
vi.mock('@/lib/live/useLiveStatus', () => ({ useLiveStatus: () => useLiveStatus() }));

import { StaleBanner } from './StaleBanner';

beforeEach(() => useLiveStatus.mockReset());

describe('StaleBanner', () => {
  it('renders nothing when live', () => {
    useLiveStatus.mockReturnValue({ state: 'live', refresh: vi.fn() });
    const { container } = render(<StaleBanner />);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
  it('shows a stale banner with a working Refresh', () => {
    const refresh = vi.fn();
    useLiveStatus.mockReturnValue({ state: 'stale', refresh });
    render(<StaleBanner />);
    expect(screen.getByText('Data may be out of date')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('shows an offline banner', () => {
    useLiveStatus.mockReturnValue({ state: 'offline', refresh: vi.fn() });
    render(<StaleBanner />);
    expect(screen.getByText('Offline — showing last-known data')).toBeTruthy();
  });
});
