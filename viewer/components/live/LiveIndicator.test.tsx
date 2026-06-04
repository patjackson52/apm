import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const useLiveStatus = vi.fn();
vi.mock('@/lib/live/useLiveStatus', () => ({ useLiveStatus: () => useLiveStatus() }));

import { LiveIndicator } from './LiveIndicator';

beforeEach(() => useLiveStatus.mockReset());

describe('LiveIndicator', () => {
  it('shows the state label + aria-live + "updated Ns ago"', () => {
    useLiveStatus.mockReturnValue({ state: 'live', lastUpdatedAt: Date.now() - 3000, isFetching: false, refresh: vi.fn() });
    const { container } = render(<LiveIndicator />);
    expect(screen.getByText('Live')).toBeTruthy();
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(screen.getByText(/updated \d+s ago/)).toBeTruthy();
  });
  it('applies the pulse class only while fetching', () => {
    useLiveStatus.mockReturnValue({ state: 'live', lastUpdatedAt: Date.now(), isFetching: true, refresh: vi.fn() });
    const { container } = render(<LiveIndicator />);
    expect(container.querySelector('[class*="pulse"]')).not.toBeNull();
  });
  it('shows Offline state', () => {
    useLiveStatus.mockReturnValue({ state: 'offline', lastUpdatedAt: null, isFetching: false, refresh: vi.fn() });
    render(<LiveIndicator />);
    expect(screen.getByText('Offline')).toBeTruthy();
  });
});
