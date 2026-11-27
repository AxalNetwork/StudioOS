/** #5039: approved cockpit controls and governed flows with synthetic finance records. */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';

const stamp = '2026-10-20T12:00:00Z';
const period = '2026-Q4';
const reason = 'Confirmed with the subsidiary finance operator';
const statement = () => ({
  uid: 'statement-fr', licence_uid: 'fr', brand_name: 'Test France', period,
  currency: 'EUR', status: 'issued', owed_cents: 120000, paid_cents: 0, disputed_cents: 0,
  outstanding_cents: 120000, gross_cents: 400000, revenue_share_bps: 3000,
  unreported_streams: 0, estimated_streams: 0, complete: true, revision: 0,
  due_on: '2026-10-01', overdue: true, created_at: stamp, streams: [],
});
const summary = (p = period) => ({
  quarter: { key: p, label: p }, current_period: period, read_at: stamp,
  temporal: { licence_fees: 'as_of_now', licence_invoices: 'period' },
  licence_fees: { available: true, active_without_fee: 0, by_currency: [{ currency: 'EUR', licences: 1, quarter_cents: 200000 }] },
  licence_invoices: { available: true, source: 'licence_fee_invoices', as_of: stamp,
    by_currency: [{ currency: 'EUR', invoices: 1, invoiced_cents: p === '2026-Q2' ? 222200 : p === '2026-Q3' ? 333300 : 300000, collected_cents: 100000, outstanding_cents: 200000, overdue_cents: 50000, overdue_invoices: 1 }],
    receivable_by_currency: [{ currency: 'EUR', open_invoices: 1, outstanding_cents: 200000, overdue_cents: 50000, overdue_invoices: 1 }],
    overdue: [], expected_not_invoiced: [], cannot_invoice: [],
  },
  token_cost: { available: false }, promos: { available: true, active_codes: 0, redemptions: 0 },
  usage_coverage: { available: true, by_licence: [{ licence_uid: 'fr', brand_name: 'Test France', reported: false }] },
});

async function start(page, request, { width = 1440, dark = false, unknown = false } = {}) {
  await prepare(page, request, { as: 'security' });
  await page.setViewportSize({ width, height: 960 });
  await page.addInitScript((isDark) => { localStorage.setItem('theme', isDark ? 'dark' : 'light'); }, dark);
  const state = { row: statement(), receipts: [], writes: [], reads: [], historyFailure: false, branchFailure: false, unknown, hold: null };
  await page.route('**/api/admin/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (path === '/api/admin/revenue/summary') {
      const p = url.searchParams.get('period') || period;
      if (state.hold?.period === p) await state.hold.promise;
      return route.fulfill({ json: summary(p) });
    }
    if (path === '/api/admin/statements') return route.fulfill({ json: { available: true, current_period: period, items: [state.row] } });
    if (path === '/api/admin/billing/disputes') return route.fulfill({ json: { disputes: [] } });
    if (path === '/api/admin/billing/refunds') return route.fulfill({ json: { available: true, count: 0, items: [], by_currency: [] } });
    if (path === '/api/admin/promo-ceilings') return route.fulfill({ json: { available: true, current_period: period, items: [{ licence_uid: 'fr', brand_name: 'Test France', period, currency: 'EUR', ceiling_cents: 100000, pushed_at: stamp, updated_at: stamp }] } });
    if (path === '/api/admin/promo-ceilings/fr/read-back') {
      state.reads.push('branch');
      return route.fulfill({ json: state.branchFailure ? { state: 'unreadable', message: 'Branch checkout could not be read.' }
        : { state: 'verified', as_of: stamp, message: 'Branch checkout confirms this ceiling.' } });
    }
    if (path === '/api/admin/statements/statement-fr/actions') {
      state.reads.push('history');
      return route.fulfill({ status: state.historyFailure ? 503 : 200, json: state.historyFailure ? { error: 'unavailable' } : { available: true, items: state.receipts, next_cursor: null } });
    }
    if (req.method() === 'POST' && /\/statements\/statement-fr\/(disputes|due-date)$/.test(path)) {
      const body = req.postDataJSON();
      state.writes.push(body);
      const old = state.receipts.find((r) => r.key === body.idempotency_key);
      if (old) return route.fulfill({ json: { ...old.response, replayed: true } });
      const before = { ...state.row };
      const kind = path.endsWith('/disputes') ? 'record_dispute' : 'set_due_date';
      if (kind === 'record_dispute') state.row.disputed_cents = body.disputed_cents;
      else state.row.due_on = body.due_on;
      state.row.outstanding_cents = state.row.owed_cents - state.row.disputed_cents;
      state.row.revision++;
      const response = { outcome: 'applied', action: kind, before, after: { ...state.row }, receipt: { action_uid: `receipt-${state.row.revision}`, at: stamp, currency: 'EUR', reason: body.reason } };
      state.receipts.unshift({ uid: response.receipt.action_uid, action: kind, actor_user_id: 42, reason: body.reason, created_at: stamp, currency: 'EUR', before, after: response.after, key: body.idempotency_key, response });
      if (state.unknown) { state.unknown = false; return route.fulfill({ status: 503, json: { error: 'connection_lost' } }); }
      return route.fulfill({ json: response });
    }
    return route.continue();
  });
  await page.goto('/admin/revenue');
  await expect(page.getByTestId('hq-revenue-header')).toBeVisible();
  await expect(page.getByTestId('hq-revenue-period')).toHaveValue(period);
  if (dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
  return state;
}

async function openStatement(page) {
  await page.getByRole('button', { name: /^Open Test France Revenue share/ }).filter({ visible: true }).click();
  await expect(page.getByTestId('hq-revenue-statement-drawer')).toBeVisible();
}

async function review(page, kind) {
  await page.getByRole('button', { name: kind === 'record_dispute' ? 'Record dispute…' : 'Set due date…', exact: true }).click();
  if (kind === 'record_dispute') await page.getByLabel('Disputed amount · EUR').fill('1.25');
  else await page.getByLabel('Due date · UTC', { exact: true }).fill('2026-10-15');
  await page.getByLabel('Reason', { exact: false }).fill(reason);
  await page.getByRole('button', { name: 'Continue to review', exact: true }).click();
  await expect(page.getByTestId('hq-statement-flow-review')).toContainText('Before → after');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId(`hq-statement-flow-${kind}`)).toContainText('values you reviewed');
}

for (const mode of [{ width: 1440 }, { width: 834 }, { width: 390 }, { width: 1440, dark: true }]) {
  test(`Revenue recorded workflows at ${mode.width}px${mode.dark ? ' dark' : ''}`, async ({ page, request }, info) => {
    const state = await start(page, request, mode);
    expect(state.reads).toEqual([]);
    const tiles = page.getByTestId('hq-revenue-ledger-tiles');
    await expect(tiles).toContainText('€3,000.00');
    await expect(tiles).toContainText('€1,000.00');
    await info.attach('cockpit-header', { body: await page.screenshot(), contentType: 'image/png' });
    await page.getByTestId('hq-revenue-stream-filter').selectOption('tokens');
    await expect(page.getByTestId('hq-revenue-streams').locator('tr:visible')).toHaveCount(1);
    await expect(page.getByTestId('hq-revenue-streams').locator('tr:visible')).toContainText('AI / tokens');
    await expect(tiles).toContainText('€3,000.00');
    await page.getByTestId('hq-revenue-stream-filter').selectOption('all');
    await expect(page.getByTestId('hq-revenue-receivables')).toContainText('2026-10-01');
    const branch = page.getByTestId('promotion-readback-fr');
    await expect(branch).toContainText('Enforcement not checked');
    await branch.getByRole('button', { name: 'Check branch', exact: true }).click();
    await expect(branch).toContainText('Branch checkout confirms this ceiling.');
    state.branchFailure = true;
    await branch.getByRole('button', { name: 'Check branch again' }).click();
    await expect(branch).toContainText('Branch checkout could not be read.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await info.attach('promotions', { body: await page.screenshot(), contentType: 'image/png' });
    state.historyFailure = true;
    await openStatement(page);
    await expect(page.getByTestId('hq-statement-action-history')).toContainText('unreadable');
    state.historyFailure = false;
    await page.getByRole('button', { name: 'Retry history' }).click();
    await expect(page.getByTestId('hq-statement-action-history')).toContainText('No governed actions recorded');
    await review(page, 'record_dispute');
    await page.getByTestId('hq-statement-flow-confirm').click();
    await expect(page.getByTestId('hq-statement-flow-outcome')).toContainText('Dispute recorded');
    expect(state.writes[0]).toMatchObject({ disputed_cents: 125, expected_revision: 0, reason });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByTestId('hq-statement-action-history')).toContainText(reason);
    await expect(page.getByTestId('hq-statement-action-history')).toContainText('actor #42');
    await review(page, 'set_due_date');
    await page.getByTestId('hq-statement-flow-confirm').click();
    await expect(page.getByTestId('hq-statement-flow-outcome')).toContainText('Due date recorded');
    expect(state.writes[1]).toMatchObject({ due_on: '2026-10-15', expected_revision: 1 });
    await info.attach('receipt', { body: await page.screenshot(), contentType: 'image/png' });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByTestId('hq-statement-action-history')).toContainText('2026-10-15');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hq-revenue-statement-drawer')).toHaveCount(0);
  });
}

test('Unknown dispute outcome replays its original key and records once', async ({ page, request }) => {
  const state = await start(page, request, { unknown: true });
  await openStatement(page);
  await review(page, 'record_dispute');
  await page.getByTestId('hq-statement-flow-confirm').click();
  await expect(page.getByTestId('hq-statement-flow-outcome')).toHaveAttribute('data-outcome', 'unknown');
  await page.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(page.getByTestId('hq-statement-flow-outcome')).toContainText('not recorded twice');
  expect(state.writes).toHaveLength(2);
  expect(state.writes[1]).toEqual(state.writes[0]);
  expect(state.receipts).toHaveLength(1);
});

test('A late summary response cannot overwrite the newly selected period', async ({ page, request }) => {
  const state = await start(page, request);
  let release;
  state.hold = { period: '2026-Q3', promise: new Promise((resolve) => { release = resolve; }) };
  await page.getByTestId('hq-revenue-period').selectOption('2026-Q3');
  await page.getByTestId('hq-revenue-period').selectOption('2026-Q2');
  await expect(page.getByTestId('hq-revenue-streams-section')).toContainText('Q2 2026');
  await expect(page.getByTestId('hq-revenue-ledger-tiles')).toContainText('€2,222.00');
  const late = page.waitForResponse((r) => r.url().includes('/admin/revenue/summary?period=2026-Q3'));
  release();
  await late;
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.getByTestId('hq-revenue-period')).toHaveValue('2026-Q2');
  await expect(page.getByTestId('hq-revenue-streams-section')).toContainText('Q2 2026');
  await expect(page.getByTestId('hq-revenue-ledger-tiles')).toContainText('€2,222.00');
});
