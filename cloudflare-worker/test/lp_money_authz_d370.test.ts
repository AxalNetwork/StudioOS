/**
 * D370 — LP-money authorisation, on a real node:sqlite database.
 *
 * Every gate here is asserted from BOTH sides: the role it refuses gets the
 * refusal and nothing moves; the role it permits gets through. A guard proven
 * only from the permitted side is indistinguishable from no guard at all.
 *
 * Actors (all on Fund I = id 1, whose GP of record is GP_ID):
 *   ADMIN        admin — unscoped
 *   GP           institutional investor, GP of record of Fund I
 *   OTHER_GP     institutional investor, GP of record of Fund II
 *   LP           investor (free tier), an LP of Fund I and GP of nothing
 *   FOUNDER      founder, no fund at all
 *   PARTNER      partner, no fund at all
 * Fund III has NO GP of record — the admin-created fund the LPA rule is about.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lp_money_authz_d370.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import funds from '../src/routes/funds.ts';
import fundSim from '../src/routes/fund_simulator.ts';
import legalcap from '../src/routes/legalcap.ts';
import { handleJob } from '../src/services/queueWorker.ts';
import { makeD1 } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADMIN_ID = 1;
const GP_ID = 40;
const OTHER_GP_ID = 41;
const LP_ID = 10;
const FOUNDER_ID = 60;
const PARTNER_ID = 70;

const USERS: Array<[number, string, string | null]> = [
  [ADMIN_ID, 'admin', null],
  [GP_ID, 'investor', 'institutional'],
  [OTHER_GP_ID, 'investor', 'institutional'],
  [LP_ID, 'investor', null],
  [FOUNDER_ID, 'founder', null],
  [PARTNER_ID, 'partner', null],
];
const ROLE = new Map(USERS.map(([id, role]) => [id, role]));

const SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1,
  investor_tier TEXT, investor_subscription_status TEXT);
CREATE TABLE vc_funds (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, vintage_year INTEGER,
  total_commitment REAL NOT NULL DEFAULT 0, deployed_capital REAL NOT NULL DEFAULT 0,
  lp_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'fundraising',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  lpa_doc_id INTEGER, fund_size_cents INTEGER NOT NULL DEFAULT 0, carried_interest REAL NOT NULL DEFAULT 0.20,
  management_fee REAL NOT NULL DEFAULT 0.02, slug TEXT, gp_user_id INTEGER, gp_name TEXT, gp_title TEXT,
  gp_email TEXT, gp_entity TEXT, fund_admin TEXT, auditor TEXT, legal_counsel TEXT, custodian TEXT,
  valuation_policy TEXT, company_id INTEGER);
CREATE TABLE fund_report_periods (id INTEGER PRIMARY KEY AUTOINCREMENT, fund_id INTEGER, period TEXT);
CREATE TABLE limited_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, fund_id INTEGER NOT NULL,
  commitment_amount REAL NOT NULL DEFAULT 0, invested_amount REAL NOT NULL DEFAULT 0,
  returns REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'committed',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  lpa_signed INTEGER NOT NULL DEFAULT 0, lpa_signed_at TEXT, commitment_date TEXT,
  distribution_history TEXT, name TEXT, email TEXT);
CREATE TABLE capital_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, limited_partner_id INTEGER, lp_investor_id INTEGER,
  project_id INTEGER, amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  due_date TEXT, paid_date TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE fund_distributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fund_id INTEGER NOT NULL, lp_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL, distribution_type TEXT NOT NULL, source_liquidity_event_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending', notes TEXT, distributed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE queue_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_type TEXT NOT NULL, payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT, completed_at TEXT, max_retries INTEGER NOT NULL DEFAULT 3, dead_at TEXT,
  idempotency_key TEXT);
CREATE TABLE subsidiaries (id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER, subsidiary_name TEXT NOT NULL);
CREATE TABLE secondary_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, subsidiary_id INTEGER NOT NULL,
  shares REAL NOT NULL, asking_price_cents INTEGER NOT NULL, ai_valuation_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'open', notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE legal_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL, type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', content TEXT, file_url TEXT, generated_by INTEGER,
  signed_by INTEGER, version INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, fund_id INTEGER);
CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
CREATE TABLE fund_reserve_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, fund_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL, reserve_amount REAL NOT NULL DEFAULT 0, initial_check REAL NOT NULL DEFAULT 0,
  next_round_label TEXT, target_ownership_pct REAL, confidence TEXT NOT NULL DEFAULT 'medium', notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE fund_scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, fund_id INTEGER NOT NULL,
  kind TEXT NOT NULL, name TEXT NOT NULL, description TEXT, inputs_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}', created_by_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT, body TEXT, link TEXT, created_at TEXT);
`;

function seed(): string {
  const users = USERS.map(([id, role, tier]) =>
    `(${id}, 'u${id}@example.test', 'U${id}', '${role}', 1, ${tier ? `'${tier}'` : 'NULL'})`).join(', ');
  return `
INSERT INTO users (id, email, name, role, is_active, investor_tier) VALUES ${users};
INSERT INTO vc_funds (id, name, gp_user_id, gp_email, fund_size_cents, deployed_capital)
  VALUES (1, 'Fund I',   ${GP_ID},       'gp1@fund.example', 1000000000, 50000),
         (2, 'Fund II',  ${OTHER_GP_ID}, 'gp2@fund.example', 2000000000, 90000),
         (3, 'Fund III', NULL,           NULL,               500000000,  0);
INSERT INTO limited_partners (id, fund_id, user_id, name, email, commitment_amount, invested_amount)
  VALUES (100, 1, ${LP_ID}, 'LP One', 'u${LP_ID}@example.test', 500, 0),
         (200, 2, NULL,     'LP Two', 'two@lp.example',         700, 0);
INSERT INTO capital_calls (id, limited_partner_id, amount, status)
  VALUES (1, 100, 500, 'pending'), (2, 200, 700, 'pending');
INSERT INTO subsidiaries (id, deal_id, subsidiary_name) VALUES (1, 1, 'Sub Co');
INSERT INTO secondary_listings (id, user_id, subsidiary_id, shares, asking_price_cents) VALUES (1, ${LP_ID}, 1, 10, 10000);
INSERT INTO queue_jobs (id, job_type, payload, status)
  VALUES (1, 'capital_call_notice', '{"fund_id":1,"amount_cents":100000}', 'pending'),
         (2, 'capital_call_notice', '{"fund_id":2,"amount_cents":900000}', 'pending');
INSERT INTO projects (id, name, status) VALUES (1, 'Co', 'active');
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
  // A gate that refuses by THROWING a Response (the fund gate's 402 / 404) is
  // turned into the reply by `withThrownResponses` around the Worker's fetch
  // (util/thrownResponse.ts). Calling a router directly skips that wrapper, so
  // the same unwrapping happens here — otherwise a refusal reads as a crash.
  const res: Response = await app.request(path, {
    ...init,
    headers: { Authorization: `Bearer ${await token(userId)}`, 'content-type': 'application/json', ...(init.headers || {}) },
  }, env).catch((e: unknown) => {
    if (e instanceof Response) return e;
    throw e;
  });
  let body: any = null;
  try { body = await res.json(); } catch { /* 204 */ }
  return { status: res.status, body };
}

const ids = (items: any[]) => (items || []).map((f: any) => f.id).sort((a: number, b: number) => a - b);

// ── GET /funds ──────────────────────────────────────────────────────────

test('fund list: an admin sees every fund', async () => {
  const env = makeEnv();
  const r = await call(funds, env, ADMIN_ID, '/');
  assert.equal(r.status, 200);
  assert.deepEqual(ids(r.body.items), [1, 2, 3]);
});

test('fund list: a GP sees their own fund and not another GP\'s', async () => {
  const env = makeEnv();
  const r = await call(funds, env, GP_ID, '/');
  assert.deepEqual(ids(r.body.items), [1]);
  assert.ok(!JSON.stringify(r.body).includes('gp2@fund.example'), 'another GP\'s email leaked');
});

test('fund list: an LP sees the fund they hold a position in, and only that', async () => {
  const env = makeEnv();
  const r = await call(funds, env, LP_ID, '/');
  assert.deepEqual(ids(r.body.items), [1]);
});

test('fund list: a founder or partner with no fund sees none, and no GP email', async () => {
  for (const who of [FOUNDER_ID, PARTNER_ID]) {
    const env = makeEnv();
    const r = await call(funds, env, who, '/');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items, [], `user ${who} saw funds`);
    assert.ok(!/@fund\.example/.test(JSON.stringify(r.body)), `user ${who} saw a GP email`);
  }
});

test('fund list: the status filter still applies inside the scope', async () => {
  const env = makeEnv();
  env.__db.exec(`UPDATE vc_funds SET status = 'active' WHERE id = 1`);
  assert.deepEqual(ids((await call(funds, env, GP_ID, '/?status=active')).body.items), [1]);
  assert.deepEqual(ids((await call(funds, env, GP_ID, '/?status=closed')).body.items), []);
});

// ── GET /funds/analytics and /funds/:id/analytics ──────────────────────

test('family analytics: a GP\'s rollup is their own funds; an LP or founder gets none', async () => {
  const env = makeEnv();
  assert.deepEqual(ids((await call(funds, env, ADMIN_ID, '/analytics')).body.items), [1, 2, 3]);
  assert.deepEqual(ids((await call(funds, env, GP_ID, '/analytics')).body.items), [1]);
  for (const who of [LP_ID, FOUNDER_ID]) {
    const r = await call(funds, env, who, '/analytics');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items, [], `user ${who} got another fund's rollup`);
  }
});

test('fund analytics: the GP of that fund, or an admin; nobody else gets a figure', async () => {
  const env = makeEnv();
  assert.equal((await call(funds, env, GP_ID, '/1/analytics')).status, 200);
  assert.equal((await call(funds, env, ADMIN_ID, '/2/analytics')).status, 200);
  for (const [who, fund] of [[GP_ID, 2], [OTHER_GP_ID, 1], [FOUNDER_ID, 1]] as const) {
    const r = await call(funds, env, who, `/${fund}/analytics`);
    assert.equal(r.status, 404, `user ${who} read fund ${fund}'s analytics`);
    assert.equal(r.body?.fund, undefined);
  }
  // Below the institutional tier: the fund gate's 402, whatever the fund.
  assert.equal((await call(funds, env, LP_ID, '/1/analytics')).status, 402);
});

// ── GET /funds/:id ──────────────────────────────────────────────────────

test('fund detail: the GP of that fund, or an admin; others get no row', async () => {
  const env = makeEnv();
  const own = await call(funds, env, GP_ID, '/1');
  assert.equal(own.status, 200);
  assert.equal(own.body.fund.gp_email, 'gp1@fund.example');
  assert.equal((await call(funds, env, ADMIN_ID, '/2')).status, 200);
  for (const [who, fund] of [[GP_ID, 2], [OTHER_GP_ID, 1], [FOUNDER_ID, 1], [PARTNER_ID, 3]] as const) {
    const r = await call(funds, env, who, `/${fund}`);
    assert.equal(r.status, 404, `user ${who} read fund ${fund}`);
    assert.ok(!/@fund\.example/.test(JSON.stringify(r.body)));
  }
  assert.equal((await call(funds, env, LP_ID, '/1')).status, 402);
});

// ── GET /funds/syndication ─────────────────────────────────────────────

test('syndication: a founder is refused with a code and our sentence', async () => {
  const env = makeEnv();
  const r = await call(funds, env, FOUNDER_ID, '/syndication');
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'investor_access_required');
  assert.equal(typeof r.body.message, 'string');
});

test('syndication: pending calls are the caller\'s own funds (all of them for an admin)', async () => {
  const env = makeEnv();
  const pendingFunds = (r: any) => r.body.pending_capital_calls.map((j: any) => Number(j.fund_id)).sort();
  assert.deepEqual(pendingFunds(await call(funds, env, ADMIN_ID, '/syndication')), [1, 2]);
  assert.deepEqual(pendingFunds(await call(funds, env, GP_ID, '/syndication')), [1]);
  const lp = await call(funds, env, LP_ID, '/syndication');
  assert.equal(lp.status, 200);
  assert.deepEqual(lp.body.pending_capital_calls, [], 'an LP saw queued call amounts');
  assert.equal(lp.body.co_invest_listings.length, 1, 'the listings themselves are for investors');
});

// ── LPA: no GP of record, no LPA ────────────────────────────────────────

test('fund create: an admin-created fund has no GP of record, so no LPA is queued', async () => {
  const env = makeEnv();
  const r = await call(funds, env, ADMIN_ID, '/', { method: 'POST', body: JSON.stringify({ name: 'Fund IV' }) });
  assert.equal(r.status, 201);
  assert.equal(r.body.lpa_status, 'blocked_no_gp');
  assert.match(r.body.lpa_reason, /general partner of record/);
  const jobs = env.__db.prepare(`SELECT COUNT(*) AS n FROM queue_jobs WHERE job_type = 'lpa_generation'`).get();
  assert.equal(jobs.n, 0);
});

test('fund create: a GP-created fund names its GP, so its LPA is queued', async () => {
  const env = makeEnv();
  const r = await call(funds, env, GP_ID, '/', { method: 'POST', body: JSON.stringify({ name: 'Fund V' }) });
  assert.equal(r.status, 201);
  assert.equal(r.body.lpa_status, 'enqueued');
  const jobs = env.__db.prepare(`SELECT COUNT(*) AS n FROM queue_jobs WHERE job_type = 'lpa_generation'`).get();
  assert.equal(jobs.n, 1);
});

test('regenerate LPA: refused with no_gp_of_record for a fund with no GP; allowed for one with', async () => {
  const env = makeEnv();
  env.__db.exec('UPDATE vc_funds SET lpa_doc_id = 99 WHERE id = 3');
  const r = await call(funds, env, ADMIN_ID, '/3/regenerate-lpa', { method: 'POST' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'no_gp_of_record');
  assert.equal(env.__db.prepare('SELECT lpa_doc_id FROM vc_funds WHERE id = 3').get().lpa_doc_id, 99,
    'the refused request must not clear the LPA on file');
  const ok = await call(funds, env, GP_ID, '/1/regenerate-lpa', { method: 'POST' });
  assert.equal(ok.status, 200);
});

test('the LPA job itself drafts nothing for a fund with no GP of record', async () => {
  const env = makeEnv();
  await handleJob(env, { id: 1, job_type: 'lpa_generation', payload: JSON.stringify({ fund_id: 3 }) } as any);
  const docs = env.__db.prepare(`SELECT COUNT(*) AS n FROM legal_documents WHERE fund_id = 3`).get();
  assert.equal(docs.n, 0, 'an LPA was written for a fund nobody is GP of');
  assert.equal(env.__db.prepare('SELECT lpa_doc_id FROM vc_funds WHERE id = 3').get().lpa_doc_id, null);
});

// ── /fund-sim writes ────────────────────────────────────────────────────

const reservesBody = JSON.stringify({ items: [{ project_id: 1, reserve_amount: 1000, initial_check: 100 }] });

test('fund-sim: only the GP of record (or an admin) writes a fund\'s reserves', async () => {
  const count = (env: any) => env.__db.prepare('SELECT COUNT(*) AS n FROM fund_reserve_allocations').get().n;
  for (const [who, want] of [[LP_ID, 402], [OTHER_GP_ID, 404]] as const) {
    const env = makeEnv();
    const r = await call(fundSim, env, who, '/funds/1/reserves', { method: 'PUT', body: reservesBody });
    assert.equal(r.status, want, `user ${who} got ${r.status}`);
    assert.equal(count(env), 0, `user ${who} wrote Fund I's reserves`);
  }
  for (const who of [GP_ID, ADMIN_ID]) {
    const env = makeEnv();
    const r = await call(fundSim, env, who, '/funds/1/reserves', { method: 'PUT', body: reservesBody });
    assert.equal(r.status, 200, `user ${who} was refused`);
    assert.equal(count(env), 1);
  }
});

test('fund-sim: only the GP of record (or an admin) saves a scenario under a fund', async () => {
  const body = JSON.stringify({ kind: 'reserves', name: 'Base case' });
  const count = (env: any) => env.__db.prepare('SELECT COUNT(*) AS n FROM fund_scenarios').get().n;
  for (const [who, want] of [[LP_ID, 402], [OTHER_GP_ID, 404]] as const) {
    const env = makeEnv();
    const r = await call(fundSim, env, who, '/funds/1/scenarios', { method: 'POST', body });
    assert.equal(r.status, want);
    assert.equal(count(env), 0);
  }
  const env = makeEnv();
  assert.equal((await call(fundSim, env, GP_ID, '/funds/1/scenarios', { method: 'POST', body })).status, 201);
  assert.equal(count(env), 1);
});

// ── /legalcap/capital/calls: the dead read, swapped ─────────────────────

test('legacy calls read: returns the real rows instead of throwing', async () => {
  // It named deal_id / syndicate_id / lp_responses, which capital_calls does
  // not have, so every call threw and the pages showed "no capital calls".
  const env = makeEnv();
  const r = await call(legalcap, env, ADMIN_ID, '/capital/calls');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((x: any) => x.id).sort(), [1, 2]);
  assert.ok(r.body.every((x: any) => typeof x.fund_id === 'number'), 'each call names its fund');
});

test('legacy calls read: fixed WITH a scope — an investor never sees another LP\'s call', async () => {
  const env = makeEnv();
  assert.deepEqual((await call(legalcap, env, LP_ID, '/capital/calls')).body.map((x: any) => x.id), [1]);
  assert.deepEqual((await call(legalcap, env, GP_ID, '/capital/calls')).body.map((x: any) => x.id), [1]);
  assert.deepEqual((await call(legalcap, env, OTHER_GP_ID, '/capital/calls')).body.map((x: any) => x.id), [2]);
  assert.equal((await call(legalcap, env, FOUNDER_ID, '/capital/calls')).status, 403);
});

// ── The frontend reads the live ledger ──────────────────────────────────

test('the fund pages read the live calls ledger, and the legacy method no longer swallows failure', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const api = read('frontend/src/lib/api.js');
  const m = /capitalCalls: \(\) => request\('\/legalcap\/capital\/calls'\)([^,\n]*)/.exec(api);
  assert.ok(m, 'api.capitalCalls was not found');
  assert.doesNotMatch(m[1], /\.catch/, 'a failed read is again reported as "no calls"');
  // Re-aimed by D371: the other page D370 swapped, FundOpsWorkspace's Capital
  // Calls panel, was retired into the Calls zone, which reads the fund's own
  // call ledger. The property is unchanged — no fund page reads the dead
  // shape — and the landing still reads the live one.
  assert.match(read('frontend/src/pages/investor/InvestorFundLanding.jsx'), /api\.listCapitalCalls\(\)/,
    'the landing does not read the live ledger');
  assert.match(read('frontend/src/pages/investor/InvestorFundCalls.jsx'), /api\.fundsCallLedger\(/,
    'the Calls zone does not read the fund call ledger');
  for (const page of [
    'frontend/src/pages/FundOpsWorkspace.jsx',
    'frontend/src/pages/investor/InvestorFundLanding.jsx',
    'frontend/src/pages/investor/InvestorFundCalls.jsx',
  ]) {
    assert.doesNotMatch(read(page), /api\.capitalCalls\(\)/, `${page} reads the dead shape`);
  }
});

// ── The test database keeps D1's batch guarantee ────────────────────────

test('the test database runs a batch as one transaction, as D1 does', async () => {
  // D1 runs a batch as a single transaction. The fixture used to await each
  // statement in turn, so two batches in flight interleaved — looser than
  // production. Two concurrent batches each read a counter and then bump it;
  // atomic, they read 0 and 1. Interleaved, both read 0.
  const { DB, db } = makeD1(`CREATE TABLE t (v INTEGER); INSERT INTO t VALUES (0);
    CREATE TABLE seen (who TEXT, v INTEGER);`);
  const batchFor = (who: string) => DB.batch([
    DB.prepare('INSERT INTO seen (who, v) SELECT ?, v FROM t').bind(who),
    DB.prepare('UPDATE t SET v = v + 1'),
  ]);
  await Promise.all([batchFor('A'), batchFor('B')]);
  const seen = db.prepare('SELECT v FROM seen ORDER BY v').all().map((r: any) => r.v);
  assert.deepEqual(seen, [0, 1], 'two batches interleaved statement by statement');

  // All or nothing: a batch whose second statement fails leaves no trace.
  await assert.rejects(DB.batch([
    DB.prepare('UPDATE t SET v = 100'),
    DB.prepare('INSERT INTO no_such_table VALUES (1)'),
  ]));
  assert.equal(db.prepare('SELECT v FROM t').get().v, 2, 'a failed batch left its first write behind');
});
