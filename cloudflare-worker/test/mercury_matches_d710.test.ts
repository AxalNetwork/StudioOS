/**
 * D710 (#1775) decisions 9 and 10 — reconciliation proposes, a person confirms.
 *
 * Fund I and #1774's fee periods are not on `main` yet (#1773's `fundPayeeOf`,
 * #1774's periods), so production's defaults propose neither kind; the first
 * test pins that. The rest drive the matcher's rules through the same
 * dependencies, with a fixture fund and fixture periods.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_matches_d710.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectedFor, proposeMatches, type FeePeriod, type MatchDeps } from '../src/services/mercury/match.ts';
import { upsertTransaction } from '../src/services/mercury/store.ts';
import { ADMIN, JTI, appFor, call, envFor, freshDb, one, rows } from './_mercury_fixture.ts';

const FUND = 1;
const PERIODS: FeePeriod[] = [
  { id: 41, fund_id: FUND, status: 'issued', net_total_cents: 250_000, window_start: '2026-07-01', window_end: '2026-09-30' },
  { id: 42, fund_id: FUND, status: 'draft', net_total_cents: 999_000, window_start: '2026-07-01', window_end: '2026-09-30' },
];
const DEPS: Partial<MatchDeps> = { fundOneId: async () => FUND, feePeriods: async () => PERIODS };

function seed() {
  const db = freshDb();
  db.exec(`INSERT INTO vc_funds (id, name, slug) VALUES (${FUND}, 'Example Fund I', 'spinout-fund-i'), (2, 'Other Fund', 'other')`);
  db.exec(`INSERT INTO limited_partners (id, user_id, fund_id, status, name) VALUES (1, 905, ${FUND}, 'active', 'LP One'), (2, 905, ${FUND}, 'active', 'LP Two'), (3, 905, 2, 'active', 'LP Elsewhere')`);
  db.exec(`INSERT INTO fund_capital_calls (id, uid, fund_id, call_number, amount_cents, due_date, line_count, created_at)
           VALUES (1, 'fc1', ${FUND}, 1, 300000, '2026-10-01', 2, '2026-09-01 00:00:00')`);
  // Line 1 owes $1,000; line 2 owes $2,000 and has no header (its own date); line 3 is another fund's.
  db.exec(`INSERT INTO capital_calls (id, uid, limited_partner_id, amount, amount_cents, status, due_date, fund_call_id, created_at) VALUES
    (1, 'l1', 1, 1000, 100000, 'pending', '2026-10-01', 1, '2026-09-01 00:00:00'),
    (2, 'l2', 2, 2000, 200000, 'pending', NULL, NULL, '2026-09-10 00:00:00'),
    (3, 'l3', 3, 1000, 100000, 'pending', '2026-10-01', NULL, '2026-09-01 00:00:00')`);
  for (const [id, entity] of [[1, 'fund'], [2, 'gp'], [3, 'management']] as const) {
    db.exec(`INSERT INTO mercury_entity_connections (id, uid, entity_key, status, credentials_enc, connected_by) VALUES (${id}, 'c-${entity}', '${entity}', 'active', 'v1.x', 901)`);
  }
  db.exec(`INSERT INTO mercury_accounts (id, uid, mercury_account_id, connection_id, entity_key, kind, last_four, registered) VALUES
    (1, '${'a'.repeat(32)}', 'acc-fund', 1, 'fund', 'checking', '1212', 1),
    (2, '${'b'.repeat(32)}', 'acc-gp', 2, 'gp', 'checking', '3434', 1),
    (3, '${'c'.repeat(32)}', 'acc-gp-unreg', 2, 'gp', 'checking', '5656', 0),
    (4, '${'d'.repeat(32)}', 'acc-mgmt', 3, 'management', 'checking', '7878', 1)`);
  return db;
}
let n = 0;
function credit(db: any, account: number, cents: number, posted: string | null, extra: { kind?: string; status?: string } = {}) {
  n += 1;
  db.prepare(`INSERT INTO mercury_transactions (uid, mercury_transaction_id, account_id, amount_cents, created_on, posted_on, status, kind)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(`t${String(n).padStart(31, '0')}`, `tx-${n}`, account, cents, posted, posted, extra.status ?? 'sent', extra.kind ?? 'incomingDomesticWire');
  return one(db, 'SELECT * FROM mercury_transactions WHERE mercury_transaction_id = ?', `tx-${n}`);
}
const matches = (db: any) => rows(db, 'SELECT target_kind, target_id, state, origin FROM mercury_matches ORDER BY id').map((r) => ({ ...r }));

test('today: with Fund I and fee periods not on main, nothing is proposed', async () => {
  const db = seed();
  credit(db, 1, 100000, '2026-09-20');
  credit(db, 2, 250000, '2026-10-05');
  assert.deepEqual(await proposeMatches(envFor(db)), { proposed: 0 });
  assert.equal(matches(db).length, 0);
});

test('the matcher: one open line\'s outstanding on the Fund\'s account is proposed; two equal lines propose nothing; the windows hold', async () => {
  const db = seed();
  credit(db, 1, 100000, '2026-09-20');
  credit(db, 1, 200000, '2026-12-08', {});   // line 2: no due date, issue 2026-09-10 + 90 days = 2026-12-09
  credit(db, 1, 200000, '2026-12-10');       // a day outside line 2's window
  assert.deepEqual(await proposeMatches(envFor(db), DEPS), { proposed: 2 });
  assert.deepEqual(matches(db), [
    { target_kind: 'capital_call_line', target_id: 1, state: 'proposed', origin: 'matcher' },
    { target_kind: 'capital_call_line', target_id: 2, state: 'proposed', origin: 'matcher' },
  ]);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM capital_call_receipts').n, 0, 'the matcher writes no receipt');
  // Two lines owing the same: nothing.
  const two = seed();
  two.exec("UPDATE capital_calls SET amount_cents = 100000, amount = 1000, due_date = '2026-10-01' WHERE id = 2");
  credit(two, 1, 100000, '2026-09-25');
  assert.deepEqual(await proposeMatches(envFor(two), DEPS), { proposed: 0 });
});

test('a GP- or Management-account credit never matches a line; an internal transfer, a pending line or an unregistered account never matches', async () => {
  const db = seed();
  credit(db, 2, 100000, '2026-09-20');                                  // GP account, a line's amount
  credit(db, 4, 200000, '2026-09-21');                                  // Management account, line 2's amount (decision 10)
  credit(db, 1, 100000, '2026-09-21', { kind: 'internalTransfer' });
  credit(db, 1, 100000, null, { status: 'pending' });
  credit(db, 3, 250000, '2026-10-05');                                  // unregistered GP account, a period's total
  assert.deepEqual(await proposeMatches(envFor(db), DEPS), { proposed: 0 });
});

test('manual pairs: the wrong entity, an unregistered account or a rejected pair is 409; a partial wire is accepted', async () => {
  const db = seed();
  const app = appFor({ match: DEPS });
  const env = envFor(db);
  const gpLine = credit(db, 2, 50000, '2026-09-20');
  const fundLine = credit(db, 1, 50000, '2026-09-20');
  const unreg = credit(db, 3, 250000, '2026-10-05');
  const post = (body: any) => call(app, env, 'POST', '/matches', ADMIN, { jti: JTI.adminTotp, body });
  assert.deepEqual([(await post({ transaction_uid: gpLine.uid, target_kind: 'capital_call_line', target_id: 1 })).body.code], ['wrong_entity']);
  assert.deepEqual([(await post({ transaction_uid: fundLine.uid, target_kind: 'fee_period', target_id: 41 })).body.code], ['wrong_entity']);
  const r3 = await post({ transaction_uid: unreg.uid, target_kind: 'fee_period', target_id: 41 });
  assert.deepEqual([r3.status, r3.body.code], [409, 'not_matchable']);
  assert.equal((await post({ transaction_uid: fundLine.uid, target_kind: 'capital_call_line', target_id: 3 })).status, 404, 'another fund\'s line');
  const partial = await post({ transaction_uid: fundLine.uid, target_kind: 'capital_call_line', target_id: 1 });
  assert.equal(partial.status, 201, partial.text);
  const reject = await call(app, env, 'POST', `/matches/${partial.body.uid}/reject`, ADMIN, { jti: JTI.adminTotp, body: { reason: 'Not this LP’s wire' } });
  assert.equal(reject.status, 200);
  const again = await post({ transaction_uid: fundLine.uid, target_kind: 'capital_call_line', target_id: 1 });
  assert.deepEqual([again.status, again.body.code], [409, 'pair_rejected']);
  // Without Fund I, no capital-call pair at all.
  const off = await call(appFor(), env, 'POST', '/matches', ADMIN, { jti: JTI.adminTotp, body: { transaction_uid: credit(db, 1, 1000, '2026-09-22').uid, target_kind: 'capital_call_line', target_id: 1 } });
  assert.deepEqual([off.status, off.body.code], [409, 'fund_account_unavailable']);
});

test('confirming a capital-call match writes exactly one receipt; a second confirm and a second insert are refused; a held receipt is linked', async () => {
  const db = seed();
  const app = appFor({ match: DEPS });
  const env = envFor(db);
  const t = credit(db, 1, 100000, '2026-09-20');
  await proposeMatches(env, DEPS);
  const m = one(db, 'SELECT uid FROM mercury_matches');
  const ok = await call(app, env, 'POST', `/matches/${m.uid}/confirm`, ADMIN, { jti: JTI.adminTotp });
  assert.equal(ok.status, 200, ok.text);
  const receipts = rows(db, 'SELECT * FROM capital_call_receipts');
  assert.equal(receipts.length, 1);
  assert.deepEqual([receipts[0].reference, receipts[0].received_on, receipts[0].amount_cents, receipts[0].source, receipts[0].recorded_by],
    [`mercury:${t.mercury_transaction_id}`, '2026-09-20', 100000, 'receipt', ADMIN]);
  assert.equal(one(db, 'SELECT status FROM capital_calls WHERE id = 1').status, 'paid');
  assert.equal(one(db, 'SELECT state FROM mercury_matches').state, 'confirmed');
  const second = await call(app, env, 'POST', `/matches/${m.uid}/confirm`, ADMIN, { jti: JTI.adminTotp });
  assert.equal(second.status, 409);
  assert.equal(rows(db, 'SELECT * FROM capital_call_receipts').length, 1, 'nothing more');
  assert.throws(() => db.exec(`INSERT INTO capital_call_receipts (uid, capital_call_id, limited_partner_id, fund_id, amount_cents, received_on, reference, source, recorded_by)
    VALUES ('dup', 2, 2, 1, 10, '2026-09-21', 'mercury:${t.mercury_transaction_id}', 'receipt', 902)`), /UNIQUE/);
  // A receipt already holds a bank line's reference while its match is still proposed: confirm links it.
  const t2 = credit(db, 1, 200000, '2026-10-01');
  db.exec(`INSERT INTO capital_call_receipts (uid, capital_call_id, limited_partner_id, fund_id, amount_cents, received_on, reference, source, recorded_by)
    VALUES ('held', 2, 2, 1, 200000, '2026-10-01', 'mercury:${t2.mercury_transaction_id}', 'receipt', 902)`);
  db.exec(`INSERT INTO mercury_matches (uid, transaction_id, target_kind, target_id, state, origin, amount_cents) VALUES ('m-held', ${t2.id}, 'capital_call_line', 2, 'proposed', 'matcher', 200000)`);
  const linked = await call(app, env, 'POST', '/matches/m-held/confirm', ADMIN, { jti: JTI.adminTotp });
  assert.equal(linked.status, 200, linked.text);
  assert.equal(rows(db, 'SELECT * FROM capital_call_receipts').length, 2, 'no second receipt for that line');
  assert.equal(one(db, "SELECT receipt_id FROM mercury_matches WHERE uid = 'm-held'").receipt_id, one(db, "SELECT id FROM capital_call_receipts WHERE uid = 'held'").id);
});

test('fee matches: a GP credit equal to an issued period\'s net total is proposed and confirmed; a second live match fails on the index', async () => {
  const db = seed();
  const app = appFor({ match: DEPS });
  const env = envFor(db);
  credit(db, 2, 250000, '2026-10-05');
  credit(db, 2, 999000, '2026-10-05');   // a draft period's total: not proposed
  credit(db, 2, 12_500, '2026-10-05');   // one LP's fee line, no period's total: not proposed
  assert.deepEqual(await proposeMatches(env, DEPS), { proposed: 1 });
  const m = one(db, "SELECT uid FROM mercury_matches WHERE target_kind = 'fee_period'");
  assert.equal((await call(app, env, 'POST', `/matches/${m.uid}/confirm`, ADMIN, { jti: JTI.adminTotp })).status, 200);
  const collected = await collectedFor(env, [41, 42]);
  assert.deepEqual(collected.get(41), { collected_on: '2026-10-05', last_four: '3434' });
  assert.equal(collected.has(42), false);
  const other = credit(db, 2, 250000, '2026-10-06');
  assert.throws(() => db.exec(`INSERT INTO mercury_matches (uid, transaction_id, target_kind, target_id, state, origin, amount_cents)
    VALUES ('m-dup', ${other.id}, 'fee_period', 41, 'proposed', 'manual', 250000)`), /UNIQUE/);
  // Without #1774's periods, a fee confirm is refused.
  db.exec(`INSERT INTO mercury_matches (uid, transaction_id, target_kind, target_id, state, origin, amount_cents) VALUES ('m-off', ${other.id}, 'fee_period', 77, 'proposed', 'manual', 250000)`);
  assert.deepEqual((await call(appFor(), env, 'POST', '/matches/m-off/confirm', ADMIN, { jti: JTI.adminTotp })).body.code, 'fee_periods_unavailable');
});

test('reject needs a reason and is remembered; a line changed after confirm turns needs_review, which confirm refuses', async () => {
  const db = seed();
  const app = appFor({ match: DEPS });
  const env = envFor(db);
  const t = credit(db, 1, 100000, '2026-09-20');
  await proposeMatches(env, DEPS);
  const m = one(db, 'SELECT uid FROM mercury_matches');
  const short = await call(app, env, 'POST', `/matches/${m.uid}/reject`, ADMIN, { jti: JTI.adminTotp, body: { reason: 'no' } });
  assert.deepEqual([short.status, short.body.code], [400, 'reason_required']);
  assert.equal((await call(app, env, 'POST', `/matches/${m.uid}/reject`, ADMIN, { jti: JTI.adminTotp, body: { reason: 'Wrong LP for this wire' } })).status, 200);
  assert.deepEqual(await proposeMatches(env, DEPS), { proposed: 0 }, 'a rejected pair is not proposed again');
  // A confirmed match whose line Mercury later changes.
  const t2 = credit(db, 1, 200000, '2026-10-01');
  await proposeMatches(env, DEPS);
  const m2 = one(db, "SELECT uid FROM mercury_matches WHERE target_id = 2");
  assert.equal((await call(app, env, 'POST', `/matches/${m2.uid}/confirm`, ADMIN, { jti: JTI.adminTotp })).status, 200);
  await upsertTransaction(env, { id: t2.account_id }, { mercury_transaction_id: t2.mercury_transaction_id, amount_cents: 150000, created_on: '2026-10-01',
    posted_on: '2026-10-01', counterparty_name: null, memo: null, status: 'sent', kind: 'incomingDomesticWire' });
  assert.equal(one(db, 'SELECT state FROM mercury_matches WHERE uid = ?', m2.uid).state, 'needs_review');
  assert.equal(rows(db, 'SELECT * FROM capital_call_receipts').length, 1, 'nothing it wrote is undone');
  // A proposed match whose line is cancelled.
  const t3 = credit(db, 2, 250000, '2026-10-05');
  await proposeMatches(env, DEPS);
  const m3 = one(db, "SELECT uid FROM mercury_matches WHERE target_kind = 'fee_period'");
  await upsertTransaction(env, { id: t3.account_id }, { mercury_transaction_id: t3.mercury_transaction_id, amount_cents: 250000, created_on: '2026-10-05',
    posted_on: '2026-10-05', counterparty_name: null, memo: null, status: 'cancelled', kind: 'incomingDomesticWire' });
  const refused = await call(app, env, 'POST', `/matches/${m3.uid}/confirm`, ADMIN, { jti: JTI.adminTotp });
  assert.deepEqual([refused.status, refused.body.code], [409, 'needs_review']);
  assert.equal((await call(app, env, 'POST', `/matches/${m3.uid}/reject`, ADMIN, { jti: JTI.adminTotp, body: { reason: 'Cancelled by the sender' } })).status, 200);
  assert.equal(t.amount_cents, 100000);
  assert.throws(() => db.exec('DELETE FROM mercury_matches'), /append-only/);
});
