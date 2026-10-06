/**
 * D614 (#1307) — four gates on deal rooms and co-invest, on a real node:sqlite
 * database.
 *
 *   1. Join refuses a deal that does not exist (404 `deal_not_found`), writes
 *      nothing, and so uses no room quota.
 *   2. Leave is open on every plan: the Professional gate on /api/deals/*
 *      exempts that one route, so a Free investor can leave the rooms they
 *      joined while still being refused the deal list.
 *   3. Co-invest (`GET /api/funds/syndication`) is Institutional for an
 *      investor, with the paywall's own 402 body; admins and partners pass.
 *   4. Creating a deal with a status the table does not allow is a 400 that
 *      names the allowed statuses, not a 500 from the CHECK.
 *
 * Each gate is asserted from both sides.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/dealroom_coinvest_gates_d614.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deals from '../src/routes/deals.ts';
import funds from '../src/routes/funds.ts';
import { requireInvestorTierExcept, INVESTOR_PRO_EXEMPT } from '../src/middleware/requireInvestorTier.ts';
import { makeD1 } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADMIN = 1;
const FREE = 10;          // investor, Free
const PRO = 11;           // investor, Professional
const INST = 12;          // investor, Institutional
const PARTNER = 20;
const FOUNDER = 30;       // founder_id 300, owns project 1

const USERS: Array<[number, string, string | null, number | null]> = [
  [ADMIN, 'admin', null, null],
  [FREE, 'investor', 'free', null],
  [PRO, 'investor', 'professional', null],
  [INST, 'investor', 'institutional', null],
  [PARTNER, 'partner', null, null],
  [FOUNDER, 'founder', null, 300],
];
const ROLE = new Map(USERS.map(([id, role]) => [id, role]));

const DEAL = 5;           // a real deal
const ROOM = 6;           // a real deal FREE joined before dropping to Free

const SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1,
  founder_id INTEGER, jwt_min_iat INTEGER, subscription_tier TEXT,
  investor_tier TEXT, investor_subscription_status TEXT, investor_dealroom_max INTEGER,
  investor_seat_primary_user_id INTEGER, investor_subscription_renews_at TEXT);
CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, sector TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT, status TEXT);
CREATE TABLE partners (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, partner_id INTEGER, lead_partner_id INTEGER,
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','scored','active','funded','rejected')),
  notes TEXT, amount REAL, source TEXT, stage_changed_at TEXT, pass_reason TEXT, pass_note TEXT, passed_at TEXT,
  passed_by_user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
CREATE TABLE deal_stage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER, from_stage TEXT, to_stage TEXT, kind TEXT,
  days_in_from REAL, actor_user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE investor_dealroom_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT, investor_user_id INTEGER NOT NULL, deal_id INTEGER NOT NULL,
  joined_at TEXT DEFAULT CURRENT_TIMESTAMP, company_id INTEGER, UNIQUE(investor_user_id, deal_id));
CREATE TABLE user_company_links (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
CREATE TABLE deal_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER, investor_user_id INTEGER, company_id INTEGER, status TEXT);
CREATE TABLE commitments (id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER, investor_user_id INTEGER, amount REAL, company_id INTEGER, status TEXT);
CREATE TABLE vc_funds (id INTEGER PRIMARY KEY, name TEXT, gp_user_id INTEGER, company_id INTEGER);
CREATE TABLE subsidiaries (id INTEGER PRIMARY KEY, deal_id INTEGER, subsidiary_name TEXT);
CREATE TABLE secondary_listings (
  id INTEGER PRIMARY KEY, user_id INTEGER, subsidiary_id INTEGER, shares INTEGER, asking_price_cents INTEGER,
  ai_valuation_cents INTEGER, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE queue_jobs (id INTEGER PRIMARY KEY, job_type TEXT, payload TEXT, status TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
`;

function seed(): string {
  const users = USERS.map(([id, role, tier, founderId]) =>
    `(${id}, 'u${id}@example.test', 'U${id}', '${role}', 1, ${founderId ?? 'NULL'}, ${tier ? `'${tier}'` : 'NULL'})`).join(', ');
  return `
INSERT INTO users (id, email, name, role, is_active, founder_id, investor_tier) VALUES ${users};
INSERT INTO projects (id, name, founder_id) VALUES (1, 'Co', 300);
INSERT INTO deals (id, project_id, status) VALUES (${DEAL}, 1, 'applied'), (${ROOM}, 1, 'active');
INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (${FREE}, ${ROOM});
INSERT INTO subsidiaries (id, deal_id, subsidiary_name) VALUES (1, ${DEAL}, 'Sub Co');
INSERT INTO secondary_listings (id, user_id, subsidiary_id, shares, asking_price_cents) VALUES (1, ${FREE}, 1, 10, 10000);
`;
}

function makeEnv(): any {
  const { DB, db } = makeD1(SCHEMA, seed());
  return { JWT_SECRET, ENVIRONMENT: 'development', DB, __db: db };
}

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: ROLE.get(userId) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(app: any, env: any, userId: number, path: string, init: RequestInit = {}) {
  const res: Response = await app.request(path, {
    ...init,
    headers: { Authorization: `Bearer ${await token(userId)}`, 'content-type': 'application/json', ...(init.headers || {}) },
  }, env).catch((e: unknown) => {
    if (e instanceof Response) return e;
    throw e;
  });
  let body: any = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}

/** /api/deals as index.ts mounts it: the Professional gate, then the router. */
function gatedDeals(): Hono<any> {
  const app = new Hono<any>();
  const gate = requireInvestorTierExcept('professional');
  app.use('/api/deals', gate);
  app.use('/api/deals/*', gate);
  app.route('/api/deals', deals);
  return app;
}

const rooms = (env: any, userId: number) =>
  env.__db.prepare(`SELECT deal_id FROM investor_dealroom_members WHERE investor_user_id = ? ORDER BY deal_id`)
    .all(userId).map((r: any) => Number(r.deal_id));

// ── 1. Join checks the deal ────────────────────────────────────────────

test('join: an unknown deal is a 404 and writes no membership, so no quota is used', async () => {
  const env = makeEnv();
  const r = await call(deals, env, PRO, '/999/dealroom/join', { method: 'POST' });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'deal_not_found');
  assert.deepEqual(rooms(env, PRO), [], 'a membership was written for a deal that does not exist');
  // The slot is still free: the next real join counts as the first.
  const ok = await call(deals, env, PRO, `/${DEAL}/dealroom/join`, { method: 'POST' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.used, 1);
  assert.deepEqual(rooms(env, PRO), [DEAL]);
});

// ── 2. Leave is open on every plan ─────────────────────────────────────

test('leave: a Free investor can leave a room they joined, and still cannot list deals', async () => {
  const env = makeEnv();
  const app = gatedDeals();
  const left = await call(app, env, FREE, `/api/deals/${ROOM}/dealroom/leave`, { method: 'DELETE' });
  assert.equal(left.status, 200);
  assert.deepEqual(rooms(env, FREE), [], 'the Free investor is still in the room');
  const list = await call(app, env, FREE, '/api/deals');
  assert.equal(list.status, 402);
  assert.equal(list.body.required, 'professional');
  const join = await call(app, env, FREE, `/api/deals/${DEAL}/dealroom/join`, { method: 'POST' });
  assert.equal(join.status, 402, 'joining is not exempt');
  // The exemption is the DELETE only: another method on the same path is gated.
  const post = await call(app, env, FREE, `/api/deals/${ROOM}/dealroom/leave`, { method: 'POST' });
  assert.equal(post.status, 402);
  // A Professional investor lists as before.
  assert.equal((await call(app, env, PRO, '/api/deals')).status, 200);
});

test('the exemption list is that one route, and index.ts mounts the gate that reads it', () => {
  assert.deepEqual(INVESTOR_PRO_EXEMPT.map((e) => [e.method, e.path.source]),
    [['DELETE', '^\\/api\\/deals\\/[^/]+\\/dealroom\\/leave\\/?$']]);
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/index.ts'), 'utf8');
  assert.match(src, /const investorPro = requireInvestorTierExcept\('professional'\);\s*for \(const p of INVESTOR_PRO_PREFIXES\) \{\s*app\.use\(p, investorPro\);\s*app\.use\(`\$\{p\}\/\*`, investorPro\);/);
});

// ── 3. Co-invest is Institutional ──────────────────────────────────────

test('co-invest: a Professional investor gets the Institutional paywall; Institutional, admin and partner read it', async () => {
  const env = makeEnv();
  for (const who of [FREE, PRO]) {
    const r = await call(funds, env, who, '/syndication');
    assert.equal(r.status, 402, `investor ${who} read co-invest`);
    assert.equal(r.body.error, 'investor_tier_required');
    assert.equal(r.body.required, 'institutional');
    assert.ok(!('co_invest_listings' in r.body), 'the listings leaked with the paywall');
  }
  for (const who of [INST, ADMIN, PARTNER]) {
    const r = await call(funds, env, who, '/syndication');
    assert.equal(r.status, 200, `user ${who} was refused co-invest`);
    assert.equal(r.body.co_invest_listings.length, 1);
  }
  // A founder is still refused by role, before any tier.
  assert.equal((await call(funds, env, FOUNDER, '/syndication')).status, 403);
});

// ── 4. Create refuses an unknown status ────────────────────────────────

test('create: an unknown status is a 400 naming the allowed ones, and writes nothing', async () => {
  const env = makeEnv();
  const count = () => Number(env.__db.prepare(`SELECT COUNT(*) AS n FROM deals`).get().n);
  const before = count();
  const r = await call(deals, env, FOUNDER, '/', { method: 'POST', body: JSON.stringify({ project_id: 1, status: 'closed' }) });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'unknown_status');
  // The list is the table's own CHECK, read from the canonical schema.
  const baseline = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
  const table = baseline.slice(baseline.search(/CREATE TABLE (IF NOT EXISTS )?deals \(/));
  const check = /status TEXT NOT NULL DEFAULT 'applied' CHECK \(status IN \(([^)]*)\)\)/.exec(table);
  assert.ok(check, 'the deals table has no status CHECK');
  assert.deepEqual(r.body.allowed, check[1].match(/'([^']+)'/g)!.map((v) => v.slice(1, -1)));
  assert.equal(count(), before);
  // An allowed status, and none at all, still create.
  const ok = await call(deals, env, FOUNDER, '/', { method: 'POST', body: JSON.stringify({ project_id: 1, status: 'scored' }) });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.status, 'scored');
  const dflt = await call(deals, env, FOUNDER, '/', { method: 'POST', body: JSON.stringify({ project_id: 1 }) });
  assert.equal(dflt.status, 201);
  assert.equal(dflt.body.status, 'applied');
});
