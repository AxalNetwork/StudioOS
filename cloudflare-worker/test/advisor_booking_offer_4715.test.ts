/**
 * #4715 — a booking keeps the exact offer it was made on: the session type's
 * name, length, pricing mode and price, copied when the booking is written.
 * A later rename, reprice or length change of the type rewrites nothing
 * already booked; a re-booking of a cancelled slot takes the terms of the
 * moment it is made.
 *
 * On the migrated schema, synthetic rows only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor_booking_offer_4715.test.ts
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
const DAY = 86_400_000;
// One clock read for the whole file: two reads a few ms apart made a 45-minute slot 45 min and some ms long.
const NOW = Date.now();
const at = (days: number, minutes = 0) => new Date(NOW + days * DAY + minutes * 60_000).toISOString();

// 11 a founder; 21 the advisor (row 201). Session types: 301 priced 45 min,
// 302 a free intro (with a leftover price, which the offer must not carry), 303 included.
function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active,subscription_tier) VALUES
      (11,'Founder','f@example.test','founder',101,1,'studio'),
      (21,'Advisor','a@example.test','advisor',NULL,1,'studio');
    INSERT INTO advisors(id,uid,user_id,display_name,email,is_active,hourly_rate_usd) VALUES (201,'a-1',21,'Advisor','a@example.test',1,400);
    UPDATE users SET advisor_id = 201 WHERE id = 21;
    INSERT INTO advisor_session_types(id,uid,advisor_id,name,duration_minutes,price_cents,is_free_intro,is_included,is_active,cadence_note) VALUES
      (301,'t-1',201,'Strategy call',45,15000,0,0,1,'One-off'),
      (302,'t-2',201,'Intro',30,5000,1,0,1,NULL),
      (303,'t-3',201,'Cohort office hour',60,NULL,0,1,1,NULL);
  `);
  const slot = db.prepare('INSERT INTO advisor_office_hour_slots(id,uid,advisor_id,starts_at,ends_at,capacity) VALUES (?,?,?,?,?,1)');
  slot.run(1, 's-1', 201, at(3), at(3, 45));
  slot.run(2, 's-2', 201, at(4), at(4, 30));
  slot.run(3, 's-3', 201, at(5), at(5, 60));
  slot.run(4, 's-4', 201, at(6), at(6, 45));
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const ctx: any = { waitUntil() {}, passThroughOnException() {}, props: {} };
  const app = new Hono<any>();
  app.route('/api/advisors', advisors);
  const call = async (path: string, who: number, method = 'GET', body?: unknown) => {
    const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`/api/advisors${path}`, {
      method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env, ctx);
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) as any }; } catch { throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`); }
  };
  return { db, call };
}

const STRATEGY = { session_type_id: 301, name: 'Strategy call', duration_minutes: 45, pricing: 'price', price_cents: 15000, cadence_note: 'One-off' };

test('a booking carries the offer it was made on, in the response and in both parties’ lists', async () => {
  const f = fixture();
  const r = await f.call('/slots/1/book', 11, 'POST', { topic: 'Pricing', session_type_id: 301 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.offer, STRATEGY);
  const mine = (await f.call('/bookings/me', 11)).body.items;
  assert.deepEqual(mine.find((b: any) => b.id === r.body.id).offer, STRATEGY);
  const theirs = (await f.call('/me/bookings', 21)).body.items;
  assert.deepEqual(theirs.find((b: any) => b.id === r.body.id).offer, STRATEGY);
});

test('renaming, repricing or retiming the type afterwards rewrites nothing already booked', async () => {
  const f = fixture();
  const r = await f.call('/slots/1/book', 11, 'POST', { topic: 'Pricing', session_type_id: 301 });
  f.db.exec("UPDATE advisor_session_types SET name = 'Deep dive', price_cents = 30000, duration_minutes = 90 WHERE id = 301");
  const mine = (await f.call('/bookings/me', 11)).body.items;
  assert.deepEqual(mine.find((b: any) => b.id === r.body.id).offer, STRATEGY);
});

test('free intro and included offers keep their mode and no price', async () => {
  const f = fixture();
  const free = await f.call('/slots/2/book', 11, 'POST', { topic: 'Hello', session_type_id: 302 });
  assert.equal(free.status, 200, JSON.stringify(free.body));
  assert.equal(free.body.offer.pricing, 'free');
  assert.equal(free.body.offer.price_cents, null);
  const incl = await f.call('/slots/3/book', 11, 'POST', { topic: 'Cohort', session_type_id: 303 });
  assert.equal(incl.status, 200, JSON.stringify(incl.body));
  assert.equal(incl.body.offer.pricing, 'included');
  assert.equal(incl.body.offer.name, 'Cohort office hour');
});

test('a booking with no session type records no offer', async () => {
  const f = fixture();
  const r = await f.call('/slots/4/book', 11, 'POST', { topic: 'General' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.offer, null);
});

test('re-booking a cancelled slot takes the offer as it is at the new booking', async () => {
  const f = fixture();
  const first = await f.call('/slots/1/book', 11, 'POST', { topic: 'Pricing', session_type_id: 301 });
  assert.equal((await f.call(`/bookings/${first.body.id}/cancel`, 11, 'POST', {})).status, 200);
  f.db.exec("UPDATE advisor_session_types SET name = 'Strategy call v2', price_cents = 20000 WHERE id = 301");
  const again = await f.call('/slots/1/book', 11, 'POST', { topic: 'Pricing', session_type_id: 301 });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.offer.name, 'Strategy call v2');
  assert.equal(again.body.offer.price_cents, 20000);
});
