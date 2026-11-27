/** #6146: actual deal-flow peek navigation, lazy events and independent retry. */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';

for (const phone of [false, true]) test(`peek history ${phone ? 'phone failure and retry' : 'desktop recorded chronology'}`, async ({ page, request }) => {
  const m = await prepare(page, request, { as: 'security' });
  const user = { ...m.security.user, role: 'investor', is_superadmin: false, kyc_status: 'approved' };
  await page.addInitScript((user) => { localStorage.setItem('user', JSON.stringify(user)); localStorage.setItem('viewMode', 'investor'); }, user);
  if (phone) await page.setViewportSize({ width: 390, height: 844 });
  let fail = phone; const reads = [];
  await page.route('**/api/**', async route => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: user });
    if (path === '/api/onboarding/progress') return route.fulfill({ json: { flow: 'investor', completed_at: '2026-10-01' } });
    if (path === '/api/deals/flow') return route.fulfill({ json: { scope: 'firm', items: [{ uid: 'flow-7', deal_id: 7, venture: 'Synthetic Venture', stage: 'passed', round_status: 'active', entered_via: 'invited', can_open: true,
      note: 'Keep the rest of the peek', pass: { reason: 'valuation', passed_at: '2026-11-14 10:00:00', revisit: 'date', revisit_at: '2026-12-01' } }] } });
    if (path === '/api/deals') return route.fulfill({ json: [{ id: 7, project_name: 'Synthetic Venture', currency: 'USD', status: 'active' }] });
    if (path === '/api/deals/flow/7/events') {
      reads.push(req.method());
      return route.fulfill(fail ? { status: 503, json: { detail: 'Synthetic history failure' } } : { json: { items: [
        { kind: 'entered', to: 'sourcing', at: '2026-10-01 10:00:00', by: { name: 'First Actor' } },
        { kind: 'passed', from: 'diligence', to: 'passed', reason: 'valuation', at: '2026-11-14 10:00:00', by: null }] } });
    }
    return route.fulfill({ json: { items: [], views: [], weights: {}, by_stage: {} } });
  });
  await page.goto('/deals?view=table&stage=passed');
  await page.getByTestId('dealflow-peek-7').click();
  const peek = page.getByTestId('dealflow-peek');
  await expect(peek).toContainText('Keep the rest of the peek');
  expect(reads).toEqual([]);
  await page.getByTestId('dealflow-history-toggle').click();
  if (phone) {
    await expect(peek).toContainText('History is unreadable');
    await expect(peek.getByTestId('dealflow-peek-compare')).toBeVisible();
    await expect(peek).toContainText('Keep the rest of the peek');
    fail = false; await page.getByTestId('dealflow-history-retry').click();
  }
  const events = page.getByTestId('dealflow-history-event');
  await expect(events).toHaveCount(2);
  await expect(events.first()).toContainText('Passed');
  await expect(events.first()).toContainText('By: Not recorded');
  await expect(events.last()).toContainText('Invited by the studio');
  await expect(peek.getByTestId('dealflow-current-return')).toContainText('Current pass · return date: 2026-12-01');
  expect(reads).toEqual(phone ? ['GET', 'GET'] : ['GET']);
});
