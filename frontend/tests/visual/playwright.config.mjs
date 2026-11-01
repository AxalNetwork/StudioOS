/**
 * D1511 (#3762, deck v2 A18) — Playwright for the editor's visual regression
 * and axe suites. Separate from `../e2e` (which runs against a deployed
 * preview): this one starts its own server (`server.ts`: the built `docs/`
 * plus the real Worker on SQLite and the fake AI binding), so it needs no
 * network, no secret and no preview.
 *
 * DETERMINISM. One worker, no retries; a fixed viewport, device scale 1,
 * UTC, en-US, reduced motion, light colour scheme; service workers blocked;
 * every request off 127.0.0.1 aborted, and Google Fonts answered from
 * `fonts/` (`_editor.mjs`). CI runs this in the pinned Playwright container
 * (`mcr.microsoft.com/playwright:v1.64.1-noble`, ci.yml `visual`), the same
 * version as `@playwright/test` in package-lock.json. `PW_CHROMIUM_PATH`
 * points at a Chromium already on disk when the version's own browser is
 * not installed (local runs only).
 *
 *   npm run build                              (repo root: builds docs/)
 *   cd frontend && npx playwright test -c tests/visual/playwright.config.mjs
 *   … --update-snapshots                       (regenerate the baselines; review every PNG)
 */
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PORT = Number(process.env.VISUAL_PORT || 4791);
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs$/,
  outputDir: './test-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: CI,
  timeout: 180_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixels: 0, threshold: 0.05, animations: 'disabled', caret: 'hide', scale: 'css' },
  },
  reporter: CI ? [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    launchOptions: {
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
      args: ['--font-render-hinting=none', '--disable-lcd-text', '--disable-skia-runtime-opts', '--force-color-profile=srgb'],
    },
  },
  webServer: {
    command: 'node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs frontend/tests/visual/server.ts',
    cwd: ROOT,
    env: { PORT: String(PORT) },
    url: `http://127.0.0.1:${PORT}/__visual/manifest`,
    reuseExistingServer: !CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
