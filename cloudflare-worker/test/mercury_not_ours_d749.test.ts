/**
 * D749 (#1838) — "Not ours" for an unmatched Mercury credit: what can be
 * marked, one live match or one live mark per line (the race included),
 * withdraw, a sync that puts a mark in review, who may act, and what
 * `GET /transactions` lists.
 *
 * Every account ending, id and amount here is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_not_ours_d749.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { proposeManual, proposeMatches, type MatchDeps } from '../src/services/mercury/match.ts';
import { markNotOurs, NOT_OURS_REASONS } from '../src/services/mercury/notOurs.ts';
import { upsertTransaction } from '../src/services/mercury/store.ts';
import { ADMIN, FOUNDER, JTI, appFor, call, envFor, freshDb, one, rows } from './_mercury_fixture.ts';

const FUND = 1;
const DEPS: Partial<MatchDeps> = { fundOneId: async () => FUND, feePeriods: async () => [] };
const ADMIN_USER = { id: ADMIN, email: 'user902@example.test', role: 'admin' } as any;

function seed() {
  const db = freshDb();
  db.exec(`INSERT INTO vc_funds (id, name, slug) VALUES (${FUND}, 'Example Fund I', 'spinout-fund-i')`);
  db.exec(`INSERT INTO limited_partners (id, user_id, fund_id, status, name) VALUES (1, 905, ${FUND}, 'active', 'LP One')`);
  db.exec(`INSERT INTO capital_calls (id, uid, limited_partner_id, amount, amount_cents, status, due_date, created_at) VALUES
    (1, 'l1', 1, 1000, 100000, 'pending', '2026-10-01', '2026-09-01 00:00:00')`);
  db.exec("INSERT INTO mercury_entity_connections (id, uid, entity_key, status, credentials_enc, connected_by) VALUES (1, 'c-fund', 'fund', 'active', 'v1.x', 901)");
  db.exec(`INSERT INTO mercury_accounts (id, uid, mercury_account_id, connection_id, entity_key, kind, last_four, registered) VALUES
    (1, '${'a'.repeat(32)}', 'acc-fund', 1, 'fund', 'checking', '1212', 1),
    (2, '${'b'.repeat(32)}', 'acc-unreg', 1, 'fund', 'checking', '5656', 0)`);
  return db;
}
let n = 0;
function line(db: any, account: number, cents: number, extra: { status?: string; kind?: string; posted?: string | null } = {}) {
  n += 1;
  const posted = extra.posted === undefined ? '2026-09-20' : extra.posted;
  db.prepare(`INSERT INTO mercury_transactions (uid, mercury_transaction_id, account_id, amount_cents, created_on, posted_on, status, kind)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(`t${String(n).padStart(31, '0')}`, `tx-${n}`, account, cents, '2026-09-20', posted, extra.status ?? 'sent', extra.kind ?? 'incomingDomesticWire');
  return one(db, 'SELECT * FROM mercury_transactions WHERE mercury_transaction_id = ?', `tx-${n}`);
}
const app = () => appFor({ match: DEPS });
const mark = (env: any, uid: string, body: unknown, as = ADMIN) => call(app(), env, 'POST', `/transactions/${uid}/not-ours`, as, { ...(as === ADMIN ? { jti: JTI.adminTotp } : {}), body });
const withdraw = (env: any, uid: string, body: unknown) => call(app(), env, 'POST', `/not-ours/${uid}/withdraw`, ADMIN, { jti: JTI.adminTotp, body });
const list = async (env: any, match: string) => (await call(app(), env, 'GET', `/transactions?match=${match}`, ADMIN, { jti: JTI.adminTotp })).body;
const audits = (db: any, action: string) => rows(db, 'SELECT filters_json AS details FROM admin_audit_log WHERE action = ?', action);

test('the reasons are decision 4\'s keys, in order', () => {
  assert.deepEqual(NOT_OURS_REASONS.map((r) => r.key), ['not_fund_transaction', 'other_entity', 'duplicate', 'other']);
});

test('an eligible credit is marked: 201, one active row, one audit row with no note in it', async () => {
  const db = seed(); const env = envFor(db);
  const t = line(db, 1, 100000);
  const r = await mark(env, t.uid, { reason: 'duplicate', note: 'Second copy of wire 4471-fixture' });
  assert.equal(r.status, 201, r.text);
  assert.match(r.body.uid, /^[0-9a-f]{32}$/);
  const m = one(db, 'SELECT * FROM mercury_not_ours');
  assert.deepEqual([m.state, m.reason, m.amount_cents, m.marked_by, m.note], ['active', 'duplicate', 100000, ADMIN, 'Second copy of wire 4471-fixture']);
  const a = audits(db, 'mercury_not_ours_marked');
  assert.equal(a.length, 1);
  assert.deepEqual(JSON.parse(a[0].details), { transaction_uid: t.uid, mark_uid: r.body.uid, reason: 'duplicate' });
  assert.doesNotMatch(a[0].details, /Second copy|4471/);
});

test('refused: a debit, an internal transfer, a pending line, an unregistered account, an unknown uid, a bad reason or note, a second mark, a live match', async () => {
  const db = seed(); const env = envFor(db);
  for (const t of [line(db, 1, -5000), line(db, 1, 5000, { kind: 'internalTransfer' }), line(db, 1, 5000, { status: 'pending', posted: null }), line(db, 2, 5000)]) {
    const r = await mark(env, t.uid, { reason: 'duplicate' });
    assert.deepEqual([r.status, r.body.code], [409, 'not_matchable'], t.mercury_transaction_id);
  }
  assert.equal((await mark(env, 'f'.repeat(32), { reason: 'duplicate' })).status, 404);
  const t = line(db, 1, 7000);
  assert.deepEqual((await mark(env, t.uid, {})).body.code, 'invalid_reason');
  assert.deepEqual((await mark(env, t.uid, { reason: 'nope' })).body.code, 'invalid_reason');
  assert.deepEqual((await mark(env, t.uid, { reason: 'other' })).body.code, 'note_required');
  assert.deepEqual((await mark(env, t.uid, { reason: 'other', note: 'too short' })).body.code, 'note_required');
  assert.deepEqual((await mark(env, t.uid, { reason: 'duplicate', note: 'x'.repeat(501) })).body.code, 'note_too_long');
  assert.equal(rows(db, 'SELECT * FROM mercury_not_ours').length, 0, 'no refusal writes a row');
  assert.equal((await mark(env, t.uid, { reason: 'other', note: 'A wire meant for another fund' })).status, 201);
  const again = await mark(env, t.uid, { reason: 'duplicate' });
  assert.deepEqual([again.status, again.body.code], [409, 'already_marked']);
  // A proposed match, then a confirmed one, then a rejected one.
  for (const state of ['proposed', 'confirmed']) {
    const m = line(db, 1, 8000);
    db.exec(`INSERT INTO mercury_matches (uid, transaction_id, target_kind, target_id, state, origin, amount_cents) VALUES ('m-${m.id}', ${m.id}, 'capital_call_line', 1, '${state}', 'manual', 8000)`);
    const r = await mark(env, m.uid, { reason: 'duplicate' });
    assert.deepEqual([r.status, r.body.code], [409, 'has_live_match'], state);
  }
  const rej = line(db, 1, 9000);
  db.exec(`INSERT INTO mercury_matches (uid, transaction_id, target_kind, target_id, state, origin, amount_cents, reason) VALUES ('m-rej', ${rej.id}, 'capital_call_line', 1, 'rejected', 'manual', 9000, 'Not this LP at all')`);
  assert.equal((await mark(env, rej.uid, { reason: 'duplicate' })).status, 201, 'a line whose only match was rejected can be marked');
  assert.equal(audits(db, 'mercury_not_ours_marked').length, 2, 'only the two marks are audited');
});

test('a marked line is never matched: the matcher skips it and a manual pair is 409; after Withdraw both match it again', async () => {
  const db = seed(); const env = envFor(db);
  const t = line(db, 1, 100000);    // fits capital-call line 1 exactly
  const r = await mark(env, t.uid, { reason: 'other_entity' });
  assert.equal(r.status, 201);
  assert.deepEqual(await proposeMatches(env, DEPS), { proposed: 0 });
  const manual = await proposeManual(env, ADMIN_USER, { transaction_uid: t.uid, target_kind: 'capital_call_line', target_id: 1 }, DEPS);
  assert.deepEqual(manual.ok ? null : [manual.status, manual.code], [409, 'marked_not_ours']);
  assert.equal((await withdraw(env, r.body.uid, { reason: 'It was ours after all' })).status, 200);
  assert.deepEqual(await proposeMatches(env, DEPS), { proposed: 1 });
  // A second line, matched by hand after its withdrawn mark.
  const u = line(db, 1, 50000);
  const r2 = await mark(env, u.uid, { reason: 'duplicate' });
  await withdraw(env, r2.body.uid, { reason: 'It was ours after all' });
  const ok = await proposeManual(env, ADMIN_USER, { transaction_uid: u.uid, target_kind: 'capital_call_line', target_id: 1 }, DEPS);
  assert.equal(ok.ok, true);
});

test('the race: a mark and a match on one line, in either order, never both win', async () => {
  // Match first, then mark: the mark's INSERT sees the live match.
  const a = seed(); const envA = envFor(a);
  const t = line(a, 1, 100000);
  assert.deepEqual(await proposeMatches(envA, DEPS), { proposed: 1 });
  const late = await markNotOurs(envA, ADMIN_USER, t.uid, { reason: 'duplicate' });
  assert.deepEqual(late.ok ? null : late.code, 'has_live_match');
  assert.equal(rows(a, 'SELECT * FROM mercury_not_ours').length, 0);
  // Mark first, then match: the matcher's INSERT sees the live mark, even
  // when its candidate read happened before the mark (the INSERT's own check).
  const b = seed(); const envB = envFor(b);
  const u = line(b, 1, 100000);
  const raced = { ...DEPS, fundOneId: async () => { await markNotOurs(envB, ADMIN_USER, u.uid, { reason: 'duplicate' }); return FUND; } };
  assert.deepEqual(await proposeMatches(envB, raced), { proposed: 0 }, 'the mark landed between the candidate read and the INSERT');
  assert.equal(rows(b, 'SELECT * FROM mercury_matches').length, 0);
  assert.equal(rows(b, "SELECT * FROM mercury_not_ours WHERE state = 'active'").length, 1);
});

test('withdraw: a reason is needed; the row stays withdrawn, the line is unmatched again, a second withdraw is 409, and DELETE is refused', async () => {
  const db = seed(); const env = envFor(db);
  const t = line(db, 1, 100000);
  const uid = (await mark(env, t.uid, { reason: 'duplicate' })).body.uid;
  assert.deepEqual((await list(env, 'none')).items.map((i: any) => i.uid), []);
  assert.deepEqual((await withdraw(env, uid, {})).body.code, 'reason_required');
  assert.deepEqual((await withdraw(env, uid, { reason: 'short' })).body.code, 'reason_required');
  assert.equal((await withdraw(env, 'f'.repeat(32), { reason: 'Wrong line entirely' })).status, 404);
  const ok = await withdraw(env, uid, { reason: 'Wrong line entirely' });
  assert.equal(ok.status, 200, ok.text);
  const m = one(db, 'SELECT * FROM mercury_not_ours');
  assert.deepEqual([m.state, m.withdrawn_by, m.withdraw_reason], ['withdrawn', ADMIN, 'Wrong line entirely']);
  assert.ok(m.withdrawn_at);
  assert.deepEqual(JSON.parse(audits(db, 'mercury_not_ours_withdrawn')[0].details), { mark_uid: uid });
  assert.deepEqual((await list(env, 'none')).items.map((i: any) => i.uid), [t.uid]);
  assert.deepEqual((await withdraw(env, uid, { reason: 'Wrong line entirely' })).body.code, 'mark_withdrawn');
  assert.throws(() => db.exec('DELETE FROM mercury_not_ours'), /append-only \(D749\)/);
  // A withdrawn line can be marked again.
  assert.equal((await mark(env, t.uid, { reason: 'other_entity' })).status, 201);
});

test('a sync that changes a marked line turns its mark needs_review, and the line is unmatched again; an unchanged sync leaves it active', async () => {
  for (const change of ['amount', 'cancelled', 'failed', 'unchanged'] as const) {
    const db = seed(); const env = envFor(db);
    const t = line(db, 1, 100000);
    await mark(env, t.uid, { reason: 'duplicate' });
    const parsed = { mercury_transaction_id: t.mercury_transaction_id, amount_cents: change === 'amount' ? 90000 : 100000, created_on: t.created_on,
      posted_on: t.posted_on, counterparty_name: t.counterparty_name, memo: t.memo, status: change === 'cancelled' || change === 'failed' ? change : t.status, kind: t.kind };
    await upsertTransaction(env, { id: 1 }, parsed as any);
    const state = one(db, 'SELECT state FROM mercury_not_ours').state;
    assert.equal(state, change === 'unchanged' ? 'active' : 'needs_review', change);
    const none = (await list(env, 'none')).items.map((i: any) => i.uid);
    assert.deepEqual(none, change === 'unchanged' ? [] : [t.uid], `${change}: back in match=none`);
    if (change !== 'unchanged') {
      // Still blocks a match, and Withdraw is still offered.
      const m = await proposeManual(env, ADMIN_USER, { transaction_uid: t.uid, target_kind: 'capital_call_line', target_id: 1 }, DEPS);
      assert.equal(m.ok ? 'ok' : m.code, change === 'amount' ? 'marked_not_ours' : 'not_matchable');
    }
  }
});

test('who: a plain Admin marks; a non-admin, a support session and a branch Worker are refused and write nothing', async () => {
  const db = seed(); const env = envFor(db);
  const t = line(db, 1, 100000);
  assert.equal((await mark(env, t.uid, { reason: 'duplicate' }, FOUNDER)).status, 403);
  const support = await call(app(), env, 'POST', `/transactions/${t.uid}/not-ours`, ADMIN, { jti: JTI.adminTotp, impersonated: true, body: { reason: 'duplicate' } });
  assert.equal(support.status, 403);
  const branch = await call(app(), envFor(db, { BRANCH_CODE: 'ldn' }), 'POST', `/transactions/${t.uid}/not-ours`, ADMIN, { jti: JTI.adminTotp, body: { reason: 'duplicate' } });
  assert.equal(branch.status, 403);
  assert.equal(rows(db, 'SELECT * FROM mercury_not_ours').length, 0);
  const uid = (await mark(env, t.uid, { reason: 'duplicate' })).body.uid;
  const w = await call(app(), env, 'POST', `/not-ours/${uid}/withdraw`, FOUNDER, { body: { reason: 'Wrong line entirely' } });
  assert.equal(w.status, 403);
  assert.equal(one(db, 'SELECT state FROM mercury_not_ours').state, 'active');
});

test('GET /transactions: match=none leaves an active mark out, match=not_ours lists active and needs_review marks, each item carries not_ours', async () => {
  const db = seed(); const env = envFor(db);
  const plain = line(db, 1, 1000);
  const active = line(db, 1, 2000);
  const review = line(db, 1, 3000);
  const gone = line(db, 1, 4000);
  await mark(env, active.uid, { reason: 'duplicate', note: 'Copy of an earlier wire' });
  await mark(env, review.uid, { reason: 'other_entity' });
  db.exec(`UPDATE mercury_not_ours SET state = 'needs_review' WHERE transaction_id = ${review.id}`);
  const g = (await mark(env, gone.uid, { reason: 'duplicate' })).body.uid;
  await withdraw(env, g, { reason: 'Wrong line entirely' });
  const none = await list(env, 'none');
  assert.deepEqual(none.items.map((i: any) => i.uid).sort(), [plain.uid, review.uid, gone.uid].sort());
  assert.equal(none.total, 3);
  const marked = await list(env, 'not_ours');
  assert.deepEqual(marked.items.map((i: any) => i.uid).sort(), [active.uid, review.uid].sort());
  const a = marked.items.find((i: any) => i.uid === active.uid);
  assert.deepEqual({ ...a.not_ours, uid: 'x', marked_at: 'x' }, { uid: 'x', reason: 'duplicate', note: 'Copy of an earlier wire', state: 'active', marked_at: 'x' });
  assert.equal(none.items.find((i: any) => i.uid === plain.uid).not_ours, null);
  assert.equal(none.items.find((i: any) => i.uid === gone.uid).not_ours, null, 'a withdrawn mark is not carried');
  assert.equal((await call(app(), env, 'GET', '/transactions?match=bogus', ADMIN, { jti: JTI.adminTotp })).status, 400);
});

test('the routes move no money and the act table names them', () => {
  const src = readFileSync(resolve('cloudflare-worker/src/routes/admin_mercury.ts'), 'utf8');
  for (const path of ["'/transactions/:uid/not-ours'", "'/not-ours/:uid/withdraw'"]) {
    assert.ok(src.includes(`r.post(${path}`), path);
    assert.doesNotMatch(path, /send|transfer|pay|payout|wire/);
  }
  const acts = readFileSync(resolve('cloudflare-worker/src/services/fundAdminAccess.ts'), 'utf8');
  assert.ok(acts.includes("'POST /api/admin/mercury/transactions/:uid/not-ours'") && acts.includes("'POST /api/admin/mercury/not-ours/:uid/withdraw'"));
});
