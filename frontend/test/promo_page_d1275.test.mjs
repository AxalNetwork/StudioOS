/**
 * D1275 (#3301) — Promo codes part 5: the list, the drawer and the dialogs
 * (PRM1, PRM1m, PRM2–PRM6, PRM9–PRM12) over parts 2–4's reads and writes
 * (D1272–D1274).
 *
 * The model's rules, then the page mounted through its address against the
 * Worker's own shapes (routes/admin_promos.ts, services/promoUsage.ts) with a
 * stubbed fetch. Stripe is never reached: every answer here is the Worker's.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/promo_page_d1275.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { PromoCodesPanel } from '../src/pages/admin/consoles/PromoCodesConsole.jsx';
import {
  appliesWord, codeHref, discountWord, durationWord, endsWord, filterSearch, historyRow, listQuery, money, redeemedLines,
  redeemedWord, redemptionRow, rowActions, tiles, toMinor, viewOf,
} from '../src/pages/admin/promos/promoModel.js';
import {
  catalogueChoices, createBody, draftFrom, emptyDraft, generateCode, memberPays, planKeyOfProduct, stepProblem, stepsFor,
} from '../src/pages/admin/promos/promoWizard.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const NOW = Date.parse('2026-10-21T10:42:00Z');
const BASE = '/admin/platform/promo-codes';

/* ------------------------------------------------------------------ *
 * The Worker's shapes
 * ------------------------------------------------------------------ */

const ROW = (id, code, over = {}) => ({
  id, code, coupon_id: `c_${id}`, percent_off: 20, amount_off: null, currency: null, duration: 'once',
  product_ids: [], product_ids_readable: true, max_redemptions: 200, times_redeemed: 37, active: true,
  expires_at: '2026-12-31T23:59:59.000Z', created_by: 1, created_at: '2026-10-02 10:14:00', state: 'active',
  paused_at: null, paused_by: null, ended_at: null, ended_by: null, reason: null, name: null, note: null,
  duration_in_months: null, replaced_by: null, plan_keys: [], intervals: ['month'], once_per_member: false, first_purchase_only: false,
  ...over,
});
const ROWS = () => [
  ROW('p1', 'LAUNCH20', { name: 'Autumn launch', note: 'For the advisor push', plan_keys: ['plan:advisor_pro'], product_ids: ['prod_adv'], once_per_member: true }),
  ROW('p2', 'EVENT15', { percent_off: 15, state: 'paused', active: false, paused_at: '2026-10-09 16:20:00', reason: 'Event moved', max_redemptions: 100, times_redeemed: 9 }),
  ROW('p3', 'OFFICEHRS', { percent_off: null, amount_off: 2500, currency: 'usd', product_ids: ['prod_office'], max_redemptions: 40, times_redeemed: 9, expires_at: '2026-10-31T23:59:59.000Z' }),
  ROW('p4', 'SUMMER25', { percent_off: 25, state: 'ended', active: false, ended_at: '2026-09-02 12:00:00', reason: 'Replaced by FOUNDERS50', replaced_by: 'promo_f50' }),
  ROW('p5', 'REPORT15', { percent_off: 15, product_ids_readable: false, max_redemptions: null, times_redeemed: 21 }),
];
const COUNTS = { active: 9, paused: 3, ended: 5, expired: 5, at_cap: 2, off: 0 };
const LIST = (over = {}) => ({ promos: ROWS(), total: 5, page: 1, page_size: 25, sort: 'newest', counts: COUNTS, ...over });
const USAGE = () => ({
  range: { from: '2026-09-22', to: '2026-10-21' },
  redemptions: { available: true, reason: null, total: 142, members: 131, weeks: [] },
  discount: { available: true, reason: null, currencies: [{ currency: 'usd', redemptions: 120, discount_cents: 231840, average_cents: 1932 }], not_recorded: 22 },
  top_codes: { available: true, reason: null, codes: [] },
  products: { available: true, reason: null, rows: [], not_recorded: 0 },
  near_end: { available: true, reason: null, within_days: 14, codes: [
    { promo_id: 'p3', code: 'OFFICEHRS', ends_in_days: 10, at_cap: false }, { promo_id: 'p9', code: 'PRESS50', ends_in_days: null, at_cap: true },
  ] },
});
const CATALOG = () => ({ products: [
  { id: 'prod_adv', name: 'Advisor Pro', kind: 'subscription', active: true, metadata: { plan_group: 'advisor_pro' }, plan: { label: 'Advisor Pro' },
    prices: [{ id: 'pr_m', currency: 'usd', unit_amount: 2000, interval: 'month', type: 'recurring', active: true }, { id: 'pr_y', currency: 'usd', unit_amount: 20400, interval: 'year', type: 'recurring', active: true }] },
  { id: 'prod_growth', name: 'Raise + Grow', kind: 'subscription', active: true, metadata: { tier: 'growth' },
    prices: [{ id: 'pr_g', currency: 'usd', unit_amount: 9900, interval: 'month', type: 'recurring', active: true }] },
  { id: 'prod_office', name: 'Office hours session', kind: 'session', active: true, metadata: {},
    prices: [{ id: 'pr_o', currency: 'usd', unit_amount: 15000, interval: null, type: 'one_time', active: true }] },
  { id: 'prod_old', name: 'Old report', kind: 'report', active: false, metadata: {}, prices: [] },
  { id: 'prod_pack', name: 'Token pack', kind: 'token_pack', active: true, metadata: {}, prices: [{ id: 'pr_p', currency: 'usd', unit_amount: 500, type: 'one_time', active: true }] },
] });

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the row menu by state: an ended code offers no resume, only Open and Copy as a new code', () => {
  // Mutation checked: let an ended code resume → 'resume' in its menu.
  assert.deepEqual(rowActions('ended'), ['open', 'copy_new']);
  assert.deepEqual(rowActions('active'), ['open', 'copy_code', 'pause', 'end', 'replace', 'copy_new']);
  assert.deepEqual(rowActions('paused'), ['open', 'copy_code', 'resume', 'end', 'replace', 'copy_new']);
  assert.ok(rowActions('off').includes('resume'), 'a code switched off before part 2 can be resumed');
  for (const s of ['expired', 'at_cap']) assert.ok(!rowActions(s).includes('pause') && !rowActions(s).includes('resume'), s);
});

test('a missing figure is never 0: the tiles say Not recorded with why; a counted 0 stays 0', () => {
  const none = Object.fromEntries(tiles({ counts: null, usage: null }).map((t) => [t.key, t]));
  // Mutation checked: read a missing usage as zero → '0'.
  assert.deepEqual(Object.values(none).map((t) => t.value), [null, null, null, null]);
  assert.equal(none.redemptions.sub, 'Could not be read.');
  const full = Object.fromEntries(tiles({ counts: COUNTS, usage: USAGE() }).map((t) => [t.key, t]));
  assert.deepEqual([full.active.value, full.redemptions.value, full.discount.value, full.ending.value], ['9', '142', '$2,318.40', '1']);
  assert.match(full.active.sub, /^of 24 · 3 paused · 5 expired · 2 at their cap · 5 ended$/);
  assert.match(full.discount.sub, /22 redemptions carry no amount/);
  assert.equal(full.ending.sub, 'OFFICEHRS');
  const empty = Object.fromEntries(tiles({ counts: { ...COUNTS, active: 0 }, usage: { ...USAGE(),
    redemptions: { available: true, total: 0 }, discount: { available: false, reason: 'no_redemptions' } } }).map((t) => [t.key, t]));
  assert.deepEqual([empty.active.value, empty.redemptions.value, empty.discount.value], ['0', '0', 'None given']);
  const unrecorded = tiles({ counts: COUNTS, usage: { ...USAGE(), discount: { available: false, reason: 'not_recorded' } } }).find((t) => t.key === 'discount');
  assert.deepEqual([unrecorded.value, unrecorded.sub], [null, 'None of these redemptions carries its amount.']);
  assert.match(tiles({ counts: COUNTS, usage: USAGE(), scoped: true })[0].sub, /under these filters/);
});

test('the words: money in major units, scope, duration, the redeemed count, the end', () => {
  assert.equal(money(2500, 'usd'), '$25.00');
  assert.equal(money(41200, 'eur'), '€412.00');
  assert.equal(money(null, 'usd'), null);
  assert.deepEqual([toMinor('10', 'usd'), toMinor('10.5', 'usd'), toMinor('10.50', 'gbp'), toMinor('10.555', 'usd'), toMinor('ten', 'usd')], [1000, 1050, 1050, null, null]);
  const [launch, , office, , report] = ROWS();
  assert.deepEqual([discountWord(launch), discountWord(office)], ['20% off', '$25.00 off']);
  assert.equal(appliesWord(launch, { 'plan:advisor_pro': 'Advisor Pro' }).text, 'Advisor Pro · monthly');
  assert.equal(appliesWord(office, { prod_office: 'Office hours session' }).text, 'Office hours session');
  assert.equal(appliesWord(ROW('x', 'X')).text, 'Every product');
  // Mutation checked: read an unreadable list as every product → 'Every product'.
  assert.deepEqual(appliesWord(report), { text: 'Product list unreadable', unreadable: true });
  assert.equal(appliesWord({ ...launch, intervals: null }).text, 'Advisor Pro · every interval', 'a code from before 630 applies to every interval');
  assert.deepEqual([durationWord(launch), durationWord(office), durationWord({ duration: 'repeating', duration_in_months: 3 }),
    durationWord({ duration: 'repeating', duration_in_months: null }), durationWord({ duration: 'forever' })],
  ['First payment only', 'Once', '3 months', 'Repeating, months not recorded', 'Every payment']);
  assert.deepEqual([redeemedWord(launch), redeemedWord(report)], ['37 of 200', '21, no cap']);
  // Mutation checked: draw a missing count as 0 → '0 of 200'.
  assert.equal(redeemedWord({ ...launch, times_redeemed: null }), 'Not recorded');
  assert.deepEqual(endsWord(office, NOW), { day: '31 Oct 2026', soon: 'in 11 days' });
  assert.deepEqual(endsWord({ expires_at: null }, NOW), { day: 'No expiry', soon: null });
  assert.equal(endsWord(ROWS()[3], NOW).soon, 'Ended');
});

test('the address carries the filters; search starts at two characters', () => {
  const v = viewOf(`${BASE}/p1`, '?state=paused&applies=plans&q=launch&sort=code&page=2');
  assert.deepEqual(v, { tab: 'codes', id: 'p1', filters: { state: 'paused', applies: 'plans', q: 'launch', sort: 'code', page: 2 } });
  assert.equal(filterSearch(v.filters), '?state=paused&applies=plans&q=launch&sort=code&page=2');
  assert.equal(codeHref('p1', { state: 'ended' }), `${BASE}/p1?state=ended`);
  assert.deepEqual(listQuery({ ...v.filters, q: 'l' }), { page: 2, page_size: 25, state: 'paused', applies: 'plans', sort: 'code' });
  assert.equal(filterSearch({ sort: 'newest' }), '', 'the default sort is not written');
});

test('the catalogue: plans grouped as the Worker resolves them, never a pack or an archived product', () => {
  assert.equal(planKeyOfProduct(CATALOG().products[0]), 'plan:advisor_pro');
  assert.equal(planKeyOfProduct(CATALOG().products[1]), 'tier:growth');
  const c = catalogueChoices(CATALOG().products);
  assert.deepEqual(c.plans.map((p) => p.key), ['plan:advisor_pro', 'tier:growth']);
  // Mutation checked: keep packs → prod_pack offered.
  assert.deepEqual(c.products.map((p) => p.id), ['prod_office']);
  assert.equal(c.plans[0].prices.length, 2);
});

test('New code: the steps, what each refuses, and the body in minor units with the day ending 23:59:59 UTC', () => {
  const c = catalogueChoices(CATALOG().products);
  const d = { ...emptyDraft(), plans: ['plan:advisor_pro'], percent: '20', code: 'adv-7kq2', name: 'Autumn launch', cap: '200', once_per_member: true, ends_on: '2026-12-31' };
  assert.deepEqual(stepsFor(d), [0, 1, 2, 3, 4]);
  // Mutation checked: ask the duration for one-time products → [0, 1, 2, 3, 4].
  assert.deepEqual(stepsFor({ ...d, scope: 'products' }), [0, 1, 3, 4]);
  assert.equal(stepProblem(0, { ...d, plans: [] }), 'Choose at least one plan.');
  assert.equal(stepProblem(0, { ...d, intervals: [] }), 'Choose monthly, yearly or both.');
  assert.equal(stepProblem(1, { ...d, percent: '0' }), 'Percent off is 1 to 100.');
  assert.equal(stepProblem(1, { ...d, percent: '101' }), 'Percent off is 1 to 100.');
  assert.equal(stepProblem(1, { ...d, type: 'fixed', amount: '' }), 'Type the amount off, such as 10 or 10.50.');
  assert.equal(stepProblem(2, { ...d, duration: 'repeating', months: '0' }), 'For 1 to 36 months.');
  assert.equal(stepProblem(3, { ...d, code: 'ab' }), '3 to 64 characters: letters, digits, _ or -.');
  assert.equal(stepProblem(3, { ...d, ends_on: '2026-10-01' }, { now: NOW }), 'It cannot end in the past.');
  assert.equal(stepProblem(3, { ...d, code: 'launch20' }, { taken: ['LAUNCH20'] }), 'LAUNCH20 is already taken. Codes can never be reused.');
  assert.equal(stepProblem(3, d, { now: NOW }), null);
  assert.deepEqual(createBody(d), {
    code: 'ADV-7KQ2', type: 'percent', duration: 'once', once_per_member: true, first_purchase_only: false, percent_off: 20,
    plan_keys: ['plan:advisor_pro'], intervals: ['month'], product_ids: [], max_redemptions: 200, expires_at: '2026-12-31T23:59:59Z', name: 'Autumn launch',
  });
  // Mutation checked: send major units → amount_off 10.5.
  const fixed = createBody({ ...d, scope: 'products', products: ['prod_office'], type: 'fixed', amount: '10.50', currency: 'eur', duration: 'forever' });
  assert.deepEqual([fixed.amount_off, fixed.currency, fixed.duration, fixed.product_ids, 'plan_keys' in fixed], [1050, 'eur', 'once', ['prod_office'], false]);
  assert.deepEqual(memberPays(d, c), [{ label: 'Advisor Pro · monthly', from: '$20.00', to: '$16.00', applies: true }]);
  const eur = memberPays({ ...d, type: 'fixed', amount: '5', currency: 'eur' }, c);
  assert.deepEqual(eur[0], { label: 'Advisor Pro · monthly', from: '$20.00', to: null, applies: false }, 'an amount off touches only its own currency');
  assert.match(generateCode('Autumn launch', () => 0), /^AUTUMN-AAAA$/);
});

test('Copy and Replace start from the code’s terms, never its code; the drawer’s rows say what was not recorded', () => {
  const d = draftFrom(ROWS()[2]);
  assert.deepEqual([d.scope, d.products, d.type, d.amount, d.currency, d.code, d.cap], ['products', ['prod_office'], 'fixed', '25.00', 'usd', '', '40']);
  const plan = draftFrom(ROWS()[0]);
  assert.deepEqual([plan.scope, plan.plans, plan.products, plan.once_per_member, plan.name], ['plans', ['plan:advisor_pro'], [], true, 'Autumn launch']);
  const r = redemptionRow({ created_at: '2026-10-21 09:12:00', user_id: 7, member: null, source: null, product_id: null, amount_before_cents: null, discount_cents: null, currency: null });
  assert.deepEqual(r, { when: '21 Oct 2026, 09:12', member: 'Account 7', bought: 'Not recorded', paid: 'Not recorded', saved: 'Not recorded', source: 'Not recorded' });
  const full = redemptionRow({ created_at: '2026-10-20 17:40:00', user_id: 8, member: 'Ben Sample', source: 'subscription', product_id: 'prod_adv', interval: 'month', amount_before_cents: 2000, discount_cents: 400, currency: 'usd' }, { prod_adv: 'Advisor Pro' });
  assert.deepEqual([full.bought, full.paid, full.saved, full.source], ['Advisor Pro · monthly', '$16.00', '$4.00', 'Subscription']);
  assert.deepEqual(redeemedLines(ROWS()[0], { stripe: { available: false, reason: 'stripe_not_configured' } }).map((l) => [l.value, l.why]),
    [['37 of 200', null], ['Not read', 'Stripe is not configured on this deployment.']]);
  assert.deepEqual(historyRow({ at: '2026-10-09 16:20:00', action: 'promo_pause', by: { id: 3, name: null }, change: {} }),
    { what: 'Paused by Account 3', when: '9 Oct 2026, 16:20', detail: '' });
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const response = (body, status = 200) => ({
  ok: status < 400, status, type: 'basic', redirected: false,
  headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => body, text: async () => JSON.stringify(body),
});

function handler(over = {}) {
  return (url, options = {}) => {
    const method = options.method || 'GET';
    for (const [k, f] of Object.entries(over)) if (url.includes(k) && (!f.method || f.method === method)) return f.answer(url, options);
    if (url.includes('/api/admin/catalog/products')) return response(CATALOG());
    if (url.includes('/api/admin/promos/usage')) return response(USAGE());
    if (/\/api\/admin\/promos\/p\d\/redemptions$/.test(url)) return response({ promo_id: 'p1', mirror_redeemed: 37, redemptions: { available: true, reason: null, rows: [] }, stripe: { available: true, reason: null, times_redeemed: 44 } });
    if (/\/api\/admin\/promos\/p\d\/history$/.test(url)) return response({ promo_id: 'p1', history: { available: true, reason: null, events: [{ at: '2026-10-02 10:14:00', action: 'promo_create', by: { id: 1, name: 'Hana HQ' }, change: { code: 'LAUNCH20', percent_off: 20 } }] } });
    const one = /\/api\/admin\/promos\/(p\d)$/.exec(url);
    if (one && method === 'GET') return response({ promo: ROWS().find((r) => r.id === one[1]) });
    if (one) return response({ ok: true, promo_id: one[1] });
    if (url.includes('/api/admin/promos')) return response(method === 'POST' ? { ok: true, promo_id: 'p9', code: 'ADV-7KQ2' } : LIST());
    return response({});
  };
}

function Page({ now }) {
  const { pathname, search } = useLocation();
  return h('div', null, h('span', { 'data-testid': 'where' }, `${pathname}${search}`), h(PromoCodesPanel, { view: viewOf(pathname, search), now }));
}

async function mounted(path = BASE, { handle = handler() } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, open: globalThis.open, alert: globalThis.alert, confirm: globalThis.confirm };
  const requests = [];
  const popups = [];
  globalThis.fetch = async (u, options = {}) => {
    requests.push({ url: String(u), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    return handle(String(u), options);
  };
  globalThis.open = (...a) => { popups.push(['open', ...a]); return null; };
  globalThis.alert = (...a) => popups.push(['alert', ...a]);
  globalThis.confirm = (...a) => { popups.push(['confirm', ...a]); return true; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, h(Page, { now: NOW }))));
  const flush = () => act(async () => { for (let i = 0; i < 40; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props_ = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props_(n)['data-testid'] === id);
  return {
    requests, popups, flush, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props_(byId(id)), all: () => text(document.body),
    count: (id) => nodes().filter((n) => props_(n)['data-testid'] === id).length,
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onClick({ preventDefault() {}, button: 0, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false }); }); await flush(); },
    change: async (id, value) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onChange({ target: { value, checked: value } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const writes = (r) => r.requests.filter((q) => q.method !== 'GET');
const lists = (r) => r.requests.filter((q) => /\/api\/admin\/promos(\?|$)/.test(q.url) && q.method === 'GET');

test('mounted PRM1: the tiles, the chips with their counts, the rows, and each row’s menu by state', async () => {
  const r = await mounted();
  try {
    assert.equal(lists(r)[0].url, '/api/admin/promos?page=1&page_size=25');
    assert.ok(r.requests.some((q) => q.url === '/api/admin/promos/usage?from=2026-09-22&to=2026-10-21'));
    assert.equal(r.textOf('promo-tile-active-value'), '9');
    assert.equal(r.textOf('promo-tile-discount-value'), '$2,318.40');
    assert.equal(r.textOf('promo-chip-all'), 'All24');
    assert.equal(r.textOf('promo-chip-paused'), 'Paused3');
    assert.equal(r.count('promo-row'), 5);
    assert.equal(r.textOf('promo-applies-p1'), 'Advisor Pro · monthly');
    assert.equal(r.textOf('promo-applies-p5'), 'Product list unreadable');
    assert.equal(r.textOf('promo-redeemed-p5'), '21, no cap');
    await r.click('promo-row-menu-p4');
    assert.equal(r.textOf('promo-row-menu-list-p4'), 'OpenCopy as a new code', 'an ended code offers no resume');
    await r.click('promo-row-menu-p2');
    assert.ok(r.has('promo-row-resume-p2') && !r.has('promo-row-pause-p2'));
    await r.click('promo-chip-ended');
    assert.equal(r.textOf('where'), `${BASE}?state=ended`);
    assert.ok(lists(r).some((q) => q.url === '/api/admin/promos?state=ended&page=1&page_size=25'));
    await r.change('promo-applies', 'plans');
    assert.ok(lists(r).some((q) => q.url === '/api/admin/promos?state=ended&applies=plans&page=1&page_size=25'));
    assert.deepEqual(writes(r), []);
  } finally { await r.close(); }
});

test('mounted PRM9–PRM11: a failed usage read leaves Not recorded beside the list; a failed list is never "No codes"', async () => {
  const r = await mounted(BASE, { handle: handler({ '/api/admin/promos/usage': { answer: () => response({ error: 'down' }, 503) } }) });
  try {
    assert.ok(r.has('promo-tile-redemptions-unrecorded'));
    // Mutation checked: draw a failed read as 0 → a value node.
    assert.ok(!r.has('promo-tile-redemptions-value') && !r.has('promo-tile-discount-value'));
    assert.equal(r.count('promo-row'), 5, 'one failed block never blanks the page');
  } finally { await r.close(); }
  const f = await mounted(BASE, { handle: handler({ '/api/admin/promos?': { answer: () => response({ error: 'down' }, 503) } }) });
  try {
    assert.ok(f.has('promo-list-failed'));
    assert.ok(!f.has('promo-none') && !f.has('promo-none-match'));
    assert.match(f.all(), /The rest of Platform still works\./);
  } finally { await f.close(); }
  const e = await mounted(BASE, { handle: handler({ '/api/admin/promos?': { answer: () => response(LIST({ promos: [], total: 0, counts: { active: 0, paused: 0, ended: 0, expired: 0, at_cap: 0, off: 0 } })) } }) });
  try {
    assert.ok(e.has('promo-none'));
    assert.equal(e.textOf('promo-tile-active-value'), '0', 'a counted 0 is a 0');
  } finally { await e.close(); }
  const m = await mounted(`${BASE}?state=paused`, { handle: handler({ '/api/admin/promos?': { answer: () => response(LIST({ promos: [], total: 0 })) } }) });
  try { assert.ok(m.has('promo-none-match') && !m.has('promo-none')); } finally { await m.close(); }
});

test('mounted PRM6: pause asks a reason, end asks a reason and the code typed, resume takes none; each in the page', async () => {
  const r = await mounted();
  try {
    await r.click('promo-row-menu-p1');
    await r.click('promo-row-pause-p1');
    assert.ok(r.has('promo-pause'));
    assert.equal(r.props('promo-pause-go').disabled, true, 'no reason yet');
    await r.change('promo-pause-reason', 'Checking the price');
    await r.click('promo-pause-go');
    assert.deepEqual(writes(r).map((q) => [q.method, q.url, q.body]), [['PATCH', '/api/admin/promos/p1', { action: 'pause', reason: 'Checking the price' }]]);
    assert.equal(r.textOf('promo-said'), 'Paused LAUNCH20.');
    assert.ok(lists(r).length >= 2, 'the list is read again');

    await r.click('promo-row-menu-p3');
    await r.click('promo-row-end-p3');
    await r.change('promo-end-reason', 'Sessions moved');
    assert.equal(r.props('promo-end-go').disabled, true, 'the code is not typed yet');
    await r.change('promo-end-typed', 'officehr');
    assert.equal(r.props('promo-end-go').disabled, true);
    await r.change('promo-end-typed', 'officehrs');
    await r.click('promo-end-go');
    assert.deepEqual(writes(r).at(-1), { url: '/api/admin/promos/p3', method: 'DELETE', body: { reason: 'Sessions moved' } });

    await r.click('promo-row-menu-p2');
    await r.click('promo-row-resume-p2');
    await r.click('promo-resume-go');
    assert.deepEqual(writes(r).at(-1).body, { action: 'resume' });
    assert.deepEqual(r.popups, [], 'never a browser pop-up');
  } finally { await r.close(); }
});

test('mounted PRM2: the drawer at its address reads the code, Stripe’s count and, when asked, its history', async () => {
  const r = await mounted(`${BASE}/p1?state=active`);
  try {
    assert.ok(r.requests.some((q) => q.url === '/api/admin/promos/p1'));
    assert.ok(r.requests.some((q) => q.url === '/api/admin/promos/p1/redemptions'));
    assert.ok(!r.requests.some((q) => q.url.endsWith('/history')), 'history is read when its tab opens');
    assert.equal(r.textOf('promo-fact-note'), 'For the advisor push');
    assert.equal(r.textOf('promo-fact-limit'), '200 in all; once per member');
    assert.match(r.textOf('promo-redeemed-stripe'), /44/);
    assert.match(r.textOf('promo-drawer-pays'), /Advisor Pro · monthly\$20\.00 → \$16\.00/);
    assert.equal(r.textOf('promo-drawer-tab-redemptions'), 'Redemptions 44');
    await r.click('promo-drawer-tab-history');
    assert.ok(r.requests.some((q) => q.url === '/api/admin/promos/p1/history'));
    assert.equal(r.textOf('promo-history-row'), 'Created by Hana HQ2 Oct 2026, 10:1420% off');
    assert.ok(r.has('promo-drawer-pause') && !r.has('promo-drawer-resume'));
  } finally { await r.close(); }
  const ended = await mounted(`${BASE}/p4`);
  try {
    assert.match(ended.textOf('promo-drawer-ended'), /Ended on 2 Sep 2026: “Replaced by FOUNDERS50” Replaced by promo_f50\. It can never be resumed or reused\./);
    // Mutation checked: offer resume on an ended code → promo-drawer-resume exists.
    assert.ok(!ended.has('promo-drawer-resume') && !ended.has('promo-drawer-pause') && !ended.has('promo-drawer-end'));
    assert.ok(ended.has('promo-drawer-copy_new'));
  } finally { await ended.close(); }
});

test('mounted PRM3–PRM4: New code in five steps sends one create, in minor units, with the plans and intervals', async () => {
  const r = await mounted();
  try {
    await r.click('promo-new');
    assert.ok(r.has('promo-step-applies'));
    assert.equal(r.props('promo-wizard-new-next').disabled, true, 'no plan chosen');
    await r.change('promo-plan-plan:advisor_pro', true);
    await r.click('promo-wizard-new-next');
    await r.change('promo-percent', '20');
    assert.match(r.textOf('promo-wizard-pays'), /\$20\.00 → \$16\.00/);
    await r.click('promo-wizard-new-next');
    assert.ok(r.has('promo-step-duration'));
    await r.click('promo-wizard-new-next');
    await r.change('promo-code', 'adv-7kq2');
    await r.change('promo-cap', '200');
    await r.click('promo-wizard-new-next');
    assert.equal(r.textOf('promo-review-code'), 'ADV-7KQ2');
    assert.deepEqual(writes(r), [], 'nothing is created before the last press');
    await r.click('promo-wizard-new-go');
    const w = writes(r);
    assert.equal(w.length, 1);
    assert.deepEqual([w[0].method, w[0].url], ['POST', '/api/admin/promos']);
    assert.deepEqual(w[0].body, { code: 'ADV-7KQ2', type: 'percent', duration: 'once', once_per_member: false, first_purchase_only: false, percent_off: 20,
      plan_keys: ['plan:advisor_pro'], intervals: ['month'], product_ids: [], max_redemptions: 200 });
    assert.equal(r.textOf('promo-said'), 'Created ADV-7KQ2.');
  } finally { await r.close(); }
});

test('mounted PRM5: Replace asks its reason, and a new code made while the old one could not be ended is said as that', async () => {
  const r = await mounted(BASE, { handle: handler({ '/replace': { method: 'POST', answer: () => response({ ok: false, promo_id: 'p9', code: 'LAUNCH21', old_ended: false, old_promo_id: 'p1', error: 'Stripe did not end the old code.' }, 502) } }) });
  try {
    await r.click('promo-row-menu-p1');
    await r.click('promo-row-replace-p1');
    for (let i = 0; i < 3; i += 1) await r.click('promo-wizard-replace-next');
    assert.equal(r.props('promo-code').value, '', 'the old code is never copied');
    await r.change('promo-code', 'LAUNCH20');
    assert.match(r.textOf('promo-wizard-replace-problem'), /LAUNCH20 is already taken/);
    await r.change('promo-code', 'LAUNCH21');
    await r.click('promo-wizard-replace-next');
    assert.equal(r.props('promo-wizard-replace-go').disabled, true, 'no reason yet');
    await r.change('promo-replace-reason', 'Adding yearly');
    await r.click('promo-wizard-replace-go');
    const w = writes(r);
    assert.deepEqual([w[0].url, w[0].body.code, w[0].body.reason, w[0].body.once_per_member], ['/api/admin/promos/p1/replace', 'LAUNCH21', 'Adding yearly', true]);
    // Mutation checked: treat the 502 as a refusal → no partial line.
    assert.equal(r.textOf('promo-replace-partial'), 'LAUNCH21 was created, but LAUNCH20 could not be ended. Both work at checkout now.');
  } finally { await r.close(); }
});

test('mounted: opening a drawer by its address keeps it open; search alone writes the address', async () => {
  const r = await mounted(`${BASE}/p1?state=active`);
  try {
    await act(async () => { await new Promise((res) => setTimeout(res, 380)); });
    // Mutation checked: let the search box write on its first render → the address loses /p1.
    assert.equal(r.textOf('where'), `${BASE}/p1?state=active`);
    assert.ok(r.has('promo-drawer-overview'));
    await r.change('promo-search', 'launch');
    await act(async () => { await new Promise((res) => setTimeout(res, 380)); });
    await r.flush();
    assert.equal(r.textOf('where'), `${BASE}?state=active&q=launch`);
    assert.ok(lists(r).some((q) => q.url === '/api/admin/promos?q=launch&state=active&page=1&page_size=25'));
  } finally { await r.close(); }
});

test('the source: no browser pop-up, no new tab, and the page wired through the address', () => {
  for (const f of ['frontend/src/pages/admin/consoles/PromoCodesConsole.jsx', 'frontend/src/pages/admin/promos/PromoParts.jsx', 'frontend/src/pages/admin/promos/PromoDialogs.jsx']) {
    const src = read(f);
    assert.ok(!/window\.(confirm|alert|open)\(|\bconfirm\(|\balert\(/.test(src), `${f}: no pop-up`);
    assert.ok(!/target="_blank"/.test(src), `${f}: no new tab`);
  }
  assert.ok(read('frontend/src/pages/admin/ConsolePages.jsx').includes('<PromoCodesPanel view={view} />'));
});
