/**
 * Task #3 (IC) — axe-core a11y CI gate. #9037 (D9037): it now runs, in `ci.yml` job `visual`, on the PR's own build.
 *
 * Runs @axe-core/playwright against the app's ten top public routes, each at 1440 and 390 in light and dark, and fails
 * on any `serious` or `critical` WCAG 2.0/2.1 A or AA violation. NO EXCEPTIONS: no axe rule is disabled and no element
 * is excused. (public_journey.spec.js keeps its own named KNOWN list for the signed-in pages of its journeys; that list
 * does not apply here.)
 *
 * NO PREVIEW, NO ACCOUNT. `startLocalWorker()` (`_helpers.js`) serves the built `docs/` with the Workers assets
 * binding's single-page-application fallback, signed out: every `/api/*` read answers 401, `/api/public/*` answers
 * `{}`. Off-origin requests are aborted, and the service worker is blocked so every read reaches that local Worker.
 *
 * A route must be a real page. It must answer 200, and because the SPA fallback answers 200 for any path, it must not
 * render the catch-all NotFoundPage ("Page not found") either: a route that drifts to 404 fails, it is never skipped.
 *
 *     npm run build && cd frontend && npx playwright test -c playwright.config.js tests/e2e/axe-top-routes.spec.js
 */
import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { isolatePreviewTraffic, startLocalWorker } from './_helpers.js';

const test = base.extend({
  localWorker: [async ({}, use) => {
    const worker = await startLocalWorker();
    await use(worker);
    await worker.close();
  }, { scope: 'worker' }],
  baseURL: async ({ localWorker }, use) => use(localWorker.origin),
});
test.use({ serviceWorkers: 'block' });

// The public routes of App.jsx that a signed-out browser reaches. #9037: `/forgot-password`, `/legal/terms`,
// `/legal/privacy` and `/docs` were never routes (each fell to NotFoundPage); account recovery is `/auth/recover`, the
// legal pages are `/terms` and `/privacy`, and the guides are `/help`.
const ROUTES = ['/', '/login', '/register', '/auth/recover', '/about', '/pricing', '/contact', '/terms', '/privacy', '/help'];
const SIZES = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

for (const route of ROUTES) {
  for (const viewport of SIZES) {
    for (const colorScheme of ['light', 'dark']) {
      test(`no serious/critical violations on ${route} at ${viewport.width} ${colorScheme}`, async ({ page, context, baseURL }) => {
        await isolatePreviewTraffic(context, baseURL);
        // The theme as a visitor's own Appearance choice stores it (SettingsContext), and the browser's scheme to
        // match; a page that pins light for itself (useForcedLightTheme) stays light, as it does for that visitor.
        await page.addInitScript((theme) => {
          try { localStorage.setItem('axal_appearance_v1', JSON.stringify({ theme })); } catch { /* storage off */ }
        }, colorScheme);
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        const resp = await page.goto(route, { waitUntil: 'domcontentloaded' });
        expect(resp?.status(), `${route} answered ${resp?.status() ?? 'nothing'}`).toBe(200);
        // The page has painted its own heading (the boot screen draws none; the cookie notice's is not the page's).
        await expect(page.locator('h1, h2').filter({ hasNotText: 'We use cookies' }).first()).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('heading', { name: 'Page not found' }), `${route} rendered NotFoundPage`).toHaveCount(0);
        await page.waitForLoadState('load');

        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        const blocking = results.violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 200), summary: n.failureSummary })) }));
        expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
      });
    }
  }
}
