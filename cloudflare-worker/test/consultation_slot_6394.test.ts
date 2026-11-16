/** #6394: empty consultation slot input preserves the booking; invalid times cannot write a decision. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`INSERT INTO users (id, role, name, email, is_active) VALUES
    (1, 'admin', 'Admin', 'admin@example.test', 1),
    (2, 'investor', 'Investor', 'investor@example.test', 1),
    (3, 'advisor', 'Advisor', 'advisor@example.test', 1),
    (4, 'founder', 'Founder', 'founder@example.test', 1);
    INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at)
      VALUES (1, 'admin-totp', 'totp', 'totp', datetime('now'));`);
  return { db, env: { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any };
}
async function call(env: any, method: string, path: string, body?: unknown, userId = 1) {
  const token = await new SignJWT({ user_id: userId, ...(userId === 1 ? { jti: 'admin-totp' } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const response = await withThrownResponses(() => app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env, { waitUntil() {}, passThroughOnException() {} } as any));
  return { status: response.status, body: await response.json() as any };
}

import { adminConsultations } from '../src/routes/consultations.ts';
const app = new Hono<any>(); app.route('/api/admin/consultations', adminConsultations);
const SLOT = '2026-11-20T10:30:00Z';
function booking(db: DatabaseSync) {
  return (db.prepare("INSERT INTO admin_consultation_bookings (user_id, status, slot_at) VALUES (4, 'requested', ?) RETURNING id").get(SLOT) as any).id;
}
function stored(db: DatabaseSync, id: number) { return db.prepare('SELECT status, slot_at, version FROM admin_consultation_bookings WHERE id = ?').get(id) as any; }
const decision = (slot_at?: unknown) => ({ status: 'confirmed', expected_version: 1, ...(slot_at === undefined ? {} : { slot_at }) });

test('empty, whitespace, null and omitted slots preserve the booked time through a legal decision', async () => {
  const { db, env } = fixture();
  try {
    for (const slot of ['', '  \t\n ', null, undefined]) {
      const id = booking(db); const response = await call(env, 'POST', `/api/admin/consultations/${id}/status`, decision(slot));
      assert.equal(response.status, 200);
      assert.deepEqual([response.body.booking.slot_at, ...Object.values(stored(db, id))], [SLOT, 'confirmed', SLOT, 2]);
      const listed = (await call(env, 'GET', '/api/admin/consultations')).body.find((row: any) => row.id === id);
      assert.equal(listed.slot_at, SLOT);
      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM admin_consultation_booking_events WHERE booking_id = ?').get(id) as any).n, 1);
    }
  } finally { db.close(); }
});

test('invalid date-times return 400 without changing the booking, version or history', async () => {
  const { db, env } = fixture();
  try {
    for (const slot of ['not-a-time', '2026-11-20', '12', '2026-02-30T10:30:00Z', '2026-11-20T24:00:00Z', '2026-13-20T10:30:00Z', '2026-11-20T10:60:00Z', true, 123, {}]) {
      const id = booking(db); const response = await call(env, 'POST', `/api/admin/consultations/${id}/status`, decision(slot));
      assert.deepEqual([response.status, response.body.code], [400, 'invalid_slot_at'], String(slot));
      assert.deepEqual(Object.values(stored(db, id)), ['requested', SLOT, 1]);
      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM admin_consultation_booking_events WHERE booking_id = ?').get(id) as any).n, 0);
    }
  } finally { db.close(); }
});

test('valid local and offset date-times can replace a slot; whitespace is trimmed', async () => {
  const { db, env } = fixture();
  try {
    for (const slot of ['2028-02-29T09:15', '2026-11-20T09:15:30.123Z', '2026-11-20T09:15:00+02:00']) {
      const id = booking(db); const response = await call(env, 'POST', `/api/admin/consultations/${id}/status`, decision(`  ${slot}  `));
      assert.equal(response.status, 200); assert.equal(response.body.booking.slot_at, slot);
      assert.equal(stored(db, id).slot_at, slot);
    }
  } finally { db.close(); }
});
