import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeQueryClient } from './queryClient';
import { useStatus } from './hooks';
import type { ReactNode } from 'react';

const wrapper = () => {
  const client = makeQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
};
const okStatus = {
  ok: true, error: null, meta: { api_version: 1, command: 'status', ts: 't' },
  data: { work: { by_status: { ready: 2 } }, ready_count: 2, active_leases: [], open_blockers: [], awaiting_human: [], active_runs: [] },
};
afterEach(() => vi.restoreAllMocks());

describe('useStatus', () => {
  it('resolves to typed StatusView', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => okStatus, status: 200 } as Response)));
    const { result } = renderHook(() => useStatus({ refetchInterval: false }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.ready_count).toBe(2);
  });
  it('surfaces ApiError on the error path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ ok: false, data: null, error: { code: 'E_NOT_FOUND', message: 'x', retryable: false }, meta: { api_version: 1, command: 'status', ts: 't' } }), status: 404 } as Response)));
    const { result } = renderHook(() => useStatus({ refetchInterval: false }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as { code?: string })?.code).toBe('E_NOT_FOUND');
  });
});
