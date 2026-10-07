/**
 * D634 (#1392) — the Worker side of three HQ review screens.
 *
 *   Q6 · Sensitive fields. The KYC record and the partner profile leave the
 *   server with date of birth, ID number, address, phone and tax ID masked.
 *   Each value comes back in clear only from its own route, and that showing
 *   is written to `activity_logs` with the field and the member, never the
 *   value. A field the member did not submit, an unknown field and a missing
 *   member write nothing.
 *
 *   Q4 · Deleting a review comment refuses with a sentence the page prints:
 *   asserted in `article_comment_delete_d617.test.ts`, beside D617's codes.
 *
 *   Q5 · A billing dispute reads from Stripe: "Stripe is not configured" is
 *   503 `stripe_not_configured`, a failed read is `stripe_error`, and a read
 *   carries the amount, currency, status, reason, due date, references and
 *   evidence count the page draws.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/hq_review_d634.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import kyc from '../src/routes/kyc.ts';
import profiling from '../src/routes/profiling.ts';
import adminBilling from '../src/routes/admin_billing.ts';
import { hashEmail } from '../src/util/hashEmail.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { maskValue, maskKycData, maskPartnerProfile } from '../src/services/sensitiveFields.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
function tableDdl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  if (at < 0) throw new Error(`${name} is missing from schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

const DOB = '1990-01-02';
const ID = 'P1234567';
const PHONE = '+44 7700 900123';
const LINE1 = '12 Secret Road';
const CITY = 'Leeds';
const POST = 'LS1 4AB';
const EIN = '12-3456789';
const MEMBER_EMAIL = 'member@secret.test';
const SECRETS = [DOB, ID, PHONE, LINE1, CITY, POST, EIN, MEMBER_EMAIL];

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, email TEXT NOT NULL, name TEXT, role TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    kyc_status TEXT, kyc_data TEXT, kyc_provider TEXT,
    kyc_submitted_at TEXT, kyc_reviewed_at TEXT, kyc_rejection_reason TEXT
  );
  CREATE TABLE activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, details TEXT, actor TEXT, user_id INTEGER
  );`);
  db.exec(tableDdl('partner_profiles'));
  const kycData = JSON.stringify({
    legal_first_name: 'Pat', legal_last_name: 'Member', date_of_birth: DOB, nationality: 'GB', country: 'GB',
    address_line1: LINE1, address_line2: null, city: CITY, state_region: null, postal_code: POST,
    id_type: 'passport', id_number: ID, phone: PHONE,
  });
  db.prepare(`INSERT INTO users (id, email, name, role, kyc_status) VALUES (1, 'admin@axal.test', 'Ada Admin', 'admin', 'not_started')`).run();
  db.prepare(`INSERT INTO users (id, email, name, role, kyc_status, kyc_data) VALUES (2, ?, 'Pat Member', 'founder', 'pending', ?)`).run(MEMBER_EMAIL, kycData);
  // A member who left out the phone.
  db.prepare(`INSERT INTO users (id, email, name, role, kyc_status, kyc_data) VALUES (3, 'nophone@secret.test', 'No Phone', 'founder', 'pending', ?)`)
    .run(JSON.stringify({ legal_first_name: 'No', date_of_birth: DOB, id_number: ID, address_line1: LINE1 }));
  db.prepare(`INSERT INTO partner_profiles (email, user_id, ein, extracted_data, persona, legal_entity_name, admin_status)
    VALUES (?, 2, ?, ?, 'Founder', 'Secret LLC', 'pending')`).run(MEMBER_EMAIL, EIN, JSON.stringify({ ein: EIN, legal_name: 'Secret LLC' }));
  db.prepare(`INSERT INTO partner_profiles (email, user_id, ein, persona, admin_status) VALUES ('noein@secret.test', 3, NULL, 'Founder', 'pending')`).run();
  return db;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/kyc', kyc as any);
  a.route('/api/profiling', profiling as any);
  a.route('/api/admin/billing', adminBilling as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: String(err?.message || 'Internal server error') }, 500);
  });
  return a;
})();

async function call(db: DatabaseSync, path: string, init: { method?: string; env?: Record<string, unknown> } = {}) {
  const tok = await new SignJWT({ user_id: 1, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://x/api${path}`, {
    method: init.method || 'GET', headers: { Authorization: `Bearer ${tok}` },
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...(init.env || {}) } as any);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, text };
}

const logs = (db: DatabaseSync, action?: string) => (action
  ? db.prepare('SELECT action, details, actor, user_id FROM activity_logs WHERE action = ? ORDER BY id').all(action)
  : db.prepare('SELECT action, details, actor, user_id FROM activity_logs ORDER BY id').all()) as any[];

function noSecret(s: string) {
  for (const v of SECRETS) assert.equal(s.includes(v), false, `${v} leaked into: ${s}`);
}

// ── Q6 · the masks ─────────────────────────────────────────────────────────

test('D634: the mask keeps separators and, where it is asked to, the last characters', () => {
  assert.equal(maskValue(DOB), '••••-••-••');
  assert.equal(maskValue(ID, 2), '••••••67');
  assert.equal(maskValue(PHONE, 2), '+•• •••• ••••23');
  assert.equal(maskValue(EIN, 2), '••-•••••89');
  assert.equal(maskKycData(null), null);
  const m = maskKycData({ date_of_birth: DOB, phone: '', country: 'GB', nationality: 'GB' })!;
  assert.equal(m.masked.phone, null, 'an empty field is not recorded, not masked');
  assert.equal(m.masked.address, null);
  assert.equal(m.country, 'GB', 'country stays plain');
  assert.equal(maskPartnerProfile({ ein: '  ', extracted_data: 'not json' }).masked.ein, null);
  assert.equal(maskPartnerProfile({ ein: EIN, extracted_data: 'not json' }).extracted_data, 'not json');
});

test('D634: the KYC record leaves with every sensitive value masked', async () => {
  const db = freshDb();
  const r = await call(db, '/kyc/admin/2');
  assert.equal(r.status, 200, r.text);
  const d = r.body.kyc_data;
  for (const k of ['date_of_birth', 'id_number', 'phone', 'address_line1', 'address_line2', 'city', 'state_region', 'postal_code']) {
    assert.equal(k in d, false, `${k} left the server`);
  }
  assert.deepEqual(d.masked, {
    date_of_birth: '••••-••-••',
    id_number: '••••••67',
    address: '•• •••••• ••••, •••••, ••• •••',
    phone: '+•• •••• ••••23',
  });
  assert.equal(d.legal_first_name, 'Pat');
  assert.equal(d.nationality, 'GB');
  for (const v of [DOB, ID, PHONE, LINE1, CITY, POST]) assert.equal(r.text.includes(v), false, `${v} left the server`);
});

test('D634: "Show" returns one KYC value in clear and logs that showing, naming the field and the member only', async () => {
  const db = freshDb();
  const actor = await hashEmail('admin@axal.test');
  const cases: Array<[string, string]> = [
    ['date_of_birth', DOB], ['id_number', ID], ['phone', PHONE], ['address', `${LINE1}, ${CITY}, ${POST}`],
  ];
  for (const [field, value] of cases) {
    const r = await call(db, `/kyc/admin/2/sensitive/${field}`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.field, field);
    assert.equal(r.body.value, value);
    assert.equal(r.body.shown_by, 'Ada Admin');
    assert.ok(!Number.isNaN(Date.parse(r.body.shown_at)));
  }
  const rows = logs(db, 'kyc_field_shown');
  assert.deepEqual(rows.map((x) => x.details), cases.map(([f]) => `Admin showed ${f} on the KYC record for user_id=2`));
  for (const row of rows) {
    assert.equal(row.actor, actor);
    assert.equal(row.user_id, 1);
    noSecret(row.details);
  }
});

test('D634: a field not submitted, an unknown field and a missing member are refused in sentences and log nothing', async () => {
  const db = freshDb();
  const notRecorded = await call(db, '/kyc/admin/3/sensitive/phone');
  assert.equal(notRecorded.status, 404);
  assert.equal(notRecorded.body.error, 'field_not_recorded');
  assert.match(notRecorded.body.detail, /Nothing was shown\.$/);
  const unknown = await call(db, '/kyc/admin/2/sensitive/nationality');
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, 'unknown_field');
  const missing = await call(db, '/kyc/admin/99/sensitive/phone');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'user_not_found');
  assert.equal(logs(db, 'kyc_field_shown').length, 0);
});

test('D634: the partner profile leaves with the tax ID masked, in the column and in the extraction', async () => {
  const db = freshDb();
  const r = await call(db, `/profiling/admin/${encodeURIComponent(MEMBER_EMAIL)}`);
  assert.equal(r.status, 200, r.text);
  assert.equal('ein' in r.body, false);
  assert.equal(r.body.masked.ein, '••-•••••89');
  assert.deepEqual(JSON.parse(r.body.extracted_data), { legal_name: 'Secret LLC' });
  assert.equal(r.text.includes(EIN), false);

  const shown = await call(db, `/profiling/admin/${encodeURIComponent(MEMBER_EMAIL)}/sensitive/ein`);
  assert.equal(shown.status, 200, shown.text);
  assert.equal(shown.body.value, EIN);
  const [row] = logs(db, 'partner_field_shown');
  assert.equal(row.details, 'Admin showed ein on the partner profile for user_id=2');
  assert.equal(row.actor, await hashEmail('admin@axal.test'));
  noSecret(row.details);

  const none = await call(db, '/profiling/admin/noein%40secret.test/sensitive/ein');
  assert.equal(none.status, 404);
  assert.equal(none.body.error, 'field_not_recorded');
  const bad = await call(db, `/profiling/admin/${encodeURIComponent(MEMBER_EMAIL)}/sensitive/chat_history`);
  assert.equal(bad.status, 400);
  const gone = await call(db, '/profiling/admin/nobody%40secret.test/sensitive/ein');
  assert.equal(gone.status, 404);
  assert.equal(gone.body.error, 'profile_not_found');
  assert.equal(logs(db, 'partner_field_shown').length, 1, 'only the real showing is logged');
});

// ── Q5 · the dispute read ──────────────────────────────────────────────────

test('D634: the dispute read names both Stripe states and carries what the page draws', async () => {
  const db = freshDb();
  const unconfigured = await call(db, '/admin/billing/disputes/dp_1');
  assert.equal(unconfigured.status, 503);
  assert.equal(unconfigured.body.code, 'stripe_not_configured');

  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => { throw new Error('network down'); }) as any;
    const failed = await call(db, '/admin/billing/disputes/dp_1', { env: { STRIPE_SECRET_KEY: 'sk_test_x' } });
    assert.equal(failed.status, 502);
    assert.equal(failed.body.code, 'stripe_error');

    globalThis.fetch = (async () => new Response(JSON.stringify({
      id: 'dp_1', amount: 120000, currency: 'eur', status: 'needs_response', reason: 'fraudulent',
      charge: 'ch_1', payment_intent: 'pi_1', created: 1760000000,
      evidence_details: { due_by: 1760600000, has_evidence: true, submission_count: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as any;
    const ok = await call(db, '/admin/billing/disputes/dp_1', { env: { STRIPE_SECRET_KEY: 'sk_test_x' } });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(ok.body.dispute, {
      id: 'dp_1', amount: 120000, currency: 'eur', status: 'needs_response', reason: 'fraudulent',
      charge: 'ch_1', payment_intent: 'pi_1', created: 1760000000, due_by: 1760600000,
      has_evidence: true, submission_count: 2,
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});
