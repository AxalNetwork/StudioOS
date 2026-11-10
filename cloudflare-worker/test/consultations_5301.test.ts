/** #5301 — Best-Fit consultation reads, transitions, concurrency and history. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { adminConsultations, CONSULTATION_TRANSITIONS } from '../src/routes/consultations.ts';
import { DECISION_LANES, decidedLog, decidedWeekly } from '../src/services/approvalDecisions.ts';
import { APPROVAL_SOURCES, approvalBoard } from '../src/services/approvalSources.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

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
      (${ADMIN_B}, 'totp-${ADMIN_B}', 'totp', 'totp', datetime('now'));
  `);
  return { db, binding: d1Over(db) };
}

const app = new Hono<any>();
app.route('/api/admin/consultations', adminConsultations);

async function call(binding: any, who: number, method: string, path = '', body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: 'admin', jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' })
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

test('a failed admin list is typed unreadable, never an empty queue', async () => {
  const { db, binding } = fixture(); booking(db);
  const failed = {
    ...binding,
    prepare(sql: string) {
      if (sql.includes('FROM admin_consultation_bookings b') && sql.includes('ORDER BY b.created_at DESC')) {
        return { bind() { return this; }, async all() { throw new Error('synthetic read failure'); } };
      }
      return binding.prepare(sql);
    },
  };
  const saved = console.error; console.error = () => {};
  try {
    const r = await call(failed, ADMIN_A, 'GET');
    assert.deepEqual([r.status, r.body.code], [503, 'consultations_unreadable']);
    assert.match(r.body.message, /not a claim that nobody is waiting/i);
    assert.ok(!Array.isArray(r.body));
    const source = APPROVAL_SOURCES.find((s) => s.key === 'best_fit')!;
    const boardFailure = { ...binding, prepare(sql: string) {
      if (sql === source.rowsSql) throw new Error('synthetic lane failure');
      return binding.prepare(sql);
    } };
    const board = await approvalBoard({ DB: boardFailure } as any, 25, Date.now(), [source]);
    assert.deepEqual(board.lanes, [{ key: 'best_fit', label: 'Best-Fit consultations', count: null }]);
    assert.deepEqual(board.unreadable, ['Best-Fit consultations']);
    assert.match(board.reason!, /no count rather than a zero/);
  } finally { console.error = saved; db.close(); }
});

test('every legal transition writes actor, time and version; every other transition is refused', async () => {
  const { db, binding } = fixture();
  const statuses = ['requested', 'confirmed', 'completed', 'cancelled'] as const;
  for (const from of statuses) for (const to of statuses) {
    const id = booking(db, from);
    const legal = CONSULTATION_TRANSITIONS[from].includes(to);
    const r = await call(binding, ADMIN_A, 'POST', `/${id}/status`, { status: to, expected_version: 1 });
    assert.equal(r.status, legal ? 200 : 409, `${from} -> ${to}`);
    const current = db.prepare('SELECT status, version FROM admin_consultation_bookings WHERE id = ?').get(id) as any;
    assert.deepEqual([current.status, current.version], legal ? [to, 2] : [from, 1], `${from} -> ${to}`);
    const events = db.prepare('SELECT from_status, to_status, version, actor_user_id, created_at FROM admin_consultation_booking_events WHERE booking_id = ?').all(id) as any[];
    assert.equal(events.length, legal ? 1 : 0, `${from} -> ${to} history`);
    if (legal) {
      assert.deepEqual([events[0].from_status, events[0].to_status, events[0].version, events[0].actor_user_id], [from, to, 2, ADMIN_A]);
      assert.match(events[0].created_at, /^\d{4}-\d{2}-\d{2} /);
    } else {
      assert.equal(r.body.code, 'illegal_transition');
    }
  }
  db.close();
});

test('two admins using one version cannot overwrite each other; the loser gets the current row', async () => {
  const { db, binding } = fixture();
  const id = booking(db);
  const pair = await Promise.all([
    call(binding, ADMIN_A, 'POST', `/${id}/status`, { status: 'confirmed', expected_version: 1 }),
    call(binding, ADMIN_B, 'POST', `/${id}/status`, { status: 'cancelled', expected_version: 1 }),
  ]);
  assert.deepEqual(pair.map((r) => r.status).sort(), [200, 409]);
  const winner = pair.find((r) => r.status === 200)!.body.booking;
  const loser = pair.find((r) => r.status === 409)!.body;
  assert.equal(loser.code, 'version_conflict');
  assert.deepEqual([loser.current.status, loser.current.version], [winner.status, 2]);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM admin_consultation_booking_events WHERE booking_id = ?').get(id) as any).n, 1);
  db.close();
});

test('expected_version is required and a stale version returns the current booking', async () => {
  const { db, binding } = fixture();
  const id = booking(db);
  assert.deepEqual([(await call(binding, ADMIN_A, 'POST', `/${id}/status`, { status: 'confirmed' })).status,
    (await call(binding, ADMIN_A, 'POST', `/${id}/status`, { status: 'confirmed' })).body.code], [400, 'expected_version_required']);
  await call(binding, ADMIN_A, 'POST', `/${id}/status`, { status: 'confirmed', expected_version: 1 });
  const stale = await call(binding, ADMIN_B, 'POST', `/${id}/status`, { status: 'cancelled', expected_version: 1 });
  assert.deepEqual([stale.status, stale.body.code, stale.body.current.version], [409, 'version_conflict', 2]);
  db.close();
});

test('Best-Fit history feeds Decided and weekly periods before history are Not recorded, never zero', async () => {
  const { db, binding } = fixture();
  const id = booking(db);
  await call(binding, ADMIN_A, 'POST', `/${id}/status`, { status: 'confirmed', expected_version: 1 });
  db.prepare("UPDATE admin_consultation_bookings SET requested_at = '2026-11-17 08:00:00' WHERE id = ?").run(id);
  db.prepare("UPDATE admin_consultation_booking_events SET created_at = '2026-11-17 09:00:00' WHERE booking_id = ?").run(id);
  const lane = DECISION_LANES.find((l) => l.key === 'best_fit')!;
  const log = await decidedLog({ DB: binding } as any, { lanes: [lane], page: 1 });
  assert.deepEqual([log.total, log.items[0].outcome_word, log.items[0].decided_by?.name], [1, 'Confirmed', 'Ada Admin']);
  const source = APPROVAL_SOURCES.find((s) => s.key === 'best_fit')!;
  const weekly = await decidedWeekly({ DB: binding } as any, { lanes: [lane], sources: [source], now: Date.parse('2026-11-18T12:00:00Z') });
  const series = weekly.lanes[0];
  assert.ok(series.decided.slice(0, -1).every((n) => n === null), 'pre-history weeks are Not recorded');
  assert.equal(series.decided.at(-1), 1);
  assert.ok(weekly.totals.decided.slice(0, -1).every((n) => n === null));
  assert.ok(weekly.not_recorded_periods.includes('Best-Fit consultations'));
  db.close();
});
