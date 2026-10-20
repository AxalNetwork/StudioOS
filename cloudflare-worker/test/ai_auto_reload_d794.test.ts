// D794 (#2219) — opt-in auto-reload of AI tokens. Real SQLite with migrations
// 419, 430, 486, 505 and 511; runs are reserved and settled through the real
// budget code. Stripe is stubbed: no live call. Each case names the mutations
// it was checked against.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/ai_auto_reload_d794.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { aiBudgetFixture, setFixtureAllowance, AI_FIXTURE_PLANS } from './_ai_budget_fixture.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { ensureCatalogSchema } from '../src/services/catalog.ts';
import { ensureOrdersSchema } from '../src/services/orders.ts';
import { recordAiTopupPurchase, creditAiTopupFromPayment } from '../src/services/aiTopups.ts';
import { reserveAiBudget, settleAiReservation } from '../src/services/aiBudget.ts';
import { ledgerBalance } from '../src/services/aiCredits.ts';
import { runAutoReload, thresholdMicro, AUTO_RELOAD_LIMITS, DISABLED_WORDS } from '../src/services/aiAutoReload.ts';
import budgetRoute from '../src/routes/ai_budget.ts';
import billingRoute from '../src/routes/billing.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const M511 = readFileSync(new URL('../sql/migrations/511_ai_auto_reload.sql', import.meta.url), 'utf8');
const PACK = 'price_pack25';
const M = 1_000_000;

/** A member (2) with a $27.50 balance from one credited pack, the $25 pack on sale, and orders, sessions and the queue. */
async function world() {
  n = 0;
  const f = aiBudgetFixture();
  const env = { DB: f.DB, JWT_SECRET: 'd794-fixture-only-signing-secret', STRIPE_WEBHOOK_SECRET: 'd794-fixture-only-webhook-secret',
    STRIPE_SECRET_KEY: 'sk' + '_test_fixtureOnly000', ENVIRONMENT: 'development' } as any;
  await ensureCatalogSchema(env);
  await ensureOrdersSchema(env);
  for (const t of ['user_sessions', 'queue_jobs']) f.db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  f.db.exec(`ALTER TABLE users ADD COLUMN uid TEXT; ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
    ALTER TABLE users ADD COLUMN investor_stripe_customer_id TEXT; ALTER TABLE users ADD COLUMN recovery_cooling_off_until TEXT;
    UPDATE users SET uid='uid-'||id, stripe_customer_id='cus_member'||id`);
  f.db.prepare("INSERT INTO stripe_products(id,name,kind,active,metadata_json,prices_json) VALUES('prod_pack25','$25 of tokens','alacarte',1,'{}',?)")
    .run(JSON.stringify([{ id: PACK, product: 'prod_pack25', active: true, currency: 'usd', unit_amount: 2500, nickname: null, type: 'one_time', recurring: null }]));
  f.db.prepare("INSERT INTO ai_token_packs(uid,price_id,product_id,face_cents,bonus_microusd,on_sale,origin) VALUES('pack25',?,'prod_pack25',2500,2500000,1,'created')").run(PACK);
  f.db.exec(M511);
  setFixtureAllowance(f.db, 0); // D783: no plan, so every run draws tokens
  await buy(env, 'pi_first');
  return { ...f, env };
}
/** A $25 pack bought and credited by the webhook, as D755 does. */
async function buy(env: any, pi: string) {
  await recordAiTopupPurchase(env, { paymentIntentId: pi, orderRef: `MRD-${pi}`, userId: 2, totalCents: 2500, currency: 'usd',
    quote: { priceId: PACK, creditMicrousd: 25 * M, packUid: 'pack25', bonusMicrousd: 2.5 * M } });
  assert.equal(await creditAiTopupFromPayment(env, { id: pi, status: 'succeeded', currency: 'usd', amount_received: 2500,
    metadata: { kind: 'cart_order', order_ref: `MRD-${pi}`, user_id: '2' } }), true);
}
/** Turn auto-reload on: the $25 pack below a $20 threshold, with a saved card. */
function enable(f: any, threshold = 20) {
  f.db.prepare(`INSERT INTO member_ai_auto_reload(user_id,enabled,pack_uid,threshold_microusd,stripe_payment_method) VALUES(2,1,'pack25',?,'pm_saved')
    ON CONFLICT(user_id) DO UPDATE SET enabled=1, threshold_microusd=excluded.threshold_microusd, disabled_reason=NULL`).run(threshold * M);
}
/** Spend through the real reserve and settle code. */
async function spend(f: any, micro: number) {
  const r = await reserveAiBudget(f.env, 2, micro, new Date());
  if (!r.ok) throw Error(`reserve refused: ${JSON.stringify(r)}`);
  await settleAiReservation(f.env, r.reservation, micro);
}
const balance = (f: any) => f.db.prepare('SELECT balance_microusd AS b FROM ai_topup_accounts WHERE user_id=2').get()?.b ?? 0;
const jobs = (f: any) => f.db.prepare("SELECT payload FROM queue_jobs WHERE job_type='ai_auto_reload'").all().map((r: any) => JSON.parse(r.payload));
const settings = (f: any) => ({ ...f.db.prepare('SELECT enabled,disabled_reason,last_outcome,last_crossing FROM member_ai_auto_reload WHERE user_id=2').get() });
const notices = (f: any) => f.db.prepare("SELECT title, body FROM notifications_inbox WHERE user_id=2 AND type='ai_auto_reload_off'").all().map((r: any) => ({ ...r }));

type Call = { method: string; path: string; body: URLSearchParams; key: string | null };
/** Stripe, stubbed. `confirm` answers the off-session confirm; anything unanswered fails the test. */
let n = 0; // across stubs, as Stripe never reuses a PaymentIntent id
function stripeStub(opts: { confirm?: () => Response | Promise<Response>; setupIntent?: Record<string, unknown>; pm?: Record<string, unknown> } = {}) {
  const before = globalThis.fetch; const calls: Call[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = (async (input: any, init: any) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = new URLSearchParams(init?.body ? String(init.body) : url.search);
    calls.push({ method, path: url.pathname, body, key: init?.headers?.['Idempotency-Key'] ?? null });
    if (method === 'POST' && url.pathname === '/v1/payment_intents') { n++; return json({ id: `pi_reload${n}`, status: 'requires_confirmation' }); }
    const confirm = /^\/v1\/payment_intents\/(pi_\w+)\/confirm$/.exec(url.pathname);
    if (method === 'POST' && confirm) return opts.confirm ? opts.confirm() : json({ id: confirm[1], status: 'succeeded' });
    if (method === 'POST' && url.pathname === '/v1/setup_intents') return json({ id: 'seti_new', client_secret: 'seti_new_secret_fixture' });
    if (method === 'GET' && /^\/v1\/setup_intents\/seti_\w+$/.test(url.pathname))
      return json({ status: 'succeeded', customer: 'cus_member2', usage: 'off_session', payment_method: 'pm_fromSetup', metadata: { user_id: '2', purpose: 'ai_auto_reload' }, ...opts.setupIntent });
    if (method === 'GET' && /^\/v1\/payment_methods\/pm_\w+$/.test(url.pathname))
      return json({ id: 'pm_saved', customer: 'cus_member2', card: { brand: 'visa', last4: '4242' }, ...opts.pm });
    throw new Error(`no Stripe stub answers ${method} ${url.pathname}`);
  }) as any;
  const creates = () => calls.filter((c) => c.method === 'POST' && c.path === '/v1/payment_intents');
  return { calls, creates, restore: () => { globalThis.fetch = before; } };
}
const declined = () => new Response(JSON.stringify({ error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' } }), { status: 402 });
async function webhook(f: any, type: string, object: Record<string, unknown>) {
  const body = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, type, data: { object } });
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(f.env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)))).map((x) => x.toString(16).padStart(2, '0')).join('');
  return billingRoute.request('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${timestamp},v1=${signature}`, 'content-type': 'application/json' }, body }, f.env);
}
async function invariant(f: any) {
  assert.equal(await ledgerBalance(f.env, 2), balance(f), 'the ledger sum is the balance');
}

// 1 ───────────────────────────────────────────────────────────────────────────
test('off: a run that takes the balance below any threshold queues nothing and calls no Stripe', async () => {
  // Mutations checked: the enabled filter dropped from the due read; the hook run on a refund.
  const f = await world(); const s = stripeStub();
  try {
    await spend(f, 20 * M);
    assert.deepEqual(jobs(f), [], 'no settings, no reload');
    f.db.prepare("INSERT INTO member_ai_auto_reload(user_id,enabled,pack_uid,threshold_microusd,stripe_payment_method) VALUES(2,0,'pack25',?,'pm_saved')").run(20 * M);
    await spend(f, 1 * M);
    assert.deepEqual(jobs(f), [], 'switched off, no reload');
    assert.equal(await runAutoReload(f.env, 2), 'off');
    assert.equal(s.calls.length, 0);
  } finally { s.restore(); f.db.close(); }
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('a crossing queues one reload: an unconfirmed intent, then the order and purchase, then an off-session confirm', async () => {
  // Mutations checked: confirm on create; the purchase row written after the confirm; the idempotency key dropped; the threshold compare reversed.
  const f = await world(); const s = stripeStub();
  try {
    enable(f, 20);
    await spend(f, 5 * M); // 22.50: above $20
    assert.deepEqual(jobs(f), [], 'above the threshold, nothing is due');
    await spend(f, 5 * M); // 17.50: below
    assert.deepEqual(jobs(f), [{ user_id: 2 }]);
    assert.equal(await runAutoReload(f.env, 2), 'charged');
    const [create] = s.creates();
    assert.equal(s.creates().length, 1);
    assert.equal(create.body.get('confirm'), null, 'created unconfirmed');
    assert.equal(create.body.get('off_session'), null);
    assert.deepEqual([create.body.get('amount'), create.body.get('payment_method'), create.body.get('customer'), create.body.get('metadata[auto_reload]'), create.body.get('metadata[kind]')],
      ['2500', 'pm_saved', 'cus_member2', '1', 'cart_order']);
    assert.match(String(create.key), /^reload:2:pi_first:\d+$/, 'keyed by the member, the crossing and the settings');
    const confirm = s.calls.find((c) => c.path.endsWith('/confirm'))!;
    assert.equal(confirm.body.get('off_session'), 'true');
    assert.equal(confirm.key, `${create.key}:confirm`);
    assert.ok(s.calls.indexOf(confirm) > s.calls.indexOf(create));
    const purchase = { ...f.db.prepare("SELECT order_ref,pack_uid,credit_microusd,bonus_microusd,expected_total_cents,credited_at FROM ai_topup_purchases WHERE payment_intent_id='pi_reload1'").get() };
    assert.deepEqual([purchase.pack_uid, purchase.credit_microusd, purchase.bonus_microusd, purchase.expected_total_cents, purchase.credited_at], ['pack25', 25 * M, 2.5 * M, 2500, null], 'credited by the webhook alone');
    assert.equal(f.db.prepare("SELECT status FROM orders WHERE payment_intent_id='pi_reload1'").get().status, 'pending');
    assert.deepEqual([settings(f).last_outcome, settings(f).last_crossing], ['charged', 'pi_first']);
    assert.equal(balance(f), 17.5 * M, 'nothing credited before the webhook');
    await invariant(f);
  } finally { s.restore(); f.db.close(); }
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('one crossing, one charge: a later settle queues nothing, and a duplicate job charges nothing', async () => {
  // Mutations checked: the last_crossing compare dropped from the due read; the crossing claim made unconditional.
  const f = await world(); const s = stripeStub();
  try {
    enable(f, 20);
    await spend(f, 10 * M);
    assert.equal(await runAutoReload(f.env, 2), 'charged');
    await spend(f, 1 * M);
    await spend(f, 1 * M);
    assert.equal(jobs(f).length, 1, 'the reload is pending: the crossing is taken');
    assert.equal(await runAutoReload(f.env, 2), 'not_due');
    assert.equal(s.creates().length, 1);
  } finally { s.restore(); f.db.close(); }
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('two racing jobs cause one charge', async () => {
  // Mutations checked: the lock's expiry check dropped (a held lock taken again); the lock never taken.
  const f = await world(); const s = stripeStub();
  try {
    enable(f, 20);
    await spend(f, 10 * M);
    const outcomes = await Promise.all([runAutoReload(f.env, 2), runAutoReload(f.env, 2), runAutoReload(f.env, 2)]);
    assert.equal(outcomes.filter((o) => o === 'charged').length, 1, JSON.stringify(outcomes));
    assert.ok(outcomes.every((o) => ['charged', 'locked', 'not_due'].includes(o)), JSON.stringify(outcomes));
    assert.equal(s.creates().length, 1, 'one PaymentIntent');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM member_ai_reload_locks').get().n, 0, 'the lock is released');
  } finally { s.restore(); f.db.close(); }
});

// 4b ──────────────────────────────────────────────────────────────────────────
test('a lock another job holds refuses this one; an expired lock is taken; and with the lock lost, the crossing claim still charges once', async () => {
  // Mutations checked: the lock's expiry check dropped; the lock's answer ignored; the crossing claim made unconditional.
  const f = await world(); const s = stripeStub();
  try {
    enable(f, 20);
    await spend(f, 10 * M);
    f.db.prepare("INSERT INTO member_ai_reload_locks(user_id,locked_until) VALUES(2,datetime('now','+1 minute'))").run();
    assert.equal(await runAutoReload(f.env, 2), 'locked');
    assert.equal(s.calls.length, 0);
    f.db.prepare("UPDATE member_ai_reload_locks SET locked_until=datetime('now','-1 second') WHERE user_id=2").run();
    // A database that grants every lock, as when a crashed job's lock expires under a live one.
    const DB = new Proxy(f.env.DB, { get(target: any, prop) {
      if (prop !== 'prepare') return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
      return (sql: string) => /INSERT INTO member_ai_reload_locks/.test(sql)
        ? { bind: () => ({ run: async () => ({ success: true, meta: { changes: 1 } }) }) }
        : target.prepare(sql);
    } });
    const env = { ...f.env, DB };
    const outcomes = await Promise.all([runAutoReload(env, 2), runAutoReload(env, 2), runAutoReload(env, 2)]);
    assert.equal(outcomes.filter((o) => o === 'charged').length, 1, JSON.stringify(outcomes));
    assert.equal(s.creates().length, 1, 'the claim is the second guard');
  } finally { s.restore(); f.db.close(); }
});

// 4c ──────────────────────────────────────────────────────────────────────────
test('only a run that drew on tokens can take the balance below the line: an allowance-only run queues nothing', async () => {
  // Mutation checked: the hook run after every settlement.
  const f = await world(); const s = stripeStub();
  try {
    await spend(f, 10 * M); // 17.50, before auto-reload is on
    enable(f, 20);
    f.db.exec(AI_FIXTURE_PLANS); // the member's plan back, so the allowance pays
    setFixtureAllowance(f.db, 10 * M);
    await spend(f, 1 * M);
    assert.deepEqual(jobs(f), [], 'the allowance paid: the balance did not move');
    setFixtureAllowance(f.db, 0);
    await spend(f, 1 * M);
    assert.deepEqual(jobs(f), [{ user_id: 2 }]);
  } finally { s.restore(); f.db.close(); }
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('the webhook credits a reload as any pack, its refund reverses it, and with no limit reloads continue', async () => {
  // Mutations checked: the reload's metadata kind changed (the webhook ignores it); the crossing read from the newest ledger row of any kind.
  const f = await world(); const s = stripeStub();
  try {
    enable(f, 20);
    await spend(f, 10 * M);
    assert.equal(await runAutoReload(f.env, 2), 'charged');
    const ref = f.db.prepare("SELECT order_ref FROM orders WHERE payment_intent_id='pi_reload1'").get().order_ref;
    const pi = { id: 'pi_reload1', status: 'succeeded', currency: 'usd', amount_received: 2500, metadata: { kind: 'cart_order', order_ref: ref, user_id: '2', auto_reload: '1' } };
    assert.equal((await webhook(f, 'payment_intent.succeeded', pi)).status, 200);
    assert.equal(balance(f), 45 * M, '17.50 + 27.50');
    assert.equal(f.db.prepare("SELECT status FROM orders WHERE payment_intent_id='pi_reload1'").get().status, 'paid', 'an ordinary order, with its invoice');
    // Below the threshold again: a new crossing, so a new reload (no limit).
    await spend(f, 26 * M);
    assert.equal(jobs(f).length, 2);
    assert.equal(await runAutoReload(f.env, 2), 'charged');
    assert.equal(s.creates().length, 2);
    assert.match(String(s.creates()[1].key), /^reload:2:pi_reload1:/);
    // The first reload refunded: its tokens go, as any pack's do.
    assert.equal((await webhook(f, 'charge.refunded', { id: 'ch_reload1', object: 'charge', payment_intent: 'pi_reload1', currency: 'usd', amount: 2500, amount_captured: 2500, amount_refunded: 2500 })).status, 200);
    assert.equal(balance(f), 0, '19.00 left, 27.50 taken back as far as the balance goes');
    assert.equal(f.db.prepare("SELECT kind FROM ai_credit_ledger WHERE kind='refund'").get().kind, 'refund');
    await invariant(f);
  } finally { s.restore(); f.db.close(); }
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('the five orders a day stop a reload; a pack no longer sold turns it off', async () => {
  // Mutations checked: tokenPackQuote skipped; the archived check dropped.
  const f = await world(); const s = stripeStub();
  try {
    enable(f, 20);
    for (let i = 0; i < 4; i++) f.db.prepare("INSERT INTO ai_topup_purchases(payment_intent_id,order_ref,user_id,price_id,credit_microusd,expected_total_cents,currency,pack_uid) VALUES(?,?,2,?,1,1,'usd','pack25')").run(`pi_day${i}`, `MRD-day${i}`, PACK);
    await spend(f, 10 * M);
    assert.equal(await runAutoReload(f.env, 2), 'token_pack_daily_limit', 'pi_first and four more today');
    assert.equal(s.calls.length, 0);
    assert.equal(settings(f).enabled, 1, 'a limit is not a failure');
    assert.equal(settings(f).last_crossing, null, 'the crossing is not taken');
    f.db.exec("DELETE FROM ai_topup_purchases WHERE payment_intent_id LIKE 'pi_day%'; UPDATE ai_token_packs SET on_sale=0, archived_at=datetime('now')");
    assert.equal(await runAutoReload(f.env, 2), 'pack_unavailable');
    assert.deepEqual([settings(f).enabled, settings(f).disabled_reason], [0, 'pack_unavailable']);
    assert.equal(notices(f).length, 1);
    assert.equal(s.calls.length, 0);
  } finally { s.restore(); f.db.close(); }
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('a declined card turns auto-reload off, hands the crossing back, credits nothing and tells the member once', async () => {
  // Mutations checked: a decline treated as transient; the notice sent on every run; the crossing kept.
  const f = await world(); const s = stripeStub({ confirm: declined });
  try {
    enable(f, 20);
    await spend(f, 10 * M);
    assert.equal(await runAutoReload(f.env, 2), 'card_declined');
    assert.deepEqual(settings(f), { enabled: 0, disabled_reason: 'card_declined', last_outcome: 'card_declined', last_crossing: null });
    assert.deepEqual(notices(f), [{ title: 'Auto-reload is off', body: 'Auto-reload is off: your card was declined. Update it on Billing.' }]);
    assert.equal(balance(f), 17.5 * M, 'nothing credited');
    assert.equal(await runAutoReload(f.env, 2), 'off');
    await spend(f, 1 * M);
    assert.equal(jobs(f).length, 1, 'off: no new reload');
    assert.equal(notices(f).length, 1, 'told once');
    // The member updates the card and turns it back on: a new attempt, not a replay of the decline.
    s.restore();
    const s2 = stripeStub();
    try {
      f.db.prepare("UPDATE member_ai_auto_reload SET enabled=1, disabled_reason=NULL, updated_at=datetime('now','+1 minute') WHERE user_id=2").run();
      assert.equal(await runAutoReload(f.env, 2), 'charged');
      assert.notEqual(s2.creates()[0].key, s.creates()[0].key, 'a new idempotency key');
    } finally { s2.restore(); }
  } finally { s.restore(); f.db.close(); }
});

// 8 ───────────────────────────────────────────────────────────────────────────
test('a bank asking to authenticate turns it off; a Stripe outage leaves it on and the crossing free', async () => {
  // Mutations checked: requires_action read as success; a 500 turning auto-reload off; the crossing kept after a 500.
  const f = await world();
  let s = stripeStub({ confirm: () => new Response(JSON.stringify({ id: 'pi_reload1', status: 'requires_action' }), { status: 200 }) });
  try {
    enable(f, 20);
    await spend(f, 10 * M);
    assert.equal(await runAutoReload(f.env, 2), 'authentication_required');
    assert.equal(notices(f)[0].body, DISABLED_WORDS.authentication_required);
    s.restore();
    s = stripeStub({ confirm: () => new Response('{"error":{"type":"api_error"}}', { status: 500 }) });
    f.db.prepare("UPDATE member_ai_auto_reload SET enabled=1, disabled_reason=NULL, updated_at=datetime('now','+1 minute') WHERE user_id=2").run();
    assert.equal(await runAutoReload(f.env, 2), 'error');
    assert.deepEqual([settings(f).enabled, settings(f).last_crossing, settings(f).last_outcome], [1, null, 'error'], 'the next settlement tries again');
    s.restore();
    s = stripeStub();
    assert.equal(await runAutoReload(f.env, 2), 'charged');
    assert.equal(s.creates()[0].key, s.calls[0].key, 'the retry reuses the same key, so Stripe answers the same payment');
  } finally { s.restore(); f.db.close(); }
});

// 9 ───────────────────────────────────────────────────────────────────────────
test('a reload that fails after it was confirmed turns it off once; any other failed payment is left alone', async () => {
  // Mutations checked: the auto_reload marker not checked; the webhook case missing.
  const f = await world();
  try {
    enable(f, 20);
    const failed = { id: 'pi_reload9', status: 'requires_payment_method', last_payment_error: { code: 'card_declined' }, metadata: { kind: 'cart_order', order_ref: 'MRD-x', user_id: '2' } };
    assert.equal((await webhook(f, 'payment_intent.payment_failed', failed)).status, 200);
    assert.equal(settings(f).enabled, 1, 'not a reload');
    for (let i = 0; i < 2; i++) assert.equal((await webhook(f, 'payment_intent.payment_failed', { ...failed, metadata: { ...failed.metadata, auto_reload: '1' } })).status, 200);
    assert.deepEqual([settings(f).enabled, settings(f).disabled_reason], [0, 'card_declined']);
    assert.equal(notices(f).length, 1, 'delivered twice, told once');
  } finally { f.db.close(); }
});

// ═════════════════════════════════════════════════════════════ the routes

async function auth(f: any, user = 2, stepUp = true) {
  const jti = `jti-${user}-${stepUp}`;
  f.db.prepare(`INSERT OR IGNORE INTO user_sessions (user_id, jti, factor, created_at, last_step_up_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))`)
    .run(user, jti, stepUp ? 'totp' : 'magic_link');
  const jwt = await new SignJWT({ user_id: user, jti }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(f.env.JWT_SECRET));
  return { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' };
}
async function call(f: any, method: string, path: string, body?: unknown, stepUp = true) {
  const r = await budgetRoute.request(path, { method, headers: await auth(f, 2, stepUp), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, f.env);
  return { status: r.status, body: await r.json().catch(() => null) as any };
}

// 10 ──────────────────────────────────────────────────────────────────────────
test('each route needs a recent TOTP sign-in, and a write is refused during a recovery cool-off', async () => {
  // Mutations checked: the factor check dropped; the step-up check dropped; the cool-off check dropped on PUT or on setup.
  const f = await world(); const s = stripeStub();
  try {
    for (const [method, path] of [['GET', '/auto-reload'], ['PUT', '/auto-reload'], ['POST', '/auto-reload/setup']]) {
      const r = await call(f, method, path, method === 'GET' ? undefined : {}, false);
      assert.equal(r.status, 403, `${method} ${path}`);
    }
    const headers = await auth(f, 2, true);
    f.db.prepare("UPDATE user_sessions SET last_step_up_at=datetime('now','-1 hour'), created_at=datetime('now','-1 hour') WHERE user_id=2").run();
    const stale = await budgetRoute.request('/auto-reload', { headers }, f.env);
    assert.equal(stale.status, 403);
    assert.equal((await stale.json() as any).code, 'step_up_required', 'the SPA can ask for a fresh TOTP');
    f.db.exec("DELETE FROM user_sessions; UPDATE users SET recovery_cooling_off_until=datetime('now','+1 day') WHERE id=2");
    assert.equal((await call(f, 'GET', '/auto-reload')).status, 200, 'reading stays open');
    assert.equal((await call(f, 'PUT', '/auto-reload', { enabled: false, pack_uid: 'pack25', threshold_usd: 10 })).status, 423);
    assert.equal((await call(f, 'POST', '/auto-reload/setup', {})).status, 423);
    assert.equal(s.calls.length, 0);
  } finally { s.restore(); f.db.close(); }
});

// 11 ──────────────────────────────────────────────────────────────────────────
test('saving: the threshold, the pack and the card are checked; a card comes only from this member\'s completed SetupIntent', async () => {
  // Mutations checked: the decimals check dropped; the archived check dropped; the SetupIntent's customer or purpose not checked; enabling with no card allowed.
  const f = await world();
  let s = stripeStub();
  try {
    const put = (body: unknown) => call(f, 'PUT', '/auto-reload', body);
    const base = { enabled: true, pack_uid: 'pack25', threshold_usd: 20 };
    for (const [body, error] of [
      [{ ...base, enabled: 'yes' }, 'invalid_enabled'], [{ ...base, threshold_usd: -1 }, 'invalid_threshold'], [{ ...base, threshold_usd: 20.005 }, 'invalid_threshold'],
      [{ ...base, threshold_usd: 500.01 }, 'invalid_threshold'], [{ ...base, threshold_usd: '20' }, 'invalid_threshold'], [{ ...base, pack_uid: 'nope' }, 'pack_unavailable'],
      [base, 'card_required'], [{ ...base, setup_intent_id: 'pm_123' }, 'invalid_setup_intent'],
    ] as const) {
      const r = await put(body);
      assert.deepEqual([r.status, r.body?.error], [400, error], JSON.stringify(body));
    }
    for (const bad of [{ customer: 'cus_member3' }, { status: 'requires_payment_method' }, { metadata: { user_id: '2' } }, { usage: 'on_session' }, { metadata: { user_id: '3', purpose: 'ai_auto_reload' } }]) {
      s.restore(); s = stripeStub({ setupIntent: bad });
      const r = await put({ ...base, setup_intent_id: 'seti_member' });
      assert.deepEqual([r.status, r.body?.error], [400, 'card_not_saved'], JSON.stringify(bad));
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM member_ai_auto_reload').get().n, 0, 'nothing saved');
    s.restore(); s = stripeStub();
    const ok = await put({ ...base, setup_intent_id: 'seti_member' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual([ok.body.enabled, ok.body.pack_uid, ok.body.threshold_usd, ok.body.card], [true, 'pack25', 20, { brand: 'visa', last4: '4242' }]);
    assert.equal(f.db.prepare('SELECT stripe_payment_method FROM member_ai_auto_reload WHERE user_id=2').get().stripe_payment_method, 'pm_fromSetup');
    const log = JSON.parse(f.db.prepare("SELECT details FROM activity_logs WHERE action='ai_auto_reload_saved'").get().details);
    assert.deepEqual(log, { enabled: true, pack_uid: 'pack25', threshold_microusd: 20 * M, card_changed: true });
    // Saving again without a card keeps the card; off is allowed with any sold pack.
    const off = await put({ enabled: false, pack_uid: 'pack25', threshold_usd: 12.5 });
    assert.deepEqual([off.status, off.body.enabled, off.body.threshold_usd], [200, false, 12.5]);
    assert.equal(f.db.prepare('SELECT stripe_payment_method FROM member_ai_auto_reload WHERE user_id=2').get().stripe_payment_method, 'pm_fromSetup');
    f.db.exec('UPDATE ai_token_packs SET on_sale=0');
    assert.equal((await put(base)).body.error, 'pack_not_on_sale', 'turned on only with a pack on sale');
    f.db.exec("UPDATE ai_token_packs SET archived_at=datetime('now')");
    assert.equal((await put({ ...base, enabled: false })).body.error, 'pack_unavailable', 'never an archived pack');
  } finally { s.restore(); f.db.close(); }
});

// 12 ──────────────────────────────────────────────────────────────────────────
test('setup makes an off-session SetupIntent on the member\'s own customer, and GET shows the card it saved', async () => {
  // Mutations checked: usage not off_session; the purpose marker dropped; a card on another customer shown.
  const f = await world();
  let s = stripeStub();
  try {
    const r = await call(f, 'POST', '/auto-reload/setup', { nonce: 'n1' });
    assert.deepEqual([r.status, r.body], [200, { client_secret: 'seti_new_secret_fixture', setup_intent_id: 'seti_new' }]);
    const si = s.calls.find((c) => c.path === '/v1/setup_intents')!;
    assert.deepEqual([si.body.get('customer'), si.body.get('usage'), si.body.get('metadata[purpose]'), si.body.get('metadata[user_id]')], ['cus_member2', 'off_session', 'ai_auto_reload', '2']);
    assert.equal(si.key, 'si_reload:2:n1');
    assert.deepEqual((await call(f, 'GET', '/auto-reload')).body, { enabled: false, pack_uid: null, threshold_usd: null, card: null, card_unreadable: false, last_attempt_at: null, last_outcome: null, disabled_reason: null });
    enable(f, 20);
    assert.deepEqual((await call(f, 'GET', '/auto-reload')).body.card, { brand: 'visa', last4: '4242' });
    s.restore(); s = stripeStub({ pm: { customer: 'cus_member3' } });
    assert.equal((await call(f, 'GET', '/auto-reload')).body.card, null, 'a card on another customer is not shown');
  } finally { s.restore(); f.db.close(); }
});

// 13 ──────────────────────────────────────────────────────────────────────────
test('the threshold rule and the job\'s wiring', () => {
  // Mutations checked: the cap removed; the queue case removed.
  assert.equal(thresholdMicro(0), 0);
  assert.equal(thresholdMicro(19.99), 19_990_000);
  assert.equal(thresholdMicro(500), AUTO_RELOAD_LIMITS.maxThresholdMicrousd);
  for (const bad of [500.01, -0.01, 1.234, Number.NaN, Infinity, '5', null]) assert.equal(thresholdMicro(bad as any), null, String(bad));
  const worker = readFileSync(new URL('../src/services/queueWorker.ts', import.meta.url), 'utf8');
  assert.match(worker, /case 'ai_auto_reload': \{[\s\S]*?runAutoReload\(env, Number\(payload\.user_id\)\)/);
});
