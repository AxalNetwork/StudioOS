/**
 * `/api/portfolio-support` — one investor's book is not another's, on the write
 * as well as the read.
 *
 * WHY A WORKER TEST FOR THIS ONE. Every other write in the Portfolio bucket is
 * `requireAdmin`, and this route deliberately is not: a support entry is a
 * record of what a person did, not a valuation, and an admin-only ledger stays
 * empty because the people doing the work cannot write to it. A widened gate is
 * the right call and it is also the risky one, so the gate is driven here
 * against real SQL rather than asserted from the source text.
 *
 * THE PREDICATE THAT MUST NEVER SEE AN EMPTY SET. Reads and writes both narrow
 * on `investorProjectIds` through the CSV predicate
 * `(? IS NULL OR instr(',' || ? || ',', …) > 0)`, whose NULL means EVERY ROW.
 * So an investor whose accessible set is `[]` must be answered before the query
 * runs; `''.join(',')` is `''`, which is not NULL, but the short-circuit is
 * what makes that irrelevant rather than a near miss. Both handlers check
 * `empty` first, and the two tests below fail if either stops.
 *
 * REAL SQLITE, NOT A TEXT-MATCHING STUB — `_d1_sqlite.mjs` argues this at
 * length. A stub taught which strings to expect cannot tell a correct predicate
 * from an incorrect one; here the wrong rows arriving is what fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import support from '../src/routes/portfolio_support.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const MINE = 41;        // investor with a dealroom seat on PROJ_A
const OTHER = 42;       // investor whose book is PROJ_B
const LONER = 43;       // investor with no relationship to anything
const ADMIN = 44;
const FOUNDER = 45;
const PROJ_A = 7;
const PROJ_B = 8;

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
    async batch(x: any[]) { return x; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT,
      investor_seat_primary_user_id INTEGER, investor_tier TEXT,
      investor_subscription_status TEXT, subscription_tier TEXT, partner_id INTEGER
    );
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, is_primary_admin INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, uid TEXT, name TEXT, sector TEXT, stage TEXT,
      status TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT
    );
    CREATE TABLE deals (id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER);
    CREATE TABLE investor_dealroom_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT, investor_user_id INTEGER,
      deal_id INTEGER, company_id INTEGER
    );
    CREATE TABLE investor_introductions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, investor_user_id INTEGER,
      project_id INTEGER, status TEXT, quarter TEXT, company_id INTEGER
    );
    CREATE TABLE watchlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, owner_user_id INTEGER,
      converted_deal_id INTEGER, company_id INTEGER
    );
    CREATE TABLE portfolio_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, fund_id INTEGER,
      project_id INTEGER NOT NULL, round_name TEXT, invested_amount REAL
    );
    -- Migration 237, verbatim in shape.
    CREATE TABLE portfolio_support_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      fund_id INTEGER, project_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'other'
        CHECK (kind IN ('intro','board_prep','hiring','customer','fundraising','other')),
      state TEXT NOT NULL DEFAULT 'promised'
        CHECK (state IN ('promised','delivered','withdrawn')),
      hours REAL, promised_at TEXT, delivered_at TEXT, withdrawn_at TEXT,
      summary TEXT NOT NULL, outcome TEXT, recorded_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, investor_tier) VALUES (?, ?, ?)');
  u.run(MINE, 'investor', 'institutional');
  u.run(OTHER, 'investor', 'institutional');
  u.run(LONER, 'investor', 'institutional');
  u.run(ADMIN, 'admin', null);
  u.run(FOUNDER, 'founder', null);

  const p = db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?, ?, ?, ?)');
  p.run(PROJ_A, 'p-alpha', 'Alpha', 1);
  p.run(PROJ_B, 'p-beta', 'Beta', 2);
  db.prepare('INSERT INTO deals (id, uid, project_id) VALUES (?, ?, ?)').run(71, 'd-a', PROJ_A);
  db.prepare('INSERT INTO deals (id, uid, project_id) VALUES (?, ?, ?)').run(72, 'd-b', PROJ_B);
  const m = db.prepare('INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (?, ?)');
  m.run(MINE, 71);
  m.run(OTHER, 72);

  const pos = db.prepare('INSERT INTO portfolio_positions (uid, project_id, round_name, invested_amount) VALUES (?, ?, ?, ?)');
  pos.run('pos-a', PROJ_A, 'Seed', 500000);
  pos.run('pos-b', PROJ_B, 'Seed', 400000);

  // One entry on each side of the wall, so a leak shows up as a row rather
  // than as an absence that could also mean "the query found nothing".
  const e = db.prepare(
    `INSERT INTO portfolio_support_entries (uid, project_id, kind, state, hours, summary, outcome, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  e.run('sup-a', PROJ_A, 'intro', 'promised', null, 'Promised an intro to a buyer at Northwind', null, MINE);
  e.run('sup-a2', PROJ_A, 'hiring', 'delivered', 2, 'Sat in on two VP Eng loops', 'Offer accepted', MINE);
  e.run('sup-b', PROJ_B, 'board_prep', 'delivered', 4, 'BETA BOARD DECK — the other firm’s work', 'n/a', OTHER);
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

async function call(db: any, who: { user: number; role: string }, path: string, init: any = {}) {
  const jwt = await token(who.user, who.role);
  return support.fetch(
    new Request(`http://x${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers || {}) },
    }),
    env(db),
  );
}

test('the ledger returns only the caller’s own book', async () => {
  const db = freshDb();
  const res = await call(db, { user: MINE, role: 'investor' }, '/');
  assert.equal(res.status, 200);
  const body: any = await res.json();
  const uids = body.entries.map((x: any) => x.uid).sort();
  assert.deepEqual(uids, ['sup-a', 'sup-a2'], 'the other firm’s entries reached this book');
  // Not just the uid: the other firm's PROSE must not be in the payload at all.
  assert.ok(!JSON.stringify(body).includes('BETA BOARD DECK'),
    'the other firm’s summary text is in the response');
  assert.ok(!JSON.stringify(body).includes('Beta'), 'the other firm’s company is named');
  assert.equal(body.totals.companies_in_book, 1);
});

test('an investor with no accessible project gets an empty ledger, never the firm’s', async () => {
  // THE ONE THAT MATTERS. `[].join(',')` is `''` and the predicate's NULL means
  // every row; only the short-circuit keeps those apart.
  const db = freshDb();
  const res = await call(db, { user: LONER, role: 'investor' }, '/');
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.deepEqual(body.entries, [], 'an empty accessible set returned the whole ledger');
  assert.deepEqual(body.untouched, []);
  assert.equal(body.totals.companies_in_book, 0);
});

test('an admin is not narrowed, and sees both books', async () => {
  const db = freshDb();
  const res = await call(db, { user: ADMIN, role: 'admin' }, '/');
  const body: any = await res.json();
  assert.equal(body.entries.length, 3, 'the operator view is narrowed');
  assert.equal(body.totals.companies_in_book, 2);
});

test('a founder is refused the desk outright', async () => {
  const db = freshDb();
  const res = await call(db, { user: FOUNDER, role: 'founder' }, '/');
  assert.equal(res.status, 403, 'a founder can read an investor’s support ledger');
});

test('logging against another firm’s company is a 404, not a write', async () => {
  const db = freshDb();
  const res = await call(db, { user: MINE, role: 'investor' }, '/', {
    method: 'POST',
    body: JSON.stringify({ project_uid: 'p-beta', kind: 'intro', summary: 'not mine to log' }),
  });
  assert.equal(res.status, 404, 'an investor wrote an entry against a company outside their book');
  const rows = db.prepare('SELECT COUNT(*) AS n FROM portfolio_support_entries WHERE project_id = ?').get(PROJ_B) as any;
  assert.equal(Number(rows.n), 1, 'a row was written into the other firm’s ledger');
});

test('an investor with no book cannot log anywhere', async () => {
  const db = freshDb();
  const res = await call(db, { user: LONER, role: 'investor' }, '/', {
    method: 'POST',
    body: JSON.stringify({ project_uid: 'p-alpha', kind: 'intro', summary: 'no book, no write' }),
  });
  assert.equal(res.status, 404);
  const rows = db.prepare('SELECT COUNT(*) AS n FROM portfolio_support_entries').get() as any;
  assert.equal(Number(rows.n), 3, 'an empty accessible set still wrote a row');
});

test('logging into the caller’s own book works, and defaults to promised', async () => {
  const db = freshDb();
  const res = await call(db, { user: MINE, role: 'investor' }, '/', {
    method: 'POST',
    body: JSON.stringify({ project_uid: 'p-alpha', kind: 'customer', summary: 'Warm intro to a design partner' }),
  });
  assert.equal(res.status, 201);
  const body: any = await res.json();
  assert.equal(body.item.state, 'promised', 'a new entry did not default to promised');
  assert.equal(body.item.delivered_at, null, 'a promised entry carries a delivery date');
  assert.equal(body.item.hours, null, 'an unfilled hours field was stored as a number');
});

test('an entry with no description is refused', async () => {
  // A count of unnamed favours is not a ledger; the column is NOT NULL for the
  // same reason the route checks.
  const db = freshDb();
  const res = await call(db, { user: MINE, role: 'investor' }, '/', {
    method: 'POST',
    body: JSON.stringify({ project_uid: 'p-alpha', kind: 'intro', summary: '   ' }),
  });
  assert.equal(res.status, 400);
});

test('an entry cannot be logged as already withdrawn', async () => {
  const db = freshDb();
  const res = await call(db, { user: MINE, role: 'investor' }, '/', {
    method: 'POST',
    body: JSON.stringify({ project_uid: 'p-alpha', state: 'withdrawn', summary: 'retroactively retired' }),
  });
  assert.equal(res.status, 400, 'a promise that was never made was recorded as withdrawn');
});

test('delivering stamps a date, and delivered is terminal', async () => {
  const db = freshDb();
  const ok = await call(db, { user: MINE, role: 'investor' }, '/sup-a', {
    method: 'PATCH', body: JSON.stringify({ state: 'delivered', hours: 1.5 }),
  });
  assert.equal(ok.status, 200);
  const body: any = await ok.json();
  assert.equal(body.item.state, 'delivered');
  assert.match(String(body.item.delivered_at), /^\d{4}-\d{2}-\d{2}$/, 'delivering did not stamp a date');
  assert.equal(body.item.hours, 1.5);

  // Re-opening a kept promise is the audit failure this ledger exists to
  // survive.
  const back = await call(db, { user: MINE, role: 'investor' }, '/sup-a', {
    method: 'PATCH', body: JSON.stringify({ state: 'promised' }),
  });
  assert.equal(back.status, 409, 'a delivered entry was moved back to promised');
});

test('another firm’s entry cannot be moved', async () => {
  const db = freshDb();
  const res = await call(db, { user: MINE, role: 'investor' }, '/sup-b', {
    method: 'PATCH', body: JSON.stringify({ state: 'withdrawn' }),
  });
  assert.equal(res.status, 404, 'an investor withdrew another firm’s support entry');
  const row = db.prepare('SELECT state FROM portfolio_support_entries WHERE uid = ?').get('sup-b') as any;
  assert.equal(row.state, 'delivered', 'the other firm’s entry changed state');
});

test('an unrecorded hour count is never summed as zero', async () => {
  const db = freshDb();
  const res = await call(db, { user: MINE, role: 'investor' }, '/');
  const body: any = await res.json();
  // Two entries: one untimed, one at 2h. The sum is 2 and the untimed one is
  // COUNTED, so a reader can tell the total does not cover everything.
  assert.equal(body.totals.hours_recorded, 2);
  assert.equal(body.totals.entries_without_hours, 1);
  const alpha = body.companies.find((x: any) => x.project_id === PROJ_A);
  assert.equal(alpha.entries_without_hours, 1);
  assert.equal(alpha.hours, 2);
});

test('a company in the book with no entry is reported as untouched', async () => {
  const db = freshDb();
  // Give MINE a second position with nothing logged against it.
  db.prepare('INSERT INTO portfolio_positions (uid, project_id, round_name, invested_amount) VALUES (?, ?, ?, ?)')
    .run('pos-c', 9, 'Seed', 100000);
  db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?, ?, ?, ?)').run(9, 'p-gamma', 'Gamma', 3);
  db.prepare('INSERT INTO deals (id, uid, project_id) VALUES (?, ?, ?)').run(73, 'd-c', 9);
  db.prepare('INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (?, ?)').run(MINE, 73);

  const res = await call(db, { user: MINE, role: 'investor' }, '/');
  const body: any = await res.json();
  assert.deepEqual(body.untouched.map((x: any) => x.name), ['Gamma']);
  assert.equal(body.totals.companies_in_book, 2);
  assert.equal(body.totals.companies_supported, 1);
});
