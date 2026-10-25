/**
 * D1049 (#2900) — `GET /api/billing/plan/status`, which the pricing page now
 * reads to mark a paying Advisor or Operating Partner on Pro.
 *
 * A member who pays reads their status; one who never subscribed reads
 * `free`; and a store that cannot be read is a 503 `unreadable`, never `free`,
 * so the page marks no plan rather than marking a paying member on Basic.
 * Harness from `plan_intervals_d816.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { ensureCatalogSchema } from '../src/services/catalog.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import billing from '../src/routes/billing.ts';
import publicRoutes from '../src/routes/public.ts';
import { readAccountSubscription } from '../src/services/accountPlans.ts';

const JWT_SECRET = 'd1049-plan-status-fixture-only-secret-0123456789';
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

const sub = (f: any, user: number, group: string, status: string) =>
  f.db.prepare(`INSERT INTO account_subscriptions (user_id, plan_group, plan, status, subscription_id, period_end)
    VALUES (?, ?, ?, ?, ?, '2026-11-25T00:00:00.000Z')`).run(user, group, `${group}_pro`, status, `sub_${user}`);

test('D1049: a paying Advisor reads their plan and its status; one who never subscribed reads free', async () => {
  const f = world();
  const stripe = stripeStub();
  try {
    await seed(f);
    const before = await call(f, 'GET', '/api/billing/plan/status', ADVISOR);
    assert.equal(before.status, 200, before.text);
    assert.deepEqual([before.body.plan_group, before.body.status, before.body.plan], ['advisor', 'free', null]);
    sub(f, ADVISOR, 'advisor', 'active');
    const paying = await call(f, 'GET', '/api/billing/plan/status', ADVISOR);
    assert.equal(paying.status, 200, paying.text);
    assert.deepEqual([paying.body.plan_group, paying.body.status, paying.body.plan, paying.body.renews_at],
      ['advisor', 'active', 'advisor_pro', '2026-11-25T00:00:00.000Z']);
  } finally { stripe.restore(); f.db.close(); }
});

test('D1049: a plan store that cannot be read is a 503 "unreadable", never free', async () => {
  const f = world();
  const stripe = stripeStub();
  try {
    await seed(f);
    assert.equal((await call(f, 'GET', '/api/billing/plan/status', ADVISOR)).body.status, 'free', 'the route makes the table');
    sub(f, ADVISOR, 'advisor', 'active');
    assert.equal((await call(f, 'GET', '/api/billing/plan/status', ADVISOR)).body.status, 'active');
    f.db.exec('DROP TABLE account_subscriptions');
    const r = await call(f, 'GET', '/api/billing/plan/status', ADVISOR);
    assert.equal(r.status, 503, r.text);
    assert.equal(r.body.error, 'unreadable');
    assert.equal(r.body.status, undefined, 'no status is guessed');
    await assert.rejects(readAccountSubscription(f.env, ADVISOR), 'the read throws rather than answering null');
  } finally { stripe.restore(); f.db.close(); }
});
