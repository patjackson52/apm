import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'apm-route-')));
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await writeFile(path.join(root, 'assets', 'ok.png'), 'PNGDATA');
  process.env.APM_PROJECT_ROOT = root;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function get(qs: string) {
  const { GET } = await import('./route');
  return GET(new Request('http://localhost/api/files' + qs));
}

describe('GET /api/files', () => {
  it('serves an allowlisted image with security headers', async () => {
    const res = await get('?path=assets/ok.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none'");
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=60');
    expect(await res.text()).toBe('PNGDATA');
  });

  it('returns 404 for traversal', async () => {
    expect((await get('?path=../etc/passwd.png')).status).toBe(404);
  });

  it('returns 404 when path param is missing', async () => {
    expect((await get('')).status).toBe(404);
  });

  it('returns 404 for non-allowlisted extension', async () => {
    expect((await get('?path=assets/ok.svg')).status).toBe(404);
  });
});
