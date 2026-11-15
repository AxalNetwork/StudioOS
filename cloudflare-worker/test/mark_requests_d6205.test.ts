/**
 * D6205 (#6205): an investor asks HQ for a mark, a correction or a follow-on
 * round on a company they hold (`routes/mark_requests.ts`).
 *
 * Real schema (`loadSchema`, so migration 202611141523_6205 is applied), real
 * route, synthetic fixtures:
 *   ADMIN     platform admin
 *   HOLDER    investor with a confirmed commitment in venture 7 only
 *   OTHER     investor with a confirmed commitment in venture 8 only
 *   PLEDGED   investor whose commitment in venture 7 is not confirmed
 *   FOUNDER   founder (no investor licence)
 *
 * Mutation-checked (each fails a named assertion below):
 *   · the held check dropped from POST → "not held: 403"
 *   · the open-request lookup dropped (the index still holds) → the 409 still
 *     comes from the UNIQUE catch, so "a race keeps one" covers the index too
 *   · GET binding no requester for an investor → "an investor reads only their own"
 *   · PATCH's `requireAdmin` swapped for `requireAuth` → "PATCH is admin only"
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mark_requests_d6205.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import markRequests from '../src/routes/mark_requests.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d6205-mark-requests-0123456789';
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
    INSERT INTO portfolio_marks (uid, project_id, as_of_date, fmv, basis) VALUES ('m7', 7, '2026-06-30', 900, 'round_price'), ('m8', 8, '2026-06-30', 400, 'gp_estimate');
  `);
  return db;
}

const app = new Hono<any>();
app.route('/api/mark-requests', markRequests);

async function call(db: DatabaseSync, userId: number, method: string, path: string, body?: unknown) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any)?.role ?? 'founder';
  const token = await new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  let res: Response;
  try {
    res = await app.fetch(new Request(`http://t/api/mark-requests${path}`, {
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

test('POST: a holder requests a mark for a company they hold; HQ is told; the request reads back open', async () => {
  const db = fixture();
  const res = await quiet(() => call(db, HOLDER, 'POST', '', { project_uid: 'p7', kind: 'mark', reason: '  The latest mark is from June.  ' }));
  assert.equal(res.status, 201);
  assert.equal(res.body.project_uid, 'p7');
  assert.equal(res.body.project_name, 'Venture Seven');
  assert.equal(res.body.state, 'open');
  assert.equal(res.body.reason, 'The latest mark is from June.');
  assert.equal(res.body.resolved_at, null);
  assert.equal('requester' in res.body, false, 'an investor is not handed the requester block');
  assert.equal(inbox(db, ADMIN, 'portfolio_mark_requested'), 1, 'every active admin gets an in-app notice');
});

test('POST: not held, not confirmed, unknown, an admin and a founder are all refused', async () => {
  const db = fixture();
  // mutation: held check dropped → 201 here.
  assert.equal((await call(db, HOLDER, 'POST', '', { project_uid: 'p8', kind: 'mark', reason: 'x' })).status, 403, 'not held: 403');
  assert.equal((await call(db, HOLDER, 'POST', '', { project_uid: 'p8', kind: 'mark', reason: 'x' })).body.code, 'not_held');
  assert.equal((await call(db, PLEDGED, 'POST', '', { project_uid: 'p7', kind: 'mark', reason: 'x' })).status, 403, 'an unconfirmed commitment holds nothing');
  assert.equal((await call(db, HOLDER, 'POST', '', { project_uid: 'nope', kind: 'mark', reason: 'x' })).status, 403, 'an unknown company answers like an unheld one');
  assert.equal((await call(db, ADMIN, 'POST', '', { project_uid: 'p7', kind: 'mark', reason: 'x' })).body.code, 'investor_only');
  assert.equal((await call(db, FOUNDER, 'POST', '', { project_uid: 'p7', kind: 'mark', reason: 'x' })).status, 403);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM portfolio_mark_requests').get() as any).n, 0);
});

test('POST: a reason and a known kind are required', async () => {
  const db = fixture();
  assert.equal((await call(db, HOLDER, 'POST', '', { project_uid: 'p7', kind: 'mark', reason: '   ' })).body.code, 'reason_required');
  assert.equal((await call(db, HOLDER, 'POST', '', { project_uid: 'p7', kind: 'valuation', reason: 'x' })).body.code, 'bad_kind');
  assert.equal((await call(db, HOLDER, 'POST', '', { project_uid: 'p7', kind: 'mark', reason: 'x'.repeat(2001) })).body.code, 'reason_too_long');
});

test('POST: one open request per company per investor; a second answers 409 with the open one; after an answer a new one is allowed', async () => {
  const db = fixture();
  const first = await quiet(() => call(db, HOLDER, 'POST', '', { project_uid: 'p7', kind: 'mark', reason: 'stale' }));
  const second = await call(db, HOLDER, 'POST', '', { project_uid: 'p7', kind: 'correction', reason: 'wrong' });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'request_open');
  assert.equal(second.body.request.uid, first.body.uid);
  await quiet(() => call(db, ADMIN, 'PATCH', `/${first.body.uid}`, { state: 'resolved', mark_uid: 'm7' }));
  assert.equal((await quiet(() => call(db, HOLDER, 'POST', '', { project_uid: 'p7', kind: 'correction', reason: 'wrong' }))).status, 201);
});

test('the store holds the one-open rule by itself: a second open row for the same pair is refused by the index', () => {
  const db = fixture();
  const ins = db.prepare(`INSERT INTO portfolio_mark_requests (uid, project_id, requester_user_id, kind, reason, state, created_at, updated_at)
    VALUES (?, 7, ${HOLDER}, 'mark', 'r', 'open', '2026-11-14', '2026-11-14')`);
  ins.run('a');
  assert.throws(() => ins.run('b'), /UNIQUE constraint failed/, 'a race keeps one');
  // An answered row says who and when; an open one carries no answer.
  assert.throws(() => db.prepare(`UPDATE portfolio_mark_requests SET state = 'resolved' WHERE uid = 'a'`).run(), /CHECK constraint failed/);
});

test('GET: an investor reads only their own requests; an admin reads every one with who asked; a founder is 403', async () => {
  const db = fixture();
  await quiet(() => call(db, HOLDER, 'POST', '', { project_uid: 'p7', kind: 'mark', reason: 'h' }));
  await quiet(() => call(db, OTHER, 'POST', '', { project_uid: 'p8', kind: 'follow_on', reason: 'o' }));
  const mine = await call(db, HOLDER, 'GET', '');
  // mutation: LIST bound with null for the investor (no requester filter) → two items here.
  assert.deepEqual(mine.body.items.map((x: any) => x.project_uid), ['p7'], 'an investor reads only their own');
  assert.equal(mine.body.scope, 'own_requests');
  const all = await call(db, ADMIN, 'GET', '?state=open');
  assert.deepEqual(all.body.items.map((x: any) => x.project_uid).sort(), ['p7', 'p8']);
  assert.equal(all.body.items.find((x: any) => x.project_uid === 'p8').requester.name, 'Oli');
  assert.equal((await call(db, FOUNDER, 'GET', '')).status, 403);
});

test('PATCH: an admin resolves with the mark recorded (same company only), the investor is told, and an answered request stays answered', async () => {
  const db = fixture();
  const req = (await quiet(() => call(db, HOLDER, 'POST', '', { project_uid: 'p7', kind: 'correction', reason: 'FMV is wrong' }))).body;
  // mutation: requireAdmin → requireAuth lets the holder answer their own request.
  assert.equal((await call(db, HOLDER, 'PATCH', `/${req.uid}`, { state: 'resolved', mark_uid: 'm7' })).status, 403, 'PATCH is admin only');
  assert.equal((await call(db, ADMIN, 'PATCH', `/${req.uid}`, { state: 'resolved', mark_uid: 'm8' })).body.code, 'mark_not_found', 'another company’s mark is not a link');
  assert.equal((await call(db, ADMIN, 'PATCH', `/${req.uid}`, { state: 'resolved' })).body.code, 'mark_required');
  const done = await quiet(() => call(db, ADMIN, 'PATCH', `/${req.uid}`, { state: 'resolved', mark_uid: 'm7', note: 'Re-marked at the June round.' }));
  assert.equal(done.status, 200);
  assert.equal(done.body.state, 'resolved');
  assert.equal(done.body.resolved_mark_uid, 'm7');
  assert.ok(done.body.resolved_at);
  assert.equal(inbox(db, HOLDER, 'portfolio_mark_request_answered'), 1);
  assert.equal((await call(db, ADMIN, 'PATCH', `/${req.uid}`, { state: 'declined', note: 'no' })).status, 409);
  const read = (await call(db, HOLDER, 'GET', '')).body.items[0];
  assert.equal(read.state, 'resolved');
  assert.equal(read.resolved_mark_uid, 'm7');
});

test('PATCH: a decline, and a follow-on resolved, each need a note', async () => {
  const db = fixture();
  const a = (await quiet(() => call(db, HOLDER, 'POST', '', { project_uid: 'p7', kind: 'follow_on', reason: 'Series A missing' }))).body;
  assert.equal((await call(db, ADMIN, 'PATCH', `/${a.uid}`, { state: 'resolved' })).body.code, 'note_required');
  assert.equal((await quiet(() => call(db, ADMIN, 'PATCH', `/${a.uid}`, { state: 'resolved', note: 'Round recorded.' }))).status, 200);
  const b = (await quiet(() => call(db, OTHER, 'POST', '', { project_uid: 'p8', kind: 'mark', reason: 'stale' }))).body;
  assert.equal((await call(db, ADMIN, 'PATCH', `/${b.uid}`, { state: 'declined' })).body.code, 'note_required');
  assert.equal((await call(db, ADMIN, 'PATCH', '/missing', { state: 'declined', note: 'x' })).status, 404);
});
