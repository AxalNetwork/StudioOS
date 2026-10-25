/**
 * D1103 (#2983) — Data room part 2, on real SQLite: the founder's own
 * download, versions (list, download, make current), a grant's end date and
 * folders (migration 594), co-founders, and the preview read.
 *
 * The data-room tables are cut from `sql/schema_baseline.sql` and the
 * migrations that changed them (463, 594), so a query naming a column
 * production does not have fails here too.
 *
 * Each rule is held from both sides:
 *   · the founder's download is the venture's own event: no row in the
 *     investor access log, one on the file's record; a non-member gets 404;
 *   · make current swaps the two objects and logs it;
 *   · a folder-scoped grant cannot open a file outside its folders through
 *     any reader (`/shared`, the room, the download, the Raise record's
 *     readers, the evidence count), and a scope that loses its last folder
 *     opens nothing, never the whole room;
 *   · the preview names no file the grant cannot open and writes no log row;
 *   · a co-founder uploads and organises, and cannot share, revoke or change
 *     a gate.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/data_room_part2_d1103.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { tableFromBaseline, stripForeignKeys, addColumnsFrom, splitStatements } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withGrantFolders } from './_data_room_scope.mjs';

import dataRoom from '../src/routes/data_room.ts';
import { tierAdmits, grantFolderScope, admittedCounts } from '../src/services/dataRoomAccess.ts';
import { readableRoomFiles } from '../src/services/raiseEvidence.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIG463 = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/463_raise_record_stores.sql'), 'utf8');
const MIG442 = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/442_raise_cycle_stores.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = 1;   // founders row 100, owns p-room
const SIGNED = 2;    // grant g-signed on p-room, live NDA
const SCOPED = 3;    // grant g-scoped on p-room, Financials only, live NDA
const RIVAL = 4;     // a founder who owns p-rival
const COFOUNDER = 5; // accepted co-founder of p-room
const ADVISOR = 6;   // accepted advisor of p-room: not a co-founder
const LATER = 7;     // an investor with no grant yet

const iso = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => iso(new Date(Date.now() + n * 86400_000));

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
  for (const t of ['data_room_grants', 'data_room_files', 'data_room_folders', 'data_room_access_log', 'pairwise_ndas',
    'raise_prospects', 'project_members', 'activity_logs']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  addColumnsFrom(db, stripForeignKeys(MIG463), 'data_room_files');
  addColumnsFrom(db, stripForeignKeys(MIG442), 'data_room_files');
  db.exec(stripForeignKeys(splitStatements(MIG463).find((s: string) => s.includes('CREATE TABLE IF NOT EXISTS data_room_file_versions'))));
  withGrantFolders(db);

  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?,?,?,?,?)');
  u.run(FOUNDER, 'founder', 100, 'Fran', 'fran@example.com');
  u.run(SIGNED, 'investor', null, 'Sig', 'sig@example.com');
  u.run(SCOPED, 'investor', null, 'Sco', 'sco@example.com');
  u.run(RIVAL, 'founder', 200, 'Rae', 'rae@example.com');
  u.run(COFOUNDER, 'founder', 300, 'Cora', 'cora@example.com');
  u.run(ADVISOR, 'advisor', null, 'Avi', 'avi@example.com');
  u.run(LATER, 'investor', null, 'Lat', 'lat@example.com');

  const p = db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?,?,?,?)');
  p.run(7, 'p-room', 'Roomco', 100);
  p.run(9, 'p-rival', 'Rivalco', 200);
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (7, ?, 'cofounder', 'accepted'), (7, ?, 'advisor', 'accepted')`)
    .run(COFOUNDER, ADVISOR);

  const g = db.prepare(
    `INSERT INTO data_room_grants (id, uid, project_id, investor_user_id, granted_by_user_id, status, folders_scoped)
     VALUES (?,?,?,?,?, 'active', ?)`,
  );
  g.run(1, 'g-signed', 7, SIGNED, FOUNDER, 0);
  g.run(2, 'g-scoped', 7, SCOPED, FOUNDER, 1);
  g.run(3, 'g-rival', 9, SIGNED, RIVAL, 0);
  const n = db.prepare(`INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (?, ?, 'active')`);
  n.run(FOUNDER, SIGNED); n.run(FOUNDER, SCOPED);

  // Financials → Legal under it; Deck beside it. p-rival has a folder whose
  // parent points into p-room's tree, which the scope walk must not follow.
  const d = db.prepare(`INSERT INTO data_room_folders (id, uid, project_id, parent_id, name, visibility) VALUES (?,?,?,?,?, 'open')`);
  d.run(51, 'd-fin', 7, null, 'Financials');
  d.run(52, 'd-legal', 7, 51, 'Legal');
  d.run(53, 'd-deck', 7, null, 'Deck');
  d.run(61, 'd-rival', 9, 51, 'Rival child');
  db.prepare(`UPDATE data_room_folders SET visibility = 'nda' WHERE id = 53`).run();
  db.prepare('INSERT INTO data_room_grant_folders (grant_id, folder_id) VALUES (2, 51)').run();

  const f = db.prepare(
    `INSERT INTO data_room_files (id, uid, project_id, folder_id, name, r2_key, content_type, size_bytes, visibility, uploaded_by_user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  f.run(31, 'f-deck', 7, 53, 'Pitch deck.pdf', 'data-room/p-room/deck-v3', 'application/pdf', 2048, 'open', FOUNDER);
  f.run(32, 'f-model', 7, 51, 'Model.xlsx', 'data-room/p-room/model', 'application/vnd.ms-excel', 900, 'open', FOUNDER);
  f.run(33, 'f-cap', 7, 52, 'Cap table.pdf', 'data-room/p-room/cap', 'application/pdf', 700, 'open', FOUNDER);
  f.run(34, 'f-root', 7, null, 'Readme.pdf', 'data-room/p-room/root', 'application/pdf', 10, 'open', FOUNDER);
  f.run(41, 'f-rival', 9, 61, 'Rival.pdf', 'data-room/p-rival/rival', 'application/pdf', 10, 'open', RIVAL);
  // Two earlier versions of the deck; one stored outside the prefix, which no route may hand out.
  const v = db.prepare(`INSERT INTO data_room_file_versions (file_id, version, r2_key, content_type, size_bytes, uploaded_by) VALUES (?,?,?,?,?,?)`);
  v.run(31, 1, 'data-room/p-room/deck-v1', 'application/pdf', 1000, FOUNDER);
  v.run(31, 2, 'data-room/p-room/deck-v2', 'application/pdf', null, COFOUNDER);
  v.run(32, 1, 'elsewhere/model-v1', 'application/vnd.ms-excel', 10, FOUNDER);
  return db;
}

const ROLE: Record<number, string> = {
  [FOUNDER]: 'founder', [SIGNED]: 'investor', [SCOPED]: 'investor', [RIVAL]: 'founder', [COFOUNDER]: 'founder', [ADVISOR]: 'advisor', [LATER]: 'investor',
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
const accessLog = (db: any) => db.prepare('SELECT COUNT(*) AS n FROM data_room_access_log').get().n;
const activity = (db: any, action: string) => db.prepare('SELECT entity_id, details, actor FROM activity_logs WHERE action = ?').all(action);
const tokenKey = (url: string) => JSON.parse(Buffer.from(url.split('/').pop()!.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).key;

/* ------------------------------------------------------------------ *
 * The founder's own download
 * ------------------------------------------------------------------ */

test('the founder downloads their own file: a one-time link, logged on the record and never in the investor log', async () => {
  const db = freshDb();
  const res = await call(db, FOUNDER, 'POST', '/p-room/files/f-deck/download');
  assert.equal(res.status, 200);
  assert.match(res.body.url, /^\/api\/files\/dl\//);
  assert.equal(tokenKey(res.body.url), 'data-room/p-room/deck-v3');
  assert.equal(res.body.version, null);
  assert.equal(accessLog(db), 0, 'not an investor event');
  const logged = activity(db, 'file_downloaded');
  assert.equal(logged.length, 1);
  assert.equal(String(logged[0].entity_id), '31');
  assert.equal(logged[0].actor, `user:${FOUNDER}`);
  assert.doesNotMatch(logged[0].details, /Pitch deck/, 'no file name on the record');
  // The founder's read still counts no download for the file.
  const room = await call(db, FOUNDER, 'GET', '/p-room');
  assert.equal(room.body.files.find((x: any) => x.uid === 'f-deck').downloads, 0);
  assert.equal(room.body.week.downloaded, 0);
});

test('the founder download: a co-founder may, anyone else gets 404, and another venture\'s file is not found', async () => {
  const db = freshDb();
  assert.equal((await call(db, COFOUNDER, 'POST', '/p-room/files/f-deck/download')).status, 200);
  for (const id of [SIGNED, SCOPED, RIVAL, ADVISOR, LATER]) {
    assert.equal((await call(db, id, 'POST', '/p-room/files/f-deck/download')).status, 404, String(id));
  }
  assert.equal((await call(db, FOUNDER, 'POST', '/p-room/files/f-rival/download')).status, 404);
  assert.equal(accessLog(db), 0);
});

/* ------------------------------------------------------------------ *
 * Versions
 * ------------------------------------------------------------------ */

test('versions: the current one, then each earlier one newest first; an unrecorded size is null', async () => {
  const db = freshDb();
  const res = await call(db, COFOUNDER, 'GET', '/p-room/files/f-deck/versions');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.file, { uid: 'f-deck', name: 'Pitch deck.pdf' });
  assert.equal(res.body.current.size_bytes, 2048);
  assert.equal(res.body.current.uploaded_by_name, 'Fran');
  assert.deepEqual(res.body.versions.map((v: any) => [v.version, v.size_bytes, v.uploaded_by_name]), [[2, null, 'Cora'], [1, 1000, 'Fran']]);
  assert.ok(!JSON.stringify(res.body).includes('deck-v'), 'no storage key leaves the Worker');
  assert.equal((await call(db, RIVAL, 'GET', '/p-room/files/f-deck/versions')).status, 404);
});

test('a version\'s download is its own object; a missing version, a bad number or a key outside the venture is 404', async () => {
  const db = freshDb();
  const v1 = await call(db, FOUNDER, 'POST', '/p-room/files/f-deck/versions/1/download');
  assert.equal(v1.status, 200);
  assert.equal(tokenKey(v1.body.url), 'data-room/p-room/deck-v1');
  assert.equal(v1.body.version, 1);
  assert.match(activity(db, 'file_downloaded')[0].details, /^Version 1 downloaded/);
  for (const n of ['9', '0', 'x', '-1']) assert.equal((await call(db, FOUNDER, 'POST', `/p-room/files/f-deck/versions/${n}/download`)).status, 404, n);
  assert.equal((await call(db, FOUNDER, 'POST', '/p-room/files/f-model/versions/1/download')).status, 404, 'outside data-room/p-room/');
  assert.equal(accessLog(db), 0);
});

test('make current swaps the two objects, so nothing is lost, and logs it', async () => {
  const db = freshDb();
  const res = await call(db, COFOUNDER, 'POST', '/p-room/files/f-deck/versions/1/current');
  assert.equal(res.status, 200);
  const file = db.prepare('SELECT r2_key, size_bytes FROM data_room_files WHERE id = 31').get();
  assert.deepEqual({ ...file }, { r2_key: 'data-room/p-room/deck-v1', size_bytes: 1000 });
  const v1 = db.prepare('SELECT r2_key, size_bytes, uploaded_by FROM data_room_file_versions WHERE file_id = 31 AND version = 1').get();
  assert.deepEqual({ ...v1 }, { r2_key: 'data-room/p-room/deck-v3', size_bytes: 2048, uploaded_by: FOUNDER });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM data_room_file_versions WHERE file_id = 31').get().n, 2, 'no version added or lost');
  const logged = activity(db, 'version_made_current');
  assert.equal(logged.length, 1);
  assert.equal(logged[0].actor, `user:${COFOUNDER}`);
  assert.equal((await call(db, FOUNDER, 'POST', '/p-room/files/f-deck/versions/7/current')).status, 404);
  assert.equal((await call(db, FOUNDER, 'POST', '/p-room/files/f-model/versions/1/current')).status, 404, 'a key outside the venture is never made current');
  assert.equal((await call(db, RIVAL, 'POST', '/p-room/files/f-deck/versions/2/current')).status, 404);
});

/* ------------------------------------------------------------------ *
 * A grant's folders, through every reader
 * ------------------------------------------------------------------ */

test('tierAdmits: a scope admits only its folders; null is every folder; a file at the top level is outside any scope', () => {
  const scope = new Set([51, 52]);
  assert.equal(tierAdmits({ folder_id: 51 }, false, Date.now(), scope), true);
  assert.equal(tierAdmits({ folder_id: 53 }, false, Date.now(), scope), false);
  assert.equal(tierAdmits({ folder_id: null }, false, Date.now(), scope), false);
  assert.equal(tierAdmits({}, false, Date.now(), scope), false, 'a reader that did not select folder_id admits nothing');
  assert.equal(tierAdmits({ folder_id: null }, false, Date.now(), null), true);
  assert.equal(tierAdmits({ folder_id: 51, access_tier: 'nobody' }, false, Date.now(), null), false, 'the tier still applies');
});

test('grantFolderScope: a named folder with its subfolders, in its own venture only; unscoped is null; unreadable opens nothing', async () => {
  const db = freshDb();
  assert.deepEqual([...(await grantFolderScope(env(db), 2))!].sort(), [51, 52], 'Legal under Financials; never the rival folder that points into it');
  assert.equal(await grantFolderScope(env(db), 1), null);
  assert.deepEqual([...(await grantFolderScope(env(db), 99))!], [], 'no such grant opens nothing');
  db.exec('DROP TABLE data_room_grant_folders');
  assert.deepEqual([...(await grantFolderScope(env(db), 2))!], [], 'a store that cannot be read opens nothing');
});

test('a scoped grant cannot open a file outside its folders through any reader', async () => {
  const db = freshDb();
  // The room as the scoped investor reads it.
  const room = await call(db, SCOPED, 'GET', '/shared/p-room');
  assert.equal(room.status, 200);
  assert.deepEqual(room.body.files.map((x: any) => x.uid).sort(), ['f-cap', 'f-model']);
  assert.deepEqual(room.body.folders.map((x: any) => x.uid).sort(), ['d-fin', 'd-legal']);
  assert.equal(room.body.withheld_behind_nda, 0);
  assert.equal(room.body.hidden_from_grant, undefined, 'the investor never learns how much is hidden');
  assert.ok(!JSON.stringify(room.body).includes('Pitch deck') && !JSON.stringify(room.body).includes('Readme'));
  // The list's count.
  const list = await call(db, SCOPED, 'GET', '/shared');
  assert.equal(list.body.items[0].file_count, 2);
  // The download.
  assert.equal((await call(db, SCOPED, 'POST', '/shared/p-room/files/f-deck/download')).status, 404);
  assert.equal((await call(db, SCOPED, 'POST', '/shared/p-room/files/f-root/download')).status, 404);
  assert.equal((await call(db, SCOPED, 'POST', '/shared/p-room/files/f-cap/download')).status, 200);
  // The shared counter and the evidence count.
  assert.deepEqual(await admittedCounts(env(db), 7, false, true, await grantFolderScope(env(db), 2)), { total: 2, open: 2 });
  db.prepare("UPDATE data_room_grants SET status = 'revoked' WHERE id = 1").run();
  assert.deepEqual((await readableRoomFiles(env(db), 7)).map((x: any) => x.uid).sort(), ['f-cap', 'f-model'], 'only what the live, scoped grant opens');
  // The unscoped grant still opens everything.
  db.prepare("UPDATE data_room_grants SET status = 'active' WHERE id = 1").run();
  assert.equal((await call(db, SIGNED, 'GET', '/shared/p-room')).body.files.length, 4);
});

test('a scope that loses its last folder opens nothing, never the whole room', async () => {
  const db = freshDb();
  const del = await call(db, FOUNDER, 'DELETE', '/p-room/folders/d-fin');
  assert.equal(del.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM data_room_grant_folders').get().n, 0, 'the folder left the scope with it');
  const room = await call(db, SCOPED, 'GET', '/shared/p-room');
  assert.deepEqual(room.body.files, []);
  assert.deepEqual(room.body.folders, []);
  assert.equal((await call(db, SCOPED, 'GET', '/shared')).body.items[0].file_count, 0);
  const read = await call(db, FOUNDER, 'GET', '/p-room');
  assert.deepEqual(read.body.grants.find((x: any) => x.uid === 'g-scoped').folders, [], 'scoped to nothing, said as such');
});

/* ------------------------------------------------------------------ *
 * The grant write: an end date and folders
 * ------------------------------------------------------------------ */

test('a new grant takes an end date and its folders; the founder read returns them', async () => {
  const db = freshDb();
  const end = inDays(10);
  assert.equal((await call(db, FOUNDER, 'POST', '/p-room/grants', { email: 'lat@example.com', expires_at: end, folders: ['d-legal'] })).status, 201);
  const row = db.prepare('SELECT id, expires_at, folders_scoped FROM data_room_grants WHERE investor_user_id = ?').get(LATER);
  assert.equal(row.expires_at, `${end} 23:59:59`, 'open through the end of that day');
  assert.equal(row.folders_scoped, 1);
  assert.deepEqual(db.prepare('SELECT folder_id FROM data_room_grant_folders WHERE grant_id = ?').all(row.id).map((r: any) => r.folder_id), [52]);
  assert.deepEqual((await call(db, LATER, 'GET', '/shared/p-room')).body.files.map((x: any) => x.uid), ['f-cap']);
  const read = await call(db, FOUNDER, 'GET', '/p-room');
  const g = read.body.grants.find((x: any) => x.investor_email === 'lat@example.com');
  assert.deepEqual(g.folders, ['d-legal']);
  assert.equal(read.body.grants.find((x: any) => x.uid === 'g-signed').folders, null, 'null opens every folder');
  assert.equal(read.body.role, 'owner');
  assert.ok(!('id' in g) && !('folders_scoped' in g));
});

test('the grant write refuses a bad date, a past date, an empty list and another venture\'s folder, before any account is looked up', async () => {
  const db = freshDb();
  const bad = [
    [{ expires_at: '25/12/2030' }, 400], [{ expires_at: '2030-02-31' }, 400], [{ expires_at: inDays(-2) }, 400],
    [{ folders: [] }, 400], [{ folders: 'd-fin' }, 400], [{ folders: ['d-rival'] }, 404], [{ folders: ['nope'] }, 404],
  ] as const;
  for (const [extra, status] of bad) {
    for (const email of ['lat@example.com', 'absent@example.invalid']) {
      assert.equal((await call(db, FOUNDER, 'POST', '/p-room/grants', { email, ...extra })).status, status, JSON.stringify(extra));
    }
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM data_room_grants WHERE investor_user_id = ?').get(LATER).n, 0);
  assert.equal((await call(db, FOUNDER, 'POST', '/p-room/grants', { email: 'lat@example.com', expires_at: inDays(0) })).status, 201, 'today is allowed');
});

test('PATCH a grant: its end date, its folders, back to every folder; a re-grant without folders keeps them', async () => {
  const db = freshDb();
  const end = inDays(30);
  assert.equal((await call(db, FOUNDER, 'PATCH', '/p-room/grants/g-signed', { expires_at: end, folders: ['d-deck'] })).status, 200);
  let row = db.prepare('SELECT expires_at, folders_scoped FROM data_room_grants WHERE id = 1').get();
  assert.deepEqual({ ...row }, { expires_at: `${end} 23:59:59`, folders_scoped: 1 });
  assert.deepEqual((await call(db, SIGNED, 'GET', '/shared/p-room')).body.files.map((x: any) => x.uid), ['f-deck']);
  // A re-grant that names no folders keeps the scope.
  await call(db, FOUNDER, 'POST', '/p-room/grants', { email: 'sig@example.com' });
  assert.equal(db.prepare('SELECT folders_scoped FROM data_room_grants WHERE id = 1').get().folders_scoped, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM data_room_grant_folders WHERE grant_id = 1').get().n, 1);
  // Back to every folder, and the end date cleared.
  assert.equal((await call(db, FOUNDER, 'PATCH', '/p-room/grants/g-signed', { folders: null, expires_at: null })).status, 200);
  row = db.prepare('SELECT expires_at, folders_scoped FROM data_room_grants WHERE id = 1').get();
  assert.deepEqual({ ...row }, { expires_at: null, folders_scoped: 0 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM data_room_grant_folders WHERE grant_id = 1').get().n, 0);
  assert.equal((await call(db, SIGNED, 'GET', '/shared/p-room')).body.files.length, 4);
  assert.equal((await call(db, FOUNDER, 'PATCH', '/p-room/grants/g-signed', {})).status, 400);
  assert.equal((await call(db, FOUNDER, 'PATCH', '/p-room/grants/g-rival', { folders: null })).status, 404, 'another venture\'s grant');
  assert.equal((await call(db, RIVAL, 'PATCH', '/p-room/grants/g-signed', { folders: null })).status, 404);
});

test('an ended grant opens nothing: the end date the page sets is the one every reader checks', async () => {
  const db = freshDb();
  db.prepare("UPDATE data_room_grants SET expires_at = '2000-01-01 23:59:59' WHERE id = 1").run();
  assert.equal((await call(db, SIGNED, 'GET', '/shared/p-room')).status, 404);
  assert.equal((await call(db, SIGNED, 'POST', '/shared/p-room/files/f-model/download')).status, 404);
});

/* ------------------------------------------------------------------ *
 * Co-founders
 * ------------------------------------------------------------------ */

test('a co-founder reads, uploads, moves, renames and matches; the upload takes its folder\'s visibility', async () => {
  const db = freshDb();
  const read = await call(db, COFOUNDER, 'GET', '/p-room');
  assert.equal(read.status, 200);
  assert.equal(read.body.role, 'cofounder');
  const up = await call(db, COFOUNDER, 'POST', '/p-room/files', { name: 'Board pack.pdf', data: 'data:application/pdf;base64,AAAA', folder_uid: 'd-deck' });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const row = db.prepare('SELECT visibility, access_tier, uploaded_by_user_id FROM data_room_files WHERE uid = ?').get(up.body.uid);
  assert.deepEqual({ ...row }, { visibility: 'nda', access_tier: 'invited', uploaded_by_user_id: COFOUNDER }, 'the Deck folder is NDA, so the upload is too');
  assert.equal((await call(db, COFOUNDER, 'PATCH', '/p-room/files/f-root', { name: 'Read me.pdf', folder_uid: 'd-fin', checklist_item: null })).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT name, folder_id FROM data_room_files WHERE id = 34').get() }, { name: 'Read me.pdf', folder_id: 51 });
  assert.equal((await call(db, COFOUNDER, 'POST', '/p-room/folders', { name: 'Hiring' })).status, 201);
  assert.equal((await call(db, COFOUNDER, 'PATCH', '/p-room/folders/d-legal', { name: 'Legal docs' })).status, 200);
});

test('a co-founder cannot share, revoke, change a grant, change a gate or delete a file; the owner can', async () => {
  const db = freshDb();
  const refused = [
    ['POST', '/p-room/grants', { email: 'lat@example.com' }],
    ['PATCH', '/p-room/grants/g-signed', { folders: null }],
    ['DELETE', '/p-room/grants/g-signed', undefined],
    ['PATCH', '/p-room/files/f-model', { visibility: 'nda' }],
    ['PATCH', '/p-room/files/f-model', { access_tier: 'nobody' }],
    ['PATCH', '/p-room/files/f-model', { access_expires_at: '2030-01-01' }],
    ['PATCH', '/p-room/folders/d-fin', { visibility: 'nda', apply_to_contents: true }],
    ['POST', '/p-room/folders', { name: 'Secret', visibility: 'nda' }],
    ['POST', '/p-room/files', { name: 'x.pdf', data: 'data:application/pdf;base64,AAAA', visibility: 'open' }],
    ['DELETE', '/p-room/files/f-model', undefined],
  ] as const;
  for (const [method, path, body] of refused) {
    const res = await call(db, COFOUNDER, method, path, body);
    assert.equal(res.status, 403, `${method} ${path} ${JSON.stringify(body)}`);
    assert.equal(res.body.code, 'owner_only');
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM data_room_grants WHERE investor_user_id = ?').get(LATER).n, 0);
  assert.equal(db.prepare("SELECT status FROM data_room_grants WHERE id = 1").get().status, 'active');
  assert.deepEqual({ ...db.prepare('SELECT visibility, access_tier FROM data_room_files WHERE id = 32').get() }, { visibility: 'open', access_tier: 'invited' });
  // The owner does each of them.
  assert.equal((await call(db, FOUNDER, 'POST', '/p-room/grants', { email: 'lat@example.com' })).status, 201);
  assert.equal((await call(db, FOUNDER, 'PATCH', '/p-room/files/f-model', { visibility: 'nda' })).status, 200);
  assert.equal((await call(db, FOUNDER, 'DELETE', '/p-room/grants/g-signed')).status, 200);
});

test('an advisor member and a pending or removed co-founder are not co-founders: 404', async () => {
  const db = freshDb();
  assert.equal((await call(db, ADVISOR, 'GET', '/p-room')).status, 404);
  assert.equal((await call(db, ADVISOR, 'POST', '/p-room/files', { name: 'x.pdf', data: 'data:application/pdf;base64,AAAA' })).status, 404);
  db.prepare("UPDATE project_members SET status = 'removed' WHERE user_id = ?").run(COFOUNDER);
  assert.equal((await call(db, COFOUNDER, 'GET', '/p-room')).status, 404);
  assert.equal((await call(db, COFOUNDER, 'POST', '/p-room/files/f-deck/download')).status, 404);
});

/* ------------------------------------------------------------------ *
 * The preview
 * ------------------------------------------------------------------ */

test('the preview is the investor read for that grant: what it opens by name, what it hides as a count, and no log row', async () => {
  const db = freshDb();
  const res = await call(db, FOUNDER, 'GET', '/p-room/preview?grant=g-scoped');
  assert.equal(res.status, 200);
  assert.equal(res.body.open, true);
  assert.deepEqual(res.body.files.map((x: any) => x.uid).sort(), ['f-cap', 'f-model']);
  assert.equal(res.body.hidden_from_grant, 2);
  assert.ok(!/Pitch deck|Readme|f-deck|f-root|Rival/.test(JSON.stringify(res.body)), 'a file the grant cannot open is never named');
  const investor = await call(db, SCOPED, 'GET', '/shared/p-room');
  const { grant_uid, open, hidden_from_grant, ...same } = res.body;
  assert.deepEqual(same, investor.body, 'the same filter as the investor\'s own read');
  assert.equal(accessLog(db), 1, 'only the investor\'s own read was logged');
  assert.equal((await call(db, COFOUNDER, 'GET', '/p-room/preview?grant=g-signed')).body.hidden_from_grant, 0);
});

test('the preview: a revoked grant opens nothing, another venture\'s grant or none is 404, and only members may preview', async () => {
  const db = freshDb();
  db.prepare("UPDATE data_room_grants SET status = 'revoked' WHERE id = 2").run();
  const revoked = await call(db, FOUNDER, 'GET', '/p-room/preview?grant=g-scoped');
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.open, false);
  assert.equal(revoked.body.files, undefined);
  assert.equal((await call(db, FOUNDER, 'GET', '/p-room/preview?grant=g-rival')).status, 404);
  assert.equal((await call(db, FOUNDER, 'GET', '/p-room/preview')).status, 404);
  for (const id of [SIGNED, SCOPED, RIVAL, ADVISOR]) assert.equal((await call(db, id, 'GET', '/p-room/preview?grant=g-signed')).status, 404, String(id));
  assert.equal(accessLog(db), 0);
});
