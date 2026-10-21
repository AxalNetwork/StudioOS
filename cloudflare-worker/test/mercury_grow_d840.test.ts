/**
 * D840 part 3 (#2348) — the founder's own Mercury feeds their Grow modules.
 *
 * The pure readers (`services/mercury/growFeeds.ts`) first. Ids, names and
 * amounts are invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_grow_d840.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  channelOf, channelSpend, cashFacts, debitsByMonth, fullMonths, hiresAffordable, invoiceTally, isMarketing, isPayroll,
  matchPaidInvoices, monthEnd, partnerPayments, revenueMonths, type GrowInvoice, type GrowLine,
} from '../src/services/mercury/growFeeds.ts';

const line = (over: Partial<GrowLine>): GrowLine => ({
  transaction_id: crypto.randomUUID(), amount_cents: -1000, posted_on: '2026-09-10', created_on: '2026-09-10',
  posted: true, internal: false, voided: false, counterparty_name: 'Vendor', category: null, financing: false, ...over,
});
const invoice = (over: Partial<GrowInvoice>): GrowInvoice => ({
  id: crypto.randomUUID(), amount_cents: 250000, state: 'paid', customer_name: 'Customer Co', issued_on: '2026-09-01',
  due_on: '2026-09-30', paid_on: '2026-09-12', recurring: false, ...over,
});

test('pure: the full months before today, oldest first, and a month\'s last day', () => {
  assert.deepEqual(fullMonths('2026-10-21', 3), ['2026-07', '2026-08', '2026-09']);
  assert.equal(fullMonths('2026-01-05', 12)[0], '2025-01');
  assert.equal(monthEnd('2026-02'), '2026-02-28');
  assert.equal(monthEnd('2028-02'), '2028-02-29');
});

test('pure: a month\'s money in excludes financing; a month with no posted line has no figures, never 0', () => {
  const rows = revenueMonths([
    line({ amount_cents: 300000, counterparty_name: 'Customer Co' }),
    line({ amount_cents: 9000000, financing: true }),
    line({ amount_cents: -100000 }),
    line({ amount_cents: 50000, internal: true }),
  ], ['2026-08', '2026-09']);
  assert.deepEqual(rows[0], { month: '2026-08', cash_in_cents: null, net_burn_cents: null });
  assert.deepEqual(rows[1], { month: '2026-09', cash_in_cents: 300000, net_burn_cents: -200000 });
});

test('pure: a credit lands as a paid invoice only when the match is one to one', () => {
  const a = line({ amount_cents: 250000, posted_on: '2026-09-12' });
  const inv = invoice({});
  assert.equal(matchPaidInvoices([a], [inv]).get(a.transaction_id)?.id, inv.id);
  // Two credits of the same amount: neither lands.
  const b = line({ amount_cents: 250000, posted_on: '2026-09-14' });
  assert.equal(matchPaidInvoices([a, b], [inv]).size, 0);
  // Two invoices fit one credit: it stays a pick.
  assert.equal(matchPaidInvoices([a], [inv, invoice({})]).size, 0);
  // An open invoice, a different amount, a credit before the invoice or long after it was paid: no match.
  assert.equal(matchPaidInvoices([a], [invoice({ state: 'open' })]).size, 0);
  assert.equal(matchPaidInvoices([a], [invoice({ amount_cents: 250001 })]).size, 0);
  assert.equal(matchPaidInvoices([line({ amount_cents: 250000, posted_on: '2026-08-31' })], [inv]).size, 0);
  assert.equal(matchPaidInvoices([line({ amount_cents: 250000, posted_on: '2026-09-23' })], [inv]).size, 0);
  assert.equal(matchPaidInvoices([line({ amount_cents: 250000, posted_on: '2026-09-22' })], [inv]).size, 1);
  // Pending, financing and debits never match.
  assert.equal(matchPaidInvoices([line({ amount_cents: 250000, posted: false })], [inv]).size, 0);
  assert.equal(matchPaidInvoices([line({ amount_cents: 250000, financing: true })], [inv]).size, 0);
  assert.equal(matchPaidInvoices([line({ amount_cents: -250000 })], [inv]).size, 0);
});

test('pure: invoices by state; an open invoice past due is overdue', () => {
  const t = invoiceTally([
    invoice({ amount_cents: 100 }),
    invoice({ state: 'open', amount_cents: 200, due_on: '2026-10-30' }),
    invoice({ state: 'open', amount_cents: 300, due_on: '2026-10-01' }),
    invoice({ state: 'overdue', amount_cents: 400 }),
    invoice({ state: 'other', amount_cents: 500 }),
  ], '2026-10-21');
  assert.deepEqual(t, [
    { state: 'paid', count: 1, amount_cents: 100 },
    { state: 'open', count: 1, amount_cents: 200 },
    { state: 'overdue', count: 2, amount_cents: 700 },
  ]);
});

test('pure: payroll is a payroll category or a payroll provider; marketing is its category', () => {
  assert.equal(isPayroll({ category: 'Payroll', counterparty_name: 'Someone' }), true);
  assert.equal(isPayroll({ category: null, counterparty_name: 'Gusto, Inc.' }), true);
  assert.equal(isPayroll({ category: 'Software', counterparty_name: 'Gustoso Pizza' }), false);
  assert.equal(isMarketing({ category: 'Advertising' }), true);
  assert.equal(isMarketing({ category: 'Software' }), false);
  const months = ['2026-08', '2026-09'];
  const rows = debitsByMonth([
    line({ amount_cents: -800000, category: 'Payroll' }),
    line({ amount_cents: -200000, counterparty_name: 'Gusto' }),
    line({ amount_cents: -999, counterparty_name: 'Gusto', posted: false }),
    line({ amount_cents: 5000, counterparty_name: 'Gusto' }),
  ], months, isPayroll);
  assert.deepEqual(rows, [{ month: '2026-08', cents: null }, { month: '2026-09', cents: 1000000 }]);
});

test('pure: a payee lands on a channel only when it names exactly one', () => {
  const channels = [
    { uid: 'c-google', name: 'Google Ads', utm_source: 'google' },
    { uid: 'c-meta', name: 'Meta', utm_source: 'facebook' },
    { uid: 'c-x', name: 'X', utm_source: 'x' },
  ];
  assert.equal(channelOf('GOOGLE ADS', channels), 'c-google');
  assert.equal(channelOf('Google', channels), 'c-google');
  assert.equal(channelOf('Facebook Ads', channels), 'c-meta');
  assert.equal(channelOf('Xerox', channels), null, 'a key under three letters never matches');
  assert.equal(channelOf('Googleplex', channels), null, 'a key must end on a word');
  assert.equal(channelOf('Meta Google', [...channels, { uid: 'c-mg', name: 'Meta Google', utm_source: null }]), 'c-mg', 'the longest key wins');
  assert.equal(channelOf('Google', [...channels, { uid: 'c-g2', name: 'Google', utm_source: null }]), null, 'two channels: none');
  const spend = channelSpend([
    line({ amount_cents: -30000, category: 'Advertising', counterparty_name: 'Google Ads' }),
    line({ amount_cents: -20000, category: 'Advertising', counterparty_name: 'Google Ads' }),
    line({ amount_cents: -10000, category: 'Software', counterparty_name: 'Google Ads' }),
    line({ amount_cents: -5000, category: 'Advertising', counterparty_name: 'Unknown Media' }),
  ], ['2026-09'], channels);
  assert.deepEqual(spend, [{ month: '2026-09', channel_uid: 'c-google', cents: 50000 }]);
});

test('pure: cash, treasury and runway from the three full months before today', () => {
  const lines = ['2026-07-10', '2026-08-10', '2026-09-10'].map((d) => line({ amount_cents: -100000, posted_on: d }));
  const f = cashFacts(lines, [{ kind: 'checking', available_cents: 1200000 }, { kind: 'savings', available_cents: null }], 5000000, '2026-10-21', false);
  assert.deepEqual(f, { cash_cents: 1200000, treasury_cents: 5000000, runway_months: 12, runway_reason: null, average_net_burn_cents: 100000 });
  const short = cashFacts(lines.slice(1), [{ kind: 'checking', available_cents: 1200000 }], null, '2026-10-21', false);
  assert.equal(short.runway_months, null);
  assert.match(String(short.runway_reason), /fewer than three full months/);
  assert.match(String(cashFacts(lines, [], null, '2026-10-21', false).runway_reason), /no available balance/);
  assert.match(String(cashFacts(lines, [{ kind: 'checking', available_cents: 1 }], null, '2026-10-21', true).runway_reason), /more lines than one read/);
});

test('pure: hires affordable keeps twelve months of runway; each missing input says why', () => {
  // $240k cash: $20k a month for 12 months; burn $10k leaves $10k; $5k a head → 2.
  assert.deepEqual(hiresAffordable({ cash_cents: 240_000_00, average_net_burn_cents: 10_000_00, payroll_cents: 15_000_00, headcount: 3 }),
    { value: 2, reason: null, cost_per_head_cents: 5_000_00 });
  assert.equal(hiresAffordable({ cash_cents: 6_000_00, average_net_burn_cents: 10_000_00, payroll_cents: 15_000_00, headcount: 3 }).value, 0, 'never negative');
  assert.match(String(hiresAffordable({ cash_cents: null, average_net_burn_cents: 1, payroll_cents: 1, headcount: 1 }).reason), /no available balance/);
  assert.match(String(hiresAffordable({ cash_cents: 1, average_net_burn_cents: null, payroll_cents: 1, headcount: 1 }).reason), /three full months/);
  assert.match(String(hiresAffordable({ cash_cents: 1, average_net_burn_cents: 1, payroll_cents: null, headcount: 1 }).reason), /no payroll/);
  assert.match(String(hiresAffordable({ cash_cents: 1, average_net_burn_cents: 1, payroll_cents: 1, headcount: 0 }).reason), /roster/);
});

test('pure: payments to an Axal partner\'s company are summed for a proposal; anything else is not', () => {
  const partners = [{ uid: 'p1', company: 'Brightlane Advisory LLC' }, { uid: 'p2', company: 'Twin Co' }, { uid: 'p3', company: 'Twin Co.' }];
  const out = partnerPayments([
    line({ amount_cents: -120000, counterparty_name: 'BRIGHTLANE ADVISORY', posted_on: '2026-08-02' }),
    line({ amount_cents: -30000, counterparty_name: 'Brightlane Advisory, LLC', posted_on: '2026-09-02' }),
    line({ amount_cents: -50000, counterparty_name: 'Brightlane Advisory', posted: false }),
    line({ amount_cents: 70000, counterparty_name: 'Brightlane Advisory' }),
    line({ amount_cents: -40000, counterparty_name: 'Twin Co' }),
    line({ amount_cents: -40000, counterparty_name: 'Brightlane Advisory Group' }),
  ], partners);
  assert.deepEqual(out, [{ partner_uid: 'p1', company: 'Brightlane Advisory LLC', paid_cents: 150000, payments: 2, since: '2026-08-02' }]);
});
