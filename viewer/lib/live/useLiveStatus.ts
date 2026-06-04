"use client";
import { useCallback, useEffect, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { deriveLiveState, type LiveState } from './deriveLiveState';

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
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const unsub = qc.getQueryCache().subscribe(bump);
    const interval = setInterval(bump, 1000);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      unsub();
      clearInterval(interval);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [qc]);

  let lastUpdatedAt: number | null = null;
  let anyError = false;
  for (const q of qc.getQueryCache().getAll()) {
    const u = q.state.dataUpdatedAt;
    if (u > 0 && (lastUpdatedAt === null || u > lastUpdatedAt)) lastUpdatedAt = u;
    if (q.state.status === 'error') anyError = true;
  }

  const state = deriveLiveState({ isFetching, lastUpdatedAt, anyError, online, now: Date.now(), thresholdMs });
  const refresh = useCallback(() => { void qc.invalidateQueries(); }, [qc]);

  return { state, lastUpdatedAt, isFetching, refresh };
}
