/**
 * D1597 (#3870) — `GET /api/advisors/me/visibility`: booking requests per link
 * and opens of the advisor's writing, each from the store that records it.
 * Views and engagements are null with their sentences (owner answer H = b), and
 * a failed read is null with `unreadable`, never a zero.
 *
 * On the migrated schema, synthetic rows only; the router mounted as `index.ts`
 * mounts it, at /api/advisors.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor_visibility_d1597.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import advisors from '../src/routes/advisors.ts';
import { ENGAGEMENTS_NOTE, NO_LINK_NOTE, OPENS_NOTE, VIEWS_NOTE, visibilityWindow } from '../src/services/advisorVisibility.ts';

const SECRET = 'synthetic-advisor-visibility-d1597-'.repeat(2);
test.after(() => removeMigratedDatabases());

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

// 21 advisor (201), 22 another advisor (202), 23 an advisor-role user with no profile;
// 11 founder, 31 partner, 41 Explorer.
function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
      (11,'Founder','f@example.test','founder',101,1),(21,'Advisor','a@example.test','advisor',NULL,1),
      (22,'Advisor Two','a2@example.test','advisor',NULL,1),(23,'No Profile','np@example.test','advisor',NULL,1),
      (31,'Partner','p@example.test','partner',NULL,1),(41,'Explorer','e@example.test','exploring',NULL,1);
    INSERT INTO advisors(id,uid,user_id,display_name,email) VALUES (201,'a-1',21,'Advisor','a@example.test'),(202,'a-2',22,'Advisor Two','a2@example.test');
  `);
  const link = db.prepare("INSERT INTO advisor_booking_links(id,uid,advisor_id,slug,audience,is_active) VALUES (?,?,?,?,?,?)");
  link.run(501, 'l-pub', 201, 'ada-office-hours', 'public', 1);
  link.run(502, 'l-coh', 201, 'ada-cohort', 'cohort', 0);
  link.run(503, 'l-other', 202, 'bo-hours', 'public', 1);
  let n = 0;
  const book = (advisor: number, linkId: number | null, status: string, created: string) => {
    n += 1;
    db.prepare('INSERT INTO advisor_office_hour_slots(id,uid,advisor_id,starts_at,ends_at) VALUES (?,?,?,?,?)').run(900 + n, `s-${n}`, advisor, created, created);
    db.prepare('INSERT INTO advisor_bookings(uid,slot_id,advisor_id,founder_user_id,status,booking_link_id,created_at,updated_at) VALUES (?,?,?,11,?,?,?,?)')
      .run(`b-${n}`, 900 + n, advisor, status, linkId, created, created);
  };
  // In the 30-day window, on 21: three on the public link, one cancelled on it, one without a link.
  book(201, 501, 'pending', ago(2)); book(201, 501, 'confirmed', ago(3)); book(201, 501, 'completed', ago(10)); book(201, 501, 'cancelled', ago(5));
  book(201, null, 'confirmed', ago(4));
  // Outside the 30-day window on 21: one on the cohort link 40 days ago.
  book(201, 502, 'confirmed', ago(40));
  // Another advisor's bookings on the same days, one on their own link and one with none.
  book(202, 503, 'confirmed', ago(2)); book(202, null, 'pending', ago(3));
  const art = db.prepare("INSERT INTO articles(slug,title,author_user_id,status,views,published_at) VALUES (?,?,?,?,?,?)");
  art.run('a1', 'One', 21, 'published', 300, ago(60)); art.run('a2', 'Two', 21, 'published', 12, ago(5));
  art.run('a3', 'Draft', 21, 'draft', 999, null); art.run('a4', 'Theirs', 22, 'published', 5000, ago(5));

  const fail = { table: null as null | string };
  const binding = d1Over(db);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: { ...binding, prepare(sql: string) {
    if (fail.table && new RegExp(`FROM ${fail.table}\\b`).test(sql)) {
      const statement: any = { bind: () => statement, all: async () => { throw new Error(`D1_ERROR: synthetic ${fail.table} read failed`); },
        first: async () => { throw new Error(`D1_ERROR: synthetic ${fail.table} read failed`); } };
      return statement;
    }
    return binding.prepare(sql);
  } } };
  const app = new Hono<any>();
  app.route('/api/advisors', advisors);
  const get = async (who: number, query = '') => {
    const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`/api/advisors/me/visibility${query}`, { headers: { Authorization: `Bearer ${jwt}` } }, env);
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text), text };
  };
  return { db, env, get, fail };
}

const surface = (body: any, key: string) => body.surfaces.find((s: any) => s.key === key);

test('requests per link, in the window, on this advisor only; a booking with no link lands in no_link and nowhere else', async () => {
  const { get } = fixture();
  const r = await get(21);
  assert.equal(r.status, 200);
  assert.equal(r.body.window.days, 30);
  assert.deepEqual(r.body.surfaces.map((s: any) => s.key), ['link:l-pub', 'link:l-coh', 'no_link'], 'only this advisor\'s links, then no_link');
  const pub = surface(r.body, 'link:l-pub');
  assert.deepEqual([pub.kind, pub.name, pub.audience, pub.is_active, pub.views], ['booking_link', '/b/ada-office-hours', 'public', true, null]);
  assert.equal(pub.requests, 4);
  assert.deepEqual(pub.by_status, { pending: 1, confirmed: 1, completed: 1, cancelled: 1 });
  const coh = surface(r.body, 'link:l-coh');
  assert.deepEqual([coh.requests, coh.by_status, coh.is_active], [0, {}, false], 'the 40-day-old booking is outside the window: a real zero');
  const none = surface(r.body, 'no_link');
  assert.deepEqual([none.kind, none.name, none.requests, none.by_status, none.note], ['no_link', 'Booked without a link', 1, { confirmed: 1 }, NO_LINK_NOTE]);
  assert.equal(r.body.surfaces.reduce((t: number, s: any) => t + s.requests, 0), 5, 'another advisor\'s two bookings on the same days are never counted');
  assert.equal(r.body.unreadable, false);
});

test('the window: days widens it, and days is clamped to 1–370', async () => {
  const { get } = fixture();
  const wide = await get(21, '?days=60');
  assert.equal(wide.body.window.days, 60);
  assert.equal(surface(wide.body, 'link:l-coh').requests, 1, 'the 40-day-old booking is inside 60 days');
  const narrow = await get(21, '?days=1');
  assert.equal(narrow.body.surfaces.reduce((t: number, s: any) => t + s.requests, 0), 0);
  assert.equal((await get(21, '?days=0')).body.window.days, 1);
  assert.equal((await get(21, '?days=9999')).body.window.days, 370);
  assert.equal((await get(21, '?days=abc')).body.window.days, 30);
  const w = visibilityWindow(7, Date.UTC(2026, 10, 1));
  assert.deepEqual(w, { from: '2026-10-25T00:00:00.000Z', until: '2026-11-01T00:00:00.000Z', days: 7 });
});

test('writing: published pieces and their opens, the caller\'s own; never added to requests', async () => {
  const { get } = fixture();
  const r = await get(21);
  assert.deepEqual(r.body.writing, {
    published: 2, opens: 312, opens_note: OPENS_NOTE,
    requests: null, requests_note: 'A booking does not record which piece led to it.',
  });
  for (const s of r.body.surfaces) assert.ok(s.requests < 312, 'no surface carries the opens');
  assert.equal('reach' in r.body, false);
});

test('views and engagements are always null with their sentences, never a zero', async () => {
  const { get } = fixture();
  for (const who of [21, 22]) {
    const r = await get(who);
    assert.equal(r.body.views, null);
    assert.equal(r.body.views_note, VIEWS_NOTE);
    assert.equal(r.body.engagements, null);
    assert.equal(r.body.engagements_note, ENGAGEMENTS_NOTE);
    for (const s of r.body.surfaces) assert.equal(s.views, null);
  }
});

test('a failed bookings read is null and unreadable, never zeros; writing still reads', async () => {
  const f = fixture();
  f.fail.table = 'advisor_bookings';
  const r = await f.get(21);
  assert.equal(r.status, 200);
  assert.equal(r.body.surfaces, null);
  assert.equal(r.body.unreadable, true);
  assert.equal(r.body.writing.opens, 312);
  assert.doesNotMatch(r.text, /synthetic/);
  f.fail.table = 'advisor_booking_links';
  assert.equal((await f.get(21)).body.surfaces, null, 'a failed links read too');
});

test('a failed articles read makes writing null and unreadable; the surfaces still read', async () => {
  const f = fixture();
  f.fail.table = 'articles';
  const r = await f.get(21);
  assert.equal(r.body.writing, null);
  assert.equal(r.body.unreadable, true);
  assert.equal(surface(r.body, 'link:l-pub').requests, 4);
  assert.doesNotMatch(r.text, /synthetic/);
});

test('a founder, partner or Explorer is refused; an advisor with no profile gets the existing refusal', async () => {
  const { get } = fixture();
  for (const who of [11, 31, 41]) assert.equal((await get(who)).status, 403, `user ${who}`);
  const none = await get(23);
  assert.notEqual(none.status, 200);
  assert.doesNotMatch(none.text, /surfaces/);
});
