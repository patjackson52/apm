import { test, expect } from '@playwright/test';

test('shell loads with no CSP violations + nav works', async ({ page }) => {
  const cspErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /content security policy|csp|refused to (load|execute|apply)/i.test(m.text())) cspErrors.push(m.text());
  });
  page.on('pageerror', (e) => { if (/content security policy|csp/i.test(String(e))) cspErrors.push(String(e)); });

  await page.goto('/');
  // shell chrome
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByText('APM Viewer')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // deep-link nav
  await page.getByRole('link', { name: 'Work items' }).click();
  await expect(page).toHaveURL(/\/work$/);
  await expect(page.getByRole('heading', { name: 'Work items' })).toBeVisible();

  // ART-83 acceptance gate: no CSP violations during load/nav
  expect(cspErrors, `CSP violations: ${cspErrors.join(' | ')}`).toEqual([]);
});

test('CSP nonce header present on the document response', async ({ page }) => {
  const res = await page.goto('/');
  const csp = res?.headers()['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
});
