/**
 * D790 (#2215) — token pack offers: a bonus offered only inside its window,
 * first-purchase packs, and HQ's checks. On D755's D1 harness (migrations 486
 * and 509); Stripe is stubbed, and a URL no stub answers fails the test.
 *
 * What D755 already proves and these tests lean on: the bonus quoted at
 * checkout is stored on the purchase row and credited once beside the pack,
 * and refunds and disputes reverse credit + bonus in proportion
 * (`ai_credit_reversals_d755.test.ts`). Here: the window decides the quoted
 * bonus; a later edit never changes a paid order; a first-purchase pack is
 * refused at checkout (409, a sentence), and at the webhook it is credited
 * without its bonus, which a refund then never takes back.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/token_pack_offers_d790.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { readFileSync } from 'node:fs';
import { ensureCatalogSchema } from '../src/services/catalog.ts';
import { ensureOrdersSchema } from '../src/services/orders.ts';
import { recordAiTopupPurchase, creditAiTopupFromPayment, resetAiTopupMirrorWindow } from '../src/services/aiTopups.ts';
import { ledgerBalance, offerOpen, packsOnSale, tokenPackQuote } from '../src/services/aiCredits.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import ordersRoute from '../src/routes/orders.ts';
import billingRoute from '../src/routes/billing.ts';
import { adminCatalog } from '../src/routes/catalog.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const PACK = 'price_pack25';
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const CART = { lines: [{ price_id: PACK, product_id: 'prod_pack25', name: '$25 of tokens', kind: 'token_pack', quantity: 1, unit_amount: 2500, line_total: 2500 }], subtotal: 2500, currency: 'usd' } as any;

/** A member who can check out one $25 pack with a $2.50 bonus. */
async function shop() {
  resetAiTopupMirrorWindow();
  const f = aiBudgetFixture();
  const env = { DB: f.DB, JWT_SECRET: 'd790-fixture-only-signing-secret', STRIPE_WEBHOOK_SECRET: 'd790-fixture-only-webhook-secret',
    ENVIRONMENT: 'development', STRIPE_SECRET_KEY: 'sk' + '_test_fixtureOnly000' } as any;
  await ensureCatalogSchema(env); await ensureOrdersSchema(env);
  for (const t of ['promo_codes', 'user_sessions']) f.db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  f.db.exec("ALTER TABLE users ADD COLUMN uid TEXT; ALTER TABLE users ADD COLUMN stripe_customer_id TEXT; ALTER TABLE users ADD COLUMN investor_stripe_customer_id TEXT; UPDATE users SET uid='uid-'||id, stripe_customer_id='cus_member'||id");
  f.db.prepare("INSERT INTO stripe_products(id,name,kind,active,metadata_json,prices_json) VALUES('prod_pack25','$25 of tokens','token_pack',1,'{}',?)")
    .run(JSON.stringify([{ id: PACK, product: 'prod_pack25', active: true, currency: 'usd', unit_amount: 2500, nickname: null, type: 'one_time', recurring: null }]));
  f.db.prepare("INSERT INTO ai_token_packs(uid,price_id,product_id,face_cents,bonus_microusd,on_sale,origin) VALUES('pack25',?,'prod_pack25',2500,2500000,1,'created')").run(PACK);
  return { ...f, env };
}
const setPack = (f: any, sql: string, ...binds: unknown[]) => f.db.prepare(`UPDATE ai_token_packs SET ${sql} WHERE uid='pack25'`).run(...binds);
const balance = (f: any, user = 2) => f.db.prepare('SELECT balance_microusd AS b FROM ai_topup_accounts WHERE user_id=?').get(user)?.b ?? 0;
const ledger = (f: any) => f.db.prepare('SELECT kind, delta_microusd, source_ref FROM ai_credit_ledger ORDER BY rowid').all().map((r: any) => ({ ...r }));
async function invariant(f: any) {
  for (const { user_id } of f.db.prepare('SELECT user_id FROM ai_topup_accounts UNION SELECT user_id FROM ai_credit_ledger').all())
    assert.equal(await ledgerBalance(f.env, user_id), balance(f, user_id), `the ledger sum equals the balance for ${user_id}`);
}

/** Stripe, stubbed for the order route: a customer and one PaymentIntent per call. */
function stripeStub() {
  const before = globalThis.fetch; const calls: string[] = []; let n = 0;
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input); calls.push(`${init?.method ?? 'GET'} ${url}`);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/v1/customers') || /\/v1\/customers\/cus_/.test(url)) return json({ id: 'cus_member2' });
    if (url.endsWith('/v1/payment_intents') && init?.method === 'POST') { n++; return json({ id: `pi_offer${n}`, client_secret: `pi_offer${n}` + '_secret_' + 'fixture', status: 'requires_payment_method' }); }
    throw new Error(`no Stripe stub answers ${url}`);
  }) as any;
  return { calls, restore: () => { globalThis.fetch = before; } };
}
async function auth(f: any, user = 2) {
  const jti = `jti-${user}`;
  f.db.prepare("INSERT OR IGNORE INTO user_sessions (user_id, jti, factor, created_at, last_step_up_at) VALUES (?, ?, 'totp', datetime('now'), datetime('now'))").run(user, jti);
  const jwt = await new SignJWT({ user_id: user, jti }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(f.env.JWT_SECRET));
  return { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' };
}
async function intent(f: any, user = 2) {
  const r = await ordersRoute.request('/intent', { method: 'POST', headers: await auth(f, user),
    body: JSON.stringify({ items: [{ price_id: PACK, quantity: 1 }], nonce: `n${Math.random()}`.replace('.', '') }) }, f.env);
  return { status: r.status, body: await r.json() as any };
}
async function webhook(f: any, pi: Record<string, unknown>) {
  const body = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, type: 'payment_intent.succeeded', data: { object: pi } });
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(f.env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)))).map((n) => n.toString(16).padStart(2, '0')).join('');
  return billingRoute.request('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${timestamp},v1=${signature}`, 'content-type': 'application/json' }, body }, f.env);
}
const paid = (r: any, total = 2500) => ({ id: r.body.payment_intent_id, status: 'succeeded', currency: 'usd', amount_received: total,
  metadata: { kind: 'cart_order', order_ref: r.body.order_ref, user_id: '2' } });
const refund = (f: any, pi: string, refunded: number) => webhookOf(f, 'charge.refunded',
  { id: `ch_${pi.replace(/_/g, '')}`, object: 'charge', payment_intent: pi, currency: 'usd', amount: 2500, amount_captured: 2500, amount_refunded: refunded });
async function webhookOf(f: any, type: string, object: Record<string, unknown>) {
  const body = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, type, data: { object } });
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(f.env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)))).map((n) => n.toString(16).padStart(2, '0')).join('');
  return billingRoute.request('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${timestamp},v1=${signature}`, 'content-type': 'application/json' }, body }, f.env);
}
/** Credit one plain $25 purchase on the ledger, so the member has bought a pack. */
async function boughtBefore(f: any) {
  await recordAiTopupPurchase(f.env, { paymentIntentId: 'pi_earlier', orderRef: 'MRD-earlier', userId: 2, totalCents: 2500, currency: 'usd',
    quote: { priceId: PACK, creditMicrousd: 25000000, packUid: 'pack25', bonusMicrousd: 0 } });
  assert.equal(await creditAiTopupFromPayment(f.env, { id: 'pi_earlier', status: 'succeeded', currency: 'usd', amount_received: 2500,
    metadata: { kind: 'cart_order', order_ref: 'MRD-earlier', user_id: '2' } }), true);
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

test('offerOpen: from the start (inclusive) to the end (exclusive), either end open; an unreadable end offers nothing', () => {
  const now = Date.parse('2026-10-20T12:00:00.000Z');
  const at = (h: number) => iso(now + h * HOUR);
  assert.equal(offerOpen({}, now), true, 'no window: always');
  assert.equal(offerOpen({ offer_starts_at: at(0) }, now), true, 'the start itself is inside');
  assert.equal(offerOpen({ offer_starts_at: at(1) }, now), false, 'before the start');
  assert.equal(offerOpen({ offer_ends_at: at(0) }, now), false, 'the end itself is outside');
  assert.equal(offerOpen({ offer_ends_at: at(1) }, now), true);
  assert.equal(offerOpen({ offer_starts_at: at(-2), offer_ends_at: at(-1) }, now), false, 'after the end');
  assert.equal(offerOpen({ offer_starts_at: at(-1), offer_ends_at: at(1) }, now), true);
  assert.equal(offerOpen({ offer_ends_at: 'not a date' }, now), false);
});

test('the quote and the pack read carry the bonus only inside the window, with when it ends', async () => {
  const f = await shop();
  try {
    const quote = async () => ((await tokenPackQuote(f.env, 2, CART, '')) as any);
    const offer = async () => (await packsOnSale(f.env)).packs[0];
    assert.equal((await quote()).bonusMicrousd, 2500000, 'no window: the bonus');
    const ends = iso(Date.now() + 24 * HOUR);
    setPack(f, 'offer_starts_at = ?, offer_ends_at = ?', iso(Date.now() - HOUR), ends);
    assert.equal((await quote()).bonusMicrousd, 2500000, 'inside');
    assert.deepEqual([(await offer()).bonus_microusd, (await offer()).bonus_usd, (await offer()).offer_ends_at], [2500000, 2.5, ends]);
    for (const [name, starts, end] of [['not started', iso(Date.now() + HOUR), null], ['ended', null, iso(Date.now() - HOUR)]] as const) {
      setPack(f, 'offer_starts_at = ?, offer_ends_at = ?', starts, end);
      assert.equal((await quote()).bonusMicrousd, 0, `${name}: no bonus quoted`);
      assert.deepEqual([(await offer()).bonus_microusd, (await offer()).bonus_usd, (await offer()).offer_ends_at], [0, 0, null], `${name}: none shown`);
    }
  } finally { f.db.close(); }
});

test('an order outside the window is stored and credited with no bonus; inside, with it', async () => {
  for (const [name, starts, credited] of [['outside', iso(Date.now() + HOUR), 25000000], ['inside', iso(Date.now() - HOUR), 27500000]] as const) {
    const f = await shop(); const s = stripeStub();
    try {
      setPack(f, 'offer_starts_at = ?', starts);
      const r = await intent(f);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      for (let i = 0; i < 2; i++) assert.equal((await webhook(f, paid(r))).status, 200);
      assert.equal(balance(f), credited, `${name}: credited once, a retry adds nothing`);
      assert.equal(ledger(f).filter((l: any) => l.kind === 'bonus').length, name === 'inside' ? 1 : 0);
      await invariant(f);
    } finally { s.restore(); f.db.close(); }
  }
});

test('an edit after payment never changes the bonus credited: it is the one quoted at checkout', async () => {
  const f = await shop(); const s = stripeStub();
  try {
    setPack(f, 'offer_ends_at = ?', iso(Date.now() + HOUR));
    const r = await intent(f);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    // After checkout: the bonus is cut to nothing and the window closes.
    setPack(f, 'bonus_microusd = 0, offer_ends_at = ?', iso(Date.now() - HOUR));
    assert.equal((await webhook(f, paid(r))).status, 200);
    assert.deepEqual(ledger(f).map((l: any) => [l.kind, l.delta_microusd]), [['purchase', 25000000], ['bonus', 2500000]]);
    assert.equal(balance(f), 27500000);
    await invariant(f);
  } finally { s.restore(); f.db.close(); }
});

// ---------------------------------------------------------------------------
// First purchase only
// ---------------------------------------------------------------------------

test('a first-purchase pack is sold to a member who has bought none, and refused (409, a sentence) to one who has', async () => {
  const f = await shop(); const s = stripeStub();
  try {
    setPack(f, 'first_purchase_only = 1');
    const first = await intent(f);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(f.db.prepare('SELECT first_purchase_only FROM ai_topup_purchases WHERE payment_intent_id = ?').get(first.body.payment_intent_id).first_purchase_only, 1, 'fixed on the purchase row');
    assert.equal((await webhook(f, paid(first))).status, 200);
    const intents = s.calls.filter((c) => c === 'POST https://api.stripe.com/v1/payment_intents').length;
    const again = await intent(f);
    assert.deepEqual([again.status, again.body.error], [409, 'token_pack_first_purchase_only']);
    assert.match(again.body.message, /first token purchase/);
    assert.equal(s.calls.filter((c) => c === 'POST https://api.stripe.com/v1/payment_intents').length, intents, 'no PaymentIntent for a refused order');
    // Another member, who has bought none, may still buy it.
    assert.equal((await intent(f, 3)).status, 200);
    await invariant(f);
  } finally { s.restore(); f.db.close(); }
});

test('two first-purchase checkouts racing: the second paid is credited at face value, its bonus withheld and logged', async () => {
  const f = await shop(); const s = stripeStub();
  try {
    setPack(f, 'first_purchase_only = 1');
    const a = await intent(f), b = await intent(f);
    assert.deepEqual([a.status, b.status], [200, 200], 'both quoted before either was paid');
    assert.equal((await webhook(f, paid(a))).status, 200);
    for (let i = 0; i < 2; i++) assert.equal((await webhook(f, paid(b))).status, 200);
    assert.deepEqual(ledger(f).map((l: any) => [l.kind, l.delta_microusd, l.source_ref]), [
      ['purchase', 25000000, `pi:${a.body.payment_intent_id}`], ['bonus', 2500000, `pi:${a.body.payment_intent_id}`],
      ['purchase', 25000000, `pi:${b.body.payment_intent_id}`],
    ]);
    assert.equal(balance(f), 52500000, 'the second paid its face value and got it, without the bonus');
    assert.deepEqual({ ...f.db.prepare('SELECT bonus_microusd, bonus_withheld_microusd FROM ai_topup_purchases WHERE payment_intent_id = ?').get(b.body.payment_intent_id) },
      { bonus_microusd: 0, bonus_withheld_microusd: 2500000 });
    const logs = f.db.prepare("SELECT details FROM activity_logs WHERE action = 'ai_topup_bonus_withheld'").all();
    assert.equal(logs.length, 1, 'logged once, a retry adds nothing');
    assert.deepEqual(JSON.parse(logs[0].details), { payment_intent_id: b.body.payment_intent_id, order_ref: b.body.order_ref,
      bonus_withheld_microusd: 2500000, pack_uid: 'pack25', reason: 'first_purchase_only' });
    assert.equal(f.db.prepare("SELECT title FROM notifications_inbox WHERE user_id = 2 AND type = 'ai_tokens_added' ORDER BY id DESC LIMIT 1").get().title, 'Tokens added: $25.00');
    await invariant(f);
  } finally { s.restore(); f.db.close(); }
});

test('a member who bought before checking out a first-purchase pack: refused at checkout; quoted earlier, credited without the bonus', async () => {
  const f = await shop(); const s = stripeStub();
  try {
    setPack(f, 'first_purchase_only = 1');
    const quoted = await intent(f);
    assert.equal(quoted.status, 200);
    await boughtBefore(f);
    assert.equal((await intent(f)).status, 409, 'refused at checkout');
    assert.equal((await webhook(f, paid(quoted))).status, 200);
    assert.equal(ledger(f).filter((l: any) => l.kind === 'bonus').length, 0, 'and at the webhook: no bonus');
    assert.equal(balance(f), 50000000);
    await invariant(f);
  } finally { s.restore(); f.db.close(); }
});

test('a pack that is not first-purchase only is never withheld, even for a member who bought before', async () => {
  const f = await shop(); const s = stripeStub();
  try {
    await boughtBefore(f);
    const r = await intent(f);
    assert.equal((await webhook(f, paid(r))).status, 200);
    assert.equal(balance(f), 52500000);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'ai_topup_bonus_withheld'").get().n, 0);
    await invariant(f);
  } finally { s.restore(); f.db.close(); }
});

test('a refund of a purchase whose bonus was withheld takes back only what was credited, in proportion', async () => {
  for (const [refunded, back] of [[2500, 25000000], [1000, 10000000]] as const) {
    const f = await shop(); const s = stripeStub();
    try {
      setPack(f, 'first_purchase_only = 1');
      const a = await intent(f), b = await intent(f);
      await webhook(f, paid(a)); await webhook(f, paid(b));
      const before = balance(f);
      assert.equal((await refund(f, b.body.payment_intent_id, refunded)).status, 200);
      assert.equal(before - balance(f), back, `a refund of ${refunded} of 2500 cents takes ${back}, never the withheld bonus`);
      assert.equal(f.db.prepare('SELECT reversed_microusd AS r FROM ai_topup_purchases WHERE payment_intent_id = ?').get(b.body.payment_intent_id).r, back);
      await invariant(f);
    } finally { s.restore(); f.db.close(); }
  }
});

// ---------------------------------------------------------------------------
// HQ
// ---------------------------------------------------------------------------

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error' }, 500);
  });
  a.route('/api/admin/catalog', adminCatalog);
  return a;
}
async function patch(f: any, body: unknown, user = 1) {
  const jwt = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(f.env.JWT_SECRET));
  const r = await app().request('/api/admin/catalog/token-packs/pack25', { method: 'PATCH', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, f.env);
  return { status: r.status, body: await r.json() as any };
}

test('HQ: the window must end after it starts, each end a date and time or open; first purchase only is a yes or no; every change is audited', async () => {
  const f = await shop();
  try {
    const start = '2026-11-01T09:00:00.000Z', end = '2026-11-08T09:00:00.000Z';
    for (const [body, code] of [
      [{ offer_starts_at: end, offer_ends_at: start }, 'token_pack_offer_window_invalid'],
      [{ offer_starts_at: start, offer_ends_at: start }, 'token_pack_offer_window_invalid'],
      [{ offer_starts_at: 'next week' }, 'token_pack_offer_invalid'],
      [{ offer_ends_at: 1730000000 }, 'token_pack_offer_invalid'],
      [{ first_purchase_only: 'yes' }, 'invalid_first_purchase_only'],
      [{ bonus_usd: 2.51 }, 'token_pack_bonus_invalid'],
    ] as const) {
      const r = await patch(f, body);
      assert.deepEqual([r.status, r.body.error], [400, code], JSON.stringify(body));
    }
    assert.deepEqual({ ...f.db.prepare("SELECT offer_starts_at, offer_ends_at, first_purchase_only FROM ai_token_packs WHERE uid='pack25'").get() },
      { offer_starts_at: null, offer_ends_at: null, first_purchase_only: 0 }, 'a refused change writes nothing');
    const ok = await patch(f, { offer_starts_at: start, offer_ends_at: end, first_purchase_only: true });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual([ok.body.pack.offer_starts_at, ok.body.pack.offer_ends_at, ok.body.pack.first_purchase_only], [start, end, true]);
    // An end alone must still follow the stored start; null opens an end.
    assert.equal((await patch(f, { offer_ends_at: '2026-10-31T09:00:00.000Z' })).body.error, 'token_pack_offer_window_invalid');
    const opened = await patch(f, { offer_starts_at: null });
    assert.deepEqual([opened.body.pack.offer_starts_at, opened.body.pack.offer_ends_at], [null, end]);
    const audits = f.db.prepare("SELECT filters_json FROM admin_audit_log WHERE action = 'token_pack_update' ORDER BY rowid").all().map((r: any) => JSON.parse(r.filters_json));
    assert.equal(audits.length, 2, 'one audit per saved change, none for a refusal');
    assert.deepEqual([audits[0].offer_starts_at, audits[0].offer_ends_at, audits[0].first_purchase_only, audits[0].was.first_purchase_only], [start, end, true, false]);
    assert.deepEqual([audits[1].offer_starts_at, audits[1].was.offer_starts_at], [null, start]);
    // Only a Super Admin edits a pack.
    assert.equal((await patch(f, { first_purchase_only: false }, 2)).status, 403);
  } finally { f.db.close(); }
});
