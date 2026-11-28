/** #6287 part 2 (D6287-p2): Investor Firm Settings' status blocks, deal fit after save and Team seats at 390 and 1440, light and dark, reads stubbed. Every firm, deal and address is made up. */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';
test.setTimeout(90_000);

const PROFILE = {
  firm_name: 'Example Firm', investor_type: 'angel', ticket_band: '$50k-$250k', sectors: ['Climate', 'Energy'], stages: ['Seed', 'Series A'],
  geos: ['Europe'], anti_thesis_sectors: [], anti_thesis_stages: [], value_weights: {}, accreditation_status: 'accredited', contribute_to_signals: true,
};
const crit = (stage) => [{ key: 'sector', state: 'match' }, { key: 'stage', state: stage }, { key: 'region', state: 'not_recorded' }, { key: 'ticket', state: 'not_set' }];

async function open(page, request, { width, dark = false }) {
  const m = await prepare(page, request, { as: 'security' });
  const user = { ...m.security.user, role: 'investor', is_superadmin: false, kyc_status: 'approved', investor_tier: 'institutional' };
  await page.addInitScript((u) => { localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('viewMode', 'investor'); }, user);
  await page.setViewportSize({ width, height: 900 });
  let saved = false;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()); const p = url.pathname;
    if (p === '/api/auth/me') return route.fulfill({ json: user });
    if (p === '/api/onboarding/progress') return route.fulfill({ json: { flow: 'investor', completed_at: '2026-10-01' } });
    if (p === '/api/settings/appearance') return route.fulfill({ json: { theme: dark ? 'dark' : 'light' } });
    if (p === '/api/investor-profile/me') {
      if (route.request().method() === 'PUT') { saved = true; return route.fulfill({ json: { profile: { ...PROFILE, ...route.request().postDataJSON() } } }); }
      return route.fulfill({ json: { profile: PROFILE } });
    }
    if (p === '/api/kyc/status') return route.fulfill({ json: { kyc_status: 'approved' } });
    if (p === '/api/account/licences') return route.fulfill({ json: { primary: 'investor', held: [{ licence: 'investor', label: 'Investor', is_primary: true, plan: { key: 'investor:institutional', name: 'Institutional' } }], addable: [] } });
    if (p === '/api/funds') return route.fulfill({ status: 503, json: { error: 'unavailable' } });
    if (p.startsWith('/api/investor-seats')) return route.fulfill({ json: { seats: [
      { id: 1, seat_email: 'first.colleague.with.a.long.address@example-firm.test', invited_at: '2026-10-02 10:00:00', accepted_at: '2026-10-03 10:00:00', revoked_at: null, state: 'accepted' },
      { id: 2, seat_email: 'analyst@example-firm.test', invited_at: '2026-11-14 10:00:00', accepted_at: null, revoked_at: null, state: 'invited' },
    ], cap: 4, used: 2 } });
    if (p === '/api/deals/flow') return route.fulfill({ json: { scope: 'firm', items: [
      { deal_id: 1, venture: 'Example Storage', sector: 'Climate', can_open: true },
      { deal_id: 2, venture: 'Example Robotics', sector: 'Robotics', can_open: true },
    ] } });
    if (p === '/api/deals/fit') return route.fulfill({ json: { items: [
      { deal_id: 1, state: 'recorded', criteria: crit('match') },
      { deal_id: 2, state: 'recorded', criteria: crit(saved ? 'outside' : 'match') },
    ] } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/account/portfolio/settings');
}

for (const width of [390, 1440]) {
  for (const dark of [false, true]) {
    test(`Firm Settings status, fit and seats at ${width}px${dark ? ', dark' : ''}`, async ({ page, request }, testInfo) => {
      await open(page, request, { width, dark });
      await expect(page.getByRole('heading', { level: 1, name: 'Firm Settings' })).toBeVisible();
      await expect(page.getByTestId('firm-status-identity')).toContainText('Verified');
      await expect(page.getByTestId('firm-status-funds')).toContainText('Funds could not be read.');
      await expect(page.getByTestId('team-seats')).toContainText('2 seats left');
      await page.getByLabel('Firm name').fill('Example Firm Two');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByTestId('fit-compare')).toContainText('Example Robotics: Stage moved Match → Outside');
      if (width < 768) await expect(page.locator('[data-testid="deal-fit"] table')).toBeHidden();
      else await expect(page.locator('[data-testid="deal-fit"] table')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.setViewportSize({ width, height: width < 768 ? 3600 : 2000 });
      await page.screenshot({ path: testInfo.outputPath(`firm-settings-${width}${dark ? '-dark' : ''}.png`), fullPage: true });
    });
  }
}
