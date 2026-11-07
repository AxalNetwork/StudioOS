/**
 * D4855 (#4855) — a promo code is redeemed only inside the licence's promotion
 * ceiling, decided by one rule at every checkout path, with the discount taken
 * out of the ceiling in one conditional write.
 *
 * Stripe is stubbed (no test reaches a provider host). The catalog, the users
 * and the ceiling ledger are rows in an in-memory SQLite built from the
 * baseline and the migrations, so the real SQL decides.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import payments from '../src/routes/payments.ts';
import billingRoute from '../src/routes/billing.ts';
import {
  canRedeemPromo, reservePromo, commitPromoReservation, releasePromoReservation, promoRefusalBody,
  RESERVATION_TTL_MS, REFUSAL_MESSAGES,
} from '../src/services/promoRedemption.ts';
import { resolveCartPromo } from '../src/services/orders.ts';
import { quarterKey } from '../src/services/statements.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const read = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const MIGRATIONS = ['630_promo_scope_and_limits.sql', '631_promo_redemption_detail.sql', '202611071527_promo_ceiling_reservations.sql'].map(read);
const BRANCH_CEILING = (() => {
  const sql = read('256_branch_local_copies.sql');
  const at = sql.indexOf('CREATE TABLE IF NOT EXISTS branch_promo_ceiling');
  return sql.slice(at, sql.indexOf('\n);', at) + 3);
})();
const PACKS = (() => {
  const sql = read('486_ai_credits_token_packs.sql');
  const at = sql.indexOf('CREATE TABLE IF NOT EXISTS ai_token_packs');
  return sql.slice(at, sql.indexOf('\n);', at) + 3);
})();
const ADA = 51, BEA = 52;
const PERIOD = quarterKey(new Date());

// ── Stripe, stubbed ────────────────────────────────────────────────────────
let calls: Array<{ url: string; method: string; body: string }> = [];
let refuseIntent = false;
let refuseSubscription = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url);
  const method = String(init?.method || 'GET').toUpperCase();
  calls.push({ url, method, body: String(init?.body ?? '') });
  const path = url.replace('https://api.stripe.com/v1', '');
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s });
  if (path.startsWith('/promotion_codes/')) return json({ times_redeemed: 0 });
  if (path.startsWith('/subscriptions') && method === 'GET') return json({ data: [], has_more: false });
  if (path.startsWith('/subscriptions') && refuseSubscription) return json({ error: { message: 'card declined' } }, 402);
  if (path.startsWith('/subscriptions')) return json({ id: 'sub_1', status: 'incomplete', latest_invoice: { id: 'in_1', payment_intent: { id: 'pi_1', client_secret: 'pi_1_secret_fixture' } } });
  if (path.startsWith('/customers')) return json({ id: 'cus_new' });
  if (path.startsWith('/payment_intents') && method === 'GET') return json({ data: [], has_more: false });
  if (path.startsWith('/payment_intents')) {
    if (refuseIntent) return json({ error: { message: 'down' } }, 500);
    return json({ id: 'pi_one', client_secret: 'pi_one_secret_fixture', status: 'requires_payment_method' });
  }
  return new Response('unexpected call in test', { status: 599 });
}) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });
beforeEach(() => { calls = []; refuseIntent = false; refuseSubscription = false; });
const posted = (prefix: string) => calls.filter((c) => c.method === 'POST' && c.url.startsWith(`https://api.stripe.com/v1${prefix}`));

// ── The store ───────────────────────────────────────────────────────────────
const price = (id: string, cents: number, interval: string | null) => ({
  id, unit_amount: cents, currency: 'usd', interval, interval_count: interval ? 1 : null, nickname: null, type: interval ? 'recurring' : 'one_time', active: true,
});
/** A branch store with a ceiling of `ceiling` USD cents for this period; `ceiling: null` leaves none pushed. */
function database(ceiling: number | null = 1000, over: { period?: string; currency?: string } = {}) {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'user_sessions', 'promo_codes', 'promo_redemptions', 'orders', 'activity_logs', 'account_subscriptions']) {
    d.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  for (const m of MIGRATIONS) d.exec(m);
  d.exec(BRANCH_CEILING);
  d.exec(PACKS);
  d.exec(`CREATE TABLE stripe_products (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'subscription',
      active INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}', prices_json TEXT NOT NULL DEFAULT '[]', synced_at TEXT NOT NULL DEFAULT (datetime('now')), livemode INTEGER);`);
  const product = d.prepare('INSERT INTO stripe_products (id, name, kind, active, metadata_json, prices_json,livemode) VALUES (?, ?, ?, ?, ?, ?,0)');
  product.run('prod_growth', 'Founder — Growth', 'subscription', 1, JSON.stringify({ tier: 'growth' }), JSON.stringify([price('price_growth_m', 7900, 'month')]));
  product.run('prod_report', 'A report', 'alacarte', 1, JSON.stringify({ feature_key: 'report' }), JSON.stringify([price('price_report', 5000, null)]));
  product.run('prod_other', 'Another report', 'alacarte', 1, JSON.stringify({ feature_key: 'other' }), JSON.stringify([price('price_other', 3000, null)]));
  const u = d.prepare('INSERT INTO users (id, role, name, email, uid, is_active, stripe_customer_id) VALUES (?, ?, ?, ?, ?, 1, ?)');
  u.run(ADA, 'founder', 'Ada Quill', 'ada@example.test', 'uid-51', 'cus_ada');
  u.run(BEA, 'founder', 'Bea Lin', 'bea@example.test', 'uid-52', 'cus_bea');
  if (ceiling !== null) {
    d.prepare('INSERT INTO branch_promo_ceiling (id, period, ceiling_cents, currency, issued_cents, pushed_at) VALUES (1, ?, ?, ?, 0, ?)')
      .run(over.period ?? PERIOD, ceiling, over.currency ?? 'USD', '2026-01-01T00:00:00.000Z');
  }
  return d;
}
const env = (d: DatabaseSync, branch: string | null = 'lagos') => ({
  DB: d1Over(d), JWT_SECRET, ENVIRONMENT: 'development', STRIPE_SECRET_KEY: 'sk_test_fixture', ...(branch ? { BRANCH_CODE: branch } : {}),
} as any);
const app = (() => {
  const a = new Hono<any>();
  a.route('/api/payments', payments);
  a.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    return s ? c.json({ detail: err.message }, s) : c.json({ detail: String(err?.message || '') }, 500);
  });
  return a;
})();
const token = (id: number) => new SignJWT({ user_id: id, role: 'founder' })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function post(d: DatabaseSync, path: string, who: number, body: unknown, branch: string | null = 'lagos') {
  const jwt = await token(who);
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env(d, branch));
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text };
  } finally { [console.warn, console.error] = saved; }
}
/** An amount-off code in USD cents (or a percent code when `percent` is given). */
function insertPromo(d: DatabaseSync, code: string, o: { off?: number; percent?: number; currency?: string | null; expires?: string | null; active?: number; max?: number | null; once?: number; first?: number; products?: string } = {}) {
  d.prepare(`INSERT INTO promo_codes (id, code, code_normalized, coupon_id, percent_off, amount_off, currency, product_ids_json, max_redemptions, active, expires_at, once_per_member, first_purchase_only)
    VALUES (?, ?, ?, 'coupon', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(`promo_${code}`, code, code, o.percent ?? null, o.off ?? null, o.currency === undefined ? (o.off != null ? 'usd' : null) : o.currency,
      o.products ?? '[]', o.max ?? null, o.active ?? 1, o.expires ?? null, o.once ?? 0, o.first ?? 0);
}
const intent = (d: DatabaseSync, code: string, nonce: string, who = ADA, extra: Record<string, unknown> = {}, branch: string | null = 'lagos') =>
  post(d, '/api/payments/intent', who, { price_id: 'price_report', promo_code: code, nonce, ...extra }, branch);
const rows = (d: DatabaseSync) => d.prepare('SELECT ref, amount_cents, state, period, currency, promo_id FROM promo_ceiling_reservations ORDER BY ref').all() as any[];
const issued = (d: DatabaseSync) => (d.prepare('SELECT issued_cents AS n FROM branch_promo_ceiling WHERE id = 1').get() as any)?.n;
const buyer = { userId: ADA, interval: null };
const ask = (code: string, amount = 5000, currency = 'usd', productId = 'prod_report') => ({ code, productId, amountCents: amount, currency, buyer });

// ── The acceptance cases, through the real route ───────────────────────────

test('D4855: a licence with 1,000 left cannot complete a redemption worth 1,001 — nothing reaches Stripe and nothing is reserved', async () => {
  const d = database(1000);
  insertPromo(d, 'OVER', { off: 1001 });
  const res = await intent(d, 'OVER', 'n1');
  assert.equal(res.status, 400, res.text);
  assert.equal(res.body.error, 'promo_invalid');
  assert.equal(res.body.reason, 'ceiling_exceeded');
  assert.equal(res.body.remaining_cents, 1000, 'the refusal says what is left');
  assert.equal(res.body.currency, 'USD');
  assert.match(res.body.message, /raise the ceiling/, 'and what to do');
  assert.equal(posted('/payment_intents').length, 0, 'no PaymentIntent was made');
  assert.deepEqual(rows(d), []);
  assert.equal(issued(d), 0);
});

test('D4855: 1,000 against 1,000 is allowed (the boundary), and then nothing is left', async () => {
  const d = database(1000);
  insertPromo(d, 'EXACT', { off: 1000 });
  const ok = await intent(d, 'EXACT', 'n1');
  assert.equal(ok.status, 200, ok.text);
  assert.equal(posted('/payment_intents').length, 1);
  assert.equal(new URLSearchParams(posted('/payment_intents')[0].body).get('amount'), '4000', 'the member pays the discounted amount');
  assert.deepEqual(rows(d).map((r) => [r.amount_cents, r.state]), [[1000, 'reserved']]);
  assert.equal(issued(d), 1000, 'the branch\'s running figure follows the ledger');
  const next = await intent(d, 'EXACT', 'n2', BEA);
  assert.equal(next.status, 400);
  assert.equal(next.body.reason, 'ceiling_exceeded');
  assert.equal(next.body.remaining_cents, 0, 'nothing left reads as 0 left, from a ceiling that was read');
  assert.equal(posted('/payment_intents').length, 1, 'the second never reached Stripe');
});

test('D4855: two checkouts at once cannot jointly exceed what is left — through the route', async () => {
  const d = database(1000);
  insertPromo(d, 'SIX', { off: 600 });
  const [a, b] = await Promise.all([intent(d, 'SIX', 'a', ADA), intent(d, 'SIX', 'b', BEA)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 400], `${a.text} / ${b.text}`);
  const refused = a.status === 400 ? a : b;
  assert.equal(refused.body.reason, 'ceiling_exceeded');
  assert.equal(refused.body.remaining_cents, 400);
  assert.equal(rows(d).length, 1);
  assert.equal(issued(d), 600);
});

test('D4855: the reservation is one conditional write — five racing reservations of 300 against 1,000 take exactly three', async () => {
  const d = database(1000);
  insertPromo(d, 'THREE', { off: 300 });
  const e = env(d);
  const results = await Promise.all([1, 2, 3, 4, 5].map((i) => reservePromo(e, { ...ask('THREE'), reference: `ref-${i}` })));
  assert.equal(results.filter((r) => r.ok).length, 3);
  const refused = results.filter((r) => !r.ok) as any[];
  assert.equal(refused.length, 2);
  assert.ok(refused.every((r) => r.reason === 'ceiling_exceeded'));
  const total = (d.prepare("SELECT SUM(amount_cents) AS n FROM promo_ceiling_reservations WHERE state = 'reserved'").get() as any).n;
  assert.equal(total, 900);
  assert.ok(total <= 1000);
});

test('D4855: even when every racer passed the read check on a stale figure, the write refuses the one that does not fit', async () => {
  const d = database(1000);
  insertPromo(d, 'SIX', { off: 600 });
  const e = env(d);
  // Both are told "allowed" by the read, as two requests in flight would be.
  const stale = await canRedeemPromo(e, ask('SIX'));
  assert.ok(stale.ok);
  const first = await reservePromo(e, { ...ask('SIX'), reference: 'one' }, Date.now(), stale as any);
  const second = await reservePromo(e, { ...ask('SIX'), reference: 'two' }, Date.now(), stale as any);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false, 'the stale "allowed" did not overspend the ceiling');
  assert.equal((second as any).reason, 'ceiling_exceeded');
  assert.equal((second as any).remaining_cents, 400);
});

test('D4855 retry: the same checkout twice reserves once, and is not refused for fitting twice', async () => {
  const d = database(1000);
  insertPromo(d, 'SIX', { off: 600 });
  const one = await intent(d, 'SIX', 'same');
  const again = await intent(d, 'SIX', 'same');
  assert.equal(one.status, 200, one.text);
  assert.equal(again.status, 200, 'a retry is not refused for fitting twice');
  assert.equal(rows(d).length, 1);
  assert.equal(issued(d), 600, 'and is not charged to the ceiling twice');
  assert.equal(new URLSearchParams(posted('/payment_intents')[0].body).get('metadata[promo_reservation_ref]'), rows(d)[0].ref, 'the payment carries its reservation for the webhook');
});

test('D4855 retry: the same reference twice at once is one row', async () => {
  const d = database(1000);
  insertPromo(d, 'SIX', { off: 600 });
  const e = env(d);
  const [a, b] = await Promise.all([reservePromo(e, { ...ask('SIX'), reference: 'dup' }), reservePromo(e, { ...ask('SIX'), reference: 'dup' })]);
  assert.ok(a.ok && b.ok, 'both succeed: the second is the first');
  assert.equal(rows(d).length, 1);
  assert.equal(issued(d), 600);
});

test('D4855 retry: a failed attempt releases its hold, so the retry is not blocked by it', async () => {
  const d = database(1000);
  insertPromo(d, 'SIX', { off: 600 });
  refuseIntent = true;
  const failed = await intent(d, 'SIX', 'r1');
  assert.equal(failed.status, 502);
  assert.deepEqual(rows(d).map((r) => r.state), ['released'], 'Stripe made no PaymentIntent, so nothing is held');
  assert.equal(issued(d), 0);
  refuseIntent = false;
  const retried = await intent(d, 'SIX', 'r1');
  assert.equal(retried.status, 200, retried.text);
  assert.deepEqual(rows(d).map((r) => r.state), ['reserved'], 'the same reference is taken again');
  const other = await intent(d, 'SIX', 'r2', BEA);
  assert.equal(other.body.remaining_cents, 400);
});

test('D4855: an abandoned checkout stops holding the ceiling by itself; a committed one never does', async () => {
  const d = database(1000, { period: '2026-Q3' });
  insertPromo(d, 'SIX', { off: 600 });
  const e = env(d);
  const t0 = Date.UTC(2026, 7, 15, 10, 0, 0);
  assert.ok((await reservePromo(e, { ...ask('SIX'), reference: 'abandoned' }, t0)).ok);
  const during = await canRedeemPromo(e, ask('SIX'), t0 + RESERVATION_TTL_MS - 1);
  assert.equal(during.ok, false, 'still held just inside the window');
  const after = await canRedeemPromo(e, ask('SIX'), t0 + RESERVATION_TTL_MS + 1);
  assert.equal(after.ok, true, 'free again once it lapsed');
  // The lapsed row is taken over by a new reservation under the same test.
  assert.ok((await reservePromo(e, { ...ask('SIX'), reference: 'abandoned' }, t0 + RESERVATION_TTL_MS + 1)).ok);
  await commitPromoReservation(e, rows(d)[0].ref, t0 + RESERVATION_TTL_MS + 2);
  const much = await canRedeemPromo(e, ask('SIX'), t0 + 10 * RESERVATION_TTL_MS);
  assert.equal(much.ok, false, 'committed spend counts for good');
  assert.equal((much as any).remaining_cents, 400);
});

test('D4855: a payment that succeeds after its hold lapsed is still counted; releasing never undoes a committed one', async () => {
  const d = database(1000, { period: '2026-Q3' });
  insertPromo(d, 'SIX', { off: 600 });
  const e = env(d);
  const t0 = Date.UTC(2026, 7, 15, 10, 0, 0);
  assert.ok((await reservePromo(e, { ...ask('SIX'), reference: 'late' }, t0)).ok);
  const ref = rows(d)[0].ref;
  await commitPromoReservation(e, ref, t0 + 3 * RESERVATION_TTL_MS);
  assert.deepEqual(rows(d).map((r) => r.state), ['committed']);
  await releasePromoReservation(e, ref, t0 + 3 * RESERVATION_TTL_MS);
  assert.deepEqual(rows(d).map((r) => r.state), ['committed'], 'a paid discount cannot be handed back');
  await commitPromoReservation(e, null);
  await releasePromoReservation(e, undefined);
  assert.equal(issued(d), 600);
});

test('D4855 currency: a ceiling in another currency refuses and converts nothing', async () => {
  const d = database(100000, { currency: 'EUR' });
  insertPromo(d, 'TEN', { off: 1000 });
  const res = await intent(d, 'TEN', 'n1');
  assert.equal(res.status, 400, res.text);
  assert.equal(res.body.reason, 'currency_mismatch');
  assert.equal(res.body.currency, 'EUR', 'it names the currency the ceiling is in');
  assert.deepEqual(rows(d), []);
  assert.equal(posted('/payment_intents').length, 0);
});

test('D4855 currency: a code in another currency than the sale is refused by the same rule, and a percent code carries none', async () => {
  const d = database(100000);
  insertPromo(d, 'EURCODE', { off: 500, currency: 'eur' });
  insertPromo(d, 'PCT', { percent: 10 });
  const e = env(d);
  const mismatch = await canRedeemPromo(e, ask('EURCODE'));
  assert.equal(mismatch.ok, false);
  assert.equal((mismatch as any).reason, 'currency_mismatch');
  const pct = await canRedeemPromo(e, ask('PCT'));
  assert.equal(pct.ok, true);
  assert.equal((pct as any).discountCents, 500);
  assert.equal((pct as any).ceiling.remaining_cents, 100000);
  const usd = await canRedeemPromo(e, ask('PCT', 5000, 'USD'));
  assert.equal(usd.ok, true, 'currency case does not matter');
});

test('D4855: a branch with no ceiling for this period reads "not recorded" — not unlimited, not zero', async () => {
  const none = database(null);
  insertPromo(none, 'TEN', { off: 1000 });
  const res = await intent(none, 'TEN', 'n1');
  assert.equal(res.status, 400, res.text);
  assert.equal(res.body.reason, 'ceiling_not_recorded');
  assert.equal('remaining_cents' in res.body, false, 'no figure is invented');
  assert.match(res.body.message, /ask HQ to set a ceiling/);
  assert.equal(posted('/payment_intents').length, 0);
  const stale = database(1000, { period: '2019-Q1' });
  insertPromo(stale, 'TEN', { off: 1000 });
  const old = await intent(stale, 'TEN', 'n1');
  assert.equal(old.body.reason, 'ceiling_not_recorded', 'last year\'s ceiling says nothing about this period');
});

test('D4855: a ceiling that cannot be read refuses the discount rather than waving it through', async () => {
  const d = database(1000);
  insertPromo(d, 'TEN', { off: 1000 });
  d.exec('DROP TABLE promo_ceiling_reservations');
  const res = await intent(d, 'TEN', 'n1');
  assert.equal(res.status, 400);
  assert.equal(res.body.reason, 'ceiling_unreadable');
});

test('D4855: HQ has no licence and so no ceiling — its checkouts are decided by the code\'s own terms and write no ledger row', async () => {
  const d = database(null);
  insertPromo(d, 'BIG', { off: 4000 });
  const res = await intent(d, 'BIG', 'n1', ADA, {}, null);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(rows(d), []);
  assert.equal(posted('/payment_intents').length, 1);
});

test('D4855: a checkout with no code, or a code that discounts nothing, touches no ceiling', async () => {
  const d = database(0);
  const plain = await post(d, '/api/payments/intent', ADA, { price_id: 'price_report', nonce: 'p1' });
  assert.equal(plain.status, 200, plain.text);
  insertPromo(d, 'ZERO', { percent: 0 });
  const zero = await intent(d, 'ZERO', 'z1');
  assert.equal(zero.status, 200, zero.text);
  assert.deepEqual(rows(d), []);
});

test('D4855: the preview the page validates with is the same rule — same refusal, same figure left', async () => {
  const d = database(1000);
  insertPromo(d, 'OVER', { off: 1001 });
  insertPromo(d, 'EXACT', { off: 1000 });
  const over = await post(d, '/api/payments/promo/validate', ADA, { code: 'OVER', price_id: 'price_report' });
  assert.equal(over.status, 200);
  assert.deepEqual([over.body.valid, over.body.reason, over.body.remaining_cents, over.body.currency], [false, 'ceiling_exceeded', 1000, 'USD']);
  assert.ok(over.body.message);
  const exact = await post(d, '/api/payments/promo/validate', ADA, { code: 'EXACT', price_id: 'price_report' });
  assert.equal(exact.body.valid, true);
  assert.equal(exact.body.discount_cents, 1000);
  assert.deepEqual(rows(d), [], 'a preview reserves nothing');
  const checkout = await intent(d, 'OVER', 'n1');
  assert.equal(checkout.body.reason, over.body.reason, 'checkout and preview agree');
});

test('D4855: the code\'s own terms still refuse first, with the stable reasons the page already reads', async () => {
  const d = database(100000);
  insertPromo(d, 'GONE', { off: 100, expires: '2020-01-01T00:00:00.000Z' });
  insertPromo(d, 'OFF', { off: 100, active: 0 });
  insertPromo(d, 'ONLYOTHER', { off: 100, products: '["prod_other"]' });
  insertPromo(d, 'FULL', { off: 100, max: 1 });
  insertPromo(d, 'ONCE', { off: 100, once: 1 });
  insertPromo(d, 'FIRST', { off: 100, first: 1 });
  d.prepare("UPDATE promo_codes SET times_redeemed = 1 WHERE code = 'FULL'").run();
  d.prepare("INSERT INTO promo_redemptions (promo_id, user_id, payment_intent_id) VALUES ('promo_ONCE', ?, 'pi_old')").run(ADA);
  d.prepare("INSERT INTO orders (id, order_ref, user_id, status, currency, subtotal_cents, discount_cents, vat_cents, total_cents, items_json) VALUES ('o1', 'ref1', ?, 'paid', 'usd', 5000, 0, 0, 5000, '[]')").run(ADA);
  const e = env(d);
  const reason = async (code: string) => ((await canRedeemPromo(e, ask(code))) as any).reason;
  assert.equal(await reason('NOPE'), 'not_found');
  assert.equal(await reason('GONE'), 'expired');
  assert.equal(await reason('OFF'), 'inactive');
  assert.equal(await reason('ONLYOTHER'), 'product_not_eligible');
  assert.equal(await reason('FULL'), 'usage_limit_reached');
  assert.equal(await reason('ONCE'), 'already_used');
  assert.equal(await reason('FIRST'), 'not_first_purchase');
  for (const r of ['not_found', 'expired', 'inactive', 'product_not_eligible', 'usage_limit_reached', 'already_used', 'not_first_purchase', 'ceiling_exceeded', 'ceiling_not_recorded', 'ceiling_unreadable', 'currency_mismatch'] as const) {
    assert.ok(REFUSAL_MESSAGES[r].length > 20, `${r} has a sentence`);
    assert.doesNotMatch(REFUSAL_MESSAGES[r], /undefined|\bnull\b|\b0\b/);
  }
});

test('D4855: the discount is judged on what is charged — a quantity of two doubles a percent code before the ceiling sees it', async () => {
  const d = database(900);
  insertPromo(d, 'TEN', { percent: 10 });
  const one = await intent(d, 'TEN', 'q1');
  assert.equal(one.status, 200, '10% of 5,000 is 500, within 900');
  d.prepare('DELETE FROM promo_ceiling_reservations').run();
  const two = await intent(d, 'TEN', 'q2', ADA, { quantity: 2 });
  assert.equal(two.status, 400, two.text);
  assert.deepEqual([two.body.reason, two.body.remaining_cents], ['ceiling_exceeded', 900], '10% of 10,000 is 1,000, over 900');
});

test('D4855: a free unlock (100% off) takes its whole price from the ceiling, and is refused when that does not fit', async () => {
  const d = database(1000);
  insertPromo(d, 'FREE', { percent: 100 });
  const refused = await post(d, '/api/payments/alacarte/intent', ADA, { price_id: 'price_report', promo_code: 'FREE', nonce: 'f1' });
  assert.equal(refused.status, 400, refused.text);
  assert.equal(refused.body.reason, 'ceiling_exceeded');
  assert.equal(refused.body.remaining_cents, 1000);
  assert.deepEqual(rows(d), []);
  d.prepare('UPDATE branch_promo_ceiling SET ceiling_cents = 5000').run();
  const granted = await post(d, '/api/payments/alacarte/intent', ADA, { price_id: 'price_report', promo_code: 'FREE', nonce: 'f1' });
  assert.equal(granted.status, 200, granted.text);
  assert.equal(granted.body.free, true);
  assert.deepEqual(rows(d).map((r) => [r.amount_cents, r.state]), [[5000, 'committed']], 'nothing follows a free unlock, so it counts at once');
  assert.equal(issued(d), 5000);
});

test('D4855: a paid à la carte purchase carries its reservation to the webhook, and a PaymentIntent that failed to start releases it', async () => {
  const d = database(1000);
  insertPromo(d, 'SIX', { off: 600 });
  const ok = await post(d, '/api/payments/alacarte/intent', ADA, { price_id: 'price_report', promo_code: 'SIX', nonce: 'a1' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(new URLSearchParams(posted('/payment_intents')[0].body).get('metadata[promo_reservation_ref]'), rows(d)[0].ref);
  refuseIntent = true;
  const failed = await post(d, '/api/payments/alacarte/intent', ADA, { price_id: 'price_other', promo_code: 'SIX', nonce: 'a2' }, 'lagos');
  assert.equal(failed.status, 400, 'only 400 left: the second 600 does not fit');
  refuseIntent = false;
  insertPromo(d, 'TWO', { off: 300 });
  refuseIntent = true;
  const broke = await post(d, '/api/payments/alacarte/intent', BEA, { price_id: 'price_other', promo_code: 'TWO', nonce: 'a3' });
  assert.equal(broke.status, 502);
  assert.deepEqual(rows(d).map((r) => r.state).sort(), ['released', 'reserved']);
  assert.equal(issued(d), 600);
});

test('D4855: a subscription start reserves its first invoice\'s discount, stamps it on the subscription, and is refused over the ceiling', async () => {
  const d = database(1000);
  insertPromo(d, 'PCT20', { percent: 20 });
  insertPromo(d, 'SMALL', { off: 600 });
  const over = await post(d, '/api/payments/intent', ADA, { price_id: 'price_growth_m', promo_code: 'PCT20', nonce: 's1' });
  assert.equal(over.status, 400, over.text);
  assert.deepEqual([over.body.reason, over.body.remaining_cents], ['ceiling_exceeded', 1000], '20% of 7,900 is 1,580');
  assert.equal(posted('/subscriptions').length, 0);
  const ok = await post(d, '/api/payments/intent', ADA, { price_id: 'price_growth_m', promo_code: 'SMALL', nonce: 's2' });
  assert.equal(ok.status, 200, ok.text);
  const sent = new URLSearchParams(posted('/subscriptions')[0].body);
  assert.equal(sent.get('metadata[promo_reservation_ref]'), rows(d)[0].ref);
  assert.equal(sent.get('discounts[0][promotion_code]'), 'promo_SMALL');
  assert.deepEqual(rows(d).map((r) => [r.amount_cents, r.state]), [[600, 'reserved']]);
  const again = await post(d, '/api/payments/intent', ADA, { price_id: 'price_growth_m', promo_code: 'SMALL', nonce: 's2' });
  assert.equal(again.status, 200);
  assert.equal(rows(d).length, 1, 'the retry reserved nothing more');
});

test('D4855: a subscription Stripe refused gives its discount back', async () => {
  const d = database(1000);
  insertPromo(d, 'SMALL', { off: 600 });
  refuseSubscription = true;
  const res = await post(d, '/api/payments/intent', ADA, { price_id: 'price_growth_m', promo_code: 'SMALL', nonce: 's3' });
  assert.equal(res.status, 502, res.text);
  assert.deepEqual(rows(d).map((r) => r.state), ['released']);
  assert.equal(issued(d), 0);
});

test('D4855: the first paid invoice commits the subscription\'s reservation', async () => {
  const d = database(1000);
  insertPromo(d, 'SMALL', { off: 600 });
  const e = env(d);
  assert.ok((await reservePromo(e, { ...ask('SMALL'), reference: 'sub-key' })).ok);
  const ref = rows(d)[0].ref;
  const { recordInvoiceRedemption } = await import('../src/services/promoUsage.ts');
  await recordInvoiceRedemption(e, {
    billing_reason: 'subscription_create', subscription: 'sub_abc123', total_discount_amounts: [{ amount: 600 }],
    subscription_details: { metadata: { promo_code_id: 'promo_SMALL', user_id: String(ADA), promo_reservation_ref: ref } },
    currency: 'usd', subtotal: 5000, lines: { data: [] },
  });
  assert.deepEqual(rows(d).map((r) => r.state), ['committed']);
});

test('D4855 cart: a cart code is judged by the same rule, and reserves once for the whole cart', async () => {
  const d = database(1000);
  insertPromo(d, 'SIX', { off: 600 });
  insertPromo(d, 'OVER', { off: 1001 });
  const e = env(d);
  const cart = { lines: [{ product_id: 'prod_report' }, { product_id: 'prod_other' }], subtotal: 8000, currency: 'usd' } as any;
  const over = await resolveCartPromo(e, 'OVER', cart, ADA, 'cart:ord_1') as any;
  assert.equal(over.error, 'ceiling_exceeded');
  assert.equal(over.refusal.remaining_cents, 1000);
  assert.deepEqual(promoRefusalBody(over.refusal).reason, 'ceiling_exceeded');
  assert.deepEqual(rows(d), []);
  const checkOnly = await resolveCartPromo(e, 'SIX', cart, ADA) as any;
  assert.equal(checkOnly.discountCents, 600);
  assert.equal(checkOnly.reservationRef, null, 'no reference, no reservation');
  const ok = await resolveCartPromo(e, 'SIX', cart, ADA, 'cart:ord_1') as any;
  const again = await resolveCartPromo(e, 'SIX', cart, ADA, 'cart:ord_1') as any;
  assert.equal(ok.reservationRef, again.reservationRef);
  assert.equal(rows(d).length, 1);
  assert.equal(rows(d)[0].amount_cents, 600);
  const next = await resolveCartPromo(e, 'SIX', cart, BEA, 'cart:ord_2') as any;
  assert.equal(next.error, 'ceiling_exceeded', 'the second cart does not fit in what the first left');
  assert.equal(next.refusal.remaining_cents, 400);
});

test('D4855: a refusal is a typed body — stable code, our sentence, what is left', () => {
  const body = promoRefusalBody({ ok: false, reason: 'ceiling_exceeded', message: REFUSAL_MESSAGES.ceiling_exceeded, remaining_cents: 250, currency: 'USD' });
  assert.deepEqual(body, { error: 'promo_invalid', reason: 'ceiling_exceeded', message: REFUSAL_MESSAGES.ceiling_exceeded, detail: REFUSAL_MESSAGES.ceiling_exceeded, remaining_cents: 250, currency: 'USD' });
  const plain = promoRefusalBody({ ok: false, reason: 'expired', message: REFUSAL_MESSAGES.expired });
  assert.equal('remaining_cents' in plain, false, 'a refusal about the code states no figure');
});

test('D4855: no checkout path asks the code\'s terms directly — they all go through promoRedemption', () => {
  const root = new URL('../src/', import.meta.url);
  const offenders: string[] = [];
  const walk = (dir: URL) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
      if (e.isDirectory()) { walk(u); continue; }
      if (!/\.ts$/.test(e.name) || /promos\.ts$|promoRedemption\.ts$/.test(e.name)) continue;
      if (/\bvalidatePromoForProduct\b/.test(readFileSync(u, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))) offenders.push(u.pathname.split('/src/')[1]);
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], 'these call the terms-only check and skip the ceiling');
  for (const f of ['routes/payments.ts', 'routes/orders.ts', 'routes/billing_checkout.ts', 'services/influencerOffers.ts']) {
    assert.match(readFileSync(new URL(f, root), 'utf8'), /promoRedemption|canRedeemPromo|resolveCartPromo/, `${f} uses the shared rule`);
  }
});

// ── The payment webhook closes the hold ─────────────────────────────────────

const WEBHOOK = 'd4855-fixture-only-webhook-secret';
async function webhook(env: any, type: string, object: Record<string, unknown>) {
  const body = JSON.stringify({ id: `evt_${object.id}`, livemode: false, type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(WEBHOOK), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)))).map((n) => n.toString(16).padStart(2, '0')).join('');
  return billingRoute.request('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}`, 'content-type': 'application/json' }, body }, env);
}

test('D4855: payment_intent.succeeded commits the reservation the PaymentIntent carries — once, and for a lapsed one too', async () => {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'super_admins', 'user_sessions', 'mi_pro_subscriptions', 'promo_codes', 'promo_redemptions', 'admin_audit_log', 'activity_logs']) {
    d.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  for (const m of ['277_user_recovery_state.sql', '631_promo_redemption_detail.sql', '097_stripe_products.sql', '691_stripe_mode_stamps.sql', '202611071527_promo_ceiling_reservations.sql']) d.exec(read(m));
  d.exec(BRANCH_CEILING);
  d.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)').run(ADA, 'founder', 'Ada Quill', 'ada@example.test');
  d.prepare("INSERT INTO promo_codes (id, code, code_normalized, coupon_id, percent_off, amount_off, currency) VALUES ('promo_SIX', 'SIX', 'SIX', 'c', NULL, 600, 'usd')").run();
  d.prepare('INSERT INTO branch_promo_ceiling (id, period, ceiling_cents, currency, issued_cents, pushed_at) VALUES (1, ?, 1000, ?, 0, ?)').run(PERIOD, 'USD', '2026-01-01T00:00:00.000Z');
  const e = { ...env(d), STRIPE_WEBHOOK_SECRET: WEBHOOK };
  const held = await reservePromo(e, { ...ask('SIX'), reference: 'pi-key' });
  assert.ok(held.ok);
  const ref = rows(d)[0].ref;
  // The hold lapsed before the card was confirmed.
  d.prepare("UPDATE promo_ceiling_reservations SET expires_at = '2020-01-01T00:00:00.000Z'").run();
  assert.equal((await canRedeemPromo(e, ask('SIX'))).ok, true, 'lapsed, so it holds nothing');
  const pi = { id: 'pi_paid', amount: 4400, currency: 'usd', metadata: { promo_code_id: 'promo_SIX', user_id: String(ADA), promo_reservation_ref: ref } };
  for (let i = 0; i < 2; i++) assert.equal((await webhook(e, 'payment_intent.succeeded', pi)).status, 200);
  assert.deepEqual(rows(d).map((r) => r.state), ['committed']);
  assert.equal(issued(d), 600);
  const after = await canRedeemPromo(e, ask('SIX'));
  assert.equal(after.ok, false, 'money was taken, so it counts');
  assert.equal((after as any).remaining_cents, 400);
  await webhook(e, 'payment_intent.succeeded', { id: 'pi_plain', amount: 5000, currency: 'usd', metadata: { user_id: String(ADA) } });
  assert.equal(rows(d).length, 1, 'a payment with no reservation writes none');
});
