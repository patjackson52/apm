export type LiveState = 'live' | 'stale' | 'offline';

export interface LiveInput {
  isFetching: boolean;
  lastUpdatedAt: number | null;
  anyError: boolean;
  online: boolean;
  now: number;
  thresholdMs?: number;
}

/**
 * Pure liveness state machine (no Date.now inside — `now` is injected).
 * offline if the browser is offline or fetches are erroring; stale if there is
 * no successful update yet or the freshest one is older than the threshold;
 * else live. `isFetching` is surfaced for the pulse but does not change state.
 */
export function deriveLiveState(i: LiveInput): LiveState {
  if (!i.online || i.anyError) return 'offline';
  const threshold = i.thresholdMs ?? 15000;
  if (i.lastUpdatedAt === null || i.now - i.lastUpdatedAt > threshold) return 'stale';
  return 'live';
}
