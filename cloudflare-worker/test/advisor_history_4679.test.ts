/**
 * #4679 — client and financial history stays what happened.
 *
 * Every case runs through the MOUNTED advisors router against real SQLite with
 * the money migrations read from their files. The rule under test: a status
 * update, a rate change or a slow response must not rewrite a line's price,
 * its rate, its cut, or the period a note belongs to.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import advisors from '../src/routes/advisors.ts';
import { cutCents } from '../src/services/advisorMoney.ts';
import { chargeSession, FeeSnapshotMissing } from '../src/services/advisorConnect.ts';

const SQL = resolve(dirname(fileURLToPath(import.meta.url)), '../sql');
const JWT_SECRET = 'test-secret-for-advisor-money-model';

const ADVISOR_USER = 90;
const OTHER_ADVISOR_USER = 91;
const CLIENT_A = 92;
const CLIENT_B = 93;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
let afterFirst: ((sql: string) => void) | null = null;
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() {
          const row = db.prepare(sql).get(...b) ?? null;
          if (afterFirst && /SELECT \* FROM advisor_bookings WHERE id = \?/.test(sql)) {
            const f = afterFirst; afterFirst = null; f(sql);
          }
          return row;
        },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) {
      const out = [];
      for (const st of x || []) out.push(await st.run().catch(() => ({})));
      return out;
    },
  };
}

const migration = (name: string) => readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, advisor_id INTEGER, stripe_customer_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE advisors (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, user_id INTEGER UNIQUE,
      display_name TEXT NOT NULL, email TEXT, bio TEXT,
      expertise_json TEXT NOT NULL DEFAULT '[]', sectors_json TEXT NOT NULL DEFAULT '[]',
      linkedin_url TEXT, hourly_rate_usd INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    -- advisor_bookings as it really exists (sql/historical/t13_t14_t15.sql),
    -- plus 205's two columns, which is the shape 241 ALTERs.
    CREATE TABLE advisor_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      advisor_id INTEGER NOT NULL, slot_id INTEGER, founder_user_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending', topic TEXT, notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE advisor_office_hour_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      advisor_id INTEGER NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 1, meeting_url TEXT, notes TEXT,
      is_cancelled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(`ALTER TABLE advisor_bookings ADD COLUMN amount_cents INTEGER;`);
  db.exec(`ALTER TABLE advisor_bookings ADD COLUMN billing_state TEXT NOT NULL DEFAULT 'unpriced';`);
  db.exec(migration('241_advisor_money_model'));
  // 242 — the period note D4's AI band files on Accept. Same fixture,
  // because the note is keyed to the same windows the ledger answers for
  // and a test that could not read one could not check the other.
  db.exec(migration('242_advisor_quarter_notes'));
  db.exec(migration('202611070915_advisory_refunds_due'));
  db.exec(`CREATE TABLE IF NOT EXISTS advisor_engagements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
    advisor_id INTEGER NOT NULL, founder_user_id INTEGER, client_name TEXT NOT NULL,
    lane TEXT NOT NULL DEFAULT 'signed', shape TEXT NOT NULL DEFAULT 'retainer',
    amount_cents INTEGER);`);

  const u = db.prepare('INSERT INTO users (id, role, advisor_id, name, email) VALUES (?,?,?,?,?)');
  u.run(ADVISOR_USER, 'advisor', 1, 'Ada', 'ada@example.com');
  u.run(OTHER_ADVISOR_USER, 'advisor', 2, 'Grace', 'grace@example.com');
  u.run(CLIENT_A, 'founder', null, 'Meridian Labs', 'm@example.com');
  u.run(CLIENT_B, 'founder', null, 'Halverton', 'h@example.com');

  const a = db.prepare(
    'INSERT INTO advisors (id, uid, user_id, display_name, email) VALUES (?,?,?,?,?)');
  a.run(1, 'adv-1', ADVISOR_USER, 'Ada', 'ada@example.com');
  a.run(2, 'adv-2', OTHER_ADVISOR_USER, 'Grace', 'grace@example.com');
  return db;
}

/** Insert a booking and return its id, so tests can price it through the route. */
function booking(
  db: InstanceType<typeof DatabaseSync>,
  uid: string, advisorId: number, clientId: number | null, createdAt?: string,
): number {
  const r = db.prepare(
    `INSERT INTO advisor_bookings (uid, advisor_id, founder_user_id, status, topic, created_at)
     VALUES (?, ?, ?, 'completed', ?, ?)`,
  ).run(uid, advisorId, clientId, uid, createdAt ?? '2026-08-01T10:00:00.000Z');
  return Number(r.lastInsertRowid);
}

function env(db: InstanceType<typeof DatabaseSync>, extra: Record<string, any> = {}) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), ...extra };
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  e: any, method: string, path: string, who: { user: number; role: string }, body?: any,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    (init as any).body = JSON.stringify(body);
  }
  // Hono's `c.executionCtx` getter THROWS when absent, so the stub is not
  // optional: without it a deferred-hook guard becomes a 500 in tests only.
  const res = await advisors.request(path, init, e, {
    waitUntil() {}, passThroughOnException() {},
  } as any);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const ada = { user: ADVISOR_USER, role: 'advisor' };


const FRAN = 95;

function price(db: any, id: number, over: Record<string, any> = {}) {
  return call(env(db), 'PATCH', `/me/bookings/${id}/billing`, ada, { amount_cents: 30_000, ...over });
}
const row = (db: any, id: number) => db.prepare('SELECT * FROM advisor_bookings WHERE id = ?').get(id) as any;
const setRate = (db: any, bps: string) =>
  db.prepare('UPDATE platform_settings SET value = ? WHERE key = ?').run(bps, 'advisor_take_rate_bps');

// ── Billing-state-only changes keep the snapshot ───────────────────────────

test('a line priced at 15% keeps 15% and its cut after the rate moves and it is marked collected', async () => {
  const db = freshDb(); const id = booking(db, 'b1', 1, CLIENT_A);
  assert.equal((await price(db, id)).status, 200);
  assert.equal(row(db, id).take_rate_bps, 1500);
  assert.equal(row(db, id).platform_cut_cents, 4_500);

  setRate(db, '1200');
  const r = await call(env(db), 'PATCH', `/me/bookings/${id}/billing`, ada, { billing_state: 'collected' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = row(db, id);
  assert.equal(after.billing_state, 'collected');
  assert.equal(after.amount_cents, 30_000);
  assert.equal(after.take_rate_bps, 1500, 'the rate on the line did not move');
  assert.equal(after.platform_cut_cents, 4_500, 'the cut on the line did not move');
});

test('billed -> written_off -> billed also leaves amount, rate and cut alone', async () => {
  const db = freshDb(); const id = booking(db, 'b1', 1, CLIENT_A);
  await price(db, id);
  setRate(db, '900');
  for (const s of ['written_off', 'billed']) {
    const r = await call(env(db), 'PATCH', `/me/bookings/${id}/billing`, ada, { billing_state: s });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const after = row(db, id);
  assert.deepEqual([after.amount_cents, after.take_rate_bps, after.platform_cut_cents], [30_000, 1500, 4_500]);
});

test('sending the SAME amount again with a state is a status update, not a repricing', async () => {
  const db = freshDb(); const id = booking(db, 'b1', 1, CLIENT_A);
  await price(db, id);
  setRate(db, '1200');
  const r = await call(env(db), 'PATCH', `/me/bookings/${id}/billing`, ada,
    { amount_cents: 30_000, billing_state: 'collected' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(row(db, id).take_rate_bps, 1500);
});

// ── Repricing is explicit ──────────────────────────────────────────────────

test('changing a price without reprice:true is refused and changes nothing', async () => {
  const db = freshDb(); const id = booking(db, 'b1', 1, CLIENT_A);
  await price(db, id);
  setRate(db, '1200');
  const r = await price(db, id, { amount_cents: 40_000 });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, 'reprice_required');
  const after = row(db, id);
  assert.deepEqual([after.amount_cents, after.take_rate_bps, after.platform_cut_cents], [30_000, 1500, 4_500]);
});

test('reprice:true restamps amount, rate and cut at today’s rate', async () => {
  const db = freshDb(); const id = booking(db, 'b1', 1, CLIENT_A);
  await price(db, id);
  setRate(db, '1200');
  const r = await price(db, id, { amount_cents: 40_000, reprice: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = row(db, id);
  assert.deepEqual([after.amount_cents, after.take_rate_bps, after.platform_cut_cents], [40_000, 1200, 4_800]);
});

test('reprice needs an amount, and must be a boolean', async () => {
  const db = freshDb(); const id = booking(db, 'b1', 1, CLIENT_A);
  await price(db, id);
  const a = await call(env(db), 'PATCH', `/me/bookings/${id}/billing`, ada, { reprice: true });
  assert.equal(a.status, 400);
  const b = await price(db, id, { reprice: 'yes' });
  assert.equal(b.status, 400);
});

test('a collected or written-off line cannot be repriced, even on purpose', async () => {
  for (const state of ['collected', 'written_off']) {
    const db = freshDb(); const id = booking(db, 'b1', 1, CLIENT_A);
    await price(db, id, { billing_state: state });
    const r = await price(db, id, { amount_cents: 99_000, reprice: true, billing_state: state });
    assert.equal(r.status, 409, `${state}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, 'settled_price');
    assert.equal(row(db, id).amount_cents, 30_000);
  }
});

test('an edit that lands between the read and the write is a 409, not an overwrite', async () => {
  const db = freshDb(); const id = booking(db, 'b1', 1, CLIENT_A);
  await price(db, id);
  afterFirst = (sql) => {
    db.prepare("UPDATE advisor_bookings SET billing_state = 'written_off' WHERE id = ?").run(id);
  };
  const r = await call(env(db), 'PATCH', `/me/bookings/${id}/billing`, ada, { billing_state: 'collected' });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, 'booking_changed');
  assert.equal(row(db, id).billing_state, 'written_off', 'the other edit stands');
});

// ── Payment creation consumes the stored snapshot ──────────────────────────

const verifiedAccount = {
  provider_account_id: 'acct_1', charges_enabled: 1, payouts_enabled: 1,
  details_submitted: 1, blocked_reason: null,
} as any;

test('chargeSession uses the stored fee, and refuses a missing snapshot', async () => {
  const e: any = { ...env(freshDb()), ADVISOR_CHARGING_ENABLED: '1', STRIPE_SECRET_KEY: 'sk_test_x' };
  const base = {
    account: verifiedAccount, bookingUid: 'b_1', bookingId: 1, advisorId: 1,
    amountCents: 30_000, customerId: 'cus_1',
  };
  for (const feeSnapshot of [
    { bps: null, cutCents: null }, { bps: 1500, cutCents: null }, { bps: null, cutCents: 4_500 },
    { bps: 1500, cutCents: 30_001 }, { bps: 1500, cutCents: -1 }, { bps: 1500, cutCents: 4.5 },
  ]) {
    await assert.rejects(() => chargeSession(e, { ...base, feeSnapshot }),
      (err: any) => err instanceof FeeSnapshotMissing, JSON.stringify(feeSnapshot));
  }
});

test('the PaymentIntent carries the line’s 15% cut after the global rate moved to 12%', async () => {
  const db = freshDb(); const id = booking(db, 'b1', 1, FRAN);
  db.prepare('UPDATE advisor_bookings SET founder_user_id = ?, status = ? WHERE id = ?').run(FRAN, 'completed', id);
  db.prepare('INSERT INTO users (id, role, name, email, stripe_customer_id) VALUES (?,?,?,?,?)')
    .run(FRAN, 'founder', 'Fran', 'f@example.com', 'cus_fran');
  await price(db, id, { billing_state: 'billed' });
  setRate(db, '1200');
  db.prepare(`INSERT INTO advisor_payout_accounts (uid, advisor_id, state, provider, provider_account_id, charges_enabled, payouts_enabled)
              VALUES ('pa-1', 1, 'pending', 'stripe', 'acct_1', 1, 1)`).run();
  const calls: any[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: String(init?.body || '') });
    return new Response(JSON.stringify({ id: 'pi_1', client_secret: 'pi_1_secret' }), { status: 200 });
  }) as any;
  try {
    const e = env(db, { ADVISOR_CHARGING_ENABLED: '1', STRIPE_SECRET_KEY: 'sk_test_x' });
    const r = await call(e, 'POST', `/bookings/${id}/pay`, { user: FRAN, role: 'founder' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const sent = new URLSearchParams(calls.at(-1).body);
    assert.equal(sent.get('application_fee_amount'), '4500', 'not 12% of 30000');
    assert.equal(sent.get('metadata[take_rate_bps]'), '1500');
    assert.equal(r.body.take_rate_bps, 1500);
  } finally { globalThis.fetch = realFetch; }
});

test('a billed line with no stored fee is refused before any Stripe call', async () => {
  const db = freshDb(); const id = booking(db, 'b1', 1, FRAN);
  db.prepare('INSERT INTO users (id, role, name, email, stripe_customer_id) VALUES (?,?,?,?,?)')
    .run(FRAN, 'founder', 'Fran', 'f@example.com', null);
  db.prepare(`UPDATE advisor_bookings SET amount_cents = 30000, billing_state = 'billed' WHERE id = ?`).run(id);
  db.prepare(`INSERT INTO advisor_payout_accounts (uid, advisor_id, state, provider, provider_account_id, charges_enabled, payouts_enabled)
              VALUES ('pa-1', 1, 'pending', 'stripe', 'acct_1', 1, 1)`).run();
  let called = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { called++; return new Response('{}'); }) as any;
  try {
    const e = env(db, { ADVISOR_CHARGING_ENABLED: '1', STRIPE_SECRET_KEY: 'sk_test_x' });
    const r = await call(e, 'POST', `/bookings/${id}/pay`, { user: FRAN, role: 'founder' });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.code, 'fee_snapshot_missing');
    // The customer is NOT seeded, so creating one would be a Stripe call:
    // the refusal has to come first.
    assert.equal(called, 0);
  } finally { globalThis.fetch = realFetch; }
});

// ── Earnings states ────────────────────────────────────────────────────────

function seedStates(db: any) {
  const mk = (uid: string, status: string, state: string | null, amount: number | null) => {
    const id = booking(db, uid, 1, CLIENT_A);
    db.prepare(`UPDATE advisor_bookings SET status = ?, amount_cents = ?, billing_state = ?,
                take_rate_bps = ?, platform_cut_cents = ? WHERE id = ?`)
      .run(status, amount, state ?? 'unpriced', amount == null ? null : 1500,
        amount == null ? null : cutCents(amount, 1500), id);
    return id;
  };
  mk('billed', 'completed', 'billed', 10_000);
  mk('collected', 'completed', 'collected', 20_000);
  mk('written', 'completed', 'written_off', 40_000);
  mk('unpriced', 'completed', 'unpriced', null);
  mk('cancelled-billed', 'cancelled', 'billed', 80_000);
  mk('cancelled-written', 'no_show', 'written_off', 160_000);
  const refunded = mk('cancelled-collected', 'cancelled', 'collected', 5_000);
  db.prepare(`INSERT INTO advisory_refunds_due (booking_id, booking_uid, booking_status, amount_cents)
              VALUES (?, 'cancelled-collected', 'cancelled', 5000)`).run(refunded);
}

test('each state contributes only to its own total; cancelled uncollected sessions leave every total', async () => {
  const db = freshDb(); seedStates(db);
  const r = await call(env(db), 'GET', '/me/ledger', ada);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = r.body.states;
  assert.equal(s.billed.gross_cents, 10_000);
  assert.equal(s.collected.gross_cents, 25_000, 'collected includes the refund-owed charge: the money is real');
  assert.equal(s.written_off.gross_cents, 40_000);
  assert.equal(s.unpriced.sessions, 1);
  assert.equal(s.void_sessions, 2);
  assert.equal(s.refunds_owed.amount_cents, 5_000);
  assert.equal(r.body.totals.gross_cents, 10_000 + 25_000 + 40_000, 'priced = billed + collected + written off');
  assert.equal(r.body.totals.received_cents, 25_000 - cutCents(25_000, 1500)!, 'received = collected, net of the cut');
  assert.notEqual(r.body.totals.received_cents, r.body.totals.net_cents,
    'received is not the net of everything priced');
});

test('a resolved refund row is reported as refunded, not owed', async () => {
  const db = freshDb(); seedStates(db);
  db.prepare("UPDATE advisory_refunds_due SET resolved_at = '2026-08-02T00:00:00Z'").run();
  const s = (await call(env(db), 'GET', '/me/ledger', ada)).body.states;
  assert.equal(s.refunds_owed.amount_cents, 0);
  assert.equal(s.refunded.amount_cents, 5_000);
});

test('paid-out money comes from paid payouts only, in the window', async () => {
  const db = freshDb(); seedStates(db);
  const p = db.prepare(`INSERT INTO advisor_payouts (uid, advisor_id, amount_cents, state, paid_at, created_at)
                        VALUES (?, 1, ?, ?, ?, ?)`);
  p.run('p1', 1_000, 'paid', '2026-08-03T00:00:00Z', '2026-08-03T00:00:00Z');
  p.run('p2', 2_000, 'scheduled', null, '2026-08-03T00:00:00Z');
  p.run('p3', 4_000, 'failed', null, '2026-08-03T00:00:00Z');
  p.run('p4', 8_000, 'paid', '2025-01-03T00:00:00Z', '2025-01-03T00:00:00Z');
  const q = await call(env(db), 'GET', '/me/ledger?from=2026-07-01T00:00:00.000Z&until=2026-10-01T00:00:00.000Z', ada);
  assert.equal(q.body.states.paid_out_cents, 1_000);
});

test('/me/earnings does not count a cancelled session as billed or written off', async () => {
  const db = freshDb(); seedStates(db);
  const r = await call(env(db), 'GET', '/me/earnings', ada);
  assert.equal(r.body.billed_cents, 10_000);
  assert.equal(r.body.written_off_cents, 40_000);
  assert.equal(r.body.collected_cents, 25_000);
});

// ── Period-bound notes ─────────────────────────────────────────────────────

test('a note written for another period is refused and nothing is saved', async () => {
  const db = freshDb();
  const r = await call(env(db), 'PUT', '/me/period-notes/2026-Q3', ada,
    { body: 'Q2 narrative', source: 'ai', period_key: '2026-Q2' });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, 'period_mismatch');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM advisor_period_notes').get().n, 0);
});

test('a note for the period in the URL is filed, and one without a period key still is', async () => {
  const db = freshDb();
  const a = await call(env(db), 'PUT', '/me/period-notes/2026-Q3', ada, { body: 'Q3', period_key: '2026-Q3' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const b = await call(env(db), 'PUT', '/me/period-notes/2026-Q4', ada, { body: 'Q4' });
  assert.equal(b.status, 200, JSON.stringify(b.body));
});
