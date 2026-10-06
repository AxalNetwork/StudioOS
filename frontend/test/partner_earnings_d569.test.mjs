/**
 * D569 (#1174) — the partner earnings screens and the admin commissions
 * console: `/partner/earnings`, `/partner/referrals`,
 * `/partner/relationships/:id`, `/partner/leaderboard` and `/admin/commissions`.
 *
 * Every component is rendered with fixtures shaped like the Worker's real
 * answers (`routes/network.ts`, `routes/partnernet.ts`, `routes/introductions.ts`,
 * `routes/admin_platform.ts`), in each of its states, and every vocabulary
 * the pages mirror is read back out of those files.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/partner_earnings_d569.test.mjs
 */
// Set before any Date is built: a SQLite timestamp has no zone mark, and a
// reader that forgot to treat it as UTC is only caught off UTC.
process.env.TZ = 'America/New_York';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  PAYOUT_METHODS, PAYOUT_MIN_CENTS, PAYOUT_ACTIONS, TABLE_DEFAULT_CURRENCY, COMMISSION_STATUS, PAYOUT_STATUS,
  RELATIONSHIP_TYPES, BADGE_LABELS, SOURCE_LABELS, EARNINGS_AREA,
  centsOf, formatMoney, timeOf, dayOf, sourceLabel, totalsByStatus, payoutsInFlight, payoutOptions,
  payoutRequestBody, payoutDetails, payoutActionsFor, filterCommissions, commissionsForReferral,
  creditsResetDay, eventEntry, timeline, interactionBody, rankBoard, ruleAmount, ruleActive, takeRateInput,
  relationshipLogPath,
} from '../src/lib/partnerEarnings.js';
import { EarningsTotals, CommissionsList, PayoutRequestForm, PayoutHistory, optionLabel } from '../src/pages/partner/earnings/PartnerEarnings.jsx';
import { ReferralCodeCard, IntroCreditsCard, SignupsTable, filterSignups } from '../src/pages/partner/earnings/PartnerReferrals.jsx';
import { RelationshipHeader, RelationshipTimeline, LogInteractionForm } from '../src/pages/partner/earnings/PartnerRelationshipLog.jsx';
import { LeaderboardTable, ViewerStanding } from '../src/pages/partner/earnings/PartnerLeaderboard.jsx';
import { RulesTable, TakeRateCard, PayoutQueue, AllCommissionsTable } from '../src/pages/admin/AdminCommissions.jsx';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => html(el).replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

const NETWORK = read('cloudflare-worker/src/routes/network.ts');
const PARTNERNET = read('cloudflare-worker/src/routes/partnernet.ts');
const quoted = (s) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

/* ------------------------------------------------------------------ *
 * Fixtures, in the routes' own shapes
 * ------------------------------------------------------------------ */

// GET /network/commissions/me → { balance_cents, lifetime_cents, commissions: SELECT * … ORDER BY created_at DESC }.
// As the writers leave them: a rule commission names its referral and takes
// the table's USD; a purchase commission names none and carries the payment's
// currency; a compounding bonus names none and takes USD.
const COMMISSIONS = [
  { id: 14, user_id: 3, referral_id: 41, amount_cents: 35000, currency: 'USD', source_type: 'deal_funding', source_id: 'd-9', status: 'accrued', description: 'Introduction to Acme closed', created_at: '2026-10-03 09:00:00', paid_at: null },
  { id: 13, user_id: 3, referral_id: null, amount_cents: 70000, currency: 'USD', source_type: 'purchase', source_id: 'pi_1', status: 'accrued', description: 'Referral commission (10% of Studio)', created_at: '2026-10-02 10:00:00', paid_at: null },
  { id: 12, user_id: 3, referral_id: 40, amount_cents: 5000, currency: 'USD', source_type: 'kyc_approved', source_id: 'k-2', status: 'accrued', description: '$50 flat when a referred user completes KYC', created_at: '2026-10-01 23:30:00', paid_at: null },
  { id: 7, user_id: 3, referral_id: 41, amount_cents: 500000, currency: 'USD', source_type: 'lp_onboarded', source_id: 'lp-3', status: 'paid', description: '$5,000 flat for successful LP onboarding', created_at: '2026-09-05 10:00:00', paid_at: '2026-09-20 12:00:00' },
  { id: 9, user_id: 3, referral_id: null, amount_cents: 20000, currency: 'EUR', source_type: 'purchase', source_id: 'pi_0', status: 'paid', description: 'Referral commission (10% of Growth)', created_at: '2026-09-01 08:00:00', paid_at: '2026-09-20 12:00:00' },
  { id: 8, user_id: 3, referral_id: null, amount_cents: 2500, currency: 'USD', source_type: 'kyc_approved_compound', source_id: 'k-1:L2', status: 'paid', description: 'Compounding L2 bonus from kyc_approved', created_at: '2026-08-20 08:00:00', paid_at: '2026-09-20 12:00:00' },
];
const COMMISSIONS_ME = { balance_cents: 110000, lifetime_cents: 632500, commissions: COMMISSIONS };

// GET /network/payouts/me → SELECT * FROM payouts (a bare array)
const PAYOUTS = [
  { id: 5, user_id: 3, amount_cents: 120000, currency: 'USD', status: 'requested', payout_method: 'wire', payout_details: '{"note":"IBAN ending 1234"}', failure_reason: null, processed_by: null, created_at: '2026-10-04 10:00:00', completed_at: null },
  { id: 4, user_id: 3, amount_cents: 30000, currency: 'USD', status: 'processing', payout_method: 'stripe', payout_details: null, failure_reason: null, processed_by: 7, created_at: '2026-10-02 10:00:00', completed_at: null },
  { id: 3, user_id: 3, amount_cents: 640000, currency: 'USD', status: 'completed', payout_method: 'wire', payout_details: null, failure_reason: null, processed_by: 7, created_at: '2026-09-28 10:00:00', completed_at: '2026-09-30 15:00:00' },
  { id: 2, user_id: 3, amount_cents: 200000, currency: 'USD', status: 'failed', payout_method: 'crypto', payout_details: null, failure_reason: 'Bank returned the transfer: account closed', processed_by: 7, created_at: '2026-09-14 10:00:00', completed_at: null },
];

/* ------------------------------------------------------------------ *
 * The vocabularies, read back out of the Worker
 * ------------------------------------------------------------------ */

test('the payout vocabulary is the request and process routes\' own', () => {
  const methods = /if \(!\[([^\]]*)\]\.includes\(payout_method\)\)/.exec(NETWORK);
  assert.ok(methods, 'the payout_method check moved; re-read it');
  assert.deepEqual(PAYOUT_METHODS.map((m) => m.value), quoted(methods[1]));
  const min = /if \(!amt \|\| amt < (\d+)\)/.exec(NETWORK);
  assert.equal(PAYOUT_MIN_CENTS, Number(min?.[1]));
  const actions = /if \(!\[([^\]]*)\]\.includes\(action\)\)/.exec(NETWORK);
  assert.deepEqual(Object.keys(PAYOUT_ACTIONS).sort(), quoted(actions[1]).sort());
  // Every status the payout routes write is one the pages can name.
  for (const s of ['requested', 'processing', 'completed', 'failed']) {
    assert.match(NETWORK, new RegExp(`status = '${s}'|status, payout_method[\\s\\S]{0,80}'${s}'|'${s}'`));
    assert.ok(PAYOUT_STATUS[s], `${s} has no label`);
  }
  for (const s of ['accrued', 'paid']) {
    assert.match(NETWORK, new RegExp(`status = '${s}'`));
    assert.ok(COMMISSION_STATUS[s], `${s} has no label`);
  }
  assert.match(NETWORK, new RegExp(`currency TEXT NOT NULL DEFAULT '${TABLE_DEFAULT_CURRENCY}'`));
});

test('every seeded rule source, a purchase and the types and badges are named, not title-cased', () => {
  const seeded = [...NETWORK.matchAll(/\['referral_\w+', '(\w+)'/g)].map((m) => m[1]);
  assert.equal(seeded.length, 5, 'the rule seeds moved; re-read them');
  for (const s of [...seeded, 'purchase']) assert.ok(SOURCE_LABELS[s], `${s} has no label`);
  assert.equal(sourceLabel('kyc_approved'), 'KYC approved');
  assert.equal(sourceLabel('kyc_approved_compound'), 'KYC approved · compounding');
  assert.equal(sourceLabel('brand_new_thing'), 'Brand New Thing');
  assert.equal(sourceLabel(''), null);
  const types = /const REL_TYPES = new Set\(\[([^\]]*)\]\)/.exec(PARTNERNET);
  assert.deepEqual(Object.keys(RELATIONSHIP_TYPES), quoted(types[1]));
  const badges = [...PARTNERNET.matchAll(/badges\.push\('(\w+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(Object.keys(BADGE_LABELS).sort(), badges.sort());
});

/* ------------------------------------------------------------------ *
 * Values
 * ------------------------------------------------------------------ */

test('money is per currency and absent is never zero', () => {
  assert.equal(formatMoney(123450, 'USD'), '$1,234.50');
  assert.equal(formatMoney(35000, 'eur'), '€350.00');
  assert.equal(formatMoney('5000', 'USD'), '$50.00');
  assert.equal(formatMoney(500, null), '5.00', 'no currency: the number, and the page names the gap');
  for (const absent of [null, undefined, '', '  ', [], 'abc']) {
    assert.equal(formatMoney(absent, 'USD'), null, `${JSON.stringify(absent)} is not an amount`);
    assert.equal(centsOf(absent), null);
  }
});

test('a SQLite timestamp is read as UTC', () => {
  assert.equal(timeOf('2026-10-01 23:30:00'), Date.UTC(2026, 9, 1, 23, 30));
  assert.equal(dayOf('2026-10-01 23:30:00'), 'Oct 1, 2026');
  assert.equal(dayOf('2026-10-01T23:30:00.000Z'), 'Oct 1, 2026');
  assert.equal(dayOf(null), null);
  assert.equal(dayOf('not a date'), null);
});

test('totals are per status and per currency, never a currency-blind sum', () => {
  const { statuses, unreadable } = totalsByStatus([...COMMISSIONS, { id: 99, status: 'accrued', amount_cents: null, currency: 'USD' }]);
  const accrued = statuses.find((s) => s.key === 'accrued');
  const paid = statuses.find((s) => s.key === 'paid');
  assert.deepEqual(accrued.sums, [{ currency: 'USD', cents: 110000, count: 3 }]);
  assert.deepEqual(paid.sums, [{ currency: 'EUR', cents: 20000, count: 1 }, { currency: 'USD', cents: 502500, count: 2 }]);
  assert.equal(unreadable, 1, 'an unreadable amount is counted apart, not added as zero');
  const none = totalsByStatus([]);
  assert.deepEqual(none.statuses.map((s) => [s.key, s.sums.length]), [['accrued', 0], ['paid', 0]]);
  const flight = payoutsInFlight(PAYOUTS);
  assert.equal(flight.count, 2, 'requested and processing only');
  assert.deepEqual(flight.sums, [{ currency: 'USD', cents: 150000, count: 2 }]);
});

/**
 * The request route, as `network.ts` runs it: accrued rows oldest first,
 * whole rows only, nothing under the minimum. Written out here so the options
 * can be put through it.
 */
function routeAccepts(rows, amt) {
  if (!amt || amt < 1000) return false;
  const accrued = rows.filter((r) => r.status === 'accrued')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id);
  const balance = accrued.reduce((n, r) => n + r.amount_cents, 0);
  if (amt > balance) return false;
  let remaining = amt;
  for (const row of accrued) {
    if (remaining <= 0) break;
    if (row.amount_cents > remaining) return false;
    remaining -= row.amount_cents;
  }
  return remaining === 0;
}

test('the payout form offers exactly the amounts the route accepts, oldest first', () => {
  const plan = payoutOptions(COMMISSIONS);
  assert.equal(plan.accruedCount, 3);
  assert.deepEqual(plan.options.map((o) => [o.count, o.cents, o.currency, o.ids]), [
    [1, 5000, 'USD', [12]],
    [2, 75000, 'USD', [12, 13]],
    [3, 110000, 'USD', [12, 13, 14]],
  ]);
  for (const o of plan.options) assert.ok(routeAccepts(COMMISSIONS, o.cents), `${o.cents} would be refused`);
  // An amount between the runs is one the route refuses, which is why there is no free box.
  assert.equal(routeAccepts(COMMISSIONS, 40000), false);
  // Under the minimum: nothing offered.
  const small = [{ id: 1, status: 'accrued', amount_cents: 400, currency: 'USD', created_at: '2026-01-01 00:00:00' }];
  assert.deepEqual(payoutOptions(small).options, []);
  assert.equal(payoutOptions(small).currency, 'USD');
  // The runs stop where the currency changes.
  const mixed = [
    { id: 1, status: 'accrued', amount_cents: 2000, currency: 'USD', created_at: '2026-01-01 00:00:00' },
    { id: 2, status: 'accrued', amount_cents: 9000, currency: 'EUR', created_at: '2026-01-02 00:00:00' },
  ];
  const mp = payoutOptions(mixed);
  assert.deepEqual(mp.options.map((o) => o.cents), [2000]);
  assert.equal(mp.stoppedAt, 'currency');
  // Equal timestamps fall back to the id, as the rows are inserted.
  const tied = [
    { id: 8, status: 'accrued', amount_cents: 3000, currency: 'USD', created_at: '2026-01-01 00:00:00' },
    { id: 7, status: 'accrued', amount_cents: 1000, currency: 'USD', created_at: '2026-01-01 00:00:00' },
  ];
  assert.deepEqual(payoutOptions(tied).options.map((o) => o.ids), [[7], [7, 8]]);
  assert.equal(optionLabel(plan.options[2], true), 'All accrued · $1,100.00 USD (3 commissions)');
  assert.equal(optionLabel(plan.options[0], false), 'Oldest 1 · $50.00 USD');
});

test('the request body is the three fields the route reads', () => {
  const o = { count: 2, cents: 75000, currency: 'USD' };
  assert.deepEqual(payoutRequestBody(o, 'wire', '  IBAN ending 1234 '), { amount_cents: 75000, payout_method: 'wire', payout_details: { note: 'IBAN ending 1234' } });
  assert.deepEqual(payoutRequestBody(o, 'crypto', '   '), { amount_cents: 75000, payout_method: 'crypto' });
  assert.deepEqual(payoutDetails('{"note":"x","empty":""}'), [['note', 'x']]);
  assert.equal(payoutDetails('plain words'), 'plain words');
  assert.equal(payoutDetails(null), null);
});

/* ------------------------------------------------------------------ *
 * Earnings
 * ------------------------------------------------------------------ */

const ready = (data) => ({ status: 'ready', data });

test('the totals strip: loading, unreadable, and per-currency figures with words for none', () => {
  assert.match(html(h(EarningsTotals, { commissions: { status: 'loading' }, payouts: { status: 'loading' } })), /aria-busy="true"/);
  const bad = text(h(EarningsTotals, { commissions: { status: 'unreadable' }, payouts: { status: 'unreadable' } }));
  assert.equal((bad.match(/Unreadable/g) || []).length, 3);
  assert.doesNotMatch(bad, /\$0|Nothing accrued/);
  const ok = text(h(EarningsTotals, { commissions: ready(COMMISSIONS_ME), payouts: ready(PAYOUTS) }));
  assert.match(ok, /Accrued \$1,100\.00 USD/);
  assert.match(ok, /Paid €200\.00 EUR \$5,025\.00 USD Claimed/, 'one line per currency');
  assert.match(ok, /In payout requests \$1,500\.00 USD/);
  assert.doesNotMatch(ok, /6,325\.00|5,225\.00/, 'the route\'s lifetime_cents adds dollars to euros and is not shown, nor is any cross-currency sum');
  const empty = text(h(EarningsTotals, { commissions: ready({ commissions: [] }), payouts: ready([]) }));
  assert.match(empty, /Nothing accrued/);
  assert.match(empty, /Nothing paid yet/);
  assert.match(empty, /No request open/);
  assert.doesNotMatch(empty, /\$0/);
});

test('the commissions ledger: each state, and a row in the canvas\'s columns', () => {
  assert.match(html(h(CommissionsList, { state: 'loading', rows: [], total: 0 })), /animate-pulse/);
  const bad = text(h(CommissionsList, { state: 'unreadable', rows: [], total: 0, onRetry: () => {} }));
  assert.match(bad, /Your commissions could not be read\. This is not a claim that you have none\./);
  assert.doesNotMatch(bad, /No commissions yet/);
  const empty = html(h(CommissionsList, { state: 'ready', rows: [], total: 0 }));
  assert.match(empty, /No commissions yet/);
  assert.match(empty, /href="\/partner\/referrals"/);
  const filtered = text(h(CommissionsList, { state: 'ready', rows: [], total: 6 }));
  assert.match(filtered, /No commission matches these filters/);
  assert.doesNotMatch(filtered, /No commissions yet/);
  // Each cell carries its own label for the phone layout, so the label reads before the value.
  const rows = text(h(CommissionsList, { state: 'ready', rows: COMMISSIONS, total: 6 }));
  assert.match(rows, /Deal funded Description Introduction to Acme closed Amount \$350\.00 USD Status Accrued Accrued Oct 3, 2026 Paid Not paid yet/);
  assert.match(rows, /Purchase Description Referral commission \(10% of Growth\) Amount €200\.00 EUR Status Paid Accrued Sep 1, 2026 Paid Sep 20, 2026/);
  assert.match(rows, /KYC approved · compounding Description Compounding L2 bonus from kyc_approved Amount \$25\.00 USD Status Paid Accrued Aug 20, 2026 Paid Sep 20, 2026/);
  assert.match(html(h(CommissionsList, { state: 'ready', rows: COMMISSIONS, total: 6 })), /class="hidden gap-3[^"]*md:grid/, 'the header row is a wide-screen row only');
  assert.match(rows, /6 commissions/);
  const paged = text(h(CommissionsList, { state: 'ready', rows: COMMISSIONS, total: 6, shown: 2, onMore: () => {} }));
  assert.match(paged, /showing 2/);
  assert.match(paged, /Show 4 more/);
  assert.match(text(h(CommissionsList, { state: 'ready', rows: COMMISSIONS.slice(0, 2), total: 6 })), /2 of 6 commissions/);
});

test('the ledger filters narrow by status, source, period and search', () => {
  const now = Date.UTC(2026, 9, 6);
  assert.deepEqual(filterCommissions(COMMISSIONS, { status: 'paid', now }).map((c) => c.id), [7, 9, 8]);
  assert.deepEqual(filterCommissions(COMMISSIONS, { source: 'purchase', now }).map((c) => c.id), [13, 9]);
  assert.deepEqual(filterCommissions(COMMISSIONS, { period: '30d', now }).map((c) => c.id), [14, 13, 12]);
  assert.deepEqual(filterCommissions(COMMISSIONS, { query: 'acme', now }).map((c) => c.id), [14]);
  assert.deepEqual(filterCommissions(COMMISSIONS, { query: 'deal funded', now }).map((c) => c.id), [14], 'the source label is searched too');
});

test('the request form: nothing accrued, below the minimum, a currency stop, the form, the confirmation, the result', () => {
  const none = text(h(PayoutRequestForm, { state: 'ready', plan: payoutOptions([]), draft: {} }));
  assert.match(none, /Nothing is accrued, so there is nothing to request/);
  const small = text(h(PayoutRequestForm, { state: 'ready', plan: payoutOptions([{ id: 1, status: 'accrued', amount_cents: 400, currency: 'USD', created_at: '2026-01-01 00:00:00' }]), draft: {} }));
  assert.match(small, /do not yet reach the minimum a request takes: \$10\.00 USD/);
  assert.match(text(h(PayoutRequestForm, { state: 'unreadable', plan: payoutOptions([]), draft: {} })), /could not be read/);

  const plan = payoutOptions(COMMISSIONS);
  const form = html(h(PayoutRequestForm, { state: 'ready', plan, draft: { optionIndex: null, method: '', note: '' } }));
  const amounts = [...form.matchAll(/<option value="(\d)"[^>]*>([^<]+)<\/option>/g)].map((m) => m[2]);
  assert.deepEqual(amounts, ['Oldest 1 · $50.00 USD', 'Oldest 2 · $750.00 USD', 'All accrued · $1,100.00 USD (3 commissions)']);
  assert.match(form, /<option value="2" selected="">All accrued/, 'the whole balance is the default');
  assert.match(form, /<option value="" selected="">Choose a method<\/option><option value="stripe">Stripe<\/option><option value="wire">Wire transfer<\/option><option value="crypto">Crypto<\/option>/);
  assert.match(form, /data-testid="button-review-payout"[^>]*disabled=""|disabled=""[^>]*data-testid="button-review-payout"/, 'no method, no review');
  const chosen = html(h(PayoutRequestForm, { state: 'ready', plan, draft: { optionIndex: 1, method: 'wire', note: '' } }));
  assert.doesNotMatch(chosen, /disabled=""[^>]*data-testid="button-review-payout"/);

  const confirm = text(h(PayoutRequestForm, { state: 'ready', plan, stage: 'confirm', draft: { optionIndex: 1, method: 'wire', note: 'IBAN ending 1234' } }));
  assert.match(confirm, /Confirm the request Amount \$750\.00 USD Method Wire transfer Claims the 2 oldest accrued commissions Note IBAN ending 1234/);
  assert.match(confirm, /marked Paid as soon as the request is recorded\. The payout stays Requested until an admin processes it, and nothing on this page sends money/);
  assert.match(confirm, /Cancel Confirm request/);
  // With no amount picked, what is confirmed is the default the select shows: everything accrued.
  const whole = text(h(PayoutRequestForm, { state: 'ready', plan, stage: 'confirm', draft: { optionIndex: null, method: 'crypto', note: '' } }));
  assert.match(whole, /Amount \$1,100\.00 USD Method Crypto Claims the 3 oldest accrued commissions/);
  assert.doesNotMatch(whole, /Note/, 'no note row without a note');

  const ok = html(h(PayoutRequestForm, { state: 'ready', plan, draft: {}, result: { ok: true, text: 'Requested $750.00 USD. It reads Requested until an admin processes it.' } }));
  assert.match(ok, /role="status"[^>]*>Requested \$750\.00 USD/);
  const refused = html(h(PayoutRequestForm, { state: 'ready', plan, draft: {}, result: { ok: false, text: 'Your balance changed during the request (concurrent payout). Please refresh and retry.' } }));
  assert.match(refused, /role="alert"[^>]*>Your balance changed during the request/);

  const mixed = payoutOptions([
    { id: 1, status: 'accrued', amount_cents: 2000, currency: 'USD', created_at: '2026-01-01 00:00:00' },
    { id: 2, status: 'accrued', amount_cents: 9000, currency: 'EUR', created_at: '2026-01-02 00:00:00' },
  ]);
  assert.match(text(h(PayoutRequestForm, { state: 'ready', plan: mixed, draft: {} })), /Only your oldest commissions in USD are offered/);
});

test('the payout history: each state; a failure says its reason and that its day is not recorded', () => {
  assert.match(html(h(PayoutHistory, { state: 'loading', rows: [] })), /animate-pulse/);
  assert.match(text(h(PayoutHistory, { state: 'unreadable', rows: [], onRetry: () => {} })), /This is not a claim that nothing was requested or paid/);
  assert.match(text(h(PayoutHistory, { state: 'ready', rows: [] })), /No payout requested yet/);
  const list = text(h(PayoutHistory, { state: 'ready', rows: PAYOUTS }));
  assert.match(list, /\$1,200\.00 USD Wire transfer Requested Requested Oct 4, 2026 Note: IBAN ending 1234/);
  assert.match(list, /\$6,400\.00 USD Wire transfer Completed Requested Sep 28, 2026 · completed Sep 30, 2026/);
  assert.match(list, /\$2,000\.00 USD Crypto Failed Requested Sep 14, 2026 Bank returned the transfer: account closed · the day it failed is not recorded/);
  assert.match(list, /4 requests/);
});

/* ------------------------------------------------------------------ *
 * Referrals
 * ------------------------------------------------------------------ */

// GET /network/referral/code
const CODE = { code: 'K7Q2ZX', legacy_code: 'AXAL-1A2B3C', link: 'https://axal.vc/?ref=K7Q2ZX', register_link: 'https://axal.vc/register?ref=K7Q2ZX' };
// GET /network/referral/list
const SIGNUPS = [
  { id: 41, status: 'converted', created_at: '2026-09-10 10:00:00', converted_at: '2026-10-03 09:00:00', referred_user_id: 88, referred_name: 'Dana Founder', referred_email: 'dana@example.com', kyc_status: 'approved' },
  { id: 40, status: 'pending', created_at: '2026-09-01 10:00:00', converted_at: null, referred_user_id: 87, referred_name: null, referred_email: 'lee@example.com', kyc_status: null },
  { id: 39, status: 'pending', created_at: '2026-08-01 10:00:00', converted_at: null, referred_user_id: 86, referred_name: 'Sam Quiet', referred_email: 'sam@example.com', kyc_status: 'pending' },
];
// GET /introductions/credits
const CREDITS = { credits: { month: '2026-10', monthly_allowance: 3, allowance_remaining: 2, used_this_month: 1, purchased_total: 10, purchased_remaining: 4, referral_total: 2, referral_remaining: 1, balance: 7 }, buy_path: '/products#introduction-packs', refer_path: '/account/referrals' };

test('the referral code: each state, both links, the old code, and Share only where the browser has it', () => {
  assert.match(html(h(ReferralCodeCard, { state: 'loading' })), /animate-pulse/);
  assert.match(text(h(ReferralCodeCard, { state: 'unreadable', onRetry: () => {} })), /Your referral code could not be read\. This is not a claim that you have none\./);
  const card = html(h(ReferralCodeCard, { state: 'ready', data: CODE, canShare: false }));
  assert.match(card, /data-testid="text-referral-code"[^>]*>K7Q2ZX</);
  assert.match(card, /https:\/\/axal\.vc\/\?ref=K7Q2ZX/);
  assert.match(card, /Straight to sign-up: https:\/\/axal\.vc\/register\?ref=K7Q2ZX/);
  assert.match(card, /Your previous code AXAL-1A2B3C still works/);
  assert.doesNotMatch(card, /button-share-code/);
  assert.match(html(h(ReferralCodeCard, { state: 'ready', data: CODE, canShare: true })), /button-share-code/);
  assert.match(html(h(ReferralCodeCard, { state: 'ready', data: CODE, copied: { ok: false, text: 'This browser would not copy it.' } })), /role="alert"/);
});

test('the credits card reads the monthly allowance, names the renewal day, and never fills a gap with zero', () => {
  assert.equal(creditsResetDay('2026-10'), 'Nov 1, 2026');
  assert.equal(creditsResetDay('2026-12'), 'Jan 1, 2027');
  assert.equal(creditsResetDay(''), null);
  const card = text(h(IntroCreditsCard, { state: 'ready', data: CREDITS }));
  assert.match(card, /7 left 2 of 3 from this month’s allowance 1 of 2 earned by referrals 4 of 10 bought 1 used this month The allowance renews on Nov 1, 2026 \(UTC\)/);
  const gaps = text(h(IntroCreditsCard, { state: 'ready', data: { credits: { month: 'x', balance: null } } }));
  assert.doesNotMatch(gaps, /\b0\b/);
  assert.match(gaps, /Not recorded left/);
  assert.match(gaps, /Renewal day not recorded/);
  assert.match(text(h(IntroCreditsCard, { state: 'unreadable', onRetry: () => {} })), /This is not a claim that you have none left/);
});

test('the sign-ups: role not returned, each one\'s commission by its referral id, and the states', () => {
  assert.deepEqual(commissionsForReferral(41, COMMISSIONS).map((c) => c.id), [14, 7]);
  assert.deepEqual(commissionsForReferral(40, COMMISSIONS).map((c) => c.id), [12]);
  assert.deepEqual(commissionsForReferral(null, COMMISSIONS), [], 'a purchase or compounding row names no sign-up');
  const table = text(h(SignupsTable, { state: 'ready', rows: SIGNUPS, total: 3, commissionsState: 'ready', commissions: COMMISSIONS }));
  assert.match(table, /Dana Founder Role Not returned Signed up Sep 10, 2026 Status Converted Oct 3, 2026 KYC Approved Commission \$350\.00 USD accrued \$5,000\.00 USD paid/);
  assert.match(table, /lee@example\.com Role Not returned .* Commission \$50\.00 USD accrued Sam/);
  assert.match(table, /Sam Quiet .* Signed up .* Pending Commission None linked/);
  const unread = text(h(SignupsTable, { state: 'ready', rows: SIGNUPS, total: 3, commissionsState: 'unreadable', commissions: [] }));
  assert.equal((unread.match(/Unreadable/g) || []).length, 3);
  assert.doesNotMatch(unread, /None linked/, 'a commission read that failed is not "none"');
  assert.match(text(h(SignupsTable, { state: 'ready', rows: [], total: 0, onCopyCode: () => {} })), /Nobody has signed up with your code yet .* Copy your code/);
  assert.match(text(h(SignupsTable, { state: 'unreadable', rows: [], total: 0, onRetry: () => {} })), /This is not a claim that nobody signed up/);
  assert.deepEqual(filterSignups(SIGNUPS, { status: 'pending' }).map((r) => r.id), [40, 39]);
  assert.deepEqual(filterSignups(SIGNUPS, { query: 'LEE@' }).map((r) => r.id), [40]);
  assert.deepEqual(filterSignups(SIGNUPS, { period: '30d', now: Date.UTC(2026, 9, 6) }).map((r) => r.id), [41]);
});

/* ------------------------------------------------------------------ *
 * The relationship log
 * ------------------------------------------------------------------ */

// GET /partnernet/relationships (accepted, with `other`)
const REL = { id: 5, partner_a_id: 3, partner_b_id: 21, relationship_type: 'operator_partner', strength_score: 50, status: 'accepted', created_at: '2026-09-01 10:00:00', responded_at: '2026-09-02T10:00:00.000Z', last_interaction_at: '2026-10-05T14:00:00.000Z', other: { id: 21, name: 'Robin Operator', email: 'robin@example.com', role: 'partner' } };
// GET /partnernet/relationships/:id/events (details parsed)
const EVENTS = [
  { id: 1, relationship_id: 5, event_type: 'requested', details: { requested_by: 3, type: 'operator_partner' }, created_at: '2026-09-01 10:00:00' },
  { id: 2, relationship_id: 5, event_type: 'accepted', details: { by: 21 }, created_at: '2026-09-02 10:00:00' },
  { id: 3, relationship_id: 5, event_type: 'updated', details: { by: 3, fields: ['private_note'] }, created_at: '2026-09-20 10:00:00' },
];
// GET /partnernet/relationships/:id/interactions → { items }
const INTERACTIONS = [
  { id: 11, uid: 'i11', relationship_id: 5, kind: 'call', note: 'Talked through the Q4 retainer.', interacted_at: '2026-10-05T14:00:00.000Z', recorded_by: 3, created_at: '2026-10-05T15:00:00.000Z', recorded_by_name: 'Pat Partner' },
  { id: 10, uid: 'i10', relationship_id: 5, kind: 'note', note: null, interacted_at: '2026-09-25T12:00:00.000Z', recorded_by: 3, created_at: '2026-09-25T12:00:00.000Z', recorded_by_name: null },
];

test('the timeline merges both logs newest first, in words', () => {
  const entries = timeline(EVENTS, INTERACTIONS);
  assert.deepEqual(entries.map((e) => e.title), ['Call', 'Note', 'Updated', 'Accepted', 'Request sent']);
  assert.equal(eventEntry(EVENTS[0]).detail, 'Asked to record the relationship as operator and partner.');
  assert.equal(eventEntry(EVENTS[2]).detail, 'Changed a private note.');
  for (const type of ['requested', 'accepted', 'declined', 'withdrawn', 'removed', 'updated']) {
    assert.match(PARTNERNET, new RegExp(`'${type}'`), `${type} is not an event the route writes`);
    assert.notEqual(eventEntry({ event_type: type }).title, 'Event');
  }
  const view = text(h(RelationshipTimeline, { events: ready(EVENTS), interactions: ready(INTERACTIONS) }));
  assert.match(view, /Interaction Call Oct 5, 2026 Talked through the Q4 retainer\. Logged by Pat Partner/);
  assert.match(view, /Interaction Note Sep 25, 2026 No note/);
  assert.match(view, /Event Request sent Sep 1, 2026 Asked to record/);
  assert.match(view, /5 entries, newest first/);
});

test('the timeline: one log failing keeps the other; a refusal is said as one; both empty is the empty state', () => {
  const half = text(h(RelationshipTimeline, { events: ready(EVENTS), interactions: { status: 'unreadable' }, onRetry: () => {} }));
  assert.match(half, /The interaction log could not be read\. This is not a claim that it is empty\./);
  assert.match(half, /Request sent/);
  const closed = text(h(RelationshipTimeline, { events: { status: 'refused', code: 409 }, interactions: { status: 'refused', code: 409 } }));
  assert.match(closed, /has not been accepted, or it has ended, so its log is closed/);
  assert.doesNotMatch(closed, /could not be read/);
  const empty = text(h(RelationshipTimeline, { events: ready([]), interactions: ready([]), onLog: () => {} }));
  assert.match(empty, /Nothing logged yet .* Log an interaction/);
  assert.match(html(h(RelationshipTimeline, { events: { status: 'loading' }, interactions: { status: 'loading' } })), /animate-pulse/);
});

test('the header reads the book; a relationship stores no company', () => {
  const head = text(h(RelationshipHeader, { state: 'ready', rel: REL }));
  assert.match(head, /Robin Operator Operator and partner Role Partner Company Not recorded In your book since Sep 2, 2026 Last interaction Oct 5, 2026/);
  assert.match(text(h(RelationshipHeader, { state: 'ready', rel: null })), /not among your accepted relationships/);
  assert.match(html(h(RelationshipHeader, { state: 'loading' })), /animate-pulse/);
});

test('logging an interaction: the route\'s fields, no outcome, and the empty touch refused', () => {
  const form = html(h(LogInteractionForm, { draft: { kind: 'call', date: '', time: '', note: '' } }));
  assert.match(form, /<option value="call" selected="">Call<\/option><option value="email">Email<\/option><option value="meeting">Meeting<\/option><option value="message">Message<\/option><option value="note">Note<\/option>/);
  assert.match(form, /type="date"/);
  assert.match(form, /type="time"/);
  assert.match(form, /it has no outcome field/);
  assert.doesNotMatch(form, /data-testid="input-interaction-outcome"/);
  assert.match(text(h(LogInteractionForm, { draft: {}, closed: 'This relationship has not been accepted, or it has ended, so its log is closed.' })), /its log is closed/);
  assert.deepEqual(interactionBody({ kind: 'call', date: '2026-10-05', time: '', note: '  Q4 ' }), { kind: 'call', note: 'Q4', interacted_at: '2026-10-05T12:00:00.000Z' });
  assert.deepEqual(interactionBody({ kind: 'email', date: '2026-10-05', time: '14:00', note: '' }), { kind: 'email', note: null, interacted_at: '2026-10-05T18:00:00.000Z' }, '14:00 in New York is 18:00Z');
  assert.deepEqual(interactionBody({ kind: 'note', date: '', time: '', note: '' }), { kind: 'note', note: null }, 'neither a note nor a date: the page refuses it before the route does');
  assert.equal(relationshipLogPath(5), '/partner/relationships/5');
});

/* ------------------------------------------------------------------ *
 * The leaderboard
 * ------------------------------------------------------------------ */

// GET /partnernet/leaderboard/public — initials, never an email
const PUBLIC_BOARD = [
  { id: 30, name: 'JD', role: 'founder', network_score: 61.5, active_relationships: 6, network_reach: 12, verified_badges: ['top_referrer', 'connector'] },
  { id: 3, name: 'PP', role: 'partner', network_score: 40, active_relationships: 3, network_reach: 2, verified_badges: [] },
  { id: 31, name: 'AB', role: 'investor', network_score: 40, active_relationships: 2, network_reach: 0, verified_badges: [] },
  { id: 32, name: 'User #32', role: 'partner', network_score: 12.4, active_relationships: 1, network_reach: 0, verified_badges: [] },
];
// GET /partnernet/leaderboard (admin) — names, emails, earnings
const ADMIN_BOARD = [{ id: 30, name: 'Jo Doe', email: 'jo@example.com', role: 'founder', network_score: 61.5, total_earnings: 90000, active_relationships: 6, network_reach: 12, verified_badges: [] }];

test('a rank is read off the returned scores, ties shared, and only the viewer is named', () => {
  const ranked = rankBoard(PUBLIC_BOARD, 3);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 2, 4]);
  assert.deepEqual(ranked.map((r) => r.isViewer), [false, true, false, false]);
  assert.equal(rankBoard([{ id: 1, network_score: null }])[0].rank, null, 'no score, no rank');
  const board = html(h(LeaderboardTable, { state: 'ready', ranked }));
  assert.match(board, /data-testid="row-board-viewer"[^>]*class="[^"]*bg-amber-50/);
  const words = text(h(LeaderboardTable, { state: 'ready', ranked }));
  assert.match(words, /1 Member Founder Top referrer Connector Network score 61\.5 Relationships 6 Reach 12 Change Not recorded/);
  assert.match(words, /2 Member You Partner Network score 40/);
  for (const hidden of ['JD', 'AB', 'User #32']) assert.doesNotMatch(words, new RegExp(`\\b${hidden}\\b`), `${hidden} is shown`);
  const admin = text(h(LeaderboardTable, { state: 'ready', ranked: rankBoard(ADMIN_BOARD, 3) }));
  assert.doesNotMatch(admin, /Jo Doe|jo@example\.com|90000|900\.00/, 'the admin arm\'s names, emails and earnings stay off the page');
  assert.match(words, /Names are never shown/);
});

test('the viewer\'s standing is a returned rank or "Not ranked", never a made-up number', () => {
  assert.match(text(h(ViewerStanding, { state: 'ready', ranked: rankBoard(PUBLIC_BOARD, 3) })), /Your rank 2 of the 4 the board shows, with a network score of 40\./);
  const out = text(h(ViewerStanding, { state: 'ready', ranked: rankBoard(PUBLIC_BOARD, 999) }));
  assert.match(out, /Not ranked You are not among the 4 members the board returns/);
  assert.doesNotMatch(out, /\b5\b/, 'no rank below the last one is invented');
  assert.match(text(h(ViewerStanding, { state: 'ready', ranked: [] })), /Not ranked The board has nobody on it yet/);
  assert.equal(html(h(ViewerStanding, { state: 'loading', ranked: [] })), '');
  assert.match(text(h(LeaderboardTable, { state: 'unreadable', ranked: [], onRetry: () => {} })), /This is not a claim that nobody is ranked/);
  assert.match(text(h(LeaderboardTable, { state: 'ready', ranked: [] })), /Nobody is ranked yet/);
});

/* ------------------------------------------------------------------ *
 * The admin console
 * ------------------------------------------------------------------ */

// GET /network/admin/commission-rules → SELECT * FROM commission_rules
const RULES = [
  { id: 2, rule_key: 'referral_deal_funded', source_type: 'deal_funding', amount_cents: null, percentage_bps: 200, description: '2% of funding amount when referred user closes a deal', active: 1 },
  { id: 1, rule_key: 'referral_kyc_approved', source_type: 'kyc_approved', amount_cents: 5000, percentage_bps: null, description: '$50 flat when a referred user completes KYC', active: 1 },
  { id: 3, rule_key: 'referral_spinout', source_type: 'spinout', amount_cents: null, percentage_bps: 100, description: '1% of spin-out raise', active: 0 },
];

test('the rules read as the route stores them: fixed in the table default, a percentage, on or off, and no edit', () => {
  assert.deepEqual(ruleAmount(RULES[1]), { kind: 'fixed', text: '$50.00', currency: 'USD' });
  assert.deepEqual(ruleAmount(RULES[0]), { kind: 'percentage', text: '2%', currency: null });
  assert.equal(ruleAmount({ amount_cents: null, percentage_bps: null }), null);
  assert.equal(ruleActive({ active: 0 }), false);
  assert.equal(ruleActive({ active: null }), true, 'the column defaults to 1');
  const table = text(h(RulesTable, { state: 'ready', rows: RULES }));
  assert.match(table, /referral_kyc_approved Source KYC approved Amount \$50\.00 USD · fixed Description \$50 flat/);
  assert.match(table, /referral_deal_funded Source Deal funded Amount 2% of the amount/);
  assert.match(table, /referral_spinout .* Active Off/);
  assert.match(table, /Read-only: no route edits a rule/);
  assert.doesNotMatch(html(h(RulesTable, { state: 'ready', rows: RULES })), /<button|<input/);
  assert.match(text(h(RulesTable, { state: 'ready', rows: [] })), /No commission rule is stored/);
  assert.match(text(h(RulesTable, { state: 'unreadable', rows: [], onRetry: () => {} })), /This is not a claim that there are none/);
});

// GET /admin/platform/take-rate
const TAKE = { bps: 1500, pct: 15, source: 'setting', updated_at: '2026-09-01T10:00:00.000Z', updated_by: 'hq@axal.vc', max_bps: 5000, default_bps: 1500, settlement: 'none', note: 'Applied to advisory sessions when a price is recorded, and stamped on that line so a later change to this rate cannot restate a past quarter.' };

test('the take rate: super admin only, said as the advisory take and not a commission rate, and edited in basis points', () => {
  const withheld = text(h(TakeRateCard, { allowed: false, state: 'loading' }));
  assert.match(withheld, /Super admin only/);
  assert.doesNotMatch(withheld, /%/);
  const card = text(h(TakeRateCard, { allowed: true, state: 'ready', data: TAKE }));
  assert.match(card, /HQ take rate 15% Edit Set Sep 1, 2026 by hq@axal\.vc\./);
  assert.match(card, /No partner commission is computed with it: commissions come from the rules\./);
  assert.match(card, /Advisory charging is off, so no session is charged at this rate yet/);
  assert.match(text(h(TakeRateCard, { allowed: true, state: 'ready', data: { ...TAKE, source: 'default', updated_at: null } })), /The platform default: nobody has stored a rate/);
  assert.match(text(h(TakeRateCard, { allowed: true, state: 'ready', data: TAKE, stage: 'edit', draft: '1200' })), /1200 basis points is 12%/);
  assert.match(text(h(TakeRateCard, { allowed: true, state: 'ready', data: TAKE, stage: 'edit', draft: '15.5' })), /Enter whole basis points/);
  assert.deepEqual(takeRateInput('9000', 5000).error, 'The highest rate the route accepts is 5000 basis points (50%).');
  assert.deepEqual(takeRateInput('1200', 5000), { bps: 1200 });
  const confirm = text(h(TakeRateCard, { allowed: true, state: 'ready', data: TAKE, stage: 'confirm', draft: '1200' }));
  assert.match(confirm, /Change the take rate From 15% To 12%/);
  assert.match(confirm, /Lines already recorded keep the rate they were stamped with/);
  assert.match(text(h(TakeRateCard, { allowed: true, state: 'unreadable', onRetry: () => {} })), /This is not a claim that none is set/);
});

// GET /network/admin/payouts → p.*, u.email, u.name
const QUEUE = PAYOUTS.map((p) => ({ ...p, name: p.id === 2 ? null : 'Pat Partner', email: 'pat@example.com' }));

test('the payout queue offers only what each status allows, and the confirmations say what moves and what does not', () => {
  assert.deepEqual(payoutActionsFor('requested').map((a) => a.action), ['complete', 'process', 'fail']);
  assert.deepEqual(payoutActionsFor('processing').map((a) => a.action), ['complete', 'fail']);
  assert.deepEqual(payoutActionsFor('completed').map((a) => a.action), ['fail']);
  assert.deepEqual(payoutActionsFor('failed'), []);
  const open = html(h(PayoutQueue, { state: 'ready', rows: QUEUE, view: 'open' }));
  assert.match(open, /row-queue-5/);
  assert.match(open, /row-queue-4/);
  assert.doesNotMatch(open, /row-queue-3|row-queue-2/, 'Open is requested and processing');
  assert.match(open, /button-complete-5/);
  assert.match(open, /button-process-5/);
  assert.doesNotMatch(open, /button-process-4/, 'a processing payout is not marked processing again');
  const all = html(h(PayoutQueue, { state: 'ready', rows: QUEUE, view: 'all' }));
  assert.match(all, /button-fail-3/, 'a completed payout can still be marked failed: a bank return');
  assert.doesNotMatch(all, /button-(complete|process|fail)-2"/, 'a failed payout is not reopened');
  const words = text(h(PayoutQueue, { state: 'ready', rows: QUEUE, view: 'all' }));
  assert.match(words, /Recorded by account #7 \(name not returned\)/);
  assert.match(words, /pat@example\.com \$2,000\.00 USD Crypto Failed requested Sep 14, 2026 Bank returned the transfer/);

  const complete = text(h(PayoutQueue, { state: 'ready', rows: QUEUE, view: 'open', pending: { id: 5, action: 'complete', reason: '' } }));
  assert.match(complete, /Process payout · confirm Partner Pat Partner Amount \$1,200\.00 USD Method Wire transfer/);
  assert.match(complete, /Nothing here sends money: pay it by wire transfer yourself before you confirm/);
  const fail = html(h(PayoutQueue, { state: 'ready', rows: QUEUE, view: 'open', pending: { id: 4, action: 'fail', reason: '' } }));
  assert.match(fail, /data-testid="input-fail-reason"/);
  assert.match(text(h(PayoutQueue, { state: 'ready', rows: QUEUE, view: 'open', pending: { id: 4, action: 'fail', reason: '' } })), /The commissions it claimed stay marked Paid: the route does not return them to Accrued/);
  const noted = html(h(PayoutQueue, { state: 'ready', rows: QUEUE, view: 'open', result: { id: 5, ok: false, text: 'Payout not found' } }));
  assert.match(noted, /data-testid="note-queue-5"[^>]*>Payout not found|role="alert"[^>]*data-testid="note-queue-5"[^>]*>Payout not found/);
  assert.doesNotMatch(noted, /note-queue-lifted/);
  // Completed, the payout leaves Open: the outcome is said above the list rather than lost with the row.
  const moved = QUEUE.map((p) => (p.id === 5 ? { ...p, status: 'completed', processed_by: 9, completed_at: '2026-10-06 10:00:00' } : p));
  const lifted = html(h(PayoutQueue, { state: 'ready', rows: moved, view: 'open', result: { id: 5, ok: true, text: 'Marked Completed.' } }));
  assert.match(lifted, /role="status" data-testid="note-queue-lifted"[^>]*>Payout #5: Marked Completed\./);
  assert.doesNotMatch(lifted, /row-queue-5/);
  assert.match(text(h(PayoutQueue, { state: 'ready', rows: [], view: 'open' })), /No payouts are waiting/);
  assert.match(text(h(PayoutQueue, { state: 'unreadable', rows: [], onRetry: () => {} })), /This is not a claim that no payout is waiting/);
  assert.match(html(h(PayoutQueue, { state: 'loading', rows: [] })), /animate-pulse/);
});

test('every commission, with the partner, and the route\'s 500-row ceiling said', () => {
  const rows = COMMISSIONS.map((c) => ({ ...c, name: 'Pat Partner', email: 'pat@example.com' }));
  const table = text(h(AllCommissionsTable, { state: 'ready', rows, total: 4 }));
  assert.match(table, /Pat Partner Introduction to Acme closed Source Deal funded Amount \$350\.00 USD Status Accrued Accrued Oct 3, 2026 Paid Not paid yet/);
  assert.match(text(h(AllCommissionsTable, { state: 'ready', rows, total: 500 })), /the newest 500 the route returns/);
  assert.match(text(h(AllCommissionsTable, { state: 'ready', rows: [], total: 0 })), /No commission has accrued to anyone yet/);
  assert.match(text(h(AllCommissionsTable, { state: 'unreadable', rows: [], total: 0, onRetry: () => {} })), /This is not a claim that none have accrued/);
  assert.deepEqual(filterCommissions(rows, { query: 'pat@' }).length, 6, 'the admin search reaches the partner');
  assert.deepEqual(filterCommissions(rows, { query: 'nobody' }).length, 0);
});

/* ------------------------------------------------------------------ *
 * The wiring: client, Worker, router, doors
 * ------------------------------------------------------------------ */

test('every method the screens call reaches its Worker route', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url).replace(/^.*\/api/, ''), init.body]);
    // The leaderboard asks the admin arm first and falls back on a refusal.
    if (String(url).endsWith('/partnernet/leaderboard')) {
      return new Response('{"error":"Admin only"}', { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { api } = await import('../src/lib/api.js');
    await api.commissionsMe();
    await api.payoutsMe();
    await api.payoutRequest({ amount_cents: 75000, payout_method: 'wire' });
    await api.referralCode();
    await api.referralList();
    await api.introCredits();
    await api.partnerRelationships();
    await api.relationshipEvents(5);
    await api.partnerInteractionLog(5);
    await api.partnerInteractionAdd(5, { kind: 'call', note: 'x' });
    await api.partnerLeaderboard();
    await api.adminCommissionRules();
    await api.adminCommissions();
    await api.adminPayouts();
    await api.adminProcessPayout(9, { action: 'fail', failure_reason: 'returned' });
    await api.hqTakeRate();
    await api.setHqTakeRate(1200);
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(calls.map(([m, u]) => `${m} ${u}`), [
    'GET /network/commissions/me',
    'GET /network/payouts/me',
    'POST /network/payout/request',
    'GET /network/referral/code',
    'GET /network/referral/list',
    'GET /introductions/credits',
    'GET /partnernet/relationships',
    'GET /partnernet/relationships/5/events',
    'GET /partnernet/relationships/5/interactions',
    'POST /partnernet/relationships/5/interactions',
    'GET /partnernet/leaderboard',
    'GET /partnernet/leaderboard/public',
    'GET /network/admin/commission-rules',
    'GET /network/admin/commissions',
    'GET /network/admin/payouts',
    'PATCH /network/admin/payouts/9/process',
    'GET /admin/platform/take-rate',
    'PUT /admin/platform/take-rate',
  ]);
  assert.deepEqual(JSON.parse(calls[2][2]), { amount_cents: 75000, payout_method: 'wire' });
  assert.deepEqual(JSON.parse(calls[15][2]), { action: 'fail', failure_reason: 'returned' });
  assert.deepEqual(JSON.parse(calls[17][2]), { bps: 1200 });

  // And each is a mounted route, behind the gate the page assumes.
  const index = read('cloudflare-worker/src/index.ts');
  assert.match(index, /app\.route\('\/api\/network', network\)/);
  assert.match(index, /app\.route\('\/api\/partnernet', partnernet\)/);
  assert.match(index, /app\.route\('\/api\/introductions', introductionsRoutes\)/);
  assert.match(index, /app\.route\('\/api\/admin\/platform', adminPlatform\)/);
  const gate = (src, verb, path) => {
    const at = src.indexOf(`${verb}('${path}'`);
    assert.ok(at >= 0, `${verb} ${path} is not declared`);
    return src.slice(at, at + 160);
  };
  for (const p of ['/commissions/me', '/payouts/me', '/referral/code', '/referral/list']) assert.match(gate(NETWORK, 'network.get', p), /requireAuth/);
  assert.match(gate(NETWORK, 'network.post', '/payout/request'), /requireAuth/);
  for (const p of ['/admin/commissions', '/admin/commission-rules', '/admin/payouts']) assert.match(gate(NETWORK, 'network.get', p), /requireAdmin/);
  assert.match(gate(NETWORK, 'network.patch', '/admin/payouts/:id/process'), /requireAdmin/);
  const platform = read('cloudflare-worker/src/routes/admin_platform.ts');
  assert.match(gate(platform, 'r.get', '/take-rate'), /requireSuperAdmin/);
  assert.match(gate(platform, 'r.put', '/take-rate'), /requireSuperAdmin/);
  assert.match(gate(read('cloudflare-worker/src/routes/introductions.ts'), 'introductions.get', '/credits'), /requireAuth/);
  // No rule-writing route exists, which is why the rules table is read-only.
  assert.doesNotMatch(NETWORK, /network\.(post|patch|put|delete)\('\/admin\/commission-rules/);
});

test('the five routes are mounted with the guards their routes need, and each has a door', () => {
  const app = read('frontend/src/App.jsx');
  const line = (path) => app.split('\n').find((l) => l.includes(`path="${path}"`) && l.includes('<Route'));
  assert.match(line('/partner/earnings'), /guard\(\['admin', 'partner'\], <PartnerEarnings \/>\)/);
  assert.match(line('/partner/referrals'), /guard\(\['admin', 'partner'\], <PartnerReferrals \/>\)/);
  assert.match(line('/partner/relationships/:id'), /guard\(\['admin', 'partner'\], <PartnerRelationshipLog \/>\)/);
  assert.match(line('/partner/leaderboard'), /guard\(\['admin', 'partner'\], <PartnerLeaderboard user=\{user\} \/>\)/);
  const admin = line('/admin/commissions');
  assert.match(admin, /guard\(\['admin'\], <AdminCommissions user=\{user\} \/>\)/);
  assert.doesNotMatch(admin, /hqOnly/, 'the commission routes answer any admin, on either tier');
  assert.match(app, /const AdminCommissions = lazy\(\(\) => import\('\.\/pages\/admin\/AdminCommissions'\)\)/);
  // Doors: the admin console from the referral review queue, the log from the
  // partner's accepted relationships, and the three earnings screens from each other.
  assert.match(read('frontend/src/pages/admin/ReferralReview.jsx'), /to="\/admin\/commissions"/);
  assert.match(read('frontend/src/workspaces/NetworkWorkspace.jsx'), /<RelationshipRequests logPath=\{role === 'partner' \? relationshipLogPath : undefined\} \/>/);
  assert.match(read('frontend/src/components/RelationshipRequests.jsx'), /logPath \? \(\s*<Link to=\{logPath\(r\.id\)\}/);
  assert.deepEqual(EARNINGS_AREA.zones.map((z) => `${EARNINGS_AREA.prefix}/${z.slug}`), ['/partner/earnings', '/partner/referrals', '/partner/leaderboard']);
});

test('the rails speak as Eadwyn may: no advisor, advice, recommendation or fiduciary', () => {
  const files = ['PartnerEarnings', 'PartnerReferrals', 'PartnerRelationshipLog'].map((f) => `frontend/src/pages/partner/earnings/${f}.jsx`)
    .concat('frontend/src/pages/admin/AdminCommissions.jsx');
  for (const f of files) {
    const src = read(f);
    const rails = src.split('<WorkerRail').slice(1).map((s) => s.slice(0, s.indexOf('/>')));
    assert.ok(rails.length === 1, `${f} mounts ${rails.length} rails`);
    assert.doesNotMatch(rails[0], /advis|advice|recommend|fiduciar/i, `${f}'s rail breaks the voice rule`);
  }
  // The leaderboard has no rail, by its canvas.
  assert.doesNotMatch(read('frontend/src/pages/partner/earnings/PartnerLeaderboard.jsx'), /<WorkerRail/);
});
