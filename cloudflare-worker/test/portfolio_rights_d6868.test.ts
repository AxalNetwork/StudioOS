/**
 * D6868 (#6868): an investor's rights in a company they hold, and their requests that HQ record one
 * (`routes/portfolio_rights.ts`).
 *
 * Real schema (`loadSchema`, so migration 202611161152_6868 is applied), real route, synthetic fixtures:
 *   ADMIN     platform admin
 *   HOLDER    investor with a confirmed commitment in venture 7 only
 *   OTHER     investor with a confirmed commitment in venture 8 only
 *   PLEDGED   investor whose commitment in venture 7 is not confirmed
 *   FOUNDER   founder (no investor licence)
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/portfolio_rights_d6868.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import rights, { RIGHT_TYPES } from '../src/routes/portfolio_rights.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d6868-portfolio-rights-0123456789';
const ADMIN = 1, HOLDER = 2, OTHER = 3, PLEDGED = 4, FOUNDER = 5;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare(`INSERT INTO users (id, role, founder_id, name, email, is_active, investor_tier, investor_subscription_status)
    VALUES (?, ?, ?, ?, ?, 1, ?, 'active')`);
  u.run(ADMIN, 'admin', null, 'Ada', 'ada@axal.example', 'free');
  u.run(HOLDER, 'investor', null, 'Hal', 'hal@angel.example', 'professional');
  u.run(OTHER, 'investor', null, 'Oli', 'oli@angel.example', 'professional');
  u.run(PLEDGED, 'investor', null, 'Pia', 'pia@angel.example', 'professional');
  u.run(FOUNDER, 'founder', 70, 'Fay', 'fay@co.example', 'free');
  db.exec(`
    INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p7', 'Venture Seven', 70), (8, 'p8', 'Venture Eight', 80);
    INSERT INTO deals (id, project_id) VALUES (70, 7), (80, 8);
    INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (${HOLDER}, 70), (${OTHER}, 80), (${PLEDGED}, 70);
    INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES
      (1, 70, ${HOLDER}, 1000, 'confirmed'), (2, 80, ${OTHER}, 1000, 'confirmed'), (3, 70, ${PLEDGED}, 1000, 'pending');
  `);
  return db;
}

const app = new Hono<any>();
app.route('/api/portfolio-rights', rights);

async function call(db: DatabaseSync, userId: number, method: string, path: string, body?: unknown) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any)?.role ?? 'founder';
  const token = await new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  let res: Response;
  try {
    res = await app.fetch(new Request(`http://t/api/portfolio-rights${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  } catch (e) {
    if (e instanceof Response) res = e; else throw e;
  }
  const text = await res.text();
  let parsed: any = null; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}
const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  const [w, e] = [console.warn, console.error];
  console.warn = () => {}; console.error = () => {};
  try { return await f(); } finally { console.warn = w; console.error = e; }
};
const inbox = (db: DatabaseSync, userId: number, type: string) =>
  (db.prepare('SELECT COUNT(*) AS n FROM notifications_inbox WHERE user_id = ? AND type = ?').get(userId, type) as any).n;
const PRO_RATA = { document_title: 'Investors’ Rights Agreement', clause: '§2.1', terms: 'Buy up to your share of new securities, on the same terms', signed_on: '2026-03-31' };

test('GET: a holder reads all six rights in order; none recorded reads not recorded, never none', async () => {
  const db = fixture();
  const res = await call(db, HOLDER, 'GET', '/p7');
  assert.equal(res.status, 200);
  assert.equal(res.body.scope, 'own_rights');
  assert.deepEqual(res.body.project, { uid: 'p7', name: 'Venture Seven' });
  assert.deepEqual(res.body.rights.map((x: any) => x.type), [...RIGHT_TYPES]);
  assert.ok(res.body.rights.every((x: any) => x.recorded === false));
  assert.deepEqual(res.body.requests, []);
});

test('GET: not held, not confirmed, unknown and a founder are refused alike', async () => {
  const db = fixture();
  // mutation: the held check dropped → 200 here.
  const notHeld = await call(db, HOLDER, 'GET', '/p8');
  assert.equal(notHeld.status, 403, 'not held: 403');
  assert.equal(notHeld.body.error, 'not_held');
  assert.equal((await call(db, PLEDGED, 'GET', '/p7')).body.error, 'not_held', 'an unconfirmed commitment holds nothing');
  assert.equal((await call(db, HOLDER, 'GET', '/nope')).body.error, 'not_held', 'an unknown company answers like an unheld one');
  assert.equal((await call(db, FOUNDER, 'GET', '/p7')).status, 403);
});

test('PUT: an admin records a holder’s right from the paper; the holder reads it, another holder does not', async () => {
  const db = fixture();
  db.exec(`INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (${OTHER}, 70);
    INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES (4, 70, ${OTHER}, 500, 'confirmed')`);
  const put = await quiet(() => call(db, ADMIN, 'PUT', `/p7/holders/${HOLDER}/pro_rata`, PRO_RATA));
  assert.equal(put.status, 201);
  assert.equal(put.body.type, 'pro_rata');
  assert.deepEqual(put.body.holder, { id: HOLDER, name: 'Hal' });
  const mine = await call(db, HOLDER, 'GET', '/p7');
  const pr = mine.body.rights.find((x: any) => x.type === 'pro_rata');
  assert.equal(pr.recorded, true);
  assert.equal(pr.document_title, PRO_RATA.document_title);
  assert.equal(pr.clause, '§2.1');
  assert.equal(pr.signed_on, '2026-03-31');
  assert.equal('holder' in pr, false, 'an investor is not handed the holder block');
  // mutation: the holder filter dropped from the investor read → OTHER reads HOLDER's right.
  const theirs = await call(db, OTHER, 'GET', '/p7');
  assert.ok(theirs.body.rights.every((x: any) => x.recorded === false), 'another holder of the same company reads only their own');
  // A second PUT corrects the same row.
  const again = await quiet(() => call(db, ADMIN, 'PUT', `/p7/holders/${HOLDER}/pro_rata`, { ...PRO_RATA, clause: '§2.2' }));
  assert.equal(again.status, 200);
  assert.equal(again.body.uid, put.body.uid);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM portfolio_rights').get() as any).n, 1);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM activity_logs WHERE action LIKE 'portfolio.right_%'`).get() as any).n, 2, 'each write is audited');
});

test('PUT: admin only; the holder must hold the company; the paper’s fields are checked', async () => {
  const db = fixture();
  // mutation: requireAdmin swapped for requireAuth → 201 here.
  assert.equal((await call(db, HOLDER, 'PUT', `/p7/holders/${HOLDER}/pro_rata`, PRO_RATA)).status, 403, 'PUT is admin only');
  assert.equal((await call(db, ADMIN, 'PUT', `/p7/holders/${OTHER}/pro_rata`, PRO_RATA)).body.error, 'not_a_holder');
  assert.equal((await call(db, ADMIN, 'PUT', `/p7/holders/${PLEDGED}/pro_rata`, PRO_RATA)).body.error, 'not_a_holder', 'a pending commitment is not a holding');
  assert.equal((await call(db, ADMIN, 'PUT', `/p7/holders/${HOLDER}/carry`, PRO_RATA)).body.error, 'bad_type');
  assert.equal((await call(db, ADMIN, 'PUT', `/nope/holders/${HOLDER}/pro_rata`, PRO_RATA)).status, 404);
  assert.equal((await call(db, ADMIN, 'PUT', `/p7/holders/${HOLDER}/pro_rata`, { ...PRO_RATA, document_title: ' ' })).body.error, 'document_required');
  assert.equal((await call(db, ADMIN, 'PUT', `/p7/holders/${HOLDER}/pro_rata`, { ...PRO_RATA, terms: '' })).body.error, 'terms_required');
  assert.equal((await call(db, ADMIN, 'PUT', `/p7/holders/${HOLDER}/pro_rata`, { ...PRO_RATA, signed_on: '2026-02-30' })).body.error, 'bad_signed_on');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM portfolio_rights').get() as any).n, 0);
});

test('POST /requests: a holder asks HQ to record a right; HQ is told; one open request per company, investor and type', async () => {
  const db = fixture();
  const first = await quiet(() => call(db, HOLDER, 'POST', '/requests', { project_uid: 'p7', type: 'observer_seat', description: '  IRA §3.3, page 9  ' }));
  assert.equal(first.status, 201);
  assert.equal(first.body.state, 'open');
  assert.equal(first.body.description, 'IRA §3.3, page 9');
  assert.equal(inbox(db, ADMIN, 'portfolio_right_requested'), 1);
  const second = await call(db, HOLDER, 'POST', '/requests', { project_uid: 'p7', type: 'observer_seat', description: 'again' });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'request_open');
  assert.equal(second.body.request.uid, first.body.uid);
  assert.equal((await quiet(() => call(db, HOLDER, 'POST', '/requests', { project_uid: 'p7', type: 'pro_rata', description: 'Side letter §2' }))).status, 201, 'another type is its own request');
  const read = await call(db, HOLDER, 'GET', '/p7');
  assert.deepEqual(read.body.requests.map((q: any) => q.type).sort(), ['observer_seat', 'pro_rata']);
});

test('POST /requests: not held, an admin, a founder, an unknown type and no description are refused', async () => {
  const db = fixture();
  assert.equal((await call(db, HOLDER, 'POST', '/requests', { project_uid: 'p8', type: 'pro_rata', description: 'x' })).body.error, 'not_held');
  assert.equal((await call(db, ADMIN, 'POST', '/requests', { project_uid: 'p7', type: 'pro_rata', description: 'x' })).body.error, 'investor_only');
  assert.equal((await call(db, FOUNDER, 'POST', '/requests', { project_uid: 'p7', type: 'pro_rata', description: 'x' })).status, 403);
  assert.equal((await call(db, HOLDER, 'POST', '/requests', { project_uid: 'p7', type: 'carry', description: 'x' })).body.error, 'bad_type');
  assert.equal((await call(db, HOLDER, 'POST', '/requests', { project_uid: 'p7', type: 'pro_rata', description: '  ' })).body.error, 'description_required');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM portfolio_right_requests').get() as any).n, 0);
});

test('PUT with request_uid answers the request as recorded, links the right and tells the investor', async () => {
  const db = fixture();
  const q = await quiet(() => call(db, HOLDER, 'POST', '/requests', { project_uid: 'p7', type: 'pro_rata', description: 'IRA §2.1' }));
  assert.equal((await call(db, ADMIN, 'PUT', `/p7/holders/${HOLDER}/board_seat`, { ...PRO_RATA, request_uid: q.body.uid })).body.error, 'request_mismatch', 'a request for another type is not answered');
  const put = await quiet(() => call(db, ADMIN, 'PUT', `/p7/holders/${HOLDER}/pro_rata`, { ...PRO_RATA, request_uid: q.body.uid }));
  assert.equal(put.status, 201);
  const read = await call(db, HOLDER, 'GET', '/p7');
  const answered = read.body.requests.find((x: any) => x.uid === q.body.uid);
  assert.equal(answered.state, 'recorded');
  assert.equal(answered.right_uid, put.body.uid);
  assert.equal(inbox(db, HOLDER, 'portfolio_right_request_answered'), 1);
  assert.equal((await call(db, ADMIN, 'PUT', `/p7/holders/${HOLDER}/pro_rata`, { ...PRO_RATA, request_uid: q.body.uid })).body.error, 'request_answered');
});

test('PATCH /requests/:uid: an admin declines with a reason the investor reads; not reopened; admin only', async () => {
  const db = fixture();
  const q = await quiet(() => call(db, HOLDER, 'POST', '/requests', { project_uid: 'p7', type: 'board_seat', description: 'IRA §3.1' }));
  assert.equal((await call(db, HOLDER, 'PATCH', `/requests/${q.body.uid}`, { state: 'declined', note: 'x' })).status, 403, 'PATCH is admin only');
  assert.equal((await call(db, ADMIN, 'PATCH', `/requests/${q.body.uid}`, { state: 'declined' })).body.error, 'note_required');
  assert.equal((await call(db, ADMIN, 'PATCH', `/requests/${q.body.uid}`, { state: 'recorded', note: 'x' })).body.error, 'bad_state');
  const done = await quiet(() => call(db, ADMIN, 'PATCH', `/requests/${q.body.uid}`, { state: 'declined', note: 'The seat is the Series Seed majority’s, not yours.' }));
  assert.equal(done.status, 200);
  assert.equal(done.body.state, 'declined');
  assert.deepEqual(done.body.requester, { id: HOLDER, name: 'Hal' });
  const read = await call(db, HOLDER, 'GET', '/p7');
  assert.equal(read.body.requests[0].answer_note, 'The seat is the Series Seed majority’s, not yours.');
  assert.equal((await call(db, ADMIN, 'PATCH', `/requests/${q.body.uid}`, { state: 'declined', note: 'again' })).body.error, 'request_answered');
  // After an answer a new request of the same type is allowed.
  assert.equal((await quiet(() => call(db, HOLDER, 'POST', '/requests', { project_uid: 'p7', type: 'board_seat', description: 'Side letter' }))).status, 201);
});

test('GET as admin: every holder’s rights, every request with who asked, and the company’s holders', async () => {
  const db = fixture();
  await quiet(() => call(db, ADMIN, 'PUT', `/p7/holders/${HOLDER}/anti_dilution`, { document_title: 'Restated Certificate', clause: 'Art. IV §4(d)', terms: 'Broad-based weighted average' }));
  await quiet(() => call(db, HOLDER, 'POST', '/requests', { project_uid: 'p7', type: 'pro_rata', description: 'IRA §2.1' }));
  const res = await call(db, ADMIN, 'GET', '/p7');
  assert.equal(res.body.scope, 'all_holders');
  assert.deepEqual(res.body.holders, [{ id: HOLDER, name: 'Hal' }], 'a pending commitment is not listed as a holder');
  assert.equal(res.body.rights.length, 1);
  assert.deepEqual(res.body.rights[0].holder, { id: HOLDER, name: 'Hal' });
  assert.equal(res.body.requests[0].requester.name, 'Hal');
  assert.equal(res.body.requests[0].holder_id, HOLDER, 'each request names whose right PUT records');
});

test('the store holds its rules by itself: one right per company, holder and type; one open request per type; answers carry who and when', () => {
  const db = fixture();
  const r = db.prepare(`INSERT INTO portfolio_rights (uid, project_id, holder_user_id, right_type, document_title, terms, recorded_at, updated_at)
    VALUES (?, 7, ${HOLDER}, 'pro_rata', 'IRA', 'terms', '2026-11-16', '2026-11-16')`);
  r.run('a');
  assert.throws(() => r.run('b'), /UNIQUE constraint failed/);
  const q = db.prepare(`INSERT INTO portfolio_right_requests (uid, project_id, requester_user_id, right_type, description, state, created_at, updated_at)
    VALUES (?, 7, ${HOLDER}, 'pro_rata', 'd', 'open', '2026-11-16', '2026-11-16')`);
  q.run('q1');
  assert.throws(() => q.run('q2'), /UNIQUE constraint failed/, 'a race keeps one');
  assert.throws(() => db.prepare(`UPDATE portfolio_right_requests SET state = 'declined' WHERE uid = 'q1'`).run(), /CHECK constraint failed/);
  assert.throws(() => db.prepare(`UPDATE portfolio_right_requests SET state = 'recorded', answered_at = 'x', answered_by = 1 WHERE uid = 'q1'`).run(), /CHECK constraint failed/, 'a recorded request links its right');
});
