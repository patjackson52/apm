import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProgram } from '../../src/cli/program.js';
import { fixedClock } from '../../src/domain/clock.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-cli-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('apm init (cli)', () => {
  it('initializes in the given --dir and prints a confirmation', () => {
    const lines: string[] = [];
    const program = buildProgram({ clock: fixedClock('2026-06-02T12:00:00.000Z'), out: (s) => lines.push(s) });
    program.parse(['init', '--dir', dir], { from: 'user' });
    expect(existsSync(join(dir, '.apm', 'apm.db'))).toBe(true);
    expect(lines.join('\n')).toMatch(/initialized/i);
  });
});
