/**
 * D1013 (#2832, part 5 of Payments #2386) — New product (PAY3), the price
 * dialogs (PAY4), the Stripe dialogs and the step-up (PAY6), today's editor
 * retired and the storefront's writer turned into a link. Mounted on a
 * stubbed `fetch` as the Super Admin; each dialog also meets a refusal.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/payments_dialogs_d1013.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  PLAN_FAMILIES, centsOf, keyCheck, membersOn, planClash, planKeyOf, pricePreview, reasonProblem, refusalOf, syncDiff,
} from '../src/pages/admin/payments/dialogModel.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import Payments from '../src/pages/admin/payments/Payments.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// ---------------------------------------------------------------- the model

test('the plan levels are /pricing\'s cards, with the metadata planOf reads; a level no checkout sells has none', () => {
  const lv = (fam, id) => PLAN_FAMILIES.find((f) => f.key === fam).levels.find((l) => l.id === id);
  assert.deepEqual(PLAN_FAMILIES.map((f) => f.key), ['founder', 'investor', 'advisor', 'partner', 'market_intelligence']);
  assert.deepEqual(PLAN_FAMILIES[0].levels.map((l) => [l.name, l.metadata]), [['Validate + Build', { tier: 'growth' }], ['Raise + Grow', { tier: 'studio' }]]);
  assert.equal(lv('investor', 'plus').metadata, null, 'Investor Plus would be created with metadata no checkout reads');
  assert.match(lv('investor', 'plus').note, /no checkout sells this level yet/);
  assert.deepEqual(lv('investor', 'professional').metadata, { investor_tier: 'professional' });
  assert.deepEqual(lv('investor', 'institutional').metadata, { investor_tier: 'institutional' });
  assert.match(lv('investor', 'institutional').note, /Contact Sales/);
  assert.deepEqual(lv('advisor', 'pro').metadata, { plan_group: 'advisor' });
  assert.deepEqual(lv('partner', 'pro').metadata, { plan_group: 'partner' });
  assert.deepEqual(lv('market_intelligence', 'mi_pro').metadata, { plan: 'mi_pro' });
  // Every level that can be created is one the Worker accepts (validateProductMetadata).
  const ok = (m) => m.plan === 'mi_pro' || ['growth', 'studio'].includes(m.tier) || ['professional', 'institutional'].includes(m.investor_tier) || ['advisor', 'partner'].includes(m.plan_group);
  for (const f of PLAN_FAMILIES) for (const l of f.levels) if (l.metadata) assert.ok(ok(l.metadata), `${l.name}: metadata the Worker refuses`);
});

test('planKeyOf is the Worker\'s planOf, and the clash is the same plan on another active product', () => {
  assert.equal(planKeyOf({ tier: 'studio' }), 'founder:studio');
  assert.equal(planKeyOf({ investor_tier: 'institutional' }), 'investor:institutional');
  assert.equal(planKeyOf({ plan_group: 'partner' }), 'partner');
  assert.equal(planKeyOf({ plan: 'mi_pro' }), 'market_intelligence');
  assert.equal(planKeyOf({ kind: 'session' }), null);
  // The Worker's own function, read so the two cannot drift.
  const worker = read('cloudflare-worker/src/services/aiCredits.ts');
  assert.match(worker, /metadata\.tier === 'growth' \|\| metadata\.tier === 'studio'\) return \{ family: 'founder', licence_key: `founder:\$\{metadata\.tier\}` \}/);
  const studio = PLAN_FAMILIES[0].levels[1];
  const growth = PLAN_FAMILIES[0].levels[0];
  const products = [
    { id: 'a', name: 'Old Studio', active: false, metadata: { tier: 'studio' } },
    { id: 'b', name: 'Raise + Grow 2025', active: true, metadata: { tier: 'studio' } },
  ];
  assert.equal(planClash(products, studio)?.id, 'b');
  assert.equal(planClash(products.slice(0, 1), studio), null, 'an archived product clashed');
  assert.equal(planClash(products, growth), null, 'two founder tiers clashed');
  assert.equal(planClash([{ id: 'c', active: true, metadata: {}, plan: { key: 'founder:growth' } }], growth)?.id, 'c', 'part 2\'s plan key was not read');
  assert.equal(planClash(products, { metadata: null }), null);
});

test('amounts, the preview, the allowance and the saving — never computed against another currency', () => {
  assert.equal(centsOf('204.00'), 20400);
  assert.equal(centsOf('20'), 2000);
  assert.equal(centsOf('1,428.5'), 142850);
  for (const bad of ['', 'abc', '-5', '20.001', '1e3']) assert.equal(centsOf(bad), null, bad);
  const monthly = { unit_amount: 2000, currency: 'usd' };
  assert.equal(pricePreview({ cents: 20400, billing: 'year', isPlan: true, monthly }), '$204.00 / year · AI allowance $4.25 a month · saves 15% against monthly.');
  assert.equal(pricePreview({ cents: 2000, billing: 'month', isPlan: true }), '$20.00 / month · AI allowance $5.00 a month.');
  assert.equal(pricePreview({ cents: 20400, currency: 'eur', billing: 'year', isPlan: true, monthly }), '204.00 EUR / year · no AI allowance: only USD prices give one.');
  assert.equal(pricePreview({ cents: 30000, billing: 'year', isPlan: true, monthly }), '$300.00 / year · AI allowance $6.25 a month.', 'a yearly price that saves nothing claimed a saving');
  assert.equal(pricePreview({ cents: 49900, billing: 'once', isPlan: false }), '$499.00 once.');
  assert.equal(pricePreview({ cents: null, billing: 'month', isPlan: true }), null);
});

test('the reason rule is the Worker\'s: 1 to 500, and 10 for a price change', () => {
  assert.match(reasonProblem(''), /Say why/);
  assert.equal(reasonProblem('x'), null);
  assert.match(reasonProblem('too short', 10), /at least 10/);
  assert.equal(reasonProblem('  Raise for 2027  ', 10), null);
  assert.match(reasonProblem('x'.repeat(501)), /500/);
});

test('the key check: a secret key is refused before it is sent; a mismatch is said; an unread account is not compared', () => {
  for (const k of ['sk_live_abc', 'sk_test_abc', 'rk_live_abc']) {
    const c = keyCheck(k, 'live');
    assert.equal(c.ok, false, k);
    assert.match(c.text, /secret key\. Never paste it here/);
  }
  assert.equal(keyCheck('abc', 'live').ok, false);
  assert.equal(keyCheck('pk_abc', 'live').ok, false, 'a key in no known mode was accepted');
  const bad = keyCheck('pk_test_123', 'live');
  assert.deepEqual([bad.ok, bad.mismatch, bad.text], [true, true, 'This is a Test key. The account is Live. Checkout and token packs will fail until they match.']);
  assert.deepEqual([keyCheck('pk_live_123', 'live').tone, keyCheck('pk_live_123', 'live').text], ['good', 'Live key · matches the account.']);
  assert.match(keyCheck('pk_live_123', null).text, /was not read, so it was not compared/);
  assert.equal(keyCheck('pk_live_123', null).mismatch, undefined);
});

test('the sync\'s new and gone, the members count, and a cancelled step-up in words', () => {
  assert.deepEqual(syncDiff([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], [{ id: 'b', name: 'B' }, { id: 'c', name: 'C' }]), { added: ['C'], gone: ['A'] });
  assert.equal(membersOn({ by_price: [{ price_id: 'p1', active: 30, other: 7 }, { price_id: 'p2', active: 5, other: 0 }] }, ['p1']), 37);
  assert.equal(membersOn({ by_price: [] }, ['p1']), 0);
  assert.equal(membersOn(null, ['p1']), null, 'an unread count became a number');
  assert.match(refusalOf({ status: 403, code: 'step_up_required', message: 'x' }).message, /authenticator code was not entered/);
  assert.equal(refusalOf({ status: 502, code: 'create_failed', message: 'The product could not be created in Stripe.' }).message, 'The product could not be created in Stripe.');
});

// ---------------------------------------------------------------- mounted, as the Super Admin

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const SUPER = { id: 1, role: 'admin', is_super_admin: 1, name: 'Ada' };
const price = (id, unit_amount, interval, extra = {}) => ({ id, currency: 'usd', unit_amount, interval, interval_count: interval ? 1 : null, type: interval ? 'recurring' : 'one_time', active: true, ...extra });
const PRODUCTS = [
  { id: 'prod_b', name: 'Founder Validate + Build', kind: 'subscription', active: true, metadata: { tier: 'growth', audience: 'founders' }, categories: ['founders'], prices: [price('p1', 2000, 'month')] },
  { id: 'prod_s', name: 'Founder Raise + Grow', kind: 'subscription', active: true, metadata: { tier: 'studio' }, categories: [], prices: [price('p2', 4900, 'month')] },
  { id: 'prod_e', name: '$10 pack', kind: 'token_pack', active: true, metadata: {}, categories: [], prices: [price('p6', 1000, null)] },
];
const AUD = [{ value: 'founders', label: 'For Founders' }, { value: 'legal_services', label: 'Legal Services' }];
const WEBHOOK = { our_url: 'https://axal.vc/api/billing/stripe/webhook', required_events: ['checkout.session.completed', 'charge.refunded'], endpoints: [] };

function stub(over = {}) {
  const original = globalThis.fetch;
  const calls = [];
  const answers = {
    'GET /api/auth/me': () => json(SUPER),
    'GET /api/admin/catalog/products': () => json({ products: PRODUCTS, mode: 'live', audience_categories: AUD }),
    'GET /api/admin/catalog/members': () => json({ by_price: [{ price_id: 'p1', active: 30, other: 7 }], by_plan: [], without_price_total: 0 }),
    'GET /api/admin/stripe/config': () => json({ publishable_key: 'pk_live_••••4821', mode: 'live', configured: true }),
    'GET /api/admin/stripe/webhook': () => json(WEBHOOK),
    'GET /api/admin/platform/summary': () => json({ payments_catalog: { publishable: { configured: true, mode: 'live' }, catalog: { available: true, products: { all: 3, active: 3 }, prices: { all: 3, active: 3 }, last_written_at: null, sync_basis: 'Nothing syncs on a schedule.' }, webhook: { available: false, reason: 'x' } } }),
    'GET /api/admin/payments/webhook-deliveries': () => json({ available: true, deliveries: 0, not_2xx: 0, last: null, hours: [] }),
    'POST /api/admin/catalog/products': () => json({ ok: true, product: { id: 'prod_new' } }),
    'POST /api/admin/catalog/products/prod_b/prices': () => json({ ok: true, price: { id: 'p9' } }),
    'POST /api/admin/catalog/prices/p1/change': () => json({ ok: true }),
    'POST /api/admin/catalog/products/prod_b/archive': () => json({ ok: true }),
    'PATCH /api/admin/catalog/products/prod_b': () => json({ ok: true }),
    'PUT /api/admin/stripe/config': () => json({ ok: true, mode: 'live' }),
    'POST /api/admin/stripe/webhook': () => json({ ok: true, endpoint_id: 'we_9', url: 'x', secret_stored: true }),
    'POST /api/admin/catalog/sync': () => json({ ok: true, synced: 3 }),
    ...over,
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: u.pathname, body });
    const f = answers[`${method} ${u.pathname}`];
    return f ? f(body, calls) : json({});
  };
  return {
    calls,
    writes: () => calls.filter((c) => c.method !== 'GET'),
    count: (m, p) => calls.filter((c) => c.method === m && c.path === p).length,
    restore() { globalThis.fetch = original; },
  };
}

async function settle() { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }

async function render(url, { user = SUPER } = {}) {
  const restore = installDocument();
  if (user) localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null,
      h(Routes, null, ['', '/stripe', '/log'].map((p) => h(Route, { key: p, path: `/admin/platform/payments${p}`, element: h(Payments) }))))));
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
    async click(id) { await act(async () => { props(node(id)).onClick({ preventDefault() {}, target: node(id) }); }); await settle(); },
    async change(id, value) { await act(async () => { props(node(id)).onChange({ target: { value } }); }); await settle(); },
    async submit(id) { await act(async () => { props(node(id)).onSubmit({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

test('New product, a plan: two steps, the preview as members will see it, the clash, and one write with the reason', async () => {
  const s = stub();
  const v = await render('/admin/platform/payments');
  try {
    await v.click('pay-new-open');
    assert.match(v.of('pay-new'), /Step 1 of 2 · What are you selling\?.*Plan.*One-time service.*Add-on.*Session.*Token packs are made on AI allowances/s);
    await v.click('pay-new-continue');
    await v.click('pay-new-level-studio');
    assert.match(v.of('pay-new-clash'), /An active product already makes the Raise \+ Grow card: Founder Raise \+ Grow\. Archive it first/);
    await v.click('pay-new-level-growth');
    assert.match(v.of('pay-new-clash'), /Founder Validate \+ Build/);
    await v.change('pay-new-name', 'Validate + Build 2027');
    assert.match(v.of('pay-new-preview'), /Preview · \/pricing · Founder tab.*Validate \+ Build 2027.*Prove the idea, then build the company\..*No price yet/s);
    assert.equal(v.props('pay-new-create').disabled, true, 'created without a reason');
    await v.change('pay-new-reason', 'The 2027 founder plan');
    assert.equal(v.props('pay-new-create').disabled, false);
    assert.match(v.of('pay-new-tech'), /tier=growth/);
    assert.equal(s.writes().length, 0);
    await v.submit('pay-new-form');
    assert.deepEqual(s.writes(), [{ method: 'POST', path: '/api/admin/catalog/products', body: { name: 'Validate + Build 2027', kind: 'subscription', metadata: { tier: 'growth' }, reason: 'The 2027 founder plan' } }]);
    assert.ok(!v.has('pay-new'), 'the dialog stayed open');
    assert.match(v.of('pay-saved'), /Validate \+ Build 2027 was created\. It is recorded in the change log\./);
    assert.ok(s.count('GET', '/api/admin/catalog/products') >= 2, 'the catalogue was not read again');
  } finally { await v.unmount(); s.restore(); }
});

test('New product: Investor Plus cannot be created; an add-on needs its feature and whole days; ?new=product opens it', async () => {
  const s = stub();
  const v = await render('/admin/platform/payments?new=product');
  try {
    assert.ok(v.has('pay-new'), 'the storefront\'s door did not open New product');
    await v.click('pay-new-continue');
    await v.click('pay-new-family-investor');
    await v.click('pay-new-level-plus');
    assert.match(v.of('pay-new-level-note'), /\/pricing shows this card, but no checkout sells this level yet\./);
    await v.change('pay-new-reason', 'Try investor plus');
    assert.equal(v.props('pay-new-create').disabled, true, 'a level no checkout sells was created');
  } finally { await v.unmount(); }
  const w = await render('/admin/platform/payments');
  try {
    await w.click('pay-new-open');
    await w.click('pay-new-kind-alacarte');
    await w.click('pay-new-continue');
    await w.change('pay-new-name', 'CSV export · 30 days');
    await w.change('pay-new-feature', 'export_csv');
    await w.change('pay-new-days', '30.5');
    await w.change('pay-new-reason', 'A new add-on');
    assert.equal(w.props('pay-new-create').disabled, true, 'half a day was accepted');
    await w.change('pay-new-days', '30');
    await w.submit('pay-new-form');
    assert.deepEqual(s.writes().at(-1).body, { name: 'CSV export · 30 days', kind: 'alacarte', metadata: { kind: 'alacarte', feature_key: 'export_csv', unlock_days: '30' }, reason: 'A new add-on' });
  } finally { await w.unmount(); s.restore(); }
});

test('New product, refused: the Worker\'s sentence stays in the dialog, the code under Technical details, and nothing is said saved', async () => {
  const s = stub({ 'POST /api/admin/catalog/products': () => json({ error: 'create_failed', message: 'The product could not be created in Stripe. Nothing changed; try again in a moment.' }, 502) });
  const v = await render('/admin/platform/payments');
  try {
    await v.click('pay-new-open');
    await v.click('pay-new-kind-session');
    await v.click('pay-new-continue');
    await v.change('pay-new-name', 'Office hours');
    await v.change('pay-new-reason', 'Sessions for founders');
    await v.submit('pay-new-form');
    assert.match(v.of('pay-new-error'), /could not be created in Stripe\. Nothing changed.*Technical details.*502 · create_failed/s);
    assert.ok(v.has('pay-new'), 'the dialog closed on a refusal');
    assert.ok(!v.has('pay-saved'));
  } finally { await v.unmount(); s.restore(); }
});

test('the step-up: a write the Worker answers step_up_required is sent again once the code is in; cancelled, nothing changed', async () => {
  let first = true;
  const s = stub({ 'POST /api/admin/catalog/products/prod_b/archive': () => {
    if (first) { first = false; return json({ error: 'step_up_required', code: 'step_up_required', ttl_minutes: 15 }, 403); }
    return json({ ok: true });
  } });
  const originalDispatch = globalThis.dispatchEvent;
  let answer = true;
  const asked = [];
  globalThis.dispatchEvent = (ev) => {
    if (ev.type === 'studioos:step_up_required') { asked.push(ev.detail.ttlMinutes); ev.detail.ack = true; setTimeout(() => ev.detail.done(answer), 0); }
    return true;
  };
  const v = await render('/admin/platform/payments');
  try {
    await v.click('pay-row-open-prod_b');
    await v.click('pay-act-archive');
    assert.match(v.of('pay-archive-product-effects'), /37 members on it keep their plan until they cancel\./);
    await v.change('pay-archive-product-reason', 'Replaced by the 2027 plan');
    await v.submit('pay-archive-product-form');
    await settle();
    assert.deepEqual(asked, [15], 'the step-up was not asked for');
    const archives = s.calls.filter((c) => c.path === '/api/admin/catalog/products/prod_b/archive');
    assert.equal(archives.length, 2, 'the write was not sent again after the code');
    assert.deepEqual(archives.map((c) => c.body), [{ reason: 'Replaced by the 2027 plan' }, { reason: 'Replaced by the 2027 plan' }]);
    assert.match(v.of('pay-saved'), /Founder Validate \+ Build was archived/);
    // Cancelled: the original refusal, in words, and the dialog stays.
    first = true; answer = false;
    await v.click('pay-row-open-prod_b');
    await v.click('pay-act-archive');
    await v.change('pay-archive-product-reason', 'Replaced by the 2027 plan');
    await v.submit('pay-archive-product-form');
    await settle();
    assert.match(v.of('pay-archive-product-error'), /The authenticator code was not entered, so nothing was changed\./);
  } finally { globalThis.dispatchEvent = originalDispatch; await v.unmount(); s.restore(); }
});

test('Add a price: the billing, the preview with allowance and saving, and the body the Worker takes', async () => {
  const s = stub();
  const v = await render('/admin/platform/payments');
  try {
    await v.click('pay-row-open-prod_b');
    assert.match(v.of('pay-product'), /Add a price.*Edit details.*Archive product/s);
    await v.click('pay-act-add-price');
    await v.change('pay-add-price-amount', '204.00');
    await v.click('pay-add-price-year');
    assert.match(v.of('pay-add-price-preview'), /\$204\.00 \/ year · AI allowance \$4\.25 a month · saves 15% against monthly\./);
    await v.change('pay-add-price-reason', 'Yearly price');
    await v.submit('pay-add-price-form');
    assert.deepEqual(s.writes().at(-1), { method: 'POST', path: '/api/admin/catalog/products/prod_b/prices', body: { currency: 'usd', unit_amount: 20400, type: 'recurring', interval: 'year', reason: 'Yearly price' } });
    assert.match(v.of('pay-saved'), /The price was added to Founder Validate \+ Build/);
  } finally { await v.unmount(); s.restore(); }
});

test('Change a price: part 2\'s route, the members who keep the old one, ten characters of reason, and a refusal kept', async () => {
  const s = stub({ 'POST /api/admin/catalog/prices/p1/change': () => json({ error: 'price_change_rolled_back', message: 'The old price could not be archived, so the new one was archived again. The old price is still the price.' }, 502) });
  const v = await render('/admin/platform/payments');
  try {
    await v.click('pay-row-open-prod_b');
    await v.click('pay-act-change-p1');
    assert.match(v.of('pay-change-price'), /Stripe never edits a price\. This adds the new price and archives the old one\..*Old price.*20\.00 USD \/ month/s);
    await v.change('pay-change-price-amount', '24.00');
    assert.match(v.of('pay-change-price-effects'), /37 members on it keep the old price\..*New members pay 24\.00 USD \/ month from now\./s);
    await v.change('pay-change-price-reason', 'Too short');
    assert.equal(v.props('pay-change-price-send').disabled, true, 'a nine-character reason was sent');
    await v.change('pay-change-price-reason', 'Prices for 2027');
    await v.submit('pay-change-price-form');
    const w = s.writes().at(-1);
    assert.equal(w.path, '/api/admin/catalog/prices/p1/change');
    assert.deepEqual({ ...w.body, idempotency_key: typeof w.body.idempotency_key }, { unit_amount: 2400, reason: 'Prices for 2027', idempotency_key: 'string' });
    assert.ok(w.body.idempotency_key.length >= 8);
    assert.match(v.of('pay-change-price-error'), /The old price is still the price\./);
    await v.submit('pay-change-price-form');
    const again = s.writes().at(-1);
    assert.equal(again.body.idempotency_key, w.body.idempotency_key, 'a retried press would make a second price');
  } finally { await v.unmount(); s.restore(); }
});

test('the members read failing says the count was not taken, never "0 members"', async () => {
  const s = stub({ 'GET /api/admin/catalog/members': () => json({ error: 'members_unreadable', message: 'down' }, 502) });
  const v = await render('/admin/platform/payments');
  try {
    await v.click('pay-row-open-prod_b');
    await v.click('pay-act-change-p1');
    assert.match(v.of('pay-change-price-effects'), /The members on it could not be counted; they keep the old price\./);
    assert.doesNotMatch(v.of('pay-change-price-effects'), /\b0 members/);
  } finally { await v.unmount(); s.restore(); }
});

test('Edit details keeps the metadata the plan is read from, and never sends an empty description', async () => {
  const s = stub();
  const v = await render('/admin/platform/payments');
  try {
    await v.click('pay-row-open-prod_b');
    await v.click('pay-act-edit');
    assert.equal(v.props('pay-edit-product-send').disabled, true, 'saved with nothing changed');
    await v.change('pay-edit-product-name', 'Validate + Build');
    await v.change('pay-edit-product-reason', 'Shorter name');
    await v.submit('pay-edit-product-form');
    assert.deepEqual(s.writes().at(-1), { method: 'PATCH', path: '/api/admin/catalog/products/prod_b', body: { name: 'Validate + Build', metadata: { tier: 'growth', audience: 'founders' }, reason: 'Shorter name' } });
  } finally { await v.unmount(); s.restore(); }
});

test('a token pack offers no change here, and anyone but the Super Admin is told who can', async () => {
  const s = stub({ 'GET /api/auth/me': () => json({ id: 2, role: 'admin', is_super_admin: 0 }) });
  const v = await render('/admin/platform/payments', { user: { id: 2, role: 'admin', is_super_admin: 0 } });
  try {
    assert.ok(!v.has('pay-new-open'));
    assert.match(v.of('pay-new-holder'), /Only the Super Admin can change payments/);
    await v.click('pay-row-open-prod_b');
    assert.ok(!v.has('pay-product-actions'));
    assert.ok(!v.has('pay-act-change-p1'));
  } finally { await v.unmount(); s.restore(); }
});

test('Stripe: Replace key refuses a secret key and a mismatched key, and sends a matching one with its reason', async () => {
  const s = stub();
  const v = await render('/admin/platform/payments/stripe');
  try {
    await v.click('pay-key-replace');
    await v.change('pay-replace-key-input', 'sk_live_51abc');
    await v.change('pay-replace-key-reason', 'Rotating the key');
    assert.match(v.of('pay-replace-key-check'), /That is a secret key\. Never paste it here/);
    assert.equal(v.props('pay-replace-key-send').disabled, true, 'a secret key could be sent');
    await v.change('pay-replace-key-input', 'pk_test_51abc');
    assert.match(v.of('pay-replace-key-check'), /This is a Test key\. The account is Live\./);
    assert.equal(v.props('pay-replace-key-send').disabled, true, 'a mismatched key could be sent');
    await v.change('pay-replace-key-input', 'pk_live_51abc');
    assert.match(v.of('pay-replace-key-check'), /Live key · matches the account\./);
    await v.submit('pay-replace-key-form');
    assert.deepEqual(s.writes(), [{ method: 'PUT', path: '/api/admin/stripe/config', body: { publishable_key: 'pk_live_51abc', reason: 'Rotating the key' } }]);
    assert.ok(!s.calls.some((c) => JSON.stringify(c.body || '').includes('sk_live')), 'a secret key left the page');
    assert.match(v.of('pay-saved'), /The publishable key was replaced with a Live key\./);
    assert.doesNotMatch(v.of('pay-saved'), /pk_live_51abc/, 'the key was echoed back');
  } finally { await v.unmount(); s.restore(); }
});

test('Stripe: Register a new endpoint and Add the missing events send their own action; a secret not stored is said', async () => {
  const s = stub({ 'POST /api/admin/stripe/webhook': (body) => (body.action === 'register'
    ? json({ error: 'secret_storage_failed', detail: 'The endpoint has been removed to avoid a partially-configured state.' }, 503)
    : json({ ok: true })) });
  const v = await render('/admin/platform/payments/stripe');
  try {
    await v.click('pay-webhook-register');
    assert.match(v.of('pay-register'), /This creates an endpoint in Stripe with every event the platform acts on.*axal\.vc\/api\/billing\/stripe\/webhook.*2 events.*authenticator code/s);
    await v.submit('pay-register-form');
    assert.deepEqual(s.writes().at(-1).body, { action: 'register' });
    assert.ok(v.has('pay-register-error'), 'a secret that was not stored was called registered');
  } finally { await v.unmount(); s.restore(); }
  const t = stub({ 'GET /api/admin/stripe/webhook': () => json({ ...WEBHOOK, endpoints: [{ id: 'we_1', url: WEBHOOK.our_url, status: 'enabled', is_ours: true, missing_events: ['charge.refunded'] }] }) });
  const w = await render('/admin/platform/payments/stripe');
  try {
    await w.click('pay-webhook-add-we_1');
    assert.match(w.of('pay-add-events'), /1 missing.*charge\.refunded/s);
    await w.submit('pay-add-events-form');
    assert.deepEqual(t.writes().at(-1).body, { action: 'update', endpoint_id: 'we_1' });
    assert.match(w.of('pay-saved'), /The missing events were added/);
  } finally { await w.unmount(); t.restore(); }
});

test('Stripe: the sync says what is new and what is gone; a failure says nothing changed and offers Try again', async () => {
  let reads = 0;
  const after = [...PRODUCTS.slice(1), { id: 'prod_n', name: 'Advisor Pro', kind: 'subscription', active: true, metadata: {}, categories: [], prices: [] }];
  const s = stub({ 'GET /api/admin/catalog/products': () => { reads += 1; return json({ products: reads === 1 ? PRODUCTS : after }); } });
  const v = await render('/admin/platform/payments/stripe');
  try {
    await v.click('pay-sync-open');
    await v.click('pay-sync-send');
    assert.match(v.of('pay-sync-result'), /Synced 3 products\..*1 new: Advisor Pro\..*1 gone from Stripe: Founder Validate \+ Build\./s);
  } finally { await v.unmount(); s.restore(); }
  // The read before the sync failed: what changed is not listed, rather than every product called new.
  const u = stub({ 'GET /api/admin/catalog/products': () => json({ error: 'down' }, 502) });
  const x = await render('/admin/platform/payments/stripe');
  try {
    await x.click('pay-sync-open');
    await x.click('pay-sync-send');
    assert.match(x.of('pay-sync-result'), /Synced 3 products\..*What changed could not be listed/s);
    assert.doesNotMatch(x.of('pay-sync-result'), /new:/);
  } finally { await x.unmount(); u.restore(); }
  const t = stub({ 'POST /api/admin/catalog/sync': () => json({ error: 'catalog_sync_failed', message: 'The catalogue could not be synced with Stripe.' }, 502) });
  const w = await render('/admin/platform/payments/stripe');
  try {
    await w.click('pay-sync-open');
    await w.click('pay-sync-send');
    assert.match(w.of('pay-sync-failed'), /Stripe did not answer\. Nothing changed\. This failure is recorded\./);
    assert.ok(w.has('pay-sync-retry'));
    assert.ok(!w.has('pay-sync-result'));
  } finally { await w.unmount(); t.restore(); }
});

// ---------------------------------------------------------------- the source

test('the editor is retired, the storefront writes nothing, and no dialog uses a browser pop-up or names a secret key', () => {
  assert.equal(existsSync(resolve(process.cwd(), 'frontend/src/pages/admin/consoles/PaymentsConsole.jsx')), false, 'PaymentsPanel is still in the tree');
  const page = read('frontend/src/pages/admin/payments/Payments.jsx');
  assert.ok(!/PaymentsPanel|PaymentsConsole'/.test(page.replace(/\/\*[\s\S]*?\*\//g, '')), 'the page still mounts the editor');
  const store = read('frontend/src/pages/ProductsPage.jsx');
  assert.ok(!store.includes('adminCatalogCreateProduct'), 'the storefront still creates products');
  assert.ok(!store.includes('AddProductModal'));
  assert.match(store, /to="\/admin\/platform\/payments\?new=product"/);
  assert.match(store, /const canAddProduct = user\?\.role === 'admin' && isSuperAdminUser\(user\);/);
  for (const f of ['ProductDialogs.jsx', 'StripeDialogs.jsx', 'dialogModel.js', 'Payments.jsx', 'StripeConnection.jsx']) {
    const src = read(`frontend/src/pages/admin/payments/${f}`);
    assert.ok(!/\b(alert|confirm|prompt)\(/.test(src), `${f}: a browser pop-up`);
    assert.ok(!/STRIPE_SECRET|sk_live_[A-Za-z0-9]{4}/.test(src), `${f}: names a secret key`);
  }
  // Every write the dialogs send carries the reason the Worker requires (D1009).
  const api = read('frontend/src/lib/api.js');
  assert.match(api, /adminCatalogArchiveProduct: \(id, reason\) =>[\s\S]{0,140}body: JSON\.stringify\(\{ reason \}\)/);
  assert.match(api, /adminCatalogArchivePrice: \(priceId, reason\) =>[\s\S]{0,140}body: JSON\.stringify\(\{ reason \}\)/);
  assert.match(api, /adminStripeSetConfig: \(publishableKey, reason\) =>[\s\S]{0,120}body: JSON\.stringify\(\{ publishable_key: publishableKey, reason \}\)/);
});
