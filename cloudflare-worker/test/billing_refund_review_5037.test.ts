/**
 * D5037 (#5037) — a refund is Lookup → Review → Confirm → Step-up → Refund.
 *
 * What this file holds the route to:
 *   - the lookup (`POST /refund/review`) moves no money and writes nothing, and shows what the operator must see:
 *     gross, refunded to date, what is left, the amount asked, full or partial, the policy and the clawback;
 *   - the write (`POST /refund`) refuses a raw identifier: no review token, no refund, and Stripe is never asked;
 *   - a review is this admin's, untampered, unexpired, and still true when confirmed (`review_stale` otherwise);
 *   - a blocked policy and an UNAVAILABLE policy both need an explicit override with its own written reason, recorded
 *     in Stripe metadata and on the audit row. Unavailable is never read as allowed;
 *   - a partial refund cannot exceed what Stripe says is left; a full one sends exactly that;
 *   - the referral clawback is previewed on the review and audited on the refund.
 *
 * Stripe is a stub on `globalThis.fetch` holding one charge whose refunded total moves when a refund lands.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import billing from '../src/routes/admin_billing.ts';
import { decideRefundPolicy, signReview, verifyReview, REVIEW_TTL_SECONDS } from '../src/services/refundReview.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;
const SUPER2 = 3;
const PLAIN = 2;
const REASON = 'Customer cancelled within the window; confirmed by email on the 4th.';
const OVERRIDE = 'Owner approved the exception in writing on 2026-11-08.';

const ERRORS = { Unauthorized: 401, 'Admin required': 403, 'Super admin required': 403, 'HQ only': 403, 'TOTP required': 403, step_up_required: 403 } as Record<string, 401 | 403>;
const app = new Hono<any>();
app.route('/', billing);
app.onError((err: any, c) => {
  const s = ERRORS[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

function coerce(a: any[]): any[] { return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v)); }
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { const r = db.prepare(sql).run(...b); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run().catch(() => ({}))); return out; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
      name TEXT, email TEXT, stripe_customer_id TEXT, investor_stripe_customer_id TEXT);
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
    CREATE TABLE user_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, jti TEXT, factor TEXT, assurance_level TEXT,
      revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT, last_step_up_at TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE admin_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER NOT NULL, action TEXT NOT NULL,
      report_type TEXT, format TEXT, filters_json TEXT, storage_key TEXT, download_url TEXT,
      exported_at TEXT NOT NULL DEFAULT (datetime('now')), viewed_user_id INTEGER, conversation_id INTEGER, viewed_at TEXT);
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE incorporations (id INTEGER PRIMARY KEY, status TEXT, stripe_payment_intent TEXT);
    CREATE TABLE commissions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, referral_id INTEGER,
      amount_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', source_type TEXT NOT NULL, source_id TEXT,
      status TEXT NOT NULL DEFAULT 'accrued', description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, paid_at TIMESTAMP,
      reversed_amount_cents INTEGER NOT NULL DEFAULT 0, reversed_at TIMESTAMP);
  `);
  const u = db.prepare('INSERT INTO users (id, role, name, email, stripe_customer_id) VALUES (?,?,?,?,?)');
  u.run(SUPER, 'admin', 'Sue', 'sue@axal.example', null);
  u.run(PLAIN, 'admin', 'Pat', 'pat@axal.example', null);
  u.run(SUPER2, 'admin', 'Sam', 'sam@axal.example', null);
  u.run(40, 'founder', 'Fay Founder', 'fay@example.test', 'cus_40');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER2);
  for (const id of [SUPER, PLAIN, SUPER2]) {
    db.prepare(`INSERT INTO user_sessions (user_id, jti, factor, assurance_level) VALUES (?, ?, 'totp', 'totp')`).run(id, `totp-${id}`);
  }
  return db;
}
const env = (db: InstanceType<typeof DatabaseSync>) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), STRIPE_SECRET_KEY: 'sk_test_stub' });
const jwt = (userId: number) => new SignJWT({ user_id: userId, role: 'admin', jti: `totp-${userId}` })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));

/** One charge of `amount` EUR cents with `refunded` already refunded; a refund adds to it. Every call is recorded. */
function stubStripe(o: { amount?: number; refunded?: number; metadata?: Record<string, string>; fail?: boolean } = {}) {
  const state = { refunded: o.refunded ?? 0 };
  const calls: Array<{ url: string; method: string; form: Record<string, string>; idem: string | null }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);
    const form = Object.fromEntries(new URLSearchParams(String(init.body || '')));
    calls.push({ url, method: String(init.method || 'GET'), form, idem: init.headers?.['Idempotency-Key'] ?? null });
    const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
    if (o.fail) return json({ error: { message: 'down' } }, 500);
    const amount = o.amount ?? 10_000;
    if (url.includes('/v1/refunds')) {
      state.refunded += Number(form.amount);
      return json({ id: `re_${calls.length}`, object: 'refund', amount: Number(form.amount), currency: 'eur', charge: 'ch_1', payment_intent: 'pi_1', status: 'succeeded' });
    }
    if (url.includes('/v1/payment_intents/')) return json({ id: 'pi_1', amount, currency: 'eur', latest_charge: 'ch_1', customer: 'cus_40', metadata: o.metadata ?? {} });
    if (url.includes('/v1/charges/')) return json({ id: 'ch_1', amount, amount_refunded: state.refunded, currency: 'eur', paid: true, payment_intent: 'pi_1', customer: 'cus_40', metadata: {} });
    return json({});
  }) as any;
  return {
    state, calls, restore: () => { globalThis.fetch = real; },
    refunds: () => calls.filter((x) => x.url.includes('/v1/refunds')),
  };
}

async function post(e: any, actor: number, path: string, body: Record<string, unknown>) {
  const res = await app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${await jwt(actor)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, e);
  let json: any = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
const review = (e: any, body: Record<string, unknown>, actor = SUPER) => post(e, actor, '/refund/review', body);
const confirm = (e: any, body: Record<string, unknown>, actor = SUPER) => post(e, actor, '/refund', { reason: REASON, ...body });
const audit = (db: any) => (db.prepare("SELECT * FROM admin_audit_log WHERE action = 'billing_refund' ORDER BY rowid").all() as any[]).map((r) => JSON.parse(r.filters_json));

test('the lookup moves no money, writes nothing, and shows the payment before anything is confirmed', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO commissions (user_id, amount_cents, currency, source_type, source_id) VALUES (9, 1000, 'EUR', 'purchase', 'pi_1')").run();
  const s = stubStripe({ amount: 10_000, refunded: 2_000 });
  try {
    const r = await review(env(db), { payment_intent: 'pi_1', amount_major: '30.00' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const v = r.body.review;
    assert.deepEqual([v.payment_intent, v.charge, v.currency], ['pi_1', 'ch_1', 'EUR']);
    assert.deepEqual([v.gross_cents, v.refunded_cents, v.remaining_cents, v.requested_cents, v.full], [10_000, 2_000, 8_000, 3_000, false]);
    assert.deepEqual(v.account, { known: true, user_id: 40, name: 'Fay Founder', email: 'fay@example.test' });
    assert.equal(v.policy.state, 'allowed');
    assert.equal(v.policy.override_required, false);
    assert.match(v.policy.note, /default rule/);
    // 1000 × (2000 + 3000) / 10000 = 500 of the commission reversed.
    assert.deepEqual(v.clawback, { outcome: 'would_reverse', commission_id: 1, amount_cents: 500, currency: 'EUR', full: false });
    assert.equal(typeof r.body.review_token, 'string');
    assert.equal(s.refunds().length, 0, 'a lookup asked Stripe to refund');
    assert.ok(s.calls.every((c) => c.method === 'GET'), 'a lookup made a non-GET Stripe call');
    assert.equal(audit(db).length, 0, 'a lookup wrote an audit row');
    assert.equal((db.prepare('SELECT reversed_amount_cents AS n FROM commissions').get() as any).n, 0, 'a lookup reversed a commission');
  } finally { s.restore(); }
});

test('a raw identifier is refused: no review token, no refund, and Stripe is never asked', async () => {
  const db = freshDb();
  const s = stubStripe();
  try {
    const raw = await confirm(env(db), { payment_intent: 'pi_1' });
    assert.equal(raw.status, 400);
    assert.equal(raw.body.code, 'review_required');
    assert.equal(s.calls.length, 0, 'a raw-identifier refund reached Stripe');
    const r = await review(env(db), { payment_intent: 'pi_1' });
    const named = await confirm(env(db), { review_token: r.body.review_token, amount: 1 });
    assert.equal(named.status, 400);
    assert.equal(named.body.code, 'review_fixed', 'a confirm that names its own amount was accepted');
    assert.equal(s.refunds().length, 0);
  } finally { s.restore(); }
});

test('a review is this admin\'s, untampered and unexpired', async () => {
  const db = freshDb();
  const s = stubStripe();
  try {
    const r = await review(env(db), { payment_intent: 'pi_1' });
    const other = await confirm(env(db), { review_token: r.body.review_token }, SUPER2);
    assert.equal(other.status, 409);
    assert.equal(other.body.code, 'review_invalid', 'another admin confirmed someone else\'s review');
    const [body, sig] = r.body.review_token.split('.');
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    const forged = `${Buffer.from(JSON.stringify({ ...claims, req: 1 })).toString('base64url')}.${sig}`;
    assert.equal((await confirm(env(db), { review_token: forged })).body.code, 'review_invalid', 'a tampered review was accepted');
    const old = await signReview(env(db) as any, { ...claims, exp: Math.floor(Date.now() / 1000) - 1 });
    assert.equal((await confirm(env(db), { review_token: old })).body.code, 'review_expired');
    assert.equal(s.refunds().length, 0);
    const ok = await verifyReview(env(db) as any, r.body.review_token, SUPER);
    assert.equal(ok.ok, true);
    assert.ok(ok.ok && ok.claims.exp - ok.claims.iat === REVIEW_TTL_SECONDS);
  } finally { s.restore(); }
});

test('a plain admin cannot look a payment up, and a stale step-up cannot confirm', async () => {
  const db = freshDb();
  const s = stubStripe();
  try {
    const plain = await review(env(db), { payment_intent: 'pi_1' }, PLAIN);
    assert.equal(plain.status, 403);
    assert.equal(s.calls.length, 0);
    const r = await review(env(db), { payment_intent: 'pi_1' });
    db.prepare("UPDATE user_sessions SET created_at = datetime('now', '-2 hours') WHERE user_id = ?").run(SUPER);
    const stale = await confirm(env(db), { review_token: r.body.review_token });
    assert.equal(stale.status, 403);
    assert.equal(stale.body.detail, 'step_up_required');
    assert.equal(s.refunds().length, 0);
  } finally { s.restore(); }
});

test('a partial refund cannot exceed what is left; a full one sends exactly what is left', async () => {
  const db = freshDb();
  const s = stubStripe({ amount: 10_000, refunded: 7_500 });
  try {
    const over = await review(env(db), { payment_intent: 'pi_1', amount_major: '25.01' });
    assert.equal(over.status, 409);
    assert.equal(over.body.code, 'over_remaining');
    assert.equal(over.body.remaining_cents, 2_500);
    const part = await review(env(db), { payment_intent: 'pi_1', amount_major: '10.00' });
    const p = await confirm(env(db), { review_token: part.body.review_token });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.equal(s.refunds()[0].form.amount, '1000');
    const full = await review(env(db), { payment_intent: 'pi_1' });
    assert.equal(full.body.review.full, true);
    assert.equal(full.body.review.requested_cents, 1_500);
    const f = await confirm(env(db), { review_token: full.body.review_token });
    assert.equal(f.status, 200, JSON.stringify(f.body));
    assert.equal(s.refunds()[1].form.amount, '1500');
    const done = await review(env(db), { payment_intent: 'pi_1' });
    assert.equal(done.status, 409);
    assert.equal(done.body.code, 'nothing_refundable');
    const rows = audit(db);
    assert.deepEqual(rows.map((r) => [r.review.remaining_before_cents, r.review.requested_cents, r.review.full]), [[2_500, 1_000, false], [1_500, 1_500, true]]);
  } finally { s.restore(); }
});

test('a review that is no longer true is refused: another refund landed in between', async () => {
  const db = freshDb();
  const s = stubStripe({ amount: 10_000 });
  try {
    const r = await review(env(db), { payment_intent: 'pi_1', amount_major: '60.00' });
    s.state.refunded = 5_000; // someone refunded half in the Stripe dashboard
    const c = await confirm(env(db), { review_token: r.body.review_token });
    assert.equal(c.status, 409);
    assert.equal(c.body.code, 'review_stale');
    assert.equal(c.body.now.remaining_cents, 5_000);
    assert.equal(s.refunds().length, 0, 'a refund was issued against a stale review');
  } finally { s.restore(); }
});

test('one review is one refund: a double confirm sends the same idempotency key', async () => {
  const db = freshDb();
  const s = stubStripe({ amount: 10_000 });
  try {
    const r = await review(env(db), { payment_intent: 'pi_1', amount_major: '10.00' });
    const a = await confirm(env(db), { review_token: r.body.review_token });
    assert.equal(a.status, 200);
    const r2 = await review(env(db), { payment_intent: 'pi_1', amount_major: '10.00' });
    await confirm(env(db), { review_token: r2.body.review_token });
    const keys = s.refunds().map((x) => x.idem);
    assert.ok(keys[0] && keys[0].startsWith('refund-review:'), 'no idempotency key was sent');
    assert.notEqual(keys[0], keys[1], 'two reviews collapsed into one refund key');
  } finally { s.restore(); }
});

test('a blocked policy needs an explicit override with its own written reason, and both are recorded', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO incorporations (id, status, stripe_payment_intent) VALUES (7, 'filed', 'pi_1')").run();
  const s = stubStripe({ metadata: { kind: 'incorporation', incorporation_id: '7' } });
  try {
    const r = await review(env(db), { payment_intent: 'pi_1' });
    assert.equal(r.body.review.policy.state, 'blocked');
    assert.equal(r.body.review.policy.reason, 'incorporation_filed:filed');
    assert.equal(r.body.review.policy.override_required, true);
    const no = await confirm(env(db), { review_token: r.body.review_token });
    assert.equal(no.status, 409);
    assert.equal(no.body.code, 'refund_policy_blocked');
    const bare = await confirm(env(db), { review_token: r.body.review_token, override_policy: true });
    assert.equal(bare.status, 400);
    assert.equal(bare.body.code, 'override_reason_required');
    assert.equal(s.refunds().length, 0);
    const yes = await confirm(env(db), { review_token: r.body.review_token, override_policy: true, override_reason: OVERRIDE });
    assert.equal(yes.status, 200, JSON.stringify(yes.body));
    const f = s.refunds()[0].form;
    assert.equal(f['metadata[policy_override]'], '1');
    assert.equal(f['metadata[policy_state]'], 'blocked');
    assert.equal(f['metadata[override_reason]'], OVERRIDE);
    const row = audit(db)[0];
    assert.equal(row.policy_override, true);
    assert.equal(row.override_reason, OVERRIDE);
  } finally { s.restore(); }
});

test('a policy that cannot be resolved is Policy unavailable, never allowed, and needs an audited override', async () => {
  const db = freshDb();
  const s = stubStripe({ metadata: { kind: 'incorporation' } }); // no incorporation row for pi_1
  try {
    const r = await review(env(db), { payment_intent: 'pi_1' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.review.policy.state, 'unavailable', 'an unresolvable policy was read as a decision');
    assert.equal(r.body.review.policy.override_required, true);
    const no = await confirm(env(db), { review_token: r.body.review_token });
    assert.equal(no.status, 409);
    assert.equal(no.body.code, 'policy_unavailable');
    assert.equal(s.refunds().length, 0, 'an unresolvable policy let money move without an override');
    const yes = await confirm(env(db), { review_token: r.body.review_token, override_policy: true, override_reason: OVERRIDE });
    assert.equal(yes.status, 200, JSON.stringify(yes.body));
    const f = s.refunds()[0].form;
    assert.equal(f['metadata[policy_unavailable]'], '1');
    assert.equal(f['metadata[override_reason]'], OVERRIDE);
    const row = audit(db)[0];
    assert.equal(row.policy_state, 'unavailable');
    assert.equal(row.policy_override, true);
    assert.equal(row.override_reason, OVERRIDE);
  } finally { s.restore(); }
});

test('a lookup Stripe cannot answer refuses, and nothing is reviewed against a guess', async () => {
  const db = freshDb();
  const s = stubStripe({ fail: true });
  try {
    const r = await review(env(db), { payment_intent: 'pi_1' });
    assert.equal(r.status, 502);
    assert.equal(r.body.code, 'lookup_failed');
    assert.equal(r.body.review_token, undefined);
    const bad = await review(env(db), { payment_intent: 'not-an-id' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'invalid_target');
  } finally { s.restore(); }
});

test('the referral clawback is audited on the refund', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO commissions (user_id, amount_cents, currency, source_type, source_id) VALUES (9, 1000, 'EUR', 'purchase', 'pi_1')").run();
  const s = stubStripe({ amount: 10_000 });
  try {
    const r = await review(env(db), { payment_intent: 'pi_1' });
    const c = await confirm(env(db), { review_token: r.body.review_token });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(c.body.clawback.outcome, 'reversed');
    assert.equal(audit(db)[0].clawback.outcome, 'reversed');
    assert.equal(audit(db)[0].clawback.reversed_amount_cents, 1000);
  } finally { s.restore(); }
});

test('the policy evaluator: booking window, unreadable D1, subscriptions and the default rule', async () => {
  const db = freshDb();
  const t = (metadata: Record<string, string>) => ({ payment_intent: 'pi_1', charge: 'ch_1', currency: 'EUR', gross: 1, refunded: 0, remaining: 1, customer: null, metadata, description: null, created: null });
  const e = env(db) as any;
  assert.equal((await decideRefundPolicy(e, t({ kind: 'expert_booking' }))).state, 'unavailable', 'a booking table that is missing was read as allowed');
  db.exec('CREATE TABLE expert_bookings (id INTEGER PRIMARY KEY, scheduled_at TEXT, stripe_payment_intent_id TEXT)');
  db.prepare('INSERT INTO expert_bookings (id, scheduled_at) VALUES (1, ?)').run(new Date(Date.now() + 3_600_000).toISOString());
  db.prepare('INSERT INTO expert_bookings (id, scheduled_at) VALUES (2, ?)').run(new Date(Date.now() + 3 * 86_400_000).toISOString());
  assert.equal((await decideRefundPolicy(e, t({ kind: 'expert_booking', booking_id: '1' }))).state, 'blocked');
  assert.equal((await decideRefundPolicy(e, t({ kind: 'expert_booking', booking_id: '2' }))).state, 'allowed');
  assert.equal((await decideRefundPolicy(e, t({ kind: 'expert_booking', booking_id: '99' }))).state, 'unavailable');
  assert.match((await decideRefundPolicy(e, t({ kind: 'tier' }))).note, /prorated/);
  const plain = await decideRefundPolicy(e, t({}));
  assert.deepEqual([plain.state, plain.kind], ['allowed', 'unknown']);
});
