import { describe, it, expect } from 'vitest';
import { fixedClock, isoZ } from '../../src/domain/clock.js';

describe('clock', () => {
  it('fixedClock returns the same instant', () => {
    const clock = fixedClock('2026-06-02T12:00:00.000Z');
    expect(clock.now()).toBe('2026-06-02T12:00:00.000Z');
    expect(clock.now()).toBe('2026-06-02T12:00:00.000Z');
  });

  it('isoZ formats an epoch-ms as zero-padded UTC Z', () => {
    expect(isoZ(0)).toBe('1970-01-01T00:00:00.000Z');
  });
});
