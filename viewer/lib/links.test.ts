import { describe, it, expect } from 'vitest';
import { hrefForId } from './links';

describe('hrefForId', () => {
  it('maps known prefixes to opaque same-origin paths', () => {
    expect(hrefForId('WI-3')).toBe('/work/WI-3');
    expect(hrefForId('ART-9')).toBe('/artifacts/ART-9');
    expect(hrefForId('ADR-2')).toBe('/artifacts/ADR-2');
  });
  it('returns null for ids with no standalone route or unknown prefix', () => {
    expect(hrefForId('WR-1')).toBeNull();   // run has no standalone route in V1
    expect(hrefForId('LEASE-5')).toBeNull();
    expect(hrefForId('ZZZ-1')).toBeNull();
  });
  it('encodes the id segment', () => {
    expect(hrefForId('WI-a b')).toBe('/work/WI-a%20b');
  });
});
