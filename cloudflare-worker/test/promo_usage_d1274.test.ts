/**
 * D1274 (#3300) — Promo codes part 4: every redemption says what it was for,
 * a subscription's redemption is recorded once from its first paid invoice,
 * and HQ reads usage, a code's redemptions and history, and a CSV export.
 *
 * A block without data says why (`no_redemptions`, `not_recorded`,
 * `unreadable`), never 0. Stripe is stubbed in every case.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import adminPromos from '../src/routes/admin_promos.ts';
import billingRoute from '../src/routes/billing.ts';
import { recordPaidRedemption, fulfilFreeUnlock, getPromoById } from '../src/services/promos.ts';
import { recordInvoiceRedemption, parseRange, weekOf, usageRead, EXPORT_HEADER } from '../src/services/promoUsage.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'd1274-fixture-only-signing-secret';
const WEBHOOK = 'd1274-fixture-only-webhook-secret';
const HQ = 901, PLAIN = 902, MEMBER = 7, OTHER_MEMBER = 8;
const NOW = new Date('2026-10-26T12:00:00Z');
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const baseline = read('../sql/schema_baseline.sql');
const MIGRATION_631 = read('../sql/migrations/631_promo_redemption_detail.sql');

function fixture(opts: { failOn?: RegExp } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['users', 'super_admins', 'user_sessions', 'mi_pro_subscriptions', 'promo_codes', 'promo_redemptions', 'admin_audit_log', 'activity_logs']) {
    db.exec(stripForeignKeys(tableFromBaseline(baseline, name)));
  }
  db.exec(read('../sql/migrations/277_user_recovery_state.sql'));
  db.exec(MIGRATION_631);
  db.exec(read('../sql/migrations/097_stripe_products.sql'));
  db.exec(read('../sql/migrations/691_stripe_mode_stamps.sql'));
  const user = db.prepare('INSERT INTO users (id,role,name,email) VALUES (?, ?, ?, ?)');
  user.run(HQ, 'admin', 'Hana HQ', 'hq@example.test');
  user.run(PLAIN, 'admin', 'Pat Admin', 'admin@example.test');
  user.run(MEMBER, 'founder', 'Mia Member', 'mia@example.test');
  user.run(OTHER_MEMBER, 'founder', 'Ola Other', 'ola@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HQ);
  const promo = db.prepare(`INSERT INTO promo_codes (id,code,code_normalized,coupon_id,percent_off,max_redemptions,times_redeemed,active,expires_at)
    VALUES (?, ?, ?, ?, 20, ?, ?, ?, ?)`);
  promo.run('promo_launch', 'LAUNCH20', 'LAUNCH20', 'co_launch', 200, 0, 1, '2027-01-04T00:00:00.000Z');
  promo.run('promo_demo', 'DEMODAY', 'DEMODAY', 'co_demo', 50, 3, 1, '2026-10-31T00:00:00.000Z'); // ends in 5 days
  promo.run('promo_full', 'PRESS50', 'PRESS50', 'co_full', 2, 2, 1, null); // at its cap
  promo.run('promo_off', 'OLDCODE', 'OLDCODE', 'co_off', 10, 10, 0, '2026-10-28T00:00:00.000Z'); // paused: never near its end
  promo.run('promo_past', 'SUMMER', 'SUMMER', 'co_past', 5, 5, 1, '2026-10-01T00:00:00.000Z'); // ended, at its cap: neither
  const d1 = d1Over(db);
  const env = {
    DB: { ...d1, prepare(sql: string) {
      if (opts.failOn?.test(sql)) throw new Error('D1_ERROR: fixture refused');
      return d1.prepare(sql);
    } },
    JWT_SECRET: SECRET, STRIPE_WEBHOOK_SECRET: WEBHOOK, STRIPE_SECRET_KEY: 'sk_test_fixture', ENVIRONMENT: 'development',
  } as any;
  const app = new Hono<any>();
  app.route('/api/admin/promos', adminPromos);
  app.onError((err, c) => {
    const status = AUTH_ERROR_STATUSES[err.message];
    if (!status) throw err;
    return c.json({ detail: err.message }, status);
  });
  async function call(path: string, id = HQ) {
    db.prepare("INSERT OR IGNORE INTO user_sessions (user_id,jti,factor,created_at) VALUES (?, ?, 'totp', datetime('now'))").run(id, `j${id}`);
    const token = await new SignJWT({ user_id: id, jti: `j${id}` }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    return app.request(`/api/admin/promos${path}`, { headers: { Authorization: `Bearer ${token}` } }, env);
  }
  const rows = (sql: string, ...b: any[]) => db.prepare(sql).all(...b).map((r: any) => ({ ...r }));
  return { db, env, call, rows };
}

/** Stripe, stubbed: each answer is keyed by the path it serves. Every other call fails the test. */
function stubStripe(answers: Record<string, unknown | Error>) {
  const before = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const path = String(url).replace('https://api.stripe.com/v1', '').split('?')[0];
    calls.push(path);
    if (!(path in answers)) throw new Error(`no Stripe stub answers ${path}`);
    const a = answers[path];
    if (a instanceof Error) return new Response(JSON.stringify({ error: { message: 'stubbed failure' } }), { status: 500 });
    return new Response(JSON.stringify(a), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
  return { calls, restore: () => { globalThis.fetch = before; } };
}

const seed = (f: any, rows: [string, number, string, string, string | null, ...any[]][]) => {
  const ins = f.db.prepare(`INSERT INTO promo_redemptions (promo_id,user_id,payment_intent_id,created_at,source,product_id,price_id,billing_interval,amount_before_cents,discount_cents,currency)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  for (const r of rows) ins.run(...r, ...Array(11 - r.length).fill(null));
};

// ---------------------------------------------------------------- recording

/** Stripe's first invoice for a subscription that took LAUNCH20, as `invoice.paid` carries it. */
const FIRST_INVOICE = (extra: Record<string, unknown> = {}) => ({
  id: 'in_first', billing_reason: 'subscription_create', subscription: 'sub_abc', currency: 'usd',
  subtotal: 2000, total_discount_amounts: [{ amount: 400, discount: 'di_1' }],
  subscription_details: { metadata: { promo_code_id: 'promo_launch', user_id: String(MEMBER) } },
  lines: { data: [{ price: { id: 'price_advmonthly', product: 'prod_advisorpro', recurring: { interval: 'month' } } }] },
  ...extra,
});

test('a subscription redemption is recorded once, with its detail, and never bumps the mirror count', async () => {
  const f = fixture();
  await recordInvoiceRedemption(f.env, FIRST_INVOICE());
  await recordInvoiceRedemption(f.env, FIRST_INVOICE()); // a re-delivered invoice
  await recordInvoiceRedemption(f.env, FIRST_INVOICE({ id: 'in_second', billing_reason: 'subscription_cycle' })); // the renewal
  // A renewal is never a redemption, even of a subscription not yet recorded.
  await recordInvoiceRedemption(f.env, FIRST_INVOICE({ id: 'in_other', subscription: 'sub_other', billing_reason: 'subscription_cycle' }));
  assert.deepEqual(
    f.rows('SELECT promo_id,user_id,payment_intent_id,source,product_id,price_id,billing_interval,amount_before_cents,discount_cents,currency FROM promo_redemptions'),
    [{ promo_id: 'promo_launch', user_id: MEMBER, payment_intent_id: 'sub:sub_abc', source: 'subscription', product_id: 'prod_advisorpro',
      price_id: 'price_advmonthly', billing_interval: 'month', amount_before_cents: 2000, discount_cents: 400, currency: 'usd' }],
  );
  // Stripe counts it in its own times_redeemed; checkout adds that to the mirror's.
  assert.equal((await getPromoById(f.env, 'promo_launch'))!.times_redeemed, 0);
});

test('an invoice without the metadata reads the subscription; one without a discount, a code or a user records nothing', async () => {
  const f = fixture();
  const stripe = stubStripe({ '/subscriptions/sub_old': { metadata: { promo_code_id: 'promo_launch', user_id: String(OTHER_MEMBER) } } });
  try {
    await recordInvoiceRedemption(f.env, FIRST_INVOICE({ subscription: 'sub_old', subscription_details: undefined }));
    assert.deepEqual(stripe.calls, ['/subscriptions/sub_old']);
    // No discount: not a redemption, and Stripe is not asked.
    await recordInvoiceRedemption(f.env, FIRST_INVOICE({ subscription: 'sub_full', total_discount_amounts: [], subscription_details: undefined }));
    // A code the mirror does not hold, and no member: nothing.
    await recordInvoiceRedemption(f.env, FIRST_INVOICE({ subscription: 'sub_x', subscription_details: { metadata: { promo_code_id: 'promo_gone', user_id: '7' } } }));
    await recordInvoiceRedemption(f.env, FIRST_INVOICE({ subscription: 'sub_y', subscription_details: { metadata: { promo_code_id: 'promo_launch' } } }));
    await recordInvoiceRedemption(f.env, FIRST_INVOICE({ subscription: 'sub_z', subscription_details: { metadata: { promo_code_id: 'promo_launch', user_id: '0' } } }));
    assert.deepEqual(stripe.calls, ['/subscriptions/sub_old']);
  } finally { stripe.restore(); }
  assert.deepEqual(f.rows('SELECT user_id,payment_intent_id FROM promo_redemptions'), [{ user_id: OTHER_MEMBER, payment_intent_id: 'sub:sub_old' }]);
});

test('a failed Stripe read never fails the webhook, and records nothing', async () => {
  const f = fixture();
  const stripe = stubStripe({ '/subscriptions/sub_old': new Error('down') });
  try {
    await recordInvoiceRedemption(f.env, FIRST_INVOICE({ subscription: 'sub_old', subscription_details: undefined }));
  } finally { stripe.restore(); }
  assert.equal(f.rows('SELECT * FROM promo_redemptions').length, 0);
});

async function webhook(f: any, type: string, object: Record<string, unknown>) {
  const body = JSON.stringify({ id: `evt_${object.id}`, livemode: false, type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(WEBHOOK), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)))).map((n) => n.toString(16).padStart(2, '0')).join('');
  return billingRoute.request('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}`, 'content-type': 'application/json' }, body }, f.env);
}

test('a paid one-time redemption records the detail checkout stamped, once; a PaymentIntent from before it records none, never 0', async () => {
  const f = fixture();
  const pi = { id: 'pi_one', amount: 1600, currency: 'usd', metadata: {
    promo_code_id: 'promo_launch', user_id: String(MEMBER), price_id: 'price_report', product_id: 'prod_report',
    promo_amount_before: '2000', promo_discount: '400' } };
  for (let i = 0; i < 2; i++) assert.equal((await webhook(f, 'payment_intent.succeeded', pi)).status, 200);
  await webhook(f, 'payment_intent.succeeded', { id: 'pi_legacy', amount: 900, currency: 'eur', metadata: { promo_code_id: 'promo_launch', user_id: String(MEMBER) } });
  assert.deepEqual(
    f.rows('SELECT payment_intent_id,source,product_id,price_id,billing_interval,amount_before_cents,discount_cents,currency FROM promo_redemptions ORDER BY id'),
    [
      { payment_intent_id: 'pi_one', source: 'payment', product_id: 'prod_report', price_id: 'price_report', billing_interval: null, amount_before_cents: 2000, discount_cents: 400, currency: 'usd' },
      { payment_intent_id: 'pi_legacy', source: 'payment', product_id: null, price_id: null, billing_interval: null, amount_before_cents: null, discount_cents: null, currency: 'eur' },
    ],
  );
  assert.equal((await getPromoById(f.env, 'promo_launch'))!.times_redeemed, 2, 'one-time redemptions still count in the mirror');
});

test('a cart redemption names its product only when it holds one, and the detail is written once', async () => {
  const f = fixture();
  const one = { source: 'cart' as const, productId: 'prod_report', priceId: 'price_report', amountBeforeCents: 5000, discountCents: 1000, currency: 'USD' };
  await recordPaidRedemption(f.env, { promoId: 'promo_launch', userId: MEMBER, paymentIntentId: 'pi_cart', detail: one });
  // A re-delivery with other figures does not rewrite what was recorded.
  await recordPaidRedemption(f.env, { promoId: 'promo_launch', userId: MEMBER, paymentIntentId: 'pi_cart', detail: { ...one, discountCents: 9 } });
  // Malformed fields are NULL, never coerced.
  await recordPaidRedemption(f.env, { promoId: 'promo_launch', userId: MEMBER, paymentIntentId: 'order:A1', detail: { source: 'cart', productId: 'not a product', amountBeforeCents: -5, discountCents: 1.5, currency: 'dollars' } });
  assert.deepEqual(f.rows('SELECT payment_intent_id,source,product_id,amount_before_cents,discount_cents,currency FROM promo_redemptions ORDER BY id'), [
    { payment_intent_id: 'pi_cart', source: 'cart', product_id: 'prod_report', amount_before_cents: 5000, discount_cents: 1000, currency: 'usd' },
    { payment_intent_id: 'order:A1', source: 'cart', product_id: null, amount_before_cents: null, discount_cents: null, currency: null },
  ]);
  // The cart path passes one product only when the cart holds one.
  const orders = read('../src/services/orders.ts');
  assert.match(orders, /source: 'cart',\s*productId: products\.size === 1 \? \[\.\.\.products\]\[0\] : null,/);
});

test('a free unlock records the whole price as its discount; one refused at the cap records nothing', async () => {
  const f = fixture();
  const detail = { productId: 'prod_report', priceId: 'price_report', amountBeforeCents: 2000, discountCents: 2000, currency: 'usd' };
  const promo = (await getPromoById(f.env, 'promo_full'))!;
  assert.equal(await fulfilFreeUnlock(f.env, { promo, userId: MEMBER, featureKey: 'report', detail }), false, 'PRESS50 is at its cap');
  const open = (await getPromoById(f.env, 'promo_launch'))!;
  assert.equal(await fulfilFreeUnlock(f.env, { promo: open, userId: MEMBER, featureKey: 'report', detail }), true);
  assert.deepEqual(f.rows('SELECT promo_id,source,amount_before_cents,discount_cents FROM promo_redemptions'), [
    { promo_id: 'promo_launch', source: 'free_unlock', amount_before_cents: 2000, discount_cents: 2000 },
  ]);
  // Checkout passes the whole price as the discount, because nothing is charged.
  const payments = read('../src/routes/payments.ts');
  assert.match(payments, /amountBeforeCents: found\.price\.unit_amount,\s*discountCents: found\.price\.unit_amount,/);
});

// ---------------------------------------------------------------- reads

/** Redemptions in the default range (the twelve weeks to 26 Oct), from every source, plus legacy rows with no detail. */
function seeded(f: any) {
  seed(f, [
    ['promo_launch', MEMBER, 'pi_a', '2026-10-20 09:00:00', 'payment', 'prod_report', 'price_report', null, 2000, 400, 'usd'],
    ['promo_launch', OTHER_MEMBER, 'pi_b', '2026-10-21 09:00:00', 'cart', 'prod_report', 'price_report', null, 3000, 600, 'usd'],
    ['promo_launch', OTHER_MEMBER, 'sub:sub_c', '2026-10-26 08:00:00', 'subscription', 'prod_advisorpro', 'price_adv', 'month', 2000, 400, 'usd'],
    ['promo_demo', MEMBER, 'pi_d', '2026-10-14 09:00:00', 'free_unlock', 'prod_report', 'price_report', null, 1000, 1000, 'eur'],
    ['promo_demo', MEMBER, 'pi_e', '2026-09-01 09:00:00', null], // before 631: no detail
    ['promo_launch', MEMBER, 'pi_old', '2026-07-01 09:00:00', 'payment', 'prod_report', null, null, 100, 10, 'usd'], // outside the range
  ]);
}

test('the range: twelve weeks by default; a bad, reversed or too-long range, or a bad code, is refused', () => {
  assert.deepEqual(parseRange({}, NOW), { ok: true, range: { from: '2026-08-04', to: '2026-10-26', promoId: null } });
  assert.deepEqual(parseRange({ from: '2026-10-01', to: '2026-10-07', promo: 'promo_demo' }, NOW), { ok: true, range: { from: '2026-10-01', to: '2026-10-07', promoId: 'promo_demo' } });
  for (const q of [{ from: '2026-02-30' }, { from: '2026-10-08', to: '2026-10-07' }, { from: '2025-10-01', to: '2026-10-02' }, { to: 'today' }]) {
    assert.deepEqual(parseRange(q, NOW), { ok: false, code: 'invalid_range' }, JSON.stringify(q));
  }
  assert.deepEqual(parseRange({ promo: "promo_x' OR 1=1" }, NOW), { ok: false, code: 'invalid_promo' });
  assert.equal(parseRange({ from: '2025-10-26', to: '2026-10-26' }, NOW).ok, true, '366 days is allowed');
  assert.equal(weekOf('2026-10-26'), '2026-10-26'); // a Monday
  assert.equal(weekOf('2026-11-01'), '2026-10-26'); // the Sunday after
});

test('usage: weeks by source with legacy rows as not recorded, each currency apart, top codes, products and codes near their end', async () => {
  const f = fixture();
  seeded(f);
  const u = await usageRead(f.env, parseRange({}, NOW).range as any, NOW);
  assert.equal(u.redemptions.available, true);
  const r = u.redemptions as any;
  assert.deepEqual([r.total, r.members], [5, 2]);
  assert.equal(r.weeks.length, 13, 'every week of the range, empty ones as measured 0');
  assert.deepEqual(r.weeks.at(-1), { week: '2026-10-26', cart: 0, payment: 0, free_unlock: 0, subscription: 1, not_recorded: 0 });
  assert.deepEqual(r.weeks.at(-2), { week: '2026-10-19', cart: 1, payment: 1, free_unlock: 0, subscription: 0, not_recorded: 0 });
  assert.deepEqual(r.weeks.find((w: any) => w.week === '2026-08-31'), { week: '2026-08-31', cart: 0, payment: 0, free_unlock: 0, subscription: 0, not_recorded: 1 });
  assert.equal(r.detail_recorded_from, '2026-07-01 09:00:00');
  assert.deepEqual(u.discount, { available: true, reason: null, not_recorded: 1, currencies: [
    { currency: 'usd', redemptions: 3, discount_cents: 1400, average_cents: 467 },
    { currency: 'eur', redemptions: 1, discount_cents: 1000, average_cents: 1000 },
  ] });
  assert.deepEqual((u.top_codes as any).codes.map((c: any) => [c.code, c.redeemed, c.max_redemptions]), [['LAUNCH20', 3, 200], ['DEMODAY', 2, 50]]);
  assert.deepEqual(u.products, { available: true, reason: null, not_recorded: 1, rows: [
    { product_id: 'prod_report', name: null, price_id: 'price_report', interval: null, redemptions: 3 },
    { product_id: 'prod_advisorpro', name: null, price_id: 'price_adv', interval: 'month', redemptions: 1 },
  ] });
  assert.deepEqual((u.near_end as any).codes.map((c: any) => [c.code, c.at_cap, c.ends_in_days]), [['PRESS50', true, null], ['DEMODAY', false, 5]]);
});

test('a block without data says why, never 0: no redemptions, not recorded, and one unreadable block beside readable ones', async () => {
  const empty = fixture();
  const e = await usageRead(empty.env, parseRange({}, NOW).range as any, NOW);
  assert.equal((e.redemptions as any).total, 0, 'a count of none is measured');
  for (const b of [e.discount, e.top_codes, e.products]) assert.deepEqual(b, { available: false, reason: 'no_redemptions' });

  const legacy = fixture();
  seed(legacy, [['promo_demo', MEMBER, 'pi_e', '2026-09-01 09:00:00', null]]);
  const l = await usageRead(legacy.env, parseRange({}, NOW).range as any, NOW);
  assert.deepEqual(l.discount, { available: false, reason: 'not_recorded' });
  assert.deepEqual(l.products, { available: false, reason: 'not_recorded' });
  assert.equal((l.redemptions as any).detail_recorded_from, null);

  const broken = fixture({ failOn: /SUM\(r\.discount_cents\)/ });
  seeded(broken);
  const b = await usageRead(broken.env, parseRange({}, NOW).range as any, NOW);
  assert.deepEqual(b.discount, { available: false, reason: 'unreadable' });
  assert.equal(b.top_codes.available, true, 'one failed block never blanks the others');
  const total = fixture({ failOn: /COUNT\(DISTINCT r\.user_id\)/ });
  const t = await usageRead(total.env, parseRange({}, NOW).range as any, NOW);
  for (const x of [t.redemptions, t.discount, t.top_codes, t.products]) assert.deepEqual(x, { available: false, reason: 'unreadable' });
  assert.equal(t.near_end.available, true);
});

test('a code filter narrows every block to that code', async () => {
  const f = fixture();
  seeded(f);
  const u = await usageRead(f.env, parseRange({ promo: 'promo_demo' }, NOW).range as any, NOW);
  assert.equal((u.redemptions as any).total, 2);
  assert.deepEqual((u.top_codes as any).codes.map((c: any) => c.code), ['DEMODAY']);
  assert.deepEqual((u.near_end as any).codes.map((c: any) => c.code), ['DEMODAY']);
});

test('the routes are HQ Super Admin only, and refuse a bad range', async () => {
  const f = fixture();
  for (const p of ['/usage', '/export.csv', '/promo_launch/redemptions', '/promo_launch/history']) {
    assert.equal((await f.call(p, PLAIN)).status, 403, p);
  }
  const bad = await f.call('/usage?from=2026-10-08&to=2026-10-07');
  assert.equal(bad.status, 400);
  assert.equal((await bad.json() as any).code, 'invalid_range');
  assert.equal((await f.call('/export.csv?promo=nope')).status, 400);
  assert.equal((await f.call('/promo_nope/history')).status, 404);
  assert.equal((await f.call('/usage')).status, 200);
});

test('a code’s redemptions, newest first, with Stripe’s own count beside them; Stripe unread is said', async () => {
  const f = fixture();
  seeded(f);
  let stripe = stubStripe({ '/promotion_codes/promo_launch': { id: 'promo_launch', times_redeemed: 41 } });
  try {
    const body = await (await f.call('/promo_launch/redemptions')).json() as any;
    assert.deepEqual(body.stripe, { available: true, reason: null, times_redeemed: 41 });
    assert.deepEqual(body.redemptions.rows.map((r: any) => [r.created_at, r.member, r.source]), [
      ['2026-10-26 08:00:00', 'Ola Other', 'subscription'], ['2026-10-21 09:00:00', 'Ola Other', 'cart'],
      ['2026-10-20 09:00:00', 'Mia Member', 'payment'], ['2026-07-01 09:00:00', 'Mia Member', 'payment'],
    ]);
    assert.equal(body.mirror_redeemed, 0);
  } finally { stripe.restore(); }
  stripe = stubStripe({ '/promotion_codes/promo_launch': new Error('down') });
  try {
    const body = await (await f.call('/promo_launch/redemptions')).json() as any;
    assert.deepEqual(body.stripe, { available: false, reason: 'unreadable' });
    assert.equal(body.redemptions.available, true);
  } finally { stripe.restore(); }
});

test('a code’s history: its own audit rows, oldest first, with only the fields a history shows', async () => {
  const f = fixture();
  const audit = f.db.prepare("INSERT INTO admin_audit_log (admin_user_id,action,report_type,filters_json,exported_at) VALUES (?, ?, ?, ?, ?)");
  audit.run(HQ, 'promo_create', 'billing', JSON.stringify({ promo_id: 'promo_launch', coupon_id: 'co_launch', code: 'LAUNCH20', percent_off: 20 }), '2026-10-01 10:00:00');
  audit.run(HQ, 'promo_update', 'billing', JSON.stringify({ promo_id: 'promo_demo', active: false }), '2026-10-02 10:00:00');
  audit.run(HQ, 'promo_update', 'billing', JSON.stringify({ promo_id: 'promo_launch', active: false }), '2026-10-03 10:00:00');
  audit.run(HQ, 'promo_export', 'billing', JSON.stringify({ promo_id: 'promo_launch', rows: 4 }), '2026-10-04 10:00:00');
  audit.run(HQ, 'promo_update', 'other', JSON.stringify({ promo_id: 'promo_launch', active: true }), '2026-10-05 10:00:00');
  audit.run(HQ, 'promo_delete', 'billing', 'not json', '2026-10-06 10:00:00');
  // D1272 lifecycle actions must stay visible in D1274's history after merging.
  for (const [i, action] of ['promo_pause', 'promo_resume', 'promo_end'].entries()) {
    audit.run(HQ, action, 'billing', JSON.stringify({ promo_id: 'promo_launch', reason: 'fixture-only detail' }), `2026-10-0${i + 7} 10:00:00`);
  }
  const body = await (await f.call('/promo_launch/history')).json() as any;
  assert.deepEqual(body.history, { available: true, reason: null, events: [
    { at: '2026-10-01 10:00:00', action: 'promo_create', by: { id: HQ, name: 'Hana HQ' }, change: { code: 'LAUNCH20', percent_off: 20 } },
    { at: '2026-10-03 10:00:00', action: 'promo_update', by: { id: HQ, name: 'Hana HQ' }, change: { active: false } },
    ...['promo_pause', 'promo_resume', 'promo_end'].map((action, i) => ({ at: `2026-10-0${i + 7} 10:00:00`, action, by: { id: HQ, name: 'Hana HQ' }, change: {} })),
  ] });
});

test('the export: the range’s redemptions, a blank cell for what was not recorded, and an audit row with the count', async () => {
  const f = fixture();
  seeded(f);
  const res = await f.call('/export.csv?from=2026-09-01&to=2026-10-20');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
  const lines = (await res.text()).split('\r\n');
  assert.equal(lines[0], EXPORT_HEADER.join(','));
  assert.deepEqual(lines.slice(1), [
    `2026-09-01 09:00:00,DEMODAY,promo_demo,${MEMBER},,,,,,,`,
    `2026-10-14 09:00:00,DEMODAY,promo_demo,${MEMBER},free_unlock,prod_report,price_report,,1000,1000,eur`,
    `2026-10-20 09:00:00,LAUNCH20,promo_launch,${MEMBER},payment,prod_report,price_report,,2000,400,usd`,
  ]);
  assert.deepEqual(f.rows("SELECT admin_user_id,action,report_type,filters_json FROM admin_audit_log WHERE action = 'promo_export'"), [
    { admin_user_id: HQ, action: 'promo_export', report_type: 'billing', filters_json: JSON.stringify({ from: '2026-09-01', to: '2026-10-20', promo_id: null, rows: 3, truncated: false }) },
  ]);
});

test('the wiring: the webhook records the first paid invoice; checkout stamps the detail; no raw-interpolated SQL', () => {
  const billing = read('../src/routes/billing.ts');
  assert.match(billing, /case 'invoice\.paid':[\s\S]*?if \(event\.type === 'invoice\.paid'\) \{[\s\S]*?await recordInvoiceRedemption\(env, obj\);/);
  const payments = read('../src/routes/payments.ts');
  assert.equal((payments.match(/promoDetailMeta\(found\.product\.id,/g) || []).length, 2, 'both one-time intents stamp the detail');
  const usage = read('../src/services/promoUsage.ts');
  assert.ok(!/\.prepare\(\s*`[^`]*\$\{/.test(usage), 'every statement is a literal');
});
