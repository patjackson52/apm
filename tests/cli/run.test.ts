import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { runCommand, findProjectDb, resolveFormat } from '../../src/cli/run.js';
import { fixedClock } from '../../src/domain/clock.js';
import { ApmError } from '../../src/domain/errors.js';

let dir: string;
const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-run-')); initProject(dir, clock); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('runCommand', () => {
  it('renders an ok envelope and exit 0', () => {
    const lines: string[] = [];
    const code = runCommand({ dir, clock, format: 'json', out: (s) => lines.push(s) }, 'demo', () => ({ data: { hello: 'world' } }));
    expect(code).toBe(0);
    const env = JSON.parse(lines.join('\n'));
    expect(env.ok).toBe(true);
    expect(env.data).toEqual({ hello: 'world' });
    expect(env.meta.command).toBe('demo');
  });

  it('renders a fail envelope and the mapped exit code', () => {
    const lines: string[] = [];
    const code = runCommand({ dir, clock, format: 'json', out: (s) => lines.push(s) }, 'demo', () => { throw new ApmError('E_NOT_FOUND', 'nope'); });
    expect(code).toBe(44);
    const env = JSON.parse(lines.join('\n'));
    expect(env.ok).toBe(false);
    expect(env.error.code).toBe('E_NOT_FOUND');
  });

  it('findProjectDb walks up to locate .apm', () => {
    expect(findProjectDb(dir)).toBe(join(dir, '.apm', 'apm.db'));
  });

  it('resolveFormat prefers explicit over env over default', () => {
    expect(resolveFormat('yaml', { APM_FORMAT: 'json' }, false)).toBe('yaml');
    expect(resolveFormat(undefined, { APM_FORMAT: 'json' }, false)).toBe('json');
    expect(resolveFormat(undefined, {}, true)).toBe('human');
    expect(resolveFormat(undefined, {}, false)).toBe('json');
  });
});
