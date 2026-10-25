/**
 * D1008 (#2386) — Payments at /admin/platform/payments: the owner's canvas
 * (PAY1–PAY13) integrated under D936's header, HQ only, out of the Admin
 * Console. Catalogue and Stripe connection draw what four existing reads
 * carry, each answering alone.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/payments_d1008.test.mjs
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
  MOVED_NOTICES, catalogueCounts, catalogueGroups, keysMatch, kindWord, modeWord, needsYou, priceText, searchProducts, stampText, tabOf,
} from '../src/pages/admin/payments/payModel.js';
import Payments from '../src/pages/admin/payments/Payments.jsx';
import { legacyContractsTarget } from '../src/pages/admin/LegacyContractsRedirect.jsx';
import { stripFor } from '../src/lib/hqStrips.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const price = (id, unit_amount, interval, extra = {}) => ({ id, currency: 'usd', unit_amount, interval, interval_count: interval ? 1 : null, nickname: null, type: interval ? 'recurring' : 'one_time', active: true, ...extra });
const PRODUCTS = [
  { id: 'prod_b', name: 'Founder Validate + Build', kind: 'subscription', active: true, metadata: { tier: 'growth' }, categories: ['founders'], prices: [price('p1', 2000, 'month'), price('p2', 20400, 'year')] },
  { id: 'prod_a', name: 'Advisor Pro', kind: 'subscription', active: true, metadata: {}, categories: [], prices: [price('p3', 2000, 'month', { interval_count: 3 })] },
  { id: 'prod_c', name: 'Delaware incorporation', kind: 'incorporation', active: true, metadata: {}, categories: ['founders', 'legal_services'], prices: [price('p4', 49900, null)] },
  { id: 'prod_d', name: 'Old add-on', kind: 'alacarte', active: false, metadata: {}, categories: [], prices: [price('p5', 900, null, { active: false })] },
  { id: 'prod_e', name: '$10 pack', kind: 'token_pack', active: true, metadata: {}, categories: [], prices: [price('p6', 1000, null)] },
  { id: 'prod_f', name: 'An archived session', kind: 'session', active: false, metadata: {}, categories: [], prices: [] },
];
const AUD = [{ value: 'founders', label: 'For Founders' }, { value: 'legal_services', label: 'Legal Services' }];

// ---------------------------------------------------------------- the model

test('the addresses, the redirect, the strip and the moved notice', () => {
  assert.equal(tabOf('/admin/platform/payments'), 'catalogue');
  assert.equal(tabOf('/admin/platform/payments/stripe/'), 'stripe');
  assert.equal(tabOf('/admin/platform/payments/log'), null, 'the change log waits for its read');
  assert.equal(legacyContractsTarget('?tab=payments'), '/admin/platform/payments?moved=payments');
  assert.equal(stripFor('/admin/platform/payments/stripe'), 'Platform');
  assert.equal(MOVED_NOTICES.payments, 'The Admin Console has moved: Payments now lives under Platform.');
});

test('words: kinds, modes and prices in the canvas\'s form, a quarterly price never read as monthly', () => {
  assert.deepEqual(['subscription', 'incorporation', 'session', 'alacarte', 'token_pack', 'odd'].map(kindWord), ['Plan', 'Incorporation', 'Session', 'Add-on', 'Token pack', 'Not recorded']);
  assert.deepEqual(['live', 'test', 'unconfigured', undefined].map(modeWord), ['Live', 'Test', 'Not connected', 'Not recorded']);
  assert.equal(priceText(price('x', 2000, 'month')), '20.00 USD / month');
  assert.equal(priceText(price('x', 2000, 'month', { interval_count: 3 })), '20.00 USD every 3 months');
  assert.equal(priceText(price('x', 49900, null)), '499.00 USD');
  assert.equal(priceText(price('x', null, 'month')), 'No fixed amount / month');
  assert.equal(stampText('2026-10-18 09:12:00'), '18 Oct 2026, 09:12 UTC');
  assert.equal(stampText(null), null);
});

test('the catalogue: three groups, active by name then archived, counts over every product, search from two characters', () => {
  const g = Object.fromEntries(catalogueGroups(PRODUCTS).map((x) => [x.key, x.rows.map((r) => r.id)]));
  assert.deepEqual(g, { plans: ['prod_a', 'prod_b'], oneTime: ['prod_c', 'prod_f', 'prod_d'], packs: ['prod_e'] }, 'archived rows sit at the end of their group');
  assert.deepEqual(catalogueCounts(PRODUCTS), { all: 6, active: 4, activePrices: 5, byGroup: { plans: 2, oneTime: 3, packs: 1 } });
  assert.equal(searchProducts(PRODUCTS, 'z').length, 6, 'one character filtered');
  assert.deepEqual(searchProducts(PRODUCTS, 'prod_c').map((p) => p.id), ['prod_c']);
});

test('keys match only when both reads answer: the account\'s mode and the key\'s own', () => {
  assert.deepEqual(keysMatch({ mode: 'live' }, { publishable: { configured: true, mode: 'live' } }), { state: 'match', mode: 'live' });
  assert.deepEqual(keysMatch({ mode: 'live' }, { publishable: { configured: true, mode: 'test' } }), { state: 'differ', key: 'test', account: 'live' });
  assert.equal(keysMatch(null, { publishable: { configured: true, mode: 'live' } }).state, 'unchecked');
  assert.equal(keysMatch({ mode: 'live' }, null).state, 'unchecked', 'a missing summary was read as a match');
  assert.equal(keysMatch({ mode: 'live' }, { publishable: { configured: false, mode: null } }).state, 'nokey');
});

test('needs you: mismatched keys, no endpoint of ours, missing events, a disabled endpoint; a failed webhook read claims nothing', () => {
  const ok = { endpoints: [{ id: 'we_1', is_ours: true, status: 'enabled', missing_events: [] }] };
  assert.deepEqual(needsYou({ config: { mode: 'live' }, summary: { publishable: { configured: true, mode: 'live' } }, webhook: ok }), []);
  const ids = needsYou({
    config: { mode: 'live' },
    summary: { publishable: { configured: true, mode: 'test' } },
    webhook: { endpoints: [{ id: 'we_1', is_ours: true, status: 'disabled', missing_events: ['charge.refunded', 'charge.dispute.created'] }] },
  }).map((n) => n.id);
  assert.deepEqual(ids, ['keys', 'missing-we_1', 'disabled-we_1']);
  assert.deepEqual(needsYou({ config: { mode: 'live' }, summary: { publishable: { configured: true, mode: 'live' } }, webhook: { endpoints: [{ id: 'x', is_ours: false }] } }).map((n) => n.id), ['noendpoint']);
  assert.deepEqual(needsYou({ config: { mode: 'live' }, summary: { publishable: { configured: true, mode: 'live' } }, webhook: null }), []);
});

// ---------------------------------------------------------------- the page, mounted

async function render(url) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] },
      h(Routes, null,
        h(Route, { path: '/admin/platform/payments', element: h(Payments) }),
        h(Route, { path: '/admin/platform/payments/stripe', element: h(Payments) }))));
  });
  for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  return {
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byTestId(id)),
    count: (id) => walk(container).filter((n) => props(n)?.['data-testid'] === id).length,
    h1s: () => walk(container).filter((n) => n.tagName === 'H1').length,
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const SUMMARY = { payments_catalog: {
  publishable: { configured: true, masked: 'pk_live_••••4821', mode: 'test' },
  catalog: { available: true, products: { all: 5, active: 4 }, prices: { all: 6, active: 5 }, last_written_at: '2026-10-18 09:12:00', sync_basis: 'Nothing syncs on a schedule.' },
  webhook: { available: true, deliveries: 212, not_2xx: 2, last: { status_code: 200, latency_ms: 84, at: '2026-10-24 14:02:00' } },
} };
const WEBHOOK = { our_url: 'https://axal.vc/api/billing/stripe/webhook', required_events: ['checkout.session.completed', 'charge.refunded'], endpoints: [
  { id: 'we_1', url: 'https://axal.vc/api/billing/stripe/webhook', status: 'enabled', is_ours: true, missing_events: ['charge.refunded'] },
  { id: 'we_2', url: 'https://example.com/hook', status: 'enabled', is_ours: false, missing_events: [] },
] };
function stub(over = {}) {
  const original = globalThis.fetch;
  const seen = [];
  const answers = {
    '/api/admin/catalog/products': () => json({ products: PRODUCTS, mode: 'live', audience_categories: AUD }),
    '/api/admin/stripe/config': () => json({ publishable_key: 'pk_live_••••4821', mode: 'live', configured: true }),
    '/api/admin/stripe/webhook': () => json(WEBHOOK),
    '/api/admin/platform/summary': () => json(SUMMARY),
    ...over,
  };
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    seen.push(u.pathname);
    return answers[u.pathname] ? answers[u.pathname]() : json({});
  };
  return { seen, restore() { globalThis.fetch = original; } };
}

test('mounted Catalogue: one h1, the crumb, HQ only, the notice, needs you, the tiles, the grouped table, and only its four reads', async () => {
  const s = stub();
  const v = await render('/admin/platform/payments?moved=payments');
  try {
    assert.equal(v.h1s(), 1);
    assert.match(v.of('pay-header'), /Platform.*Payments.*HQ only/s);
    assert.match(v.of('pay-header'), /The Admin Console has moved: Payments now lives under Platform\./);
    assert.match(v.of('pay-tab-catalogue'), /Catalogue\s*6/);
    assert.match(v.of('pay-need-keys'), /publishable key is Test, the account is Live/);
    assert.match(v.of('pay-need-missing-we_1'), /misses 1 event/);
    assert.match(v.of('pay-tile-stripe'), /Live.*Keys differ/s);
    assert.match(v.of('pay-tile-products'), /4.*of 6.*5 active prices/s);
    assert.match(v.of('pay-tile-sync'), /18 Oct 2026, 09:12 UTC/);
    assert.match(v.of('pay-tile-webhook'), /212.*2 not accepted/s);
    assert.match(v.of('pay-group-plans'), /Advisor Pro.*every 3 months.*Founder Validate \+ Build.*20\.00 USD \/ month.*204\.00 USD \/ year/s);
    assert.match(v.of('pay-group-packs'), /Managed on AI allowances/);
    assert.match(v.of('pay-group-oneTime'), /Old add-on.*Archived/s);
    assert.ok(v.has('pay-editor-open'), 'today\'s editor is unreachable');
    assert.deepEqual([...new Set(s.seen.filter((p) => !p.startsWith('/api/ai')))].sort(),
      ['/api/admin/catalog/products', '/api/admin/platform/summary', '/api/admin/stripe/config', '/api/admin/stripe/webhook']);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted Stripe connection: the account, the key and its mismatch, our endpoint\'s checklist, the other endpoint, deliveries, the mirror', async () => {
  const s = stub();
  const v = await render('/admin/platform/payments/stripe');
  try {
    assert.match(v.of('pay-account'), /Live/);
    assert.match(v.of('pay-key-match'), /The publishable key is Test, the account is Live/);
    assert.match(v.of('pay-endpoint-ours'), /charge\.refunded — missing.*1 missing/s);
    assert.match(v.of('pay-endpoint-other'), /Not used by this platform/);
    assert.match(v.of('pay-deliveries'), /212 deliveries · 2 not accepted.*Per hour: Not read here yet/s);
    assert.match(v.of('pay-mirror'), /4 active of 5 products · 5 active of 6 prices/);
    assert.ok(!s.seen.includes('/api/admin/catalog/products'), 'Stripe connection read the catalogue');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted: each read fails alone, and no failure is drawn as "not set up" or as a match', async () => {
  const s = stub({
    '/api/admin/stripe/config': () => json({ detail: 'down' }, 503),
    '/api/admin/stripe/webhook': () => json({ detail: 'down' }, 502),
    '/api/admin/catalog/products': () => json({ detail: 'down' }, 502),
  });
  const v = await render('/admin/platform/payments');
  try {
    assert.match(v.of('pay-stripe-unread'), /This is not a claim that Stripe is off/);
    assert.match(v.of('pay-catalogue-failed'), /The rest of Payments still works/);
    assert.match(v.of('pay-tile-webhook'), /212/, 'the summary still answered');
    assert.equal(v.count('pay-need-keys'), 0, 'a failed config read was drawn as a mismatch');
    assert.equal(v.count('pay-need-noendpoint'), 0, 'a failed webhook read was drawn as no endpoint');
  } finally { await v.unmount(); s.restore(); }
});

// ---------------------------------------------------------------- the source

test('the routes behind hqOnly, the console mount gone, the doors, and the rail frame outermost', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes(`<Route path="/admin/platform/payments" element={guard(['admin'], hqOnly(<Payments />))} />`));
  assert.ok(app.includes(`<Route path="/admin/platform/payments/stripe" element={guard(['admin'], hqOnly(<Payments />))} />`));
  assert.ok(app.includes('<StripLink to="/admin/platform/payments">Payments</StripLink>'));
  const admin = read('frontend/src/pages/admin/ConsolePages.jsx');
  assert.ok(!admin.includes('<PaymentsPanel'), 'the console still mounts the tab');
  assert.ok(read('frontend/src/pages/hq/PlatformPage.jsx').includes('<Link to="/admin/platform/payments"'));
  const page = read('frontend/src/pages/admin/payments/Payments.jsx');
  assert.match(page, /export default function Payments\(\) \{\s*return \(\s*<AdminBoardFrame workspace="Payments catalogue"/);
  assert.ok(!/\b(alert|confirm)\(/.test(page), 'a browser pop-up on the page');
  assert.ok(!/sk_(live|test)_|STRIPE_SECRET/.test(page), 'the page names a secret key');
});
