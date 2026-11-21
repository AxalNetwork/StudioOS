/** #6393: refund counts include missing amounts without presenting them as zero-priced sessions. */
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
async function call(env: any, method: string, path: string, body?: unknown, userId = 3) {
  const token = await new SignJWT({ user_id: userId, ...(userId === 1 ? { jti: 'admin-totp' } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const response = await withThrownResponses(() => app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env, { waitUntil() {}, passThroughOnException() {} } as any));
  return { status: response.status, body: await response.json() as any };
}

import money from '../src/routes/advisors_money.ts';
const app = new Hono<any>(); app.route('/api/advisors', money);
function seed(db: DatabaseSync) {
  db.exec(`INSERT INTO advisors (id, uid, user_id, display_name, is_active) VALUES (1, 'adv-one', 3, 'Advisor', 1), (2, 'adv-other', 4, 'Other', 1);`);
  const slot = db.prepare("INSERT INTO advisor_office_hour_slots (id, uid, advisor_id, starts_at, ends_at) VALUES (?, ?, ?, '2026-11-20T10:00:00Z', '2026-11-20T11:00:00Z')");
  const booking = db.prepare("INSERT INTO advisor_bookings (id, uid, advisor_id, slot_id, founder_user_id, status, created_at) VALUES (?, ?, ?, ?, 4, 'cancelled', ?)");
  const refund = db.prepare("INSERT INTO advisory_refunds_due (booking_id, booking_uid, booking_status, amount_cents, resolved_at) VALUES (?, ?, 'cancelled', ?, ?)");
  for (const [id, amount, resolved, advisor, date] of [
    [1, 5000, null, 1, '2026-11-10T10:00:00Z'], [2, null, null, 1, '2026-11-10T10:00:00Z'],
    [3, 7000, '2026-11-11T10:00:00Z', 1, '2026-11-10T10:00:00Z'], [4, null, '2026-11-11T10:00:00Z', 1, '2026-11-10T10:00:00Z'],
    [5, 0, null, 1, '2026-11-10T10:00:00Z'], [6, 9000, null, 2, '2026-11-10T10:00:00Z'],
    [7, null, null, 1, '2025-01-01T10:00:00Z'],
  ] as const) { slot.run(id, `slot-${id}`, advisor); booking.run(id, `booking-${id}`, advisor, id, date); refund.run(id, `booking-${id}`, amount, resolved); }
}
const path = '/api/advisors/me/ledger?from=2026-11-01T00:00:00Z&until=2026-12-01T00:00:00Z';

test('owed and resolved refund counts include unpriced rows, retain zero and stay advisor/window scoped', async () => {
  const { db, env } = fixture();
  try {
    seed(db);
    const response = await call(env, 'GET', path);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.states.refunds_owed, { sessions: 3, amount_cents: 5000, unpriced_sessions: 1 });
    assert.deepEqual(response.body.states.refunded, { sessions: 2, amount_cents: 7000, unpriced_sessions: 1 });
    db.exec('UPDATE advisory_refunds_due SET amount_cents = NULL');
    const unpriced = (await call(env, 'GET', path)).body.states;
    assert.deepEqual(unpriced.refunds_owed, { sessions: 3, amount_cents: 0, unpriced_sessions: 3 });
    assert.deepEqual(unpriced.refunded, { sessions: 2, amount_cents: 0, unpriced_sessions: 2 });
  } finally { db.close(); }
});

test('an empty refund store is recorded zero, while an unreadable store remains unknown', async () => {
  const { db, env } = fixture();
  try {
    seed(db); db.exec('DELETE FROM advisory_refunds_due');
    const empty = (await call(env, 'GET', path)).body.states;
    assert.deepEqual(empty.refunds_owed, { sessions: 0, amount_cents: 0, unpriced_sessions: 0 });
    assert.deepEqual(empty.refunded, { sessions: 0, amount_cents: 0, unpriced_sessions: 0 });
    db.exec('DROP TABLE advisory_refunds_due');
    const unreadable = (await call(env, 'GET', path)).body.states;
    assert.equal(unreadable.refunds_owed, null); assert.equal(unreadable.refunded, null);
  } finally { db.close(); }
});
