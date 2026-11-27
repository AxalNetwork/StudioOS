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
import updates from '../src/routes/portfolio_updates.ts';
import { applySupportLedgerSchema } from './_support_ledger_schema.mjs';

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
      const runSync = () => {
        const r = db.prepare(sql).run(...b);
        return { success: true, meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      };
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { return runSync(); },
        runSync,
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    // D4642: this used to hand the statements back WITHOUT running them, so a
    // batched write would look as though it had succeeded and write nothing.
    // #4642's amendment path is the first batch on this route and it reads
    // `success` and `meta.changes` back, so the fixture has to execute — inside
    // a savepoint, as `_d1_sqlite.mjs` does, so a failing statement rolls its
    // siblings back rather than leaving half a write behind.
    async batch(x: any[]) {
      const list = x || [];
      db.exec('SAVEPOINT support_batch');
      try {
        const out = list.map((s) => s.runSync());
        db.exec('RELEASE support_batch');
        return out;
      } catch (e) {
        db.exec('ROLLBACK TO support_batch');
        db.exec('RELEASE support_batch');
        throw e;
      }
    },
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
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
  `);
  // D6202: the ledger's tables from the real migrations (237, D4642, D6202), not a copy of their DDL.
  applySupportLedgerSchema(db);
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

test('a state nobody recognises is refused, not quietly recorded as a promise', async () => {
  // THE ASYMMETRY THIS CLOSES. POST used to coerce — `SUPPORT_STATES.has(x) ? x
  // : 'promised'` — so a typo answered 201 and was filed as a promise, while
  // PATCH one handler down refuses the same typo with a 400. An investor who
  // meant "delivered" and mistyped it got a promise they never made, and
  // nothing told them.
  const db = freshDb();
  const before = db.prepare('SELECT COUNT(*) AS n FROM portfolio_support_entries').get() as any;
  const res = await call(db, { user: MINE, role: 'investor' }, '/', {
    method: 'POST',
    body: JSON.stringify({ project_uid: 'p-alpha', kind: 'intro', state: 'delivred', summary: 'A typo' }),
  });
  assert.equal(res.status, 400, 'an unrecognised state was accepted');
  const body: any = await res.json();
  assert.match(String(body.detail), /promised, in_progress or delivered/, 'the refusal does not name the states that are allowed'); // D6202: in_progress opens too
  const after = db.prepare('SELECT COUNT(*) AS n FROM portfolio_support_entries').get() as any;
  assert.equal(Number(after.n), Number(before.n), 'a refused state still wrote a row');
});

test('an entry may open delivered — work is often logged after it is done', async () => {
  // THE REGRESSION GUARD. The log form's State select offers exactly promised
  // and delivered (InvestorPortfolioValueAdd.jsx), so narrowing creation to
  // `promised` alone would 400 a shipped path. Refusing the unknown state above
  // must not turn into refusing this known one.
  const db = freshDb();
  const res = await call(db, { user: MINE, role: 'investor' }, '/', {
    method: 'POST',
    body: JSON.stringify({ project_uid: 'p-alpha', kind: 'hiring', state: 'delivered', summary: 'Closed the VP Eng' }),
  });
  assert.equal(res.status, 201, 'a delivered entry could not be logged');
  const body: any = await res.json();
  assert.equal(body.item.state, 'delivered');
  assert.match(String(body.item.delivered_at), /^\d{4}-\d{2}-\d{2}$/,
    'opening delivered did not stamp a delivery date');
});

test('a date that is not a date on the calendar is dropped rather than stored', async () => {
  // `Date.parse('2026-02-30')` returns a FINITE number in V8, so the old
  // `/^\d{4}-\d{2}-\d{2}$/ && Number.isFinite(Date.parse(s))` pair let
  // impossible days through and stored them verbatim. February 30th is not a
  // typo the reader can spot later — it is a date the ledger asserts happened.
  const db = freshDb();
  const bad = await call(db, { user: MINE, role: 'investor' }, '/sup-a', {
    method: 'PATCH', body: JSON.stringify({ state: 'delivered', delivered_at: '2026-02-30' }),
  });
  assert.equal(bad.status, 200);
  const badBody: any = await bad.json();
  assert.notEqual(badBody.item.delivered_at, '2026-02-30', 'a day that does not exist was stored');
  assert.equal(badBody.item.delivered_at, new Date().toISOString().slice(0, 10),
    'a dropped date did not fall back to the server stamp');

  // And a real one is still honoured, so the check tightened rather than
  // stopped reading the field.
  const db2 = freshDb();
  const ok = await call(db2, { user: MINE, role: 'investor' }, '/sup-a', {
    method: 'PATCH', body: JSON.stringify({ state: 'delivered', delivered_at: '2026-03-04' }),
  });
  const okBody: any = await ok.json();
  assert.equal(okBody.item.delivered_at, '2026-03-04', 'a valid delivery date was discarded');
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

test('founder asks require both a holding and a delivery; promises remain private and unique', async t => {
  const db = freshDb();
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE commitments (deal_id INTEGER, investor_user_id INTEGER, status TEXT, company_id INTEGER);
    CREATE TABLE portfolio_updates (id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER, kind TEXT, sent_at TEXT);
    CREATE TABLE update_recipients (update_id INTEGER, user_id INTEGER, audience TEXT, version_id INTEGER, delivery_state TEXT, opened_at TEXT);
    CREATE TABLE update_asks (id INTEGER PRIMARY KEY, uid TEXT, update_id INTEGER, kind TEXT, text TEXT, link_ref TEXT);
    CREATE TABLE update_ask_replies (ask_id INTEGER);
    INSERT INTO commitments VALUES (71, 41, 'confirmed', NULL), (71, 42, 'confirmed', NULL);
    INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (42, 71);
    INSERT INTO portfolio_updates VALUES (1, 'sent-update', 7, 'update', '2026-11-15'), (2, 'empty-update', 7, 'update', '2026-11-15');
    INSERT INTO update_recipients VALUES
      (1, 41, 'investor', 1, 'delivered', NULL),
      (1, 42, 'investor', 1, 'reserved', NULL),
      (1, 43, 'investor', 1, 'delivered', NULL),
      (2, 41, 'investor', 2, 'delivered', NULL);
    INSERT INTO update_asks VALUES (1, 'ask-one', 1, 'customer', 'Private request for a customer intro', NULL),
      (2, 'ask-two', 1, 'hire', 'Private request to hire', NULL);
  `);
  async function read(who: number, update: string) {
    return updates.fetch(new Request(`http://x/${update}/asks`, {
      headers: { Authorization: `Bearer ${await token(who, 'investor')}` },
    }), env(db));
  }
  const authorized = await read(MINE, 'sent-update');
  assert.equal(authorized.status, 200, await authorized.clone().text());
  assert.deepEqual((await authorized.json() as any).asks.map((x: any) => x.uid), ['ask-one', 'ask-two']);
  assert.deepEqual(await (await read(MINE, 'empty-update')).json(), { asks: [] });
  assert.equal((await read(OTHER, 'sent-update')).status, 403);
  assert.equal((await read(LONER, 'sent-update')).status, 403);
  assert.equal(db.prepare('SELECT COUNT(opened_at) AS n FROM update_recipients').get()?.n, 0);

  const mine = { user: MINE, role: 'investor' };
  const other = { user: OTHER, role: 'investor' };
  const promise = (who: typeof mine, askUid: string) => call(db, who, '/', {
    method: 'POST', body: JSON.stringify({ project_uid: 'p-alpha', ask_uid: askUid, kind: 'intro', summary: 'Private request for a customer intro' }),
  });
  assert.equal((await promise(other, 'ask-one')).status, 404);
  const created = await promise(mine, 'ask-one');
  assert.equal(created.status, 201, await created.clone().text());
  const { item } = await created.json() as any;
  const retry = await promise(mine, 'ask-one');
  assert.equal(retry.status, 200);
  assert.equal((await retry.json() as any).item.uid, item.uid);
  const ledger = await call(db, other, '/');
  assert.doesNotMatch(await ledger.text(), /Private request|ask-one/);
  assert.equal((await call(db, other, `/${item.uid}/history`)).status, 404);

  const second = await promise(mine, 'ask-two');
  const secondUid = (await second.json() as any).item.uid;
  const started = await call(db, mine, `/${item.uid}`, { method: 'PATCH', body: JSON.stringify({ state: 'in_progress', expected_revision: 1 }) });
  assert.equal(started.status, 200, await started.clone().text());
  const openMine = await call(db, mine, '/?state=open');
  const openItems = (await openMine.json() as any).entries;
  assert.ok(openItems.some((row: any) => row.uid === item.uid && row.state === 'in_progress'));
  assert.ok(openItems.some((row: any) => row.uid === secondUid && row.state === 'promised'));
  const openColleague = await call(db, other, '/?state=open');
  assert.doesNotMatch(await openColleague.text(), /Private request|ask-one|ask-two/);
  for (const [uid, state] of [[item.uid, 'delivered'], [secondUid, 'withdrawn']]) {
    const moved = await call(db, mine, `/${uid}`, { method: 'PATCH', body: JSON.stringify({ state, expected_revision: uid === item.uid ? 2 : 1 }) });
    assert.equal(moved.status, 200, await moved.clone().text());
  }
  const states = (await (await read(MINE, 'sent-update')).json() as any).asks.map((a: any) => a.support_state);
  assert.deepEqual(states, ['delivered', 'withdrawn']);
  const ownerLedger = await call(db, mine, '/');
  assert.match(await ownerLedger.text(), /ask-one/);
  db.exec('DROP TABLE update_ask_replies');
  assert.equal((await read(MINE, 'sent-update')).status, 500);
});

test('D6215: a capital ask on a live round call sends Promise support to the call; without one it is a promise', async t => {
  const db = freshDb();
  t.after(() => db.close());
  db.exec(`
    ALTER TABLE users ADD COLUMN kyc_status TEXT;
    UPDATE users SET kyc_status = 'approved' WHERE id = 41;
    CREATE TABLE commitments (deal_id INTEGER, investor_user_id INTEGER, status TEXT, company_id INTEGER);
    CREATE TABLE portfolio_updates (id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER, kind TEXT, sent_at TEXT);
    CREATE TABLE update_recipients (update_id INTEGER, user_id INTEGER, audience TEXT, version_id INTEGER, delivery_state TEXT, opened_at TEXT);
    CREATE TABLE update_asks (id INTEGER PRIMARY KEY, uid TEXT, update_id INTEGER, kind TEXT, text TEXT, link_ref TEXT);
    CREATE TABLE update_ask_replies (ask_id INTEGER);
    CREATE TABLE round_calls (id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER, state TEXT, target_close TEXT);
    CREATE TABLE round_call_recipients (call_id INTEGER, investor_user_id INTEGER);
    INSERT INTO commitments VALUES (71, 41, 'confirmed', NULL);
    INSERT INTO portfolio_updates VALUES (1, 'sent-update', 7, 'update', '2026-11-15');
    INSERT INTO update_recipients VALUES (1, 41, 'investor', 1, 'delivered', NULL);
    INSERT INTO round_calls VALUES (1, 'call-live', 7, 'sent', '2099-01-01');
    INSERT INTO round_call_recipients VALUES (1, 41);
    INSERT INTO update_asks VALUES (1, 'ask-cap', 1, 'capital', 'Funds that lead a seed extension', 'call-live'),
      (2, 'ask-cap-none', 1, 'capital', 'Funds for a bridge', NULL);
  `);
  const roundEnv = (on: boolean): any => ({ ...env(db), ...(on ? { ROUND_CALLS_ENABLED: 'true' } : {}) });
  const jwt = await token(MINE, 'investor');
  const promise = (askUid: string, on = true) => support.fetch(new Request('http://x/', {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ project_uid: 'p-alpha', ask_uid: askUid, kind: 'fundraising', summary: 'Funds that lead' }),
  }), roundEnv(on));
  const asks = await updates.fetch(new Request('http://x/sent-update/asks', { headers: { Authorization: `Bearer ${jwt}` } }), roundEnv(true));
  assert.equal(asks.status, 200, await asks.clone().text());
  assert.deepEqual((await asks.json() as any).asks.map((a: any) => [a.uid, a.link_ref]), [['ask-cap', 'call-live'], ['ask-cap-none', null]]);

  const onCall = await promise('ask-cap');
  assert.equal(onCall.status, 409, await onCall.clone().text());
  assert.deepEqual(await onCall.json(), { error: 'ask_on_round_call', detail: 'This ask lands on a round call. Promise support on the call.', call_uid: 'call-live' });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM portfolio_support_entries WHERE ask_uid = 'ask-cap'").get()?.n, 0);

  // A capital ask with no open call, or with round calls off, stays a Value-add promise.
  assert.equal((await promise('ask-cap-none')).status, 201);
  assert.equal((await promise('ask-cap', false)).status, 201);
});
