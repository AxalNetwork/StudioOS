/**
 * D580 (#1207) — 83(b) operator review, on real SQLite with migration 398's
 * own DDL.
 *
 * The owner chose 1A (an Axal admin assigned per startup), 2A (the 83(b)
 * filing record is what is reviewed) and 3A (a review does not gate
 * graduation). What these tests hold:
 *   - only an admin writes, and every write records the acting admin;
 *   - the operator is an active admin; a review needs one assigned and is
 *     stamped with that operator, not with whoever typed it;
 *   - a founder reads their own startup's operator and reviews; anyone else
 *     (another founder, an advisor member, a partner, an investor) gets 404;
 *   - the read's three states: nothing recorded, an operator with no review,
 *     and an operator with a review and its follow-up date.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/section83b_operator_review_d580.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import admin83bReview from '../src/routes/admin_83b_review.ts';
import legal83b from '../src/routes/legal_83b.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { hashEmail } from '../src/util/hashEmail.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADMIN = 1;
const OPERATOR = 3;
const INACTIVE_ADMIN = 4;
const FOUNDER_A = 10;
const FOUNDER_B = 20;
const COFOUNDER = 30;
const ADVISOR = 40;
const PARTNER = 50;
const INVESTOR = 60;

const ROLE: Record<number, string> = {
  [ADMIN]: 'admin', [OPERATOR]: 'admin', [INACTIVE_ADMIN]: 'admin', [FOUNDER_A]: 'founder', [FOUNDER_B]: 'founder',
  [COFOUNDER]: 'founder', [ADVISOR]: 'founder', [PARTNER]: 'partner', [INVESTOR]: 'investor',
};

function migration398(): string {
  return readFileSync(new URL('../sql/migrations/398_section_83b_operator_review.sql', import.meta.url), 'utf8');
}

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        jwt_min_iat INTEGER, name TEXT, email TEXT, founder_id INTEGER);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, founder_id INTEGER);
    CREATE TABLE section_83b_trackers (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER);
    ${migration398()}
  `);
  const u = db.prepare('INSERT INTO users (id, role, is_active, name, email, founder_id) VALUES (?,?,?,?,?,?)');
  u.run(ADMIN, 'admin', 1, 'Hq Admin', 'hq@axal.example', null);
  u.run(OPERATOR, 'admin', 1, 'Olu Operator', 'olu@axal.example', null);
  u.run(INACTIVE_ADMIN, 'admin', 0, 'Gone Admin', 'gone@axal.example', null);
  u.run(FOUNDER_A, 'founder', 1, 'Fay Founder', 'fay@example.test', 1001);
  u.run(FOUNDER_B, 'founder', 1, 'Bo Founder', 'bo@example.test', 1002);
  u.run(COFOUNDER, 'founder', 1, 'Cy Cofounder', 'cy@example.test', null);
  u.run(ADVISOR, 'founder', 1, 'Ad Visor', 'ad@example.test', null);
  u.run(PARTNER, 'partner', 1, 'Pat Partner', 'pat@example.test', null);
  u.run(INVESTOR, 'investor', 1, 'Ivy Investor', 'ivy@example.test', null);
  db.exec(`
    INSERT INTO projects (id, name, founder_id) VALUES (1, 'Acme', 1001), (2, 'Beta', 1002);
    INSERT INTO section_83b_trackers (id, project_id, user_id) VALUES (11, 1, ${FOUNDER_A}), (21, 2, ${FOUNDER_B});
  `);
  return db;
}

function membersOf(db: InstanceType<typeof DatabaseSync>) {
  // The membership schema is created on first use by projectAccess; seed it after.
  db.exec(`CREATE TABLE IF NOT EXISTS project_members (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'cofounder', status TEXT NOT NULL DEFAULT 'accepted', source TEXT,
    invitation_id INTEGER, cofounder_connection_id INTEGER, added_by_user_id INTEGER, accepted_at TEXT, removed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES
    (1, ${COFOUNDER}, 'cofounder', 'accepted'), (1, ${ADVISOR}, 'advisor', 'accepted')`);
}

const app = new Hono<any>();
app.route('/admin/83b-review', admin83bReview);
app.route('/legal', legal83b);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 403));

async function call(db: InstanceType<typeof DatabaseSync>, userId: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: userId, role: ROLE[userId] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });
  return { status: res.status, body: await res.json() as any };
}

const assign = (db: any, who: number, project: number, operator: number | null) =>
  call(db, who, 'PUT', `/admin/83b-review/projects/${project}/operator`, { operator_user_id: operator });
const review = (db: any, who: number, project: number, body: Record<string, unknown>) =>
  call(db, who, 'POST', `/admin/83b-review/projects/${project}/reviews`, body);
const read = (db: any, who: number, project: number | string) =>
  call(db, who, 'GET', `/legal/83b/operator-review?project_id=${project}`);

const count = (db: any, table: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n);

test('an admin assigns an operator, and the write records the acting admin in both audit stores', async () => {
  const db = fixture();
  const res = await assign(db, ADMIN, 1, OPERATOR);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.operator.user_id, OPERATOR);
  assert.equal(res.body.operator.name, 'Olu Operator');
  const row = db.prepare('SELECT project_id, operator_user_id, assigned_by FROM section_83b_operator_assignments').get() as any;
  assert.deepEqual({ ...row }, { project_id: 1, operator_user_id: OPERATOR, assigned_by: ADMIN });

  const log = db.prepare("SELECT action, details, actor, user_id FROM activity_logs").all() as any[];
  assert.equal(log.length, 1);
  assert.equal(log[0].action, 'section_83b_operator_assigned');
  assert.equal(log[0].user_id, ADMIN);
  assert.equal(log[0].actor, await hashEmail('hq@axal.example'));
  assert.deepEqual(JSON.parse(log[0].details), { project_id: 1, operator_user_id: OPERATOR });
  const audit = db.prepare('SELECT admin_user_id, action FROM admin_audit_log').all() as any[];
  assert.deepEqual(audit.map((a) => ({ ...a })), [{ admin_user_id: ADMIN, action: 'section_83b_operator_assigned' }]);
});

test('only an admin writes: a founder, a partner and an investor are refused and nothing is stored or logged', async () => {
  const db = fixture();
  await assign(db, ADMIN, 1, OPERATOR);
  const before = { a: count(db, 'section_83b_operator_assignments'), l: count(db, 'activity_logs') };
  for (const who of [FOUNDER_A, PARTNER, INVESTOR]) {
    const a = await assign(db, who, 1, OPERATOR);
    assert.equal(a.status, 403, `assign by ${ROLE[who]} ${who}`);
    const r = await review(db, who, 1, { outcome: 'complete' });
    assert.equal(r.status, 403, `review by ${ROLE[who]} ${who}`);
    const l = await call(db, who, 'GET', '/admin/83b-review');
    assert.equal(l.status, 403, `HQ list read by ${ROLE[who]} ${who}`);
  }
  assert.equal(count(db, 'section_83b_operator_assignments'), before.a);
  assert.equal(count(db, 'section_83b_operator_reviews'), 0);
  assert.equal(count(db, 'activity_logs'), before.l);
});

test('the operator must be an active admin, and the project must exist', async () => {
  const db = fixture();
  assert.deepEqual((await assign(db, ADMIN, 1, FOUNDER_A)).body, { error: 'operator_not_an_admin' });
  assert.deepEqual((await assign(db, ADMIN, 1, INACTIVE_ADMIN)).body, { error: 'operator_not_an_admin' });
  assert.deepEqual((await assign(db, ADMIN, 1, 0)).body, { error: 'operator_user_id_invalid' });
  assert.equal((await call(db, ADMIN, 'PUT', '/admin/83b-review/projects/1/operator', {})).status, 400);
  assert.equal((await assign(db, ADMIN, 99, OPERATOR)).status, 404);
  assert.equal(count(db, 'section_83b_operator_assignments'), 0);
  assert.equal(count(db, 'activity_logs'), 0);
});

test('a review needs an operator, is stamped with the operator and the reviewer, and is logged', async () => {
  const db = fixture();
  const none = await review(db, ADMIN, 1, { outcome: 'complete' });
  assert.equal(none.status, 409);
  assert.deepEqual(none.body, { error: 'no_operator_assigned' });

  await assign(db, ADMIN, 1, OPERATOR);
  const ok = await review(db, ADMIN, 1, { outcome: 'incomplete', note: '  Tracking number missing.  ', follow_up_date: '2099-01-15', tracker_id: 11 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const row = db.prepare('SELECT project_id, tracker_id, item, operator_user_id, outcome, note, follow_up_date, reviewed_by FROM section_83b_operator_reviews').get() as any;
  assert.deepEqual({ ...row }, {
    project_id: 1, tracker_id: 11, item: 'section_83b_filing_record', operator_user_id: OPERATOR,
    outcome: 'incomplete', note: 'Tracking number missing.', follow_up_date: '2099-01-15', reviewed_by: ADMIN,
  });
  const log = db.prepare("SELECT action, details, user_id FROM activity_logs WHERE action = 'section_83b_operator_review_recorded'").get() as any;
  assert.ok(log, 'the review was not logged');
  assert.equal(log.user_id, ADMIN);
  const d = JSON.parse(log.details);
  assert.equal(d.project_id, 1);
  assert.equal(d.operator_user_id, OPERATOR);
  assert.equal(d.outcome, 'incomplete');
  assert.equal(d.follow_up_date, '2099-01-15');
  assert.equal(d.review_uid, ok.body.review_uid);
});

test('a review is refused for a bad outcome, a bad or past follow-up date, or another startup\'s tracker', async () => {
  const db = fixture();
  await assign(db, ADMIN, 1, OPERATOR);
  const logs = count(db, 'activity_logs');
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ outcome: 'approved' }, 'outcome_invalid'],
    [{}, 'outcome_invalid'],
    [{ outcome: 'complete', follow_up_date: '2099-02-31' }, 'follow_up_date_invalid'],
    [{ outcome: 'complete', follow_up_date: '2000-01-01' }, 'follow_up_date_past'],
    [{ outcome: 'complete', tracker_id: 21 }, 'tracker_not_on_project'],
    [{ outcome: 'complete', tracker_id: 'x' }, 'tracker_not_on_project'],
  ];
  for (const [body, error] of cases) {
    const r = await review(db, ADMIN, 1, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(r.body, { error }, JSON.stringify(body));
  }
  assert.equal(count(db, 'section_83b_operator_reviews'), 0);
  assert.equal(count(db, 'activity_logs'), logs);
});

test('a founder reads their own startup\'s; another founder, an advisor member, a partner and an investor get 404', async () => {
  const db = fixture();
  membersOf(db);
  await assign(db, ADMIN, 1, OPERATOR);
  await review(db, ADMIN, 1, { outcome: 'complete', follow_up_date: '2099-03-01' });
  for (const who of [FOUNDER_A, COFOUNDER, ADMIN]) {
    const r = await read(db, who, 1);
    assert.equal(r.status, 200, `${who} should read project 1`);
    assert.equal(r.body.operator.name, 'Olu Operator');
    assert.equal(r.body.last_review.outcome, 'complete');
    assert.equal(r.body.next_follow_up, '2099-03-01');
  }
  for (const who of [FOUNDER_B, ADVISOR, PARTNER, INVESTOR]) {
    const r = await read(db, who, 1);
    assert.equal(r.status, 404, `${ROLE[who]} ${who} read project 1`);
    assert.deepEqual(r.body, { error: 'not_found' });
  }
  assert.equal((await read(db, FOUNDER_A, 99)).status, 404);
  assert.equal((await read(db, FOUNDER_A, 'abc')).status, 404);
  assert.equal((await read(db, FOUNDER_B, 2)).status, 200, 'founder B reads their own');
});

test('the read\'s three states: nothing recorded, an operator with no review, an operator with a review', async () => {
  const db = fixture();
  const empty = (await read(db, FOUNDER_A, 1)).body;
  assert.equal(empty.operator, null);
  assert.equal(empty.last_review, null);
  assert.equal(empty.next_follow_up, null);
  assert.match(empty.role_note, /not tax or legal advice/);

  await assign(db, ADMIN, 1, OPERATOR);
  const assigned = (await read(db, FOUNDER_A, 1)).body;
  assert.equal(assigned.operator.user_id, OPERATOR);
  assert.equal(assigned.last_review, null);
  assert.equal(assigned.next_follow_up, null);

  await review(db, ADMIN, 1, { outcome: 'incomplete', follow_up_date: '2099-01-10' });
  await review(db, ADMIN, 1, { outcome: 'complete' });
  const reviewed = (await read(db, FOUNDER_A, 1)).body;
  assert.equal(reviewed.last_review.outcome, 'complete', 'the newest review is the last one');
  assert.equal(reviewed.last_review.operator_name, 'Olu Operator');
  assert.equal(reviewed.next_follow_up, null, 'the newest review set no follow-up, so none is next');

  // Unassigning clears the operator and keeps the history.
  await assign(db, ADMIN, 1, null);
  const unassigned = (await read(db, FOUNDER_A, 1)).body;
  assert.equal(unassigned.operator, null);
  assert.equal(unassigned.last_review.outcome, 'complete');
  assert.equal(count(db, 'section_83b_operator_assignments'), 2);
  // With the operator unassigned, no review can be recorded.
  const afterUnassign = await review(db, ADMIN, 1, { outcome: 'complete' });
  assert.equal(afterUnassign.status, 409);
  assert.deepEqual(afterUnassign.body, { error: 'no_operator_assigned' });
  // Another startup's records never show.
  assert.equal((await read(db, FOUNDER_B, 2)).body.operator, null);
});

test('HQ\'s list shows each startup with a tracker, its operator, and the active admins to choose from', async () => {
  const db = fixture();
  await assign(db, ADMIN, 2, OPERATOR);
  const r = await call(db, ADMIN, 'GET', '/admin/83b-review');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.startups.map((s: any) => [s.project_name, s.operator?.name ?? null]), [['Acme', null], ['Beta', 'Olu Operator']]);
  assert.deepEqual(r.body.operators.map((o: any) => o.id).sort(), [ADMIN, OPERATOR]);
});

test('migration 398 stores only the 83(b) filing record as the reviewed item (2A)', () => {
  const db = fixture();
  assert.throws(() => db.prepare(
    "INSERT INTO section_83b_operator_reviews (project_id, item, operator_user_id, outcome, reviewed_by) VALUES (1, 'week_4_compliance', 3, 'complete', 1)",
  ).run(), /CHECK/);
  assert.throws(() => db.prepare(
    "INSERT INTO section_83b_operator_reviews (project_id, operator_user_id, outcome, reviewed_by) VALUES (1, 3, 'approved', 1)",
  ).run(), /CHECK/);
});

test('a review gates nothing: no Lab milestone, certificate or cohort code reads the store (3A)', () => {
  for (const f of ['routes/spinout_lab.ts', 'services/certificateIssuance.ts', 'services/cohortTiming.ts', 'services/labMilestoneCredits.ts']) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /section_83b_operator|section83bOperatorReview/, `${f} reads the operator review`);
  }
});
