/**
 * D574 part 2 — the Wellbeing gaps that need no migration.
 *
 *   · an expert's active services, shown to members on the directory and the
 *     profile;
 *   · the service on a booking, both sides;
 *   · slots cut from the expert's weekly grid, each window in its own zone,
 *     and a booking refused at a time the grid does not offer;
 *   · a member's own rating, read back;
 *   · a member cancelling their own open, unpaid, future booking;
 *   · whether a check-in was stored encrypted.
 *
 * The real router on node:sqlite. The expert tables are the baseline's own
 * DDL, so the columns are production's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import wellbeing, { submitCanonicalCheckin } from '../src/routes/wellbeing.ts';
import { gridSlots, zonedToUtc, offeredSlots } from '../src/services/wellbeing/slots.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MEMBER = 1, OTHER = 2, EXPERT_USER = 3;
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const ddl = (name: string) => {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is not in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
};

function setup() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, email TEXT, name TEXT,
             is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, subscription_tier TEXT, subscription_status TEXT);
           CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT, body TEXT, link TEXT, payload TEXT, created_at TEXT);`);
  for (const t of ['experts', 'expert_services', 'expert_availability', 'expert_bookings', 'expert_ratings', 'expert_profile_views']) db.exec(ddl(t));
  const u = db.prepare('INSERT INTO users (id, role, email, name, subscription_tier) VALUES (?, ?, ?, ?, ?)');
  u.run(MEMBER, 'founder', 'm@example.test', 'Mia Member', 'growth');
  u.run(OTHER, 'founder', 'o@example.test', 'Otto Other', 'growth');
  u.run(EXPERT_USER, 'advisor', 'e@example.test', 'Eve Expert', 'growth');
  db.prepare(`INSERT INTO experts (uid, user_id, name, is_active, verified, profile_completion_pct, timezones_json, categories_json, languages_json)
              VALUES ('exp1', ?, 'Eve Expert', 1, 1, 90, '["Europe/Paris"]', '["coaching"]', '["en"]')`).run(EXPERT_USER);
  const s = db.prepare(`INSERT INTO expert_services (uid, expert_id, title, duration_minutes, price_cents, currency, is_active, sort_order) VALUES (?, 1, ?, ?, ?, 'usd', ?, ?)`);
  s.run('svc-b', 'Deep dive', 60, 0, 1, 2);
  s.run('svc-a', 'Intro call', 30, 0, 1, 1);
  s.run('svc-off', 'Retired', 30, 0, 0, 0);
  return db;
}
const envOf = (db: any) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) }) as any;
async function call(e: any, method: string, path: string, who: number, body?: unknown) {
  const tok = await new SignJWT({ user_id: who, role: who === EXPERT_USER ? 'advisor' : 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await wellbeing.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, e);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, er = console.error, i = console.info, l = console.log;
  console.warn = () => {}; console.error = () => {}; console.info = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = er; console.info = i; console.log = l; }
};

test('a member sees the expert\'s active services, in order, on the profile and the directory', async () => {
  const db = setup(); const e = envOf(db);
  const one = await quiet(() => call(e, 'GET', '/experts/exp1', MEMBER));
  assert.equal(one.status, 200);
  assert.deepEqual(one.body.services.map((x: any) => [x.uid, x.title, x.duration_minutes]),
    [['svc-a', 'Intro call', 30], ['svc-b', 'Deep dive', 60]]);
  assert.ok(!('id' in one.body.services[0]) && !('expert_id' in one.body.services[0]), 'a row id reached the member');
  const dir = await quiet(() => call(e, 'GET', '/experts?limit=50', MEMBER));
  const listed = dir.body.matches.find((m: any) => m.uid === 'exp1');
  assert.deepEqual(listed?.services.map((x: any) => x.uid), ['svc-a', 'svc-b']);
});

test('a member\'s own rating is read back, and never another member\'s', async () => {
  const db = setup(); const e = envOf(db);
  assert.equal((await quiet(() => call(e, 'GET', '/experts/exp1', MEMBER))).body.my_rating, null);
  const rated = await quiet(() => call(e, 'POST', '/experts/exp1/rate', MEMBER, { stars: 4, review: 'Clear' }));
  assert.equal(rated.status, 200);
  assert.equal(rated.body.my_rating.stars, 4);
  assert.equal((await quiet(() => call(e, 'GET', '/experts/exp1', MEMBER))).body.my_rating.stars, 4);
  assert.equal((await quiet(() => call(e, 'GET', '/experts/exp1', OTHER))).body.my_rating, null);
  await quiet(() => call(e, 'POST', '/experts/exp1/rate', MEMBER, { stars: 2 }));
  assert.equal((await quiet(() => call(e, 'GET', '/experts/exp1', MEMBER))).body.my_rating.stars, 2, 'rating again replaces it');
});

test('slots: a window is read in its own zone, a skipped wall time is not offered, and no grid says default hours', () => {
  const now = new Date('2026-10-06T12:00:00Z'); // a Tuesday
  assert.deepEqual(gridSlots([{ day_of_week: 1, start_minute: 9 * 60, end_minute: 10 * 60, timezone: 'Europe/Paris' }], now).slice(0, 2),
    ['2026-10-12T07:00:00.000Z', '2026-10-12T07:30:00.000Z'], 'Paris 09:00 in October is 07:00 UTC');
  assert.equal(gridSlots([{ day_of_week: 3, start_minute: 9 * 60, end_minute: 9 * 60 + 30, timezone: 'America/New_York' }], now)[0],
    '2026-10-07T13:00:00.000Z');
  assert.equal(zonedToUtc(2026, 3, 29, 150, 'Europe/Paris'), null, '02:30 does not exist the night Paris moves forward');
  assert.equal(offeredSlots([], now).source, 'default_hours');
  assert.equal(offeredSlots([{ day_of_week: 1, start_minute: 540, end_minute: 600, timezone: 'UTC' }], now).source, 'grid');
});

test('the slots route offers the grid, and a booking outside it is refused', async () => {
  const db = setup(); const e = envOf(db);
  db.prepare(`INSERT INTO expert_availability (expert_id, day_of_week, start_minute, end_minute, timezone) VALUES (1, ?, 540, 600, 'UTC')`)
    .run(new Date(Date.now() + 2 * 86_400_000).getUTCDay());
  const slots = await quiet(() => call(e, 'GET', '/experts/exp1/slots', MEMBER));
  assert.equal(slots.body.source, 'grid');
  assert.ok(slots.body.slots.length >= 2);
  assert.ok(slots.body.slots.every((s: string) => /T09:(00|30):00\.000Z$/.test(s)), 'a slot outside 09:00–10:00 UTC was offered');

  const outside = new Date(slots.body.slots[0]); outside.setUTCHours(15);
  const refused = await quiet(() => call(e, 'POST', '/experts/exp1/book', MEMBER, { scheduled_at: outside.toISOString() }));
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'slot_not_offered');
  const booked = await quiet(() => call(e, 'POST', '/experts/exp1/book', MEMBER, { scheduled_at: slots.body.slots[0], service_uid: 'svc-a' }));
  assert.ok(booked.status < 300, `an offered slot was refused (${booked.status})`);
  const after = await quiet(() => call(e, 'GET', '/experts/exp1/slots', MEMBER));
  assert.ok(!after.body.slots.includes(slots.body.slots[0]), 'a booked slot was still offered');
});

test('a booking carries its service, to the member and to the expert', async () => {
  const db = setup(); const e = envOf(db);
  const slots = await quiet(() => call(e, 'GET', '/experts/exp1/slots', MEMBER));
  assert.equal(slots.body.source, 'default_hours');
  await quiet(() => call(e, 'POST', '/experts/exp1/book', MEMBER, { scheduled_at: slots.body.slots[0], service_uid: 'svc-b' }));
  const mine = await quiet(() => call(e, 'GET', '/bookings/mine', MEMBER));
  assert.equal(mine.body.bookings[0].service_uid, 'svc-b');
  assert.equal(mine.body.bookings[0].service_title, 'Deep dive');
  const theirs = await quiet(() => call(e, 'GET', '/experts/me/bookings', EXPERT_USER));
  assert.equal(theirs.body.bookings[0].service_title, 'Deep dive');
  assert.ok(!('my_stars' in theirs.body.bookings[0]), 'the expert read a member\'s rating off the booking');
  assert.equal(mine.body.bookings[0].my_stars, null, 'no rating given yet');
  await quiet(() => call(e, 'POST', '/experts/exp1/rate', MEMBER, { stars: 5 }));
  await quiet(() => call(e, 'POST', '/experts/exp1/rate', OTHER, { stars: 1 }));
  const rated = await quiet(() => call(e, 'GET', '/bookings/mine', MEMBER));
  assert.equal(rated.body.bookings.length, 1, 'another member\'s rating duplicated the booking');
  assert.equal(rated.body.bookings[0].my_stars, 5, 'the member\'s own rating rides on their booking');
});

test('a member cancels their own open, unpaid, future booking, and nothing else', async () => {
  const db = setup(); const e = envOf(db);
  const ins = db.prepare(`INSERT INTO expert_bookings (uid, expert_id, user_id, scheduled_at, status, payment_status) VALUES (?, 1, ?, ?, ?, ?)`);
  const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
  ins.run('b-open', MEMBER, future, 'scheduled', 'free');
  ins.run('b-paid', MEMBER, future, 'confirmed', 'paid');
  ins.run('b-past', MEMBER, new Date(Date.now() - 3_600_000).toISOString(), 'scheduled', 'free');
  ins.run('b-done', MEMBER, future, 'completed', 'free');

  assert.equal((await quiet(() => call(e, 'POST', '/bookings/b-open/cancel', OTHER))).status, 404, 'another member cancelled it');
  const ok = await quiet(() => call(e, 'POST', '/bookings/b-open/cancel', MEMBER));
  assert.equal(ok.status, 200);
  assert.equal((db.prepare(`SELECT status FROM expert_bookings WHERE uid = 'b-open'`).get() as any).status, 'cancelled');
  const again = await quiet(() => call(e, 'POST', '/bookings/b-open/cancel', MEMBER));
  assert.equal(again.body.error, 'booking_not_open');
  assert.equal((await quiet(() => call(e, 'POST', '/bookings/b-paid/cancel', MEMBER))).body.error, 'paid_booking');
  assert.equal((await quiet(() => call(e, 'POST', '/bookings/b-past/cancel', MEMBER))).body.error, 'booking_started');
  assert.equal((await quiet(() => call(e, 'POST', '/bookings/b-done/cancel', MEMBER))).body.error, 'booking_not_open');
  const left = db.prepare(`SELECT uid, status FROM expert_bookings WHERE uid != 'b-open' ORDER BY uid`).all().map((r: any) => r.status);
  assert.deepEqual(left, ['completed', 'confirmed', 'scheduled'], 'a refused cancel changed a booking');
});

test('a check-in says whether it was stored encrypted', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(ddl('wellbeing_daily_pulses'));
  for (const col of ['mood_plain INTEGER', 'stress_plain INTEGER', 'sleep_plain INTEGER', 'energy_plain INTEGER', 'focus_plain INTEGER', 'social_plain INTEGER', 'free_text_plain TEXT', 'tags_plain TEXT']) {
    try { db.exec(`ALTER TABLE wellbeing_daily_pulses ADD COLUMN ${col}`); } catch { /* the baseline has it */ }
  }
  const enc = await quiet(() => submitCanonicalCheckin({ DB: d1Over(db), AXAL_ENCRYPTION_SECRET: 'k'.repeat(48), JWT_SECRET } as any, MEMBER, { mood: 4 }));
  assert.equal(enc.status, 201);
  assert.equal((enc.body as any).stored_encrypted, true);
  const plain = await quiet(() => submitCanonicalCheckin({ DB: d1Over(db) } as any, OTHER, { mood: 3 }));
  assert.equal(plain.status, 201);
  assert.equal((plain.body as any).stored_encrypted, false, 'a plaintext backstop save claimed encryption');
});
