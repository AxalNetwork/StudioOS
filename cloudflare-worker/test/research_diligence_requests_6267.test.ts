/**
 * #6267 — `GET /api/research/diligence` returns the investor's own room requests, and each room
 * (list and room page) says where its NDA stands. Run against real SQLite; the request store is
 * migration 595's table cut from the file, the grants and NDAs are the baseline's.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_diligence_requests_6267.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { tableFromBaseline, stripForeignKeys, addColumnsFrom } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withGrantFolders } from './_data_room_scope.mjs';
import { AI_LOG_SCHEMA, AI_BUDGET_MIGRATION } from './_ai_budget_fixture.mjs';
import research from '../src/routes/research.ts';
import { ventureNdaStatus } from '../src/services/dealAccess.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIG463 = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/463_raise_record_stores.sql'), 'utf8');
const MIG595 = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/595_data_room_access_requests.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 1, ME = 2, OTHER = 3;

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT UNIQUE NOT NULL, name TEXT, founder_id INTEGER, deleted_at TEXT);
    CREATE TABLE round_calls (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL);
    CREATE TABLE round_call_recipients (id INTEGER PRIMARY KEY, call_id INTEGER NOT NULL, investor_user_id INTEGER NOT NULL);
    CREATE TABLE deals (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL);
    CREATE TABLE deal_invitations (id INTEGER PRIMARY KEY, deal_id INTEGER NOT NULL, investor_user_id INTEGER NOT NULL);
    CREATE TABLE commitments (id INTEGER PRIMARY KEY, deal_id INTEGER NOT NULL, investor_user_id INTEGER NOT NULL);
  `);
  for (const t of ['data_room_grants', 'data_room_files', 'data_room_folders', 'data_room_access_log', 'pairwise_ndas', 'raise_prospects']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  addColumnsFrom(db, stripForeignKeys(MIG463), 'data_room_files');
  withGrantFolders(db);
  const start = MIG595.indexOf('CREATE TABLE IF NOT EXISTS data_room_access_requests');
  db.exec(stripForeignKeys(MIG595.slice(start, MIG595.indexOf('INSERT OR IGNORE', start))));
  db.exec(AI_LOG_SCHEMA + AI_BUDGET_MIGRATION);
  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?,?,?,?,?)');
  u.run(FOUNDER, 'founder', 100, 'Founder', 'founder@example.test');
  u.run(ME, 'investor', null, 'Me', 'me@example.test');
  u.run(OTHER, 'investor', null, 'Other', 'other@example.test');
  const p = db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?,?,?,?)');
  p.run(7, 'p-room', 'Roomco', 100);       // a live grant: a room, not a request
  p.run(8, 'p-call', 'Callco', 100);       // asked from a round call I received
  p.run(9, 'p-deal', 'Dealco', 100);       // asked from a deal I am invited to
  p.run(10, 'p-gone', 'Goneco', 100);      // asked from a deal I can no longer open
  p.run(11, 'p-revoked', 'Revokedco', 100); // accepted, then the grant was revoked
  db.exec(`
    INSERT INTO data_room_grants (uid, project_id, investor_user_id, granted_by_user_id, status) VALUES ('g-room', 7, ${ME}, ${FOUNDER}, 'active'), ('g-revoked', 11, ${ME}, ${FOUNDER}, 'revoked');
    INSERT INTO round_calls (id, project_id) VALUES (40, 8);
    INSERT INTO round_call_recipients (call_id, investor_user_id) VALUES (40, ${ME});
    INSERT INTO deals (id, project_id) VALUES (50, 9), (51, 10);
    INSERT INTO deal_invitations (deal_id, investor_user_id) VALUES (50, ${ME});
    INSERT INTO data_room_access_requests (uid, project_id, investor_user_id, source, round_call_id, state, created_at) VALUES
      ('q-accepted', 7, ${ME}, 'deal_page', NULL, 'accepted', '2026-11-01 10:00:00'),
      ('q-accepted-revoked', 11, ${ME}, 'deal_page', NULL, 'accepted', '2026-11-01 11:00:00'),
      ('q-call', 8, ${ME}, 'round_call', 40, 'open', '2026-11-02 10:00:00'),
      ('q-deal', 9, ${ME}, 'deal_page', NULL, 'declined', '2026-11-03 10:00:00'),
      ('q-gone', 10, ${ME}, 'deal_page', NULL, 'open', '2026-11-04 10:00:00'),
      ('q-theirs', 9, ${OTHER}, 'deal_page', NULL, 'open', '2026-11-05 10:00:00');
    UPDATE data_room_access_requests SET decided_at = '2026-11-03 12:00:00', decline_reason = 'Not raising from new funds this round.' WHERE uid = 'q-deal';
  `);
  return db;
}

async function get(db: any, userId: number, path: string, DB: any = d1Over(db)) {
  const tok = await new SignJWT({ user_id: userId, role: 'investor' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await research.fetch(new Request(`http://x${path}`, { headers: { Authorization: `Bearer ${tok}` } }), { JWT_SECRET, ENVIRONMENT: 'development', DB } as any);
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null, raw };
}

// Mutation checked: the investor filter dropped (fails); accepted requests kept (fails); the live-grant
// filter dropped (fails); the decline reason dropped (fails).
test('#6267: only my open and declined requests that no live grant answers; a declined one carries its reason and date', async () => {
  const db = freshDb();
  const r = await get(db, ME, '/diligence');
  assert.equal(r.status, 200);
  assert.equal(r.body.requests_unreadable, false);
  assert.deepEqual(r.body.requests.map((q: any) => q.uid), ['q-gone', 'q-deal', 'q-call'], 'newest first; no accepted one; never another investor\'s');
  assert.ok(!r.raw.includes('q-theirs'), 'another investor\'s request was returned');
  assert.ok(!r.raw.includes('q-accepted'), 'an accepted request is the room, not a request, even after the grant is revoked');
  assert.deepEqual(r.body.items.map((i: any) => i.grant_uid), ['g-room']);
  const declined = r.body.requests.find((q: any) => q.uid === 'q-deal');
  assert.deepEqual(declined, { uid: 'q-deal', project_name: 'Dealco', state: 'declined', created_at: '2026-11-03 10:00:00', decided_at: '2026-11-03 12:00:00', decline_reason: 'Not raising from new funds this round.', source: 'deal_page' });
  // An open request on a venture where I now hold a live grant is answered: it is the room.
  db.exec(`INSERT INTO data_room_grants (uid, project_id, investor_user_id, granted_by_user_id, status) VALUES ('g-call', 8, ${ME}, ${FOUNDER}, 'active')`);
  assert.ok(!(await get(db, ME, '/diligence')).body.requests.some((q: any) => q.uid === 'q-call'));
  // Another investor sees only their own.
  assert.deepEqual((await get(db, OTHER, '/diligence')).body.requests.map((q: any) => q.uid), ['q-theirs']);
});

// Mutation checked: every name returned (fails); the round-call recipient check dropped (fails); no name for a deal request (fails); a deleted venture named (fails).
test('#6267: a venture is named only where the round call or deal that produced the request showed it', async () => {
  const db = freshDb();
  const names = Object.fromEntries((await get(db, ME, '/diligence')).body.requests.map((q: any) => [q.uid, q.project_name]));
  assert.deepEqual(names, { 'q-call': 'Callco', 'q-deal': 'Dealco', 'q-gone': null });
  // The call's recipient is someone else: it never named the venture to me.
  db.exec(`UPDATE round_call_recipients SET investor_user_id = ${OTHER}`);
  assert.equal((await get(db, ME, '/diligence')).body.requests.find((q: any) => q.uid === 'q-call').project_name, null);
  // A commitment on the deal is a relationship too (the deal page's rule).
  db.exec(`INSERT INTO commitments (deal_id, investor_user_id) VALUES (51, ${ME})`);
  assert.equal((await get(db, ME, '/diligence')).body.requests.find((q: any) => q.uid === 'q-gone').project_name, 'Goneco');
  // A deleted venture is never named.
  db.exec(`UPDATE projects SET deleted_at = '2026-11-10' WHERE id = 9`);
  assert.equal((await get(db, ME, '/diligence')).body.requests.find((q: any) => q.uid === 'q-deal').project_name, null);
});

// Mutation checked: the failure caught into [] (fails).
test('#6267: a failed request read answers requests: null with requests_unreadable, and the rooms still answer', async () => {
  const db = freshDb();
  const raw = d1Over(db);
  const DB = { ...raw, prepare(sql: string) { if (/FROM data_room_access_requests q/.test(sql)) throw new Error('D1_ERROR'); return raw.prepare(sql); } };
  const r = await get(db, ME, '/diligence', DB);
  assert.equal(r.status, 200);
  assert.equal(r.body.requests, null, 'never an empty list');
  assert.equal(r.body.requests_unreadable, true);
  assert.deepEqual(r.body.items.map((i: any) => i.grant_uid), ['g-room']);
});

// Mutation checked: on_file and out_for_signature swapped (fails); a lapsed NDA kept as on file (fails);
// the room page without nda (fails); the list without nda (fails); another investor's NDA read as mine (fails).
// (pairwise_ndas holds one row per pair, so each state is the same row changed.)
test('#6267: each room, in the list and on its page, says where its NDA stands', async () => {
  const db = freshDb();
  const list = async () => (await get(db, ME, '/diligence')).body.items[0].nda;
  const room = async () => (await get(db, ME, '/diligence/g-room')).body.nda;
  assert.deepEqual(await list(), { status: 'none', valid_until: null });
  assert.deepEqual(await room(), { status: 'none', valid_until: null });
  db.exec(`INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (${FOUNDER}, ${ME}, 'pending')`);
  assert.deepEqual(await list(), { status: 'out_for_signature', valid_until: null });
  db.exec(`UPDATE pairwise_ndas SET status = 'active', valid_until = '2099-01-01T00:00:00Z' WHERE party_b_user_id = ${ME}`);
  assert.deepEqual(await list(), { status: 'on_file', valid_until: '2099-01-01T00:00:00Z' });
  assert.deepEqual(await room(), { status: 'on_file', valid_until: '2099-01-01T00:00:00Z' });
  db.exec(`UPDATE pairwise_ndas SET valid_until = '2020-01-01T00:00:00Z' WHERE status = 'active'`);
  assert.deepEqual(await list(), { status: 'none', valid_until: null }, 'a lapsed NDA is not on file');
  // Another investor's NDA with the founder is never mine.
  db.exec(`DELETE FROM pairwise_ndas; INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (${FOUNDER}, ${OTHER}, 'active')`);
  assert.deepEqual(await list(), { status: 'none', valid_until: null });
});

// The move kept the deal page's answer: the same shape the room door has returned since D1153.
test('#6267: ventureNdaStatus is the deal page\'s read, moved, and deal_workroom.ts no longer holds its own copy', async () => {
  const db = freshDb();
  const env = { DB: d1Over(db) } as any;
  assert.equal(await ventureNdaStatus(env, 7, ME), null);
  db.exec(`INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (${FOUNDER}, ${ME}, 'partially_signed')`);
  assert.deepEqual(await ventureNdaStatus(env, 7, ME), { status: 'out_for_signature', valid_until: null });
  const workroom = readFileSync(resolve(ROOT, 'cloudflare-worker/src/routes/deal_workroom.ts'), 'utf8');
  assert.doesNotMatch(workroom, /FROM pairwise_ndas/, 'a second copy of the NDA status predicate');
  assert.match(workroom, /const nda = await ventureNdaStatus\(c\.env, x\.projectId, x\.user\.id\);/);
  assert.match(workroom, /\n    nda,\n/, 'the room door returns the shared read as it is');
  const researchSrc = readFileSync(resolve(ROOT, 'cloudflare-worker/src/routes/research.ts'), 'utf8');
  assert.doesNotMatch(researchSrc.slice(researchSrc.indexOf("research.get('/diligence'")), /FROM pairwise_ndas/);
});
