import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...cssFiles(p));
    else if (e.endsWith('.module.css')) out.push(p);
  }
  return out;
}

describe('components use design tokens (no raw hex)', () => {
  it('no #rgb/#rrggbb literals in components/**/*.module.css', () => {
    const offenders: string[] = [];
    for (const f of cssFiles(join(process.cwd(), 'components'))) {
      if (/#[0-9a-fA-F]{3,8}\b/.test(readFileSync(f, 'utf8'))) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
