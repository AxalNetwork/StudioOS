/**
 * D714 (#1779) — every fund act, driven through the real routers on node:sqlite.
 *
 * Actors:
 *   ADMIN        plain Admin: an HQ admin without the elevation, in a fresh TOTP session
 *   SUPER        the Super Admin; three sessions — fresh TOTP, TOTP two days old, SMS
 *   FROZEN       plain Admin holding an overdue compliance notice (D135)
 *   COOL         a Super Admin in a recovery cool-off, fresh TOTP session
 *   GP           institutional investor, GP of record of Fund 1
 *   OTHER_GP     institutional investor, GP of record of Fund 2
 *   LP           investor, an LP of Fund 1, and the ledger administrator's candidate
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fund_admin_acts_d714.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import funds from '../src/routes/funds.ts';
import capital from '../src/routes/capital.ts';
import fundLedger from '../src/routes/fund_ledger.ts';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const BASELINE = read('../sql/schema_baseline.sql');

const ADMIN = 1;
const SUPER = 2;
const FROZEN = 3;
const COOL = 5;
const LP = 10;
const GP = 40;
const OTHER_GP = 41;

/** jti per (user, session kind). */
const JTI: Record<string, string> = {
  [`${ADMIN}`]: 'totp-admin',
  [`${ADMIN}:stale`]: 'totp-admin-stale',
  [`${ADMIN}:sms`]: 'sms-admin',
  [`${SUPER}`]: 'totp-super',
  [`${SUPER}:stale`]: 'totp-super-stale',
  [`${SUPER}:sms`]: 'sms-super',
  [`${FROZEN}`]: 'totp-frozen',
  [`${COOL}`]: 'totp-cool',
};

const TABLES = ['users', 'super_admins', 'user_sessions', 'vc_funds', 'limited_partners', 'capital_calls', 'projects',
  'partners', 'activity_logs', 'activity_stats', 'notifications', 'queue_jobs', 'liquidity_events', 'fund_distributions',
  'fund_report_periods', 'portfolio_positions', 'legal_documents'];

const SCHEMA = [
  ...TABLES.map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))),
  'CREATE TABLE user_recovery_state (user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);',
  'CREATE UNIQUE INDEX periods_unique ON fund_report_periods(fund_id, period);',
  stripForeignKeys(read('../sql/migrations/264_admin_notices.sql')),
  read('../sql/migrations/312_fund_call_ledger.sql'),
  read('../sql/migrations/418_fund_ledger.sql'),
  // D709 (#1774): a receipt also settles a fee line linked to its call line.
  read('../sql/migrations/473_fund_management_fees.sql'),
].join('\n');

const SEED = `
INSERT INTO users (id, email, name, role, is_active, investor_tier, investor_subscription_status, kyc_status) VALUES
  (${ADMIN}, 'admin@example.test', 'Plain Admin', 'admin', 1, 'free', 'active', 'approved'),
  (${SUPER}, 'super@example.test', 'Super Admin', 'admin', 1, 'free', 'active', 'approved'),
  (${FROZEN}, 'frozen@example.test', 'Frozen Admin', 'admin', 1, 'free', 'active', 'approved'),
  (${COOL}, 'cool@example.test', 'Recovered Super', 'admin', 1, 'free', 'active', 'approved'),
  (${LP}, 'lp@example.test', 'LP', 'investor', 1, 'free', 'active', 'approved'),
  (${GP}, 'gp@example.test', 'GP', 'investor', 1, 'institutional', 'active', 'approved'),
  (${OTHER_GP}, 'other@example.test', 'Other GP', 'investor', 1, 'institutional', 'active', 'approved');
INSERT INTO super_admins (user_id) VALUES (${SUPER}), (${COOL});
INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES
  (${ADMIN}, 'totp-admin', 'totp', datetime('now')),
  (${ADMIN}, 'totp-admin-stale', 'totp', datetime('now', '-2 days')),
  (${ADMIN}, 'sms-admin', 'sms', datetime('now')),
  (${SUPER}, 'totp-super', 'totp', datetime('now')),
  (${SUPER}, 'totp-super-stale', 'totp', datetime('now', '-2 days')),
  (${SUPER}, 'sms-super', 'sms', datetime('now')),
  (${FROZEN}, 'totp-frozen', 'totp', datetime('now')),
  (${COOL}, 'totp-cool', 'totp', datetime('now'));
INSERT INTO admin_notices (uid, user_id, kind, subject, body, respond_by, status)
  VALUES ('notice-1', ${FROZEN}, 'fees', 'Fees overdue', 'Answer this notice.', datetime('now', '-1 day'), 'overdue');
INSERT INTO user_recovery_state (user_id, cooling_off_until) VALUES (${COOL}, datetime('now', '+1 day'));
INSERT INTO vc_funds (id, name, gp_user_id, carried_interest, management_fee) VALUES
  (1, 'Fund 1', ${GP}, 0.2, 0.02), (2, 'Fund 2', ${OTHER_GP}, 0.2, 0.02);
INSERT INTO limited_partners (id, fund_id, user_id, name, email, commitment_amount, invested_amount, status) VALUES
  (100, 1, ${LP}, 'LP A', 'lp@example.test', 600, 100, 'active'),
  (101, 1, NULL, 'LP B', 'b@lp.example', 400, 100, 'committed');
INSERT INTO projects (id, name, sector) VALUES (1, 'Project', 'ai');
INSERT INTO fund_distributions (id, fund_id, lp_id, amount_cents, distribution_type, status)
  VALUES (700, 1, 100, 5000, 'exit_proceeds', 'pending');
`;

function makeEnv(extra: Record<string, unknown> = {}): any {
  const { DB, db } = makeD1(SCHEMA, SEED);
  return { JWT_SECRET, ENVIRONMENT: 'development', DB, __db: db, ...extra };
}

const app = new Hono<any>();
app.route('/api/funds', funds);
app.route('/api/capital', capital);
app.route('/api/fund-ledger', fundLedger);

type As = { user: number; session?: 'stale' | 'sms'; support?: boolean };

async function token(as: As): Promise<string> {
  const jti = JTI[as.session ? `${as.user}:${as.session}` : `${as.user}`];
  return new SignJWT({ user_id: as.user, ...(jti ? { jti } : {}), ...(as.support ? { impersonated_by: SUPER } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/** A route call, with a thrown gate Response unwrapped as the Worker's fetch does. */
async function call(env: any, as: As | number, method: string, path: string, body?: unknown) {
  const who = typeof as === 'number' ? { user: as } : as;
  const res: Response = await (app.request(path, {
    method,
    headers: { Authorization: `Bearer ${await token(who)}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env) as Promise<Response>).catch((e: unknown) => {
    if (e instanceof Response) return e;
    throw e;
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, body: json };
}

const q = (env: any, sql: string, ...b: any[]) => env.__db.prepare(sql).all(...b) as any[];
const one = (env: any, sql: string, ...b: any[]) => env.__db.prepare(sql).get(...b) as any;

/** Everything a fund act could write, except the logs. */
function snapshot(env: any): string {
  const tables = ['vc_funds', 'limited_partners', 'capital_calls', 'fund_capital_calls', 'capital_call_receipts',
    'queue_jobs', 'liquidity_events', 'fund_distributions', 'fund_report_periods', 'fund_ledger_accounts',
    'fund_accounting_periods', 'fund_ledger_entries', 'fund_ledger_lines'];
  return JSON.stringify(tables.map((t) => q(env, `SELECT * FROM ${t} ORDER BY rowid`)));
}

const auditRows = (env: any) => {
  try { return q(env, 'SELECT admin_user_id, action, filters_json FROM admin_audit_log ORDER BY id'); } catch { return []; }
};

/** Each Super Admin act, one request apiece. */
const SUPER_ACTS: Array<[string, string, string, unknown]> = [
  ['issue a call', 'POST', '/api/funds/1/capital-call', { amount_cents: 100_000 }],
  ['add an LP with a first call', 'POST', '/api/funds/1/lps', { name: 'New LP', email: 'new@lp.example', commitment_amount: 100, first_call_cents: 5_000 }],
  ['legacy create call', 'POST', '/api/capital/calls', { limited_partner_id: 100, amount: 5 }],
  ['legacy issue to all', 'POST', '/api/capital/capitalCall', { startup_id: 1, amount: 10 }],
  ['execute a distribution', 'POST', '/api/funds/distributions/execute', { fund_id: 1, proceeds_cents: 100_000 }],
  ['change the GP of record', 'PATCH', '/api/funds/1', { gp_user_id: OTHER_GP }],
  ['change the carry', 'PATCH', '/api/funds/1', { carried_interest: 0.3 }],
  ['assign the ledger administrator', 'PUT', '/api/fund-ledger/1/administrator', { user_id: LP }],
];

// ── The Super Admin acts ────────────────────────────────────────────────

test('a plain Admin is refused every Super Admin act with super_admin_required, never a code demand, and writes nothing', async () => {
  // Fresh TOTP, TOTP two days old, SMS: whatever the session, the answer is
  // the elevation — a plain Admin is never asked for a code it cannot use.
  for (const session of [undefined, 'stale', 'sms'] as const) {
    for (const [name, method, path, body] of SUPER_ACTS) {
      const env = makeEnv();
      const before = snapshot(env);
      const r = await call(env, { user: ADMIN, session }, method, path, body);
      assert.equal(r.status, 403, `${name} (${session ?? 'fresh'}): ${JSON.stringify(r.body)}`);
      assert.equal(r.body?.code, 'super_admin_required', `${name} (${session ?? 'fresh'}): ${JSON.stringify(r.body)}`);
      assert.equal(snapshot(env), before, `${name} wrote something`);
      assert.equal(auditRows(env).length, 0, `${name} left an audit row`);
    }
  }
});

test('the Super Admin without a TOTP session is refused; with a stale step-up gets step_up_required on every route; fresh, succeeds', async () => {
  for (const [name, method, path, body] of SUPER_ACTS) {
    const env = makeEnv();
    const before = snapshot(env);
    const sms = await call(env, { user: SUPER, session: 'sms' }, method, path, body);
    assert.equal(sms.status, 403, `${name} on SMS: ${JSON.stringify(sms.body)}`);
    assert.equal(sms.body?.detail, 'TOTP required', name);
    const stale = await call(env, { user: SUPER, session: 'stale' }, method, path, body);
    assert.equal(stale.status, 403, `${name} stale: ${JSON.stringify(stale.body)}`);
    assert.equal(stale.body?.code, 'step_up_required', `${name}: the SPA's step-up prompt keys on this code`);
    assert.equal(snapshot(env), before, `${name} wrote something before the bar`);
    const fresh = await call(env, SUPER, method, path, body);
    assert.ok(fresh.status === 200 || fresh.status === 201, `${name} fresh: ${fresh.status} ${JSON.stringify(fresh.body)}`);
    assert.notEqual(snapshot(env), before, `${name} succeeded and wrote nothing`);
  }
});

// ── The Admin acts ──────────────────────────────────────────────────────

test('a plain Admin previews a call and a distribution, records a receipt, marks paid, drafts a report, renames a fund and writes the ledger', async () => {
  const env = makeEnv();
  assert.equal((await call(env, SUPER, 'POST', '/api/funds/1/capital-call', { amount_cents: 100_000 })).status, 201);
  const line = one(env, 'SELECT id FROM capital_calls WHERE fund_call_id IS NOT NULL ORDER BY id LIMIT 1');
  const steps: Array<[string, string, unknown, number]> = [
    ['POST', '/api/funds/1/capital-calls/preview', { amount_cents: 1_000 }, 200],
    ['POST', '/api/funds/1/distributions/preview', { proceeds_cents: 1_000 }, 200],
    ['POST', `/api/funds/1/capital-calls/lines/${line.id}/receipts`, { amount_cents: 100, received_on: '2026-01-02', reference: 'WIRE-REF-SECRET' }, 201],
    ['POST', '/api/funds/distributions/700/mark-paid', undefined, 200],
    ['POST', '/api/funds/1/report-periods', { period: 'Q2 2026', period_start: '2026-04-01', period_end: '2026-06-30', narrative: { letter: ['Letter.'] } }, 201],
    ['PATCH', '/api/funds/1', { name: 'Fund One' }, 200],
    ['POST', '/api/fund-ledger/1/accounts', { code: 'CASH', name: 'Cash', category: 'asset' }, 201],
  ];
  for (const [method, path, body, status] of steps) {
    const r = await call(env, ADMIN, method, path, body);
    assert.equal(r.status, status, `${method} ${path}: ${JSON.stringify(r.body)}`);
  }
  assert.equal(one(env, 'SELECT name FROM vc_funds WHERE id = 1').name, 'Fund One');
  assert.equal(one(env, "SELECT status FROM fund_distributions WHERE id = 700").status, 'paid');
  assert.equal(one(env, "SELECT status FROM fund_report_periods WHERE fund_id = 1").status, 'draft');
});

test('a frozen plain Admin\'s receipt, report draft and ledger write get 423 admin_frozen, and write nothing', async () => {
  const env = makeEnv();
  assert.equal((await call(env, SUPER, 'POST', '/api/funds/1/capital-call', { amount_cents: 100_000 })).status, 201);
  const line = one(env, 'SELECT id FROM capital_calls WHERE fund_call_id IS NOT NULL ORDER BY id LIMIT 1');
  const before = snapshot(env);
  for (const [method, path, body] of [
    ['POST', `/api/funds/1/capital-calls/lines/${line.id}/receipts`, { amount_cents: 100, received_on: '2026-01-02' }],
    ['POST', '/api/funds/1/report-periods', { period: 'Q2 2026', period_start: '2026-04-01', period_end: '2026-06-30', narrative: { letter: ['L.'] } }],
    ['POST', '/api/fund-ledger/1/accounts', { code: 'CASH', name: 'Cash', category: 'asset' }],
  ] as Array<[string, string, unknown]>) {
    const r = await call(env, FROZEN, method, path, body);
    assert.equal(r.status, 423, `${path}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body?.code, 'admin_frozen', `${path}: the freeze banner keys on this code`);
    assert.equal(r.body?.notice?.uid, 'notice-1');
  }
  assert.equal(snapshot(env), before);
  // A read stays open to a frozen admin.
  assert.equal((await call(env, FROZEN, 'GET', '/api/funds/1/capital-calls')).status, 200);
});

// ── Support sessions ────────────────────────────────────────────────────

/** One request per act key in the table. */
const EVERY_ACT: Array<[string, string, string, unknown]> = [
  ['capital_call.preview', 'POST', '/api/funds/1/capital-calls/preview', { amount_cents: 1_000 }],
  ['capital_call.issue', 'POST', '/api/funds/1/capital-call', { amount_cents: 1_000 }],
  ['capital_call.receipt', 'POST', '/api/funds/1/capital-calls/lines/1/receipts', { amount_cents: 1, received_on: '2026-01-02' }],
  ['distribution.preview', 'POST', '/api/funds/1/distributions/preview', { proceeds_cents: 1_000 }],
  ['distribution.execute', 'POST', '/api/funds/distributions/execute', { fund_id: 1, proceeds_cents: 1_000 }],
  ['distribution.mark_paid', 'POST', '/api/funds/distributions/700/mark-paid', undefined],
  ['fund_report.draft', 'POST', '/api/funds/1/report-periods', { period: 'Q2 2026', period_start: '2026-04-01', period_end: '2026-06-30', narrative: {} }],
  ['fund.gp_of_record', 'PATCH', '/api/funds/1', { gp_user_id: OTHER_GP }],
  ['fund.economics', 'PATCH', '/api/funds/1', { management_fee: 0.03 }],
  ['fund.write', 'PATCH', '/api/funds/1', { name: 'Renamed' }],
  ['fund_ledger.administrator', 'PUT', '/api/fund-ledger/1/administrator', { user_id: LP }],
  ['fund_ledger.write', 'POST', '/api/fund-ledger/1/accounts', { code: 'CASH', name: 'Cash', category: 'asset' }],
];

test('a support session is refused every act key, as an admin and as the GP of record; its reads still answer', async () => {
  for (const user of [SUPER, ADMIN, GP]) {
    for (const [act, method, path, body] of EVERY_ACT) {
      if (user === GP && act.startsWith('fund_ledger.')) continue; // the GP has no ledger role to act through
      const env = makeEnv();
      const before = snapshot(env);
      const r = await call(env, { user, support: true }, method, path, body);
      assert.equal(r.status, 403, `${act} as ${user}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body?.code, 'support_session_refused', `${act} as ${user}`);
      assert.equal(snapshot(env), before, `${act} as ${user} wrote something`);
    }
  }
  const env = makeEnv();
  assert.equal((await call(env, { user: GP, support: true }, 'GET', '/api/funds/1/capital-calls')).status, 200);
});

// ── The GP of record, a branch, the cool-off ────────────────────────────

test('an institutional GP of record issues, executes and issues a report on their own fund as today, and cannot change its GP of record', async () => {
  const env = makeEnv();
  assert.equal((await call(env, GP, 'POST', '/api/funds/1/capital-call', { amount_cents: 100_000 })).status, 201);
  assert.equal((await call(env, GP, 'POST', '/api/funds/distributions/execute', { fund_id: 1, proceeds_cents: 10_000 })).status, 200);
  const report = await call(env, GP, 'POST', '/api/funds/1/report-periods',
    { period: 'Q2 2026', period_start: '2026-04-01', period_end: '2026-06-30', narrative: { letter: ['L.'] }, issue: true });
  assert.equal(report.status, 201, JSON.stringify(report.body));
  assert.equal((await call(env, GP, 'PATCH', '/api/funds/1', { carried_interest: 0.25 })).status, 200);
  const before = snapshot(env);
  const r = await call(env, GP, 'PATCH', '/api/funds/1', { gp_user_id: OTHER_GP });
  assert.equal(r.status, 403);
  assert.equal(r.body?.code, 'super_admin_required');
  assert.equal(snapshot(env), before);
  // Sending the GP of record it already has is not a change.
  assert.equal((await call(env, GP, 'PATCH', '/api/funds/1', { gp_user_id: GP, name: 'Same GP' })).status, 200);
});

test('on a branch Worker an admin issues as today, and a support session is still refused', async () => {
  const env = makeEnv({ BRANCH_CODE: 'fr' });
  const r = await call(env, ADMIN, 'POST', '/api/funds/1/capital-call', { amount_cents: 100_000 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const s = await call(env, { user: ADMIN, support: true }, 'POST', '/api/funds/1/capital-call', { amount_cents: 100_000 });
  assert.equal(s.status, 403);
  assert.equal(s.body?.code, 'support_session_refused');
});

test('an account in its recovery cool-off gets 423 on a first call and a GP change, while its GET of the fund answers', async () => {
  const env = makeEnv();
  const before = snapshot(env);
  for (const [method, path, body] of [
    ['POST', '/api/funds/1/lps', { name: 'New', email: 'n@lp.example', commitment_amount: 1, first_call_cents: 100 }],
    ['PATCH', '/api/funds/1', { gp_user_id: OTHER_GP }],
  ] as Array<[string, string, unknown]>) {
    const r = await call(env, COOL, method, path, body);
    assert.equal(r.status, 423, `${path}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body?.error, 'recovery_cool_off_active');
  }
  assert.equal(snapshot(env), before);
  assert.equal((await call(env, COOL, 'GET', '/api/funds/1')).status, 200);
  // An Admin act on the same route is not paused.
  assert.equal((await call(env, COOL, 'PATCH', '/api/funds/1', { name: 'Renamed in cool-off' })).status, 200);
});

// ── The audit ───────────────────────────────────────────────────────────

test('each admin act writes one fund_admin.<act> row with no bank text; mark-paid logs its activity; control changes keep old and new', async () => {
  const env = makeEnv();
  assert.equal((await call(env, SUPER, 'POST', '/api/funds/1/capital-call', { amount_cents: 100_000 })).status, 201);
  const line = one(env, 'SELECT id FROM capital_calls WHERE fund_call_id IS NOT NULL ORDER BY id LIMIT 1');
  assert.equal((await call(env, ADMIN, 'POST', `/api/funds/1/capital-calls/lines/${line.id}/receipts`,
    { amount_cents: 100, received_on: '2026-01-02', reference: 'WIRE-REF-SECRET' })).status, 201);
  assert.equal((await call(env, ADMIN, 'POST', '/api/funds/distributions/700/mark-paid')).status, 200);
  assert.equal((await call(env, SUPER, 'PATCH', '/api/funds/1', { gp_user_id: OTHER_GP })).status, 200);
  assert.equal((await call(env, SUPER, 'PATCH', '/api/funds/1', { carried_interest: 0.3 })).status, 200);

  const rows = auditRows(env);
  assert.deepEqual(rows.map((r) => [r.admin_user_id, r.action]), [
    [SUPER, 'fund_admin.capital_call.issue'],
    [ADMIN, 'fund_admin.capital_call.receipt'],
    [ADMIN, 'fund_admin.distribution.mark_paid'],
    [SUPER, 'fund_admin.fund.gp_of_record'],
    [SUPER, 'fund_admin.fund.economics'],
  ]);
  assert.doesNotMatch(JSON.stringify(rows), /WIRE-REF-SECRET/, 'a receipt reference reached the audit row');
  const receipt = JSON.parse(rows[1].filters_json);
  assert.equal(receipt.act, 'capital_call.receipt');
  assert.equal(receipt.fund_id, 1);
  assert.equal(receipt.amount_cents, 100);
  assert.deepEqual(JSON.parse(rows[3].filters_json).changes, { gp_user_id: { from: GP, to: OTHER_GP } });
  assert.deepEqual(JSON.parse(rows[4].filters_json).changes, { carried_interest: { from: 0.2, to: 0.3 } });

  const paid = q(env, "SELECT user_id, metadata FROM activity_logs WHERE action_type = 'distribution_marked_paid'");
  assert.equal(paid.length, 1);
  assert.deepEqual(JSON.parse(paid[0].metadata), { fund_id: 1, lp_id: 100, amount_cents: 5000 });
  const updated = q(env, "SELECT metadata FROM activity_logs WHERE action_type = 'fund_updated' ORDER BY id")
    .map((r) => JSON.parse(r.metadata));
  assert.deepEqual(updated.map((m) => m.fields.filter((f: string) => f !== 'updated_at')), [['gp_user_id'], ['carried_interest']]);
});

test('a GP of record\'s own act leaves no admin audit row; the mark-paid activity row is written for every caller', async () => {
  const env = makeEnv();
  assert.equal((await call(env, GP, 'POST', '/api/funds/distributions/700/mark-paid')).status, 200);
  assert.equal(auditRows(env).length, 0);
  assert.equal(q(env, "SELECT 1 FROM activity_logs WHERE action_type = 'distribution_marked_paid' AND user_id = ?", GP).length, 1);
});
