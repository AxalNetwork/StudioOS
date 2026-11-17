/**
 * D6238 (#6238) — one capital call: its page read, the correction of its due
 * date or purpose, and its withdrawal while nothing is paid against it. Real
 * node:sqlite, with migrations 312, 387, 473 and 202611152336 applied from
 * their own files.
 *
 * Actors:
 *   GP        institutional investor, GP of record of Fund I
 *   OTHER_GP  institutional investor, GP of record of Fund II
 *   ADMIN     a plain Admin (not the Super Admin)
 *   SUPER     the Super Admin, in a fresh TOTP session
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fund_call_amend_6238.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import funds from '../src/routes/funds.ts';
import { previewCallNotices } from '../src/services/fundNoticeStore.ts';
import { callReminderMaterial } from '../src/services/fundLpComms.ts';
import { makeD1 } from './_d1_sqlite.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const mig = (f: string) => readFileSync(resolve(HERE, '../sql/migrations', f), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADMIN = 1;
const SUPER = 2;
const GP = 40;
const OTHER_GP = 41;
const LP_A = 10;
const ROLE = new Map<number, string>([[ADMIN, 'admin'], [SUPER, 'admin'], [GP, 'investor'], [OTHER_GP, 'investor'], [LP_A, 'investor']]);
const SESSION = new Map<number, string>([[SUPER, 'totp-super']]);

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
  user_id INTEGER, stat_date TEXT, action_count INTEGER DEFAULT 0, updated_at TEXT, UNIQUE (user_id, stat_date));
CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT, body TEXT, link TEXT, created_at TEXT);
CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
CREATE TABLE user_sessions (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, jti TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, revoked_at TIMESTAMP, factor TEXT, last_step_up_at TIMESTAMP);
CREATE TABLE legal_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, notice_type TEXT NOT NULL, source_ref TEXT NOT NULL,
  fund_id INTEGER, limited_partner_id INTEGER, reference TEXT, amount_cents INTEGER, figures_json TEXT NOT NULL,
  supersedes_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
${mig('312_fund_call_ledger.sql')}
${mig('387_fund_lp_type_and_comms.sql')}
${mig('473_fund_management_fees.sql')}
${mig('202611152336_6238_capital_call_amendments.sql')}
`;

const SEED = `
INSERT INTO users (id, email, name, role, is_active, investor_tier, kyc_status) VALUES
  (${ADMIN}, 'a@example.test', 'Plain Admin', 'admin', 1, NULL, 'approved'),
  (${SUPER}, 's@example.test', 'Super Admin', 'admin', 1, NULL, 'approved'),
  (${GP}, 'gp@example.test', 'Gee Pee', 'investor', 1, 'institutional', 'approved'),
  (${OTHER_GP}, 'og@example.test', 'Other GP', 'investor', 1, 'institutional', 'approved'),
  (${LP_A}, 'lpa@example.test', 'LP A', 'investor', 1, NULL, 'pending');
INSERT INTO super_admins (user_id) VALUES (${SUPER});
INSERT INTO user_sessions (user_id, jti, factor) VALUES (${SUPER}, 'totp-super', 'totp');
INSERT INTO vc_funds (id, name, gp_user_id) VALUES (1, 'Fund I', ${GP}), (2, 'Fund II', ${OTHER_GP});
INSERT INTO limited_partners (id, fund_id, user_id, name, email, commitment_amount, status) VALUES
  (100, 1, ${LP_A}, 'LP A', 'lpa@example.test', 300, 'committed'),
  (200, 1, NULL, 'Institution', 'inst@lp.example', 100, 'committed'),
  (500, 2, NULL, 'Fund II LP', 'two@lp.example', 1000, 'active');
`;

function makeEnv(): any {
  const { DB, db } = makeD1(SCHEMA, SEED);
  return { JWT_SECRET, ENVIRONMENT: 'development', DB, __db: db };
}

async function token(userId: number): Promise<string> {
  const jti = SESSION.get(userId);
  return new SignJWT({ user_id: userId, role: ROLE.get(userId), ...(jti ? { jti } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(env: any, userId: number, path: string, init: { method?: string; body?: unknown } = {}) {
  const res: Response = await funds.request(path, {
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

const q = (env: any, sql: string, ...b: any[]) => env.__db.prepare(sql).all(...b) as any[];
const one = (env: any, sql: string, ...b: any[]) => env.__db.prepare(sql).get(...b) as any;
const amendments = (env: any) => q(env, 'SELECT * FROM fund_capital_call_amendments ORDER BY id');
const lines = (env: any, callId: number) => q(env, 'SELECT * FROM capital_calls WHERE fund_call_id = ? ORDER BY limited_partner_id', callId);

/** Issue a $1,000.00 call on Fund I as its GP, due 2099-01-31; its header id. */
async function issued(env: any, body: Record<string, unknown> = {}) {
  const r = await call(env, GP, '/1/capital-call', {
    method: 'POST', body: { amount_cents: 100_000, purpose: 'Seed reserve', due_date: '2099-01-31', ...body },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return Number(r.body.call.id);
}

const receipt = (env: any, lineId: number, cents: number, who = GP) => call(env, who, `/1/capital-calls/lines/${lineId}/receipts`, {
  method: 'POST', body: { amount_cents: cents, received_on: '2026-01-15' },
});

// ── The call page read ──────────────────────────────────────────────────

test('read: one call with its lines, receipts, comms and the notices issued on its lines', async () => {
  const env = makeEnv();
  const first = await issued(env);
  const second = await issued(env, { amount_cents: 40_000 });
  const [la, lb] = lines(env, first);
  assert.equal((await receipt(env, la.id, 10_000)).status, 201);
  env.__db.exec(`INSERT INTO fund_lp_communications (fund_id, lp_id, kind, subject, sent_at, logged_by, capital_call_id)
    VALUES (1, 100, 'call_reminder', 'Call 1 reminder', '2026-11-01 00:00:00', ${GP}, ${la.id}),
           (1, 200, 'call_reminder', 'Call 2 reminder', '2026-11-01 00:00:00', ${GP}, ${lines(env, second)[1].id})`);
  env.__db.exec(`INSERT INTO legal_notices (uid, notice_type, source_ref, fund_id, limited_partner_id, reference, amount_cents, figures_json) VALUES
    ('n1', 'capital_call_notice', 'call_line:${lb.id}', 1, 200, 'AXL-1', ${lb.amount_cents}, '{"notice_date":"2026-11-02","title":"Capital call notice"}'),
    ('n2', 'capital_call_notice', 'call_line:${lines(env, second)[0].id}', 1, 100, 'AXL-2', 1, '{"notice_date":"2026-11-03","title":"Capital call notice"}')`);

  const r = await call(env, GP, `/1/capital-calls/${first}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.call.call_number, 1);
  assert.equal(r.body.call.lines.length, 2);
  assert.equal(r.body.call.lines_behind, 2, 'both lines still owe something');
  assert.equal(r.body.call.receipt_count, 1);
  assert.equal(r.body.receipts.status, 'ready');
  assert.deepEqual(r.body.receipts.rows.map((x: any) => x.amount_cents), [10_000]);
  assert.deepEqual(r.body.comms.rows.map((x: any) => x.subject), ['Call 1 reminder'], "another call's comms leaked in");
  assert.equal(r.body.notices.status, 'ready');
  assert.deepEqual(r.body.notices.rows.map((n: any) => n.reference), ['AXL-1'], "another call's notice leaked in");
  assert.equal(r.body.notices.rows[0].figures, undefined, 'the GP reads a summary, never the figures');

  // Another GP's fund, or a call of another fund, is not readable.
  assert.notEqual((await call(env, OTHER_GP, `/1/capital-calls/${first}`)).status, 200);
  assert.equal((await call(env, OTHER_GP, `/2/capital-calls/${first}`)).status, 404);
  assert.equal((await call(env, GP, '/1/capital-calls/9999')).status, 404);
  assert.equal((await call(env, GP, '/1/capital-calls/1.0')).status, 404);
});

test('read: the notices failing to read is Unreadable for them alone', async () => {
  const env = makeEnv();
  const id = await issued(env);
  env.__db.exec('DROP TABLE legal_notices');
  const r = await call(env, GP, `/1/capital-calls/${id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.notices.status, 'unreadable');
  assert.equal(r.body.notices.rows, null, 'an unread notice list is not an empty one');
  assert.equal(r.body.receipts.status, 'ready');
});

// ── Correction ──────────────────────────────────────────────────────────

test('correct: a due date is recorded with who, when, from and to, and moves onto the lines; the header stays as issued', async () => {
  const env = makeEnv();
  const id = await issued(env);
  const r = await call(env, GP, `/1/capital-calls/${id}/correct`, {
    method: 'POST', body: { field: 'due_date', value: '2099-02-15', reason: 'Typo in the notice' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const [a] = amendments(env);
  assert.equal(a.kind, 'due_date');
  assert.equal(a.old_value, '2099-01-31');
  assert.equal(a.new_value, '2099-02-15');
  assert.equal(a.recorded_by, GP);
  assert.ok(a.created_at, 'when it was recorded');
  assert.equal(a.reason, 'Typo in the notice');
  assert.ok(lines(env, id).every((l) => l.due_date === '2099-02-15'), 'a line kept the old due date');
  assert.equal(one(env, 'SELECT due_date FROM fund_capital_calls WHERE id = ?', id).due_date, '2099-01-31', 'the sealed header was rewritten');

  const list = await call(env, GP, '/1/capital-calls');
  const c = list.body.calls[0];
  assert.equal(c.due_date, '2099-02-15');
  assert.equal(c.issued_due_date, '2099-01-31');
  assert.equal(c.amendments.length, 1);
  assert.equal(c.amendments[0].by_name, 'Gee Pee');
  assert.equal(q(env, "SELECT * FROM activity_logs WHERE action_type = 'capital_call_corrected'").length, 1, 'the correction was not logged');
});

test('correct: the purpose, the same value twice, a bad field and a date before issue', async () => {
  const env = makeEnv();
  const id = await issued(env);
  const p = await call(env, GP, `/1/capital-calls/${id}/correct`, { method: 'POST', body: { field: 'purpose', value: 'Follow-on reserve' } });
  assert.equal(p.status, 201);
  const read = await call(env, GP, `/1/capital-calls/${id}`);
  assert.equal(read.body.call.purpose, 'Follow-on reserve');
  assert.equal(read.body.call.issued_purpose, 'Seed reserve');
  // The reminder draft reads the corrected purpose.
  const material = await callReminderMaterial(env, GP, String(lines(env, id)[0].id));
  assert.ok(material.some((m) => m.includes('for Follow-on reserve')), material.join(' | '));

  const same = await call(env, GP, `/1/capital-calls/${id}/correct`, { method: 'POST', body: { field: 'purpose', value: 'Follow-on reserve' } });
  assert.equal(same.status, 409);
  assert.equal(same.body.error, 'no_change');
  for (const body of [{ field: 'amount', value: '1' }, { field: 'due_date', value: '2099-02-30' }, { field: 'purpose', value: '   ' }]) {
    assert.equal((await call(env, GP, `/1/capital-calls/${id}/correct`, { method: 'POST', body })).status, 400, JSON.stringify(body));
  }
  const early = await call(env, GP, `/1/capital-calls/${id}/correct`, { method: 'POST', body: { field: 'due_date', value: '2001-01-01' } });
  assert.equal(early.status, 400);
  assert.equal(early.body.error, 'due_before_issue');
  assert.equal(amendments(env).length, 1, 'a refused correction was written');
});

test('correct and withdraw are the narrowest role: a plain Admin and another GP are refused, the Super Admin passes', async () => {
  const env = makeEnv();
  const id = await issued(env);
  for (const [who, path] of [[ADMIN, `/1/capital-calls/${id}/correct`], [ADMIN, `/1/capital-calls/${id}/withdraw`],
    [OTHER_GP, `/1/capital-calls/${id}/correct`], [OTHER_GP, `/1/capital-calls/${id}/withdraw`]] as const) {
    const r = await call(env, who, path, { method: 'POST', body: { field: 'purpose', value: 'X' } });
    assert.ok(r.status === 403 || r.status === 404, `${who} ${path}: ${r.status}`);
    if (who === ADMIN) assert.equal(r.body.code, 'super_admin_required');
  }
  assert.equal(amendments(env).length, 0, 'a refused caller wrote an amendment');
  assert.ok(lines(env, id).every((l) => l.status === 'pending'));
  const sup = await call(env, SUPER, `/1/capital-calls/${id}/correct`, { method: 'POST', body: { field: 'purpose', value: 'Set by HQ' } });
  assert.equal(sup.status, 201, JSON.stringify(sup.body));
  assert.equal(amendments(env)[0].recorded_by, SUPER);
});

// ── Withdrawal ──────────────────────────────────────────────────────────

test('withdraw: a call with no receipts is withdrawn, its lines owe nothing, and the issued shares are kept', async () => {
  const env = makeEnv();
  const id = await issued(env);
  const before = lines(env, id);
  const r = await call(env, GP, `/1/capital-calls/${id}/withdraw`, { method: 'POST', body: { reason: 'Issued on the wrong fund' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const after = lines(env, id);
  assert.ok(after.every((l) => l.status === 'withdrawn' && l.amount === 0 && l.amount_cents === 0), JSON.stringify(after));
  const [a] = amendments(env);
  assert.equal(a.kind, 'withdrawn');
  assert.equal(a.recorded_by, GP);
  assert.deepEqual(JSON.parse(a.lines_json).map((l: any) => l.owed_cents), before.map((l) => l.amount_cents));
  assert.equal(one(env, 'SELECT amount_cents FROM fund_capital_calls WHERE id = ?', id).amount_cents, 100_000, 'the header lost what was issued');

  const list = await call(env, GP, '/1/capital-calls');
  assert.equal(list.body.summary.called_cents, 0, 'a withdrawn call still counts as called');
  assert.equal(list.body.summary.outstanding_cents, 0);
  const c = list.body.calls[0];
  assert.equal(c.withdrawn, true);
  assert.equal(c.lines_behind, 0);
  assert.equal(c.withdrawal.by_name, 'Gee Pee');
  assert.equal(c.withdrawal.reason, 'Issued on the wrong fund');
  assert.ok(c.lines.every((l: any) => l.state === 'withdrawn' && l.outstanding_cents === 0));
  assert.deepEqual(c.lines.map((l: any) => l.issued_owed_cents).sort(), before.map((l) => l.amount_cents).sort());

  // Nothing lands on it afterwards, and it is not corrected, withdrawn or noticed again.
  const late = await receipt(env, after[0].id, 1);
  assert.equal(late.status, 409);
  assert.equal(late.body.error, 'call_withdrawn');
  assert.equal(q(env, 'SELECT * FROM capital_call_receipts').length, 0);
  assert.equal((await call(env, GP, `/1/capital-calls/${id}/withdraw`, { method: 'POST', body: {} })).body.error, 'call_withdrawn');
  assert.equal((await call(env, GP, `/1/capital-calls/${id}/correct`, { method: 'POST', body: { field: 'purpose', value: 'Y' } })).body.error, 'call_withdrawn');
  await assert.rejects(() => previewCallNotices(env, one(env, 'SELECT uid FROM fund_capital_calls WHERE id = ?', id).uid),
    (e: any) => e.code === 'call_withdrawn');
  assert.deepEqual(await callReminderMaterial(env, GP, String(after[0].id)), [], 'a withdrawn line still has a reminder to draft');
  assert.equal(q(env, "SELECT * FROM activity_logs WHERE action_type = 'capital_call_withdrawn'").length, 1);
});

test('withdraw: refused once any line has a receipt, and nothing is written', async () => {
  const env = makeEnv();
  const id = await issued(env);
  const [la] = lines(env, id);
  assert.equal((await receipt(env, la.id, 1)).status, 201);
  const r = await call(env, GP, `/1/capital-calls/${id}/withdraw`, { method: 'POST', body: {} });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'call_has_receipts');
  assert.equal(amendments(env).length, 0);
  assert.ok(lines(env, id).every((l) => l.status !== 'withdrawn' && l.amount_cents > 0));
});

test('withdraw: refused while a management-fee line is linked to the call', async () => {
  const env = makeEnv();
  const id = await issued(env);
  const [la] = lines(env, id);
  // The link only (D709); the fee period's own columns are not what this rule reads.
  env.__db.exec('PRAGMA foreign_keys = OFF');
  env.__db.exec(`INSERT INTO fund_fee_lines (uid, period_id, fund_id, limited_partner_id, commitment_cents, committed_days,
      invested_days, gross_fee_cents, net_fee_cents, reference_code, capital_call_line_id, status)
    VALUES ('fl-1', 1, 1, 100, 30000, 90, 0, 100, 100, 'FEE-1', ${la.id}, 'issued')`);
  const r = await call(env, GP, `/1/capital-calls/${id}/withdraw`, { method: 'POST', body: {} });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'call_carries_fee');
  assert.equal(amendments(env).length, 0);
});

test('the amendments are sealed by the database', async () => {
  const env = makeEnv();
  const id = await issued(env);
  await call(env, GP, `/1/capital-calls/${id}/correct`, { method: 'POST', body: { field: 'purpose', value: 'Z' } });
  assert.throws(() => env.__db.exec("UPDATE fund_capital_call_amendments SET new_value = 'W'"), /append-only/);
  assert.throws(() => env.__db.exec('DELETE FROM fund_capital_call_amendments'), /append-only/);
});
