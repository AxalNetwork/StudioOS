/** #5035 — exercise the mounted Support route with synthetic HQ and branch reads. */
import { test, expect } from '@playwright/test';
import { CONSENT_VERSION } from '../../src/lib/cookieConsent.js';

const path = '/admin/hq-support';
const operator = { id: 5035, name: 'Support operator', role: 'admin', is_super_admin: 1 };
const readAt = '2026-11-12T10:00:00Z';
const ticket = { id: 5, title: 'Billing question', requester: 'Test operator', sla_band: 'past', age_hours: 49 };
const unavailable = { value: null, why: 'unreadable', reason: 'The branch did not answer.' };
const branch = { code: 'fr', label: 'France', state: 'unreadable', reason: unavailable.reason };
const matrix = { available: true, rows: [
  { key: 'hq', kind: 'hq', label: 'HQ', hq_held: { value: 1 } },
  { key: 'fr', kind: 'licence', label: 'France', branch_code: 'fr', escalations: { value: 2 }, about_admin: unavailable },
] };

async function visitSupport(page, { waitForBranches } = {}) {
  let open = ['Invoice approval', 'Renewal request'].map((subject, i) => ({
    uid: `case-${i}`, subject, kind: 'other', branch_code: 'fr', sla: i ? 'ok' : 'past', age_hours: i ? 2 : 80,
  }));
  const decisions = [];
  const writes = [];
  let resendAttempts = 0;
  function local() {
    const bands = { past: open.filter(x => x.sla === 'past').length, due_soon: 0, ok: open.filter(x => x.sla === 'ok').length };
    return {
      read_at: readAt,
      escalations: { available: true, complete: true, count: open.length, bands, items: open },
      tickets: { available: true, complete: true, open: 1, buckets: {
        hq_held: { count: 1, bands: { past: 1, due_soon: 0, ok: 0 }, items: [ticket] },
        admin_product: { count: 0, bands: { past: 0, due_soon: 0, ok: 0 }, items: [] },
      } },
      recent_decisions: { available: true, items: decisions },
    };
  }
  await page.addInitScript(({ user, consentVersion }) => {
    localStorage.setItem('token', 'synthetic-support-session');
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('hqView', '1');
    localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ version: consentVersion, decided: true, categories: { essential: true } }));
  }, { user: operator, consentVersion: CONSENT_VERSION });
  await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
  await page.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/me' || pathname === '/api/me') return route.fulfill({ json: operator });
    if (pathname === '/api/onboarding/progress') return route.fulfill({ json: { completed_at: readAt } });
    if (pathname === '/api/settings') return route.fulfill({ json: {} });
    if (pathname === '/api/admin/hq-support/local') return route.fulfill({ json: local() });
    if (pathname === '/api/admin/hq-support') {
      await waitForBranches;
      return route.fulfill({ json: { ...local(), branch_tickets: { lines: [branch] }, matrix } });
    }
    if (request.method() === 'POST' && pathname === '/api/admin/escalations/case-0/resend') {
      resendAttempts += 1;
      if (resendAttempts === 1) return route.fulfill({ status: 502, json: { error: 'unavailable' } });
      const stored = decisions.find(row => row.uid === 'case-0');
      const pushAt = '2026-11-12T10:01:00Z';
      Object.assign(stored, { push_ok: 1, push_reason: null, push_at: pushAt });
      return route.fulfill({ json: { ...stored, pushed: { ok: true, push_at: pushAt } } });
    }
    if (request.method() === 'PATCH' && pathname.startsWith('/api/admin/escalations/')) {
      const item = open.find(row => pathname.endsWith(`/${row.uid}`));
      if (item) {
        const decision = { ...item, ...request.postDataJSON(), answered_at: readAt };
        open = open.filter(row => row !== item);
        decisions.unshift({ ...decision, push_ok: 0, push_at: readAt, push_reason: branch.reason });
        writes.push(request.postDataJSON());
        return route.fulfill({ json: { ...decision, pushed: { ok: false, reason: branch.reason } } });
      }
    }
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
  await page.goto(path);
  return writes;
}

test('keyboard decisions restore focus to the opener, next row and empty queue', async ({ page }) => {
  const writes = await visitSupport(page);
  const first = page.getByRole('button', { name: /Review .*Invoice approval/ });
  const next = page.getByRole('button', { name: /Review .*Renewal request/ });
  const sheet = page.getByRole('dialog', { name: /Invoice approval/ });
  await first.press('Enter');
  const answer = sheet.getByRole('radio', { name: /Record answer/ });
  await expect(answer).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(sheet.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  const submit = sheet.getByRole('button', { name: 'Record answer', exact: true });
  await expect(submit).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(sheet.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(first).toBeFocused();

  await page.keyboard.press('Space');
  await expect(answer).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(sheet.getByRole('radio', { name: /Decline/ })).toBeChecked();
  await sheet.getByRole('button', { name: 'Record the decline' }).press('Enter');
  const reason = sheet.getByRole('textbox', { name: /Reason for declining/ });
  await expect(reason).toHaveAttribute('aria-invalid', 'true');
  await expect(reason).toHaveAccessibleDescription(/A decline needs its reason/);
  expect(writes).toEqual([]);
  await reason.fill('Use the agreed terms.');
  await sheet.getByRole('button', { name: 'Record the decline' }).press('Enter');
  await expect(sheet.getByRole('status')).toContainText('Declined · Recorded at HQ');
  await expect(sheet.getByRole('status')).toContainText('Not delivered to France');
  await sheet.getByRole('button', { name: 'Back to the queue' }).press('Enter');
  await expect(next).toBeFocused();
  await page.keyboard.press('Enter');
  const lastSheet = page.getByRole('dialog', { name: /Renewal request/ });
  await lastSheet.getByRole('textbox', { name: /Answer/ }).fill('Approved.');
  await lastSheet.getByRole('button', { name: 'Record answer', exact: true }).press('Enter');
  await expect(lastSheet.getByRole('status')).toContainText('Answered · Recorded at HQ');
  await lastSheet.getByRole('button', { name: 'Back to the queue' }).press('Enter');
  await expect(page.getByTestId('hq-support-tab-queue')).toBeFocused();
  expect(writes).toEqual([{ answer: 'Use the agreed terms.', status: 'declined' }, { answer: 'Approved.', status: 'answered' }]);
  await page.getByTestId('hq-support-tab-delivery').press('Enter');
  await page.reload();
  const delivery = page.getByTestId('hq-support-delivery');
  await expect(delivery.getByTestId('hq-support-recorded-item')).toHaveCount(2);
  await expect(delivery.getByRole('button', { name: 'Send again' })).toHaveCount(2);
  const invoice = delivery.getByTestId('hq-support-recorded-item').filter({ hasText: 'Invoice approval' });
  const resend = invoice.getByRole('button', { name: 'Send again' });
  await resend.press('Enter');
  await expect(invoice.getByRole('alert')).toContainText('Send again to retry');
  await resend.press('Enter');
  await expect(invoice.getByRole('status')).toContainText('fr received it');
  await page.reload();
  await expect(invoice.getByRole('status')).toContainText('fr received it');
  await expect(resend).toHaveCount(0);
  expect(writes).toHaveLength(2);
});

for (const width of [390, 1280]) {
  test(`HQ tickets and the subsidiary matrix fit the ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const { promise, resolve } = Promise.withResolvers();
    await visitSupport(page, { waitForBranches: promise });
    const phone = width === 390;
    const tickets = page.getByTestId(phone ? 'hq-support-tickets-list' : 'hq-support-tickets-table');
    await expect(tickets.getByRole('link', { name: ticket.title })).toBeVisible();
    await expect(tickets).toContainText('Past SLA');
    const bounds = await tickets.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    await expect(page.getByTestId(phone ? 'hq-support-tickets-table' : 'hq-support-tickets-list')).toBeHidden();
    const branches = page.getByTestId('hq-support-tab-branches');
    await branches.press('Enter');
    await expect(page.getByTestId('hq-support-branches').getByRole('status')).toContainText('Asking each subsidiary');
    resolve();
    await expect(page.getByTestId('hq-support-branch-card-fr')).toContainText('Unavailable');
    const table = page.getByRole('table', { name: /Open items by subsidiary/ });
    await expect(table.getByRole('row', { name: /France/ })).toContainText('Unreadable');
    const dimensions = await table.evaluate(el => {
      const scroll = el.parentElement;
      scroll.scrollLeft = scroll.scrollWidth;
      return { scrolled: scroll.scrollLeft, windowWidth: document.documentElement.clientWidth,
        pageWidth: document.documentElement.scrollWidth, rightEdge: el.getBoundingClientRect().right };
    });
    expect(dimensions.pageWidth).toBeLessThanOrEqual(dimensions.windowWidth);
    expect(dimensions.rightEdge).toBeLessThanOrEqual(dimensions.windowWidth + 1);
    expect(dimensions.scrolled > 0).toBe(phone);
  });
}
