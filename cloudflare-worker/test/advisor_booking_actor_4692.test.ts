/**
 * #4692 (D4692) — every booking lifecycle change records WHO made it and when.
 *
 * `POST /api/advisors/bookings/:id/{confirm,complete,cancel,no-show}` all go
 * through one `transition` helper. The row it writes carries the outcome
 * (`status`, `cancelled_by`, `advisor_decision`) but named no account, so a
 * completed session — the one the advisor is paid on — and a cancel could not
 * be traced to a person, and an admin's cancel on someone else's booking
 * reached no audit store at all.
 *
 * WHAT IS PINNED
 *   · The advisor's own confirm, complete, no-show and cancel each write one
 *     `activity_logs` row: the acting user, the action, the booking, the slot,
 *     the advisor, and the statuses it moved between.
 *   · The client's cancel is recorded as the client.
 *   · An admin's cancel is the privileged one: it reaches `admin_audit_log`
 *     (HQ's governance feed) with the founder as its subject, and `activity_logs`.
 *   · A refused press records nothing — neither a transition the graph forbids
 *     nor one lost to a race leaves a line for an act that did not happen.
 *   · The cancel reason is free text the person typed and reaches neither store.
 *
 * Synthetic data only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor_booking_actor_4692.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import advisors from '../src/routes/advisors.ts';

const SQL = new URL('../sql', import.meta.url).pathname;
const mig = (n: string) => readFileSync(`${SQL}/migrations/${n}.sql`, 'utf8');
const SECRET = ['d4692', 'booking', 'actor', 'fixture', 'secret'].join('-');
const ADA = 70, FRAN = 72, ROOT = 74;
const HOUR = 3_600_000;
const at = (ms: number) => new Date(ms).toISOString();

const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, advisor_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
    jwt_min_iat INTEGER, name TEXT, email TEXT, subscription_tier TEXT DEFAULT 'studio', spinout_lab_active INTEGER DEFAULT 0);
  CREATE TABLE network_member_states (user_id INTEGER, paused_at TEXT);
  CREATE TABLE advisor_office_hour_slots (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
    advisor_id INTEGER NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, capacity INTEGER NOT NULL DEFAULT 1,
    meeting_url TEXT, notes TEXT, is_cancelled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE advisor_bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, slot_id INTEGER NOT NULL,
    advisor_id INTEGER NOT NULL, founder_user_id INTEGER NOT NULL, topic TEXT, notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending', cancel_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (slot_id, founder_user_id));
  CREATE TABLE advisor_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, booking_id INTEGER NOT NULL,
    reviewer_user_id INTEGER NOT NULL, reviewer_role TEXT NOT NULL, rating INTEGER NOT NULL, comment TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (booking_id, reviewer_role));
  CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, action TEXT, details TEXT,
    actor TEXT, user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE admin_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER NOT NULL, action TEXT NOT NULL,
    report_type TEXT, format TEXT, filters_json TEXT, storage_key TEXT, download_url TEXT,
    exported_at TEXT NOT NULL DEFAULT (datetime('now')), viewed_user_id INTEGER, conversation_id INTEGER, viewed_at TEXT);
` + ['201_advisors_table_in_ledger', '202_advisor_profile_fields', '203_advisor_services', '204_advisor_proof',
  '205_advisor_booking_amounts', '206_advisor_cohort_assignments', '241_advisor_money_model', '369_advisor_client_notes',
  '238_advisor_engagements', '239_advisor_deliverables', '202611062152_advisor_deliverable_recipients',
  '240_advisor_sessions_config', '218_advisor_client_grants', '394_advisor_practice',
  '202611071547_advisor_engagement_events', '202611082054_advisor_engagement_corrections',
  '202611071558_advisor_booking_decision', '202611082030_advisor_booking_offer'].map(mig).join('\n');

function fixture() {
  const { DB, db } = makeD1(SCHEMA);
  const hooks: { before: ((sql: string) => void) | null } = { before: null };
  const wrapped: any = new Proxy(DB, {
    get(target, prop, recv) {
      if (prop === 'prepare') return (sql: string) => { hooks.before?.(sql); return target.prepare(sql); };
      return Reflect.get(target, prop, recv);
    },
  });
  const u = db.prepare('INSERT INTO users (id, role, advisor_id, name, email) VALUES (?,?,?,?,?)');
  u.run(ADA, 'advisor', 1, 'Ada', 'ada@example.test');
  u.run(FRAN, 'founder', null, 'Fran', 'fran@example.test');
  u.run(ROOT, 'admin', null, 'Root', 'root@example.test');
  db.prepare("INSERT INTO advisors (id, uid, user_id, display_name, email) VALUES (1, 'adv-1', ?, 'Ada', 'ada@example.test')").run(ADA);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: wrapped };
  async function call(who: number, role: string, method: string, path: string, body?: unknown) {
    const token = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
      .setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await advisors.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env, { waitUntil() {}, passThroughOnException() {} } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  }
  const ada = (m: string, p: string, b?: unknown) => call(ADA, 'advisor', m, p, b);
  const fran = (m: string, p: string, b?: unknown) => call(FRAN, 'founder', m, p, b);
  const root = (m: string, p: string, b?: unknown) => call(ROOT, 'admin', m, p, b);
  const rows = (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
  /** Every `activity_logs` line this booking's lifecycle wrote, oldest first, with its details parsed. */
  const acts = () => rows("SELECT action, user_id, actor, details FROM activity_logs WHERE action LIKE 'advisor_booking_%' ORDER BY id")
    .map((r) => ({ ...r, details: JSON.parse(r.details) }));
  const audits = () => rows('SELECT admin_user_id, action, viewed_user_id, filters_json FROM admin_audit_log ORDER BY id');
  let n = 100;
  /** One bookable hour and one pending booking on it, held by Fran. */
  const booked = (status = 'pending') => {
    n += 1;
    const start = Date.now() + 3 * 24 * HOUR;
    db.prepare('INSERT INTO advisor_office_hour_slots (id, uid, advisor_id, starts_at, ends_at, capacity) VALUES (?,?,1,?,?,1)')
      .run(n, `slot-${n}`, at(start), at(start + HOUR));
    db.prepare('INSERT INTO advisor_bookings (id, uid, slot_id, advisor_id, founder_user_id, topic, status) VALUES (?,?,?,1,?,?,?)')
      .run(n, `bk-${n}`, n, FRAN, 'Synthetic session', status);
    return n;
  };
  return { db, env, hooks, ada, fran, root, rows, acts, audits, booked };
}

// 1 ───────────────────────────────────────────────────────────────────────────
test('each of the advisor\'s four lifecycle presses records the actor, the booking and the statuses it moved between', async () => {
  // Mutations checked: the logActorAct call removed; it recorded before the conditional UPDATE's changes check.
  for (const [press, from, to] of [
    ['confirm', 'pending', 'confirmed'],
    ['complete', 'confirmed', 'completed'],
    ['no-show', 'confirmed', 'no_show'],
    ['cancel', 'confirmed', 'cancelled'],
  ] as const) {
    const f = fixture();
    const id = f.booked(from);
    const res = await f.ada('POST', `/bookings/${id}/${press}`, press === 'cancel' ? { reason: 'Clashes with a board meeting' } : undefined);
    assert.equal(res.status, 200, press);
    const acts = f.acts();
    assert.equal(acts.length, 1, `${press} records exactly one line`);
    assert.equal(acts[0].action, `advisor_booking_${to}`, `${press} names what it did`);
    assert.equal(acts[0].user_id, ADA, `${press} names the account that pressed it`);
    assert.ok(acts[0].actor && acts[0].actor.length >= 16, 'the actor is the hashed email, not the address');
    assert.ok(!String(acts[0].actor).includes('@'), 'no address is stored');
    assert.equal(acts[0].details.booking_id, id);
    assert.equal(acts[0].details.slot_id, id);
    assert.equal(acts[0].details.advisor_id, 1);
    assert.equal(acts[0].details.from_status, from, `${press} records where it came from`);
    assert.equal(acts[0].details.to_status, to, `${press} records where it went`);
    assert.equal(acts[0].details.actor_role, 'advisor');
    assert.match(String(acts[0].details.at), /^\d{4}-\d{2}-\d{2}T/, `${press} records when`);
    // The time recorded is the one written to the row, so the act and the row agree.
    const row = f.rows('SELECT status, updated_at FROM advisor_bookings WHERE id = ?', id)[0];
    assert.equal(row.status, to);
    assert.equal(row.updated_at, acts[0].details.at, `${press}: the line's time is the row's time`);
    assert.deepEqual(f.audits(), [], 'the advisor\'s own press is not a privileged admin action');
  }
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('the cancel reason the person typed reaches neither audit store', async () => {
  // Mutations checked: opts.reason added to the recorded details.
  const f = fixture();
  const id = f.booked('confirmed');
  const secret = 'Fran disclosed their runway to me in confidence';
  assert.equal((await f.fran('POST', `/bookings/${id}/cancel`, { reason: secret })).status, 200);
  const acts = f.acts();
  assert.equal(acts.length, 1);
  // The reason IS kept on the booking — it is what the other side is told. It
  // is the audit line that must stay ids and states only.
  assert.equal(f.rows('SELECT cancel_reason FROM advisor_bookings WHERE id = ?', id)[0].cancel_reason, secret);
  assert.ok(!JSON.stringify(acts[0].details).includes('runway'), 'no free text in activity_logs');
  assert.ok(!JSON.stringify(f.audits()).includes('runway'), 'and none in admin_audit_log');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('the client\'s cancel is recorded as the client; an admin\'s reaches the governance feed with the founder as its subject', async () => {
  // Mutations checked: actor_role fixed to 'advisor'; the admin branch sending logActorAct instead of logAdminAction.
  const own = fixture();
  const mine = own.booked('confirmed');
  assert.equal((await own.fran('POST', `/bookings/${mine}/cancel`, { reason: 'Something came up' })).status, 200);
  const byClient = own.acts();
  assert.equal(byClient.length, 1);
  assert.equal(byClient[0].user_id, FRAN, 'the client\'s own account is named');
  assert.equal(byClient[0].details.actor_role, 'client');
  assert.equal(byClient[0].details.cancelled_by, 'client');
  assert.deepEqual(own.audits(), [], 'a member cancelling their own booking is not a privileged action');

  const f = fixture();
  const id = f.booked('confirmed');
  assert.equal((await f.root('POST', `/bookings/${id}/cancel`, { reason: 'Support request' })).status, 200);
  const acts = f.acts();
  assert.equal(acts.length, 1, 'the admin\'s press is in activity_logs too');
  assert.equal(acts[0].user_id, ROOT);
  assert.equal(acts[0].details.actor_role, 'admin');
  assert.equal(acts[0].details.cancelled_by, 'admin', 'and agrees with the row\'s own word for it');
  const audits = f.audits();
  assert.equal(audits.length, 1, 'an admin acting on someone else\'s booking reaches admin_audit_log');
  assert.equal(audits[0].admin_user_id, ROOT);
  assert.equal(audits[0].action, 'advisor_booking_cancelled');
  assert.equal(audits[0].viewed_user_id, FRAN, 'the governance feed names whose booking it was');
  assert.equal(JSON.parse(audits[0].filters_json).booking_id, id);
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('a refused press records nothing: neither a move the graph forbids nor one lost to a race', async () => {
  // Mutations checked: recording moved above the `changes === 0` check; recording moved above the allowed-status check.
  const f = fixture();

  // The graph refuses it: a completed session cannot be confirmed.
  const done = f.booked('completed');
  assert.equal((await f.ada('POST', `/bookings/${done}/confirm`)).status, 409);
  assert.deepEqual(f.acts(), [], 'a forbidden move leaves no line');

  // The race: the booking is cancelled between the status read and the UPDATE,
  // so the conditional write changes nothing and the press is a 409.
  const id = f.booked('confirmed');
  let raced = false;
  f.hooks.before = (sql) => {
    if (!raced && sql.startsWith('UPDATE advisor_bookings SET status')) {
      raced = true;
      f.db.exec(`UPDATE advisor_bookings SET status = 'cancelled' WHERE id = ${id}`);
    }
  };
  const late = await f.ada('POST', `/bookings/${id}/complete`);
  f.hooks.before = null;
  assert.equal(late.status, 409, 'the stale press is refused');
  assert.equal(f.rows('SELECT status FROM advisor_bookings WHERE id = ?', id)[0].status, 'cancelled', 'and changed nothing');
  assert.deepEqual(f.acts(), [], 'an act that did not happen is not recorded');
  assert.deepEqual(f.audits(), []);
});
