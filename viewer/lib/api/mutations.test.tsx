import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeQueryClient } from './queryClient';
import { useAnswerGate } from './mutations';
import type { ReactNode } from 'react';

const wrapper = () => {
  const client = makeQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
};
const meta = { api_version: 1, command: 'c', ts: 't' };
const csrf = (token: string) => ({ json: async () => ({ ok: true, data: { token }, error: null, meta }), status: 200 } as Response);
const run = { id: 'WR-1', work_item: 'WI-1', workflow: 'feature_delivery', status: 'active', current_step: 'spec', started_at: 't', completed_at: null };
const okRun = { json: async () => ({ ok: true, data: run, error: null, meta }), status: 200 } as Response;
const forbidden = { json: async () => ({}), status: 403 } as Response;

afterEach(() => vi.restoreAllMocks());

describe('useAnswerGate', () => {
  it('fetches the token then POSTs the answer with X-APM-CSRF', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url.endsWith('/api/csrf')) return csrf('TOK');
      return okRun;
    }));
    const { result } = renderHook(() => useAnswerGate(), { wrapper: wrapper() });
    await act(async () => { await result.current.mutateAsync({ blocker: 'BLK-1', choice: 'yes' }); });

    const write = calls.find(([u]) => u.includes('/api/gates/'))!;
    expect(write[0]).toContain('/api/gates/BLK-1/answer');
    expect(write[1]?.method).toBe('POST');
    expect((write[1]?.headers as Record<string, string>)['x-apm-csrf']).toBe('TOK');
    expect(JSON.parse(write[1]?.body as string)).toMatchObject({ choice: 'yes', agent: 'human:viewer' });
  });

  it('refetches the token and retries once on a 403', async () => {
    let tokenFetches = 0;
    let firstWrite = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/api/csrf')) { tokenFetches += 1; return csrf(`TOK${tokenFetches}`); }
      if (firstWrite) { firstWrite = false; return forbidden; } // stale token → 403
      return okRun;
    }));
    const { result } = renderHook(() => useAnswerGate(), { wrapper: wrapper() });
    await act(async () => { await result.current.mutateAsync({ blocker: 'BLK-1', choice: 'yes' }); });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(tokenFetches).toBe(2); // initial + refetch after the 403
    expect(result.current.data?.id).toBe('WR-1');
  });
});
