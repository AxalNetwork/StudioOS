/**
 * `POST /bookings/:id/pay` — the caller `chargeSession` did not have.
 *
 * WHAT THIS FILE EXISTS TO STOP. PR5b shipped `chargeSession` as an exported
 * function that **nothing in the worker called** — only its own test file
 * referenced it. Onboarding was wired and so was webhook fulfilment, so the
 * money chain was built from both ends with no middle: `PATCH
 * /me/bookings/:id/billing` writes `billing_state='billed'`, `markSessionCharged`
 * writes `'collected'`, and no code wrote the transition. This route is that
 * transition, and these tests are the only thing exercising it, because
 * `settlementMode()` answers `'none'` in every environment and the route
 * therefore returns 503 to every real caller today. Code nothing exercises is
 * code whose refusals nobody has checked. D81.
 *
 * THE ORDER OF THE GUARDS IS ITSELF A TEST. `chargeSession` throws
 * `SettlementDisabled` on its own, so the route refuses either way — but it
 * throws AFTER `ensurePaymentsCustomer` would have created a Stripe customer and
 * written `users.stripe_customer_id`. So the settlement check has to come first
 * among the non-auth guards, and the assertion that matters is not the status
 * code: it is that a charge which cannot succeed leaves NO row changed and makes
 * NO network call.
 *
 * NO NETWORK, ENFORCED RATHER THAN HOPED FOR. `advisor_connect_leg.test.ts`
 * states the rule — "a suite that could call Stripe is a suite that will, one
 * day, against a live key" — and avoids the call by never reaching it. A ROUTE
 * test has to reach it to check what the route sends, so instead `globalThis.fetch`
 * is replaced for the duration and restored after. Every stub asserts the URL it
 * was handed, and the refusal tests assert the stub was never called at all, so
 * a test cannot pass by quietly skipping the thing it is about.
 *
 * THE CUSTOMER IS SEEDED, NOT CREATED. `users.stripe_customer_id` is set in the
 * fixture, so `ensurePaymentsCustomer` returns it without a Stripe call. That is
 * the real behaviour for any user who has paid before, and it keeps the one
 * network call in this file down to the PaymentIntent.
 *
 * HARNESS. The real router against real in-memory SQLite, with 240 and 241 read
 * from the MIGRATION FILES rather than hand-copied — the rule
 * `advisor_stores.test.ts` states, for the reason `advisor_engagements_scope.test.ts`
 * repeats: a test that copies a schema passes against a database production does
 * not have.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor_charge_route.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import advisors from '../src/routes/advisors.ts';
import { PAYOUT_GATE, cutCents } from '../src/services/advisorMoney.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADVISOR_USER = 80;
const FOUNDER_USER = 81;
/** A second founder, so "not yours" and "does not exist" can be compared. */
const OTHER_FOUNDER = 82;

/**
 * DELIBERATELY NOT A ROUND NUMBER, and mutation testing is why.
 *
 * This was `30_000` until replacing `amountCents: gross` with the literal
 * `30000` in the route passed every test in this file: the fixture's price was
 * the same round figure anyone would hardcode, so "charges the booking's own
 * amount" and "charges thirty thousand" were indistinguishable. An odd price
 * plus reading the stored row back (see `storedAmount`) makes the assertion
 * anchor on the database rather than on a constant in the test.
 */
const PRICE = 41_737;
const SLOT_ID = 1;

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
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, advisor_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
      name TEXT, email TEXT, uid TEXT, stripe_customer_id TEXT
    );
    CREATE TABLE advisors (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, user_id INTEGER UNIQUE,
      display_name TEXT NOT NULL, email TEXT, bio TEXT,
      expertise_json TEXT NOT NULL DEFAULT '[]', sectors_json TEXT NOT NULL DEFAULT '[]',
      linkedin_url TEXT, hourly_rate_usd INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
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
    CREATE TABLE advisor_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      slot_id INTEGER NOT NULL, advisor_id INTEGER NOT NULL,
      founder_user_id INTEGER NOT NULL, topic TEXT, notes TEXT,
      status TEXT NOT NULL DEFAULT 'pending', cancel_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // 205's two columns, which 240/241 assume are already there.
  db.exec(`ALTER TABLE advisor_bookings ADD COLUMN amount_cents INTEGER;`);
  db.exec(`ALTER TABLE advisor_bookings ADD COLUMN billing_state TEXT NOT NULL DEFAULT 'unpriced';`);
  // Verbatim from the migrations: 240 brings `payment_state` on the slot, 241
  // brings `advisor_payout_accounts` and the take-rate setting.
  db.exec(migration('240_advisor_sessions_config'));
  db.exec(migration('241_advisor_money_model'));

  const u = db.prepare(
    'INSERT INTO users (id, role, advisor_id, name, email, uid, stripe_customer_id) VALUES (?,?,?,?,?,?,?)');
  u.run(ADVISOR_USER, 'advisor', 1, 'Ada', 'ada@example.com', 'u-ada', null);
  u.run(FOUNDER_USER, 'founder', null, 'Fran', 'fran@example.com', 'u-fran', 'cus_fran');
  u.run(OTHER_FOUNDER, 'founder', null, 'Otto', 'otto@example.com', 'u-otto', 'cus_otto');

  db.prepare('INSERT INTO advisors (id, uid, user_id, display_name, email) VALUES (?,?,?,?,?)')
    .run(1, 'adv-1', ADVISOR_USER, 'Ada', 'ada@example.com');
  db.prepare(
    `INSERT INTO advisor_office_hour_slots (id, uid, advisor_id, starts_at, ends_at)
     VALUES (?, 'slot-1', 1, '2026-12-01T10:00:00Z', '2026-12-01T11:00:00Z')`,
  ).run(SLOT_ID);
  return db;
}

/** A booking owned by Fran, priced and `billed` unless overridden. */
function seedBooking(
  db: InstanceType<typeof DatabaseSync>,
  over: { amount?: number | null; state?: string; owner?: number; uid?: string } = {},
) {
  const uid = over.uid ?? 'bk-pay-1';
  db.prepare(
    `INSERT INTO advisor_bookings
       (uid, slot_id, advisor_id, founder_user_id, topic, status, amount_cents, billing_state)
     VALUES (?, ?, 1, ?, 'Pricing strategy', 'completed', ?, ?)`,
  ).run(
    uid, SLOT_ID, over.owner ?? FOUNDER_USER,
    over.amount === undefined ? PRICE : over.amount,
    over.state ?? 'billed',
  );
  return db.prepare('SELECT * FROM advisor_bookings WHERE uid = ?').get(uid) as any;
}

/** A payout account for advisor 1 in the given state. */
function seedPayout(
  db: InstanceType<typeof DatabaseSync>,
  over: { charges?: number; payouts?: number; blocked?: string | null; acct?: string | null } = {},
) {
  db.prepare(
    `INSERT INTO advisor_payout_accounts
       (uid, advisor_id, state, provider, provider_account_id,
        charges_enabled, payouts_enabled, blocked_reason)
     VALUES ('pa-1', 1, 'pending', 'stripe', ?, ?, ?, ?)`,
  ).run(
    over.acct === undefined ? 'acct_test_1' : over.acct,
    over.charges ?? 1, over.payouts ?? 1, over.blocked ?? null,
  );
}

/** Settlement ON (test mode): the flag, a key, and a non-production env. */
const envOn = (db: InstanceType<typeof DatabaseSync>) => ({
  JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db),
  ADVISOR_CHARGING_ENABLED: '1', STRIPE_SECRET_KEY: 'sk_test_x',
});
/** Settlement OFF — the shipped state, and therefore every real call today. */
const envOff = (db: InstanceType<typeof DatabaseSync>) => ({
  JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db),
  STRIPE_SECRET_KEY: 'sk_test_x',
});

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function pay(
  e: any, id: number | string, who: { user: number; role: string },
): Promise<{ status: number; body: any }> {
  const res = await advisors.request(
    `/bookings/${id}/pay`,
    { method: 'POST', headers: { Authorization: `Bearer ${await token(who.user, who.role)}` } },
    e,
    // Not optional: Hono's `c.executionCtx` getter THROWS when absent, so a
    // deferred-hook guard becomes a 500 in tests and only in tests.
    { waitUntil() {}, passThroughOnException() {} } as any,
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

const fran = { user: FOUNDER_USER, role: 'founder' };
const otto = { user: OTHER_FOUNDER, role: 'founder' };
const ada = { user: ADVISOR_USER, role: 'advisor' };

/**
 * Replace `globalThis.fetch` for one test and record what it was handed.
 *
 * Returns the call log; the caller restores via the returned function. Nothing
 * here can reach the network, which is stronger than a suite that merely does
 * not happen to.
 */
function stubFetch(reply: any = { id: 'pi_test_1', client_secret: 'pi_test_1_secret' }) {
  const calls: Array<{ url: string; init: any }> = [];
  const real = globalThis.fetch;
  (globalThis as any).fetch = async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(reply), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  return { calls, restore: () => { (globalThis as any).fetch = real; } };
}

const slotState = (db: InstanceType<typeof DatabaseSync>) =>
  (db.prepare('SELECT payment_state FROM advisor_office_hour_slots WHERE id = ?')
    .get(SLOT_ID) as any)?.payment_state;

/** What the row actually holds, so no assertion restates a constant. */
const storedAmount = (db: InstanceType<typeof DatabaseSync>, id = 1) =>
  Number((db.prepare('SELECT amount_cents FROM advisor_bookings WHERE id = ?').get(id) as any).amount_cents);

// ── Ownership: not yours and not there are the same answer ──────────────────

test('another founder booking is 404, and specifically NOT 403', async () => {
  const db = freshDb();
  seedBooking(db);
  seedPayout(db);
  const s = stubFetch();
  try {
    const r = await pay(envOn(db), 1, otto);
    // A 403 would distinguish "exists but is not yours" from "does not exist",
    // which is an enumeration oracle over other people's sessions.
    assert.equal(r.status, 404);
    assert.notEqual(r.status, 403);
    assert.equal(s.calls.length, 0, 'someone else booking reached Stripe');
  } finally { s.restore(); }
});

test('a booking that does not exist answers identically', async () => {
  const db = freshDb();
  seedBooking(db);
  seedPayout(db);
  const mine = await pay(envOn(db), 1, otto);
  const absent = await pay(envOn(db), 9999, otto);
  assert.equal(absent.status, mine.status);
  assert.deepEqual(absent.body, mine.body,
    'the two answers differ, so one of them tells you the row exists');
});

test('the advisor cannot pay on their client behalf', async () => {
  // Ownership is `founder_user_id`, not a role. The advisor is not the payer,
  // and neither is an admin: the only caller who passes is whose money it is.
  const db = freshDb();
  seedBooking(db);
  seedPayout(db);
  const r = await pay(envOn(db), 1, ada);
  assert.equal(r.status, 404);
});

// ── The flag, and the side effects it must prevent ──────────────────────────

test('settlement off is 503, and leaves NOTHING behind', async () => {
  // THE SHIPPED STATE, so this is every real call today. The status code is the
  // least of it: the point is that no Stripe customer is created, no slot is
  // marked, and no request leaves the process.
  const db = freshDb();
  seedBooking(db);
  const s = stubFetch();
  try {
    const r = await pay(envOff(db), 1, fran);
    assert.equal(r.status, 503);
    assert.equal(r.body.settlement, 'none');
    assert.match(r.body.detail, /not switched on/i);
    assert.equal(s.calls.length, 0, 'a charge that cannot succeed called Stripe');
    assert.equal(slotState(db), 'not_applicable', 'settlement off wrote held_unpaid');
  } finally { s.restore(); }
});

test('settlement off refuses before it can matter that the advisor is unverified', async () => {
  // No payout account at all AND settlement off. The answer must be the flag,
  // not the account: reporting the account would send someone to fix the wrong
  // thing, and would also mean the slot got written.
  const db = freshDb();
  seedBooking(db);
  const s = stubFetch();
  try {
    const r = await pay(envOff(db), 1, fran);
    assert.equal(r.status, 503);
    assert.equal(slotState(db), 'not_applicable');
  } finally { s.restore(); }
});

// ── The billing state decides, and each refusal names whose move it is ──────

test('an unpriced session says the advisor has not priced it', async () => {
  const db = freshDb();
  seedBooking(db, { amount: null, state: 'unpriced' });
  seedPayout(db);
  const s = stubFetch();
  try {
    const r = await pay(envOn(db), 1, fran);
    assert.equal(r.status, 409);
    assert.match(r.body.detail, /not priced/i);
    assert.equal(s.calls.length, 0);
  } finally { s.restore(); }
});

test('an already-collected session is not charged twice', async () => {
  const db = freshDb();
  seedBooking(db, { state: 'collected' });
  seedPayout(db);
  const s = stubFetch();
  try {
    const r = await pay(envOn(db), 1, fran);
    assert.equal(r.status, 409);
    assert.match(r.body.detail, /already paid/i);
    assert.equal(r.body.billing_state, 'collected');
    assert.equal(s.calls.length, 0, 'a paid session was charged again');
  } finally { s.restore(); }
});

test('a written-off session has nothing to pay', async () => {
  const db = freshDb();
  seedBooking(db, { state: 'written_off' });
  seedPayout(db);
  const s = stubFetch();
  try {
    const r = await pay(envOn(db), 1, fran);
    assert.equal(r.status, 409);
    assert.match(r.body.detail, /written off/i);
    assert.equal(s.calls.length, 0);
  } finally { s.restore(); }
});

test('the four refusals are worded differently from each other', async () => {
  // One "cannot pay" for all of them would leave a founder unable to tell
  // "your advisor has not priced it" from "you already paid".
  const said: string[] = [];
  for (const state of ['unpriced', 'collected', 'written_off']) {
    const db = freshDb();
    seedBooking(db, { state, amount: state === 'unpriced' ? null : PRICE });
    seedPayout(db);
    const s = stubFetch();
    try {
      said.push((await pay(envOn(db), 1, fran)).body.detail);
    } finally { s.restore(); }
  }
  assert.equal(new Set(said).size, said.length, `two states share wording: ${said.join(' | ')}`);
});

test('an unrecognised billing state is not a licence to charge', async () => {
  // A later migration adding a state must not make it payable by default.
  const db = freshDb();
  seedBooking(db, { state: 'awaiting_something_new' });
  seedPayout(db);
  const s = stubFetch();
  try {
    const r = await pay(envOn(db), 1, fran);
    assert.equal(r.status, 409);
    assert.equal(s.calls.length, 0);
  } finally { s.restore(); }
});

// ── A price of nothing is not a free session ────────────────────────────────

test('a null, zero or negative amount is refused, never charged', async () => {
  for (const amount of [null, 0, -1]) {
    const db = freshDb();
    // `billed` with no figure is a state the PATCH refuses to create, but the
    // route must not assume its sibling was the only writer.
    seedBooking(db, { amount, state: 'billed' });
    seedPayout(db);
    const s = stubFetch();
    try {
      const r = await pay(envOn(db), 1, fran);
      assert.equal(r.status, 409, `amount=${String(amount)} was accepted`);
      assert.equal(s.calls.length, 0, `amount=${String(amount)} reached Stripe`);
    } finally { s.restore(); }
  }
});

// ── The payout gate, and 240's held_unpaid finally having a writer ──────────

test('no payout account at all is refused, and the slot is marked held_unpaid', async () => {
  const db = freshDb();
  seedBooking(db);
  const s = stubFetch();
  try {
    const r = await pay(envOn(db), 1, fran);
    assert.equal(r.status, 409);
    assert.equal(r.body.payout_state, 'pending', 'an account nobody started is pending, not blocked');
    assert.equal(r.body.gate, PAYOUT_GATE.pending);
    assert.equal(s.calls.length, 0);
    // Migration 240 created this column to record "a slot taken by a booking
    // that could not be charged", and until this route nothing ever set it.
    assert.equal(slotState(db), 'held_unpaid');
  } finally { s.restore(); }
});

test('a pending and a blocked account each report their own gate sentence', async () => {
  for (const [over, expected] of [
    [{ charges: 0, payouts: 0 }, 'pending'],
    [{ blocked: 'requirements.past_due' }, 'blocked'],
  ] as Array<[any, string]>) {
    const db = freshDb();
    seedBooking(db);
    seedPayout(db, over);
    const s = stubFetch();
    try {
      const r = await pay(envOn(db), 1, fran);
      assert.equal(r.status, 409);
      assert.equal(r.body.payout_state, expected);
      // Straight from PAYOUT_GATE, which exists so the worker and the page
      // cannot word the same state differently.
      assert.equal(r.body.gate, PAYOUT_GATE[expected]);
      assert.equal(slotState(db), 'held_unpaid');
      assert.equal(s.calls.length, 0);
    } finally { s.restore(); }
  }
});

test('a verified account with no provider id is still refused', async () => {
  // `derivePayoutState` reads the two booleans and says `verified`; the id is a
  // separate fact, and a destination charge cannot name a missing account.
  const db = freshDb();
  seedBooking(db);
  seedPayout(db, { acct: null });
  const s = stubFetch();
  try {
    const r = await pay(envOn(db), 1, fran);
    assert.equal(r.status, 409);
    assert.equal(s.calls.length, 0, 'a charge was attempted with no destination');
  } finally { s.restore(); }
});

test('held_unpaid never walks a slot backwards', async () => {
  // Capacity can exceed one, so another booking on the same slot may already
  // have been charged. Downgrading that to held_unpaid would unmake a fact.
  const db = freshDb();
  seedBooking(db);
  db.prepare(`UPDATE advisor_office_hour_slots SET payment_state = 'charged' WHERE id = ?`).run(SLOT_ID);
  const s = stubFetch();
  try {
    const r = await pay(envOn(db), 1, fran);
    assert.equal(r.status, 409);
    assert.equal(slotState(db), 'charged', 'a charged slot was reset to held_unpaid');
  } finally { s.restore(); }
});

// ── The charge itself ──────────────────────────────────────────────────────

test('a verified account charges the booking OWN stored amount', async () => {
  const db = freshDb();
  seedBooking(db);
  seedPayout(db);
  const s = stubFetch();
  try {
    const r = await pay(envOn(db), 1, fran);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.client_secret, 'pi_test_1_secret');
    assert.equal(r.body.payment_intent_id, 'pi_test_1');
    assert.equal(r.body.amount_cents, storedAmount(db));
    assert.equal(r.body.booking_uid, 'bk-pay-1');
    assert.equal(r.body.settlement, 'test', 'a non-production env must not report live');

    assert.equal(s.calls.length, 1, 'expected exactly one Stripe call');
    const [call] = s.calls;
    assert.match(call.url, /\/payment_intents$/);
    const sent = new URLSearchParams(String(call.init.body));
    // THE BOOKING'S OWN PRICE, read back OUT OF THE ROW rather than compared to
    // a constant this file holds. The advisor may have discounted this session,
    // and 241 stamped the cut against this figure. Asserting against `PRICE`
    // instead let a hardcoded `amountCents: 30000` in the route pass, which is
    // what moved the fixture off a round number.
    assert.equal(sent.get('amount'), String(storedAmount(db)));
    assert.equal(sent.get('transfer_data[destination]'), 'acct_test_1');
    assert.equal(sent.get('customer'), 'cus_fran');
    assert.equal(sent.get('metadata[kind]'), 'advisor_session');
    assert.equal(sent.get('metadata[booking_uid]'), 'bk-pay-1');
  } finally { s.restore(); }
});

test('the fee is the same function the ledger totals with', async () => {
  const db = freshDb();
  seedBooking(db);
  seedPayout(db);
  const s = stubFetch();
  try {
    const r = await pay(envOn(db), 1, fran);
    const sent = new URLSearchParams(String(s.calls[0].init.body));
    const bps = Number(r.body.take_rate_bps);
    const gross = storedAmount(db);
    // Two computations of a platform fee is how a client is charged one number
    // and an advisor is shown another, so this is `cutCents` or it is wrong.
    assert.equal(Number(sent.get('application_fee_amount')), cutCents(gross, bps));
    assert.equal(r.body.application_fee_cents, cutCents(gross, bps));
    // And the fee must actually be a fraction of the gross, not the gross: a
    // `cutCents` that returned its input would satisfy both lines above.
    assert.ok(cutCents(gross, bps)! > 0 && cutCents(gross, bps)! < gross,
      'the platform fee is not strictly between nothing and the whole session');
    assert.equal(sent.get('metadata[take_rate_bps]'), String(bps));
  } finally { s.restore(); }
});

test('the idempotency key is derived from the booking uid', async () => {
  // One intent per booking, replayed rather than duplicated. A double-submit on
  // a money call is the failure the key exists for, so it must not carry
  // anything that varies between attempts.
  const db = freshDb();
  seedBooking(db, { uid: 'bk-unique-9' });
  seedPayout(db);
  const s = stubFetch();
  try {
    await pay(envOn(db), 1, fran);
    await pay(envOn(db), 1, fran);
    assert.equal(s.calls.length, 2);
    const keys = s.calls.map((c) => (c.init.headers || {})['Idempotency-Key']);
    assert.equal(keys[0], 'pi:advisory:bk-unique-9');
    assert.equal(keys[0], keys[1], 'two attempts sent different keys, so Stripe would make two intents');
  } finally { s.restore(); }
});

test('both service refusals are still mapped, including the unreachable one', () => {
  // A SOURCE ASSERTION, AND THE REASON IS WORTH STATING RATHER THAN HIDING.
  // The early settlement guard means `chargeSession` can never throw
  // `SettlementDisabled` from this route as written, so no runtime test in this
  // file can reach that catch branch — mutation-checking confirmed it: deleting
  // the branch passed every other test here. It still has to exist, because the
  // service is the authority and a guard that depends on a caller checking first
  // is not a guard. So its presence is asserted directly, which is honest about
  // being weaker than exercising it.
  //
  // HOW MUCH WEAKER, MEASURED. Mutation-checking established the boundary: this
  // catches the branch being deleted and catches its class being swapped for one
  // that never throws here, but it CANNOT catch the branch being left in place
  // and dead — `if (false && e instanceof SettlementDisabled)` still contains
  // the text this reads, and it escaped on the first attempt. Nobody writes that
  // on purpose, so the residual risk is accepted rather than papered over with a
  // `false &&` ban that would only fit the one mutation that found it.
  const src = readFileSync(resolve(HERE, '../src/routes/advisors.ts'), 'utf8');
  const handler = src.slice(src.indexOf("advisors.post('/bookings/:id/pay'"));
  const body = handler.slice(0, handler.indexOf('\nadvisors.'));
  assert.match(body, /e instanceof SettlementDisabled/,
    'the SettlementDisabled mapping is gone, so a service-level refusal would surface as a 500');
  assert.match(body, /e instanceof PayoutAccountNotReady/,
    'the PayoutAccountNotReady mapping is gone');
  // BOTH MAPPINGS REPORT WHAT THE THROWER DECIDED. `advisor_connect_leg.test.ts`
  // already forbids hard-coding the settlement mode anywhere in the route file,
  // and it caught the first draft of the catch below — twice, because it scans
  // the file as text and the second draft quoted the forbidden pair in a comment
  // explaining the first. It cannot catch the other wrong fix: re-reading
  // `settlementMode(c.env)` there would satisfy it while answering about the env
  // as it is NOW rather than about the refusal that actually happened. So the
  // shape is pinned here, next to the reason.
  assert.match(body, /settlement: e\.mode/,
    'the 503 no longer reports the mode the service refused on');
  assert.match(body, /payout_state: e\.state/,
    'the 409 no longer reports the state the service refused on');
  // And the ordering the side-effect tests depend on, stated where a reader of
  // this file will look for it: settlement is decided before a customer exists.
  //
  // BOTH ANCHORS ARE REQUIRED TO EXIST BEFORE THEY ARE COMPARED. `indexOf`
  // answers -1 for absent, and -1 is less than every real index, so a bare
  // `a < b` would report the ordering as correct precisely when one half of it
  // had been deleted. That is the self-satisfying assertion this session has
  // now written four times; it is checked here rather than caught later.
  const gate = body.indexOf('settlementMode(c.env)');
  const customer = body.indexOf('ensurePaymentsCustomer');
  assert.ok(gate >= 0, 'the route no longer consults settlementMode at all');
  assert.ok(customer >= 0, 'the route no longer creates a payments customer, so nothing charges');
  assert.ok(
    gate < customer,
    'the settlement check moved after the customer is created, so a refused charge leaves one behind',
  );
});

test('a paid slot is not marked held_unpaid on the way through', async () => {
  // The happy path must not touch `payment_state` at all: the webhook moves it
  // to `charged`, and a route that pre-empted that would assert a settlement
  // that has not happened.
  const db = freshDb();
  seedBooking(db);
  seedPayout(db);
  const s = stubFetch();
  try {
    assert.equal((await pay(envOn(db), 1, fran)).status, 200);
    assert.equal(slotState(db), 'not_applicable');
  } finally { s.restore(); }
});
