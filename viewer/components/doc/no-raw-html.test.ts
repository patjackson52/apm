import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

describe('no-raw-HTML guard (WI-31)', () => {
  it('components/doc/** has zero dangerouslySetInnerHTML', () => {
    for (const f of filesUnder('components/doc')) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });

  it('components/markdown/** uses dangerouslySetInnerHTML ONLY in Mermaid (audited sanitized SVG)', () => {
    for (const f of filesUnder('components/markdown')) {
      if (readFileSync(f, 'utf8').includes('dangerouslySetInnerHTML')) {
        expect(f.endsWith('Mermaid.tsx'), `unexpected dangerouslySetInnerHTML in ${f}`).toBe(true);
      }
    }
  });

  it('Markdown.tsx does not derive heading ids itself (slugify only in the pre-sanitize plugin)', () => {
    expect(readFileSync('components/markdown/Markdown.tsx', 'utf8')).not.toMatch(/slugify/);
  });
});
