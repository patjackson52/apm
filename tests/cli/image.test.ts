import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { fixedClock } from '../../src/domain/clock.js';
import { resolveProjectRoot } from '../../src/cli/run.js';
import { buildProgram } from '../../src/cli/program.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import * as work from '../../src/usecases/work.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const clock = fixedClock('2026-06-04T12:00:00.000Z');
let dir: string;
beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'apm-cli-img-'))); initProject(dir, clock); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('resolveProjectRoot', () => {
  it('returns the dir containing .apm when --dir is explicit', () => {
    expect(resolveProjectRoot(dir)).toBe(dir);
  });
});

function runCli(args: string[]): { out: string; code: number } {
  const lines: string[] = [];
  const program = buildProgram({ clock, out: (s) => lines.push(s), defaultFormat: 'json' });
  const orig = process.exitCode;
  program.parse(['--dir', dir, ...args], { from: 'user' });
  const code = (process.exitCode as number) ?? 0;
  process.exitCode = orig;
  return { out: lines.join('\n'), code };
}

describe('apm image CLI', () => {
  it('add -> show -> list round trip', () => {
    const storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
    const wi = work.create({ storage, clock }, { type: 'feature', title: 'F', agent: 'agent:claude' });
    storage.close();
    const png = join(dir, 'shot.png');
    writeFileSync(png, PNG);

    const added = JSON.parse(runCli(['image', 'add', '--work-item', wi.id, '--file', png, '--kind', 'screenshot', '--alt', 'home', '--agent', 'agent:claude']).out);
    expect(added.ok).toBe(true);
    expect(added.data.id).toBe('IMG-1');

    const shown = JSON.parse(runCli(['image', 'show', 'IMG-1']).out);
    expect(shown.data.path).toMatch(/^\.apm\/blobs\//);

    const listed = JSON.parse(runCli(['image', 'list', '--work-item', wi.id]).out);
    expect(listed.data.items.map((i: any) => i.id)).toContain('IMG-1');
  });
});

import { readFileSync as rf, existsSync } from 'node:fs';

describe('apm image error handling', () => {
  it('a missing --file yields a clean error envelope, not a stack trace', () => {
    const storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
    const wi = work.create({ storage, clock }, { type: 'feature', title: 'F', agent: 'agent:claude' });
    storage.close();
    const res = runCli(['image', 'add', '--work-item', wi.id, '--file', join(dir, 'does-not-exist.png'), '--agent', 'agent:claude']);
    const parsed = JSON.parse(res.out);
    expect(parsed.ok).toBe(false);
    expect(res.code).not.toBe(0);
  });
});

describe('apm image save + embed', () => {
  it('saves blob bytes to a path and emits embed snippets', () => {
    const storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
    const wi = work.create({ storage, clock }, { type: 'feature', title: 'F', agent: 'agent:claude' });
    storage.close();
    const png = join(dir, 's.png');
    writeFileSync(png, PNG);
    runCli(['image', 'add', '--work-item', wi.id, '--file', png, '--alt', 'home', '--agent', 'agent:claude']);

    const dest = join(dir, 'out.png');
    runCli(['image', 'save', 'IMG-1', '--to', dest]);
    expect(existsSync(dest)).toBe(true);
    expect(rf(dest).equals(PNG)).toBe(true);

    const embed = JSON.parse(runCli(['image', 'embed', 'IMG-1']).out);
    expect(embed.data.markdown).toBe('![home](apm:IMG-1)');
    const resolved = JSON.parse(runCli(['image', 'embed', 'IMG-1', '--resolve']).out);
    expect(resolved.data.markdown).toMatch(/^!\[home\]\(\.apm\/blobs\//);
  });
});
