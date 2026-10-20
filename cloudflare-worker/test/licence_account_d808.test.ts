/**
 * D808 (#2250) — the Licences canvas's additions to the Administrator's
 * account: the contract in force and pending, its PDF, Needs you, the usage
 * reports by month with Send now, and the platform IP licensor as payee.
 *
 * On node:sqlite, with the baseline's own DDL for users, licences,
 * administrators and envelopes, and migrations 256–512 from their files. HQ's
 * RPC and the throttle store are stubbed. The bank account is written with a
 * number drawn at run time, so no account number is in this file; the people
 * are placeholders.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_account_d808.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomInt } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import licence from '../src/routes/licence.ts';
import { encryptColumn } from '../src/services/columnCipher.ts';
import {
  DEFAULT_USAGE_REPORT_DAY, NEEDS_LINKS, SEND_NOW_HQ_REASON, accountTermsOf, contractPaperInput, licensorRefusal,
  quarterOfMonth, seatNeeds, usageMonths,
} from '../src/services/licenceAccount.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'd808-fixture-only-signing-secret';
const PRINCIPAL = 21;
const DELEGATE = 22;
const OTHER_PRINCIPAL = 23;
const CLEAN_PRINCIPAL = 24;
const MEMBER = 25;
const SUPER = 26;

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATIONS = [
  '259_licence_contracts.sql', '259_hq_escalations.sql', '260_subsidiary_statements.sql', '264_admin_notices.sql',
  '472_entity_bank_accounts.sql', '256_branch_local_copies.sql', '257_branch_licence_ref.sql',
  '265_branch_licence_entity.sql', '284_branch_licence_kind.sql', '512_licence_terms.sql',
].map((f) => read(`cloudflare-worker/sql/migrations/${f}`));

/** A ten-digit number drawn per run: never a literal in this file. */
const accountNumber = () => String(randomInt(1_000_000_000, 9_999_999_999));

/** D797 splits the licensor in two. Until its branch carries the columns, the fixture adds them as it will. */
function ensureLicensorSplit(db: any) {
  const cols = new Set((db.prepare('PRAGMA table_info(licence_terms)').all() as any[]).map((c) => c.name));
  for (const c of ['licensor_ip_entity', 'licensor_brand_entity']) {
    if (!cols.has(c)) db.exec(`ALTER TABLE licence_terms ADD COLUMN ${c} TEXT`);
  }
}

function fixture(o: { branch?: string } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'user_sessions', 'territory_licences', 'licence_admins', 'esign_envelopes', 'esign_recipients']) {
    db.exec(tableFromBaseline(BASELINE, t));
  }
  for (const m of MIGRATIONS) db.exec(m);
  ensureLicensorSplit(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(PRINCIPAL, 'admin', 'Principal A', 'principal-a@example.test');
  u.run(DELEGATE, 'admin', 'Delegate A', 'delegate-a@example.test');
  u.run(OTHER_PRINCIPAL, 'admin', 'Principal B', 'principal-b@example.test');
  u.run(CLEAN_PRINCIPAL, 'admin', 'Principal C', 'principal-c@example.test');
  u.run(MEMBER, 'founder', 'Member', 'member@example.test');
  u.run(SUPER, 'admin', 'HQ', 'hq@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  const l = db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, currency)
    VALUES (?, ?, ?, ?, ?, 'active', 'EUR')`);
  l.run(1, 'lic_a', 'LIC-A', 'Licensee A', 'Brand A');
  l.run(2, 'lic_b', 'LIC-B', 'Licensee B', 'Brand B');
  l.run(3, 'lic_c', 'LIC-C', 'Licensee C', 'Brand C');
  const a = db.prepare('INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (?, ?, ?)');
  a.run(1, PRINCIPAL, 'principal');
  a.run(1, DELEGATE, 'delegate');
  a.run(2, OTHER_PRINCIPAL, 'principal');
  a.run(3, CLEAN_PRINCIPAL, 'principal');

  // Licence A: v6 signed, then v6.1 drawn (which superseded v6) and sent to the principal.
  const c = db.prepare(`INSERT INTO licence_contracts
      (uid, licence_uid, template_slug, template_version, template_title, body_md, unfilled_fields, status, envelope_uid, superseded_at, sent_at, signed_at, created_at)
    VALUES (?, ?, 'licence_agreement', ?, 'Subsidiary licence agreement', ?, '[]', ?, ?, ?, ?, ?, ?)`);
  c.run('ctr_a_v6', 'lic_a', 6, 'STORED-BODY-A-V6', 'signed', 'env-a6', '2026-10-08 00:00:00', '2025-03-01 00:00:00', '2025-03-02 00:00:00', '2025-02-20 00:00:00');
  c.run('ctr_a_v7', 'lic_a', 7, 'STORED-BODY-A-V7', 'sent', 'env-a7', null, '2026-10-12 00:00:00', null, '2026-10-08 00:00:00');
  // Licence B: only a signed, current contract.
  c.run('ctr_b_v6', 'lic_b', 6, 'STORED-BODY-B-V6', 'signed', 'env-b6', null, '2025-03-01 00:00:00', '2025-03-02 00:00:00', '2025-02-20 00:00:00');
  const e = db.prepare(`INSERT INTO esign_envelopes (id, envelope_uuid, document_type, document_title, document_body, body_sha256, status, created_by, completed_at)
    VALUES (?, ?, 'licence_agreement', 'Subsidiary licence agreement', 'x', 'x', ?, ?, ?)`);
  e.run(1, 'env-a6', 'completed', SUPER, '2025-03-02 00:00:00');
  e.run(2, 'env-a7', 'sent', SUPER, null);
  e.run(3, 'env-b6', 'completed', SUPER, '2025-03-02 00:00:00');
  db.prepare(`INSERT INTO esign_recipients (envelope_id, user_id, recipient_email, recipient_name, signing_token, token_expires_at, status)
    VALUES (2, ?, 'principal-a@example.test', 'Principal A', 'tok-a7', '2099-01-01T00:00:00Z', 'pending')`).run(PRINCIPAL);

  // Statements: A has one issued and unpaid, one issued and paid in full, one paid; B one issued and unpaid.
  const s = db.prepare(`INSERT INTO subsidiary_statements
      (uid, licence_uid, period, gross_cents, revenue_share_bps, owed_cents, currency, streams_json, estimated_streams,
       unreported_streams, paid_cents, disputed_cents, status, drawn_by_user_id)
    VALUES (?, ?, ?, 100000, 2000, 20000, 'EUR', '[]', 0, 0, ?, 0, ?, ?)`);
  s.run('st_a_q3', 'lic_a', '2026-Q3', 0, 'issued', SUPER);
  s.run('st_a_q2', 'lic_a', '2026-Q2', 20000, 'issued', SUPER);
  s.run('st_a_q1', 'lic_a', '2026-Q1', 20000, 'paid', SUPER);
  s.run('st_a_q4', 'lic_a', '2026-Q4', 0, 'draft', SUPER);
  s.run('st_b_q3', 'lic_b', '2026-Q3', 0, 'issued', SUPER);

  // Notices: two waiting on the principal, one answered, one to the delegate, one on another licence.
  const n = db.prepare(`INSERT INTO admin_notices (uid, user_id, licence_id, kind, subject, body, respond_by, status, issued_by_user_id)
    VALUES (?, ?, ?, ?, ?, 'x', ?, ?, ?)`);
  n.run('ntc_late', PRINCIPAL, 1, 'term_violation', 'Late usage report', '2026-10-24', 'issued', SUPER);
  n.run('ntc_over', PRINCIPAL, 1, 'other', 'Overdue reply', '2026-10-01', 'overdue', SUPER);
  n.run('ntc_done', PRINCIPAL, 1, 'other', 'Answered', '2026-09-01', 'responded', SUPER);
  n.run('ntc_del', DELEGATE, 1, 'other', 'For the delegate', '2026-10-30', 'issued', SUPER);
  n.run('ntc_b', OTHER_PRINCIPAL, 2, 'other', 'For licence B', '2026-10-30', 'issued', SUPER);

  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://app.example.test/' };
  if (o.branch) env.BRANCH_CODE = o.branch;
  return { db, env };
}

/** Holdings' checking, carrying the territory licence fee, as the console writes it. */
async function holdingsAccount(env: any, db: any) {
  const number = accountNumber();
  const uid = '0000aaaa-0000-4000-8000-000000000808';
  const enc = await encryptColumn(env, 'entity_bank_accounts', 'account_number_enc', uid, number);
  db.prepare(`INSERT INTO entity_bank_accounts
      (uid, entity_key, label, bank_name, bank_address, beneficiary_name, beneficiary_address, account_kind,
       account_number_enc, account_last4, routing_number, swift_code, purposes_json, status, recorded_by)
     VALUES (?, 'holdings', 'Fixture', 'Bank A', 'Bank address A', 'Axal VC Holdings LLC', 'Registered address A', 'checking',
       ?, ?, '000000000', 'BANKAXXX', ?, 'active', ?)`)
    .run(uid, enc, number.slice(-4), JSON.stringify(['territory_licence_fee']), SUPER);
  return number;
}

const ERRORS: Record<string, 401 | 403> = { Unauthorized: 401, 'Admin required': 403 };
const app = new Hono<any>();
app.route('/licence', licence);
app.onError((err: any, c) => {
  const s = ERRORS[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

async function raw(env: any, userId: number, method: string, path: string) {
  const jwt = await new SignJWT({ user_id: userId }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  return app.request(`/licence${path}`, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' } }, env);
}
async function call(env: any, userId: number, method: string, path: string) {
  const res = await raw(env, userId, method, path);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const quietly = async <T>(fn: () => Promise<T>) => {
  const saved = [console.warn, console.error, console.info]; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try { return await fn(); } finally { [console.warn, console.error, console.info] = saved; }
};

// ───────────────────────────────────────────────────────── 1. in force and pending

test('in force and pending together: v6 signed stays in force though v7 superseded it; v7 is pending on the principal', async () => {
  const { env } = fixture();
  const r = await call(env, PRINCIPAL, 'GET', '/mine/contract');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.in_force?.uid, 'ctr_a_v6');
  assert.equal(r.body.in_force.status, 'signed');
  assert.equal(r.body.in_force.template_version, 6);
  assert.equal(r.body.pending?.uid, 'ctr_a_v7');
  assert.equal(r.body.pending.sent_at, '2026-10-12 00:00:00');
  assert.equal(r.body.pending.waiting_on_you, true);
  assert.equal(r.body.contract.uid, 'ctr_a_v7', 'D798\'s current contract is kept');
  assert.deepEqual(r.body.earlier.map((x: any) => x.uid), ['ctr_a_v6'], 'D798\'s earlier list is kept');

  const d = await call(env, DELEGATE, 'GET', '/mine/contract');
  assert.equal(d.body.pending.uid, 'ctr_a_v7');
  assert.equal(d.body.pending.waiting_on_you, false, 'the delegate is not the signer');
});

test('in force only, and pending only', async () => {
  const { env, db } = fixture();
  const b = await call(env, OTHER_PRINCIPAL, 'GET', '/mine/contract');
  assert.equal(b.body.in_force?.uid, 'ctr_b_v6');
  assert.equal(b.body.pending, null);

  db.prepare("DELETE FROM licence_contracts WHERE uid = 'ctr_a_v6'").run();
  const a = await call(env, PRINCIPAL, 'GET', '/mine/contract');
  assert.equal(a.body.in_force, null);
  assert.equal(a.body.pending?.uid, 'ctr_a_v7');

  const c = await call(env, CLEAN_PRINCIPAL, 'GET', '/mine/contract');
  assert.equal(c.body.in_force, null);
  assert.equal(c.body.pending, null);
});

// ───────────────────────────────────────────────────────── 2. the PDF

test('the PDF is the stored body, and another licence\'s contract is refused', async () => {
  const { env, db } = fixture();
  const res = await quietly(() => raw(env, PRINCIPAL, 'GET', '/mine/contract/ctr_a_v7/pdf'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'application/pdf');
  assert.match(res.headers.get('Content-Disposition') || '', /LIC-A-contract-v7\.pdf/);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');

  const other = await call(env, PRINCIPAL, 'GET', '/mine/contract/ctr_b_v6/pdf');
  assert.equal(other.status, 404);
  assert.equal(other.body.error, 'not_found');
  const unknown = await call(env, PRINCIPAL, 'GET', '/mine/contract/ctr_none/pdf');
  assert.equal(unknown.status, 404);
  assert.equal((await call(env, MEMBER, 'GET', '/mine/contract/ctr_a_v7/pdf')).status, 404, 'a member administers no licence');

  const row = db.prepare("SELECT * FROM licence_contracts WHERE uid = 'ctr_a_v7'").get() as any;
  const input = await contractPaperInput(row);
  assert.equal(input.body, 'STORED-BODY-A-V7', 'the stored body, never the template');
  assert.equal(input.version, 7);
  assert.deepEqual(input.state, { kind: 'issued' });
  assert.deepEqual((await contractPaperInput({ ...row, status: 'draft' })).state, { kind: 'draft' });

  const branch = await call(fixture({ branch: 'fr' }).env, PRINCIPAL, 'GET', '/mine/contract/ctr_a_v7/pdf');
  assert.equal(branch.status, 501);
});

// ───────────────────────────────────────────────────────── 3. Needs you

test('/mine/needs lists exactly the open items, in order, each with its link', async () => {
  const { env } = fixture();
  const r = await call(env, PRINCIPAL, 'GET', '/mine/needs');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.items.map((i: any) => [i.kind, i.contract_uid ?? i.notice_uid ?? i.statement_uid]), [
    ['contract', 'ctr_a_v7'], ['notice', 'ntc_over'], ['notice', 'ntc_late'], ['statement', 'st_a_q3'],
  ]);
  assert.equal(r.body.count, 4);
  assert.equal(r.body.complete, true);
  assert.deepEqual(r.body.unavailable, []);
  const [contract, notice, , statement] = r.body.items;
  assert.equal(contract.link, NEEDS_LINKS.contract);
  assert.equal(contract.action, 'sign');
  assert.equal(notice.link, NEEDS_LINKS.notice);
  assert.equal(notice.subject, 'Overdue reply');
  assert.equal(statement.link, NEEDS_LINKS.statement);
  assert.equal(statement.owed_cents, 20000);
  assert.ok(!r.body.items.some((i: any) => i.kind === 'seats'), 'HQ does not count seats');

  const d = await call(env, DELEGATE, 'GET', '/mine/needs');
  assert.deepEqual(d.body.items.map((i: any) => i.notice_uid ?? i.statement_uid), ['ntc_del', 'st_a_q3'],
    'the delegate signs nothing and reads only their own notices');
});

test('/mine/needs is empty for a clean licence, and names a source it cannot read', async () => {
  const { env, db } = fixture();
  const c = await call(env, CLEAN_PRINCIPAL, 'GET', '/mine/needs');
  assert.deepEqual(c.body, { items: [], count: 0, complete: true, unavailable: [] });

  db.exec('DROP TABLE admin_notices');
  const r = await quietly(() => call(env, PRINCIPAL, 'GET', '/mine/needs'));
  assert.equal(r.body.complete, false);
  assert.deepEqual(r.body.unavailable.map((u: any) => u.kind), ['notice']);
  assert.deepEqual(r.body.items.map((i: any) => i.kind), ['contract', 'statement']);
});

test('on a branch, needs lists the seat types at 90% or more and names HQ\'s three as unavailable', async () => {
  const { env, db } = fixture({ branch: 'fr' });
  db.prepare(`INSERT INTO branch_licence (id, licence_uid, licence_ref, legal_entity, brand_name, territory, status, seats_json, pushed_at)
    VALUES (1, 'lic_a', 'LIC-A', 'Licensee A', 'Brand A', 'FR', 'active', ?, '2026-10-01')`)
    .run(JSON.stringify({ founder: 10, investor: 10, advisor: 0 }));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, ?)');
  for (let i = 0; i < 8; i += 1) u.run(100 + i, 'founder', `F${i}`, `f${i}@example.test`, 1);
  u.run(120, 'founder', 'Inactive', 'inactive@example.test', 0);
  for (let i = 0; i < 8; i += 1) u.run(130 + i, 'investor', `I${i}`, `i${i}@example.test`, 1);
  u.run(140, 'advisor', 'A', 'a@example.test', 1);
  // Founders: 8 here plus MEMBER is 9 of 10; investors 8 of 10; advisors licensed for none.
  const r = await call(env, PRINCIPAL, 'GET', '/mine/needs');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.items, [{
    kind: 'seats', link: NEEDS_LINKS.seats, action: 'request_seats', seat_type: 'founder', seats_used: 9, seats_licensed: 10,
  }]);
  assert.equal(r.body.count, 1);
  assert.equal(r.body.complete, false);
  assert.deepEqual(r.body.unavailable.map((x: any) => x.kind), ['contract', 'notice', 'statement']);
  assert.equal((await call(env, MEMBER, 'GET', '/mine/needs')).status, 403);

  assert.deepEqual(seatNeeds({ founder: 10 }, { founder: 8 }), [], '80% is not near the limit');
  assert.equal(seatNeeds({ founder: 10 }, { founder: 9 }).length, 1, '90% is');
  assert.equal(seatNeeds({ founder: 10 }, { founder: 12 }).length, 1, 'over the limit is');
});

test('on a branch with no licence copy, the seats are named as unavailable, not clear', async () => {
  const { env } = fixture({ branch: 'fr' });
  const r = await call(env, PRINCIPAL, 'GET', '/mine/needs');
  assert.deepEqual(r.body.items, []);
  assert.deepEqual(r.body.unavailable.map((x: any) => x.kind), ['contract', 'notice', 'statement', 'seats']);
});

// ───────────────────────────────────────────────────────── 4. usage months and Send now

test('a usage month is late after the report day, due before it, and sent once its quarter is reported after it', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  assert.equal(quarterOfMonth('2026-09'), '2026-Q3');
  assert.equal(quarterOfMonth('2026-10'), '2026-Q4');

  const none = usageMonths([], now, null);
  assert.deepEqual(none.map((m) => [m.month, m.status, m.due_on]), [
    ['2026-09', 'late', '2026-10-05'], ['2026-08', 'late', '2026-09-05'], ['2026-07', 'late', '2026-08-05'],
  ]);
  assert.equal(DEFAULT_USAGE_REPORT_DAY, 5);
  assert.equal(usageMonths([], now, 15)[0].status, 'due', 'before day 15 of October, September is due');
  assert.equal(usageMonths([], new Date('2026-10-05T23:00:00Z'), null)[0].status, 'due', 'the report day itself is not late');
  assert.equal(usageMonths([], new Date('2026-10-06T00:00:00Z'), null)[0].status, 'late');

  const q3 = usageMonths([{ period: '2026-Q3', reported_at: '2026-10-02T05:10:00.000Z' }], now, null);
  assert.deepEqual(q3.map((m) => [m.month, m.status, m.sent_at]), [
    ['2026-09', 'sent', '2026-10-02T05:10:00.000Z'], ['2026-08', 'sent', '2026-10-02T05:10:00.000Z'], ['2026-07', 'sent', '2026-10-02T05:10:00.000Z'],
  ]);
  const mid = usageMonths([{ period: '2026-Q3', reported_at: '2026-09-20 05:10:00' }], now, null);
  assert.deepEqual(mid.map((m) => m.status), ['late', 'sent', 'sent'], 'a stamp inside September does not cover September');
  const monthly = usageMonths([{ period: '2026-09', reported_at: '2026-10-03' }], now, null);
  assert.equal(monthly[0].status, 'sent', 'a period stored by month covers its month');
});

test('statements read the report day from the terms, and Send now is false on HQ with the reason', async () => {
  const { env, db } = fixture();
  db.prepare("INSERT INTO licence_terms (licence_uid, usage_report_day) VALUES ('lic_a', 10)").run();
  const r = await call(env, PRINCIPAL, 'GET', '/mine/statements');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.usage_report_day, 10);
  assert.equal(r.body.usage_report_day_recorded, true);
  assert.equal(r.body.usage_months.length, 3);
  assert.equal(r.body.send_now, false);
  assert.equal(r.body.send_now_reason, SEND_NOW_HQ_REASON);

  const b = await call(env, OTHER_PRINCIPAL, 'GET', '/mine/statements');
  assert.equal(b.body.usage_report_day, DEFAULT_USAGE_REPORT_DAY);
  assert.equal(b.body.usage_report_day_recorded, false);

  const hq = await call(env, PRINCIPAL, 'POST', '/mine/usage-reports/send');
  assert.equal(hq.status, 409);
  assert.equal(hq.body.error, 'send_now_branch_only');
});

/** A KV stand-in for RATE_LIMITS. */
function kvStub() {
  const m = new Map<string, string>();
  return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); } };
}

test('Send now on a branch calls HQ once, then waits five minutes; with no throttle store it refuses', async () => {
  const { env } = fixture({ branch: 'fr' });
  const calls: string[] = [];
  env.RPC_SECRET = 'fixture-rpc-secret';
  env.HQ = { reportUsage: async (_code: string, _s: string, period: string) => { calls.push(period); return { ok: true, period, streams: 1 }; } };

  const none = await quietly(() => call(env, PRINCIPAL, 'POST', '/mine/usage-reports/send'));
  assert.equal(none.status, 503);
  assert.equal(none.body.called, false);
  assert.match(none.body.reason, /RATE_LIMITS/);
  assert.equal(calls.length, 0, 'no throttle store, no call to HQ');

  env.RATE_LIMITS = kvStub();
  const first = await quietly(() => call(env, PRINCIPAL, 'POST', '/mine/usage-reports/send'));
  assert.equal(first.body.called, true, JSON.stringify(first.body));
  assert.ok(calls.length >= 1, 'HQ was called');
  const after = calls.length;
  const second = await quietly(() => call(env, PRINCIPAL, 'POST', '/mine/usage-reports/send'));
  assert.equal(second.status, 429);
  assert.equal(second.body.called, false);
  assert.ok(second.body.retry_after, 'it says when to try again');
  assert.equal(calls.length, after, 'the second press did not call HQ');

  assert.equal((await call(env, MEMBER, 'POST', '/mine/usage-reports/send')).status, 403);

  const st = await call(env, PRINCIPAL, 'GET', '/mine/statements');
  assert.equal(st.body.available, false);
  assert.equal(st.body.send_now, true);
});

// ───────────────────────────────────────────────────────── 5. the payee

test('the payee refusal reads licensor_ip_entity, never the brand licensor', async () => {
  const { env, db } = fixture();
  const number = await holdingsAccount(env, db);
  db.prepare("INSERT INTO licence_terms (licence_uid, licensor_ip_entity, licensor_brand_entity) VALUES ('lic_a', 'holdings', 'management')").run();
  const paid = await call(env, PRINCIPAL, 'GET', '/mine/statements');
  assert.equal(paid.body.payment.account_last4, number.slice(-4), 'a brand licensor other than Holdings is not a refusal');

  db.prepare("UPDATE licence_terms SET licensor_ip_entity = 'management', licensor_brand_entity = 'holdings' WHERE licence_uid = 'lic_a'").run();
  const refused = await call(env, PRINCIPAL, 'GET', '/mine/statements');
  assert.equal(refused.body.payment.refusal_code, 'licensor_not_payee');
  assert.equal(refused.body.payment.lines, undefined);
  assert.ok(!JSON.stringify(refused.body).includes(number.slice(-4)), 'Holdings\' account was shown');
  assert.match(refused.body.payment.refusal, /platform IP licensor/);

  assert.deepEqual(accountTermsOf({ licensor_ip_entity: 'gp', usage_report_day: 7, licensor_entity: 'holdings' }),
    { licensor_ip_entity: 'gp', usage_report_day: 7 });
  assert.deepEqual(accountTermsOf(null), { licensor_ip_entity: null, usage_report_day: null });
  assert.deepEqual(accountTermsOf({ usage_report_day: 31 }), { licensor_ip_entity: null, usage_report_day: null });
  assert.equal(licensorRefusal('holdings'), null);
});

test('a database without the terms table reads no refusal and the default day, and still answers', async () => {
  const { env, db } = fixture();
  await holdingsAccount(env, db);
  db.exec('DROP TABLE licence_terms');
  const r = await quietly(() => call(env, PRINCIPAL, 'GET', '/mine/statements'));
  assert.equal(r.status, 200);
  assert.equal(r.body.usage_report_day, DEFAULT_USAGE_REPORT_DAY);
  assert.ok(r.body.payment.account_last4, 'no refusal');
});
