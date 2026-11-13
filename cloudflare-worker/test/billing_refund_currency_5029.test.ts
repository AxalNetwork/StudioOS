/**
 * D5029 — a refund typed in major units is converted in the CHARGE's currency, exactly, or refused.
 *
 * The Revenue refund form is given a Stripe id, so it cannot know the currency; it sends `amount_major` and this route
 * reads the currency from Stripe. 25.50 EUR is 2550; 2500 JPY is 2500 (never 250000); 1.230 KWD is 1230; 1.235 KWD is
 * refused because Stripe refunds a three-decimal currency in steps of ten; ISK and UGX are sent as Stripe's two-decimal
 * amounts. A currency Stripe did not name, or one StudioOS cannot price in, is refused with nothing refunded.
 *
 * Mutations checked: the old `Math.round(x * 100)` in the route (JPY 2500 sent as 250000); the currency guessed as EUR
 * when unreadable; the KWD multiple-of-ten rule removed; the ISK/UGX scaling removed.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/billing_refund_currency_5029.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import billing, { REFUND_REASON_MIN } from '../src/routes/admin_billing.ts';

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

/** Stripe, as far as this route reads it: the charge is in `currency`, and every refund request body is recorded. */
function stubStripe(currency: string | null) {
  const refunds: Array<Record<string, string>> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/v1/refunds')) {
      const form = Object.fromEntries(new URLSearchParams(String(init.body || '')));
      refunds.push(form);
      return json({ id: 're_1', object: 'refund', amount: Number(form.amount || 0), currency, status: 'succeeded' });
    }
    const cur = currency === null ? undefined : currency;
    if (url.includes('/v1/payment_intents/')) return json({ id: 'pi_1', amount: 999999, currency: cur, latest_charge: 'ch_1', metadata: {} });
    if (url.includes('/v1/charges/')) return json({ id: 'ch_1', amount: 999999, amount_refunded: 0, currency: cur, paid: true, payment_intent: 'pi_1', metadata: {} });
    return json({});
  }) as any;
  return { refunds, restore: () => { globalThis.fetch = real; } };
}

/**
 * D5037: a refund is a review, then a confirmation. The target and the amount go to `/refund/review`; the reason and
 * the review's token go to `/refund`. A review that refuses is the answer, and nothing is confirmed.
 */
async function refund(e: any, body: Record<string, unknown>) {
  const auth = { Authorization: `Bearer ${await token(SUPER)}`, 'Content-Type': 'application/json' };
  const read = async (res: Response) => { let json: any = null; try { json = await res.json(); } catch { /* empty */ } return { status: res.status, body: json }; };
  const reviewBody: Record<string, unknown> = { payment_intent: 'pi_1' };
  for (const k of ['amount', 'amount_major']) if (k in body) reviewBody[k] = body[k];
  const review = await read(await app.request('/refund/review', { method: 'POST', headers: auth, body: JSON.stringify(reviewBody) }, e));
  if (review.status !== 200) return review;
  return read(await app.request('/refund', {
    method: 'POST', headers: auth, body: JSON.stringify({ reason: REASON, review_token: review.body.review_token }),
  }, e));
}

/** One refund of `amount_major` against a charge in `currency`: the status, the body and what Stripe was sent. */
async function attempt(currency: string | null, body: Record<string, unknown>) {
  const db = freshDb();
  const s = stubStripe(currency);
  try {
    const r = await refund(env(db), body);
    return { ...r, sent: s.refunds };
  } finally { s.restore(); }
}

test('major units are converted in the charge\'s own currency: EUR hundredths, JPY whole, KWD thousandths', async () => {
  const eur = await attempt('eur', { amount_major: '25.50' });
  assert.equal(eur.status, 200, JSON.stringify(eur.body));
  assert.equal(eur.sent[0].amount, '2550');
  const eurAgain = await attempt('eur', { amount_major: '1,234.56' });
  assert.equal(eurAgain.sent[0].amount, '123456');
  const jpy = await attempt('jpy', { amount_major: '2500' });
  assert.equal(jpy.status, 200, JSON.stringify(jpy.body));
  assert.equal(jpy.sent[0].amount, '2500', 'JPY is not multiplied by 100');
  const kwd = await attempt('kwd', { amount_major: '1.230' });
  assert.equal(kwd.status, 200, JSON.stringify(kwd.body));
  assert.equal(kwd.sent[0].amount, '1230', 'three decimals are kept');
  const whole = await attempt('kwd', { amount_major: '5' });
  assert.equal(whole.sent[0].amount, '5000');
});

test('an amount the currency cannot hold is refused and Stripe is never asked to refund', async () => {
  for (const [currency, amount_major] of [['jpy', '10.5'], ['eur', '10.005'], ['eur', '0'], ['eur', '-5'], ['eur', 'abc'], ['kwd', '1.2345'], ['eur', '9007199254740991']] as const) {
    const r = await attempt(currency, { amount_major });
    assert.equal(r.status, 400, `${currency} ${amount_major}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, 'invalid_amount');
    assert.equal(r.sent.length, 0, `${currency} ${amount_major} reached Stripe`);
  }
  const jpy = await attempt('jpy', { amount_major: '10.5' });
  assert.match(jpy.body.error, /no minor unit/);
  assert.equal(jpy.body.currency, 'JPY');
  assert.equal(jpy.body.decimals, 0);
});

test('Stripe\'s own rules at the boundary: a three-decimal currency in steps of ten, ISK and UGX as two-decimal amounts', async () => {
  const odd = await attempt('kwd', { amount_major: '1.235' });
  assert.equal(odd.status, 400);
  assert.match(odd.body.error, /steps of 0\.010/);
  assert.equal(odd.sent.length, 0);
  const isk = await attempt('isk', { amount_major: '1000' });
  assert.equal(isk.status, 200, JSON.stringify(isk.body));
  assert.equal(isk.sent[0].amount, '100000', 'ISK is whole krónur in our records and two-decimal in Stripe');
  const ugx = await attempt('ugx', { amount_major: '5000' });
  assert.equal(ugx.sent[0].amount, '500000');
});

test('a charge whose currency Stripe did not name, or that is not a listed currency, is never guessed', async () => {
  for (const currency of [null, 'xyz']) {
    const r = await attempt(currency, { amount_major: '25.50' });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.code, 'currency_unknown');
    assert.equal(r.sent.length, 0, 'nothing is refunded in a guessed currency');
  }
});

test('amount (Stripe minor units, as before) still passes through; both forms at once is refused; a full refund sends what is left', async () => {
  const legacy = await attempt('eur', { amount: 4900 });
  assert.equal(legacy.status, 200, JSON.stringify(legacy.body));
  assert.equal(legacy.sent[0].amount, '4900');
  const both = await attempt('eur', { amount: 4900, amount_major: '49' });
  assert.equal(both.status, 400);
  assert.equal(both.sent.length, 0);
  const full = await attempt('eur', {});
  assert.equal(full.status, 200, JSON.stringify(full.body));
  // D5037: the reviewed remaining is sent, never "whatever is left when Stripe gets to it".
  assert.equal(full.sent[0].amount, '999999');
  const unsafe = await attempt('eur', { amount: 9007199254740993 });
  assert.equal(unsafe.status, 400);
  assert.ok(REFUND_REASON_MIN > 0);
});
