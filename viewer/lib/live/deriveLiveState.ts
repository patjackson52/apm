export type LiveState = 'live' | 'stale' | 'offline';

export interface LiveInput {
  isFetching: boolean;
  lastUpdatedAt: number | null;
  /** Connection is currently down: the most recent fetch settled as an error,
   *  newer than the freshest success. A stale one-off error on an idle query
   *  (dominated by ongoing successful polls) is NOT "down". */
  connectionDown: boolean;
  online: boolean;
  now: number;
  thresholdMs?: number;
}

/**
 * Pure liveness state machine (no Date.now inside — `now` is injected).
 * offline if the browser is offline or the connection is currently down; stale
 * if there is no successful update yet or the freshest one is older than the
 * threshold; else live. `isFetching` is surfaced for the pulse, not the state.
 */
export function deriveLiveState(i: LiveInput): LiveState {
  if (!i.online || i.connectionDown) return 'offline';
  const threshold = i.thresholdMs ?? 15000;
  if (i.lastUpdatedAt === null || i.now - i.lastUpdatedAt > threshold) return 'stale';
  return 'live';
}
