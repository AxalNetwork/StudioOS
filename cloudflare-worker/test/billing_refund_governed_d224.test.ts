/**
 * D224 — a refund is HQ's governed action, and Revenue reads what was refunded.
 *
 * `POST /api/admin/billing/refund` moves money out of HQ's Stripe account.
 * Until D224 it asked for a TOTP session, a fresh step-up and `requireAdmin`,
 * so every admin could refund any charge: the D133 class. It now asks for
 * `requireSuperAdminWriteBar`, a written reason of REFUND_REASON_MIN characters,
 * and writes its audit through `logAdminAction` (D159), exactly once.
 *
 * Each refusal is paired with the holder succeeding on the same call, because
 * a gate that also stopped HQ would be the worse bug. Stripe is a stub on
 * `globalThis.fetch` that records every call, so "refused" is asserted as
 * "Stripe was never called", not only as a status code.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/billing_refund_governed_d224.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import billing, { REFUND_REASON_MIN, REFUND_WINDOW_DAYS } from '../src/routes/admin_billing.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;
const PLAIN = 2;
const REASON = 'Charged twice for the March cohort seat; customer wrote in on the 4th.';

const ERRORS = {
  Unauthorized: 401,
  'Admin required': 403,
  'Super admin required': 403,
  'HQ only': 403,
  'TOTP required': 403,
  step_up_required: 403,
} as Record<string, 401 | 403>;

const app = new Hono<any>();
app.route('/', billing);
app.onError((err: any, c) => {
  const s = ERRORS[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run().catch(() => ({}))); return out; },
  };
}

/** `stale` gives an admin a TOTP session minted two hours ago and never stepped up. */
function freshDb(opts: { staleFor?: number } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
    CREATE TABLE user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, jti TEXT, factor TEXT,
      assurance_level TEXT, revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT,
      last_step_up_at TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE admin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER NOT NULL, action TEXT NOT NULL,
      report_type TEXT, format TEXT, filters_json TEXT, storage_key TEXT, download_url TEXT,
      exported_at TEXT NOT NULL DEFAULT (datetime('now')), viewed_user_id INTEGER,
      conversation_id INTEGER, viewed_at TEXT
    );
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(SUPER, 'admin', 'Sue', 'sue@axal.example');
  u.run(PLAIN, 'admin', 'Pat', 'pat@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, PLAIN]) {
    const age = opts.staleFor === id ? "datetime('now', '-2 hours')" : "datetime('now')";
    db.prepare(
      `INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at)
       VALUES (?, ?, 'totp', 'totp', ${age})`,
    ).run(id, `totp-${id}`);
  }
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), STRIPE_SECRET_KEY: 'sk_test_stub' });

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', jti: `totp-${userId}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/** Stripe, as far as this route reads it. Every call is recorded. */
function stubStripe() {
  const calls: Array<{ url: string; method: string }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);
    const method = String(init.method || 'GET');
    calls.push({ url, method });
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/v1/refunds')) {
      return json({ id: 're_1', object: 'refund', amount: 4900, currency: 'eur', charge: 'ch_1', payment_intent: 'pi_1', status: 'succeeded', reason: null });
    }
    if (url.includes('/v1/payment_intents/')) {
      return json({ id: 'pi_1', amount: 4900, amount_received: 4900, currency: 'eur', latest_charge: 'ch_1', metadata: {} });
    }
    if (url.includes('/v1/charges/')) {
      return json({ id: 'ch_1', amount: 4900, amount_refunded: 4900, currency: 'eur', paid: true, payment_intent: 'pi_1', metadata: {} });
    }
    return json({});
  }) as any;
  return { calls, restore: () => { globalThis.fetch = real; }, refunds: () => calls.filter((x) => x.url.includes('/v1/refunds')).length };
}

async function refund(e: any, actor: number, body: Record<string, unknown>) {
  const res = await app.request('/refund', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token(actor)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, e);
  let json: any = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}

const auditRows = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare("SELECT * FROM admin_audit_log WHERE action = 'billing_refund'").all() as any[];

test('the holder refunds, with a written reason, and exactly one audit row is written', async () => {
  const db = freshDb();
  const s = stubStripe();
  try {
    const r = await refund(env(db), SUPER, { payment_intent: 'pi_1', reason: REASON, target_user_id: 30 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(s.refunds(), 1);
    const rows = auditRows(db);
    assert.equal(rows.length, 1, 'one refund must write one admin_audit_log row');
    const d = JSON.parse(rows[0].filters_json);
    assert.equal(d.reason, REASON);
    assert.equal(d.amount, 4900);
    assert.equal(rows[0].admin_user_id, SUPER);
    assert.equal(rows[0].viewed_user_id, 30, 'the target account is linked on the row');
    // logAdminAction's other half: the hashed-actor row, also exactly one.
    const acts = db.prepare("SELECT * FROM activity_logs WHERE action = 'billing_refund'").all();
    assert.equal(acts.length, 1);
  } finally { s.restore(); }
});

test('a plain admin with TOTP and a fresh step-up is refused, and Stripe is never called', async () => {
  const db = freshDb();
  const s = stubStripe();
  try {
    const r = await refund(env(db), PLAIN, { payment_intent: 'pi_1', reason: REASON });
    assert.equal(r.status, 403);
    assert.equal(r.body?.detail, 'Super admin required');
    assert.equal(s.calls.length, 0, 'a refused refund reached Stripe');
    assert.equal(auditRows(db).length, 0);
  } finally { s.restore(); }
});

test('the holder with a stale step-up is refused, and Stripe is never called', async () => {
  const db = freshDb({ staleFor: SUPER });
  const s = stubStripe();
  try {
    const r = await refund(env(db), SUPER, { payment_intent: 'pi_1', reason: REASON });
    assert.equal(r.status, 403);
    assert.equal(r.body?.detail, 'step_up_required');
    assert.equal(s.calls.length, 0);
  } finally { s.restore(); }
});

test('on a branch the refund is refused as HQ only', async () => {
  const db = freshDb();
  const s = stubStripe();
  try {
    const r = await refund({ ...env(db), BRANCH_CODE: 'fr' }, SUPER, { payment_intent: 'pi_1', reason: REASON });
    assert.equal(r.status, 403);
    assert.equal(r.body?.detail, 'HQ only');
    assert.equal(s.refunds(), 0);
  } finally { s.restore(); }
});

test('a missing, blank or short reason is refused before Stripe is called', async () => {
  const db = freshDb();
  const s = stubStripe();
  try {
    for (const reason of [undefined, '', '   ', 'duplicate', 'x'.repeat(REFUND_REASON_MIN - 1)]) {
      const r = await refund(env(db), SUPER, { payment_intent: 'pi_1', ...(reason === undefined ? {} : { reason }) });
      assert.equal(r.status, 400, `reason ${JSON.stringify(reason)} was accepted`);
      assert.equal(r.body?.code, 'reason_required');
    }
    assert.equal(s.calls.length, 0, 'a refused reason still reached Stripe');
    assert.equal(auditRows(db).length, 0);
    // The boundary itself is accepted.
    const ok = await refund(env(db), SUPER, { payment_intent: 'pi_1', reason: 'y'.repeat(REFUND_REASON_MIN) });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  } finally { s.restore(); }
});

test('a Stripe category rides in stripe_reason, and the written reason stays in metadata', async () => {
  const db = freshDb();
  const s = stubStripe();
  let form = '';
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    if (String(input).includes('/v1/refunds')) form = String(init.body || '');
    return inner(input, init);
  }) as any;
  try {
    const r = await refund(env(db), SUPER, { payment_intent: 'pi_1', reason: REASON, stripe_reason: 'duplicate' });
    assert.equal(r.status, 200);
    const p = new URLSearchParams(form);
    assert.equal(p.get('reason'), 'duplicate');
    assert.equal(p.get('metadata[admin_reason]'), REASON);
  } finally { globalThis.fetch = inner; s.restore(); }
});

/* ------------------------------------------------------------------ *
 * GET /refunds — what Revenue's Billing exceptions block reads
 * ------------------------------------------------------------------ */

async function list(e: any, actor: number) {
  const res = await app.request('/refunds', { headers: { Authorization: `Bearer ${await token(actor)}` } }, e);
  return { status: res.status, body: await res.json() };
}

test('the refunds read is the holder\'s, per currency in integer cents, inside the window', async () => {
  const db = freshDb();
  const ins = db.prepare(
    `INSERT INTO admin_audit_log (admin_user_id, action, filters_json, exported_at) VALUES (?, 'billing_refund', ?, ?)`,
  );
  const row = (amount: unknown, currency: unknown) => JSON.stringify({ refund_id: 're_x', status: 'succeeded', amount, currency, reason: REASON });
  ins.run(SUPER, row(4900, 'eur'), new Date().toISOString().replace('T', ' ').slice(0, 19));
  ins.run(SUPER, row(100, 'eur'), new Date().toISOString().replace('T', ' ').slice(0, 19));
  ins.run(SUPER, row(2500, 'usd'), new Date().toISOString().replace('T', ' ').slice(0, 19));
  // Outside the window, and a row whose amount cannot be read.
  ins.run(SUPER, row(99900, 'eur'), '2020-01-01 00:00:00');
  ins.run(SUPER, row('lots', 'eur'), new Date().toISOString().replace('T', ' ').slice(0, 19));

  const plain = await list(env(db), PLAIN);
  assert.equal(plain.status, 403);

  const r = await list(env(db), SUPER);
  assert.equal(r.status, 200);
  assert.equal(r.body.available, true);
  assert.equal(r.body.window_days, REFUND_WINDOW_DAYS);
  assert.equal(r.body.count, 3);
  assert.equal(r.body.unreadable_rows, 1, 'an unreadable row was folded into a total');
  const eur = r.body.by_currency.find((b: any) => b.currency === 'EUR');
  const usd = r.body.by_currency.find((b: any) => b.currency === 'USD');
  assert.deepEqual(eur, { currency: 'EUR', count: 2, amount_cents: 5000 });
  assert.deepEqual(usd, { currency: 'USD', count: 1, amount_cents: 2500 });
  assert.ok(r.body.items.every((i: any) => Number.isInteger(i.amount_cents)));
  assert.equal(r.body.items[0].reason, REASON);
});

test('an empty ledger is an empty list, and a failed read says unavailable rather than zero', async () => {
  const db = freshDb();
  const empty = await list(env(db), SUPER);
  assert.equal(empty.body.available, true);
  assert.equal(empty.body.count, 0);
  assert.deepEqual(empty.body.by_currency, []);

  const broken = {
    ...env(db),
    DB: {
      ...makeD1(db),
      prepare(sql: string) {
        if (sql.includes('FROM admin_audit_log')) throw new Error('D1 down');
        return makeD1(db).prepare(sql);
      },
    },
  };
  const r = await list(broken, SUPER);
  assert.equal(r.body.available, false);
  assert.equal(r.body.count, undefined, 'a failed read carried a count');
  assert.match(r.body.reason, /could not be read/);
});
