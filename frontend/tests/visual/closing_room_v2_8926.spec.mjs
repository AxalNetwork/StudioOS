/**
 * #8926 (D8926): the investor's closing room built to the #6188 v2 canvas (DE35 to DE41), at 1440 and 390,
 * light and dark, with its reads stubbed. Every venture, name and figure is made up.
 */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';
test.setTimeout(60_000);

const DEAL = { id: 7, project_id: 5, project_name: 'Example Robotics', project_sector: 'Robotics', status: 'active', currency: 'USD', target_raise: 1500000, instrument: 'safe', capital_committed: 620000, can_read: true, is_member: 1, closing_deadline: '2026-12-20' };
const stage = (position, role, state, extra = {}) => ({ position, role, name: null, state, sent_at: '2026-11-08', signed_at: null, ...extra });
const PAPERS = {
  sign: [{ uid: 's1', title: 'SAFE', complete: false, countersign: true, voided: false, stages: [stage(1, 'investor', 'sent', { name: 'Example Ventures' }), stage(2, 'company', 'waiting', { name: 'Founder A' }), stage(3, 'axal', 'waiting')] }],
  done: [{ uid: 's1', title: 'SAFE', complete: true, countersign: true, voided: false, stages: [stage(1, 'investor', 'signed', { name: 'Example Ventures', signed_at: '2026-11-14' }), stage(2, 'company', 'signed', { name: 'Founder A', signed_at: '2026-11-14' }), stage(3, 'axal', 'signed', { signed_at: '2026-11-14' })] }],
};
const LINE = { uid: 'l2', commitment_id: 12, prospect_id: null, investor_name: 'Example Ventures', route: 'direct', amount_cents: 10000000, currency: 'USD', status: 'open', vehicle_ref: null, evidence: [] };
const PART = { project_uid: 'proj-example', conditions: { waiting_on_you: [{ line_uid: 'l2', step: 'sign' }], rest: { your_lines: 0, other_lines: 3, round: 1 }, rest_count: 4 }, summary: [], reporting: { state: 'not_closed', duties: [] } };
const CLOSING = (over = {}) => ({
  uid: 'c7', deal_id: 7, project_id: 5, round_label: 'Seed', instrument: 'SAFE', currency: 'USD', status: 'open', deadline: '2026-11-25', created_at: '2026-10-08 10:00:00',
  reach: 'own', total_cents: 72000000, line_count: 4, captable: { state: 'not_ready', decided_at: null }, lines: [LINE], events: null, closed_at: null, for_investor: PART, ...over,
});
const CONDITIONS = { items: [
  { uid: 'k1', deal_id: 7, decision_title: 'Example Ventures · decision of 10 Oct 2026', body: 'Confirm the option pool top-up is inside the cap', status: 'open', created_at: '2026-10-10', resolved_at: null },
  { uid: 'k2', deal_id: 7, decision_title: 'Example Ventures · decision of 10 Oct 2026', body: 'Reference calls with two pilot customers', status: 'met', created_at: '2026-10-10', resolved_at: '2026-10-12' },
  { uid: 'k3', deal_id: 7, decision_title: 'Example Ventures · decision of 10 Oct 2026', body: 'Information rights side letter', status: 'waived', created_at: '2026-10-10', resolved_at: '2026-10-12' },
] };
const ACCOUNT = { uid: 'a1', revision: 2, created_at: '2026-10-13T09:00:00Z', payee_name: 'Example Robotics, Inc.', bank_name: 'Example Bank', account_number: '••••3392', routing_number: '000000000', swift_code: null, currency: 'USD', payment_reference: 'EXAMPLE-SEED' };

async function open(page, request, { width, dark = false, closing = CLOSING(), papers = PAPERS.sign, closings = [{ uid: 'c7', deal_id: 7, project_id: 5, project_name: 'Example Robotics', round_label: 'Seed', instrument: 'SAFE', status: 'open', reach: 'own' }] }) {
  const m = await prepare(page, request, { as: 'security' });
  const user = { ...m.security.user, role: 'investor', is_superadmin: false, kyc_status: 'approved' };
  await page.addInitScript((u) => { localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('viewMode', 'investor'); }, user);
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: user });
    if (path === '/api/onboarding/progress') return route.fulfill({ json: { flow: 'investor', completed_at: '2026-10-01' } });
    if (path === '/api/settings/appearance') return route.fulfill({ json: { theme: dark ? 'dark' : 'light' } });
    if (path === '/api/deals') return route.fulfill({ json: [DEAL] });
    if (path === '/api/deals/7') return route.fulfill({ json: DEAL });
    if (path === '/api/deals/7/commitments') return route.fulfill({ json: [{ id: 12, uid: 'k-12', deal_id: 7, amount: 100000, status: 'pending', investor_name: 'Example Ventures', created_at: '2026-10-04' }] });
    if (path === '/api/closings') return route.fulfill({ json: { closings } });
    if (path === '/api/closings/c7') return route.fulfill({ json: closing });
    if (path === '/api/legal/esign/staged/line/12') return route.fulfill({ json: { envelopes: papers } });
    if (path === '/api/mercury/investor/proposals') return route.fulfill({ json: { proposals: [] } });
    if (path === '/api/ic/conditions') return route.fulfill({ json: CONDITIONS });
    if (path === '/api/closings/company-receiving-accounts/5') return route.fulfill({ json: { recorded: true, account: ACCOUNT } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/deals/7/closing');
  await expect(page.getByTestId('closing-room')).toBeVisible();
}

const shoot = async (page, testInfo, width, name) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width, height: width < 768 ? 2400 : 1500 });
  await page.screenshot({ path: testInfo.outputPath(name), fullPage: true });
};

for (const width of [1440, 390]) {
  for (const dark of [false, true]) {
    test(`DE35 / DE40a / DE41 the investor's closing room at ${width}px${dark ? ', dark' : ''}`, async ({ page, request }, testInfo) => {
      await open(page, request, { width, dark });
      if (dark) await expect(page.locator('html')).toHaveClass(/dark/);
      await expect(page.getByTestId('closing-head')).toContainText('Example Robotics · Seed round');
      await expect(page.getByTestId('closing-steps')).toContainText(width < 768 ? 'Step 2 of 7 · Sign' : 'Now · Your signature is next');
      await expect(page.getByTestId('closing-review-sign')).toHaveText('Review and sign');
      await shoot(page, testInfo, width, `de35-${width}${dark ? '-dark' : ''}.png`);
    });
  }
  test(`DE36 the payment sheet at ${width}px`, async ({ page, request }, testInfo) => {
    await open(page, request, { width, papers: PAPERS.done });
    await page.getByTestId('closing-see-instructions').click();
    await expect(page.getByTestId('closing-pay-changed')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`de36-${width}.png`) });
  });
  test(`DE37 after Closed at ${width}px`, async ({ page, request }, testInfo) => {
    const closed = CLOSING({
      status: 'closed', closed_at: '2026-10-18T10:00:00Z', captable: { state: 'accepted', decided_at: '2026-10-17' },
      lines: [{ ...LINE, status: 'received', evidence: [{ uid: 'e3', kind: 'company_mercury', side: 'receiving', created_at: '2026-10-16' }] }],
      for_investor: { ...PART, summary: [{ line_uid: 'l2', amount_cents: 10000000, currency: 'USD', signed_at: '2026-10-14', received_at: '2026-10-16', signed_copy: { envelope_id: 55 } }], reporting: { state: 'ok', duties: [] } },
    });
    await open(page, request, { width, closing: closed, papers: PAPERS.done });
    await expect(page.getByTestId('closing-portfolio-link')).toBeVisible();
    await shoot(page, testInfo, width, `de37-${width}.png`);
  });
  test(`DE38 no closing opened yet at ${width}px`, async ({ page, request }, testInfo) => {
    await open(page, request, { width, closings: [] });
    await expect(page.getByTestId('closing-not-opened')).toBeVisible();
    await shoot(page, testInfo, width, `de38-${width}.png`);
  });
}
