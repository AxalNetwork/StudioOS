/**
 * D708 (#1773) — no Fund I capital call issues, by any path, while the Fund
 * has no account to be paid into; only the Super Admin moves the Fund I slug;
 * and an LP sees the wire details for their own open Fund I line.
 *
 * On node:sqlite with migrations 312 and 472 applied from their own files.
 * Fund 1 carries `spinout-fund-i` unless a test says otherwise; Fund IV is
 * another fund of the same GP, which never reads the registry.
 *
 * Every account number here is synthetic.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fund_call_payable_d708.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import funds from '../src/routes/funds.ts';
import capital from '../src/routes/capital.ts';
import { handleJob } from '../src/services/queueWorker.ts';
import { encryptColumn } from '../src/services/columnCipher.ts';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
/** A baseline table without its foreign keys: `makeD1` enforces them, and the tables they name are not this file's. */
const baselineTable = (name: string) => stripForeignKeys(tableFromBaseline(BASELINE, name));
const MIGRATION_312 = read('cloudflare-worker/sql/migrations/312_fund_call_ledger.sql');
const MIGRATION_472 = read('cloudflare-worker/sql/migrations/472_entity_bank_accounts.sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADMIN_ID = 1;      // a plain Admin
const HOLDER_ID = 2;     // the Super Admin
const GP_ID = 40;        // GP of record of Fund I and Fund IV
const LP_A = 10;
const LP_B = 20;
// Synthetic; ends in no real account's last four.
const FUND_NUMBER = '8100223344';

const USERS: Array<[number, string, string | null, string]> = [
  [ADMIN_ID, 'admin', null, 'approved'],
  [HOLDER_ID, 'admin', null, 'approved'],
  [GP_ID, 'investor', 'institutional', 'approved'],
  [LP_A, 'investor', null, 'approved'],
  [LP_B, 'investor', null, 'approved'],
];
const ROLE = new Map(USERS.map(([id, role]) => [id, role]));

const SCHEMA = (withRegistry: boolean) => `
CREATE TABLE users (
  id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1,
  investor_tier TEXT, investor_subscription_status TEXT, kyc_status TEXT, last_active TEXT);
${baselineTable('vc_funds')}
CREATE TABLE limited_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, fund_id INTEGER NOT NULL,
  commitment_amount REAL NOT NULL DEFAULT 0, invested_amount REAL NOT NULL DEFAULT 0,
  returns REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'committed',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  lpa_signed INTEGER NOT NULL DEFAULT 0, lpa_signed_at TEXT, commitment_date TEXT,
  distribution_history TEXT, name TEXT, email TEXT);
CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, sector TEXT);
CREATE TABLE partners (id INTEGER PRIMARY KEY, name TEXT, status TEXT DEFAULT 'active', company TEXT, specialization TEXT);
CREATE TABLE capital_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  limited_partner_id INTEGER, lp_investor_id INTEGER, project_id INTEGER REFERENCES projects(id),
  amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  due_date TEXT, paid_date TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT, details TEXT, actor TEXT,
  action_type TEXT, entity_type TEXT, entity_id TEXT, ip_address TEXT, user_agent TEXT,
  metadata TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE activity_stats (
  user_id INTEGER, stat_date TEXT, action_count INTEGER DEFAULT 0, updated_at TEXT,
  UNIQUE (user_id, stat_date));
CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT, body TEXT, link TEXT, created_at TEXT);
CREATE TABLE job_idempotency (idempotency_key TEXT PRIMARY KEY, created_at TEXT);
${baselineTable('queue_jobs')}
${baselineTable('super_admins')}
${baselineTable('user_sessions')}
CREATE TABLE fund_distributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fund_id INTEGER NOT NULL, lp_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL, distribution_type TEXT NOT NULL DEFAULT 'cash', source_liquidity_event_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending', notes TEXT, distributed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE fund_report_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fund_id INTEGER, period TEXT, period_start TEXT, period_end TEXT,
  issued_at TEXT, status TEXT, notes TEXT);
${MIGRATION_312}
${withRegistry ? MIGRATION_472 : ''}
`;

function seed(fundISlug: number | null = 1): string {
  const users = USERS.map(([id, role, tier, kyc]) =>
    `(${id}, 'u${id}@example.test', 'U${id}', '${role}', 1, ${tier ? `'${tier}'` : 'NULL'}, '${kyc}')`).join(', ');
  return `
INSERT INTO users (id, email, name, role, is_active, investor_tier, kyc_status) VALUES ${users};
INSERT INTO super_admins (user_id) VALUES (${HOLDER_ID});
INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES
  (${HOLDER_ID}, 'totp-holder', 'totp', datetime('now')),
  (${ADMIN_ID}, 'totp-stale-admin', 'totp', datetime('now', '-2 days')),
  (${ADMIN_ID}, 'password-admin', 'password', datetime('now')),
  (${GP_ID}, 'totp-gp', 'totp', datetime('now'));
INSERT INTO vc_funds (id, name, gp_user_id, slug) VALUES
  (1, 'Fund I', ${GP_ID}, ${fundISlug === 1 ? "'spinout-fund-i'" : 'NULL'}),
  (4, 'Fund IV', ${GP_ID}, ${fundISlug === 4 ? "'spinout-fund-i'" : "'fund-iv'"});
INSERT INTO projects (id, name, sector) VALUES (77, 'Startup', 'AI');
INSERT INTO limited_partners (id, fund_id, user_id, name, email, commitment_amount, status) VALUES
  (100, 1, ${LP_A}, 'LP A', 'u${LP_A}@example.test', 300, 'active'),
  (200, 1, ${LP_B}, 'LP B', 'u${LP_B}@example.test', 300, 'active'),
  (600, 4, ${LP_A}, 'LP A in IV', 'u${LP_A}@example.test', 500, 'active');
INSERT INTO capital_calls (id, limited_partner_id, amount, status, due_date, paid_date) VALUES
  (900, 100, 50, 'paid', NULL, '2026-01-10'),
  (902, 100, 40, 'pending', '2026-12-01', NULL),
  (903, 200, 40, 'pending', '2026-12-01', NULL),
  (960, 600, 30, 'pending', '2026-12-01', NULL);
`;
}

function makeEnv(opts: { registry?: boolean; fundISlug?: number | null } = {}): any {
  const { DB, db } = makeD1(SCHEMA(opts.registry !== false), seed(opts.fundISlug === undefined ? 1 : opts.fundISlug));
  return { JWT_SECRET, ENVIRONMENT: 'development', DB, __db: db };
}

/** The Fund's checking for capital contributions, as the console would write it. */
async function addFundAccount(env: any) {
  const uid = '0000bbbb-0000-4000-8000-000000000001';
  const enc = await encryptColumn(env, 'entity_bank_accounts', 'account_number_enc', uid, FUND_NUMBER);
  env.__db.prepare(`INSERT INTO entity_bank_accounts
      (uid, entity_key, label, bank_name, bank_address, beneficiary_name, beneficiary_address, account_kind,
       account_number_enc, account_last4, routing_number, swift_code, purposes_json, recorded_by)
     VALUES (?, 'fund', 'Fund checking', 'Column N.A.', '1 Letterman Drive', 'Axal VC Spin-Out Lab Fund I LP',
             '16192 Coastal Highway', 'checking', ?, ?, '121145433', 'CLNOUS66MER', '["capital_contribution","gp_commitment"]', ?)`)
    .run(uid, enc, FUND_NUMBER.slice(-4), HOLDER_ID);
}

async function token(userId: number, extra: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({ user_id: userId, role: ROLE.get(userId), ...extra })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

const responses: string[] = [];
async function call(app: any, env: any, userId: number, path: string,
  init: { method?: string; body?: unknown; jti?: string; impersonatedBy?: number } = {}) {
  const claims: Record<string, unknown> = {};
  if (init.jti) claims.jti = init.jti;
  if (init.impersonatedBy) claims.impersonated_by = init.impersonatedBy;
  const res: Response = await app.request(path, {
    method: init.method || 'GET',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: { Authorization: `Bearer ${await token(userId, claims)}`, 'content-type': 'application/json' },
  }, env).catch((e: unknown) => {
    if (e instanceof Response) return e;
    throw e;
  });
  const text = await res.text();
  responses.push(`${init.method || 'GET'} ${path} ${text}`);
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* no body */ }
  return { status: res.status, body, text, headers: res.headers };
}

const q = (env: any, sql: string, ...binds: any[]) => env.__db.prepare(sql).all(...binds) as any[];
const headers = (env: any) => q(env, 'SELECT * FROM fund_capital_calls ORDER BY id');
const lines = (env: any) => q(env, 'SELECT * FROM capital_calls ORDER BY id');
const reveals = (env: any) => q(env, 'SELECT * FROM entity_bank_account_reveals ORDER BY id');

function job(payload: Record<string, unknown>) {
  return {
    id: 0, job_type: 'capital_call_notice' as const, payload: JSON.stringify(payload),
    status: 'processing' as const, attempts: 1, max_retries: 3, error: null,
    created_at: '2026-09-27T00:00:00Z', updated_at: '2026-09-27T00:00:00Z',
    started_at: '2026-09-27T00:00:00Z', completed_at: null, dead_at: null,
  };
}

// A refusal built by `refuse()` (D278) carries its code as `error`. Since
// D714 a call is a Super Admin act, so the legacy routes run as the holder.

// ── The four paths, held ────────────────────────────────────────────────

test('held: POST /:id/capital-call on Fund I without the Fund\'s account writes no header or line', async () => {
  const env = makeEnv();
  const before = lines(env).length;
  const r = await call(funds, env, GP_ID, '/1/capital-call', { method: 'POST', body: { amount_cents: 100_000 } });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.error, 'fund_account_missing');
  assert.match(r.body.message, /Do not send money until Axal adds the Fund's account/);
  assert.equal(headers(env).length, 0);
  assert.equal(lines(env).length, before);
});

test('held: POST /:id/lps with a first call refuses before the LP is written, and enqueues nothing', async () => {
  const env = makeEnv();
  const lpsBefore = q(env, 'SELECT * FROM limited_partners').length;
  const r = await call(funds, env, GP_ID, '/1/lps', { method: 'POST', body: { name: 'New LP', email: 'new@lp.example', commitment_amount: 1000, first_call_cents: 50_000 } });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.error, 'fund_account_missing');
  assert.equal(q(env, 'SELECT * FROM limited_partners').length, lpsBefore, 'the LP was written');
  assert.equal(q(env, 'SELECT * FROM queue_jobs').length, 0, 'a call was enqueued');
});

test('held: the capital_call_notice job writes capital_call_held for the issuer, without throwing', async () => {
  const env = makeEnv();
  await handleJob(env, job({ fund_id: 1, amount_cents: 100_000, call_uid: 'held-call', issued_by: GP_ID }));
  assert.equal(headers(env).length, 0);
  const held = q(env, "SELECT * FROM activity_logs WHERE action = 'capital_call_held'");
  assert.equal(held.length, 1);
  assert.equal(held[0].user_id, GP_ID);
  assert.match(held[0].details, /fund_account_missing/);
  assert.match(held[0].details, /Issue the call again once the Fund's account is added/);
  assert.equal(q(env, "SELECT * FROM activity_logs WHERE action = 'capital_call_notice'").length, 0);
});

test('held: the legacy POST /api/capital/calls refuses a line on Fund I', async () => {
  const env = makeEnv();
  const before = lines(env).length;
  const r = await call(capital, env, HOLDER_ID, '/calls', { method: 'POST', jti: 'totp-holder', body: { limited_partner_id: 100, amount: 25 } });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.error, 'fund_account_missing');
  assert.equal(lines(env).length, before);
});

test('held: the legacy POST /api/capital/capitalCall, which bills every active LP, writes nothing', async () => {
  const env = makeEnv();
  const before = lines(env).length;
  const r = await call(capital, env, HOLDER_ID, '/capitalCall', { method: 'POST', jti: 'totp-holder', body: { startup_id: 77, amount: 300 } });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.error, 'fund_account_missing');
  assert.equal(lines(env).length, before);
});

test('held: the preview shows the refusal; with the account it shows the masked instructions', async () => {
  const env = makeEnv();
  const held = await call(funds, env, GP_ID, '/1/capital-calls/preview', { method: 'POST', body: { amount_cents: 100_000 } });
  assert.equal(held.status, 200, held.text);
  assert.deepEqual([held.body.payment_instructions.ok, held.body.payment_instructions.code], [false, 'fund_account_missing']);
  await addFundAccount(env);
  const ok = await call(funds, env, GP_ID, '/1/capital-calls/preview', { method: 'POST', body: { amount_cents: 100_000 } });
  assert.equal(ok.body.payment_instructions.ok, true, ok.text);
  assert.equal(ok.body.payment_instructions.instructions.account_masked, `••••${FUND_NUMBER.slice(-4)}`);
  assert.ok(!ok.text.includes(FUND_NUMBER), 'the preview carried the number');
  const other = await call(funds, env, GP_ID, '/4/capital-calls/preview', { method: 'POST', body: { amount_cents: 100_000 } });
  assert.equal(other.body.payment_instructions, null, 'a fund that is not Fund I was given Axal instructions');
});

// ── With the account, as before ─────────────────────────────────────────

test('with the Fund\'s account, every path issues as before', async () => {
  const env = makeEnv();
  await addFundAccount(env);
  const issued = await call(funds, env, GP_ID, '/1/capital-call', { method: 'POST', body: { amount_cents: 100_000 } });
  assert.equal(issued.status, 201, issued.text);
  assert.equal(issued.body.lines_written, 2);

  const lp = await call(funds, env, GP_ID, '/1/lps', { method: 'POST', body: { name: 'New LP', email: 'new@lp.example', commitment_amount: 1000, first_call_cents: 50_000 } });
  assert.equal(lp.status, 201, lp.text);
  assert.equal(q(env, "SELECT * FROM queue_jobs WHERE job_type = 'capital_call_notice'").length, 1);

  await handleJob(env, job({ fund_id: 1, amount_cents: 100_000, call_uid: 'job-call', issued_by: GP_ID }));
  assert.equal(headers(env).length, 2);
  assert.equal(q(env, "SELECT * FROM activity_logs WHERE action = 'capital_call_held'").length, 0);

  const one = await call(capital, env, HOLDER_ID, '/calls', { method: 'POST', jti: 'totp-holder', body: { limited_partner_id: 100, amount: 25 } });
  assert.equal(one.status, 201, one.text);
  const all = await call(capital, env, HOLDER_ID, '/capitalCall', { method: 'POST', jti: 'totp-holder', body: { startup_id: 77, amount: 300 } });
  assert.equal(all.status, 200, all.text);
});

test('another fund\'s call issues with no registry table at all', async () => {
  const env = makeEnv({ registry: false });
  const r = await call(funds, env, GP_ID, '/4/capital-call', { method: 'POST', body: { amount_cents: 100_000 } });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.lines_written, 1);
  const legacy = await call(capital, env, HOLDER_ID, '/calls', { method: 'POST', jti: 'totp-holder', body: { limited_partner_id: 600, amount: 25 } });
  assert.equal(legacy.status, 201, legacy.text);
});

// ── The slug lock ───────────────────────────────────────────────────────

const slugOf = (env: any, id: number) => q(env, 'SELECT slug FROM vc_funds WHERE id = ?', id)[0].slug;

test('slug: the fund\'s own GP can neither set spinout-fund-i nor remove it, and the row is unchanged', async () => {
  const env = makeEnv();
  const set = await call(funds, env, GP_ID, '/4', { method: 'PATCH', body: { slug: 'spinout-fund-i' }, jti: 'totp-gp' });
  assert.equal(set.status, 403, set.text);
  assert.deepEqual([set.body.code, set.body.detail], ['super_admin_required', 'Super admin required']);
  assert.equal(slugOf(env, 4), 'fund-iv');
  const remove = await call(funds, env, GP_ID, '/1', { method: 'PATCH', body: { slug: null }, jti: 'totp-gp' });
  assert.equal(remove.status, 403, remove.text);
  assert.equal(slugOf(env, 1), 'spinout-fund-i');
  // Any other change, the slug untouched, is the GP's as before.
  const rename = await call(funds, env, GP_ID, '/1', { method: 'PATCH', body: { name: 'Fund I (renamed)', slug: 'spinout-fund-i' }, jti: 'totp-gp' });
  assert.equal(rename.status, 200, rename.text);
});

for (const [session, jti] of [['a TOTP session with no fresh step-up', 'totp-stale-admin'], ['a non-TOTP session', 'password-admin']] as const) {
  test(`slug: a plain Admin on ${session} gets 403 super_admin_required, no step-up demand, the row unchanged`, async () => {
    const env = makeEnv();
    for (const [id, slug, after] of [[4, 'spinout-fund-i', 'fund-iv'], [1, 'fund-one', 'spinout-fund-i']] as const) {
      const r = await call(funds, env, ADMIN_ID, `/${id}`, { method: 'PATCH', body: { slug }, jti });
      assert.equal(r.status, 403, r.text);
      assert.equal(r.body.code, 'super_admin_required');
      assert.equal(r.body.detail, 'Super admin required');
      assert.doesNotMatch(r.text, /step_up_required|totp/i);
      assert.equal(slugOf(env, id), after);
    }
  });
}

test('slug: the Super Admin with a fresh step-up moves it', async () => {
  const env = makeEnv();
  const off = await call(funds, env, HOLDER_ID, '/1', { method: 'PATCH', body: { slug: null }, jti: 'totp-holder' });
  assert.equal(off.status, 200, off.text);
  assert.equal(slugOf(env, 1), null);
  const on = await call(funds, env, HOLDER_ID, '/4', { method: 'PATCH', body: { slug: 'spinout-fund-i' }, jti: 'totp-holder' });
  assert.equal(on.status, 200, on.text);
  assert.equal(slugOf(env, 4), 'spinout-fund-i');
});

// ── The LP's wire details ───────────────────────────────────────────────

const PAY = (fund: number, line: number) => `/${fund}/capital-calls/lines/${line}/pay-instructions`;

test('the LP\'s own open Fund I line gives the full instructions, the reference and the warning, recorded first', async () => {
  const env = makeEnv();
  await addFundAccount(env);
  const r = await call(funds, env, LP_A, PAY(1, 902));
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.instructions.account_number, FUND_NUMBER);
  assert.equal(r.body.reference, 'AXAL-CC-1-L100-902');
  assert.match(r.body.warning, /^Before you send money, call us/);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  const rows = reveals(env);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].context, rows[0].context_ref, rows[0].actor_user_id], ['capital_call_line', '902', LP_A]);
});

test('anyone but the LP whose line it is gets the same 404, and no reveal is recorded', async () => {
  const env = makeEnv();
  await addFundAccount(env);
  for (const who of [LP_B, GP_ID, ADMIN_ID, HOLDER_ID]) {
    const r = await call(funds, env, who, PAY(1, 902));
    assert.equal(r.status, 404, `${who}: ${r.text}`);
    assert.equal(r.body.error, 'call_line_not_found');
  }
  // The LP's own line under another fund's id, and their line on a fund that is not Fund I.
  for (const path of [PAY(4, 902), PAY(4, 960), PAY(1, 960), PAY(1, 99999)]) {
    const r = await call(funds, env, LP_A, path);
    assert.equal(r.status, 404, `${path}: ${r.text}`);
  }
  assert.equal(reveals(env).length, 0);
});

test('a paid line gets 409 line_already_paid', async () => {
  const env = makeEnv();
  await addFundAccount(env);
  const r = await call(funds, env, LP_A, PAY(1, 900));
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.error, 'line_already_paid');
  assert.equal(reveals(env).length, 0);
});

test('a support session minted for the LP gets 403, and no reveal is recorded', async () => {
  const env = makeEnv();
  await addFundAccount(env);
  const r = await call(funds, env, LP_A, PAY(1, 902), { impersonatedBy: ADMIN_ID });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.body.error, 'support_session_refused');
  assert.ok(!r.text.includes(FUND_NUMBER));
  assert.equal(reveals(env).length, 0);
});

test('with no Fund account, the LP\'s line refuses with the sentence and gives no number', async () => {
  const env = makeEnv();
  const r = await call(funds, env, LP_A, PAY(1, 902));
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.error, 'fund_account_missing');
});

test('/lp-portal carries the masked fields on each unpaid Fund I line, and the number is in no other response', async () => {
  const env = makeEnv();
  await addFundAccount(env);
  const start = responses.length;
  const r = await call(funds, env, LP_A, '/lp-portal');
  assert.equal(r.status, 200, r.text);
  const byId = new Map(r.body.capital_calls.map((c: any) => [Number(c.id), c]));
  const open: any = byId.get(902);
  assert.deepEqual(
    [open.pay_instructions.available, open.pay_instructions.bank_name, open.pay_instructions.account_masked, open.pay_instructions.reference],
    [true, 'Column N.A.', `••••${FUND_NUMBER.slice(-4)}`, 'AXAL-CC-1-L100-902'],
  );
  assert.equal((byId.get(900) as any).pay_instructions, null, 'a paid line was given wire details');
  assert.equal((byId.get(960) as any).pay_instructions, null, 'a line on another fund was given Axal instructions');
  assert.equal(reveals(env).length, 0, 'the portal recorded a reveal');

  await call(funds, env, LP_A, PAY(1, 902));
  const leaking = responses.slice(start).filter((t) => t.includes(FUND_NUMBER) && !t.includes('/pay-instructions '));
  assert.deepEqual(leaking, [], 'a response other than the LP\'s reveal carried the number');
});

test('/lp-portal without the Fund account says why, on the same lines', async () => {
  const env = makeEnv();
  const r = await call(funds, env, LP_A, '/lp-portal');
  const open = r.body.capital_calls.find((c: any) => Number(c.id) === 902);
  assert.deepEqual([open.pay_instructions.available, open.pay_instructions.code], [false, 'fund_account_missing']);
});
