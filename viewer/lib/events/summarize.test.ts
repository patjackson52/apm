import { describe, it, expect } from 'vitest';
import { summarizePayload } from './summarize';

describe('summarizePayload', () => {
  it('stringifies objects and truncates', () => {
    expect(summarizePayload({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
    const long = summarizePayload({ s: 'y'.repeat(300) });
    expect(long.length).toBeLessThanOrEqual(140);
    expect(long.endsWith('…')).toBe(true);
  });
  it('handles primitives and null', () => {
    expect(summarizePayload(42)).toBe('42');
    expect(summarizePayload(null)).toBe('');
    expect(summarizePayload(undefined)).toBe('');
  });
  it('returns markup as a literal string (caller renders as plain text)', () => {
    const out = summarizePayload({ note: '<script>alert(1)</script>' });
    expect(typeof out).toBe('string');
    expect(out).toContain('<script>');
  });
});
