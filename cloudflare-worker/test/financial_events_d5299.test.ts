/**
 * D5299 (#5299, slice 1 of #5038) — the revenue ledger, `financial_events`.
 *
 * Every Stripe event goes through the real webhook route (`POST /api/billing/stripe/webhook`, which soft-accepts
 * without a secret in tests) over the real migration, with Stripe stubbed; HQ's refunds go through the real
 * `POST /api/admin/billing/refund`. Covered:
 *   - each event kind lands once, with its native currency and integer minor units, and a replay writes nothing new;
 *   - out-of-order delivery: a refund before its charge, a dispute closed before it opened, each its own row dated by
 *     the event, not by arrival;
 *   - a refund made outside HQ's route (Stripe's `charge.refunded` alone) is recorded; one HQ made is one row whether
 *     HQ's write or Stripe's event lands first;
 *   - attribution is what the event names; an unresolvable one stays NULL and is reported as unattributed;
 *   - a missing amount is NULL, never 0; currency is kept per row and nothing is summed across currencies;
 *   - a failed write leaves no row and the webhook answers non-2xx with its receipt unfinished, so Stripe retries;
 *   - rows are immutable and kept; only `setReconciliationState` moves a row, by an allowed move, compare-and-set;
 *   - the coverage start is recorded per source; the runtime safety net is the migration, statement for statement.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/financial_events_d5299.test.ts
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import billing from '../src/routes/billing.ts';
import adminBilling from '../src/routes/admin_billing.ts';
import {
  FINANCIAL_EVENTS_DDL, FINANCIAL_EVENT_KINDS, coverageStarts, setReconciliationState, unattributedFields, writeFinancialEvent,
} from '../src/services/financialEvents.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const MIGRATION = 'cloudflare-worker/sql/migrations/202611100929_financial_events.sql';
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADA = 61, IRA = 62, SUPER = 1;
const REASON = 'Customer cancelled within the window; confirmed by email on the 4th.';

// ── Stripe, stubbed: one EUR charge whose refunded total moves when HQ refunds it ──
let charge = { amount: 10_000, refunded: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url);
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
  const form = Object.fromEntries(new URLSearchParams(String(init.body || '')));
  if (url.includes('/v1/refunds')) {
    charge.refunded += Number(form.amount);
    return json({ id: `re_hq${charge.refunded}`, object: 'refund', amount: Number(form.amount), currency: 'eur', charge: 'ch_hq', payment_intent: 'pi_hq', status: 'succeeded' });
  }
  if (url.includes('/v1/payment_intents/')) return json({ id: 'pi_hq', amount: charge.amount, currency: 'eur', latest_charge: 'ch_hq', customer: 'cus_ada', metadata: { kind: 'cart_order', user_id: String(ADA) } });
  if (url.includes('/v1/charges/')) return json({ id: 'ch_hq', amount: charge.amount, amount_refunded: charge.refunded, currency: 'eur', paid: true, payment_intent: 'pi_hq', customer: 'cus_ada', metadata: {} });
  if (url.startsWith('https://api.stripe.com/')) return json({ error: { message: 'no stub' } }, 404);
  return new Response('unexpected call in test', { status: 599 });
}) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });
beforeEach(() => { charge = { amount: 10_000, refunded: 0 }; });

// ── A database: users and the webhook's tables as production has them, and this migration ──
function database({ ledger = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const baseline = read('cloudflare-worker/sql/schema_baseline.sql');
  for (const t of ['users', 'user_sessions', 'activity_logs', 'account_subscriptions']) db.exec(tableFromBaseline(baseline, t));
  db.exec(`CREATE TABLE IF NOT EXISTS mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'free', subscription_id TEXT UNIQUE, plan TEXT, period_end TEXT, stripe_customer_id TEXT, updated_at TEXT);
    CREATE TABLE ai_topup_purchases (payment_intent_id TEXT PRIMARY KEY, user_id INTEGER, credited_at TEXT);
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
    CREATE TABLE admin_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER NOT NULL, action TEXT NOT NULL,
      report_type TEXT, format TEXT, filters_json TEXT, storage_key TEXT, download_url TEXT,
      exported_at TEXT NOT NULL DEFAULT (datetime('now')), viewed_user_id INTEGER, conversation_id INTEGER, viewed_at TEXT);
    CREATE TABLE commissions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, referral_id INTEGER,
      amount_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', source_type TEXT NOT NULL, source_id TEXT,
      status TEXT NOT NULL DEFAULT 'accrued', description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, paid_at TIMESTAMP,
      reversed_amount_cents INTEGER NOT NULL DEFAULT 0, reversed_at TIMESTAMP);`);
  db.exec(read('cloudflare-worker/sql/migrations/505_member_subscription_amounts.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/578_billing_alerts.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/097_stripe_products.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/691_stripe_mode_stamps.sql'));
  if (ledger) db.exec(read(MIGRATION));
  const u = db.prepare('INSERT INTO users (id, role, name, email, uid, is_active, stripe_customer_id) VALUES (?, ?, ?, ?, ?, 1, ?)');
  u.run(ADA, 'founder', 'Ada Quill', 'ada@example.test', 'uid-61', 'cus_ada');
  u.run(IRA, 'founder', 'Ira Vale', 'ira@example.test', 'uid-62', 'cus_ira');
  u.run(SUPER, 'admin', 'Sue', 'sue@axal.example', 'uid-1', null);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare(`INSERT INTO user_sessions (user_id, jti, factor, assurance_level) VALUES (?, 'totp-1', 'totp', 'totp')`).run(SUPER);
  return db;
}
const env = (db: DatabaseSync, over: Record<string, unknown> = {}) =>
  ({ JWT_SECRET, ENVIRONMENT: 'test', STRIPE_SECRET_KEY: 'sk_test_sentinel', DB: d1Over(db), ...over } as any);
const app = (() => {
  const a = new Hono<any>();
  a.route('/api/billing', billing);
  a.route('/api/admin/billing', adminBilling);
  a.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')] ?? ({ 'Super admin required': 403, 'HQ only': 403, 'TOTP required': 403, step_up_required: 403 } as Record<string, number>)[String(err?.message || '')];
    return s ? c.json({ detail: err.message }, s as any) : c.json({ detail: String(err?.message || '') }, 500);
  });
  return a;
})();
async function hit(e: any, path: string, body: unknown, auth?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${auth}`;
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await app.request(path, { method: 'POST', headers, body: JSON.stringify(body) }, e);
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json };
  } finally { [console.warn, console.error, console.log] = saved; }
}
const T0 = 1_790_000_000;
const hook = (e: any, id: string, type: string, object: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  hit(e, '/api/billing/stripe/webhook', { id, livemode: false, type, created: T0, data: { object }, ...extra });
const rows = (db: DatabaseSync) => db.prepare('SELECT * FROM financial_events ORDER BY id').all() as any[];
const receipt = (db: DatabaseSync, id: string) =>
  (db.prepare('SELECT handled_at FROM stripe_webhook_events WHERE event_id = ?').get(id) as any)?.handled_at ?? null;
const iso = (sec: number) => new Date(sec * 1000).toISOString().replace('.000Z', 'Z');

const succeeded = (over: Record<string, unknown> = {}) => ({
  id: 'ch_a1', object: 'charge', amount: 4_900, amount_captured: 4_900, amount_refunded: 0, captured: true, currency: 'usd',
  customer: 'cus_ada', payment_intent: 'pi_a1', metadata: {}, ...over,
});

// ── the schema ──────────────────────────────────────────────────────────────

test('the runtime safety net is the migration, statement for statement', () => {
  const norm = (s: string) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  const file = norm(read(MIGRATION));
  for (const sql of FINANCIAL_EVENTS_DDL) assert.ok(file.includes(norm(sql)), `not in the migration: ${norm(sql).slice(0, 80)}`);
  const stmts = file.split(/;(?= |$)/).map((s) => s.trim()).filter(Boolean);
  // A trigger body holds its own `;`, so count CREATE/INSERT heads instead of splitting naively.
  const heads = (file.match(/\b(CREATE (TABLE|UNIQUE INDEX|INDEX|TRIGGER) IF NOT EXISTS|INSERT OR IGNORE INTO)\b/g) || []).length;
  assert.equal(heads, FINANCIAL_EVENTS_DDL.length, `${stmts.length} statements; the safety net has ${FINANCIAL_EVENTS_DDL.length}`);
  // A database the migration never reached heals to the same objects.
  const a = database({ ledger: true }), b = database({ ledger: false });
  for (const sql of FINANCIAL_EVENTS_DDL) b.prepare(sql).run();
  const objects = (db: DatabaseSync) => db.prepare(`SELECT type, name, sql FROM sqlite_master WHERE name LIKE '%financial_event%' ORDER BY name`).all();
  assert.deepEqual(objects(b).map((o: any) => [o.type, o.name]), objects(a).map((o: any) => [o.type, o.name]));
});

test('coverage: each source records when the ledger began; nothing before it, and the row cannot move', async () => {
  const db = database();
  const starts = await coverageStarts(env(db));
  assert.deepEqual(Object.keys(starts), ['hq', 'stripe']);
  for (const v of Object.values(starts)) assert.match(v, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.throws(() => db.prepare(`UPDATE financial_event_coverage SET coverage_starts_at = '2020-01-01T00:00:00Z'`).run(), /immutable/);
  assert.throws(() => db.prepare('DELETE FROM financial_event_coverage').run(), /kept/);
  await assert.rejects(writeFinancialEvent(env(db), {
    source: 'mercury' as any, source_event_id: 'x1', source_event_type: 'x', kind: 'adjustment', livemode: null, object_ref: null,
    charge_ref: null, payment_intent_ref: null, invoice_ref: null, customer_ref: null, refund_key: null, user_id: null,
    company_id: null, project_id: null, licence_uid: null, revenue_stream: null, product_ref: null, actor_user_id: null,
    currency: 'USD', gross_cents: 1, refund_cents: 0, net_cents: 1, occurred_at: null,
  }), /no coverage row/);
  assert.equal(rows(db).length, 0);
});

// ── each kind, once ─────────────────────────────────────────────────────────

test('each event kind lands once, in its own currency and minor units, and a replay writes nothing new', async () => {
  const db = database();
  const e = env(db);
  const events: Array<[string, string, Record<string, unknown>, Record<string, unknown>?]> = [
    ['evt_inv', 'invoice.paid', { id: 'in_a1', object: 'invoice', amount_paid: 24_900, currency: 'usd', customer: 'cus_ada', charge: 'ch_inv', payment_intent: 'pi_inv', subscription: 'sub_a', subscription_details: { metadata: { kind: 'tier', user_id: String(ADA) } } }],
    ['evt_ch', 'charge.succeeded', succeeded()],
    ['evt_pi', 'payment_intent.succeeded', { id: 'pi_b1', object: 'payment_intent', amount: 1_500, amount_received: 1_500, currency: 'gbp', customer: 'cus_ira', latest_charge: 'ch_b1', metadata: { kind: 'cart_order', user_id: String(IRA), product_id: 'prod_pack', project_id: '7', licence_uid: 'lic-uk-1' } }],
    ['evt_rf', 'charge.refunded', succeeded({ amount_refunded: 1_000, refunded: false }), { data: { object: succeeded({ amount_refunded: 1_000 }), previous_attributes: { amount_refunded: 0 } } }],
    ['evt_dp1', 'charge.dispute.created', { id: 'dp_a1', object: 'dispute', amount: 3_900, currency: 'usd', charge: 'ch_a1', payment_intent: 'pi_a1', status: 'needs_response', metadata: {} }],
    ['evt_dp2', 'charge.dispute.closed', { id: 'dp_a1', object: 'dispute', amount: 3_900, currency: 'usd', charge: 'ch_a1', payment_intent: 'pi_a1', status: 'won', metadata: {} }],
  ];
  for (const [id, type, object, extra] of events) {
    const r = await hook(e, id, type, object, extra);
    assert.equal(r.status, 200, `${type}: ${JSON.stringify(r.body)}`);
    assert.ok(receipt(db, id), `${type} acknowledged as handled`);
  }
  const got = rows(db).map((r) => [r.source_event_id, r.kind, r.currency, r.gross_cents, r.refund_cents, r.net_cents]);
  assert.deepEqual(got, [
    ['evt_inv', 'invoice', 'USD', 24_900, 0, 24_900],
    ['evt_ch', 'charge', 'USD', 4_900, 0, 4_900],
    ['evt_pi', 'payment', 'GBP', 1_500, 0, 1_500],
    ['evt_rf', 'refund', 'USD', 0, 1_000, -1_000],
    ['evt_dp1', 'dispute', 'USD', 0, 3_900, -3_900],
    ['evt_dp2', 'dispute', 'USD', 3_900, 0, 3_900],
  ]);
  const [inv, ch, pi, rf] = rows(db);
  assert.deepEqual([inv.invoice_ref, inv.charge_ref, inv.payment_intent_ref, inv.user_id, inv.revenue_stream], ['in_a1', 'ch_inv', 'pi_inv', ADA, 'tier']);
  assert.deepEqual([ch.object_ref, ch.payment_intent_ref, ch.customer_ref, ch.user_id], ['ch_a1', 'pi_a1', 'cus_ada', ADA]);
  assert.deepEqual([pi.user_id, pi.project_id, pi.licence_uid, pi.product_ref, pi.revenue_stream], [IRA, 7, 'lic-uk-1', 'prod_pack', 'cart_order']);
  assert.equal(rf.refund_key, 'ch_a1:1000');
  for (const r of rows(db)) {
    assert.equal(r.occurred_at, iso(T0));
    assert.equal(r.reconciliation_state, 'pending');
    assert.equal(r.livemode, 0);
  }
  // A kind the webhook does not make is HQ's to write: an adjustment, through the same one-statement write.
  assert.equal(await writeFinancialEvent(e, {
    source: 'hq', source_event_id: 'adj_1', source_event_type: 'hq.adjustment', kind: 'adjustment', livemode: null, object_ref: null,
    charge_ref: null, payment_intent_ref: null, invoice_ref: null, customer_ref: null, refund_key: null, user_id: ADA,
    company_id: null, project_id: null, licence_uid: null, revenue_stream: null, product_ref: null, actor_user_id: SUPER,
    currency: 'USD', gross_cents: 0, refund_cents: 250, net_cents: -250, occurred_at: iso(T0),
  }), true);
  assert.deepEqual([...new Set(rows(db).map((r) => r.kind))].sort(), [...FINANCIAL_EVENT_KINDS].sort());

  // Replay: every event again (Stripe's retry, or a receipt that was lost) writes nothing new.
  const before = rows(db).length;
  for (const [id, type, object, extra] of events) {
    db.prepare('UPDATE stripe_webhook_events SET handled_at = NULL WHERE event_id = ?').run(id); // the ledger, not the receipt, must hold
    const r = await hook(e, id, type, object, extra);
    assert.equal(r.status, 200);
  }
  for (const [id, type, object, extra] of events) assert.equal((await hook(e, id, type, object, extra)).body?.duplicate, true);
  assert.equal(rows(db).length, before);
});

test('events the ledger does not record write nothing', async () => {
  const db = database();
  for (const [i, type] of ['invoice.finalized', 'customer.subscription.updated', 'invoice.payment_failed', 'account.updated'].entries()) {
    await hook(env(db), `evt_x${i}`, type, { id: `in_x${i}`, object: 'invoice', currency: 'usd', amount_paid: 100, customer: 'cus_ada' });
  }
  assert.equal(rows(db).length, 0);
});

// ── order, currency, missing amounts ────────────────────────────────────────

test('out-of-order delivery: each event is its own row, dated by the event, not by arrival', async () => {
  const db = database();
  const e = env(db);
  // The second partial refund arrives first, then the charge, then the first refund; a dispute closes before it opens.
  await hook(e, 'evt_r2', 'charge.refunded', {}, { created: T0 + 300, data: { object: succeeded({ amount_refunded: 3_000 }), previous_attributes: { amount_refunded: 1_000 } } });
  await hook(e, 'evt_c', 'charge.succeeded', succeeded(), { created: T0 });
  await hook(e, 'evt_r1', 'charge.refunded', {}, { created: T0 + 100, data: { object: succeeded({ amount_refunded: 1_000 }), previous_attributes: { amount_refunded: 0 } } });
  await hook(e, 'evt_d2', 'charge.dispute.closed', { id: 'dp_o', amount: 900, currency: 'usd', charge: 'ch_a1', status: 'lost' }, { created: T0 + 900 });
  await hook(e, 'evt_d1', 'charge.dispute.created', { id: 'dp_o', amount: 900, currency: 'usd', charge: 'ch_a1', status: 'needs_response' }, { created: T0 + 600 });
  const ordered = db.prepare('SELECT source_event_id, kind, refund_cents, refund_key, gross_cents FROM financial_events ORDER BY occurred_at, id').all() as any[];
  assert.deepEqual(ordered.map((r) => [r.source_event_id, r.kind, r.refund_cents, r.refund_key]), [
    ['evt_c', 'charge', 0, null],
    ['evt_r1', 'refund', 1_000, 'ch_a1:1000'],
    ['evt_r2', 'refund', 2_000, 'ch_a1:3000'],
    ['evt_d1', 'dispute', 900, null],
    ['evt_d2', 'dispute', 0, null],
  ]);
});

test('currency is kept per row, and Stripe hundredths become the currency\'s own minor unit', async () => {
  const db = database();
  const e = env(db);
  await hook(e, 'evt_usd', 'charge.succeeded', succeeded({ id: 'ch_u', amount: 1_000, amount_captured: 1_000, currency: 'usd' }));
  await hook(e, 'evt_eur', 'charge.succeeded', succeeded({ id: 'ch_e', amount: 1_000, amount_captured: 1_000, currency: 'eur' }));
  await hook(e, 'evt_jpy', 'charge.succeeded', succeeded({ id: 'ch_j', amount: 1_000, amount_captured: 1_000, currency: 'jpy' }));
  await hook(e, 'evt_isk', 'charge.succeeded', succeeded({ id: 'ch_i', amount: 150_000, amount_captured: 150_000, currency: 'isk' }));
  assert.deepEqual(rows(db).map((r) => [r.currency, r.gross_cents]), [['USD', 1_000], ['EUR', 1_000], ['JPY', 1_000], ['ISK', 1_500]]);
  // Per currency, never one total.
  const byCurrency = db.prepare('SELECT currency, SUM(net_cents) AS net FROM financial_events GROUP BY currency ORDER BY currency').all() as any[];
  assert.equal(byCurrency.length, 4);
});

test('a missing amount is NULL, never 0; a row with no currency carries no amount', async () => {
  const db = database();
  const e = env(db);
  // No previous total on the event: this refund's share cannot be read.
  await hook(e, 'evt_rn', 'charge.refunded', succeeded({ amount_refunded: 500 }));
  // No amount at all.
  await hook(e, 'evt_pn', 'payment_intent.succeeded', { id: 'pi_n', currency: 'usd', customer: 'cus_ada', metadata: {} });
  // No readable currency.
  await hook(e, 'evt_cn', 'charge.succeeded', succeeded({ id: 'ch_n', currency: 'zzz' }));
  await hook(e, 'evt_rz', 'charge.refunded', {}, { data: { object: succeeded({ id: 'ch_z', currency: 'zzz', amount_refunded: 100 }), previous_attributes: { amount_refunded: 0 } } });
  const [rn, pn, cn, rz] = rows(db);
  assert.deepEqual([rn.gross_cents, rn.refund_cents, rn.net_cents, rn.refund_key], [0, null, null, 'ch_a1:500']);
  assert.deepEqual([pn.gross_cents, pn.refund_cents, pn.net_cents], [null, null, null]);
  assert.deepEqual([cn.currency, cn.gross_cents, cn.refund_cents, cn.net_cents], [null, null, null, null]);
  assert.deepEqual([rz.kind, rz.currency, rz.gross_cents, rz.refund_cents, rz.net_cents], ['refund', null, null, null, null]);
});

// ── attribution ─────────────────────────────────────────────────────────────

test('unresolved attribution stays NULL and is reported as unattributed, never guessed', async () => {
  const db = database();
  const e = env(db);
  // A customer no account records, and a customer two accounts claim: neither is a match.
  db.prepare(`UPDATE users SET investor_stripe_customer_id = 'cus_shared' WHERE id = ?`).run(ADA);
  db.prepare(`UPDATE users SET stripe_customer_id = 'cus_shared' WHERE id = ?`).run(IRA);
  await hook(e, 'evt_u1', 'charge.succeeded', succeeded({ id: 'ch_u1', customer: 'cus_nobody', metadata: { kind: 'Not A Label', project_id: 'seven' } }));
  await hook(e, 'evt_u2', 'charge.succeeded', succeeded({ id: 'ch_u2', customer: 'cus_shared' }));
  await hook(e, 'evt_u3', 'charge.succeeded', succeeded({ id: 'ch_u3', customer: null }));
  for (const r of rows(db)) {
    assert.equal(r.user_id, null, r.source_event_id);
    assert.deepEqual(unattributedFields(r), ['user_id', 'company_id', 'project_id', 'licence_uid', 'revenue_stream', 'product_ref']);
  }
  // Stamped at write time and immutable: a later link of the customer changes no row.
  db.prepare(`UPDATE users SET stripe_customer_id = 'cus_nobody' WHERE id = ?`).run(ADA);
  assert.equal(rows(db)[0].user_id, null);
  assert.throws(() => db.prepare(`UPDATE financial_events SET user_id = ? WHERE source_event_id = 'evt_u1'`).run(ADA), /immutable/);
});

test('an attribution lookup that cannot be read fails the write; it is not stored as unattributed', async () => {
  const db = database();
  db.exec('ALTER TABLE users RENAME TO users_gone');
  const r = await hook(env(db), 'evt_ul', 'charge.succeeded', succeeded());
  assert.equal(r.status, 503);
  assert.equal(rows(db).length, 0);
  assert.equal(receipt(db, 'evt_ul'), null);
});

// ── a failed write ──────────────────────────────────────────────────────────

test('a failed write leaves no row and the webhook is not acknowledged as stored; Stripe\'s retry then lands it once', async () => {
  const db = database();
  const base = d1Over(db);
  let fail = true;
  const flaky = {
    ...base,
    prepare(sql: string) {
      const st = base.prepare(sql);
      if (!/INSERT INTO financial_events/.test(sql)) return st;
      const wrap: any = { bind: (...a: unknown[]) => { st.bind(...a); return wrap; }, run: async () => { if (fail) throw new Error('D1_ERROR: database is locked'); return st.run(); } };
      return wrap;
    },
  };
  const e = env(db, { DB: flaky });
  const r = await hook(e, 'evt_f', 'charge.succeeded', succeeded());
  assert.ok(r.status >= 500, `not acknowledged: ${r.status}`);
  assert.equal(r.body?.received, undefined);
  assert.equal(rows(db).length, 0);
  assert.equal(receipt(db, 'evt_f'), null);
  fail = false;
  const retry = await hook(e, 'evt_f', 'charge.succeeded', succeeded());
  assert.equal(retry.status, 200);
  assert.ok(receipt(db, 'evt_f'));
  assert.equal(rows(db).length, 1);
});

test('a row a CHECK refuses throws; it is never dropped silently', async () => {
  const db = database();
  await assert.rejects(writeFinancialEvent(env(db), {
    source: 'hq', source_event_id: 'adj_bad', source_event_type: 'hq.adjustment', kind: 'adjustment', livemode: null, object_ref: null,
    charge_ref: null, payment_intent_ref: null, invoice_ref: null, customer_ref: null, refund_key: null, user_id: null,
    company_id: null, project_id: null, licence_uid: null, revenue_stream: null, product_ref: null, actor_user_id: null,
    currency: 'USD', gross_cents: 100, refund_cents: 0, net_cents: 99, occurred_at: null,
  }), /CHECK/);
  assert.equal(rows(db).length, 0);
});

// ── refunds: HQ's route and everywhere else ─────────────────────────────────

const jwt = () => new SignJWT({ user_id: SUPER, role: 'admin', jti: 'totp-1' })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function hqRefund(e: any, amountMajor: string) {
  const token = await jwt();
  const rv = await hit(e, '/api/admin/billing/refund/review', { payment_intent: 'pi_hq', amount_major: amountMajor }, token);
  assert.equal(rv.status, 200, JSON.stringify(rv.body));
  const r = await hit(e, '/api/admin/billing/refund', { reason: REASON, review_token: rv.body.review_token }, token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.refund;
}
const chargeRefunded = (total: number) =>
  ({ id: 'ch_hq', object: 'charge', amount: 10_000, amount_captured: 10_000, amount_refunded: total, currency: 'eur', customer: 'cus_ada', payment_intent: 'pi_hq', metadata: {} });

test('a refund HQ issued is one row, whether HQ\'s write or Stripe\'s event lands first', async () => {
  const db = database();
  const e = env(db, { ENVIRONMENT: 'development' });
  const refund = await hqRefund(e, '30.00');
  let [row] = rows(db);
  assert.deepEqual([row.source, row.source_event_id, row.kind, row.currency, row.gross_cents, row.refund_cents, row.net_cents, row.refund_key],
    ['hq', refund.id, 'refund', 'EUR', 0, 3_000, -3_000, 'ch_hq:3000']);
  assert.deepEqual([row.actor_user_id, row.user_id, row.revenue_stream, row.payment_intent_ref], [SUPER, ADA, 'cart_order', 'pi_hq']);
  // Stripe then reports it.
  const r = await hit(e, '/api/billing/stripe/webhook', { id: 'evt_hq1', livemode: false, type: 'charge.refunded', created: T0, data: { object: chargeRefunded(3_000), previous_attributes: { amount_refunded: 0 } } });
  assert.equal(r.status, 200);
  assert.equal(rows(db).length, 1);
  // The other way round: Stripe's event for the next refund lands before HQ's write.
  await hit(e, '/api/billing/stripe/webhook', { id: 'evt_hq2', livemode: false, type: 'charge.refunded', created: T0, data: { object: chargeRefunded(5_000), previous_attributes: { amount_refunded: 3_000 } } });
  await hqRefund(e, '20.00');
  const all = rows(db);
  assert.equal(all.length, 2);
  assert.deepEqual([all[1].source, all[1].refund_key, all[1].refund_cents], ['stripe', 'ch_hq:5000', 2_000]);
});

test('a refund made outside HQ\'s refund route is recorded from Stripe\'s charge.refunded', async () => {
  const db = database();
  const r = await hook(env(db), 'evt_dash', 'charge.refunded', {}, { data: { object: succeeded({ amount_refunded: 4_900, refunded: true }), previous_attributes: { amount_refunded: 0 } } });
  assert.equal(r.status, 200);
  const [row] = rows(db);
  assert.deepEqual([row.source, row.kind, row.refund_cents, row.net_cents, row.actor_user_id, row.user_id], ['stripe', 'refund', 4_900, -4_900, null, ADA]);
});

test('HQ\'s refund still succeeds when the ledger write fails: the money has moved, and the webhook records it', async () => {
  const db = database();
  db.exec('DROP TRIGGER trg_financial_events_source_covered');
  db.exec(`CREATE TRIGGER trg_block BEFORE INSERT ON financial_events WHEN NEW.source = 'hq' BEGIN SELECT RAISE(ABORT, 'blocked'); END`);
  const e = env(db, { ENVIRONMENT: 'development' });
  await hqRefund(e, '10.00');
  assert.equal(rows(db).length, 0);
  await hit(e, '/api/billing/stripe/webhook', { id: 'evt_late', livemode: false, type: 'charge.refunded', created: T0, data: { object: chargeRefunded(1_000), previous_attributes: { amount_refunded: 0 } } });
  assert.deepEqual(rows(db).map((r) => [r.source, r.refund_key]), [['stripe', 'ch_hq:1000']]);
});

// ── immutability and the one guarded path ───────────────────────────────────

test('rows are kept and never updated in place, except reconciliation through setReconciliationState', async () => {
  const db = database();
  const e = env(db);
  await hook(e, 'evt_m', 'charge.succeeded', succeeded());
  const [row] = rows(db);
  assert.throws(() => db.prepare('UPDATE financial_events SET gross_cents = 1').run(), /immutable/);
  assert.throws(() => db.prepare(`UPDATE financial_events SET currency = 'EUR'`).run(), /immutable/);
  assert.throws(() => db.prepare('DELETE FROM financial_events').run(), /kept/);

  assert.deepEqual(await setReconciliationState(e, { uid: row.uid, from: 'pending', to: 'pending', actorUserId: SUPER }), { ok: false, code: 'move_not_allowed' });
  assert.deepEqual(await setReconciliationState(e, { uid: row.uid, from: 'discrepancy', to: 'matched', actorUserId: SUPER }), { ok: false, code: 'state_changed' });
  assert.deepEqual(await setReconciliationState(e, { uid: row.uid, from: 'pending', to: 'discrepancy', actorUserId: SUPER, note: 'Stripe shows 4,800' }), { ok: true });
  assert.deepEqual(await setReconciliationState(e, { uid: row.uid, from: 'discrepancy', to: 'matched', actorUserId: SUPER }), { ok: true });
  assert.deepEqual(await setReconciliationState(e, { uid: row.uid, from: 'matched', to: 'excluded', actorUserId: SUPER }), { ok: false, code: 'move_not_allowed' });
  const [after] = rows(db);
  assert.deepEqual([after.reconciliation_state, after.reconciled_by_user_id, after.gross_cents, after.recorded_at], ['matched', SUPER, row.gross_cents, row.recorded_at]);
  assert.match(after.reconciled_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('an inquiry moves no money; the account our checkout stamped wins over a customer lookup', async () => {
  const db = database();
  const e = env(db);
  await hook(e, 'evt_inq', 'charge.dispute.created', { id: 'dp_inq', amount: 700, currency: 'usd', charge: 'ch_a1', status: 'warning_needs_response' });
  await hook(e, 'evt_meta', 'charge.succeeded', succeeded({ id: 'ch_meta', customer: 'cus_ada', metadata: { user_id: String(IRA) } }));
  const [inq, meta] = rows(db);
  assert.deepEqual([inq.kind, inq.gross_cents, inq.refund_cents, inq.net_cents], ['dispute', 0, 0, 0]);
  assert.equal(meta.user_id, IRA);
});
