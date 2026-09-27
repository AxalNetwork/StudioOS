/**
 * D371 — the fund call ledger, on a real node:sqlite database with migration
 * 312 applied from its own file.
 *
 * Money is integer cents; a call's lines sum to the call exactly, and the
 * rounding residual sits on one named line. Receipts are append-only — the
 * database refuses UPDATE and DELETE — and a receipt moves money once. Every
 * gate is asserted from the refused role's side (nothing written, nothing
 * moved) and from the permitted one.
 *
 * Actors:
 *   ADMIN        admin — unscoped
 *   GP           institutional investor, GP of record of Funds I and IV
 *   OTHER_GP     institutional investor, GP of record of Fund II
 *   LAPSED_GP    GP of record of Fund III whose tier is free
 *   LP_A / LP_B  investors (free tier) holding positions in Fund I
 *   FOUNDER      founder, no fund
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fund_call_ledger_d371.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import funds from '../src/routes/funds.ts';
import capital from '../src/routes/capital.ts';
import { handleJob } from '../src/services/queueWorker.ts';
import { hardDeleteProject } from '../src/services/projectTrash.ts';
import { splitCall } from '../src/services/fundCallSplit.ts';
import { daysOverdue } from '../src/services/fundCallLedger.ts';
import { makeD1 } from './_d1_sqlite.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION_312 = readFileSync(resolve(HERE, '../sql/migrations/312_fund_call_ledger.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADMIN_ID = 1;
const GP_ID = 40;
const OTHER_GP_ID = 41;
const LAPSED_GP_ID = 42;
const LP_A = 10;
const LP_B = 20;
const FOUNDER_ID = 60;

const USERS: Array<[number, string, string | null, string]> = [
  [ADMIN_ID, 'admin', null, 'approved'],
  [GP_ID, 'investor', 'institutional', 'approved'],
  [OTHER_GP_ID, 'investor', 'institutional', 'approved'],
  [LAPSED_GP_ID, 'investor', null, 'approved'],
  [LP_A, 'investor', null, 'approved'],
  [LP_B, 'investor', null, 'pending'],
  [FOUNDER_ID, 'founder', null, 'not_started'],
];
const ROLE = new Map(USERS.map(([id, role]) => [id, role]));

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
${MIGRATION_312}
`;

/**
 * Fund I has three billed LPs with EQUAL commitments, so every call that is not
 * a multiple of three cents leaves a residual — the case the old REAL shares
 * could not account for — and a redeemed LP the call must skip. It also
 * carries two lines written before 312: one paid (with no receipt behind it)
 * and one overdue.
 */
function seed(): string {
  const users = USERS.map(([id, role, tier, kyc]) =>
    `(${id}, 'u${id}@example.test', 'U${id}', '${role}', 1, ${tier ? `'${tier}'` : 'NULL'}, '${kyc}')`).join(', ');
  return `
INSERT INTO users (id, email, name, role, is_active, investor_tier, kyc_status) VALUES ${users};
INSERT INTO vc_funds (id, name, gp_user_id) VALUES
  (1, 'Fund I', ${GP_ID}), (2, 'Fund II', ${OTHER_GP_ID}), (3, 'Fund III', ${LAPSED_GP_ID}), (4, 'Fund IV', ${GP_ID});
INSERT INTO limited_partners (id, fund_id, user_id, name, email, commitment_amount, status) VALUES
  (100, 1, ${LP_A}, 'LP A', 'u${LP_A}@example.test', 300, 'committed'),
  (200, 1, ${LP_B}, 'LP B', 'u${LP_B}@example.test', 300, 'active'),
  (300, 1, NULL,    'Institution', 'inst@lp.example', 300, 'committed'),
  (400, 1, NULL,    'Redeemed', 'gone@lp.example', 999, 'redeemed'),
  (500, 2, NULL,    'Fund II LP', 'two@lp.example', 1000, 'active');
INSERT INTO capital_calls (id, limited_partner_id, amount, status, due_date, paid_date, created_at) VALUES
  (900, 100, 50, 'paid', NULL, '2026-01-10', '2026-01-05 00:00:00'),
  (901, 200, 25.5, 'pending', '2026-01-01', NULL, '2026-01-06 00:00:00'),
  (950, 500, 100, 'pending', NULL, NULL, '2026-01-07 00:00:00');
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

/** A route call, with a thrown gate Response unwrapped as the Worker's fetch does. */
async function call(app: any, env: any, userId: number, path: string, init: { method?: string; body?: unknown } = {}) {
  const res: Response = await app.request(path, {
    method: init.method || 'GET',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: { Authorization: `Bearer ${await token(userId)}`, 'content-type': 'application/json' },
  }, env).catch((e: unknown) => {
    if (e instanceof Response) return e;
    throw e;
  });
  let body: any = null;
  try { body = await res.json(); } catch { /* no body */ }
  return { status: res.status, body };
}

const q = (env: any, sql: string, ...binds: any[]) => env.__db.prepare(sql).all(...binds) as any[];
const one = (env: any, sql: string, ...binds: any[]) => env.__db.prepare(sql).get(...binds) as any;
const headers = (env: any) => q(env, 'SELECT * FROM fund_capital_calls ORDER BY id');
const fundLines = (env: any, callId: number) =>
  q(env, 'SELECT * FROM capital_calls WHERE fund_call_id = ? ORDER BY limited_partner_id', callId);
const receipts = (env: any) => q(env, 'SELECT * FROM capital_call_receipts ORDER BY id');
const invested = (env: any, lpId: number) => Number(one(env, 'SELECT invested_amount AS v FROM limited_partners WHERE id = ?', lpId).v);
const deployed = (env: any, fundId: number) => Number(one(env, 'SELECT deployed_capital AS v FROM vc_funds WHERE id = ?', fundId).v);
const today = () => new Date().toISOString().slice(0, 10);

async function issue(env: any, body: Record<string, unknown> = { amount_cents: 100_000 }, who = GP_ID, fund = 1) {
  return call(funds, env, who, `/${fund}/capital-call`, { method: 'POST', body });
}

// ── The split ───────────────────────────────────────────────────────────

test('split: three equal commitments on $1,000.00 sum to the call, and the odd cent is named', () => {
  const s = splitCall(100_000, [
    { id: 300, commitment_amount: 300 }, { id: 100, commitment_amount: 300 }, { id: 200, commitment_amount: 300 },
  ]);
  assert.equal(s.lines.reduce((t, l) => t + l.shareCents, 0), 100_000, 'the lines do not sum to the call');
  assert.equal(s.residualCents, 1);
  // Equal commitments: the lowest LP id carries it, whatever order they came in.
  assert.equal(s.residualLpId, 100);
  assert.deepEqual(s.lines.map((l) => [l.lpId, l.shareCents, l.residual]),
    [[300, 33333, false], [100, 33334, true], [200, 33333, false]]);
});

test('split: the residual goes to the largest commitment, and only to it', () => {
  const s = splitCall(1_001, [
    { id: 1, commitment_amount: 1 }, { id: 2, commitment_amount: 5 }, { id: 3, commitment_amount: 3 },
  ]);
  assert.equal(s.lines.reduce((t, l) => t + l.shareCents, 0), 1_001);
  assert.equal(s.residualLpId, 2);
  assert.equal(s.lines.filter((l) => l.residual).length, 1);
});

test('split: amounts past 2^53 in the product stay exact', () => {
  // ~$90 trillion against three large commitments: amount × commitment passes
  // 2^53, where a Number product loses low digits. On these figures a
  // floating-point floor moves a cent from the second line to the third.
  const s = splitCall(8_999_999_999_912_891, [
    { id: 1, commitment_amount: 12_345_678_901.12 },
    { id: 2, commitment_amount: 55_555_555_555.55 },
    { id: 3, commitment_amount: 98_765_432_109.09 },
  ]);
  assert.deepEqual(s.lines.map((l) => l.shareCents), [666_666_661_057_654, 3_000_000_001_786_983, 5_333_333_337_068_254]);
  assert.equal(s.lines.reduce((t, l) => t + BigInt(l.shareCents), 0n), 8_999_999_999_912_891n);
});

test('split: no commitment, no line; a share that floors to nothing is not billed', () => {
  const s = splitCall(5, [
    { id: 1, commitment_amount: 0 }, { id: 2, commitment_amount: null },
    { id: 3, commitment_amount: 1_000_000 }, { id: 4, commitment_amount: 1 },
  ]);
  assert.deepEqual(s.excluded, [{ lpId: 1, reason: 'no_commitment' }, { lpId: 2, reason: 'no_commitment' }]);
  assert.deepEqual(s.lines.map((l) => l.lpId), [3], 'a zero share was billed');
  assert.equal(s.lines[0].shareCents, 5);
});

test('split: an amount that is not a positive whole number of cents is refused', () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
    assert.throws(() => splitCall(bad, [{ id: 1, commitment_amount: 1 }]), /positive whole number of cents/);
  }
});

// ── Issuing ─────────────────────────────────────────────────────────────

test('issue: the GP issues a numbered call whose lines sum to it, with the residual named', async () => {
  const env = makeEnv();
  const r = await issue(env, { amount_cents: 100_000, note: 'Call for the Series A reserve', due_date: '2026-12-15' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.call.call_number, 1);
  assert.equal(r.body.lines_written, 3);
  const [h] = headers(env);
  assert.equal(h.amount_cents, 100_000);
  assert.equal(h.purpose, 'Call for the Series A reserve');
  assert.equal(h.due_date, '2026-12-15');
  assert.equal(h.issued_by, GP_ID);
  assert.equal(h.residual_cents, 1);
  assert.equal(h.residual_lp_id, 100);
  const lines = fundLines(env, h.id);
  assert.deepEqual(lines.map((l) => l.limited_partner_id), [100, 200, 300], 'the redeemed LP was billed');
  assert.equal(lines.reduce((t, l) => t + l.amount_cents, 0), 100_000, 'the lines do not sum to the call');
  assert.deepEqual(lines.map((l) => l.amount_cents), [33334, 33333, 33333]);
  assert.deepEqual(lines.map((l) => l.amount), [333.34, 333.33, 333.33], 'the dollar column disagrees with the cents');
  assert.ok(lines.every((l) => l.due_date === '2026-12-15' && l.status === 'pending'));
  // Nothing is paid by issuing.
  assert.equal(deployed(env, 1), 0);
  const second = await issue(env, { amount_cents: 30_000 });
  assert.equal(second.body.call.call_number, 2, 'the second call is not numbered after the first');
  // No due date given, none invented: on the header or on any line.
  assert.equal(second.body.call.due_date, null);
  assert.ok(fundLines(env, second.body.call.id).every((l) => l.due_date === null), 'a line was given a due date nobody typed');
});

test('issue: an in-app notice is logged for each LP with an account, none invented for one without', async () => {
  const env = makeEnv();
  await issue(env);
  const notices = q(env, "SELECT user_id, details FROM activity_logs WHERE action = 'capital_call_notice' ORDER BY id");
  assert.equal(notices.length, 3);
  assert.deepEqual(notices.map((n) => n.user_id), [LP_A, LP_B, null]);
  assert.match(notices[0].details, /^Capital call 1 from fund #1: \$333\.34 due \(pro-rata of \$1000\)\.$/);
});

test('issue: refused for an LP, another fund\'s GP, a lapsed GP and a founder — nothing written', async () => {
  // The tier check applies to investors only (userMeetsInvestorTier), so a
  // founder reaches the ownership check and gets its 404.
  for (const [who, fund, status] of [[LP_A, 1, 402], [OTHER_GP_ID, 1, 404], [LAPSED_GP_ID, 3, 402], [FOUNDER_ID, 1, 404]]) {
    const env = makeEnv();
    const r = await issue(env, { amount_cents: 100_000 }, who, fund);
    assert.equal(r.status, status, `user ${who} on fund ${fund}: ${JSON.stringify(r.body)}`);
    assert.equal(headers(env).length, 0, `user ${who} wrote a call header`);
    assert.equal(q(env, 'SELECT * FROM capital_calls WHERE fund_call_id IS NOT NULL').length, 0);
  }
});

test('issue: an admin may issue on any fund', async () => {
  const env = makeEnv();
  const r = await issue(env, { amount_cents: 1_000 }, ADMIN_ID, 2);
  assert.equal(r.status, 201);
  assert.equal(headers(env)[0].fund_id, 2);
});

test('issue: a bad amount or due date is refused with our sentence, and nothing is written', async () => {
  for (const body of [{ amount_cents: 0 }, { amount_cents: 12.5 }, { amount: 'lots' }, {}]) {
    const env = makeEnv();
    const r = await issue(env, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error, 'invalid_amount');
    assert.equal(headers(env).length, 0);
  }
  for (const due_date of ['2026-02-30', 'next friday', '15/12/2026']) {
    const env = makeEnv();
    const r = await issue(env, { amount_cents: 1_000, due_date });
    assert.equal(r.status, 400, due_date);
    assert.equal(r.body.error, 'invalid_due_date');
    assert.equal(headers(env).length, 0, `${due_date} wrote a call`);
  }
});

test('issue: a fund with nobody to bill refuses instead of writing an empty call', async () => {
  const env = makeEnv();
  const r = await issue(env, { amount_cents: 1_000 }, GP_ID, 4);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'no_billable_lps');
  assert.equal(headers(env).length, 0);
});

// ── Preview ─────────────────────────────────────────────────────────────

test('preview: shows exactly the lines the issue then writes, and writes nothing', async () => {
  const env = makeEnv();
  const p = await call(funds, env, GP_ID, '/1/capital-calls/preview', { method: 'POST', body: { amount_cents: 100_000 } });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(headers(env).length, 0, 'the preview wrote a call');
  assert.equal(p.body.next_call_number, 1);
  assert.equal(p.body.residual_lp_id, 100);
  assert.equal(p.body.lines.reduce((t: number, l: any) => t + l.share_cents, 0), 100_000);
  // KYC: the account's status where there is one; null — not "pending" — where there is none.
  assert.deepEqual(p.body.lines.map((l: any) => [l.lp_id, l.kyc_status, l.has_account]),
    [[100, 'approved', true], [200, 'pending', true], [300, null, false]]);
  await issue(env, { amount_cents: 100_000 });
  const written = fundLines(env, headers(env)[0].id).map((l) => [l.limited_partner_id, l.amount_cents]);
  assert.deepEqual(written, p.body.lines.map((l: any) => [l.lp_id, l.share_cents]), 'the preview promised different lines');
});

test('preview: refused for another GP (404) and an LP (402)', async () => {
  const env = makeEnv();
  const other = await call(funds, env, OTHER_GP_ID, '/1/capital-calls/preview', { method: 'POST', body: { amount_cents: 100 } });
  assert.equal(other.status, 404);
  assert.ok(!JSON.stringify(other.body).includes('inst@lp.example'), 'another GP read the register');
  const lp = await call(funds, env, LP_A, '/1/capital-calls/preview', { method: 'POST', body: { amount_cents: 100 } });
  assert.equal(lp.status, 402);
});

// ── Receipts ────────────────────────────────────────────────────────────

async function issuedLine(env: any, lpId = 200) {
  await issue(env);
  return one(env, 'SELECT * FROM capital_calls WHERE fund_call_id IS NOT NULL AND limited_partner_id = ?', lpId);
}
const receive = (env: any, lineId: number, body: Record<string, unknown>, who = GP_ID, fund = 1) =>
  call(funds, env, who, `/${fund}/capital-calls/lines/${lineId}/receipts`, { method: 'POST', body });

test('receipt: a part payment is recorded and credited; the rest completes the line', async () => {
  const env = makeEnv();
  const line = await issuedLine(env);           // LP B owes 33,333 cents
  const a = await receive(env, line.id, { amount_cents: 20_000, received_on: '2026-09-20', reference: 'WIRE-1' });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.paid, false);
  assert.equal(a.body.line.outstanding_cents, 13_333);
  assert.equal(invested(env, 200), 200);
  assert.equal(deployed(env, 1), 200);
  const b = await receive(env, line.id, { amount_cents: 13_333, received_on: '2026-09-21' });
  assert.equal(b.body.paid, true);
  const after = one(env, 'SELECT status, paid_date FROM capital_calls WHERE id = ?', line.id);
  assert.deepEqual([after.status, after.paid_date], ['paid', '2026-09-21'], 'paid on the date the last wire landed');
  assert.equal(Math.round(invested(env, 200) * 100), 33_333, 'the LP was credited something other than what arrived');
  const rs = receipts(env);
  assert.deepEqual(rs.map((r) => [r.amount_cents, r.received_on, r.reference, r.recorded_by, r.source]),
    [[20_000, '2026-09-20', 'WIRE-1', GP_ID, 'receipt'], [13_333, '2026-09-21', null, GP_ID, 'receipt']]);
  const logged = q(env, "SELECT user_id, entity_id FROM activity_logs WHERE action_type = 'capital_call_receipt_recorded'");
  assert.equal(logged.length, 2, 'a receipt recorded on the LP\'s behalf left no actor record');
  assert.ok(logged.every((l) => l.user_id === GP_ID && Number(l.entity_id) === line.id));
});

test('receipt: more than the line still owes is refused, and nothing moves', async () => {
  const env = makeEnv();
  const line = await issuedLine(env);
  const r = await receive(env, line.id, { amount_cents: 33_334, received_on: '2026-09-20' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'receipt_exceeds_outstanding');
  assert.equal(r.body.outstanding_cents, 33_333);
  assert.equal(receipts(env).length, 0);
  assert.equal(invested(env, 200), 0);
});

test('receipt: a paid line takes no further receipt', async () => {
  const env = makeEnv();
  const line = await issuedLine(env);
  await receive(env, line.id, { amount_cents: 33_333, received_on: '2026-09-20' });
  const again = await receive(env, line.id, { amount_cents: 1, received_on: '2026-09-20' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'line_already_paid');
  assert.equal(receipts(env).length, 1);
});

/**
 * Hold every batch until `n` are waiting, then let them run. Both requests
 * have then read the line — and passed its outstanding check in JavaScript —
 * before either writes, which is the race the in-batch guards exist for.
 * Without the barrier the first request can finish before the second reads,
 * and the pre-check answers alone: the mutation run showed exactly that.
 */
function holdBatches(env: any, n = 2) {
  const real = env.DB.batch.bind(env.DB);
  const waiting: Array<() => void> = [];
  env.DB = {
    ...env.DB,
    batch: async (stmts: any[]) => {
      await new Promise<void>((go) => {
        waiting.push(go);
        if (waiting.length >= n) waiting.splice(0).forEach((g) => g());
      });
      return real(stmts);
    },
  };
}

test('receipt: two part payments read together land one; the second is refused and credits nothing', async () => {
  const env = makeEnv();
  const line = await issuedLine(env);           // 33,333 owed
  holdBatches(env);
  const [a, b] = await Promise.all([
    receive(env, line.id, { amount_cents: 20_000, received_on: '2026-09-20' }),
    receive(env, line.id, { amount_cents: 20_000, received_on: '2026-09-20' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(receipts(env).length, 1, 'both landed, and the line took more than it owes');
  assert.equal(Math.round(invested(env, 200) * 100), 20_000, 'the refused press was credited to the LP');
  assert.equal(Math.round(deployed(env, 1) * 100), 20_000, 'the refused press was credited to the fund');
});

test('receipt: two presses for the full amount at once land one receipt and credit once', async () => {
  const env = makeEnv();
  const line = await issuedLine(env);
  holdBatches(env);
  const [a, b] = await Promise.all([
    receive(env, line.id, { amount_cents: 33_333, received_on: '2026-09-20' }),
    receive(env, line.id, { amount_cents: 33_333, received_on: '2026-09-20' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(receipts(env).length, 1, 'both presses landed a receipt');
  assert.equal(Math.round(invested(env, 200) * 100), 33_333, 'the LP was credited twice');
  assert.equal(Math.round(deployed(env, 1) * 100), 33_333, 'the fund was credited twice');
});

test('receipt: refused for an LP, another GP, and on a line from another fund — nothing moves', async () => {
  const env = makeEnv();
  const line = await issuedLine(env);
  const lp = await receive(env, line.id, { amount_cents: 1, received_on: '2026-09-20' }, LP_B);
  assert.equal(lp.status, 402, 'the LP who owes the line recorded their own receipt');
  const other = await receive(env, line.id, { amount_cents: 1, received_on: '2026-09-20' }, OTHER_GP_ID);
  assert.equal(other.status, 404);
  // Fund II's GP, through Fund II's URL, naming Fund I's line: the same 404 as a missing line.
  const crossed = await receive(env, line.id, { amount_cents: 1, received_on: '2026-09-20' }, OTHER_GP_ID, 2);
  assert.equal(crossed.status, 404);
  assert.equal(crossed.body.error, 'call_line_not_found');
  // And the GP of Fund I cannot reach Fund II's line through Fund I's URL.
  const mine = await receive(env, 950, { amount_cents: 1, received_on: '2026-09-20' }, GP_ID, 1);
  assert.equal(mine.status, 404);
  assert.equal(receipts(env).length, 0);
  assert.equal(invested(env, 200), 0);
  assert.equal(invested(env, 500), 0);
});

test('receipt: a date that is not real, or is in the future, is refused', async () => {
  const env = makeEnv();
  const line = await issuedLine(env);
  const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  for (const received_on of ['2026-13-01', 'yesterday', future, undefined]) {
    const r = await receive(env, line.id, { amount_cents: 100, received_on });
    assert.equal(r.status, 400, String(received_on));
    assert.equal(r.body.error, 'invalid_received_on');
  }
  assert.equal(receipts(env).length, 0);
});

test('the receipts and the call headers are append-only in the database itself', async () => {
  const env = makeEnv();
  const line = await issuedLine(env);
  await receive(env, line.id, { amount_cents: 100, received_on: '2026-09-20' });
  assert.throws(() => env.__db.exec('UPDATE capital_call_receipts SET amount_cents = 1'), /append-only/);
  assert.throws(() => env.__db.exec('DELETE FROM capital_call_receipts'), /append-only/);
  assert.throws(() => env.__db.exec('UPDATE fund_capital_calls SET amount_cents = 1'), /append-only/);
  assert.throws(() => env.__db.exec('DELETE FROM fund_capital_calls'), /append-only/);
  assert.equal(receipts(env)[0].amount_cents, 100);
  assert.equal(headers(env)[0].amount_cents, 100_000);
});

test('Mark Paid is a receipt for what is still owed, so a part payment is not credited twice', async () => {
  const env = makeEnv();
  const line = await issuedLine(env);
  await receive(env, line.id, { amount_cents: 10_000, received_on: '2026-09-20' });
  const r = await call(capital, env, GP_ID, `/calls/${line.id}/pay`, { method: 'POST' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'paid');
  const rs = receipts(env);
  assert.deepEqual(rs.map((x) => [x.amount_cents, x.source]), [[10_000, 'receipt'], [23_333, 'mark_paid']]);
  assert.equal(rs[1].received_on, today());
  assert.equal(Math.round(invested(env, 200) * 100), 33_333, 'Mark Paid credited the whole line on top of the part payment');
  const again = await call(capital, env, GP_ID, `/calls/${line.id}/pay`, { method: 'POST' });
  assert.equal(again.body.already_paid, true);
  assert.equal(receipts(env).length, 2);
});

// ── Reading ─────────────────────────────────────────────────────────────

test('the call ledger: each call with its lines, states, KYC and the named residual', async () => {
  const env = makeEnv();
  await issue(env, { amount_cents: 100_000, due_date: '2026-01-01' });
  const lineB = one(env, 'SELECT id FROM capital_calls WHERE fund_call_id IS NOT NULL AND limited_partner_id = 200');
  await receive(env, lineB.id, { amount_cents: 1_000, received_on: '2026-09-20' });
  const r = await call(funds, env, GP_ID, '/1/capital-calls');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [c1] = r.body.calls;
  assert.equal(c1.call_number, 1);
  assert.equal(c1.residual_lp_name, 'U10');
  assert.equal(c1.received_cents, 1_000);
  assert.equal(c1.outstanding_cents, 99_000);
  const byLp = new Map(c1.lines.map((l: any) => [l.limited_partner_id, l]));
  // Past its due date and not paid: overdue, with the days counted, even part-received.
  assert.equal(byLp.get(200).state, 'overdue');
  assert.ok(byLp.get(200).days_overdue > 0);
  assert.equal(byLp.get(100).kyc_status, 'approved');
  assert.equal(byLp.get(300).kyc_status, null, 'an LP with no account was given a KYC status');
  assert.equal(byLp.get(300).has_account, false);
  // The two lines from before 312: listed, never folded into a numbered call.
  const legacy = new Map(r.body.unnumbered.map((l: any) => [l.id, l]));
  assert.equal(legacy.get(900).state, 'paid');
  assert.equal(legacy.get(900).receipt_recorded, false, 'a line paid before receipts claims a receipt');
  assert.equal(legacy.get(901).state, 'overdue');
  assert.equal(legacy.get(901).owed_cents, 2_550);
  // Fund II's line is not on Fund I's ledger.
  assert.ok(!r.body.unnumbered.some((l: any) => l.id === 950));
  assert.deepEqual(r.body.summary, {
    committed_cents: 90_000, committed_lps: 3,
    called_cents: 100_000 + 5_000 + 2_550,
    received_cents: 1_000,
    paid_before_receipts_cents: 5_000,
    outstanding_cents: 99_000 + 2_550,
    calls_count: 1,
  });
});

test('the call ledger is refused to another GP (404), an LP (402) and a founder (404)', async () => {
  const env = makeEnv();
  await issue(env);
  for (const [who, status] of [[OTHER_GP_ID, 404], [LP_A, 402], [FOUNDER_ID, 404]]) {
    const r = await call(funds, env, who, '/1/capital-calls');
    assert.equal(r.status, status, `user ${who}`);
    assert.ok(!JSON.stringify(r.body).includes('inst@lp.example'), `user ${who} read the register`);
  }
  assert.equal((await call(funds, env, ADMIN_ID, '/1/capital-calls')).status, 200);
});

test('the ledger: calls and receipts newest first; one LP\'s history; a stranger LP is 404', async () => {
  const env = makeEnv();
  await issue(env);
  const lineB = one(env, 'SELECT id FROM capital_calls WHERE fund_call_id IS NOT NULL AND limited_partner_id = 200');
  await receive(env, lineB.id, { amount_cents: 500, received_on: '2026-09-20', reference: 'W-9' });
  const r = await call(funds, env, GP_ID, '/1/ledger');
  assert.equal(r.status, 200);
  const kinds = r.body.entries.map((e: any) => e.kind);
  assert.ok(kinds.includes('call') && kinds.includes('receipt') && kinds.includes('line'));
  const rec = r.body.entries.find((e: any) => e.kind === 'receipt');
  assert.deepEqual([rec.amount_cents, rec.reference, rec.call_number, rec.lp_name, rec.recorded_by_name], [500, 'W-9', 1, 'U20', 'U40']);
  // The fund ledger's `line` entries are the pre-312 lines only.
  assert.deepEqual(r.body.entries.filter((e: any) => e.kind === 'line').map((e: any) => e.id).sort(), [900, 901]);
  const mine = await call(funds, env, GP_ID, '/1/ledger?lp=200');
  assert.deepEqual(mine.body.entries.map((e: any) => [e.kind, e.id]).sort(),
    [['line', 901], ['line', lineB.id], ['receipt', rec.id]].sort());
  const stranger = await call(funds, env, GP_ID, '/1/ledger?lp=500');
  assert.equal(stranger.status, 404);
  assert.equal(stranger.body.error, 'lp_not_on_fund');
  assert.equal((await call(funds, env, GP_ID, '/1/ledger?lp=abc')).status, 404);
  assert.equal((await call(funds, env, OTHER_GP_ID, '/1/ledger')).status, 404);
});

test('a line is overdue only once its due date has passed', () => {
  assert.equal(daysOverdue('2026-09-20', '2026-09-20'), null);
  assert.equal(daysOverdue('2026-09-19', '2026-09-20'), 1);
  assert.equal(daysOverdue('2026-12-31', '2026-09-20'), null);
  assert.equal(daysOverdue(null, '2026-09-20'), null);
  assert.equal(daysOverdue('soon', '2026-09-20'), null);
});

// ── The fund list and the register ──────────────────────────────────────

test('the fund list says which funds the caller can operate', async () => {
  const env = makeEnv();
  const gp = await call(funds, env, GP_ID, '/');
  assert.deepEqual(gp.body.items.map((f: any) => [f.id, f.can_manage]).sort(), [[1, true], [4, true]]);
  // An LP sees the fund they hold a position in, and cannot operate it.
  const lp = await call(funds, env, LP_A, '/');
  assert.deepEqual(lp.body.items.map((f: any) => [f.id, f.can_manage]), [[1, false]]);
  // GP of record on a lapsed tier: listed, not operable — the gate would answer 402.
  const lapsed = await call(funds, env, LAPSED_GP_ID, '/');
  assert.deepEqual(lapsed.body.items.map((f: any) => [f.id, f.can_manage]), [[3, false]]);
  const admin = await call(funds, env, ADMIN_ID, '/');
  assert.ok(admin.body.items.length === 4 && admin.body.items.every((f: any) => f.can_manage === true));
});

test('the LP register carries each account\'s KYC status, and none for an LP without one', async () => {
  const env = makeEnv();
  const r = await call(funds, env, GP_ID, '/1/lps');
  assert.equal(r.status, 200);
  const kyc = new Map(r.body.items.map((lp: any) => [lp.id, lp.kyc_status]));
  assert.equal(kyc.get(100), 'approved');
  assert.equal(kyc.get(200), 'pending');
  assert.equal(kyc.get(300), null);
});

// ── A project purge ─────────────────────────────────────────────────────

test('purging a project keeps a call line that has a receipt, detached, and still purges the project', async () => {
  const env = makeEnv();
  // A project-linked line, as POST /capital/calls writes one, marked paid.
  env.__db.exec(`INSERT INTO projects (id, name) VALUES (7, 'Co');
    INSERT INTO capital_calls (id, limited_partner_id, project_id, amount, status) VALUES (970, 100, 7, 40, 'pending'),
      (971, 200, 7, 60, 'pending');`);
  const paid = await call(capital, env, GP_ID, '/calls/970/pay', { method: 'POST' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  await hardDeleteProject(env, 7);
  assert.equal(one(env, 'SELECT COUNT(*) AS n FROM projects WHERE id = 7').n, 0, 'the project could not be purged');
  const kept = one(env, 'SELECT project_id FROM capital_calls WHERE id = 970');
  assert.ok(kept, 'the line whose money arrived was deleted with the project');
  assert.equal(kept.project_id, null);
  assert.equal(receipts(env).length, 1);
  // A line with no receipt goes with the project, as before.
  assert.equal(one(env, 'SELECT COUNT(*) AS n FROM capital_calls WHERE id = 971').n, 0);
});

// ── The queue job ───────────────────────────────────────────────────────

function job(payload: Record<string, unknown>) {
  return {
    id: 0, job_type: 'capital_call_notice' as const, payload: JSON.stringify(payload),
    status: 'processing' as const, attempts: 1, max_retries: 3, error: null,
    created_at: '2026-09-27T00:00:00Z', updated_at: '2026-09-27T00:00:00Z',
    started_at: '2026-09-27T00:00:00Z', completed_at: null, dead_at: null,
  };
}

test('the job writes the same header and lines, records who issued it, and a retry writes nothing', async () => {
  const env = makeEnv();
  const payload = { fund_id: 1, amount_cents: 100_000, call_uid: 'first-call', issued_by: GP_ID, due_date: '2026-11-01' };
  await handleJob(env, job(payload));
  await handleJob(env, job(payload));
  const hs = headers(env);
  assert.equal(hs.length, 1, 'a retry wrote a second header');
  assert.equal(hs[0].issued_by, GP_ID);
  assert.equal(fundLines(env, hs[0].id).reduce((t, l) => t + l.amount_cents, 0), 100_000);
  assert.equal(q(env, "SELECT * FROM activity_logs WHERE action = 'capital_call_notice'").length, 3);
});

test('a retry that finds lines missing and a changed register fails loudly instead of billing new shares', async () => {
  const env = makeEnv();
  const payload = { fund_id: 1, amount_cents: 100_000, call_uid: 'first-call' };
  await handleJob(env, job(payload));
  const h = headers(env)[0];
  // A hand edit removes one line, and an LP joins before the retry.
  env.__db.exec(`DELETE FROM capital_calls WHERE fund_call_id = ${h.id} AND limited_partner_id = 300`);
  env.__db.exec(`INSERT INTO limited_partners (id, fund_id, name, commitment_amount, status) VALUES (600, 1, 'Late', 300, 'committed')`);
  await assert.rejects(() => handleJob(env, job(payload)), /no longer splits it as issued/);
  assert.equal(fundLines(env, h.id).length, 2, 'the retry wrote lines against a changed register');
});
