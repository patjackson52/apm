'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CsrfTokenSchema } from '@apm/types';
import { apiGet } from './client';
import { qk } from './keys';

/** The daemon mints a per-listener CSRF token at GET /api/csrf; writes must echo it
 *  back via X-APM-CSRF. The token is stable for the listener's life, so cache it
 *  forever and refetch only on demand (a 403 → token rotated, see mutations.ts). */
export function useCsrfToken() {
  return useQuery({
    queryKey: qk.csrf(),
    queryFn: () => apiGet('/api/csrf', CsrfTokenSchema),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
}

/** Imperatively (re)fetch the token — used by mutations to recover from a 403.
 *  staleTime:0 forces a real network hit (the cached token is what just got rejected). */
export function useRefetchCsrf() {
  const qc = useQueryClient();
  return () =>
    qc.fetchQuery({ queryKey: qk.csrf(), queryFn: () => apiGet('/api/csrf', CsrfTokenSchema), staleTime: 0 });
}
