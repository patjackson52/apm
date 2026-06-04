import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useLiveStatus } from './useLiveStatus';

function wrapper(client: QueryClient) {
  const W = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  W.displayName = 'TestWrapper';
  return W;
}

afterEach(() => vi.restoreAllMocks());

describe('useLiveStatus', () => {
  it('is live when a query has a fresh successful update', () => {
    const client = new QueryClient();
    client.setQueryData(['x'], { ok: true }); // sets dataUpdatedAt = now
    const { result } = renderHook(() => useLiveStatus(), { wrapper: wrapper(client) });
    expect(result.current.state).toBe('live');
    expect(result.current.lastUpdatedAt).not.toBeNull();
  });

  it('flips to offline on a window offline event', () => {
    const client = new QueryClient();
    client.setQueryData(['x'], 1);
    const { result } = renderHook(() => useLiveStatus(), { wrapper: wrapper(client) });
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(result.current.state).toBe('offline');
  });

  it('refresh() invalidates queries', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
    const { result } = renderHook(() => useLiveStatus(), { wrapper: wrapper(client) });
    act(() => result.current.refresh());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('cleans up without throwing on unmount', () => {
    const client = new QueryClient();
    const { unmount } = renderHook(() => useLiveStatus(), { wrapper: wrapper(client) });
    expect(() => unmount()).not.toThrow();
  });
});
