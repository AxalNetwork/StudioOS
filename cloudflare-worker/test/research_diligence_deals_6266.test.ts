/**
 * D6266 (#6266): each diligence room carries the deals on its company that the
 * caller may open (invited to, or committed on: the deal page's own rule), with
 * the deal's stage. A deal the caller cannot open is never named or counted; a
 * room with none says so in plain words; a failed deal read is Unreadable.
 *
 * Real SQLite, with the tables cut from `sql/schema_baseline.sql`.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_diligence_deals_6266.test.ts
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
import { AI_LOG_SCHEMA, AI_BUDGET_MIGRATION } from './_ai_budget_fixture.mjs';
import research, { NO_ROOM_DEAL, ROOM_DEAL_UNREADABLE } from '../src/routes/research.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIG463 = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/463_raise_record_stores.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 1, INVITED = 2, COMMITTED = 3, NEITHER = 4;

function freshDb({ deals = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT UNIQUE NOT NULL, name TEXT, founder_id INTEGER);
  `);
  for (const t of ['data_room_grants', 'data_room_files', 'data_room_folders', 'data_room_access_log', 'pairwise_ndas', 'raise_prospects']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  addColumnsFrom(db, stripForeignKeys(MIG463), 'data_room_files');
  withGrantFolders(db);
  if (deals) for (const t of ['deals', 'deal_invitations', 'commitments']) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  db.exec(AI_LOG_SCHEMA + AI_BUDGET_MIGRATION);
  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?,?,?,?,?)');
  u.run(FOUNDER, 'founder', 100, 'Fran', 'fran@example.com');
  for (const id of [INVITED, COMMITTED, NEITHER]) u.run(id, 'investor', null, `Investor ${id}`, `i${id}@example.com`);
  const p = db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?,?,?,?)');
  p.run(7, 'p-room', 'Roomco', 100);
  p.run(8, 'p-other', 'Elsewhere', 100);
  const g = db.prepare(`INSERT INTO data_room_grants (uid, project_id, investor_user_id, granted_by_user_id, status) VALUES (?,?,?,?, 'active')`);
  g.run('g-invited', 7, INVITED, FOUNDER);
  g.run('g-committed', 7, COMMITTED, FOUNDER);
  g.run('g-neither', 7, NEITHER, FOUNDER);
  if (deals) {
    const d = db.prepare(`INSERT INTO deals (id, project_id, status, created_at) VALUES (?,?,?,?)`);
    d.run(51, 7, 'active', '2026-10-01T00:00:00Z');   // INVITED is invited
    d.run(52, 7, 'funded', '2026-09-01T00:00:00Z');   // COMMITTED committed; nobody else related
    d.run(53, 8, 'active', '2026-10-05T00:00:00Z');   // another company: never on Roomco's room
    db.prepare('INSERT INTO deal_invitations (deal_id, investor_user_id) VALUES (?, ?)').run(51, INVITED);
    db.prepare('INSERT INTO deal_invitations (deal_id, investor_user_id) VALUES (?, ?)').run(53, INVITED);
    db.prepare(`INSERT INTO commitments (deal_id, investor_user_id, amount, status) VALUES (?, ?, ?, 'pending')`).run(52, COMMITTED, 50000);
  }
  return db;
}

async function get(db: any, userId: number, path: string) {
  const tokenOf = await new SignJWT({ user_id: userId, role: 'investor' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await research.fetch(new Request(`http://x${path}`, { headers: { Authorization: `Bearer ${tokenOf}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null, raw };
}

test('an invited investor sees the deal on the room’s company, with its stage; no other company’s deal and no unrelated one', async () => {
  const db = freshDb();
  const list = await get(db, INVITED, '/diligence');
  assert.equal(list.status, 200);
  const room = list.body.items.find((r: any) => r.grant_uid === 'g-invited');
  assert.deepEqual(room.deals, [{ id: 51, stage: 'active', name: 'Roomco' }]);
  assert.equal('deal_stage_note' in room, false, 'the note is only for a room with none');
  assert.equal(list.raw.includes('"id":52') || list.raw.includes('"id":53'), false, 'deal 52 (unrelated) and 53 (another company) are never named');
  assert.equal('deal_stage' in list.body, false, 'the old top-level null is gone');
  assert.equal(list.raw.includes('no key between'), false);
  const one = await get(db, INVITED, '/diligence/g-invited');
  assert.equal(one.status, 200);
  assert.deepEqual(one.body.deals, [{ id: 51, stage: 'active', name: 'Roomco' }]);
  assert.equal('deal_stage_note' in one.body, false);
});

test('a commitment is a relationship too, and only that deal is returned', async () => {
  const db = freshDb();
  const list = await get(db, COMMITTED, '/diligence');
  assert.deepEqual(list.body.items[0].deals, [{ id: 52, stage: 'funded', name: 'Roomco' }]);
  const one = await get(db, COMMITTED, '/diligence/g-committed');
  assert.deepEqual(one.body.deals.map((d: any) => d.id), [52]);
});

test('a room with no deal the caller may open says so in plain words, and counts nothing', async () => {
  const db = freshDb();
  const list = await get(db, NEITHER, '/diligence');
  assert.deepEqual(list.body.items[0].deals, []);
  assert.equal(list.body.items[0].deal_stage_note, NO_ROOM_DEAL);
  assert.equal(NO_ROOM_DEAL, 'No deal you are invited to is recorded for this company.');
  const one = await get(db, NEITHER, '/diligence/g-neither');
  assert.deepEqual(one.body.deals, []);
  assert.equal(one.body.deal_stage_note, NO_ROOM_DEAL);
  for (const raw of [list.raw, one.raw]) assert.equal(/"id":5[123]|active|funded/.test(raw.replace(/"status":"active"/g, '')), false, 'no deal named or counted');
});

test('a failed deal read is Unreadable, and the room still opens', async () => {
  const db = freshDb({ deals: false });
  const list = await get(db, INVITED, '/diligence');
  assert.equal(list.status, 200);
  assert.equal(list.body.items[0].deals, null);
  assert.equal(list.body.items[0].deal_stage_note, ROOM_DEAL_UNREADABLE);
  const one = await get(db, INVITED, '/diligence/g-invited');
  assert.equal(one.status, 200);
  assert.equal(one.body.deals, null);
  assert.match(one.body.deal_stage_note, /^Unreadable: .* not a claim that there are none\.$/);
});
