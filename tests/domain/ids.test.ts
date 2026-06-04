import { describe, it, expect } from 'vitest';
import { ID_PREFIXES, formatId, parseId, artifactRef } from '../../src/domain/ids.js';

describe('ids', () => {
  it('lists every entity prefix', () => {
    expect(ID_PREFIXES.workItem).toBe('WI');
    expect(ID_PREFIXES.blocker).toBe('BLK');
    expect(ID_PREFIXES.workflowRun).toBe('WR');
    expect(Object.values(ID_PREFIXES)).not.toContain('HG');
  });

  it('formats a prefix + number into an id', () => {
    expect(formatId('WI', 123)).toBe('WI-123');
  });

  it('parses an id back into prefix + number', () => {
    expect(parseId('ART-9')).toEqual({ prefix: 'ART', value: 9 });
  });

  it('throws on a malformed id', () => {
    expect(() => parseId('nonsense')).toThrow(/invalid id/i);
  });

  it('renders a compact artifact version ref', () => {
    expect(artifactRef('ART-1', 2)).toBe('ART-1@2');
  });
});

describe('IMG prefix', () => {
  it('is registered and formats', () => {
    expect(ID_PREFIXES.image).toBe('IMG');
    expect(formatId(ID_PREFIXES.image, 7)).toBe('IMG-7');
  });
});
