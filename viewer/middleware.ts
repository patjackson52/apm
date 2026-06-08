import { NextResponse, type NextRequest } from 'next/server';

const SERVE = 'http://127.0.0.1:7842';

export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  // Next.js dev (HMR / React Fast Refresh) evaluates strings, which a strict CSP
  // blocks — crashing the client bundle (empty dashboard + stuck "Offline").
  // Allow eval in dev ONLY; production builds are eval-free, so the strict
  // nonce + strict-dynamic posture (PLAN.md security checklist) is preserved there.
  const scriptSrc =
    process.env.NODE_ENV === 'production'
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`;
  const csp = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' ${SERVE}`,
    `connect-src 'self' ${SERVE}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  const reqHeaders = new Headers(req.headers);
  reqHeaders.set('x-nonce', nonce);
  reqHeaders.set('content-security-policy', csp);

  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set('content-security-policy', csp);
  res.headers.set('x-content-type-options', 'nosniff');
  res.headers.set('referrer-policy', 'no-referrer');
  res.headers.set('x-frame-options', 'DENY');
  return res;
}

export const config = {
  matcher: [{ source: '/((?!api/|_next/static|_next/image|favicon.ico).*)' }],
};
