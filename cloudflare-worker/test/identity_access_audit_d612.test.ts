/**
 * D612 (#1312) — reading KYC records, queues, and partner profiles is audit-logged
 * with the actor hashed and no identity field values in details, and the KYC queue is trimmed.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/identity_access_audit_d612.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import kyc from '../src/routes/kyc.ts';
import profiling from '../src/routes/profiling.ts';
import { hashEmail } from '../src/util/hashEmail';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN_ID = 1;
const ADMIN_EMAIL = 'admin@example.com';
const MEMBER_ID = 42;
const MEMBER_EMAIL = 'partner@example.com';

function setupDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });

  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      uid TEXT,
      name TEXT,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER,
      kyc_status TEXT DEFAULT 'not_started',
      kyc_provider TEXT,
      kyc_submitted_at TIMESTAMP,
      kyc_reviewed_at TIMESTAMP,
      kyc_reviewed_by INTEGER,
      kyc_rejection_reason TEXT,
      kyc_data TEXT
    );
    CREATE TABLE partner_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      organization TEXT,
      ein TEXT,
      transcript TEXT,
      admin_status TEXT DEFAULT 'pending',
      agreement_type TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT,
      project_id INTEGER,
      user_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      actor TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.prepare(`INSERT INTO users (id, uid, name, email, role) VALUES (?, 'u-admin', 'Admin User', ?, 'admin')`).run(
    ADMIN_ID,
    ADMIN_EMAIL,
  );

  const kycPayload = JSON.stringify({
    legal_first_name: 'John',
    legal_last_name: 'Doe',
    date_of_birth: '1990-01-01',
    nationality: 'US',
    country: 'US',
    address_line1: '123 Main St',
    city: 'New York',
    phone: '+15555555555',
    id_type: 'passport',
    id_number: 'P12345678',
  });

  db.prepare(
    `INSERT INTO users (id, uid, name, email, role, kyc_status, kyc_provider, kyc_submitted_at, kyc_data)
     VALUES (?, 'u-member', 'John Doe', ?, 'user', 'pending', 'mock', datetime('now'), ?)`,
  ).run(MEMBER_ID, MEMBER_EMAIL, kycPayload);

  db.prepare(
    `INSERT INTO partner_profiles (id, email, organization, ein, transcript)
     VALUES (10, ?, 'Acme Corp', '12-3456789', 'Confidential interview transcript')`,
  ).run(MEMBER_EMAIL);

  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({
    JWT_SECRET,
    ENVIRONMENT: 'development',
    APP_URL: 'https://axal.vc',
    DB: d1Over(db),
  }) as any;

function createApp() {
  const app = new Hono();
  app.route('/api/kyc', kyc);
  app.route('/api/profiling', profiling);
  return app;
}

async function requestAsAdmin(app: Hono, db: InstanceType<typeof DatabaseSync>, path: string) {
  const jwt = await new SignJWT({ user_id: ADMIN_ID, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));

  const res = await app.request(
    path,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwt}` },
    },
    env(db),
  );

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, body: json };
}

test('KYC queue read trims kyc_data and logs kyc_queue_access with count and no identity values', async () => {
  const db = setupDb();
  const app = createApp();

  const res = await requestAsAdmin(app, db, '/api/kyc/admin/queue?status=pending');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);

  // Queue must be trimmed: no kyc_data field
  assert.equal(res.body[0].kyc_data, undefined, 'queue response must trim kyc_data');
  assert.equal(res.body[0].id, MEMBER_ID);
  assert.equal(res.body[0].email, MEMBER_EMAIL);

  // Activity logs must contain exactly 1 kyc_queue_access row
  const log = db.prepare(`SELECT * FROM activity_logs WHERE action = 'kyc_queue_access'`).get() as any;
  assert.ok(log, 'kyc_queue_access log must be written');
  assert.equal(log.user_id, ADMIN_ID);
  assert.equal(log.actor, await hashEmail(ADMIN_EMAIL));

  const details = JSON.parse(log.details);
  assert.equal(details.count, 1);
  assert.ok(!log.details.includes('John'), 'details must not leak personal names');
  assert.ok(!log.details.includes('123 Main St'), 'details must not leak address');
  assert.ok(!log.details.includes('P12345678'), 'details must not leak ID numbers');
});

test('KYC record read logs kyc_record_access with member_id and no identity values in details', async () => {
  const db = setupDb();
  const app = createApp();

  const res = await requestAsAdmin(app, db, `/api/kyc/admin/${MEMBER_ID}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.kyc_data, 'record endpoint returns full kyc_data for review modal');
  assert.equal(res.body.kyc_data.legal_first_name, 'John');

  const log = db.prepare(`SELECT * FROM activity_logs WHERE action = 'kyc_record_access'`).get() as any;
  assert.ok(log, 'kyc_record_access log must be written');
  assert.equal(log.user_id, ADMIN_ID);
  assert.equal(log.actor, await hashEmail(ADMIN_EMAIL));

  const details = JSON.parse(log.details);
  assert.equal(details.member_id, MEMBER_ID);
  assert.ok(!log.details.includes('John'), 'details must not contain personal names');
  assert.ok(!log.details.includes('1990-01-01'), 'details must not contain date of birth');
  assert.ok(!log.details.includes('123 Main St'), 'details must not contain addresses');
  assert.ok(!log.details.includes('P12345678'), 'details must not contain ID numbers');
});

test('KYC record 404 logs nothing in activity_logs', async () => {
  const db = setupDb();
  const app = createApp();

  const res = await requestAsAdmin(app, db, '/api/kyc/admin/99999');
  assert.equal(res.status, 404);

  const logs = db.prepare(`SELECT COUNT(*) as n FROM activity_logs WHERE action = 'kyc_record_access'`).get() as any;
  assert.equal(logs.n, 0, '404 must not record any audit entry');
});

test('Partner profile read logs partner_profile_access with member_id and no EIN/transcript in details', async () => {
  const db = setupDb();
  const app = createApp();

  const res = await requestAsAdmin(app, db, `/api/profiling/admin/${encodeURIComponent(MEMBER_EMAIL)}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.ein, '12-3456789');

  const log = db.prepare(`SELECT * FROM activity_logs WHERE action = 'partner_profile_access'`).get() as any;
  assert.ok(log, 'partner_profile_access log must be written');
  assert.equal(log.user_id, ADMIN_ID);
  assert.equal(log.actor, await hashEmail(ADMIN_EMAIL));

  const details = JSON.parse(log.details);
  assert.equal(details.member_id, MEMBER_ID);
  assert.ok(!log.details.includes('12-3456789'), 'details must not contain EIN');
  assert.ok(!log.details.includes('Confidential interview transcript'), 'details must not contain transcript');
});

test('Partner profile 404 logs nothing in activity_logs', async () => {
  const db = setupDb();
  const app = createApp();

  const res = await requestAsAdmin(app, db, '/api/profiling/admin/nonexistent@example.com');
  assert.equal(res.status, 404);

  const logs = db.prepare(`SELECT COUNT(*) as n FROM activity_logs WHERE action = 'partner_profile_access'`).get() as any;
  assert.equal(logs.n, 0, '404 must not record any audit entry');
});
