/**
 * D6913 part 3 (#6913, RS-15): a Library row added from a data room carries its access, so an Ask citation can say how
 * long the room stays open (`routes/research.ts`, `roomDto`).
 *
 * Real schema (`loadSchema`), real routes, synthetic fixtures:
 *   FOUNDER  owns venture 7's room
 *   HOLDER   investor with an active grant on venture 7
 *   PEER     another investor with their own grant on venture 7, ending sooner
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/room_library_access_6913.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import roomLibrary from '../src/routes/room_library.ts';
import research from '../src/routes/research.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d6913-room-access-0123456789';
const FOUNDER = 1, HOLDER = 3, PEER = 4;

function fixture(holderExpires: string | null) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare(`INSERT INTO users (id, role, founder_id, name, email, is_active, investor_tier, investor_subscription_status) VALUES (?, ?, ?, ?, ?, 1, ?, 'active')`);
  u.run(FOUNDER, 'founder', 100, 'Mara', 'mara@co.example', 'free');
  u.run(HOLDER, 'investor', null, 'Theo', 'theo@vc.example', 'professional');
  u.run(PEER, 'investor', null, 'Pia', 'pia@vc.example', 'professional');
  db.prepare(`INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p-room', 'Halverton', 100)`).run();
  db.prepare(`INSERT INTO data_room_grants (id, uid, project_id, investor_user_id, granted_by_user_id, status, expires_at) VALUES (1, 'g-holder', 7, ?, ?, 'active', ?)`)
    .run(HOLDER, FOUNDER, holderExpires);
  db.prepare(`INSERT INTO data_room_grants (id, uid, project_id, investor_user_id, granted_by_user_id, status, expires_at) VALUES (2, 'g-peer', 7, ?, ?, 'active', '2098-03-01T00:00:00Z')`)
    .run(PEER, FOUNDER);
  db.exec(`
    INSERT INTO data_room_files (id, uid, project_id, name, visibility, r2_key, content_type, size_bytes) VALUES
      (11, 'f-open', 7, 'Cohort retention Q3.xlsx', 'open', 'data-room/p-room/open', 'text/csv', 5000);
    INSERT INTO data_room_library_settings (project_id, allow_library, updated_at) VALUES (7, 1, '2026-11-16');
  `);
  return db;
}

const app = new Hono<any>();
app.route('/api/room-library', roomLibrary);
app.route('/api/research', research);

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
      FILES: { put: async () => {}, delete: async () => {}, get: async () => null },
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

async function roomRow(db: DatabaseSync) {
  const add = await quiet(() => call(db, HOLDER, 'POST', '/api/room-library/items', { project_uid: 'p-room', file_uid: 'f-open' }));
  assert.equal(add.status < 300, true, JSON.stringify(add.body));
  const lib = await quiet(() => call(db, HOLDER, 'GET', '/api/research/documents'));
  return lib.body.items.find((i: any) => i.uid === add.body.document_uid);
}

test('a live reference carries its own grant’s end, not another investor’s', async () => {
  // mutation: roomRefAccess reads any active grant on the room (joined on the project, no investor check) → the peer's 2098-03-01.
  const row = await roomRow(fixture('2099-01-12T00:00:00Z'));
  assert.deepEqual(row.room.access, { until: '2099-01-12T00:00:00Z' });
});

test('a grant with no end set reads as access with no end, not as no access', async () => {
  // mutation: an entry kept only when `expires_at` is set → null here.
  const row = await roomRow(fixture(null));
  assert.deepEqual(row.room.access, { until: null });
});

test('a lapsed reference carries no access at all, even while its grant is still active', async () => {
  // The founder turns Library copies off: the grant stays active, the reference lapses.
  // mutation: `r.lost_at IS NULL` dropped from roomRefAccess → the lapsed row still reads the live grant's access.
  for (const [reason, lapse] of [
    ['library_off', `UPDATE data_room_library_settings SET allow_library = 0`],
    ['revoked', `UPDATE data_room_grants SET status = 'revoked' WHERE id = 1`],
  ] as const) {
    const db = fixture('2099-01-12T00:00:00Z');
    const add = await quiet(() => call(db, HOLDER, 'POST', '/api/room-library/items', { project_uid: 'p-room', file_uid: 'f-open' }));
    db.exec(lapse);
    const lib = await quiet(() => call(db, HOLDER, 'GET', '/api/research/documents'));
    const row = lib.body.items.find((i: any) => i.uid === add.body.document_uid);
    assert.equal(row.room.lost_reason, reason);
    assert.equal(row.room.access, null, reason);
  }
});
