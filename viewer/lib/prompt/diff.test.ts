import { describe, it, expect } from 'vitest';
import { wordDiff } from './diff';

const words = (a: string, b: string) =>
  wordDiff(a, b).filter((t) => t.text.trim() !== '');

describe('wordDiff', () => {
  it('marks the changed word as del + add and keeps surrounding words eq', () => {
    const toks = words('the quick fox', 'the slow fox');
    expect(toks).toEqual([
      { type: 'eq', text: 'the' },
      { type: 'del', text: 'quick' },
      { type: 'add', text: 'slow' },
      { type: 'eq', text: 'fox' },
    ]);
  });

  it('treats identical strings as all eq', () => {
    expect(words('a b c', 'a b c').every((t) => t.type === 'eq')).toBe(true);
  });

  it('handles pure additions', () => {
    const toks = words('a', 'a b');
    expect(toks).toContainEqual({ type: 'add', text: 'b' });
  });
});
