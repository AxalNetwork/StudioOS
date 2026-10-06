/** D573: real router and migration 394, with synthetic fixtures only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import advisors from '../src/routes/advisors.ts';
import { Hono } from 'hono';
import { rateLimitMiddleware } from '../src/middleware/rateLimit.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADVISOR_USER = 70;
const OTHER_ADVISOR_USER = 71;
const FOUNDER_USER = 72;
const ADMIN_USER = 73;
// A founder with no part in any booking — the reader the reviews endpoint
// used to answer, and the reason `grace` alone is not enough of a test: an
// advisor missing the advisor half of the predicate and a founder missing the
// founder half are two different ways for the WHERE clause to be wrong.
const OUTSIDER_USER = 74;
const CYCLE = 9;
const OTHER_CYCLE = 10;

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
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT, subscription_tier TEXT DEFAULT 'growth'
    );
    CREATE TABLE cohort_cycles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER NOT NULL, month INTEGER NOT NULL,
      start_at TEXT NOT NULL, end_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled'
    );
    CREATE TABLE week_windows (
      id INTEGER PRIMARY KEY AUTOINCREMENT, cohort_cycle_id INTEGER NOT NULL,
      week_number INTEGER NOT NULL, unlock_at TEXT NOT NULL, deadline_at TEXT NOT NULL,
      UNIQUE(cohort_cycle_id, week_number)
    );
    CREATE TABLE company_week_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      cohort_cycle_id INTEGER NOT NULL, week_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      deliverables_done INTEGER NOT NULL DEFAULT 0,
      deliverables_required INTEGER NOT NULL DEFAULT 0
    );
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
  db.exec(migration('240_advisor_sessions_config'));
  db.exec(migration('218_advisor_client_grants'));
  db.exec(migration('394_advisor_practice'));
  const activitySchema = readFileSync(`${SQL}/schema_baseline.sql`, 'utf8')
    .match(/CREATE TABLE activity_logs\s*\([\s\S]*?\);/)?.[0];
  if (!activitySchema) throw new Error('Activity schema not found');
  db.exec(activitySchema);
  db.exec('CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT); CREATE TABLE research_documents (id INTEGER PRIMARY KEY, uid TEXT, title TEXT)');

  const u = db.prepare('INSERT INTO users (id, role, advisor_id, name, email) VALUES (?,?,?,?,?)');
  u.run(ADVISOR_USER, 'advisor', 1, 'Ada', 'ada@example.com');
  u.run(OTHER_ADVISOR_USER, 'advisor', 2, 'Grace', 'grace@example.com');
  u.run(FOUNDER_USER, 'founder', null, 'Fran', 'fran@example.com');
  u.run(ADMIN_USER, 'admin', null, 'Root', 'root@example.com');
  u.run(OUTSIDER_USER, 'founder', null, 'Otto', 'otto@example.com');

  const a = db.prepare(
    'INSERT INTO advisors (id, uid, user_id, display_name, email) VALUES (?,?,?,?,?)');
  a.run(1, 'adv-1', ADVISOR_USER, 'Ada', 'ada@example.com');
  a.run(2, 'adv-2', OTHER_ADVISOR_USER, 'Grace', 'grace@example.com');

  const cy = db.prepare(
    'INSERT INTO cohort_cycles (id, year, month, start_at, end_at, status) VALUES (?,?,?,?,?,?)');
  cy.run(CYCLE, 2026, 9, '2026-09-01T04:00:00Z', '2026-09-29T04:00:00Z', 'active');
  cy.run(OTHER_CYCLE, 2026, 10, '2026-10-01T04:00:00Z', '2026-10-29T04:00:00Z', 'scheduled');

  const w = db.prepare(
    'INSERT INTO company_week_status (user_id, cohort_cycle_id, week_number) VALUES (?,?,?)');
  w.run(FOUNDER_USER, CYCLE, 1);
  w.run(FOUNDER_USER, CYCLE, 2);   // same founder twice — DISTINCT must collapse it
  w.run(ADVISOR_USER, OTHER_CYCLE, 1);

  // Two windows already unlocked, two still ahead — so `current_week` has a
  // real answer to compute rather than a trivial one.
  const past = new Date(Date.now() - 86400000).toISOString();
  const future = new Date(Date.now() + 86400000).toISOString();
  const ww = db.prepare(
    'INSERT INTO week_windows (cohort_cycle_id, week_number, unlock_at, deadline_at) VALUES (?,?,?,?)');
  ww.run(CYCLE, 1, past, past);
  ww.run(CYCLE, 2, past, future);
  ww.run(CYCLE, 3, future, future);

  return db;
}

function env(db: InstanceType<typeof DatabaseSync>) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) };
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  e: any, method: string, path: string, who: { user: number; role: string }, body?: any,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    (init as any).body = JSON.stringify(body);
  }
  // The fourth argument is the ExecutionContext. Without it Hono's
  // `c.executionCtx` getter THROWS rather than returning undefined, so
  // `c.executionCtx?.waitUntil` — the guard the cancel and booking paths use
  // to defer their calendar-sync hooks — turns into a 500 in tests and only
  // in tests. Production always has one; passing a no-op here means these
  // tests exercise the same branch production does.
  const res = await advisors.request(path, init, e, {
    waitUntil() {}, passThroughOnException() {},
  } as any);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const ada = { user: ADVISOR_USER, role: 'advisor' };
const grace = { user: OTHER_ADVISOR_USER, role: 'advisor' };
const fran = { user: FOUNDER_USER, role: 'founder' };
const otto = { user: OUTSIDER_USER, role: 'founder' };

function seed(db: InstanceType<typeof DatabaseSync>) {
  db.prepare(`INSERT INTO advisor_session_types (id, uid, advisor_id, name, duration_minutes, price_cents, is_included)
    VALUES (1, 'type-one', 1, 'Practice session', 60, 0, 1), (2, 'type-two', 2, 'Other session', 60, 5000, 0)`).run();
  db.prepare(`INSERT INTO advisor_booking_links (id, uid, advisor_id, slug, session_type_id)
    VALUES (1, 'link-one', 1, 'ada/practice', 1), (2, 'link-two', 2, 'grace/practice', 2)`).run();
  db.prepare(`INSERT INTO advisor_office_hour_slots (id, uid, advisor_id, starts_at, ends_at, capacity)
    VALUES (1, 'future-one', 1, '2037-01-01T10:00:00Z', '2037-01-01T11:00:00Z', 5),
    (2, 'future-two', 2, '2037-01-01T10:00:00Z', '2037-01-01T11:00:00Z', 5),
    (3, 'future-three', 1, '2037-01-02T10:00:00Z', '2037-01-02T11:00:00Z', 5)`).run();
}
async function anonymous(e: any, path: string, body?: any) {
  const r = await advisors.request(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, e, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: r.status, body: await r.json() };
}

test('D573: migration preserves unknown legacy facts and the public profile publishes only public active links', async () => {
  const db = freshDb(); try {
    seed(db); const e = env(db);
    db.exec("UPDATE advisor_booking_links SET audience = 'private' WHERE id = 2");
    const r = await anonymous(e, '/adv-1');
    assert.deepEqual([r.status, r.body.display_name, r.body.session_types[0].is_included,
      r.body.booking_links.map((l: any) => l.slug)], [200, 'Ada', true, ['ada/practice']]);
    assert.equal(['email', 'user_id', 'id'].some(k => k in r.body), false);
    assert.equal(db.prepare('SELECT opens_count FROM advisor_booking_links WHERE id = 1').get()?.opens_count, null);
    db.exec("UPDATE advisor_booking_links SET audience = 'private' WHERE id = 1; UPDATE advisor_session_types SET is_active = 0 WHERE id = 1");
    const hidden = await anonymous(e, '/adv-1');
    assert.deepEqual([hidden.body.session_types, hidden.body.booking_links], [[], []]);
  } finally { db.close(); }
});

test('D573: a public link opens its type, records accepted requests and refuses disabled or unpriced types', async () => {
  const db = freshDb(); try {
    seed(db); const e = env(db);
    const opened = await anonymous(e, '/booking-links/open', { slug: 'ada/practice' });
    assert.deepEqual([opened.status, opened.body.session_type.id,
      db.prepare('SELECT opens_count FROM advisor_booking_links WHERE id = 1').get()?.opens_count], [200, 1, 1]);
    db.exec('UPDATE advisor_session_types SET is_active = 0 WHERE id = 1');
    const off = await anonymous(e, '/booking-links/open', { slug: 'ada/practice' });
    db.exec('UPDATE advisor_session_types SET is_active = 1, is_included = 0, price_cents = NULL WHERE id = 1');
    const unpriced = await anonymous(e, '/booking-links/open', { slug: 'ada/practice' });
    db.exec('UPDATE advisor_booking_links SET is_active = 0 WHERE id = 1');
    const disabled = await anonymous(e, '/booking-links/open', { slug: 'ada/practice' });
    assert.deepEqual([off.status, unpriced.status, disabled.status,
      db.prepare('SELECT opens_count FROM advisor_booking_links WHERE id = 1').get()?.opens_count], [409, 409, 404, 1]);
  } finally { db.close(); }
});

test('D573: cohort links require recorded membership and payout-required links refuse an unverified account', async () => {
  const db = freshDb(); try {
    seed(db); const e = env(db);
    db.prepare("UPDATE advisor_booking_links SET audience = 'cohort', cohort_ref = ? WHERE id = 1").run(String(CYCLE));
    const outside = await anonymous(e, '/booking-links/open', { slug: 'ada/practice' });
    const member = await call(e, 'POST', '/booking-links/open', fran, { slug: 'ada/practice' });
    db.exec('UPDATE advisor_booking_links SET requires_payout_account = 1 WHERE id = 1');
    const blocked = await call(e, 'POST', '/booking-links/open', fran, { slug: 'ada/practice' });
    assert.deepEqual([outside.status, member.status, blocked.status], [404, 200, 409]);
  } finally { db.close(); }
});

test('D573: booking attribution reaches counts, stays scoped and honors the type and link switches', async () => {
  const db = freshDb(); try {
    seed(db); const e = env(db);
    const foreign = await call(e, 'POST', '/slots/2/book', fran, { booking_link_slug: 'ada/practice' });
    const mismatch = await call(e, 'POST', '/slots/1/book', fran, { booking_link_slug: 'ada/practice', session_type_id: 2 });
    const booked = await call(e, 'POST', '/slots/1/book', fran, { booking_link_slug: 'ada/practice', topic: 'Product' });
    const types = await call(e, 'GET', '/me/session-types', ada);
    const links = await call(e, 'GET', '/me/booking-links', ada);
    assert.deepEqual([foreign.status, mismatch.status, booked.status, booked.body.session_type_id,
      booked.body.booking_link_id, types.body.items[0].booking_count, links.body.items[0].booking_count], [404, 400, 200, 1, 1, 1, 1]);
    db.exec('UPDATE advisor_session_types SET is_active = 0 WHERE id = 1');
    const off = await call(e, 'POST', '/slots/3/book', fran, { session_type_id: 1 });
    db.exec('UPDATE advisor_session_types SET is_active = 1 WHERE id = 1; UPDATE advisor_booking_links SET is_active = 0 WHERE id = 1');
    const disabled = await call(e, 'POST', '/slots/3/book', fran, { booking_link_slug: 'ada/practice' });
    assert.deepEqual([off.status, disabled.status], [409, 404]);
  } finally { db.close(); }
});

test('D573: disabling a type between validation and insertion cannot create a booking', async () => {
  const db = freshDb(); try {
    seed(db); const e = env(db); const prepare = e.DB.prepare;
    e.DB.prepare = (sql: string) => {
      if (sql.includes('INSERT INTO advisor_bookings')) db.exec('UPDATE advisor_session_types SET is_active = 0 WHERE id = 1');
      return prepare(sql);
    };
    const r = await call(e, 'POST', '/slots/1/book', fran, { session_type_id: 1 });
    assert.deepEqual([r.status, db.prepare('SELECT COUNT(*) AS n FROM advisor_bookings').get()?.n], [409, 0]);
  } finally { db.close(); }
});

test('D573: a once-per-client type cannot be booked twice, and mismatched slot lengths are refused', async () => {
  const db = freshDb(); try {
    seed(db); const e = env(db);
    db.exec('UPDATE advisor_session_types SET once_per_client = 1 WHERE id = 1');
    const first = await call(e, 'POST', '/slots/1/book', fran, { session_type_id: 1 });
    const twice = await call(e, 'POST', '/slots/3/book', fran, { session_type_id: 1 });
    db.exec('UPDATE advisor_session_types SET duration_minutes = 30 WHERE id = 1');
    const length = await call(e, 'POST', '/slots/3/book', fran, { session_type_id: 1 });
    assert.deepEqual([first.status, twice.status, length.status], [200, 409, 400]);
  } finally { db.close(); }
});

test('D573: link toggles are owned, typed, audited and preserve another advisor’s link', async () => {
  const db = freshDb(); try {
    seed(db); const e = env(db);
    const wrong = await call(e, 'PATCH', '/me/booking-links/1', grace, { is_active: false });
    const invalid = await call(e, 'PATCH', '/me/booking-links/1', ada, { is_active: 'false' });
    const updated = await call(e, 'PATCH', '/me/booking-links/1', ada, { is_active: false });
    const audit = db.prepare("SELECT user_id FROM activity_logs WHERE action = 'advisor_booking_link_updated'").get();
    assert.deepEqual([wrong.status, invalid.status, updated.status, updated.body.is_active, audit?.user_id,
      db.prepare('SELECT is_active FROM advisor_booking_links WHERE id = 2').get()?.is_active], [404, 400, 200, false, ADVISOR_USER, 1]);
  } finally { db.close(); }
});

test('D573: due date and work status round-trip, invalid dates and a fabricated acceptance are refused', async () => {
  const db = freshDb(); try {
    seed(db); const e = env(db);
    db.exec("INSERT INTO advisor_deliverables (id, uid, advisor_id, client_name, title) VALUES (1, 'work-one', 1, 'Synthetic client', 'Plan')");
    const updated = await call(e, 'PATCH', '/me/deliverables/1', ada, { due_date: '2026-12-31', manual_status: 'in_progress' });
    const kept = await call(e, 'PATCH', '/me/deliverables/1', ada, { title: 'Renamed' });
    const wrong = await call(e, 'PATCH', '/me/deliverables/1', grace, { due_date: null });
    const badDate = await call(e, 'PATCH', '/me/deliverables/1', ada, { due_date: '2026-02-30' });
    const invented = await call(e, 'PATCH', '/me/deliverables/1', ada, { manual_status: 'accepted' });
    assert.deepEqual([updated.status, kept.body.due_date, kept.body.manual_status, wrong.status, badDate.status, invented.status],
      [200, '2026-12-31', 'in_progress', 404, 400, 400]);
  } finally { db.close(); }
});

test('D573: only the client accepts a sent version, first acceptance wins and an unsent version stays private', async () => {
  const db = freshDb(); try {
    const e = env(db);
    db.prepare("INSERT INTO advisor_engagements (id, uid, advisor_id, founder_user_id, client_name, lane) VALUES (1, 'eng-one', 1, ?, 'Synthetic client', 'signed')").run(FOUNDER_USER);
    db.exec("INSERT INTO advisor_deliverables (id, uid, advisor_id, engagement_id, client_name, title) VALUES (1, 'work-one', 1, 1, 'Synthetic client', 'Plan')");
    db.exec("INSERT INTO advisor_deliverable_versions (id, uid, deliverable_id, version, sent_at) VALUES (1, 'version-one', 1, 1, '2026-10-01T10:00:00Z'), (2, 'version-two', 1, 2, NULL)");
    const outsider = await call(e, 'POST', '/received/deliverables/version-one/accept', otto);
    const advisor = await call(e, 'POST', '/received/deliverables/version-one/accept', ada);
    const draft = await call(e, 'POST', '/received/deliverables/version-two/accept', fran);
    const accepted = await call(e, 'POST', '/received/deliverables/version-one/accept', fran);
    db.exec("UPDATE advisor_deliverable_versions SET signed_off_at = '2026-10-01T11:00:00Z' WHERE id = 1");
    const again = await call(e, 'POST', '/received/deliverables/version-one/accept', fran);
    assert.deepEqual([outsider.status, advisor.status, draft.status, accepted.status, Boolean(accepted.body.signed_off_at), again.body.signed_off_at],
      [404, 404, 404, 200, true, '2026-10-01T11:00:00Z']);
    assert.deepEqual({ ...db.prepare("SELECT user_id, COUNT(*) AS n FROM activity_logs WHERE action = 'advisor_deliverable_accepted'").get() },
      { user_id: FOUNDER_USER, n: 1 });
  } finally { db.close(); }
});

test('D573: the advisor’s access reader includes only their own rows and cannot be borrowed by a founder', async () => {
  const db = freshDb(); try {
    const e = env(db);
    db.exec("INSERT INTO projects VALUES (1, 'project-one', 'Synthetic client'); INSERT INTO research_documents VALUES (1, 'doc-one', 'Private title')");
    db.prepare("INSERT INTO advisor_client_access_log (project_id, advisor_user_id, action, document_id) VALUES (1, ?, 'open_brief', NULL), (1, ?, 'open_document', 1)").run(ADVISOR_USER, OTHER_ADVISOR_USER);
    const own = await call(e, 'GET', '/me/access-log', ada);
    const other = await call(e, 'GET', '/me/access-log', grace);
    const forbidden = await call(e, 'GET', '/me/access-log', fran);
    assert.deepEqual([own.status, own.body.items.map((r: any) => r.action), other.body.items.map((r: any) => r.action), forbidden.status],
      [200, ['open_brief'], ['open_document'], 403]);
    assert.equal(JSON.stringify(own.body).includes('Private title'), false);
  } finally { db.close(); }
});

test('D573: public link opens are capped on both mounts and a limiter outage fails closed', async () => {
  const previousNow = Date.now; const instant = previousNow(); Date.now = () => instant;
  try {
    for (const prefix of ['advisors', 'mentors']) {
      const app = new Hono(); let handled = 0;
      app.use('/api/*', rateLimitMiddleware());
      app.post('/api/*', c => { handled++; return c.json({ opened: true }); });
      const counts = new Map<string, string>();
      const e = { RATE_LIMITS: { get: async (key: string) => counts.get(key), put: async (key: string, value: string) => { counts.set(key, value); } },
        DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) } };
      const statuses = [];
      const ctx = { waitUntil() {}, passThroughOnException() {} } as any;
      for (let i = 0; i < 21; i++) statuses.push((await app.request(`/api/${prefix}/booking-links/open`, { method: 'POST' }, e, ctx)).status);
      assert.deepEqual([statuses.slice(0, 20), statuses[20], handled], [Array(20).fill(200), 429, 20]);
      e.RATE_LIMITS.get = async () => { throw new Error('Synthetic KV outage'); };
      const outage = await app.request(`/api/${prefix}/booking-links/open`, { method: 'POST' }, e, ctx);
      assert.deepEqual([outage.status, handled], [503, 20]);
    }
  } finally { Date.now = previousNow; }
});
