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
const MEMBER_EMAIL = 'member@secret.test';

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
  );
  CREATE TABLE partner_profiles (
    id INTEGER PRIMARY KEY, email TEXT NOT NULL, ein TEXT, transcript TEXT
  );`);
  const kycData = JSON.stringify({
    legal_first_name: 'Pat', legal_last_name: 'Secret', id_number: SECRET_ID, date_of_birth: '1990-01-02',
  });
  db.prepare(`INSERT INTO users (id, email, name, role, kyc_status, kyc_data) VALUES (1, 'admin@axal.test', 'Admin', 'admin', 'not_started', NULL)`).run();
  db.prepare(`INSERT INTO users (id, email, name, role, kyc_status, kyc_data, kyc_submitted_at) VALUES (2, ?, 'Pat Secret', 'founder', 'pending', ?, '2026-10-01')`).run(MEMBER_EMAIL, kycData);
  db.prepare(`INSERT INTO users (id, email, name, role, kyc_status, kyc_data, kyc_submitted_at) VALUES (3, 'other@secret.test', 'Other', 'investor', 'pending', ?, '2026-10-02')`).run(kycData);
  db.prepare(`INSERT INTO partner_profiles (id, email, ein, transcript) VALUES (1, ?, ?, 'transcript body SECRET')`).run(MEMBER_EMAIL, SECRET_EIN);
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
}

test('D612: a KYC record read is one log row, a missing member logs nothing, and the queue carries no identity', async () => {
  const db = freshDb();
  const actor = await hashEmail('admin@axal.test');
  const record = await call(db, 'GET', '/kyc/admin/2');
  assert.equal(record.status, 200);
  assert.equal(record.body.kyc_data.id_number, SECRET_ID);
  const recordLogs = logs(db);
  assert.equal(recordLogs.length, 1);
  assert.equal(recordLogs[0].action, 'kyc_record_access');
  assert.equal(recordLogs[0].actor, actor);
  assert.equal(recordLogs[0].user_id, 1);
  assert.match(recordLogs[0].details, /user_id=2/);
  noIdentity(recordLogs[0].details);

  const missing = await call(db, 'GET', '/kyc/admin/999');
  assert.equal(missing.status, 404);
  assert.equal(logs(db).length, 1);

  const queue = await call(db, 'GET', '/kyc/admin/queue?status=pending');
  assert.equal(queue.status, 200);
  assert.equal(queue.body.length, 2);
  for (const row of queue.body) {
    assert.equal(row.kyc_data, undefined);
    assert.equal(JSON.stringify(row).includes(SECRET_ID), false);
  }
  const queueLogs = logs(db).filter((r) => r.action === 'kyc_queue_access');
  assert.equal(queueLogs.length, 1);
  assert.equal(queueLogs[0].actor, actor);
  assert.match(queueLogs[0].details, /count=2/);
  noIdentity(queueLogs[0].details);
});

test('D612: a partner profile read is one log row, and a missing profile logs nothing', async () => {
  const db = freshDb();
  const actor = await hashEmail('admin@axal.test');
  const profile = await call(db, 'GET', `/profiling/admin/${encodeURIComponent(MEMBER_EMAIL)}`);
  assert.equal(profile.status, 200, profile.text);
  assert.equal(profile.body.ein, SECRET_EIN);
  const rows = logs(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'partner_profile_access');
  assert.equal(rows[0].actor, actor);
  assert.match(rows[0].details, /user_id=2/);
  noIdentity(rows[0].details);

  const missing = await call(db, 'GET', '/profiling/admin/nobody@secret.test');
  assert.equal(missing.status, 404);
  assert.equal(logs(db).length, 1);
});
