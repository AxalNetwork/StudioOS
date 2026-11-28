/**
 * D8688 (#8688), part 2 — Playwright for the role qualification's 390 px browser pass.
 *
 * Separate from `../visual` on purpose: this suite's server (`server.ts`) holds
 * only the qualification's synthetic fixtures, because its fail-closed guard
 * refuses a database with any account outside `qualification.invalid`, and the
 * visual suite's database holds other suites' accounts. It also serves a second
 * deployment, the test-territory branch, which the visual server does not.
 *
 * One worker, no retries, a 390 × 844 phone viewport at device scale 1, UTC,
 * en-US, reduced motion; service workers blocked; every request off 127.0.0.1
 * aborted. No screenshots or baselines: the pass records pass or fail per row
 * in the `--phone` format of `scripts/qualification/role-matrix.mjs`
 * (`ROLE_QUALIFICATION_PHONE`, default `test-results/role-phone-390.json`).
 *
 *   npm run build                                   (repo root: builds docs/)
 *   cd frontend && npx playwright test -c tests/qualification/playwright.config.mjs
 *   node scripts/qualification/role-matrix.mjs --phone frontend/tests/qualification/test-results/role-phone-390.json
 *
 * `PW_CHROMIUM_PATH` points Playwright at a Chromium it did not download.
 */
import { defineConfig } from '@playwright/test';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PORT = Number(process.env.QUALIFICATION_PORT || 4795);
const CI = Boolean(process.env.CI);
const PHONE = process.env.ROLE_QUALIFICATION_PHONE || fileURLToPath(new URL('./test-results/role-phone-390.json', import.meta.url));

// The rows merge their results into PHONE as each ends (a failed row restarts the worker). Start every run
// empty, once: the runner loads this file without TEST_WORKER_INDEX, each worker with it.
if (!process.env.TEST_WORKER_INDEX) rmSync(PHONE, { force: true });

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs$/,
  outputDir: './test-results/runs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: CI,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: false,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    trace: 'off',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs frontend/tests/qualification/server.ts',
    cwd: ROOT,
    env: { PORT: String(PORT) },
    url: `http://127.0.0.1:${PORT}/__qualification/manifest`,
    // Never reuse: a reused server holds the last run's drafts, and every row starts from the seeded state.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
