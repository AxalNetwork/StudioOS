/**
 * D4642 (#4642, Portfolio audit 2/5) — a support entry's amendment lifecycle.
 *
 * `portfolio_support_scope.test.ts` beside this file drives the ACCESS wall.
 * This file drives what happens to a record once a member may write to it:
 *
 *   association  an amendment names the record it means, and a mismatch is
 *                refused rather than applied to whatever that uid resolves to;
 *   conflict     the write is conditional on the revision that was read, so the
 *                loser of a race is refused and handed the newer row instead of
 *                overwriting it;
 *   invariants   delivered and withdrawn stay terminal, and the refusal names
 *                the record;
 *   history      every accepted amendment is attributed and append-only.
 *
 * Real SQLite through the same shim as its neighbour, so a wrong revision guard
 * shows up as the wrong row in the store rather than as an unmet expectation.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/support_entry_integrity_4642.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import support from '../src/routes/portfolio_support.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MINE = 41;      // the member who recorded the entries
const COLLEAGUE = 46; // a second member with the same book
const OTHER = 42;     // a member whose book is PROJ_B
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
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      revision INTEGER NOT NULL DEFAULT 1, updated_by INTEGER
    );
    CREATE TABLE portfolio_support_entry_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      entry_id INTEGER NOT NULL, revision INTEGER NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('amended','delivered','withdrawn')),
      from_state TEXT, to_state TEXT,
      changed_json TEXT NOT NULL DEFAULT '[]', actor_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (entry_id, revision)
    );
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, investor_tier, name) VALUES (?, ?, ?, ?)');
  u.run(MINE, 'investor', 'institutional', 'Mine');
  u.run(COLLEAGUE, 'investor', 'institutional', 'Colleague');
  u.run(OTHER, 'investor', 'institutional', 'Other');

  const p = db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?, ?, ?, ?)');
  p.run(PROJ_A, 'p-alpha', 'Alpha', 1);
  p.run(PROJ_B, 'p-beta', 'Beta', 2);
  db.prepare('INSERT INTO deals (id, uid, project_id) VALUES (?, ?, ?)').run(71, 'd-a', PROJ_A);
  db.prepare('INSERT INTO deals (id, uid, project_id) VALUES (?, ?, ?)').run(72, 'd-b', PROJ_B);
  const m = db.prepare('INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (?, ?)');
  m.run(MINE, 71);
  m.run(COLLEAGUE, 71); // the same book, so a race between the two is possible
  m.run(OTHER, 72);
  const pos = db.prepare('INSERT INTO portfolio_positions (uid, project_id, round_name, invested_amount) VALUES (?, ?, ?, ?)');
  pos.run('pos-a', PROJ_A, 'Seed', 500000);
  pos.run('pos-b', PROJ_B, 'Seed', 400000);

  const e = db.prepare(
    `INSERT INTO portfolio_support_entries (uid, project_id, kind, state, hours, summary, outcome, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  e.run('sup-a', PROJ_A, 'intro', 'promised', null, 'Promised an intro to a buyer at Northwind', null, MINE);
  e.run('sup-done', PROJ_A, 'hiring', 'delivered', 2, 'Sat in on two VP Eng loops', 'Offer accepted', MINE);
  e.run('sup-b', PROJ_B, 'board_prep', 'promised', null, 'The other firm’s work', null, OTHER);
  return db;
}

const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });
async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
async function call(db: any, user: number, path: string, init: any = {}) {
  const jwt = await token(user, 'investor');
  return support.fetch(
    new Request(`http://x${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers || {}) },
    }),
    env(db),
  );
}
const patch = (db: any, user: number, uid: string, body: unknown) =>
  call(db, user, `/${uid}`, { method: 'PATCH', body: JSON.stringify(body) });
const rowOf = (db: any, uid: string) =>
  db.prepare('SELECT * FROM portfolio_support_entries WHERE uid = ?').get(uid) as any;
const eventsOf = (db: any, uid: string) => db.prepare(
  `SELECT e.* FROM portfolio_support_entry_events e
     JOIN portfolio_support_entries s ON s.id = e.entry_id
    WHERE s.uid = ? ORDER BY e.revision`,
).all(uid) as any[];

// ------------------------------------------------------------- association

test('the list reports the revision a client must send back', async () => {
  const db = freshDb();
  const body = await (await call(db, MINE, '/')).json() as any;
  const entry = body.entries.find((x: any) => x.uid === 'sup-a');
  assert.equal(entry.revision, 1, 'a row written before the migration reads 1');
  assert.equal(entry.project_uid, 'p-alpha', 'and the record it belongs to, to send back');
});

test('an amendment that names a different company is refused, not applied', async () => {
  // Mutation checked: dropping the record_mismatch check → 200, and sup-a is
  // delivered on the strength of a request that said it meant p-beta.
  const db = freshDb();
  const res = await patch(db, MINE, 'sup-a', { state: 'delivered', project_uid: 'p-beta' });
  assert.equal(res.status, 409);
  const body = await res.json() as any;
  assert.equal(body.code, 'record_mismatch');
  assert.equal(body.project_uid, 'p-alpha', 'the refusal names the company the entry really belongs to');
  assert.equal(body.entry_uid, 'sup-a');
  assert.equal(rowOf(db, 'sup-a').state, 'promised', 'nothing was written');
  assert.equal(eventsOf(db, 'sup-a').length, 0);
});

test('an amendment that names the right company goes through', async () => {
  const db = freshDb();
  const res = await patch(db, MINE, 'sup-a', { state: 'delivered', project_uid: 'p-alpha', expected_revision: 1 });
  assert.equal(res.status, 200);
  const row = rowOf(db, 'sup-a');
  assert.equal(row.state, 'delivered');
  assert.equal(row.revision, 2, 'the revision moved on');
  assert.ok(row.delivered_at, 'and the transition stamped its date');
});

// ---------------------------------------------------------------- conflict

test('a stale revision is refused and the newer work is handed back, not overwritten', async () => {
  // THE DEFECT THIS PACKAGE FIXES. The UPDATE was unconditional, so a second
  // member who had opened the same entry overwrote the first silently.
  // Mutation checked: dropping the expected_revision guard → 200 and the
  // colleague's 'delivered' is replaced by 'withdrawn'.
  const db = freshDb();
  // Both members read revision 1. The colleague saves first.
  assert.equal((await patch(db, COLLEAGUE, 'sup-a', { state: 'delivered', expected_revision: 1 })).status, 200);
  // Now the first member's save lands, still believing it holds revision 1.
  const res = await patch(db, MINE, 'sup-a', { state: 'withdrawn', expected_revision: 1 });
  assert.equal(res.status, 409);
  const body = await res.json() as any;
  assert.equal(body.code, 'changed_since_open');
  assert.equal(body.revision, 2, 'the refusal says where the row has got to');
  assert.equal(body.expected_revision, 1);
  assert.equal(body.item.state, 'delivered', 'and hands back the accepted work');
  assert.equal(body.project_name, 'Alpha', 'naming the record it is about');
  const row = rowOf(db, 'sup-a');
  assert.equal(row.state, 'delivered', 'the colleague’s change survived');
  assert.equal(Number(row.updated_by), COLLEAGUE);
});

test('the guard is in the statement, so a writer that lands mid-save still refuses', async () => {
  // Belt and braces for the window the `expected_revision` check cannot cover:
  // between the handler's own read and its UPDATE. Another writer landing there
  // is simulated by moving the row on inside the batch call itself.
  // Mutation checked: removing `AND revision = ?` from the UPDATE → 200, and
  // the row is written over the other writer's revision.
  const db = freshDb();
  const base = makeD1(db);
  let interfered = false;
  const racing: any = {
    ...base,
    async batch(stmts: any[]) {
      if (!interfered) {
        interfered = true;
        // Another member's amendment commits first.
        db.prepare(`UPDATE portfolio_support_entries SET revision = revision + 1, state = 'withdrawn' WHERE uid = 'sup-a'`).run();
      }
      return base.batch(stmts);
    },
  };
  const jwt = await token(MINE, 'investor');
  const res = await support.fetch(
    new Request('http://x/sup-a', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'delivered', expected_revision: 1 }),
    }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: racing } as any,
  );
  assert.equal(res.status, 409, 'the conditional UPDATE caught it');
  const body = await res.json() as any;
  assert.equal(body.code, 'changed_since_open');
  assert.equal(body.item.state, 'withdrawn', 'and hands back the writer that won');
  const row = rowOf(db, 'sup-a');
  assert.equal(row.state, 'withdrawn', 'this save wrote nothing over it');
  assert.equal(eventsOf(db, 'sup-a').length, 0, 'and recorded no amendment of its own');
});

test('an older client that sends no revision still works on an untouched row', async () => {
  const db = freshDb();
  const res = await patch(db, MINE, 'sup-a', { state: 'delivered' });
  assert.equal(res.status, 200, 'expected_revision is optional');
  assert.equal(rowOf(db, 'sup-a').revision, 2);
});

test('a malformed expected_revision is refused before anything is written', async () => {
  const db = freshDb();
  for (const bad of [0, -1, 1.5, 'two']) {
    const res = await patch(db, MINE, 'sup-a', { state: 'delivered', expected_revision: bad });
    assert.equal(res.status, 400, String(bad));
  }
  assert.equal(rowOf(db, 'sup-a').state, 'promised');
});

// -------------------------------------------------------------- invariants

test('a terminal entry cannot change state, and the refusal names the record', async () => {
  const db = freshDb();
  const res = await patch(db, MINE, 'sup-done', { state: 'withdrawn', expected_revision: 1 });
  assert.equal(res.status, 409);
  const body = await res.json() as any;
  assert.equal(body.code, 'state_is_terminal');
  assert.equal(body.state, 'delivered');
  assert.equal(body.project_name, 'Alpha', 'a page of many entries can say which one');
  assert.match(body.detail, /hours, outcome and description can still be amended/);
  assert.equal(rowOf(db, 'sup-done').state, 'delivered');
});

test('a terminal entry may still be amended, and the amendment is recorded', async () => {
  // The documented policy: the state is final, the record of what happened is
  // not. Before, this went through unattributed and unrecorded.
  const db = freshDb();
  const res = await patch(db, MINE, 'sup-done', { hours: 5, outcome: 'Offer accepted, started in March', expected_revision: 1 });
  assert.equal(res.status, 200);
  const row = rowOf(db, 'sup-done');
  assert.equal(row.hours, 5);
  assert.equal(row.state, 'delivered', 'the state did not move');
  const events = eventsOf(db, 'sup-done');
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'amended');
  assert.equal(events[0].from_state, null, 'no transition, so no from/to');
  assert.deepEqual(JSON.parse(events[0].changed_json).sort(), ['hours', 'outcome']);
});

test('a request that changes nothing is not recorded and does not bump the revision', async () => {
  // Mutation checked: writing unconditionally → revision 2 and a history row
  // that records no change, so a double-click invents an amendment.
  const db = freshDb();
  const res = await patch(db, MINE, 'sup-done', { state: 'delivered', hours: 2, expected_revision: 1 });
  assert.equal(res.status, 200);
  assert.equal((await res.json() as any).unchanged, true);
  assert.equal(rowOf(db, 'sup-done').revision, 1);
  assert.equal(eventsOf(db, 'sup-done').length, 0);
});

test('an empty summary keeps the recorded one rather than blanking it', async () => {
  const db = freshDb();
  await patch(db, MINE, 'sup-a', { summary: '   ', expected_revision: 1 });
  assert.match(rowOf(db, 'sup-a').summary, /Northwind/);
});

// ----------------------------------------------------------------- history

test('every amendment is attributed, append-only and readable', async () => {
  // Mutation checked: not writing the event row → the history is empty and an
  // amendment by a second member is unattributable.
  const db = freshDb();
  await patch(db, MINE, 'sup-a', { hours: 1, expected_revision: 1 });
  await patch(db, COLLEAGUE, 'sup-a', { state: 'delivered', expected_revision: 2 });

  const row = rowOf(db, 'sup-a');
  assert.equal(row.revision, 3);
  assert.equal(Number(row.updated_by), COLLEAGUE, 'the latest amendment is attributed');
  assert.equal(Number(row.recorded_by), MINE, 'and who created it is untouched');

  const body = await (await call(db, MINE, '/sup-a/history')).json() as any;
  assert.equal(body.revision, 3);
  assert.equal(body.items.length, 2);
  assert.deepEqual(body.items.map((x: any) => [x.revision, x.action, x.actor.id]), [
    [2, 'amended', MINE],
    [3, 'delivered', COLLEAGUE],
  ]);
  // promised → delivered stamps the delivery date, so the transition's own
  // field change is recorded with it; nothing the member typed changed.
  assert.deepEqual(body.items[1].changed, ['delivered_at'],
    'the transition records the date it stamped and nothing else');
  assert.deepEqual([body.items[1].from_state, body.items[1].to_state], ['promised', 'delivered']);
  assert.equal(body.items[0].actor.name, 'Mine');
});

test('(entry, revision) is unique, so one revision cannot hold two amendments', async () => {
  const db = freshDb();
  await patch(db, MINE, 'sup-a', { hours: 1, expected_revision: 1 });
  assert.throws(() => db.prepare(
    `INSERT INTO portfolio_support_entry_events (uid, entry_id, revision, action, changed_json, actor_user_id)
     SELECT 'dup', id, 2, 'amended', '[]', ? FROM portfolio_support_entries WHERE uid = 'sup-a'`,
  ).run(MINE), /UNIQUE/i);
});

test('the history of an entry outside the caller’s book is Not found, not empty', async () => {
  // The same wall as the read and the amendment: an absence a caller could
  // mistake for "nothing was recorded" is not an answer.
  const db = freshDb();
  const res = await call(db, OTHER, '/sup-a/history');
  assert.equal(res.status, 404);
  const mine = await call(db, MINE, '/sup-b/history');
  assert.equal(mine.status, 404);
});

test('an amendment to an entry outside the caller’s book is Not found', async () => {
  const db = freshDb();
  const res = await patch(db, MINE, 'sup-b', { state: 'delivered' });
  assert.equal(res.status, 404);
  assert.equal(rowOf(db, 'sup-b').state, 'promised');
});
