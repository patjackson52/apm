import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { fixedClock } from '../../src/domain/clock.js';
import { startServer } from '../../src/server/serve.js';

// Characterization/regression suite for the apm-serve daemon hardening (PLAN.md M0).
// These assert ALREADY-implemented behavior in src/server/serve.ts so it can't regress.
const clock = fixedClock('2026-01-01T00:00:00.000Z');
let dir: string;
let server: http.Server;
let port: number;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'apm-sec-'));
  initProject(dir, clock);
  server = startServer({ dir, clock, port: 0 });
  await new Promise<void>((r) => server.on('listening', () => r()));
  port = (server.address() as { port: number }).port;
});

afterAll(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

// Raw http.request: lets us set a custom Host header (undici fetch forbids it -> would false-green).
function req(opts: {
  method?: string;
  path?: string;
  host?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: '127.0.0.1',
        port,
        method: opts.method ?? 'GET',
        path: opts.path ?? '/api/status',
        headers: { ...(opts.host ? { host: opts.host } : {}), ...(opts.headers ?? {}) },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: b }));
      },
    );
    r.on('error', reject);
    if (opts.body != null) r.write(opts.body);
    r.end();
  });
}

describe('apm serve — daemon security hardening', () => {
  it('GET on a known route is 200 with security headers + no CORS', async () => {
    const r = await req({ path: '/api/status' });
    expect(r.status).toBe(200);
    expect(r.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('OPTIONS is rejected 405 (no CORS preflight)', async () => {
    expect((await req({ method: 'OPTIONS', path: '/api/status' })).status).toBe(405);
  });

  it('writes without a CSRF token are rejected 403 (write guard)', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const r = await req({ method, path: '/api/status' });
      expect(r.status, `${method} w/o CSRF should be 403`).toBe(403);
    }
  });

  it('GET /api/csrf returns a token', async () => {
    const r = await req({ path: '/api/csrf' });
    expect(r.status).toBe(200);
    expect(typeof JSON.parse(r.body).data.token).toBe('string');
    expect(JSON.parse(r.body).data.token.length).toBeGreaterThan(10);
  });

  it('a write with a bad CSRF token is 403; with a valid token it passes the guard (405 = no write route here)', async () => {
    const token = JSON.parse((await req({ path: '/api/csrf' })).body).data.token as string;
    expect((await req({ method: 'POST', path: '/api/status', headers: { 'x-apm-csrf': 'nope' }, body: '{}' })).status).toBe(403);
    // Valid token → past the CSRF guard; /api/status has no POST route → 405 (not 403).
    expect((await req({ method: 'POST', path: '/api/status', headers: { 'x-apm-csrf': token, 'content-type': 'application/json' }, body: '{}' })).status).toBe(405);
  });

  it('foreign Host header is rejected 403 (anti DNS-rebind)', async () => {
    expect((await req({ host: 'evil.com' })).status).toBe(403);
    // IPv4-loopback-only by design (serve.ts comment): an IPv6 [::1] Host is rejected.
    expect((await req({ host: '[::1]' })).status).toBe(403);
  });

  it('localhost / 127.0.0.1 Host headers are allowed', async () => {
    expect((await req({ host: '127.0.0.1' })).status).toBe(200);
    expect((await req({ host: 'localhost' })).status).toBe(200);
  });

  it('unknown route is 404 with no filesystem path / stack leak', async () => {
    const r = await req({ path: '/api/nope' });
    expect(r.status).toBe(404);
    expect(r.body).not.toMatch(/\/(Users|home|tmp|var)\//);
  });

  it('server is bound to 127.0.0.1', () => {
    expect((server.address() as { address: string }).address).toBe('127.0.0.1');
  });
});
