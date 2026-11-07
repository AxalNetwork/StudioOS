/**
 * D4855 (#4855) — the plan checkout, the plan quote, the automatic influencer
 * offer and the cart order all decide a promo code with the same rule as the
 * payments routes, and take its discount out of the licence's ceiling in one
 * conditional write. (`promo_ceiling_d4855.test.ts` holds the rule itself and
 * the payments routes; this holds the other paths.)
 *
 * The database is the baseline plus every migration. Stripe is stubbed.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import checkout from '../src/routes/billing_checkout.ts';
import orders from '../src/routes/orders.ts';
import { quarterKey } from '../src/services/statements.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'd4855-unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1, JANE = 10, MEMBER = 20, OTHER = 21;
const PERIOD = quarterKey(new Date());
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const DAY = 86_400_000;
let refuseIntent = false;

// ── Stripe, stubbed ─────────────────────────────────────────────────────────
type Call = { url: string; method: string; body: string };
let calls: Call[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url);
  const method = String(init?.method || 'GET').toUpperCase();
  calls.push({ url, method, body: String(init?.body ?? '') });
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s });
  const path = url.replace('https://api.stripe.com/v1', '').split('?')[0];
  if (path === '/subscriptions' && method === 'GET') return json({ data: [] });
  if (path === '/subscriptions' && method === 'POST') {
    return json({ id: 'sub_new1', status: 'incomplete', latest_invoice: { id: 'in_1', payment_intent: { id: 'pi_1', client_secret: 'pi_1' + '_secret_' + 'fixture' } } });
  }
  if (path === '/payment_intents' && method === 'POST') {
    if (refuseIntent) return json({ error: { message: 'down' } }, 500);
    return json({ id: 'pi_cart', client_secret: 'pi_cart_secret_fixture', status: 'requires_payment_method' });
  }
  if (path.startsWith('/promotion_codes/')) return json({ times_redeemed: 0 });
  if (path.startsWith('/customers')) return json({ id: 'cus_new' });
  return new Response('unexpected call in test: ' + method + ' ' + url, { status: 599 });
}) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });
beforeEach(() => { calls = []; refuseIntent = false; });
const posted = (prefix: string) => calls.filter((c) => c.method === 'POST' && c.url.includes(prefix)).map((c) => new URLSearchParams(c.body));

const PRICES = JSON.stringify([
  { id: 'price_growth_m', unit_amount: 10000, currency: 'usd', interval: 'month', interval_count: 1, nickname: null, type: 'recurring', active: true },
  { id: 'price_growth_y', unit_amount: 100000, currency: 'usd', interval: 'year', interval_count: 1, nickname: null, type: 'recurring', active: true },
]);

function world(ceiling: number | null = 1000) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, uid, is_active, email_verified, stripe_customer_id) VALUES (?, ?, ?, ?, ?, 1, 1, ?)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test', 'uid-sue', null);
  u.run(JANE, 'investor', 'Jane Creator', 'jane@example.test', 'uid-jane', null);
  u.run(MEMBER, 'founder', 'Max Member', 'max@example.test', 'uid-max', 'cus_max');
  u.run(OTHER, 'founder', 'Omar Other', 'omar@example.test', 'uid-omar', 'cus_omar');
  for (const [id, jti] of [[MEMBER, 'totp-max'], [OTHER, 'totp-omar']] as const) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))").run(id, jti);
  }
  db.prepare("INSERT INTO stripe_products (id, name, kind, active, metadata_json, prices_json, livemode) VALUES ('prod_growth', 'Validate + Build', 'subscription', 1, ?, ?, 0)")
    .run(JSON.stringify({ tier: 'growth' }), PRICES);
  const one = (id: string, price: string, cents: number) => db.prepare("INSERT INTO stripe_products (id, name, kind, active, metadata_json, prices_json, livemode) VALUES (?, ?, 'alacarte', 1, ?, ?, 0)")
    .run(id, id, JSON.stringify({ feature_key: id }), JSON.stringify([{ id: price, unit_amount: cents, currency: 'usd', interval: null, interval_count: null, nickname: null, type: 'one_time', active: true }]));
  one('prod_report', 'price_report', 5000);
  one('prod_other', 'price_other', 3000);
  const promo = db.prepare(`INSERT INTO promo_codes (id, code, code_normalized, coupon_id, percent_off, amount_off, currency, duration, product_ids_json, max_redemptions, times_redeemed, active, once_per_member, created_at, synced_at)
    VALUES (?, ?, ?, 'cpn', ?, ?, ?, 'once', '[]', NULL, 0, 1, ?, datetime('now'), datetime('now'))`);
  promo.run('promo_p5', 'PCT5', 'PCT5', 5, null, null, 0);     // 500 of 10,000
  promo.run('promo_p20', 'PCT20', 'PCT20', 20, null, null, 1); // 2,000 of 10,000, once per member
  promo.run('promo_six', 'SIX', 'SIX', null, 600, 'usd', 0);
  promo.run('promo_full', 'FULL', 'FULL', 100, null, null, 0);
  db.exec(`CREATE TABLE IF NOT EXISTS referral_attributions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL UNIQUE, referral_code TEXT NOT NULL,
    referrer_user_id INTEGER NOT NULL, first_touch_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, expires_at TIMESTAMP NOT NULL, converted_payment_intent_id TEXT, converted_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  for (const who of [OTHER, MEMBER]) {
    db.prepare("INSERT INTO referral_attributions (user_id, referral_code, referrer_user_id, expires_at) VALUES (?, 'h:jane', ?, '2099-01-01T00:00:00.000Z')").run(who, JANE);
  }
  if (ceiling !== null) {
    db.prepare("INSERT INTO branch_promo_ceiling (id, period, ceiling_cents, currency, issued_cents, pushed_at) VALUES (1, ?, ?, 'USD', 0, '2026-01-01T00:00:00.000Z')").run(PERIOD, ceiling);
  }
  const env = { DB: d1Over(db), ENVIRONMENT: 'test', JWT_SECRET, STRIPE_SECRET_KEY: 'sk_test_sentinel', STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture', STRIPE_WEBHOOK_SECRET: 'fixture-signing', BRANCH_CODE: 'lagos' } as any;
  return { db, env };
}
const ledger = (db: DatabaseSync) => db.prepare('SELECT ref, amount_cents, state FROM promo_ceiling_reservations ORDER BY ref').all().map((r: any) => ({ ...r }));

const app = (() => {
  const a = new Hono<any>();
  a.route('/api/billing', checkout);
  a.route('/api/orders', orders);
  a.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    return s ? c.json({ detail: err.message, code: err.message }, s) : c.json({ detail: String(err?.message || '') }, 500);
  });
  return a;
})();
async function hit(env: any, db: DatabaseSync, path: string, who: number, body: unknown) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any).role;
  const jti = (db.prepare('SELECT jti FROM user_sessions WHERE user_id = ?').get(who) as any)?.jti;
  const token = await new SignJWT({ user_id: who, role, ...(jti ? { jti } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text };
  } finally { [console.warn, console.error] = saved; }
}
const start = (env: any, db: DatabaseSync, nonce: string, code?: string, who = MEMBER) =>
  hit(env, db, '/api/billing/checkout/start', who, { plan_key: 'founder:growth', interval: 'month', nonce, ...(code ? { promo_code: code } : {}) });
const quote = (env: any, db: DatabaseSync, code?: string, who = MEMBER) =>
  hit(env, db, '/api/billing/checkout/quote', who, { plan_key: 'founder:growth', interval: 'month', ...(code ? { promo_code: code } : {}) });

// ── The plan checkout and its quote ─────────────────────────────────────────

test('D4855 plan checkout: the quote and the start refuse a discount over the ceiling the same way, with what is left', async () => {
  const { db, env } = world(1000);
  const q = await quote(env, db, 'PCT20');
  assert.equal(q.status, 200, q.text);
  assert.equal(q.body.discount, null, 'the quote shows no discount it could not give');
  assert.equal(q.body.discount_reason, 'ceiling_exceeded');
  const s = await start(env, db, 'nonce-press-0001', 'PCT20');
  assert.equal(s.status, 400, s.text);
  assert.deepEqual([s.body.error, s.body.reason, s.body.remaining_cents, s.body.currency], ['promo_invalid', 'ceiling_exceeded', 1000, 'USD']);
  assert.ok(s.body.message);
  assert.equal(posted('/subscriptions').length, 0, 'Stripe was never asked');
  assert.deepEqual(ledger(db), []);
});

test('D4855 plan checkout: a discount that fits is reserved before Stripe is asked, stamped on the subscription, and a retry is the same hold', async () => {
  const { db, env } = world(600); // after the first hold only 100 is left: a retry must not be asked to fit 500 again
  const q = await quote(env, db, 'PCT5');
  assert.deepEqual(q.body.discount, { amount: 500, code: 'PCT5' });
  assert.deepEqual(ledger(db), [], 'a quote reserves nothing');
  const s1 = await start(env, db, 'nonce-press-0002', 'PCT5');
  assert.equal(s1.status, 200, s1.text);
  const sub = posted('/subscriptions')[0];
  assert.equal(sub.get('metadata[promo_reservation_ref]'), ledger(db)[0].ref);
  assert.deepEqual(ledger(db).map((r) => [r.amount_cents, r.state]), [[500, 'reserved']]);
  const s2 = await start(env, db, 'nonce-press-0002', 'PCT5');
  assert.equal(s2.status, 200, s2.text);
  assert.equal(ledger(db).length, 1, 'the second press of Pay held nothing more');
  const used = (db.prepare('SELECT issued_cents AS n FROM branch_promo_ceiling').get() as any).n;
  assert.equal(used, 500);
});

test('D4855 plan checkout: the quote judges the member, so a once-per-member code is shown to a member who has not used it', async () => {
  const { db, env } = world(100000);
  const q = await quote(env, db, 'PCT20');
  assert.deepEqual(q.body.discount, { amount: 2000, code: 'PCT20' });
  db.prepare("INSERT INTO promo_redemptions (promo_id, user_id, payment_intent_id) VALUES ('promo_p20', ?, 'pi_before')").run(MEMBER);
  const used = await quote(env, db, 'PCT20');
  assert.equal(used.body.discount_reason, 'already_used');
});

test('D4855 plan checkout: a subscription Stripe refused gives its discount back', async () => {
  const { db, env } = world(1000);
  const saved = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(typeof input === 'string' ? input : input?.url);
    if (url.endsWith('/subscriptions') && String(init?.method).toUpperCase() === 'POST') return new Response(JSON.stringify({ error: { message: 'declined' } }), { status: 402 });
    return saved(input, init);
  }) as typeof fetch;
  try {
    const s = await start(env, db, 'nonce-press-0003', 'PCT5');
    assert.equal(s.status, 502, s.text);
  } finally { globalThis.fetch = saved; }
  assert.deepEqual(ledger(db).map((r) => r.state), ['released']);
});

test('D4855 plan checkout: an automatic influencer offer the ceiling cannot cover is not applied, and never blocks the sale', async () => {
  const { db, env } = world(1000);
  db.prepare(`INSERT INTO influencer_offers (uid, influencer_user_id, promo_id, budget_cents, currency, status, featured, created_by)
    VALUES ('off-20', ?, 'promo_p20', 50000, 'USD', 'active', 0, ?)`).run(JANE, SUPER);
  const q = await quote(env, db, undefined, OTHER);
  assert.equal(q.body.discount, null, '2,000 is more than the 1,000 left');
  const s = await start(env, db, 'nonce-press-0004', undefined, OTHER);
  assert.equal(s.status, 200, s.text);
  const sub = posted('/subscriptions')[0];
  assert.equal(sub.get('discounts[0][promotion_code]'), null);
  assert.deepEqual(ledger(db), []);
  db.prepare('UPDATE branch_promo_ceiling SET ceiling_cents = 5000').run();
  const funded = await quote(env, db, undefined, OTHER);
  assert.deepEqual(funded.body.discount, { amount: 2000, code: 'PCT20' }, 'with room, the offer applies');
  const s2 = await start(env, db, 'nonce-press-0005', undefined, OTHER);
  assert.equal(s2.status, 200, s2.text);
  assert.deepEqual(ledger(db).map((r) => [r.amount_cents, r.state]), [[2000, 'reserved']]);
});

test('D4855 plan checkout: two starts racing for the last of the ceiling — a typed code is refused for the loser, an automatic offer falls away and the sale goes on', async () => {
  const typed = world(600);
  const [a, b] = await Promise.all([start(typed.env, typed.db, 'race-typed-a', 'PCT5', MEMBER), start(typed.env, typed.db, 'race-typed-b', 'PCT5', OTHER)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 400], `${a.text} / ${b.text}`);
  assert.equal(ledger(typed.db).length, 1);
  assert.equal(posted('/subscriptions').length, 1, 'the loser never reached Stripe');

  calls = [];
  const auto = world(2500);
  auto.db.prepare(`INSERT INTO influencer_offers (uid, influencer_user_id, promo_id, budget_cents, currency, status, featured, created_by)
    VALUES ('off-20', ?, 'promo_p20', 50000, 'USD', 'active', 0, ?)`).run(JANE, SUPER);
  const [c, d] = await Promise.all([start(auto.env, auto.db, 'race-auto-a', undefined, MEMBER), start(auto.env, auto.db, 'race-auto-b', undefined, OTHER)]);
  assert.deepEqual([c.status, d.status], [200, 200], 'an offer never blocks a sale');
  const subs = posted('/subscriptions');
  assert.equal(subs.length, 2);
  assert.equal(subs.filter((p) => p.get('discounts[0][promotion_code]')).length, 1, 'only one of them got the 2,000');
  assert.equal(subs.filter((p) => p.get('metadata[influencer_offer_uid]')).length, 1);
  assert.deepEqual(ledger(auto.db).map((r) => r.amount_cents), [2000]);
});

/** The same store, but another request takes `cents` of the ceiling between this one's check and its write. */
function raced(w: ReturnType<typeof world>, cents: number) {
  const real = w.env.DB;
  let fired = false;
  return { ...w.env, DB: { ...real, prepare(sql: string) {
    if (!fired && /^\s*INSERT INTO promo_ceiling_reservations/.test(sql)) {
      fired = true;
      w.db.prepare("INSERT INTO promo_ceiling_reservations (ref, period, currency, amount_cents, promo_id, state, expires_at, created_at, updated_at) VALUES ('other-request', ?, 'USD', ?, 'promo_six', 'reserved', '2099-01-01T00:00:00.000Z', 'x', 'x')").run(PERIOD, cents);
    }
    return real.prepare(sql);
  }, batch: (stmts: any) => real.batch(stmts) } };
}

test('D4855 plan checkout: when another request takes the ceiling after the check, the write refuses a typed code and drops an automatic offer', async () => {
  const typed = world(2500);
  const lost = await start(raced(typed, 1000), typed.db, 'late-typed', 'PCT20');
  assert.equal(lost.status, 400, lost.text);
  assert.deepEqual([lost.body.reason, lost.body.remaining_cents], ['ceiling_exceeded', 1500], '2,500 less the 1,000 taken leaves 1,500, and the code is worth 2,000');
  assert.equal(posted('/subscriptions').length, 0);

  const auto = world(2500);
  auto.db.prepare(`INSERT INTO influencer_offers (uid, influencer_user_id, promo_id, budget_cents, currency, status, featured, created_by)
    VALUES ('off-20', ?, 'promo_p20', 50000, 'USD', 'active', 0, ?)`).run(JANE, SUPER);
  const kept = await start(raced(auto, 1000), auto.db, 'late-auto', undefined, OTHER);
  assert.equal(kept.status, 200, 'an offer never blocks a sale');
  const sub = posted('/subscriptions')[0];
  assert.equal(sub.get('discounts[0][promotion_code]'), null);
  assert.equal(sub.get('metadata[promo_code_id]'), null);
  assert.equal(sub.get('metadata[influencer_offer_uid]'), null);
  assert.deepEqual(ledger(auto.db).map((r) => r.ref), ['other-request'], 'nothing of ours was held');
});

// ── The cart order ──────────────────────────────────────────────────────────

const cart = (nonce: string, code: string, items = [{ price_id: 'price_report', quantity: 1 }, { price_id: 'price_other', quantity: 1 }]) =>
  ({ items, promo_code: code, nonce });

test('D4855 cart: a code worth more than the ceiling has left is refused before a PaymentIntent exists', async () => {
  const { db, env } = world(500);
  const res = await hit(env, db, '/api/orders/intent', MEMBER, cart('c1', 'SIX'));
  assert.equal(res.status, 400, res.text);
  assert.deepEqual([res.body.error, res.body.reason, res.body.remaining_cents], ['promo_invalid', 'ceiling_exceeded', 500]);
  assert.equal(posted('/payment_intents').length, 0);
  assert.deepEqual(ledger(db), []);
});

test('D4855 cart: a discount that fits is held, carried on the PaymentIntent, and handed back if Stripe makes none', async () => {
  const { db, env } = world(1000);
  const ok = await hit(env, db, '/api/orders/intent', MEMBER, cart('c2', 'SIX'));
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.discount_cents, 600);
  assert.equal(posted('/payment_intents')[0].get('metadata[promo_reservation_ref]'), ledger(db)[0].ref);
  const again = await hit(env, db, '/api/orders/intent', MEMBER, cart('c2', 'SIX'));
  assert.equal(again.status, 200, again.text);
  assert.equal(ledger(db).length, 1, 'a refresh of the same cart holds nothing more');
  refuseIntent = true;
  db.prepare('UPDATE branch_promo_ceiling SET ceiling_cents = 5000').run();
  const failed = await hit(env, db, '/api/orders/intent', MEMBER, cart('c3', 'SIX'));
  assert.equal(failed.status, 502, failed.text);
  assert.deepEqual(ledger(db).map((r) => r.state).sort(), ['released', 'reserved']);
});

test('D4855 cart: a free order has no payment webhook, so its discount is committed at once', async () => {
  const { db, env } = world(8000);
  const res = await hit(env, db, '/api/orders/intent', MEMBER, cart('c4', 'FULL'));
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.free, true);
  assert.deepEqual(ledger(db).map((r) => [r.amount_cents, r.state]), [[8000, 'committed']]);
});
