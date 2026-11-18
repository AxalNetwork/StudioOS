/**
 * #5885 — the Best-Fit board's Worker reads: one booking with its recorded
 * history (`GET /api/admin/consultations/:id`), the names the list now carries
 * (first triaged by, latest decision), and the lane's new home on Approvals.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { adminConsultations, CONSULTATION_HISTORY_SINCE } from '../src/routes/consultations.ts';
import { APPROVAL_LANES } from '../src/services/approvalLaneRegistry.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN_A = 1, ADMIN_B = 2, MEMBER = 3;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`
    INSERT INTO users (id, role, name, email, is_active) VALUES
      (${ADMIN_A}, 'admin', 'Ada Admin', 'ada@example.test', 1),
      (${ADMIN_B}, 'admin', 'Ben Admin', 'ben@example.test', 1),
      (${MEMBER}, 'founder', 'Mina Member', 'mina@example.test', 1);
    INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES
      (${ADMIN_A}, 'totp-${ADMIN_A}', 'totp', 'totp', datetime('now')),
      (${ADMIN_B}, 'totp-${ADMIN_B}', 'totp', 'totp', datetime('now')),
      (${MEMBER}, 'totp-${MEMBER}', 'totp', 'totp', datetime('now'));
  `);
  return { db, binding: d1Over(db) };
}

const app = new Hono<any>();
// The app's own mapping of an auth refusal to its status (index.ts onError).
app.onError((err: any, c: any) => {
  const status = AUTH_ERROR_STATUSES[String(err?.message)];
  return status ? c.json({ detail: err.message }, status) : c.json({ detail: 'error' }, 500);
});
app.route('/api/admin/consultations', adminConsultations);

async function call(binding: any, who: number, method: string, path = '', body?: unknown, role = 'admin') {
  const token = await new SignJWT({ user_id: who, role, jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => app.request(`/api/admin/consultations${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { DB: binding, JWT_SECRET, ENVIRONMENT: 'development' } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

function booking(db: DatabaseSync, status = 'requested') {
  const row = db.prepare(`INSERT INTO admin_consultation_bookings (user_id, status, topic)
    VALUES (?, ?, 'Fundraising fit') RETURNING id`).get(MEMBER, status) as any;
  return Number(row.id);
}

/** A binding whose reads matching `needle` throw. */
function failing(binding: any, needle: string) {
  return {
    ...binding,
    prepare(sql: string) {
      if (sql.includes(needle)) return { bind() { return this; }, async first() { throw new Error('synthetic'); }, async all() { throw new Error('synthetic'); } };
      return binding.prepare(sql);
    },
  };
}

const quiet = async <T>(fn: () => Promise<T>) => {
  const saved = console.error; console.error = () => {};
  try { return await fn(); } finally { console.error = saved; }
};

test('one booking reads with its history oldest first, each change with its actor and time', async () => {
  const { db, binding } = fixture();
  const id = booking(db);
  await call(binding, ADMIN_A, 'POST', `/${id}/status`, { status: 'confirmed', expected_version: 1, slot_at: '2026-11-20T10:00:00Z' });
  await call(binding, ADMIN_B, 'POST', `/${id}/status`, { status: 'completed', expected_version: 2 });
  const r = await call(binding, ADMIN_A, 'GET', `/${id}`);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.booking.status, r.body.booking.version, r.body.booking.user_name], ['completed', 3, 'Mina Member']);
  assert.equal(r.body.booking.admin_name, 'Ada Admin', 'first triaged by, as a name');
  assert.deepEqual([r.body.booking.decided_by_name, r.body.booking.decided_by_id], ['Ben Admin', ADMIN_B], 'the latest change');
  assert.equal(r.body.history.available, true);
  assert.equal(r.body.history.since, CONSULTATION_HISTORY_SINCE);
  assert.deepEqual(r.body.history.items.map((e: any) => [e.from_status, e.to_status, e.version, e.actor_name]),
    [['requested', 'confirmed', 2, 'Ada Admin'], ['confirmed', 'completed', 3, 'Ben Admin']]);
  for (const e of r.body.history.items) assert.match(e.created_at, /^\d{4}-\d{2}-\d{2} /);
  db.close();
});

test('a booking with no recorded change answers an empty history, not an invented one', async () => {
  const { db, binding } = fixture();
  const id = booking(db, 'cancelled'); // decided before the history table existed
  const r = await call(binding, ADMIN_A, 'GET', `/${id}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.history.items, []);
  assert.equal(r.body.history.available, true);
  assert.deepEqual([r.body.booking.decided_at, r.body.booking.decided_by_name, r.body.booking.admin_name], [null, null, null]);
  db.close();
});

test('a missing booking is 404, a bad id 400, and a failed read 503, never a 404', async () => {
  const { db, binding } = fixture();
  assert.deepEqual([(await call(binding, ADMIN_A, 'GET', '/999')).status, (await call(binding, ADMIN_A, 'GET', '/999')).body.code], [404, 'not_found']);
  assert.equal((await call(binding, ADMIN_A, 'GET', '/abc')).status, 400);
  assert.equal((await call(binding, ADMIN_A, 'GET', '/0')).status, 400);
  const id = booking(db);
  const broken = await quiet(() => call(failing(binding, 'WHERE b.id = ?'), ADMIN_A, 'GET', `/${id}`));
  assert.deepEqual([broken.status, broken.body.code], [503, 'consultation_unreadable']);
  db.close();
});

test('a failed history read keeps the booking and says the history was not read', async () => {
  const { db, binding } = fixture();
  const id = booking(db);
  const r = await quiet(() => call(failing(binding, 'WHERE e.booking_id = ? ORDER BY e.version ASC'), ADMIN_A, 'GET', `/${id}`));
  assert.equal(r.status, 200);
  assert.equal(r.body.booking.id, id);
  assert.equal(r.body.history.available, false);
  assert.ok(!('items' in r.body.history), 'no empty list stands in for an unread one');
  assert.match(r.body.history.reason, /could not be read/);
  db.close();
});

test('the item read has the list\'s gate: a non-admin is refused', async () => {
  const { db, binding } = fixture();
  const id = booking(db);
  const r = await call(binding, MEMBER, 'GET', `/${id}`, undefined, 'founder');
  assert.equal(r.status, 403);
  assert.ok(!r.body?.booking);
  db.close();
});

test('the list carries who first triaged each booking and its latest decision', async () => {
  const { db, binding } = fixture();
  const a = booking(db);
  const b = booking(db);
  await call(binding, ADMIN_B, 'POST', `/${a}/status`, { status: 'confirmed', expected_version: 1 });
  await call(binding, ADMIN_A, 'POST', `/${a}/status`, { status: 'cancelled', expected_version: 2 });
  const r = await call(binding, ADMIN_A, 'GET', '');
  assert.equal(r.status, 200);
  const byId = new Map(r.body.map((row: any) => [row.id, row]));
  assert.deepEqual([byId.get(a).admin_name, byId.get(a).decided_by_name, byId.get(a).status], ['Ben Admin', 'Ada Admin', 'cancelled']);
  assert.deepEqual([byId.get(b).admin_name, byId.get(b).decided_by_name, byId.get(b).decided_at], [null, null, null]);
  assert.equal(r.body.length, 2, 'the latest-event join adds no rows');
  db.close();
});

test('Best-Fit is decided on its Approvals board', () => {
  assert.equal(APPROVAL_LANES.best_fit.decidedOn, 'Approvals › Best-Fit consultations');
  assert.equal(APPROVAL_LANES.best_fit.decisionPath, '/admin/approvals/best-fit');
});
