import { describe, it, expect } from 'vitest';
import { normalizeTitle } from '../../src/domain/normalize.js';

describe('normalizeTitle', () => {
  it('lowercases, trims, collapses whitespace, strips punctuation', () => {
    expect(normalizeTitle('  Fix   the Login-Bug! ')).toBe('fix the loginbug');
    expect(normalizeTitle('Add OAuth')).toBe(normalizeTitle('add   oauth'));
  });
});
