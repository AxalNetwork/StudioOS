/**
 * Company scoping, stage 5: the Investor Portfolio surfaces.
 *
 * The first stage that could not inherit a company through migration 189, and
 * the first that needed schema of its own.
 *
 * A founder's data hangs off a project, and a project has a `company_id`. An
 * investor's does not: the projects they can see are DERIVED from explicit
 * relationships — dealroom membership, introductions, a converted watchlist
 * item — and every one of those rows is keyed on a user id alone. Migration 193
 * puts `company_id` on the relationship rows, and `investorProjectIds` filters
 * on it.
 *
 * Three groupings in this schema could each have been "the investor's firm" —
 * `user_company_links`, the billing seat (`investor_seat_primary_user_id`), and
 * `vc_funds.gp_user_id`. The first was chosen, so the control a person clicks
 * is the thing that scopes and the switcher means one thing in every role.
 * Migration 193's header records the other two and why they were not.
 *
 * Harness matches stages 1-4: the real router against real in-memory SQLite
 * with a real `user_company_links` table, so `resolveActiveCompany` runs
 * unmocked and a forged header is refused by the code prod uses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import positions from '../src/routes/positions.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const INVESTOR = 42;
const ADMIN = 44;
const FUND_A = 3;         // the investor's fund that holds the DEAL relationship
const FUND_B = 5;         // their other fund
const PROJ_A = 7;         // reached through a dealroom membership in FUND_A
const PROJ_B = 9;         // reached through an introduction in FUND_B
const PROJ_NONE = 11;     // relationship with no company — visible everywhere
const DEAL_A = 71;

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
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
      investor_seat_primary_user_id INTEGER, investor_tier TEXT,
      investor_subscription_status TEXT, subscription_tier TEXT
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, uid TEXT, name TEXT NOT NULL, founder_id INTEGER,
      company_id INTEGER, sector TEXT, stage TEXT, status TEXT, deleted_at TEXT
    );
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL
    );
    CREATE TABLE deals (id INTEGER PRIMARY KEY, project_id INTEGER);
    -- The three relationship tables, each with the company_id migration 193 adds.
    CREATE TABLE investor_dealroom_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT, investor_user_id INTEGER NOT NULL,
      deal_id INTEGER NOT NULL, joined_at TEXT, company_id INTEGER
    );
    CREATE TABLE investor_introductions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, investor_user_id INTEGER NOT NULL,
      founder_user_id INTEGER, founder_id INTEGER, project_id INTEGER,
      message TEXT, status TEXT, quarter TEXT, created_at TEXT, company_id INTEGER
    );
    CREATE TABLE watchlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, owner_user_id INTEGER NOT NULL,
      project_id INTEGER, converted_deal_id INTEGER, company_id INTEGER
    );
    CREATE TABLE portfolio_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
      invested_amount REAL, position_date TEXT, ownership_pct REAL,
      round_name TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
    -- investor_seats is NOT created here on purpose. ensureInvestorPaywallSchema
    -- creates it, and a fixture table that merely resembles the real one blocks
    -- its CREATE TABLE IF NOT EXISTS and then fails on the first column the
    -- real shape has and the copy does not (seat_email, learned the hard way).
    -- Letting the bootstrap own a table it already owns is always safer than
    -- transcribing it.
  `);
  const u = db.prepare('INSERT INTO users (id, role, investor_tier) VALUES (?, ?, ?)');
  u.run(INVESTOR, 'investor', 'institutional');
  u.run(ADMIN, 'admin', null);
  const p = db.prepare('INSERT INTO projects (id, name, company_id) VALUES (?, ?, ?)');
  p.run(PROJ_A, 'Reached via FUND_A', null);
  p.run(PROJ_B, 'Reached via FUND_B', null);
  p.run(PROJ_NONE, 'Relationship has no company', null);
  const l = db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)');
  l.run(FUND_A, INVESTOR); l.run(FUND_B, INVESTOR);
  db.prepare('INSERT INTO deals (id, project_id) VALUES (?, ?)').run(DEAL_A, PROJ_A);
  // One relationship of each kind, in different companies.
  db.prepare('INSERT INTO investor_dealroom_members (investor_user_id, deal_id, company_id) VALUES (?, ?, ?)')
    .run(INVESTOR, DEAL_A, FUND_A);
  const i = db.prepare('INSERT INTO investor_introductions (investor_user_id, project_id, company_id) VALUES (?, ?, ?)');
  i.run(INVESTOR, PROJ_B, FUND_B);
  i.run(INVESTOR, PROJ_NONE, null);   // backfilled nothing — no primary company
  const pos = db.prepare('INSERT INTO portfolio_positions (project_id, invested_amount) VALUES (?, ?)');
  pos.run(PROJ_A, 100); pos.run(PROJ_B, 200); pos.run(PROJ_NONE, 300);
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

async function listed(who: { user: number; role: string }, company?: number | string): Promise<number[]> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(who.user, who.role)}` };
  if (company !== undefined) headers['X-Company-Id'] = String(company);
  const res = await positions.request('/', { headers }, env(freshDb()));
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  const rows = Array.isArray(body) ? body : (body.items ?? body.positions ?? []);
  return rows.map((r: any) => Number(r.project_id ?? r.project?.id)).filter(Number.isFinite).sort((a: number, b: number) => a - b);
}

const investor = { user: INVESTOR, role: 'investor' };
const admin = { user: ADMIN, role: 'admin' };

test('positions narrow to the relationships owned by the active company', async () => {
  // PROJ_NONE rides along under both: its relationship has no company, which is
  // what migration 193 leaves for an investor with no primary company.
  assert.deepEqual(await listed(investor, FUND_A), [PROJ_A, PROJ_NONE]);
  assert.deepEqual(await listed(investor, FUND_B), [PROJ_B, PROJ_NONE]);
});

test('no company selected lists every relationship the investor has', async () => {
  // The single-fund case, and the case before the switcher is ever touched.
  assert.deepEqual(await listed(investor), [PROJ_A, PROJ_B, PROJ_NONE]);
});

test('a forged company id neither widens nor narrows', async () => {
  // 999 is a real-looking id the investor is not a member of; resolveActiveCompany
  // checks it against user_company_links and yields null, so the answer must be
  // identical to sending no header at all.
  assert.deepEqual(await listed(investor, 999), [PROJ_A, PROJ_B, PROJ_NONE]);
  assert.deepEqual(await listed(investor, 'not-a-number'), [PROJ_A, PROJ_B, PROJ_NONE]);
});

test('admin is unscoped — investorProjectIds returns null for operators', async () => {
  // isInvestor() is false for an admin, so the function returns null meaning
  // "portfolio-wide", and the company clause is never reached. Selecting a
  // company must not turn an operator view into a tenant view.
  assert.deepEqual(await listed(admin, FUND_A), [PROJ_A, PROJ_B, PROJ_NONE]);
});
