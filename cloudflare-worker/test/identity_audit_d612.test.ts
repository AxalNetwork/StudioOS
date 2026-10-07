/**
 * D612 (#1312) — reading a KYC record, the KYC queue, or a partner profile
 * is audit-logged the way opening the ID document already is. Values stay
 * out of the log. A 404 writes nothing. The queue does not carry identity.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/identity_audit_d612.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import kyc from '../src/routes/kyc.ts';
import profiling from '../src/routes/profiling.ts';
import { hashEmail } from '../src/util/hashEmail.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SECRET_ID = 'SECRET-ID-999';
const SECRET_EIN = '12-3456789';
const SECRET_NATION = 'SECRET-NATION';
const SECRET_PHONE = 'SECRET-PHONE-555';
const SECRET_ADDRESS = 'SECRET-ADDRESS-1';
const SECRET_EXTRACT = 'SECRET-EXTRACT';
const MEMBER_EMAIL = 'member@secret.test';
const QUEUE_KEYS = ['email', 'id', 'kyc_provider', 'kyc_status', 'name', 'rejection_reason', 'reviewed_at', 'role', 'submitted_at'];

const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
function tableDdl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  if (at < 0) throw new Error(`${name} is missing from schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

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
    legal_first_name: 'Pat', legal_last_name: 'Secret', id_number: SECRET_ID, date_of_birth: '1990-01-02',
    nationality: SECRET_NATION, phone: SECRET_PHONE, address_line1: SECRET_ADDRESS,
  });
  db.prepare(`INSERT INTO users (id, email, name, role, kyc_status, kyc_data) VALUES (1, 'admin@axal.test', 'Admin', 'admin', 'not_started', NULL)`).run();
  db.prepare(`INSERT INTO users (id, email, name, role, kyc_status, kyc_data, kyc_submitted_at) VALUES (2, ?, 'Pat Secret', 'founder', 'pending', ?, '2026-10-01')`).run(MEMBER_EMAIL, kycData);
  db.prepare(`INSERT INTO users (id, email, name, role, kyc_status, kyc_data, kyc_submitted_at) VALUES (3, 'other@secret.test', 'Other', 'investor', 'pending', ?, '2026-10-02')`).run(kycData);
  db.prepare(`INSERT INTO partner_profiles (email, user_id, ein, chat_history, extracted_data, persona, legal_entity_name, admin_status)
    VALUES (?, 2, ?, 'transcript body SECRET', ?, 'Founder', 'Secret LLC', 'pending')`).run(MEMBER_EMAIL, SECRET_EIN, `{"note":"${SECRET_EXTRACT}"}`);
  return db;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/kyc', kyc as any);
  a.route('/api/profiling', profiling as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function call(db: DatabaseSync, method: string, path: string) {
  const tok = await new SignJWT({ user_id: 1, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://x/api${path}`, {
    method, headers: { Authorization: `Bearer ${tok}` },
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}

const logs = (db: DatabaseSync) => db.prepare('SELECT action, details, actor, user_id FROM activity_logs ORDER BY id').all() as any[];

function noIdentity(details: string) {
  assert.equal(details.includes(SECRET_ID), false, details);
  assert.equal(details.includes(SECRET_EIN), false, details);
  assert.equal(details.includes(MEMBER_EMAIL), false, details);
  assert.equal(details.includes('Pat Secret'), false, details);
  assert.equal(details.includes('transcript body'), false, details);
  assert.equal(details.includes(SECRET_NATION), false, details);
  assert.equal(details.includes(SECRET_PHONE), false, details);
  assert.equal(details.includes(SECRET_ADDRESS), false, details);
  assert.equal(details.includes(SECRET_EXTRACT), false, details);
}

test('D612: a KYC record read is one log row, a missing member logs nothing, and the queue carries no identity', async () => {
  const db = freshDb();
  const actor = await hashEmail('admin@axal.test');
  const record = await call(db, 'GET', '/kyc/admin/2');
  assert.equal(record.status, 200);
  // D634: the record leaves masked; the value is shown through its own logged route.
  assert.equal(record.body.kyc_data.id_number, undefined);
  assert.equal(record.body.kyc_data.masked.id_number, '••••••-••-•99');
  const recordLogs = logs(db);
  assert.equal(recordLogs.length, 1);
  assert.equal(recordLogs[0].action, 'kyc_record_access');
  assert.equal(recordLogs[0].actor, actor);
  assert.equal(recordLogs[0].user_id, 1);
  assert.equal(recordLogs[0].details, 'Admin read KYC record for user_id=2');
  noIdentity(recordLogs[0].details);

  const missing = await call(db, 'GET', '/kyc/admin/999');
  assert.equal(missing.status, 404);
  assert.equal(logs(db).length, 1);

  const queue = await call(db, 'GET', '/kyc/admin/queue?status=pending');
  assert.equal(queue.status, 200);
  assert.equal(queue.body.length, 2);
  for (const row of queue.body) {
    assert.deepEqual(Object.keys(row).sort(), QUEUE_KEYS);
    assert.equal(JSON.stringify(row).includes(SECRET_ID), false);
    assert.equal(JSON.stringify(row).includes(SECRET_NATION), false);
    assert.equal(JSON.stringify(row).includes(SECRET_PHONE), false);
    assert.equal(JSON.stringify(row).includes(SECRET_ADDRESS), false);
  }
  const queueLogs = logs(db).filter((r) => r.action === 'kyc_queue_access');
  assert.equal(queueLogs.length, 1);
  assert.equal(queueLogs[0].actor, actor);
  assert.equal(queueLogs[0].details, 'KYC queue read count=2');
  noIdentity(queueLogs[0].details);
});

test('D612: a partner profile read is one log row, and a missing profile logs nothing', async () => {
  const db = freshDb();
  const actor = await hashEmail('admin@axal.test');
  const profile = await call(db, 'GET', `/profiling/admin/${encodeURIComponent(MEMBER_EMAIL)}`);
  assert.equal(profile.status, 200, profile.text);
  assert.equal(profile.body.ein, undefined, 'D634: the tax ID leaves masked');
  assert.equal(profile.body.masked.ein, '••-•••••89');
  const rows = logs(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'partner_profile_access');
  assert.equal(rows[0].actor, actor);
  assert.equal(rows[0].details, 'Admin read partner profile for user_id=2');
  noIdentity(rows[0].details);

  const missing = await call(db, 'GET', '/profiling/admin/nobody@secret.test');
  assert.equal(missing.status, 404);
  assert.equal(logs(db).length, 1);
});

test('D625: a profile keeps the member it was written for when the address has moved', async () => {
  const db = freshDb();
  db.prepare(`UPDATE users SET email = 'moved@secret.test' WHERE id = 2`).run();
  db.prepare(`UPDATE users SET email = ? WHERE id = 3`).run(MEMBER_EMAIL);
  const profile = await call(db, 'GET', `/profiling/admin/${encodeURIComponent(MEMBER_EMAIL)}`);
  assert.equal(profile.status, 200, profile.text);
  assert.equal(profile.body.masked.ein, '••-•••••89');
  const rows = logs(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'partner_profile_access');
  assert.equal(rows[0].details, 'Admin read partner profile for user_id=2');
  noIdentity(rows[0].details);
});

test('D625: the profile list carries no identity and writes one counted log row', async () => {
  const db = freshDb();
  const actor = await hashEmail('admin@axal.test');
  const list = await call(db, 'GET', '/profiling/admin/list');
  assert.equal(list.status, 200, list.text);
  assert.equal(list.body.length, 1);
  assert.deepEqual(Object.keys(list.body[0]).sort(), [
    'admin_status', 'agreement_type', 'company_established', 'email', 'founder_track',
    'legal_entity_name', 'partnership_goal', 'persona', 'user_name',
  ]);
  assert.equal(list.body[0].email, MEMBER_EMAIL);
  assert.equal(list.body[0].persona, 'Founder');
  assert.equal(list.body[0].legal_entity_name, 'Secret LLC');
  const packed = JSON.stringify(list.body);
  assert.equal(packed.includes(SECRET_EIN), false);
  assert.equal(packed.includes('transcript body'), false);
  assert.equal(packed.includes(SECRET_EXTRACT), false);
  const listed = logs(db).filter((r) => r.action === 'partner_profile_list_access');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].details, 'Partner profile list read count=1');
  assert.equal(listed[0].actor, actor);
  assert.equal(listed[0].user_id, 1);
  noIdentity(listed[0].details);

  db.prepare('DELETE FROM partner_profiles').run();
  const empty = await call(db, 'GET', '/profiling/admin/list');
  assert.equal(empty.status, 200, empty.text);
  assert.equal(empty.body.length, 0);
  const again = logs(db).filter((r) => r.action === 'partner_profile_list_access');
  assert.equal(again.length, 2);
  assert.equal(again[1].details, 'Partner profile list read count=0');
  noIdentity(again[1].details);
});
