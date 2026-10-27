/**
 * D1276 (#3302) — Promo codes part 6: the Usage tab (PRM7, PRM8 dark, PRM13
 * the phone) over `GET /api/admin/promos/usage` (D1274).
 *
 * The model's rules, then the tab mounted at its address against the Worker's
 * own shape (services/promoUsage.ts `usageRead`) with a stubbed fetch. Every
 * block is `{ available, reason }`; each one is drawn, said empty in the
 * canvas's words, or failed with Try again on its own. Stripe is never reached.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/promo_usage_d1276.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { PromoUsage } from '../src/pages/admin/promos/PromoParts.jsx';
import {
  blockState, currencyRows, nearEndRows, nearEndSentence, periodWord, productsChart, rangeDays, rangeProblem, topCodesChart,
  usageHref, usageRangeOf, usageTiles, weekChart,
} from '../src/pages/admin/promos/promoModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const NOW = Date.parse('2026-10-26T12:00:00Z'); // a Monday
const USAGE_PATH = '/admin/platform/promo-codes/usage';

/* ------------------------------------------------------------------ *
 * The Worker's shape (fake figures)
 * ------------------------------------------------------------------ */

const WEEK = (week, over = {}) => ({ week, cart: 0, payment: 0, free_unlock: 0, subscription: 0, not_recorded: 0, ...over });
const USAGE = () => ({
  range: { from: '2026-08-04', to: '2026-10-26' },
  redemptions: {
    available: true, reason: null, total: 60, members: 51,
    weeks: [
      WEEK('2026-10-05', { not_recorded: 12 }),
      WEEK('2026-10-12', { cart: 10, payment: 4, subscription: 6 }),
      WEEK('2026-10-19', { cart: 12, free_unlock: 3, subscription: 9 }),
      WEEK('2026-10-26', { cart: 2, payment: 2 }),
    ],
    detail_recorded_from: '2026-10-12 08:00:00',
  },
  discount: {
    available: true, reason: null, not_recorded: 12,
    currencies: [
      { currency: 'usd', redemptions: 44, discount_cents: 96100, average_cents: 2184 },
      { currency: 'eur', redemptions: 4, discount_cents: 9156, average_cents: 2289 },
    ],
  },
  top_codes: { available: true, reason: null, codes: [
    { promo_id: 'promo_ws', code: 'WEBSUMMIT', redeemed: 44, max_redemptions: 100, mirror_redeemed: 61 },
    { promo_id: 'promo_gone', code: null, redeemed: 9, max_redemptions: null, mirror_redeemed: null },
  ] },
  products: { available: true, reason: null, not_recorded: 14, rows: [
    { product_id: 'prod_adv', name: 'Advisor Pro', price_id: 'pr_m', interval: 'month', redemptions: 30 },
    { product_id: 'prod_office', name: null, price_id: 'pr_o', interval: null, redemptions: 16 },
  ] },
  near_end: { available: true, reason: null, within_days: 14, codes: [
    { promo_id: 'promo_cap', code: 'PRESS50', expires_at: null, ends_in_days: null, at_cap: true, mirror_redeemed: 50, max_redemptions: 50 },
    { promo_id: 'promo_soon', code: 'OFFICEHRS', expires_at: '2026-10-31T23:59:59Z', ends_in_days: 6, at_cap: false, mirror_redeemed: 9, max_redemptions: 40 },
  ] },
});
const RANGE = { key: '12w', from: '2026-08-04', to: '2026-10-26' };
const NONE = () => ({
  range: { from: '2026-08-04', to: '2026-10-26' },
  redemptions: { available: true, reason: null, total: 0, members: 0, weeks: [WEEK('2026-10-19'), WEEK('2026-10-26')], detail_recorded_from: null },
  discount: { available: false, reason: 'no_redemptions' },
  top_codes: { available: false, reason: 'no_redemptions' },
  products: { available: false, reason: 'no_redemptions' },
  near_end: { available: true, reason: null, within_days: 14, codes: [] },
});

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the range: chips in the address, whole UTC days, at most 366, a bad one refused', () => {
  assert.deepEqual(usageRangeOf('', NOW), RANGE, 'the Worker’s default, twelve weeks with today');
  assert.deepEqual(usageRangeOf('?range=30d', NOW), { key: '30d', from: '2026-09-27', to: '2026-10-26' });
  assert.deepEqual(usageRangeOf('?range=quarter', NOW), { key: 'quarter', from: '2026-10-01', to: '2026-10-26' });
  assert.deepEqual(usageRangeOf('?from=2026-09-01&to=2026-09-30', NOW), { key: 'custom', from: '2026-09-01', to: '2026-09-30' });
  // Mutation checked: take any from/to → a reversed or too-long range is sent and the Worker answers 400.
  assert.equal(usageRangeOf('?from=2026-09-30&to=2026-09-01', NOW).key, '12w');
  assert.equal(usageRangeOf('?from=2025-01-01&to=2026-10-26', NOW).key, '12w');
  assert.equal(usageRangeOf('?from=2026-02-30&to=2026-03-02', NOW).key, '12w', 'a day that does not exist');
  assert.deepEqual([rangeDays('2026-01-01', '2026-12-31'), rangeDays('2026-01-01', '2027-01-01'), rangeDays('2026-01-02', '2026-01-01')], [365, 366, null]);
  assert.equal(rangeDays('2026-01-01', '2027-01-02'), null);
  assert.deepEqual([rangeProblem('', '2026-01-01'), rangeProblem('2026-02-01', '2026-01-01'), rangeProblem('2025-01-01', '2026-10-26'), rangeProblem('2026-01-01', '2026-01-31')],
    ['Choose a first and a last day.', 'The first day comes after the last.', 'A range is at most 366 days.', null]);
  assert.deepEqual([usageHref({ key: '12w' }), usageHref({ key: '30d' }), usageHref({ key: 'custom', from: '2026-09-01', to: '2026-09-30' }), usageHref({ key: 'custom', from: 'x', to: 'y' })],
    [USAGE_PATH, `${USAGE_PATH}?range=30d`, `${USAGE_PATH}?from=2026-09-01&to=2026-09-30`, USAGE_PATH]);
  assert.deepEqual([periodWord(RANGE), periodWord({ key: 'custom', from: '2026-09-01', to: '2026-09-30' })], ['the last 12 weeks', '1 Sep 2026 to 30 Sep 2026']);
});

test('the tiles: each currency on its own, never added; a missing figure is null with why, a measured 0 is 0', () => {
  const t = Object.fromEntries(usageTiles(USAGE(), RANGE).map((x) => [x.key, x]));
  assert.deepEqual([t.redemptions.value, t.discount.value, t.members.value, t.average.value], ['60', '$961.00 and €91.56', '51', '$21.84']);
  // Mutation checked: add the currencies together → one figure.
  assert.ok(!/\$1,052/.test(t.discount.value));
  assert.equal(t.redemptions.sub, 'The last 12 weeks · every source');
  assert.equal(t.discount.sub, '12 redemptions carry no amount. Each currency on its own.');
  assert.equal(t.average.sub, 'USD, over the 44 redemptions with a recorded discount. €22.89 in EUR.');
  const none = Object.fromEntries(usageTiles(null, RANGE).map((x) => [x.key, x]));
  // Mutation checked: read a failed read as zero → '0'.
  assert.deepEqual(Object.values(none).map((x) => x.value), [null, null, null, null]);
  assert.ok(Object.values(none).every((x) => x.sub === 'Could not be read.'));
  const empty = Object.fromEntries(usageTiles(NONE(), RANGE).map((x) => [x.key, x]));
  assert.deepEqual([empty.redemptions.value, empty.discount.value, empty.members.value, empty.average.value], ['0', 'None given', '0', null]);
  assert.deepEqual([empty.redemptions.sub, empty.members.sub, empty.average.sub], ['Nothing was redeemed in this period.', 'No redemptions in this period.', 'No redemptions to average.']);
  const unrec = Object.fromEntries(usageTiles({ ...USAGE(), discount: { available: false, reason: 'not_recorded' } }, RANGE).map((x) => [x.key, x]));
  assert.deepEqual([unrec.discount.value, unrec.discount.sub, unrec.average.value], [null, 'None of these redemptions carries its amount.', null]);
});

test('a block says why it is empty, in the canvas’s words; unreadable is a failed read, never empty', () => {
  assert.deepEqual(blockState('redemptions', USAGE().redemptions), { kind: 'ok', text: null });
  assert.deepEqual(blockState('redemptions', NONE().redemptions), { kind: 'empty', text: 'Nothing was redeemed in this period.' });
  assert.deepEqual(blockState('discount', NONE().discount), { kind: 'empty', text: 'No discount was given in this period.' });
  assert.deepEqual(blockState('top_codes', NONE().top_codes), { kind: 'empty', text: 'No code was redeemed in this period.' });
  assert.deepEqual(blockState('products', NONE().products), { kind: 'empty', text: 'Nothing to break down in this period.' });
  assert.match(blockState('products', { available: false, reason: 'not_recorded' }).text, /None of these redemptions carries its product/);
  // Mutation checked: read `unreadable` as an empty period → "No code was redeemed".
  for (const b of ['redemptions', 'discount', 'top_codes', 'products', 'near_end']) {
    assert.deepEqual(blockState(b, { available: false, reason: 'unreadable' }), { kind: 'unreadable', text: null }, b);
    assert.deepEqual(blockState(b, undefined), { kind: 'unreadable', text: null }, `${b} missing`);
  }
});

test('redemptions per week: stacked by source, this week to date, the unrecorded weeks dashed and said', () => {
  const c = weekChart(USAGE().redemptions, NOW);
  assert.equal(c.type, 'stack');
  assert.deepEqual(c.rows.map((r) => [r.label, r.value]), [['5 Oct', 12], ['12 Oct', 20], ['19 Oct', 24], ['26 Oct', 4]]);
  assert.deepEqual(c.rows[0].parts.map((p) => [p.key, p.value]), [['cart', 0], ['payment', 0], ['free_unlock', 0], ['subscription', 0], ['not_recorded', 12]]);
  assert.deepEqual(c.table.head, ['Week', 'Cart orders', 'One-time payments', 'Free unlocks', 'Subscriptions', 'Not recorded', 'Total']);
  // Mutation checked: mark no week as to date → 'Week of 26 Oct 2026'.
  assert.deepEqual(c.table.rows.map((r) => r[0]), ['Week of 5 Oct 2026', 'Week of 12 Oct 2026', 'Week of 19 Oct 2026', 'This week, to date']);
  assert.deepEqual(c.table.rows[1], ['Week of 12 Oct 2026', '10', '4', '0', '6', '0', '20']);
  assert.equal(c.summary, '60 redemptions in 4 weeks.');
  assert.equal(c.recorded, 'Source is recorded on each redemption from 12 Oct 2026; 12 redemptions before that are Not recorded.');
  assert.equal(weekChart({ ...USAGE().redemptions, detail_recorded_from: null }, NOW).recorded, 'No redemption carries its source yet, so every one is Not recorded.');
  assert.equal(weekChart({ available: false, reason: 'unreadable' }, NOW), null);
});

test('top codes, products and codes near their end: of its cap, a Not recorded row, at the cap first', () => {
  const top = topCodesChart(USAGE().top_codes);
  assert.deepEqual(top.rows.map((r) => [r.label, r.text]), [['WEBSUMMIT', '44 of 100'], ['promo_gone', '9, no cap']]);
  assert.equal(top.summary, 'WEBSUMMIT was redeemed most: 44 of its 100.');
  assert.deepEqual(top.table.rows[1], ['promo_gone', '9', 'No cap']);
  const pr = productsChart(USAGE().products);
  assert.deepEqual(pr.rows.map((r) => [r.label, r.value, Boolean(r.dash)]), [['Advisor Pro · monthly', 30, false], ['prod_office', 16, false], ['Not recorded', 14, true]]);
  assert.equal(pr.summary, 'Advisor Pro · monthly leads among the 46 redemptions with a product recorded.');
  // Mutation checked: drop the unrecorded row → two rows.
  assert.equal(productsChart({ ...USAGE().products, not_recorded: 0 }).rows.length, 2);
  assert.deepEqual(currencyRows(USAGE().discount), [
    { currency: 'USD', total: '$961.00', redemptions: '44', average: '$21.84' },
    { currency: 'EUR', total: '€91.56', redemptions: '4', average: '€22.89' },
  ]);
  assert.deepEqual(nearEndRows(USAGE().near_end).map((r) => [r.code, r.used, r.why]), [['PRESS50', '50 of 50', 'At its cap'], ['OFFICEHRS', '9 of 40', 'ends in 6 days']]);
  assert.equal(nearEndSentence(USAGE().near_end), '1 code ends within 14 days; 1 is at its cap.');
  assert.equal(nearEndSentence(NONE().near_end), 'No active code ends within 14 days or is at its cap.');
  assert.equal(nearEndRows({ available: false, reason: 'unreadable' }), null);
  assert.equal(nearEndRows({ available: true, codes: [{ promo_id: 'x', code: 'X', ends_in_days: 2, at_cap: false, mirror_redeemed: null, max_redemptions: 5 }] })[0].used, 'Not recorded');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const response = (body, status = 200) => ({
  ok: status < 400, status, type: 'basic', redirected: false,
  headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => body, text: async () => JSON.stringify(body),
});

function Page() {
  const { pathname, search } = useLocation();
  return h('div', null, h('span', { 'data-testid': 'where' }, `${pathname}${search}`), h(PromoUsage, { now: NOW }));
}

async function mounted(path = USAGE_PATH, answer = () => response(USAGE())) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch };
  const requests = [];
  globalThis.fetch = async (u) => { if (String(u).includes('/client-error')) return response({}); requests.push(String(u)); return answer(String(u), requests.length); };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, h(Page))));
  const flush = () => act(async () => { for (let i = 0; i < 40; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props_ = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props_(n)['data-testid'] === id);
  return {
    requests, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), all: () => text(document.body),
    count: (id) => nodes().filter((n) => props_(n)['data-testid'] === id).length,
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onClick({ preventDefault() {}, button: 0, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false }); }); await flush(); },
    change: async (id, value) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onChange({ target: { value } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

test('mounted PRM7: the default range is read, the tiles and five blocks drawn, each chart with View as table', async () => {
  const r = await mounted();
  try {
    assert.deepEqual(r.requests, ['/api/admin/promos/usage?from=2026-08-04&to=2026-10-26']);
    assert.equal(r.textOf('promo-usage-period'), '4 Aug 2026 to 26 Oct 2026 · every code');
    assert.match(r.textOf('promo-usage-tile-discount'), /\$961\.00 and €91\.56/);
    for (const b of ['weeks', 'discount', 'top', 'products', 'near']) assert.ok(r.has(`promo-usage-${b}`), b);
    assert.ok(r.has('promo-usage-weeks-chart') && !r.has('promo-usage-weeks-table'));
    await r.click('promo-usage-weeks-toggle');
    assert.ok(r.has('promo-usage-weeks-table') && !r.has('promo-usage-weeks-chart'));
    assert.match(r.textOf('promo-usage-weeks-table'), /This week, to date220004/);
    await r.click('promo-usage-top-toggle');
    assert.match(r.textOf('promo-usage-top-table'), /WEBSUMMIT44100/);
    await r.click('promo-usage-products-toggle');
    assert.match(r.textOf('promo-usage-products-table'), /Not recorded14/);
    assert.equal(r.count('promo-usage-currency'), 2);
    assert.ok(r.has('promo-wait-discountWeeks'), 'the discount by week is said to wait, never drawn as 0');
    assert.equal(r.count('promo-usage-near-row'), 2);
    assert.match(r.textOf('promo-usage-near-list'), /PRESS5050 of 50At its capOpen/);
  } finally { await r.close(); }
});

test('mounted: a chip and a custom range move the address and read again; a bad range is refused here', async () => {
  const r = await mounted();
  try {
    await r.click('promo-usage-range-30d');
    assert.equal(r.textOf('where'), `${USAGE_PATH}?range=30d`);
    assert.equal(r.requests.at(-1), '/api/admin/promos/usage?from=2026-09-27&to=2026-10-26');
    await r.click('promo-usage-range-custom');
    await r.change('promo-usage-from', '2026-10-20');
    await r.change('promo-usage-to', '2026-10-01');
    const before = r.requests.length;
    await r.click('promo-usage-apply');
    assert.equal(r.textOf('promo-usage-range-problem'), 'The first day comes after the last.');
    // Mutation checked: apply without rangeProblem → a request the Worker refuses.
    assert.equal(r.requests.length, before);
    await r.change('promo-usage-from', '2026-09-01');
    await r.click('promo-usage-apply');
    assert.equal(r.textOf('where'), `${USAGE_PATH}?from=2026-09-01&to=2026-10-01`);
    assert.equal(r.requests.at(-1), '/api/admin/promos/usage?from=2026-09-01&to=2026-10-01');
  } finally { await r.close(); }
});

test('mounted PRM7 empty: every block says why, in the canvas’s words, and no 0 stands for a missing figure', async () => {
  const r = await mounted(USAGE_PATH, () => response(NONE()));
  try {
    assert.equal(r.textOf('promo-usage-weeks-empty'), 'Nothing was redeemed in this period.');
    assert.equal(r.textOf('promo-usage-discount-empty'), 'No discount was given in this period.');
    assert.equal(r.textOf('promo-usage-top-empty'), 'No code was redeemed in this period.');
    assert.equal(r.textOf('promo-usage-products-empty'), 'Nothing to break down in this period.');
    assert.equal(r.textOf('promo-usage-near-summary'), 'No active code ends within 14 days or is at its cap.');
    assert.match(r.textOf('promo-usage-tile-average'), /Not recorded/);
    assert.ok(!r.has('promo-usage-weeks-toggle'), 'no table of an empty period');
  } finally { await r.close(); }
});

test('mounted: while the read is out, the tiles say Reading and no block is drawn as failed', async () => {
  const r = await mounted(USAGE_PATH, () => new Promise(() => {}));
  try {
    assert.match(r.textOf('promo-usage-tile-redemptions'), /Reading…/);
    // Mutation checked: no loading state → each block reads as failed before the answer.
    for (const b of ['weeks', 'discount', 'top', 'products', 'near']) assert.ok(!r.has(`promo-usage-${b}-failed`) && !r.has(`promo-usage-${b}-empty`), b);
  } finally { await r.close(); }
});

test('mounted: one unreadable block fails alone with Try again; a failed read is never an empty period', async () => {
  const one = await mounted(USAGE_PATH, () => response({ ...USAGE(), top_codes: { available: false, reason: 'unreadable' } }));
  try {
    assert.ok(one.has('promo-usage-top-failed') && one.has('promo-usage-top-failed-retry'));
    // Mutation checked: draw unreadable as an empty period → 'promo-usage-top-empty'.
    assert.ok(!one.has('promo-usage-top-empty'));
    assert.ok(one.has('promo-usage-weeks-chart') && one.has('promo-usage-products-chart'), 'one failed block never blanks the tab');
  } finally { await one.close(); }
  const all = await mounted(USAGE_PATH, (_u, n) => (n === 1 ? response({ error: 'down' }, 503) : response(USAGE())));
  try {
    assert.ok(all.has('promo-usage-failed'));
    assert.ok(!all.has('promo-usage-tiles') && !all.has('promo-usage-weeks-empty'));
    await all.click('promo-usage-failed-retry');
    assert.equal(all.requests.length, 2, 'Try again reads again');
    assert.ok(all.has('promo-usage-weeks-chart'));
  } finally { await all.close(); }
});

test('the source: dark violet, the phone at one block per width, the address door, no browser pop-up', () => {
  const src = read('frontend/src/pages/admin/promos/PromoParts.jsx');
  const usage = src.slice(src.indexOf('const CHIP ='), src.indexOf('const PILL ='));
  assert.ok(usage.includes('dark:text-[#a78bfa]') && usage.includes('dark:border-[#a78bfa]'), 'PRM8: violet is #a78bfa in dark');
  assert.ok(usage.includes('grid grid-cols-1 gap-3 lg:grid-cols-2'), 'PRM13: one block per width on a phone');
  assert.ok(usage.includes('grid grid-cols-2 gap-2 lg:grid-cols-4'), 'PRM13: two tiles a row on a phone');
  assert.ok(usage.includes('<Link to={codeHref(r.id)}'), 'a near-end code opens its drawer at its address');
  assert.ok(!/(?<![.\w])(alert|confirm|prompt)\(|window\.open/.test(usage));
  const doc = read('documentation/architecture/decisions/D1276.md');
  assert.match(doc, /UNVERIFIED/);
  assert.ok(read('documentation/architecture/ROUTE_MAP.md').includes('D1276'));
});
