/**
 * D1105 (#2985, part 4 of #2456) — the data room's activity over a period
 * (daily figures against the period before, per investor, the log), its CSV,
 * the checklist read, and migration 596 (each file's source), on real SQLite.
 *
 * The data-room tables are cut from `sql/schema_baseline.sql` and the
 * migrations that changed them (442, 463, 594, 596), as D1103's test cuts them,
 * so a query naming a column production does not have fails here too. Every
 * venture, person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/data_room_activity_d1105.test.ts
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
import { CSV_HEADER, CSV_MAX_ROWS, NO_ONE_REASONS, parseActivityQuery } from '../src/services/dataRoomActivity.ts';
import { DILIGENCE_CHECKLIST } from '../src/services/raiseCycle.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sqlOf = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const BASELINE = sqlOf('cloudflare-worker/sql/schema_baseline.sql');
const MIG = (n: string) => sqlOf(`cloudflare-worker/sql/migrations/${n}`);
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture

const FOUNDER = 1;   // owns p-room (founders row 100)
const SIGNED = 2;    // grant g-signed on p-room, NDA signed
const SCOPED = 3;    // grant g-scoped on p-room, Financials only, NDA signed
const RIVAL = 4;     // owns p-rival
const COFOUNDER = 5; // accepted co-founder of p-room
const STRANGER = 6;  // logged on p-room with no grant there (a grant since deleted)
const ADMIN = 7;
const ROLE: Record<number, string> = {
  [FOUNDER]: 'founder', [SIGNED]: 'investor', [SCOPED]: 'investor', [RIVAL]: 'founder', [COFOUNDER]: 'founder', [STRANGER]: 'investor', [ADMIN]: 'admin',
};

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT UNIQUE NOT NULL, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
  `);
  for (const t of ['data_room_grants', 'data_room_files', 'data_room_folders', 'data_room_access_log', 'pairwise_ndas', 'raise_prospects', 'project_members']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  addColumnsFrom(db, stripForeignKeys(MIG('463_raise_record_stores.sql')), 'data_room_files');
  addColumnsFrom(db, stripForeignKeys(MIG('442_raise_cycle_stores.sql')), 'data_room_files');
  addColumnsFrom(db, MIG('596_data_room_file_source.sql'), 'data_room_files');
  withGrantFolders(db);

  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?,?,?,?,?)');
  u.run(FOUNDER, 'founder', 100, 'Fran', 'fran@example.com');
  u.run(SIGNED, 'investor', null, '=Sig Cell', 'sig@example.com');
  u.run(SCOPED, 'investor', null, 'Sco', 'sco@example.com');
  u.run(RIVAL, 'founder', 200, 'Rae', 'rae@example.com');
  u.run(COFOUNDER, 'founder', 300, 'Cora', 'cora@example.com');
  u.run(STRANGER, 'investor', null, 'Stan Stranger', 'stan@example.com');
  u.run(ADMIN, 'admin', null, 'Ada', 'ada@example.com');
  const p = db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?,?,?,?)');
  p.run(7, 'p-room', 'Roomco', 100);
  p.run(9, 'p-rival', 'Rivalco', 200);
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (7, ?, 'cofounder', 'accepted')`).run(COFOUNDER);
  const g = db.prepare(`INSERT INTO data_room_grants (id, uid, project_id, investor_user_id, granted_by_user_id, status, folders_scoped, expires_at)
    VALUES (?,?,?,?,?,?,?,?)`);
  g.run(1, 'g-signed', 7, SIGNED, FOUNDER, 'active', 0, null);
  g.run(2, 'g-scoped', 7, SCOPED, FOUNDER, 'active', 1, null);
  g.run(3, 'g-rival', 9, STRANGER, RIVAL, 'active', 0, null);
  const n = db.prepare(`INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (?, ?, 'active')`);
  n.run(FOUNDER, SIGNED); n.run(FOUNDER, SCOPED);
  db.prepare(`INSERT INTO data_room_folders (id, uid, project_id, parent_id, name, visibility) VALUES (51, 'd-fin', 7, NULL, 'Financials', 'open')`).run();
  db.prepare('INSERT INTO data_room_grant_folders (grant_id, folder_id) VALUES (2, 51)').run();
  return db;
}

function file(db: DatabaseSync, id: number, o: { project?: number; folder?: number | null; name: string; visibility?: string; tier?: string; item?: string | null; kind?: string; ref?: string | null }) {
  db.prepare(`INSERT INTO data_room_files (id, uid, project_id, folder_id, name, r2_key, content_type, size_bytes, visibility, uploaded_by_user_id,
      access_tier, checklist_item, source_kind, source_ref) VALUES (?,?,?,?,?,?,'application/pdf',10,?,?,?,?,?,?)`)
    .run(id, `f-${id}`, o.project ?? 7, o.folder ?? null, o.name, `data-room/p-room/${id}`, o.visibility ?? 'open', FOUNDER,
      o.tier ?? 'invited', o.item ?? null, o.kind ?? 'document', o.ref ?? null);
}
function logged(db: DatabaseSync, project: number, user: number, action: string, at: string, fileId: number | null = null) {
  db.prepare('INSERT INTO data_room_access_log (project_id, file_id, user_id, action, created_at) VALUES (?,?,?,?,?)').run(project, fileId, user, action, at);
}

async function call(db: DatabaseSync, userId: number, path: string) {
  const token = await new SignJWT({ user_id: userId, role: ROLE[userId] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await dataRoom.fetch(new Request(`http://x${path}`, { headers: { Authorization: `Bearer ${token}` } }),
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { status: res.status, body, text, type: res.headers.get('content-type'), disposition: res.headers.get('content-disposition') };
  } finally { [console.warn, console.error] = saved; }
}

/** A room with a week of activity, a refusal among it, and the period before. */
function busyRoom() {
  const db = freshDb();
  file(db, 31, { name: 'Term sheet.pdf', visibility: 'nda' });
  file(db, 41, { project: 9, name: 'Rival.pdf' });
  logged(db, 7, SIGNED, 'open_room', '2026-10-20T09:00:00.000Z');
  logged(db, 7, SIGNED, 'download', '2026-10-20T09:05:00.000Z', 31);
  logged(db, 7, SCOPED, 'open_room', '2026-10-21T10:00:00.000Z');
  logged(db, 7, SCOPED, 'blocked', '2026-10-21T10:01:00.000Z', 31);
  logged(db, 7, SCOPED, 'blocked', '2026-10-22T23:59:59.000Z', 31);
  logged(db, 7, STRANGER, 'open_room', '2026-10-22T08:00:00.000Z');
  // The period before (14–19 Oct, for a 20–25 Oct period).
  logged(db, 7, SIGNED, 'open_room', '2026-10-15T09:00:00.000Z');
  logged(db, 7, SCOPED, 'blocked', '2026-10-19T09:00:00.000Z', 31);
  // Outside both, and another venture's.
  logged(db, 7, SIGNED, 'open_room', '2026-10-26T00:00:00.000Z');
  logged(db, 9, STRANGER, 'download', '2026-10-21T09:00:00.000Z', 41);
  return db;
}
const PERIOD = 'from=2026-10-20&to=2026-10-25';

// ─────────────────────────────────────────────── migration 596

test('596: every file has a source, a document by default; a Mercury-landed file is backfilled connector; any other word is refused', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'data_room_files')));
  addColumnsFrom(db, stripForeignKeys(MIG('463_raise_record_stores.sql')), 'data_room_files');
  db.exec('CREATE TABLE mercury_raise_proposals (id INTEGER PRIMARY KEY, local_table TEXT, local_id INTEGER)');
  const f = db.prepare(`INSERT INTO data_room_files (id, uid, project_id, name, r2_key, visibility) VALUES (?, ?, 7, ?, 'k', 'open')`);
  f.run(1, 'f-1', 'Upload.pdf'); f.run(2, 'f-2', 'Mercury statement 2026-09.pdf'); f.run(3, 'f-3', 'Other.pdf');
  db.exec(`INSERT INTO mercury_raise_proposals (id, local_table, local_id) VALUES (1, 'data_room_files', 2), (2, 'revenue_entries', 3), (3, 'data_room_files', NULL)`);
  db.exec(MIG('596_data_room_file_source.sql'));
  const rows = (db.prepare('SELECT id, source_kind, source_ref FROM data_room_files ORDER BY id').all() as any[]).map((r) => [r.id, r.source_kind, r.source_ref]);
  assert.deepEqual(rows, [[1, 'document', null], [2, 'connector', 'mercury'], [3, 'document', null]]);
  assert.throws(() => db.exec(`INSERT INTO data_room_files (uid, project_id, name, r2_key, source_kind) VALUES ('x', 7, 'x', 'k', 'upload')`), /CHECK/);
  db.exec(`INSERT INTO data_room_files (uid, project_id, name, r2_key, source_kind) VALUES ('y', 7, 'y', 'k', 'signed')`);
});

test('the founder’s room read says where each file came from', async () => {
  const db = freshDb();
  file(db, 31, { name: 'Upload.pdf' });
  file(db, 32, { name: 'Mercury statement 2026-09.pdf', kind: 'connector', ref: 'mercury', tier: 'nobody', visibility: 'nda' });
  const files = (await call(db, FOUNDER, '/p-room')).body.files;
  assert.deepEqual(files.map((f: any) => [f.name, f.source_kind, f.source_ref]), [
    ['Mercury statement 2026-09.pdf', 'connector', 'mercury'], ['Upload.pdf', 'document', null],
  ]);
});

// ─────────────────────────────────────────────── the activity read

test('activity: the period’s days against the period before, and a refusal is never counted as an open', async () => {
  const r = await call(busyRoom(), FOUNDER, `/p-room/activity?${PERIOD}`);
  assert.equal(r.status, 200, r.text);
  const b = r.body;
  assert.deepEqual([b.period, b.previous_period], [{ from: '2026-10-20', to: '2026-10-25', days: 6 }, { from: '2026-10-14', to: '2026-10-19' }]);
  assert.deepEqual(b.daily.map((d: any) => [d.day, d.opened, d.downloaded, d.blocked]), [
    ['2026-10-20', 1, 1, 0], ['2026-10-21', 1, 0, 1], ['2026-10-22', 1, 0, 1],
    ['2026-10-23', 0, 0, 0], ['2026-10-24', 0, 0, 0], ['2026-10-25', 0, 0, 0],
  ], 'every day of the period, a 23:59:59 refusal on its own day, the 26th left out');
  assert.deepEqual(b.totals, { opened: 3, downloaded: 1, blocked: 2 });
  assert.deepEqual(b.previous, { opened: 1, downloaded: 0, blocked: 1 });
  // Another venture's rows never reach this room.
  assert.ok(!b.log.rows.some((x: any) => x.file?.name === 'Rival.pdf'));
});

test('activity: per investor, named only through this venture’s own grants', async () => {
  const b = (await call(busyRoom(), FOUNDER, `/p-room/activity?${PERIOD}`)).body;
  const by = Object.fromEntries(b.investors.map((i: any) => [i.grant_uid ?? 'none', i]));
  assert.deepEqual([by['g-scoped'].name, by['g-scoped'].opened, by['g-scoped'].downloaded, by['g-scoped'].blocked], ['Sco', 1, 0, 2]);
  assert.deepEqual([by['g-signed'].email, by['g-signed'].opened, by['g-signed'].downloaded], ['sig@example.com', 1, 1]);
  assert.deepEqual([by.none.name, by.none.email, by.none.opened], [null, null, 1], 'a reader with no grant here keeps their row and loses their name');
  assert.equal(b.investors[0].grant_uid, 'g-scoped', 'the busiest first');
  const stranger = b.log.rows.find((x: any) => x.investor.grant_uid === null);
  assert.deepEqual(stranger.investor, { grant_uid: null, name: null, email: null });
});

test('activity: the log is paged newest first; investor narrows everything, action narrows the log only', async () => {
  const db = busyRoom();
  const b = (await call(db, FOUNDER, `/p-room/activity?${PERIOD}`)).body;
  assert.deepEqual([b.log.total, b.log.page, b.log.pages, b.log.rows.length], [6, 1, 1, 6]);
  assert.deepEqual(b.log.rows.map((x: any) => x.action), ['blocked', 'open_room', 'blocked', 'open_room', 'download', 'open_room']);
  assert.deepEqual(b.log.rows[0].file, { uid: 'f-31', name: 'Term sheet.pdf' });
  const one = (await call(db, FOUNDER, `/p-room/activity?${PERIOD}&investor=g-scoped`)).body;
  assert.deepEqual([one.totals, one.previous, one.investors.length, one.log.total], [{ opened: 1, downloaded: 0, blocked: 2 }, { opened: 0, downloaded: 0, blocked: 1 }, 1, 3]);
  const blocked = (await call(db, FOUNDER, `/p-room/activity?${PERIOD}&action=blocked`)).body;
  assert.deepEqual([blocked.log.total, blocked.log.rows.every((x: any) => x.action === 'blocked'), blocked.totals.opened], [2, true, 3]);
  // Fifty to a page.
  for (let i = 0; i < 55; i += 1) logged(db, 7, SIGNED, 'download', `2026-10-23T10:${String(i % 60).padStart(2, '0')}:00.000Z`, 31);
  const p2 = (await call(db, FOUNDER, `/p-room/activity?${PERIOD}&page=2`)).body;
  assert.deepEqual([p2.log.total, p2.log.pages, p2.log.rows.length], [61, 2, 11]);
});

test('activity: who may read it, and the refusals', async () => {
  const db = busyRoom();
  assert.equal((await call(db, COFOUNDER, `/p-room/activity?${PERIOD}`)).status, 200);
  for (const who of [RIVAL, SIGNED, ADMIN]) assert.equal((await call(db, who, `/p-room/activity?${PERIOD}`)).status, 404, String(who));
  const bad = async (q: string) => (await call(db, FOUNDER, `/p-room/activity?${q}`)).body.code;
  assert.equal(await bad('from=2026-10-26&to=2026-10-25'), 'bad_period');
  assert.equal(await bad('from=2025-01-01&to=2026-10-25'), 'bad_period');
  assert.equal(await bad('from=2026-02-30'), 'bad_from');
  assert.equal(await bad('action=view'), 'bad_action');
  assert.equal(await bad('page=0'), 'bad_page');
  const rivalGrant = await call(db, FOUNDER, `/p-room/activity?investor=g-rival`);
  assert.deepEqual([rivalGrant.status, rivalGrant.body.code], [404, 'unknown_investor'], 'another venture’s grant names no investor here');
  // With no period named, the 30 days to today.
  const q = parseActivityQuery(() => undefined, '2026-10-25');
  assert.deepEqual(q.ok && [q.q.from, q.q.to, q.q.days], ['2026-09-26', '2026-10-25', 30]);
});

// ─────────────────────────────────────────────── the CSV

test('the CSV: the same rows, a refusal in its own words, names only for this venture’s grants, a formula neutralised', async () => {
  const db = busyRoom();
  const r = await call(db, FOUNDER, `/p-room/activity.csv?${PERIOD}`);
  assert.equal(r.status, 200, r.text);
  assert.match(r.type!, /^text\/csv/);
  assert.match(r.disposition!, /attachment; filename="data-room-activity-2026-10-20-to-2026-10-25\.csv"/);
  const lines = r.text.trimEnd().split('\r\n');
  assert.equal(lines[0], CSV_HEADER.join(','));
  assert.equal(lines.length, 7, 'the header and the period’s six rows');
  assert.equal(lines.filter((l) => l.includes('Blocked: NDA not signed')).length, 2);
  assert.equal(lines.filter((l) => l.includes(',Opened the room,')).length, 3, 'two refusals are not opens');
  assert.ok(lines.some((l) => l.includes(`,'=Sig Cell,sig@example.com,`)), 'a name a spreadsheet would run is quoted');
  const strangerLine = lines.find((l) => l.startsWith('2026-10-22T08:00'))!;
  assert.equal(strangerLine, '2026-10-22T08:00:00.000Z,Opened the room,,,', 'no name, no email');
  assert.ok(!r.text.includes('stan@example.com') && !r.text.includes('Rival.pdf'));
  const blocked = (await call(db, FOUNDER, `/p-room/activity.csv?${PERIOD}&action=blocked`)).text.trimEnd().split('\r\n');
  assert.equal(blocked.length, 3);
  assert.equal((await call(db, RIVAL, `/p-room/activity.csv?${PERIOD}`)).status, 404);
});

test('the CSV refuses a period longer than one file takes, rather than cutting it short', async () => {
  const db = freshDb();
  const ins = db.prepare(`INSERT INTO data_room_access_log (project_id, file_id, user_id, action, created_at) VALUES (7, NULL, ?, 'open_room', '2026-10-21T09:00:00.000Z')`);
  for (let i = 0; i <= CSV_MAX_ROWS; i += 1) ins.run(SIGNED);
  const r = await call(db, FOUNDER, `/p-room/activity.csv?${PERIOD}`);
  assert.deepEqual([r.status, r.body.code], [413, 'too_many_rows']);
  assert.equal((await call(db, FOUNDER, `/p-room/activity.csv?${PERIOD}&action=download`)).status, 200);
});

// ─────────────────────────────────────────────── the checklist

test('the checklist: per item, the files that answer it and how many grants in force can open each', async () => {
  const db = freshDb();
  file(db, 31, { name: 'Certificate.pdf', item: 'incorporation' });                                      // top level: the scoped grant is out
  file(db, 32, { name: 'Statements.pdf', item: 'financial_statements', tier: 'nobody', kind: 'connector', ref: 'mercury' });
  file(db, 33, { name: 'Model.xlsx', item: 'financial_model', folder: 51, visibility: 'nda' });
  file(db, 34, { name: 'Contracts.pdf', item: 'material_contracts', tier: 'committed' });
  file(db, 35, { name: 'Untagged.pdf' });
  file(db, 36, { name: 'Unknown item.pdf', item: 'not_an_item' });
  // An expired grant and a revoked one open nothing.
  db.prepare(`INSERT INTO users (id, role, name, email) VALUES (8, 'investor', 'Old', 'old@example.com'), (9, 'investor', 'Rev', 'rev@example.com')`).run();
  db.prepare(`INSERT INTO data_room_grants (uid, project_id, investor_user_id, granted_by_user_id, status, folders_scoped, expires_at) VALUES
    ('g-old', 7, 8, ?, 'active', 0, '2020-01-01'), ('g-rev', 7, 9, ?, 'revoked', 0, NULL)`).run(FOUNDER, FOUNDER);
  const r = await call(db, FOUNDER, '/p-room/checklist');
  assert.equal(r.status, 200, r.text);
  const b = r.body;
  assert.equal(b.grants_in_force, 2);
  assert.deepEqual(b.items.map((i: any) => i.key), DILIGENCE_CHECKLIST.map((c) => c.key));
  const by = Object.fromEntries(b.items.map((i: any) => [i.key, i]));
  assert.deepEqual([by.incorporation.state, by.incorporation.files[0].grants_that_open], ['open', 1]);
  assert.deepEqual([by.financial_model.state, by.financial_model.files[0].grants_that_open], ['open', 2]);
  assert.deepEqual([by.financial_statements.state, by.financial_statements.reason], ['no_one_can_open', NO_ONE_REASONS.private_only],
    'a file only a nobody tier answers: no one can open it');
  assert.deepEqual(by.financial_statements.files[0].source, { kind: 'connector', ref: 'mercury' });
  assert.deepEqual([by.material_contracts.state, by.material_contracts.reason], ['no_one_can_open', NO_ONE_REASONS.no_grant_admits]);
  assert.deepEqual([by.security.state, by.security.reason, by.security.files], ['no_file', NO_ONE_REASONS.no_file, []]);
  assert.deepEqual(b.totals, { items: DILIGENCE_CHECKLIST.length, answered: 4, openable: 2 });
  // A committed prospect opens the committed-only file; a lapsed NDA shuts the model to that grant.
  db.prepare(`INSERT INTO raise_prospects (uid, project_id, email, stage) VALUES ('rp-1', 7, 'sig@example.com', 'committed')`).run();
  db.prepare(`UPDATE pairwise_ndas SET status = 'revoked' WHERE party_b_user_id = ?`).run(SCOPED);
  const after = Object.fromEntries((await call(db, FOUNDER, '/p-room/checklist')).body.items.map((i: any) => [i.key, i]));
  assert.deepEqual([after.material_contracts.state, after.financial_model.files[0].grants_that_open], ['open', 1]);
  assert.equal((await call(db, COFOUNDER, '/p-room/checklist')).status, 200);
  for (const who of [RIVAL, SIGNED, ADMIN]) assert.equal((await call(db, who, '/p-room/checklist')).status, 404, String(who));
});

test('the checklist with the room shared with no one says so', async () => {
  const db = freshDb();
  db.prepare("UPDATE data_room_grants SET status = 'revoked'").run();
  file(db, 31, { name: 'Certificate.pdf', item: 'incorporation' });
  const by = Object.fromEntries((await call(db, FOUNDER, '/p-room/checklist')).body.items.map((i: any) => [i.key, i]));
  assert.deepEqual([by.incorporation.state, by.incorporation.reason], ['no_one_can_open', NO_ONE_REASONS.not_shared]);
});
