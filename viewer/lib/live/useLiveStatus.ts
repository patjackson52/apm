"use client";
import { useCallback, useEffect, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { deriveLiveState, type LiveState } from './deriveLiveState';
import { useHydrated } from '@/lib/hooks/useHydrated';

export interface LiveStatus {
  state: LiveState;
  lastUpdatedAt: number | null;
  isFetching: boolean;
  refresh: () => void;
}

/** Derive live/stale/offline from TanStack polling signals (poll-based, no websocket). */
export function useLiveStatus(thresholdMs?: number): LiveStatus {
  const qc = useQueryClient();
  const isFetching = useIsFetching() > 0;
  const [, setTick] = useState(0);
  const hydrated = useHydrated();
  // SSR-stable default; the real navigator value is applied on mount. Initializing
  // from navigator.onLine here would diverge from the server render.
  const [online, setOnline] = useState(true);
  const refresh = useCallback(() => { void qc.invalidateQueries(); }, [qc]);

  useEffect(() => {
    setOnline(navigator.onLine);
    // A 1s tick re-evaluates freshness over time. We deliberately do NOT subscribe
    // to the query cache: that callback fires synchronously while other components
    // render their useQuery, causing "setState while rendering" on this component.
    // useIsFetching() already re-renders us on every fetch start/stop, which covers
    // live/error transitions; the tick covers the passage into "stale".
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Connectivity and the query cache are client-only; before hydration they differ
  // from the server render. Return a deterministic snapshot so the first client
  // render matches SSR — otherwise React reports a hydration mismatch and
  // regenerates the tree (which surfaced as a spurious "Offline" flash).
  if (!hydrated) return { state: 'stale', lastUpdatedAt: null, isFetching: false, refresh };

  // Track the freshest success and the freshest error across all queries. The
  // connection is "down" only when the most recent fetch settled as an error —
  // an idle non-polling query that errored once long ago must NOT pin us offline
  // while other queries keep polling successfully.
  let lastUpdatedAt: number | null = null;
  let lastErrorAt = 0;
  for (const q of qc.getQueryCache().getAll()) {
    const u = q.state.dataUpdatedAt;
    if (u > 0 && (lastUpdatedAt === null || u > lastUpdatedAt)) lastUpdatedAt = u;
    if (q.state.status === 'error' && q.state.errorUpdatedAt > lastErrorAt) lastErrorAt = q.state.errorUpdatedAt;
  }
  const connectionDown = lastErrorAt > 0 && lastErrorAt > (lastUpdatedAt ?? 0);

  const state = deriveLiveState({ isFetching, lastUpdatedAt, connectionDown, online, now: Date.now(), thresholdMs });

  return { state, lastUpdatedAt, isFetching, refresh };
}
