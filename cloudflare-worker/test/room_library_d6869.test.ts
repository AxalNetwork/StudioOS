/**
 * D6869 (#6869): a data-room file in an investor's Library, a live reference that follows the grant
 * (`routes/room_library.ts`, `services/roomLibrary.ts`, and the guards on `routes/research.ts`).
 *
 * Real schema (`loadSchema`, so migration 202611161204_6869 is applied), real routes, synthetic fixtures:
 *   FOUNDER   owns venture 7's room
 *   COFOUNDER an accepted cofounder of venture 7
 *   HOLDER    investor with an active grant on venture 7 and an active NDA
 *   OTHER     investor with no grant
 *   ADMIN     platform admin
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/room_library_d6869.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import roomLibrary from '../src/routes/room_library.ts';
import research from '../src/routes/research.ts';
import { reconcileRoomRefs } from '../src/services/roomLibrary.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d6869-room-library-0123456789';
const FOUNDER = 1, COFOUNDER = 2, HOLDER = 3, OTHER = 4, ADMIN = 5;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare(`INSERT INTO users (id, role, founder_id, name, email, is_active, investor_tier, investor_subscription_status) VALUES (?, ?, ?, ?, ?, 1, ?, 'active')`);
  u.run(FOUNDER, 'founder', 100, 'Mara', 'mara@co.example', 'free');
  u.run(COFOUNDER, 'founder', 300, 'Cora', 'cora@co.example', 'free');
  u.run(HOLDER, 'investor', null, 'Theo', 'theo@vc.example', 'professional');
  u.run(OTHER, 'investor', null, 'Oli', 'oli@vc.example', 'professional');
  u.run(ADMIN, 'admin', null, 'Ada', 'ada@axal.example', 'free');
  db.exec(`
    INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p-room', 'Halverton', 100);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (7, ${COFOUNDER}, 'cofounder', 'accepted');
    INSERT INTO data_room_grants (id, uid, project_id, investor_user_id, granted_by_user_id, status) VALUES (1, 'g-holder', 7, ${HOLDER}, ${FOUNDER}, 'active');
    INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (${FOUNDER}, ${HOLDER}, 'active');
    INSERT INTO data_room_files (id, uid, project_id, name, visibility, r2_key, content_type, size_bytes) VALUES
      (11, 'f-open', 7, 'Cohort retention Q3.xlsx', 'open', 'data-room/p-room/open', 'text/csv', 5000),
      (12, 'f-nda', 7, 'Term sheet draft.pdf', 'nda', 'data-room/p-room/nda', 'application/pdf', 9000),
      (13, 'f-hidden', 7, 'Board only.pdf', 'open', 'data-room/p-room/hidden', 'application/pdf', 100);
    UPDATE data_room_files SET access_tier = 'nobody' WHERE id = 13;
  `);
  return db;
}

const app = new Hono<any>();
app.route('/api/room-library', roomLibrary);
app.route('/api/research', research);

const deleted: string[] = [];
async function call(db: DatabaseSync, userId: number, method: string, path: string, body?: unknown) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any)?.role ?? 'founder';
  const token = await new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  let res: Response;
  try {
    res = await app.fetch(new Request(`http://t${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), {
      JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db),
      FILES: { put: async () => {}, delete: async (k: string) => { deleted.push(k); }, get: async () => null },
    } as any);
  } catch (e) {
    if (e instanceof Response) res = e; else throw e;
  }
  const text = await res.text();
  let parsed: any = null; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}
const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  const [w, e, l] = [console.warn, console.error, console.log];
  console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try { return await f(); } finally { console.warn = w; console.error = e; console.log = l; }
};
const switchOn = (db: DatabaseSync) => db.exec(`INSERT INTO data_room_library_settings (project_id, allow_library, updated_at) VALUES (7, 1, '2026-11-16')`);
const log = (db: DatabaseSync, action: string) => (db.prepare('SELECT COUNT(*) AS n FROM data_room_access_log WHERE action = ?').get(action) as any).n;
const ref = (db: DatabaseSync) => db.prepare('SELECT * FROM research_room_refs ORDER BY id DESC LIMIT 1').get() as any;

test('the switch is off by default: an add is refused until the founder turns it on', async () => {
  const db = fixture();
  const off = await call(db, HOLDER, 'POST', '/api/room-library/items', { project_uid: 'p-room', file_uid: 'f-open' });
  assert.equal(off.status, 403);
  assert.equal(off.body.error, 'library_off');
  const s = await call(db, FOUNDER, 'GET', '/api/room-library/settings/p-room');
  assert.deepEqual(s.body, { allow_library: false, live_references: 0, can_change: true });
});

test('an add: the investor’s own read-only row, kind diligence, the room file’s key, no storage counted; logged as library_add', async () => {
  const db = fixture(); switchOn(db);
  const res = await quiet(() => call(db, HOLDER, 'POST', '/api/room-library/items', { project_uid: 'p-room', file_uid: 'f-open' }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const doc = db.prepare('SELECT * FROM research_documents WHERE uid = ?').get(res.body.document_uid) as any;
  assert.equal(doc.owner_user_id, HOLDER);
  assert.equal(doc.kind, 'diligence');
  assert.equal(doc.r2_key, 'data-room/p-room/open', 'a reference, not a copy');
  assert.equal(doc.size_bytes, null, 'the bytes are the room’s, not counted against the investor');
  assert.equal(ref(db).grant_id, 1);
  assert.equal(log(db, 'library_add'), 1, 'the founder sees the Add in the room’s activity');
  const again = await call(db, HOLDER, 'POST', '/api/room-library/items', { project_uid: 'p-room', file_uid: 'f-open' });
  assert.equal(again.body.error, 'already_added');
  const room = await call(db, HOLDER, 'GET', '/api/room-library/rooms/p-room');
  assert.equal(room.body.allowed, true);
  assert.deepEqual(room.body.items.map((i: any) => i.file_uid), ['f-open']);
  const lib = await call(db, HOLDER, 'GET', '/api/research/documents');
  const row = lib.body.items.find((i: any) => i.uid === res.body.document_uid);
  assert.equal(row.read_only, true);
  assert.equal(row.room.project_name, 'Halverton');
  assert.equal(row.room.lost_reason, null);
  assert.equal(lib.body.from_rooms, 1);
});

test('the room’s gate decides an add: no grant, a hidden file, an admin, and the NDA', async () => {
  const db = fixture(); switchOn(db);
  assert.equal((await call(db, OTHER, 'POST', '/api/room-library/items', { project_uid: 'p-room', file_uid: 'f-open' })).body.error, 'room_not_found');
  // mutation: the tier check dropped → 201 here.
  assert.equal((await call(db, HOLDER, 'POST', '/api/room-library/items', { project_uid: 'p-room', file_uid: 'f-hidden' })).body.error, 'file_not_found', 'a file the tier hides answers as not there');
  assert.equal((await call(db, ADMIN, 'POST', '/api/room-library/items', { project_uid: 'p-room', file_uid: 'f-open' })).body.error, 'investor_only');
  // D6073: a file in Trash answers as not there. mutation: liveFiles dropped from the add's lookup → 201 here.
  const binned = fixture(); switchOn(binned); binned.exec(`UPDATE data_room_files SET removed_at = '2026-11-16 09:00:00' WHERE id = 11`);
  assert.equal((await call(binned, HOLDER, 'POST', '/api/room-library/items', { project_uid: 'p-room', file_uid: 'f-open' })).body.error, 'file_not_found', 'a file in Trash');
  assert.equal((await quiet(() => call(db, HOLDER, 'POST', '/api/room-library/items', { project_uid: 'p-room', file_uid: 'f-nda' }))).status, 201, 'behind a live NDA');
  const db2 = fixture(); switchOn(db2); db2.exec(`UPDATE pairwise_ndas SET status = 'expired'`);
  const nda = await quiet(() => call(db2, HOLDER, 'POST', '/api/room-library/items', { project_uid: 'p-room', file_uid: 'f-nda' }));
  assert.equal(nda.body.error, 'nda_required');
  assert.equal(log(db2, 'blocked'), 1);
});

test('each lapse reads its own reason; the row stays, its index state is source_lost, and it is never indexed again', async () => {
  const cases: Array<[string, (db: DatabaseSync) => void, string]> = [
    ['revoked', (db) => db.exec(`UPDATE data_room_grants SET status = 'revoked'`), 'f-open'],
    ['expired', (db) => db.exec(`UPDATE data_room_grants SET expires_at = '2020-01-01T00:00:00Z'`), 'f-open'],
    ['removed', (db) => db.exec(`DELETE FROM data_room_files WHERE id = 11`), 'f-open'],
    // D6073: a file the founder moved to Trash is gone for investors too. mutation: liveFiles dropped from refAccess → no lapse.
    ['removed', (db) => db.exec(`UPDATE data_room_files SET removed_at = '2026-11-16 09:00:00' WHERE id = 11`), 'f-open'],
    ['moved', (db) => db.exec(`UPDATE data_room_files SET access_tier = 'nobody' WHERE id = 11`), 'f-open'],
    ['nda_lapsed', (db) => db.exec(`UPDATE pairwise_ndas SET status = 'expired'`), 'f-nda'],
    ['library_off', (db) => db.exec(`UPDATE data_room_library_settings SET allow_library = 0`), 'f-open'],
  ];
  for (const [reason, lapse, file] of cases) {
    const db = fixture(); switchOn(db);
    const add = await quiet(() => call(db, HOLDER, 'POST', '/api/room-library/items', { project_uid: 'p-room', file_uid: file }));
    db.exec(`UPDATE research_documents SET index_state = 'indexed', chunk_count = 3`);
    lapse(db);
    const lib = await quiet(() => call(db, HOLDER, 'GET', '/api/research/documents'));
    const row = lib.body.items.find((i: any) => i.uid === add.body.document_uid);
    assert.ok(row, `${reason}: the row stays`);
    assert.equal(row.room.lost_reason, reason, reason);
    assert.equal(row.in_ask, false, `${reason}: Ask stops citing it`);
    assert.equal(row.index_state, 'source_lost');
    assert.equal(row.chunk_count, null, `${reason}: the index entries are gone`);
    const re = await call(db, HOLDER, 'POST', `/api/research/documents/${add.body.document_uid}/reindex`);
    assert.equal(re.body.detail, 'source_no_longer_available', `${reason}: not indexed again`);
  }
});

test('the founder turning the switch off lapses every live reference at once; only the owner may', async () => {
  const db = fixture(); switchOn(db);
  await quiet(() => call(db, HOLDER, 'POST', '/api/room-library/items', { project_uid: 'p-room', file_uid: 'f-open' }));
  assert.equal((await call(db, COFOUNDER, 'PUT', '/api/room-library/settings/p-room', { allow_library: false })).body.error, 'owner_only');
  assert.equal((await call(db, HOLDER, 'PUT', '/api/room-library/settings/p-room', { allow_library: false })).status, 404);
  const off = await quiet(() => call(db, FOUNDER, 'PUT', '/api/room-library/settings/p-room', { allow_library: false }));
  assert.deepEqual(off.body, { allow_library: false, lapsed: 1 });
  assert.equal(ref(db).lost_reason, 'library_off');
  const cof = await call(db, COFOUNDER, 'GET', '/api/room-library/settings/p-room');
  assert.equal(cof.body.can_change, false);
});

test('a room reference is opened in the room and never edited, and removing it never deletes the room’s file', async () => {
  const db = fixture(); switchOn(db);
  const add = await quiet(() => call(db, HOLDER, 'POST', '/api/room-library/items', { project_uid: 'p-room', file_uid: 'f-open' }));
  const uid = add.body.document_uid;
  // mutation: the download guard dropped → a signed URL for the room's bytes from Research.
  const dl = await call(db, HOLDER, 'GET', `/api/research/documents/${uid}/download`);
  assert.equal(dl.status, 409);
  assert.equal(dl.body.detail, 'open_in_room');
  assert.equal(dl.body.project_uid, 'p-room');
  assert.equal((await call(db, HOLDER, 'PATCH', `/api/research/documents/${uid}`, { title: 'Mine now' })).body.detail, 'room_reference_read_only');
  deleted.length = 0;
  // mutation: the delete guard dropped → the room's object is deleted from R2.
  const del = await quiet(() => call(db, HOLDER, 'DELETE', `/api/research/documents/${uid}`));
  assert.equal(del.status, 200);
  assert.deepEqual(deleted, [], 'the room’s file is never deleted');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM research_room_refs').get() as any).n, 0);
  assert.equal(log(db, 'library_remove'), 1, 'the founder sees the Remove');
  // The same through the room-library route.
  const add2 = await quiet(() => call(db, HOLDER, 'POST', '/api/room-library/items', { project_uid: 'p-room', file_uid: 'f-open' }));
  assert.equal((await quiet(() => call(db, OTHER, 'DELETE', `/api/room-library/items/${add2.body.document_uid}`))).status, 404, 'another investor cannot remove it');
  assert.equal((await quiet(() => call(db, HOLDER, 'DELETE', `/api/room-library/items/${add2.body.document_uid}`))).status, 200);
  assert.deepEqual(deleted, []);
  assert.equal(log(db, 'library_remove'), 2);
});

test('a replaced file is followed: the reference takes the new key and is read again', async () => {
  const db = fixture(); switchOn(db);
  const add = await quiet(() => call(db, HOLDER, 'POST', '/api/room-library/items', { project_uid: 'p-room', file_uid: 'f-open' }));
  db.exec(`UPDATE research_documents SET index_state = 'indexed', chunk_count = 2; UPDATE data_room_files SET r2_key = 'data-room/p-room/open-v2' WHERE id = 11`);
  await quiet(() => reconcileRoomRefs({ DB: d1Over(db) } as any, HOLDER));
  const doc = db.prepare('SELECT r2_key, index_state FROM research_documents WHERE uid = ?').get(add.body.document_uid) as any;
  assert.deepEqual({ ...doc }, { r2_key: 'data-room/p-room/open-v2', index_state: 'pending' });
});

test('the store holds one live reference per investor and file', () => {
  const db = fixture();
  const ins = db.prepare(`INSERT INTO research_room_refs (document_id, owner_user_id, project_id, file_id, grant_id, added_at) VALUES (?, ${HOLDER}, 7, 11, 1, '2026-11-16')`);
  ins.run(1);
  assert.throws(() => ins.run(2), /UNIQUE constraint failed/);
  db.exec(`UPDATE research_room_refs SET lost_at = '2026-11-17', lost_reason = 'revoked' WHERE document_id = 1`);
  ins.run(2);
  assert.throws(() => db.exec(`UPDATE research_room_refs SET lost_reason = NULL WHERE document_id = 1`), /CHECK constraint failed/);
});
