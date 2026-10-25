/**
 * D1010 (#2829) — Payments part 2, on node:sqlite with Stripe stubbed.
 *
 *   · the catalogue's checks, each a sentence: two products making one plan,
 *     a plan with no yearly price, a subscription that makes no card, a price
 *     charged every N intervals, a non-USD and a weekly plan price, and the
 *     publishable key's mode against the account's;
 *   · "shows on" per product and the AI allowance per price (25% of a USD
 *     monthly price, a yearly one's ÷ 12, none in another currency), with the
 *     yearly saving, all in the admin catalogue read; no key in it;
 *   · members per price and per family and interval, Super Admin only, with
 *     rows recorded before migration 572 counted apart; the webhook stores
 *     the price id, and an update without one keeps it;
 *   · one change-a-price route behind the Super Admin write bar and a reason:
 *     it adds the new price with the old one's currency and interval, then
 *     archives the old; a failed archive archives the new one again, and when
 *     that fails too it says both are live. Each guard has its refusal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { ensureCatalogSchema, type CatalogProduct } from '../src/services/catalog.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { adminCatalog } from '../src/routes/catalog.ts';
import { annotateCatalog, catalogChecks, priceAllowance, showsOn } from '../src/services/paymentsCatalog.ts';
import { recordSubscriptionAmount } from '../src/services/planAllowance.ts';

const JWT_SECRET = 'd1010-payments-fixture-only-secret-0123456789';
const OWNER = 1; // a Super Admin in the fixture
const FOUNDER = 2;
const ADMIN = 5; // a plain admin, added below

type P = { id: string; currency?: string; unit_amount: number; interval: string | null; interval_count?: number; active?: boolean; nickname?: string | null };
const price = (x: P) => ({ id: x.id, currency: x.currency ?? 'usd', unit_amount: x.unit_amount, interval: x.interval, interval_count: x.interval === null ? null : (x.interval_count ?? 1),
  nickname: x.nickname ?? null, type: x.interval === null ? 'one_time' : 'recurring', active: x.active ?? true });
const product = (id: string, name: string, kind: string, metadata: Record<string, string>, prices: P[], o: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id, name, kind: kind as any, active: true, metadata, categories: [], prices: prices.map(price) as any, synced_at: '2026-10-24 12:00:00', ...o,
});

const GOOD = () => [
  product('prod_growth', 'Validate + Build', 'subscription', { tier: 'growth' }, [{ id: 'price_gmonth', unit_amount: 2000, interval: 'month' }, { id: 'price_g_y', unit_amount: 20400, interval: 'year' }]),
  product('prod_pro', 'Investor Plus', 'subscription', { investor_tier: 'professional' }, [{ id: 'price_p_m', unit_amount: 14900, interval: 'month' }, { id: 'price_pyear', unit_amount: 151980, interval: 'year' }]),
  // A second founder plan: same family, another tier, so no clash.
  product('prod_studio', 'Raise + Grow', 'subscription', { tier: 'studio' }, [{ id: 'price_s_m', unit_amount: 19900, interval: 'month' }, { id: 'price_s_y', unit_amount: 199000, interval: 'year' }]),
];
const LIVE = { accountMode: 'live' as const, publishableMode: 'live' as const };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('a clean catalogue with matching keys has no checks', () => {
  assert.deepEqual(catalogChecks(GOOD(), LIVE), []);
});

test('each check names its product or price and says what goes wrong', () => {
  const codes = (ps: CatalogProduct[], keys = LIVE) => catalogChecks(ps, keys).map((c) => [c.code, c.severity, c.product_id, c.price_id]);
  // Two active products making one plan; an archived twin is not a clash.
  const clash = [...GOOD(), product('prod_growth2', 'Growth (old)', 'subscription', { tier: 'growth' }, [{ id: 'price_g2_m', unit_amount: 1900, interval: 'month' }, { id: 'price_g2_y', unit_amount: 19000, interval: 'year' }])];
  assert.deepEqual(codes(clash), [['plan_clash', 'blocker', 'prod_growth', null]]);
  assert.match(catalogChecks(clash, LIVE)[0].message, /“Validate \+ Build” and “Growth \(old\)” all make the founder growth plan\./);
  assert.deepEqual(codes([...GOOD(), { ...clash[2], active: false }]), []);
  // A plan with no yearly price (an archived yearly one does not count).
  assert.deepEqual(codes([product('prod_studio', 'Raise + Grow', 'subscription', { tier: 'studio' }, [{ id: 'price_s_m', unit_amount: 19900, interval: 'month' }, { id: 'price_s_y', unit_amount: 1, interval: 'year', active: false }])]),
    [['plan_no_yearly', 'warning', 'prod_studio', null]]);
  // A subscription that makes no card.
  assert.deepEqual(codes([product('prod_ra', 'Registered Agent', 'subscription', {}, [{ id: 'price_rayear', unit_amount: 9900, interval: 'year' }])]),
    [['subscription_no_card', 'warning', 'prod_ra', null]]);
  // A price charged every three months, a weekly one, a euro one.
  const odd = product('prod_growth', 'Validate + Build', 'subscription', { tier: 'growth' }, [
    { id: 'price_gmonth', unit_amount: 2000, interval: 'month' }, { id: 'price_g_y', unit_amount: 20400, interval: 'year' },
    { id: 'price_g_q', unit_amount: 5400, interval: 'month', interval_count: 3 }, { id: 'price_g_w', unit_amount: 500, interval: 'week' },
    { id: 'price_g_eur', currency: 'eur', unit_amount: 1900, interval: 'month' }]);
  assert.deepEqual(codes([odd]), [
    ['price_interval_count', 'blocker', 'prod_growth', 'price_g_q'], ['plan_price_short_interval', 'blocker', 'prod_growth', 'price_g_w'],
    ['plan_price_not_usd', 'warning', 'prod_growth', 'price_g_eur']]);
  assert.match(catalogChecks([odd], LIVE)[0].message, /charged every 3 months \(price_g_q\)\. Checkout picks a plan's price by its interval alone/);
  // The keys.
  assert.deepEqual(codes(GOOD(), { accountMode: 'live', publishableMode: 'test' }), [['key_mode_mismatch', 'blocker', null, null]]);
  assert.match(catalogChecks(GOOD(), { accountMode: 'live', publishableMode: 'test' })[0].message, /publishable key is a test key but the account key is live/);
  assert.deepEqual(codes(GOOD(), { accountMode: 'test', publishableMode: null }), [['publishable_key_missing', 'blocker', null, null]]);
  assert.deepEqual(codes(GOOD(), { accountMode: 'test', publishableMode: 'unknown' }), [['publishable_key_unknown', 'blocker', null, null]]);
  assert.deepEqual(codes(GOOD(), { accountMode: 'unconfigured', publishableMode: 'live' }), [['secret_key_missing', 'blocker', null, null]]);
});

test('shows on: a plan is a /pricing card and a bundle; a pack is a pack; everything else an add-on under its audiences', () => {
  const [growth] = GOOD();
  assert.deepEqual(showsOn(growth, new Set()).map((s) => [s.key, s.path, s.detail]), [['pricing', '/pricing', 'the founder growth plan card'], ['bundles', '/pricing/products', 'Profile bundles']]);
  const quarterly = product('prod_q', 'Quarterly', 'subscription', { tier: 'studio' }, [{ id: 'price_q', unit_amount: 1, interval: 'month', interval_count: 3 }]);
  assert.deepEqual(showsOn(quarterly, new Set()).map((s) => s.key), ['bundles'], 'no card without a monthly or yearly price');
  assert.deepEqual(showsOn(product('prod_pack', 'Tokens', 'alacarte', {}, []), new Set(['prod_pack'])).map((s) => s.key), ['packs'], 'the pack store decides, not the kind');
  assert.deepEqual(showsOn(product('prod_inc', 'Delaware filing', 'incorporation', { kind: 'incorporation', jurisdiction_id: 'delaware' }, [], { categories: ['founders', 'legal_services'] }), new Set()).map((s) => [s.key, s.detail]),
    [['addons', 'Add-ons & services: founders, legal_services'], ['incorporate', 'the delaware filing']]);
  assert.deepEqual(showsOn(product('prod_ala', 'Brand kit', 'alacarte', { kind: 'alacarte' }, []), new Set()).map((s) => [s.key, s.detail]),
    [['addons', 'Add-ons & services, under All only'], ['incorporate', 'add-ons at incorporation']]);
  assert.deepEqual(showsOn({ ...growth, active: false }, new Set()), [], 'an archived product shows nowhere');
});

test('the AI allowance per price: 25% of a USD monthly price, a yearly one\'s ÷ 12, none in another currency or off a plan', () => {
  const g = product('prod_growth', 'Validate + Build', 'subscription', { tier: 'growth' }, [
    { id: 'm', unit_amount: 2000, interval: 'month' }, { id: 'y', unit_amount: 24000, interval: 'year' }, { id: 'eur', currency: 'eur', unit_amount: 2000, interval: 'month' },
    { id: 'w', unit_amount: 2000, interval: 'week' }, { id: 'old', unit_amount: 2000, interval: 'month', active: false }]);
  const a = Object.fromEntries(g.prices.map((x) => [x.id, priceAllowance(g, x)]));
  assert.deepEqual(a.m, { microusd: 5_000_000, reason: null }, 'the owner\'s example: $20 gives $5');
  assert.deepEqual(a.y, { microusd: 5_000_000, reason: null }, '$240 a year gives $5 a month');
  assert.deepEqual(a.eur, { microusd: 0, reason: 'not_usd' });
  assert.deepEqual(a.w, { microusd: 0, reason: 'not_monthly_or_yearly' });
  assert.deepEqual(a.old, { microusd: 0, reason: 'archived' });
  const ra = product('prod_ra', 'Registered Agent', 'subscription', {}, [{ id: 'ra', unit_amount: 9900, interval: 'year' }]);
  assert.deepEqual(priceAllowance(ra, ra.prices[0]), { microusd: 0, reason: 'not_a_plan' });
  const [growth] = annotateCatalog(GOOD(), new Set());
  assert.deepEqual(growth.plan, { key: 'founder:growth', family: 'founder', label: 'founder growth', yearly_saving_percent: 15 });
  assert.deepEqual(growth.prices.map((x: any) => x.allowance_microusd), [5_000_000, 4_250_000]);
});

/* ------------------------------------------------------------------ *
 * The routes, on node:sqlite
 * ------------------------------------------------------------------ */

function world(o: { pk?: string | null; secret?: string | null } = {}) {
  const f = aiBudgetFixture();
  const kv = new Map<string, string>();
  if (o.pk !== null) kv.set('config:stripe:pk', o.pk ?? 'pk_test_fixtureOnly000');
  const env = { DB: f.DB, JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://app.example.test',
    RATE_LIMITS: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } },
    ...(o.secret === null ? {} : { STRIPE_SECRET_KEY: o.secret ?? `sk${'_test_'}fixtureOnly000` }) } as any;
  f.db.prepare("INSERT INTO users(id,email,name,role,is_super_admin) VALUES(?, 'admin@example.test', 'Plain Admin', 'admin', 0) ON CONFLICT(id) DO UPDATE SET role = 'admin', is_super_admin = 0").run(ADMIN);
  f.db.exec(`CREATE TABLE IF NOT EXISTS user_sessions (jti TEXT PRIMARY KEY, user_id INTEGER, factor TEXT, created_at TEXT DEFAULT (datetime('now')),
    last_step_up_at TEXT, revoked_at TEXT, expires_at TEXT, last_seen_at TEXT, ip TEXT, user_agent TEXT)`);
  f.db.exec('DELETE FROM member_subscription_amounts');
  return { ...f, env, kv };
}

/** The catalogue as Stripe holds it, mirrored into D1 the way a sync writes it. */
const STRIPE = () => ({
  products: [
    { id: 'prod_growth', name: 'Validate + Build', active: true, metadata: { tier: 'growth' } },
    { id: 'prod_ra', name: 'Registered Agent', active: true, metadata: {} },
  ],
  prices: [
    { id: 'price_gmonth', product: 'prod_growth', active: true, currency: 'usd', unit_amount: 2000, nickname: 'Monthly', type: 'recurring', recurring: { interval: 'month', interval_count: 1 } },
    { id: 'price_rayear', product: 'prod_ra', active: true, currency: 'usd', unit_amount: 9900, nickname: null, type: 'recurring', recurring: { interval: 'year', interval_count: 1 } },
    { id: 'price_gold', product: 'prod_growth', active: false, currency: 'usd', unit_amount: 1500, nickname: 'Old monthly', type: 'recurring', recurring: { interval: 'month', interval_count: 1 } },
  ],
});

async function seed(f: any, store = STRIPE()) {
  await ensureCatalogSchema(f.env);
  for (const p of store.products) {
    const kind = 'subscription';
    const prices = store.prices.filter((x) => x.product === p.id).map((x) => ({ id: x.id, currency: x.currency, unit_amount: x.unit_amount, interval: x.recurring?.interval ?? null,
      interval_count: x.recurring?.interval_count ?? null, nickname: x.nickname, type: x.type, active: x.active }));
    f.db.prepare('INSERT INTO stripe_products(id,name,kind,active,metadata_json,prices_json) VALUES(?,?,?,?,?,?)').run(p.id, p.name, kind, 1, JSON.stringify(p.metadata), JSON.stringify(prices));
  }
}

/** Stripe, stubbed: lists, creates and archives prices in `store`. `fail` names calls that answer 500. */
function stripeStub(store: ReturnType<typeof STRIPE>, fail: { create?: boolean; archive?: string[] } = {}) {
  const before = globalThis.fetch;
  const calls: Array<{ method: string; path: string; form: URLSearchParams; idem: string | null }> = [];
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  let n = 0;
  globalThis.fetch = (async (input: any, init: any) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const form = new URLSearchParams(String(init?.body ?? ''));
    calls.push({ method, path: url.pathname, form, idem: init?.headers?.['Idempotency-Key'] ?? null });
    if (method === 'GET' && url.pathname === '/v1/products') return json({ data: store.products, has_more: false });
    if (method === 'GET' && url.pathname === '/v1/prices') return json({ data: store.prices, has_more: false });
    if (method === 'POST' && url.pathname === '/v1/prices') {
      if (fail.create) return json({ error: { message: 'boom' } }, 500);
      n += 1;
      const p = { id: `price_new${n}`, product: form.get('product')!, active: true, currency: form.get('currency')!, unit_amount: Number(form.get('unit_amount')), nickname: form.get('nickname'),
        type: form.get('recurring[interval]') ? 'recurring' : 'one_time', recurring: form.get('recurring[interval]') ? { interval: form.get('recurring[interval]')!, interval_count: Number(form.get('recurring[interval_count]') || 1) } : null };
      store.prices.push(p as any);
      return json(p);
    }
    const one = /^\/v1\/prices\/(price_[A-Za-z0-9]+)$/.exec(url.pathname);
    if (method === 'POST' && one) {
      if ((fail.archive ?? []).includes(one[1])) return json({ error: { message: 'boom' } }, 500);
      const p = store.prices.find((x) => x.id === one[1]);
      if (p && form.get('active') === 'false') p.active = false;
      return json(p ?? {});
    }
    throw new Error(`no Stripe stub answers ${method} ${url.pathname}`);
  }) as any;
  return { calls, restore: () => { globalThis.fetch = before; } };
}

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: String(e?.message) }, 500);
  });
  a.route('/api/admin/catalog', adminCatalog);
  return a;
}

const sqlAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');

/** A request as `user`; `stepUp: false` is a TOTP session with no recent step-up. */
async function call(f: any, method: string, path: string, user: number | null, body?: unknown, o: { stepUp?: boolean } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (user !== null) {
    const jti = `jti-${user}-${Math.random().toString(36).slice(2)}`;
    // A session minted just now counts as a step-up, so "no step-up" is a session minted two hours ago.
    f.db.prepare("INSERT INTO user_sessions(jti,user_id,factor,created_at,last_step_up_at) VALUES(?,?, 'totp', ?, ?)")
      .run(jti, user, o.stepUp === false ? sqlAgo(120) : sqlAgo(0), o.stepUp === false ? null : sqlAgo(0));
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: user, jti }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const r = await app().request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, f.env);
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, body: json, text };
}

test('the admin catalogue read carries the checks, the two keys\' modes and no key, shows-on and each price\'s allowance', async () => {
  const f = world({ pk: 'pk_live_fixtureOnly000' }); await seed(f);
  const r = await call(f, 'GET', '/api/admin/catalog/products', OWNER);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.keys, { account_mode: 'test', publishable_mode: 'live' });
  assert.deepEqual(r.body.checks.map((c: any) => c.code).sort(), ['key_mode_mismatch', 'plan_no_yearly', 'subscription_no_card']);
  const growth = r.body.products.find((p: any) => p.id === 'prod_growth');
  assert.deepEqual(growth.shows_on.map((s: any) => s.key), ['pricing', 'bundles']);
  assert.deepEqual([growth.prices[0].allowance_microusd, growth.prices[0].allowance_reason], [5_000_000, null]);
  assert.equal(growth.plan.yearly_saving_percent, null, 'no yearly price, no saving');
  assert.doesNotMatch(r.text, /sk_test_|pk_live_fixture|fixtureOnly/, 'no key, secret or publishable, is returned');
  assert.equal((await call(f, 'GET', '/api/admin/catalog/products', FOUNDER)).status, 403, 'a member is refused');
});

test('members per plan: Super Admin only; per price and per family and interval; rows with no price counted apart', async () => {
  const f = world(); await seed(f);
  const ins = f.db.prepare('INSERT INTO member_subscription_amounts(subscription_id,user_id,plan_family,amount_cents,currency,interval,interval_count,status,price_id) VALUES(?,?,?,?,?,?,?,?,?)');
  ins.run('sub_1', 10, 'founder', 2000, 'usd', 'month', 1, 'active', 'price_gmonth');
  ins.run('sub_2', 11, 'founder', 2000, 'usd', 'month', 1, 'past_due', 'price_gmonth');
  ins.run('sub_3', 12, 'founder', 2000, 'usd', 'month', 1, 'active', null);
  ins.run('sub_4', 13, 'founder', 2000, 'usd', 'month', 1, 'canceled', 'price_gmonth');
  ins.run('sub_5', 14, 'investor', 151980, 'usd', 'year', 1, 'active', 'price_pyear');
  const r = await call(f, 'GET', '/api/admin/catalog/members', OWNER);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.by_price, [
    { price_id: 'price_gmonth', product_id: 'prod_growth', active: 1, other: 1 },
    { price_id: 'price_pyear', product_id: null, active: 1, other: 0 }]);
  assert.deepEqual(r.body.by_plan, [
    { family: 'founder', interval: 'month', interval_count: 1, active: 2, other: 1, without_price: 1 },
    { family: 'investor', interval: 'year', interval_count: 1, active: 1, other: 0, without_price: 0 }]);
  assert.equal(r.body.without_price_total, 1);
  assert.equal((await call(f, 'GET', '/api/admin/catalog/members', ADMIN)).status, 403, 'a plain admin is refused');
  f.db.exec('DROP TABLE member_subscription_amounts');
  const down = await call(f, 'GET', '/api/admin/catalog/members', OWNER);
  assert.equal(down.status, 502);
  assert.equal(down.body.message, 'The members per plan could not be read. That is not a claim that there are none.');
});

test('the subscription webhook stores the price id, and an update that carries none keeps it', async () => {
  const f = world();
  // An advisor plan names its member in its own metadata, so no customer lookup is needed.
  const sub = (priceId?: string) => ({ id: 'sub_9', metadata: { plan_group: 'advisor', user_id: String(FOUNDER) }, status: 'active', items: { data: [{ quantity: 1, price: { ...(priceId ? { id: priceId } : {}), unit_amount: 2000, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } }] } });
  assert.equal(await recordSubscriptionAmount(f.env, sub('price_gmonth'), { isPlan: true, isTier: false, isInvestor: false }), 'recorded');
  const row = () => f.db.prepare("SELECT price_id FROM member_subscription_amounts WHERE subscription_id = 'sub_9'").get() as any;
  assert.equal(row().price_id, 'price_gmonth');
  await recordSubscriptionAmount(f.env, sub(), { isPlan: true, isTier: false, isInvestor: false });
  assert.equal(row().price_id, 'price_gmonth', 'an update without a price id keeps the one recorded');
  await recordSubscriptionAmount(f.env, sub('price_gyear'), { isPlan: true, isTier: false, isInvestor: false });
  assert.equal(row().price_id, 'price_gyear');
});

const CHANGE = { unit_amount: 2500, reason: 'Raise the monthly price for 2027.', idempotency_key: 'chg-0001-abcd' };

test('change a price: the new one keeps the old one\'s currency and interval, the old is archived, and the reason is audited', async () => {
  const f = world(); const store = STRIPE(); await seed(f, store); const s = stripeStub(store);
  try {
    const r = await call(f, 'POST', '/api/admin/catalog/prices/price_gmonth/change', OWNER, CHANGE);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.old_price_id, 'price_gmonth');
    const create = s.calls.find((c) => c.method === 'POST' && c.path === '/v1/prices')!;
    assert.deepEqual([create.form.get('product'), create.form.get('currency'), create.form.get('unit_amount'), create.form.get('recurring[interval]'), create.form.get('nickname')],
      ['prod_growth', 'usd', '2500', 'month', 'Monthly']);
    assert.equal(create.idem, 'price-change-chg-0001-abcd', 'a retried press makes one price');
    assert.equal(store.prices.find((x) => x.id === 'price_gmonth')!.active, false, 'the old price is archived');
    assert.equal(store.prices.find((x) => x.id === r.body.price.id)!.active, true);
    const createdAt = s.calls.findIndex((c) => c.path === '/v1/prices' && c.method === 'POST');
    const archivedAt = s.calls.findIndex((c) => c.path === '/v1/prices/price_gmonth');
    assert.ok(createdAt >= 0 && createdAt < archivedAt, 'the new price exists before the old one is archived');
    const audit = f.db.prepare("SELECT filters_json FROM admin_audit_log WHERE action = 'catalog_price_change'").get() as any;
    assert.deepEqual(JSON.parse(audit.filters_json), { product_id: 'prod_growth', old_price_id: 'price_gmonth', currency: 'usd', interval: 'month', interval_count: 1,
      old_unit_amount: 2000, new_unit_amount: 2500, reason: CHANGE.reason, new_price_id: r.body.price.id });
  } finally { s.restore(); }
});

test('change a price: a failed archive archives the new price again; when that fails too, it says both are live', async () => {
  {
    const f = world(); const store = STRIPE(); await seed(f, store); const s = stripeStub(store, { archive: ['price_gmonth'] });
    try {
      const r = await call(f, 'POST', '/api/admin/catalog/prices/price_gmonth/change', OWNER, CHANGE);
      assert.equal(r.status, 502);
      assert.equal(r.body.message, 'The old price could not be archived, so the new one was archived again. The old price is still the live one; try again in a moment.');
      assert.deepEqual(store.prices.filter((x) => x.active && x.product === 'prod_growth').map((x) => x.id), ['price_gmonth'], 'only the old price is live');
      assert.ok(f.db.prepare("SELECT 1 FROM admin_audit_log WHERE action = 'catalog_price_change_rolled_back'").get());
    } finally { s.restore(); }
  }
  {
    const f = world(); const store = STRIPE(); await seed(f, store); const s = stripeStub(store, { archive: ['price_gmonth', 'price_new1'] });
    try {
      const r = await call(f, 'POST', '/api/admin/catalog/prices/price_gmonth/change', OWNER, CHANGE);
      assert.equal(r.status, 502);
      assert.equal(r.body.error, 'price_change_incomplete');
      assert.match(r.body.message, /^Both prices are live: the new one \(price_new1\) was created, and neither the old one \(price_gmonth\) nor the new one could be archived\./);
      assert.ok(f.db.prepare("SELECT 1 FROM admin_audit_log WHERE action = 'catalog_price_change_incomplete'").get());
    } finally { s.restore(); }
  }
  {
    const f = world(); const store = STRIPE(); await seed(f, store); const s = stripeStub(store, { create: true });
    try {
      const r = await call(f, 'POST', '/api/admin/catalog/prices/price_gmonth/change', OWNER, CHANGE);
      assert.deepEqual([r.status, r.body.message], [502, 'The new price could not be created in Stripe. Nothing changed; try again in a moment.']);
      assert.ok(!s.calls.some((c) => c.path === '/v1/prices/price_gmonth'), 'nothing is archived when nothing was created');
    } finally { s.restore(); }
  }
});

test('change a price: every guard refuses with its reason', async () => {
  const f = world(); const store = STRIPE(); await seed(f, store);
  const s = stripeStub(store);
  try {
    const go = (user: number, body: unknown = CHANGE, path = '/api/admin/catalog/prices/price_gmonth/change', o = {}) => call(f, 'POST', path, user, body, o);
    assert.equal((await go(ADMIN)).status, 403, 'a plain admin');
    assert.equal((await go(FOUNDER)).status, 403, 'a member');
    const noStep = await go(OWNER, CHANGE, undefined, { stepUp: false });
    assert.equal(noStep.status, AUTH_ERROR_STATUSES.step_up_required, 'a Super Admin without a recent step-up');
    assert.deepEqual([(await go(OWNER, { ...CHANGE, reason: 'too short' })).body.error], ['reason_required']);
    assert.deepEqual([(await go(OWNER, { ...CHANGE, idempotency_key: 'x' })).body.error], ['idempotency_key_invalid']);
    assert.deepEqual([(await go(OWNER, { ...CHANGE, unit_amount: 0 })).body.error], ['unit_amount_invalid']);
    assert.deepEqual([(await go(OWNER, { ...CHANGE, unit_amount: 12.5 })).body.error], ['unit_amount_invalid']);
    assert.deepEqual([(await go(OWNER, { ...CHANGE, unit_amount: 2000 })).status, (await go(OWNER, { ...CHANGE, unit_amount: 2000 })).body.error], [409, 'price_unchanged']);
    assert.deepEqual([(await go(OWNER, CHANGE, '/api/admin/catalog/prices/price_nope/change')).body.error], ['price_not_found']);
    const archived = await go(OWNER, CHANGE, '/api/admin/catalog/prices/price_gold/change');
    assert.deepEqual([archived.status, archived.body.error], [409, 'price_archived'], 'an archived price is not changed');
    f.db.prepare("INSERT INTO ai_token_packs(uid,price_id,product_id,face_cents,origin) VALUES('p1','price_rayear','prod_ra',2500,'adopted')").run();
    assert.deepEqual([(await go(OWNER, CHANGE, '/api/admin/catalog/prices/price_rayear/change')).status], [409], 'a token pack is managed on HQ');
    assert.ok(!s.calls.some((c) => c.method === 'POST'), 'no refused change reached Stripe');
  } finally { s.restore(); }
  const bare = world({ secret: null }); await seed(bare);
  assert.equal((await call(bare, 'POST', '/api/admin/catalog/prices/price_gmonth/change', OWNER, CHANGE)).status, 503);
});
