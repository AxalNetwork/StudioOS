/**
 * D1012 (#2831) — Payments part 4: Catalogue complete. Needs you from part 2's
 * checks, every column, Filters, Sort and the pager, the product lightbox
 * (PAY2) at its own address, and PAY8–PAY11's states. The page is mounted on
 * a stubbed `fetch` answering with the Worker's shapes (D1010, D1011, the
 * promo mirror), and React props are read through `__reactProps$`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/payments_catalogue_d1012.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  allowanceCell, allowanceOf, filterProducts, flaggedProducts, membersLine, membersOn, needsYouAll, pageOf, priceText,
  productIdOf, productPath, promosFor, sortProducts, tabOf, tableGroups, technicalLines, yearlyLine, FILTERS_EMPTY,
} from '../src/pages/admin/payments/payModel.js';
import { hqLine, hqLinks } from '../src/pages/hq/hqNoticeModel.js';
import Payments from '../src/pages/admin/payments/Payments.jsx';
import SuperAdminOnlyNotice from '../src/pages/hq/SuperAdminOnlyNotice.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// ------------------------------------------------------------ the Worker's shapes (D1010)

const price = (id, unit_amount, interval, extra = {}) => ({
  id, currency: 'usd', unit_amount, interval, interval_count: interval ? 1 : null, nickname: null,
  type: interval ? 'recurring' : 'one_time', active: true, allowance_microusd: 0, allowance_reason: 'not_a_plan', ...extra,
});
const plan = (key, family, label, pct) => ({ key, family, label, yearly_saving_percent: pct });
const PRODUCTS = [
  {
    id: 'prod_vb', name: 'Founder Validate + Build', kind: 'subscription', active: true,
    metadata: { tier: 'growth', plan_family: 'founder' }, categories: ['founders'],
    plan: plan('founder:growth', 'founder', 'Founder Growth', 15),
    shows_on: [{ key: 'pricing', path: '/pricing', detail: 'the Founder Growth plan card' }, { key: 'bundles', path: '/pricing/products', detail: 'Profile bundles' }],
    prices: [
      price('price_m', 2000, 'month', { nickname: 'Monthly 2026', allowance_microusd: 5_000_000, allowance_reason: null }),
      price('price_y', 20400, 'year', { nickname: 'Yearly 2026', allowance_microusd: 4_250_000, allowance_reason: null }),
      price('price_old', 1800, 'month', { active: false, allowance_microusd: 0, allowance_reason: 'archived' }),
    ],
  },
  {
    id: 'prod_rg', name: 'Founder Raise + Grow', kind: 'subscription', active: true,
    metadata: { tier: 'scale' }, categories: ['founders'],
    plan: plan('founder:scale', 'founder', 'Founder Scale', null),
    shows_on: [{ key: 'pricing', path: '/pricing', detail: 'the Founder Scale plan card' }],
    prices: [price('price_rg', 4900, 'month', { allowance_microusd: 12_250_000, allowance_reason: null })],
  },
  {
    id: 'prod_inc', name: 'Delaware incorporation', kind: 'incorporation', active: true,
    metadata: { jurisdiction_id: 'us-de' }, categories: ['founders'], plan: null,
    shows_on: [{ key: 'addons', path: '/pricing/products', detail: 'Add-ons & services: For Founders' }, { key: 'incorporate', path: '/incorporate', detail: 'the us-de filing' }],
    prices: [price('price_inc', 49900, null)],
  },
  {
    id: 'prod_pack', name: '$10 AI credit pack', kind: 'token_pack', active: true, metadata: {}, categories: [], plan: null,
    shows_on: [{ key: 'packs', path: '/pricing', detail: 'token packs, while the pack is on sale' }],
    prices: [price('price_pack', 1000, null)],
  },
  {
    id: 'prod_old', name: 'Old add-on', kind: 'alacarte', active: false, metadata: {}, categories: [], plan: null, shows_on: [],
    prices: [price('price_oa', 500, null, { active: false, allowance_reason: 'archived' })],
  },
];
const CHECKS = [
  { code: 'plan_no_yearly', severity: 'warning', product_id: 'prod_rg', price_id: null, message: '“Founder Raise + Grow” has no yearly price, so /pricing offers it monthly only and a yearly checkout for it is refused.' },
  { code: 'key_mode_mismatch', severity: 'blocker', product_id: null, price_id: null, message: 'The publishable key is a test key but the account key is live. Card forms and checkouts would talk to different Stripe accounts.' },
];
const AUD = [{ value: 'founders', label: 'For Founders' }];
const CATALOG = { products: PRODUCTS, mode: 'live', audience_categories: AUD, keys: { account_mode: 'live', publishable_mode: 'test' }, checks: CHECKS };
const MEMBERS = {
  by_price: [
    { price_id: 'price_m', product_id: 'prod_vb', active: 37, other: 2 },
    { price_id: 'price_y', product_id: 'prod_vb', active: 12, other: 0 },
    // Members on an archived price keep it, and still count.
    { price_id: 'price_old', product_id: 'prod_vb', active: 3, other: 0 },
    { price_id: 'price_rg', product_id: 'prod_rg', active: 9, other: 0 },
  ],
  by_plan: [
    { family: 'founder', interval: 'month', interval_count: 1, active: 50, other: 2, without_price: 4 },
    { family: 'investor', interval: 'month', interval_count: 1, active: 3, other: 0, without_price: 7 },
  ],
  without_price_total: 11,
};
const promo = (id, extra = {}) => ({ id, code: id.toUpperCase(), active: true, product_ids: [], product_ids_readable: true, max_redemptions: null, times_redeemed: 0, expires_at: null, ...extra });
const PROMOS = { promos: [
  promo('everyone'),
  promo('vbonly', { product_ids: ['prod_vb'] }),
  promo('other', { product_ids: ['prod_inc'] }),
  promo('off', { active: false }),
  promo('expired', { expires_at: '2020-01-01T00:00:00Z' }),
  promo('usedup', { max_redemptions: 5, times_redeemed: 5 }),
  promo('broken', { product_ids_readable: false }),
] };
const CHANGES = { entries: [
  { id: 3, at: '2026-10-18 09:00:00', action: 'catalog_price_create', what: 'price', who: { id: 1, name: 'Admin Fixture' }, product_id: 'prod_vb', price_id: 'price_y', details: {} },
  { id: 2, at: '2026-10-09 10:00:00', action: 'catalog_price_update', what: 'price', who: { id: 1, name: 'Admin Fixture' }, product_id: 'prod_vb', price_id: 'price_m', details: {} },
  { id: 1, at: '2026-09-02 08:00:00', action: 'catalog_product_create', what: 'product', who: { id: 9, name: null }, product_id: 'prod_vb', price_id: null, details: {} },
], total: 3, limit: 3, offset: 0, filters: {}, kinds: [] };

// ---------------------------------------------------------------- the model

test('the product address: one route under Payments, read back, the Catalogue tab', () => {
  assert.equal(productPath('prod_vb'), '/admin/platform/payments/products/prod_vb');
  assert.equal(productIdOf('/admin/platform/payments/products/prod_vb'), 'prod_vb');
  assert.equal(productIdOf('/admin/platform/payments/products/prod_vb/'), 'prod_vb');
  assert.equal(productIdOf('/admin/platform/payments/products/'), null);
  assert.equal(productIdOf('/admin/platform/payments/products/a/b'), null);
  assert.equal(productIdOf('/admin/platform/payments'), null);
  assert.equal(tabOf('/admin/platform/payments/products/prod_vb'), 'catalogue', 'a product opens over Catalogue');
});

test('Needs you from the checks: blockers first, a product check opens its product, a key check opens Stripe, the webhook\'s own items after', () => {
  const webhook = { endpoints: [{ id: 'we_1', is_ours: true, status: 'enabled', missing_events: ['charge.refunded'] }] };
  const items = needsYouAll({ config: { mode: 'live' }, summary: { publishable: { configured: true, mode: 'live' } }, webhook, catalog: CATALOG });
  assert.deepEqual(items.map((i) => [i.code || i.id, i.action, i.href]), [
    ['key_mode_mismatch', 'Open Stripe connection', '/admin/platform/payments/stripe'],
    ['plan_no_yearly', 'Review Founder Raise + Grow', '/admin/platform/payments/products/prod_rg'],
    ['missing-we_1', 'Fix in Stripe connection', '/admin/platform/payments/stripe'],
  ]);
  assert.equal(items[1].text, CHECKS[0].message, 'the Worker\'s sentence is shown as written');
  // With the catalogue unread, the keys are judged from the config and summary, as before.
  const fallback = needsYouAll({ config: { mode: 'live' }, summary: { publishable: { configured: true, mode: 'test' } }, webhook: null, catalog: null });
  assert.deepEqual(fallback.map((i) => [i.id, i.href]), [['keys', '/admin/platform/payments/stripe']]);
  // A catalogue that answered with no checks raises nothing of its own.
  assert.deepEqual(needsYouAll({ config: null, summary: null, webhook: null, catalog: { products: [], checks: [] } }), []);
  assert.deepEqual([...flaggedProducts(CATALOG)], ['prod_rg']);
});

test('the AI allowance and the yearly line: active plans only, from the Worker\'s figure, never a zero', () => {
  assert.deepEqual(allowanceCell(PRODUCTS[0]), { main: '$5.00 / month', sub: '$4.25 on yearly', reason: null });
  assert.deepEqual(allowanceCell(PRODUCTS[1]), { main: '$12.25 / month', sub: null, reason: null });
  assert.equal(allowanceCell(PRODUCTS[2]).main, null);
  assert.equal(allowanceCell(PRODUCTS[2]).reason, 'Only active plans include an AI allowance.');
  assert.equal(allowanceCell({ ...PRODUCTS[0], active: false }).main, null, 'an archived plan gives no allowance');
  assert.deepEqual(allowanceOf(PRODUCTS[0].prices[2]), { text: null, reason: 'An archived price gives no AI allowance.' });
  assert.deepEqual(allowanceOf(price('x', 2000, 'month', { allowance_reason: 'not_usd' })), { text: null, reason: 'An AI allowance is counted in USD only.' });
  assert.match(allowanceOf({ id: 'x', active: true }).reason, /^Not recorded/, 'a read without the allowance is not a zero');
  assert.equal(allowanceOf(price('x', 2003, 'month', { allowance_microusd: 5_007_500, allowance_reason: null })).text, '$5.00', 'rounded down, never up');
  assert.deepEqual(yearlyLine(PRODUCTS[0]), { tone: 'good', text: 'Yearly saves 15%' });
  assert.deepEqual(yearlyLine(PRODUCTS[1]), { tone: 'muted', text: 'No yearly price' });
  assert.equal(yearlyLine(PRODUCTS[2]), null);
  assert.equal(priceText(price('x', 49900, null)), '499.00 USD · one time');
});

test('the table: archived in their own group, the kind chip, search, Filters, Sort and pages', () => {
  const flagged = flaggedProducts(CATALOG);
  const groups = tableGroups(sortProducts(PRODUCTS, 'name'));
  assert.deepEqual(groups.map((g) => [g.key, g.rows.map((p) => p.id)]), [
    ['plans', ['prod_rg', 'prod_vb']], ['oneTime', ['prod_inc']], ['packs', ['prod_pack']], ['archived', ['prod_old']],
  ]);
  const ids = (o) => filterProducts(PRODUCTS, { flagged, ...o }).map((p) => p.id).sort();
  assert.deepEqual(ids({ group: 'plans' }), ['prod_rg', 'prod_vb']);
  assert.deepEqual(ids({ group: 'oneTime' }), ['prod_inc', 'prod_old'], 'the kind chip keeps its archived products');
  assert.deepEqual(ids({ filters: { ...FILTERS_EMPTY, needs: true } }), ['prod_rg']);
  assert.deepEqual(ids({ filters: { ...FILTERS_EMPTY, status: 'archived' } }), ['prod_old']);
  assert.deepEqual(ids({ filters: { ...FILTERS_EMPTY, status: 'active' } }), ['prod_inc', 'prod_pack', 'prod_rg', 'prod_vb']);
  assert.deepEqual(ids({ filters: { ...FILTERS_EMPTY, surface: 'incorporate' } }), ['prod_inc']);
  assert.deepEqual(ids({ q: 'raise' }), ['prod_rg']);
  assert.deepEqual(sortProducts(PRODUCTS, 'name_desc').map((p) => p.id), ['prod_old', 'prod_vb', 'prod_rg', 'prod_inc', 'prod_pack']);
  assert.equal(sortProducts(PRODUCTS, 'needs', flagged)[0].id, 'prod_rg');
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `prod_${String(i).padStart(2, '0')}`, name: `P${String(i).padStart(2, '0')}`, kind: 'session', active: true, prices: [] }));
  const one = pageOf(tableGroups(many), 1, 25);
  assert.equal(one.range, '1–25 of 30');
  assert.equal(one.groups.find((g) => g.key === 'oneTime').rows.length, 25);
  assert.equal(one.groups.find((g) => g.key === 'oneTime').count, 30, 'a group header counts its rows on every page');
  const two = pageOf(tableGroups(many), 2, 25);
  assert.deepEqual([two.range, two.pages, two.groups.find((g) => g.key === 'oneTime').rows[0].id], ['26–30 of 30', 2, 'prod_25']);
  assert.equal(pageOf(tableGroups([]), 1, 25).range, '0 of 0');
});

test('members on a plan: paid members per interval from its prices, the others beside, the rows with no price apart', () => {
  const m = membersOn(PRODUCTS[0], MEMBERS);
  assert.deepEqual(m, { monthly: 40, yearly: 12, otherIntervals: 0, other: 2, withoutPrice: 4 });
  assert.equal(membersLine(m), '40 monthly · 12 yearly');
  assert.equal(membersOn(PRODUCTS[2], MEMBERS), null, 'a one-time product is no plan');
  assert.deepEqual(membersOn(PRODUCTS[1], { by_price: [], by_plan: [] }), { monthly: 0, yearly: 0, otherIntervals: 0, other: 0, withoutPrice: 0 });
});

test('promo codes that apply: usable now, for every product or this one; an unreadable list is counted apart', () => {
  const now = Date.parse('2026-10-25T00:00:00Z');
  assert.deepEqual(promosFor('prod_vb', PROMOS.promos, now), { apply: 2, unreadable: 1 });
  assert.deepEqual(promosFor('prod_inc', PROMOS.promos, now), { apply: 2, unreadable: 1 });
  assert.deepEqual(promosFor('prod_rg', PROMOS.promos, now), { apply: 1, unreadable: 1 });
  assert.deepEqual(promosFor('prod_rg', [promo('sql', { expires_at: '2026-10-24 23:00:00' })], now), { apply: 0, unreadable: 0 }, 'a SQL stamp is read as UTC');
});

test('technical details carry the codes the face of the page leaves out', () => {
  const t = Object.fromEntries(technicalLines(PRODUCTS[0]).map(([k, v]) => [`${k}`, v]));
  assert.equal(t.product, 'prod_vb');
  assert.equal(t.plan, 'founder:growth');
  assert.equal(t.tier, 'growth');
  assert.equal(t['price monthly'], 'price_old', 'every price is listed, the archived one included');
});

test('PAY11: a studio admin on Payments meets the closed card with its words and its two doors', () => {
  assert.equal(hqLine('/admin/platform/payments/products/prod_vb'), 'HQ sets what members pay. You are signed in as a studio admin, so this page stays closed rather than opening and refusing each action.');
  assert.deepEqual(hqLinks('/admin/platform/payments').map((l) => [l.label, l.href]), [['Go to Studio', '/studio'], ['See the public pricing page', '/pricing']]);
  assert.deepEqual(hqLinks('/admin/platform/allowances').map((l) => l.href), ['/studio', '/admin/my-licence'], 'other HQ pages keep their doors');
  assert.match(hqLine('/admin/platform/paymentsx'), /^HQ manages this page\./);
});

// ---------------------------------------------------------------- mounted

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fail = () => json({ error: 'read_failed', message: 'The read failed.' }, 502);
const SUMMARY = { payments_catalog: {
  publishable: { configured: true, masked: 'pk_live_••••4821', mode: 'live' },
  catalog: { available: true, last_written_at: '2026-10-18 09:12:00' },
  webhook: { available: true, deliveries: 212, not_2xx: 2 },
} };
const WEBHOOK = { our_url: 'https://axal.vc/api/billing/stripe/webhook', required_events: [], endpoints: [{ id: 'we_1', url: 'https://axal.vc/api/billing/stripe/webhook', status: 'enabled', is_ours: true, missing_events: [] }] };

function stub(over = {}) {
  const original = globalThis.fetch;
  const seen = [];
  const answers = {
    '/api/admin/catalog/products': () => json(CATALOG),
    '/api/admin/stripe/config': () => json({ publishable_key: 'pk_live_••••4821', mode: 'live', configured: true }),
    '/api/admin/stripe/webhook': () => json(WEBHOOK),
    '/api/admin/platform/summary': () => json(SUMMARY),
    '/api/admin/catalog/members': () => json(MEMBERS),
    '/api/admin/promos': () => json(PROMOS),
    '/api/admin/payments/change-log': () => json(CHANGES),
    ...over,
  };
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    seen.push(u);
    const a = answers[u.pathname];
    return a ? a(u) : json({});
  };
  return { seen, paths: () => [...new Set(seen.map((u) => u.pathname))].filter((p) => !p.startsWith('/api/ai')).sort(), restore() { globalThis.fetch = original; } };
}

async function settle() { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }

async function render(url, element = h(Payments)) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] },
      h(Routes, null, ['', '/stripe', '/log', '/products/:id'].map((p) => h(Route, { key: p, path: `/admin/platform/payments${p}`, element })))));
  });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  const node = (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return n; };
  return {
    of: (id) => textOf(node(id)),
    has: (id) => Boolean(byTestId(id)),
    props: (id) => props(node(id)),
    text: () => textOf(container),
    count: (id) => walk(container).filter((n) => props(n)?.['data-testid'] === id).length,
    all: (id) => walk(container).filter((n) => props(n)?.['data-testid'] === id).map(textOf),
    links: (id) => walk(byTestId(id) || container).filter((n) => n.tagName === 'A').map((n) => [textOf(n), props(n)?.href]),
    async click(id) { await act(async () => { props(node(id)).onClick({ preventDefault() {}, target: node(id) }); }); await settle(); },
    async change(id, value, checked) { await act(async () => { props(node(id)).onChange({ target: { value, checked } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

test('mounted Catalogue: Needs you from the checks with their doors, every column, the marker, the groups and the pager', async () => {
  const s = stub();
  const v = await render('/admin/platform/payments');
  try {
    assert.match(v.of('pay-needs'), /^Needs you · 2/);
    assert.deepEqual(v.links('pay-needs'), [['Open Stripe connection', '/admin/platform/payments/stripe'], ['Review Founder Raise + Grow', '/admin/platform/payments/products/prod_rg']]);
    assert.match(v.of('pay-need-plan_no_yearly'), /has no yearly price/);
    assert.doesNotMatch(v.text(), /Not read here yet|arrive with D1008 part 2/, 'part 2 has landed; nothing says it waits');
    assert.match(v.of('pay-catalogue'), /Product.*Kind.*Prices.*AI allowance.*Shows on.*For.*Status/s);
    const plans = v.of('pay-group-plans');
    assert.match(plans, /^Plans · 2/);
    assert.match(plans, /Founder Raise \+ Grow.*49\.00 USD \/ month.*No yearly price.*\$12\.25 \/ month.*\/pricing.*● Needs you/s);
    assert.match(plans, /Founder Validate \+ Build.*Yearly saves 15%.*20\.00 USD \/ month.*204\.00 USD \/ year.*\$5\.00 \/ month.*\$4\.25 on yearly.*\/pricing.*Products page · Profile bundles/s);
    assert.equal(v.count('pay-row-needs'), 1, 'only the product a check names carries the marker');
    assert.match(v.of('pay-group-oneTime'), /Delaware incorporation.*Incorporation · prod_inc.*One-time.*499\.00 USD · one time.*—.*Products page.*\/incorporate/s);
    assert.match(v.of('pay-group-packs'), /Token packs · 1 · read only.*Managed on AI allowances/s);
    assert.match(v.of('pay-group-archived'), /^Archived · 1.*Old add-on.*– Archived.*Date not recorded/s);
    assert.equal(v.of('pay-count'), '1–5 of 5');
    assert.deepEqual(v.all('pay-row-open'), ['Founder Raise + Grow', 'Founder Validate + Build', 'Delaware incorporation', '$10 AI credit pack', 'Old add-on']);
    assert.equal(v.props('pay-row-open').href, '/admin/platform/payments/products/prod_rg');
    assert.ok(!v.has('pay-product'), 'no product opens until its address is visited');
    assert.deepEqual(s.paths(), ['/api/admin/catalog/products', '/api/admin/platform/summary', '/api/admin/stripe/config', '/api/admin/stripe/webhook'], 'the lightbox\'s reads wait for it');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted Filters and Sort: in-page, they narrow and reorder the rows, and say how many filters are on', async () => {
  const s = stub();
  const v = await render('/admin/platform/payments');
  try {
    assert.ok(!v.has('pay-filters-panel'));
    await v.click('pay-filters');
    assert.ok(v.has('pay-filters-panel'), 'Filters opens an in-page panel');
    await v.change('pay-filter-needs', 'on', true);
    assert.deepEqual(v.all('pay-row-open'), ['Founder Raise + Grow']);
    assert.match(v.of('pay-filters'), /Filters · 1/);
    assert.equal(v.of('pay-count'), '1–1 of 1');
    await v.change('pay-filter-needs', 'on', false);
    await v.change('pay-filter-status', 'archived');
    assert.deepEqual(v.all('pay-row-open'), ['Old add-on']);
    await v.change('pay-filter-status', 'all');
    await v.change('pay-filter-surface', 'incorporate');
    assert.deepEqual(v.all('pay-row-open'), ['Delaware incorporation']);
    await v.change('pay-filter-surface', '');
    await v.change('pay-sort', 'name_desc');
    assert.deepEqual(v.all('pay-row-open'), ['Founder Validate + Build', 'Founder Raise + Grow', 'Delaware incorporation', '$10 AI credit pack', 'Old add-on']);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted product lightbox at its address: where members see it, prices, members, promo codes, checks, recent changes, details', async () => {
  const s = stub();
  const v = await render('/admin/platform/payments/products/prod_vb');
  try {
    assert.ok(v.has('pay-product'), 'the address opens the lightbox');
    assert.match(v.of('pay-product'), /Founder Validate \+ Build/);
    assert.match(v.of('pay-product'), /Plan · Founder Growth.*✓ Active/s);
    assert.deepEqual(v.links('pay-product-where'), [['↗ /pricing', '/pricing'], ['↗ Products page · Profile bundles', '/pricing/products']]);
    assert.deepEqual(v.all('pay-price-row'), [
      'Monthly20.00 USD$5.00Monthly 2026Active',
      'Yearly204.00 USD$4.25Yearly 2026Active',
      'Monthly18.00 USD—NoneArchived',
    ]);
    assert.equal(v.of('pay-product-saving'), 'Yearly saves 15%, computed from the two prices.');
    assert.equal(v.of('pay-product-members-line'), '40 monthly · 12 yearly');
    assert.match(v.of('pay-product-members'), /2 more trialing, past due, unpaid or incomplete\..*4 on this plan’s family were recorded before prices were stored.*Archiving a price stops new sales\. Members already on it keep their price\./s);
    assert.equal(v.of('pay-product-promos-count'), '2 codes');
    assert.match(v.of('pay-product-promos'), /1 code could not be matched/);
    assert.deepEqual(v.links('pay-product-promos'), [['Open Promo codes', '/admin/platform/promo-codes']]);
    assert.match(v.of('pay-product-checks'), /✓ No issues\./);
    assert.deepEqual(v.all('pay-product-change'), [
      '18 Oct 2026 · Admin Fixture · Added a price',
      '9 Oct 2026 · Admin Fixture · Changed a price',
      '2 Sep 2026 · Account #9 · name not recorded · Created a product',
    ]);
    assert.deepEqual(v.links('pay-product-changes'), [['Open the change log', '/admin/platform/payments/log?product=prod_vb']]);
    assert.match(v.of('pay-product-tech'), /^Technical details.*product: prod_vb.*plan: founder:growth.*tier: growth.*price_m/s);
    assert.match(v.of('pay-product-actions'), /Add a price.*Change a price.*Opens with D1008 part 5/s);
    const log = s.seen.find((u) => u.pathname === '/api/admin/payments/change-log');
    assert.equal(log?.searchParams.get('product'), 'prod_vb', 'the recent changes are this product\'s');
    assert.equal(log?.searchParams.get('limit'), '3');
    assert.ok(s.paths().includes('/api/admin/catalog/members') && s.paths().includes('/api/admin/promos'));
  } finally { await v.unmount(); s.restore(); }
});

test('mounted lightbox: a failed check is shown, a product that is not a plan reads no members, a missing product says so', async () => {
  let s = stub();
  let v = await render('/admin/platform/payments/products/prod_rg');
  try {
    assert.match(v.of('pay-product-checks'), /! “Founder Raise \+ Grow” has no yearly price/);
    assert.doesNotMatch(v.of('pay-product-checks'), /No issues/, 'a failed check also said no issues');
    assert.ok(!v.has('pay-product-saving'), 'no saving without a yearly price');
  } finally { await v.unmount(); s.restore(); }
  s = stub();
  v = await render('/admin/platform/payments/products/prod_inc');
  try {
    assert.ok(!v.has('pay-product-members'), 'a one-time product has no members section');
    assert.ok(!s.paths().includes('/api/admin/catalog/members'), 'nor its read');
    assert.deepEqual(v.links('pay-product-where'), [['↗ Products page', '/pricing/products'], ['↗ /incorporate', '/incorporate']]);
  } finally { await v.unmount(); s.restore(); }
  s = stub();
  v = await render('/admin/platform/payments/products/prod_nope');
  try {
    assert.match(v.of('pay-product-missing'), /No product with this ID is in the catalogue/);
    assert.match(v.of('pay-product-tech'), /prod_nope/);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted lightbox: each of its reads fails alone, says so with Try again, and never reads as none', async () => {
  const s = stub({ '/api/admin/catalog/members': fail, '/api/admin/promos': fail, '/api/admin/payments/change-log': fail });
  const v = await render('/admin/platform/payments/products/prod_vb');
  try {
    assert.match(v.of('pay-product-members-unread'), /Could not be read\. That is not a claim that nobody is on this plan\..*Try again/s);
    assert.match(v.of('pay-product-promos-unread'), /That is not a claim that no code applies/);
    assert.match(v.of('pay-product-changes-unread'), /Nothing is shown rather than an empty history/);
    assert.ok(!v.has('pay-product-members-line') && !v.has('pay-product-promos-count'), 'a failed read drew a count');
    assert.equal(v.count('pay-price-row'), 3, 'the catalogue\'s sections still draw');
    assert.match(v.of('pay-product-checks'), /✓ No issues\./);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted PAY8a: Stripe not connected is one card, with no tiles, no table and no count', async () => {
  const s = stub({
    '/api/admin/stripe/config': () => json({ publishable_key: null, mode: 'unconfigured', configured: false }),
    '/api/admin/catalog/products': () => json({ ...CATALOG, products: [], keys: { account_mode: 'unconfigured', publishable_mode: null }, checks: [] }),
  });
  const v = await render('/admin/platform/payments');
  try {
    assert.match(v.of('pay-not-connected'), /Stripe is not connected on this platform yet\.HQ adds the account’s keys at deploy\. Until then nothing can be sold, and this page shows no products\./);
    assert.ok(!v.has('pay-tiles') && !v.has('pay-catalogue') && !v.has('pay-needs'), 'fake tiles or a table were drawn');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted PAY8b, PAY9 and PAY10b: no products yet, eight skeleton rows while reading, a failed catalogue on its own', async () => {
  let s = stub({ '/api/admin/catalog/products': () => json({ ...CATALOG, products: [], checks: [] }) });
  let v = await render('/admin/platform/payments');
  try {
    assert.match(v.of('pay-catalogue-empty'), /No products yet\.Make the first one, or sync products you made in the Stripe dashboard\./);
    assert.match(v.of('pay-catalogue-empty'), /New product.*Sync from Stripe/s);
    assert.ok(v.has('pay-tiles'), 'the tiles still draw');
  } finally { await v.unmount(); s.restore(); }

  s = stub({ '/api/admin/catalog/products': () => new Promise(() => {}) });
  v = await render('/admin/platform/payments');
  try {
    assert.equal(v.count('pay-skeleton-row'), 8);
    assert.match(v.of('pay-catalogue'), /Product.*Kind.*Prices.*AI allowance.*Shows on.*For.*Status/s, 'the headers are real while reading');
    assert.ok(!v.has('pay-needs'), 'Needs you waits for the catalogue');
  } finally { await v.unmount(); s.restore(); }

  s = stub({ '/api/admin/catalog/products': fail });
  v = await render('/admin/platform/payments');
  try {
    assert.match(v.of('pay-catalogue-failed'), /We could not load the catalogue\.The rest of Payments still works\.Try again/);
    assert.match(v.of('pay-checks-unread'), /checks could not be read.*not a claim that nothing needs you/);
    assert.ok(v.has('pay-tiles') && !v.has('pay-catalogue'), 'one failed block blanked the page, or drew an empty table');
    assert.ok(!v.has('pay-catalogue-empty'), 'a failed read was drawn as no products');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted PAY11: the closed card on Payments, with its words and doors', async () => {
  const v = await render('/admin/platform/payments/products/prod_vb', h(SuperAdminOnlyNotice));
  try {
    assert.match(v.of('super-admin-only-notice'), /HQ only.*This page belongs to the Super Admin.*HQ sets what members pay\. You are signed in as a studio admin/s);
    assert.deepEqual(v.links('super-admin-only-notice'), [['Go to Studio', '/studio'], ['See the public pricing page', '/pricing']]);
  } finally { await v.unmount(); }
});

test('mounted Change log: a product\'s link arrives filtered to that product', async () => {
  const s = stub();
  const v = await render('/admin/platform/payments/log?product=prod_vb');
  try {
    const call = s.seen.find((u) => u.pathname === '/api/admin/payments/change-log');
    assert.equal(call?.searchParams.get('product'), 'prod_vb');
  } finally { await v.unmount(); s.restore(); }
  const t = stub();
  const w = await render('/admin/platform/payments/log?product=not-a-product');
  try {
    assert.equal(t.seen.find((u) => u.pathname === '/api/admin/payments/change-log')?.searchParams.get('product'), null, 'an unreadable product is not sent');
  } finally { await w.unmount(); t.restore(); }
});

test('the source: the product route behind hqOnly, its door a literal link, no browser pop-up, no secret key', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/admin\/platform\/payments\/products\/:id" element=\{guard\(\['admin'\], hqOnly\(<Payments \/>\)\)\} \/>/);
  const page = read('frontend/src/pages/admin/payments/Payments.jsx');
  assert.match(page, /to=\{`\/admin\/platform\/payments\/products\/\$\{encodeURIComponent\(p\.id\)\}`\}/);
  for (const f of ['Payments.jsx', 'ProductLightbox.jsx', 'payModel.js']) {
    const src = read(`frontend/src/pages/admin/payments/${f}`);
    assert.doesNotMatch(src, /\b(alert|confirm|prompt)\(/, `${f} uses a browser pop-up`);
    assert.doesNotMatch(src, /sk_(live|test)_/, `${f} names a secret key`);
  }
});
