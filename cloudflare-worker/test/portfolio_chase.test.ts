/**
 * D464 — the chase log, and the quarter-end read.
 *
 * THE CHASE (migration 337). Canvas IP2's "Chase all overdue" and the
 * Portfolio canvas's per-company Nudge are the same act: an investor asks a
 * silent company for its update. `POST /portfolio/chase` logs one row per
 * company and notifies the founder; the tenancy check is on the project, not
 * on the page's overdue list; a repeat chase inside the hour answers the
 * existing row rather than re-notifying.
 *
 * THE QUARTER-END READ. `GET /positions/analytics` accepts `as_of`, and it
 * now cuts the flows AND the marks at the date — a quarter-end export must
 * not count a wire that landed after it or price the book with a mark that
 * did not exist yet.
 *
 * Harness: the real routers against in-memory SQLite, with the app's onError
 * mapping replicated.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import portfolio from '../src/routes/portfolio.ts';
import positions from '../src/routes/positions.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const app = new Hono();
app.onError((err: any, c: any) => {
  const msg = String(err?.message || '');
  if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
  if (msg === 'Forbidden' || msg === 'Admin required') return c.json({ detail: msg }, 403);
  return c.json({ detail: 'Internal server error' }, 500);
});
app.route('/api/portfolio', portfolio);
app.route('/api/positions', positions);

const INVESTOR = 42;
const OUTSIDER = 43;
const ADMIN = 44;
const FOUNDER = 50;
const PROJ = 7;
const PROJ_OUT = 9;

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
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, name TEXT, email TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
      investor_tier TEXT, partner_id INTEGER, founder_id INTEGER,
      investor_seat_primary_user_id INTEGER
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, uid TEXT, name TEXT, founder_id INTEGER,
      company_id INTEGER, deleted_at TEXT
    );
    CREATE TABLE portfolio_update_chases (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      project_id INTEGER NOT NULL, chased_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE investor_dealroom_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT, investor_user_id INTEGER NOT NULL,
      deal_id INTEGER NOT NULL, company_id INTEGER
    );
    CREATE TABLE investor_introductions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, investor_user_id INTEGER NOT NULL,
      project_id INTEGER, company_id INTEGER, quarter TEXT
    );
    CREATE TABLE watchlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, owner_user_id INTEGER NOT NULL,
      converted_deal_id INTEGER, company_id INTEGER
    );
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER,
      status TEXT NOT NULL DEFAULT 'applied'
    );
    CREATE TABLE portfolio_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, project_id INTEGER,
      fund_id INTEGER, round_name TEXT, invested_amount REAL,
      position_date TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE portfolio_marks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, project_id INTEGER,
      fund_id INTEGER, as_of_date TEXT, fmv REAL, post_money REAL,
      event TEXT, basis TEXT, source TEXT, note TEXT, created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE portfolio_distributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, project_id INTEGER,
      fund_id INTEGER, distribution_date TEXT, amount REAL, kind TEXT,
      note TEXT, created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, name, founder_id) VALUES (?, ?, ?, ?)');
  u.run(INVESTOR, 'investor', 'Ingrid Investor', null);
  u.run(OUTSIDER, 'investor', 'Otto Outsider', null);
  u.run(ADMIN, 'admin', 'Ada Admin', null);
  u.run(FOUNDER, 'founder', 'Fred Founder', 9);
  db.prepare("INSERT INTO projects (id, uid, name, founder_id) VALUES (?, 'p-alpha', 'Alpha', 9)").run(PROJ);
  db.prepare("INSERT INTO projects (id, uid, name, founder_id) VALUES (?, 'p-beta', 'Beta', null)").run(PROJ_OUT);
  // The investor's book: a deal on PROJ, and membership in its room.
  db.prepare("INSERT INTO deals (id, uid, project_id) VALUES (71, 'd-alpha', ?)").run(PROJ);
  db.prepare('INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (?, 71)').run(INVESTOR);
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

async function call(
  who: { user: number; role: string },
  path: string,
  init: { method?: string; body?: any } = {},
  db: InstanceType<typeof DatabaseSync> = freshDb(),
): Promise<{ status: number; body: any; db: InstanceType<typeof DatabaseSync> }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
    'Content-Type': 'application/json',
  };
  const res = await app.request(path, {
    method: init.method || 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, env(db));
  const body = await res.json().catch(() => null);
  return { status: res.status, body, db };
}

// ── The chase ──────────────────────────────────────────────────────────────

test('a chase is logged per company, and the tenancy check is on the project', async () => {
  const db = freshDb();
  const r = await call({ user: INVESTOR, role: 'investor' }, '/api/portfolio/chase', {
    method: 'POST', body: { project_ids: [PROJ, PROJ_OUT] },
  }, db);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.chased.map((c: any) => c.project_id), [PROJ]);
  assert.deepEqual(r.body.skipped, [PROJ_OUT], 'a project outside the book is skipped, not chased');
  const rows = db.prepare('SELECT project_id, chased_by FROM portfolio_update_chases').all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].chased_by, INVESTOR);
});

test('a repeat chase inside the hour answers the existing row', async () => {
  const db = freshDb();
  const first = await call({ user: INVESTOR, role: 'investor' }, '/api/portfolio/chase', { method: 'POST', body: { project_ids: [PROJ] } }, db);
  assert.equal(first.body.chased[0].already, false);
  const second = await call({ user: INVESTOR, role: 'investor' }, '/api/portfolio/chase', { method: 'POST', body: { project_ids: [PROJ] } }, db);
  assert.equal(second.body.chased[0].already, true, 'a double-click is not a second ask');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM portfolio_update_chases').get() as any).n, 1);
});

test('the chase log reads back, scoped to the chaser', async () => {
  const db = freshDb();
  await call({ user: INVESTOR, role: 'investor' }, '/api/portfolio/chase', { method: 'POST', body: { project_ids: [PROJ] } }, db);
  const read = await call({ user: INVESTOR, role: 'investor' }, '/api/portfolio/chases', {}, db);
  assert.equal(read.status, 200);
  assert.equal(read.body.items.length, 1);
  assert.equal(read.body.items[0].project_name, 'Alpha');
  const other = await call({ user: OUTSIDER, role: 'investor' }, '/api/portfolio/chases', {}, db);
  assert.equal(other.body.items.length, 0, 'another investor’s chase is not in this log');
});

test('a founder may not chase', async () => {
  const r = await call({ user: FOUNDER, role: 'founder' }, '/api/portfolio/chase', { method: 'POST', body: { project_ids: [PROJ] } });
  assert.equal(r.status, 403);
});

// ── The quarter-end read ───────────────────────────────────────────────────

test('as_of cuts the flows and the marks at the date', async () => {
  const db = freshDb();
  // A position contributed in March, a distribution in May, and two marks:
  // one at the quarter end, one after it.
  db.prepare(`INSERT INTO portfolio_positions (uid, project_id, invested_amount, position_date)
              VALUES ('pos-1', ?, 1000000, '2026-03-10')`).run(PROJ);
  db.prepare(`INSERT INTO portfolio_marks (uid, project_id, as_of_date, fmv, basis)
              VALUES ('m-1', ?, '2026-03-31', 1200000, 'gp_estimate'), ('m-2', ?, '2026-05-02', 900000, 'write_down')`).run(PROJ, PROJ);
  db.prepare(`INSERT INTO portfolio_distributions (uid, project_id, distribution_date, amount, kind)
              VALUES ('dist-1', ?, '2026-05-12', 50000, 'dividend')`).run(PROJ);

  const admin = { user: ADMIN, role: 'admin' };
  const now = await call(admin, '/api/positions/analytics', {}, db);
  assert.equal(now.status, 200);
  assert.equal(now.body.nav, 900000, 'today’s read prices the latest mark');
  assert.equal(now.body.distributed, 50000);

  const quarterEnd = await call(admin, '/api/positions/analytics?as_of=2026-03-31', {}, db);
  assert.equal(quarterEnd.status, 200);
  assert.equal(quarterEnd.body.as_of, '2026-03-31', 'the date the figures speak for is echoed');
  assert.equal(quarterEnd.body.nav, 1200000, 'the quarter-end read prices the mark that existed then');
  assert.equal(quarterEnd.body.distributed, 0, 'the May distribution is not in the March quarter');
});
