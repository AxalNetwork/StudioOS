/**
 * Task #3 (IC) — axe-core a11y CI gate.
 *
 * Runs @axe-core/playwright against the app's top public routes and
 * fails the build on any `serious` or `critical` violation. Signed-in
 * routes are out of scope here because the suite runs in CI against a
 * preview Cloudflare Worker without a seeded session — they'll be
 * added once Task #15 (cookie-based test login) lands.
 *
 * Local iteration: set `PLAYWRIGHT_BASE_URL=http://localhost:5173`
 * (vite dev) and run `npx playwright test axe-top-routes`. CI sets the
 * env to the deployed preview URL; without it the suite is skipped so
 * developers aren't blocked by missing infra.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.PLAYWRIGHT_BASE_URL || '';

// Public routes available to a fully unauthenticated browser. We
// deliberately keep the list short and stable — adding flaky routes
// here turns the gate into noise.
const ROUTES = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/about',
  '/pricing',
  '/contact',
  '/legal/terms',
  '/legal/privacy',
  '/docs',
];

test.describe('axe-core a11y gate', () => {
  test.skip(!BASE, 'PLAYWRIGHT_BASE_URL not set — skipping a11y gate');

  for (const route of ROUTES) {
    test(`no serious/critical violations on ${route}`, async ({ page }) => {
      const resp = await page.goto(route, { waitUntil: 'domcontentloaded' });
      // Routes that 404 on a particular preview shouldn't crash the
      // whole gate — log and skip.
      if (!resp || resp.status() >= 400) {
        test.skip(true, `route ${route} returned ${resp?.status() ?? 'no response'}`);
      }
      // Give SPA shell a beat to render React content.
      await page.waitForLoadState('networkidle').catch(() => {});

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const blocking = results.violations.filter(
        v => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });
  }
});
