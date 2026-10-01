/**
 * D374 — the founder's data-room read gains its counts, and the NDA refusal is
 * logged — run against real SQLite.
 *
 * The four data-room tables and `pairwise_ndas` are cut from
 * `sql/schema_baseline.sql`, so a query naming a column production does not
 * have fails here too. `users` and `projects` are the narrow shapes
 * `requireAuth` and `projectOwnerScope` read.
 *
 * Each gate is asserted from both sides: the refused download writes
 * `blocked` and the permitted one does not; the week counts this room's last
 * seven days and nothing older or elsewhere; a folder's visibility reaches its
 * own subtree and no other.
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

import dataRoom from '../src/routes/data_room.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = 1;     // founders row 100, owns p-room and p-other
const SIGNED = 2;      // grant on p-room, live NDA with FOUNDER
const UNSIGNED = 3;    // grant on p-room, no NDA
const RIVAL = 4;       // a founder who owns p-rival

const ago = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

function freshDb() {
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
  for (const t of ['data_room_grants', 'data_room_files', 'data_room_folders', 'data_room_access_log', 'pairwise_ndas']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?,?,?,?,?)');
  u.run(FOUNDER, 'founder', 100, 'Fran', 'fran@example.com');
  u.run(SIGNED, 'investor', null, 'Sig', 'sig@example.com');
  u.run(UNSIGNED, 'investor', null, 'Una', 'una@example.com');
  u.run(RIVAL, 'founder', 200, 'Rae', 'rae@example.com');

  const p = db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?,?,?,?)');
  p.run(7, 'p-room', 'Roomco', 100);
  p.run(8, 'p-other', 'Elsewhere', 100);
  p.run(9, 'p-rival', 'Rivalco', 200);

  const g = db.prepare(
    `INSERT INTO data_room_grants (uid, project_id, investor_user_id, granted_by_user_id, status)
     VALUES (?,?,?,?, 'active')`,
  );
  g.run('g-signed', 7, SIGNED, FOUNDER);
  g.run('g-unsigned', 7, UNSIGNED, FOUNDER);
  db.prepare(`INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (?, ?, 'active')`)
    .run(FOUNDER, SIGNED);

  // A tree in p-room: fin → fin/legal, and a sibling "deck". p-rival has its
  // own folder with the same parent shape, to prove the walk stays home.
  const d = db.prepare(
    `INSERT INTO data_room_folders (id, uid, project_id, parent_id, name, visibility) VALUES (?,?,?,?,?, 'open')`,
  );
  d.run(51, 'd-fin', 7, null, 'Financials');
  d.run(52, 'd-legal', 7, 51, 'Legal');
  d.run(53, 'd-deck', 7, null, 'Deck');
  d.run(61, 'd-rival', 9, null, 'Rival folder');
  // A rival folder whose parent_id points into p-room's tree. No route writes
  // this shape (a parent must be in the same project), but the walk must not
  // follow it if a row ever does.
  d.run(62, 'd-rival-child', 9, 51, 'Rival child');

  const f = db.prepare(
    `INSERT INTO data_room_files (id, uid, project_id, folder_id, name, r2_key, content_type, size_bytes, visibility)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  f.run(31, 'f-open', 7, 53, 'Pitch deck.pdf', 'data-room/p-room/f-open', 'application/pdf', 2048, 'open');
  f.run(32, 'f-nda', 7, 51, 'Term sheet.pdf', 'data-room/p-room/f-nda', 'application/pdf', 4096, 'nda');
  f.run(33, 'f-model', 7, 51, 'Model.xlsx', 'data-room/p-room/f-model', 'application/vnd.ms-excel', 900, 'open');
  f.run(34, 'f-cap', 7, 52, 'Cap table.pdf', 'data-room/p-room/f-cap', 'application/pdf', 700, 'open');
  f.run(35, 'f-root', 7, null, 'Readme.pdf', 'data-room/p-room/f-root', 'application/pdf', 10, 'open');
  f.run(41, 'f-rival', 9, 61, 'Rival.pdf', 'data-room/p-rival/f-rival', 'application/pdf', 10, 'open');
  f.run(42, 'f-rival-child', 9, 62, 'Rival child.pdf', 'data-room/p-rival/f-rival-child', 'application/pdf', 10, 'open');
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [SIGNED]: 'investor', [UNSIGNED]: 'investor', [RIVAL]: 'founder' };

async function call(db: any, userId: number, method: string, path: string, body?: unknown) {
  const res = await dataRoom.fetch(
    new Request(`http://x${path}`, {
      method,
      headers: { Authorization: `Bearer ${await token(userId, ROLE[userId])}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES: { put: async () => {}, delete: async () => {} } } as any,
  );
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null };
}

const log = (db: any) => db.prepare('SELECT project_id, user_id, action, file_id FROM data_room_access_log ORDER BY id').all()
  .map((r: any) => ({ ...r }));
const logAt = (db: any, project: number, user: number, action: string, file: number | null, at: string) =>
  db.prepare('INSERT INTO data_room_access_log (project_id, file_id, user_id, action, created_at) VALUES (?,?,?,?,?)')
    .run(project, file, user, action, at);
const vis = (db: any, table: string, uid: string) =>
  (db.prepare(`SELECT visibility FROM ${table} WHERE uid = ?`).get(uid) as any).visibility;

test('a download the NDA gate refuses is logged as blocked, and a permitted one is not', async () => {
  const db = freshDb();
  const refused = await call(db, UNSIGNED, 'POST', '/shared/p-room/files/f-nda/download');
  assert.equal(refused.status, 403);
  assert.deepEqual(log(db), [{ project_id: 7, user_id: UNSIGNED, action: 'blocked', file_id: 32 }]);

  const allowed = await call(db, SIGNED, 'POST', '/shared/p-room/files/f-nda/download');
  assert.equal(allowed.status, 200);
  assert.deepEqual(log(db).slice(1), [{ project_id: 7, user_id: SIGNED, action: 'download', file_id: 32 }],
    'a permitted download was logged as blocked, or not logged');

  // An open file never reaches the gate, so nothing is blocked there.
  await call(db, UNSIGNED, 'POST', '/shared/p-room/files/f-open/download');
  assert.deepEqual(log(db).map((r: any) => r.action), ['blocked', 'download', 'download']);
});

test('the week counts this room’s last seven days by action, not the fifty rows', async () => {
  const db = freshDb();
  for (let i = 0; i < 55; i++) logAt(db, 7, SIGNED, 'open_room', null, ago(1));
  logAt(db, 7, SIGNED, 'download', 31, ago(2));
  logAt(db, 7, UNSIGNED, 'blocked', 32, ago(3));
  logAt(db, 7, SIGNED, 'download', 31, ago(9));      // older than the week
  logAt(db, 8, SIGNED, 'open_room', null, ago(1));   // another room

  const r = await call(db, FOUNDER, 'GET', '/p-room');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.week, { opened: 55, downloaded: 1, blocked: 1 });
  assert.equal(r.body.recent_access.length, 50, 'the recent list is still capped at fifty');

  // A room with no events counts zero for each action — the log exists.
  const empty = await call(db, FOUNDER, 'GET', '/p-other');
  assert.deepEqual(empty.body.week, { opened: 1, downloaded: 0, blocked: 0 });
});

test('each file carries its own download count, and only downloads count', async () => {
  const db = freshDb();
  logAt(db, 7, SIGNED, 'download', 31, ago(1));
  logAt(db, 7, UNSIGNED, 'download', 31, ago(20));
  logAt(db, 7, UNSIGNED, 'blocked', 32, ago(1));
  logAt(db, 7, SIGNED, 'open_room', null, ago(1));
  const files = (await call(db, FOUNDER, 'GET', '/p-room')).body.files;
  const by = Object.fromEntries(files.map((f: any) => [f.uid, f.downloads]));
  assert.equal(by['f-open'], 2, 'the per-file count is every download, not the week');
  assert.equal(by['f-nda'], 0, 'a blocked attempt was counted as a download');
  assert.equal(by['f-model'], 0);
});

test('the recent list says which file an event was on and whether it is NDA-marked', async () => {
  const db = freshDb();
  logAt(db, 7, UNSIGNED, 'blocked', 32, ago(1));
  const [row] = (await call(db, FOUNDER, 'GET', '/p-room')).body.recent_access;
  assert.equal(row.action, 'blocked');
  assert.equal(row.file_name, 'Term sheet.pdf');
  assert.equal(row.file_visibility, 'nda');
  assert.equal(row.user_name, 'Una');
});

test('the founder counts never reach an investor, and another founder reads nothing', async () => {
  const db = freshDb();
  logAt(db, 7, SIGNED, 'download', 31, ago(1));
  const shared = await call(db, SIGNED, 'GET', '/shared/p-room');
  assert.equal(shared.status, 200);
  assert.equal(shared.body.week, undefined);
  assert.ok(shared.body.files.every((f: any) => f.downloads === undefined), 'a download count reached an investor');

  const rival = await call(db, RIVAL, 'GET', '/p-room');
  assert.equal(rival.status, 404);
  assert.equal(rival.body.week, undefined);
});

test('a folder’s visibility reaches its own subtree when asked, and only then', async () => {
  const db = freshDb();
  // Without apply_to_contents the folder's own row changes and nothing else.
  let r = await call(db, FOUNDER, 'PATCH', '/p-room/folders/d-fin', { visibility: 'nda' });
  assert.equal(r.status, 200);
  assert.equal(vis(db, 'data_room_folders', 'd-fin'), 'nda');
  assert.equal(vis(db, 'data_room_files', 'f-model'), 'open');
  assert.equal(vis(db, 'data_room_folders', 'd-legal'), 'open');

  r = await call(db, FOUNDER, 'PATCH', '/p-room/folders/d-fin', { visibility: 'nda', apply_to_contents: true });
  assert.equal(r.status, 200);
  for (const [t, uid] of [['data_room_folders', 'd-legal'], ['data_room_files', 'f-model'], ['data_room_files', 'f-cap']]) {
    assert.equal(vis(db, t, uid), 'nda', `${uid} is under Financials and kept its old gate`);
  }
  // The sibling folder, a root file, and another founder's room are untouched.
  assert.equal(vis(db, 'data_room_folders', 'd-deck'), 'open');
  assert.equal(vis(db, 'data_room_files', 'f-open'), 'open');
  assert.equal(vis(db, 'data_room_files', 'f-root'), 'open');
  assert.equal(vis(db, 'data_room_files', 'f-rival'), 'open');
  assert.equal(vis(db, 'data_room_folders', 'd-rival-child'), 'open', 'the walk left the project');
  assert.equal(vis(db, 'data_room_files', 'f-rival-child'), 'open', 'the walk left the project');

  // And back: opening the folder with its contents opens the whole subtree.
  await call(db, FOUNDER, 'PATCH', '/p-room/folders/d-fin', { visibility: 'open', apply_to_contents: true });
  assert.equal(vis(db, 'data_room_files', 'f-nda'), 'open');
  assert.equal(vis(db, 'data_room_files', 'f-cap'), 'open');
});

test('the carried visibility is refused outside the caller’s room and for a value that is not a gate', async () => {
  const db = freshDb();
  const other = await call(db, RIVAL, 'PATCH', '/p-room/folders/d-fin', { visibility: 'nda', apply_to_contents: true });
  assert.equal(other.status, 404);
  assert.equal(vis(db, 'data_room_files', 'f-model'), 'open');

  // A folder uid from another project, addressed through this founder's room.
  const cross = await call(db, FOUNDER, 'PATCH', '/p-room/folders/d-rival', { visibility: 'nda', apply_to_contents: true });
  assert.equal(cross.status, 404);
  assert.equal(vis(db, 'data_room_files', 'f-rival'), 'open');
  assert.equal(vis(db, 'data_room_folders', 'd-rival'), 'open');

  const bad = await call(db, FOUNDER, 'PATCH', '/p-room/folders/d-fin', { visibility: 'private', apply_to_contents: true });
  assert.equal(bad.status, 400);
  assert.equal(vis(db, 'data_room_files', 'f-model'), 'open');
});
