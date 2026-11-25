// D8535 (#8535) — a data-room grant revoked, or the venture moved to another company, while the investor is using it.
//
// The d4570 suites ask each gate one request at a time. This one changes the grant while the investor has the room
// open, on the real Worker (`worker.fetch`, the fully migrated schema, an R2 bucket stub), with two accounts: the
// venture's owner and one investor. The owner shares one folder; the investor reads the room, opens a file (a preview:
// the room's one-time signed link, `/api/files/dl/<token>`), keeps two more links in hand (one not yet opened, one whose
// response has begun) and adds the file to their Library (the room's one export: a reference that follows the grant,
// D6869). Then, in turn, the owner
//   (a) revokes the grant (`DELETE /api/data-room/:projectUid/grants/:uid`), and
//   (b) moves the venture to another of their companies (`POST /api/projects/:id/move`).
// After each:
//   - the next document read is refused (the room, the room list, the document page);
//   - a range request for the file being previewed is refused, on the opened link and on a link minted before;
//   - a link minted before and not yet opened (a cached preview URL) is refused at the moment it is opened;
//   - the export is cancelled: the Library reference lapses, and its download sends the investor to the room;
//   - reopening from history (the same request again) is refused, and so is the opened link;
//   - a response that began before the change completes, and nothing after it opens a stored object.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/data_room_live_revocation_d8535.test.ts
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import worker from '../src/index.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

const SECRET = 'd8535-live-revocation-fixture-only-'.repeat(2); // A fixture signing key; never a service credential.
const OWNER = 1, VIEWER = 2;
const PROJECT = 10, NORTH = 501, SOUTH = 502;
const ROOM = 'p-kestrel';
const GRANTED_KEY = `data-room/${ROOM}/granted-model.pdf`;
const WITHHELD_KEY = `data-room/${ROOM}/withheld-terms.pdf`;
const BYTES = 'KESTREL-GRANTED-BYTES-0123456789';
const LEAKS = ['KESTREL', 'Kestrel', 'granted-model', 'Granted model'];

class FakeR2 {
  objects = new Map<string, Uint8Array>();
  reads: string[] = [];
  constructor(entries: Record<string, string>) { for (const [k, v] of Object.entries(entries)) this.objects.set(k, new TextEncoder().encode(v)); }
  async head(key: string) { this.reads.push(`head ${key}`); const o = this.objects.get(key); return o ? { size: o.length, httpMetadata: { contentType: 'application/pdf' } } : null; }
  async get(key: string, opts?: any) {
    this.reads.push(`get ${key}`);
    const o = this.objects.get(key);
    if (!o) return null;
    const r = opts?.range;
    const bytes = r ? o.slice(r.offset, r.offset + r.length) : o;
    return { body: new Blob([bytes]).stream(), httpMetadata: { contentType: 'application/pdf' }, writeHttpMetadata(h: Headers) { h.set('content-type', 'application/pdf'); } };
  }
  async put() { throw new Error('nothing here writes an object'); }
  async delete() { throw new Error('nothing here deletes an object'); }
}

const ctx: any = { waitUntil() {}, passThroughOnException() {} };
const jwt = (userId: number) =>
  new SignJWT({ user_id: userId }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30m').sign(new TextEncoder().encode(SECRET));

after(() => removeMigratedDatabases());

/** One room, its two accounts, and the investor part-way through using it. */
async function openRoom() {
  const db: any = migratedDatabase();
  db.exec(`INSERT INTO users (id, uid, name, email, role, founder_id, is_active, email_verified, subscription_tier, subscription_status) VALUES
    (${OWNER},'u-owner','Owner','owner@example.test','founder',40,1,1,'studio','active'),
    (${VIEWER},'u-viewer','Viewer','viewer@example.test','investor',NULL,1,1,'studio','active');
    INSERT INTO company_profiles (id, uid, company_name, created_at, updated_at) VALUES
      (${NORTH},'co-north','North Holdings','2026-01-01','2026-01-01'), (${SOUTH},'co-south','South Holdings','2026-01-01','2026-01-01');
    INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES
      ('l-north',${NORTH},${OWNER},'Owner',1,'2026-01-01'), ('l-south',${SOUTH},${OWNER},'Owner',1,'2026-01-01');
    INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (${PROJECT},'${ROOM}','Kestrel Robotics',40,${NORTH});
    INSERT INTO data_room_folders (id, uid, project_id, parent_id, name, visibility) VALUES
      (71,'fold-granted',${PROJECT},NULL,'Financials','open'), (72,'fold-withheld',${PROJECT},NULL,'Legal','open');
    INSERT INTO data_room_files (id, uid, project_id, folder_id, name, r2_key, content_type, size_bytes, visibility) VALUES
      (81,'file-granted',${PROJECT},71,'Granted model.pdf','${GRANTED_KEY}','application/pdf',${BYTES.length},'open'),
      (82,'file-withheld',${PROJECT},72,'Withheld terms.pdf','${WITHHELD_KEY}','application/pdf',10,'open');`);
  const files = new FakeR2({ [GRANTED_KEY]: BYTES, [WITHHELD_KEY]: 'WITHHELD-BYTES' });
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', RATE_LIMITS: memKV(), TOKENS: memKV(), FILES: files, APP_URL: 'https://unit.test' };
  const sessions: Record<number, string> = { [OWNER]: await jwt(OWNER), [VIEWER]: await jwt(VIEWER) };

  /** One request through the whole Worker; the body is left unread, so a response can be held open. */
  const raw = (path: string, who?: number, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
    const read = method === 'GET';
    return worker.fetch(new Request(`https://unit.test${path}`, {
      method, redirect: 'manual',
      headers: { ...(who ? { authorization: `Bearer ${sessions[who]}` } : {}), ...(read ? {} : { 'content-type': 'application/json' }), ...headers },
      body: read ? undefined : JSON.stringify(body ?? {}),
    // A fresh limiter per request: this suite is about gates, and the limiter would otherwise answer 429 first.
    }), { ...env, RATE_LIMITS: memKV() } as any, ctx);
  };
  const call = async (path: string, who?: number, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
    const res = await raw(path, who, method, body, headers);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, text, json, disposition: res.headers.get('content-disposition') ?? '' };
  };
  const link = async () => {
    const res = await call(`/api/data-room/shared/${ROOM}/files/file-granted/download`, VIEWER, 'POST');
    assert.equal(res.status, 200, res.text);
    return res.json.url as string;
  };

  // The owner turns on Library copies and shares one folder.
  assert.equal((await call(`/api/room-library/settings/${ROOM}`, OWNER, 'PUT', { allow_library: true })).status, 200);
  const shared = await call(`/api/data-room/${ROOM}/grants`, OWNER, 'POST', { email: 'viewer@example.test', folders: ['fold-granted'] });
  assert.equal(shared.status, 201, shared.text);
  const grant = db.prepare('SELECT uid, status FROM data_room_grants WHERE project_id = ? AND investor_user_id = ?').get(PROJECT, VIEWER);
  assert.equal(grant?.status, 'active', 'the fixture: the grant is written');

  // The investor reads the room: the granted folder's file, not the other folder's.
  const room = await call(`/api/data-room/shared/${ROOM}`, VIEWER);
  assert.equal(room.status, 200, room.text);
  assert.deepEqual(room.json.files.map((f: any) => f.uid), ['file-granted'], 'the fixture: one folder is shared');
  assert.equal((await call(`/api/research/diligence/${grant.uid}/files/file-granted`, VIEWER)).status, 200, 'the fixture: the document page reads');

  // A preview, opened and read to the end.
  const preview = await link();
  const opened = await call(preview, VIEWER);
  assert.deepEqual([opened.status, opened.text], [200, BYTES], 'the fixture: the preview serves the file');
  // A response that has begun (headers sent, body not yet read), a link minted and kept (a cached preview URL), and
  // one more kept for a range request.
  const streaming = await raw(await link(), VIEWER);
  assert.equal(streaming.status, 200);
  const cached = await link();
  const ranged = await link();
  // The export: the file added to the investor's Library.
  const added = await call('/api/room-library/items', VIEWER, 'POST', { project_uid: ROOM, file_uid: 'file-granted' });
  assert.equal(added.status, 201, added.text);
  const listed = await call('/api/research/documents', VIEWER);
  assert.equal(listed.status, 200, listed.text);
  assert.ok(listed.text.includes(added.json.document_uid), 'the fixture: the export is in the Library');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_room_refs WHERE lost_at IS NULL').get().n, 1);

  return { db, files, call, raw, grant, preview, streaming, cached, ranged, documentUid: added.json.document_uid as string };
}

const leaks = (r: { text: string; disposition: string }) => LEAKS.filter((l) => r.text.includes(l) || r.disposition.includes(l));

const CHANGES = [
  {
    name: 'the owner revokes the grant',
    change: async (s: Awaited<ReturnType<typeof openRoom>>) => {
      const res = await s.call(`/api/data-room/${ROOM}/grants/${s.grant.uid}`, OWNER, 'DELETE');
      assert.equal(res.status, 200, res.text);
    },
  },
  {
    name: 'the owner moves the venture to another company',
    change: async (s: Awaited<ReturnType<typeof openRoom>>) => {
      const res = await s.call(`/api/projects/${PROJECT}/move`, OWNER, 'POST', { company_id: SOUTH });
      assert.equal(res.status, 200, res.text);
      assert.equal(s.db.prepare('SELECT company_id FROM projects WHERE id = ?').get(PROJECT).company_id, SOUTH, 'the fixture: the venture moved');
    },
  },
] as const;

for (const { name, change } of CHANGES) {
  test(`${name} while the room is open: the next read, a range request, a kept link, the export and a reopen are refused`, async () => {
    const s = await openRoom();
    await change(s);
    // Mutation checked: the move's `UPDATE data_room_grants SET status = 'revoked'` dropped from
    // `projectMoveStatements` → the grant stays active after the move and this fails.
    assert.equal(s.db.prepare('SELECT status FROM data_room_grants WHERE uid = ?').get(s.grant.uid).status, 'revoked', `${name}: the grant is ended`);
    const readsBefore = s.files.reads.length;

    // 1. The next document read: the room, the room list and the document page.
    const room = await s.call(`/api/data-room/shared/${ROOM}`, VIEWER);
    assert.equal(room.status, 404, `${name}: the room: ${room.text}`);
    const list = await s.call('/api/data-room/shared', VIEWER);
    assert.equal(list.status, 200, list.text);
    assert.deepEqual(list.json.items, [], `${name}: the room is no longer listed`);
    const page = await s.call(`/api/research/diligence/${s.grant.uid}/files/file-granted`, VIEWER);
    assert.equal(page.status, 404, `${name}: the document page: ${page.text}`);
    assert.deepEqual(leaks(page), [], `${name}: the document page's refusal names nothing`);

    // 2. A range request for the file being previewed: on the opened link (spent), and on a link minted before.
    for (const [which, url] of [['the opened preview', s.preview], ['a link minted before', s.ranged]] as const) {
      const res = await s.call(url, VIEWER, 'GET', undefined, { range: 'bytes=0-7' });
      // Mutation checked (a link minted before): the grant re-check at `/api/files/dl` (`dataRoomLinkOpen`) removed
      // → the kept link serves its bytes after the change and this fails.
      assert.equal(res.status, 403, `${name}: a range request on ${which}: ${res.text}`);
      assert.deepEqual(leaks(res), [], `${name}: ${which}'s refusal names nothing`);
      assert.ok(!res.text.includes(BYTES.slice(0, 8)), `${name}: no byte of the file`);
    }

    // 3. A cached preview URL, minted before and opened now.
    const cached = await s.call(s.cached, VIEWER);
    // Mutation checked: as above, the re-check at `/api/files/dl` removed → the kept link serves the file and this fails.
    assert.equal(cached.status, 403, `${name}: the kept link: ${cached.text}`);
    assert.deepEqual(leaks(cached), [], `${name}: the kept link's refusal names nothing`);

    // 4. The export is cancelled: the Library reference lapses, and its download opens nothing.
    const docs = await s.call('/api/research/documents', VIEWER);
    assert.equal(docs.status, 200, docs.text);
    const ref = s.db.prepare('SELECT lost_at, lost_reason FROM research_room_refs').get();
    // Mutation checked: `roomFileLapse`'s grant test (`grant.status !== 'active'`) removed → the reference stays live and this fails.
    assert.ok(ref.lost_at, `${name}: the Library reference lapsed`);
    assert.equal(ref.lost_reason, 'revoked', `${name}: it reads as revoked`);
    const exported = await s.call(`/api/research/documents/${s.documentUid}/download`, VIEWER);
    assert.equal(exported.status, 409, `${name}: the export's download: ${exported.text}`);
    assert.equal(exported.json?.detail, 'open_in_room');
    assert.equal(exported.json?.project_uid, null, `${name}: a lapsed reference names no room to open`);
    assert.ok(!('url' in (exported.json ?? {})), `${name}: no link is minted for it`);
    const again = await s.call('/api/room-library/items', VIEWER, 'POST', { project_uid: ROOM, file_uid: 'file-granted' });
    assert.equal(again.status, 404, `${name}: a new export is refused: ${again.text}`);

    // 5. Reopening from history: the same requests again.
    const remint = await s.call(`/api/data-room/shared/${ROOM}/files/file-granted/download`, VIEWER, 'POST');
    // Mutation checked: the investor download's `activeGrant` test removed (`!project || !grant` → `!project`) → a new
    // link is minted after the change and this fails.
    assert.equal(remint.status, 404, `${name}: a new link from history: ${remint.text}`);
    assert.deepEqual(leaks(remint), []);
    const reopened = await s.call(s.preview, VIEWER);
    assert.equal(reopened.status, 403, `${name}: the opened link from history: ${reopened.text}`);

    // Nothing after the change opened a stored object.
    assert.deepEqual(s.files.reads.slice(readsBefore), [], `${name}: no object was opened after the change`);

    // 6. The response that began before the change completes, whole: it was let through before the grant ended.
    assert.equal(await s.streaming.text(), BYTES, `${name}: a response already streaming completes`);
  });
}

test('the re-check at /api/files/dl lets the investor through while the grant holds, and leaves the founder\'s own links alone', async () => {
  const s = await openRoom();
  // A kept link still opens while nothing has changed: the refusals above are the change, not the re-check.
  const kept = await s.call(s.cached, VIEWER, 'GET', undefined, { range: 'bytes=0-7' });
  assert.deepEqual([kept.status, kept.text], [200, BYTES], 'a kept link opens while the grant holds (the route sends the whole file)');
  // The opened preview is spent whatever the grant: a range request on it is refused while the grant holds.
  const spent = await s.call(s.preview, VIEWER, 'GET', undefined, { range: 'bytes=0-7' });
  // Mutation checked: `verifyAndConsumeToken`'s single-use test (`if (!present)`) removed → the spent link serves and this fails.
  assert.equal(spent.status, 403, `a range request on the opened preview while the grant holds: ${spent.text}`);
  // The founder's own link (`data_room_founder:` audience) is not an investor's and is not re-checked against a grant.
  const own = await s.call(`/api/data-room/${ROOM}/files/file-granted/download`, OWNER, 'POST');
  assert.equal(own.status, 200, own.text);
  await s.call(`/api/data-room/${ROOM}/grants/${s.grant.uid}`, OWNER, 'DELETE');
  const ownOpened = await s.call(own.json.url, OWNER);
  assert.deepEqual([ownOpened.status, ownOpened.text], [200, BYTES], 'the founder\'s link opens after an investor is revoked');
  // The re-check is the room's whole gate, not only the grant: a link to a file the owner then moves out of the shared
  // folder is refused too.
  await s.call(`/api/data-room/${ROOM}/grants`, OWNER, 'POST', { email: 'viewer@example.test', folders: ['fold-granted'] });
  const before = await s.call(`/api/data-room/shared/${ROOM}/files/file-granted/download`, VIEWER, 'POST');
  assert.equal(before.status, 200, before.text);
  s.db.prepare('UPDATE data_room_files SET folder_id = 72 WHERE id = 81').run();
  const outOfScope = await s.call(before.json.url, VIEWER);
  // Mutation checked: `dataRoomLinkOpen`'s folder test (`tierAdmits`) removed → the moved file serves and this fails.
  assert.equal(outOfScope.status, 403, `a link to a file moved out of the shared folder: ${outOfScope.text}`);
});
