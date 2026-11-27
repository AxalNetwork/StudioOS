/** #6262: zone-visible credits, spend payload and unknown/zero controls on desktop/phone. */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';

async function open(page, request, initialBalance = 1) {
  const m = await prepare(page, request, { as: 'security' }); const user = { ...m.security.user, role: 'investor', is_superadmin: false, kyc_status: 'approved' };
  await page.addInitScript((user) => { localStorage.setItem('user', JSON.stringify(user)); localStorage.setItem('viewMode', 'investor'); }, user);
  const state = { balance: initialBalance, fail: false, writes: [] };
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: user });
    if (path === '/api/onboarding/progress') return route.fulfill({ json: { flow: 'investor', completed_at: '2026-10-01' } });
    if (path === '/api/introductions/propositions') return route.fulfill(state.fail ? { status: 503, json: { detail: 'Synthetic introduction read failure' } }
      : { json: { credits: state.balance == null ? null : { balance: state.balance }, propositions: [{ uid: 'intro-6262', status: 'pending', counterpart_status: 'accepted', target: { name: 'Synthetic Counterpart' } }] } });
    if (/\/introductions\/propositions\/intro-6262\/(accept|decline)$/.test(path)) {
      state.writes.push({ path, method: req.method() }); state.balance = 0;
      return route.fulfill({ json: { status: path.endsWith('accept') ? 'accepted' : 'declined', credits: { balance: 0 } } });
    }
    return route.fulfill({ json: { items: [], introductions: [], relationships: [] } });
  });
  await page.goto('/network/introductions');
  await expect(page.getByTestId('card-introduction-intro-6262')).toBeVisible(); return state;
}

test('zone header shows actual credits and Accept spends one through the existing route', async ({ page, request }) => {
  const state = await open(page, request);
  await expect(page.getByTestId('intro-credit-summary')).toContainText('1 credit available');
  await expect(page.getByTestId('intro-cost-intro-6262')).toContainText('Accepting uses 1 credit');
  await expect(page.getByTestId('intro-counterpart-intro-6262')).toContainText('Other side: Agreed');
  await page.getByTestId('button-accept-intro-intro-6262').click();
  await expect(page.getByTestId('intro-credit-summary')).toContainText('0 credits available');
  expect(state.writes).toEqual([{ path: '/api/introductions/propositions/intro-6262/accept', method: 'POST' }]);
});

test('phone zero and failed refresh disable Accept while keeping Decline available', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await open(page, request, 0);
  const accept = page.getByTestId('button-accept-intro-intro-6262'), decline = page.getByTestId('button-decline-intro-intro-6262');
  await expect(accept).toBeDisabled(); await expect(decline).toBeEnabled();
  await expect(page.getByTestId('intro-credit-summary')).toContainText('Insufficient credits');
  state.fail = true; await page.getByTestId('intro-credit-retry').click();
  await expect(page.getByTestId('intro-credit-summary')).toContainText('Could not be read');
  await expect(page.getByTestId('intro-credit-summary')).not.toContainText('0 credits available');
  await expect(accept).toBeDisabled(); await expect(decline).toBeEnabled();
  await decline.click();
  expect(state.writes).toEqual([{ path: '/api/introductions/propositions/intro-6262/decline', method: 'POST' }]);
});

test('a successful read with no balance never prints an invented zero', async ({ page, request }) => {
  await open(page, request, null);
  await expect(page.getByTestId('intro-credit-summary')).toContainText('Could not be read');
  await expect(page.getByTestId('intro-credit-summary')).not.toContainText('0 credits');
  await expect(page.getByTestId('button-accept-intro-intro-6262')).toBeDisabled();
  await expect(page.getByTestId('button-decline-intro-intro-6262')).toBeEnabled();
});
