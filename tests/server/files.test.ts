import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { fixedClock } from '../../src/domain/clock.js';
import { resolveFilePath } from '../../src/server/files.js';
import { startServer } from '../../src/server/serve.js';

const clock = fixedClock('2026-06-03T12:00:00.000Z');

describe('resolveFilePath (security core)', () => {
  let root: string; let outside: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'apm-files-root-'));
    outside = mkdtempSync(join(tmpdir(), 'apm-files-out-'));
    writeFileSync(join(root, 'ok.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(root, 'secret.env'), 'TOKEN=hunter2');
    writeFileSync(join(outside, 'passwd'), 'root:x:0:0');
    mkdirSync(join(root, 'images'));
    writeFileSync(join(root, 'images', 'a.png'), Buffer.from([1, 2, 3]));
    symlinkSync(join(outside, 'passwd'), join(root, 'escape.png'));   // symlink escaping root
    symlinkSync(join(root, 'secret.env'), join(root, 'leak.png'));    // in-root symlink → secret
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });

  it('serves a real in-root image', () => {
    expect(resolveFilePath(root, 'ok.png')).toBe(fs.realpathSync(join(root, 'ok.png')));
    expect(resolveFilePath(root, 'images/a.png')).toBeTruthy();
  });
  it('rejects path traversal', () => {
    expect(resolveFilePath(root, '../../../etc/passwd')).toBeNull();
    expect(resolveFilePath(root, 'images/../../escape.png')).toBeNull();
  });
  it('rejects absolute paths and ~', () => {
    expect(resolveFilePath(root, '/etc/passwd')).toBeNull();
    expect(resolveFilePath(root, '~/x.png')).toBeNull();
  });
  it('rejects a symlink escaping the root', () => {
    expect(resolveFilePath(root, 'escape.png')).toBeNull();
  });
  it('rejects an in-root symlink pointing at a non-image secret (resolved-ext re-check)', () => {
    expect(resolveFilePath(root, 'leak.png')).toBeNull();
  });
  it('rejects non-allowlisted extensions', () => {
    expect(resolveFilePath(root, 'secret.env')).toBeNull();
  });
  it('rejects missing/empty/null-byte', () => {
    expect(resolveFilePath(root, '')).toBeNull();
    expect(resolveFilePath(root, null)).toBeNull();
    expect(resolveFilePath(root, 'nope.png')).toBeNull();
    expect(resolveFilePath(root, 'a\0.png')).toBeNull();
  });
});

describe('/api/files endpoint', () => {
  let dir: string; let server: http.Server; let base: string;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'apm-files-srv-'));
    initProject(dir, clock); // creates dir/.apm; projectRoot = dir
    writeFileSync(join(dir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(dir, 'diagram.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    server = startServer({ dir, clock, port: 0 });
    await new Promise<void>((r) => server.on('listening', () => r()));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); rmSync(dir, { recursive: true, force: true }); });

  it('serves an allowlisted image with nosniff', async () => {
    const r = await fetch(`${base}/api/files?path=pic.png`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('serves SVG with a locking CSP', async () => {
    const r = await fetch(`${base}/api/files?path=diagram.svg`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
  });
  it('404s traversal and secret files', async () => {
    expect((await fetch(`${base}/api/files?path=../../etc/passwd`)).status).toBe(404);
    expect((await fetch(`${base}/api/files?path=.apm/apm.db`)).status).toBe(404);
    expect((await fetch(`${base}/api/files?path=.env`)).status).toBe(404);
    expect((await fetch(`${base}/api/files`)).status).toBe(404);
  });
  it('403 for POST /api/files (write guard: no CSRF token)', async () => {
    expect((await fetch(`${base}/api/files?path=pic.png`, { method: 'POST' })).status).toBe(403);
  });
});
