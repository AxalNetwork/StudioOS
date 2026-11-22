/**
 * D6073 (#6073) — the data room's 30-day Trash, on real SQLite: Remove is a
 * stamp, every investor read and count leaves a stamped file out at once,
 * Restore returns the file with its folder, gate and versions (or to the top
 * level when its folder was deleted), Delete now and the 30-day sweep delete
 * the stored objects and then the rows, idempotently, and keep a connector's
 * "deleted stays deleted" ledger (D1094). Only the owner and a co-founder see
 * Trash and restore; only the owner removes and deletes now.
 *
 * The data-room tables are cut from `sql/schema_baseline.sql` and the
 * migrations that changed them, the new columns from migration
 * 202611152333_6073 itself, so a query naming a column production does not
 * have fails here too.
 *
 * The last test is a source guard: every read of `data_room_files` in the
 * Worker either leaves Trash out or is listed below with its reason, so a new
 * reader cannot quietly show a removed file.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/data_room_trash_6073.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { tableFromBaseline, stripForeignKeys, addColumnsFrom, splitStatements } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withGrantFolders } from './_data_room_scope.mjs';

import dataRoom, { roomSummary } from '../src/routes/data_room.ts';
import { admittedCounts, tierAdmits } from '../src/services/dataRoomAccess.ts';
import { readableRoomFiles } from '../src/services/raiseEvidence.ts';
import { roomGatesAskNda } from '../src/services/dataRoomNda.ts';
import { checklistRead } from '../src/services/dataRoomActivity.ts';
import { searchRoom, DIMENSIONS } from '../src/services/dataRoomSearch.ts';
import { daysLeft, purgeExpiredTrash, readTrash, TRASH_DAYS } from '../src/services/dataRoomTrash.ts';
import { applySuppressionLedger } from './_suppression_ledger.mjs';

const read = (p: string) => readFileSync(p, 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIG = (n: string) => read(`cloudflare-worker/sql/migrations/${n}`);
const TRASH_MIG = MIG('202611152333_6073_data_room_trash.sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = 1;   // founders row 100, owns p-room
const SIGNED = 2;    // grant g-signed on p-room, live NDA, committed
const COFOUNDER = 5; // accepted co-founder of p-room
const ADVISOR = 6;   // accepted advisor of p-room
const RIVAL = 4;     // owns p-rival
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [SIGNED]: 'investor', [COFOUNDER]: 'founder', [ADVISOR]: 'advisor', [RIVAL]: 'founder' };

const DAY = 86_400_000;

function freshDb() {
  const db = new DatabaseSync(':memory:');
  applySuppressionLedger(db); // D6654
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
  addColumnsFrom(db, stripForeignKeys(MIG('463_raise_record_stores.sql')), 'data_room_files');
  addColumnsFrom(db, MIG('596_data_room_file_source.sql'), 'data_room_files');
  addColumnsFrom(db, stripForeignKeys(MIG('442_raise_cycle_stores.sql')), 'data_room_files');
  addColumnsFrom(db, stripForeignKeys(TRASH_MIG), 'data_room_files');
  for (const s of splitStatements(TRASH_MIG)) if (s.startsWith('CREATE INDEX')) db.exec(s);
  db.exec(stripForeignKeys(splitStatements(MIG('463_raise_record_stores.sql')).find((s: string) => s.includes('CREATE TABLE IF NOT EXISTS data_room_file_versions'))));
  db.exec(MIG('445_connector_fed_items.sql'));
  for (const s of splitStatements(MIG('765_data_room_search.sql'))) if (s.startsWith('CREATE')) db.exec(s);
  withGrantFolders(db);

  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?,?,?,?,?)');
  u.run(FOUNDER, 'founder', 100, 'Fran', 'fran@example.test');
  u.run(SIGNED, 'investor', null, 'Sig', 'sig@example.test');
  u.run(COFOUNDER, 'founder', 300, 'Cora', 'cora@example.test');
  u.run(ADVISOR, 'advisor', null, 'Avi', 'avi@example.test');
  u.run(RIVAL, 'founder', 200, 'Rae', 'rae@example.test');
  const p = db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?,?,?,?)');
  p.run(7, 'p-room', 'Roomco', 100);
  p.run(9, 'p-rival', 'Rivalco', 200);
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (7, ?, 'cofounder', 'accepted'), (7, ?, 'advisor', 'accepted')`)
    .run(COFOUNDER, ADVISOR);
  db.prepare(`INSERT INTO data_room_grants (id, uid, project_id, investor_user_id, granted_by_user_id, status, folders_scoped)
    VALUES (1, 'g-signed', 7, ?, ?, 'active', 0)`).run(SIGNED, FOUNDER);
  db.prepare(`INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (?, ?, 'active')`).run(FOUNDER, SIGNED);
  db.prepare(`INSERT INTO raise_prospects (uid, project_id, name, email, stage) VALUES ('rp1', 7, 'Sig', 'sig@example.test', 'committed')`).run();

  db.prepare(`INSERT INTO data_room_folders (id, uid, project_id, parent_id, name, visibility) VALUES
    (51, 'd-fin', 7, NULL, 'Financials', 'open'), (52, 'd-legal', 7, NULL, 'Legal', 'nda')`).run();
  const f = db.prepare(`INSERT INTO data_room_files
    (id, uid, project_id, folder_id, name, r2_key, content_type, size_bytes, visibility, uploaded_by_user_id, access_tier, access_expires_at, checklist_item)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  f.run(31, 'f-keep', 7, 51, 'Model.xlsx', 'data-room/p-room/model', 'application/vnd.ms-excel', 900, 'open', FOUNDER, 'invited', null, null);
  // The file this suite removes: NDA, committed-only, an end date, a checklist match, two earlier versions.
  f.run(32, 'f-gone', 7, 52, 'Customer contracts.pdf', 'data-room/p-room/contracts-v3', 'application/pdf', 700, 'nda', FOUNDER, 'committed', '2099-01-01', 'customer_contracts');
  f.run(41, 'f-rival', 9, null, 'Rival.pdf', 'data-room/p-rival/rival', 'application/pdf', 10, 'open', RIVAL, 'invited', null, null);
  const v = db.prepare('INSERT INTO data_room_file_versions (file_id, version, r2_key, content_type, size_bytes, uploaded_by) VALUES (?,?,?,?,?,?)');
  v.run(32, 1, 'data-room/p-room/contracts-v1', 'application/pdf', 600, FOUNDER);
  v.run(32, 2, 'data-room/p-room/contracts-v2', 'application/pdf', 650, FOUNDER);
  return db;
}

function bucket(fail = false) {
  const deleted: string[] = [];
  return {
    deleted,
    put: async () => {},
    delete: async (k: string | string[]) => { if (fail) throw new Error('R2 down'); for (const x of [k].flat()) deleted.push(x); },
  };
}

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: ROLE[userId] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
function envOf(db: any, files = bucket()): any {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES: files };
}
async function call(db: any, userId: number, method: string, path: string, files = bucket(), body?: unknown) {
  const res = await dataRoom.fetch(
    new Request(`http://x${path}`, {
      method,
      headers: { Authorization: `Bearer ${await token(userId)}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    envOf(db, files),
  );
  const raw = await res.text();
  let parsed: any = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
  return { status: res.status, body: parsed, raw };
}

const vec = () => Array.from({ length: DIMENSIONS }, () => 0.01);
function passages(db: any) {
  const p = db.prepare('INSERT INTO data_room_passages (project_id, file_id, seq, text, vector_id) VALUES (7, ?, 0, ?, ?)');
  p.run(31, 'revenue model passage', 'drf:31:0');
  p.run(32, 'contracts passage', 'drf:32:0');
}
const searchDeps = () => ({
  index: { query: async () => ({ matches: [{ id: 'drf:31:0' }, { id: 'drf:32:0' }] }) } as any,
  embed: async () => vec(), rerank: async () => null,
}) as any;

/**
 * Every investor-facing read and count of the room, with whether it shows
 * f-gone (by name, by uid or by count). Each entry is one reader.
 */
async function investorReads(db: any): Promise<Record<string, unknown>> {
  const env = envOf(db);
  const shared = await call(db, SIGNED, 'GET', '/shared');
  const room = await call(db, SIGNED, 'GET', '/shared/p-room');
  const dl = await call(db, SIGNED, 'POST', '/shared/p-room/files/f-gone/download');
  const preview = await call(db, FOUNDER, 'GET', '/p-room/preview?grant=g-signed');
  const founder = await call(db, FOUNDER, 'GET', '/p-room');
  const search = await searchRoom(env, searchDeps(), 7, 'contracts', null);
  return {
    'GET /shared file_count': shared.body.items[0].file_count,
    'GET /shared/:p lists it': room.raw.includes('f-gone') || room.raw.includes('Customer contracts'),
    'GET /shared/:p withheld_behind_nda': room.body.withheld_behind_nda,
    'POST /shared/:p/files/:uid/download': dl.status,
    'GET /:p/preview lists it': preview.raw.includes('f-gone'),
    'GET /:p/preview hidden_from_grant': preview.body.hidden_from_grant,
    'GET /:p (founder) lists it': founder.body.files.some((f: any) => f.uid === 'f-gone'),
    'admittedCounts total': (await admittedCounts(env, 7, true, true, null)).total,
    'readableRoomFiles': (await readableRoomFiles(env, 7)).map((f: any) => f.uid).sort(),
    'roomGatesAskNda': await roomGatesAskNda(env, 7),
    'roomSummary total': ((await roomSummary(env, { id: 7, uid: 'p-room' })) as any).files.total,
    'checklistRead files': (await checklistRead(env, 7)).items.flatMap((i: any) => i.files.map((f: any) => f.uid)),
    'searchRoom hits': search.available ? (search as any).value.hits.map((h: any) => h.file_uid) : search,
  };
}

test('Remove is a stamp: the row, its versions and its objects stay; it is the owner’s alone', async () => {
  // Mutation checked: trashFile deleting the row → the row-count assertion fails; `delete` given to MEMBER → the co-founder's 403 fails.
  const db = freshDb();
  const files = bucket();
  assert.equal((await call(db, COFOUNDER, 'DELETE', '/p-room/files/f-gone')).status, 403, 'a co-founder does not remove');
  const r = await call(db, FOUNDER, 'DELETE', '/p-room/files/f-gone', files);
  assert.equal(r.status, 200);
  assert.equal(r.body.in_trash, true);
  assert.equal(Date.parse(r.body.purge_at) - Date.parse(r.body.removed_at), TRASH_DAYS * DAY);
  const row = db.prepare('SELECT * FROM data_room_files WHERE id = 32').get() as any;
  assert.ok(row.removed_at, 'stamped');
  assert.equal(row.removed_by_user_id, FOUNDER);
  assert.equal(row.removed_folder_name, 'Legal');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM data_room_file_versions WHERE file_id = 32').get() as any).n, 2);
  assert.deepEqual(files.deleted, [], 'nothing is deleted from storage');
  assert.equal((await call(db, FOUNDER, 'DELETE', '/p-room/files/f-gone')).status, 404, 'a file already in Trash is not in the room');
  assert.equal((await call(db, RIVAL, 'DELETE', '/p-room/files/f-keep')).status, 404);
});

test('a removed file is gone from every investor read and count at once, and back on Restore', async () => {
  // Mutation checked, one at a time: the liveFiles clause dropped from investorView, admittedCounts, readableRoomFiles,
  // roomGatesAskNda, roomSummary, checklistRead and searchRoom, and the shared-download lookup → each named key differs.
  const db = freshDb();
  passages(db);
  const before = await investorReads(db);
  assert.deepEqual(before, {
    'GET /shared file_count': 2,
    'GET /shared/:p lists it': true,
    'GET /shared/:p withheld_behind_nda': 0,
    'POST /shared/:p/files/:uid/download': 200,
    'GET /:p/preview lists it': true,
    'GET /:p/preview hidden_from_grant': 0,
    'GET /:p (founder) lists it': true,
    'admittedCounts total': 2,
    'readableRoomFiles': ['f-gone', 'f-keep'],
    'roomGatesAskNda': true,
    'roomSummary total': 2,
    'checklistRead files': ['f-gone'],
    'searchRoom hits': ['f-keep', 'f-gone'],
  });
  assert.equal((await call(db, FOUNDER, 'DELETE', '/p-room/files/f-gone')).status, 200);
  assert.deepEqual(await investorReads(db), {
    'GET /shared file_count': 1,
    'GET /shared/:p lists it': false,
    'GET /shared/:p withheld_behind_nda': 0,
    'POST /shared/:p/files/:uid/download': 404,
    'GET /:p/preview lists it': false,
    'GET /:p/preview hidden_from_grant': 0,
    'GET /:p (founder) lists it': false,
    'admittedCounts total': 1,
    'readableRoomFiles': ['f-keep'],
    'roomGatesAskNda': false,
    'roomSummary total': 1,
    'checklistRead files': [],
    'searchRoom hits': ['f-keep'],
  }, 'hidden from every read, counted nowhere, and not even as hidden');
  // The founder's own per-file reads answer as for a file not in the room, until it is restored.
  for (const [m, path] of [['POST', '/p-room/files/f-gone/download'], ['GET', '/p-room/files/f-gone/versions'],
    ['POST', '/p-room/files/f-gone/versions/1/current'], ['PATCH', '/p-room/files/f-gone']] as const) {
    assert.equal((await call(db, FOUNDER, m, path, bucket(), m === 'PATCH' ? { name: 'x' } : undefined)).status, 404, `${m} ${path}`);
  }
  // A reader that selected the whole row (`SELECT *`: readableRoomFiles, a deck proof) is refused by the gate itself.
  assert.equal(tierAdmits({ access_tier: 'invited', removed_at: '2026-11-01T00:00:00.000Z' } as any, true, Date.parse('2026-11-15T00:00:00Z'), null), false);
  assert.equal(tierAdmits({ access_tier: 'invited', removed_at: null } as any, true, Date.parse('2026-11-15T00:00:00Z'), null), true);
  const restored = await call(db, COFOUNDER, 'POST', '/p-room/trash/f-gone/restore');
  assert.equal(restored.status, 200);
  assert.deepEqual(await investorReads(db), before, 'Restore returns it to every read');
});

test('Restore returns the folder, the gate, the matches and the versions; a deleted folder sends it to the top level, said so', async () => {
  // Mutation checked: restoreFile keeping a dangling folder_id → folder_id 999 survives; folder_gone always false → Trash says nothing.
  const db = freshDb();
  const gate = (id: number) => ({ ...(db.prepare('SELECT folder_id, visibility, access_tier, access_expires_at, checklist_item FROM data_room_files WHERE id = ?').get(id) as any) });
  const was = gate(32);
  await call(db, FOUNDER, 'DELETE', '/p-room/files/f-gone');
  const r = await call(db, FOUNDER, 'POST', '/p-room/trash/f-gone/restore');
  assert.deepEqual(r.body, { ok: true, uid: 'f-gone', folder_uid: 'd-legal', returned_to_top_level: false });
  assert.deepEqual(gate(32), was);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM data_room_file_versions WHERE file_id = 32').get() as any).n, 2);
  const row = db.prepare('SELECT removed_at, removed_by_user_id, removed_folder_name FROM data_room_files WHERE id = 32').get() as any;
  assert.deepEqual({ ...row }, { removed_at: null, removed_by_user_id: null, removed_folder_name: null });
  assert.equal((await call(db, FOUNDER, 'POST', '/p-room/trash/f-gone/restore')).body.code, 'not_in_trash', 'twice is once');

  // The folder is deleted while the file waits (foreign keys off, as D1 may run: the id dangles).
  await call(db, FOUNDER, 'DELETE', '/p-room/files/f-gone');
  db.exec('DELETE FROM data_room_folders WHERE id = 52');
  const trash = await call(db, COFOUNDER, 'GET', '/p-room/trash');
  assert.equal(trash.body.items[0].folder, 'Legal');
  assert.equal(trash.body.items[0].folder_gone, true);
  const back = await call(db, COFOUNDER, 'POST', '/p-room/trash/f-gone/restore');
  assert.equal(back.body.returned_to_top_level, true);
  assert.equal(back.body.folder_uid, null);
  assert.equal(gate(32).folder_id, null, 'at the top level, not in a folder that is gone');
  assert.equal(gate(32).visibility, 'nda', 'the gate is kept');
});

test('Trash: the owner and a co-founder read it with days left; nobody else does; only the owner deletes now', async () => {
  // Mutation checked: `restore` given to nobody → the co-founder's read is 403; Trash read without the project scope → the rival's file shows.
  const db = freshDb();
  db.exec("UPDATE data_room_files SET removed_at = '2026-11-01T00:00:00.000Z', removed_by_user_id = 1, removed_folder_name = 'Legal' WHERE id = 32");
  db.exec("UPDATE data_room_files SET removed_at = '2026-11-01T00:00:00.000Z' WHERE id = 41");
  const owner = await call(db, FOUNDER, 'GET', '/p-room/trash');
  assert.equal(owner.status, 200);
  assert.deepEqual(owner.body.items.map((i: any) => [i.uid, i.name, i.folder, i.removed_by_name, i.earlier_versions]), [['f-gone', 'Customer contracts.pdf', 'Legal', 'Fran', 2]]);
  assert.equal(owner.body.can_delete_now, true);
  assert.equal(owner.body.trash_days, 30);
  const co = await call(db, COFOUNDER, 'GET', '/p-room/trash');
  assert.equal(co.status, 200);
  assert.equal(co.body.can_delete_now, false);
  for (const who of [ADVISOR, SIGNED, RIVAL]) {
    assert.equal((await call(db, who, 'GET', '/p-room/trash')).status, 404, `user ${who}`);
    assert.equal((await call(db, who, 'POST', '/p-room/trash/f-gone/restore')).status, 404, `user ${who}`);
    assert.equal((await call(db, who, 'DELETE', '/p-room/trash/f-gone')).status, 404, `user ${who}`);
  }
  assert.equal((await call(db, COFOUNDER, 'DELETE', '/p-room/trash/f-gone')).status, 403, 'a co-founder restores but does not delete now');
  assert.equal((await call(db, FOUNDER, 'GET', '/p-room')).body.trash_count, 1);
  assert.equal((await call(db, COFOUNDER, 'GET', '/p-room')).body.trash_count, 1);
  // Days left, on an injected clock: 30 on the day, 23 a week on, 0 (never negative) after.
  const removed = '2026-11-01T00:00:00.000Z';
  assert.equal(daysLeft(removed, new Date('2026-11-01T00:00:00Z')), 30);
  assert.equal(daysLeft(removed, new Date('2026-11-08T00:00:00Z')), 23);
  assert.equal(daysLeft(removed, new Date('2026-11-08T00:00:01Z')), 23, 'rounded up: a part day still counts');
  assert.equal(daysLeft(removed, new Date('2026-12-05T00:00:00Z')), 0);
  assert.equal(daysLeft('not a time', new Date('2026-11-08T00:00:00Z')), null);
  assert.equal((await readTrash(envOf(db), 7, new Date('2026-11-08T00:00:00Z'))).items[0].days_left, 23);
});

test('Delete now: the objects (current and every version) first, then the rows; a failed delete keeps it in Trash', async () => {
  // Mutation checked: rows deleted before the objects → the failed-R2 case loses the row; versions' keys left out → only one key deleted.
  const db = freshDb();
  passages(db);
  db.prepare(`INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
    VALUES (3, 7, 'data_room', 'drive_copy', 'drv1:copy:7', 'data_room_files', 32)`).run();
  await call(db, FOUNDER, 'DELETE', '/p-room/files/f-gone');
  assert.equal((await call(db, FOUNDER, 'DELETE', '/p-room/trash/f-keep')).status, 404, 'a file in the room is not deleted now');
  const failing = bucket(true);
  const refused = await call(db, FOUNDER, 'DELETE', '/p-room/trash/f-gone', failing);
  assert.equal(refused.status, 503);
  assert.equal(refused.body.code, 'delete_incomplete');
  assert.ok(db.prepare('SELECT 1 FROM data_room_files WHERE id = 32').get(), 'still in Trash');
  const files = bucket();
  const r = await call(db, FOUNDER, 'DELETE', '/p-room/trash/f-gone', files);
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted_versions, 2);
  assert.equal(r.body.trash_count, 0);
  assert.deepEqual(files.deleted.sort(), ['data-room/p-room/contracts-v1', 'data-room/p-room/contracts-v2', 'data-room/p-room/contracts-v3']);
  assert.equal(db.prepare('SELECT 1 FROM data_room_files WHERE id = 32').get(), undefined);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM data_room_file_versions WHERE file_id = 32').get() as any).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM data_room_passages WHERE file_id = 32').get() as any).n, 0);
  const ledger = db.prepare("SELECT local_id FROM connector_fed_items WHERE external_id = 'drv1:copy:7'").get() as any;
  assert.ok(ledger, 'D1094: the ledger row stays');
  assert.equal(ledger.local_id, null, 'with no local_id, so a re-sync never copies it again');
  assert.equal((await call(db, FOUNDER, 'DELETE', '/p-room/trash/f-gone')).status, 404, 'twice is once');
});

test('the sweep purges what has had its thirty days, oldest first, and nothing else; a second run does nothing', async () => {
  // Mutation checked: the cutoff at `now` instead of now − 30 days → the 29-day file goes; objects outside the prefix deleted → the foreign key appears.
  const db = freshDb();
  const now = new Date('2026-12-15T04:30:00Z');
  const at = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  db.prepare('UPDATE data_room_files SET removed_at = ? WHERE id = 32').run(at(31));
  db.prepare('UPDATE data_room_files SET removed_at = ? WHERE id = 31').run(at(29));
  db.prepare("UPDATE data_room_files SET removed_at = ?, r2_key = 'elsewhere/rival' WHERE id = 41").run(at(30));
  db.prepare(`INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
    VALUES (3, 7, 'data_room', 'drive_copy', 'drv1:copy:7', 'data_room_files', 32)`).run();
  const files = bucket();
  const env = envOf(db, files);
  assert.deepEqual(await purgeExpiredTrash(env, now), { scanned: 2, purged: 2, failed: 0 });
  assert.deepEqual(db.prepare('SELECT id FROM data_room_files ORDER BY id').all().map((r: any) => r.id), [31], 'the 29-day file waits');
  assert.deepEqual(files.deleted.sort(), ['data-room/p-room/contracts-v1', 'data-room/p-room/contracts-v2', 'data-room/p-room/contracts-v3'],
    'only keys inside the venture’s own prefix are deleted');
  assert.equal((db.prepare("SELECT local_id FROM connector_fed_items WHERE external_id = 'drv1:copy:7'").get() as any).local_id, null);
  assert.deepEqual(await purgeExpiredTrash(env, now), { scanned: 0, purged: 0, failed: 0 }, 'idempotent');
  // A storage failure is counted and the file waits for the next run.
  const failing = envOf(db, bucket(true));
  assert.deepEqual(await purgeExpiredTrash(failing, new Date(now.getTime() + 2 * DAY)), { scanned: 1, purged: 0, failed: 1 });
  assert.ok(db.prepare('SELECT 1 FROM data_room_files WHERE id = 31').get());
});

test('a database without the Trash column still reads, and Remove refuses rather than deleting', async () => {
  const db = new DatabaseSync(':memory:');
  applySuppressionLedger(db); // D6654
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT UNIQUE NOT NULL, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);`);
  for (const t of ['data_room_grants', 'data_room_files', 'data_room_folders', 'data_room_access_log', 'pairwise_ndas', 'raise_prospects', 'project_members', 'activity_logs']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  addColumnsFrom(db, stripForeignKeys(MIG('463_raise_record_stores.sql')), 'data_room_files');
  withGrantFolders(db);
  db.prepare("INSERT INTO users (id, role, founder_id, name) VALUES (1, 'founder', 100, 'Fran')").run();
  db.prepare("INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p-room', 'Roomco', 100)").run();
  db.prepare("INSERT INTO data_room_files (id, uid, project_id, name, r2_key) VALUES (31, 'f-keep', 7, 'Model.xlsx', 'data-room/p-room/m')").run();
  assert.equal((await admittedCounts(envOf(db), 7, true, true, null)).total, 1);
  const r = await call(db, FOUNDER, 'DELETE', '/p-room/files/f-keep');
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'trash_unavailable');
  assert.ok(db.prepare('SELECT 1 FROM data_room_files WHERE id = 31').get(), 'nothing was deleted');
});

/* ------------------------------------------------------------------ *
 * The source guard                                                     *
 * ------------------------------------------------------------------ */

/**
 * Reads and writes of `data_room_files` that do not leave Trash out, each with
 * why. Matched by file and a distinctive piece of its line. A new reader that
 * is not here and carries no `liveFiles(`/`removed_at` near it fails the test.
 */
const UNFILTERED: Array<[string, string, string]> = [
  ['routes/account_companies.ts', "SELECT 'raise', project_id FROM data_room_files", 'which cycles hold any record; a file in Trash is still recorded'],
  ['routes/captable.ts', 'INSERT INTO data_room_files', 'a write of a new file'],
  ['routes/cycle_use_of_funds.ts', 'INSERT INTO data_room_files', 'a write of a new file'],
  ['routes/data_room.ts', 'LEFT JOIN data_room_files f ON f.id = l.file_id', 'the founder’s access log keeps naming what was opened'],
  ['routes/data_room.ts', 'INSERT INTO data_room_files', 'a write of a new file'],
  ['routes/data_room.ts', 'UPDATE data_room_files SET r2_key = ?', 'Replace and Make current, after a live-only lookup'],
  ['routes/data_room.ts', 'UPDATE data_room_files SET deck_source = 0', 'deck source off, after a lookup that refuses a file in Trash'],
  ['routes/data_room.ts', 'EXISTS (SELECT 1 FROM data_room_files WHERE id = ? AND r2_key = ?)', 'the Make current swap guard, after a live-only lookup'],
  ['services/capTableRecord.ts', "const row = await env.DB.prepare('SELECT id FROM data_room_files WHERE id = ? AND project_id = ?')", 'whether a signed copy was filed; Trash does not unsign it'],
  ['services/cycleActivity.ts', 'FROM data_room_files f LEFT JOIN users u', 'who created a record, for the activity history'],
  ['services/cycleFocus.ts', 'EXISTS(SELECT 1 FROM data_room_files WHERE project_id = ?) AS files', 'whether anything was ever recorded'],
  ['services/dataRoomActivity.ts', 'LEFT JOIN data_room_files f ON f.id = l.file_id', 'the activity log keeps naming what was opened'],
  ['services/dataRoomProposals.ts', 'FROM data_room_files WHERE id = ? AND project_id = ?', 'accept and undo guards, after a live-only lookup'],
  ['services/dataRoomProposals.ts', 'UPDATE data_room_files SET', 'accept and undo writes, after a live-only lookup'],
  ['services/decks/dataroomExtract.ts', 'data_room_files', 'the extraction pipeline; sourceFile is SELECT * and its readers refuse a stamped row (route, tierAdmits)'],
  ['services/google/raise.ts', 'NOT EXISTS (SELECT 1 FROM data_room_files t', 'D1094: a row in Trash still exists, so its ledger keeps it'],
  ['services/google/raise.ts', 'SELECT id, r2_key FROM data_room_files WHERE id = ?', 'reached only after copyFile kept a copy in Trash'],
  ['services/google/raise.ts', 'UPDATE data_room_files SET name = ?', 'reached only after copyFile kept a copy in Trash'],
  ['services/google/raise.ts', 'INSERT INTO data_room_files', 'a write of a new file'],
  ['services/google/raise.ts', 'SELECT f.id, f.r2_key FROM data_room_files f JOIN connector_fed_items', 'From Google’s own Delete of a copy'],
  ['services/google/raise.ts', 'DELETE FROM data_room_files', 'From Google’s own Delete of a copy'],
  ['services/mercury/raiseFeeds.ts', 'data_room_files', 'the Mercury ledger and its writes; a row in Trash still exists'],
  ['services/raiseEvidenceSources.ts', 'data_room_files', 'founder-side candidates; the investor read re-checks each file (fileAdmits, filtered)'],
  ['services/raiseWriters.ts', 'UPDATE data_room_files SET checklist_item', 'a record action; records/owned.ts refuses a file in Trash first'],
  ['services/roomLibrary.ts', "const row = await env.DB.prepare('SELECT id FROM data_room_files WHERE id = ? AND project_id = ?')", 'D6869: whether a removed reference\'s activity row can still name the file; a row in Trash still exists'],
  ['services/storageUsage.ts', 'data_room_files', 'a file in Trash still holds its bytes until it is purged, so it counts to storage'],
];

test('every SQL statement on data_room_files in the Worker leaves Trash out, or says why not', () => {
  // Mutation checked: removing the liveFiles clause from research.ts's diligence read → it is named here.
  const root = 'cloudflare-worker/src';
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; });
  const offenders: string[] = [];
  const used = new Set<number>();
  for (const file of walk(root)) {
    if (file.endsWith('dataRoomTrash.ts')) continue;
    const rel = file.slice(root.length + 1);
    const lines = read(file).split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('data_room_files')) return;
      const t = line.trim();
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
      if (!['FROM data_room_files', 'JOIN data_room_files', 'UPDATE data_room_files', 'INTO data_room_files'].some((k) => line.includes(k))) return;
      const near = lines.slice(Math.max(0, i - 3), i + 5).join('\n');
      if (near.includes('liveFiles(') || near.includes('removed_at') || near.includes('${live}')) return;
      const at = UNFILTERED.findIndex(([f, piece]) => f === rel && line.includes(piece));
      if (at >= 0) { used.add(at); return; }
      offenders.push(`${rel}:${i + 1}: ${t.slice(0, 120)}`);
    });
  }
  assert.deepEqual(offenders, [], 'a read of data_room_files that shows a file in Trash');
  const stale = UNFILTERED.filter((_, i) => !used.has(i)).map(([f, piece]) => `${f}: ${piece}`);
  assert.deepEqual(stale, [], 'an allowance that no longer matches any line');
});
