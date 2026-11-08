// D4687 (#4687): the Practice journey through the REAL Worker, not the advisors
// router alone. `GET /api/advisors/me/slots` was registered after
// `GET /:uid/slots`, so Hono answered it with uid='me' and a 404; the isolated
// handler tests could not see that, because they never put the two in one
// ordering question. These requests go through `worker.fetch`, so the mount
// order index.ts and the route registry produce is the order under test.
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/practice_journey_4687.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memKV } from './_mem_kv.mjs';

const { default: worker } = await import('../src/index.ts');
const advisorsSrc = readFileSync(new URL('../src/routes/advisors.ts', import.meta.url), 'utf8');

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADVISOR_USER = 70;
const FOUNDER_USER = 72;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) {
      const out = [];
      for (const st of x || []) out.push(await st.run().catch(() => ({})));
      return out;
    },
  };
}

const migration = (name: string) => readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, advisor_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT, subscription_tier TEXT DEFAULT 'studio'
    );
    -- D683: advisor booking is on the Raise + Grow plan (studio), so the
    -- founders here hold it; this file pins attribution, not the paywall.
    -- advisor_office_hour_slots and advisor_bookings in the LIVE (t13) shape:
    -- scripts/sqlite-table-collisions-baseline.json records that schema.sql's
    -- six-column advisor_bookings is the dead one, because the booking flow
    -- works and it writes advisor_id / founder_user_id.
    CREATE TABLE advisor_office_hour_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      advisor_id INTEGER NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 1, meeting_url TEXT, notes TEXT,
      is_cancelled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE advisor_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      slot_id INTEGER NOT NULL, advisor_id INTEGER NOT NULL,
      founder_user_id INTEGER NOT NULL, topic TEXT, notes TEXT,
      status TEXT NOT NULL DEFAULT 'pending', cancel_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (slot_id, founder_user_id)
    );
    -- Verbatim from sql/historical/t13_t14_t15.sql:69. Present because
    -- GET /bookings/:id/reviews is read here, and a read whose ownership
    -- check is the thing under test has to be able to return a row.
    CREATE TABLE advisor_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      booking_id INTEGER NOT NULL, reviewer_user_id INTEGER NOT NULL,
      reviewer_role TEXT NOT NULL, rating INTEGER NOT NULL, comment TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (booking_id, reviewer_role)
    );
  `);
  // The new schema comes from the migration files verbatim. If one of them
  // stops parsing, these tests stop running — which is the point.
  db.exec(migration('201_advisors_table_in_ledger'));
  db.exec(migration('202_advisor_profile_fields'));
  db.exec(migration('203_advisor_services'));
  db.exec(migration('204_advisor_proof'));
  db.exec(migration('205_advisor_booking_amounts'));
  db.exec(migration('206_advisor_cohort_assignments'));
  // 241 — `PATCH /me/bookings/:id/billing` now stamps `platform_cut_cents`
  // and `take_rate_bps` beside the amount, and reads the rate out of
  // `platform_settings`. A fixture that stopped at 205 made every price write
  // in this file fail on a missing column, which is the fixture being stale
  // rather than the route being wrong — the tests below assert 205's
  // behaviour and still do.
  db.exec(migration('241_advisor_money_model'));
  db.exec(migration('369_advisor_client_notes'));
  db.exec(migration('238_advisor_engagements'));
  db.exec(migration('239_advisor_deliverables'));
  db.exec(migration('202611062152_advisor_deliverable_recipients'));
  db.exec(migration('240_advisor_sessions_config'));
  db.exec(migration('218_advisor_client_grants'));
  db.exec(migration('394_advisor_practice'));
  const activitySchema = readFileSync(`${SQL}/schema_baseline.sql`, 'utf8')
    .match(/CREATE TABLE activity_logs\s*\([\s\S]*?\);/)?.[0];
  if (!activitySchema) throw new Error('Activity schema not found');
  db.exec(activitySchema);

  db.exec('CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT); CREATE TABLE research_documents (id INTEGER PRIMARY KEY, uid TEXT, title TEXT)');
  const u = db.prepare('INSERT INTO users (id, role, advisor_id, name, email) VALUES (?,?,?,?,?)');
  u.run(ADVISOR_USER, 'advisor', 1, 'Ada', 'ada@example.test');
  u.run(FOUNDER_USER, 'founder', null, 'Fran', 'fran@example.test');
  db.prepare('INSERT INTO advisors (id, uid, user_id, display_name, email) VALUES (?,?,?,?,?)')
    .run(1, 'adv-1', ADVISOR_USER, 'Ada', 'ada@example.test');
  return db;
}

const ctx: any = { waitUntil() {}, passThroughOnException() {} };
async function call(db: DatabaseSync, method: string, path: string, user: number, role: string, body?: any) {
  const e: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), RATE_LIMITS: memKV(), TOKENS: memKV() };
  const tok = await new SignJWT({ user_id: user, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  const init: any = { method, headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const quiet = [console.warn, console.error, console.log];
  console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await worker.fetch(new Request(`https://axal.vc${path}`, init), e, ctx);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, console.log] = quiet as any; }
}
const adv = (db: DatabaseSync, m: string, p: string, b?: any) => call(db, m, p, ADVISOR_USER, 'advisor', b);
const fou = (db: DatabaseSync, m: string, p: string, b?: any) => call(db, m, p, FOUNDER_USER, 'founder', b);

test('registration order: the owner calendar is registered before GET /:uid/slots', () => {
  const own = advisorsSrc.indexOf("advisors.get('/me/slots'");
  const pub = advisorsSrc.indexOf("advisors.get('/:uid/slots'");
  assert.ok(own > 0 && pub > 0);
  assert.ok(own < pub, 'GET /me/slots must precede GET /:uid/slots');
});

test('the journey through the mounted Worker: publish, calendar, request, confirm, complete, history, review', async () => {
  const db = freshDb();
  const starts = new Date(Date.now() + 3 * 86400000).toISOString();
  const ends = new Date(Date.now() + 3 * 86400000 + 3600000).toISOString();

  const made = await adv(db, 'POST', '/api/advisors/me/slots', { starts_at: starts, ends_at: ends, capacity: 1 });
  assert.equal(made.status, 200, JSON.stringify(made.body));

  // THE COLLISION: this was 404 'Advisor not found' (uid = 'me').
  const cal = await adv(db, 'GET', '/api/advisors/me/slots');
  assert.equal(cal.status, 200, JSON.stringify(cal.body));
  assert.equal(cal.body.items.length, 1);
  assert.ok('recording_state' in cal.body.items[0], 'the owner shape, not the public one');
  assert.ok(cal.body.window, 'the owner handler answered');

  // The public read keeps the lean shape for another advisor's uid.
  const pub = await fou(db, 'GET', '/api/advisors/adv-1/slots');
  assert.equal(pub.status, 200);
  assert.ok(!('recording_state' in pub.body.items[0]));

  const slotId = made.body.id;
  const booked = await fou(db, 'POST', `/api/advisors/slots/${slotId}/book`, { topic: 'First call' });
  assert.ok([200, 201].includes(booked.status), JSON.stringify(booked.body));
  const bookingId = booked.body.id;

  const pending = await adv(db, 'GET', '/api/advisors/me/bookings');
  assert.equal(pending.body.items.find((b: any) => b.id === bookingId).status, 'pending');

  assert.equal((await adv(db, 'POST', `/api/advisors/bookings/${bookingId}/confirm`)).status, 200);
  assert.equal((await adv(db, 'POST', `/api/advisors/bookings/${bookingId}/complete`)).status, 200);

  // After a reload: history says completed, and the founder may now review it.
  const after = await adv(db, 'GET', '/api/advisors/me/bookings?status=completed');
  assert.deepEqual(after.body.items.map((b: any) => b.status), ['completed']);
  const review = await adv(db, 'POST', `/api/advisors/bookings/${bookingId}/review`, { rating: 5, comment: 'Prepared' });
  assert.equal(review.status, 200, JSON.stringify(review.body));
  const reviews = await adv(db, 'GET', `/api/advisors/bookings/${bookingId}/reviews`);
  assert.equal(reviews.body.items.length, 1);
});

test('no-show and cancel are reachable and recorded', async () => {
  const db = freshDb();
  const mk = async (day: number) => (await adv(db, 'POST', '/api/advisors/me/slots', {
    starts_at: new Date(Date.now() + day * 86400000).toISOString(),
    ends_at: new Date(Date.now() + day * 86400000 + 3600000).toISOString(), capacity: 1,
  })).body.id;
  const s1 = await mk(2); const s2 = await mk(4);
  const b1 = (await fou(db, 'POST', `/api/advisors/slots/${s1}/book`, { topic: 'A' })).body.id;
  assert.equal((await adv(db, 'POST', `/api/advisors/bookings/${b1}/confirm`)).status, 200);
  assert.equal((await adv(db, 'POST', `/api/advisors/bookings/${b1}/no-show`, { reason: 'Did not join' })).status, 200);
  const b2 = (await fou(db, 'POST', `/api/advisors/slots/${s2}/book`, { topic: 'B' })).body.id;
  assert.equal((await adv(db, 'POST', `/api/advisors/bookings/${b2}/confirm`)).status, 200);
  assert.equal((await adv(db, 'POST', `/api/advisors/bookings/${b2}/cancel`, { reason: 'Conflict' })).status, 200);
  const all = await adv(db, 'GET', '/api/advisors/me/bookings');
  const by = Object.fromEntries(all.body.items.map((b: any) => [b.id, b.status]));
  assert.equal(by[b1], 'no_show');
  assert.equal(by[b2], 'cancelled');
});
