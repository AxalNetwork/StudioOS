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
