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
});
