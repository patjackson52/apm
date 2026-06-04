import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseThemeTokens, resolveVar } from './parseTokens';
import { contrastRatio } from './contrast';
import { TOKEN_PAIRS } from './tokenPairs';

const css = readFileSync(join(__dirname, '../../app/tokens.css'), 'utf8');
const { light, dark } = parseThemeTokens(css);

describe('token contrast meets WCAG AA', () => {
  for (const [name, map] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    for (const p of TOKEN_PAIRS) {
      it(`${name}: ${p.note} (${p.fg} on ${p.bg}) >= ${p.min}:1`, () => {
        const ratio = contrastRatio(resolveVar(p.fg, map), resolveVar(p.bg, map));
        expect(ratio).toBeGreaterThanOrEqual(p.min);
      });
    }
  }
});
