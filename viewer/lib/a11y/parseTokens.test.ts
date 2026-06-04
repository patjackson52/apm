import { describe, it, expect } from 'vitest';
import { parseThemeTokens, resolveVar } from './parseTokens';

const CSS = `
[data-theme="light"] { --accent: #3b66f5; --border-focus: var(--accent); --fg: #181b22; }
[data-theme="dark"]  { --accent: #5a7dff; --border-focus: var(--accent); --fg: #e8eaee; }
`;

describe('parseThemeTokens', () => {
  it('extracts both theme blocks as maps', () => {
    const { light, dark } = parseThemeTokens(CSS);
    expect(light.get('--accent')).toBe('#3b66f5');
    expect(dark.get('--fg')).toBe('#e8eaee');
  });
  it('resolves single-level var()', () => {
    const { light } = parseThemeTokens(CSS);
    expect(resolveVar('--border-focus', light)).toBe('#3b66f5');
  });
  it('returns a direct hex unchanged', () => {
    const { dark } = parseThemeTokens(CSS);
    expect(resolveVar('--accent', dark)).toBe('#5a7dff');
  });
  it('throws on undefined token', () => {
    const { light } = parseThemeTokens(CSS);
    expect(() => resolveVar('--nope', light)).toThrow(/not defined/);
  });
  it('throws on unresolved var', () => {
    const m = new Map([['--x', 'var(--missing)']]);
    expect(() => resolveVar('--x', m)).toThrow(/--missing/);
  });
});
