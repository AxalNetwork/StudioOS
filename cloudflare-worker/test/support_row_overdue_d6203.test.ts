/**
 * D6203 (#6203) — the support ledger's read gives each entry its own Overdue, by the Worker's date and the rule
 * `totals.overdue` counts with, so the Value-add page never measures a due date against the browser's clock; and
 * `state=open` reads both open states (promised and in progress), so Outstanding keeps work that started. The real
 * router over node:sqlite, on the ledger's tables as the migrations build them. Every identity is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/support_row_overdue_d6203.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import support from '../src/routes/portfolio_support.ts';
import { applySupportLedgerSchema } from './_support_ledger_schema.mjs';

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
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
  `);
  // D6202: the ledger's tables from the real migrations (237, D4642, D6202), not a copy of their DDL.
  applySupportLedgerSchema(db);
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

const PAST = '2000-01-31';
const FUTURE = '2999-12-31';
const setRow = (db: any, uid: string, state: string, due: string | null) =>
  db.prepare('UPDATE portfolio_support_entries SET state = ?, due_date = ? WHERE uid = ?').run(state, due, uid);
const list = async (db: any, query = '') => (await (await call(db, MINE, `/${query}`)).json()) as any;
const entry = (body: any, uid: string) => body.entries.find((e: any) => e.uid === uid);

test("each entry's overdue is the Worker's, and agrees with totals.overdue", async () => {
  // Mutation checked: dropping the state test from the row's CASE marks the delivered entry overdue, and this fails.
  const db = freshDb();
  setRow(db, 'sup-a', 'in_progress', PAST);      // open and past due
  setRow(db, 'sup-done', 'delivered', PAST);     // closed: never overdue
  const e = db.prepare(
    `INSERT INTO portfolio_support_entries (uid, project_id, kind, state, summary, recorded_by, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  e.run('sup-later', PROJ_A, 'customer', 'promised', 'A buyer call next year', MINE, FUTURE);
  e.run('sup-undated', PROJ_A, 'other', 'promised', 'No date set', MINE, null);
  const body = await list(db);
  assert.equal(entry(body, 'sup-a').overdue, true, 'an open entry past its due date is overdue');
  assert.equal(entry(body, 'sup-done').overdue, false, 'a delivered entry is never overdue');
  assert.equal(entry(body, 'sup-later').overdue, false, 'a due date still ahead is not overdue');
  assert.equal(entry(body, 'sup-undated').overdue, false, 'an entry with no due date is never overdue');
  assert.equal(typeof entry(body, 'sup-undated').overdue, 'boolean', 'a flag, not a 0 or 1 the page must interpret');
  assert.equal(body.totals.overdue, body.entries.filter((x: any) => x.overdue).length, 'the rows and the figure count the same entries');
});

test('state=open reads promised and in-progress entries together, and its matching total follows', async () => {
  // Mutation checked: removing the open clause from the WHERE leaves the in-progress entry out, and this fails.
  const db = freshDb();
  setRow(db, 'sup-a', 'in_progress', null);
  const e = db.prepare(
    `INSERT INTO portfolio_support_entries (uid, project_id, kind, state, summary, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  e.run('sup-open', PROJ_A, 'customer', 'promised', 'Still promised', MINE);
  e.run('sup-gone', PROJ_A, 'other', 'cancelled', 'Called off', MINE);
  const body = await list(db, '?state=open');
  assert.deepEqual(body.entries.map((x: any) => x.uid).sort(), ['sup-a', 'sup-open']);
  assert.equal(body.filter.state, 'open');
  assert.equal(body.page.matching_total, 2);
  const promisedOnly = await list(db, '?state=promised');
  assert.deepEqual(promisedOnly.entries.map((x: any) => x.uid), ['sup-open'], 'a single state still reads only that state');
  const junk = await list(db, '?state=everything');
  assert.equal(junk.filter.state, null, 'an unknown state is no filter, as before');
});
