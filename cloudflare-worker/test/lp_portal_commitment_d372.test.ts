/**
 * D372 — the LP's own portal feeds the My-commitment card, on node:sqlite
 * with migration 312 applied from its own file.
 *
 * `GET /api/funds/lp-portal`:
 *   - each capital-call line carries its owed and received cents, its call's
 *     number and its fund, so called / due / uncalled can be summed;
 *   - a calls read that fails says so (`capital_calls_recorded: false`),
 *     where it used to answer `[]`;
 *   - TVPI and DPI are null when nothing is paid in, where they read 0;
 *   - each fund names its GP of record's account for "Message the GP", and
 *     only on the LP's own funds.
 * The GP's per-LP report (`GET /:id/lp-report/:lpId`) keeps the same TVPI rule.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lp_portal_commitment_d372.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import funds from '../src/routes/funds.ts';
import { makeD1 } from './_d1_sqlite.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION_312 = readFileSync(resolve(HERE, '../sql/migrations/312_fund_call_ledger.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const GP_ID = 40;
const LP_A = 10;
const LP_B = 20;
const ROLE = new Map([[GP_ID, 'investor'], [LP_A, 'investor'], [LP_B, 'investor']]);

const SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1,
  investor_tier TEXT, investor_subscription_status TEXT, kyc_status TEXT, last_active TEXT);
CREATE TABLE vc_funds (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, vintage_year INTEGER,
  total_commitment REAL NOT NULL DEFAULT 0, deployed_capital REAL NOT NULL DEFAULT 0,
  lp_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'fundraising',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  lpa_doc_id INTEGER, fund_size_cents INTEGER NOT NULL DEFAULT 0, carried_interest REAL NOT NULL DEFAULT 0.20,
  management_fee REAL NOT NULL DEFAULT 0.02, slug TEXT, gp_user_id INTEGER, gp_name TEXT, gp_title TEXT,
  gp_email TEXT, gp_entity TEXT, fund_admin TEXT, auditor TEXT, legal_counsel TEXT, custodian TEXT,
  valuation_policy TEXT, company_id INTEGER);
CREATE TABLE limited_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, fund_id INTEGER NOT NULL,
  commitment_amount REAL NOT NULL DEFAULT 0, invested_amount REAL NOT NULL DEFAULT 0,
  returns REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'committed',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  lpa_signed INTEGER NOT NULL DEFAULT 0, lpa_signed_at TEXT, commitment_date TEXT,
  distribution_history TEXT, name TEXT, email TEXT);
CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE capital_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  limited_partner_id INTEGER, lp_investor_id INTEGER, project_id INTEGER,
  amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  due_date TEXT, paid_date TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE fund_distributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fund_id INTEGER NOT NULL, lp_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL, distribution_type TEXT NOT NULL DEFAULT 'cash', source_liquidity_event_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending', notes TEXT, distributed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE fund_report_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fund_id INTEGER, period TEXT, period_start TEXT, period_end TEXT,
  issued_at TEXT, status TEXT, notes TEXT);
${MIGRATION_312}
`;

/**
 * LP A holds Fund I (GP of record 40) and Fund II (no GP of record). Fund I
 * has a numbered call with a part receipt and an older paid line; LP B's line
 * on Fund I must never reach LP A.
 */
function seed(): string {
  return `
INSERT INTO users (id, email, name, role, investor_tier) VALUES
  (${GP_ID}, 'gp@fund.example', 'Grace GP', 'investor', 'institutional'),
  (${LP_A}, 'a@lp.example', 'LP A', 'investor', NULL),
  (${LP_B}, 'b@lp.example', 'LP B', 'investor', NULL);
INSERT INTO vc_funds (id, name, gp_user_id, gp_name, gp_email) VALUES
  (1, 'Fund I', ${GP_ID}, 'Grace GP', 'signatory@fund.example'),
  (2, 'Fund II', NULL, NULL, NULL);
INSERT INTO limited_partners (id, fund_id, user_id, name, email, commitment_amount, invested_amount, lpa_signed, lpa_signed_at) VALUES
  (100, 1, ${LP_A}, 'LP A', 'a@lp.example', 1000, 150, 1, '2026-03-02'),
  (101, 2, ${LP_A}, 'LP A', 'a@lp.example', 500, 0, 0, NULL),
  (200, 1, ${LP_B}, 'LP B', 'b@lp.example', 1000, 0, 1, NULL);
INSERT INTO fund_capital_calls (id, uid, fund_id, call_number, amount_cents, line_count) VALUES
  (1, 'call-1', 1, 1, 60000, 2);
INSERT INTO capital_calls (id, uid, limited_partner_id, amount, amount_cents, fund_call_id, status, due_date, created_at) VALUES
  (10, 'l-10', 100, 300, 30000, 1, 'pending', '2026-12-01', '2026-09-01 00:00:00'),
  (11, 'l-11', 200, 300, 30000, 1, 'pending', '2026-12-01', '2026-09-01 00:00:00'),
  (12, 'l-12', 100, 50, NULL, NULL, 'paid', NULL, '2026-01-01 00:00:00');
INSERT INTO capital_call_receipts (uid, capital_call_id, limited_partner_id, fund_id, amount_cents, received_on, recorded_by) VALUES
  ('r-1', 10, 100, 1, 10000, '2026-09-10', ${GP_ID});
INSERT INTO fund_distributions (fund_id, lp_id, amount_cents, status, distributed_at) VALUES (1, 100, 2500, 'paid', '2026-06-30');
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

async function call(env: any, userId: number, path: string) {
  const res: Response = await funds.request(path, {
    headers: { Authorization: `Bearer ${await token(userId)}` },
  }, env).catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('each call line carries its owed and received cents, its call number and its fund', async () => {
  const r = await call(makeEnv(), LP_A, '/lp-portal');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.capital_calls_recorded, true);
  const byId = new Map(r.body.capital_calls.map((c: any) => [c.id, c]));
  const line: any = byId.get(10);
  assert.deepEqual([line.owed_cents, line.received_cents, line.call_number, line.fund_id, line.fund_name],
    [30000, 10000, 1, 1, 'Fund I']);
  // A pre-312 line: owed rounded from its dollars, no receipt, no number.
  const old: any = byId.get(12);
  assert.deepEqual([old.owed_cents, old.received_cents, old.call_number], [5000, 0, null]);
});

test('another LP\'s line on the same fund never reaches this LP', async () => {
  const r = await call(makeEnv(), LP_A, '/lp-portal');
  assert.ok(!r.body.capital_calls.some((c: any) => c.id === 11), 'LP B\'s call reached LP A');
  const b = await call(makeEnv(), LP_B, '/lp-portal');
  assert.deepEqual(b.body.capital_calls.map((c: any) => c.id), [11]);
});

test('a calls read that fails is reported, never an empty list', async () => {
  const env = makeEnv();
  env.__db.exec('DROP TABLE capital_call_receipts');
  const r = await call(env, LP_A, '/lp-portal');
  assert.equal(r.status, 200);
  assert.equal(r.body.capital_calls_recorded, false, 'a failed read reads as "no calls"');
  assert.deepEqual(r.body.capital_calls, []);
  // The rest of the portal still answers.
  assert.equal(r.body.lp_holdings.length, 2);
});

test('TVPI and DPI are null with nothing paid in, and figures otherwise', async () => {
  const r = await call(makeEnv(), LP_A, '/lp-portal');
  const perf = new Map(r.body.performance.map((p: any) => [p.fund_id, p]));
  assert.equal((perf.get(2) as any).tvpi, null, 'nothing paid in, and a multiple was printed');
  assert.equal((perf.get(2) as any).dpi, null);
  // Fund I: 150 paid in, 25 distributed → TVPI (150 + 25) / 150, DPI 25 / 150.
  assert.equal((perf.get(1) as any).tvpi, 1.167);
  assert.equal((perf.get(1) as any).dpi, 0.167);
  assert.equal((perf.get(1) as any).lpa_signed_at, '2026-03-02');
});

test('the GP\'s per-LP report keeps the same rule', async () => {
  const env = makeEnv();
  const r = await call(env, GP_ID, '/1/lp-report/200');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.performance[0].tvpi, null);
  assert.equal(r.body.performance[0].dpi, null);
});

test('each of the LP\'s funds names its GP of record\'s account, and none where there is no GP', async () => {
  const r = await call(makeEnv(), LP_A, '/lp-portal');
  assert.equal(r.body.funds['1'].gp.contact_email, 'gp@fund.example',
    'the message would go to the document address, which may not be an account');
  assert.equal(r.body.funds['1'].gp.email, 'signatory@fund.example');
  assert.equal(r.body.funds['2'].gp.contact_email, null);
  // A user with no position on the fund gets no fund facts at all.
  const b = await call(makeEnv(), LP_B, '/lp-portal');
  assert.deepEqual(Object.keys(b.body.funds), ['1']);
});
