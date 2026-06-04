import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

let projectParam: string | null = null;
vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: (k: string) => (k === 'project' ? projectParam : null) }) }));

const apiGet = vi.fn().mockResolvedValue([]);
vi.mock('@/lib/api/client', () => ({ apiGet: (...a: unknown[]) => apiGet(...a) }));

import { ActiveProjectProvider } from './ActiveProjectProvider';
import { useStatus, useWorkItems } from '@/lib/api/hooks';

function wrap({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}><ActiveProjectProvider>{children}</ActiveProjectProvider></QueryClientProvider>;
}

beforeEach(() => { apiGet.mockClear(); projectParam = null; });

describe('project-scoped useApiQuery', () => {
  it('is a no-op when no active project (query-less path unchanged)', async () => {
    renderHook(() => useStatus(), { wrapper: wrap });
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(apiGet.mock.calls[0]![0]).toBe('/api/status');
  });
  it('appends ?project= on a query-less path when active', async () => {
    projectParam = 'proj-b';
    renderHook(() => useStatus(), { wrapper: wrap });
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(apiGet.mock.calls[0]![0]).toBe('/api/status?project=proj-b');
  });
  it('appends &project= on a path that already has a query', async () => {
    projectParam = 'proj-b';
    renderHook(() => useWorkItems({ status: 'ready' }), { wrapper: wrap });
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(apiGet.mock.calls[0]![0]).toContain('?status=ready');
    expect(apiGet.mock.calls[0]![0]).toContain('&project=proj-b');
  });
});
