/**
 * D1334 (#3540) — Investor Plus is sold, between Investor Basic and Investor Pro.
 *
 * Before D1334 the webhook mapped any investor product that was not
 * `institutional` to `professional`, so a Plus product would have handed out
 * Pro. These tests drive the real webhook and the real dev checkout on a
 * node:sqlite database, and hold the ladder, the gates and the caps.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/investor_plus_d1334.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import billing from '../src/routes/billing.ts';
import {
  INVESTOR_QUOTAS, effectiveInvestorTier, investorTierCovers, investorUpsell, nextInvestorTier, paidInvestorTier,
  userMeetsInvestorTier, requireInvestorTierExcept,
} from '../src/middleware/requireInvestorTier.ts';
import { planMetaForProduct } from '../src/services/planSubscription.ts';
import { planOf } from '../src/services/aiCredits.ts';
import { aiLicenceKey } from '../src/services/aiBudget.ts';
import { monthlyAllowanceFor } from '../src/services/introductions.ts';
import { callerHasFullLens } from '../src/util/marketIntelTier.ts';
import { moneyKindForCatalogPrice } from '../src/services/moneyRails.ts';
import { validateProductMetadata } from '../src/services/catalog.ts';
import { planByKey } from '../src/services/planCatalogue.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
// A fixture value, assembled so no secret-shaped literal sits in the source.
const JWT_SECRET = ['d1334', 'fixture', 'only', 'signing', 'value', 'for', 'tests'].join('-');
const INVESTOR = 61;

// No test here reaches Stripe: any outbound call is answered empty and recorded.
let outbound = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => { outbound += 1; return new Response(JSON.stringify({ id: 'obj_1', data: [] }), { status: 200 }); }) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });

function database() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const baseline = read('cloudflare-worker/sql/schema_baseline.sql');
  for (const t of ['users', 'user_sessions', 'activity_logs', 'account_subscriptions', 'super_admins', 'admin_audit_log']) db.exec(tableFromBaseline(baseline, t));
  db.exec(`CREATE TABLE IF NOT EXISTS mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'free', subscription_id TEXT UNIQUE, plan TEXT, period_end TEXT, stripe_customer_id TEXT, updated_at TEXT);
    CREATE TABLE stripe_products (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'subscription',
      active INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}', prices_json TEXT NOT NULL DEFAULT '[]', synced_at TEXT NOT NULL DEFAULT (datetime('now')), livemode INTEGER);`);
  db.prepare('INSERT INTO users (id, role, name, email, uid, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(INVESTOR, 'investor', 'Ira Vale', 'ira@example.test', 'uid-61');
  db.exec(read('cloudflare-worker/sql/migrations/691_stripe_mode_stamps.sql').split('CREATE TABLE IF NOT EXISTS stripe_webhook_events')[1].replace(/^/, 'CREATE TABLE IF NOT EXISTS stripe_webhook_events'));
  return db;
}
const env = (db: DatabaseSync, over: Record<string, unknown> = {}) => ({ JWT_SECRET, ENVIRONMENT: 'test', STRIPE_SECRET_KEY: 'sk_test_sentinel', STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture', STRIPE_WEBHOOK_SECRET: 'fixture-signing', DB: d1Over(db), ...over } as any);
const app = (() => {
  const a = new Hono<any>();
  a.route('/api/billing', billing);
  a.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    return s ? c.json({ detail: err.message }, s) : c.json({ detail: String(err?.message || '') }, 500);
  });
  return a;
})();
const token = (id: number, role: string) => new SignJWT({ user_id: id, role }).setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function request(db: DatabaseSync, path: string, init: RequestInit, e = env(db)) {
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, init, e);
    const text = await res.text();
    let body: any = null; try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body };
  } finally { [console.warn, console.error] = saved; }
}
const hook = (db: DatabaseSync, type: string, object: Record<string, unknown>) => request(db, '/api/billing/stripe/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: `evt_${Math.random()}`, livemode: false, type, data: { object } }),
}, env(db, { STRIPE_WEBHOOK_SECRET: undefined }));
const row = (db: DatabaseSync) => db.prepare('SELECT investor_tier, investor_subscription_status, investor_dealroom_max, investor_stripe_subscription_id FROM users WHERE id = ?').get(INVESTOR) as any;
const completed = (tier: string) => ({
  id: 'cs_plus_1', object: 'checkout.session', mode: 'subscription', customer: 'cus_inv_61', subscription: 'sub_plus_1',
  client_reference_id: `investor:${INVESTOR}`,
  metadata: { kind: 'investor', user_id: String(INVESTOR), investor_tier: tier, plan: 'investor_plus_monthly' },
});

// ── The webhook ─────────────────────────────────────────────────────────────

test('a plus checkout sets investor_tier = plus with Plus\'s deal-room cap, never professional', async () => {
  const db = database();
  const r = await hook(db, 'checkout.session.completed', completed('plus'));
  assert.equal(r.status, 200);
  const u = row(db);
  assert.equal(u.investor_tier, 'plus');
  assert.notEqual(u.investor_tier, 'professional');
  assert.equal(u.investor_subscription_status, 'active');
  assert.equal(u.investor_dealroom_max, INVESTOR_QUOTAS.plus.dealroom_max);
  assert.equal(u.investor_stripe_subscription_id, 'sub_plus_1');
});

test('an investor checkout naming an unknown tier grants nothing (the old fallback granted Professional)', async () => {
  const db = database();
  for (const tier of ['gold', '', 'PLUS']) {
    const r = await hook(db, 'checkout.session.completed', completed(tier));
    assert.equal(r.status, 200, `tier ${JSON.stringify(tier)}`);
    assert.equal(row(db).investor_tier, 'free', `tier ${JSON.stringify(tier)} must not grant a plan`);
  }
});

test('the subscription mirror keeps plus, and moves plus to professional on an upgrade', async () => {
  const db = database();
  db.prepare("UPDATE users SET investor_stripe_customer_id = 'cus_inv_61' WHERE id = ?").run(INVESTOR);
  const sub = (tier: string) => ({
    id: 'sub_plus_1', object: 'subscription', status: 'active', customer: 'cus_inv_61', current_period_end: 1_900_000_000,
    metadata: { kind: 'investor', user_id: String(INVESTOR), investor_tier: tier },
    items: { data: [{ quantity: 1, price: { id: 'price_plus_m', unit_amount: 5000, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } }] },
  });
  assert.equal((await hook(db, 'customer.subscription.updated', sub('plus'))).status, 200);
  assert.equal(row(db).investor_tier, 'plus');
  assert.equal(row(db).investor_dealroom_max, 2);
  assert.equal((await hook(db, 'customer.subscription.updated', sub('professional'))).status, 200);
  assert.equal(row(db).investor_tier, 'professional');
  assert.equal(row(db).investor_dealroom_max, 5);
});

// ── Checkout ────────────────────────────────────────────────────────────────

test('the dev checkout sells investor_plus_monthly as plus', async () => {
  const db = database();
  const auth = { Authorization: `Bearer ${await token(INVESTOR, 'investor')}` };
  const r = await request(db, '/api/billing/investor/dev-upgrade?plan=investor_plus_monthly', { method: 'POST', headers: auth }, env(db, { STRIPE_SECRET_KEY: undefined }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.tier, 'plus');
  assert.equal(row(db).investor_tier, 'plus');
  assert.equal(row(db).investor_dealroom_max, 2);
});

test('Plus is sold monthly and yearly under its own plan keys, never priced as another tier', async () => {
  const src = read('cloudflare-worker/src/routes/billing.ts');
  assert.match(src, /investor_plus_monthly: \{ tier: 'plus',\s+interval: 'month' \}/);
  assert.match(src, /investor_plus_yearly:\s+\{ tier: 'plus',\s+interval: 'year'\s+\}/);
  assert.match(src, /if \(!plan\) return c\.json\(\{ error: 'invalid_interval'/);
  const db = database();
  const auth = { Authorization: `Bearer ${await token(INVESTOR, 'investor')}` };
  const r = await request(db, '/api/billing/investor/dev-upgrade?plan=investor_plus_yearly', { method: 'POST', headers: auth }, env(db, { STRIPE_SECRET_KEY: undefined }));
  assert.equal(r.body.tier, 'plus');
  // The webhook's old fallback is gone.
  assert.doesNotMatch(src, /\? 'institutional' : 'professional'/);
});

// ── The ladder and the gates ────────────────────────────────────────────────

test('the ladder: free < plus < professional < institutional, and Plus passes no Professional or Institutional gate', () => {
  assert.equal(investorTierCovers('plus', 'plus'), true);
  assert.equal(investorTierCovers('plus', 'professional'), false);
  assert.equal(investorTierCovers('plus', 'institutional'), false);
  assert.equal(investorTierCovers('professional', 'plus'), true);
  assert.equal(investorTierCovers('free', 'plus'), false);
  const plus = { id: 1, role: 'investor', investor_tier: 'plus', investor_subscription_status: 'active' } as any;
  assert.equal(effectiveInvestorTier(plus), 'plus');
  assert.equal(userMeetsInvestorTier(plus, 'professional'), false);
  assert.equal(userMeetsInvestorTier(plus, 'institutional'), false);
  assert.equal(userMeetsInvestorTier(plus, 'plus'), true);
  assert.equal(effectiveInvestorTier({ ...plus, investor_subscription_status: 'canceled' }), 'free');
  assert.deepEqual(investorUpsell('plus').plan, { tier: 'plus', name: 'Investor Plus', plan_key: 'investor:plus' });
  assert.deepEqual(['free', 'plus', 'professional', 'institutional'].map((t) => nextInvestorTier(t as any)), ['plus', 'professional', 'institutional', null]);
});

test('the Professional gate on /api/deals refuses a Plus investor with the Professional upsell', async () => {
  const db = database();
  db.prepare("UPDATE users SET investor_tier = 'plus', investor_subscription_status = 'active' WHERE id = ?").run(INVESTOR);
  const gated = new Hono<any>();
  gated.use('/api/deals/*', requireInvestorTierExcept('professional'));
  gated.get('/api/deals/list', (c) => c.json({ ok: true }));
  const res = await gated.request('/api/deals/list', { headers: { Authorization: `Bearer ${await token(INVESTOR, 'investor')}` } }, env(db));
  assert.equal(res.status, 402);
  const body: any = await res.json();
  assert.equal(body.required, 'professional');
  assert.equal(body.plan.plan_key, 'investor:professional');
});

// ── The catalogue readers ───────────────────────────────────────────────────

test('every Stripe-metadata reader accepts plus, and none accepts an unknown tier', () => {
  assert.equal(paidInvestorTier('plus'), 'plus');
  assert.equal(paidInvestorTier('gold'), null);
  assert.deepEqual(planMetaForProduct({ metadata: { investor_tier: 'plus' } }, { interval: 'month' }), { kind: 'investor', investor_tier: 'plus' });
  assert.equal(planMetaForProduct({ metadata: { investor_tier: 'gold' } }, { interval: 'month' }), null);
  assert.deepEqual(planOf({ investor_tier: 'plus' }), { family: 'investor', licence_key: 'investor:plus' });
  assert.deepEqual(validateProductMetadata('subscription', { investor_tier: 'plus' }), []);
  assert.equal(moneyKindForCatalogPrice({ metadata: { investor_tier: 'plus' } }, { type: 'recurring' }), 'investor_tier');
  const entry = planByKey('investor:plus')!;
  assert.equal(entry.sellable, true);
  assert.deepEqual(entry.matches, { investor_tier: 'plus' });
});

// ── The caps ────────────────────────────────────────────────────────────────

test('Plus\'s caps sit between Basic and Pro, each named in D1334', () => {
  const q = INVESTOR_QUOTAS;
  assert.deepEqual(q.plus, { intros_per_quarter: 10, dealroom_max: 2, seats: 0 });
  for (const k of ['intros_per_quarter', 'dealroom_max'] as const) {
    assert.ok(q.free[k] < q.plus[k] && q.plus[k] < q.professional[k], k);
  }
  const allowance = (investor_tier: string) => monthlyAllowanceFor({ role: 'investor', investor_tier, investor_subscription_status: 'active' } as any);
  assert.deepEqual(['free', 'plus', 'professional', 'institutional'].map(allowance), [3, 5, 10, 25]);
  const member = { id: 1, role: 'investor', investor_tier: 'plus', investor_subscription_status: 'active' };
  assert.equal(aiLicenceKey(member), 'investor:plus');
  assert.equal(callerHasFullLens(member as any), true);
  assert.equal(callerHasFullLens({ ...member, investor_tier: 'free' } as any), false);
  const doc = read('documentation/architecture/decisions/D1334.md');
  for (const figure of ['**10**', '**2**', '**5**', '`investor:plus`']) assert.ok(doc.includes(figure), `D1334 names ${figure}`);
  assert.equal(outbound, 0, 'no test reached Stripe');
});
