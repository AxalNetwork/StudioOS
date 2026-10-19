/**
 * D752 (#1889) section 5 — a founder's spending, burn, cash and runway from
 * their own Mercury, the snapshot they save, and the source lock on
 * `project_metrics`.
 *
 * The pure service (`services/mercurySpend.ts`) directly; then
 * `GET /api/revenue/projects/:id/mercury-spend` and `POST …/snapshot` for the
 * founder, every other role, a support session and a branch; then the lock
 * through `/api/progress`. Mercury is the `bank()` stub throughout. Ids, names
 * and amounts are invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_spend_d752.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mig } from './_mercury_d713.ts';
import { personalFixture, connected, bank, credit, req, account, defaultBank, count, day, ACC_A, ACC_B, FOUR_A, FOUR_B, type Txn } from './_mercury_personal_d713.ts';
import {
  SPEND_VISIBILITY, bucketMonths, cashNow, runwayFrom, snapshotFigures, spendMonths, spendWindow, type SpendLine,
} from '../src/services/mercurySpend.ts';
import { runwayMonths } from '../src/services/saasMetrics.ts';
import { ensureProjectMetricsSchema } from '../src/routes/progress.ts';
import { fedCounts } from '../src/integrations/fed.ts';
import { kpiRows } from '../src/services/growKpis.ts';

/** The `d`th of the month `k` months before this one, in UTC. */
const inMonth = (k: number, d = 10) => {
  const t = new Date();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - k, d)).toISOString().slice(0, 10);
};
const key = (k: number) => inMonth(k, 1).slice(0, 7);

// ─────────────────────────────────────────────────────────── the service

const line = (over: Partial<SpendLine>): SpendLine => ({
  transaction_id: crypto.randomUUID(), amount_cents: -1000, posted_on: '2026-09-10', created_on: '2026-09-10',
  posted: true, internal: false, voided: false, counterparty_name: 'Vendor', category: null, financing: false, ...over,
});

test('service: a line lands in the month it posted; pending, failed and internal lines are counted, never summed', () => {
  const rows = bucketMonths([
    line({ amount_cents: -5000, created_on: '2026-08-31', posted_on: '2026-09-01' }),
    line({ amount_cents: -7000, posted: false, posted_on: null, created_on: '2026-09-03' }),
    line({ amount_cents: -9000, voided: true, status: 'cancelled' } as any),
    line({ amount_cents: -11000, voided: true }),
    line({ amount_cents: -13000, internal: true }),
    line({ amount_cents: 2000, counterparty_name: 'Customer Co' }),
  ], ['2026-08', '2026-09']);
  assert.equal(rows[0].reason, 'no_lines', 'the created date never decides when a posted date exists');
  assert.deepEqual(rows[1].lines, { posted: 2, pending: 1, failed: 2, internal: 1 });
  assert.deepEqual([rows[1].out_cents, rows[1].operating_in_cents, rows[1].net_burn_cents], [5000, 2000, 3000]);
});

test('service: Axal money and confirmed receipts are financing, never income, and never lower burn', () => {
  const [m] = bucketMonths([
    line({ amount_cents: -400000 }),
    line({ amount_cents: 100000, counterparty_name: 'Customer Co' }),
    line({ amount_cents: 50000000, counterparty_name: 'Axal VC Spin-Out Lab Fund I LP', financing: true }),
    line({ amount_cents: 2500000, counterparty_name: 'An Angel', financing: true }),
  ], ['2026-09']);
  assert.deepEqual([m.financing_in_cents, m.operating_in_cents, m.out_cents, m.net_burn_cents], [52500000, 100000, 400000, 300000]);
});

test('service: a month with no posted line has no figures, never zeros', () => {
  const [m] = bucketMonths([line({ posted: false })], ['2026-09']);
  assert.deepEqual([m.reason, m.out_cents, m.operating_in_cents, m.financing_in_cents, m.net_burn_cents], ['no_lines', null, null, null, null]);
});

test('service: the top five payees by money out, grouped on a normalised name, credits never listed', () => {
  const payees = ['Example Cloud', ' example  cloud ', 'B Co', 'C Co', 'D Co', 'E Co', 'F Co', null];
  const amounts = [-500, -600, -900, -800, -700, -300, -200, -1000];
  const [m] = bucketMonths([
    ...payees.map((p, i) => line({ counterparty_name: p, amount_cents: amounts[i] })),
    line({ counterparty_name: 'Big Customer', amount_cents: 999999 }),
  ], ['2026-09']);
  assert.deepEqual(m.top_counterparties, [
    { name: 'Example Cloud', out_cents: 1100, lines: 2 },
    { name: null, out_cents: 1000, lines: 1 },
    { name: 'B Co', out_cents: 900, lines: 1 },
    { name: 'C Co', out_cents: 800, lines: 1 },
    { name: 'D Co', out_cents: 700, lines: 1 },
  ]);
});

test('service: categories are null when Mercury gave none, and sorted by money out when it did', () => {
  assert.equal(bucketMonths([line({})], ['2026-09'])[0].categories, null);
  const [m] = bucketMonths([line({ category: 'Software', amount_cents: -300 }), line({ category: 'Travel', amount_cents: -900 }), line({ category: 'Software', amount_cents: -700 })], ['2026-09']);
  assert.deepEqual(m.categories, [{ category: 'Software', out_cents: 1000 }, { category: 'Travel', out_cents: 900 }]);
});

test('service: cash is the available balance of checking and savings; a missing one is unreadable, never 0', () => {
  assert.deepEqual(cashNow([{ kind: 'checking', available_cents: 1000 }, { kind: 'savings', available_cents: 250 }, { kind: 'treasury', available_cents: 9 }]),
    { cents: 1250, accounts_counted: 2, accounts_unreadable: 0 });
  assert.deepEqual(cashNow([{ kind: 'checking', available_cents: 1000 }, { kind: 'savings', available_cents: null }]), { cents: 1000, accounts_counted: 1, accounts_unreadable: 1 });
  assert.deepEqual(cashNow([{ kind: 'checking', available_cents: null }]), { cents: null, accounts_counted: 0, accounts_unreadable: 1 });
});

test('service: runway is cash over the three-month average, and each missing input has its reason', () => {
  const rows = bucketMonths([
    line({ posted_on: '2026-07-10', amount_cents: -300000 }), line({ posted_on: '2026-08-10', amount_cents: -600000 }),
    line({ posted_on: '2026-09-10', amount_cents: -900000 }),
  ], ['2026-07', '2026-08', '2026-09']);
  const r = runwayFrom(12000000, rows, false);
  assert.deepEqual([r.average_net_burn_cents, r.months, r.reason, r.from], [600000, runwayMonths(12000000, 600000), null, ['2026-07', '2026-08', '2026-09']]);
  assert.equal(r.months, 20);
  assert.equal(runwayFrom(null, rows, false).reason, 'cash_not_read');
  assert.equal(runwayFrom(12000000, rows, true).reason, 'partial');
  const gap = bucketMonths([line({ posted_on: '2026-07-10' }), line({ posted_on: '2026-09-10' })], ['2026-07', '2026-08', '2026-09']);
  assert.equal(runwayFrom(12000000, gap, false).reason, 'needs_three_months');
  const earning = bucketMonths(['2026-07', '2026-08', '2026-09'].map((m) => line({ posted_on: `${m}-10`, amount_cents: 5000 })), ['2026-07', '2026-08', '2026-09']);
  const e = runwayFrom(12000000, earning, false);
  assert.deepEqual([e.months, e.reason], [null, 'not_burning']);
});

test('service: months is 1 to 12, two digits at most; the read covers four months even when one is listed', () => {
  for (const bad of ['0', '13', 'x', '1.5', '012', '-1']) assert.deepEqual(spendMonths(bad), { error: 'invalid_months', message: 'Choose 1 to 12 months.' }, bad);
  assert.equal(spendMonths(undefined), 6);
  assert.equal(spendMonths('12'), 12);
  const w = spendWindow(1, '2026-10-18');
  assert.deepEqual([w.from, w.to, w.listed, w.runwayMonths, w.lastFullMonth], ['2026-07-01', '2026-10-18', ['2026-10'], ['2026-07', '2026-08', '2026-09'], '2026-09']);
  assert.deepEqual(spendWindow(6, '2026-01-05').listed, ['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01']);
});

test('service: the snapshot figures are dollars, cash only by choice, refused without a month or a cash figure', () => {
  const [m] = bucketMonths([line({ amount_cents: -312345 })], ['2026-09']);
  assert.deepEqual(snapshotFigures(m, 4100000, false, '2026-10-18'),
    { ok: true, net_burn: 3123.45, cash_balance: null, notes: 'Net burn for 2026-09, read from your Mercury on 2026-10-18.' });
  assert.deepEqual(snapshotFigures(m, 4100000, true, '2026-10-18'),
    { ok: true, net_burn: 3123.45, cash_balance: 41000, notes: 'Net burn for 2026-09 and cash on hand on 2026-10-18, read from your Mercury on 2026-10-18.' });
  assert.equal((snapshotFigures(m, null, true, '2026-10-18') as any).code, 'cash_not_read');
  const [empty] = bucketMonths([], ['2026-09']);
  assert.equal((snapshotFigures(empty, 4100000, false, '2026-10-18') as any).code, 'no_lines_last_month');
});

// ─────────────────────────────────────────────────────────── the routes

const debit = (n: number, amount: number, posted: string, counterpartyName = 'Example Cloud Inc', extra: Partial<Txn> = {}) =>
  credit(n, -amount, posted, counterpartyName, extra);

/**
 * Three full months burning $30,000 each, a $500,000 wire from Fund I in the
 * last, and a pending, a cancelled and an internal line in the last full month.
 */
function spendBank() {
  const state = defaultBank();
  state.accounts = [
    { ...account(ACC_A, FOUR_A, 'checking'), availableBalance: 300000.25, currentBalance: 999999.99 },
    { ...account(ACC_B, FOUR_B, 'savings'), availableBalance: 60000.5, currentBalance: 1.11 },
  ];
  state.txns = {
    [ACC_A]: [
      debit(1, 40000, inMonth(3)), credit(2, 10000, inMonth(3)),
      debit(3, 50000, inMonth(2), 'Office Lease LLC'), credit(4, 20000, inMonth(2)),
      debit(5, 30000, inMonth(1)), debit(6, 15000, inMonth(1), 'Office Lease LLC'), credit(7, 15000, inMonth(1)),
      credit(8, 500000, inMonth(1), 'Axal VC Spin-Out Lab Fund I LP'),
      debit(9, 7000, inMonth(1), 'Pending Vendor', { postedAt: null, status: 'pending' }),
      debit(10, 8000, inMonth(1), 'Cancelled Vendor', { status: 'cancelled' }),
      debit(11, 25000, inMonth(1), 'Own savings', { kind: 'internalTransfer' }),
      debit(12, 1234, day(0)),
    ],
    [ACC_B]: [credit(13, 25000, inMonth(1), 'Own checking', { kind: 'internalTransfer' })],
  };
  return bank(state);
}

async function setup() {
  const { db, env } = await personalFixture();
  // Grow's custom KPI tables only, from 462, so `kpiRows` reads.
  const grow = mig('462_grow_record_stores.sql');
  for (const t of ['custom_kpis', 'custom_kpi_values']) {
    const at = grow.indexOf(`CREATE TABLE IF NOT EXISTS ${t} (`);
    db.exec(grow.slice(at, grow.indexOf(');', at) + 2));
  }
  db.exec('CREATE TABLE IF NOT EXISTS revenue_entries (id INTEGER PRIMARY KEY, project_id INTEGER, revenue_type TEXT, amount_cents INTEGER, received_on TEXT, customer TEXT, source TEXT)');
  await ensureProjectMetricsSchema(env);
  const integration = await connected(db, env, 10);
  return { db, env, integration };
}

const SPEND = '/api/revenue/projects/1/mercury-spend';
const metrics = (db: any) => db.prepare('SELECT * FROM project_metrics ORDER BY id').all() as any[];
const only = (calls: any[]) => calls.every((c) => c.method === 'GET' && ['/organization', '/accounts'].includes(c.path) || /^\/account\/[^/]+\/transactions$/.test(c.path));

test('GET mercury-spend: the founder\'s months, financing apart, cash from available balances, runway, and one log row of counts', async () => {
  const { db, env } = await setup();
  const b = spendBank();
  try {
    const r = await req(env, 10, 'GET', SPEND);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.months.length, 6);
    assert.deepEqual(r.body.months.map((m: any) => m.month), [5, 4, 3, 2, 1, 0].map(key));
    const last = r.body.months[4];
    assert.deepEqual([last.month, last.partial, last.reason], [key(1), false, null]);
    assert.deepEqual([last.operating_in_cents, last.financing_in_cents, last.out_cents, last.net_burn_cents], [1500000, 50000000, 4500000, 3000000]);
    assert.deepEqual(last.lines, { posted: 4, pending: 1, failed: 1, internal: 2 });
    assert.deepEqual(last.top_counterparties, [{ name: 'Example Cloud Inc', out_cents: 3000000, lines: 1 }, { name: 'Office Lease LLC', out_cents: 1500000, lines: 1 }]);
    assert.equal(last.categories, null);
    assert.deepEqual([r.body.months[5].partial, r.body.months[0].reason], [true, 'no_lines']);
    assert.deepEqual(r.body.cash, { cents: 36000075, as_of: day(0), accounts_counted: 2, accounts_unreadable: 0 }, 'available, never current');
    assert.deepEqual(r.body.runway, { months: runwayMonths(36000075, 3000000), reason: null, from: [3, 2, 1].map(key), average_net_burn_cents: 3000000 });
    assert.equal(r.body.last_full_month, key(1));
    assert.deepEqual(r.body.save, { month: key(1), visibility: SPEND_VISIBILITY });
    assert.deepEqual([r.body.partial, r.body.unreadable_lines, r.body.currency], [false, 0, 'USD']);
    for (const k of ['account_id', 'last_four', 'memo', 'transaction_id']) assert.ok(!r.text.includes(`"${k}"`), k);
    assert.ok(only(b.calls), JSON.stringify(b.calls.map((c) => c.path)));
    assert.ok(!b.calls.some((c) => /card/i.test(c.path)));
    const logs = db.prepare("SELECT response_summary FROM integration_logs WHERE event_type = 'mercury_spend_read'").all() as any[];
    assert.equal(logs.length, 1);
    assert.match(logs[0].response_summary, /^use=venture_spend lines=\d+ months=\d+ capped=[01] unreadable=\d+$/);
    assert.equal(metrics(db).length, 0, 'the read stores nothing');
  } finally { b.restore(); }
});

test('GET mercury-spend: months is checked before Mercury; only the founder reaches it; support sessions and the unconnected are refused; a branch is fine', async () => {
  const { db, env } = await setup();
  const b = spendBank();
  try {
    let r = await req(env, 10, 'GET', `${SPEND}?months=13`);
    assert.deepEqual([r.status, r.body.error], [400, 'invalid_months']);
    assert.equal(b.calls.length, 0);
    r = await req(env, 1, 'GET', SPEND);
    assert.deepEqual([r.status, r.body.error, r.body.message], [403, 'mercury_owner_only', 'Only the startup\'s founder can read its spending, from their own connected Mercury.']);
    for (const who of [20, 30]) {
      r = await req(env, who, 'GET', SPEND);
      assert.equal(r.status === 403 || r.status === 404, true, `${who}: ${r.text}`);
      assert.notEqual(r.body?.error, 'mercury_owner_only', 'refused by the gate, before the owner check');
    }
    r = await req(env, 10, 'GET', SPEND, undefined, { impersonated: true });
    assert.deepEqual([r.status, r.body.error], [403, 'support_session_refused']);
    assert.equal(b.calls.length, 0, 'nobody but the founder reached Mercury');
    db.exec('DELETE FROM integrations WHERE user_id = 10');
    r = await req(env, 10, 'GET', SPEND);
    assert.deepEqual([r.status, r.body.error], [409, 'mercury_not_connected']);
    await connected(db, env, 10);
    r = await req(env, 10, 'GET', `${SPEND}?months=1`, undefined, { branch: true });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.body.months.length, r.body.runway.reason], [1, null], 'one month listed; runway still from three full months');
  } finally { b.restore(); }
});

test('GET mercury-spend: at the line cap the read is partial, with no runway', async () => {
  const { env } = await setup();
  const b = spendBank();
  try {
    b.state.txns[ACC_A] = Array.from({ length: 1001 }, (_, i) => debit(1000 + i, 10, inMonth(1, 1 + (i % 27))));
    const r = await req(env, 10, 'GET', SPEND);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.body.partial, r.body.runway.months, r.body.runway.reason], [true, null, 'partial']);
  } finally { b.restore(); }
});

test('POST snapshot: the visibility confirmation and include_cash are checked before Mercury; nothing is written', async () => {
  const { db, env } = await setup();
  const b = spendBank();
  try {
    for (const body of [{}, { confirm_visible: 'yes' }, { confirm_visible: false }]) {
      const r = await req(env, 10, 'POST', `${SPEND}/snapshot`, body);
      assert.deepEqual([r.status, r.body.error, r.body.visibility], [400, 'visibility_confirm_required', SPEND_VISIBILITY]);
    }
    const r = await req(env, 10, 'POST', `${SPEND}/snapshot`, { confirm_visible: true, include_cash: 'yes' });
    assert.deepEqual([r.status, r.body.error], [400, 'invalid_include_cash']);
    const admin = await req(env, 1, 'POST', `${SPEND}/snapshot`, { confirm_visible: true });
    assert.deepEqual([admin.status, admin.body.error], [403, 'mercury_owner_only']);
    assert.equal(b.calls.length, 0);
    assert.equal(metrics(db).length, 0);
  } finally { b.restore(); }
});

test('POST snapshot: the last full month\'s burn, cash only when asked, one row a day, fed into Revenue and traction and read by Grow', async () => {
  const { db, env, integration } = await setup();
  const b = spendBank();
  try {
    let r = await req(env, 10, 'POST', `${SPEND}/snapshot`, { confirm_visible: true });
    assert.equal(r.status, 200, r.text);
    let rows = metrics(db);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].source, rows[0].snapshot_date, rows[0].net_burn, rows[0].cash_balance, rows[0].notes],
      ['mercury', day(0), 30000, null, `Net burn for ${key(1)}, read from your Mercury on ${day(0)}.`]);
    assert.deepEqual([r.body.month, r.body.net_burn, r.body.cash_balance, r.body.source], [key(1), 30000, null, 'mercury']);
    r = await req(env, 10, 'POST', `${SPEND}/snapshot`, { confirm_visible: true, include_cash: true });
    assert.equal(r.status, 200, r.text);
    rows = metrics(db);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].cash_balance, rows[0].notes], [360000.75, `Net burn for ${key(1)} and cash on hand on ${day(0)}, read from your Mercury on ${day(0)}.`]);
    const kpis = await kpiRows(env, 1, Date.now());
    const burn = kpis.find((k) => k.id === 'net_burn')!;
    const runway = kpis.find((k) => k.id === 'runway')!;
    assert.deepEqual([burn.value, burn.source], [30000, 'mercury']);
    assert.equal(runway.value, runwayMonths(360000.75, 30000));
    r = await req(env, 10, 'POST', `${SPEND}/snapshot`, { confirm_visible: true, include_cash: false });
    assert.equal(r.status, 200, r.text);
    rows = metrics(db);
    assert.deepEqual([rows.length, rows[0].cash_balance], [1, null], 'saving again without cash clears it');
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM connector_fed_items WHERE kind = 'metric_snapshot' AND local_table = 'project_metrics' AND module = 'revenue_and_traction'"), 1);
    const fed = await fedCounts(env, integration, 'mercury', 'founder');
    assert.equal(fed.find((m) => m.module === 'revenue_and_traction')?.count, 1);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM integration_logs WHERE event_type = 'mercury_spend_snapshot'"), 3);
    const logs = (db.prepare('SELECT response_summary FROM integration_logs').all() as any[]).map((l) => l.response_summary).join(' ');
    assert.doesNotMatch(logs, /Example Cloud|Office Lease|30000|36000075/);
  } finally { b.restore(); }
});

test('POST snapshot: refused, with nothing saved, for an empty last month, a capped read and an unreadable cash figure', async () => {
  const { db, env } = await setup();
  const b = spendBank();
  try {
    const keep = b.state.txns[ACC_A];
    b.state.txns[ACC_A] = keep.filter((t) => !String(t.postedAt ?? t.createdAt).startsWith(key(1)));
    let r = await req(env, 10, 'POST', `${SPEND}/snapshot`, { confirm_visible: true });
    assert.deepEqual([r.status, r.body.error], [409, 'no_lines_last_month']);
    b.state.txns[ACC_A] = Array.from({ length: 1001 }, (_, i) => debit(2000 + i, 10, inMonth(1, 1 + (i % 27))));
    r = await req(env, 10, 'POST', `${SPEND}/snapshot`, { confirm_visible: true });
    assert.deepEqual([r.status, r.body.error], [409, 'spend_partial']);
    b.state.txns[ACC_A] = keep;
    b.state.accounts = [account(ACC_A, FOUR_A), account(ACC_B, FOUR_B, 'savings')];
    r = await req(env, 10, 'POST', `${SPEND}/snapshot`, { confirm_visible: true, include_cash: true });
    assert.deepEqual([r.status, r.body.error], [409, 'cash_not_read']);
    assert.equal(metrics(db).length, 0);
    r = await req(env, 10, 'POST', `${SPEND}/snapshot`, { confirm_visible: true });
    assert.equal(r.status, 200, 'without cash it still saves');
  } finally { b.restore(); }
});

// ─────────────────────────────────────────────────────────── the source lock

test('lock: a typed snapshot cannot claim Stripe or Mercury; without a source, or as manual, it is typed', async () => {
  const { db, env } = await setup();
  for (const source of ['stripe', 'mercury', ' Mercury ', 'STRIPE']) {
    const r = await req(env, 10, 'POST', '/api/progress/metrics/1', { snapshot_date: '2026-09-30', net_burn: 1, source });
    assert.deepEqual([r.status, r.body.detail?.code], [400, 'source_reserved'], source);
  }
  assert.equal(metrics(db).length, 0);
  for (const [i, source] of [undefined, 'manual'].entries()) {
    const r = await req(env, 10, 'POST', '/api/progress/metrics/1', { snapshot_date: `2026-09-2${i}`, net_burn: 1, ...(source ? { source } : {}) });
    assert.equal(r.status, 200, r.text);
  }
  assert.deepEqual(metrics(db).map((m) => m.source), ['manual', 'manual']);
});

test('lock: a Mercury row\'s date and figures cannot be edited; its notes can; a manual row stays editable; delete works', async () => {
  const { db, env } = await setup();
  const b = spendBank();
  try {
    await req(env, 10, 'POST', `${SPEND}/snapshot`, { confirm_visible: true, include_cash: true });
  } finally { b.restore(); }
  const row = metrics(db)[0];
  for (const body of [{ net_burn: 1 }, { cash_balance: 1 }, { snapshot_date: '2026-01-01' }, { mrr: 5 }, { mrr: null }, { notes: 'x', net_burn: 2 }]) {
    const r = await req(env, 10, 'PUT', `/api/progress/metrics/snapshot/${row.id}`, body);
    assert.deepEqual([r.status, r.body.detail?.code], [409, 'mercury_figure_locked'], JSON.stringify(body));
  }
  assert.deepEqual(metrics(db)[0], row, 'unchanged');
  let r = await req(env, 10, 'PUT', `/api/progress/metrics/snapshot/${row.id}`, { notes: 'Checked with the accountant' });
  assert.equal(r.status, 200, r.text);
  assert.equal(metrics(db)[0].notes, 'Checked with the accountant');
  const manual = await req(env, 10, 'POST', '/api/progress/metrics/1', { snapshot_date: '2026-09-30', net_burn: 1 });
  r = await req(env, 10, 'PUT', `/api/progress/metrics/snapshot/${manual.body.id}`, { net_burn: 2 });
  assert.equal(r.status, 200, r.text);
  r = await req(env, 10, 'DELETE', `/api/progress/metrics/${row.id}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM project_metrics WHERE source = 'mercury'"), 0);
});

test('static: the Stripe writer names its source in its own SQL, and the pure service imports nothing from the bank code', () => {
  const stripe = readFileSync('cloudflare-worker/src/integrations/providers/stripe.ts', 'utf8');
  assert.match(stripe, /INSERT INTO project_metrics[\s\S]{0,600}'stripe'/);
  const stripeCode = stripe.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(stripeCode, /\/metrics\/:projectId|api\/progress\/metrics/, 'the Stripe writer never goes through the typed POST');
  const spend = readFileSync('cloudflare-worker/src/services/mercurySpend.ts', 'utf8');
  assert.deepEqual([...spend.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]), ['./saasMetrics']);
  assert.doesNotMatch(spend, /prepare\(|fetch\(|Context/);
});
