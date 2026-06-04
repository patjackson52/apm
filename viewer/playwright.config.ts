import { defineConfig, devices } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;
const here = dirname(fileURLToPath(import.meta.url));

// The viewer's own /api/files Next route resolves local images under this root.
// The render-security spec references ![local](ok.png); e2e/fixtures/ok.png lives here.
const FIXTURE_ROOT = join(here, 'e2e', 'fixtures');

export default defineConfig({
  testDir: './e2e',
  use: { baseURL },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { APM_PROJECT_ROOT: FIXTURE_ROOT },
  },
});
