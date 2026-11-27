/**
 * #8899 — `GET /api/private-data/portfolio/metrics` answers its admin overview
 * to admins only.
 *
 * The handler answers a founder and a partner or investor from their own
 * branches and used to hand every other signed-in role the admin overview:
 * every live project, the deal counts and the limited partners' committed and
 * called totals. This file pins, on real SQLite (node:sqlite speaks D1's
 * dialect), with made-up accounts only:
 *
 *   1. an advisor and an `exploring` member get the house refusal (403,
 *      `error: 'admin_required'`, our sentence on `message` and `detail`) and
 *      no figure from the overview;
 *   2. an admin gets the overview, counted from the fixture;
 *   3. the founder, partner and investor views are what they were.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/portfolio_metrics_admin_gate_8899.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import privateData from '../src/routes/private-data.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { REQUIRE_ADMIN_MFA_KEY } from '../src/services/adminMfaPolicy.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

// Accounts. Every name and address is made up.
const ADMIN = 1;
const FOUNDER = 2;     // founder_id 20, owns project 100
const PARTNER = 3;     // partner_id 30, one deal
const INVESTOR = 4;
const ADVISOR = 5;
const EXPLORING = 6;
const ROLE: Record<number, string> = {
  [ADMIN]: 'admin', [FOUNDER]: 'founder', [PARTNER]: 'partner', [INVESTOR]: 'investor',
  [ADVISOR]: 'advisor', [EXPLORING]: 'exploring',
};

function freshDb(opts: { adminMfaRequired?: boolean } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, partner_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT, tfa_methods TEXT
    );
    CREATE TABLE platform_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by INTEGER);
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, name TEXT, sector TEXT, stage TEXT, status TEXT,
      founder_id INTEGER, company_id INTEGER, deleted_at TEXT
    );
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL
    );
    CREATE TABLE company_profiles (id INTEGER PRIMARY KEY, archived_at TEXT);
    CREATE TABLE limited_partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT, fund_id INTEGER NOT NULL DEFAULT 1,
      commitment_amount REAL NOT NULL DEFAULT 0, invested_amount REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, partner_id INTEGER,
      status TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // The founder branch reads it through getVerifiedLatestSnapshot; the
  // production columns, from the baseline.
  db.exec(stripForeignKeys(tableFromBaseline(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'), 'score_snapshots')));
  if (opts.adminMfaRequired) db.prepare(`INSERT INTO platform_settings (key, value) VALUES (?, '1')`).run(REQUIRE_ADMIN_MFA_KEY);
  const u = db.prepare('INSERT INTO users (id, role, founder_id, partner_id, name, email) VALUES (?,?,?,?,?,?)');
  for (const [id, role] of Object.entries(ROLE)) {
    u.run(Number(id), role, Number(id) === FOUNDER ? 20 : null, Number(id) === PARTNER ? 30 : null,
      `Test ${role}`, `${role}@example.test`);
  }
  const p = db.prepare('INSERT INTO projects (id, name, sector, status, founder_id, deleted_at) VALUES (?,?,?,?,?,?)');
  p.run(100, 'Testventure One', 'DevTools', 'tier_1', 20, null);
  p.run(101, 'Testventure Two', 'Climate', 'spinout', 21, null);
  p.run(102, 'Testventure Draft', 'Health', 'draft', 22, null);
  p.run(103, 'Testventure Gone', 'Health', 'active', 22, '2026-01-01 00:00:00');
  const d = db.prepare('INSERT INTO deals (project_id, partner_id, status) VALUES (?,?,?)');
  d.run(100, 30, 'active');
  d.run(101, 31, 'applied');
  d.run(102, 31, 'closed');
  const l = db.prepare('INSERT INTO limited_partners (commitment_amount, invested_amount) VALUES (?,?)');
  l.run(1000, 250);
  l.run(3000, 750);
  return db;
}

const app = new Hono<any>();
app.route('/api/private-data', privateData);
// As `index.ts`'s onError: a thrown gate sentence is its mapped status.
app.onError((err: any, c) => {
  const msg = String(err?.message || '');
  return c.json({ detail: msg }, (AUTH_ERROR_STATUSES[msg] as any) || 500);
});

async function metrics(as: number, opts: { adminMfaRequired?: boolean } = {}) {
  const token = await new SignJWT({ user_id: as, role: ROLE[as] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(freshDb(opts)) };
  const res = await app.request('/api/private-data/portfolio/metrics', { headers: { Authorization: `Bearer ${token}` } }, env);
  return { status: res.status, body: await res.json() as any };
}

const ids = (rows: any[] | undefined) => (rows || []).map((r: any) => Number(r.id)).sort((a, b) => a - b);

test('1. an advisor and an exploring member are refused, with nothing from the overview', async () => {
  for (const who of [ADVISOR, EXPLORING]) {
    const r = await metrics(who);
    assert.equal(r.status, 403, `${ROLE[who]} must be refused`);
    assert.equal(r.body.error, 'admin_required', `${ROLE[who]}: the refusal carries its code`);
    assert.equal(r.body.message, 'The portfolio overview is open to admins only.');
    assert.equal(r.body.detail, r.body.message);
    for (const key of ['overview', 'portfolio', 'fund_metrics', 'deals', 'projects', 'role']) {
      assert.equal(key in r.body, false, `${ROLE[who]}: the refusal carries no \`${key}\``);
    }
  }
});

test('2. an admin gets the overview, counted from every live row', async () => {
  const r = await metrics(ADMIN);
  assert.equal(r.status, 200);
  assert.equal(r.body.role, 'admin');
  assert.deepEqual(r.body.overview, {
    total_projects: 3, active_projects: 2, total_deals: 3, active_deals: 2,
    total_committed: 4000, total_called: 1000,
  });
  assert.deepEqual(ids(r.body.portfolio), [100, 101]);
});

test('3. the founder view is unchanged: their own projects only', async () => {
  const r = await metrics(FOUNDER);
  assert.equal(r.status, 200);
  assert.equal(r.body.role, 'founder');
  assert.equal(r.body.total_projects, 1);
  assert.deepEqual(ids(r.body.projects), [100]);
  assert.equal('overview' in r.body, false);
});

test('3. the partner and investor views are unchanged', async () => {
  const partner = await metrics(PARTNER);
  assert.equal(partner.status, 200);
  assert.equal(partner.body.role, 'partner');
  assert.equal(partner.body.total_deals, 1);
  assert.equal(partner.body.active_deals, 1);
  assert.deepEqual(partner.body.deals.map((d: any) => d.project_id), [100]);
  assert.deepEqual(partner.body.fund_metrics, { total_committed: 4000, total_called: 1000, called_pct: 0.25, portfolio_companies: 2 });
  assert.deepEqual(ids(partner.body.portfolio), [100, 101]);
  assert.equal('overview' in partner.body, false);

  const investor = await metrics(INVESTOR);
  assert.equal(investor.status, 200);
  assert.equal(investor.body.role, 'investor');
  assert.equal(investor.body.total_deals, 0, 'an investor with no partner record has no deals');
  assert.equal(investor.body.fund_metrics.portfolio_companies, 2);
  assert.deepEqual(ids(investor.body.portfolio), [100, 101]);
  assert.equal('overview' in investor.body, false);
});
