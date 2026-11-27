/** #5077 BD8: real SPA, synthetic module reads; never launches a provider. */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';
test.setTimeout(60_000);

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    for (const count of [0, 2]) {
      test(`Lovable belongs to Sources at ${width}px, ${theme}, ${count} must-haves`, async ({ page, request }, testInfo) => {
        const m = await prepare(page, request);
        const projectId = m.oneClick.projectId;
        await page.setViewportSize({ width, height: 900 });
        if (theme === 'dark') await page.route('**/api/settings/appearance', route => route.request().method() === 'GET' ? route.fulfill({ json: { theme } }) : route.continue());
        let reads = 0;
        let writes = 0;
        page.on('request', r => { if (r.url().includes('/lovable/') && r.method() !== 'GET') writes += 1; });
        await page.route('**/api/cycles/build/modules/prototype-mvp*', route => {
          reads += 1;
          return route.fulfill({ json: {
            card: { slug: 'prototype-mvp', name: 'Prototype / MVP', state: count ? 'too_little' : 'empty', series: [], reason: 'Synthetic module for layout verification.', next: null },
            module: { slug: 'prototype-mvp', name: 'Prototype / MVP', records_title: 'Must-haves' },
            records: { cols: [{ key: 'must_have', label: 'Must-have' }], total: count, page: 1, page_size: 25,
              rows: Array.from({ length: count }, (_, i) => ({ id: i + 1, cells: { must_have: `Synthetic must-have ${i + 1}` } })) },
            facts: { done: 0, total: count, blocked: 0, target_date: null, can_set_target: false },
            parts: { lovable: { state: reads === 1 ? 'unreadable' : 'ok', slots: [], launch: { project_id: projectId, record: { id: projectId, title: 'Prototype / MVP' }, can_launch: true, opened_at: null } } },
          } });
        });
        await page.goto(`/build/prototype-mvp?project_id=${projectId}`);
        await page.waitForLoadState('networkidle');
        const sources = page.getByTestId('module-sources');
        await expect(sources).toBeAttached();
        if (!count) {
          await expect(sources).toHaveAttribute('data-stage', 'zero');
          await expect(sources).not.toHaveAttribute('open', '');
          await sources.locator('summary').press('Enter');
          await expect(sources).toHaveAttribute('open', '');
        }
        const source = sources.getByTestId('cycle-part-lovable');
        const launch = source.getByRole('button', { name: 'Prepare a Lovable prompt', exact: true });
        await expect(launch).toBeVisible();
        await expect(page.getByTestId('lovable-build')).toHaveCount(1);
        await expect(page.getByTestId(width === 390 ? 'phone-module-next' : 'cycle-records').getByTestId('lovable-build')).toHaveCount(0);
        await expect(source.getByTestId('lovable-retry')).toBeVisible();
        await source.getByTestId('lovable-retry').click();
        await expect(source.getByTestId('lovable-retry')).toHaveCount(0);
        // The existing retry re-reads the module; its zero-state disclosure
        // can remount closed. The handoff remains reachable after reopening.
        if (!count && !(await sources.evaluate(el => el.open))) {
          await sources.locator('summary').press('Enter');
          await expect(sources).toHaveAttribute('open', '');
        }
        await expect(launch).toBeVisible();
        await launch.focus();
        await expect(launch).toBeFocused();
        expect((await launch.boundingBox()).height).toBeGreaterThanOrEqual(44);
        expect(await source.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
        await page.screenshot({ path: testInfo.outputPath(`lovable-sources-${width}-${theme}-${count}.png`), fullPage: true });
        expect(writes).toBe(0);
      });
    }
  }
}
