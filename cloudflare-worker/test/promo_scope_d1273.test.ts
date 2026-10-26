/**
 * D1273 (#3299, part 3 of #2381) — a promo code's plan and interval scope,
 * once per member and first purchase only, enforced at create and at every
 * checkout path.
 *
 * Stripe is stubbed: every call is recorded and answered from the fixtures
 * below, so no test reaches a provider host. The catalog, the token packs and
 * the users are rows in an in-memory SQLite built from the baseline.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import adminPromos from '../src/routes/admin_promos.ts';
import payments from '../src/routes/payments.ts';
import {
  validatePromoForProduct, readIntervals, planKeyOf, rowToView, memberHasPaid, reserveMemberUse, memberUseRef,
  DEFAULT_PROMO_INTERVALS, type PromoRow,
} from '../src/services/promos.ts';
import { resolveCartPromo } from '../src/services/orders.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const MIGRATION = readFileSync(new URL('../sql/migrations/630_promo_scope_and_limits.sql', import.meta.url), 'utf8');
// The packs table alone, from the migration that made it (it is not in the baseline).
const PACKS = (() => {
  const sql = readFileSync(new URL('../sql/migrations/486_ai_credits_token_packs.sql', import.meta.url), 'utf8');
  const at = sql.indexOf('CREATE TABLE IF NOT EXISTS ai_token_packs');
  return sql.slice(at, sql.indexOf('\n);', at) + 3);
})();
const ADMIN = 801, ADA = 51, BEA = 52, CY = 53;

// ── Stripe, stubbed ────────────────────────────────────────────────────────
let calls: Array<{ url: string; method: string; body: string }> = [];
let paidIntents: Record<string, Array<{ status: string }>> = {};
let morePages: Record<string, boolean> = {};
let refuseSubscription = false;
let refuseIntentsRead = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url);
  const method = String(init?.method || 'GET').toUpperCase();
  calls.push({ url, method, body: String(init?.body ?? '') });
  const path = url.replace('https://api.stripe.com/v1', '');
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s });
  if (path.startsWith('/coupons') && method === 'POST') return json({ id: 'coupon_1', percent_off: 20, amount_off: null, currency: null, duration: 'once' });
  if (path.startsWith('/promotion_codes') && method === 'POST' && path === '/promotion_codes') {
    const sent = new URLSearchParams(String(init?.body ?? ''));
    return json({ id: 'promo_1', code: sent.get('code'), active: true, max_redemptions: null, expires_at: null });
  }
  if (path.startsWith('/promotion_codes/')) return json({ times_redeemed: 0 });
  if (path.startsWith('/payment_intents') && method === 'GET') {
    if (refuseIntentsRead) return json({ error: { message: 'down' } }, 500);
    const customer = new URL(url).searchParams.get('customer') || '';
    return json({ data: paidIntents[customer] ?? [], has_more: !!morePages[customer] });
  }
  // The plans a member already holds (D892 §6 reads them before a subscription starts): none.
  if (path.startsWith('/subscriptions') && method === 'GET') return json({ data: [], has_more: false });
  if (path.startsWith('/subscriptions')) {
    if (refuseSubscription) return json({ error: { message: 'card declined' } }, 402);
    return json({ id: 'sub_1', status: 'incomplete', latest_invoice: { id: 'in_1', payment_intent: { id: 'pi_1', client_secret: 'pi_1_secret_fixture' } } });
  }
  if (path.startsWith('/customers')) return json({ id: 'cus_new' });
  if (path.startsWith('/payment_intents')) return json({ id: 'pi_one', client_secret: 'pi_one_secret_fixture', status: 'requires_payment_method' });
  return new Response('unexpected call in test', { status: 599 });
}) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });
beforeEach(() => { calls = []; paidIntents = {}; morePages = {}; refuseSubscription = false; refuseIntentsRead = false; });
const posted = (prefix: string) => calls.filter((c) => c.method === 'POST' && c.url.startsWith(`https://api.stripe.com/v1${prefix}`));

// ── The store: users, the catalog, a token pack, and the promo tables ─────
const price = (id: string, cents: number, interval: string | null) => ({
  id, unit_amount: cents, currency: 'usd', interval, interval_count: interval ? 1 : null, nickname: null, type: interval ? 'recurring' : 'one_time', active: true,
});
function database() {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'user_sessions', 'promo_codes', 'promo_redemptions', 'orders', 'activity_logs', 'account_subscriptions']) {
    d.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  d.exec(MIGRATION);
  d.exec(PACKS);
  d.exec(`CREATE TABLE stripe_products (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'subscription',
      active INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}', prices_json TEXT NOT NULL DEFAULT '[]', synced_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  const product = d.prepare('INSERT INTO stripe_products (id, name, kind, active, metadata_json, prices_json) VALUES (?, ?, ?, ?, ?, ?)');
  product.run('prod_growth', 'Founder — Growth', 'subscription', 1, JSON.stringify({ tier: 'growth' }),
    JSON.stringify([price('price_growth_m', 7900, 'month'), price('price_growth_y', 79000, 'year')]));
  product.run('prod_growth_old', 'Founder — Growth (old)', 'subscription', 0, JSON.stringify({ tier: 'growth' }), JSON.stringify([price('price_growth_old', 6900, 'month')]));
  product.run('prod_pro', 'Investor — Professional', 'subscription', 1, JSON.stringify({ investor_tier: 'professional' }), JSON.stringify([price('price_pro_m', 14900, 'month')]));
  product.run('prod_report', 'A report', 'alacarte', 1, JSON.stringify({ feature_key: 'report' }), JSON.stringify([price('price_report', 5000, null)]));
  product.run('prod_archived', 'An old report', 'alacarte', 0, JSON.stringify({}), JSON.stringify([price('price_archived', 5000, null)]));
  product.run('prod_pack', 'AI tokens', 'alacarte', 1, JSON.stringify({}), JSON.stringify([price('price_pack', 2500, null)]));
  d.prepare("INSERT INTO ai_token_packs (uid, price_id, product_id, face_cents, bonus_microusd, on_sale, origin) VALUES ('pack-1', 'price_pack', 'prod_pack', 2500, 0, 1, 'created')").run();
  const u = d.prepare('INSERT INTO users (id, role, name, email, uid, is_active, stripe_customer_id) VALUES (?, ?, ?, ?, ?, 1, ?)');
  u.run(ADMIN, 'admin', 'The Holder', 'holder@example.test', 'uid-801', null);
  u.run(ADA, 'founder', 'Ada Quill', 'ada@example.test', 'uid-51', 'cus_ada');
  u.run(BEA, 'founder', 'Bea Lin', 'bea@example.test', 'uid-52', 'cus_bea');
  u.run(CY, 'founder', 'Cy Moss', 'cy@example.test', 'uid-53', null);
  d.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(ADMIN);
  d.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))").run(ADMIN, 'totp-holder');
  return d;
}
const env = (d: DatabaseSync) => ({ DB: d1Over(d), JWT_SECRET, ENVIRONMENT: 'development', STRIPE_SECRET_KEY: 'sk_test_fixture' } as any);
const app = (() => {
  const a = new Hono<any>();
  a.route('/api/admin/promos', adminPromos);
  a.route('/api/payments', payments);
  a.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    return s ? c.json({ detail: err.message }, s) : c.json({ detail: String(err?.message || '') }, 500);
  });
  return a;
})();
const token = (id: number, role: string, jti?: string) => new SignJWT({ user_id: id, role, ...(jti ? { jti } : {}) })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function post(d: DatabaseSync, path: string, who: number, body: unknown) {
  const jwt = who === ADMIN ? await token(ADMIN, 'admin', 'totp-holder') : await token(who, 'founder');
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env(d));
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text };
  } finally { [console.warn, console.error] = saved; }
}
const create = (d: DatabaseSync, body: Record<string, unknown>) => post(d, '/api/admin/promos', ADMIN, { type: 'percent', percent_off: 20, ...body });
function insertPromo(d: DatabaseSync, code: string, over: Record<string, unknown> = {}) {
  const row = { product_ids_json: '[]', intervals_json: null, once_per_member: 0, first_purchase_only: 0, plan_keys_json: '[]', max_redemptions: null, ...over };
  d.prepare(`INSERT INTO promo_codes (id, code, code_normalized, coupon_id, percent_off, product_ids_json, intervals_json, once_per_member, first_purchase_only, plan_keys_json, max_redemptions, active)
    VALUES (?, ?, ?, 'coupon', 20, ?, ?, ?, ?, ?, ?, 1)`)
    .run(`id-${code}`, code, code, row.product_ids_json, row.intervals_json, row.once_per_member, row.first_purchase_only, row.plan_keys_json, row.max_redemptions);
}

// ── The rules, pure ─────────────────────────────────────────────────────────

test('D1273: an interval list reads as month and year only; NULL is a code from before 630 and applies to every interval', () => {
  assert.deepEqual(readIntervals(null), { ok: true, intervals: null });
  assert.deepEqual(readIntervals('["month"]'), { ok: true, intervals: ['month'] });
  assert.deepEqual(readIntervals('["month","year","month"]'), { ok: true, intervals: ['month', 'year'] });
  for (const bad of ['[]', '["week"]', '"month"', 'not json', '{}']) assert.deepEqual(readIntervals(bad), { ok: false }, bad);
  assert.deepEqual(DEFAULT_PROMO_INTERVALS, ['month'], '#2381 question 3: monthly only by default');
  assert.equal(planKeyOf({ metadata: { tier: 'growth' } }), 'tier:growth');
  assert.equal(planKeyOf({ metadata: { investor_tier: 'professional' } }), 'investor:professional');
  assert.equal(planKeyOf({ metadata: { plan_group: ' partner ' } }), 'plan:partner');
  assert.equal(planKeyOf({ metadata: { plan: 'mi_pro' } }), 'mi:mi_pro');
  assert.equal(planKeyOf({ metadata: { tier: 'platinum' } }), null, 'an unknown tier is no plan');
  const base = { id: 'x', code: 'X', code_normalized: 'X', coupon_id: 'c', percent_off: 10, amount_off: null, currency: null, duration: 'once',
    product_ids_json: '[]', max_redemptions: null, times_redeemed: 0, active: 1, expires_at: null, created_by: null, created_at: '', synced_at: '' } as PromoRow;
  const legacy = rowToView(base);
  assert.equal(legacy.intervals, null, 'a store before 630 reads as every interval');
  assert.deepEqual([legacy.plan_keys, legacy.once_per_member, legacy.first_purchase_only], [[], false, false]);
  const scoped = rowToView({ ...base, intervals_json: '["year"]', plan_keys_json: '["tier:growth"]', once_per_member: 1, first_purchase_only: 1 });
  assert.deepEqual([scoped.intervals, scoped.plan_keys, scoped.once_per_member, scoped.first_purchase_only], [['year'], ['tier:growth'], true, true]);
  assert.deepEqual(rowToView({ ...base, intervals_json: '["week"]' }).intervals, [], 'an unreadable list shows as no interval, as checkout refuses it');
});

// ── Create ──────────────────────────────────────────────────────────────────

test('D1273 create: a plan resolves to its live products, monthly by default, and the limits reach Stripe and the mirror', async () => {
  const d = database();
  const res = await create(d, { code: 'GROW20', plan_keys: ['tier:growth'], once_per_member: true, first_purchase_only: true });
  assert.equal(res.status, 200, res.text);
  const coupon = new URLSearchParams(posted('/coupons')[0].body);
  assert.equal(coupon.get('applies_to[products][0]'), 'prod_growth', 'the plan resolves to its live product');
  assert.equal(coupon.get('applies_to[products][1]'), null, 'an archived product of the same plan is not added');
  const promo = new URLSearchParams(posted('/promotion_codes')[0].body);
  assert.equal(promo.get('restrictions[first_time_transaction]'), 'true', 'Stripe enforces a first purchase on a subscription too');
  assert.equal(promo.get('metadata[intervals]'), '["month"]');
  const row = d.prepare('SELECT product_ids_json, plan_keys_json, intervals_json, once_per_member, first_purchase_only FROM promo_codes WHERE id = ?').get('promo_1') as any;
  assert.deepEqual({ ...row }, { product_ids_json: '["prod_growth"]', plan_keys_json: '["tier:growth"]', intervals_json: '["month"]', once_per_member: 1, first_purchase_only: 1 });
  const audit = d.prepare("SELECT filters_json FROM admin_audit_log WHERE action = 'promo_create'").get() as any;
  assert.deepEqual(JSON.parse(audit.filters_json).intervals, ['month'], 'the audit row names the scope');

  const both = await create(d, { code: 'BOTH20', intervals: ['month', 'year'] });
  assert.equal(both.status, 200, both.text);
  assert.equal((d.prepare("SELECT intervals_json FROM promo_codes WHERE code = 'BOTH20'").get() as any).intervals_json, '["month","year"]');
  assert.equal(new URLSearchParams(posted('/promotion_codes')[1].body).get('restrictions[first_time_transaction]'), null, 'no restriction unless asked');
});

test('D1273 create: a token pack, an archived product, an unknown product or plan, and a bad interval are refused before Stripe', async () => {
  const d = database();
  for (const [body, code] of [
    [{ product_ids: ['prod_pack'] }, 'token_pack_not_discountable'],
    [{ product_ids: ['prod_archived'] }, 'product_archived'],
    [{ product_ids: ['prod_nowhere'] }, 'unknown_product'],
    [{ plan_keys: ['tier:platinum'] }, 'unknown_plan'],
    [{ plan_keys: ['nonsense'] }, 'invalid_plan_keys'],
    [{ intervals: [] }, 'invalid_intervals'],
    [{ intervals: ['week'] }, 'invalid_intervals'],
    [{ intervals: 'month' }, 'invalid_intervals'],
    [{ once_per_member: 'yes' }, 'invalid_once_per_member'],
    [{ first_purchase_only: 1 }, 'invalid_first_purchase_only'],
  ] as const) {
    const res = await create(d, { code: 'NOPE10', ...body });
    assert.equal(res.status, 400, `${code}: ${res.text}`);
    assert.equal(res.body.code, code);
  }
  assert.equal(posted('/').length, 0, 'Stripe was never asked');
  assert.equal((d.prepare('SELECT COUNT(*) AS n FROM promo_codes').get() as any).n, 0);
});

// ── Checkout ────────────────────────────────────────────────────────────────

test('D1273: a monthly-only code is refused on a yearly price, and a one-time price is not touched by the interval scope', async () => {
  const d = database();
  insertPromo(d, 'MONTHLY', { intervals_json: '["month"]' });
  insertPromo(d, 'LEGACY', { intervals_json: null });
  insertPromo(d, 'BROKEN', { intervals_json: '["week"]' });
  const e = env(d);
  const yearly = await validatePromoForProduct(e, 'MONTHLY', 'prod_growth', 79000, 'usd', { userId: ADA, interval: 'year' });
  assert.deepEqual([yearly.ok, yearly.reason], [false, 'interval_not_eligible']);
  assert.equal((await validatePromoForProduct(e, 'MONTHLY', 'prod_growth', 7900, 'usd', { userId: ADA, interval: 'month' })).ok, true);
  assert.equal((await validatePromoForProduct(e, 'MONTHLY', 'prod_report', 5000, 'usd', { userId: ADA, interval: null })).ok, true, 'a one-time price has no interval');
  assert.equal((await validatePromoForProduct(e, 'LEGACY', 'prod_growth', 79000, 'usd', { userId: ADA, interval: 'year' })).ok, true, 'a code from before 630 keeps every interval');
  assert.equal((await validatePromoForProduct(e, 'BROKEN', 'prod_growth', 7900, 'usd', { userId: ADA, interval: 'month' })).reason, 'interval_not_eligible', 'an unreadable list is no interval, never all');

  // The route: refused before a subscription starts, and the preview says the same.
  const res = await post(d, '/api/payments/intent', ADA, { price_id: 'price_growth_y', promo_code: 'MONTHLY', nonce: 'n1' });
  assert.equal(res.status, 400, res.text);
  assert.deepEqual(res.body, { error: 'promo_invalid', reason: 'interval_not_eligible' });
  assert.equal(posted('/subscriptions').length, 0, 'no subscription started');
  const preview = await post(d, '/api/payments/promo/validate', ADA, { code: 'MONTHLY', price_id: 'price_growth_y' });
  assert.deepEqual(preview.body, { valid: false, reason: 'interval_not_eligible' });
  const ok = await post(d, '/api/payments/intent', ADA, { price_id: 'price_growth_m', promo_code: 'MONTHLY', nonce: 'n2' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(new URLSearchParams(posted('/subscriptions')[0].body).get('discounts[0][promotion_code]'), 'id-MONTHLY');
});

test('D1273: once per member — a second use by one member is refused, another member is not, and a subscription reserves the use', async () => {
  const d = database();
  insertPromo(d, 'ONCE', { once_per_member: 1 });
  const e = env(d);
  assert.equal((await validatePromoForProduct(e, 'ONCE', 'prod_report', 5000, 'usd', { userId: ADA, interval: null })).ok, true);
  d.prepare("INSERT INTO promo_redemptions (promo_id, user_id, payment_intent_id) VALUES ('id-ONCE', ?, 'pi_paid')").run(ADA);
  assert.equal((await validatePromoForProduct(e, 'ONCE', 'prod_report', 5000, 'usd', { userId: ADA, interval: null })).reason, 'already_used');
  assert.equal((await validatePromoForProduct(e, 'ONCE', 'prod_report', 5000, 'usd', { userId: BEA, interval: null })).ok, true, 'another member may use it');
  assert.equal((await validatePromoForProduct(e, 'ONCE', 'prod_report', 5000, 'usd')).reason, 'already_used', 'asked without a member, it is refused');

  // A subscription: the use is reserved before Stripe is asked, and kept.
  const first = await post(d, '/api/payments/intent', BEA, { price_id: 'price_growth_m', promo_code: 'ONCE', nonce: 'n1' });
  assert.equal(first.status, 200, first.text);
  const held = d.prepare('SELECT user_id FROM promo_redemptions WHERE payment_intent_id = ?').get(memberUseRef('id-ONCE', BEA)) as any;
  assert.equal(held?.user_id, BEA, 'the use is the member\'s once Stripe applies it');
  assert.equal((d.prepare("SELECT times_redeemed FROM promo_codes WHERE id = 'id-ONCE'").get() as any).times_redeemed, 0, 'Stripe counts a subscription redemption; the mirror does not add it');
  const second = await post(d, '/api/payments/intent', BEA, { price_id: 'price_pro_m', promo_code: 'ONCE', nonce: 'n2' });
  assert.deepEqual(second.body, { error: 'promo_invalid', reason: 'already_used' });
  assert.equal(posted('/subscriptions').length, 1, 'no second subscription with the code');
  assert.equal(await reserveMemberUse(e, 'id-ONCE', BEA), false, 'the reservation is one per member');

  // Stripe refuses the subscription: the member did not use the code.
  refuseSubscription = true;
  const refused = await post(d, '/api/payments/intent', CY, { price_id: 'price_growth_m', promo_code: 'ONCE', nonce: 'n3' });
  assert.equal(refused.status, 502, refused.text);
  assert.equal(d.prepare('SELECT 1 FROM promo_redemptions WHERE payment_intent_id = ?').get(memberUseRef('id-ONCE', CY)), undefined, 'the reservation is released');

  // A cart checks the member too.
  const cart = { lines: [{ product_id: 'prod_report', price_id: 'price_report', quantity: 1, unit_amount: 5000, line_total: 5000 }], subtotal: 5000, currency: 'usd' } as any;
  assert.deepEqual(await resolveCartPromo(e, 'ONCE', cart, ADA), { error: 'already_used' });
  const fresh = await resolveCartPromo(e, 'ONCE', cart, CY);
  assert.equal('error' in fresh, false, 'a member who has not used it gets the discount in a cart');
});

test('D1273: first purchase only — a member who has paid is refused; Stripe that cannot be read refuses, never lets by', async () => {
  const d = database();
  insertPromo(d, 'FIRST', { first_purchase_only: 1 });
  const e = env(d);
  const ask = (userId: number) => validatePromoForProduct(e, 'FIRST', 'prod_report', 5000, 'usd', { userId, interval: null });
  assert.equal((await ask(CY)).ok, true, 'no Stripe customer: never paid');
  paidIntents.cus_ada = [{ status: 'requires_payment_method' }, { status: 'canceled' }];
  assert.equal((await ask(ADA)).ok, true, 'intents that never succeeded are not a payment');
  paidIntents.cus_ada = [{ status: 'succeeded' }];
  assert.equal((await ask(ADA)).reason, 'not_first_purchase');
  assert.equal(await memberHasPaid(e, ADA), true);

  d.prepare("INSERT INTO orders (id, order_ref, user_id, status, currency, subtotal_cents, discount_cents, vat_cents, total_cents, items_json) VALUES ('o1', 'AX-1', ?, 'paid', 'usd', 5000, 5000, 0, 0, '[]')").run(BEA);
  assert.equal((await ask(BEA)).ok, true, 'a 100%-off order took no money');
  d.prepare("INSERT INTO orders (id, order_ref, user_id, status, currency, subtotal_cents, discount_cents, vat_cents, total_cents, items_json) VALUES ('o2', 'AX-2', ?, 'paid', 'usd', 5000, 0, 0, 5000, '[]')").run(BEA);
  calls = [];
  assert.equal((await ask(BEA)).reason, 'not_first_purchase', 'a paid order answers without Stripe');
  assert.equal(calls.filter((c) => c.url.includes('/payment_intents')).length, 0);

  d.prepare("UPDATE users SET stripe_customer_id = 'cus_many' WHERE id = ?").run(CY);
  morePages.cus_many = true;
  paidIntents.cus_many = [{ status: 'canceled' }];
  assert.equal((await ask(CY)).reason, 'first_purchase_unreadable', 'more intents behind the page: not known');
  morePages = {};
  refuseIntentsRead = true;
  assert.equal((await ask(CY)).reason, 'first_purchase_unreadable', 'Stripe down: refused');
  assert.equal(await memberHasPaid(e, CY), null);
  assert.equal((await validatePromoForProduct(e, 'FIRST', 'prod_report', 5000, 'usd')).reason, 'first_purchase_unreadable', 'asked without a member');
});

test('D1273: the checks run after the code\'s own terms, so a refused code never asks Stripe about the member', async () => {
  const d = database();
  insertPromo(d, 'SCOPED', { first_purchase_only: 1, product_ids_json: '["prod_growth"]' });
  const r = await validatePromoForProduct(env(d), 'SCOPED', 'prod_report', 5000, 'usd', { userId: ADA, interval: null });
  assert.equal(r.reason, 'product_not_eligible');
  assert.equal(calls.length, 0);
});
