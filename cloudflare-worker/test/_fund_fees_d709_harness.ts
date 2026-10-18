/**
 * D709 (#1774) — the shared fixture for the fee routes' tests. The tables the
 * fee reads take their DDL from `schema_baseline.sql` with `ddl()` (the
 * pattern of capital_call_ledger.test.ts:65-77: foreign keys dropped, the
 * quoted `capital_calls` read), then 312, 472, 473 and 474 are applied from their files.
 * Every name, figure and email is made up.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import fundFees from '../src/routes/fund_fees.ts';
import funds from '../src/routes/funds.ts';
import capital from '../src/routes/capital.ts';
import { parseQuarter, quarterOf } from '../src/services/fundFeeCalc.ts';
import { encryptColumn } from '../src/services/columnCipher.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = readFileSync(resolve(HERE, '../sql/schema_baseline.sql'), 'utf8');
export const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

function ddl(table: string): string {
  for (const needle of [`CREATE TABLE ${table} (`, `CREATE TABLE "${table}" (`]) {
    const at = BASELINE.indexOf(needle);
    if (at < 0) continue;
    const end = BASELINE.indexOf(';', at);
    const sql = BASELINE.slice(at, end + 1)
      .replace(/\s+REFERENCES\s+"?\w+"?\s*\([^)]*\)(\s+ON\s+(DELETE|UPDATE)\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))*/gi, '');
    assert.doesNotMatch(sql, /REFERENCES/i, `${table} still carries a foreign key`);
    return sql;
  }
  assert.fail(`the baseline no longer defines ${table}`);
}

export const ADMIN = 1, SUPER = 2, GP = 40, OTHER_GP = 41, PRO_LP = 42, LP_USER = 10;
const USERS: Array<[number, string, string | null]> = [
  [ADMIN, 'admin', null], [SUPER, 'admin', null], [GP, 'investor', 'institutional'], [OTHER_GP, 'investor', 'institutional'],
  [PRO_LP, 'investor', 'professional'], [LP_USER, 'investor', 'institutional'],
];
const ROLE = new Map(USERS.map(([id, role]) => [id, role]));

const SCHEMA = [
  `CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1,
     investor_tier TEXT, investor_subscription_status TEXT, kyc_status TEXT, last_active TEXT, jwt_min_iat INTEGER);`,
  `CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);`,
  `CREATE TABLE user_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, jti TEXT, factor TEXT, assurance_level TEXT,
     revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT, last_step_up_at TEXT, created_at TEXT DEFAULT (datetime('now')));`,
  ddl('vc_funds'), ddl('limited_partners'), ddl('capital_calls'), ddl('portfolio_positions'),
  `CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT);`,
  `CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT, details TEXT, actor TEXT,
     action_type TEXT, entity_type TEXT, entity_id TEXT, ip_address TEXT, user_agent TEXT, metadata TEXT, created_at TEXT DEFAULT (datetime('now')));`,
  `CREATE TABLE activity_stats (user_id INTEGER, stat_date TEXT, action_count INTEGER DEFAULT 0, updated_at TEXT, UNIQUE (user_id, stat_date));`,
  `CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT, body TEXT, link TEXT, created_at TEXT);`,
  `CREATE TABLE job_idempotency (idempotency_key TEXT PRIMARY KEY, created_at TEXT);`,
  readFileSync(resolve(HERE, '../sql/migrations/312_fund_call_ledger.sql'), 'utf8'),
  readFileSync(resolve(HERE, '../sql/migrations/472_entity_bank_accounts.sql'), 'utf8'),
  readFileSync(resolve(HERE, '../sql/migrations/473_fund_management_fees.sql'), 'utf8'),
  readFileSync(resolve(HERE, '../sql/migrations/474_mercury_entity_connections.sql'), 'utf8'),
].join('\n');

/** This quarter and the next, from today (UTC): the routes read the real clock. */
export const TODAY = new Date().toISOString().slice(0, 10);
export const Q0 = quarterOf(TODAY);
const after = (q: string) => { const p = parseQuarter(q)!; return p.q === 4 ? `${p.year + 1}Q1` : `${p.year}Q${p.q + 1}`; };
export const Q1 = after(Q0), Q2 = after(Q1);
export const FEE_START = parseQuarter(Q0)!.first;

function seed(): string {
  const users = USERS.map(([id, role, tier]) => `(${id}, 'u${id}@example.test', 'U${id}', '${role}', 1, ${tier ? `'${tier}'` : 'NULL'}, 'approved')`).join(', ');
  return `
INSERT INTO users (id, email, name, role, is_active, investor_tier, kyc_status) VALUES ${users};
INSERT INTO super_admins (user_id) VALUES (${SUPER});
INSERT INTO user_sessions (user_id, jti, factor, assurance_level) VALUES (${SUPER}, 'totp-${SUPER}', 'totp', 'totp'), (${ADMIN}, 'totp-${ADMIN}', 'totp', 'totp');
INSERT INTO vc_funds (id, name, gp_user_id, slug) VALUES (1, 'Fund I', ${GP}, 'spinout-fund-i'), (2, 'Fund II', ${OTHER_GP}, 'fund-ii');
INSERT INTO limited_partners (id, fund_id, user_id, name, email, commitment_amount, status) VALUES
  (100, 1, ${LP_USER}, 'LP A', 'lpa@example.test', 1000000, 'committed'),
  (200, 1, NULL, 'LP B', 'lpb@example.test', 500000, 'active'),
  (300, 1, NULL, 'LP C', 'lpc@example.test', 999, 'redeemed'),
  (500, 2, NULL, 'Fund II LP', 'two@example.test', 1000, 'active');
INSERT INTO projects (id, name) VALUES (7, 'Portfolio Co'), (8, 'Not held');
INSERT INTO portfolio_positions (uid, fund_id, project_id, round_name, invested_amount) VALUES ('pos-1', 1, 7, 'Seed', 100000);
`;
}

export function makeEnv(): any {
  const { DB, db } = makeD1(SCHEMA, seed());
  return { JWT_SECRET, ENVIRONMENT: 'development', DB, __db: db };
}

/**
 * D708 decision 9: a call on Fund I issues only while the Fund has a payable
 * account, so a test that calls capital adds one first, as the console would
 * write it (fund_call_payable_d708.test.ts's account). Synthetic number.
 */
export async function addFundAccount(env: any) {
  if (env.__db.prepare(`SELECT 1 FROM entity_bank_accounts WHERE entity_key = 'fund'`).get()) return;
  const uid = '0000bbbb-0000-4000-8000-000000000709';
  const number = '8100223344';
  const enc = await encryptColumn(env, 'entity_bank_accounts', 'account_number_enc', uid, number);
  env.__db.prepare(`INSERT INTO entity_bank_accounts
      (uid, entity_key, label, bank_name, bank_address, beneficiary_name, beneficiary_address, account_kind,
       account_number_enc, account_last4, routing_number, swift_code, purposes_json, recorded_by)
     VALUES (?, 'fund', 'Fund checking', 'Column N.A.', '1 Letterman Drive', 'Axal VC Spin-Out Lab Fund I LP',
             '16192 Coastal Highway', 'checking', ?, ?, '121145433', 'CLNOUS66MER', '["capital_contribution","gp_commitment"]', ?)`)
    .run(uid, enc, number.slice(-4), SUPER);
}

const app = new Hono<any>();
app.route('/api/fund-fees', fundFees);
app.route('/api/funds', funds);
app.route('/api/capital', capital);
// The Worker's app.onError maps the gates' errors to their 403s.
app.onError((e: any, c) => {
  const m = String(e?.message ?? '');
  if (m === 'step_up_required') return c.json({ code: 'step_up_required' }, 403);
  if (m === 'TOTP required') return c.json({ code: 'totp_required' }, 403);
  if (m === 'Super admin required') return c.json({ code: 'super_admin_required' }, 403);
  if (m === 'Unauthorized') return c.json({ detail: 'Unauthorized' }, 401);
  return c.json({ error: m }, 500);
});

export async function token(userId: number, extra: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({ user_id: userId, role: ROLE.get(userId), ...extra })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}
export async function call(env: any, userId: number, path: string, init: { method?: string; body?: unknown; claims?: Record<string, unknown> } = {}) {
  const res: Response = await Promise.resolve(app.request(path, {
    method: init.method || 'GET', body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: { Authorization: `Bearer ${await token(userId, init.claims)}`, 'content-type': 'application/json' },
  }, env)).catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
  let body: any = null;
  try { body = await res.json(); } catch { /* none */ }
  return { status: res.status, body };
}
export const q = (env: any, sql: string, ...binds: any[]) => env.__db.prepare(sql).all(...binds) as any[];
export const one = (env: any, sql: string, ...binds: any[]) => env.__db.prepare(sql).get(...binds) as any;
export const count = (env: any, table: string) => Number(one(env, `SELECT COUNT(*) AS n FROM ${table}`).n);

/** Terms confirmed from this quarter's first day, and both billable LPs admitted then. */
export async function readyFund(env: any, over: Record<string, unknown> = {}) {
  const t = await call(env, GP, '/api/fund-fees/1/terms', { method: 'POST', body: { fee_start_date: FEE_START, investment_period_end: '2099-12-31',
    lpa_reference: 'LPA §8.1 (synthetic)', ...over } });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal((await call(env, GP, `/api/fund-fees/1/terms/${t.body.uid}/confirm`, { method: 'POST' })).status, 200);
  for (const lp of [100, 200]) {
    const r = await call(env, GP, `/api/fund-fees/1/lps/${lp}/admission`, { method: 'PUT', body: { admitted_on: FEE_START, closing_label: 'First closing', source: 'Closing memo (synthetic)' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  return t.body.uid as string;
}
export async function preview(env: any, quarter = Q0, who = GP) {
  return call(env, who, `/api/fund-fees/1/periods/${quarter}/preview`, { method: 'POST' });
}
export async function issue(env: any, digest: unknown, quarter = Q0, who = GP, extra: Record<string, unknown> = {}) {
  return call(env, who, `/api/fund-fees/1/periods/${quarter}/issue`, { method: 'POST', body: { digest, ...extra } });
}

/**
 * #1773's registry rows, written as its console would. The numbers are
 * synthetic and end in no real account's last four.
 */
export const GP_NUMBER = '5512340093';
export async function bankAccount(env: any, entity: 'gp' | 'fund', number: string, purpose: string, beneficiary: string) {
  const uid = `0000bbbb-0000-4000-8000-${entity === 'gp' ? '000000000711' : '000000000712'}`;
  const enc = await encryptColumn(env, 'entity_bank_accounts', 'account_number_enc', uid, number);
  env.__db.prepare(`INSERT INTO entity_bank_accounts
      (uid, entity_key, label, bank_name, bank_address, beneficiary_name, beneficiary_address, account_kind,
       account_number_enc, account_last4, routing_number, swift_code, purposes_json, status, recorded_by)
     VALUES (?, ?, 'Checking', 'Column N.A.', '1 Letterman Drive', ?, '16192 Coastal Highway', 'checking',
       ?, ?, '121145433', 'CLNOUS66MER', ?, 'active', ?)`).run(uid, entity, beneficiary, enc, number.slice(-4), JSON.stringify([purpose]), SUPER);
}
export const gpAccount = (env: any) => bankAccount(env, 'gp', GP_NUMBER, 'management_fee', 'Axal VC GP LLC');
