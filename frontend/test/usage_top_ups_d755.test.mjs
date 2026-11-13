/**
 * D755 §10 (#1984, part 1) — the Top-ups card on /account/usage, from
 * `/ai-budget/history`. Every order reference and pack is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/usage_top_ups_d755.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { TopUpsCard, UsagePhoneView, TOP_UPS_LIMIT } from '../src/pages/account/AccountUsage.jsx';
import { topUpRows, signedMicroUsd } from '../src/pages/account/usageModel.js';
import { ADD_TOKENS_PATH } from '../src/lib/aiTokens.js';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/usage'] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
const ready = (data) => ({ status: 'ready', data, reload() {} });
const M = 1_000_000;
const row = (uid, kind, delta, o = {}) => ({ uid, kind, delta_microusd: delta, shortfall_microusd: 0, at: '2026-10-18 09:00:00',
  order_ref: null, pack_label: '$20 of tokens', reservation_uid: null, ...o });

// Newest first, as the Worker answers.
const HISTORY = {
  items: [
    row('u7', 'adjustment', -2 * M, { pack_label: null, at: '2026-10-18 12:00:00', reason: 'Synthetic internal reason' }),
    row('u6', 'dispute_won', 20 * M, { at: '2026-10-18 11:00:00', order_ref: 'AX-SYN-2' }),
    row('u5', 'dispute', -20 * M, { at: '2026-10-18 10:30:00', order_ref: 'AX-SYN-2' }),
    row('u4', 'refund', -15 * M, { at: '2026-10-18 10:00:00', order_ref: 'AX-SYN-1', shortfall_microusd: 5 * M }),
    row('u3', 'bonus', 1 * M, { at: '2026-10-18 09:01:00', order_ref: 'AX-SYN-1' }),
    row('u2', 'purchase', 20 * M, { at: '2026-10-18 09:00:00', order_ref: 'AX-SYN-1' }),
    row('u1', 'adjustment', 3 * M, { pack_label: null, at: '2026-10-17 08:00:00' }),
  ],
  pending: [{ order_ref: 'AX-SYN-3', pack_label: '$50 of tokens', state: 'waiting', amount_microusd: 50 * M, at: '2026-10-18 13:00:00' }],
  next_before: null,
};

test('D755 the card lists every kind, newest first, with the Worker\'s signed amounts', () => {
  const t = text(html(h(TopUpsCard, { history: ready(HISTORY) })));
  const order = ['$50 of tokens', 'Adjustment', 'Dispute won · $20 of tokens', 'Disputed · $20 of tokens', 'Refund · $20 of tokens',
    'Bonus on $20 of tokens', '$20 of tokens', 'Adjustment'];
  let at = -1;
  for (const label of order) { const i = t.indexOf(label, at + 1); assert.ok(i > at, label); at = i; }
  assert.match(t, /\$50 of tokens .*order AX-SYN-3 \+\$50\.00 being added/, 'a pending order leads and reads "being added"');
  assert.match(t, /Refund · \$20 of tokens .*−\$15\.00/);
  assert.match(t, /Bonus on \$20 of tokens .*\+\$1\.00/);
  assert.match(t, /Adjustment .*−\$2\.00/);
  assert.match(t, /Adjustment .*\+\$3\.00/);
  assert.match(t, /Dispute won · \$20 of tokens .*\+\$20\.00/);
});

test('D755 a refund with a shortfall says how much had been used; one without says nothing', () => {
  const t = text(html(h(TopUpsCard, { history: ready(HISTORY) })));
  assert.match(t, /\$5\.00 of these tokens had already been used\./);
  assert.equal((t.match(/had already been used/g) || []).length, 1);
});

test('D755 an adjustment never shows its reason, even if one reached the browser', () => {
  const markup = html(h(TopUpsCard, { history: ready(HISTORY) }));
  assert.doesNotMatch(markup, /Synthetic internal reason/);
  const src = readFileSync(new URL('../src/pages/account/usageModel.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export function topUpRows'));
  assert.doesNotMatch(fn, /\.reason\b/, 'topUpRows never reads a reason');
});

test('D755 nothing in the browser adds up a balance', () => {
  const rows = topUpRows(HISTORY);
  assert.deepEqual(rows.map((r) => r.amount), ['+$50.00', '−$2.00', '+$20.00', '−$20.00', '−$15.00', '+$1.00', '+$20.00', '+$3.00']);
  const markup = html(h(TopUpsCard, { history: ready(HISTORY) }));
  assert.doesNotMatch(text(markup), /total|balance of/i, 'no total is drawn');
  assert.equal(signedMicroUsd(1.5), null, 'a non-integer amount is not formatted');
  assert.equal(signedMicroUsd(-1_234_560_000), '−$1,234.56');
});

test('D755 no top-ups: the empty state and Add tokens on the one path', () => {
  const markup = html(h(TopUpsCard, { history: ready({ items: [], pending: [], next_before: null }) }));
  assert.match(text(markup), /No top-ups yet\./);
  assert.match(markup, new RegExp(`<a href="${ADD_TOKENS_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*data-testid="usage-top-ups-add"[^>]*>Add tokens</a>`), 'the one Add tokens path (#1916)');
});

test('D755 an unreadable history blanks only this card, with Retry', () => {
  const markup = html(h(TopUpsCard, { history: { status: 'unreadable', data: null, reload() {} } }));
  assert.match(markup, /data-testid="usage-top-ups-unreadable"/);
  assert.match(text(markup), /Your top-ups/);
  assert.match(text(markup), /The balance above is unaffected\./);
  assert.match(text(markup), /Try again|Retry/);
  assert.doesNotMatch(text(markup), /No top-ups yet/, 'unreadable is never empty');
  const src = readFileSync(new URL('../src/pages/account/AccountUsage.jsx', import.meta.url), 'utf8');
  assert.match(src, /<AllowanceCard budget=\{budget\} product=\{product\} \/>\n\s*<TopUpsCard \{\.\.\.topUps\} \/>/, 'its own read, after the allowance card');
  assert.match(src, /const history = useAccountRead\(\(\) => aiBudgetApi\.history\(\{ runs, limit: TOP_UPS_LIMIT \}\)\);/);
});

test('D755 "Show AI runs" asks the Worker for runs and draws them', () => {
  const markup = html(h(TopUpsCard, { history: ready({ items: [row('r2', 'spend', -40_000, { pack_label: null }), row('r1', 'hold', -50_000, { pack_label: null })], pending: [] }), runs: true }));
  const box = (m) => m.match(/<input type="checkbox"[^>]*data-testid="usage-top-ups-runs"[^>]*\/>/)?.[0] ?? '';
  assert.match(box(markup), /checked=""/);
  const t = text(markup);
  assert.match(t, /AI run 18 Oct, 09:00 UTC −\$0\.04/);
  assert.match(t, /AI run · held 18 Oct, 09:00 UTC −\$0\.05/);
  const off = html(h(TopUpsCard, { history: ready(HISTORY), runs: false }));
  assert.ok(box(off) && !/checked=""/.test(box(off)));
  const src = readFileSync(new URL('../src/pages/account/AccountUsage.jsx', import.meta.url), 'utf8');
  assert.match(src, /const onToggleRuns = \(\) => \{ setRuns\(\(r\) => !r\); history\.reload\(\); \};/, 'the switch re-reads with runs');
});

test('D755 a full page says only the latest are shown', () => {
  const t = text(html(h(TopUpsCard, { history: ready({ ...HISTORY, next_before: '2026-10-17 08:00:00|u1' }) })));
  assert.match(t, new RegExp(`Showing the latest ${TOP_UPS_LIMIT}\\.`));
  assert.doesNotMatch(text(html(h(TopUpsCard, { history: ready(HISTORY) }))), /Showing the latest/);
});

test('D755 the phone draws the same card', () => {
  const loading = { status: 'loading', data: null, reload() {} };
  const props = { budget: loading, product: loading, spend: loading, rates: loading, storage: loading,
    topUps: { history: ready(HISTORY), runs: false, onToggleRuns() {} } };
  const markup = html(h(UsagePhoneView, props));
  assert.match(markup, /id="top-ups"/);
  assert.match(text(markup), /Refund · \$20 of tokens/);
});

// ── Part 2: the top-up tile's states (lib/aiTokens.js, #1916 / #2027) ─────────
import { AllowanceCard, allowanceGroup } from '../src/pages/account/AccountUsage.jsx';
import { TOPUP_UNAVAILABLE_RUNS } from '../src/lib/aiTokens.js';
import { purchaseLine } from '../src/pages/account/usageModel.js';

const NOW = new Date('2026-10-18T12:00:00Z');
const BUDGET = {
  licence: 'founder:growth', source: 'environment', daily_microusd: 2_000_000, monthly_microusd: 40_000_000,
  day_spend_microusd: 2_000_000, month_spend_microusd: 6_100_000, day_reserved_microusd: 0, month_reserved_microusd: 0,
  balance_microusd: 20_000_000, topup_reserved_microusd: 0, held_for_review: [],
};
const PACK = { price_id: 'price_SYN1', currency: 'usd', unit_amount: 2000, label: '$20 of tokens' };
const topUp = (o = {}) => ({ state: 'ready', packs: [PACK], on_hold: false, latest: null, ...o });
const card = (product) => text(html(h(AllowanceCard, { budget: ready(BUDGET), product, now: NOW })));
const latest = (state, o = {}) => ({ order_ref: 'AX-SYN-9', pack_label: '$20 of tokens', state, amount_microusd: 21 * M, at: '2026-10-18 11:40:00', ...o });

test('D755 the tile: loading, unreadable, not ready and ready each say their sentence', () => {
  const loading = text(html(h(AllowanceCard, { budget: ready(BUDGET), product: { status: 'loading', data: null, reload() {} }, now: NOW })));
  assert.doesNotMatch(loading, /Top-up isn't available yet|The top-up option/);
  assert.match(card({ status: 'unreadable', data: null, reload() {} }), /The top-up option .*Your balance above is unaffected\./);
  assert.ok(card(ready(topUp({ state: 'not_ready', packs: [] }))).includes(TOPUP_UNAVAILABLE_RUNS));
  assert.match(card(ready(topUp())), /Runs use your included allowance first, then your top-up balance\./);
});

test('D755 the tile: waiting, credited, overdue and refunded', () => {
  assert.match(card(ready(topUp({ latest: latest('waiting') }))),
    /Adding \$21\.00 from order AX-SYN-9\. It appears here once Stripe confirms the payment\./);
  assert.match(card(ready(topUp({ latest: latest('credited', { credited_at: '2026-10-18 11:41:00' }) }))),
    /Added \$21\.00 on 18 Oct, 11:41 UTC · order AX-SYN-9\./);
  const overdue = html(h(AllowanceCard, { budget: ready(BUDGET), product: ready(topUp({ latest: latest('overdue') })), now: NOW }));
  assert.match(text(overdue), /Payment for AX-SYN-9 is recorded, but the tokens are not in your balance yet\. If they are not here within an hour, contact support with the order number\./);
  assert.match(overdue, /<a href="\/help"[^>]*>Help Center<\/a>/);
  assert.match(card(ready(topUp({ latest: latest('refunded', { reversed_microusd: 15 * M }) }))),
    /Order AX-SYN-9 was refunded\. \$15\.00 was taken off your top-up balance\./);
  // CR2's `latest` carries no reversed amount yet: the line names none rather than guess.
  assert.match(card(ready(topUp({ latest: latest('refunded') }))), /Order AX-SYN-9 was refunded\. Your top-ups below show what was taken off/);
  // A waiting order paid more than an hour ago reads as overdue (purchaseState).
  assert.equal(purchaseLine(latest('waiting', { at: '2026-10-18 10:00:00' }), NOW.getTime()).state, 'overdue');
  assert.equal(purchaseLine(null, NOW.getTime()), null);
  assert.equal(purchaseLine(latest('disputed'), NOW.getTime()), null, 'a dispute is the card\'s to list');
});

test('D755 the banners promise no top-up balance when nothing is on sale', () => {
  const none = card(ready(topUp({ state: 'not_ready', packs: [] })));
  assert.match(none, /Runs wait until your allowance resets\./);
  assert.doesNotMatch(none, /Runs use your top-up balance/);
  assert.match(card(ready(topUp())), /Runs use your top-up balance until then\./);
});

test('D755 the phone shows the latest top-up too', () => {
  const g = allowanceGroup({ budget: ready(BUDGET), product: ready(topUp({ latest: latest('overdue') })), now: NOW });
  const row = g.rows.find((r) => r.key === 'latest-top-up');
  assert.match(row.description, /Payment for AX-SYN-9 is recorded/);
  assert.equal(row.href, '/help');
});
