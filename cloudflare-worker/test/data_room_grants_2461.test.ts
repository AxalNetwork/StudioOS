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
import { tableFromBaseline, stripForeignKeys, addColumnsFrom } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

import dataRoom from '../src/routes/data_room.ts';
import { withGrantFolders } from './_data_room_scope.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIG463 = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/463_raise_record_stores.sql'), 'utf8');
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
  // D691 (#1700) — migration 463's file access columns, which every room read now filters on.
  addColumnsFrom(db, stripForeignKeys(MIG463), 'data_room_files');
  // D1103 (#2983) — migration 594: a grant's folder scope, which every investor read passes.
  withGrantFolders(db);
  // The pipeline a committed-only file is opened by.
  db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'raise_prospects')));
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
  for (const [id, role] of [[5,'admin'],[6,'partner'],[7,'advisor'],[8,'explorer']] as const) {
    u.run(id,role,null,`Synthetic ${role}`,`synthetic-${role}@example.invalid`);
  }
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

const ROLE: Record<number, string> = { 5:'admin', 6:'partner', 7:'advisor', 8:'explorer', [FOUNDER]: 'founder', [SIGNED]: 'investor', [UNSIGNED]: 'investor', [RIVAL]: 'founder' };

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


test('2461: admin re-grant keeps the founder NDA valid for listing and download', async () => {
 const db = freshDb();
 const grant = await call(db,5,'POST','/p-room/grants',{email:'sig@example.com'});
 assert.equal(grant.status,201);
 assert.equal((await call(db,SIGNED,'POST','/shared/p-room/files/f-nda/download')).status,200);
 const shared = await call(db,SIGNED,'GET','/shared/p-room');
 assert.equal(shared.status,200);
 assert.ok(shared.body.files.some((f:any)=>f.uid==='f-nda'));
 const room = await call(db,FOUNDER,'GET','/p-room');
 const row = room.body.grants.find((g:any)=>g.investor_email==='sig@example.com');
 assert.equal(row.nda_signed,true); assert.equal(row.granted_by_name,'Synthetic admin'); assert.equal(row.granted_by_role,'admin');
});
test('2461: admin NDA cannot substitute for founder NDA; expiry remains enforced', async () => {
 const db = freshDb();
 await call(db,5,'POST','/p-room/grants',{email:'una@example.com'});
 db.prepare("INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status) VALUES(5,3,'active')").run();
 assert.equal((await call(db,UNSIGNED,'POST','/shared/p-room/files/f-nda/download')).status,403);
 assert.equal((await call(db,UNSIGNED,'GET','/shared/p-room')).body.files.some((f:any)=>f.uid==='f-nda'),false);
 db.prepare("UPDATE pairwise_ndas SET valid_until='2000-01-01' WHERE party_a_user_id=1").run();
 assert.equal((await call(db,SIGNED,'POST','/shared/p-room/files/f-nda/download')).status,403);
});
test('2461: sharing responds identically for known, unknown and own addresses', async () => {
 const db = freshDb();
 const known = await call(db,FOUNDER,'POST','/p-room/grants',{email:'sig@example.com'});
 const unknown = await call(db,FOUNDER,'POST','/p-room/grants',{email:'absent@example.invalid'});
 const own = await call(db,FOUNDER,'POST','/p-room/grants',{email:'fran@example.com'});
 assert.deepEqual(unknown,known); assert.deepEqual(own,known);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM data_room_grants').get().n,2);
});
test('2461: nonowners cannot grant or read founder grant attribution', async () => {
 const db = freshDb();
 for (const id of [SIGNED,UNSIGNED,RIVAL,6,7,8]) {
  assert.equal((await call(db,id,'POST','/p-room/grants',{email:'sig@example.com'})).status,404,String(id));
  assert.equal((await call(db,id,'GET','/p-room')).status,404,String(id));
 }
});
