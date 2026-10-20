/**
 * D816 (#2262) — every paid plan sells monthly or yearly.
 *
 *  - The founder and investor checkouts take `interval: 'month' | 'year'` and
 *    choose the catalogue's price for it; absent is monthly (the investor plan
 *    key's own interval); a value that is neither is refused.
 *  - With no price at the interval, `catalog_price_missing` names it.
 *  - The status reads return the held plan's interval from the charge the
 *    webhook recorded (migration 505).
 *  - `GET /api/public/plans-and-packs` gives each plan its monthly and yearly
 *    price and computes the yearly saving: 15% from a $20 / $204 pair. An
 *    inactive price is left out, and no internal field leaks.
 *
 * Real SQLite (the D640 budget fixture and the catalogue mirror), Stripe
 * stubbed: no call leaves the process.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/plan_intervals_d816.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { ensureCatalogSchema } from '../src/services/catalog.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import billing, { checkoutInterval } from '../src/routes/billing.ts';
import publicRoutes from '../src/routes/public.ts';
import { intervalPrices } from '../src/services/aiCredits.ts';

const JWT_SECRET = 'd816-intervals-fixture-only-secret-0123456789';
const FOUNDER = 2; const INVESTOR = 3; const ADVISOR = 4;

type Price = { id: string; active: boolean; unit_amount: number; interval: 'month' | 'year'; currency?: string };
const PRODUCTS: Array<{ id: string; name: string; metadata: Record<string, string>; prices: Price[] }> = [
  { id: 'prod_growth', name: 'Validate + Build', metadata: { tier: 'growth' }, prices: [
    { id: 'price_growth_m', active: true, unit_amount: 4900, interval: 'month' },
    { id: 'price_growth_y', active: true, unit_amount: 49980, interval: 'year' }] },
  // Raise + Grow has no yearly price yet: its yearly checkout answers catalog_price_missing.
  { id: 'prod_studio', name: 'Raise + Grow', metadata: { tier: 'studio' }, prices: [
    { id: 'price_studio_m', active: true, unit_amount: 19900, interval: 'month' }] },
  { id: 'prod_pro', name: 'Investor Plus', metadata: { investor_tier: 'professional' }, prices: [
    { id: 'price_pro_m', active: true, unit_amount: 14900, interval: 'month' },
    { id: 'price_pro_y', active: true, unit_amount: 151980, interval: 'year' }] },
  { id: 'prod_advisor', name: 'Advisor Pro', metadata: { plan_group: 'advisor' }, prices: [
    { id: 'price_adv_m', active: true, unit_amount: 2000, interval: 'month' },
    { id: 'price_adv_y', active: true, unit_amount: 20400, interval: 'year' },
    { id: 'price_adv_y_old', active: false, unit_amount: 19000, interval: 'year' }] },
];

function world() {
  const f = aiBudgetFixture();
  const env = { DB: f.DB, JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://app.example.test',
    STRIPE_SECRET_KEY: 'sk' + '_test_fixtureOnly000' } as any;
  return { ...f, env };
}

async function seed(f: any) {
  await ensureCatalogSchema(f.env);
  for (const p of PRODUCTS) {
    f.db.prepare('INSERT INTO stripe_products(id,name,kind,active,metadata_json,prices_json) VALUES(?,?,?,?,?,?)').run(
      p.id, p.name, 'subscription', 1, JSON.stringify(p.metadata),
      JSON.stringify(p.prices.map((x) => ({ id: x.id, currency: x.currency ?? 'usd', unit_amount: x.unit_amount, interval: x.interval, interval_count: 1, nickname: null, type: 'recurring', active: x.active }))));
  }
  // The fixture seeds 2 (founder) and 3 (investor); 4 becomes an advisor. No charge is recorded until a test records one.
  f.db.exec('DELETE FROM member_subscription_amounts');
  f.db.prepare("UPDATE users SET role = 'advisor' WHERE id = ?").run(ADVISOR);
  f.db.exec(`CREATE TABLE IF NOT EXISTS user_sessions (jti TEXT PRIMARY KEY, user_id INTEGER, factor TEXT, created_at TEXT DEFAULT (datetime('now')),
    last_step_up_at TEXT, revoked_at TEXT, expires_at TEXT, last_seen_at TEXT, ip TEXT, user_agent TEXT)`);
}

/** Stripe, stubbed: records each checkout session's form and answers a session url. */
function stripeStub() {
  const before = globalThis.fetch;
  const sessions: URLSearchParams[] = [];
  globalThis.fetch = (async (input: any, init: any) => {
    const path = new URL(String(input)).pathname;
    if ((init?.method ?? 'GET') === 'POST' && path === '/v1/checkout/sessions') {
      const form = new URLSearchParams(String(init?.body ?? ''));
      sessions.push(form);
      return new Response(JSON.stringify({ id: `cs_${sessions.length}`, url: `https://checkout.example.test/${sessions.length}` }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`no Stripe stub answers ${init?.method ?? 'GET'} ${input}`);
  }) as any;
  return { sessions, restore: () => { globalThis.fetch = before; } };
}

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: String(e?.message) }, 500);
  });
  a.route('/api/billing', billing);
  a.route('/api/public', publicRoutes);
  return a;
}

async function call(f: any, method: string, path: string, user: number | null, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (user !== null) {
    // A TOTP-minted session with a step-up a minute ago: the investor checkout's bar (BLOCK-AUTH-03).
    const jti = `jti-${user}-${Math.random().toString(36).slice(2)}`;
    f.db.prepare("INSERT INTO user_sessions(jti,user_id,factor,created_at,last_step_up_at) VALUES(?,?, 'totp', datetime('now'), datetime('now'))").run(jti, user);
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: user, jti }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const r = await app().request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, f.env);
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, body: json, headers: r.headers, text };
}
const priceOf = (form: URLSearchParams) => form.get('line_items[0][price]');

test('D816: the interval a checkout may name — absent is monthly; anything but month or year is refused', () => {
  assert.equal(checkoutInterval(undefined), 'month');
  assert.equal(checkoutInterval(null), 'month');
  assert.equal(checkoutInterval('month'), 'month');
  assert.equal(checkoutInterval('year'), 'year');
  for (const bad of ['yearly', 'annual', 'week', '', 12, true]) assert.equal(checkoutInterval(bad), null, String(bad));
});

test('D816: the founder checkout sells the yearly price at year, the monthly by default, and refuses another interval', async () => {
  // Mutation checked: drop the interval from the price lookup → year buys the monthly price.
  const f = world(); await seed(f); const s = stripeStub();
  try {
    const year = await call(f, 'POST', '/api/billing/tier/checkout', FOUNDER, { tier: 'growth', interval: 'year' });
    assert.equal(year.status, 200, year.text);
    const plain = await call(f, 'POST', '/api/billing/tier/checkout', FOUNDER, { tier: 'growth' });
    assert.equal(plain.status, 200, plain.text);
    const month = await call(f, 'POST', '/api/billing/tier/checkout', FOUNDER, { tier: 'growth', interval: 'month' });
    assert.equal(month.status, 200, month.text);
    assert.deepEqual(s.sessions.map(priceOf), ['price_growth_y', 'price_growth_m', 'price_growth_m'], 'yearly at year; monthly by default and at month');
    assert.equal(s.sessions[0].get('metadata[interval]'), 'year');
    const bad = await call(f, 'POST', '/api/billing/tier/checkout', FOUNDER, { tier: 'growth', interval: 'annual' });
    assert.deepEqual([bad.status, bad.body.error], [400, 'invalid_interval']);
    assert.equal(s.sessions.length, 3, 'a refused interval starts no checkout');
  } finally { s.restore(); f.db.close(); }
});

test('D816: with no yearly price, catalog_price_missing names the interval and nothing is started', async () => {
  // Mutation checked: drop `interval` from the refusal → the page cannot say "Yearly not offered yet".
  const f = world(); await seed(f); const s = stripeStub();
  try {
    const r = await call(f, 'POST', '/api/billing/tier/checkout', FOUNDER, { tier: 'studio', interval: 'year' });
    assert.equal(r.status, 502, r.text);
    assert.equal(r.body.error, 'catalog_price_missing');
    assert.equal(r.body.interval, 'year');
    assert.match(r.body.detail, /interval=year/);
    assert.equal(s.sessions.length, 0);
    const inv = await call(f, 'POST', '/api/billing/investor/checkout', INVESTOR, { plan: 'investor_inst_monthly', interval: 'year' });
    assert.deepEqual([inv.status, inv.body.error, inv.body.interval], [502, 'catalog_price_missing', 'year']);
  } finally { s.restore(); f.db.close(); }
});

test('D816: the investor checkout takes an interval over its plan key\'s, and records the plan it sells', async () => {
  // Mutation checked: ignore the body's interval → the yearly request buys the monthly price.
  const f = world(); await seed(f); const s = stripeStub();
  try {
    const year = await call(f, 'POST', '/api/billing/investor/checkout', INVESTOR, { plan: 'investor_pro_monthly', interval: 'year' });
    assert.equal(year.status, 200, year.text);
    const keyed = await call(f, 'POST', '/api/billing/investor/checkout', INVESTOR, { plan: 'investor_pro_yearly' });
    assert.equal(keyed.status, 200, keyed.text);
    const plain = await call(f, 'POST', '/api/billing/investor/checkout', INVESTOR, { plan: 'investor_pro_monthly' });
    assert.equal(plain.status, 200, plain.text);
    assert.deepEqual(s.sessions.map(priceOf), ['price_pro_y', 'price_pro_y', 'price_pro_m']);
    assert.deepEqual(s.sessions.map((x) => x.get('subscription_data[metadata][plan]')), ['investor_pro_yearly', 'investor_pro_yearly', 'investor_pro_monthly'],
      'the plan Stripe records is the one sold, never the key the caller sent');
    const bad = await call(f, 'POST', '/api/billing/investor/checkout', INVESTOR, { plan: 'investor_pro_monthly', interval: 'weekly' });
    assert.deepEqual([bad.status, bad.body.error], [400, 'invalid_interval']);
  } finally { s.restore(); f.db.close(); }
});

test('D816: each status read returns the held plan\'s interval from the recorded charge, and null with none', async () => {
  // Mutation checked: read a canceled row → a canceled yearly plan still reads "yearly".
  const f = world(); await seed(f);
  try {
    const before = await call(f, 'GET', '/api/billing/tier/status', FOUNDER);
    assert.equal(before.status, 200, before.text);
    assert.equal(before.body.interval, null, 'no recorded charge, no interval');
    const rec = f.db.prepare(`INSERT INTO member_subscription_amounts (subscription_id, user_id, plan_family, amount_cents, currency, interval, interval_count, status)
      VALUES (?, ?, ?, ?, 'usd', ?, 1, ?)`);
    rec.run('sub_f_old', FOUNDER, 'founder', 4900, 'month', 'canceled');
    rec.run('sub_f', FOUNDER, 'founder', 49980, 'year', 'active');
    rec.run('sub_i', INVESTOR, 'investor', 14900, 'month', 'active');
    rec.run('sub_a', ADVISOR, 'advisor', 20400, 'year', 'active');
    rec.run('sub_a_gone', FOUNDER, 'advisor', 20400, 'year', 'canceled');
    assert.equal((await call(f, 'GET', '/api/billing/tier/status', FOUNDER)).body.interval, 'year');
    assert.equal((await call(f, 'GET', '/api/billing/investor/status', INVESTOR)).body.interval, 'month');
    const persona = await call(f, 'GET', '/api/billing/plan/status', ADVISOR);
    assert.equal(persona.status, 200, persona.text);
    assert.equal(persona.body.interval, 'year');
    f.db.prepare("UPDATE member_subscription_amounts SET status = 'canceled' WHERE subscription_id = 'sub_f'").run();
    assert.equal((await call(f, 'GET', '/api/billing/tier/status', FOUNDER)).body.interval, null, 'a canceled plan has no interval');
  } finally { f.db.close(); }
});

test('D816: the saving is computed from the two prices — 15% from $20 / $204 — and null without both', () => {
  // Mutation checked: hard-code 15 → the $10 / $96 pair reads 15 instead of 20, and the $10 / $120 pair 15 instead of null.
  const p = (unit_amount: number, interval: string, extra: Record<string, unknown> = {}) =>
    ({ unit_amount, currency: 'usd', interval, interval_count: 1, allowance_microusd: 0, ...extra });
  assert.equal(intervalPrices([p(2000, 'month'), p(20400, 'year')]).yearly_saving_percent, 15);
  assert.equal(intervalPrices([p(4900, 'month'), p(49980, 'year')]).yearly_saving_percent, 15);
  assert.equal(intervalPrices([p(1000, 'month'), p(10200, 'year')]).yearly_saving_percent, 15);
  assert.equal(intervalPrices([p(1000, 'month'), p(9600, 'year')]).yearly_saving_percent, 20);
  assert.equal(intervalPrices([p(1000, 'month'), p(12000, 'year')]).yearly_saving_percent, null, 'no saving, no badge');
  assert.equal(intervalPrices([p(1000, 'month')]).yearly_saving_percent, null);
  assert.equal(intervalPrices([p(1000, 'month'), p(9600, 'year', { currency: 'eur' })]).yearly, null, 'a yearly price in another currency is not this plan\'s yearly');
  assert.equal(intervalPrices([p(1000, 'month'), p(9600, 'year', { interval_count: 2 })]).yearly, null, 'every two years is not yearly');
});

test('D816: the public plans read gives each plan its two prices and saving, omits inactive prices, leaks nothing, and caches five minutes', async () => {
  // Mutation checked: keep an inactive price → Advisor Pro's yearly reads $190; drop the s-maxage → the edge does not cache it.
  const f = world(); await seed(f); const s = stripeStub();
  try {
    const r = await call(f, 'GET', '/api/public/plans-and-packs', null);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.headers.get('cache-control'), 'public, max-age=300, s-maxage=300');
    const by = Object.fromEntries(r.body.plans.filter((p: any) => !p.free).map((p: any) => [p.plan_name, p]));
    assert.deepEqual(by['Advisor Pro'].monthly, { unit_amount: 2000, currency: 'usd', allowance_microusd: 5_000_000 });
    assert.deepEqual(by['Advisor Pro'].yearly, { unit_amount: 20400, currency: 'usd', allowance_microusd: 4_250_000 }, '25% of $204 ÷ 12');
    assert.equal(by['Advisor Pro'].yearly_saving_percent, 15);
    assert.ok(!by['Advisor Pro'].prices.some((p: any) => p.unit_amount === 19000), 'an inactive price is never shown');
    assert.deepEqual([by['Raise + Grow'].yearly, by['Raise + Grow'].yearly_saving_percent], [null, null], 'no yearly price: the page says "Yearly not offered yet"');
    assert.equal(by['Validate + Build'].yearly_saving_percent, 15);
    const free = r.body.plans.find((p: any) => p.free);
    assert.deepEqual([free.monthly, free.yearly, free.yearly_saving_percent], [null, null, null]);
    const keys = new Set<string>();
    const walk = (v: any) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (!Array.isArray(v)) keys.add(k); walk(x); } };
    walk(r.body.plans);
    for (const k of ['metadata', 'metadata_json', 'prices_json', 'nickname', 'livemode', 'user_id', 'recorded_by', 'email', 'tier', 'investor_tier', 'plan_group'])
      assert.ok(!keys.has(k), `no ${k}`);
    assert.deepEqual([...keys].filter((k) => k.endsWith('_id')).sort(), ['price_id', 'product_id'], 'only the ids the catalogue page builds its cart from');
    assert.equal(s.sessions.length, 0, 'a public read never reaches Stripe');
  } finally { s.restore(); f.db.close(); }
});
