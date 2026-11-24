/** #6151 part 2 (D6151-p2): Screening (DE26) and Compare (DE29) at 390 and 1440, light and dark, their reads stubbed. Every venture is made up. */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';
test.setTimeout(60_000);

const sc = (scope, band, confidence_word = 'High') => ({ scope, state: 'scored', band, confidence_word });
const DEALS = [
  { id: 1, project_name: 'Example Robotics', project_sector: 'Robotics', status: 'scored', currency: 'USD', target_raise: 2000000, instrument: 'safe', can_read: true },
  { id: 2, project_name: 'Example Harbor', project_sector: 'AI tooling', status: 'active', currency: 'USD', target_raise: 1000000, instrument: 'priced', can_read: true },
  { id: 3, project_name: 'Example Copperline', project_sector: 'Energy', status: 'active', currency: 'USD', target_raise: 2500000, instrument: 'safe', can_read: true },
  { id: 4, project_name: 'Example Lumen', project_sector: 'Energy', status: 'scored', currency: 'USD', target_raise: 800000, instrument: 'safe', can_read: true },
];
const BATCH = { items: [
  { deal_id: 1, locked: false, scopes: [sc('team', 'strong'), sc('market', 'fair', 'Medium')] },
  { deal_id: 2, locked: false, scopes: [sc('team', 'fair', 'Low'), sc('market', 'weak', 'Low')] },
  { deal_id: 3, locked: false, scopes: [sc('team', 'strong', 'Medium')] },
  { deal_id: 4, locked: true, reason: 'Not shared.' },
] };

async function open(page, request, { width, dark = false, path }) {
  const m = await prepare(page, request, { as: 'security' });
  const user = { ...m.security.user, role: 'investor', is_superadmin: false, kyc_status: 'approved', subscription_tier: 'pro' };
  await page.addInitScript((u) => { localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('viewMode', 'investor'); }, user);
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()); const p = url.pathname;
    if (p === '/api/auth/me') return route.fulfill({ json: user });
    if (p === '/api/onboarding/progress') return route.fulfill({ json: { flow: 'investor', completed_at: '2026-10-01' } });
    if (p === '/api/settings/appearance') return route.fulfill({ json: { theme: dark ? 'dark' : 'light' } });
    if (p === '/api/deals/screening') return route.fulfill({ json: { desk: { available: true, total_deals: 4, rows: DEALS.map((d) => ({ deal_id: d.id, company: d.project_name, sector: d.project_sector, deal_status: d.status })) } } });
    if (p === '/api/deals/flow/passes') return route.fulfill({ json: { scope: 'you', total: 0, buckets: [], items: [] } });
    if (p === '/api/deals/flow') return route.fulfill({ json: { scope: 'firm', items: [{ deal_id: 2, stage: 'diligence', stage_changed_at: '2026-10-10 10:00:00' }], by_stage: {} } });
    if (p === '/api/deals/fit') return route.fulfill({ json: { items: [{ deal_id: 1, state: 'scored', score: 84, confidence_label: 'High' }] } });
    if (p === '/api/venture-scores/batch') return route.fulfill({ json: BATCH });
    if (p === '/api/deals') return route.fulfill({ json: DEALS });
    return route.fulfill({ json: {} });
  });
  await page.goto(path);
}

for (const width of [390, 1440]) {
  for (const dark of [false, true]) {
    test(`DE26 Screening at ${width}px${dark ? ', dark' : ''}`, async ({ page, request }, testInfo) => {
      await open(page, request, { width, dark, path: '/deals/screening' });
      if (width < 768) {
        await expect(page.getByTestId('screening-card')).toHaveCount(4);
        await expect(page.getByTestId('screening-move-1-card')).toBeVisible();
        const box = await page.getByTestId('screening-move-1-card').boundingBox();
        expect(box.width).toBeGreaterThan(280);
        expect(box.height).toBeGreaterThanOrEqual(44);
        await expect(page.locator('table')).toBeHidden();
      } else {
        await expect(page.getByTestId('screening-move-1')).toBeVisible();
        await expect(page.getByTestId('screening-cards')).toBeHidden();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.setViewportSize({ width, height: width < 768 ? 2400 : 1400 });
      await page.screenshot({ path: testInfo.outputPath(`de26-${width}${dark ? '-dark' : ''}.png`) });
    });
  }
  for (const ids of ['1,2', '1,2,3,4']) {
    test(`DE29 Compare ${ids.split(',').length} ventures at ${width}px`, async ({ page, request }, testInfo) => {
      await open(page, request, { width, path: `/deals/compare?ids=${ids}` });
      await expect(page.getByTestId('dealflow-compare-page')).toBeVisible();
      if (width < 768) {
        await expect(page.getByTestId('dealflow-compare-phone')).toBeVisible();
        await expect(page.getByTestId('dealflow-compare-table')).toBeHidden();
        await expect(page.getByTestId('dealflow-compare-legend')).toContainText('Example Robotics');
        if (ids.length > 3) await expect(page.locator('[data-testid^="dealflow-compare-phone-toggle-"][aria-expanded="true"]')).toHaveCount(1);
      } else {
        await expect(page.getByTestId('dealflow-compare-table')).toBeVisible();
        await expect(page.getByTestId('dealflow-compare-phone')).toBeHidden();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.setViewportSize({ width, height: width < 768 ? 2400 : 1600 });
      await page.screenshot({ path: testInfo.outputPath(`de29-${ids.split(',').length}-${width}.png`) });
    });
  }
}
