/**
 * The investor's room and document reads, keyed by the grant they hold, and
 * the list's "open to you" count — run against real SQLite.
 *
 * The data room's tables and `pairwise_ndas` are cut from
 * `sql/schema_baseline.sql` rather than retyped, so a query naming a column
 * production does not have fails here too. `users` and `projects` are the
 * narrow shapes `requireAuth` and the reads need; `users` is at D1's column
 * cap and standing all of it up proves nothing about these routes.
 *
 * Every assertion is about what comes back and what is written, not about the
 * text of a query: a gate that stops holding fails because the wrong rows or
 * the wrong names appear.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

import research from '../src/routes/research.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATION_221 = readdirSync(resolve(ROOT, 'cloudflare-worker/sql/migrations')).find((f) => f.startsWith('221_')) as string;
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = 1;
const SIGNED = 2;     // holds a grant on the room and a live NDA with FOUNDER
const UNSIGNED = 3;   // holds a grant on the room, no NDA
const STRANGER = 4;   // an investor with no grant on the room at all

const OPEN_NAME = 'Pitch deck.pdf';
const NDA_NAME = 'Series B term sheet.pdf';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT UNIQUE NOT NULL, name TEXT, founder_id INTEGER);
  `);
  for (const t of ['data_room_grants', 'data_room_files', 'data_room_folders', 'data_room_access_log', 'pairwise_ndas']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  // The drafts table as migration 221 declares it, cut from the file itself.
  const m221 = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations', MIGRATION_221), 'utf8');
  const start = m221.indexOf('CREATE TABLE IF NOT EXISTS research_zone_drafts');
  assert.ok(start >= 0, 'migration 221 no longer declares research_zone_drafts');
  db.exec(stripForeignKeys(m221.slice(start, m221.indexOf(');', start) + 2)));
  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?,?,?,?,?)');
  u.run(FOUNDER, 'founder', 100, 'Fran', 'fran@example.com');
  u.run(SIGNED, 'investor', null, 'Sig', 'sig@example.com');
  u.run(UNSIGNED, 'investor', null, 'Una', 'una@example.com');
  u.run(STRANGER, 'investor', null, 'Stan', 'stan@example.com');

  const p = db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?,?,?,?)');
  p.run(7, 'p-room', 'Roomco', 100);
  p.run(8, 'p-other', 'Elsewhere', 100);

  const g = db.prepare(
    `INSERT INTO data_room_grants (uid, project_id, investor_user_id, granted_by_user_id, status, expires_at)
     VALUES (?,?,?,?,?,?)`,
  );
  g.run('g-signed', 7, SIGNED, FOUNDER, 'active', null);
  g.run('g-unsigned', 7, UNSIGNED, FOUNDER, 'active', null);
  g.run('g-revoked', 8, SIGNED, FOUNDER, 'revoked', null);
  g.run('g-expired', 8, UNSIGNED, FOUNDER, 'active', '2020-01-01T00:00:00.000Z');

  db.prepare(`INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (?, ?, 'active')`)
    .run(FOUNDER, SIGNED);

  const f = db.prepare(
    `INSERT INTO data_room_files (id, uid, project_id, name, r2_key, content_type, size_bytes, visibility)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  f.run(31, 'f-open', 7, OPEN_NAME, 'k/open', 'application/pdf', 2048, 'open');
  f.run(32, 'f-nda', 7, NDA_NAME, 'k/nda', 'application/pdf', 4096, 'nda');
  f.run(33, 'f-elsewhere', 8, 'Elsewhere plan.pdf', 'k/else', 'application/pdf', 10, 'open');
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function get(db: any, userId: number, path: string): Promise<{ status: number; body: any; raw: string }> {
  const res = await research.fetch(
    new Request(`http://x${path}`, { headers: { Authorization: `Bearer ${await token(userId, 'investor')}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any,
  );
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null, raw };
}

const logRows = (db: any) => db.prepare('SELECT project_id, user_id, action, file_id FROM data_room_access_log ORDER BY id').all()
  .map((r: any) => ({ ...r }));
const logDownload = (db: any, userId: number, fileId: number, at: string) =>
  db.prepare(`INSERT INTO data_room_access_log (project_id, file_id, user_id, action, created_at) VALUES (7, ?, ?, 'download', ?)`)
    .run(fileId, userId, at);

test('the list counts an NDA file as open to an investor who has signed, and withheld from one who has not', async () => {
  const db = freshDb();
  const signed = (await get(db, SIGNED, '/diligence')).body.items.find((r: any) => r.grant_uid === 'g-signed');
  assert.equal(signed.file_total, 2);
  assert.equal(signed.file_open, 2, 'a signed investor was told a file is behind the NDA they signed');
  assert.equal(signed.withheld_behind_nda, 0);
  assert.equal(signed.nda_signed, true);

  const unsigned = (await get(db, UNSIGNED, '/diligence')).body.items.find((r: any) => r.grant_uid === 'g-unsigned');
  assert.equal(unsigned.file_open, 1);
  assert.equal(unsigned.withheld_behind_nda, 1);
  assert.equal(unsigned.nda_signed, false);
});

test('an NDA that has lapsed stops opening the count', async () => {
  const db = freshDb();
  db.exec(`UPDATE pairwise_ndas SET valid_until = '2020-01-01T00:00:00.000Z'`);
  const row = (await get(db, SIGNED, '/diligence')).body.items.find((r: any) => r.grant_uid === 'g-signed');
  assert.equal(row.file_open, 1);
  assert.equal(row.withheld_behind_nda, 1);
});

test('the room lists what the caller may open, counts the rest, and never names it', async () => {
  const db = freshDb();
  const r = await get(db, UNSIGNED, '/diligence/g-unsigned');
  assert.equal(r.status, 200);
  assert.equal(r.body.project.name, 'Roomco');
  assert.deepEqual(r.body.files.map((f: any) => f.name), [OPEN_NAME]);
  assert.equal(r.body.file_open, 1);
  assert.equal(r.body.file_total, 2);
  assert.equal(r.body.withheld_behind_nda, 1);
  assert.ok(!r.raw.includes(NDA_NAME), 'a file behind an unsigned NDA was named in the room');
  assert.ok(!r.raw.includes('f-nda'), 'a file behind an unsigned NDA leaked its uid');
  assert.ok(!r.raw.includes('Elsewhere plan'), 'a file from another project appeared in this room');

  const s = await get(db, SIGNED, '/diligence/g-signed');
  assert.deepEqual(s.body.files.map((f: any) => f.name).sort(), [NDA_NAME, OPEN_NAME].sort());
  assert.equal(s.body.withheld_behind_nda, 0);
});

test('a grant the caller does not hold answers exactly like one that does not exist', async () => {
  const db = freshDb();
  const missing = await get(db, STRANGER, '/diligence/g-nothing');
  const theirs = await get(db, STRANGER, '/diligence/g-signed');
  assert.equal(missing.status, 404);
  assert.equal(theirs.status, 404);
  assert.deepEqual(theirs.body, missing.body, 'someone else’s grant was distinguishable from a missing one');
  assert.equal(theirs.body.error, 'room_not_found');
  assert.ok(!theirs.raw.includes('Roomco'));
  // Nor is the door opened by holding a DIFFERENT live grant on the same room.
  assert.equal((await get(db, UNSIGNED, '/diligence/g-signed')).status, 404);
  assert.equal(logRows(db).length, 0, 'a refused read was logged as opening the room');
});

test('a revoked or expired grant no longer opens the room or its documents', async () => {
  const db = freshDb();
  assert.equal((await get(db, SIGNED, '/diligence/g-revoked')).status, 404);
  assert.equal((await get(db, UNSIGNED, '/diligence/g-expired')).status, 404);
  assert.equal((await get(db, SIGNED, '/diligence/g-revoked/files/f-elsewhere')).status, 404);
  assert.equal((await get(db, UNSIGNED, '/diligence/g-expired/files/f-elsewhere')).status, 404);
});

test('opening the room is logged as open_room for the caller, and "last opened" is the visit before', async () => {
  const db = freshDb();
  const first = await get(db, UNSIGNED, '/diligence/g-unsigned');
  assert.equal(first.body.last_opened_at, null, 'a first visit claimed an earlier one');
  assert.deepEqual(logRows(db), [{ project_id: 7, user_id: UNSIGNED, action: 'open_room', file_id: null }]);
  const second = await get(db, UNSIGNED, '/diligence/g-unsigned');
  assert.ok(second.body.last_opened_at, 'the earlier visit was not reported');
  assert.equal(logRows(db).length, 2);
});

test('activity is the caller’s own, and a download under a lapsed NDA keeps its line but loses its name', async () => {
  const db = freshDb();
  logDownload(db, SIGNED, 32, '2026-09-01T10:00:00.000Z');
  logDownload(db, SIGNED, 31, '2026-09-02T10:00:00.000Z');
  logDownload(db, UNSIGNED, 31, '2026-09-03T10:00:00.000Z');

  const live = await get(db, SIGNED, '/diligence/g-signed');
  const names = live.body.activity.map((a: any) => a.file_name);
  assert.deepEqual(names, [OPEN_NAME, NDA_NAME]);
  assert.ok(live.body.activity.every((a: any) => a.created_at !== '2026-09-03T10:00:00.000Z'),
    'another investor’s download appeared in this investor’s activity');
  assert.equal(live.body.files.find((f: any) => f.uid === 'f-open').last_downloaded_at, '2026-09-02T10:00:00.000Z');

  db.exec(`UPDATE pairwise_ndas SET status = 'expired'`);
  const lapsed = await get(db, SIGNED, '/diligence/g-signed');
  assert.ok(!lapsed.raw.includes(NDA_NAME), 'the log re-served a name the gate now withholds');
  const row = lapsed.body.activity.find((a: any) => a.created_at === '2026-09-01T10:00:00.000Z');
  assert.equal(row.action, 'download');
  assert.equal(row.file_name, null);
  assert.equal(row.file_withheld, true);
});

test('a document behind an unsigned NDA returns the room and nothing about the file', async () => {
  const db = freshDb();
  const r = await get(db, UNSIGNED, '/diligence/g-unsigned/files/f-nda');
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'nda_required');
  assert.equal(r.body.room.grant_uid, 'g-unsigned');
  assert.ok(!r.raw.includes(NDA_NAME), 'the gated file was named');
  assert.ok(!r.raw.includes('4096'), 'the gated file’s size travelled');
  assert.ok(!r.raw.includes('application/pdf'), 'the gated file’s type travelled');
  assert.equal(r.body.file, undefined);
});

test('a document the caller may open carries its facts and only their own download history', async () => {
  const db = freshDb();
  logDownload(db, SIGNED, 32, '2026-09-01T10:00:00.000Z');
  logDownload(db, UNSIGNED, 32, '2026-09-04T10:00:00.000Z');
  const r = await get(db, SIGNED, '/diligence/g-signed/files/f-nda');
  assert.equal(r.status, 200);
  assert.equal(r.body.file.name, NDA_NAME);
  assert.equal(r.body.file.size_bytes, 4096);
  assert.equal(r.body.file.content_type, 'application/pdf');
  assert.equal(r.body.room.project_uid, 'p-room', 'the page cannot reach the download route without the project uid');
  assert.deepEqual(r.body.downloads, ['2026-09-01T10:00:00.000Z']);
  assert.equal(r.body.last_downloaded_at, '2026-09-01T10:00:00.000Z');
  assert.equal(logRows(db).length, 2, 'reading one document wrote to the access log');
});

test('a real file uid from another room is not in this one', async () => {
  const db = freshDb();
  const r = await get(db, SIGNED, '/diligence/g-signed/files/f-elsewhere');
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'file_not_found');
  assert.ok(!r.raw.includes('Elsewhere plan'));
  assert.equal((await get(db, STRANGER, '/diligence/g-signed/files/f-open')).status, 404);
});

/**
 * POST /drafts for the room memo, with the model stubbed so the test can read
 * exactly what it would have been sent. `prompt` is null when the model was
 * never reached, which is the only outcome a refusal may have.
 */
async function draftRoom(db: any, userId: number, scopeKey: string): Promise<{ status: number; body: any; prompt: string | null }> {
  let prompt: string | null = null;
  const AI = {
    run: async (_model: string, payload: any) => {
      const messages = payload?.messages || [];
      prompt = String(messages[messages.length - 1]?.content ?? '');
      return { response: 'a drafted memo' };
    },
  };
  const res = await research.fetch(
    new Request('http://x/drafts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await token(userId, 'investor')}`, 'content-type': 'application/json' },
      body: JSON.stringify({ surface: 'research/diligence', scope_key: scopeKey }),
    }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), AI } as any,
  );
  return { status: res.status, body: await res.json().catch(() => null), prompt };
}

test('the room memo is drafted only over a room the caller holds', async () => {
  const db = freshDb();
  for (const [who, uid] of [[STRANGER, 'g-signed'], [UNSIGNED, 'g-signed'], [SIGNED, 'g-revoked'], [SIGNED, '']] as const) {
    const r = await draftRoom(db, who, uid);
    assert.equal(r.status, 409, `a memo was drafted over ${uid || 'no grant'} for user ${who}`);
    assert.equal(r.prompt, null, 'the model was reached over a room the caller does not hold');
  }
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM research_zone_drafts').get() as any).n, 0);
});

test('the room memo is told the NDA count and never the NDA names', async () => {
  const db = freshDb();
  const r = await draftRoom(db, UNSIGNED, 'g-unsigned');
  assert.equal(r.status, 201);
  assert.ok(r.prompt!.includes(OPEN_NAME), 'the open document is not in the material');
  assert.ok(!r.prompt!.includes(NDA_NAME), 'a name behind an unsigned NDA was sent to the model');
  assert.match(r.prompt!, /Behind an NDA, not named: 1\./);
  assert.ok(!r.prompt!.includes('Elsewhere plan'), 'another room’s document was sent to the model');
  const row = db.prepare('SELECT owner_user_id, surface, scope_key FROM research_zone_drafts').get() as any;
  assert.deepEqual({ ...row }, { owner_user_id: UNSIGNED, surface: 'research/diligence', scope_key: 'g-unsigned' });
});

test('a room page reads only its own room’s memo', async () => {
  const db = freshDb();
  const ins = db.prepare(
    `INSERT INTO research_zone_drafts (uid, owner_user_id, surface, scope_key, body) VALUES (?, ?, 'research/diligence', ?, ?)`,
  );
  ins.run('d-a', SIGNED, 'g-signed', 'memo on this room');
  ins.run('d-b', SIGNED, 'g-other-room', 'memo on another room');
  const scoped = await get(db, SIGNED, '/drafts?surface=research%2Fdiligence&scope_key=g-signed');
  assert.deepEqual(scoped.body.items.map((d: any) => d.body), ['memo on this room']);
  // Unscoped reads keep their old meaning: the surface's newest, whatever the record.
  const all = await get(db, SIGNED, '/drafts?surface=research%2Fdiligence');
  assert.equal(all.body.items.length, 2);
});
