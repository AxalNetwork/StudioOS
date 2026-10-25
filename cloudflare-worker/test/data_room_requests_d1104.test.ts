/**
 * D1104 (#2984) — Data room part 3, on real SQLite: access requests in one
 * queue (migration 595) from the round call and the deal page, and the
 * founder-sent three-way NDA.
 *
 * The data-room tables are cut from `sql/schema_baseline.sql` and the
 * migrations that changed them (594, 595), and the round-call tables from
 * 436, so a query naming a column production does not have fails here too.
 *
 * Held from both sides:
 *   · a round-call request lands in the queue once, however often it is
 *     made, and never for an investor who already has the room;
 *   · accept writes one grant (with part 2's folders and end date) and a
 *     decided request answers 409 and writes nothing;
 *   · decline keeps the reason and tells the investor, and the reason is in
 *     no log;
 *   · only the owner answers; a co-founder reads; anyone else gets 404;
 *   · the founder's NDA is refused when one is live or out for signature,
 *     and to anyone but the venture's founder.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/data_room_requests_d1104.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withGrantFolders } from './_data_room_scope.mjs';

import dataRoom from '../src/routes/data_room.ts';
import { dealPageRequestStatement, roundCallRequestStatement } from '../src/services/dataRoomRequests.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIG436 = read('cloudflare-worker/sql/migrations/436_round_calls.sql');
const MIG595 = read('cloudflare-worker/sql/migrations/595_data_room_access_requests.sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = 1;   // founders row 100, owns p-room
const ASKER = 2;     // investor who asked from the round call
const HOLDER = 3;    // investor with a live grant already
const RIVAL = 4;     // a founder who owns p-rival
const COFOUNDER = 5; // accepted co-founder of p-room
const LATER = 6;     // investor who asks from the deal page
const ADMIN = 7;     // an admin: owner by tenancy, not the venture's founder

const iso = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => iso(new Date(Date.now() + n * 86400_000));

const MIG595_TABLE = stripForeignKeys(MIG595.slice(0, MIG595.indexOf('INSERT OR IGNORE')));
const MIG595_BACKFILL = MIG595.slice(MIG595.indexOf('INSERT OR IGNORE'));

function baseDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, uid TEXT UNIQUE NOT NULL, name TEXT,
      founder_id INTEGER, company_id INTEGER, deleted_at TEXT
    );
  `);
  for (const t of ['data_room_grants', 'data_room_files', 'data_room_folders', 'data_room_access_log', 'pairwise_ndas',
    'project_members', 'activity_logs', 'notifications_inbox']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  withGrantFolders(db);
  db.exec(stripForeignKeys(MIG436));
  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?,?,?,?,?)');
  u.run(FOUNDER, 'founder', 100, 'Fran', 'fran@example.com');
  u.run(ASKER, 'investor', null, 'Asha', 'asha@example.com');
  u.run(HOLDER, 'investor', null, 'Hol', 'hol@example.com');
  u.run(RIVAL, 'founder', 200, 'Rae', 'rae@example.com');
  u.run(COFOUNDER, 'founder', 300, 'Cora', 'cora@example.com');
  u.run(LATER, 'investor', null, 'Lat', 'lat@example.com');
  u.run(ADMIN, 'admin', null, 'Ada', 'ada@example.com');
  const p = db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?,?,?,?)');
  p.run(7, 'p-room', 'Roomco', 100);
  p.run(9, 'p-rival', 'Rivalco', 200);
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (7, ?, 'cofounder', 'accepted')`).run(COFOUNDER);
  db.prepare(`INSERT INTO data_room_folders (id, uid, project_id, parent_id, name, visibility) VALUES (51, 'd-fin', 7, NULL, 'Financials', 'open')`).run();
  db.prepare(`INSERT INTO data_room_grants (id, uid, project_id, investor_user_id, granted_by_user_id, status) VALUES (1, 'g-holder', 7, ?, ?, 'active')`).run(HOLDER, FOUNDER);
  // A round call on p-room, sent to the asker and the holder.
  db.prepare(`INSERT INTO round_calls (id, uid, project_id, name, amount_cents, instrument, terms, minimum_cheque_cents, target_close, terms_hash, created_by, state)
              VALUES (1, 'call-1', 7, 'Seed round', 100000000, 'safe', 'Terms', 100000, '2099-01-01', 'h', ?, 'sent')`).run(FOUNDER);
  const r = db.prepare(`INSERT INTO round_call_recipients (id, call_id, investor_user_id, origin, data_room_requested_at, response_claim) VALUES (?, 1, ?, 'chosen', ?, ?)`);
  r.run(11, ASKER, '2026-10-20 10:00:00', 'claim-a');
  r.run(12, HOLDER, '2026-10-21 10:00:00', 'claim-h');
  return db;
}

/** A room with the queue made and backfilled, as production has it after migration 595. */
function freshDb() {
  const db = baseDb();
  db.exec(MIG595_TABLE);
  db.exec(MIG595_BACKFILL);
  return db;
}

const ROLE: Record<number, string> = {
  [FOUNDER]: 'founder', [ASKER]: 'investor', [HOLDER]: 'investor', [RIVAL]: 'founder', [COFOUNDER]: 'founder', [LATER]: 'investor', [ADMIN]: 'admin',
};
async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: ROLE[userId] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
async function call(db: any, userId: number, method: string, path: string, body?: unknown) {
  const res = await dataRoom.fetch(
    new Request(`http://x${path}`, {
      method,
      headers: { Authorization: `Bearer ${await token(userId)}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES: { put: async () => {}, delete: async () => {} } } as any,
  );
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null };
}
const env = (db: any) => ({ DB: d1Over(db) }) as any;
const requests = (db: any) => db.prepare('SELECT * FROM data_room_access_requests ORDER BY id').all() as any[];
const grantsOf = (db: any, investor: number) => db.prepare('SELECT * FROM data_room_grants WHERE project_id = 7 AND investor_user_id = ?').all(investor) as any[];
const activity = (db: any, action: string) => db.prepare('SELECT entity_id, details FROM activity_logs WHERE action = ?').all(action) as any[];
const inbox = (db: any, userId: number) => db.prepare('SELECT title, body FROM notifications_inbox WHERE user_id = ?').all(userId) as any[];
const askerUid = (db: any) => db.prepare('SELECT uid FROM data_room_access_requests WHERE investor_user_id = ?').get(ASKER).uid as string;

/* ------------------------------------------------------------------ *
 * The migration and the writers
 * ------------------------------------------------------------------ */

test('migration 595 backfills one row per investor and venture: open when they have no room, accepted (who and when not recorded) when they do', () => {
  const db = freshDb();
  const rows = requests(db);
  assert.deepEqual(rows.map((q) => [q.investor_user_id, q.source, q.round_call_id, q.state, q.decided_by, q.decided_at, q.created_at]), [
    [ASKER, 'round_call', 1, 'open', null, null, '2026-10-20 10:00:00'],
    [HOLDER, 'round_call', 1, 'accepted', null, null, '2026-10-21 10:00:00'],
  ]);
  db.exec(MIG595_BACKFILL);
  assert.equal(requests(db).length, 2, 'a re-run of the backfill added rows');
});

test('the backfill takes each investor once across two calls, dated by the earliest', () => {
  const db = baseDb();
  db.prepare(`INSERT INTO round_calls (id, uid, project_id, name, amount_cents, instrument, terms, minimum_cheque_cents, target_close, terms_hash, created_by, state)
              VALUES (2, 'call-2', 7, 'Bridge', 100000000, 'safe', 'Terms', 100000, '2099-01-01', 'h2', ?, 'sent')`).run(FOUNDER);
  db.prepare(`INSERT INTO round_call_recipients (call_id, investor_user_id, origin, data_room_requested_at) VALUES (2, ?, 'chosen', '2026-10-01 09:00:00')`).run(ASKER);
  db.exec(MIG595_TABLE);
  db.exec(MIG595_BACKFILL);
  const asker = requests(db).filter((q) => q.investor_user_id === ASKER);
  assert.equal(asker.length, 1);
  assert.equal(asker[0].created_at, '2026-10-01 09:00:00');
});

test('one open request per investor and venture: the round call and the deal page asking again are the same row', async () => {
  const db = freshDb();
  const e = env(db);
  await e.DB.batch([roundCallRequestStatement(e, { callId: 1, projectId: 7, investorUserId: ASKER, recipientId: 11, claim: 'claim-a', at: '2026-10-25 10:00:00' })]);
  await e.DB.batch([dealPageRequestStatement(e, { projectId: 7, investorUserId: ASKER, message: 'Again', at: '2026-10-25 11:00:00' })]);
  assert.equal(requests(db).filter((q) => q.investor_user_id === ASKER).length, 1);
  // The deal page's first ask is its own row, with the investor's words.
  await e.DB.batch([dealPageRequestStatement(e, { projectId: 7, investorUserId: LATER, message: '  We met at demo day.  ', at: '2026-10-25 12:00:00' })]);
  const later = requests(db).filter((q) => q.investor_user_id === LATER);
  assert.deepEqual(later.map((q) => [q.source, q.message, q.state]), [['deal_page', 'We met at demo day.', 'open']]);
});

test('no request for an investor who already holds the room, and none when the response claim did not hold', async () => {
  const db = freshDb();
  db.exec("DELETE FROM data_room_access_requests");
  const e = env(db);
  await e.DB.batch([dealPageRequestStatement(e, { projectId: 7, investorUserId: HOLDER, at: '2026-10-25 10:00:00' })]);
  await e.DB.batch([roundCallRequestStatement(e, { callId: 1, projectId: 7, investorUserId: HOLDER, recipientId: 12, claim: 'claim-h', at: '2026-10-25 10:00:00' })]);
  assert.equal(requests(db).length, 0, 'a request for someone who has the room');
  await e.DB.batch([roundCallRequestStatement(e, { callId: 1, projectId: 7, investorUserId: ASKER, recipientId: 11, claim: 'a-stale-claim', at: '2026-10-25 10:00:00' })]);
  assert.equal(requests(db).length, 0, 'a refused response left a request behind');
  await e.DB.batch([roundCallRequestStatement(e, { callId: 1, projectId: 7, investorUserId: ASKER, recipientId: 11, claim: 'claim-a', at: '2026-10-25 10:00:00' })]);
  assert.equal(requests(db).length, 1);
});

test('the round call\'s respond writes the request in its own batch, under its own claim', () => {
  const src = read('cloudflare-worker/src/services/roundCalls.ts');
  assert.match(src, /if\(action==='data_room'\) statements\.push\(roundCallRequestStatement\(env,\{callId:call\.id,projectId:call\.project_id,investorUserId:investor\.id,recipientId:recipient\.id,claim,at\}\)\);/);
  // It is pushed after the response's own update, which stays statement 0 (the claim check reads result[0]).
  assert.ok(src.indexOf('roundCallRequestStatement(env,') > src.indexOf('const statements=['));
  assert.ok(src.indexOf('roundCallRequestStatement(env,') < src.indexOf('const result=await env.DB.batch(statements);'));
});

/* ------------------------------------------------------------------ *
 * The queue read
 * ------------------------------------------------------------------ */

test('the queue: open first, each with its investor, call, NDA and whether they have the room; a co-founder reads it but cannot answer', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (?, ?, 'pending')`).run(FOUNDER, ASKER);
  const res = await call(db, FOUNDER, 'GET', '/p-room/requests');
  assert.equal(res.status, 200);
  assert.equal(res.body.open, 1);
  assert.equal(res.body.can_answer, true);
  const [first, second] = res.body.requests;
  assert.deepEqual([first.investor, first.source, first.round_call, first.state, first.nda, first.has_access],
    [{ id: ASKER, name: 'Asha', email: 'asha@example.com' }, 'round_call', { uid: 'call-1', name: 'Seed round' }, 'open', 'pending', false]);
  assert.deepEqual([second.investor.id, second.state, second.decided_by, second.decided_at, second.has_access], [HOLDER, 'accepted', null, null, true]);
  const cof = await call(db, COFOUNDER, 'GET', '/p-room/requests');
  assert.equal(cof.status, 200);
  assert.equal(cof.body.can_answer, false);
  for (const id of [RIVAL, ASKER, LATER]) assert.equal((await call(db, id, 'GET', '/p-room/requests')).status, 404, String(id));
});

test('the queue failing to read is 503 with a sentence, never an empty queue', async () => {
  const db = baseDb(); // no migration 595: the store does not answer
  const res = await call(db, FOUNDER, 'GET', '/p-room/requests');
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'requests_unreadable');
  assert.match(res.body.detail, /not a claim that nobody asked/);
  assert.equal(res.body.requests, undefined);
});

/* ------------------------------------------------------------------ *
 * Accept and decline
 * ------------------------------------------------------------------ */

test('accept writes one grant, with the folders and end date given, logs it and tells the investor; a decided request answers 409 and writes nothing', async () => {
  const db = freshDb();
  const uid = askerUid(db);
  const end = inDays(30);
  const res = await call(db, FOUNDER, 'POST', `/p-room/requests/${uid}/accept`, { expires_at: end, folders: ['d-fin'] });
  assert.equal(res.status, 200);
  assert.equal(res.body.state, 'accepted');
  const grants = grantsOf(db, ASKER);
  assert.equal(grants.length, 1);
  assert.deepEqual([grants[0].status, grants[0].granted_by_user_id, grants[0].expires_at, grants[0].folders_scoped], ['active', FOUNDER, `${end} 23:59:59`, 1]);
  assert.deepEqual(db.prepare('SELECT folder_id FROM data_room_grant_folders WHERE grant_id = ?').all(grants[0].id).map((r: any) => r.folder_id), [51]);
  const q = requests(db).find((x) => x.uid === uid);
  assert.deepEqual([q.state, q.decided_by, typeof q.decided_at], ['accepted', FOUNDER, 'string']);
  assert.equal(activity(db, 'access_request_accepted').length, 1);
  assert.match(inbox(db, ASKER).map((n) => n.title).join('|'), /Your data room request was accepted/);

  for (const path of [`/p-room/requests/${uid}/accept`, `/p-room/requests/${uid}/decline`]) {
    const again = await call(db, FOUNDER, 'POST', path, { reason: 'Changed my mind' });
    assert.equal(again.status, 409, path);
    assert.equal(again.body.code, 'request_decided');
  }
  assert.equal(grantsOf(db, ASKER).length, 1, 'a decided request wrote a second grant');
  assert.equal(activity(db, 'access_request_accepted').length, 1);
  assert.equal(requests(db).find((x) => x.uid === uid).state, 'accepted', 'the decline overwrote the accept');
});

test('accept checks the grant fields before claiming: a bad end date or an unknown folder leaves the request open', async () => {
  const db = freshDb();
  const uid = askerUid(db);
  assert.equal((await call(db, FOUNDER, 'POST', `/p-room/requests/${uid}/accept`, { expires_at: '2020-01-01' })).status, 400);
  assert.equal((await call(db, FOUNDER, 'POST', `/p-room/requests/${uid}/accept`, { folders: ['d-nowhere'] })).status, 404);
  assert.equal(requests(db).find((x) => x.uid === uid).state, 'open');
  assert.equal(grantsOf(db, ASKER).length, 0);
});

test('when the grant cannot be written the claim is put back: the request is open again and no grant exists', async () => {
  const db = freshDb();
  const uid = askerUid(db);
  db.exec('DROP TABLE data_room_grant_folders');
  const res = await call(db, FOUNDER, 'POST', `/p-room/requests/${uid}/accept`, { folders: ['d-fin'] });
  assert.ok(res.status >= 400 && res.status !== 409, String(res.status));
  // The folder table is gone, so the scope statements fail and the batch rolls back.
  const q = requests(db).find((x) => x.uid === uid);
  assert.deepEqual([q.state, q.decided_by, q.decided_at], ['open', null, null]);
  assert.equal(grantsOf(db, ASKER).length, 0);
});

test('decline keeps the reason and tells the investor; the reason is in no log; an empty or overlong reason is refused', async () => {
  const db = freshDb();
  const uid = askerUid(db);
  assert.equal((await call(db, FOUNDER, 'POST', `/p-room/requests/${uid}/decline`, { reason: '   ' })).body.code, 'reason_required');
  const long = await call(db, FOUNDER, 'POST', `/p-room/requests/${uid}/decline`, { reason: 'x'.repeat(501) });
  assert.deepEqual([long.status, long.body.code], [400, 'reason_required']);
  assert.equal(requests(db).find((x) => x.uid === uid).state, 'open');
  const reason = 'We are only opening the room to lead investors this round.';
  const res = await call(db, FOUNDER, 'POST', `/p-room/requests/${uid}/decline`, { reason: `  ${reason}  ` });
  assert.equal(res.status, 200);
  const q = requests(db).find((x) => x.uid === uid);
  assert.deepEqual([q.state, q.decline_reason, q.decided_by], ['declined', reason, FOUNDER]);
  assert.equal(grantsOf(db, ASKER).length, 0);
  const told = inbox(db, ASKER);
  assert.ok(told.some((n) => n.title === 'Your data room request was declined' && n.body.includes(reason)), 'the investor was not told why');
  const logged = activity(db, 'access_request_declined');
  assert.equal(logged.length, 1);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM activity_logs').all()).includes('lead investors'), 'the reason reached a log');
  assert.equal((await call(db, FOUNDER, 'POST', `/p-room/requests/${uid}/accept`, {})).status, 409);
  assert.equal(grantsOf(db, ASKER).length, 0);
});

test('only the owner answers: a co-founder gets 403, an investor or another founder 404, and another venture\'s request is not found', async () => {
  const db = freshDb();
  const uid = askerUid(db);
  const cof = await call(db, COFOUNDER, 'POST', `/p-room/requests/${uid}/accept`, {});
  assert.equal(cof.status, 403);
  assert.equal(cof.body.code, 'owner_only');
  assert.equal((await call(db, COFOUNDER, 'POST', `/p-room/requests/${uid}/decline`, { reason: 'Not now, sorry.' })).status, 403);
  for (const id of [ASKER, RIVAL, LATER]) assert.equal((await call(db, id, 'POST', `/p-room/requests/${uid}/accept`, {})).status, 404, String(id));
  assert.equal((await call(db, RIVAL, 'POST', `/p-rival/requests/${uid}/accept`, {})).status, 404, 'a request answered from another venture');
  assert.equal(requests(db).find((x) => x.uid === uid).state, 'open');
  assert.equal(grantsOf(db, ASKER).length, 0);
});

/* ------------------------------------------------------------------ *
 * The founder's NDA
 * ------------------------------------------------------------------ */

test('the founder\'s NDA is refused when one is in force or out for signature, for a grant that is not live, and to anyone but the venture\'s founder', async () => {
  const db = freshDb();
  // Live NDA → 409 nda_active.
  db.prepare(`INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (?, ?, 'active')`).run(FOUNDER, HOLDER);
  const live = await call(db, FOUNDER, 'POST', '/p-room/grants/g-holder/nda');
  assert.equal(live.status, 409);
  assert.equal(live.body.code, 'nda_active');
  // Out for signature → 409 nda_pending.
  db.exec(`UPDATE pairwise_ndas SET status = 'pending'`);
  const pending = await call(db, FOUNDER, 'POST', '/p-room/grants/g-holder/nda');
  assert.equal(pending.body.code, 'nda_pending');
  db.exec('DELETE FROM pairwise_ndas');
  // Not the venture's founder: a co-founder is not the owner; an admin owns by tenancy but is not party A.
  assert.equal((await call(db, COFOUNDER, 'POST', '/p-room/grants/g-holder/nda')).body.code, 'owner_only');
  for (const id of [ASKER, RIVAL, HOLDER]) assert.equal((await call(db, id, 'POST', '/p-room/grants/g-holder/nda')).status, 404, String(id));
  // A grant that is revoked, expired, or another venture's is not found.
  db.exec(`UPDATE data_room_grants SET status = 'revoked' WHERE uid = 'g-holder'`);
  assert.equal((await call(db, FOUNDER, 'POST', '/p-room/grants/g-holder/nda')).status, 404);
  db.exec(`UPDATE data_room_grants SET status = 'active', expires_at = '2020-01-01 23:59:59' WHERE uid = 'g-holder'`);
  assert.equal((await call(db, FOUNDER, 'POST', '/p-room/grants/g-holder/nda')).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pairwise_ndas').get().n, 0, 'a refusal wrote an NDA row');
});

test('the admin who owns the room by tenancy is not party A: founder_only, and nothing is sent', async () => {
  const db = freshDb();
  // The admin passes the owner check (tenancy admits admins) and is refused as not the venture's founder.
  const res = await call(db, ADMIN, 'POST', '/p-room/grants/g-holder/nda');
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body.code, 'founder_only');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pairwise_ndas').get().n, 0);
});

test('the founder sends the NDA for a live grant: party A is the founder, the founder gets only their own signing link, the investor is told', async () => {
  const db = freshDb();
  const res = await call(db, FOUNDER, 'POST', '/p-room/grants/g-holder/nda');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, 'envelope_issued');
  const signers = db.prepare('SELECT recipient_email, signing_token FROM esign_recipients').all() as any[];
  const founderToken = signers.find((s) => s.recipient_email === 'fran@example.com').signing_token;
  assert.ok(res.body.signing_url.endsWith(`/esign/${founderToken}`), 'not the founder\'s own link');
  for (const s of signers.filter((x) => x.recipient_email !== 'fran@example.com')) assert.ok(!JSON.stringify(res.body).includes(s.signing_token), 'another party\'s signing token was returned');
  const nda = db.prepare('SELECT party_a_user_id, party_b_user_id, status, nda_envelope_uuid FROM pairwise_ndas').all() as any[];
  assert.deepEqual(nda.map((n) => [n.party_a_user_id, n.party_b_user_id, n.status, n.nda_envelope_uuid]), [[FOUNDER, HOLDER, 'pending', res.body.envelope_uuid]]);
  assert.ok(inbox(db, HOLDER).some((n) => n.title === 'An NDA to sign'));
  assert.equal(activity(db, 'nda_sent').length, 1);
  // A second press finds it out for signature.
  assert.equal((await call(db, FOUNDER, 'POST', '/p-room/grants/g-holder/nda')).body.code, 'nda_pending');
});
