import { describe, it, expect } from 'vitest';
import { deriveLiveState, type LiveInput } from './deriveLiveState';

const base: LiveInput = { isFetching: false, lastUpdatedAt: 1000, connectionDown: false, online: true, now: 1000, thresholdMs: 15000 };

describe('deriveLiveState', () => {
  it('live when online + a fresh update', () => {
    expect(deriveLiveState({ ...base, now: 5000, lastUpdatedAt: 1000 })).toBe('live');
  });
  it('stale when the freshest update is past the threshold', () => {
    expect(deriveLiveState({ ...base, lastUpdatedAt: 1000, now: 1000 + 15001 })).toBe('stale');
  });
  it('live exactly at the threshold boundary (not stale)', () => {
    expect(deriveLiveState({ ...base, lastUpdatedAt: 1000, now: 1000 + 15000 })).toBe('live');
  });
  it('stale when there is no successful update yet', () => {
    expect(deriveLiveState({ ...base, lastUpdatedAt: null })).toBe('stale');
  });
  it('offline when the connection is currently down', () => {
    expect(deriveLiveState({ ...base, connectionDown: true })).toBe('offline');
  });
  it('stays live when a fresh success coexists with a stale idle error', () => {
    // connectionDown already encodes recency, so a fresh poll keeps us live.
    expect(deriveLiveState({ ...base, connectionDown: false, now: 5000, lastUpdatedAt: 4000 })).toBe('live');
  });
  it('offline when the browser is offline', () => {
    expect(deriveLiveState({ ...base, online: false })).toBe('offline');
  });
});
