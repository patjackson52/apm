import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Recursively collect *.css files under a directory. */
function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.next') continue;
      out.push(...cssFiles(full));
    } else if (ent.name.endsWith('.css')) {
      out.push(full);
    }
  }
  return out;
}

const root = join(__dirname, '../..');
const files = [join(root, 'components'), join(root, 'app')].flatMap((d) => cssFiles(d));

describe('every animation respects prefers-reduced-motion', () => {
  for (const f of files) {
    const css = readFileSync(f, 'utf8');
    const animates = /\banimation\s*:/.test(css) || /@keyframes/.test(css);
    if (!animates) continue;
    const rel = f.slice(root.length + 1);
    it(`${rel} gates motion behind prefers-reduced-motion`, () => {
      expect(/prefers-reduced-motion/.test(css)).toBe(true);
    });
  }
});
