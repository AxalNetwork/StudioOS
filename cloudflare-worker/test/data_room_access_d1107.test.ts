/**
 * D1107 (#2987) — Data room part 6, the Worker reads Access and Requests need,
 * on real SQLite:
 *   · each grant says whether an NDA is out for signature (`nda_pending`);
 *   · Share's candidates are this venture's prospects in Capital
 *     relationships, the owner's only, and never say who has an account;
 *   · `POST /grants` with `prospect` reads the address from this venture's
 *     prospect, and another venture's prospect is 404;
 *   · the requests read carries the venture's diligence requests and the
 *     files matched to each, in its own block.
 * Every name and address is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/data_room_access_d1107.test.ts
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
import dataRoom from '../src/routes/data_room.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIG = (f: string) => stripForeignKeys(read(`cloudflare-worker/sql/migrations/${f}`));
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = 1, HOLDER = 2, PENDING = 3, RIVAL = 4, COFOUNDER = 5, NEWBIE = 6;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [HOLDER]: 'investor', [PENDING]: 'investor', [RIVAL]: 'founder', [COFOUNDER]: 'founder', [NEWBIE]: 'investor' };

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT UNIQUE NOT NULL, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
  `);
  for (const t of ['data_room_grants', 'data_room_files', 'data_room_folders', 'data_room_access_log', 'pairwise_ndas', 'project_members',
    'activity_logs', 'notifications_inbox', 'raise_prospects', 'dd_cases', 'dd_requests', 'report_shares']) {
    try { db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t))); } catch { /* a table the baseline does not carry is not read here */ }
  }
  withGrantFolders(db);
  for (const f of ['442_raise_cycle_stores.sql', '463_raise_record_stores.sql', '596_data_room_file_source.sql']) {
    addColumnsFrom(db, MIG(f), 'data_room_files');
    addColumnsFrom(db, MIG(f), 'raise_prospects');
  }
  db.exec(MIG('436_round_calls.sql'));
  db.exec(MIG('595_data_room_access_requests.sql').split('INSERT OR IGNORE')[0]);
  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?,?,?,?,?)');
  u.run(FOUNDER, 'founder', 100, 'Fran', 'fran@example.com');
  u.run(HOLDER, 'investor', null, 'Hol', 'hol@example.com');
  u.run(PENDING, 'investor', null, 'Pen', 'pen@example.com');
  u.run(RIVAL, 'founder', 200, 'Rae', 'rae@example.com');
  u.run(COFOUNDER, 'founder', 300, 'Cora', 'cora@example.com');
  u.run(NEWBIE, 'investor', null, 'New', 'new@example.com');
  const p = db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?,?,?,?)');
  p.run(7, 'p-room', 'Roomco', 100);
  p.run(9, 'p-rival', 'Rivalco', 200);
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (7, ?, 'cofounder', 'accepted')`).run(COFOUNDER);
  const g = db.prepare(`INSERT INTO data_room_grants (id, uid, project_id, investor_user_id, granted_by_user_id, status) VALUES (?, ?, 7, ?, ?, 'active')`);
  g.run(1, 'g-holder', HOLDER, FOUNDER);
  g.run(2, 'g-pending', PENDING, FOUNDER);
  const n = db.prepare(`INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (?, ?, ?)`);
  n.run(FOUNDER, HOLDER, 'active');
  n.run(FOUNDER, PENDING, 'pending');
  const rp = db.prepare(`INSERT INTO raise_prospects (uid, project_id, name, firm, email, stage) VALUES (?,?,?,?,?,?)`);
  rp.run('rp-new', 7, 'New Person', 'Northwind Angels', 'new@example.com', 'contacted');
  rp.run('rp-noemail', 7, 'No Mail', 'Bluefern Capital', null, 'to_contact');
  rp.run('rp-rival', 9, 'Theirs', 'Elsewhere Fund', 'hol@example.com', 'committed');
  db.prepare(`INSERT INTO dd_cases (id, uid, subject_type, subject_id, subject_label, owner_user_id) VALUES (40, 'case-1', 'project', 7, 'Roomco', ?)`).run(FOUNDER);
  db.prepare(`INSERT INTO dd_cases (id, uid, subject_type, subject_id, subject_label, owner_user_id) VALUES (41, 'case-2', 'project', 9, 'Rivalco', ?)`).run(RIVAL);
  const dr = db.prepare(`INSERT INTO dd_requests (id, case_id, title, state, created_at) VALUES (?,?,?,?,?)`);
  dr.run(60, 40, 'Burn and runway by month', 'received', '2026-10-21 09:00:00');
  dr.run(61, 40, 'Security questionnaire', 'requested', '2026-10-22 09:00:00');
  dr.run(62, 41, 'Not this venture', 'requested', '2026-10-23 09:00:00');
  db.prepare(`INSERT INTO data_room_files (uid, project_id, name, visibility, r2_key, dd_request_id) VALUES ('f-burn', 7, 'Burn and runway 2026.xlsx', 'open', 'data-room/p-room/x', 60)`).run();
  return db;
}

async function call(db: any, userId: number, method: string, path: string, body?: unknown) {
  const tok = await new SignJWT({ user_id: userId, role: ROLE[userId] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await dataRoom.fetch(new Request(`http://x${path}`, {
    method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES: { put: async () => {}, delete: async () => {} } } as any);
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null };
}

test('each grant says whether its NDA is signed, out for signature, or neither', async () => {
  const db = fixture();
  const r = await call(db, FOUNDER, 'GET', '/p-room');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const by = Object.fromEntries(r.body.grants.map((g: any) => [g.uid, [g.nda_signed, g.nda_pending]]));
  assert.deepEqual(by, { 'g-holder': [true, false], 'g-pending': [false, true] });
});

test('Share offers this venture\'s prospects only, to the owner only, and never says who has an account', async () => {
  const db = fixture();
  const r = await call(db, FOUNDER, 'GET', '/p-room/share-candidates');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.candidates.map((c: any) => [c.uid, c.firm, c.stage, c.email]), [
    ['rp-noemail', 'Bluefern Capital', 'to_contact', null],
    ['rp-new', 'Northwind Angels', 'contacted', 'new@example.com'],
  ], 'another venture\'s prospect is never offered');
  assert.doesNotMatch(JSON.stringify(r.body), /account|user_id|has_access/);
  assert.equal((await call(db, COFOUNDER, 'GET', '/p-room/share-candidates')).body.code, 'owner_only');
  assert.equal((await call(db, RIVAL, 'GET', '/p-room/share-candidates')).status, 404);
});

test('Share by prospect reads the address from this venture\'s prospect; another venture\'s is 404, one with no email says so', async () => {
  const db = fixture();
  const ok = await call(db, FOUNDER, 'POST', '/p-room/grants', { prospect: 'rp-new', expires_at: null });
  assert.equal(ok.status, 201);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM data_room_grants WHERE project_id = 7 AND investor_user_id = ?').get(NEWBIE) as any).n, 1);
  const theirs = await call(db, FOUNDER, 'POST', '/p-room/grants', { prospect: 'rp-rival' });
  assert.equal(theirs.status, 404, 'a prospect of another venture never grants');
  const none = await call(db, FOUNDER, 'POST', '/p-room/grants', { prospect: 'rp-noemail' });
  assert.deepEqual([none.status, none.body.code], [400, 'no_email']);
  assert.equal((await call(db, COFOUNDER, 'POST', '/p-room/grants', { prospect: 'rp-new' })).body.code, 'owner_only');
});

test('the requests read carries the venture\'s diligence requests with their files, and a failed block is its own', async () => {
  const db = fixture();
  const r = await call(db, COFOUNDER, 'GET', '/p-room/requests');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.diligence.map((d: any) => [d.id, d.title, d.state, d.files.map((f: any) => f.name)]), [
    [61, 'Security questionnaire', 'requested', []],
    [60, 'Burn and runway by month', 'received', ['Burn and runway 2026.xlsx']],
  ], 'newest first; another venture\'s request is never listed');
  assert.ok(!('diligence_unreadable' in r.body));
  db.exec('DROP TABLE dd_requests');
  const down = await call(db, FOUNDER, 'GET', '/p-room/requests');
  assert.equal(down.status, 200, 'the access requests still answer');
  assert.deepEqual([down.body.diligence, down.body.diligence_unreadable], [null, true]);
});
