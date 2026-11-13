/**
 * #4714 (D4714) part 2 — the Practice lists page, and their totals are over
 * the whole set, never the page shown.
 *
 *   bookings      200 per page: 201 rows is two pages, `page.total` 201
 *   engagements   400 per page: 401 is two; `totals.active` counts all 401
 *   deliverables  400 per page: 401 is two; `totals.work_products` is 401
 *
 * On the migrated schema, synthetic rows only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/practice_pages_4714.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import advisors from '../src/routes/advisors.ts';

const SECRET = 'test'.repeat(16);
test.after(() => removeMigratedDatabases());
const SAME = '2026-10-01T09:00:00.000Z';

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,name,email,role,is_active) VALUES (21,'Advisor','a@example.test','advisor',1),(11,'F','f@example.test','founder',1);
    INSERT INTO advisors(id,uid,user_id,display_name,email) VALUES (201,'a-1',21,'Advisor','a@example.test');
    INSERT INTO advisor_office_hour_slots(id,uid,advisor_id,starts_at,ends_at,capacity) VALUES (1,'s-1',201,'2026-12-01T10:00:00Z','2026-12-01T11:00:00Z',500);
  `);
  const app = new Hono<any>(); app.route('/api/advisors', advisors);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const get = async (path: string) => {
    const jwt = await new SignJWT({ user_id: 21 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`/api/advisors${path}`, { headers: { Authorization: `Bearer ${jwt}` } }, env);
    const body = await res.json() as any;
    assert.equal(res.status, 200, JSON.stringify(body));
    return body;
  };
  return { db, get };
}

async function walk(get: (p: string) => Promise<any>, path: string) {
  const pages: any[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const b = await get(`${path}${path.includes('?') ? '&' : '?'}offset=${offset}`);
    pages.push(b);
    offset = b.page.next_offset;
    assert.ok(pages.length < 10);
  }
  return pages;
}

test('bookings: 201 rows read as two pages of 200, every row once, total 201', async () => {
  const { db, get } = fixture();
  // One founder per booking: a founder holds a slot once.
  const b = db.prepare("INSERT INTO advisor_bookings(id,uid,slot_id,advisor_id,founder_user_id,status,created_at) VALUES (?,?,1,201,?,?,?)");
  for (let i = 1; i <= 201; i += 1) b.run(i, `b-${i}`, 1000 + i, i % 2 ? 'confirmed' : 'pending', SAME);
  const pages = await walk(get, '/me/bookings');
  assert.equal(pages.length, 2);
  assert.deepEqual(pages[0].page, { offset: 0, limit: 200, total: 201, next_offset: 200 });
  assert.equal(pages[0].total, 201, 'the older field still answers');
  const ids = pages.flatMap((p) => p.items.map((x: any) => x.id));
  assert.equal(new Set(ids).size, 201, 'no booking repeats or falls between pages');
  assert.ok(ids.includes(1), 'the oldest booking is reachable');
  const pending = await walk(get, '/me/bookings?status=pending');
  assert.equal(pending[0].page.total, 100, 'the status filter pages and counts its own set');
});

test('engagements: 401 rows, two pages of 400, totals over all 401', async () => {
  const { db, get } = fixture();
  const e = db.prepare("INSERT INTO advisor_engagements(id,uid,advisor_id,client_name,lane,shape,outcome,updated_at) VALUES (?,?,201,?,?,?,?,?)");
  // Every engagement is signed; the oldest (id 1, the last row of page 2) was renewed.
  for (let i = 1; i <= 401; i += 1) e.run(i, `e-${i}`, `Client ${i}`, 'signed', 'retainer', i === 1 ? 'renewed' : null, SAME);
  const pages = await walk(get, '/me/engagements');
  assert.equal(pages.length, 2);
  assert.equal(pages[0].items.length, 400);
  assert.deepEqual(pages[1].items.map((x: any) => x.id), [1], 'the 401st is reachable');
  for (const p of pages) {
    assert.equal(p.totals.active, 401, 'active counts every engagement, not the page');
    assert.equal(p.totals.renewed, 1, 'the renewal on page 2 is counted on page 1');
    assert.equal(p.page.total, 401);
  }
});

test('deliverables: 401 rows, two pages of 400, totals over all 401', async () => {
  const { db, get } = fixture();
  const d = db.prepare("INSERT INTO advisor_deliverables(id,uid,advisor_id,client_name,title,updated_at) VALUES (?,?,201,?,?,?)");
  for (let i = 1; i <= 401; i += 1) d.run(i, `d-${i}`, `Client ${i % 3}`, `Work ${i}`, SAME);
  const pages = await walk(get, '/me/deliverables');
  assert.equal(pages.length, 2);
  assert.deepEqual(pages[1].items.map((x: any) => x.id), [1]);
  for (const p of pages) {
    assert.equal(p.totals.work_products, 401);
    assert.equal(p.totals.clients, 3);
    assert.equal(p.page.total, 401);
  }
});

test('a page asked for past the end is empty and says there is no next page', async () => {
  const { get } = fixture();
  const b = await get('/me/engagements?offset=50');
  assert.deepEqual([b.items.length, b.page.next_offset, b.page.total], [0, null, 0]);
});
