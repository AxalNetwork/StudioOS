/**
 * Company scoping, stage 6: the Investor Deals surface.
 *
 * The first surface where the answer is "narrow SOME of this and deliberately
 * not the rest", and the distinction is the whole stage.
 *
 * The deal LIST is a MARKETPLACE. An investor is meant to see deals they have
 * no relationship with yet — that is what the surface is for — so browsing is
 * not narrowed by company, and `deals` gets no company column. What narrows is
 * every claim about THIS firm: `is_member` (am I in the room) and the
 * `scope=mine` filter (invited / committed). Migration 194 puts `company_id`
 * on `deal_invitations` and `commitments`; 193 already did the dealroom.
 *
 * The founder branch is an inlined ownership query and carries the company
 * clause directly, or a founder would see deals for projects the picker had
 * already stopped showing.
 *
 * Harness matches stages 1-5: the real router against real in-memory SQLite
 * with a real `user_company_links` table, so `resolveActiveCompany` is unmocked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import deals from '../src/routes/deals.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const INVESTOR = 42;
const FOUNDER = { user: 50, founder_id: 150 };
const ADMIN = 44;
const FUND_A = 3;
const FUND_B = 5;
const CO_A = 21;          // the founder's company
const CO_B = 22;          // the founder's other company
const PROJ_A = 7;
const PROJ_B = 9;
const DEAL_A = 71;        // on PROJ_A; investor is a member under FUND_A
const DEAL_B = 72;        // on PROJ_B; investor invited under FUND_B
const DEAL_OPEN = 73;     // nobody's relationship — browse-only

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
      investor_subscription_status TEXT, subscription_tier TEXT
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, name TEXT, sector TEXT, founder_id INTEGER,
      company_id INTEGER, deleted_at TEXT
    );
    CREATE TABLE partners (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER, partner_id INTEGER,
      lead_partner_id INTEGER, status TEXT, stage TEXT,
      target_raise REAL, capital_committed REAL, amount REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      stage_changed_at TEXT
    );
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL
    );
    CREATE TABLE investor_dealroom_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT, investor_user_id INTEGER NOT NULL,
      deal_id INTEGER NOT NULL, joined_at TEXT, company_id INTEGER
    );
    -- The two columns migration 194 adds.
    CREATE TABLE deal_invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, deal_id INTEGER NOT NULL,
      investor_user_id INTEGER NOT NULL, invited_by_user_id INTEGER, message TEXT,
      email_opt_in INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'invited',
      responded_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      company_id INTEGER
    );
    CREATE TABLE commitments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, deal_id INTEGER NOT NULL,
      investor_user_id INTEGER NOT NULL, amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), company_id INTEGER
    );
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, founder_id, investor_tier) VALUES (?, ?, ?, ?)');
  u.run(INVESTOR, 'investor', null, 'institutional');
  u.run(FOUNDER.user, 'founder', FOUNDER.founder_id, null);
  u.run(ADMIN, 'admin', null, null);
  const p = db.prepare('INSERT INTO projects (id, name, founder_id, company_id) VALUES (?, ?, ?, ?)');
  p.run(PROJ_A, 'Alpha', FOUNDER.founder_id, CO_A);
  p.run(PROJ_B, 'Beta', FOUNDER.founder_id, CO_B);
  const d = db.prepare('INSERT INTO deals (id, project_id, status) VALUES (?, ?, ?)');
  d.run(DEAL_A, PROJ_A, 'open'); d.run(DEAL_B, PROJ_B, 'open'); d.run(DEAL_OPEN, null, 'open');
  const l = db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)');
  l.run(FUND_A, INVESTOR); l.run(FUND_B, INVESTOR);
  l.run(CO_A, FOUNDER.user); l.run(CO_B, FOUNDER.user);
  db.prepare('INSERT INTO investor_dealroom_members (investor_user_id, deal_id, company_id) VALUES (?, ?, ?)')
    .run(INVESTOR, DEAL_A, FUND_A);
  db.prepare('INSERT INTO deal_invitations (deal_id, investor_user_id, company_id) VALUES (?, ?, ?)')
    .run(DEAL_B, INVESTOR, FUND_B);
  // A commitment in the OTHER fund, so scope=mine exercises both of the tables
  // migration 194 touches rather than only deal_invitations. Note scope=mine is
  // invited-or-committed; dealroom membership is reported by is_member and is
  // deliberately NOT part of this filter.
  db.prepare('INSERT INTO commitments (deal_id, investor_user_id, amount, company_id) VALUES (?, ?, ?, ?)')
    .run(DEAL_A, INVESTOR, 1000, FUND_A);
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

async function list(who: { user: number; role: string }, company?: number | string, query = ''): Promise<any[]> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(who.user, who.role)}` };
  if (company !== undefined) headers['X-Company-Id'] = String(company);
  const res = await deals.request(`/${query}`, { headers }, env(freshDb()));
  assert.equal(res.status, 200);
  return (await res.json()) as any[];
}
const ids = (rows: any[]) => rows.map((r) => Number(r.id)).sort((a, b) => a - b);

const investor = { user: INVESTOR, role: 'investor' };
const founder = { user: FOUNDER.user, role: 'founder' };
const admin = { user: ADMIN, role: 'admin' };

test('the deal list is a marketplace and is NOT narrowed by company', async () => {
  // The point of the surface is deals you have no relationship with yet.
  // Narrowing this would hide what an investor could invest in and make the
  // switcher look broken.
  for (const co of [FUND_A, FUND_B, undefined]) {
    assert.deepEqual(ids(await list(investor, co)), [DEAL_A, DEAL_B, DEAL_OPEN], `company=${co}`);
  }
});

test('is_member is a claim about THIS firm, so it does narrow', async () => {
  // The dealroom was joined under FUND_A. Under FUND_B the same card must read
  // as "Join room", not as membership.
  const underA = await list(investor, FUND_A);
  assert.equal(underA.find((d) => d.id === DEAL_A).is_member, 1);
  const underB = await list(investor, FUND_B);
  assert.equal(underB.find((d) => d.id === DEAL_A).is_member, 0, 'membership must not leak across firms');
});

test('scope=mine narrows to the relationships the active company owns', async () => {
  // DEAL_A via a dealroom membership in FUND_A; DEAL_B via an invitation in FUND_B.
  assert.deepEqual(ids(await list(investor, FUND_A, '?scope=mine')), [DEAL_A]);
  assert.deepEqual(ids(await list(investor, FUND_B, '?scope=mine')), [DEAL_B]);
});

test('no company and a forged company both leave every relationship visible', async () => {
  assert.deepEqual(ids(await list(investor, undefined, '?scope=mine')), [DEAL_A, DEAL_B]);
  assert.deepEqual(ids(await list(investor, 999, '?scope=mine')), [DEAL_A, DEAL_B], 'forged id dropped');
});

test('the founder branch narrows by the project company', async () => {
  // An inlined ownership query: without the clause a founder would see deals
  // for projects the project picker had already stopped showing.
  assert.deepEqual(ids(await list(founder, CO_A)), [DEAL_A]);
  assert.deepEqual(ids(await list(founder, CO_B)), [DEAL_B]);
  assert.deepEqual(ids(await list(founder)), [DEAL_A, DEAL_B], 'no company selected');
});

test('admin is unscoped', async () => {
  assert.deepEqual(ids(await list(admin, FUND_A)), [DEAL_A, DEAL_B, DEAL_OPEN]);
});
