/**
 * D4373 (#4373) — HQ refunds a deck generation run.
 *
 *   1. Every settled charge of the batch goes back to the founder's AI tokens:
 *      one ledger row and one audit row per charge, never more than the hold
 *      settled.
 *   2. A second press (and a concurrent twin) refunds nothing again.
 *   3. A member, or a founder, gets 403; a plain HQ admin may.
 *   4. A batch with nothing settled refunds 0 and says so.
 *   5. A reason is required; an unknown batch is 404.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_batch_refund_4373.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { D1GenRuntime, type PlanLine } from '../src/services/decks/genRuntime.ts';
import { settleAiReservation } from '../src/services/aiBudget.ts';
import { ledgerBalance, recordAdjustment } from '../src/services/aiCredits.ts';
import { refundBatch } from '../src/services/decks/batchRefund.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import budgetRoute from '../src/routes/ai_budget.ts';

const M = (n: string) => readFileSync(`cloudflare-worker/sql/migrations/${n}`, 'utf8');
const SUPER = 1, FOUNDER = 7, PLAIN_ADMIN = 101, P = 5;
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const REASON = 'The one-click build failed on our side';

function world() {
  const f = aiBudgetFixture();
  f.db.exec(['525_ai_reservation_idempotency.sql', '632_ai_hold_context.sql'].map(M).join('\n'));
  f.db.exec('CREATE TABLE IF NOT EXISTS pitch_decks (id INTEGER PRIMARY KEY, project_id INTEGER, version INTEGER, slides TEXT, title TEXT, is_current INTEGER)');
  f.db.exec(`INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (50, ${P}, 1, '[]', 'A', 1), (51, ${P + 1}, 1, '[]', 'B', 1)`);
  f.db.exec(M('716_deck_area_batches.sql'));
  f.db.exec(M('752_deck_area_batches_seen.sql'));
  f.db.exec(M('202611022120_deck_batch_runtime.sql'));
  setFixtureAllowance(f.db, 0);
  f.db.prepare("INSERT INTO users(id,email,name,role,is_super_admin) VALUES(?,?,?,?,0)").run(PLAIN_ADMIN, 'plain@example.test', 'Plain Admin', 'admin');
  f.db.prepare('INSERT INTO ai_topup_accounts(user_id, balance_microusd) VALUES (?, ?)').run(FOUNDER, 50_000_000);
  const env = { DB: f.DB, JWT_SECRET: 'd4373-refund-fixture-only-secret', ENVIRONMENT: 'development' } as any;
  return { ...f, env };
}
const lines = (n: number): PlanLine[] => Array.from({ length: n }, (_, i) => ({ card_uid: `c${i}`, area_id: `a${i}`, element: 'body', kind: 'text', task: 'rail_write', model: MODEL, quote_microusd: 1000 }));
const balance = (f: any) => (f.db.prepare('SELECT balance_microusd AS n FROM ai_topup_accounts WHERE user_id = ?').get(FOUNDER) as any).n;

/** A run that ran and settled: step 0 charged 400, step 1 charged 300, step 2 failed and charged nothing. */
async function settledRun(f: any, deckId = 50, idem = 'refund-run-1', settle = true) {
  const rt = new D1GenRuntime({ DB: f.DB } as any, async () => ({ ok: true, charged_microusd: 0 }));
  const a = await rt.admit({ deckId, projectId: P, userId: FOUNDER, cls: 'deck_build', idemKey: idem, lines: lines(3) });
  assert.equal(a.ok, true, JSON.stringify(a));
  if (!a.ok) throw new Error('not admitted');
  f.db.prepare("UPDATE deck_area_batch_steps SET state = 'done', charged_microusd = 400 WHERE batch_uid = ?1 AND seq = 0").run(a.uid);
  f.db.prepare("UPDATE deck_area_batch_steps SET state = 'done', charged_microusd = 300 WHERE batch_uid = ?1 AND seq = 1").run(a.uid);
  f.db.prepare("UPDATE deck_area_batch_steps SET state = 'failed', charged_microusd = 0 WHERE batch_uid = ?1 AND seq = 2").run(a.uid);
  if (settle) {
    await settleAiReservation({ DB: f.DB } as any, { uid: a.reservation_uid!, userId: FOUNDER }, 700, false);
    f.db.prepare("UPDATE deck_area_batches SET state = 'failed', charged_microusd = 700, settled_at = datetime('now') WHERE uid = ?1").run(a.uid);
  }
  return { uid: a.uid, reservation: a.reservation_uid! };
}

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error' }, 500);
  });
  a.route('/api/ai-budget', budgetRoute);
  return a;
}
async function call(f: any, uid: string, user: number, body: unknown = { reason: REASON }) {
  const jwt = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(f.env.JWT_SECRET));
  const r = await app().request(`/api/ai-budget/deck-batches/${uid}/refund`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, f.env);
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const refunds = (f: any, uid: string) => f.db.prepare("SELECT delta_microusd, reason, actor FROM ai_credit_ledger WHERE kind = 'adjustment' AND source_ref LIKE ? ORDER BY source_ref").all(`adj:deck-refund:${uid}:%`) as any[];
const audits = (f: any) => !f.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'admin_audit_log'").get() ? [] : f.db.prepare("SELECT admin_user_id, viewed_user_id, filters_json FROM admin_audit_log WHERE action = 'deck_batch_refund' ORDER BY id").all() as any[];

test('1. every settled charge goes back to the founder\'s AI tokens, one ledger and one audit row each', async () => {
  // Mutation checked: the steps read without `charged_microusd > 0` → a third, zero row is attempted and the ledger CHECK aborts the press.
  const f = world();
  try {
    const r = await settledRun(f);
    const before = balance(f), ledgerBefore = await ledgerBalance(f.env, FOUNDER);
    const res = await call(f, r.uid, SUPER);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.refunded_count, res.body.refunded_microusd, res.body.already_refunded_count, res.body.nothing_settled, res.body.member_id],
      [2, 700, 0, false, FOUNDER]);
    assert.deepEqual(res.body.charges.map((c: any) => [c.seq, c.refunded_microusd, c.outcome]), [[0, 400, 'refunded'], [1, 300, 'refunded']]);
    assert.equal(balance(f) - before, 700);
    assert.equal(await ledgerBalance(f.env, FOUNDER) - ledgerBefore, 700, 'the ledger moved with the balance');
    const rows = refunds(f, r.uid);
    assert.deepEqual(rows.map((x) => x.delta_microusd), [400, 300]);
    assert.ok(rows.every((x) => x.reason.includes(REASON) && x.reason.includes(r.uid) && x.actor === String(SUPER)));
    const a = audits(f);
    assert.equal(a.length, 2, 'one audit row per refunded charge');
    assert.deepEqual(a.map((x) => [x.admin_user_id, x.viewed_user_id, JSON.parse(x.filters_json).seq]), [[SUPER, FOUNDER, 0], [SUPER, FOUNDER, 1]]);
  } finally { f.db.close(); }
});

test('2. the refund is idempotent: a second press and a concurrent twin refund nothing again', async () => {
  // Mutation checked: the prior-row read removed → the second press reports its charges `over_settled`, not "refunded before".
  const f = world();
  try {
    const r = await settledRun(f);
    const before = balance(f);
    assert.equal((await call(f, r.uid, SUPER)).status, 200);
    const again = await call(f, r.uid, PLAIN_ADMIN);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual([again.body.refunded_count, again.body.refunded_microusd, again.body.already_refunded_count, again.body.already_refunded_microusd],
      [0, 0, 2, 700]);
    assert.match(again.body.message, /refunded before/);
    assert.equal(balance(f) - before, 700, 'paid back once');
    assert.equal(refunds(f, r.uid).length, 2);
    assert.equal(audits(f).length, 2, 'no audit row for a charge refunded before');
    // Two presses at once on another run: the charges go back once between them.
    const s = await settledRun(f, 51, 'refund-run-2');
    const mid = balance(f);
    const [x, y] = await Promise.all([refundBatch(f.env, { batchUid: s.uid, actorId: SUPER, reason: REASON }), refundBatch(f.env, { batchUid: s.uid, actorId: PLAIN_ADMIN, reason: REASON })]);
    assert.ok(x.ok && y.ok);
    if (x.ok && y.ok) assert.equal(x.refunded_microusd + y.refunded_microusd, 700);
    assert.equal(balance(f) - mid, 700);
  } finally { f.db.close(); }
});

test('3. a non-admin gets 403, the founder included; a plain HQ admin may refund', async () => {
  // Mutation checked: requireHqAdmin replaced by requireAuth → the founder refunds their own run (200).
  const f = world();
  try {
    const r = await settledRun(f);
    for (const user of [FOUNDER, 2]) {
      const res = await call(f, r.uid, user);
      assert.equal(res.status, 403, `user ${user}`);
    }
    assert.equal(refunds(f, r.uid).length, 0, 'nothing refunded by a refused press');
    assert.equal((await call(f, r.uid, PLAIN_ADMIN)).status, 200);
  } finally { f.db.close(); }
});

test('4. a batch with nothing settled refunds 0 and says so', async () => {
  // Mutation checked: the `status === 'settled'` gate removed → the pending run's step charges are refunded though the member paid nothing.
  const f = world();
  try {
    const pending = await settledRun(f, 50, 'refund-pending', false);
    const before = balance(f);
    const p = await call(f, pending.uid, SUPER);
    assert.equal(p.status, 200);
    assert.deepEqual([p.body.refunded_count, p.body.refunded_microusd, p.body.nothing_settled, p.body.hold_status], [0, 0, true, 'pending']);
    assert.match(p.body.message, /Nothing to refund/);
    assert.equal(balance(f), before, 'nothing moved');
    // A run whose hold was released in full.
    await settleAiReservation({ DB: f.DB } as any, { uid: pending.reservation, userId: FOUNDER }, 0, true);
    const released = await call(f, pending.uid, SUPER);
    assert.deepEqual([released.body.refunded_microusd, released.body.nothing_settled, released.body.hold_status], [0, true, 'refunded']);
    assert.match(released.body.message, /released in full/);
    assert.equal(refunds(f, pending.uid).length, 0);
    assert.equal(audits(f).length, 0);
  } finally { f.db.close(); }
});

test('4b. the refunds never add up to more than the hold settled', async () => {
  // Mutation checked: the amount not clamped to what is still refundable → 700 is refunded against a hold that settled 500.
  const f = world();
  try {
    const rt = new D1GenRuntime({ DB: f.DB } as any, async () => ({ ok: true, charged_microusd: 0 }));
    const a = await rt.admit({ deckId: 50, projectId: P, userId: FOUNDER, cls: 'deck_build', idemKey: 'refund-over', lines: lines(2) });
    if (!a.ok) throw new Error('not admitted');
    f.db.prepare("UPDATE deck_area_batch_steps SET state = 'done', charged_microusd = 400 WHERE batch_uid = ?1 AND seq = 0").run(a.uid);
    f.db.prepare("UPDATE deck_area_batch_steps SET state = 'done', charged_microusd = 300 WHERE batch_uid = ?1 AND seq = 1").run(a.uid);
    await settleAiReservation({ DB: f.DB } as any, { uid: a.reservation_uid!, userId: FOUNDER }, 500, false);
    const out = await refundBatch(f.env, { batchUid: a.uid, actorId: SUPER, reason: REASON });
    assert.ok(out.ok);
    if (out.ok) {
      assert.equal(out.refunded_microusd, 500);
      assert.deepEqual(out.charges.map((c) => [c.seq, c.refunded_microusd]), [[0, 400], [1, 100]]);
    }
  } finally { f.db.close(); }
});

test('5. a reason is required, and an unknown batch is 404', async () => {
  // Mutation checked: the reason's length check removed → a press with no reason refunds.
  const f = world();
  try {
    const r = await settledRun(f);
    for (const body of [{}, { reason: 'too short' }, { reason: 'x'.repeat(401) }]) {
      const res = await call(f, r.uid, SUPER, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error, 'reason_required');
    }
    assert.equal(refunds(f, r.uid).length, 0);
    assert.equal((await call(f, '00000000-0000-0000-0000-000000000000', SUPER)).status, 404);
  } finally { f.db.close(); }
});

test('6. a batch refund is not goodwill: the 30-day adjustment window leaves it out', async () => {
  // Mutation checked: the window's `NOT LIKE 'adj:deck-refund:%'` removed → the $250 adjustment after a refund is refused.
  const f = world();
  try {
    const r = await settledRun(f);
    assert.equal((await call(f, r.uid, SUPER)).status, 200);
    const adj = await recordAdjustment(f.env, { userId: FOUNDER, actorId: SUPER, deltaMicrousd: 100_000_000, reason: 'support credit after outage', key: 'key-4373-a1' });
    const adj2 = await recordAdjustment(f.env, { userId: FOUNDER, actorId: SUPER, deltaMicrousd: 100_000_000, reason: 'support credit after outage', key: 'key-4373-a2' });
    const adj3 = await recordAdjustment(f.env, { userId: FOUNDER, actorId: SUPER, deltaMicrousd: 50_000_000, reason: 'support credit after outage', key: 'key-4373-a3' });
    assert.deepEqual([adj.ok, adj2.ok, adj3.ok], [true, true, true], 'the full $250 is still there for goodwill');
  } finally { f.db.close(); }
});

test('the route is behind the recovery cool-off, as an adjustment is', () => {
  const index = readFileSync('cloudflare-worker/src/index.ts', 'utf8');
  assert.match(index, /'\/api\/ai-budget\/deck-batches\/:uid\/refund',/);
});
