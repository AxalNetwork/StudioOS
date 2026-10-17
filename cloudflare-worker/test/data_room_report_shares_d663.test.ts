/**
 * #1524 item 2 (D663 follow-up) — a scoring report shared through
 * `lab_report_shares` (D588) shows in the data room's access, read beside the
 * room's grants, on real SQLite. One store each: nothing is copied.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/data_room_report_shares_d663.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { tableFromBaseline, stripForeignKeys, addColumnsFrom } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

import dataRoom, { reportShareStatus } from '../src/routes/data_room.ts';

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIG463 = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/463_raise_record_stores.sql'), 'utf8');
const MIG401 = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/401_lab_report_shares.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 1, INVESTOR = 2, OTHER_INV = 3, RIVAL = 4;
const future = '2999-01-01 00:00:00', past = '2000-01-01 00:00:00';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT UNIQUE NOT NULL, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
  `);
  for (const t of ['data_room_grants', 'data_room_files', 'data_room_folders', 'data_room_access_log', 'pairwise_ndas']) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  db.exec(MIG401);
  // D691 (#1700) — migration 463's file access columns, which every room read now filters on.
  addColumnsFrom(db, stripForeignKeys(MIG463), 'data_room_files');
  // The pipeline a committed-only file is opened by.
  db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'raise_prospects')));
  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?,?,?,?,?)');
  u.run(FOUNDER, 'founder', 100, 'Fran', 'fran@example.com');
  u.run(INVESTOR, 'investor', null, 'Ivy', 'ivy@example.com');
  u.run(OTHER_INV, 'investor', null, null, 'oz@example.com');
  u.run(RIVAL, 'founder', 200, 'Rae', 'rae@example.com');
  const p = db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?,?,?,?)');
  p.run(7, 'p-room', 'Roomco', 100);
  p.run(9, 'p-rival', 'Rivalco', 200);
  db.prepare("INSERT INTO data_room_grants (uid, project_id, investor_user_id, granted_by_user_id, status) VALUES ('g1', 7, ?, ?, 'active')").run(OTHER_INV, FOUNDER);
  const s = db.prepare(
    `INSERT INTO lab_report_shares (id, owner_user_id, report_kind, project_id, audience, grantee_user_id, token_hash, expires_at, open_limit, opens, revoked_at, consented_at, snapshot_json)
     VALUES (?, ?, 'scoring', ?, 'investor', ?, ?, ?, ?, ?, ?, '2026-10-01', '{}')`,
  );
  s.run(11, FOUNDER, 7, INVESTOR, 'h11', future, 5, 1, null);      // active
  s.run(12, FOUNDER, 7, OTHER_INV, 'h12', past, 5, 0, null);       // expired
  s.run(13, FOUNDER, 7, INVESTOR, 'h13', future, 2, 2, null);      // every open used
  s.run(14, FOUNDER, 7, INVESTOR, 'h14', future, 5, 0, '2026-10-02'); // revoked
  s.run(15, RIVAL, 9, INVESTOR, 'h15', future, 5, 0, null);         // another venture's report
  return db;
}

async function call(db: any, userId: number, role: string, path: string) {
  const jwt = await new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await dataRoom.fetch(new Request(`http://x${path}`, { headers: { Authorization: `Bearer ${jwt}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES: { put: async () => {}, delete: async () => {} } } as any);
  return { status: res.status, body: await res.json() as any };
}

test('a report shared through lab_report_shares shows in the data room\'s access, beside the grants', async () => {
  const db = freshDb();
  const r = await call(db, FOUNDER, 'founder', '/p-room');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.grants.map((g: any) => g.investor_email), ['oz@example.com'], 'the room\'s grants are unchanged');
  assert.deepEqual(r.body.report_shares.map((s: any) => [s.id, s.grantee_email, s.grantee_name, s.status, s.opens, s.open_limit]), [
    [14, 'ivy@example.com', 'Ivy', 'revoked', 0, 5],
    [13, 'ivy@example.com', 'Ivy', 'used_up', 2, 2],
    [12, 'oz@example.com', null, 'expired', 0, 5],
    [11, 'ivy@example.com', 'Ivy', 'active', 1, 5],
  ]);
  assert.ok(r.body.report_shares.every((s: any) => s.report_kind === 'scoring'));
  assert.ok(!JSON.stringify(r.body.report_shares).includes('h1'), 'no token hash leaves the read');
  assert.ok(!('snapshot_json' in r.body.report_shares[0]), 'the frozen report itself is not in the room read');
});

test('another venture\'s report shares never reach this room, and the rival sees only their own', async () => {
  const db = freshDb();
  assert.ok(!(await call(db, FOUNDER, 'founder', '/p-room')).body.report_shares.some((s: any) => s.id === 15));
  const rival = await call(db, RIVAL, 'founder', '/p-rival');
  assert.deepEqual(rival.body.report_shares.map((s: any) => s.id), [15]);
  assert.equal((await call(db, RIVAL, 'founder', '/p-room')).status, 404, 'not the rival\'s room');
});

test('unreadable report shares are null, never an empty list; the room still reads', async () => {
  const db = freshDb();
  db.exec('DROP TABLE lab_report_shares');
  const r = await call(db, FOUNDER, 'founder', '/p-room');
  assert.equal(r.status, 200);
  assert.equal(r.body.report_shares, null);
  assert.equal(r.body.grants.length, 1);
});

test('reportShareStatus: revoked, then used up, then expired, then active', () => {
  const now = '2026-10-10 12:00:00';
  assert.equal(reportShareStatus({ revoked_at: 'x', opens: 9, open_limit: 1, expires_at: past }, now), 'revoked');
  assert.equal(reportShareStatus({ revoked_at: null, opens: 1, open_limit: 1, expires_at: past }, now), 'used_up');
  assert.equal(reportShareStatus({ revoked_at: null, opens: 0, open_limit: 1, expires_at: now }, now), 'expired', 'an expiry at this very second is expired');
  assert.equal(reportShareStatus({ revoked_at: null, opens: 0, open_limit: 1, expires_at: future }, now), 'active');
});
