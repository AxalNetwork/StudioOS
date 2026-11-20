/**
 * D6862 (#6862, D6021 option B) — named shares of one given Validate decision,
 * on the real migrated schema, through the mounted routes.
 *
 *   1. the migration: the table, its live-share unique index and its checks;
 *   2. candidates: the venture's accepted Operating Partners and related
 *      investors with the licence, never the venture's own or an outsider;
 *   3. grant: the founder only (not an admin, partner, investor or another
 *      founder, not a support session); a Withheld decision is refused; a
 *      person who is not a candidate is refused; a grant is logged under
 *      `validate.verdict` and is idempotent;
 *   4. the recipient's read: exactly the one decision, no reasoning unless
 *      ticked, a superseded decision says so and never names the later one;
 *      refused, with the same 403, when never shared, revoked, Withheld, for
 *      another decision, for an id that does not exist, or once the person
 *      is no longer one of the venture's named people;
 *   5. revoke: the founder only, logged, and the read is refused after it.
 *
 * Every venture, person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/verdict_shares_6862.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { decisionSharesRouter, sharedDecisionsRouter } from '../src/routes/verdict_shares.ts';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 10, ADMIN = 30, PARTNER = 40, INVESTOR = 50, OUTSIDER_PARTNER = 41, OTHER_FOUNDER = 20, LAPSED = 42;
const P = 1, P_OTHER = 2, CO_OWNER = 43;
const ROLE: Record<number, string> = {
  [FOUNDER]: 'founder', [ADMIN]: 'admin', [PARTNER]: 'partner', [INVESTOR]: 'investor',
  [OUTSIDER_PARTNER]: 'partner', [OTHER_FOUNDER]: 'founder', [LAPSED]: 'advisor', [CO_OWNER]: 'partner',
};

function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = OFF');
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER_FOUNDER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@example.test', null);
  u.run(OUTSIDER_PARTNER, 'partner', 'Oz Outsider', 'oz@example.test', null);
  u.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null);
  // A member of the venture whose account holds no partner licence: never a candidate.
  u.run(LAPSED, 'advisor', 'Al Advisor', 'al@example.test', null);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Acme Dispatch', 1001), (${P_OTHER}, 'Beta Freight', 1002)`);
  const m = db.prepare("INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'advisor', 'accepted')");
  m.run(P, PARTNER); m.run(P, LAPSED); m.run(P_OTHER, OUTSIDER_PARTNER);
  // One of the venture's own who also holds the partner licence: never a candidate.
  u.run(CO_OWNER, 'partner', 'Cy Coowner', 'cy@example.test', 1001);
  m.run(P, CO_OWNER);
  db.prepare("INSERT INTO investor_introductions (uid, investor_user_id, project_id, quarter) VALUES ('intro-1', ?, ?, '2026Q4')").run(INVESTOR, P);
  const h = db.prepare("INSERT INTO hypotheses (project_id, code, claim) VALUES (?, 'H2', 'They will pay for reconciliation') RETURNING id").get(P) as { id: number };
  const d = db.prepare(`INSERT INTO validation_decisions (project_id, hypothesis_id, decision, reasoning, decided_by, state, decided_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`);
  const given = (d.get(P, null, 'pivot', 'Budget sits with finance.', FOUNDER, 'given', '2026-11-13 10:00:00') as { id: number }).id;
  const withheld = (d.get(P, h.id, 'proceed', 'Too early.', FOUNDER, 'withheld', '2026-11-14 10:00:00') as { id: number }).id;
  const other = (d.get(P, h.id, 'stop', 'Another decision.', FOUNDER, 'given', '2026-11-12 10:00:00') as { id: number }).id;
  const foreign = (d.get(P_OTHER, null, 'proceed', 'Not yours.', OTHER_FOUNDER, 'given', '2026-11-10 10:00:00') as { id: number }).id;
  db.prepare(`INSERT INTO validation_decision_evidence (uid, decision_id, kind, ref_id, label, strength, direction, on_date)
    VALUES ('ev-1', ?, 'interview', '7', 'Jo Sample · budget sits with finance', 'anecdote', 'contradicts', '2026-10-21')`).run(given);
  db.prepare(`INSERT INTO validation_decision_commitments (uid, decision_id, project_id, text, owner_user_id, due_date)
    VALUES ('cm-1', ?, ?, 'Re-test pricing with two partners', ?, '2026-11-30')`).run(given, P, FOUNDER);
  return { db, given, withheld, other, foreign };
}

const app = new Hono<any>();
app.route('/api/cycles/validate/decision-shares', decisionSharesRouter);
app.route('/api/shared-decisions', sharedDecisionsRouter);

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who], ...extra }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    const text = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally { [console.warn, console.error] = saved; }
}
const q = (decision: number, project = P) => `?project=${project}&decision=${decision}`;
const grant = (db: DatabaseSync, who: number, decision: number, body: unknown, project = P, extra = {}) =>
  call(db, who, 'POST', `/api/cycles/validate/decision-shares${q(decision, project)}`, body, extra);
const read = (db: DatabaseSync, who: number, decision: number | string) => call(db, who, 'GET', `/api/shared-decisions/${decision}`);
const logs = (db: DatabaseSync, action: string) =>
  db.prepare("SELECT entity_type, entity_id, details, user_id FROM activity_logs WHERE action = ? ORDER BY id").all(action) as any[];

test('1. the migration: one live share per decision and recipient, with its checks', () => {
  const { db, given } = fixture();
  const cols = (db.prepare("PRAGMA table_info('validation_decision_shares')").all() as any[]).map((c) => c.name);
  assert.deepEqual(cols, ['id', 'uid', 'project_id', 'decision_id', 'recipient_user_id', 'recipient_kind', 'include_reasoning',
    'shared_by', 'shared_at', 'revoked_at', 'revoked_by']);
  const ins = db.prepare(`INSERT INTO validation_decision_shares (uid, project_id, decision_id, recipient_user_id, recipient_kind, revoked_at)
    VALUES (?, ?, ?, ?, 'partner', ?)`);
  ins.run('a', P, given, PARTNER, null);
  assert.throws(() => ins.run('b', P, given, PARTNER, null), /UNIQUE/);
  // A revoked row does not block a new live share.
  ins.run('c', P, given, INVESTOR, '2026-11-15 00:00:00');
  ins.run('d', P, given, INVESTOR, null);
  assert.throws(() => db.prepare(`INSERT INTO validation_decision_shares (uid, project_id, decision_id, recipient_user_id, recipient_kind)
    VALUES ('e', ?, ?, ?, 'advisor')`).run(P, given, LAPSED), /CHECK/);
  const def = db.prepare("SELECT include_reasoning FROM validation_decision_shares WHERE uid = 'a'").get() as any;
  assert.equal(def.include_reasoning, 0);
});

test('2. candidates: the venture\'s partners and investors with the licence, never anyone else', async () => {
  const { db, given } = fixture();
  const r = await call(db, FOUNDER, 'GET', `/api/cycles/validate/decision-shares/candidates${q(given)}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.candidates.map((c: any) => [c.user_id, c.kind, c.shared]), [[PARTNER, 'partner', false], [INVESTOR, 'investor', false]]);
  // Only the venture's founder lists them.
  for (const who of [ADMIN, PARTNER, INVESTOR, OTHER_FOUNDER]) {
    assert.equal((await call(db, who, 'GET', `/api/cycles/validate/decision-shares/candidates${q(given)}`)).status, 403, `user ${who}`);
  }
});

test('3. grant: the founder shares a given decision, logged once, and nobody else can', async () => {
  const { db, given, withheld, foreign } = fixture();
  for (const who of [ADMIN, PARTNER, INVESTOR, OTHER_FOUNDER]) {
    const r = await grant(db, who, given, { recipients: [PARTNER] });
    assert.equal(r.status, 403, `user ${who}`);
  }
  // A support session is refused although the founder's token is used.
  const support = await grant(db, FOUNDER, given, { recipients: [PARTNER] }, P, { impersonated_by: ADMIN });
  assert.equal(support.status, 403);
  assert.equal(support.body.error, 'support_session_refused');
  // Withheld: refused, nothing written.
  const w = await grant(db, FOUNDER, withheld, { recipients: [PARTNER] });
  assert.equal(w.status, 409);
  assert.equal(w.body.error, 'withheld_not_shareable');
  assert.equal(w.body.message, 'A withheld decision cannot be shared.');
  // Not a candidate: an outsider partner, a member without the licence, the founder themself.
  for (const who of [OUTSIDER_PARTNER, LAPSED, FOUNDER]) {
    const r = await grant(db, FOUNDER, given, { recipients: [PARTNER, who] });
    assert.equal(r.status, 403, `recipient ${who}`);
    assert.equal(r.body.error, 'not_a_candidate');
  }
  // Another venture's decision through this venture's address is not found.
  assert.equal((await grant(db, FOUNDER, foreign, { recipients: [PARTNER] })).status, 404);
  for (const body of [{}, { recipients: [] }, { recipients: ['40'] }, { recipients: [PARTNER], include_reasoning: 'yes' }]) {
    assert.equal((await grant(db, FOUNDER, given, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM validation_decision_shares').get() as any).n, 0);

  const ok = await grant(db, FOUNDER, given, { recipients: [PARTNER, INVESTOR], include_reasoning: false });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body.shares.map((s: any) => [s.recipient_user_id, s.recipient_kind, s.include_reasoning, s.revoked_at]).sort(),
    [[PARTNER, 'partner', false, null], [INVESTOR, 'investor', false, null]]);
  // Again: idempotent, no second live row and no second log.
  await grant(db, FOUNDER, given, { recipients: [PARTNER] });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM validation_decision_shares WHERE revoked_at IS NULL').get() as any).n, 2);
  const shared = logs(db, 'decision_shared');
  assert.equal(shared.length, 2);
  assert.ok(shared.every((l) => l.entity_type === 'validate.verdict' && l.entity_id === String(given) && l.user_id === FOUNDER));
  assert.match(shared[0].details, /^Shared Pivot for the venture with (Pat Partner|Ivy Investor)$/);
});

test('4. the recipient reads exactly the one decision, and every other read is the same 403', async () => {
  const { db, given, withheld, other, foreign } = fixture();
  await grant(db, FOUNDER, given, { recipients: [PARTNER] });
  const r = await read(db, PARTNER, given);
  assert.equal(r.status, 200);
  const d = r.body.decision;
  assert.equal(d.decision_id, given);
  assert.equal(d.decision, 'pivot');
  assert.equal(d.venture, 'Acme Dispatch');
  assert.equal(d.reasoning, null, 'reasoning is not included unless ticked');
  assert.equal(d.reasoning_included, false);
  assert.equal(d.shared_by_name, 'Fay Founder');
  assert.equal(d.evidence.length, 1);
  assert.equal(d.commitments[0].text, 'Re-test pricing with two partners');
  assert.equal(d.superseded_at, null);
  assert.ok(!('actions' in d) && !('id' in d) && !('project_id' in d), 'no action and no venture id travel');
  // The first open is logged on the decision's activity, once.
  await read(db, PARTNER, given);
  assert.equal(logs(db, 'decision_share_opened').length, 1);

  const refused = async (who: number, id: number | string, why: string) => {
    const x = await read(db, who, id);
    assert.equal(x.status, 403, why);
    assert.equal(x.body.error, 'not_shared', why);
    assert.equal(x.body.message, 'This decision was shared with named people only.', why);
  };
  await refused(INVESTOR, given, 'never shared with this person');
  await refused(PARTNER, other, 'another decision of the same venture');
  await refused(PARTNER, foreign, 'another venture’s decision');
  await refused(PARTNER, 999999, 'a decision that does not exist');
  await refused(PARTNER, 'abc', 'not an id');
  await refused(OUTSIDER_PARTNER, given, 'a partner of another venture');
  // A Withheld decision is refused at the read too, even with a row written by hand.
  db.prepare(`INSERT INTO validation_decision_shares (uid, project_id, decision_id, recipient_user_id, recipient_kind)
    VALUES ('hand', ?, ?, ?, 'partner')`).run(P, withheld, PARTNER);
  await refused(PARTNER, withheld, 'a Withheld decision');
  // No longer one of the venture's named people: the share reads nothing.
  db.prepare("UPDATE project_members SET status = 'removed' WHERE user_id = ?").run(PARTNER);
  await refused(PARTNER, given, 'removed from the venture');
});

test('4b. reasoning only when ticked; a superseded decision says so and never names the later one', async () => {
  const { db, given } = fixture();
  await grant(db, FOUNDER, given, { recipients: [INVESTOR], include_reasoning: true });
  assert.equal((await read(db, INVESTOR, given)).body.decision.reasoning, 'Budget sits with finance.');
  const later = (db.prepare(`INSERT INTO validation_decisions (project_id, decision, reasoning, decided_by, state, supersedes_id)
    VALUES (?, 'proceed', 'The later secret.', ?, 'given', ?) RETURNING id`).get(P, FOUNDER, given) as any).id;
  db.prepare("UPDATE validation_decisions SET superseded_at = '2026-11-15 09:00:00' WHERE id = ?").run(given);
  const r = await read(db, INVESTOR, given);
  assert.equal(r.status, 200);
  assert.equal(r.body.decision.superseded_at, '2026-11-15 09:00:00');
  const raw = JSON.stringify(r.body);
  assert.ok(!raw.includes('The later secret.') && !raw.includes('"proceed"'), 'nothing about the later decision');
  assert.equal((await read(db, INVESTOR, later)).status, 403);
});

test('5. revoke: the founder only, logged, and the read is refused after it', async () => {
  const { db, given } = fixture();
  const ok = await grant(db, FOUNDER, given, { recipients: [PARTNER] });
  const uid = ok.body.shares[0].uid;
  const path = `/api/cycles/validate/decision-shares/${uid}/revoke${q(given)}`;
  for (const who of [ADMIN, PARTNER, INVESTOR, OTHER_FOUNDER]) {
    assert.equal((await call(db, who, 'POST', path)).status, 403, `user ${who}`);
  }
  assert.equal((await read(db, PARTNER, given)).status, 200);
  const r = await call(db, FOUNDER, 'POST', path);
  assert.equal(r.status, 200);
  assert.ok(r.body.shares[0].revoked_at);
  assert.equal((await read(db, PARTNER, given)).status, 403);
  const again = await call(db, FOUNDER, 'POST', path);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'share_revoked');
  assert.equal((await call(db, FOUNDER, 'POST', `/api/cycles/validate/decision-shares/nope/revoke${q(given)}`)).status, 404);
  const revoked = logs(db, 'decision_share_revoked');
  assert.equal(revoked.length, 1);
  assert.equal(revoked[0].entity_type, 'validate.verdict');
  assert.match(revoked[0].details, /^Revoked Pat Partner.s access to Pivot for the venture$/);
  // The list keeps the revoked row; an admin reads it, a partner does not.
  assert.equal((await call(db, ADMIN, 'GET', `/api/cycles/validate/decision-shares${q(given)}`)).body.shares.length, 1);
  assert.equal((await call(db, PARTNER, 'GET', `/api/cycles/validate/decision-shares${q(given)}`)).status, 403);
  // Shared again after a revoke: a new row, and the read works again.
  assert.equal((await grant(db, FOUNDER, given, { recipients: [PARTNER] })).status, 201);
  assert.equal((await read(db, PARTNER, given)).status, 200);
});
