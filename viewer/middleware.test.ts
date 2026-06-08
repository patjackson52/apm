import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

const call = () => middleware(new NextRequest('http://localhost:3000/'));

describe('CSP nonce middleware', () => {
  it('sets a CSP with a per-request nonce + strict-dynamic + frame-ancestors none', () => {
    const res = call();
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('generates a fresh nonce per request', () => {
    const n = (r: Response) => (r.headers.get('content-security-policy') ?? '').match(/nonce-([^']+)/)?.[1];
    expect(n(call())).not.toBe(n(call()));
  });
  it("allows 'unsafe-eval' outside production (Next dev HMR needs it)", () => {
    const prev = process.env.NODE_ENV;
    try {
      (process.env as Record<string, string>).NODE_ENV = 'development';
      expect(call().headers.get('content-security-policy') ?? '').toContain("'unsafe-eval'");
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prev ?? 'test';
    }
  });
  it("forbids 'unsafe-eval' in production (strict CSP preserved)", () => {
    const prev = process.env.NODE_ENV;
    try {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      expect(call().headers.get('content-security-policy') ?? '').not.toContain("'unsafe-eval'");
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prev ?? 'test';
    }
  });
});
