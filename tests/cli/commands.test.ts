import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { buildProgram } from '../../src/cli/program.js';
import { fixedClock } from '../../src/domain/clock.js';

let dir: string; const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-cmd-')); initProject(dir, clock); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function runCli(args: string[]): { out: string; code: number } {
  const lines: string[] = [];
  const program = buildProgram({ clock, out: (s) => lines.push(s), defaultFormat: 'json' });
  let code = 0;
  const orig = process.exitCode;
  program.parse(['--dir', dir, ...args], { from: 'user' });
  code = (process.exitCode as number) ?? 0;
  process.exitCode = orig;
  return { out: lines.join('\n'), code };
}

describe('cli command groups', () => {
  it('work create -> show -> list round trip', () => {
    const created = JSON.parse(runCli(['work', 'create', '--type', 'feature', '--title', 'Offline', '--agent', 'claude']).out);
    expect(created.ok).toBe(true); expect(created.data.id).toBe('WI-1');
    const shown = JSON.parse(runCli(['work', 'show', 'WI-1']).out);
    expect(shown.data.title).toBe('Offline');
    const listed = JSON.parse(runCli(['work', 'list']).out);
    expect(listed.data.items).toHaveLength(1);
  });

  it('lease acquire reports active and conflict exit code', () => {
    runCli(['work', 'create', '--type', 'task', '--title', 'A', '--agent', 'claude']);
    const ok = runCli(['lease', 'acquire', 'WI-1', '--agent', 'claude', '--ttl', '30m']);
    expect(JSON.parse(ok.out).data.status).toBe('active');
    const conflict = runCli(['lease', 'acquire', 'WI-1', '--agent', 'other', '--ttl', '30m']);
    expect(conflict.code).toBe(10);
    expect(JSON.parse(conflict.out).error.code).toBe('E_LEASE_CONFLICT');
  });

  it('missing project gives E_NOT_FOUND exit 44', () => {
    const lines: string[] = [];
    const program = buildProgram({ clock, out: (s) => lines.push(s), defaultFormat: 'json' });
    program.parse(['--dir', join(dir, 'nope'), 'work', 'list'], { from: 'user' });
    expect((process.exitCode as number)).toBe(44);
    process.exitCode = 0;
  });
});
