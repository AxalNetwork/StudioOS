/**
 * Migration 240 — the rules that generate a calendar, the prices on it, and
 * the links that fill it.
 *
 * WHAT THESE TESTS ARE FOR. PR4's artboard draws four things a reader is meant
 * to be able to TRUST, and each of them has a way of being quietly wrong that
 * no rendering would reveal:
 *
 *   * an availability rule the advisor never set must read as ABSENT, not as a
 *     number. A cap rendered as 0 says "accept no paid sessions", which is a
 *     decision, and the advisor did not make it (D56/D68).
 *   * a FREE intro and an UNPRICED type are different facts. 205 made the same
 *     distinction for `amount_cents` and for the same reason: zero is a price
 *     someone may genuinely mean, so it cannot double as "no answer".
 *   * a COHORT link with no cohort admits everyone — the opposite of what its
 *     own label claims.
 *   * a slot's `payment_state` must never be able to say `charged` through any
 *     route in this file. Nothing here charges anyone; the Stripe Connect
 *     service leg lands later, in test mode, behind a production flag (D75).
 *
 * And the ordinary half: every read and write is scoped to the signed-in
 * advisor, and another advisor's row answers 404 rather than 403 — the scope
 * is in the WHERE clause, so "yours" and "does not exist" are indistinguishable
 * from outside.
 *
 * The database is REAL (`node:sqlite`, the dialect D1 speaks) and the schema is
 * the migration file read verbatim. If 240 stops parsing, these stop running.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor_sessions_config.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import advisors from '../src/routes/advisors.ts';

const SQL = resolve(dirname(fileURLToPath(import.meta.url)), '../sql');
const JWT_SECRET = 'test-secret-for-advisor-sessions-config';

const ADVISOR_USER = 90;
const OTHER_ADVISOR_USER = 91;
const FOUNDER_USER = 92;

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
    CREATE TABLE advisors (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, user_id INTEGER UNIQUE,
      display_name TEXT NOT NULL, email TEXT, bio TEXT,
      expertise_json TEXT NOT NULL DEFAULT '[]', sectors_json TEXT NOT NULL DEFAULT '[]',
      linkedin_url TEXT, hourly_rate_usd INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    -- Verbatim from sql/historical/t13_t14_t15.sql:38 — the shape 240 ALTERs.
    CREATE TABLE advisor_office_hour_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      advisor_id INTEGER NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 1, meeting_url TEXT, notes TEXT,
      is_cancelled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(migration('240_advisor_sessions_config'));

  const u = db.prepare('INSERT INTO users (id, role, advisor_id, name, email) VALUES (?,?,?,?,?)');
  u.run(ADVISOR_USER, 'advisor', 1, 'Ada', 'ada@example.com');
  u.run(OTHER_ADVISOR_USER, 'advisor', 2, 'Grace', 'grace@example.com');
  u.run(FOUNDER_USER, 'founder', null, 'Fran', 'fran@example.com');

  const a = db.prepare(
    'INSERT INTO advisors (id, uid, user_id, display_name, email) VALUES (?,?,?,?,?)');
  a.run(1, 'adv-1', ADVISOR_USER, 'Ada', 'ada@example.com');
  a.run(2, 'adv-2', OTHER_ADVISOR_USER, 'Grace', 'grace@example.com');
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
  // The ExecutionContext stub is not optional: Hono's `c.executionCtx` getter
  // THROWS when absent, so a deferred-hook guard becomes a 500 in tests only.
  const res = await advisors.request(path, init, e, {
    waitUntil() {}, passThroughOnException() {},
  } as any);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const ada = { user: ADVISOR_USER, role: 'advisor' };
const grace = { user: OTHER_ADVISOR_USER, role: 'advisor' };

// ── Availability ───────────────────────────────────────────────────────────

test('an availability rule nobody has set reads as absent, not as zero', async () => {
  const e = env(freshDb());
  const r = await call(e, 'GET', '/me/availability', ada);
  assert.equal(r.status, 200);
  // Every one null, and `configured: false` so the page can tell "no rules"
  // from "rules set to nothing" — which the four nulls alone cannot.
  assert.deepEqual(r.body, {
    weekly_paid_cap: null, buffer_minutes: null, min_notice_hours: null,
    blackouts: [], timezone: null, configured: false,
  });
});

test('a cap of zero is kept as zero, because refusing paid work is a decision', async () => {
  const e = env(freshDb());
  const put = await call(e, 'PUT', '/me/availability', ada, { weekly_paid_cap: 0 });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.weekly_paid_cap, 0);
  assert.equal(put.body.configured, true);
  // ...and it survives a re-read, so the distinction is in the store rather
  // than in one response.
  const got = await call(e, 'GET', '/me/availability', ada);
  assert.equal(got.body.weekly_paid_cap, 0);
});

test('PUT replaces the whole rule set, so two rules cannot disagree about the last edit', async () => {
  const e = env(freshDb());
  await call(e, 'PUT', '/me/availability', ada, {
    weekly_paid_cap: 6, buffer_minutes: 15, min_notice_hours: 24,
    blackouts: [{ day: 'fri', from: '12:00', to: '18:00' }], timezone: 'Europe/Paris',
  });
  const second = await call(e, 'PUT', '/me/availability', ada, { weekly_paid_cap: 4 });
  assert.equal(second.status, 200);
  assert.equal(second.body.weekly_paid_cap, 4);
  // The omitted fields are CLEARED, not retained. That is what "the rule set is
  // the unit" means, and a page that sends a partial body gets what it asked
  // for rather than a silent merge.
  assert.equal(second.body.buffer_minutes, null);
  assert.equal(second.body.min_notice_hours, null);
  assert.equal(second.body.timezone, null);
  assert.deepEqual(second.body.blackouts, []);

  // EVERY field, not just the ones that happened to be easy to check. A
  // COALESCE on any single column is invisible unless that column is the one
  // omitted, so omit the cap this time and keep something else.
  const third = await call(e, 'PUT', '/me/availability', ada, { buffer_minutes: 30 });
  assert.equal(third.status, 200);
  assert.equal(third.body.weekly_paid_cap, null, 'an omitted cap must clear, not persist');
  assert.equal(third.body.buffer_minutes, 30);
});

test('a blackout is a weekday and a clock time, and a malformed one is refused', async () => {
  const e = env(freshDb());
  for (const bad of [
    [{ day: 'friday', from: '12:00', to: '18:00' }],     // not a 3-letter day
    [{ day: 'fri', from: '2026-11-04', to: '18:00' }],   // a date, not a clock
    [{ day: 'fri', from: '25:00', to: '26:00' }],        // not a clock at all
    [{ day: 'fri', from: '18:00', to: '12:00' }],        // ends before it starts
  ]) {
    const r = await call(e, 'PUT', '/me/availability', ada, { blackouts: bad });
    assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
  }
  const ok = await call(e, 'PUT', '/me/availability', ada, {
    blackouts: [{ day: 'fri', from: '12:00', to: '18:00' }],
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.blackouts, [{ day: 'fri', from: '12:00', to: '18:00' }]);
});

test('one advisor cannot read or write another advisor’s rules', async () => {
  const e = env(freshDb());
  await call(e, 'PUT', '/me/availability', ada, { weekly_paid_cap: 6 });
  const hers = await call(e, 'GET', '/me/availability', grace);
  // Not Ada's 6, and not an error either — Grace simply has none.
  assert.equal(hers.body.weekly_paid_cap, null);
  assert.equal(hers.body.configured, false);
  await call(e, 'PUT', '/me/availability', grace, { weekly_paid_cap: 2 });
  const mine = await call(e, 'GET', '/me/availability', ada);
  assert.equal(mine.body.weekly_paid_cap, 6, "Grace's write must not touch Ada's row");
});

// ── Session types ──────────────────────────────────────────────────────────

test('free and unpriced are different facts, and a type cannot claim both', async () => {
  const e = env(freshDb());
  const contradiction = await call(e, 'POST', '/me/session-types', ada, {
    name: 'Intro call', is_free_intro: true, price_cents: 30000,
  });
  assert.equal(contradiction.status, 400);

  const free = await call(e, 'POST', '/me/session-types', ada, {
    name: 'Intro call', is_free_intro: true, once_per_client: true,
  });
  assert.equal(free.status, 201, JSON.stringify(free.body));
  assert.equal(free.body.is_free_intro, true);
  assert.equal(free.body.price_cents, null);

  const unpriced = await call(e, 'POST', '/me/session-types', ada, { name: 'Workshop' });
  assert.equal(unpriced.status, 201);
  assert.equal(unpriced.body.is_free_intro, false);
  assert.equal(unpriced.body.price_cents, null);
  // Both carry price_cents null; `is_free_intro` is the whole difference, which
  // is exactly why it cannot be inferred from the price.
});

test('a price is whole cents, and a fractional or negative one is refused', async () => {
  const e = env(freshDb());
  for (const bad of [30000.5, -1, 'lots']) {
    const r = await call(e, 'POST', '/me/session-types', ada, { name: 'Session', price_cents: bad });
    assert.equal(r.status, 400, `expected 400 for price_cents=${bad}`);
  }
  const ok = await call(e, 'POST', '/me/session-types', ada, { name: 'Session', price_cents: 30000 });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.price_cents, 30000);
});

test('a session type belongs to one advisor, and the other gets 404 rather than 403', async () => {
  const e = env(freshDb());
  const mine = await call(e, 'POST', '/me/session-types', ada, { name: 'Single session' });
  assert.equal(mine.status, 201);

  const hers = await call(e, 'GET', '/me/session-types', grace);
  assert.deepEqual(hers.body.items, []);

  const patch = await call(e, 'PATCH', `/me/session-types/${mine.body.id}`, grace, { name: 'Stolen' });
  assert.equal(patch.status, 404, 'another advisor’s row must be indistinguishable from absent');

  const unchanged = await call(e, 'GET', '/me/session-types', ada);
  assert.equal(unchanged.body.items[0].name, 'Single session');
});

test('PATCH can clear a price back to unpriced without renaming the type', async () => {
  const e = env(freshDb());
  const made = await call(e, 'POST', '/me/session-types', ada, {
    name: 'Five-session pack', price_cents: 125000,
  });
  const cleared = await call(e, 'PATCH', `/me/session-types/${made.body.id}`, ada, { price_cents: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.price_cents, null);
  assert.equal(cleared.body.name, 'Five-session pack');
});

// ── Booking links ──────────────────────────────────────────────────────────

test('a cohort link without a cohort is refused, because it would admit everyone', async () => {
  const e = env(freshDb());
  const r = await call(e, 'POST', '/me/booking-links', ada, {
    slug: 'ada/cohort-4', audience: 'cohort',
  });
  assert.equal(r.status, 400);
  const ok = await call(e, 'POST', '/me/booking-links', ada, {
    slug: 'ada/cohort-4', audience: 'cohort', cohort_ref: 'cohort-4',
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.cohort_ref, 'cohort-4');
});

test('a slug is refused rather than rewritten, and it is unique across advisors', async () => {
  const e = env(freshDb());
  for (const bad of ['Ada/Intro', 'ada intro', '-ada', 'a', '']) {
    const r = await call(e, 'POST', '/me/booking-links', ada, { slug: bad });
    assert.equal(r.status, 400, `expected 400 for slug=${JSON.stringify(bad)}`);
  }
  const first = await call(e, 'POST', '/me/booking-links', ada, { slug: 'ada/intro' });
  assert.equal(first.status, 201);
  // A link resolves from the URL alone, so the namespace is global. Grace
  // cannot take a slug Ada holds.
  const clash = await call(e, 'POST', '/me/booking-links', grace, { slug: 'ada/intro' });
  assert.equal(clash.status, 409);
});

test('a link cannot sell another advisor’s session type', async () => {
  const e = env(freshDb());
  const hers = await call(e, 'POST', '/me/session-types', grace, { name: 'Grace hour' });
  assert.equal(hers.status, 201);
  const r = await call(e, 'POST', '/me/booking-links', ada, {
    slug: 'ada/borrowed', session_type_id: hers.body.id,
  });
  assert.equal(r.status, 404);
});

test('an unknown audience is refused by the route before the CHECK sees it', async () => {
  const e = env(freshDb());
  const r = await call(e, 'POST', '/me/booking-links', ada, {
    slug: 'ada/all', audience: 'everyone',
  });
  assert.equal(r.status, 400);
  // "public" is the WRONG word to assert on: SQLite's own CHECK failure reads
  // `CHECK constraint failed: audience IN ('public', 'cohort', 'private')`, so
  // a test matching /public/ passes whether the route refused the value or the
  // database did — and a mutation deleting the route's check escaped exactly
  // that way. `must be one of` is the route's phrasing and nothing else's.
  assert.match(String(r.body?.detail || ''), /must be one of/);
  // ...and belt and braces: no row was written under any audience.
  const links = await call(e, 'GET', '/me/booking-links', ada);
  assert.deepEqual(links.body.items, []);
});

// ── The line this whole PR sits behind ─────────────────────────────────────

test('no route in this group can write a slot payment_state of charged', async () => {
  // The store CAN hold 'charged' — the settlement path will need it — but
  // nothing shipped here may write it. Asserted over the source rather than by
  // probing every route, because the guarantee is "no route", not "not these
  // routes I remembered to try".
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../src/routes/advisors.ts'), 'utf8',
  );
  // Comments are stripped: the block explaining WHY nothing writes 'charged'
  // necessarily contains the word, and would satisfy a naive scan.
  const code = src
    .replace(/^\/\*[\s\S]*?\*\//gm, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
    .replace(/^\s*\*[^\n]*$/gm, '');
  assert.ok(
    !/payment_state\s*=\s*\?*\s*['"]charged['"]/.test(code),
    'a route writes payment_state = charged; nothing charges anyone until the '
    + 'Stripe Connect service leg lands behind its production flag (D75)',
  );
  assert.ok(
    !/['"]charged['"]/.test(code.split("advisors.get('/me/availability'")[1] || ''),
    'the PR4 route block must not mention a charged state at all',
  );
});

test('the migration keeps charged reachable for the settlement path that will need it', async () => {
  // The complement of the test above, and the reason it is a pair: if someone
  // "fixes" the guard by deleting 'charged' from the CHECK, the store loses the
  // state the service leg is being built toward, and the guard still passes.
  const sql = migration('240_advisor_sessions_config');
  for (const state of ['not_applicable', 'held_unpaid', 'authorized', 'charged', 'refunded']) {
    assert.ok(sql.includes(`'${state}'`), `payment_state must still admit ${state}`);
  }
});

test('a fresh slot is not_applicable and unrecorded, never a plausible default', async () => {
  const db = freshDb();
  db.prepare(
    `INSERT INTO advisor_office_hour_slots (uid, advisor_id, starts_at, ends_at)
     VALUES ('s-1', 1, '2026-11-04T10:00:00Z', '2026-11-04T11:00:00Z')`
  ).run();
  const row: any = db.prepare(
    'SELECT recording_state, payment_state, blocked_reason FROM advisor_office_hour_slots'
  ).get();
  // Consent that was never given is not consent, and a slot nobody tried to
  // charge is not an unpaid one.
  assert.equal(row.recording_state, 'none');
  assert.equal(row.payment_state, 'not_applicable');
  assert.equal(row.blocked_reason, null);
});
