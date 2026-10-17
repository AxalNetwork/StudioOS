/**
 * D707 (#1772) — each Axal entity's role, the rails map, and the guard that
 * keeps fund and intercompany money off Stripe.
 *
 *   · `MONEY_KINDS` and `ENTITY_ROLES` are the owner's words (decisions 1-2),
 *     and the prose repeats the LLC sentences word for word.
 *   · `stripeCall` refuses a create with no kind, an unknown kind, or a kind
 *     that is not on Stripe, before any request leaves the Worker, and stamps
 *     an accepted one.
 *   · `POST /api/payments/intent` refuses a body with no `price_id` before it
 *     can create a Stripe customer; a priced one-time purchase still works.
 *   · `GET /api/admin/money-rails` is admin only and carries no key.
 *
 * Synthetic `sk_test_` keys only; every outbound call is counted.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/money_rails_d707.test.ts
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import {
  ENTITY_ROLES, MONEY_KINDS, STRIPE_MONEY_KINDS, MONEY_KIND_FOR_STRIPE_METADATA,
  moneyKindForCatalogPrice, railFor, assertStripeMoneyKind, MoneyRailError,
} from '../src/services/moneyRails.ts';
import { stripeCall, STRIPE_CREATE_PATHS } from '../src/routes/billing.ts';
import payments from '../src/routes/payments.ts';
import adminMoneyRails from '../src/routes/admin_money_rails.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
// The repository's low-entropy synthetic key (as secret_consoles_d223 uses), so gitleaks reads it as no secret.
const KEY = 'sk_test_sentinel';
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const HOLDINGS = 'Axal VC Holdings LLC licenses the software IP platform to Axal VC Management LLC for management administration, and to Axal VC GP LLC for fund administration.';
const MANAGEMENT = 'Axal VC Management LLC operates between the different partners as Managing Partner under the Spin-Out Lab, and manages the other operating partners across the platform.';
const GP = "Axal VC GP LLC is the General Partner that manages the Fund's investors, and the founders getting funding through Axal VC Spin-Out Lab Fund I LP.";
const FUND = 'Limited partnership pooling LP capital. Managed exclusively by Axal VC GP LLC as general partner.';

// ── Every outbound call, counted ──────────────────────────────────────────

let calls: Array<{ url: string; method: string; body: string }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url);
  calls.push({ url, method: String(init?.method || 'GET').toUpperCase(), body: String(init?.body ?? '') });
  if (url.startsWith('https://api.stripe.com/v1/payment_intents')) {
    return new Response(JSON.stringify({ id: 'pi_test_1', client_secret: 'pi_test_1_secret_x', status: 'requires_payment_method' }), { status: 200 });
  }
  if (url.startsWith('https://api.stripe.com/v1/')) return new Response(JSON.stringify({ id: 'obj_test_1', data: [] }), { status: 200 });
  return new Response('unexpected call in test', { status: 599 });
}) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });
beforeEach(() => { calls = []; });
const sent = (i = 0) => new URLSearchParams(calls[i]?.body ?? '');

// ── 1. The map and the roles ──────────────────────────────────────────────

test('MONEY_KINDS is exactly decision 2\'s eleven rows, and every Stripe kind pays Management', () => {
  assert.deepEqual(MONEY_KINDS.map((r) => [r.kind, r.payer, r.payee, r.rail, r.group]), [
    ['platform_plan', 'customer', 'management', 'stripe', 'platform'],
    ['investor_tier', 'customer', 'management', 'stripe', 'platform'],
    ['partner_service', 'customer', 'management', 'stripe', 'platform'],
    ['marketplace', 'customer', 'management', 'stripe', 'platform'],
    ['capital_contribution', 'lp', 'fund', 'mercury', 'fund'],
    ['distribution', 'fund', 'lp', 'mercury', 'fund'],
    ['fund_expense', 'fund', 'vendor', 'mercury', 'fund'],
    ['management_fee', 'fund', 'gp', 'mercury', 'fund'],
    ['gp_commitment', 'gp', 'fund', 'mercury', 'fund'],
    ['licence_fee_management_admin', 'management', 'holdings', 'mercury', 'intercompany'],
    ['licence_fee_fund_admin', 'gp', 'holdings', 'mercury', 'intercompany'],
  ]);
  assert.deepEqual([...STRIPE_MONEY_KINDS], ['platform_plan', 'investor_tier', 'partner_service', 'marketplace']);
  for (const row of MONEY_KINDS) {
    if (row.rail === 'stripe') assert.equal(row.payee, 'management', row.kind);
    else assert.notEqual(row.group, 'platform', row.kind);
  }
  assert.equal(railFor('management_fee'), 'mercury');
  assert.equal(railFor('marketplace'), 'stripe');
  assert.equal(railFor('nonsense'), null);
  assert.deepEqual(MONEY_KIND_FOR_STRIPE_METADATA, {
    mi: 'platform_plan', tier: 'platform_plan', plan: 'platform_plan', investor: 'investor_tier',
    advisor_session: 'partner_service', alacarte: 'marketplace', intro_credits: 'marketplace', cart_order: 'marketplace',
    incorporation: 'marketplace', event_ticket: 'marketplace', expert_booking: 'marketplace',
  });
});

test('ENTITY_ROLES are the owner\'s four texts, and the prose repeats each LLC sentence word for word', () => {
  assert.deepEqual({ ...ENTITY_ROLES }, { holdings: HOLDINGS, management: MANAGEMENT, gp: GP, fund: FUND });
  const gvpn = read('frontend/src/brand/gvpn.ts');
  const md = read('documentation/architecture/LEGAL_ENTITIES.md');
  for (const sentence of [HOLDINGS, MANAGEMENT, GP]) {
    assert.ok(gvpn.includes(sentence), `gvpn.ts: ${sentence.slice(0, 40)}`);
    assert.ok(md.includes(sentence), `LEGAL_ENTITIES.md: ${sentence.slice(0, 40)}`);
  }
  assert.ok(gvpn.includes(FUND), 'the Fund\'s role stays');
  assert.doesNotMatch(gvpn, /Licenses IP to Axal VC Management LLC\./, 'the one-licence sentence is gone');
});

test('moneyKindForCatalogPrice: investor tiers, plans and one-time purchases', () => {
  assert.equal(moneyKindForCatalogPrice({ metadata: { investor_tier: 'professional' } }, { type: 'recurring' }), 'investor_tier');
  assert.equal(moneyKindForCatalogPrice({ metadata: { investor_tier: 'institutional' } }, { type: 'recurring' }), 'investor_tier');
  assert.equal(moneyKindForCatalogPrice({ metadata: { tier: 'growth' } }, { type: 'recurring' }), 'platform_plan');
  assert.equal(moneyKindForCatalogPrice({ metadata: { investor_tier: 'professional' } }, { type: 'one_time' }), 'marketplace');
  assert.equal(moneyKindForCatalogPrice({ metadata: {} }, { type: 'one_time' }), 'marketplace');
});

// ── 2. The guard in stripeCall ────────────────────────────────────────────

const env = { STRIPE_SECRET_KEY: KEY } as any;
async function refused(path: string, moneyKind: any): Promise<string> {
  try {
    await stripeCall(env, path, { amount: '5000' }, moneyKind === undefined ? undefined : { moneyKind });
  } catch (e) {
    assert.ok(e instanceof MoneyRailError, `${path}: ${String(e)}`);
    return (e as MoneyRailError).code;
  }
  return 'sent';
}

test('stripeCall refuses a create with no kind, an unknown kind, or fund or intercompany money, and nothing leaves the Worker', async () => {
  assert.deepEqual([...STRIPE_CREATE_PATHS], ['/checkout/sessions', '/subscriptions', '/subscription_items', '/subscription_schedules',
    '/invoices', '/invoiceitems', '/quotes', '/payment_intents', '/payment_links', '/charges']);
  for (const path of STRIPE_CREATE_PATHS) {
    assert.equal(await refused(path, undefined), 'money_kind_required', path);
    for (const kind of ['management_fee', 'capital_contribution', 'licence_fee_fund_admin']) {
      assert.equal(await refused(path, kind), 'money_kind_not_on_stripe', `${path} ${kind}`);
    }
    assert.equal(await refused(path, 'gift'), 'money_kind_unknown', path);
  }
  for (const path of ['/payment_intents?x=1', '/payment_intents/', '/checkout/sessions/?a=b']) {
    assert.equal(await refused(path, undefined), 'money_kind_required', path);
    assert.equal(await refused(path, 'management_fee'), 'money_kind_not_on_stripe', path);
  }
  assert.equal(calls.length, 0, 'no refused call reached Stripe');
  // A fund kind on any other call is refused too.
  assert.equal(await refused('/subscriptions/sub_x', 'distribution'), 'money_kind_not_on_stripe');
  assert.equal(calls.length, 0);
  assert.throws(() => assertStripeMoneyKind(''), (e: any) => e.code === 'money_kind_required');
});

test('stripeCall stamps an accepted kind, beside a propagated subscription kind; lists and plain updates pass', async () => {
  await stripeCall(env, '/checkout/sessions', { mode: 'subscription', 'subscription_data[metadata][kind]': 'tier' }, { moneyKind: 'platform_plan' });
  assert.equal(calls.length, 1);
  assert.equal(sent().get('metadata[money_kind]'), 'platform_plan');
  assert.equal(sent().get('subscription_data[metadata][money_kind]'), 'platform_plan');
  assert.equal(sent().get('subscription_data[metadata][kind]'), 'tier');
  calls = [];
  await stripeCall(env, '/payment_intents', { amount: '5000' }, { moneyKind: 'marketplace' });
  assert.equal(sent().get('metadata[money_kind]'), 'marketplace');
  assert.equal(sent().get('subscription_data[metadata][money_kind]'), null, 'no subscription metadata, none added');
  calls = [];
  await stripeCall(env, '/subscriptions', { customer: 'cus_x' }, { method: 'GET' });
  await stripeCall(env, '/subscriptions/sub_x', { cancel_at_period_end: 'true' });
  assert.equal(calls.length, 2, 'a GET list and an update pass without a kind');
  assert.equal(new URLSearchParams(calls[1].body).get('metadata[money_kind]'), null);
});

// ── 3. POST /api/payments/intent ──────────────────────────────────────────

const BUYER = 41, MEMBER = 42, ADMIN = 43;
function database() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const baseline = read('cloudflare-worker/sql/schema_baseline.sql');
  for (const t of ['users', 'user_sessions', 'activity_logs']) db.exec(tableFromBaseline(baseline, t));
  const u = db.prepare('INSERT INTO users (id, role, name, email, uid, is_active) VALUES (?, ?, ?, ?, ?, 1)');
  u.run(BUYER, 'founder', 'Ada Quill', 'ada@example.test', 'uid-41');
  u.run(MEMBER, 'founder', 'Juniper Lane', 'juniper@example.test', 'uid-42');
  u.run(ADMIN, 'admin', 'Orchard Admin', 'orchard@example.test', 'uid-43');
  return db;
}
const token = (id: number, role: string) => new SignJWT({ user_id: id, role }).setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
function appFor(path: string, router: any) {
  const a = new Hono<any>();
  a.route(path, router);
  a.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    return c.json({ detail: String(err?.message || '') }, 500);
  });
  return a;
}
async function hit(app: Hono<any>, db: DatabaseSync, method: string, path: string, who: number | null, role = 'founder', body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who != null) headers.Authorization = `Bearer ${await token(who, role)}`;
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      { JWT_SECRET, ENVIRONMENT: 'development', STRIPE_SECRET_KEY: KEY, DB: d1Over(db) } as any);
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text };
  } finally { [console.warn, console.error] = saved; }
}

test('POST /api/payments/intent refuses a raw amount before any Stripe call; a priced one-time purchase is stamped marketplace', async () => {
  const db = database();
  const app = appFor('/api/payments', payments);
  const raw = await hit(app, db, 'POST', '/api/payments/intent', BUYER, 'founder', { amount: 5000, currency: 'usd' });
  assert.equal(raw.status, 400, raw.text);
  assert.equal(raw.body.error, 'money_kind_required');
  assert.equal(calls.length, 0, 'not even a Stripe customer was created');
  assert.equal((db.prepare('SELECT stripe_customer_id FROM users WHERE id = ?').get(BUYER) as any).stripe_customer_id ?? null, null);

  // A mirrored one-time price.
  db.exec(`CREATE TABLE IF NOT EXISTS stripe_products (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'alacarte',
    active INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}', prices_json TEXT NOT NULL DEFAULT '[]',
    synced_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.prepare('INSERT INTO stripe_products (id, name, kind, metadata_json, prices_json) VALUES (?, ?, ?, ?, ?)').run(
    'prod_test_guide', 'Fundraising guide', 'alacarte', '{}',
    JSON.stringify([{ id: 'price_test_guide', currency: 'usd', unit_amount: 4900, interval: null, interval_count: null, nickname: null, type: 'one_time', active: true }]));
  db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run('cus_test_41', BUYER);
  const priced = await hit(app, db, 'POST', '/api/payments/intent', BUYER, 'founder', { price_id: 'price_test_guide' });
  assert.equal(priced.status, 200, priced.text);
  assert.equal(priced.body.kind, 'payment');
  const pi = calls.filter((c) => c.url.startsWith('https://api.stripe.com/v1/payment_intents'));
  assert.equal(pi.length, 1);
  const params = new URLSearchParams(pi[0].body);
  assert.equal(params.get('metadata[money_kind]'), 'marketplace');
  assert.equal(params.get('amount'), '4900');
  // An unknown price is refused, never charged under a guessed kind.
  calls = [];
  const unknown = await hit(app, db, 'POST', '/api/payments/intent', BUYER, 'founder', { price_id: 'price_test_missing' });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, 'invalid_price');
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
});

// ── 4. GET /api/admin/money-rails ─────────────────────────────────────────

test('GET /api/admin/money-rails: 401 without a token, 403 for a member, the map for an admin, and no key', async () => {
  const db = database();
  const app = appFor('/api/admin/money-rails', adminMoneyRails);
  assert.equal((await hit(app, db, 'GET', '/api/admin/money-rails', null)).status, 401);
  assert.equal((await hit(app, db, 'GET', '/api/admin/money-rails', MEMBER, 'founder')).status, 403);
  const r = await hit(app, db, 'GET', '/api/admin/money-rails', ADMIN, 'admin');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.entities.map((e: any) => [e.key, e.role]), [
    ['holdings', HOLDINGS], ['management', MANAGEMENT], ['gp', GP], ['fund', FUND],
  ]);
  assert.equal(r.body.entities.find((e: any) => e.key === 'fund').name, 'Axal VC Spin-Out Lab Fund I LP');
  assert.equal(r.body.kinds.length, 11);
  assert.deepEqual(r.body.stripe, { account_holder: 'management', mode: 'test' });
  assert.equal(r.text.includes(KEY), false, 'the key is never answered');
  assert.equal(r.text.includes('sk_'), false);
  assert.equal(calls.length, 0);
});
