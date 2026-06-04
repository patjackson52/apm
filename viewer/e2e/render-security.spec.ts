import { test, expect } from '@playwright/test';

// End-to-end proof of the PLAN.md render-security checklist against the REAL /sessions route,
// in a real browser. We inject an UNTRUSTED session context_summary via route-interception
// (the viewer client fetches /api/sessions from the daemon, which is cross-origin in a browser;
// intercepting keeps this a pure client-render security test, no daemon needed). The summary
// carries markdown + a mermaid fence + a remote image + a local image + an inline <script>.
const HOSTILE_SUMMARY = [
  '# Session summary',
  '',
  'A paragraph of text.',
  '',
  '```mermaid',
  'graph TD; A-->B',
  '```',
  '',
  '![remote](https://evil.example/x.png)',
  '![local](ok.png)',
  '<script>window.__pwned = 1</script>',
  '',
].join('\n');

const ENVELOPE = {
  ok: true,
  data: [
    {
      id: 'S-1',
      agent: 'e2e',
      status: 'active',
      context_summary: HOSTILE_SUMMARY,
      started_at: '2026-01-01T00:00:00.000Z',
      last_seen_at: null,
      ended_at: null,
    },
  ],
  error: null,
  meta: { api_version: 1, command: 'GET /api/sessions', ts: '2026-01-01T00:00:00.000Z' },
};

test('/sessions renders an untrusted summary safely (sanitized md+mermaid+image, CSP-clean)', async ({
  page,
}) => {
  const cspErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /content security policy|csp|refused to (load|execute|apply)/i.test(m.text())) {
      cspErrors.push(m.text());
    }
  });
  page.on('pageerror', (e) => {
    if (/content security policy|csp/i.test(String(e))) cspErrors.push(String(e));
  });

  // Intercept the client's data fetch and return the hostile envelope.
  await page.route('**/api/sessions*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ENVELOPE) }),
  );

  await page.goto('/sessions');

  // markdown rendered (the summary's H1)
  await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();

  // mermaid -> sanitized inline <svg>, no foreignObject/script descendants
  await expect(page.locator('svg').first()).toBeVisible();
  expect(await page.locator('svg foreignObject').count()).toBe(0);
  expect(await page.locator('svg script').count()).toBe(0);

  // injected <script> never executed and not present in the DOM (rehype-sanitize strips it)
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(await page.locator('script:has-text("__pwned")').count()).toBe(0);

  // remote image dropped to alt (no <img> to the remote host)
  expect(await page.locator('img[src*="evil.example"]').count()).toBe(0);

  // local image served via the VIEWER /api/files Next route (jail allowlist), resolved under
  // APM_PROJECT_ROOT (e2e/fixtures) -> 200.
  const local = page.locator('img[src*="/api/files?path="]').first();
  await expect(local).toBeVisible();
  const src = (await local.getAttribute('src')) ?? '';
  const resp = await page.request.get(new URL(src, page.url()).toString());
  expect(resp.status()).toBe(200);

  // security acceptance gate
  expect(cspErrors, `CSP violations: ${cspErrors.join(' | ')}`).toEqual([]);
});
