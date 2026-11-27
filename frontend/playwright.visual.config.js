/**
 * D1511 (#3762, deck v2 A18) — the visual-regression and axe suites on the
 * Pitch deck editor (`tests/visual/`). Unlike `playwright.config.js`, which
 * smokes a deployed preview, this one starts its own Vite dev server and
 * mounts the editor with stubbed reads, so it needs no Worker and no network.
 *
 * Screenshots are compared only in the pinned container of
 * `.github/workflows/deck-visual.yml` (the Playwright image matching
 * @playwright/test), with the fonts pinned in `package.json`. Locally, set
 * PW_CHROMIUM to a Chromium binary to run them; a laptop's pixels are never a
 * baseline.
 */
import { defineConfig } from '@playwright/test';

const PORT = 4179;

export default defineConfig({
  testDir: './tests/visual',
  testMatch: /.*\.visual\.spec\.js$/,
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  timeout: 180_000,
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' } },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/tests/visual/harness.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
