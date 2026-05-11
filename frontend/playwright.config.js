/**
 * Task #10 (AP) — Playwright config for the post-AO verification smoke
 * suite. Specs live in frontend/tests/e2e/ and run against a deployed
 * preview worker (URL injected via PLAYWRIGHT_BASE_URL).
 *
 * Why no `webServer` block: the smoke runs against the Cloudflare Preview
 * environment provisioned by AO (Task #15 follow-up), NOT a local vite
 * dev server. When PLAYWRIGHT_BASE_URL is unset (local iteration), each
 * spec calls `test.skip()` at the top so the suite is a no-op rather
 * than a misleading failure.
 */
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || '';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL || 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
