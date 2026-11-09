/**
 * D5074 (#5074) — the Data room read carries the caller's capabilities, and
 * they are the rules its writes enforce. On real SQLite, through the mounted
 * router, for each person who can reach the room's founder side:
 *
 *   · the venture's founder (the owner), an accepted co-founder, an advisor
 *     member and an investor (no room at all: 404 on the read and every write),
 *     an ordinary admin and a Super Admin (the summary, `admin_reason_required`),
 *     and the support read after a reason (read only: nothing allowed);
 *   · for the owner and the co-founder, each capability is probed against the
 *     write it governs: a write the map allows is never refused as the owner's,
 *     and a write it denies is refused 403 `owner_only` (or `founder_only`);
 *   · the map the Worker builds is the one the frontend tests draw from
 *     (`frontend/test/_data_room_capabilities.mjs`), so the two cannot drift.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/data_room_capabilities_5074.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { tableFromBaseline, stripForeignKeys, addColumnsFrom, splitStatements } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withGrantFolders } from './_data_room_scope.mjs';
import dataRoom from '../src/routes/data_room.ts';
import { ROOM_CAPABILITIES, roomCan, roomCapabilities } from '../src/services/dataRoomCapabilities.ts';
import { ROOM_CAPS } from '../../frontend/test/_data_room_capabilities.mjs';

const read = (p: string) => readFileSync(p, 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIG = (n: string) => read(`cloudflare-worker/sql/migrations/${n}`);
const MIG595 = MIG('595_data_room_access_requests.sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = 1;   // founders row 100, owns p-room
const INVESTOR = 2;  // grant g-signed on p-room
const COFOUNDER = 5; // accepted co-founder of p-room
const ADVISOR = 6;   // accepted advisor member of p-room
const ADMIN = 900;   // an ordinary admin
const SUPER = 901;   // a Super Admin (a `super_admins` row)

const ROLE: Record<number, string> = {
  [FOUNDER]: 'founder', [INVESTOR]: 'investor', [COFOUNDER]: 'founder', [ADVISOR]: 'advisor',
  [ADMIN]: 'admin', [SUPER]: 'admin',
};

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
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
    CREATE TABLE round_calls (id INTEGER PRIMARY KEY, uid TEXT, name TEXT);
  `);
  for (const t of ['data_room_grants', 'data_room_files', 'data_room_folders', 'data_room_access_log', 'pairwise_ndas',
    'raise_prospects', 'project_members', 'activity_logs', 'admin_audit_log']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  addColumnsFrom(db, stripForeignKeys(MIG('463_raise_record_stores.sql')), 'data_room_files');
  addColumnsFrom(db, MIG('596_data_room_file_source.sql'), 'data_room_files');
  addColumnsFrom(db, stripForeignKeys(MIG('442_raise_cycle_stores.sql')), 'data_room_files');
  db.exec(stripForeignKeys(splitStatements(MIG('463_raise_record_stores.sql')).find((s: string) => s.includes('CREATE TABLE IF NOT EXISTS data_room_file_versions'))));
  db.exec(stripForeignKeys(MIG595.slice(0, MIG595.indexOf('INSERT OR IGNORE'))));
  withGrantFolders(db);

  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?,?,?,?,?)');
  u.run(FOUNDER, 'founder', 100, 'Fran', 'fran@example.test');
  u.run(INVESTOR, 'investor', null, 'Ivo', 'ivo@example.test');
  u.run(COFOUNDER, 'founder', 300, 'Cora', 'cora@example.test');
  u.run(ADVISOR, 'advisor', null, 'Avi', 'avi@example.test');
  u.run(ADMIN, 'admin', null, 'Ada', 'ada@example.test');
  u.run(SUPER, 'admin', null, 'Sue', 'sue@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);

  db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (7, ?, ?, 100)').run('p-room', 'Roomco');
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (7, ?, 'cofounder', 'accepted'), (7, ?, 'advisor', 'accepted')`)
    .run(COFOUNDER, ADVISOR);
  db.prepare(`INSERT INTO data_room_grants (id, uid, project_id, investor_user_id, granted_by_user_id, status, folders_scoped)
    VALUES (1, 'g-signed', 7, ?, ?, 'active', 0)`).run(INVESTOR, FOUNDER);
  db.prepare(`INSERT INTO data_room_folders (id, uid, project_id, parent_id, name, visibility) VALUES (51, 'd-fin', 7, NULL, 'Financials', 'open'), (52, 'd-legal', 7, 51, 'Legal', 'open')`).run();
  const f = db.prepare(`INSERT INTO data_room_files (id, uid, project_id, folder_id, name, r2_key, content_type, size_bytes, visibility, uploaded_by_user_id)
    VALUES (?,?,7,?,?,?,?,?, 'open', ?)`);
  f.run(31, 'f-deck', 51, 'Deck.pdf', 'data-room/p-room/deck-v2', 'application/pdf', 20, FOUNDER);
  f.run(32, 'f-model', 51, 'Model.xlsx', 'data-room/p-room/model', 'application/vnd.ms-excel', 20, FOUNDER);
  db.prepare(`INSERT INTO data_room_file_versions (file_id, version, r2_key, content_type, size_bytes, uploaded_by) VALUES (31, 1, 'data-room/p-room/deck-v1', 'application/pdf', 10, ?)`).run(FOUNDER);
  db.prepare(`INSERT INTO data_room_access_requests (uid, project_id, investor_user_id, source, state) VALUES ('rq-open', 7, ?, 'deal_page', 'open')`).run(INVESTOR);
  return db;
}

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
  let parsed: any = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
  return { status: res.status, body: parsed };
}

const PDF = 'data:application/pdf;base64,JVBERi0xLjQK';
const inDays = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

/** Each capability and the write it governs (one request each, on a fresh room). */
const PROBES: Record<string, [string, string, unknown?]> = {
  upload: ['POST', '/p-room/files', { name: 'New.pdf', data: PDF }],
  edit: ['PATCH', '/p-room/files/f-model', { name: 'Renamed.xlsx' }],
  delete_folder: ['DELETE', '/p-room/folders/d-legal'],
  set_gate: ['PATCH', '/p-room/files/f-model', { visibility: 'nda' }],
  delete: ['DELETE', '/p-room/files/f-model'],
  share: ['PATCH', '/p-room/grants/g-signed', { expires_at: inDays(30) }],
  answer_requests: ['POST', '/p-room/requests/rq-open/decline', { reason: 'Not this round.' }],
  send_nda: ['POST', '/p-room/grants/g-signed/nda'],
  deck_source: ['PUT', '/p-room/files/f-model/deck-source', { enabled: true }],
  download: ['POST', '/p-room/files/f-deck/download'],
  make_current: ['POST', '/p-room/files/f-deck/versions/1/current'],
  export: ['GET', '/p-room/activity.csv'],
  search_index: ['POST', '/p-room/search/index'],
};
const REFUSED_CODES = new Set(['owner_only', 'founder_only']);
const refusedAsOwners = (r: { status: number; body: any }) => r.status === 403 && REFUSED_CODES.has(r.body?.code);

test('every capability has a probe, and every capability but the admin one is asked by a write', () => {
  assert.deepEqual(Object.keys(PROBES).sort(), ROOM_CAPABILITIES.filter((k) => k !== 'admin_reason_required').sort());
  const src = read('cloudflare-worker/src/routes/data_room.ts');
  for (const k of Object.keys(PROBES)) assert.match(src, new RegExp(`roomCan\\([^)]*'${k}'`), `${k} is enforced through roomCan`);
  assert.doesNotMatch(src, /room\.role !== 'owner'\)/, 'no write decides by the role itself any more');
});

test('the map the Worker builds is the one the frontend tests draw from', () => {
  assert.deepEqual(roomCapabilities('owner', { role: 'founder' }), ROOM_CAPS.owner);
  assert.deepEqual(roomCapabilities('cofounder', { role: 'founder' }), ROOM_CAPS.cofounder);
  assert.deepEqual(roomCapabilities('support', { role: 'admin' }), ROOM_CAPS.support);
  assert.deepEqual(roomCapabilities('summary', { role: 'admin' }), ROOM_CAPS.summary);
  for (const viewer of ['owner', 'cofounder', 'support', 'summary'] as const) {
    const caps = roomCapabilities(viewer, { role: 'founder' });
    assert.deepEqual(Object.keys(caps), [...ROOM_CAPABILITIES], `${viewer}: every key, in order`);
    for (const k of ROOM_CAPABILITIES) assert.equal(typeof caps[k], 'boolean');
  }
  // send_nda needs the venture's founder account; an owner on another role cannot sign as party A.
  assert.equal(roomCan('owner', 'send_nda', { role: 'founder' }), true);
  assert.equal(roomCan('owner', 'send_nda', { role: 'partner' }), false);
  assert.equal(roomCan('owner', 'send_nda', null), false);
});

for (const [who, id, viewer] of [['the founder (owner)', FOUNDER, 'owner'], ['an accepted co-founder', COFOUNDER, 'cofounder']] as const) {
  test(`${who}: the read's capabilities are the writes' rules, capability by capability`, async () => {
    const room = await call(freshDb(), id, 'GET', '/p-room');
    assert.equal(room.status, 200);
    assert.equal(room.body.role, viewer);
    assert.deepEqual(room.body.capabilities, ROOM_CAPS[viewer]);
    for (const [cap, [method, path, body]] of Object.entries(PROBES)) {
      const res = await call(freshDb(), id, method, path, body);
      if (room.body.capabilities[cap]) {
        assert.ok(!refusedAsOwners(res) && res.status !== 404, `${cap}: allowed by the read, so the write must not refuse (${res.status} ${JSON.stringify(res.body)})`);
      } else {
        assert.ok(refusedAsOwners(res), `${cap}: denied by the read, so the write must refuse 403 (${res.status} ${JSON.stringify(res.body)})`);
      }
    }
    // The requests read says the same as the map.
    const requests = await call(freshDb(), id, 'GET', '/p-room/requests');
    assert.equal(requests.status, 200);
    assert.equal(requests.body.can_answer, room.body.capabilities.answer_requests);
  });
}

for (const [who, id] of [['an advisor member', ADVISOR], ['an investor with a grant', INVESTOR]] as const) {
  test(`${who} reads no founder room and no write reaches it`, async () => {
    const room = await call(freshDb(), id, 'GET', '/p-room');
    assert.equal(room.status, 404);
    assert.equal(room.body.capabilities, undefined, 'no map for someone the room is not for');
    for (const [cap, [method, path, body]] of Object.entries(PROBES)) {
      const res = await call(freshDb(), id, method, path, body);
      assert.equal(res.status, 404, `${cap}: every room route answers someone the room is not for 404 (${res.status})`);
    }
  });
}

for (const [who, id] of [['an ordinary admin', ADMIN], ['a Super Admin', SUPER]] as const) {
  test(`${who} reads the summary: nothing allowed, the reason required, and every write refused`, async () => {
    const room = await call(freshDb(), id, 'GET', '/p-room');
    assert.equal(room.status, 200);
    assert.equal(room.body.mode, 'summary');
    assert.deepEqual(room.body.capabilities, ROOM_CAPS.summary);
    assert.equal(room.body.capabilities.admin_reason_required, true);
    const noReason = await call(freshDb(), id, 'POST', '/p-room/support-read', {});
    assert.equal(noReason.status, 400);
    assert.equal(noReason.body.error, 'support_reason_required', 'the reason the map asks for is the one the route requires');
    for (const [cap, [method, path, body]] of Object.entries(PROBES)) {
      const res = await call(freshDb(), id, method, path, body);
      assert.ok([403, 404].includes(res.status), `${cap}: ${res.status} ${JSON.stringify(res.body)}`);
    }
  });
}

test('the support read after a reason is read only: its map allows nothing', async () => {
  for (const id of [ADMIN, SUPER]) {
    const res = await call(freshDb(), id, 'POST', '/p-room/support-read', { reason: 'Founder asked for help finding the deck.' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.mode, 'support');
    assert.equal(res.body.read_only, true);
    assert.deepEqual(res.body.capabilities, ROOM_CAPS.support);
    assert.ok(Object.values(res.body.capabilities).every((v) => v === false));
  }
});
