import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';

/** TanStack client: retry only transient transport errors; never retry contract/business errors. */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2000,
        gcTime: 300_000,
        refetchOnWindowFocus: true,
        refetchIntervalInBackground: false,
        retry: (n: number, e: unknown) =>
          e instanceof ApiError && (e.code === 'E_NETWORK' || e.code === 'E_HTTP') ? n < 2 : false,
      },
    },
  });
}
