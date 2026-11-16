/**
 * D6072 (#6072) — a member investor is told once when a data room is shared
 * with them, with a link to the room in Research › Diligence. An address with
 * no account still gets nothing and the answer never says which it was
 * (D1101 §5 answer 6, kept by the owner on 2026-11-15). On real SQLite, with
 * the D1107 fixture.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/data_room_share_notice_6072.test.ts
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
  // D1248: migration 622's request columns (due date, withdrawn), which the diligence read selects.
  addColumnsFrom(db, MIG('622_dd_documents_due_reminders.sql'), 'dd_requests');
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

const notices = (db: any, userId?: number) => (userId == null
  ? db.prepare("SELECT user_id, type, title, body, link, category FROM notifications_inbox WHERE type = 'data_room_shared' ORDER BY id").all()
  : db.prepare("SELECT user_id, type, title, body, link, category FROM notifications_inbox WHERE type = 'data_room_shared' AND user_id = ? ORDER BY id").all(userId)) as any[];
const grantUid = (db: any, userId: number) => (db.prepare('SELECT uid FROM data_room_grants WHERE project_id = 7 AND investor_user_id = ?').get(userId) as any).uid;

test('a share to a member tells them once, with the room\'s link in Research › Diligence', async () => {
  const db = fixture();
  const r = await call(db, FOUNDER, 'POST', '/p-room/grants', { email: 'new@example.com' });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body, { ok: true });
  const n = notices(db, NEWBIE);
  assert.equal(n.length, 1);
  assert.equal(n[0].title, 'A data room was shared with you');
  assert.equal(n[0].body, 'Roomco shared its data room with you. Open it in Research › Diligence.');
  assert.equal(n[0].link, `/research/diligence/${grantUid(db, NEWBIE)}`);
  assert.equal(n[0].category, 'deals');
  // Sharing the open room again, or changing its folders, tells nobody a second time.
  assert.equal((await call(db, FOUNDER, 'POST', '/p-room/grants', { email: 'new@example.com' })).status, 201);
  assert.equal((await call(db, FOUNDER, 'POST', '/p-room/grants', { prospect: 'rp-new', folders: null })).status, 201);
  assert.equal(notices(db, NEWBIE).length, 1, 'one notice');
  // An investor who already held an open grant before this change is not told on a re-share.
  assert.equal((await call(db, FOUNDER, 'POST', '/p-room/grants', { email: 'hol@example.com' })).status, 201);
  assert.equal(notices(db, HOLDER).length, 0);
});

test('a revoked or expired grant shared again opens the room again, and that is told', async () => {
  const db = fixture();
  db.prepare("UPDATE data_room_grants SET status = 'revoked' WHERE uid = 'g-holder'").run();
  assert.equal((await call(db, FOUNDER, 'POST', '/p-room/grants', { email: 'hol@example.com' })).status, 201);
  assert.equal(notices(db, HOLDER).length, 1);
  assert.equal(notices(db, HOLDER)[0].link, '/research/diligence/g-holder', 'the row is reactivated, its uid kept');
  db.prepare("UPDATE data_room_grants SET expires_at = '2020-01-01T00:00:00Z' WHERE uid = 'g-pending'").run();
  assert.equal((await call(db, FOUNDER, 'POST', '/p-room/grants', { email: 'pen@example.com' })).status, 201);
  assert.equal(notices(db, PENDING).length, 1);
});

test('an address with no account: the same answer, no grant and no notice; a share to yourself tells nobody', async () => {
  const db = fixture();
  const before = (db.prepare('SELECT COUNT(*) AS n FROM data_room_grants').get() as any).n;
  const r = await call(db, FOUNDER, 'POST', '/p-room/grants', { email: 'nobody@example.com' });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body, { ok: true }, 'the same body a member share answers');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM data_room_grants').get() as any).n, before);
  assert.equal(notices(db).length, 0);
  assert.equal((await call(db, FOUNDER, 'POST', '/p-room/grants', { email: 'fran@example.com' })).status, 201);
  assert.equal(notices(db).length, 0);
});

test('a notice that cannot be written never fails the share', async () => {
  const db = fixture();
  db.exec('DROP TABLE notifications_inbox; CREATE VIEW notifications_inbox AS SELECT 1 AS id');
  const saved = console.warn; console.warn = () => {};
  try {
    const r = await call(db, FOUNDER, 'POST', '/p-room/grants', { email: 'new@example.com' });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body, { ok: true });
  } finally { console.warn = saved; }
  assert.equal((db.prepare("SELECT status FROM data_room_grants WHERE investor_user_id = ?").get(NEWBIE) as any).status, 'active');
});
