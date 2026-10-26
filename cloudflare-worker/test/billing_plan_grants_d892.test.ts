/**
 * D892 (#2453) — a plan bought through `POST /api/payments/intent` is granted.
 *
 * Item 1's proof without Stripe: the real intent payload goes through the real
 * webhook handler, with Stripe stubbed, and the plan columns move. On main the
 * intent stamped only `user_id`, `uid` and `price_id`, and the same events
 * granted nothing (the legacy-metadata test below is that case, now fixed by
 * the webhook's catalog fallback).
 *
 * Also: one subscription per plan family (an upgrade is refused and sent to the
 * swap route), the investor customer, and a failed renewal told once per attempt.
 * Access while Stripe retries is D1052's grace, bounded by D1100; its pin is below.
 *
 * §6, after review: unpaid statuses grant nothing, the intent's quantity and
 * investor customer, swaps in their own scope, takeovers, the Stripe check,
 * rows left at `incomplete` and the owner's reconciliation of them.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { userMeetsTier } from '../src/middleware/requireTier.ts';
import { effectiveInvestorTier, INVESTOR_QUOTAS } from '../src/middleware/requireInvestorTier.ts';
import payments from '../src/routes/payments.ts';
import billing from '../src/routes/billing.ts';
import adminBilling from '../src/routes/admin_billing.ts';
import { primaryCover } from '../src/routes/investor_seats.ts';
import { monthlyAllowanceFor } from '../src/services/introductions.ts';
import {
  planMetaForProduct, planMetaParams, subscriptionPriceId, subscriptionMetadata, heldPlanSubscription, recordRenewalFailure,
  isUnpaidStatus, planKindOfSubscription, settleIncompleteRow,
} from '../src/services/planSubscription.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const KEY = 'sk_test_sentinel';
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 51, INVESTOR = 52, PARTNER = 53;

// ── Stripe, stubbed: every call recorded, subscriptions answered ───────────
let calls: Array<{ url: string; method: string; body: string }> = [];
/** What Stripe holds, per customer, for the list read; and one subscription for the swap's read. */
let stripeSubs: Record<string, Array<Record<string, unknown>>> = {};
let stripeSub: Record<string, unknown> | null = null;
let listFails = false;
/** A list read that fails for one customer, with Stripe's status and error code. */
let listFailFor: Record<string, { status: number; code?: string }> = {};
/** One subscription's read by id, ahead of `stripeSub`; and a read that fails, by id. */
let stripeById: Record<string, Record<string, unknown>> = {};
let readFailFor: Record<string, { status: number; code?: string }> = {};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url);
  const method = String(init?.method || 'GET').toUpperCase();
  calls.push({ url, method, body: String(init?.body ?? '') });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const stripeError = (f: { status: number; code?: string }) =>
    json({ error: { message: 'synthetic failure', ...(f.code ? { code: f.code, type: 'invalid_request_error' } : {}) } }, f.status);
  const path = url.startsWith('https://api.stripe.com/') ? new URL(url).pathname : '';
  if (method === 'GET' && path === '/v1/subscriptions') {
    if (listFails) return json({ error: { message: 'down' } }, 500);
    const customer = new URL(url).searchParams.get('customer') || '';
    if (listFailFor[customer]) return stripeError(listFailFor[customer]);
    return json({ data: stripeSubs[customer] ?? [] });
  }
  const one = /^\/v1\/subscriptions\/([^/]+)$/.exec(path);
  if (one && method === 'GET') {
    if (readFailFor[one[1]]) return stripeError(readFailFor[one[1]]);
    const found = stripeById[one[1]] ?? stripeSub;
    return found ? json(found) : stripeError({ status: 404, code: 'resource_missing' });
  }
  // A plan change: Stripe answers the subscription with its new price.
  if (one && method === 'POST') {
    const sent = new URLSearchParams(String(init?.body ?? ''));
    return json({ ...(stripeSub ?? {}), id: one[1], status: 'active', items: { data: [{ id: sent.get('items[0][id]'), price: { id: sent.get('items[0][price]') } }] } });
  }
  if (method === 'GET' && path === '/v1/invoices/upcoming') {
    return json({ currency: 'usd', amount_due: 7000, total: 7000, lines: { data: [{ proration: true, amount: 7000 }] } });
  }
  if (url.startsWith('https://api.stripe.com/v1/subscriptions')) {
    return json({ id: 'sub_new_1', status: 'incomplete', latest_invoice: { id: 'in_1', payment_intent: { id: 'pi_1', client_secret: 'pi_1' + '_secret_' + 'fixture' } } });
  }
  if (url.startsWith('https://api.stripe.com/v1/customers')) return json({ id: 'cus_new_1' });
  if (url.startsWith('https://api.stripe.com/v1/')) return json({ id: 'obj_1', data: [] });
  return new Response('unexpected call in test', { status: 599 });
}) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });
beforeEach(() => { calls = []; stripeSubs = {}; stripeSub = null; listFails = false; listFailFor = {}; stripeById = {}; readFailFor = {}; });
const subCalls = () => calls.filter((c) => c.method === 'POST' && c.url.startsWith('https://api.stripe.com/v1/subscriptions'));
const customersMade = () => calls.filter((c) => c.method === 'POST' && c.url === 'https://api.stripe.com/v1/customers');
const subReads = (id: string) => calls.filter((c) => c.method === 'GET' && new URL(c.url).pathname === `/v1/subscriptions/${id}`);

// ── A database with the users table as production has it, and the catalog ──
const price = (id: string, cents: number, interval: string | null) => ({
  id, unit_amount: cents, currency: 'usd', interval, interval_count: interval ? 1 : null, nickname: null, type: interval ? 'recurring' : 'one_time', active: true,
});
function database() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const baseline = read('cloudflare-worker/sql/schema_baseline.sql');
  for (const t of ['users', 'user_sessions', 'activity_logs', 'account_subscriptions', 'super_admins', 'admin_audit_log']) db.exec(tableFromBaseline(baseline, t));
  db.exec(`CREATE TABLE IF NOT EXISTS mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'free', subscription_id TEXT UNIQUE, plan TEXT, period_end TEXT, stripe_customer_id TEXT, updated_at TEXT);
    CREATE TABLE stripe_products (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'subscription',
      active INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}', prices_json TEXT NOT NULL DEFAULT '[]', synced_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  const product = db.prepare('INSERT INTO stripe_products (id, name, metadata_json, prices_json) VALUES (?, ?, ?, ?)');
  product.run('prod_growth', 'Founder — Growth', JSON.stringify({ tier: 'growth' }), JSON.stringify([price('price_growth_m', 7900, 'month')]));
  product.run('prod_studio', 'Founder — Studio', JSON.stringify({ tier: 'studio' }), JSON.stringify([price('price_studio_m', 24900, 'month')]));
  product.run('prod_pro', 'Investor — Professional', JSON.stringify({ investor_tier: 'professional' }), JSON.stringify([price('price_pro_m', 14900, 'month')]));
  product.run('prod_partner', 'Operating Partner', JSON.stringify({ plan_group: 'partner' }), JSON.stringify([price('price_partner_m', 9900, 'month')]));
  product.run('prod_mi', 'Market Intelligence Pro', JSON.stringify({ plan: 'mi_pro' }), JSON.stringify([price('price_mi_y', 29000, 'year')]));
  product.run('prod_svc', 'A monthly service', JSON.stringify({}), JSON.stringify([price('price_svc_m', 1000, 'month')]));
  const u = db.prepare('INSERT INTO users (id, role, name, email, uid, is_active, stripe_customer_id) VALUES (?, ?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Ada Quill', 'ada@example.test', 'uid-51', 'cus_founder');
  u.run(INVESTOR, 'investor', 'Ira Vale', 'ira@example.test', 'uid-52', 'cus_general_52');
  u.run(PARTNER, 'partner', 'Pat Rowe', 'pat@example.test', 'uid-53', 'cus_partner');
  return db;
}
const env = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'test', STRIPE_SECRET_KEY: KEY, DB: d1Over(db) } as any);
/**
 * The same database behind a D1 binding whose statements throw when `fails`
 * says so, as a transient D1 error does. `fails` is asked once for each
 * statement, when the code prepares it; a batch holding one rolls back whole.
 */
function flakyD1(db: DatabaseSync, fails: (sql: string) => boolean) {
  const base = d1Over(db);
  return {
    ...base,
    prepare(sql: string) {
      if (!fails(sql)) return base.prepare(sql);
      const boom = () => { throw new Error('D1_ERROR: synthetic failure'); };
      const stmt: any = { bind: () => stmt, all: async () => boom(), first: async () => boom(), run: async () => boom(), runSync: boom };
      return stmt;
    },
  };
}
const app = (() => {
  const a = new Hono<any>();
  a.route('/api/payments', payments);
  a.route('/api/billing', billing);
  a.route('/api/admin/billing', adminBilling);
  a.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    return s ? c.json({ detail: err.message }, s) : c.json({ detail: String(err?.message || '') }, 500);
  });
  return a;
})();
const token = (id: number, role: string) => new SignJWT({ user_id: id, role }).setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function hit(db: DatabaseSync, path: string, who: number | null, role: string, body: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who != null) headers.Authorization = `Bearer ${await token(who, role)}`;
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, { method: 'POST', headers, body: JSON.stringify(body) }, env(db));
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text };
  } finally { [console.warn, console.error] = saved; }
}
const intent = (db: DatabaseSync, who: number, role: string, priceId: string) => hit(db, '/api/payments/intent', who, role, { price_id: priceId, nonce: 'n1' });
const hook = (db: DatabaseSync, type: string, object: Record<string, unknown>) => hit(db, '/api/billing/stripe/webhook', null, 'founder', { id: `evt_${Math.random()}`, type, data: { object } });
/** A subscription event built from what the intent actually sent to Stripe. */
function subscriptionFromIntent(i = 0, status = 'active', over: Record<string, unknown> = {}) {
  const sent = new URLSearchParams(subCalls()[i].body);
  const metadata: Record<string, string> = {};
  for (const [k, v] of sent) { const m = /^metadata\[(.+)\]$/.exec(k); if (m) metadata[m[1]] = v; }
  return {
    id: 'sub_new_1', object: 'subscription', status, customer: sent.get('customer'), current_period_end: 1_800_000_000, metadata,
    items: { data: [{ quantity: 1, price: { id: sent.get('items[0][price]'), unit_amount: 7900, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } }] },
    ...over,
  };
}
const userRow = (db: DatabaseSync, id: number) => ({ ...(db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any) });

// ── The mapping ─────────────────────────────────────────────────────────────

test('a plan product maps to the kind the Billing checkouts stamp; anything else is no plan', () => {
  assert.deepEqual(planMetaForProduct({ metadata: { tier: 'growth' } }, { interval: 'month' }), { kind: 'tier', tier: 'growth' });
  assert.deepEqual(planMetaForProduct({ metadata: { investor_tier: 'institutional' } }, { interval: 'year' }), { kind: 'investor', investor_tier: 'institutional' });
  assert.deepEqual(planMetaForProduct({ metadata: { plan_group: ' partner ' } }, { interval: 'month' }), { kind: 'plan', plan_group: 'partner' });
  assert.deepEqual(planMetaForProduct({ metadata: { plan: 'mi_pro' } }, { interval: 'year' }), { kind: 'mi', plan: 'mi_pro_annual' });
  assert.deepEqual(planMetaForProduct({ metadata: { plan: 'mi_pro' } }, { interval: 'month' }), { kind: 'mi', plan: 'mi_pro_monthly' });
  assert.equal(planMetaForProduct({ metadata: { tier: 'platinum' } }, { interval: 'month' }), null, 'an unknown tier is not guessed');
  assert.equal(planMetaForProduct({ metadata: {} }, { interval: 'month' }), null);
  assert.deepEqual(planMetaParams({ kind: 'tier', tier: 'studio' }), { 'metadata[kind]': 'tier', 'metadata[tier]': 'studio' });
  assert.equal(subscriptionPriceId({ metadata: { price_id: 'price_a' } }), 'price_a');
  assert.equal(subscriptionPriceId({ metadata: {}, items: { data: [{ price: { id: 'price_b' } }] } }), 'price_b');
  assert.equal(subscriptionPriceId({}), null);
});

// ── Item 1: charged and granted ─────────────────────────────────────────────

test('item 1 end to end: a plan bought through the payments intent is granted by the webhook', async () => {
  const db = database();
  const r = await intent(db, FOUNDER, 'founder', 'price_growth_m');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.kind, 'subscription');
  const sent = new URLSearchParams(subCalls()[0].body);
  // Mutation-checked: drop planMetaParams from the intent and these two fail.
  assert.equal(sent.get('metadata[kind]'), 'tier');
  assert.equal(sent.get('metadata[tier]'), 'growth');
  assert.equal(sent.get('metadata[user_id]'), String(FOUNDER));
  assert.equal(sent.get('customer'), 'cus_founder');
  assert.equal(userRow(db, FOUNDER).subscription_tier ?? 'free', 'free', 'nothing is granted before payment');
  // Stripe creates it incomplete, then the first invoice is paid and it turns active.
  assert.equal((await hook(db, 'customer.subscription.created', subscriptionFromIntent(0, 'incomplete'))).status, 200);
  assert.equal((await hook(db, 'customer.subscription.updated', subscriptionFromIntent(0, 'active'))).status, 200);
  const u = userRow(db, FOUNDER);
  assert.equal(u.subscription_tier, 'growth');
  assert.equal(u.subscription_status, 'active');
  assert.equal(u.stripe_subscription_id, 'sub_new_1');
});

test('a subscription made before the fix, with no kind, is granted from its price on its next event', async () => {
  const db = database();
  // What main sent: user_id, uid and price_id only.
  const legacy = {
    id: 'sub_legacy_1', object: 'subscription', status: 'active', customer: 'cus_founder', current_period_end: 1_800_000_000,
    metadata: { user_id: String(FOUNDER), uid: 'uid-51', price_id: 'price_studio_m' },
    items: { data: [{ quantity: 1, price: { id: 'price_studio_m', unit_amount: 24900, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } }] },
  };
  assert.equal((await hook(db, 'customer.subscription.updated', legacy)).status, 200);
  assert.equal(userRow(db, FOUNDER).subscription_tier, 'studio');
  assert.equal(userRow(db, FOUNDER).stripe_subscription_id, 'sub_legacy_1');
});

test('the fallback never guesses: a price that is no plan, or an unreadable catalog, leaves the metadata as it came', async () => {
  const db = database();
  const meta = await subscriptionMetadata(env(db), 'customer.subscription.updated', { metadata: { user_id: '51', price_id: 'price_svc_m' } });
  assert.deepEqual(meta, { user_id: '51', price_id: 'price_svc_m' });
  const kept = await subscriptionMetadata(env(db), 'customer.subscription.updated', { metadata: { kind: 'mi', user_id: '51', price_id: 'price_growth_m' } });
  assert.equal(kept.kind, 'mi', 'an event that names its kind keeps it');
  const notSub = await subscriptionMetadata(env(db), 'checkout.session.completed', { metadata: { price_id: 'price_growth_m' } });
  assert.equal(notSub.kind, undefined, 'only subscription events are filled in');
  db.exec('DROP TABLE stripe_products');
  const broken = await subscriptionMetadata({ ...env(db), STRIPE_SECRET_KEY: undefined } as any, 'customer.subscription.updated', { metadata: { price_id: 'price_growth_m' } });
  assert.equal(broken.kind, undefined);
});

test('an investor plan uses the investor customer, and the investor webhook grants it', async () => {
  const db = database();
  const r = await intent(db, INVESTOR, 'investor', 'price_pro_m');
  assert.equal(r.status, 200, r.text);
  const sent = new URLSearchParams(subCalls()[0].body);
  assert.equal(sent.get('metadata[kind]'), 'investor');
  assert.equal(sent.get('metadata[investor_tier]'), 'professional');
  // No investor customer yet: one is made for the investor scope, never the general one (D892 §6).
  assert.equal(sent.get('customer'), 'cus_new_1');
  assert.equal(userRow(db, INVESTOR).investor_stripe_customer_id, 'cus_new_1');
  const made = calls.find((c) => c.method === 'POST' && c.url.endsWith('/v1/customers'));
  assert.equal(new URLSearchParams(made?.body).get('metadata[scope]'), 'investor');
  assert.equal((await hook(db, 'customer.subscription.updated', subscriptionFromIntent(0, 'active'))).status, 200);
  assert.equal(userRow(db, INVESTOR).investor_tier, 'professional');
  assert.equal(userRow(db, INVESTOR).investor_subscription_status, 'active');
  // An investor who already has an investor customer keeps it.
  calls = [];
  db.prepare("UPDATE users SET investor_stripe_customer_id = 'cus_inv_52', investor_tier = 'free', investor_subscription_status = 'free', investor_stripe_subscription_id = NULL WHERE id = ?").run(INVESTOR);
  assert.equal((await intent(db, INVESTOR, 'investor', 'price_pro_m')).status, 200);
  assert.equal(new URLSearchParams(subCalls()[0].body).get('customer'), 'cus_inv_52');
});

test('a persona plan and Market Intelligence Pro are stamped and granted too', async () => {
  const db = database();
  assert.equal((await intent(db, PARTNER, 'partner', 'price_partner_m')).status, 200);
  let sent = new URLSearchParams(subCalls()[0].body);
  assert.equal(sent.get('metadata[kind]'), 'plan');
  assert.equal(sent.get('metadata[plan_group]'), 'partner');
  assert.equal((await hook(db, 'customer.subscription.updated', subscriptionFromIntent(0, 'active'))).status, 200);
  const plan = db.prepare('SELECT plan_group, status, subscription_id FROM account_subscriptions WHERE user_id = ?').get(PARTNER) as any;
  assert.equal(plan?.plan_group, 'partner');
  assert.equal(plan?.status, 'active');
  calls = [];
  assert.equal((await intent(db, FOUNDER, 'founder', 'price_mi_y')).status, 200);
  sent = new URLSearchParams(subCalls()[0].body);
  assert.equal(sent.get('metadata[kind]'), 'mi');
  assert.equal(sent.get('metadata[plan]'), 'mi_pro_annual');
  // A recurring price that is no plan is charged as before, with no plan stamped.
  calls = [];
  assert.equal((await intent(db, FOUNDER, 'founder', 'price_svc_m')).status, 200);
  assert.equal(new URLSearchParams(subCalls()[0].body).get('metadata[kind]'), null);
});

// ── Item 2: no second subscription ──────────────────────────────────────────

test('item 2: a member who already pays for a plan of this kind is refused and sent to the swap route', async () => {
  const db = database();
  db.prepare("UPDATE users SET subscription_tier = 'growth', subscription_status = 'active', stripe_subscription_id = 'sub_old_1' WHERE id = ?").run(FOUNDER);
  const r = await intent(db, FOUNDER, 'founder', 'price_studio_m');
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.error, 'subscription_exists');
  assert.equal(r.body.subscription_id, 'sub_old_1');
  assert.equal(r.body.swap, '/api/billing/subscription/swap/preview');
  assert.equal(subCalls().length, 0, 'no second subscription reached Stripe');
  // A renewal Stripe is retrying still counts as held; a cancelled plan, a free tier or a partner grant does not.
  db.prepare("UPDATE users SET subscription_status = 'past_due' WHERE id = ?").run(FOUNDER);
  assert.equal(await heldPlanSubscription(env(db), FOUNDER, { kind: 'tier', tier: 'studio' }), 'sub_old_1');
  db.prepare("UPDATE users SET subscription_status = 'canceled' WHERE id = ?").run(FOUNDER);
  assert.equal(await heldPlanSubscription(env(db), FOUNDER, { kind: 'tier', tier: 'studio' }), null);
  db.prepare("UPDATE users SET subscription_tier = 'growth', subscription_status = 'partner_grant', stripe_subscription_id = NULL WHERE id = ?").run(FOUNDER);
  assert.equal(await heldPlanSubscription(env(db), FOUNDER, { kind: 'tier', tier: 'studio' }), null);
  // A founder tier does not block an MI Pro plan: another family.
  db.prepare("UPDATE users SET subscription_tier = 'growth', subscription_status = 'active', stripe_subscription_id = 'sub_old_1' WHERE id = ?").run(FOUNDER);
  assert.equal(await heldPlanSubscription(env(db), FOUNDER, { kind: 'mi', plan: 'mi_pro_monthly' }), null);
  db.prepare("INSERT INTO mi_pro_subscriptions (user_id, status, subscription_id) VALUES (?, 'active', 'sub_mi_1')").run(FOUNDER);
  assert.equal(await heldPlanSubscription(env(db), FOUNDER, { kind: 'mi', plan: 'mi_pro_annual' }), 'sub_mi_1');
});

// ── Item 3: a failed renewal is told ────────────────────────────────────────

test('item 3: a failed renewal tells the member once per attempt; a failed first payment and an unknown subscription tell nobody', async () => {
  const db = database();
  db.prepare("UPDATE users SET subscription_tier = 'growth', subscription_status = 'active', stripe_subscription_id = 'sub_old_1' WHERE id = ?").run(FOUNDER);
  const invoice = { id: 'in_renew_1', object: 'invoice', subscription: 'sub_old_1', customer: 'cus_founder', billing_reason: 'subscription_cycle', attempt_count: 1, next_payment_attempt: 1_793_000_000 };
  assert.equal((await hook(db, 'invoice.payment_failed', invoice)).status, 200);
  assert.equal((await hook(db, 'invoice.payment_failed', invoice)).status, 200, 'a redelivery');
  const rows = () => db.prepare("SELECT title, body, link, payload FROM notifications_inbox WHERE user_id = ? AND type = 'billing.renewal_failed'").all(FOUNDER) as any[];
  assert.equal(rows().length, 1, 'one notice for one attempt');
  assert.match(rows()[0].body, /Stripe will try again on 2026-10-26 \(UTC\)\./);
  assert.equal(rows()[0].link, '/settings?tab=billing');
  assert.equal(JSON.parse(rows()[0].payload).invoice, 'in_renew_1');
  // The second attempt is a new notice.
  assert.equal((await hook(db, 'invoice.payment_failed', { ...invoice, attempt_count: 2, next_payment_attempt: null })).status, 200);
  assert.equal(rows().length, 2);
  // The last attempt has no next one: the notice says so and promises no retry.
  assert.match(rows()[1].body, /^Stripe will not try again\./);
  // Not a renewal, or nobody's subscription: no notice.
  assert.equal(await recordRenewalFailure(env(db), { ...invoice, id: 'in_first', billing_reason: 'subscription_create' }), null);
  assert.equal(await recordRenewalFailure(env(db), { ...invoice, id: 'in_x', subscription: 'sub_nobody' }), null);
  assert.equal(rows().length, 2);
  // The plan columns are not touched by the failure itself: access while Stripe retries is D1052's grace.
  assert.equal(userRow(db, FOUNDER).subscription_status, 'active');
});

// ── The gates are unchanged ─────────────────────────────────────────────────

test('D1100 bounds D1052 retry access while unpaid still drops both tiers', () => {
  for(const [status,date,paid] of [['past_due',new Date().toISOString(),true],['past_due',new Date(Date.now()-22*86_400_000).toISOString(),false],['unpaid',null,false]] as const){
    assert.equal(userMeetsTier({role:'founder',subscription_tier:'studio',subscription_status:status,subscription_renews_at:date} as any,'studio'),paid);
    assert.equal(effectiveInvestorTier({investor_tier:'institutional',investor_subscription_status:status,investor_subscription_renews_at:date} as any),paid?'institutional':'free');
  }
  assert.match(read('documentation/architecture/decisions/D892.md'), /^## D892 — /);
});

// ── §6: after the review of the merged change ───────────────────────────────

test('§6 an unpaid subscription grants nothing; one that expires unpaid takes back what it was given', async () => {
  const db = database();
  assert.equal((await intent(db, FOUNDER, 'founder', 'price_studio_m')).status, 200);
  // Created before the card is confirmed: mutation-checked, drop the unpaid
  // rule from the webhook and the tier below reads studio.
  assert.equal((await hook(db, 'customer.subscription.created', subscriptionFromIntent(0, 'incomplete'))).status, 200);
  assert.equal(userRow(db, FOUNDER).subscription_tier ?? 'free', 'free');
  assert.equal(userRow(db, FOUNDER).stripe_subscription_id, null);
  assert.equal((await hook(db, 'customer.subscription.updated', subscriptionFromIntent(0, 'incomplete_expired'))).status, 200);
  assert.equal(userRow(db, FOUNDER).subscription_tier ?? 'free', 'free');
  // A row an unpaid event wrote before the rule existed is taken back when it expires.
  db.prepare("UPDATE users SET subscription_tier = 'studio', subscription_status = 'incomplete', stripe_subscription_id = 'sub_new_1' WHERE id = ?").run(FOUNDER);
  assert.equal(userMeetsTier(userRow(db, FOUNDER), 'studio'), false, 'the gate refuses an unpaid subscription');
  assert.equal((await hook(db, 'customer.subscription.updated', subscriptionFromIntent(0, 'incomplete_expired'))).status, 200);
  assert.equal(userRow(db, FOUNDER).subscription_tier, 'free');
  assert.equal(userRow(db, FOUNDER).stripe_subscription_id, null);
  // …and only that row: a member on another paid subscription keeps it.
  db.prepare("UPDATE users SET subscription_tier = 'growth', subscription_status = 'active', stripe_subscription_id = 'sub_paid_9' WHERE id = ?").run(FOUNDER);
  assert.equal((await hook(db, 'customer.subscription.updated', subscriptionFromIntent(0, 'incomplete_expired'))).status, 200);
  assert.equal(userRow(db, FOUNDER).subscription_tier, 'growth');
  assert.equal(userRow(db, FOUNDER).stripe_subscription_id, 'sub_paid_9');
  // The investor side, the same way.
  calls = [];
  assert.equal((await intent(db, INVESTOR, 'investor', 'price_pro_m')).status, 200);
  assert.equal((await hook(db, 'customer.subscription.created', subscriptionFromIntent(0, 'incomplete'))).status, 200);
  assert.equal(userRow(db, INVESTOR).investor_tier ?? 'free', 'free');
  assert.equal(effectiveInvestorTier({ investor_tier: 'professional', investor_subscription_status: 'incomplete' } as any), 'free');
  assert.equal(isUnpaidStatus('INCOMPLETE'), true);
  assert.equal(isUnpaidStatus('past_due'), false, 'a retrying renewal is D1052 grace, not this rule');
});

test('§6 the quantity is a whole number of at least one, and a plan is always one', async () => {
  const db = database();
  // A fraction above one is refused too, never floored or charged as sent: for a plan, and for a price that is no plan.
  for (const priceId of ['price_growth_m', 'price_svc_m']) {
    for (const quantity of [0.5, 1.5, 2.5, 0, -1, 'x']) {
      calls = [];
      const r = await hit(db, '/api/payments/intent', FOUNDER, 'founder', { price_id: priceId, nonce: 'n1', quantity });
      assert.equal(r.status, 400, `${priceId} × ${quantity}: ${r.text}`);
      assert.equal(r.body.error, 'invalid_quantity');
      assert.equal(calls.filter((c) => c.url.startsWith('https://api.stripe.com/')).length, 0, 'a refused quantity never reaches Stripe');
    }
  }
  assert.equal((await hit(db, '/api/payments/intent', FOUNDER, 'founder', { price_id: 'price_growth_m', nonce: 'n1', quantity: 3 })).status, 200);
  assert.equal(new URLSearchParams(subCalls()[0].body).get('items[0][quantity]'), '1');
  calls = [];
  assert.equal((await hit(db, '/api/payments/intent', FOUNDER, 'founder', { price_id: 'price_svc_m', nonce: 'n1', quantity: '2' })).status, 200);
  assert.equal(new URLSearchParams(subCalls()[0].body).get('items[0][quantity]'), '2', 'a recurring price that is no plan keeps its quantity');
});

test('§6 an event for another subscription never takes over a plan the member still holds', async () => {
  const db = database();
  db.prepare("UPDATE users SET subscription_tier = 'studio', subscription_status = 'active', stripe_subscription_id = 'sub_A' WHERE id = ?").run(FOUNDER);
  const ev = (id: string, status: string, metadata: Record<string, string>, priceId = 'price_growth_m') => ({
    id, object: 'subscription', status, customer: 'cus_founder', current_period_end: 1_800_000_000, metadata,
    items: { data: [{ quantity: 1, price: { id: priceId, unit_amount: 7900, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } }] },
  });
  const row = () => { const u = userRow(db, FOUNDER); return [u.subscription_tier, u.subscription_status, u.stripe_subscription_id]; };
  // An abandoned or ended one, with its kind.
  assert.equal((await hook(db, 'customer.subscription.updated', ev('sub_B', 'canceled', { kind: 'tier', tier: 'growth', user_id: String(FOUNDER) }))).status, 200);
  assert.deepEqual(row(), ['studio', 'active', 'sub_A']);
  // A duplicate made before D892 (no kind, read from the catalog), live: it stays inert…
  assert.equal((await hook(db, 'customer.subscription.updated', ev('sub_C', 'active', { user_id: String(FOUNDER), price_id: 'price_growth_m' }))).status, 200);
  assert.deepEqual(row(), ['studio', 'active', 'sub_A']);
  // …so its own end drops nothing.
  assert.equal((await hook(db, 'customer.subscription.deleted', ev('sub_C', 'canceled', { user_id: String(FOUNDER), price_id: 'price_growth_m' }))).status, 200);
  assert.deepEqual(row(), ['studio', 'active', 'sub_A']);
  // A live subscription with its kind, made through a checkout, still moves the row.
  assert.equal((await hook(db, 'customer.subscription.updated', ev('sub_D', 'active', { kind: 'tier', tier: 'growth' }))).status, 200);
  assert.deepEqual(row(), ['growth', 'active', 'sub_D']);
  // One with its kind but no tier, for another subscription that is not live, leaves the row as it is.
  assert.equal((await hook(db, 'customer.subscription.updated', ev('sub_E', 'canceled', { kind: 'tier', user_id: String(FOUNDER) }))).status, 200);
  assert.deepEqual(row(), ['growth', 'active', 'sub_D']);

  // MI Pro and persona plans follow the same rule.
  db.prepare("INSERT INTO mi_pro_subscriptions (user_id, status, subscription_id, plan) VALUES (?, 'active', 'sub_mi_A', 'mi_pro_annual')").run(FOUNDER);
  const mi = () => ({ ...(db.prepare('SELECT status, subscription_id FROM mi_pro_subscriptions WHERE user_id = ?').get(FOUNDER) as any) });
  assert.equal((await hook(db, 'customer.subscription.created', ev('sub_mi_B', 'incomplete', { kind: 'mi', plan: 'mi_pro_monthly', user_id: String(FOUNDER) }, 'price_mi_y'))).status, 200);
  assert.deepEqual(mi(), { status: 'active', subscription_id: 'sub_mi_A' });
  // A duplicate made before D892, read from the catalog and live, stays inert, so its own end drops nothing.
  const miDuplicate = ev('sub_mi_C', 'active', { user_id: String(FOUNDER), price_id: 'price_mi_y' }, 'price_mi_y');
  assert.equal((await hook(db, 'customer.subscription.updated', miDuplicate)).status, 200);
  assert.deepEqual(mi(), { status: 'active', subscription_id: 'sub_mi_A' });
  assert.equal((await hook(db, 'customer.subscription.deleted', { ...miDuplicate, status: 'canceled' })).status, 200);
  assert.deepEqual(mi(), { status: 'active', subscription_id: 'sub_mi_A' });
  // A live one with its kind, made through a checkout, moves the row.
  assert.equal((await hook(db, 'customer.subscription.updated', ev('sub_mi_D', 'active', { kind: 'mi', plan: 'mi_pro_annual', user_id: String(FOUNDER) }, 'price_mi_y'))).status, 200);
  assert.deepEqual(mi(), { status: 'active', subscription_id: 'sub_mi_D' });
  // A catalog-read one still takes a row that holds no live plan.
  db.prepare("UPDATE mi_pro_subscriptions SET status = 'cancelled' WHERE user_id = ?").run(FOUNDER);
  assert.equal((await hook(db, 'customer.subscription.updated', ev('sub_mi_E', 'active', { user_id: String(FOUNDER), price_id: 'price_mi_y' }, 'price_mi_y'))).status, 200);
  assert.deepEqual(mi(), { status: 'active', subscription_id: 'sub_mi_E' });

  db.prepare("INSERT INTO account_subscriptions (user_id, plan_group, plan, status, subscription_id) VALUES (?, 'partner', 'partner_pro', 'active', 'sub_p_A')").run(PARTNER);
  const plan = () => ({ ...(db.prepare('SELECT status, subscription_id FROM account_subscriptions WHERE user_id = ?').get(PARTNER) as any) });
  const persona = { ...ev('sub_p_B', 'incomplete', { kind: 'plan', plan_group: 'partner', user_id: String(PARTNER) }, 'price_partner_m'), customer: 'cus_partner' };
  assert.equal((await hook(db, 'customer.subscription.created', persona)).status, 200);
  assert.deepEqual(plan(), { status: 'active', subscription_id: 'sub_p_A' });
  const personaDuplicate = { ...ev('sub_p_C', 'active', { user_id: String(PARTNER), price_id: 'price_partner_m' }, 'price_partner_m'), customer: 'cus_partner' };
  assert.equal((await hook(db, 'customer.subscription.updated', personaDuplicate)).status, 200);
  assert.deepEqual(plan(), { status: 'active', subscription_id: 'sub_p_A' });
  assert.equal((await hook(db, 'customer.subscription.deleted', { ...personaDuplicate, status: 'canceled' })).status, 200);
  assert.deepEqual(plan(), { status: 'active', subscription_id: 'sub_p_A' });
  assert.equal((await hook(db, 'customer.subscription.updated', { ...persona, status: 'active' })).status, 200);
  assert.deepEqual(plan(), { status: 'active', subscription_id: 'sub_p_B' });
  db.prepare("UPDATE account_subscriptions SET status = 'cancelled' WHERE user_id = ?").run(PARTNER);
  assert.equal((await hook(db, 'customer.subscription.updated', { ...personaDuplicate, id: 'sub_p_E' })).status, 200);
  assert.deepEqual(plan(), { status: 'active', subscription_id: 'sub_p_E' });
});

test('§6 the same rules hold an investor row and its accepted seat colleagues', async () => {
  const db = database();
  const COLLEAGUE = 54;
  db.prepare("INSERT INTO users (id, role, name, email, uid, is_active) VALUES (?, 'investor', 'Sam Seat', 'sam@example.com', 'uid-54', 1)").run(COLLEAGUE);
  db.prepare("UPDATE users SET investor_stripe_customer_id = 'cus_inv52', investor_tier = 'institutional', investor_subscription_status = 'active', investor_stripe_subscription_id = 'sub_A' WHERE id = ?").run(INVESTOR);
  db.prepare("UPDATE users SET investor_seat_primary_user_id = ?, investor_tier = 'institutional', investor_subscription_status = 'active' WHERE id = ?").run(INVESTOR, COLLEAGUE);
  const ev = (id: string, status: string, metadata: Record<string, string>) => ({
    id, object: 'subscription', status, customer: 'cus_inv52', current_period_end: 1_800_000_000, metadata: { user_id: String(INVESTOR), ...metadata },
    items: { data: [{ quantity: 1, price: { id: 'price_pro_m', unit_amount: 14900, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } }] },
  });
  const rows = () => {
    const p = userRow(db, INVESTOR), s = userRow(db, COLLEAGUE);
    return [p.investor_tier, p.investor_subscription_status, p.investor_stripe_subscription_id, s.investor_tier, s.investor_subscription_status];
  };
  const held = ['institutional', 'active', 'sub_A', 'institutional', 'active'];
  // An abandoned one, with its kind and tier or its kind alone: neither row moves.
  for (const metadata of [{ kind: 'investor', investor_tier: 'professional' }, { kind: 'investor' }]) {
    assert.equal((await hook(db, 'customer.subscription.updated', ev('sub_B', 'canceled', metadata))).status, 200);
    assert.deepEqual(rows(), held, JSON.stringify(metadata));
  }
  // One that expires unpaid takes back only the row that points at it.
  assert.equal((await hook(db, 'customer.subscription.updated', ev('sub_B', 'incomplete_expired', { kind: 'investor', investor_tier: 'professional' }))).status, 200);
  assert.deepEqual(rows(), held);
  // A duplicate made before D892, read from the catalog and live, stays inert, so its own end drops nothing.
  assert.equal((await hook(db, 'customer.subscription.updated', ev('sub_C', 'active', { price_id: 'price_pro_m' }))).status, 200);
  assert.deepEqual(rows(), held);
  assert.equal((await hook(db, 'customer.subscription.deleted', ev('sub_C', 'canceled', { price_id: 'price_pro_m' }))).status, 200);
  assert.deepEqual(rows(), held);
  // A live one with its kind, made through a checkout, moves the row, and the colleague follows…
  assert.equal((await hook(db, 'customer.subscription.updated', ev('sub_D', 'active', { kind: 'investor', investor_tier: 'professional' }))).status, 200);
  assert.deepEqual(rows(), ['professional', 'active', 'sub_D', 'professional', 'active']);
  // …and when the one the row holds expires unpaid, both are let go.
  assert.equal((await hook(db, 'customer.subscription.updated', ev('sub_D', 'incomplete_expired', { kind: 'investor', investor_tier: 'professional' }))).status, 200);
  assert.deepEqual(rows(), ['free', 'incomplete_expired', null, 'free', 'incomplete_expired']);
});

test('§6 an investor plan made before D892 on the general customer is granted, and the member adopts that customer', async () => {
  const db = database();
  const legacy = {
    id: 'sub_inv_legacy', object: 'subscription', status: 'active', customer: 'cus_general_52', current_period_end: 1_800_000_000,
    metadata: { user_id: String(INVESTOR), uid: 'uid-52', price_id: 'price_pro_m' },
    items: { data: [{ quantity: 1, price: { id: 'price_pro_m', unit_amount: 14900, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } }] },
  };
  assert.equal((await hook(db, 'customer.subscription.updated', legacy)).status, 200);
  const u = userRow(db, INVESTOR);
  assert.equal(u.investor_tier, 'professional');
  assert.equal(u.investor_stripe_customer_id, 'cus_general_52');
  assert.equal(u.investor_stripe_subscription_id, 'sub_inv_legacy');
  // One who already has an investor customer of their own keeps it.
  db.prepare("UPDATE users SET investor_tier = 'free', investor_stripe_customer_id = 'cus_inv_own', investor_stripe_subscription_id = NULL, investor_subscription_status = 'free' WHERE id = ?").run(INVESTOR);
  assert.equal((await hook(db, 'customer.subscription.updated', legacy)).status, 200);
  assert.equal(userRow(db, INVESTOR).investor_stripe_customer_id, 'cus_inv_own');
  assert.equal(userRow(db, INVESTOR).investor_tier, 'free');
  // Only the member's own general customer is adopted: a plan on another customer that names them is not.
  db.prepare("UPDATE users SET investor_stripe_customer_id = NULL WHERE id = ?").run(INVESTOR);
  assert.equal((await hook(db, 'customer.subscription.updated', { ...legacy, customer: 'cus_elsewhere' })).status, 200);
  assert.deepEqual([userRow(db, INVESTOR).investor_stripe_customer_id, userRow(db, INVESTOR).investor_tier], [null, 'free']);
});

test('§6 a plan Stripe holds that D1 never saw blocks a second one; a check that cannot be made charges nothing', async () => {
  const db = database();
  stripeSubs.cus_founder = [
    { id: 'sub_gone', status: 'canceled', metadata: { price_id: 'price_growth_m' } },
    { id: 'sub_legacy_9', status: 'active', metadata: { user_id: String(FOUNDER), price_id: 'price_growth_m' } },
  ];
  const r = await intent(db, FOUNDER, 'founder', 'price_studio_m');
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.subscription_id, 'sub_legacy_9');
  assert.equal(subCalls().length, 0);
  // Another family does not count: an MI Pro plan is still sold.
  assert.equal((await intent(db, FOUNDER, 'founder', 'price_mi_y')).status, 200);
  // A trial, or a renewal Stripe is retrying (D1052's grace), is held too; one Stripe gave up on, or never paid, is not.
  const legacyAt = (status: string) => [{ id: 'sub_legacy_9', status, metadata: { user_id: String(FOUNDER), price_id: 'price_growth_m' } }];
  for (const status of ['past_due', 'trialing']) {
    calls = [];
    stripeSubs.cus_founder = legacyAt(status);
    const held = await intent(db, FOUNDER, 'founder', 'price_studio_m');
    assert.equal(held.status, 409, `${status}: ${held.text}`);
    assert.equal(held.body.subscription_id, 'sub_legacy_9');
    assert.equal(subCalls().length, 0, status);
  }
  for (const status of ['unpaid', 'incomplete_expired']) {
    calls = [];
    stripeSubs.cus_founder = legacyAt(status);
    const sold = await intent(db, FOUNDER, 'founder', 'price_studio_m');
    assert.equal(sold.status, 200, `${status}: ${sold.text}`);
    assert.equal(subCalls().length, 1, status);
  }
  calls = [];
  stripeSubs = {};
  listFails = true;
  const down = await intent(db, FOUNDER, 'founder', 'price_studio_m');
  assert.equal(down.status, 503, down.text);
  assert.equal(down.body.error, 'plan_check_unavailable');
  assert.equal(subCalls().length, 0);
});

test('§6 the refusal points to the swap route only for the families it changes', async () => {
  const db = database();
  db.prepare("INSERT INTO mi_pro_subscriptions (user_id, status, subscription_id) VALUES (?, 'active', 'sub_mi_1')").run(FOUNDER);
  const r = await intent(db, FOUNDER, 'founder', 'price_mi_y');
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.subscription_id, 'sub_mi_1');
  assert.equal(r.body.swap, undefined);
  assert.match(r.body.message, /Cancel it in Billing first/);
});

test('§6 a plan change acts on a subscription of its own scope only', async () => {
  const db = database();
  // An investor whose investor customer is their general one, as an intent made it before D892.
  db.prepare("UPDATE users SET investor_stripe_customer_id = 'cus_general_52', investor_tier = 'professional', investor_subscription_status = 'active', investor_stripe_subscription_id = 'sub_inv_1' WHERE id = ?").run(INVESTOR);
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at, last_step_up_at) VALUES (?, 'jti-52', 'totp', datetime('now'), datetime('now'))").run(INVESTOR);
  const jwt = await new SignJWT({ user_id: INVESTOR, role: 'investor', jti: 'jti-52' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const swap = async (path: string, scope: string, priceId: string) => {
    const res = await app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` }, body: JSON.stringify({ subscription_id: 'sub_inv_1', price_id: priceId, scope }) }, env(db));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  stripeSub = { id: 'sub_inv_1', customer: 'cus_general_52', status: 'active', metadata: { kind: 'investor', investor_tier: 'professional' }, items: { data: [{ id: 'si_1', price: { id: 'price_pro_m' } }] } };
  for (const path of ['/api/billing/subscription/swap/preview', '/api/billing/subscription/swap/confirm']) {
    const r = await swap(path, 'founder', 'price_growth_m');
    assert.equal(r.status, 400, `${path}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error, 'invalid_scope');
  }
  // The other way round: an investor-scope swap of a founder plan on that same customer, stamped or made before D892.
  addInstitutional(db);
  for (const metadata of [{ kind: 'tier', tier: 'growth' }, { user_id: String(INVESTOR), price_id: 'price_growth_m' }]) {
    stripeSub = { id: 'sub_inv_1', customer: 'cus_general_52', status: 'active', metadata, items: { data: [{ id: 'si_1', price: { id: 'price_growth_m' } }] } };
    for (const path of ['/api/billing/subscription/swap/preview', '/api/billing/subscription/swap/confirm']) {
      const r = await swap(path, 'investor', 'price_inst_m');
      assert.equal(r.status, 400, `${path} ${JSON.stringify(metadata)}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error, 'invalid_scope');
    }
  }
  assert.equal(userRow(db, INVESTOR).investor_tier, 'professional');
  assert.equal(calls.filter((c) => c.method === 'POST' && /\/v1\/subscriptions\/sub_inv_1$/.test(c.url)).length, 0, 'nothing was changed in Stripe');
  assert.equal(await planKindOfSubscription(env(db), { metadata: { user_id: '51', price_id: 'price_growth_m' } }), 'tier', 'a subscription with no kind is read from its price');
  assert.equal(await planKindOfSubscription(env(db), { metadata: { kind: 'expert_booking' } }), null);
});

// ── §6, the second review's five findings ───────────────────────────────────

/** A TOTP session for `id`, stepped up now unless `stale`, and its token. */
async function sessionToken(db: DatabaseSync, id: number, role: string, opts: { jti?: string; stale?: boolean } = {}) {
  const jti = opts.jti ?? `jti-${id}`;
  if (opts.stale) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now', '-2 days'))").run(id, jti);
  } else {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at, last_step_up_at) VALUES (?, ?, 'totp', datetime('now'), datetime('now'))").run(id, jti);
  }
  return new SignJWT({ user_id: id, role, jti }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}
/** A POST as the holder of `jwt` (or nobody), against `e` (the database's own binding unless given). */
async function send(db: DatabaseSync, path: string, jwt: string | null, body: unknown, e: any = env(db)) {
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) };
    const res = await app.request(path, { method: 'POST', headers, body: JSON.stringify(body) }, e);
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text };
  } finally { [console.warn, console.error] = saved; }
}
/** An investor plan the intent sold before D892: on the general customer, with no kind. */
const legacyInvestorSub = () => ({
  id: 'sub_invold', object: 'subscription', status: 'active', customer: 'cus_general_52', current_period_end: 1_800_000_000,
  metadata: { user_id: String(INVESTOR), uid: 'uid-52', price_id: 'price_pro_m' },
  items: { data: [{ id: 'si_invold', quantity: 1, price: { id: 'price_pro_m', unit_amount: 14900, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } }] },
});
const addInstitutional = (db: DatabaseSync) => db.prepare("INSERT INTO stripe_products (id, name, metadata_json, prices_json) VALUES ('prod_inst', 'Investor — Institutional', ?, ?)")
  .run(JSON.stringify({ investor_tier: 'institutional' }), JSON.stringify([price('price_inst_m', 49900, 'month')]));
const listedCustomers = () => calls.filter((c) => c.method === 'GET' && new URL(c.url).pathname === '/v1/subscriptions')
  .map((c) => new URL(c.url).searchParams.get('customer'));
const PERIOD_END = new Date(1_800_000_000 * 1000).toISOString();

test('§6 finding 1: a refused investor intent makes no customer; a plan on the general customer is adopted there, then granted', async () => {
  const db = database();
  stripeSubs.cus_general_52 = [legacyInvestorSub()];
  const r = await intent(db, INVESTOR, 'investor', 'price_pro_m');
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.subscription_id, 'sub_invold');
  assert.equal(r.body.swap, '/api/billing/subscription/swap/preview');
  assert.equal(customersMade().length, 0, 'a refused intent makes no investor customer');
  assert.equal(subCalls().length, 0);
  assert.equal(userRow(db, INVESTOR).investor_stripe_customer_id, 'cus_general_52', 'the general customer is adopted as the investor customer');
  // The plan's next event grants it…
  assert.equal((await hook(db, 'customer.subscription.updated', legacyInvestorSub())).status, 200);
  const u = userRow(db, INVESTOR);
  assert.deepEqual([u.investor_tier, u.investor_subscription_status, u.investor_stripe_subscription_id], ['professional', 'active', 'sub_invold']);
  // …and the swap the refusal points to finds it in the investor scope.
  addInstitutional(db);
  stripeSub = legacyInvestorSub();
  const jwt = await sessionToken(db, INVESTOR, 'investor');
  const preview = await send(db, '/api/billing/subscription/swap/preview', jwt, { subscription_id: 'sub_invold', price_id: 'price_inst_m', scope: 'investor' });
  assert.equal(preview.status, 200, preview.text);
});

test('§6 finding 1: the investor customer is checked too, and a member who has one keeps it', async () => {
  const db = database();
  db.prepare("UPDATE users SET investor_stripe_customer_id = 'cus_invown' WHERE id = ?").run(INVESTOR);
  stripeSubs.cus_invown = [{ id: 'sub_invown', status: 'active', customer: 'cus_invown', metadata: { kind: 'investor', investor_tier: 'professional' } }];
  const r = await intent(db, INVESTOR, 'investor', 'price_pro_m');
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.subscription_id, 'sub_invown');
  assert.deepEqual(listedCustomers(), ['cus_general_52', 'cus_invown']);
  // Held on the general customer instead: refused, and the investor customer stays theirs.
  calls = [];
  stripeSubs = { cus_general_52: [legacyInvestorSub()] };
  const again = await intent(db, INVESTOR, 'investor', 'price_pro_m');
  assert.equal(again.status, 409, again.text);
  assert.equal(again.body.subscription_id, 'sub_invold');
  assert.equal(userRow(db, INVESTOR).investor_stripe_customer_id, 'cus_invown');
  assert.equal(customersMade().length, 0);
});

test('§6 finding 1: a plan check that cannot be made makes no customer, and the plan is still granted on its event', async () => {
  const db = database();
  listFails = true;
  const r = await intent(db, INVESTOR, 'investor', 'price_pro_m');
  assert.equal(r.status, 503, r.text);
  assert.equal(r.body.error, 'plan_check_unavailable');
  assert.equal(customersMade().length, 0, 'nothing is made in Stripe before the check answers');
  assert.equal(subCalls().length, 0);
  assert.equal(userRow(db, INVESTOR).investor_stripe_customer_id, null);
  assert.equal((await hook(db, 'customer.subscription.updated', legacyInvestorSub())).status, 200);
  const u = userRow(db, INVESTOR);
  assert.deepEqual([u.investor_stripe_customer_id, u.investor_tier, u.investor_stripe_subscription_id], ['cus_general_52', 'professional', 'sub_invold']);
});

test('§6 finding 3: a general customer Stripe does not know holds nothing; every other failed read still refuses', async () => {
  const db = database();
  listFailFor = { cus_general_52: { status: 400, code: 'resource_missing' } };
  const ok = await intent(db, INVESTOR, 'investor', 'price_pro_m');
  assert.equal(ok.status, 200, ok.text);
  assert.equal(new URLSearchParams(subCalls()[0].body).get('customer'), 'cus_new_1', 'sold on the member’s own investor customer');
  for (const failure of [{ status: 500 }, { status: 401, code: 'api_key_expired' }, { status: 429, code: 'rate_limit' }]) {
    calls = [];
    listFailFor = { cus_general_52: failure };
    const r = await intent(db, INVESTOR, 'investor', 'price_pro_m');
    assert.equal(r.status, 503, `${JSON.stringify(failure)}: ${r.text}`);
    assert.equal(r.body.error, 'plan_check_unavailable');
    assert.equal(subCalls().length, 0);
  }
  // Only the general customer is excused: the investor customer is the one the plan is sold on.
  calls = [];
  listFailFor = { cus_new_1: { status: 400, code: 'resource_missing' } };
  const inv = await intent(db, INVESTOR, 'investor', 'price_pro_m');
  assert.equal(inv.status, 503, inv.text);
  assert.equal(subCalls().length, 0);
});

test('§6 finding 2: a row left at incomplete takes Stripe’s status when an incomplete event or invoice.paid names its subscription', async () => {
  const db = database();
  const stuck = (id: string, customer: string, metadata: Record<string, string>, status = 'active') => ({
    id, object: 'subscription', status, customer, current_period_end: 1_800_000_000, metadata,
    items: { data: [{ id: `si_${id}`, quantity: 1, price: { id: 'price_studio_m' } }] },
  });
  const founderRow = () => { const u = userRow(db, FOUNDER); return [u.subscription_tier, u.subscription_status, u.stripe_subscription_id]; };
  db.prepare("UPDATE users SET subscription_tier = 'studio', subscription_status = 'incomplete', stripe_subscription_id = 'sub_stuckA' WHERE id = ?").run(FOUNDER);
  assert.equal(userMeetsTier(userRow(db, FOUNDER), 'studio'), false, 'the gate refuses the row as it stands');
  stripeById.sub_stuckA = stuck('sub_stuckA', 'cus_founder', { kind: 'tier', tier: 'studio' });
  // A late `created` (incomplete) for the same subscription: Stripe says it is paid.
  assert.equal((await hook(db, 'customer.subscription.created', stuck('sub_stuckA', 'cus_founder', { kind: 'tier', tier: 'studio' }, 'incomplete'))).status, 200);
  assert.deepEqual(founderRow(), ['studio', 'active', 'sub_stuckA']);
  assert.equal(userRow(db, FOUNDER).subscription_renews_at, PERIOD_END);
  assert.equal(userMeetsTier(userRow(db, FOUNDER), 'studio'), true);
  // Stripe is read only for a row that holds the subscription at incomplete.
  calls = [];
  assert.equal((await hook(db, 'customer.subscription.created', stuck('sub_freshB', 'cus_founder', { kind: 'tier', tier: 'growth' }, 'incomplete'))).status, 200);
  assert.equal((await hook(db, 'customer.subscription.created', stuck('sub_stuckA', 'cus_founder', { kind: 'tier', tier: 'studio' }, 'incomplete'))).status, 200);
  assert.equal(subReads('sub_freshB').length + subReads('sub_stuckA').length, 0);
  assert.deepEqual(founderRow(), ['studio', 'active', 'sub_stuckA']);

  // invoice.paid repairs the investor side, and an accepted seat colleague follows.
  db.prepare("UPDATE users SET investor_stripe_customer_id = 'cus_inv52', investor_tier = 'institutional', investor_subscription_status = 'incomplete', investor_stripe_subscription_id = 'sub_stuckC' WHERE id = ?").run(INVESTOR);
  db.prepare("INSERT INTO users (id, role, name, email, uid, is_active, investor_seat_primary_user_id, investor_tier, investor_subscription_status) VALUES (54, 'investor', 'Sam Seat', 'sam@example.com', 'uid-54', 1, ?, 'institutional', 'incomplete')").run(INVESTOR);
  stripeById.sub_stuckC = stuck('sub_stuckC', 'cus_inv52', { kind: 'investor', investor_tier: 'institutional' });
  const paid = (subscription: string) => ({ id: 'in_paid1', object: 'invoice', subscription, customer: 'cus_founder', billing_reason: 'subscription_cycle' });
  assert.equal((await hook(db, 'invoice.paid', { ...paid('sub_stuckC'), customer: 'cus_inv52' })).status, 200);
  const inv = userRow(db, INVESTOR);
  assert.deepEqual([inv.investor_tier, inv.investor_subscription_status, inv.investor_subscription_renews_at], ['institutional', 'active', PERIOD_END]);
  const seat = userRow(db, 54);
  assert.deepEqual([seat.investor_tier, seat.investor_subscription_status, seat.investor_subscription_renews_at], ['institutional', 'active', PERIOD_END]);
  assert.equal(effectiveInvestorTier(seat), 'institutional');

  // Not repaired: Stripe still says incomplete; the subscription is another customer's; Stripe cannot be read.
  db.prepare("UPDATE users SET subscription_status = 'incomplete', stripe_subscription_id = 'sub_stuckD' WHERE id = ?").run(FOUNDER);
  stripeById.sub_stuckD = stuck('sub_stuckD', 'cus_founder', { kind: 'tier', tier: 'studio' }, 'incomplete');
  assert.equal((await hook(db, 'invoice.paid', paid('sub_stuckD'))).status, 200);
  assert.deepEqual(founderRow(), ['studio', 'incomplete', 'sub_stuckD']);
  stripeById.sub_stuckD = stuck('sub_stuckD', 'cus_elsewhere', { kind: 'tier', tier: 'studio' });
  assert.equal((await hook(db, 'invoice.paid', paid('sub_stuckD'))).status, 200);
  assert.deepEqual(founderRow(), ['studio', 'incomplete', 'sub_stuckD']);
  readFailFor.sub_stuckD = { status: 500 };
  assert.equal((await hook(db, 'invoice.paid', paid('sub_stuckD'))).status, 200, 'a failed read never fails the webhook');
  assert.deepEqual(founderRow(), ['studio', 'incomplete', 'sub_stuckD']);
  readFailFor = {};
  // The webhook writes only a live subscription: an ended one is its own event's, or the owner's reconciliation's.
  stripeById.sub_stuckD = stuck('sub_stuckD', 'cus_founder', { kind: 'tier', tier: 'studio' }, 'canceled');
  assert.equal((await hook(db, 'invoice.paid', paid('sub_stuckD'))).status, 200);
  assert.deepEqual(founderRow(), ['studio', 'incomplete', 'sub_stuckD']);
  // A renewal Stripe is retrying is live: the row takes `past_due`, and D1100's window applies to it.
  stripeById.sub_stuckD = stuck('sub_stuckD', 'cus_founder', { kind: 'tier', tier: 'studio' }, 'past_due');
  assert.equal((await hook(db, 'invoice.paid', paid('sub_stuckD'))).status, 200);
  assert.deepEqual(founderRow(), ['studio', 'past_due', 'sub_stuckD']);
});

test('§6 finding 2: the owner’s reconciliation is a dry run unless asked, Super Admin only, written with the write bar and a reason, and audited', async () => {
  const db = database();
  const person = db.prepare('INSERT INTO users (id, role, name, email, uid, is_active, stripe_customer_id) VALUES (?, ?, ?, ?, ?, 1, ?)');
  person.run(1, 'admin', 'Hal Holder', 'holder@example.com', 'uid-1', null);
  person.run(2, 'admin', 'Pia Plain', 'plain@example.com', 'uid-2', null);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (1)').run();
  for (const id of [55, 56, 57, 58]) person.run(id, 'founder', `Founder ${id}`, `f${id}@example.com`, `uid-${id}`, `cus_f${id}`);
  const stuck = db.prepare("UPDATE users SET subscription_tier = ?, subscription_status = 'incomplete', stripe_subscription_id = ? WHERE id = ?");
  stuck.run('growth', 'sub_recA', FOUNDER); // Stripe: active studio → granted
  stuck.run('growth', 'sub_recC', 55); // Stripe: incomplete_expired → ended
  stuck.run('growth', 'sub_recD', 56); // Stripe: no such subscription → missing
  stuck.run('growth', 'sub_recE', 57); // Stripe: still incomplete → unchanged
  stuck.run('growth', 'sub_recF', 58); // Stripe: an investor plan → mismatch, never written as a founder tier
  db.prepare("UPDATE users SET investor_stripe_customer_id = 'cus_inv52', investor_tier = 'professional', investor_subscription_status = 'incomplete', investor_stripe_subscription_id = 'sub_recB' WHERE id = ?").run(INVESTOR);
  db.prepare("INSERT INTO users (id, role, name, email, uid, is_active, investor_seat_primary_user_id, investor_tier, investor_subscription_status) VALUES (54, 'investor', 'Sam Seat', 'sam@example.com', 'uid-54', 1, ?, 'professional', 'incomplete')").run(INVESTOR);
  const sub = (id: string, customer: string, status: string, metadata: Record<string, string>) => ({
    id, object: 'subscription', status, customer, current_period_end: 1_800_000_000, metadata, items: { data: [{ id: `si_${id}`, price: { id: 'price_growth_m' } }] },
  });
  stripeById = {
    sub_recA: sub('sub_recA', 'cus_founder', 'active', { kind: 'tier', tier: 'studio' }),
    sub_recB: sub('sub_recB', 'cus_inv52', 'active', { kind: 'investor', investor_tier: 'institutional' }),
    sub_recC: sub('sub_recC', 'cus_f55', 'incomplete_expired', { kind: 'tier', tier: 'growth' }),
    sub_recE: sub('sub_recE', 'cus_f57', 'incomplete', { kind: 'tier', tier: 'growth' }),
    sub_recF: sub('sub_recF', 'cus_f58', 'active', { kind: 'investor', investor_tier: 'institutional' }),
  };
  const rows = () => (db.prepare(`SELECT id, subscription_tier, subscription_status, stripe_subscription_id, subscription_renews_at,
      investor_tier, investor_subscription_status, investor_subscription_renews_at FROM users WHERE id IN (51, 52, 54, 55, 56, 57, 58) ORDER BY id`).all() as any[]).map((r) => ({ ...r }));
  const byId = () => Object.fromEntries(rows().map((r) => [r.id, r]));
  const audits = () => db.prepare("SELECT action, filters_json FROM admin_audit_log WHERE action LIKE 'billing_incomplete%' ORDER BY id").all() as any[];
  const outcomes = (body: any) => Object.fromEntries(body.results.map((r: any) => [r.subscription_id, r.outcome]));
  const path = '/api/admin/billing/subscriptions/reconcile-incomplete';
  const holder = await sessionToken(db, 1, 'admin');
  const holderStale = await sessionToken(db, 1, 'admin', { jti: 'jti-1-stale', stale: true });
  const plain = await sessionToken(db, 2, 'admin');
  const member = await sessionToken(db, FOUNDER, 'founder');
  const before = rows();

  // Refused for who they are, before Stripe is read.
  for (const [jwt, status] of [[null, 401], [member, 403], [plain, 403]] as const) {
    calls = [];
    for (const body of [{}, { dry_run: false, reason: 'Repair the plan rows' }]) {
      const r = await send(db, path, jwt, body);
      assert.equal(r.status, status, r.text);
    }
    assert.equal(calls.length, 0);
  }

  // A dry run by default: Stripe is read and each row's outcome reported; nothing is written.
  calls = [];
  const dry = await send(db, path, holderStale, {});
  assert.equal(dry.status, 200, dry.text);
  assert.equal(dry.body.dry_run, true);
  assert.deepEqual(outcomes(dry.body), { sub_recA: 'granted', sub_recB: 'granted', sub_recC: 'ended', sub_recD: 'missing', sub_recE: 'unchanged', sub_recF: 'mismatch' });
  assert.deepEqual(dry.body.counts, { granted: 2, ended: 1, unpaid: 0, unchanged: 1, mismatch: 1, missing: 1, unreadable: 0, failed: 0 });
  assert.ok(dry.body.results.every((r: any) => r.written === false));
  assert.equal(calls.filter((c) => c.method !== 'GET').length, 0, 'a dry run only reads');
  assert.deepEqual(rows(), before, 'a dry run writes nothing');
  assert.equal(audits().length, 1);
  assert.equal(audits()[0].action, 'billing_incomplete_reconcile_dry_run');
  const dryAudit = JSON.parse(audits()[0].filters_json);
  assert.equal(dryAudit.dry_run, true);
  assert.deepEqual([dryAudit.written, dryAudit.results.length], [0, 6]);

  // Writing takes the write bar and a reason.
  assert.equal((await send(db, path, holderStale, { dry_run: false, reason: 'Repair the plan rows' })).status, 403);
  for (const reason of [undefined, '   ']) {
    const r = await send(db, path, holder, { dry_run: false, reason });
    assert.equal(r.status, 400, r.text);
    assert.equal(r.body.error, 'reason_required');
  }
  assert.deepEqual(rows(), before);
  assert.equal(audits().length, 1);

  // Written: paid rows take their plan, the expired one is let go, the rest stay as they are.
  const done = await send(db, path, holder, { dry_run: false, reason: 'Rows left at incomplete before D892 §6' });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.body.dry_run, false);
  assert.deepEqual(outcomes(done.body), outcomes(dry.body));
  const after = byId();
  assert.deepEqual([after[51].subscription_tier, after[51].subscription_status, after[51].stripe_subscription_id, after[51].subscription_renews_at], ['studio', 'active', 'sub_recA', PERIOD_END]);
  assert.deepEqual([after[52].investor_tier, after[52].investor_subscription_status, after[52].investor_subscription_renews_at], ['institutional', 'active', PERIOD_END]);
  assert.deepEqual([after[54].investor_tier, after[54].investor_subscription_status, after[54].investor_subscription_renews_at], ['institutional', 'active', PERIOD_END], 'the seat colleague follows');
  assert.deepEqual([after[55].subscription_tier, after[55].subscription_status, after[55].stripe_subscription_id], ['free', 'incomplete_expired', null]);
  assert.deepEqual(after[56], before.find((r) => r.id === 56));
  assert.deepEqual(after[57], before.find((r) => r.id === 57));
  assert.deepEqual(after[58], before.find((r) => r.id === 58), 'another family’s subscription is never written to this row');
  assert.equal(audits().length, 2);
  assert.equal(audits()[1].action, 'billing_incomplete_reconcile');
  const doneAudit = JSON.parse(audits()[1].filters_json);
  assert.equal(doneAudit.reason, 'Rows left at incomplete before D892 §6');
  assert.equal(doneAudit.written, 3, 'two granted, one ended');
  assert.deepEqual(doneAudit.results.find((r: any) => r.subscription_id === 'sub_recB'), { target_user_id: INVESTOR, family: 'investor', subscription_id: 'sub_recB', outcome: 'granted', written: true });

  // Again: only what Stripe did not settle is left, a page at a time; a failed read is reported and left.
  readFailFor.sub_recE = { status: 500 };
  const first = await send(db, path, holder, { limit: 1 });
  assert.deepEqual([first.body.checked, outcomes(first.body), first.body.next_after], [1, { sub_recD: 'missing' }, 56]);
  const second = await send(db, path, holder, { limit: 1, after: 56 });
  assert.deepEqual([second.body.checked, outcomes(second.body)], [1, { sub_recE: 'unreadable' }]);
  assert.deepEqual(byId()[57], before.find((r) => r.id === 57));
});

/** The Super Admin who holds the write bar, user 1, with a TOTP session stepped up now, and its token. */
async function holderToken(db: DatabaseSync) {
  db.prepare("INSERT INTO users (id, role, name, email, uid, is_active) VALUES (1, 'admin', 'Hal Holder', 'holder@example.com', 'uid-1', 1)").run();
  db.prepare('INSERT INTO super_admins (user_id) VALUES (1)').run();
  return sessionToken(db, 1, 'admin');
}
const RECONCILE = '/api/admin/billing/subscriptions/reconcile-incomplete';
/** The reconciliation's audit rows, oldest first, each with its details spread in. */
const reconcileAudits = (db: DatabaseSync) => (db.prepare("SELECT action, filters_json FROM admin_audit_log WHERE action LIKE 'billing_incomplete%' ORDER BY id").all() as any[])
  .map((a) => ({ action: a.action, ...JSON.parse(a.filters_json) }));
/** Each result's outcome and whether it was written, by subscription. */
const settledOf = (body: any) => Object.fromEntries(body.results.map((r: any) => [r.subscription_id, [r.outcome, r.written]]));
const settleSub = (id: string, customer: string, status: string, metadata: Record<string, string>) => ({
  id, object: 'subscription', status, customer, current_period_end: 1_800_000_000, metadata, items: { data: [{ id: `si_${id}`, price: { id: 'price_growth_m' } }] },
});
const founderCols = (db: DatabaseSync, id: number) => { const u = userRow(db, id); return [u.subscription_tier, u.subscription_status, u.stripe_subscription_id]; };
const investorCols = (db: DatabaseSync, id: number) => { const u = userRow(db, id); return [u.investor_tier, u.investor_subscription_status, u.investor_stripe_subscription_id]; };

test('§6 finding 2: the reconciliation writes each row of its table, seat colleagues with it, and never a row that moved', async () => {
  const db = database();
  const holder = await holderToken(db);
  db.prepare("INSERT INTO users (id, role, name, email, uid, is_active, stripe_customer_id) VALUES (55, 'founder', 'Founder 55', 'f55@example.com', 'uid-55', 1, 'cus_f55')").run();
  db.prepare("INSERT INTO users (id, role, name, email, uid, is_active) VALUES (56, 'investor', 'Investor 56', 'i56@example.com', 'uid-56', 1)").run();
  const seat = db.prepare("INSERT INTO users (id, role, name, email, uid, is_active, investor_seat_primary_user_id, investor_tier, investor_subscription_status) VALUES (?, 'investor', ?, ?, ?, 1, ?, ?, 'incomplete')");
  seat.run(54, 'Sam Seat', 'sam@example.com', 'uid-54', INVESTOR, 'institutional');
  seat.run(57, 'Sid Seat', 'sid@example.com', 'uid-57', 56, 'professional');
  const founder = db.prepare("UPDATE users SET subscription_tier = 'growth', subscription_status = 'incomplete', stripe_subscription_id = ? WHERE id = ?");
  founder.run('sub_u1', FOUNDER); // Stripe: unpaid
  founder.run('sub_c1', 55); // Stripe: canceled
  const investor = db.prepare("UPDATE users SET investor_stripe_customer_id = ?, investor_tier = ?, investor_subscription_status = 'incomplete', investor_stripe_subscription_id = ?, investor_dealroom_max = 999 WHERE id = ?");
  investor.run('cus_inv52', 'institutional', 'sub_x1', INVESTOR); // Stripe: incomplete_expired
  investor.run('cus_inv56', 'professional', 'sub_u2', 56); // Stripe: unpaid
  stripeById = {
    sub_u1: settleSub('sub_u1', 'cus_founder', 'unpaid', { kind: 'tier', tier: 'growth' }),
    sub_c1: settleSub('sub_c1', 'cus_f55', 'canceled', { kind: 'tier', tier: 'growth' }),
    sub_x1: settleSub('sub_x1', 'cus_inv52', 'incomplete_expired', { kind: 'investor', investor_tier: 'institutional' }),
    sub_u2: settleSub('sub_u2', 'cus_inv56', 'unpaid', { kind: 'investor', investor_tier: 'professional' }),
  };
  const r = await send(db, RECONCILE, holder, { dry_run: false, reason: 'Settle the rows Stripe has decided' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(settledOf(r.body), { sub_u1: ['unpaid', true], sub_c1: ['ended', true], sub_x1: ['ended', true], sub_u2: ['unpaid', true] });
  // Unpaid keeps its tier and takes the status, as its own event would write it; colleagues follow.
  assert.deepEqual(founderCols(db, FOUNDER), ['growth', 'unpaid', 'sub_u1']);
  assert.deepEqual(investorCols(db, 56), ['professional', 'unpaid', 'sub_u2']);
  assert.deepEqual(investorCols(db, 57).slice(0, 2), ['professional', 'unpaid']);
  // Canceled and expired let the plan go, canceled with the spelling the deletion writes; colleagues are let go too.
  assert.deepEqual(founderCols(db, 55), ['free', 'cancelled', null]);
  assert.deepEqual([...investorCols(db, INVESTOR), userRow(db, INVESTOR).investor_dealroom_max], ['free', 'incomplete_expired', null, INVESTOR_QUOTAS.free.dealroom_max]);
  assert.deepEqual(investorCols(db, 54).slice(0, 2), ['free', 'incomplete_expired']);
  assert.equal(effectiveInvestorTier(userRow(db, 54)), 'free');

  // A row an event moved after the page was read is never overwritten, and neither are its colleagues.
  const settle = (userId: number, family: 'tier' | 'investor', subscriptionId: string, customer: string, sub: Record<string, unknown>) =>
    settleIncompleteRow(env(db), { user_id: userId, family, subscription_id: subscriptionId, customer }, sub, { write: true })
      .then((x) => [x.outcome, x.written]);
  const founderPaid = settleSub('sub_m1', 'cus_founder', 'active', { kind: 'tier', tier: 'studio' });
  db.prepare("UPDATE users SET subscription_tier = 'growth', subscription_status = 'past_due', stripe_subscription_id = 'sub_m1' WHERE id = ?").run(FOUNDER);
  assert.deepEqual(await settle(FOUNDER, 'tier', 'sub_m1', 'cus_founder', founderPaid), ['granted', false]);
  assert.deepEqual(founderCols(db, FOUNDER), ['growth', 'past_due', 'sub_m1'], 'moved on to another status');
  db.prepare("UPDATE users SET subscription_status = 'incomplete', stripe_subscription_id = 'sub_m2' WHERE id = ?").run(FOUNDER);
  assert.deepEqual(await settle(FOUNDER, 'tier', 'sub_m1', 'cus_founder', founderPaid), ['granted', false]);
  assert.deepEqual(founderCols(db, FOUNDER), ['growth', 'incomplete', 'sub_m2'], 'holding another subscription');
  const investorPaid = settleSub('sub_m3', 'cus_inv52', 'active', { kind: 'investor', investor_tier: 'institutional' });
  db.prepare("UPDATE users SET investor_tier = 'professional', investor_subscription_status = 'past_due', investor_stripe_subscription_id = 'sub_m3' WHERE id = ?").run(INVESTOR);
  db.prepare("UPDATE users SET investor_tier = 'professional', investor_subscription_status = 'incomplete' WHERE id = 54").run();
  assert.deepEqual(await settle(INVESTOR, 'investor', 'sub_m3', 'cus_inv52', investorPaid), ['granted', false]);
  assert.deepEqual([...investorCols(db, INVESTOR), ...investorCols(db, 54).slice(0, 2)], ['professional', 'past_due', 'sub_m3', 'professional', 'incomplete']);
  db.prepare("UPDATE users SET investor_subscription_status = 'incomplete', investor_stripe_subscription_id = 'sub_m4' WHERE id = ?").run(INVESTOR);
  assert.deepEqual(await settle(INVESTOR, 'investor', 'sub_m3', 'cus_inv52', investorPaid), ['granted', false]);
  assert.deepEqual([...investorCols(db, INVESTOR), ...investorCols(db, 54).slice(0, 2)], ['professional', 'incomplete', 'sub_m4', 'professional', 'incomplete']);
  // Back at incomplete on that subscription, the same call writes the row and its colleague, with the row's period end.
  db.prepare("UPDATE users SET investor_stripe_subscription_id = 'sub_m3' WHERE id = ?").run(INVESTOR);
  assert.deepEqual(await settle(INVESTOR, 'investor', 'sub_m3', 'cus_inv52', investorPaid), ['granted', true]);
  assert.deepEqual([...investorCols(db, INVESTOR), userRow(db, INVESTOR).investor_subscription_renews_at], ['institutional', 'active', 'sub_m3', PERIOD_END]);
  assert.deepEqual([...investorCols(db, 54).slice(0, 2), userRow(db, 54).investor_subscription_renews_at], ['institutional', 'active', PERIOD_END]);
  // A row with no colleagues is written alone, and reported written.
  db.prepare('UPDATE users SET investor_seat_primary_user_id = NULL WHERE id = 57').run();
  db.prepare("UPDATE users SET investor_subscription_status = 'incomplete', investor_stripe_subscription_id = 'sub_m5' WHERE id = 56").run();
  assert.deepEqual(await settle(56, 'investor', 'sub_m5', 'cus_inv56', settleSub('sub_m5', 'cus_inv56', 'active', { kind: 'investor', investor_tier: 'institutional' })), ['granted', true]);
  assert.deepEqual(investorCols(db, 56), ['institutional', 'active', 'sub_m5']);
});

test('§6 finding 2: a reconciliation that fails part-way says which rows it wrote, leaves each failed row whole, and is audited', async () => {
  const db = database();
  const holder = await holderToken(db);
  db.prepare("INSERT INTO users (id, role, name, email, uid, is_active, stripe_customer_id) VALUES (55, 'founder', 'Founder 55', 'f55@example.com', 'uid-55', 1, 'cus_f55')").run();
  db.prepare(`INSERT INTO users (id, role, name, email, uid, is_active, investor_seat_primary_user_id, investor_tier, investor_subscription_status, investor_subscription_renews_at)
    VALUES (54, 'investor', 'Sam Seat', 'sam@example.com', 'uid-54', 1, ?, 'professional', 'incomplete', '2026-01-01T00:00:00.000Z')`).run(INVESTOR);
  const founder = db.prepare("UPDATE users SET subscription_tier = 'growth', subscription_status = 'incomplete', stripe_subscription_id = ? WHERE id = ?");
  founder.run('sub_wA', FOUNDER);
  founder.run('sub_wB', 55);
  db.prepare("UPDATE users SET subscription_renews_at = '2026-01-01T00:00:00.000Z' WHERE id = 55").run();
  db.prepare("UPDATE users SET investor_stripe_customer_id = 'cus_inv52', investor_tier = 'professional', investor_subscription_status = 'incomplete', investor_stripe_subscription_id = 'sub_wC' WHERE id = ?").run(INVESTOR);
  stripeById = {
    sub_wA: settleSub('sub_wA', 'cus_founder', 'active', { kind: 'tier', tier: 'studio' }),
    sub_wB: settleSub('sub_wB', 'cus_f55', 'active', { kind: 'tier', tier: 'studio' }),
    sub_wC: settleSub('sub_wC', 'cus_inv52', 'active', { kind: 'investor', investor_tier: 'institutional' }),
  };
  const body = { dry_run: false, reason: 'Rows left at incomplete before D892 §6' };
  const investorWhole = () => [...investorCols(db, INVESTOR), ...investorCols(db, 54).slice(0, 2)];
  const stuckInvestor = ['professional', 'incomplete', 'sub_wC', 'professional', 'incomplete'];

  // D1 fails on the second founder's write, and on the investor's own write, after its colleagues' statement ran in the same batch.
  let founderWrites = 0;
  const first = await send(db, RECONCILE, holder, body, {
    ...env(db),
    DB: flakyD1(db, (sql) => (/SET subscription_tier = COALESCE/.test(sql) && ++founderWrites === 2) || /SET investor_tier = COALESCE\(\?, investor_tier\)/.test(sql)),
  });
  assert.equal(first.status, 200, first.text);
  assert.deepEqual(settledOf(first.body), { sub_wA: ['granted', true], sub_wC: ['failed', false], sub_wB: ['failed', false] });
  assert.deepEqual([first.body.checked, first.body.counts.granted, first.body.counts.failed], [3, 1, 2]);
  assert.deepEqual(founderCols(db, FOUNDER), ['studio', 'active', 'sub_wA'], 'the row written before the failure stays written, and is reported so');
  assert.deepEqual(founderCols(db, 55), ['growth', 'incomplete', 'sub_wB']);
  assert.deepEqual(investorWhole(), stuckInvestor, 'the colleague’s statement is rolled back with the row’s');
  let audits = reconcileAudits(db);
  assert.equal(audits.length, 1, 'a run that failed part-way is audited');
  assert.deepEqual([audits[0].action, audits[0].written, audits[0].counts.failed, audits[0].reason], ['billing_incomplete_reconcile', 1, 2, body.reason]);
  assert.deepEqual(audits[0].results.map((x: any) => [x.target_user_id, x.subscription_id, x.outcome, x.written]),
    [[FOUNDER, 'sub_wA', 'granted', true], [INVESTOR, 'sub_wC', 'failed', false], [55, 'sub_wB', 'failed', false]]);

  // Again, with D1 failing on the colleagues' statement: the row is not written without them.
  const second = await send(db, RECONCILE, holder, body, { ...env(db), DB: flakyD1(db, (sql) => /WHERE investor_seat_primary_user_id = \?/.test(sql)) });
  assert.equal(second.status, 200, second.text);
  assert.deepEqual(settledOf(second.body), { sub_wC: ['failed', false], sub_wB: ['granted', true] });
  assert.deepEqual(founderCols(db, 55), ['studio', 'active', 'sub_wB']);
  assert.equal(userRow(db, 55).subscription_renews_at, PERIOD_END, 'Stripe’s period end replaces the row’s');
  assert.deepEqual(investorWhole(), stuckInvestor);

  // Once D1 answers, the row left whole is walked again and written with its colleague.
  const third = await send(db, RECONCILE, holder, body);
  assert.deepEqual(settledOf(third.body), { sub_wC: ['granted', true] });
  assert.deepEqual(investorWhole(), ['institutional', 'active', 'sub_wC', 'institutional', 'active']);
  assert.equal(userRow(db, 54).investor_subscription_renews_at, PERIOD_END);

  // A page that cannot be read answers 503 before any row is touched, and the run is still audited.
  const down = await send(db, RECONCILE, holder, body, { ...env(db), DB: flakyD1(db, (sql) => /ORDER BY id LIMIT/.test(sql)) });
  assert.equal(down.status, 503, down.text);
  assert.equal(down.body.error, 'reconcile_unavailable');
  audits = reconcileAudits(db);
  assert.equal(audits.length, 4);
  assert.deepEqual([audits[3].failed, audits[3].written, audits[3].checked, audits[3].results], ['page_unreadable', 0, 0, []]);
});

test('§6 a family the catalog cannot read is never taken for another: the intent and the swap refuse, the webhook reads on', async () => {
  const db = database();
  addInstitutional(db);
  // The catalog fails once Stripe has been read: after the reads that priced the request, at the family check.
  const stripeRead = () => calls.some((c) => c.method === 'GET' && new URL(c.url).pathname.startsWith('/v1/subscriptions'));
  const failing = { ...env(db), DB: flakyD1(db, (sql) => /stripe_products/.test(sql) && stripeRead()) };

  // The intent: a plan made before D892, with no kind, that Stripe holds and D1 never saw.
  stripeSubs.cus_founder = [{ id: 'sub_legacy_9', status: 'active', customer: 'cus_founder', metadata: { user_id: String(FOUNDER), price_id: 'price_growth_m' } }];
  const r = await send(db, '/api/payments/intent', await token(FOUNDER, 'founder'), { price_id: 'price_studio_m', nonce: 'n1' }, failing);
  assert.equal(r.status, 503, r.text);
  assert.equal(r.body.error, 'plan_check_unavailable');
  assert.equal(subCalls().length, 0, 'no second subscription reached Stripe');

  // The swap: a founder plan made before D892, on the customer the investor scope shares, is refused rather than taken as in scope.
  db.prepare("UPDATE users SET investor_stripe_customer_id = 'cus_general_52', investor_tier = 'professional', investor_subscription_status = 'active', investor_stripe_subscription_id = 'sub_inv_1' WHERE id = ?").run(INVESTOR);
  const jwt = await sessionToken(db, INVESTOR, 'investor');
  stripeSub = { id: 'sub_g0', customer: 'cus_general_52', status: 'active', metadata: { user_id: String(INVESTOR), price_id: 'price_growth_m' }, items: { data: [{ id: 'si_g0', price: { id: 'price_growth_m' } }] } };
  for (const [path, code] of [['/api/billing/subscription/swap/preview', 'preview_failed'], ['/api/billing/subscription/swap/confirm', 'swap_failed']]) {
    calls = [];
    const s = await send(db, path, jwt, { subscription_id: 'sub_g0', price_id: 'price_inst_m', scope: 'investor' }, failing);
    assert.equal(s.status, 502, `${path}: ${s.text}`);
    assert.equal(s.body.error, code);
    assert.equal(calls.filter((c) => c.method === 'POST' || new URL(c.url).pathname === '/v1/invoices/upcoming').length, 0, 'nothing was previewed or changed');
  }
  assert.equal(userRow(db, INVESTOR).investor_tier, 'professional');

  // Read leniently the same subscription has no family; read strictly the failure is thrown. The webhook reads leniently.
  const legacy = { metadata: { user_id: String(FOUNDER), price_id: 'price_growth_m' } };
  assert.equal(stripeRead(), true);
  assert.equal(await planKindOfSubscription(failing, legacy), null);
  await assert.rejects(planKindOfSubscription(failing, legacy, { strict: true }), /D1_ERROR/);
  assert.equal((await subscriptionMetadata(failing, 'customer.subscription.updated', legacy)).kind, undefined);
});

test('§6 finding 4: a plan change in its own scope goes through, previewed and confirmed', async () => {
  const db = database();
  addInstitutional(db);
  const item = (id: string, priceId: string) => ({ data: [{ id: `si_${id}`, price: { id: priceId } }] });
  const both = async (jwt: string, scope: string, sub: Record<string, unknown>, priceId: string) => {
    stripeSub = sub;
    const body = { subscription_id: sub.id, price_id: priceId, scope };
    return [await send(db, '/api/billing/subscription/swap/preview', jwt, body), await send(db, '/api/billing/subscription/swap/confirm', jwt, body)];
  };
  const changed = (id: string) => calls.filter((c) => c.method === 'POST' && new URL(c.url).pathname === `/v1/subscriptions/${id}`)
    .map((c) => Object.fromEntries(new URLSearchParams(c.body)));

  // An investor-scope swap of an investor subscription.
  db.prepare("UPDATE users SET investor_stripe_customer_id = 'cus_inv52', investor_tier = 'professional', investor_subscription_status = 'active', investor_stripe_subscription_id = 'sub_inv1' WHERE id = ?").run(INVESTOR);
  const investor = await sessionToken(db, INVESTOR, 'investor');
  for (const r of await both(investor, 'investor', { id: 'sub_inv1', customer: 'cus_inv52', status: 'active', metadata: { kind: 'investor', investor_tier: 'professional' }, items: item('inv1', 'price_pro_m') }, 'price_inst_m')) {
    assert.equal(r.status, 200, r.text);
  }
  assert.equal(changed('sub_inv1')[0]?.['items[0][price]'], 'price_inst_m');
  assert.equal(changed('sub_inv1')[0]?.['metadata[investor_tier]'], 'institutional');
  assert.equal(userRow(db, INVESTOR).investor_tier, 'institutional');

  // A founder-scope swap of a `kind=tier` subscription.
  db.prepare("UPDATE users SET subscription_tier = 'growth', subscription_status = 'active', stripe_subscription_id = 'sub_t1' WHERE id = ?").run(FOUNDER);
  const founder = await sessionToken(db, FOUNDER, 'founder');
  for (const r of await both(founder, 'founder', { id: 'sub_t1', customer: 'cus_founder', status: 'active', metadata: { kind: 'tier', tier: 'growth' }, items: item('t1', 'price_growth_m') }, 'price_studio_m')) {
    assert.equal(r.status, 200, r.text);
  }
  assert.equal(changed('sub_t1')[0]?.['metadata[tier]'], 'studio');
  assert.equal(userRow(db, FOUNDER).subscription_tier, 'studio');

  // A founder subscription made before D892, with no kind: its family is read from its price…
  for (const r of await both(founder, 'founder', { id: 'sub_t0', customer: 'cus_founder', status: 'active', metadata: { user_id: '51', price_id: 'price_growth_m' }, items: item('t0', 'price_growth_m') }, 'price_studio_m')) {
    assert.equal(r.status, 200, r.text);
  }
  assert.equal(changed('sub_t0').length, 1);
  // …so the same read refuses an investor plan sold the old way on the same customer.
  calls = [];
  for (const r of await both(founder, 'founder', { id: 'sub_i0', customer: 'cus_founder', status: 'active', metadata: { user_id: '51', price_id: 'price_pro_m' }, items: item('i0', 'price_pro_m') }, 'price_studio_m')) {
    assert.equal(r.status, 400, r.text);
    assert.equal(r.body.error, 'invalid_scope');
  }
  assert.equal(changed('sub_i0').length, 0);

  // A subscription whose price is outside the mirrored catalog is of no known family: it keeps today's behaviour and changes.
  for (const r of await both(founder, 'founder', { id: 'sub_t9', customer: 'cus_founder', status: 'active', metadata: { user_id: '51' }, items: item('t9', 'price_retired_m') }, 'price_growth_m')) {
    assert.equal(r.status, 200, r.text);
  }
  assert.equal(changed('sub_t9').length, 1);
  // A destination price outside the mirrored catalog is refused before the subscription is read.
  calls = [];
  for (const r of await both(founder, 'founder', { id: 'sub_t1', customer: 'cus_founder', status: 'active', metadata: { kind: 'tier', tier: 'studio' }, items: item('t1', 'price_studio_m') }, 'price_retired_m')) {
    assert.equal(r.status, 400, r.text);
    assert.equal(r.body.error, 'invalid_price');
  }
  assert.equal(calls.filter((c) => new URL(c.url).pathname.startsWith('/v1/subscriptions')).length, 0);
});

test('§6 finding 5: every gate refuses a first payment that never completed, and D1052’s grace is unchanged', async () => {
  const db = database();
  const day = 86_400_000;
  const ahead = new Date(Date.now() + 10 * day).toISOString();
  const inGraceEnd = new Date(Date.now() - 3 * day).toISOString();
  const investor = (status: string, renews = ahead) => ({ role: 'investor', investor_tier: 'institutional', investor_subscription_status: status, investor_subscription_renews_at: renews });
  const founder = (status: string, renews = ahead) => ({ role: 'founder', subscription_tier: 'studio', subscription_status: status, subscription_renews_at: renews });
  const cover = async (status: string, renews = ahead) => {
    db.prepare("UPDATE users SET investor_tier = 'institutional', investor_subscription_status = ?, investor_subscription_renews_at = ? WHERE id = ?").run(status, renews, INVESTOR);
    return (await primaryCover(env(db), INVESTOR)).ok;
  };
  for (const status of ['incomplete', 'incomplete_expired']) {
    assert.equal(monthlyAllowanceFor(investor(status)), 3, `the investor allowance at ${status}`);
    assert.equal(monthlyAllowanceFor(founder(status)), 3, `the founder allowance at ${status}`);
    assert.equal(await cover(status), false, `investor seats at ${status}`);
    assert.equal(userMeetsTier(founder(status) as any, 'studio'), false);
    assert.equal(effectiveInvestorTier(investor(status) as any), 'free');
  }
  // A paid plan, and a renewal Stripe retries inside D1100's window, keep everything.
  for (const [status, renews] of [['active', ahead], ['past_due', inGraceEnd]]) {
    assert.equal(monthlyAllowanceFor(investor(status, renews)), 25, status);
    assert.equal(monthlyAllowanceFor(founder(status, renews)), 25, status);
    assert.equal(await cover(status, renews), true, status);
    assert.equal(userMeetsTier(founder(status, renews) as any, 'studio'), true, status);
    assert.equal(effectiveInvestorTier(investor(status, renews) as any), 'institutional', status);
  }
});
