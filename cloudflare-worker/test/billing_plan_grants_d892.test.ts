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
 * Access while Stripe retries is #2451's owner question 4 and is not changed.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import payments from '../src/routes/payments.ts';
import billing from '../src/routes/billing.ts';
import {
  planMetaForProduct, planMetaParams, subscriptionPriceId, subscriptionMetadata, heldPlanSubscription, recordRenewalFailure,
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
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url);
  calls.push({ url, method: String(init?.method || 'GET').toUpperCase(), body: String(init?.body ?? '') });
  if (url.startsWith('https://api.stripe.com/v1/subscriptions')) {
    return new Response(JSON.stringify({ id: 'sub_new_1', status: 'incomplete', latest_invoice: { id: 'in_1', payment_intent: { id: 'pi_1', client_secret: 'pi_1' + '_secret_' + 'fixture' } } }), { status: 200 });
  }
  if (url.startsWith('https://api.stripe.com/v1/customers')) return new Response(JSON.stringify({ id: 'cus_new_1' }), { status: 200 });
  if (url.startsWith('https://api.stripe.com/v1/')) return new Response(JSON.stringify({ id: 'obj_1', data: [] }), { status: 200 });
  return new Response('unexpected call in test', { status: 599 });
}) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });
beforeEach(() => { calls = []; });
const subCalls = () => calls.filter((c) => c.method === 'POST' && c.url.startsWith('https://api.stripe.com/v1/subscriptions'));

// ── A database with the users table as production has it, and the catalog ──
const price = (id: string, cents: number, interval: string | null) => ({
  id, unit_amount: cents, currency: 'usd', interval, interval_count: interval ? 1 : null, nickname: null, type: interval ? 'recurring' : 'one_time', active: true,
});
function database() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const baseline = read('cloudflare-worker/sql/schema_baseline.sql');
  for (const t of ['users', 'user_sessions', 'activity_logs', 'account_subscriptions']) db.exec(tableFromBaseline(baseline, t));
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
const app = (() => {
  const a = new Hono<any>();
  a.route('/api/payments', payments);
  a.route('/api/billing', billing);
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
  // No investor customer yet: the general one becomes it, so the webhook can match.
  assert.equal(sent.get('customer'), 'cus_general_52');
  assert.equal(userRow(db, INVESTOR).investor_stripe_customer_id, 'cus_general_52');
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
  assert.match(rows()[0].body, /Stripe will try again on 2026-10-26\./);
  assert.equal(rows()[0].link, '/settings?tab=billing');
  assert.equal(JSON.parse(rows()[0].payload).invoice, 'in_renew_1');
  // The second attempt is a new notice.
  assert.equal((await hook(db, 'invoice.payment_failed', { ...invoice, attempt_count: 2, next_payment_attempt: null })).status, 200);
  assert.equal(rows().length, 2);
  // Not a renewal, or nobody's subscription: no notice.
  assert.equal(await recordRenewalFailure(env(db), { ...invoice, id: 'in_first', billing_reason: 'subscription_create' }), null);
  assert.equal(await recordRenewalFailure(env(db), { ...invoice, id: 'in_x', subscription: 'sub_nobody' }), null);
  assert.equal(rows().length, 2);
  // The plan columns are not touched by the failure itself: access is owner question 4 (#2451).
  assert.equal(userRow(db, FOUNDER).subscription_status, 'active');
});

// ── The gates are unchanged ─────────────────────────────────────────────────

test('the tier gates still drop past_due: what a retrying renewal may use is #2451\'s owner question 4', () => {
  assert.match(read('cloudflare-worker/src/middleware/requireTier.ts'), /if \(status === 'past_due' \|\| status === 'unpaid'\) return false;/);
  assert.match(read('cloudflare-worker/src/middleware/requireInvestorTier.ts'), /status === 'past_due' \|\| status === 'unpaid' \|\| status === 'cancelled'/);
  assert.match(read('documentation/architecture/decisions/D892.md'), /^## D892 — /);
});
