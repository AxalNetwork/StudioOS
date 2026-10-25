/**
 * D1052 (#2903, part 4 of Checkout #2451) — billing alerts and grace.
 *
 * Every event goes through the real webhook route (`POST /api/billing/stripe/webhook`,
 * which soft-accepts without a secret in tests) into migration 578's table, with
 * Stripe stubbed. Covered:
 *   - a failed renewal and a bank's confirmation open an alert; a paid invoice,
 *     a recovered subscription or an ended one closes it; `unpaid` keeps it
 *     open with no next try; each case is idempotent on its object's id and a
 *     closed alert is never reopened;
 *   - `GET /api/billing/alerts` gives the caller's open alerts only, with no card data;
 *   - Confirm fetches the client secret from Stripe only when pressed, for the caller's own alert;
 *   - a plan payment refunded or disputed is recorded and the member told, once per change;
 *   - grace: `past_due` keeps a plan's access, `unpaid` ends it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/billing_alerts_d1052.test.ts
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import billing from '../src/routes/billing.ts';
import { RENEWAL_REASONS } from '../src/services/billingAlerts.ts';
import { userMeetsTier } from '../src/middleware/requireTier.ts';
import { effectiveInvestorTier } from '../src/middleware/requireInvestorTier.ts';
import { userHasMiPro } from '../src/middleware/miAccess.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADA = 61, IRA = 62, PAT = 63;
const SECRET = 'pi_conf1' + '_secret_' + 'fixture';

// ── Stripe, stubbed ─────────────────────────────────────────────────────────
type Answer = { status?: number; body: unknown };
let stripe: Record<string, Answer> = {};
let calls: string[] = [];
let requestBodies: { path: string; body: URLSearchParams }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url);
  calls.push(`${String(init?.method || 'GET').toUpperCase()} ${url.replace('https://api.stripe.com/v1', '')}`);
  const path = url.replace('https://api.stripe.com/v1', '').split('?')[0];
  requestBodies.push({ path, body: new URLSearchParams(init.body || '') });
  const a = stripe[path];
  if (a) return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  if (url.startsWith('https://api.stripe.com/')) return new Response(JSON.stringify({ error: { message: 'no stub' } }), { status: 404 });
  return new Response('unexpected call in test', { status: 599 });
}) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });
beforeEach(() => { stripe = {}; calls = []; requestBodies = []; });

// ── A database: users and the plan tables as production has them, and 578 ──
function database({ alerts = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const baseline = read('cloudflare-worker/sql/schema_baseline.sql');
  for (const t of ['users', 'user_sessions', 'activity_logs', 'account_subscriptions']) db.exec(tableFromBaseline(baseline, t));
  db.exec(`CREATE TABLE IF NOT EXISTS mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'free', subscription_id TEXT UNIQUE, plan TEXT, period_end TEXT, stripe_customer_id TEXT, updated_at TEXT);
    CREATE TABLE ai_topup_purchases (payment_intent_id TEXT PRIMARY KEY, user_id INTEGER, credited_at TEXT);`);
  db.exec(read('cloudflare-worker/sql/migrations/505_member_subscription_amounts.sql'));
  if (alerts) db.exec(read('cloudflare-worker/sql/migrations/578_billing_alerts.sql'));
  const u = db.prepare('INSERT INTO users (id, role, name, email, uid, is_active, stripe_customer_id, stripe_subscription_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)');
  u.run(ADA, 'founder', 'Ada Quill', 'ada@example.test', 'uid-61', 'cus_ada', 'sub_ada', 'studio', 'past_due');
  u.run(IRA, 'founder', 'Ira Vale', 'ira@example.test', 'uid-62', 'cus_ira', 'sub_ira', 'growth', 'active');
  u.run(PAT, 'partner', 'Pat Rowe', 'pat@example.test', 'uid-63', 'cus_pat', null, 'free', 'active');
  db.prepare(`INSERT INTO account_subscriptions (user_id, plan_group, plan, status, subscription_id) VALUES (?, 'partner', 'partner_pro', 'active', 'sub_pat')`).run(PAT);
  return db;
}
const env = (db: DatabaseSync, over: Record<string, unknown> = {}) => ({ JWT_SECRET, ENVIRONMENT: 'test', STRIPE_SECRET_KEY: 'sk_test_sentinel', DB: d1Over(db), ...over } as any);
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
async function hit(db: DatabaseSync, method: string, path: string, who: [number, string] | null, body?: unknown, e = env(db)) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = `Bearer ${await token(who[0], who[1])}`;
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, e);
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text, headers: res.headers };
  } finally { [console.warn, console.error, console.log] = saved; }
}
let seq = 0;
const hook = (db: DatabaseSync, type: string, object: Record<string, unknown>, e = env(db)) =>
  hit(db, 'POST', '/api/billing/stripe/webhook', null, { id: `evt_${++seq}`, type, data: { object } }, e);
const alerts = (db: DatabaseSync) => db.prepare('SELECT * FROM billing_alerts ORDER BY id').all() as any[];
const notices = (db: DatabaseSync, type: string) => {
  try { return db.prepare('SELECT user_id, title, body, payload FROM notifications_inbox WHERE type = ? ORDER BY id').all(type) as any[]; }
  catch { return []; }
};
const renewal = (over: Record<string, unknown> = {}) => ({
  id: 'in_ada1', object: 'invoice', billing_reason: 'subscription_cycle', subscription: 'sub_ada', customer: 'cus_ada',
  attempt_count: 1, next_payment_attempt: 1_800_000_000, amount_due: 24900, currency: 'usd', ...over,
});

// ── migration 578 ───────────────────────────────────────────────────────────

test('migration 578: one row per kind and object, four kinds, two states, never on users', () => {
  const db = database();
  const ins = db.prepare(`INSERT INTO billing_alerts (user_id, kind, object_id) VALUES (?, ?, ?)`);
  ins.run(ADA, 'payment_failed', 'in_1');
  ins.run(ADA, 'needs_confirmation', 'in_1');
  assert.throws(() => ins.run(ADA, 'payment_failed', 'in_1'), /UNIQUE/);
  assert.throws(() => ins.run(ADA, 'card_expired', 'in_2'), /CHECK/);
  assert.throws(() => db.prepare(`INSERT INTO billing_alerts (user_id, kind, object_id, state) VALUES (?, 'refund', 'ch_1', 'pending')`).run(ADA), /CHECK/);
  const cols = (db.prepare('PRAGMA table_info(users)').all() as any[]).map((c) => c.name);
  assert.ok(!cols.some((c) => /alert/.test(c)), 'nothing on users');
  const columns = (db.prepare('PRAGMA table_info(billing_alerts)').all() as any[]).map((c) => c.name);
  assert.ok(!columns.some((c) => /card|last4|brand|secret|exp_/.test(c)), 'no card data and no secret is a column');
});

// ── a failed renewal ────────────────────────────────────────────────────────

test('a failed renewal opens one alert, moves it forward per attempt, and D892 still tells each attempt once', async () => {
  const db = database();
  assert.equal((await hook(db, 'invoice.payment_failed', renewal())).status, 200);
  let [a] = alerts(db);
  assert.deepEqual([a.user_id, a.kind, a.state, a.object_id, a.subscription_id, a.invoice_id, a.attempt_count, a.next_attempt_at, a.amount_cents, a.currency],
    [ADA, 'payment_failed', 'open', 'in_ada1', 'sub_ada', 'in_ada1', 1, '2027-01-15 08:00:00', 24900, 'usd']);
  await hook(db, 'invoice.payment_failed', renewal());
  assert.equal(alerts(db).length, 1, 'a redelivery adds nothing');
  assert.equal(notices(db, 'billing.renewal_failed').length, 1, 'and tells nothing twice');
  await hook(db, 'invoice.payment_failed', renewal({ attempt_count: 2, next_payment_attempt: 1_800_300_000 }));
  [a] = alerts(db);
  assert.deepEqual([a.attempt_count, a.next_attempt_at], [2, '2027-01-18 19:20:00']);
  assert.equal(notices(db, 'billing.renewal_failed').length, 2);
  await hook(db, 'invoice.payment_failed', renewal({ attempt_count: 1, next_payment_attempt: 1_800_000_000 }));
  assert.equal(alerts(db)[0].attempt_count, 2, 'an older attempt arriving late never moves it back');
  await hook(db, 'invoice.payment_failed', renewal({ id: 'in_first', billing_reason: 'subscription_create' }));
  await hook(db, 'invoice.payment_failed', renewal({ id: 'in_x', subscription: 'sub_nobody' }));
  await hook(db, 'invoice.payment_failed', renewal({ id: 'bogus id', subscription: 'sub_ada' }));
  assert.equal(alerts(db).length, 1, 'no alert for a first payment, a subscription no member owns, or an id that is not Stripe’s');
  assert.deepEqual([...RENEWAL_REASONS], ['subscription_cycle', 'subscription_update', 'subscription_threshold']);
});

test('a paid invoice closes its alerts, and a late failure never reopens one', async () => {
  const db = database();
  await hook(db, 'invoice.payment_failed', renewal());
  await hook(db, 'invoice.payment_action_required', renewal());
  assert.equal(alerts(db).filter((a) => a.state === 'open').length, 2);
  await hook(db, 'invoice.paid', { id: 'in_ada1', object: 'invoice', paid: true, subscription: 'sub_ada' });
  assert.deepEqual(alerts(db).map((a) => [a.state, a.closed_reason]), [['closed', 'paid'], ['closed', 'paid']]);
  await hook(db, 'invoice.payment_failed', renewal({ attempt_count: 3 }));
  assert.deepEqual(alerts(db).map((a) => [a.state, a.attempt_count]), [['closed', 1], ['closed', 1]]);
});

test('the subscription active again recovers; unpaid keeps the alert with no next try; deleted ends it', async () => {
  const db = database();
  await hook(db, 'invoice.payment_failed', renewal());
  await hook(db, 'customer.subscription.updated', { id: 'sub_ada', object: 'subscription', status: 'past_due', customer: 'cus_ada', metadata: { kind: 'tier', tier: 'studio' } });
  assert.equal(alerts(db)[0].state, 'open', 'still retrying');
  await hook(db, 'customer.subscription.updated', { id: 'sub_ada', object: 'subscription', status: 'unpaid', customer: 'cus_ada', metadata: { kind: 'tier', tier: 'studio' } });
  assert.deepEqual([alerts(db)[0].state, alerts(db)[0].next_attempt_at], ['open', null], 'Stripe stopped retrying');
  await hook(db, 'customer.subscription.updated', { id: 'sub_ada', object: 'subscription', status: 'active', customer: 'cus_ada', metadata: { kind: 'tier', tier: 'studio' } });
  assert.deepEqual([alerts(db)[0].state, alerts(db)[0].closed_reason], ['closed', 'recovered']);
  await hook(db, 'invoice.payment_failed', renewal({ id: 'in_ada2' }));
  await hook(db, 'customer.subscription.deleted', { id: 'sub_ada', object: 'subscription', status: 'canceled', customer: 'cus_ada', metadata: { kind: 'tier' } });
  assert.deepEqual([alerts(db)[1].state, alerts(db)[1].closed_reason], ['closed', 'ended']);
  await hook(db, 'invoice.payment_failed', renewal({ id: 'in_ira1', subscription: 'sub_ira', customer: 'cus_ira' }));
  assert.deepEqual([alerts(db).at(-1).object_id, alerts(db).at(-1).state], ['in_ira1', 'open']);
  await hook(db, 'customer.subscription.deleted', { id: 'sub_ira', object: 'subscription', customer: 'cus_ira', metadata: { kind: 'tier' } });
  assert.deepEqual([alerts(db).at(-1).object_id, alerts(db).at(-1).closed_reason], ['in_ira1', 'ended'], 'a deletion ends it whatever its status says');
  await hook(db, 'invoice.payment_failed', renewal({ id: 'in_pat1', subscription: 'sub_pat', customer: 'cus_pat', amount_due: 9900 }));
  await hook(db, 'customer.subscription.updated', { id: 'sub_pat', object: 'subscription', status: 'trialing', customer: 'cus_pat', metadata: { kind: 'plan', plan_group: 'partner', user_id: String(PAT) } });
  assert.deepEqual([alerts(db).at(-1).user_id, alerts(db).at(-1).closed_reason], [PAT, 'recovered'], 'an account plan, through its early-returning case');
});

// ── what the member reads, and Confirm ─────────────────────────────────────

test('GET /api/billing/alerts: the caller’s open alerts only, never card data, never cached', async () => {
  const db = database();
  await hook(db, 'invoice.payment_failed', renewal());
  await hook(db, 'invoice.payment_action_required', renewal({ id: 'in_ada2' }));
  await hook(db, 'invoice.payment_failed', renewal({ id: 'in_ira1', subscription: 'sub_ira', customer: 'cus_ira' }));
  await hook(db, 'invoice.paid', { id: 'in_ada1', paid: true });
  const r = await hit(db, 'GET', '/api/billing/alerts', [ADA, 'founder']);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(r.body.alerts.map((a: any) => [a.kind, a.can_confirm, a.amount_cents]), [['needs_confirmation', true, 24900]]);
  assert.deepEqual(Object.keys(r.body.alerts[0]).sort(), ['amount_cents', 'attempt_count', 'can_confirm', 'created_at', 'currency', 'id', 'kind', 'next_attempt_at', 'plan_family', 'updated_at']);
  assert.doesNotMatch(r.text, /in_ada|sub_ada|cus_|secret|last4|card/i, 'no Stripe ids, no card data');
  assert.equal((await hit(db, 'GET', '/api/billing/alerts', [IRA, 'founder'])).body.alerts.length, 1, 'each member reads their own');
  assert.equal((await hit(db, 'GET', '/api/billing/alerts', null)).status, 401);
  const before = database({ alerts: false });
  assert.deepEqual((await hit(before, 'GET', '/api/billing/alerts', [ADA, 'founder'])).body, { alerts: [] }, 'before 578 there are none');
  assert.equal((await hook(before, 'invoice.payment_failed', renewal())).status, 200, 'and the webhook still runs');
});

test('Confirm fetches the client secret from Stripe when pressed, for the caller’s own open alert only, and stores none', async () => {
  const db = database();
  await hook(db, 'invoice.payment_action_required', renewal());
  const id = alerts(db)[0].id;
  assert.equal(calls.length, 0, 'nothing is fetched when the alert is written');
  stripe['/invoices/in_ada1'] = { body: { id: 'in_ada1', payment_intent: { id: 'pi_conf1', status: 'requires_action', client_secret: SECRET } } };
  assert.equal((await hit(db, 'POST', `/api/billing/alerts/${id}/confirm`, [IRA, 'founder'])).status, 404, 'another member’s alert');
  assert.equal(calls.length, 0, 'and Stripe is not asked');
  const r = await hit(db, 'POST', `/api/billing/alerts/${id}/confirm`, [ADA, 'founder']);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { client_secret: SECRET, payment_intent: 'pi_conf1' });
  assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(calls, ['GET /invoices/in_ada1?expand%5B%5D=payment_intent']);
  assert.doesNotMatch(JSON.stringify(alerts(db)), /secret/, 'the secret is not stored');
  stripe['/invoices/in_ada1'] = { body: { id: 'in_ada1', payment_intent: { id: 'pi_conf1', status: 'succeeded', client_secret: SECRET } } };
  assert.deepEqual((await hit(db, 'POST', `/api/billing/alerts/${id}/confirm`, [ADA, 'founder'])).body, { error: 'confirmation_not_needed' });
  assert.equal((await hit(db, 'POST', '/api/billing/alerts/nope/confirm', [ADA, 'founder'])).status, 404);
  await hook(db, 'invoice.payment_failed', renewal({ id: 'in_ada9' }));
  assert.equal((await hit(db, 'POST', `/api/billing/alerts/${alerts(db)[1].id}/confirm`, [ADA, 'founder'])).status, 404, 'a failed payment is not a confirmation');
});

// ── refunds and disputes on plans ───────────────────────────────────────────

test('a refunded plan payment is recorded and told once per total; a charge that is no plan’s is left alone', async () => {
  const db = database();
  stripe['/invoices/in_ada1'] = { body: { id: 'in_ada1', subscription: 'sub_ada' } };
  const charge = { id: 'ch_ada1', object: 'charge', invoice: 'in_ada1', payment_intent: 'pi_ada1', amount: 24900, amount_refunded: 5000, currency: 'usd' };
  assert.equal((await hook(db, 'charge.refunded', charge)).status, 200);
  let [a] = alerts(db);
  assert.deepEqual([a.user_id, a.kind, a.state, a.object_id, a.amount_cents, a.closed_reason], [ADA, 'refund', 'closed', 'ch_ada1', 5000, 'refunded']);
  let told = notices(db, 'billing.plan_refunded');
  assert.equal(told.length, 1);
  assert.equal(told[0].title, 'Part of a plan payment was refunded');
  assert.match(told[0].body, /^\$50\.00 of a plan payment was refunded/);
  await hook(db, 'charge.refunded', charge);
  assert.equal(notices(db, 'billing.plan_refunded').length, 1, 'a redelivery tells nothing');
  await hook(db, 'charge.refunded', { ...charge, amount_refunded: 24900 });
  [a] = alerts(db);
  told = notices(db, 'billing.plan_refunded');
  assert.deepEqual([alerts(db).length, a.amount_cents, told.length, told[1].title], [1, 24900, 2, 'A plan payment was refunded']);
  assert.equal((await hit(db, 'GET', '/api/billing/alerts', [ADA, 'founder'])).body.alerts.length, 0, 'a refund is told, not left open');
  await hook(db, 'charge.refunded', { id: 'ch_once', amount: 500, amount_refunded: 500, currency: 'usd', payment_intent: 'pi_once' });
  stripe['/invoices/in_other'] = { body: { id: 'in_other', subscription: 'sub_nobody' } };
  await hook(db, 'charge.refunded', { id: 'ch_other', invoice: 'in_other', amount: 500, amount_refunded: 500, currency: 'usd' });
  assert.equal(alerts(db).length, 1, 'no invoice, or no member’s subscription: nothing');
  stripe['/invoices/in_down'] = { status: 503, body: { error: { message: 'down' } } };
  assert.notEqual((await hook(db, 'charge.refunded', { id: 'ch_down', invoice: 'in_down', amount: 500, amount_refunded: 500, currency: 'usd' })).status, 200, 'Stripe unreadable: Stripe retries the event');
});

test('a disputed plan payment opens an alert, told once, and closes with its outcome', async () => {
  const db = database();
  stripe['/charges/ch_ada1'] = { body: { id: 'ch_ada1', invoice: 'in_ada1' } };
  stripe['/invoices/in_ada1'] = { body: { id: 'in_ada1', subscription: 'sub_ada' } };
  const dispute = { id: 'dp_ada1', object: 'dispute', charge: 'ch_ada1', payment_intent: 'pi_ada1', amount: 24900, currency: 'usd', status: 'needs_response' };
  await hook(db, 'charge.dispute.created', dispute);
  await hook(db, 'charge.dispute.created', dispute);
  assert.deepEqual(alerts(db).map((a) => [a.user_id, a.kind, a.state, a.object_id, a.amount_cents]), [[ADA, 'dispute', 'open', 'dp_ada1', 24900]]);
  const told = notices(db, 'billing.plan_disputed');
  assert.equal(told.length, 1, 'told once');
  assert.match(told[0].body, /dispute on a plan payment of \$249\.00/);
  assert.deepEqual((await hit(db, 'GET', '/api/billing/alerts', [ADA, 'founder'])).body.alerts.map((a: any) => [a.kind, a.can_confirm]), [['dispute', false]]);
  await hook(db, 'charge.dispute.closed', { ...dispute, status: 'lost' });
  assert.deepEqual([alerts(db)[0].state, alerts(db)[0].closed_reason], ['closed', 'lost']);
  await hook(db, 'charge.dispute.closed', { ...dispute, status: 'won' });
  assert.equal(alerts(db)[0].closed_reason, 'lost', 'a closed dispute keeps its first outcome');
  assert.equal((await hook(db, 'charge.dispute.created', { ...dispute, id: 'dp_ada2' }, env(db, { STRIPE_SECRET_KEY: undefined }))).status, 200);
  assert.equal(alerts(db).length, 1, 'with no Stripe key nothing can be traced, and nothing is guessed');
});

// ── grace ───────────────────────────────────────────────────────────────────

test('grace: a renewal Stripe is still retrying keeps the plan’s access; unpaid ends it', () => {
  const founder = (status: string) => ({ id: 1, role: 'founder', subscription_tier: 'studio', subscription_status: status, subscription_renews_at: new Date().toISOString() } as any);
  assert.equal(userMeetsTier(founder('past_due'), 'studio'), true);
  assert.equal(userMeetsTier(founder('unpaid'), 'growth'), false);
  assert.equal(userMeetsTier(founder('active'), 'studio'), true);
  const investor = (status: string) => ({ role: 'investor', investor_tier: 'professional', investor_subscription_status: status, investor_subscription_renews_at: new Date().toISOString() } as any);
  assert.equal(effectiveInvestorTier(investor('past_due')), 'professional');
  assert.equal(effectiveInvestorTier(investor('unpaid')), 'free');
  assert.equal(effectiveInvestorTier(investor('cancelled')), 'free');
  assert.equal(userHasMiPro({ role: 'investor', mi_subscription_status: 'past_due', mi_subscription_period_end: new Date().toISOString() } as any), true);
  assert.equal(userHasMiPro({ role: 'investor', mi_subscription_status: 'unpaid' } as any), false);

});

test('D1100: a subscription update carries its period end to accepted seat colleagues', async () => {
  const db=database();
  const period=new Date(Date.now()-20*86_400_000).toISOString();
  db.prepare("UPDATE users SET role='investor',investor_stripe_customer_id='cus_grace',investor_stripe_subscription_id='sub_grace',investor_tier='institutional',investor_subscription_status='active' WHERE id=?").run(ADA);
  db.prepare("UPDATE users SET role='investor',investor_seat_primary_user_id=?,investor_tier='institutional',investor_subscription_status='active' WHERE id=?").run(ADA,IRA);
  const res=await hook(db,'customer.subscription.updated',{id:'sub_grace',customer:'cus_grace',status:'past_due',current_period_end:Date.parse(period)/1000,metadata:{kind:'investor',investor_tier:'institutional'}});
  assert.equal(res.status,200);
  const seat=db.prepare('SELECT * FROM users WHERE id=?').get(IRA) as any;
  assert.equal(seat.investor_subscription_status,'past_due');assert.equal(seat.investor_subscription_renews_at,period);
  assert.equal(effectiveInvestorTier(seat),'institutional');
  db.close();
});

// D1133: authenticated preparation, never a new subscription or a server-side charge.
async function strong(db: DatabaseSync, path: string, who = ADA, recent = true, factor = 'totp', body?: unknown) {
  const jti = crypto.randomUUID();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare("INSERT INTO user_sessions (jti,user_id,factor,created_at,last_step_up_at) VALUES (?,?,?,?,?)")
    .run(jti, who, factor, recent ? now : '2020-01-01 00:00:00', recent ? now : null);
  const jwt = await new SignJWT({ user_id: who, role: who === PAT ? 'partner' : 'founder', jti }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env(db));
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text), text, headers: res.headers };
}
const recoveryInvoice = (over = {}) => ({ id: 'in_ada1', subscription: 'sub_ada', customer: 'cus_ada', status: 'open', paid: false,
  payment_intent: { id: 'pi_recover', client_secret: SECRET, customer: 'cus_ada', status: 'requires_payment_method' }, ...over });
const activity = (db: DatabaseSync) => db.prepare("SELECT user_id, action, details FROM activity_logs WHERE action IN ('payment_refused','renewal_failed','renewal_recovered') ORDER BY id").all().map((r: any) => ({ ...r })) as any[];

test('D1133 renewal actions require fresh TOTP, caller ownership and an open failed alert before Stripe', async () => {
  const db = database();
  try {
    await hook(db, 'invoice.payment_failed', renewal()); const id = alerts(db)[0].id;
    for (const action of ['pay', 'update-card']) {
      const path = `/api/billing/alerts/${id}/${action}`;
      assert.equal((await hit(db, 'POST', path, null)).status, 401);
      assert.equal((await hit(db, 'POST', path, [ADA, 'founder'])).status, 403);
      assert.equal((await strong(db, path, ADA, false)).status, 403);
      assert.equal((await strong(db, path, ADA, true, 'passkey')).status, 403);
      assert.equal((await strong(db, path, IRA)).status, 404);
      assert.equal((await strong(db, `/api/billing/alerts/0/${action}`)).status, 404);
      assert.equal(calls.length, 0);
    }
    db.prepare("UPDATE billing_alerts SET state='closed'").run();
    assert.equal((await strong(db, `/api/billing/alerts/${id}/pay`)).status, 404);
    assert.equal(calls.length, 0);
  } finally { db.close(); }
});

test('D1133 Pay now reuses the existing invoice intent; Update card prepares a SetupIntent only', async () => {
  const db = database();
  try {
    await hook(db, 'invoice.payment_failed', renewal()); const id = alerts(db)[0].id;
    stripe['/invoices/in_ada1'] = { body: recoveryInvoice() };
    const paid = await strong(db, `/api/billing/alerts/${id}/pay`);
    assert.equal(paid.status, 200); assert.equal(paid.body.kind, 'payment'); assert.equal(paid.body.client_secret, SECRET);
    assert.equal(paid.headers.get('Cache-Control'), 'private, no-store');
    assert.ok(calls.every((c) => c.startsWith('GET /invoices/')));
    stripe['/setup_intents'] = { body: { client_secret: 'seti_fixture_secret_synthetic' } };
    const card = await strong(db, `/api/billing/alerts/${id}/update-card`);
    assert.equal(card.status, 200); assert.equal(card.body.kind, 'setup'); assert.equal(card.body.scope, 'founder');
    assert.ok(calls.includes('POST /setup_intents'));
    const setup = requestBodies.find((r) => r.path === '/setup_intents')!.body;
    assert.equal(setup.get('customer'), 'cus_ada');
    assert.equal(setup.get('usage'), 'off_session');
    assert.equal(setup.get('confirm'), null);
    assert.ok(!calls.some((c) => /\/pay$|\/confirm$|POST \/subscriptions/.test(c)));
    assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM activity_logs').all()), /secret|last4|card_number/);
    assert.equal(alerts(db)[0].state, 'open', 'only the verified webhook clears the renewal');
  } finally { db.close(); }
});

test('D1133 stale, mismatched and failed Stripe reads never yield a usable payment secret', async () => {
  const db = database();
  try {
    await hook(db, 'invoice.payment_failed', renewal()); const id = alerts(db)[0].id;
    for (const [invoice, status] of [[recoveryInvoice({ paid: true }), 409], [recoveryInvoice({ status: 'void' }), 409],
      [recoveryInvoice({ payment_intent: { id: 'pi_x', client_secret: SECRET, customer: 'cus_ada', status: 'succeeded' } }), 409],
      [recoveryInvoice({ customer: 'cus_foreign' }), 404], [recoveryInvoice({ subscription: 'sub_foreign' }), 404],
      [recoveryInvoice({ payment_intent: { id: 'pi_x', client_secret: SECRET, customer: 'cus_foreign', status: 'requires_action' } }), 409]]) {
      stripe['/invoices/in_ada1'] = { body: invoice };
      const out = await strong(db, `/api/billing/alerts/${id}/pay`); assert.equal(out.status, status); assert.doesNotMatch(out.text, /secret/);
    }
    stripe['/invoices/in_ada1'] = { status: 502, body: { error: { message: 'private provider text' } } };
    const failed = await strong(db, `/api/billing/alerts/${id}/pay`);
    assert.equal(failed.status, 503); assert.doesNotMatch(failed.text, /private provider text|stripe_error/);
  } finally { db.close(); }
});

test('D1133 recovery supports account plans and investor customers without crossing families', async () => {
  const db = database();
  try {
    await hook(db, 'invoice.payment_failed', renewal({ id: 'in_pat1', subscription: 'sub_pat', customer: 'cus_pat' }));
    const id = alerts(db)[0].id;
    stripe['/invoices/in_pat1'] = { body: recoveryInvoice({ id: 'in_pat1', subscription: 'sub_pat', customer: 'cus_pat', payment_intent: { id: 'pi_pat', client_secret: SECRET, customer: 'cus_pat', status: 'requires_action' } }) };
    assert.equal((await strong(db, `/api/billing/alerts/${id}/pay`, PAT)).status, 200);
    db.prepare("UPDATE users SET investor_stripe_customer_id='cus_inv',investor_stripe_subscription_id='sub_inv' WHERE id=?").run(ADA);
    await hook(db, 'invoice.payment_failed', renewal({ id: 'in_inv', subscription: 'sub_inv', customer: 'cus_inv' }));
    stripe['/invoices/in_inv'] = { body: recoveryInvoice({ id: 'in_inv', subscription: 'sub_inv', customer: 'cus_inv', payment_intent: { id: 'pi_inv', client_secret: SECRET, customer: 'cus_inv', status: 'requires_action' } }) };
    const out = await strong(db, `/api/billing/alerts/${alerts(db)[1].id}/pay`);
    assert.equal(out.status, 200); assert.equal(out.body.scope, 'investor');
  } finally { db.close(); }
});

test('D1133 renewal activity records each attempt and recovery once; ending is not recovery', async () => {
  const db = database();
  try {
    await hook(db, 'invoice.payment_failed', renewal()); await hook(db, 'invoice.payment_failed', renewal());
    await hook(db, 'invoice.payment_failed', renewal({ attempt_count: 2 }));
    assert.equal(activity(db).filter((r) => r.action === 'renewal_failed').length, 2);
    await hook(db, 'invoice.paid', { id: 'in_ada1', paid: true }); await hook(db, 'invoice.paid', { id: 'in_ada1', paid: true });
    await hook(db, 'customer.subscription.updated', { id: 'sub_ada', status: 'active', metadata: { kind: 'tier' } });
    assert.equal(activity(db).filter((r) => r.action === 'renewal_recovered').length, 1);
    await hook(db, 'invoice.payment_failed', renewal({ id: 'in_ada2' }));
    await hook(db, 'customer.subscription.updated', { id: 'sub_ada', status: 'active', metadata: { kind: 'tier' } });
    assert.equal(activity(db).filter((r) => r.action === 'renewal_recovered').length, 2);
    await hook(db, 'invoice.payment_failed', renewal({ id: 'in_ada3' }));
    await hook(db, 'customer.subscription.deleted', { id: 'sub_ada', metadata: { kind: 'tier' } });
    assert.equal(activity(db).filter((r) => r.action === 'renewal_recovered').length, 2);
    assert.ok(activity(db).every((r) => r.user_id === ADA && r.details === '{}'));
  } finally { db.close(); }
});

test('D1133 an activity failure rolls back alert changes; a redelivery recovers both', async () => {
  const db = database();
  try {
    db.exec("CREATE TRIGGER refuse_activity BEFORE INSERT ON activity_logs BEGIN SELECT RAISE(ABORT,'fixture refusal'); END;");
    assert.equal((await hook(db, 'invoice.payment_failed', renewal())).status, 500);
    assert.equal(alerts(db).length, 0);
    db.exec('DROP TRIGGER refuse_activity');
    assert.equal((await hook(db, 'invoice.payment_failed', renewal())).status, 200);
    db.exec("CREATE TRIGGER refuse_activity BEFORE INSERT ON activity_logs BEGIN SELECT RAISE(ABORT,'fixture refusal'); END;");
    assert.equal((await hook(db, 'invoice.paid', { id: 'in_ada1', paid: true })).status, 500);
    assert.equal(alerts(db)[0].state, 'open');
    db.exec('DROP TRIGGER refuse_activity');
    await hook(db, 'invoice.paid', { id: 'in_ada1', paid: true });
    assert.equal(alerts(db)[0].state, 'closed');
    assert.equal(activity(db).length, 2);
  } finally { db.close(); }
});

test('D1133 a verified refusal records only its reason family and deduplicates event redelivery', async () => {
  const db = database();
  try {
    stripe['/invoices/in_ada1'] = { body: { subscription: 'sub_ada', billing_reason: 'subscription_create' } };
    const event = { id: 'evt_refused', type: 'payment_intent.payment_failed', data: { object: { id: 'pi_declined', invoice: 'in_ada1', last_payment_error: { type: 'card_error', message: 'private detail 4242', decline_code: 'private_code' } } } };
    for (let n = 0; n < 2; n++) assert.equal((await hit(db, 'POST', '/api/billing/stripe/webhook', null, event)).status, 200);
    assert.deepEqual(activity(db), [{ user_id: ADA, action: 'payment_refused', details: '{"reason_family":"declined"}' }]);
    event.id = 'evt_auth'; event.data.object.last_payment_error = { code: 'authentication_required' } as any;
    await hit(db, 'POST', '/api/billing/stripe/webhook', null, event);
    assert.equal(JSON.parse(activity(db)[1].details).reason_family, 'authentication');
    assert.doesNotMatch(JSON.stringify(activity(db)), /4242|private|pi_declined|in_ada/);
  } finally { db.close(); }
});


test('D1133 a first decline arriving before subscription.created still records its owner, without trusting a foreign customer', async () => {
  const db = database();
  try {
    stripe['/invoices/in_first'] = { body: { billing_reason: 'subscription_create', subscription: 'sub_first', customer: 'cus_ada' } };
    stripe['/subscriptions/sub_first'] = { body: { customer: 'cus_ada', metadata: { kind: 'tier', user_id: String(ADA) } } };
    const event = { id: 'evt_first', type: 'payment_intent.payment_failed', data: { object: { id: 'pi_first', invoice: 'in_first' } } };
    assert.equal((await hit(db, 'POST', '/api/billing/stripe/webhook', null, event)).status, 200);
    assert.equal(activity(db).length, 1); assert.equal(activity(db)[0].user_id, ADA);
    event.id = 'evt_wrong'; stripe['/subscriptions/sub_first'] = { body: { customer: 'cus_ira', metadata: { kind: 'tier', user_id: String(ADA) } } };
    await hit(db, 'POST', '/api/billing/stripe/webhook', null, event); assert.equal(activity(db).length, 1);
    event.id = 'evt_wrongInvoice'; stripe['/subscriptions/sub_first'] = { body: { customer: 'cus_ada', metadata: { kind: 'tier', user_id: String(ADA) } } };
    stripe['/invoices/in_first'] = { body: { billing_reason: 'subscription_create', subscription: 'sub_first', customer: 'cus_ira' } };
    await hit(db, 'POST', '/api/billing/stripe/webhook', null, event); assert.equal(activity(db).length, 1);
    event.id = 'evt_retry'; stripe['/invoices/in_first'] = { status: 503, body: { error: { message: 'private provider text' } } };
    const out = await hit(db, 'POST', '/api/billing/stripe/webhook', null, event);
    assert.equal(out.status, 500); assert.doesNotMatch(out.text, /private provider text/);
  } finally { db.close(); }
});

test('D1133 a failed renewal is recorded once as renewal_failed, never as a checkout refusal', async () => {
  const db = database();
  try {
    stripe['/invoices/in_ada1'] = { body: { subscription: 'sub_ada', billing_reason: 'subscription_cycle' } };
    await hook(db, 'payment_intent.payment_failed', { invoice: 'in_ada1', last_payment_error: { type: 'card_error' } });
    await hook(db, 'invoice.payment_failed', renewal());
    assert.deepEqual(activity(db).map((r) => r.action), ['renewal_failed']);
  } finally { db.close(); }
});


test('D1133 normal-customer account plans and shared-customer founder plans update the correct existing card endpoint', async () => {
  const db = database();
  try {
    db.prepare("UPDATE users SET investor_stripe_customer_id='cus_ada', investor_stripe_subscription_id='sub_inv' WHERE id=?").run(ADA);
    await hook(db, 'invoice.payment_failed', renewal());
    stripe['/invoices/in_ada1'] = { body: recoveryInvoice() };
    stripe['/setup_intents'] = { body: { client_secret: 'seti_fixture_secret_synthetic' } };
    const out = await strong(db, `/api/billing/alerts/${alerts(db)[0].id}/update-card`);
    assert.equal(out.status, 200); assert.equal(out.body.scope, 'founder');
    // The normal/founder selector is also the existing account-plan customer
    // endpoint; it has no founder-role gate. Exercise its real handler.
    await hook(db, 'invoice.payment_failed', renewal({ id: 'in_pat1', subscription: 'sub_pat', customer: 'cus_pat' }));
    stripe['/invoices/in_pat1'] = { body: recoveryInvoice({ id: 'in_pat1', subscription: 'sub_pat', customer: 'cus_pat' }) };
    const setup = await strong(db, `/api/billing/alerts/${alerts(db)[1].id}/update-card`, PAT);
    assert.equal(setup.body.scope, 'founder');
    stripe['/payment_methods/pm_new'] = { body: { id: 'pm_new', customer: 'cus_pat' } };
    stripe['/customers/cus_pat'] = { body: { id: 'cus_pat' } };
    stripe['/subscriptions'] = { body: { data: [{ id: 'sub_pat', status: 'active' }] } };
    stripe['/subscriptions/sub_pat'] = { body: { id: 'sub_pat' } };
    assert.equal((await strong(db, '/api/billing/payment-method/default', PAT, true, 'totp', { scope: setup.body.scope, payment_method_id: 'pm_new' })).status, 200);
    assert.ok(calls.includes('POST /customers/cus_pat'));
    assert.ok(calls.includes('POST /subscriptions/sub_pat'));
    assert.ok(!calls.some((c) => c.includes('cus_ada') && c.startsWith('POST')));
  } finally { db.close(); }
});
