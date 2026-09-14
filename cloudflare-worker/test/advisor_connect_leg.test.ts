/**
 * PR5b — the advisory Stripe Connect leg, and the flag that keeps it off.
 *
 * WHAT THIS FILE EXISTS TO STOP. The leg is written, wired and unreachable:
 * `ADVISOR_CHARGING_ENABLED` is set in no environment, so `settlementMode()`
 * answers `'none'` and nothing creates an intent. That is a deliberate state
 * and it is also a fragile one — code nothing exercises is code whose
 * refusals nobody has checked. So the refusals are checked here, directly,
 * with the flag forced on and off:
 *
 *   * A CHARGE WITH SETTLEMENT OFF THROWS. It does not return a falsy result
 *     a caller could read as "free", and it does not simulate. That is
 *     `util/paymentMode.ts`'s own rule — "a missing or misconfigured Stripe
 *     setup has to fail loudly, never silently grant a paid entitlement" —
 *     and the simulated-payment fallback it was written to delete is exactly
 *     what a helpful `return null` here would recreate.
 *   * A CHARGE AGAINST AN UNVERIFIED ACCOUNT THROWS WITH THE STATE, because
 *     which of D4's three gates applied is what the slot's `payment_state`
 *     records and what the page tells the advisor.
 *   * THE FEE COMES FROM THE SAME FUNCTION THE LEDGER TOTALS WITH. Two
 *     computations of a platform fee is how a client is charged one number
 *     and an advisor is shown another.
 *   * ONBOARDING IS NOT CHARGING and is gated differently on purpose: an
 *     advisor must be able to verify an account while charging is off.
 *
 * NO NETWORK. `stripeCall` is not reachable from a test and must not be: a
 * suite that could call Stripe is a suite that will, one day, against a live
 * key. Every assertion here is about what happens BEFORE the fetch — the
 * refusals, the arithmetic and the metadata — which is where every decision
 * this file cares about is made.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor_connect_leg.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PayoutAccountNotReady, SettlementDisabled, chargeSession, ensurePayoutAccount,
  loadPayoutAccount, markSessionCharged,
} from '../src/services/advisorConnect.ts';
import { cutCents, settlementMode } from '../src/services/advisorMoney.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const SQL = resolve(dirname(fileURLToPath(import.meta.url)), '../sql');
const read = (p: string) => readFileSync(p, 'utf8');

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
    async batch() { return []; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE advisor_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      advisor_id INTEGER NOT NULL, slot_id INTEGER, founder_user_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending', topic TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE advisor_office_hour_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      advisor_id INTEGER NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 1, meeting_url TEXT, notes TEXT,
      is_cancelled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  db.exec(`ALTER TABLE advisor_bookings ADD COLUMN amount_cents INTEGER;`);
  db.exec(`ALTER TABLE advisor_bookings ADD COLUMN billing_state TEXT NOT NULL DEFAULT 'unpriced';`);
  db.exec(readFileSync(`${SQL}/migrations/240_advisor_sessions_config.sql`, 'utf8'));
  db.exec(readFileSync(`${SQL}/migrations/241_advisor_money_model.sql`, 'utf8'));
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>, extra: Record<string, any> = {}) =>
  ({ DB: makeD1(db), ENVIRONMENT: 'development', ...extra }) as any;

/** A verified account, which is the only state a charge may proceed from. */
const verified = {
  id: 1, advisor_id: 1, state: 'verified', provider: 'stripe',
  provider_account_id: 'acct_test_1', charges_enabled: 1, payouts_enabled: 1,
  blocked_reason: null, last_checked_at: '2026-09-12T00:00:00.000Z',
};

const chargeArgs = (over: Record<string, any> = {}) => ({
  account: verified as any, bookingUid: 'b_1', bookingId: 1, advisorId: 1,
  amountCents: 30_000, customerId: 'cus_1', description: 'Advisory session',
  ...over,
});

// ── The flag ───────────────────────────────────────────────────────────────

test('a charge with settlement off THROWS rather than returning anything', async () => {
  // THE SHIPPED STATE. `ADVISOR_CHARGING_ENABLED` is set nowhere, so this is
  // every call today. A helpful falsy return here would be the simulated
  // payment `util/paymentMode.ts` exists to have deleted.
  const e = env(freshDb(), { STRIPE_SECRET_KEY: 'sk_test_x' });
  assert.equal(settlementMode(e), 'none');
  await assert.rejects(() => chargeSession(e, chargeArgs()), (err: any) => {
    assert.ok(err instanceof SettlementDisabled, `threw ${err?.name}`);
    assert.equal(err.mode, 'none');
    return true;
  });
});

test('the flag alone is not enough, and neither is the key', async () => {
  const db = freshDb();
  // A key with no flag: the state every environment is in today.
  await assert.rejects(
    () => chargeSession(env(db, { STRIPE_SECRET_KEY: 'sk_test_x' }), chargeArgs()),
    SettlementDisabled,
  );
  // A flag with no key: charging "on" against nothing, which must not reach
  // Stripe and must not pretend.
  await assert.rejects(
    () => chargeSession(env(db, { ADVISOR_CHARGING_ENABLED: '1' }), chargeArgs()),
    SettlementDisabled,
  );
  // And the flag is read as exactly '1', so a half-set variable cannot switch
  // charging on by accident.
  for (const v of ['true', 'yes', 'on', '0', '', ' 1']) {
    await assert.rejects(
      () => chargeSession(env(db, { ADVISOR_CHARGING_ENABLED: v, STRIPE_SECRET_KEY: 'sk_test_x' }), chargeArgs()),
      SettlementDisabled, `ADVISOR_CHARGING_ENABLED=${JSON.stringify(v)} let a charge through`,
    );
  }
});

// ── The gate ───────────────────────────────────────────────────────────────

test('an unverified account refuses BY STATE, so the page can say which gate applied', async () => {
  const on = { ADVISOR_CHARGING_ENABLED: '1', STRIPE_SECRET_KEY: 'sk_test_x' };
  const db = freshDb();
  for (const [account, want] of [
    [{ ...verified, charges_enabled: 0, payouts_enabled: 0, state: 'pending' }, 'pending'],
    [{ ...verified, charges_enabled: 1, payouts_enabled: 0 }, 'pending'],
    [{ ...verified, blocked_reason: 'under review' }, 'blocked'],
    [{ ...verified, provider_account_id: null }, 'pending'],
  ] as Array<[any, string]>) {
    await assert.rejects(
      () => chargeSession(env(db, on), chargeArgs({ account })),
      (err: any) => {
        assert.ok(err instanceof PayoutAccountNotReady, `threw ${err?.name}`);
        assert.equal(err.state, want);
        return true;
      },
    );
  }
});

test('nothing to charge is an error, never a free session', async () => {
  const on = { ADVISOR_CHARGING_ENABLED: '1', STRIPE_SECRET_KEY: 'sk_test_x' };
  const db = freshDb();
  for (const amountCents of [null, undefined, 0, -1, Number.NaN]) {
    await assert.rejects(
      () => chargeSession(env(db, on), chargeArgs({ amountCents })),
      /advisory_charge_amount_missing/,
      `amount ${JSON.stringify(amountCents)} was charged`,
    );
  }
});

// ── The fee ────────────────────────────────────────────────────────────────

test('the application fee is the ledger’s own cut, not a second computation', () => {
  // READ FROM THE SOURCE, because the call itself cannot run without a
  // network. What matters is that the fee is `cutCents` applied to the rate
  // the SETTING holds — two functions computing a platform fee is how a
  // client is charged one number and an advisor shown another.
  const src = read(`${SRC}/services/advisorConnect.ts`);
  const fn = src.slice(src.indexOf('export async function chargeSession'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /await takeRate\(env\)/, 'the rate must come from the setting');
  assert.match(body, /cutCents\(gross, rate\.bps\)/, 'the fee must be the ledger’s own cut');
  assert.match(body, /application_fee_amount: String\(fee\)/);
  assert.match(body, /'transfer_data\[destination\]'/, 'a destination charge, not a plain one');
  // NO SECOND ARITHMETIC. A literal percentage or a hand-rolled multiply here
  // is the drift this is written to prevent.
  assert.equal(/0\.15|\* *15|\/ *100\b/.test(body), false, 'the fee is computed a second way');

  // And the arithmetic they share still reconciles at the values a session
  // is actually priced at.
  for (const gross of [30_000, 45_000, 125_000, 33_333]) {
    const fee = cutCents(gross, 1500)!;
    assert.ok(fee * 10_000 <= gross * 1500, `fee exceeds the stated rate at ${gross}`);
    assert.equal(gross - fee + fee, gross);
  }
});

test('the intent carries the rate it was charged at, and names the product', () => {
  const src = read(`${SRC}/services/advisorConnect.ts`);
  // A dispute six months later is settled by what the processor recorded, not
  // by what the setting says then.
  assert.match(src, /'metadata\[take_rate_bps\]': String\(rate\.bps\)/);
  // One Stripe platform account now carries connected accounts for two
  // products; without this they are indistinguishable in any reconciliation.
  assert.match(src, /'metadata\[axal_product\]': 'advisory'/);
  // Its own webhook kind, so a fulfilment cannot land on a wellbeing row.
  assert.match(src, /'metadata\[kind\]': 'advisor_session'/);
  const billing = read(`${SRC}/routes/billing.ts`);
  assert.match(billing, /meta\.kind === 'advisor_session'/);
  assert.match(billing, /markSessionCharged/);
  // One intent per booking, replayed rather than duplicated.
  assert.match(src, /idempotencyKey: `pi:advisory:\$\{args\.bookingUid\}`/);
});

// ── Onboarding is not charging ─────────────────────────────────────────────

test('connecting an account is gated on a key and NOT on the charging flag', () => {
  // An advisor verifying while charging is off is how the platform gets ready
  // to switch on. If `connectLink` ever grew a settlement check, an operator
  // could never get a single advisor verified before flipping the flag.
  const src = read(`${SRC}/services/advisorConnect.ts`);
  const fn = src.slice(src.indexOf('export async function connectLink'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /STRIPE_SECRET_KEY/, 'a link still needs a configured Stripe');
  assert.equal(/settlementMode/.test(body), false, 'onboarding must not be gated on the charging flag');

  const refresh = src.slice(src.indexOf('export async function refreshAccount'));
  assert.equal(/settlementMode/.test(refresh.slice(0, refresh.indexOf('\n}\n'))), false,
    'reading an account status moves no money and must not be gated either');
});

test('a payout row starts pending and all-zero, which is not refused', async () => {
  const db = freshDb();
  const e = env(db);
  const a = await ensurePayoutAccount(e, 1, 'pa_1');
  assert.equal(a.state, 'pending');
  assert.equal(a.charges_enabled, 0);
  assert.equal(a.payouts_enabled, 0);
  // NULL, meaning never asked — which the page distinguishes from asked and
  // refused.
  assert.equal(a.last_checked_at, null);
  // Idempotent: a second call does not create a second row.
  await ensurePayoutAccount(e, 1, 'pa_2');
  const n = db.prepare('SELECT COUNT(*) n FROM advisor_payout_accounts').get() as any;
  assert.equal(n.n, 1);
  assert.equal((await loadPayoutAccount(e, 1))!.uid ?? 'pa_1', 'pa_1');
});

// ── Fulfilment ─────────────────────────────────────────────────────────────

test('fulfilment stamps what the processor took, and is idempotent', async () => {
  const db = freshDb();
  const e = env(db);
  db.prepare(
    `INSERT INTO advisor_office_hour_slots (id, uid, advisor_id, starts_at, ends_at, payment_state)
     VALUES (7, 's_1', 1, 'a', 'b', 'held_unpaid')`).run();
  // THE BOOKING ALREADY CARRIES A CUT, and that is what makes this test able
  // to see the difference. It was priced at 12% when the advisor recorded the
  // amount; the charge went out at 15%. A fixture whose cut started NULL
  // cannot tell `COALESCE(?, stored)` from `COALESCE(stored, ?)`, and a
  // mutation swapping them passed — leaving a fulfilment that keeps the stale
  // figure and reports a cut the processor never took.
  db.prepare(
    `INSERT INTO advisor_bookings (uid, advisor_id, slot_id, amount_cents, billing_state,
                                   platform_cut_cents, take_rate_bps)
     VALUES ('b_1', 1, 7, 30000, 'billed', 3600, 1200)`).run();

  await markSessionCharged(e, {
    id: 'pi_1', amount_received: 30_000, application_fee_amount: 4_500,
    metadata: { booking_uid: 'b_1', take_rate_bps: '1500' },
  });
  const row = db.prepare('SELECT * FROM advisor_bookings WHERE uid = ?').get('b_1') as any;
  assert.equal(row.billing_state, 'collected');
  // WHAT STRIPE TOOK, not what the line was stamped with when it was priced
  // and not a recomputation from today's setting — both of which could differ
  // from the amount that actually moved.
  assert.equal(row.platform_cut_cents, 4_500);
  assert.equal(row.take_rate_bps, 1500);
  // The slot stops being held, because it is no longer unpaid.
  const slot = db.prepare('SELECT payment_state FROM advisor_office_hour_slots WHERE id = 7').get() as any;
  assert.equal(slot.payment_state, 'charged');

  // NO PAYOUT ROW. A payout is the provider paying the advisor OUT, a later
  // and separate event; writing one here would assert a settlement that has
  // not happened.
  const payouts = db.prepare('SELECT COUNT(*) n FROM advisor_payouts').get() as any;
  assert.equal(payouts.n, 0);

  // Idempotent: Stripe redelivers, and a second run must not write again.
  db.prepare('UPDATE advisor_bookings SET platform_cut_cents = 1 WHERE uid = ?').run('b_1');
  await markSessionCharged(e, {
    id: 'pi_1', amount_received: 30_000, application_fee_amount: 9_999,
    metadata: { booking_uid: 'b_1', take_rate_bps: '9999' },
  });
  const again = db.prepare('SELECT platform_cut_cents FROM advisor_bookings WHERE uid = ?').get('b_1') as any;
  assert.equal(again.platform_cut_cents, 1, 'a redelivery re-wrote an already-collected booking');
});

test('fulfilment without a booking uid never reaches the database', async () => {
  // NOT JUST "does not crash", which a mutation showed is too weak: deleting
  // the `!uid` guard left every assertion green, because an undefined bind
  // simply matches no row. What the guard actually buys is that a webhook
  // carrying no booking — a redelivery of some other product's event, say —
  // costs no query, so the assertion counts queries.
  const db = freshDb();
  let queries = 0;
  const counting = { DB: { ...makeD1(db) }, ENVIRONMENT: 'development' } as any;
  const inner = makeD1(db);
  counting.DB = {
    ...inner,
    prepare(sql: string) { queries += 1; return inner.prepare(sql); },
  };

  await markSessionCharged(counting, { id: 'pi_1', metadata: {} });
  await markSessionCharged(counting, { id: 'pi_1' });
  await markSessionCharged(counting, { id: 'pi_1', metadata: { booking_uid: '' } });
  assert.equal(queries, 0, 'an event with no booking uid queried the database');

  // And a uid that names nothing DOES query once and then stops — it has to
  // look before it can know.
  await markSessionCharged(counting, { id: 'pi_1', metadata: { booking_uid: 'nope' } });
  assert.equal(queries, 1, 'a miss should cost one lookup and no write');
});

test('a slot that was never held is not transitioned from nowhere', async () => {
  const db = freshDb();
  const e = env(db);
  db.prepare(
    `INSERT INTO advisor_office_hour_slots (id, uid, advisor_id, starts_at, ends_at, payment_state)
     VALUES (7, 's_1', 1, 'a', 'b', 'not_applicable')`).run();
  db.prepare(
    `INSERT INTO advisor_bookings (uid, advisor_id, slot_id, amount_cents, billing_state)
     VALUES ('b_1', 1, 7, 30000, 'billed')`).run();
  await markSessionCharged(e, {
    id: 'pi_1', amount_received: 30_000, application_fee_amount: 4_500,
    metadata: { booking_uid: 'b_1', take_rate_bps: '1500' },
  });
  const slot = db.prepare('SELECT payment_state FROM advisor_office_hour_slots WHERE id = 7').get() as any;
  assert.equal(slot.payment_state, 'not_applicable',
    'only a held or authorized slot becomes charged; the rest are left alone');
});

// ── Nothing claims a charge in test mode ───────────────────────────────────

test('no advisory surface renders a charge as accomplished fact', () => {
  // THE MIRROR OF THE FLAG. Turning settlement to 'test' must change what the
  // page SAYS, not let it say the same confident thing — a test-mode
  // deployment that reads as live is the failure this whole flag exists to
  // prevent.
  const page = read(`${SRC}/../../frontend/src/pages/advisor/practice/EarningsZone.jsx`);
  // The page branches on the mode rather than asserting one.
  assert.match(page, /d\.settlement === 'none'/);
  assert.match(page, /Payments are running in/);
  // And the mode is RENDERED, so a reader in test mode is told it is test.
  assert.match(page, /\{d\.settlement\}/);

  // The worker never hard-codes the answer.
  const adv = read(`${SRC}/routes/advisors.ts`);
  assert.equal(/settlement: 'none'/.test(adv), false,
    "a literal 'none' would keep saying none after the flag flips");
  const money = read(`${SRC}/services/advisorMoney.ts`);
  assert.match(money, /export function settlementMode/);
  // `isProductionEnv` is what decides live from test, and it is the shared
  // one — a second, looser reading of "is this production" is how a test key
  // comes to be described as live.
  assert.match(money, /from '\.\.\/util\/paymentMode'/);
  assert.match(money, /isProductionEnv\(env\) \? 'live' : 'test'/);
});
