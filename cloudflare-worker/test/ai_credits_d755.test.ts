// D755 (#1870, #1905) — the AI credit ledger and the token-pack store (migration 486).
// The ledger is append-only and signed per kind; the reservation triggers write
// the hold, the release and the spend for the unchanged reserve/settle/review
// code; the old Worker's credit is mirrored and its draw is not. After every
// case, every member's ledger sum equals their top-up balance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1 } from './_d1_sqlite.mjs';
import { aiBudgetFixture, AI_USERS_SCHEMA, AI_LOG_SCHEMA, AI_BUDGET_REVIEW_MIGRATION, AI_CREDITS_MIGRATION } from './_ai_budget_fixture.mjs';
import { reserveAiBudget, settleAiReservation, settleAiBudgetReview } from '../src/services/aiBudget.ts';
import { recordAiTopupPurchase, creditAiTopupFromPayment } from '../src/services/aiTopups.ts';
import { ledgerBalance, TOKEN_PACK_LIMITS } from '../src/services/aiCredits.ts';
import { classifyIdempotency } from '../../scripts/lib/migrationPlan.mjs';

const now = new Date('2026-10-18T12:00:00Z');
const MIGRATION_419 = readFileSync(new URL('../sql/migrations/419_ai_caps_topups.sql', import.meta.url), 'utf8');
const MESSAGE = /ai_credit_ledger is append-only \(D755\)\./;

function fixture() {
  const f = aiBudgetFixture();
  return { ...f, env: { DB: f.DB, JWT_SECRET: 'd755-fixture-only-signing-secret', STRIPE_WEBHOOK_SECRET: 'd755-fixture-only-webhook-secret', ENVIRONMENT: 'development' } as any };
}
const rows = (db: any, sql: string, ...binds: unknown[]) => db.prepare(sql).all(...binds).map((r: any) => ({ ...r }));
const ledger = (db: any) => rows(db, 'SELECT kind,delta_microusd,source_ref,reservation_uid,payment_intent_id FROM ai_credit_ledger ORDER BY rowid');
/** The invariant: for every member with a balance or a ledger row, the ledger sum is the balance. */
async function assertInvariant(f: any) {
  const users = rows(f.db, 'SELECT user_id FROM ai_topup_accounts UNION SELECT user_id FROM ai_credit_ledger');
  for (const { user_id } of users) {
    const balance = f.db.prepare('SELECT balance_microusd AS b FROM ai_topup_accounts WHERE user_id=?').get(user_id)?.b ?? 0;
    assert.equal(await ledgerBalance(f.env, user_id), balance, `ledger sum equals the balance for user ${user_id}`);
  }
}
/** A purchase credited by the current webhook: its ai_topup_ledger credit is mirrored as a purchase. */
async function buy(f: any, credit: number, id = 'pi_d755', user = 2) {
  await recordAiTopupPurchase(f.env, { paymentIntentId: id, orderRef: `order_${id}`, userId: user, totalCents: credit / 10000, currency: 'usd', quote: { priceId: 'price_owner', creditMicrousd: credit } });
  assert.equal(await creditAiTopupFromPayment(f.env, { id, status: 'succeeded', currency: 'usd', amount_received: credit / 10000, metadata: { kind: 'cart_order', order_ref: `order_${id}`, user_id: String(user) } }), true);
}
/** No included allowance, so every reserved micro-USD is held from the top-up balance. */
const noAllowance = (db: any) => db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('founder:free',0,0,1)").run();

test('migration 486 backfills 419 rows, keeps their dates, and applying it again adds nothing', async () => {
  const { DB, db } = makeD1('PRAGMA foreign_keys=ON;' + AI_USERS_SCHEMA + AI_LOG_SCHEMA + MIGRATION_419 + AI_BUDGET_REVIEW_MIGRATION);
  const f = { DB, db, env: { DB } as any };
  try {
    // What the D629 Worker left: a 5.00 credit, a settled run that drew 0.20, a pending hold of 0.10 and one in review of 0.05.
    db.exec(`INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,4650000);
      INSERT INTO ai_topup_purchases(payment_intent_id,order_ref,user_id,price_id,credit_microusd,expected_total_cents,currency,credited_at)
        VALUES('pi_old','order_old',2,'price_owner',5000000,500,'usd','2026-09-01 10:00:00');
      INSERT INTO ai_topup_ledger(uid,user_id,kind,amount_microusd,payment_intent_id,actor,created_at)
        VALUES('led_credit',2,'credit',5000000,'pi_old','payment_webhook','2026-09-01 10:00:00');
      INSERT INTO ai_budget_reservations(uid,user_id,day_key,month_key,included_microusd,topup_microusd,status,settlement_uid,actual_included_microusd,actual_topup_microusd,expires_at,created_at)
        VALUES('r_settled',2,'2026-09-02','2026-09',0,300000,'settled','tok_settled',0,200000,'2026-09-02 00:05:00','2026-09-02 00:00:00');
      INSERT INTO ai_topup_ledger(uid,user_id,kind,amount_microusd,reservation_uid,actor,created_at)
        VALUES('tok_settled',2,'draw',200000,'r_settled','2','2026-09-02 00:01:00');
      INSERT INTO ai_budget_reservations(uid,user_id,day_key,month_key,included_microusd,topup_microusd,expires_at,created_at)
        VALUES('r_pending',2,'2026-09-03','2026-09',0,100000,'2026-09-03 00:05:00','2026-09-03 00:00:00');
      INSERT INTO ai_budget_reservations(uid,user_id,day_key,month_key,included_microusd,topup_microusd,status,recorded_cost_microusd,expires_at,created_at)
        VALUES('r_review',2,'2026-09-04','2026-09',0,50000,'review',80000,'2026-09-04 00:05:00','2026-09-04 00:00:00');
      INSERT INTO ai_budget_reservations(uid,user_id,day_key,month_key,included_microusd,topup_microusd,expires_at,created_at)
        VALUES('r_included',2,'2026-09-05','2026-09',40000,0,'2026-09-05 00:05:00','2026-09-05 00:00:00');`);
    db.exec(AI_CREDITS_MIGRATION);
    const want = [
      { kind: 'purchase', delta_microusd: 5000000, source_ref: 'pi:pi_old', created_at: '2026-09-01 10:00:00' },
      { kind: 'spend', delta_microusd: -200000, source_ref: 'res:r_settled', created_at: '2026-09-02 00:01:00' },
      { kind: 'hold', delta_microusd: -100000, source_ref: 'res:r_pending', created_at: '2026-09-03 00:00:00' },
      { kind: 'hold', delta_microusd: -50000, source_ref: 'res:r_review', created_at: '2026-09-04 00:00:00' },
    ];
    const read = () => rows(db, 'SELECT kind,delta_microusd,source_ref,created_at FROM ai_credit_ledger ORDER BY created_at');
    assert.deepEqual(read(), want);
    await assertInvariant(f);
    // Every statement but the four ALTERs is idempotent; replaying the rest adds nothing.
    assert.deepEqual(classifyIdempotency(AI_CREDITS_MIGRATION).reasons, ['ALTER TABLE (SQLite ADD COLUMN is not re-runnable)']);
    const replay = AI_CREDITS_MIGRATION.replace(/^ALTER TABLE[^;]*;$/gm, '');
    assert.equal((replay.match(/ALTER TABLE ai_topup_purchases/g) || []).length, 0);
    db.exec(replay);
    assert.deepEqual(read(), want);
    // The four purchase columns arrive with their defaults.
    assert.deepEqual({ ...db.prepare('SELECT pack_uid,bonus_microusd,reversed_microusd,dispute_state FROM ai_topup_purchases').get() },
      { pack_uid: null, bonus_microusd: 0, reversed_microusd: 0, dispute_state: null });
    for (const [col, value] of [['bonus_microusd', -1], ['reversed_microusd', 1.5], ['dispute_state', 'closed']] as const)
      assert.throws(() => db.prepare(`UPDATE ai_topup_purchases SET ${col}=?`).run(value), /CHECK/, col);
    // The backfilled pending hold is released by the new trigger when it settles through the real code.
    await settleAiReservation(f.env, { uid: 'r_pending', userId: 2 }, 60000);
    assert.deepEqual(rows(db, "SELECT kind,delta_microusd FROM ai_credit_ledger WHERE source_ref='res:r_pending' ORDER BY rowid"),
      [{ kind: 'hold', delta_microusd: -100000 }, { kind: 'release', delta_microusd: 100000 }, { kind: 'spend', delta_microusd: -60000 }]);
    await assertInvariant(f);
  } finally { db.close(); }
});

test('the ledger is append-only: UPDATE and DELETE abort with D755 message', async () => {
  const f = fixture();
  try {
    await buy(f, 2000000);
    assert.throws(() => f.db.prepare('UPDATE ai_credit_ledger SET delta_microusd=delta_microusd+1').run(), MESSAGE);
    assert.throws(() => f.db.prepare("UPDATE ai_credit_ledger SET reason='rewritten history'").run(), MESSAGE);
    assert.throws(() => f.db.prepare('DELETE FROM ai_credit_ledger').run(), MESSAGE);
    assert.equal(rows(f.db, 'SELECT * FROM ai_credit_ledger').length, 1);
    await assertInvariant(f);
  } finally { f.db.close(); }
});

test('each kind carries its sign; refunds of 0 need a shortfall and adjustments a reason', async () => {
  const f = fixture();
  try {
    let n = 0;
    const insert = (kind: string, delta: number, extra: { shortfall?: number; reason?: string | null } = {}) =>
      f.db.prepare('INSERT INTO ai_credit_ledger(user_id,kind,delta_microusd,source_ref,shortfall_microusd,actor,reason) VALUES(2,?,?,?,?,?,?)')
        .run(kind, delta, `check:${++n}`, extra.shortfall ?? 0, 'test', extra.reason ?? null);
    const refused: [string, number, { shortfall?: number; reason?: string | null }?][] = [
      ['purchase', 0], ['purchase', -1], ['bonus', 0], ['release', -1], ['dispute_won', 0],
      ['hold', 0], ['hold', 1], ['spend', 0], ['spend', 1],
      ['refund', 1], ['refund', 0], ['dispute', 1], ['dispute', 0],
      ['adjustment', 0, { reason: 'a long enough reason' }], ['adjustment', 1], ['adjustment', -1, { reason: 'too short' }],
      ['adjustment', 1, { reason: '         x' }], ['refund', -1, { shortfall: -1 }], ['purchase', 1.5], ['gift', 1],
    ];
    for (const [kind, delta, extra] of refused) assert.throws(() => insert(kind, delta, extra), /CHECK/, `${kind} ${delta} ${JSON.stringify(extra)}`);
    // The same shapes with the right sign are accepted, so each refusal above is the sign rule and not the row.
    const accepted: [string, number, { shortfall?: number; reason?: string | null }?][] = [
      ['purchase', 1], ['bonus', 1], ['release', 1], ['dispute_won', 1], ['hold', -1], ['spend', -1],
      ['refund', -1], ['refund', 0, { shortfall: 1 }], ['dispute', -1], ['dispute', 0, { shortfall: 1 }],
      ['adjustment', 1, { reason: 'ten chars.' }], ['adjustment', -1, { reason: 'a long enough reason' }],
    ];
    for (const [kind, delta, extra] of accepted) assert.doesNotThrow(() => insert(kind, delta, extra), `${kind} ${delta}`);
    // One row per kind and source: the idempotency key.
    const taken = f.db.prepare("SELECT source_ref FROM ai_credit_ledger WHERE kind='purchase'").get().source_ref;
    assert.throws(() => f.db.prepare("INSERT INTO ai_credit_ledger(user_id,kind,delta_microusd,source_ref,actor) VALUES(2,'purchase',1,?,'test')").run(taken), /UNIQUE/);
    assert.doesNotThrow(() => f.db.prepare("INSERT INTO ai_credit_ledger(user_id,kind,delta_microusd,source_ref,actor) VALUES(2,'bonus',1,?,'test')").run(taken));
    assert.throws(() => f.db.prepare("INSERT INTO ai_credit_ledger(user_id,kind,delta_microusd,source_ref,actor) VALUES(999,'purchase',1,'check:fk','test')").run(), /FOREIGN KEY/);
    // Keep the invariant: the accepted rows net out to the balance written beside them.
    const sum = f.db.prepare('SELECT SUM(delta_microusd) AS s FROM ai_credit_ledger').get().s;
    f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,?)').run(sum);
    await assertInvariant(f);
  } finally { f.db.close(); }
});

test('the token-pack store bounds face value and bonus, and an archived pack is never on sale', () => {
  const f = fixture();
  try {
    const pack = (values: Record<string, unknown>) => {
      const v = { price_id: 'price_pack25', product_id: 'prod_pack25', face_cents: 2500, bonus_microusd: 0, on_sale: 0, origin: 'created', archived_at: null, ...values };
      return f.db.prepare('INSERT INTO ai_token_packs(price_id,product_id,face_cents,bonus_microusd,on_sale,origin,archived_at) VALUES(?,?,?,?,?,?,?)')
        .run(v.price_id, v.product_id, v.face_cents, v.bonus_microusd, v.on_sale, v.origin, v.archived_at);
    };
    for (const bad of [{ face_cents: 499 }, { face_cents: 50001 }, { face_cents: 2500.5 }, { bonus_microusd: 2500001 }, { bonus_microusd: -1 },
      { price_id: 'prod_x' }, { on_sale: 2 }, { origin: 'environment' }, { on_sale: 1, archived_at: '2026-10-18 00:00:00' }])
      assert.throws(() => pack(bad), /CHECK/, JSON.stringify(bad));
    assert.doesNotThrow(() => pack({ face_cents: 500, price_id: 'price_min' }));
    assert.doesNotThrow(() => pack({ face_cents: 50000, price_id: 'price_max', bonus_microusd: 50000000, origin: 'adopted' }));
    assert.doesNotThrow(() => pack({ bonus_microusd: 2500000, on_sale: 1 }));
    assert.throws(() => pack({ product_id: 'prod_dup' }), /UNIQUE/);
    assert.match(f.db.prepare("SELECT uid FROM ai_token_packs WHERE price_id='price_pack25'").get().uid, /^[0-9a-f]{32}$/);
    // The store's bounds are §16's.
    assert.equal(TOKEN_PACK_LIMITS.minFaceCents, 500); assert.equal(TOKEN_PACK_LIMITS.maxFaceCents, 50000);
    assert.equal(TOKEN_PACK_LIMITS.maxBonusPercent, 10); assert.equal(TOKEN_PACK_LIMITS.ordersPerDay, 5);
    assert.equal(TOKEN_PACK_LIMITS.balanceCeilingMicrousd, 1_000_000_000); assert.equal(TOKEN_PACK_LIMITS.shortfallHoldDays, 90);
    assert.equal(TOKEN_PACK_LIMITS.maxAdjustmentMicrousd, 100_000_000); assert.equal(TOKEN_PACK_LIMITS.maxAdjustmentAddedMicrousd, 250_000_000);
    assert.equal(TOKEN_PACK_LIMITS.adjustmentWindowDays, 30);
  } finally { f.db.close(); }
});

test('the reservation triggers write hold, release and spend through the real reserve, settle and review code', async () => {
  const f = fixture();
  try {
    noAllowance(f.db);
    await buy(f, 5000000);
    assert.deepEqual(ledger(f.db), [{ kind: 'purchase', delta_microusd: 5000000, source_ref: 'pi:pi_d755', reservation_uid: null, payment_intent_id: 'pi_d755' }]);
    const bySource = (uid: string) => rows(f.db, 'SELECT kind,delta_microusd FROM ai_credit_ledger WHERE source_ref=? ORDER BY rowid', `res:${uid}`);

    // Reserve with a top-up: a hold.
    const one = await reserveAiBudget(f.env, 2, 800000, now); if (!one.ok) throw Error('reserve');
    assert.deepEqual(bySource(one.reservation.uid), [{ kind: 'hold', delta_microusd: -800000 }]);
    await assertInvariant(f);
    // Settle: the whole hold released, then what the run cost spent.
    await settleAiReservation(f.env, one.reservation, 500000);
    assert.deepEqual(bySource(one.reservation.uid), [{ kind: 'hold', delta_microusd: -800000 }, { kind: 'release', delta_microusd: 800000 }, { kind: 'spend', delta_microusd: -500000 }]);
    await settleAiReservation(f.env, one.reservation, 500000);
    assert.equal(bySource(one.reservation.uid).length, 3, 'a replayed settle writes nothing');
    await assertInvariant(f);

    // Refunded: a release only.
    const two = await reserveAiBudget(f.env, 2, 300000, now); if (!two.ok) throw Error('reserve');
    await settleAiReservation(f.env, two.reservation, 0, true);
    assert.deepEqual(bySource(two.reservation.uid), [{ kind: 'hold', delta_microusd: -300000 }, { kind: 'release', delta_microusd: 300000 }]);
    await assertInvariant(f);

    // Pending to review writes nothing; the Super Admin's charge releases and spends the whole hold.
    const three = await reserveAiBudget(f.env, 2, 200000, now); if (!three.ok) throw Error('reserve');
    await assert.rejects(() => settleAiReservation(f.env, three.reservation, 300000), /exceeds/);
    assert.equal(f.db.prepare('SELECT status FROM ai_budget_reservations WHERE uid=?').get(three.reservation.uid).status, 'review');
    assert.deepEqual(bySource(three.reservation.uid), [{ kind: 'hold', delta_microusd: -200000 }]);
    await assertInvariant(f);
    await settleAiBudgetReview(f.env, three.reservation.uid, 'charge', 1, 'The platform charges the hold');
    assert.deepEqual(bySource(three.reservation.uid), [{ kind: 'hold', delta_microusd: -200000 }, { kind: 'release', delta_microusd: 200000 }, { kind: 'spend', delta_microusd: -200000 }]);
    await assertInvariant(f);

    // The Super Admin's refund of a review: a release only.
    const four = await reserveAiBudget(f.env, 2, 100000, now); if (!four.ok) throw Error('reserve');
    await assert.rejects(() => settleAiReservation(f.env, four.reservation, 150000), /exceeds/);
    await settleAiBudgetReview(f.env, four.reservation.uid, 'refund', 1, 'The platform refunds the hold');
    assert.deepEqual(bySource(four.reservation.uid), [{ kind: 'hold', delta_microusd: -100000 }, { kind: 'release', delta_microusd: 100000 }]);

    // A run paid wholly by the allowance writes no ledger row.
    f.db.prepare("UPDATE ai_licence_caps SET daily_microusd=1000000,monthly_microusd=1000000 WHERE licence_key='founder:free'").run();
    const five = await reserveAiBudget(f.env, 2, 100000, now); if (!five.ok) throw Error('reserve');
    await settleAiReservation(f.env, five.reservation, 50000);
    assert.deepEqual(bySource(five.reservation.uid), []);

    // No draw is written any more.
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM ai_topup_ledger WHERE kind='draw'").get().n, 0);
    assert.equal(f.db.prepare('SELECT balance_microusd AS b FROM ai_topup_accounts WHERE user_id=2').get().b, 5000000 - 500000 - 200000);
    await assertInvariant(f);
  } finally { f.db.close(); }
});

test("the old Worker's credit is mirrored as one purchase; its draw is not mirrored", async () => {
  const f = fixture();
  try {
    // A credit as the D629 Worker writes it: its purchase row, the ledger row and the balance.
    f.db.exec(`INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(3,1000000);
      INSERT INTO ai_topup_purchases(payment_intent_id,order_ref,user_id,price_id,credit_microusd,expected_total_cents,currency,credited_at)
        VALUES('pi_legacy','order_legacy',3,'price_owner',1000000,100,'usd',datetime('now'));
      INSERT OR IGNORE INTO ai_topup_ledger(uid,user_id,kind,amount_microusd,payment_intent_id,actor) VALUES('led_legacy',3,'credit',1000000,'pi_legacy','payment_webhook');`);
    assert.deepEqual(ledger(f.db), [{ kind: 'purchase', delta_microusd: 1000000, source_ref: 'pi:pi_legacy', reservation_uid: null, payment_intent_id: 'pi_legacy' }]);
    await assertInvariant(f);
    // A run as the D629 Worker settles it: the hold and the settle fire the triggers, then its own draw INSERT.
    f.db.exec(`INSERT INTO ai_budget_reservations(uid,user_id,day_key,month_key,included_microusd,topup_microusd,expires_at)
        VALUES('r_legacy',3,'2026-10-18','2026-10',0,400000,'2026-10-18 12:05:00');
      UPDATE ai_topup_accounts SET balance_microusd=balance_microusd-400000 WHERE user_id=3;
      UPDATE ai_budget_reservations SET status='settled',settlement_uid='tok_legacy',actual_included_microusd=0,actual_topup_microusd=250000 WHERE uid='r_legacy';
      UPDATE ai_topup_accounts SET balance_microusd=balance_microusd+150000 WHERE user_id=3;`);
    const before = ledger(f.db);
    f.db.exec("INSERT INTO ai_topup_ledger(uid,user_id,kind,amount_microusd,reservation_uid,actor) VALUES('tok_legacy',3,'draw',250000,'r_legacy','3')");
    assert.deepEqual(ledger(f.db), before, 'a draw adds no ledger row');
    assert.deepEqual(before.map((r: any) => [r.kind, r.delta_microusd]), [['purchase', 1000000], ['hold', -400000], ['release', 400000], ['spend', -250000]]);
    await assertInvariant(f);
  } finally { f.db.close(); }
});

// Guards. "D755 files" are the code this decision adds; D755.md itself discusses AIRail's markup by design.
const D755_FILES = ['../sql/migrations/486_ai_credits_token_packs.sql', '../src/services/aiCredits.ts'];
test('no D755 file prints a markup or reads the perk or the introduction ledger', () => {
  const markup = ['1', '.25'].join(''), word = ['mark', 'up'].join('');
  const perk = ['perk', 'credit', 'ledger'].join('_'), intro = ['intro', 'credit', 'ledger'].join('_');
  for (const rel of D755_FILES) {
    const text = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.ok(text.length > 500, rel);
    for (const needle of [markup, word, perk, intro]) assert.equal(text.toLowerCase().includes(needle), false, `${rel} contains ${needle}`);
  }
});

// ---------------------------------------------------------------------------
// PR 2: a pack is bought alone, at face value, and credited once by the webhook.
// ---------------------------------------------------------------------------
import { SignJWT } from 'jose';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { ensureCatalogSchema } from '../src/services/catalog.ts';
import { ensureOrdersSchema, fulfilOrder } from '../src/services/orders.ts';
import { validatePromoForProduct } from '../src/services/promos.ts';
import { resetAiTopupMirrorWindow } from '../src/services/aiTopups.ts';
import { tokenPackForPrice, isTokenPackPrice, isTokenPackProduct, packOnSale } from '../src/services/aiCredits.ts';
import ordersRoute from '../src/routes/orders.ts';
import paymentsRoute from '../src/routes/payments.ts';
import billingRoute from '../src/routes/billing.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const PACK = 'price_pack25', OTHER = 'price_other10', FALLBACK = 'price_envTopup';
const price = (id: string, product: string, unit_amount: number) => ({ id, product, active: true, currency: 'usd', unit_amount, nickname: null, type: 'one_time', recurring: null });

/** The D1 world of a member who can check out: orders, catalog mirror, promos, sessions and one $25 pack with a 10% bonus. */
async function shop(opts: { env?: Record<string, unknown>; mirrored?: number; onSale?: number; pack?: boolean } = {}) {
  resetAiTopupMirrorWindow();
  const f = fixture();
  Object.assign(f.env, { STRIPE_SECRET_KEY: 'sk' + '_test_fixtureOnly000', ...opts.env });
  await ensureCatalogSchema(f.env);
  await ensureOrdersSchema(f.env);
  for (const t of ['promo_codes', 'user_sessions']) f.db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  f.db.exec("ALTER TABLE users ADD COLUMN uid TEXT; ALTER TABLE users ADD COLUMN stripe_customer_id TEXT; ALTER TABLE users ADD COLUMN investor_stripe_customer_id TEXT; UPDATE users SET uid='uid-'||id, stripe_customer_id='cus_member'||id");
  const product = (id: string, name: string, prices: unknown[], metadata = {}) =>
    f.db.prepare("INSERT INTO stripe_products(id,name,kind,active,metadata_json,prices_json) VALUES(?,?,'alacarte',1,?,?)").run(id, name, JSON.stringify(metadata), JSON.stringify(prices));
  product('prod_pack25', '$25 of tokens', [price(PACK, 'prod_pack25', opts.mirrored ?? 2500)]);
  product('prod_other', 'Other', [price(OTHER, 'prod_other', 1000)], { feature_key: 'other_feature' });
  product('prod_env', 'AI tokens', [price(FALLBACK, 'prod_env', 1500)]);
  if (opts.pack !== false)
    f.db.prepare("INSERT INTO ai_token_packs(uid,price_id,product_id,face_cents,bonus_microusd,on_sale,origin) VALUES('pack25',?,'prod_pack25',2500,2500000,?,'created')").run(PACK, opts.onSale ?? 1);
  f.db.prepare("INSERT INTO promo_codes (id, code, code_normalized, coupon_id, product_ids_json, active, max_redemptions, percent_off) VALUES ('promo-free','FREE100','FREE100','coupon','[]',1,NULL,100)").run();
  return f;
}
/** Stripe, stubbed. A URL no stub answers fails the test. */
function stripeStub() {
  const before = globalThis.fetch; const calls: string[] = []; let n = 0;
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input); calls.push(`${init?.method ?? 'GET'} ${url}`);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/v1/customers') || /\/v1\/customers\/cus_/.test(url)) return json({ id: 'cus_member2' });
    if (url.endsWith('/v1/payment_intents') && init?.method === 'POST') { n++; return json({ id: `pi_pack${n}`, client_secret: `pi_pack${n}` + '_secret_' + 'fixture', status: 'requires_payment_method' }); }
    const got = /\/v1\/payment_intents\/(pi_\w+)$/.exec(url);
    if (got) return json({ id: got[1], status: 'succeeded', amount_received: 2500, currency: 'usd', metadata: stubbedPi.get(got[1]) ?? {} });
    throw new Error(`no Stripe stub answers ${url}`);
  }) as any;
  return { calls, restore: () => { globalThis.fetch = before; } };
}
const stubbedPi = new Map<string, Record<string, string>>();
async function auth(f: any, user = 2) {
  const jti = `jti-${user}`;
  f.db.prepare("INSERT OR IGNORE INTO user_sessions (user_id, jti, factor, created_at, last_step_up_at) VALUES (?, ?, 'totp', datetime('now'), datetime('now'))").run(user, jti);
  const jwt = await new SignJWT({ user_id: user, jti }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(f.env.JWT_SECRET));
  return { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' };
}
async function intent(f: any, items: unknown[], extra: Record<string, unknown> = {}, user = 2) {
  const r = await ordersRoute.request('/intent', { method: 'POST', headers: await auth(f, user), body: JSON.stringify({ items, nonce: `n${Math.random()}`.replace('.', ''), ...extra }) }, f.env);
  return { status: r.status, body: await r.json() as any };
}
async function webhook(f: any, pi: Record<string, unknown>) {
  const body = JSON.stringify({ id: `evt_${pi.id}`, type: 'payment_intent.succeeded', data: { object: pi } });
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(f.env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)))).map((n) => n.toString(16).padStart(2, '0')).join('');
  return billingRoute.request('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${timestamp},v1=${signature}`, 'content-type': 'application/json' }, body }, f.env);
}
const ONE = [{ price_id: PACK, quantity: 1 }];
const ledgerCount = (f: any) => f.db.prepare('SELECT COUNT(*) AS n FROM ai_credit_ledger').get().n;

test('each pack rule answers its code and creates no PaymentIntent', async () => {
  const cases: [string, (f: any) => void, unknown[], Record<string, unknown>, Record<string, unknown>?][] = [
    ['token_pack_alone', () => {}, [...ONE, { price_id: OTHER, quantity: 1 }], {}],
    ['token_pack_alone', () => {}, [{ price_id: PACK, quantity: 2 }], {}],
    ['promo_not_for_token_packs', () => {}, ONE, { promo_code: 'SAVE10' }],
    ['promo_not_for_token_packs', () => {}, ONE, { promo_code: 'FREE100' }],
    ['token_pack_not_on_sale', () => {}, ONE, {}, { onSale: 0 }],
    ['token_pack_not_on_sale', () => {}, ONE, {}, { mirrored: 3000 }],
    ['token_pack_not_on_sale', (f) => f.db.prepare("UPDATE ai_token_packs SET on_sale=0, archived_at=datetime('now')").run(), ONE, {}],
    ['token_pack_daily_limit', (f) => { for (let i = 0; i < 5; i++) f.db.prepare("INSERT INTO ai_topup_purchases(payment_intent_id,order_ref,user_id,price_id,credit_microusd,expected_total_cents,currency,pack_uid,credited_at) VALUES(?,?,2,?,25000000,2500,'usd','pack25',datetime('now'))").run(`pi_day${i}`, `MRD-day${i}`, PACK); f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,0)').run(); for (let i = 0; i < 5; i++) f.db.prepare("INSERT INTO ai_credit_ledger(user_id,kind,delta_microusd,source_ref,actor) VALUES(2,'purchase',25000000,?,'test')").run(`pi:pi_day${i}`); f.db.prepare('UPDATE ai_topup_accounts SET balance_microusd=125000000 WHERE user_id=2').run(); }, ONE, {}],
    ['token_balance_ceiling', (f) => { const b = 1_000_000_000 - 27_500_000 + 1; f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,?)').run(b); f.db.prepare("INSERT INTO ai_credit_ledger(user_id,kind,delta_microusd,source_ref,actor) VALUES(2,'purchase',?,'pi:pi_big','test')").run(b); }, ONE, {}],
    ['token_balance_ceiling', (f) => { const b = 1_000_000_000 - 27_500_000 - 10_000_000 + 1; f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,?)').run(b); f.db.prepare("INSERT INTO ai_credit_ledger(user_id,kind,delta_microusd,source_ref,actor) VALUES(2,'purchase',?,'pi:pi_big','test')").run(b); f.db.prepare("INSERT INTO ai_topup_purchases(payment_intent_id,order_ref,user_id,price_id,credit_microusd,expected_total_cents,currency,pack_uid) VALUES('pi_waiting','MRD-waiting',2,?,10000000,1000,'usd','pack25')").run(PACK); }, ONE, {}],
    ['token_packs_on_hold', (f) => f.db.prepare("INSERT INTO ai_topup_purchases(payment_intent_id,order_ref,user_id,price_id,credit_microusd,expected_total_cents,currency,pack_uid,dispute_state,created_at,credited_at) VALUES('pi_disputed','MRD-dispute',2,?,1,1,'usd','pack25','open',datetime('now','-30 days'),datetime('now','-30 days'))").run(PACK), ONE, {}],
    ['token_packs_on_hold', (f) => f.db.prepare("INSERT INTO ai_credit_ledger(user_id,kind,delta_microusd,source_ref,shortfall_microusd,actor,created_at) VALUES(2,'refund',0,'rf:ch_1:1',1000,'test',datetime('now','-89 days'))").run(), ONE, {}],
  ];
  for (const [code, seed, items, extra, opts] of cases) {
    const f = await shop(opts ?? {}); const s = stripeStub();
    try {
      seed(f);
      const r = await intent(f, items, extra);
      assert.deepEqual([r.status, r.body], [400, { error: code }], `${code} ${JSON.stringify([items, extra, opts])}`);
      assert.deepEqual(s.calls, [], `${code}: no Stripe call`);
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0, `${code}: no order, so no free path`);
      await assertInvariant(f);
    } finally { s.restore(); f.db.close(); }
  }
  // The edges, the other way: each is allowed and reaches Stripe once for a PaymentIntent.
  const allowed: [string, (f: any) => void][] = [
    ['a shortfall 91 days ago', (f) => f.db.prepare("INSERT INTO ai_credit_ledger(user_id,kind,delta_microusd,source_ref,shortfall_microusd,actor,created_at) VALUES(2,'refund',0,'rf:ch_1:1',1000,'test',datetime('now','-91 days'))").run()],
    ['a won dispute', (f) => f.db.prepare("INSERT INTO ai_topup_purchases(payment_intent_id,order_ref,user_id,price_id,credit_microusd,expected_total_cents,currency,pack_uid,dispute_state,created_at,credited_at) VALUES('pi_won','MRD-won',2,?,1,1,'usd','pack25','won',datetime('now','-30 days'),datetime('now','-30 days'))").run(PACK)],
    ['four orders today and one 25 hours ago', (f) => { for (let i = 0; i < 5; i++) f.db.prepare("INSERT INTO ai_topup_purchases(payment_intent_id,order_ref,user_id,price_id,credit_microusd,expected_total_cents,currency,pack_uid,created_at) VALUES(?,?,2,?,1,1,'usd','pack25',datetime('now',?))").run(`pi_day${i}`, `MRD-day${i}`, PACK, i === 0 ? '-25 hours' : '-1 hours'); }],
    ['exactly at the ceiling', (f) => { const b = 1_000_000_000 - 27_500_000; f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,?)').run(b); f.db.prepare("INSERT INTO ai_credit_ledger(user_id,kind,delta_microusd,source_ref,actor) VALUES(2,'purchase',?,'pi:pi_big','test')").run(b); }],
  ];
  for (const [name, seed] of allowed) {
    const f = await shop(); const s = stripeStub();
    try {
      seed(f);
      const r = await intent(f, ONE);
      assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.total, 2500); assert.equal(r.body.discount_cents, 0);
      assert.equal(s.calls.filter((c) => c === 'POST https://api.stripe.com/v1/payment_intents').length, 1, name);
    } finally { s.restore(); f.db.close(); }
  }
});

test('one payment delivered twice credits the pack and its bonus once, with one notice', async () => {
  const f = await shop(); const s = stripeStub();
  try {
    const r = await intent(f, ONE, { billing_country: 'AE' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.subtotal, r.body.discount_cents, r.body.vat_cents, r.body.total], [2500, 0, 125, 2625]);
    assert.deepEqual({ ...f.db.prepare('SELECT price_id,pack_uid,credit_microusd,bonus_microusd,expected_total_cents,credited_at FROM ai_topup_purchases').get() },
      { price_id: PACK, pack_uid: 'pack25', credit_microusd: 25000000, bonus_microusd: 2500000, expected_total_cents: 2625, credited_at: null }, 'VAT is never part of the tokens');
    assert.equal(ledgerCount(f), 0, 'placing the order credits nothing');
    const pi = { id: r.body.payment_intent_id, status: 'succeeded', currency: 'usd', amount_received: 2625, metadata: { kind: 'cart_order', order_ref: r.body.order_ref, user_id: '2' } };
    for (let i = 0; i < 2; i++) assert.equal((await webhook(f, pi)).status, 200);
    assert.deepEqual(rows(f.db, 'SELECT kind,delta_microusd,source_ref,pack_uid FROM ai_credit_ledger ORDER BY rowid'), [
      { kind: 'purchase', delta_microusd: 25000000, source_ref: `pi:${pi.id}`, pack_uid: 'pack25' },
      { kind: 'bonus', delta_microusd: 2500000, source_ref: `pi:${pi.id}`, pack_uid: 'pack25' },
    ]);
    assert.equal(f.db.prepare('SELECT balance_microusd AS b FROM ai_topup_accounts WHERE user_id=2').get().b, 27500000);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ai_topup_ledger').get().n, 0, 'no ai_topup_ledger row');
    const notices = rows(f.db, "SELECT user_id,title,link FROM notifications_inbox WHERE type='ai_tokens_added'");
    assert.deepEqual(notices, [{ user_id: 2, title: 'Tokens added: $27.50', link: '/account/usage#top-ups' }]);
    const log = rows(f.db, "SELECT details FROM activity_logs WHERE action='ai_topup_credited'");
    assert.equal(log.length, 1);
    assert.deepEqual(JSON.parse(log[0].details), { payment_intent_id: pi.id, order_ref: r.body.order_ref, credit_microusd: 25000000, bonus_microusd: 2500000, pack_uid: 'pack25' });
    // The pack line grants no licence; fulfilment still marks the order paid.
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM user_products').get().n, 0);
    assert.equal(f.db.prepare('SELECT status FROM orders').get().status, 'paid');
    await assertInvariant(f);
  } finally { s.restore(); f.db.close(); }
});

test('the webhook checks stay: wrong amount, order, user or no secret credits nothing', async () => {
  const f = await shop(); const s = stripeStub();
  try {
    const r = await intent(f, ONE);
    const pi = { id: r.body.payment_intent_id, status: 'succeeded', currency: 'usd', amount_received: 2500, metadata: { kind: 'cart_order', order_ref: r.body.order_ref, user_id: '2' } };
    for (const altered of [{ amount_received: 2499 }, { metadata: { ...pi.metadata, order_ref: 'MRD-other' } }, { metadata: { ...pi.metadata, user_id: '3' } }, { status: 'processing' }, { currency: 'eur' }])
      await assert.rejects(() => creditAiTopupFromPayment(f.env, { ...pi, ...altered }), /match/, JSON.stringify(altered));
    const secret = f.env.STRIPE_WEBHOOK_SECRET; delete f.env.STRIPE_WEBHOOK_SECRET;
    await assert.rejects(() => creditAiTopupFromPayment(f.env, pi), /not configured/);
    f.env.STRIPE_WEBHOOK_SECRET = secret;
    assert.equal(ledgerCount(f), 0);
    assert.equal(f.db.prepare('SELECT credited_at FROM ai_topup_purchases').get().credited_at, null);
    assert.equal(await creditAiTopupFromPayment(f.env, pi), true, 'the right payment still credits');
    await assertInvariant(f);
    // A purchase the old Worker already credited: a late delivery writes neither its purchase nor its bonus.
    f.db.exec(`INSERT INTO ai_topup_purchases(payment_intent_id,order_ref,user_id,price_id,credit_microusd,expected_total_cents,currency,pack_uid,bonus_microusd,credited_at)
        VALUES('pi_oldworker','MRD-old',2,'${PACK}',25000000,2500,'usd','pack25',2500000,datetime('now'));
      INSERT INTO ai_topup_ledger(uid,user_id,kind,amount_microusd,payment_intent_id,actor) VALUES('led_old',2,'credit',25000000,'pi_oldworker','payment_webhook');
      UPDATE ai_topup_accounts SET balance_microusd=balance_microusd+25000000 WHERE user_id=2;`);
    const before = ledgerCount(f);
    assert.equal(await creditAiTopupFromPayment(f.env, { id: 'pi_oldworker', status: 'succeeded', currency: 'usd', amount_received: 2500, metadata: { kind: 'cart_order', order_ref: 'MRD-old', user_id: '2' } }), false);
    assert.equal(ledgerCount(f), before);
    await assertInvariant(f);
  } finally { s.restore(); f.db.close(); }
});

test('no other path credits: /orders/confirm, fulfilOrder and the free path write no ledger row', async () => {
  const f = await shop(); const s = stripeStub();
  try {
    const r = await intent(f, ONE);
    stubbedPi.set(r.body.payment_intent_id, { kind: 'cart_order', order_ref: r.body.order_ref, user_id: '2' });
    const confirm = await ordersRoute.request('/confirm', { method: 'POST', headers: await auth(f), body: JSON.stringify({ payment_intent_id: r.body.payment_intent_id }) }, f.env);
    assert.ok(confirm.status < 500, await confirm.clone().text());
    await fulfilOrder(f.env, r.body.order_ref);
    assert.equal(ledgerCount(f), 0);
    assert.equal(f.db.prepare('SELECT balance_microusd AS b FROM ai_topup_accounts WHERE user_id=2').get()?.b ?? 0, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM user_products').get().n, 0, 'a pack line grants no user_products row');
    // An ordinary line still grants its row, through the paid and the free path alike.
    const free = await intent(f, [{ price_id: OTHER, quantity: 1 }], { promo_code: 'FREE100' });
    assert.equal(free.body.free, true, JSON.stringify(free.body));
    assert.deepEqual(rows(f.db, 'SELECT price_id FROM user_products'), [{ price_id: OTHER }]);
    assert.equal(ledgerCount(f), 0, 'the free path writes no ledger row');
    await assertInvariant(f);
  } finally { s.restore(); f.db.close(); }
});

test('every direct payment route refuses a pack price and the fallback, before any Stripe call', async () => {
  const f = await shop({ env: { STRIPE_PRICE_AI_TOPUP: FALLBACK } }); const s = stripeStub();
  try {
    const headers = await auth(f);
    for (const priceId of [PACK, FALLBACK]) {
      const calls: [any, string, Record<string, unknown>][] = [
        [paymentsRoute, '/intent', { price_id: priceId }],
        [paymentsRoute, '/alacarte/intent', { price_id: priceId }],
        [paymentsRoute, '/promo/validate', { code: 'FREE100', price_id: priceId }],
        [billingRoute, '/subscription/swap/preview', { subscription_id: 'sub_1', price_id: priceId }],
        [billingRoute, '/subscription/swap/confirm', { subscription_id: 'sub_1', price_id: priceId }],
      ];
      for (const [route, path, body] of calls) {
        const r = await route.request(path, { method: 'POST', headers, body: JSON.stringify(body) }, f.env);
        assert.deepEqual([r.status, await r.json()], [400, { error: 'token_pack_checkout_only' }], `${path} ${priceId}`);
      }
    }
    // An archived pack's price is still refused, and the order intent refuses it too.
    f.db.prepare("UPDATE ai_token_packs SET on_sale=0, archived_at=datetime('now')").run();
    assert.equal(await isTokenPackPrice(f.env, PACK), true); assert.equal(await tokenPackForPrice(f.env, PACK), null);
    assert.deepEqual(s.calls, []);
    // A promo never applies to a pack's product or the fallback's.
    for (const productId of ['prod_pack25', 'prod_env']) {
      assert.equal(await isTokenPackProduct(f.env, productId), true);
      assert.deepEqual(await validatePromoForProduct(f.env, 'FREE100', productId, 2500, 'usd'), { ok: false, reason: 'product_not_eligible' });
    }
    assert.equal(await isTokenPackProduct(f.env, 'prod_other'), false);
    assert.equal((await validatePromoForProduct(f.env, 'FREE100', 'prod_other', 1000, 'usd')).ok, true);
    // An ordinary price still passes the pack check.
    assert.equal(await isTokenPackPrice(f.env, OTHER), false);
  } finally { s.restore(); f.db.close(); }
});

test('with only STRIPE_PRICE_AI_TOPUP set, a member buys it alone, at face value, with no bonus', async () => {
  const f = await shop({ pack: false, env: { STRIPE_PRICE_AI_TOPUP: FALLBACK } }); const s = stripeStub();
  try {
    assert.deepEqual(await tokenPackForPrice(f.env, FALLBACK), { origin: 'environment', packUid: null, priceId: FALLBACK, productId: null, faceCents: null, bonusMicrousd: 0, onSale: true });
    assert.deepEqual(await intent(f, [{ price_id: FALLBACK, quantity: 2 }]).then((r) => r.body), { error: 'token_pack_alone' });
    assert.deepEqual(await intent(f, [{ price_id: FALLBACK, quantity: 1 }], { promo_code: 'FREE100' }).then((r) => r.body), { error: 'promo_not_for_token_packs' });
    const r = await intent(f, [{ price_id: FALLBACK, quantity: 1 }]);
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.total, 1500);
    const pi = { id: r.body.payment_intent_id, status: 'succeeded', currency: 'usd', amount_received: 1500, metadata: { kind: 'cart_order', order_ref: r.body.order_ref, user_id: '2' } };
    assert.equal((await webhook(f, pi)).status, 200);
    assert.deepEqual(rows(f.db, 'SELECT kind,delta_microusd,pack_uid FROM ai_credit_ledger'), [{ kind: 'purchase', delta_microusd: 15000000, pack_uid: null }]);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM user_products').get().n, 0);
    await assertInvariant(f);
  } finally { s.restore(); f.db.close(); }
});

test('the PR 2 files are D755 files too', () => {
  const markup = ['1', '.25'].join(''), word = ['mark', 'up'].join('');
  const perk = ['perk', 'credit', 'ledger'].join('_'), intro = ['intro', 'credit', 'ledger'].join('_');
  const text = readFileSync(new URL('../src/services/aiTopups.ts', import.meta.url), 'utf8').toLowerCase();
  for (const needle of [markup, word, perk, intro]) assert.equal(text.includes(needle), false, `aiTopups.ts contains ${needle}`);
});

test('packOnSale judges the mirrored price against face_cents; a missing pack store is no pack, any other failed read throws', async () => {
  for (const [mirrored, onSale, want] of [[2500, 1, true], [3000, 1, false], [2500, 0, false]] as const) {
    const f = await shop({ mirrored, onSale }); const s = stripeStub();
    try {
      const pack = await tokenPackForPrice(f.env, PACK); if (!pack) throw Error('pack');
      assert.equal(await packOnSale(f.env, pack), want, `${mirrored} ${onSale}`);
      assert.deepEqual(s.calls, []);
    } finally { s.restore(); f.db.close(); }
  }
  const { DB, db } = makeD1(AI_USERS_SCHEMA);
  try {
    assert.equal(await isTokenPackPrice({ DB } as any, PACK), false, 'no table: no pack can exist');
    assert.equal(await isTokenPackPrice({ DB, STRIPE_PRICE_AI_TOPUP: FALLBACK } as any, FALLBACK), true, 'the fallback is still a pack');
  } finally { db.close(); }
  const broken = { DB: { prepare: () => { throw new Error('D1_ERROR: network connection lost'); } } } as any;
  await assert.rejects(() => isTokenPackPrice(broken, PACK), /network connection lost/);
  await assert.rejects(() => isTokenPackProduct(broken, 'prod_pack25'), /network connection lost/);
});
