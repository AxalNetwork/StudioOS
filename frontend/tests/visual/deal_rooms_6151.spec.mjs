/** #6151 (D6151): Deal rooms built to DE19 to DE24, at 1440 and 390, light and dark, its four reads stubbed. Every venture is made up. */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';
test.setTimeout(60_000);

const DEALS = [
  { id: 1, project_name: 'Example Robotics', project_sector: 'Robotics', status: 'active', currency: 'USD', target_raise: 2000000, instrument: 'safe', capital_committed: 1200000, can_read: true, is_member: 0 },
  { id: 2, project_name: 'Example Harbor', project_sector: 'AI tooling', status: 'active', currency: 'USD', target_raise: 1000000, instrument: 'safe', capital_committed: 450000, can_read: false, is_member: 1 },
  { id: 3, project_name: 'Example Ridgeback', project_sector: 'Security', status: 'active', currency: 'USD', target_raise: 2200000, instrument: 'safe', capital_committed: 900000, is_member: 0 },
  { id: 4, project_name: 'Example Orchard', project_sector: 'Agritech', status: 'scored', currency: 'USD', target_raise: 600000, instrument: 'safe', capital_committed: 0, can_read: false, is_member: 0 },
  { id: 5, project_name: 'Example Tessellate', project_sector: null, status: 'applied', currency: 'USD', target_raise: null, amount: null, instrument: null, capital_committed: 0, can_read: false, is_member: 0 },
  { id: 6, project_name: 'Example Passed', status: 'rejected', can_read: true },
];

async function open(page, request, { width, dark = false, quota = { used: 3, cap: 5, unlimited: false, full: false, tier: 'professional', member_deal_ids: [2, 9] } }) {
  const m = await prepare(page, request, { as: 'security' });
  const user = { ...m.security.user, role: 'investor', is_superadmin: false, kyc_status: 'approved' };
  await page.addInitScript((u) => { localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('viewMode', 'investor'); }, user);
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: user });
    if (path === '/api/onboarding/progress') return route.fulfill({ json: { flow: 'investor', completed_at: '2026-10-01' } });
    if (path === '/api/settings/appearance') return route.fulfill({ json: { theme: dark ? 'dark' : 'light' } });
    if (path === '/api/deals') return route.fulfill({ json: DEALS });
    if (path === '/api/deals/dealroom/quota') return route.fulfill({ json: quota });
    if (path === '/api/deals/invitations/mine') return route.fulfill({ json: [{ deal_id: 1, status: 'interested', created_at: '2026-10-01 09:00:00', responded_at: '2026-10-03 10:00:00' }] });
    if (path === '/api/deals/flow') return route.fulfill({ json: { scope: 'firm', items: [{ deal_id: 1, stage: 'screening' }, { deal_id: 3, stage: 'passed' }], by_stage: {} } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/deals/rooms');
  await expect(page.getByTestId('dr-pipeline')).toBeVisible();
}

for (const width of [1440, 390]) {
  for (const dark of [false, true]) {
    test(`DE19 / DE23 / DE24 Deal rooms at ${width}px${dark ? ', dark' : ''}`, async ({ page, request }, testInfo) => {
      await open(page, request, { width, dark });
      if (dark) await expect(page.locator('html')).toHaveClass(/dark/);
      await expect(page.getByTestId('dr-quota')).toContainText('3 of 5 rooms used');
      await expect(page.getByTestId('dr-quota')).toContainText('2 under this firm');
      await expect(page.getByTestId('dr-filter-all-count')).toHaveText('5');
      const scope = page.getByTestId(width < 768 ? 'dr-cards' : 'dr-pipeline-rows');
      await expect(scope).toBeVisible();
      await expect(scope).toContainText('Interested');
      await expect(scope).toContainText('Invitation requested');
      await expect(scope).toContainText('! Access unreadable');
      await expect(scope).toContainText('— Ask not recorded');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.setViewportSize({ width, height: width < 768 ? 2600 : 1300 });
      await page.screenshot({ path: testInfo.outputPath(`de19-${width}${dark ? '-dark' : ''}.png`) });
    });
  }
  test(`DE20 allowance full at ${width}px: Request opens the full message, not the review`, async ({ page, request }, testInfo) => {
    await open(page, request, { width, quota: { used: 2, cap: 2, unlimited: false, full: true, tier: 'plus', upgrade_to: 'professional', upgrade_cap: 5, member_deal_ids: [2] } });
    await expect(page.getByTestId('dr-quota')).toContainText('You are in 2 of 2 rooms on the Plus plan. Leave a room, or move to Professional for 5.');
    await page.locator('[data-testid="dr-join"]:visible').first().click();
    await expect(page.getByTestId('dr-request-dialog')).toHaveCount(0);
    await expect(page.locator('[data-testid="dr-row-refusal"]:visible').first()).toContainText('Allowance full');
    await page.screenshot({ path: testInfo.outputPath(`de20-full-${width}.png`) });
  });
}
