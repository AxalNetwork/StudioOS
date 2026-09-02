/**
 * The advisor's own stores — migrations 201–206 and the routes over them.
 *
 * WHAT THESE TESTS ARE FOR. Every one of them pins a decision that could
 * plausibly have gone the other way and would be invisible if it did:
 *
 *   * a price that was never set reads as ABSENT, not as zero;
 *   * a profile POST from one surface does not blank the fields another surface
 *     owns (`/office-hours` sends `headline` and `timezone` and nothing else,
 *     and must not wipe stages, languages, country or the headshot);
 *   * "attested" is derived from a consent row, so an advisor cannot assert it
 *     about themselves;
 *   * a cohort read without an assignment is refused whatever the role says;
 *   * ending an assignment keeps the record that it existed.
 *
 * HARNESS. Same shape as `advisor_company_scope.test.ts`: the real router
 * against real in-memory SQLite, with the tables built from the migration
 * files THEMSELVES rather than hand-copied. Copying a shape into a test is how
 * a test ends up passing against a schema production does not have — the whole
 * class of bug migrations 196 and 200 were spent on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import advisors from '../src/routes/advisors.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADVISOR_USER = 70;
const OTHER_ADVISOR_USER = 71;
const FOUNDER_USER = 72;
const ADMIN_USER = 73;
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
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE cohort_cycles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER NOT NULL, month INTEGER NOT NULL,
      start_at TEXT NOT NULL, end_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled'
    );
    CREATE TABLE company_week_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      cohort_cycle_id INTEGER NOT NULL, week_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
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
  `);
  // The new schema comes from the migration files verbatim. If one of them
  // stops parsing, these tests stop running — which is the point.
  db.exec(migration('201_advisors_table_in_ledger'));
  db.exec(migration('202_advisor_profile_fields'));
  db.exec(migration('203_advisor_services'));
  db.exec(migration('204_advisor_proof'));
  db.exec(migration('205_advisor_booking_amounts'));
  db.exec(migration('206_advisor_cohort_assignments'));

  const u = db.prepare('INSERT INTO users (id, role, advisor_id, name, email) VALUES (?,?,?,?,?)');
  u.run(ADVISOR_USER, 'advisor', 1, 'Ada', 'ada@example.com');
  u.run(OTHER_ADVISOR_USER, 'advisor', 2, 'Grace', 'grace@example.com');
  u.run(FOUNDER_USER, 'founder', null, 'Fran', 'fran@example.com');
  u.run(ADMIN_USER, 'admin', null, 'Root', 'root@example.com');

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
  const res = await advisors.request(path, init, e);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const ada = { user: ADVISOR_USER, role: 'advisor' };
const grace = { user: OTHER_ADVISOR_USER, role: 'advisor' };
const fran = { user: FOUNDER_USER, role: 'founder' };
const root = { user: ADMIN_USER, role: 'admin' };

// ---------------------------------------------------------------------------
// 202 — profile fields
// ---------------------------------------------------------------------------
test('the profile fields the office-hours ProfileCard sends are no longer discarded', async () => {
  const e = env(freshDb());
  const saved = await call(e, 'POST', '/me', ada, { headline: 'ex-Stripe payments PM', timezone: 'America/New_York' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.headline, 'ex-Stripe payments PM');
  assert.equal(saved.body.timezone, 'America/New_York');
  const read = await call(e, 'GET', '/me', ada);
  assert.equal(read.body.headline, 'ex-Stripe payments PM', 'and it survives the round trip');
});

test('one surface saving its own fields does not blank another surface’s', async () => {
  const e = env(freshDb());
  await call(e, 'POST', '/me', ada, {
    stages: ['pre-seed', 'seed'], languages: ['en', 'fr'],
    country: 'CA', headshot_url: 'https://example.com/a.png',
  });
  // Now the office-hours ProfileCard saves, sending only what it knows about.
  await call(e, 'POST', '/me', ada, { headline: 'Payments', timezone: 'America/Toronto' });
  const read = await call(e, 'GET', '/me', ada);
  assert.deepEqual(read.body.stages, ['pre-seed', 'seed'], 'stages survived a save that never mentioned them');
  assert.deepEqual(read.body.languages, ['en', 'fr']);
  assert.equal(read.body.country, 'CA');
  assert.equal(read.body.headshot_url, 'https://example.com/a.png');
  assert.equal(read.body.headline, 'Payments');
});

test('an explicit null clears a field; an absent key does not', async () => {
  const e = env(freshDb());
  await call(e, 'POST', '/me', ada, { headshot_url: 'https://example.com/a.png', country: 'CA' });
  await call(e, 'POST', '/me', ada, { headshot_url: null });
  const read = await call(e, 'GET', '/me', ada);
  assert.equal(read.body.headshot_url, null, 'null removed it');
  assert.equal(read.body.country, 'CA', 'and left the key that was not mentioned alone');
});

test('an unanswered list reads as absent, not as an empty list', async () => {
  const e = env(freshDb());
  const read = await call(e, 'GET', '/me', ada);
  assert.equal(read.body.stages, null, 'never asked is null');
  await call(e, 'POST', '/me', ada, { stages: [] });
  const after = await call(e, 'GET', '/me', ada);
  assert.deepEqual(after.body.stages, [], 'answered-and-empty is []');
});

// ---------------------------------------------------------------------------
// 203 — services
// ---------------------------------------------------------------------------
test('a service with no price reads as unpriced, never as free', async () => {
  const e = env(freshDb());
  const made = await call(e, 'POST', '/me/services', ada, { title: 'Fractional CTO day' });
  assert.equal(made.status, 200);
  assert.equal(made.body.price_cents, null, 'not 0');
  assert.equal(made.body.kind, 'fixed');
  assert.equal(made.body.currency, 'USD');
});

test('a price is whole cents or it is rejected', async () => {
  const e = env(freshDb());
  for (const bad of [12.5, -1, 'free']) {
    const r = await call(e, 'POST', '/me/services', ada, { title: 'x', price_cents: bad });
    assert.equal(r.status, 400, `rejected ${JSON.stringify(bad)}`);
  }
  const ok = await call(e, 'POST', '/me/services', ada, { title: 'x', price_cents: 250000 });
  assert.equal(ok.body.price_cents, 250000);
});

test('units_sold is null because nothing links a booking to a service', async () => {
  const e = env(freshDb());
  await call(e, 'POST', '/me/services', ada, { title: 'Advisory hour' });
  const list = await call(e, 'GET', '/me/services', ada);
  assert.equal(list.body.items[0].units_sold, null,
    'a topic-string match would be a guess presented as a count');
});

test('an advisor cannot edit or delete another advisor’s service', async () => {
  const e = env(freshDb());
  const mine = await call(e, 'POST', '/me/services', ada, { title: 'Mine' });
  assert.equal((await call(e, 'PATCH', `/me/services/${mine.body.id}`, grace, { title: 'Hers' })).status, 404);
  assert.equal((await call(e, 'DELETE', `/me/services/${mine.body.id}`, grace)).status, 404);
  assert.equal((await call(e, 'GET', '/me/services', grace)).body.items.length, 0);
  assert.equal((await call(e, 'GET', '/me/services', ada)).body.items[0].title, 'Mine');
});

test('a service edit merges — an unmentioned price is not cleared', async () => {
  const e = env(freshDb());
  const made = await call(e, 'POST', '/me/services', ada, { title: 'Sprint', price_cents: 500000 });
  const edited = await call(e, 'PATCH', `/me/services/${made.body.id}`, ada, { scope: 'Two weeks' });
  assert.equal(edited.body.price_cents, 500000);
  assert.equal(edited.body.scope, 'Two weeks');
  const cleared = await call(e, 'PATCH', `/me/services/${made.body.id}`, ada, { price_cents: null });
  assert.equal(cleared.body.price_cents, null, 'but an explicit null does clear it');
});

// ---------------------------------------------------------------------------
// 204 — proof and consent
// ---------------------------------------------------------------------------
test('a proof item an advisor wrote about themselves is self-stated, not attested', async () => {
  const e = env(freshDb());
  const item = await call(e, 'POST', '/me/proof', ada, { title: 'Led the payments rebuild', organization: 'Stripe' });
  assert.equal(item.body.attested, false);
  assert.equal(item.body.status, 'self_stated');
});

test('only the attester can make a claim attested, and the advisor never sees the token again', async () => {
  const e = env(freshDb());
  const item = await call(e, 'POST', '/me/proof', ada, { title: 'Led the payments rebuild' });
  const req = await call(e, 'POST', `/me/proof/${item.body.id}/consent-request`, ada, {
    attester_name: 'Sam Reviewer', attester_email: 'sam@example.com',
  });
  assert.equal(req.status, 200);
  assert.equal(req.body.delivered, false, 'recorded, not sent');
  const tok = req.body.request_token;
  assert.ok(tok, 'the token is handed over exactly once');

  const listed = await call(e, 'GET', '/me/proof', ada);
  assert.equal(listed.body.items[0].attested, false, 'asking is not being told yes');
  assert.equal(listed.body.items[0].consents[0].request_token, undefined,
    'the advisor cannot read the token back and answer for the attester');

  const res = await advisors.request(`/proof-consents/${tok}/respond`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consent_text: 'I confirm Ada led this work.', statement: 'She ran it end to end.' }),
  }, e);
  assert.equal(res.status, 200);

  const after = await call(e, 'GET', '/me/proof', ada);
  assert.equal(after.body.items[0].attested, true);
  assert.equal(after.body.items[0].status, 'attested');
  assert.equal(after.body.items[0].consents[0].statement, 'She ran it end to end.');
});

test('consent without recorded wording is refused', async () => {
  const e = env(freshDb());
  const item = await call(e, 'POST', '/me/proof', ada, { title: 'A claim' });
  const req = await call(e, 'POST', `/me/proof/${item.body.id}/consent-request`, ada, { attester_name: 'Sam' });
  const res = await advisors.request(`/proof-consents/${req.body.request_token}/respond`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  }, e);
  assert.equal(res.status, 400, 'consent_text must say what was agreed to');
});

test('a withdrawn consent leaves the record that it was given', async () => {
  const e = env(freshDb());
  const item = await call(e, 'POST', '/me/proof', ada, { title: 'A claim' });
  const req = await call(e, 'POST', `/me/proof/${item.body.id}/consent-request`, ada, { attester_name: 'Sam' });
  const url = `/proof-consents/${req.body.request_token}/respond`;
  const post = (b: any) => advisors.request(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
  }, e);
  await post({ consent_text: 'Confirmed.' });
  await post({ consent_given: false });
  const after = await call(e, 'GET', '/me/proof', ada);
  assert.equal(after.body.items[0].attested, false, 'the claim is no longer attested');
  assert.equal(after.body.items[0].consents.length, 1, 'and the row is still there');
  assert.ok(after.body.items[0].consents[0].withdrawn_at, 'saying when it was withdrawn');
});

test('a proof item an advisor does not own is not theirs to delete', async () => {
  const e = env(freshDb());
  const item = await call(e, 'POST', '/me/proof', ada, { title: 'Mine' });
  assert.equal((await call(e, 'DELETE', `/me/proof/${item.body.id}`, grace)).status, 404);
});

// ---------------------------------------------------------------------------
// 205 — session amounts and earnings
// ---------------------------------------------------------------------------
function seedBooking(db: InstanceType<typeof DatabaseSync>, id: number, advisorId = 1) {
  db.prepare('INSERT INTO advisor_office_hour_slots (id, uid, advisor_id, starts_at, ends_at) VALUES (?,?,?,?,?)')
    .run(id, `slot-${id}`, advisorId, '2026-09-10T15:00:00Z', '2026-09-10T16:00:00Z');
  db.prepare('INSERT INTO advisor_bookings (id, uid, slot_id, advisor_id, founder_user_id, status) VALUES (?,?,?,?,?,?)')
    .run(id, `bk-${id}`, id, advisorId, FOUNDER_USER, 'completed');
}

test('an existing booking starts unpriced, and unpriced is not zero', async () => {
  const db = freshDb(); seedBooking(db, 1);
  const e = env(db);
  const earnings = await call(e, 'GET', '/me/earnings', ada);
  assert.equal(earnings.body.unpriced_count, 1, 'reported, not hidden');
  assert.equal(earnings.body.collected_cents, 0);
  assert.equal(earnings.body.settlement, 'none', 'no money moves through Axal');
});

test('a billing state cannot be recorded against an amount that does not exist', async () => {
  const db = freshDb(); seedBooking(db, 1);
  const e = env(db);
  const r = await call(e, 'PATCH', '/me/bookings/1/billing', ada, { billing_state: 'collected' });
  assert.equal(r.status, 400, 'there is no figure for "collected" to refer to');
});

test('pricing a session with nothing else said means billed', async () => {
  const db = freshDb(); seedBooking(db, 1);
  const e = env(db);
  const r = await call(e, 'PATCH', '/me/bookings/1/billing', ada, { amount_cents: 30000 });
  assert.equal(r.body.amount_cents, 30000);
  assert.equal(r.body.billing_state, 'billed');
  const earnings = await call(e, 'GET', '/me/earnings', ada);
  assert.equal(earnings.body.billed_cents, 30000);
  assert.equal(earnings.body.outstanding_cents, 30000);
  assert.equal(earnings.body.collected_cents, 0);
});

test('an unknown billing state is refused rather than stored', async () => {
  const db = freshDb(); seedBooking(db, 1);
  const e = env(db);
  const r = await call(e, 'PATCH', '/me/bookings/1/billing', ada,
    { amount_cents: 100, billing_state: 'paid_out' });
  assert.equal(r.status, 400);
});

test('an advisor cannot price a booking that is not theirs', async () => {
  const db = freshDb(); seedBooking(db, 1, 1);
  const e = env(db);
  assert.equal((await call(e, 'PATCH', '/me/bookings/1/billing', grace, { amount_cents: 1 })).status, 404);
});

test('earnings separate collected from written off', async () => {
  const db = freshDb(); seedBooking(db, 1); seedBooking(db, 2);
  const e = env(db);
  await call(e, 'PATCH', '/me/bookings/1/billing', ada, { amount_cents: 40000, billing_state: 'collected' });
  await call(e, 'PATCH', '/me/bookings/2/billing', ada, { amount_cents: 15000, billing_state: 'written_off' });
  const g = await call(e, 'GET', '/me/earnings', ada);
  assert.equal(g.body.collected_cents, 40000);
  assert.equal(g.body.written_off_cents, 15000);
  assert.equal(g.body.outstanding_cents, 0, 'a written-off session is not outstanding');
});

// ---------------------------------------------------------------------------
// 206 — cohort assignment
// ---------------------------------------------------------------------------
test('an advisor with no assignment sees no cohort and cannot open one', async () => {
  const e = env(freshDb());
  assert.deepEqual((await call(e, 'GET', '/me/cohort', ada)).body.items, []);
  const founders = await call(e, 'GET', `/me/cohort/${CYCLE}/founders`, ada);
  assert.equal(founders.status, 403, 'having the advisor role is not having a batch');
});

test('an admin assigns; the advisor then reads that batch and no other', async () => {
  const e = env(freshDb());
  const made = await call(e, 'POST', '/admin/cohort-assignments', root, {
    advisor_user_id: ADVISOR_USER, cohort_cycle_id: CYCLE, note: 'September batch',
  });
  assert.equal(made.status, 200);
  assert.equal(made.body.assigned_by_admin_id, ADMIN_USER, 'who decided is on the record');

  const mine = await call(e, 'GET', '/me/cohort', ada);
  assert.equal(mine.body.items.length, 1);
  assert.equal(mine.body.items[0].cohort.year, 2026);
  assert.equal(mine.body.items[0].cohort.month, 9);

  const founders = await call(e, 'GET', `/me/cohort/${CYCLE}/founders`, ada);
  assert.equal(founders.status, 200);
  assert.equal(founders.body.source, 'spinout_lab', 'seam-marked as the founder’s own record');
  assert.equal(founders.body.items.length, 1, 'two week rows, one founder');
  assert.equal(founders.body.items[0].user_id, FOUNDER_USER);

  assert.equal((await call(e, 'GET', `/me/cohort/${OTHER_CYCLE}/founders`, ada)).status, 403,
    'an assignment to one cycle is not an assignment to the next');
  assert.deepEqual((await call(e, 'GET', '/me/cohort', grace)).body.items, [],
    'and it is not an assignment for another advisor');
});

test('only an admin may assign', async () => {
  const e = env(freshDb());
  for (const who of [ada, fran, grace]) {
    const r = await call(e, 'POST', '/admin/cohort-assignments', who, {
      advisor_user_id: who.user, cohort_cycle_id: CYCLE,
    });
    assert.equal(r.status, 403, `${who.role} cannot grant themselves a batch`);
  }
});

test('assigning the same pair twice reactivates one row rather than stacking two', async () => {
  const e = env(freshDb());
  const body = { advisor_user_id: ADVISOR_USER, cohort_cycle_id: CYCLE };
  const first = await call(e, 'POST', '/admin/cohort-assignments', root, body);
  await call(e, 'DELETE', `/admin/cohort-assignments/${first.body.id}`, root);
  const again = await call(e, 'POST', '/admin/cohort-assignments', root, body);
  assert.equal(again.body.id, first.body.id, 'the same row');
  assert.equal(again.body.is_active, true);
  assert.equal(again.body.unassigned_at, null, 'reactivated, not duplicated');
  assert.equal((await call(e, 'GET', '/admin/cohort-assignments', root)).body.items.length, 1);
});

test('ending an assignment keeps the record that it existed', async () => {
  const e = env(freshDb());
  const made = await call(e, 'POST', '/admin/cohort-assignments', root, {
    advisor_user_id: ADVISOR_USER, cohort_cycle_id: CYCLE,
  });
  const gone = await call(e, 'DELETE', `/admin/cohort-assignments/${made.body.id}`, root);
  assert.equal(gone.status, 200);
  assert.ok(gone.body.unassigned_at, 'saying when access ended');

  assert.deepEqual((await call(e, 'GET', '/me/cohort', ada)).body.items, [], 'the advisor loses the batch');
  assert.equal((await call(e, 'GET', `/me/cohort/${CYCLE}/founders`, ada)).status, 403);

  const admin = await call(e, 'GET', '/admin/cohort-assignments', root);
  assert.equal(admin.body.items.length, 1, 'and the admin can still see who had it');
  assert.equal(admin.body.items[0].is_active, false);
});

test('assigning to a user or cycle that does not exist fails with a sentence', async () => {
  const e = env(freshDb());
  assert.equal((await call(e, 'POST', '/admin/cohort-assignments', root,
    { advisor_user_id: 9999, cohort_cycle_id: CYCLE })).status, 404);
  assert.equal((await call(e, 'POST', '/admin/cohort-assignments', root,
    { advisor_user_id: ADVISOR_USER, cohort_cycle_id: 9999 })).status, 404);
});

// ---------------------------------------------------------------------------
// The Lab is not touched
// ---------------------------------------------------------------------------
test('the cohort read writes nothing to the Spin-Out Lab', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'POST', '/admin/cohort-assignments', root, {
    advisor_user_id: ADVISOR_USER, cohort_cycle_id: CYCLE,
  });
  const before = {
    cycles: db.prepare('SELECT * FROM cohort_cycles ORDER BY id').all(),
    weeks: db.prepare('SELECT * FROM company_week_status ORDER BY id').all(),
  };
  await call(e, 'GET', '/me/cohort', ada);
  await call(e, 'GET', `/me/cohort/${CYCLE}/founders`, ada);
  assert.deepEqual(db.prepare('SELECT * FROM cohort_cycles ORDER BY id').all(), before.cycles);
  assert.deepEqual(db.prepare('SELECT * FROM company_week_status ORDER BY id').all(), before.weeks);
});
