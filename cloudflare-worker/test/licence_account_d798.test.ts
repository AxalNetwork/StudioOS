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
import { USAGE_REASON, licenceFeeReference, licenseeStatements, licensorRefusal, parseDispute, periodEnds, seatsNearCap, usageReportStatus } from '../src/services/licenceAccount.ts';
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
  'cloudflare-worker/sql/migrations/256_branch_local_copies.sql',
  'cloudflare-worker/sql/migrations/257_branch_licence_ref.sql',
  'cloudflare-worker/sql/migrations/265_branch_licence_entity.sql',
  'cloudflare-worker/sql/migrations/284_branch_licence_kind.sql',
  'cloudflare-worker/sql/migrations/264_admin_notices.sql',
].map(read);

/** A ten-digit number drawn per run: never a literal in this file. */
/** As HQ stored them, a fourth stream (D802) and a field no reader here knows included. */
const STREAMS_09 = JSON.stringify([
  { stream: 'subscriptions', gross_cents: 100000, currency: 'EUR', available: true, is_estimate: true },
  { stream: 'platform_licence_royalties', gross_cents: 6000, currency: 'EUR', available: true, is_estimate: false, royalty_bps: 500 },
]);
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
      (uid, licence_uid, template_slug, template_version, template_title, body_md, unfilled_fields, status, envelope_uid,
       superseded_at, sent_at, signed_at, created_at)
    VALUES (?, ?, 'licence_agreement', ?, 'Territory licence agreement', ?, ?, ?, ?, ?, ?, ?, ?)`);
  // lic_a: v2 signed and replaced by v3, v3 signed and still in force, a v3 redraft HQ never sent, v4 sent and waiting.
  c.run('ctr_a_v2', 'lic_a', 2, 'BODY-A-V2', '[]', 'signed', null, '2026-07-01 00:00:00', '2026-06-02 00:00:00', '2026-06-03 00:00:00', '2026-06-01 00:00:00');
  c.run('ctr_a_v3', 'lic_a', 3, 'BODY-A-V3', '[]', 'signed', null, '2026-09-01 00:00:00', '2026-08-02 00:00:00', '2026-08-03 00:00:00', '2026-08-01 00:00:00');
  c.run('ctr_a_redraft', 'lic_a', 3, 'BODY-A-REDRAFT', '[]', 'draft', null, '2026-09-01 00:00:00', null, null, '2026-08-15 00:00:00');
  c.run('ctr_a', 'lic_a', 4, 'BODY-A-V4', '["territory"]', 'sent', 'env-a', null, '2026-09-02 00:00:00', null, '2026-09-01 00:00:00');
  c.run('ctr_b', 'lic_b', 4, 'BODY-B-V4', '[]', 'sent', 'env-b', null, '2026-09-02 00:00:00', null, '2026-09-01 00:00:00');
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
  s.run('st_a_09', 'lic_a', '2026-09', STREAMS_09, 0, null, 'issued', SUPER);
  s.run('st_a_08', 'lic_a', '2026-08', streams, 35000, SUPER, 'paid', SUPER);
  s.run('st_a_07', 'lic_a', '2026-07', streams, 0, null, 'void', SUPER);
  s.run('st_a_10', 'lic_a', '2026-10', streams, 0, null, 'draft', SUPER);
  s.run('st_b_09', 'lic_b', '2026-09', streams, 0, null, 'issued', SUPER);
  db.prepare(`INSERT INTO subsidiary_usage_reports (licence_uid, branch_code, period, stream, gross_cents, is_estimate, reported_at)
    VALUES (?, ?, ?, 'subscriptions', 100000, 1, '2026-10-01')`).run('lic_a', 'a', '2026-09');
  db.prepare(`INSERT INTO subsidiary_usage_reports (licence_uid, branch_code, period, stream, gross_cents, is_estimate, reported_at)
    VALUES (?, ?, ?, 'subscriptions', 200000, 0, '2026-10-01')`).run('lic_b', 'b', '2026-09');

  const n = db.prepare(`INSERT INTO admin_notices (uid, user_id, licence_id, kind, subject, body, respond_by, status)
    VALUES (?, ?, ?, 'other', ?, 'Body', ?, ?)`);
  n.run('ntc_a', PRINCIPAL, 1, 'Late usage report', '2026-10-24T00:00:00Z', 'issued');
  n.run('ntc_a_done', PRINCIPAL, 1, 'Answered already', '2026-09-24T00:00:00Z', 'responded');
  n.run('ntc_b', OTHER_PRINCIPAL, 2, 'Another licence', '2026-10-24T00:00:00Z', 'issued');

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
    assert.equal(r.body.pending.uid, 'ctr_a');
    assert.equal(r.body.pending.body_md, 'BODY-A-V4');
    assert.deepEqual(r.body.pending.unfilled_fields, ['territory']);
    assert.equal(r.body.in_force.uid, 'ctr_a_v3');
    assert.ok(!JSON.stringify(r.body).includes('BODY-B'), 'another licence\'s contract leaked');
  }
  const b = await call(env, OTHER_PRINCIPAL, 'GET', '/mine/contract');
  assert.equal(b.body.pending.uid, 'ctr_b');
  assert.equal(b.body.in_force, null);
  assert.ok(!JSON.stringify(b.body).includes('BODY-A'));
});

test('a signed-in member who administers no licence gets no_licence on every route', async () => {
  const { env } = fixture();
  for (const [m, p] of [
    ['GET', '/mine/contract'], ['GET', '/mine/contract/ctr_a/pdf'], ['GET', '/mine/statements'], ['GET', '/mine/needs'],
    ['POST', '/mine/statements/st_a_09/dispute'], ['POST', '/mine/usage/send'],
  ] as const) {
    const r = await call(env, MEMBER, m, p, m === 'POST' ? { cents: 100, reason: 'A reason long enough' } : undefined);
    assert.equal(r.status, 404, p);
    assert.equal(r.body.error, 'no_licence', p);
  }
  const anon = await app.request('/licence/mine/contract', {}, env);
  assert.equal(anon.status, 401);
});

test('in force is the latest signed contract, pending the one sent and waiting, and a draft is never shown', async () => {
  const { env, db } = fixture();
  const r = await call(env, PRINCIPAL, 'GET', '/mine/contract');
  assert.equal(r.body.in_force.uid, 'ctr_a_v3', 'v3 stays in force while v4 waits, though drawing v4 superseded it');
  assert.equal(r.body.in_force.signed_at, '2026-08-03 00:00:00');
  assert.equal(r.body.pending.uid, 'ctr_a');
  assert.ok(!JSON.stringify(r.body).includes('BODY-A-REDRAFT'), 'a contract HQ never sent was shown');

  // HQ redraws while v4 is sent: v4 is no longer waiting, and the new draft is not shown.
  db.exec('SAVEPOINT redraw');
  db.prepare("UPDATE licence_contracts SET superseded_at = '2026-09-10 00:00:00' WHERE uid = 'ctr_a'").run();
  db.prepare(`INSERT INTO licence_contracts (uid, licence_uid, template_slug, template_version, template_title, body_md, status, created_at)
    VALUES ('ctr_a_v5d', 'lic_a', 'licence_agreement', 5, 'Territory licence agreement', 'BODY-A-V5D', 'draft', '2026-09-10 00:00:00')`).run();
  const redrawnSent = await call(env, PRINCIPAL, 'GET', '/mine/contract');
  assert.equal(redrawnSent.body.pending, null, 'a superseded contract is not waiting for a signature');
  assert.equal(redrawnSent.body.sign_url, null);
  assert.equal(redrawnSent.body.sign_reason, 'Not sent yet');
  assert.deepEqual(redrawnSent.body.earlier.map((x: any) => x.uid), ['ctr_a', 'ctr_a_v2']);
  db.exec('ROLLBACK TO redraw'); db.exec('RELEASE redraw');

  // v4 signed: it is in force, nothing is pending, and v3 joins the earlier ones.
  db.prepare("UPDATE esign_envelopes SET status = 'completed', completed_at = '2026-09-03 00:00:00' WHERE envelope_uuid = 'env-a'").run();
  const signed = await call(env, PRINCIPAL, 'GET', '/mine/contract');
  assert.equal(signed.body.in_force.uid, 'ctr_a', 'the status follows the envelope');
  assert.equal(signed.body.pending, null);
  assert.deepEqual(signed.body.earlier.map((x: any) => x.uid), ['ctr_a_v3', 'ctr_a_v2']);
  assert.equal(signed.body.sign_url, null);
  assert.equal(signed.body.sign_reason, 'Signed');

  // HQ redrafts: the new draft is not shown and the reason says so.
  db.prepare("UPDATE licence_contracts SET superseded_at = '2026-10-01 00:00:00' WHERE licence_uid = 'lic_a' AND superseded_at IS NULL").run();
  db.prepare(`INSERT INTO licence_contracts (uid, licence_uid, template_slug, template_version, template_title, body_md, status, created_at)
    VALUES ('ctr_a_v5', 'lic_a', 'licence_agreement', 5, 'Territory licence agreement', 'BODY-A-V5', 'draft', '2026-10-01 00:00:00')`).run();
  const redrawn = await call(env, PRINCIPAL, 'GET', '/mine/contract');
  assert.equal(redrawn.body.in_force.uid, 'ctr_a');
  assert.equal(redrawn.body.pending, null);
  assert.equal(redrawn.body.sign_reason, 'Not sent yet');
  assert.ok(!JSON.stringify(redrawn.body).includes('BODY-A-V5'));
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

  db.prepare("UPDATE licence_contracts SET envelope_uid = NULL WHERE uid = 'ctr_a'").run();
  const noEnvelope = await call(env, PRINCIPAL, 'GET', '/mine/contract');
  assert.equal(noEnvelope.body.pending.uid, 'ctr_a');
  assert.equal(noEnvelope.body.sign_url, null);
  assert.equal(noEnvelope.body.sign_reason, 'HQ has sent no signing link for it. Ask HQ.');
  db.prepare("UPDATE licence_contracts SET envelope_uid = 'env-a' WHERE uid = 'ctr_a'").run();

  // An envelope not yet sent reads as a draft: not shown, and its recipient's token is not offered.
  db.prepare("UPDATE esign_envelopes SET status = 'created' WHERE envelope_uuid = 'env-a'").run();
  db.prepare("UPDATE esign_recipients SET token_expires_at = '2099-01-01T00:00:00Z'").run();
  const unsent = await call(env, PRINCIPAL, 'GET', '/mine/contract');
  assert.equal(unsent.body.pending, null);
  assert.equal(unsent.body.sign_url, null);
  assert.equal(unsent.body.sign_reason, 'Not sent yet');
  assert.ok(!JSON.stringify(unsent.body).includes('tok-a'));
});

test('a superseded contract is in earlier with its own stored body', async () => {
  const { env } = fixture();
  const r = await call(env, PRINCIPAL, 'GET', '/mine/contract');
  assert.deepEqual(r.body.earlier.map((x: any) => x.uid), ['ctr_a_v2']);
  assert.equal(r.body.earlier[0].body_md, 'BODY-A-V2');
  assert.equal(r.body.earlier[0].template_version, 2);
  assert.equal(r.body.earlier[0].superseded_at, '2026-07-01 00:00:00');
});

test('the contract PDF prints a visible contract of the caller\'s own licence, and nothing else', async () => {
  const { env } = fixture();
  const pdfOf = async (who: number, uid: string) => {
    const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    return quietly(() => app.request(`/licence/mine/contract/${uid}/pdf`, { headers: { Authorization: `Bearer ${jwt}` } }, env));
  };
  for (const uid of ['ctr_a', 'ctr_a_v3', 'ctr_a_v2']) {
    const res = await pdfOf(DELEGATE, uid);
    assert.equal(res.status, 200, uid);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('content-disposition') || '', /^inline; filename="LIC-A-contract-v\d\.pdf"$/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  }
  for (const [who, uid] of [[PRINCIPAL, 'ctr_b'], [PRINCIPAL, 'ctr_a_redraft'], [PRINCIPAL, 'nope'], [OTHER_PRINCIPAL, 'ctr_a']] as const) {
    const res = await pdfOf(who, uid);
    assert.equal(res.status, 404, `${who} ${uid}`);
  }
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
    assert.deepEqual(sept.streams, JSON.parse(STREAMS_09), 'streams_json passes through as stored');
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
  const refused = await licenseeStatements(env, lic, { licensorIpEntity: 'management' });
  assert.equal((refused.payment as any).refusal_code, 'licensor_not_payee');
  assert.equal((refused.payment as any).lines, undefined);
  assert.ok(!JSON.stringify(refused).includes(number.slice(-4)), 'Holdings\' account was shown');
  assert.equal(refused.statements.length, 3, 'the statements are still read');
  const holdings = await licenseeStatements(env, lic, { licensorIpEntity: 'holdings' });
  assert.equal((holdings.payment as any).payee_name, 'Axal VC Holdings LLC');
  assert.equal((holdings.payment as any).method, 'Bank transfer');
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
  const contract = await call(env, PRINCIPAL, 'GET', '/mine/contract');
  assert.equal(contract.status, 200);
  assert.deepEqual(contract.body, { available: false, reason: 'Read on HQ; this branch has no copy yet' });
  const statements = await call(env, PRINCIPAL, 'GET', '/mine/statements');
  assert.deepEqual(statements.body, {
    available: false, reason: 'Read on HQ; this branch has no copy yet', usage: { send_now: true, send_now_reason: null },
  });
  for (const [m, p] of [['GET', '/mine/contract'], ['GET', '/mine/statements'], ['GET', '/mine/needs'], ['POST', '/mine/usage/send']] as const) {
    const r = await call(env, MEMBER, m, p);
    assert.equal(r.status, 403, p);
  }
  const pdf = await call(env, PRINCIPAL, 'GET', '/mine/contract/ctr_a/pdf');
  assert.equal(pdf.status, 501);
  const d = await call(env, PRINCIPAL, 'POST', '/mine/statements/st_a_09/dispute', { cents: 100, reason: 'A reason long enough to read.' });
  assert.equal(d.status, 501);
  assert.equal(d.body.error, 'statement_hq_only');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM hq_escalations').get() as any).n, 0);
});

// ───────────────────────────────────────────────────────────── usage reports

test('each period\'s usage report: sent with its date, late only after the report day, never guessed without one', async () => {
  const now = new Date('2026-10-20T12:00:00Z');
  assert.deepEqual(usageReportStatus('2026-09', '2026-10-04 08:00:00', 5, now),
    { period: '2026-09', status: 'sent', sent_at: '2026-10-04 08:00:00', due_on: null, late: false });
  assert.deepEqual(usageReportStatus('2026-08', null, null, now),
    { period: '2026-08', status: 'not_sent', sent_at: null, due_on: null, late: null });
  assert.equal(usageReportStatus('2026-09', null, 5, now).status, 'late');
  assert.equal(usageReportStatus('2026-09', null, 20, now).status, 'due', 'due through the report day itself');
  assert.equal(usageReportStatus('2026-09', null, 19, now).status, 'late');
  assert.equal(usageReportStatus('2026-09', null, 19, now).due_on, '2026-10-19');
  assert.equal(usageReportStatus('2026-Q3', null, 5, now).due_on, '2026-10-05', 'a quarter is due the month after it ends');
  assert.equal(usageReportStatus('2026-Q4', null, 5, now).status, 'due');
  assert.equal(periodEnds('2026-12')?.toISOString(), '2027-01-01T00:00:00.000Z');
  assert.equal(periodEnds('2026-Q5'), null);

  const { env, db } = fixture();
  const lic = db.prepare("SELECT * FROM territory_licences WHERE uid = 'lic_a'").get() as any;
  const none = await licenseeStatements(env, lic, {}, now);
  assert.equal(none.usage.report_day, null);
  assert.equal(none.usage.report_day_reason, USAGE_REASON.no_report_day);
  assert.deepEqual(none.usage.periods.map((u: any) => [u.period, u.status]),
    [['2026-09', 'sent'], ['2026-08', 'not_sent'], ['2026-07', 'not_sent']]);
  assert.equal(none.usage.periods[0].sent_at, '2026-10-01');
  assert.equal(none.usage.send_now, false);
  assert.equal(none.usage.send_now_reason, USAGE_REASON.hq_send);
  const day = await licenseeStatements(env, lic, { usageReportDay: 5 }, now);
  assert.deepEqual(day.usage.periods.map((u: any) => u.status), ['sent', 'late', 'late']);
  assert.ok(!none.usage.periods.some((u: any) => u.period === '2026-10'), 'a draft statement\'s period is not listed');

  const route = await call(env, PRINCIPAL, 'GET', '/mine/statements');
  assert.equal(route.body.usage.send_now, false);
  const send = await call(env, PRINCIPAL, 'POST', '/mine/usage/send');
  assert.equal(send.status, 501);
  assert.equal(send.body.error, 'usage_branch_only');
});

test('Send now on a branch runs the branch\'s own usage push and says why when it cannot', async () => {
  const { env } = fixture({ branch: 'fr' });
  const r = await call(env, PRINCIPAL, 'POST', '/mine/usage/send');
  assert.equal(r.status, 502, 'no RPC secret: the push refuses before calling HQ');
  assert.equal(r.body.sent, false);
  assert.ok(r.body.reason);
});

// ───────────────────────────────────────────────────────────── needs you

test('needs: the caller\'s contract to sign, then notices, then unpaid statements, each with its link', async () => {
  const { env, db } = fixture();
  const p = await call(env, PRINCIPAL, 'GET', '/mine/needs');
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.deepEqual(p.body.items.map((i: any) => [i.kind, i.ref, i.link]), [
    ['contract', 'ctr_a', '/admin/my-licence/contract'],
    ['notice', 'ntc_a', '/admin/my-licence/requests'],
    ['statement', 'st_a_09', '/admin/my-licence/statements'],
  ]);
  assert.equal(p.body.count, 3);
  assert.equal(p.body.items[0].title, 'Contract v4 is waiting for your signature');
  assert.equal(p.body.reasons.seats, 'Seats used is not counted on HQ yet, so no seat type is flagged here.');

  // The delegate is not the recipient and is sent no notice: only the licence's unpaid statement.
  const d = await call(env, DELEGATE, 'GET', '/mine/needs');
  assert.deepEqual(d.body.items.map((i: any) => i.ref), ['st_a_09']);
  const b = await call(env, OTHER_PRINCIPAL, 'GET', '/mine/needs');
  assert.deepEqual(b.body.items.map((i: any) => i.ref), ['ctr_b', 'ntc_b', 'st_b_09']);

  db.prepare("UPDATE subsidiary_statements SET paid_cents = owed_cents WHERE uid = 'st_a_09'").run();
  db.prepare("UPDATE admin_notices SET status = 'overdue' WHERE uid = 'ntc_a'").run();
  db.prepare("UPDATE esign_envelopes SET status = 'completed' WHERE envelope_uuid = 'env-a'").run();
  const after = await call(env, PRINCIPAL, 'GET', '/mine/needs');
  assert.deepEqual(after.body.items.map((i: any) => i.ref), ['ntc_a'], 'an overdue notice still waits; a paid statement and a signed contract do not');

  db.exec('DROP TABLE admin_notices');
  const unreadable = await quietly(() => call(env, PRINCIPAL, 'GET', '/mine/needs'));
  assert.equal(unreadable.status, 200);
  assert.match(unreadable.body.reasons.notices, /could not be read/);
});

test('needs on a branch: its notices and the seat types at 90% of their seats licensed', async () => {
  const { env, db } = fixture({ branch: 'fr' });
  db.prepare(`INSERT INTO branch_licence (id, licence_uid, brand_name, seats_json, pushed_at)
    VALUES (1, 'lic_a', 'Brand A', ?, '2026-10-01')`).run(JSON.stringify({ founder: 10, investor: 10 }));
  const u = db.prepare("INSERT INTO users (id, role, name, email) VALUES (?, 'founder', 'Member', ?)");
  for (let i = 0; i < 8; i++) u.run(100 + i, `m${i}@example.test`);
  const r = await call(env, PRINCIPAL, 'GET', '/mine/needs');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.items.map((i: any) => [i.kind, i.ref]), [['notice', 'ntc_a'], ['seats', 'founder']]);
  assert.equal(r.body.items[1].title, 'founder seats 9 of 10 used');
  assert.equal(r.body.reasons.contract, 'Read on HQ; this branch has no copy yet');

  assert.deepEqual(seatsNearCap({ founder: 10, investor: 10, advisor: 0 }, { founder: 8, investor: 10, advisor: 3 }),
    [{ seat_type: 'investor', used: 10, licensed: 10 }]);
  assert.deepEqual(seatsNearCap({ founder: 10 }, null), []);
});
