import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveSafePath } from './resolvePath';

let root: string;
let outside: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'apm-jail-')));
  outside = await realpath(await mkdtemp(path.join(tmpdir(), 'apm-out-')));
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await writeFile(path.join(root, 'assets', 'ok.png'), 'PNG');
  await writeFile(path.join(root, '.env'), 'SECRET=1');
  await writeFile(path.join(root, 'secret.db'), 'db');
  await mkdir(path.join(root, '.git'), { recursive: true });
  await writeFile(path.join(root, '.git', 'config'), 'x');
  await mkdir(path.join(root, '.apm'), { recursive: true });
  await writeFile(path.join(root, '.apm', 'apm.db'), 'x');
  await writeFile(path.join(root, 'diagram.svg'), '<svg/>');
  await writeFile(path.join(root, 'notes.txt'), 'hi');
  await writeFile(path.join(outside, 'passwd'), 'root:x');
  await symlink(outside, path.join(root, 'escape'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('resolveSafePath', () => {
  it('accepts a valid raster image under root', async () => {
    const r = await resolveSafePath(root, 'assets/ok.png');
    expect(r).toMatchObject({ ok: true, contentType: 'image/png' });
    if (r.ok) expect(r.absPath).toBe(path.join(root, 'assets', 'ok.png'));
  });

  it('rejects traversal, absolute, and symlink escape', async () => {
    expect((await resolveSafePath(root, '../passwd.png')).ok).toBe(false);
    expect((await resolveSafePath(root, path.join(outside, 'passwd'))).ok).toBe(false);
    expect((await resolveSafePath(root, 'escape/passwd')).ok).toBe(false);
  });

  it('rejects sensitive files even with allowed-looking names', async () => {
    expect((await resolveSafePath(root, '.env')).ok).toBe(false);
    expect((await resolveSafePath(root, 'secret.db')).ok).toBe(false);
    expect((await resolveSafePath(root, '.git/config')).ok).toBe(false);
    expect((await resolveSafePath(root, '.apm/apm.db')).ok).toBe(false);
  });

  it('rejects non-allowlisted extensions including .svg', async () => {
    expect((await resolveSafePath(root, 'diagram.svg')).ok).toBe(false);
    expect((await resolveSafePath(root, 'notes.txt')).ok).toBe(false);
  });

  it('rejects NUL/control chars and percent-encoded input', async () => {
    expect((await resolveSafePath(root, 'a\u0000.png')).ok).toBe(false);
    expect((await resolveSafePath(root, 'assets%2e%2e/ok.png')).ok).toBe(false);
  });

  it('rejects missing files (ENOENT) closed', async () => {
    expect((await resolveSafePath(root, 'assets/nope.png')).ok).toBe(false);
  });
});
