/**
 * D798 (#2231) — the territory licence's Administrator reads their own
 * contract, statements and payment instructions, and disputes a statement.
 *
 * On node:sqlite, with the baseline's own DDL for users, sessions, licences,
 * administrators and envelopes, and migrations 259, 260 and 472 from their
 * files. The bank account is written as the console writes it, with a number
 * drawn at run time, so no account number is in this file; the people are
 * placeholders.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_account_d798.test.ts
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
import { PAY_WARNING } from '../src/services/payInstructions.ts';
import { licenceFeeReference, licenseeStatements, licensorRefusal, parseDispute } from '../src/services/licenceAccount.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'd798-fixture-only-signing-secret';
const PRINCIPAL = 11;
const DELEGATE = 12;
const OTHER_PRINCIPAL = 13;
const MEMBER = 14;
const SUPER = 15;

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATIONS = [
  'cloudflare-worker/sql/migrations/259_licence_contracts.sql',
  'cloudflare-worker/sql/migrations/259_hq_escalations.sql',
  'cloudflare-worker/sql/migrations/260_subsidiary_statements.sql',
  'cloudflare-worker/sql/migrations/472_entity_bank_accounts.sql',
].map(read);

/** A ten-digit number drawn per run: never a literal in this file. */
const accountNumber = () => String(randomInt(1_000_000_000, 9_999_999_999));

function fixture(o: { account?: boolean; branch?: string } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'user_sessions', 'territory_licences', 'licence_admins', 'esign_envelopes', 'esign_recipients']) {
    db.exec(tableFromBaseline(BASELINE, t));
  }
  for (const m of MIGRATIONS) db.exec(m);
  const u = db.prepare("INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)");
  u.run(PRINCIPAL, 'admin', 'Principal A', 'principal-a@example.test');
  u.run(DELEGATE, 'admin', 'Delegate A', 'delegate-a@example.test');
  u.run(OTHER_PRINCIPAL, 'admin', 'Principal B', 'principal-b@example.test');
  u.run(MEMBER, 'founder', 'Member', 'member@example.test');
  u.run(SUPER, 'admin', 'HQ', 'hq@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  const l = db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, currency)
    VALUES (?, ?, ?, ?, ?, 'active', 'EUR')`);
  l.run(1, 'lic_a', 'LIC-A', 'Licensee A', 'Brand A');
  l.run(2, 'lic_b', 'LIC-B', 'Licensee B', 'Brand B');
  const a = db.prepare('INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (?, ?, ?)');
  a.run(1, PRINCIPAL, 'principal');
  a.run(1, DELEGATE, 'delegate');
  a.run(2, OTHER_PRINCIPAL, 'principal');

  const c = db.prepare(`INSERT INTO licence_contracts
      (uid, licence_uid, template_slug, template_version, template_title, body_md, unfilled_fields, status, envelope_uid, superseded_at, sent_at, created_at)
    VALUES (?, ?, 'licence_agreement', ?, 'Territory licence agreement', ?, ?, ?, ?, ?, ?, ?)`);
  c.run('ctr_a_old', 'lic_a', 3, 'BODY-A-V3', '[]', 'draft', null, '2026-09-01 00:00:00', null, '2026-08-01 00:00:00');
  c.run('ctr_a', 'lic_a', 4, 'BODY-A-V4', '["territory"]', 'sent', 'env-a', null, '2026-09-02 00:00:00', '2026-09-01 00:00:00');
  c.run('ctr_b', 'lic_b', 4, 'BODY-B-V4', '[]', 'sent', 'env-b', null, '2026-09-02 00:00:00', '2026-09-01 00:00:00');
  const e = db.prepare(`INSERT INTO esign_envelopes (id, envelope_uuid, document_type, document_title, document_body, body_sha256, status, created_by)
    VALUES (?, ?, 'licence_agreement', 'Territory licence agreement', 'x', 'x', 'sent', ?)`);
  e.run(1, 'env-a', SUPER);
  e.run(2, 'env-b', SUPER);
  const r = db.prepare(`INSERT INTO esign_recipients (envelope_id, user_id, recipient_email, recipient_name, signing_token, token_expires_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')`);
  r.run(1, PRINCIPAL, 'principal-a@example.test', 'Principal A', 'tok-a', '2099-01-01T00:00:00Z');
  r.run(2, OTHER_PRINCIPAL, 'principal-b@example.test', 'Principal B', 'tok-b', '2099-01-01T00:00:00Z');

  const s = db.prepare(`INSERT INTO subsidiary_statements
      (uid, licence_uid, period, gross_cents, revenue_share_bps, owed_cents, currency, streams_json, estimated_streams,
       unreported_streams, paid_cents, paid_note, paid_by_user_id, disputed_cents, dispute_note, status, drawn_by_user_id)
    VALUES (?, ?, ?, 100000, 3500, 35000, 'EUR', ?, 1, 0, ?, 'HQ-NOTE', ?, 0, 'HQ-DISPUTE-NOTE', ?, ?)`);
  const streams = JSON.stringify([{ stream: 'subscriptions', gross_cents: 100000, currency: 'EUR', available: true, is_estimate: true }]);
  s.run('st_a_09', 'lic_a', '2026-09', streams, 0, null, 'issued', SUPER);
  s.run('st_a_08', 'lic_a', '2026-08', streams, 35000, SUPER, 'paid', SUPER);
  s.run('st_a_07', 'lic_a', '2026-07', streams, 0, null, 'void', SUPER);
  s.run('st_a_10', 'lic_a', '2026-10', streams, 0, null, 'draft', SUPER);
  s.run('st_b_09', 'lic_b', '2026-09', streams, 0, null, 'issued', SUPER);
  db.prepare(`INSERT INTO subsidiary_usage_reports (licence_uid, branch_code, period, stream, gross_cents, is_estimate, reported_at)
    VALUES (?, ?, ?, 'subscriptions', 100000, 1, '2026-10-01')`).run('lic_a', 'a', '2026-09');
  db.prepare(`INSERT INTO subsidiary_usage_reports (licence_uid, branch_code, period, stream, gross_cents, is_estimate, reported_at)
    VALUES (?, ?, ?, 'subscriptions', 200000, 0, '2026-10-01')`).run('lic_b', 'b', '2026-09');

  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://app.example.test/' };
  if (o.branch) env.BRANCH_CODE = o.branch;
  return { db, env };
}

/** Holdings' checking, carrying the territory licence fee, as the console writes it. */
async function holdingsAccount(env: any, db: any, purposes = ['territory_licence_fee']) {
  const number = accountNumber();
  const uid = '0000aaaa-0000-4000-8000-000000000798';
  const enc = await encryptColumn(env, 'entity_bank_accounts', 'account_number_enc', uid, number);
  db.prepare(`INSERT INTO entity_bank_accounts
      (uid, entity_key, label, bank_name, bank_address, beneficiary_name, beneficiary_address, account_kind,
       account_number_enc, account_last4, routing_number, swift_code, purposes_json, status, recorded_by)
     VALUES (?, 'holdings', 'Fixture', 'Bank A', 'Bank address A', 'Axal VC Holdings LLC', 'Registered address A', 'checking',
       ?, ?, '000000000', 'BANKAXXX', ?, 'active', ?)`)
    .run(uid, enc, number.slice(-4), JSON.stringify(purposes), SUPER);
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

async function call(env: any, userId: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: userId }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/licence${path}`, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const quietly = async <T>(fn: () => Promise<T>) => {
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { [console.warn, console.error] = saved; }
};

// ───────────────────────────────────────────────────────────── the contract

test('a principal and a delegate read their own licence\'s contract, never another\'s', async () => {
  const { env } = fixture();
  for (const who of [PRINCIPAL, DELEGATE]) {
    const r = await call(env, who, 'GET', '/mine/contract');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.available, true);
    assert.equal(r.body.contract.uid, 'ctr_a');
    assert.equal(r.body.contract.body_md, 'BODY-A-V4');
    assert.deepEqual(r.body.contract.unfilled_fields, ['territory']);
    assert.ok(!JSON.stringify(r.body).includes('BODY-B'), 'another licence\'s contract leaked');
  }
  const b = await call(env, OTHER_PRINCIPAL, 'GET', '/mine/contract');
  assert.equal(b.body.contract.uid, 'ctr_b');
  assert.ok(!JSON.stringify(b.body).includes('BODY-A'));
});

test('a signed-in member who administers no licence gets no_licence on every route', async () => {
  const { env } = fixture();
  for (const [m, p] of [['GET', '/mine/contract'], ['GET', '/mine/statements'], ['POST', '/mine/statements/st_a_09/dispute']] as const) {
    const r = await call(env, MEMBER, m, p, m === 'POST' ? { cents: 100, reason: 'A reason long enough' } : undefined);
    assert.equal(r.status, 404, p);
    assert.equal(r.body.error, 'no_licence', p);
  }
  const anon = await app.request('/licence/mine/contract', {}, env);
  assert.equal(anon.status, 401);
});

test('sign_url is the caller\'s own link, only while the contract is sent to them', async () => {
  const { env, db } = fixture();
  const mine = await call(env, PRINCIPAL, 'GET', '/mine/contract');
  assert.equal(mine.body.sign_url, 'https://app.example.test/esign/tok-a');
  assert.equal(mine.body.sign_reason, null);

  const delegate = await call(env, DELEGATE, 'GET', '/mine/contract');
  assert.equal(delegate.body.sign_url, null, 'the delegate is not the recipient');
  assert.equal(delegate.body.sign_reason, 'HQ sent it to Principal A');
  assert.ok(!JSON.stringify(delegate.body).includes('tok-a'), 'the recipient\'s token leaked');

  db.prepare("UPDATE esign_recipients SET token_expires_at = '2020-01-01T00:00:00Z' WHERE signing_token = 'tok-a'").run();
  const expired = await call(env, PRINCIPAL, 'GET', '/mine/contract');
  assert.equal(expired.body.sign_url, null);
  assert.match(expired.body.sign_reason, /expired/);

  db.prepare("UPDATE esign_envelopes SET status = 'completed', completed_at = '2026-09-03 00:00:00' WHERE envelope_uuid = 'env-a'").run();
  const signed = await call(env, PRINCIPAL, 'GET', '/mine/contract');
  assert.equal(signed.body.contract.status, 'signed', 'the status follows the envelope');
  assert.equal(signed.body.sign_url, null);

  // An envelope not yet sent reads as a draft, and its recipient's token is not offered.
  db.prepare("UPDATE esign_envelopes SET status = 'created', completed_at = NULL WHERE envelope_uuid = 'env-a'").run();
  db.prepare("UPDATE esign_recipients SET token_expires_at = '2099-01-01T00:00:00Z'").run();
  const unsent = await call(env, PRINCIPAL, 'GET', '/mine/contract');
  assert.equal(unsent.body.contract.status, 'draft');
  assert.equal(unsent.body.sign_url, null);
  assert.equal(unsent.body.sign_reason, 'Not sent yet');

  db.prepare("UPDATE esign_envelopes SET status = 'sent' WHERE envelope_uuid = 'env-a'").run();
  db.prepare("UPDATE licence_contracts SET status = 'draft', envelope_uid = NULL WHERE uid = 'ctr_a'").run();
  const draft = await call(env, PRINCIPAL, 'GET', '/mine/contract');
  assert.equal(draft.body.sign_url, null);
  assert.equal(draft.body.sign_reason, 'Not sent yet');
});

test('a superseded contract is in earlier with its own stored body', async () => {
  const { env } = fixture();
  const r = await call(env, PRINCIPAL, 'GET', '/mine/contract');
  assert.equal(r.body.earlier.length, 1);
  assert.equal(r.body.earlier[0].uid, 'ctr_a_old');
  assert.equal(r.body.earlier[0].body_md, 'BODY-A-V3');
  assert.equal(r.body.earlier[0].template_version, 3);
  assert.equal(r.body.earlier[0].superseded_at, '2026-09-01 00:00:00');
});

// ───────────────────────────────────────────────────────────── statements

test('statements: the licence\'s own, a draft hidden, HQ-only fields never sent', async () => {
  const { env, db } = fixture();
  await holdingsAccount(env, db);
  for (const who of [PRINCIPAL, DELEGATE]) {
    const r = await call(env, who, 'GET', '/mine/statements');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.statements.map((s: any) => s.uid), ['st_a_09', 'st_a_08', 'st_a_07']);
    const text = JSON.stringify(r.body);
    for (const hidden of ['st_a_10', 'st_b_09', 'drawn_by_user_id', 'paid_by_user_id', 'HQ-NOTE', 'HQ-DISPUTE-NOTE']) {
      assert.ok(!text.includes(hidden), `${hidden} was sent`);
    }
    const sept = r.body.statements[0];
    assert.equal(sept.owed_cents, 35000);
    assert.equal(sept.revenue_share_bps, 3500);
    assert.equal(sept.streams[0].is_estimate, true);
    assert.equal(sept.payment_reference, 'AXAL-LIC-LIC-A-2026-09');
    assert.deepEqual(r.body.usage_reports.map((u: any) => [u.period, u.streams.length, u.streams[0].gross_cents]), [['2026-09', 1, 100000]]);
  }
});

test('the payment block is Holdings\' account for the fee, masked, with the warning', async () => {
  const { env, db } = fixture();
  const number = await holdingsAccount(env, db);
  const r = await call(env, PRINCIPAL, 'GET', '/mine/statements');
  const p = r.body.payment;
  assert.equal(p.account_last4, number.slice(-4));
  assert.equal(p.warning, PAY_WARNING);
  assert.ok(p.lines.some((l: any) => l.label === 'Account' && l.value === `ending ${number.slice(-4)}`));
  assert.ok(!JSON.stringify(r.body).includes(number), 'the full account number was sent');
  assert.ok(!JSON.stringify(r.body).includes('account_number_enc'));
});

test('with no account carrying the purpose, payment is the refusal\'s sentence', async () => {
  const { env, db } = fixture();
  const none = await call(env, PRINCIPAL, 'GET', '/mine/statements');
  assert.equal(none.body.payment.refusal_code, 'no_active_account');
  assert.match(none.body.payment.refusal, /Territory licence fee|territory licence fee/);
  assert.equal(none.body.payment.lines, undefined);

  // An account for the platform licence fee is not the territory licence fee's.
  await holdingsAccount(env, db, ['platform_licence_fee']);
  const other = await call(env, PRINCIPAL, 'GET', '/mine/statements');
  assert.equal(other.body.payment.refusal_code, 'no_active_account');
});

test('a licence whose terms name another licensor is refused rather than paid to Holdings', async () => {
  const { env, db } = fixture();
  const number = await holdingsAccount(env, db);
  const lic = db.prepare("SELECT * FROM territory_licences WHERE uid = 'lic_a'").get() as any;
  const refused = await licenseeStatements(env, lic, { licensor_ip_entity: 'management', usage_report_day: null });
  assert.equal((refused.payment as any).refusal_code, 'licensor_not_payee');
  assert.equal((refused.payment as any).lines, undefined);
  assert.ok(!JSON.stringify(refused).includes(number.slice(-4)), 'Holdings\' account was shown');
  assert.equal(refused.statements.length, 3, 'the statements are still read');
  const holdings = await licenseeStatements(env, lic, { licensor_ip_entity: 'holdings', usage_report_day: null });
  assert.equal((holdings.payment as any).account_last4, number.slice(-4));

  assert.equal(licensorRefusal(null), null);
  assert.equal(licensorRefusal(''), null);
  assert.equal(licensorRefusal('holdings'), null);
  const r = licensorRefusal('management');
  assert.equal(r?.refusal_code, 'licensor_not_payee');
  assert.match(r!.refusal, /Axal VC Management LLC/);
  assert.match(r!.refusal, /no payment instructions are given/);
  assert.equal(licenceFeeReference('LIC-A', '2026-09'), 'AXAL-LIC-LIC-A-2026-09');
  assert.throws(() => licenceFeeReference('', '2026-09'));
});

// ───────────────────────────────────────────────────────────── disputes

const statementRow = (db: any, uid: string) => db.prepare('SELECT * FROM subsidiary_statements WHERE uid = ?').get(uid);

test('a dispute is an escalation to HQ, notifies HQ and writes no statement field', async () => {
  const { env, db } = fixture();
  const before = statementRow(db, 'st_a_09');
  const r = await quietly(() => call(env, DELEGATE, 'POST', '/mine/statements/st_a_09/dispute', { cents: 5000, reason: 'Two subscriptions were refunded in September.' }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.escalation.status, 'open');
  assert.deepEqual(statementRow(db, 'st_a_09'), before, 'the statement changed');

  const esc = db.prepare('SELECT * FROM hq_escalations').all() as any[];
  assert.equal(esc.length, 1);
  assert.equal(esc[0].uid, r.body.escalation.uid);
  assert.equal(esc[0].branch_code, 'hq');
  assert.equal(esc[0].kind, 'other');
  assert.equal(esc[0].subject, 'Statement dispute 2026-09');
  assert.equal(esc[0].subject_ref, 'lic_a');
  assert.equal(esc[0].raised_by_branch_user_id, DELEGATE);
  assert.match(esc[0].detail, /st_a_09/);
  assert.match(esc[0].detail, /5000 of 35000/);
  const hours = (Date.parse(esc[0].due_at) - Date.now()) / 3600_000;
  assert.ok(hours > 71 && hours <= 72, `due in ${hours}h`);

  const inbox = db.prepare("SELECT user_id, type, link FROM notifications_inbox WHERE type = 'statement_dispute'").all() as any[];
  assert.deepEqual(inbox.map((n) => [n.user_id, n.link]), [[SUPER, '/admin/licences']]);
});

test('a dispute is refused for another licence\'s statement, a draft, a void one, and a bad body', async () => {
  const { env, db } = fixture();
  const ok = { cents: 100, reason: 'A reason long enough to read.' };
  const other = await call(env, PRINCIPAL, 'POST', '/mine/statements/st_b_09/dispute', ok);
  assert.equal(other.status, 404, 'another licence\'s statement');
  const draft = await call(env, PRINCIPAL, 'POST', '/mine/statements/st_a_10/dispute', ok);
  assert.equal(draft.status, 404, 'a draft is not the licensee\'s to see');
  const voided = await call(env, PRINCIPAL, 'POST', '/mine/statements/st_a_07/dispute', ok);
  assert.equal(voided.status, 409);
  assert.equal(voided.body.error, 'not_disputable');
  for (const [body, field] of [
    [{ cents: 0, reason: ok.reason }, 'cents'], [{ cents: 1.5, reason: ok.reason }, 'cents'],
    [{ cents: '100', reason: ok.reason }, 'cents'], [{ cents: 35001, reason: ok.reason }, 'cents'],
    [{ cents: 100, reason: 'short' }, 'reason'], [{ cents: 100, reason: 'x'.repeat(2001) }, 'reason'],
  ] as const) {
    const r = await call(env, PRINCIPAL, 'POST', '/mine/statements/st_a_09/dispute', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.field, field);
  }
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM hq_escalations').get() as any).n, 0);
  const paid = await quietly(() => call(env, PRINCIPAL, 'POST', '/mine/statements/st_a_08/dispute', { cents: 35000, reason: ok.reason }));
  assert.equal(paid.status, 201, 'a paid statement may be disputed up to what was owed');
  assert.deepEqual(parseDispute({ cents: 35000, reason: ' padded reason here ' }, 35000), { ok: true, cents: 35000, reason: 'padded reason here' });
});

// ───────────────────────────────────────────────────────────── a branch

test('on a branch an admin reads the reason and no figure; a non-admin is refused first', async () => {
  const { env, db } = fixture({ branch: 'fr' });
  await holdingsAccount(env, db);
  for (const p of ['/mine/contract', '/mine/statements']) {
    const r = await call(env, PRINCIPAL, 'GET', p);
    assert.equal(r.status, 200);
    // D808: the statements read adds what a branch can do, Send now, and still no figure.
    const extra = p === '/mine/statements' ? { send_now: true, send_now_reason: null } : {};
    assert.deepEqual(r.body, { available: false, reason: 'Read on HQ; this branch has no copy yet', ...extra }, p);
    const m = await call(env, MEMBER, 'GET', p);
    assert.equal(m.status, 403, p);
  }
  const d = await call(env, PRINCIPAL, 'POST', '/mine/statements/st_a_09/dispute', { cents: 100, reason: 'A reason long enough to read.' });
  assert.equal(d.status, 501);
  assert.equal(d.body.error, 'statement_hq_only');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM hq_escalations').get() as any).n, 0);
});
