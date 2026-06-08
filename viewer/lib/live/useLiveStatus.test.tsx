import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
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

  it('stays live when an idle query errored long ago but a fresh success exists', () => {
    const client = new QueryClient();
    client.setQueryData(['fresh'], 1); // success at "now"
    const q = client.getQueryCache().build(client, { queryKey: ['stale-bad'] });
    q.setState({ status: 'error', error: new Error('x'), errorUpdatedAt: 1, fetchStatus: 'idle' });
    const { result } = renderHook(() => useLiveStatus(), { wrapper: wrapper(client) });
    expect(result.current.state).toBe('live'); // old error must NOT pin offline
  });

  it('is offline when the most recent settle is an error', () => {
    const client = new QueryClient();
    client.setQueryData(['old'], 1);
    const q = client.getQueryCache().build(client, { queryKey: ['bad'] });
    q.setState({ status: 'error', error: new Error('x'), errorUpdatedAt: Date.now() + 10_000, fetchStatus: 'idle' });
    const { result } = renderHook(() => useLiveStatus(), { wrapper: wrapper(client) });
    expect(result.current.state).toBe('offline');
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

  it('renders a deterministic SSR-stable snapshot before hydration (no cache/connectivity leak)', () => {
    // The pre-hydration (server) render must not depend on the query cache or
    // navigator; otherwise the first client render diverges from SSR and React
    // regenerates the tree (the spurious "Offline" flash). renderToStaticMarkup
    // never runs effects, so `hydrated` stays false — the SSR branch.
    const client = new QueryClient();
    client.setQueryData(['x'], 1); // fresh cache data that WOULD imply "live"…
    function Probe() {
      const s = useLiveStatus();
      return <i>{`${s.state}:${String(s.lastUpdatedAt)}:${String(s.isFetching)}`}</i>;
    }
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}><Probe /></QueryClientProvider>,
    );
    expect(html).toContain('stale:null:false'); // …yet SSR is always the stable snapshot
  });

  it('cleans up without throwing on unmount', () => {
    const client = new QueryClient();
    const { unmount } = renderHook(() => useLiveStatus(), { wrapper: wrapper(client) });
    expect(() => unmount()).not.toThrow();
  });
});
