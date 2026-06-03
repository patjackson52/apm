import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { fixedClock } from '../../src/domain/clock.js';
import { startServer, SECURITY_HEADERS, ROUTES } from '../../src/server/serve.js';

const clock = fixedClock('2026-06-03T12:00:00.000Z');
let dir: string; let server: http.Server; let base: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'apm-sec-'));
  initProject(dir, clock);
  writeFileSync(join(dir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(dir, 'd.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  server = startServer({ dir, clock, port: 0 });
  await new Promise<void>((r) => server.on('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); rmSync(dir, { recursive: true, force: true }); });

describe('serve security hardening', () => {
  it('JSON responses carry the security headers', async () => {
    const r = await fetch(`${base}/api/status`);
    expect(r.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('image responses carry the base security headers; SVG gets the stricter CSP', async () => {
    const png = await fetch(`${base}/api/files?path=pic.png`);
    expect(png.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(png.headers.get('referrer-policy')).toBe('no-referrer');
    const svg = await fetch(`${base}/api/files?path=d.svg`);
    expect(svg.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
  });

  it('OPTIONS is rejected (no CORS preflight)', async () => {
    expect((await fetch(`${base}/api/status`, { method: 'OPTIONS' })).status).toBe(405);
  });

  it('never emits Access-Control-Allow-Origin', async () => {
    const r = await fetch(`${base}/api/status`);
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('route table is read-only (all GET)', () => {
    expect(ROUTES.every((r) => r.method === 'GET')).toBe(true);
    expect(Object.keys(SECURITY_HEADERS).length).toBe(3);
  });
});
