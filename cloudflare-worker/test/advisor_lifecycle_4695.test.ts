/**
 * D4695 (#4695) — /practice scheduling and lifecycle rules are decided on the
 * server, at the write, and are safe under races and retries. Synthetic data.
 *
 *   booking      POST /api/advisors/slots/:id/book   (a booking link and a direct slot both come through it)
 *   slots        POST /me/slots, POST /me/slots/block, GET /:uid/slots
 *   engagements  POST /me/engagements/:id/advance, /renewal, GET /:id/events
 *
 * WHAT IS PINNED
 *   · A blocked slot is not listed and cannot be booked by link or by slot; a block, a cancel or a competing booking
 *     that lands between the checks and the write still wins (the INSERT decides).
 *   · A 24 h notice rule refuses a paid booking starting in 1 h; a zero weekly paid cap refuses a paid booking;
 *     blackouts and the week are read in the advisor's timezone; a buffer keeps sessions apart.
 *   · A capacity-1 slot has exactly one winner; the loser leaves no row and can book once a seat frees; a client who
 *     cancelled can book the slot again.
 *   · A stale confirm cannot overwrite a cancel.
 *     (The route's early "blocked" answer is an equivalent mutant: the INSERT's own guard returns the same 409, so
 *     only the INSERT guard and the service are pinned separately.)
 *   · An engagement moves only along the state graph; a stale lane is a 409; a signed one never returns to an
 *     unsigned lane; ending never leaves an 'active' outcome.
 *   · A renewal names the term it decides; the same command twice is one cycle, with its history kept as events.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor_lifecycle_4695.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import advisors from '../src/routes/advisors.ts';
import {
  blackoutHit, canonicalInstant, isBlocked, isPaidType, ruleRefusal, rulesFromRow, wallClock, weekBounds,
} from '../src/services/advisorBookingRules.ts';

const SQL = new URL('../sql', import.meta.url).pathname;
const mig = (n: string) => readFileSync(`${SQL}/migrations/${n}.sql`, 'utf8');
const SECRET = ['d4695', 'lifecycle', 'fixture', 'signing', 'secret'].join('-');
const ADA = 70, FRAN = 72, GUS = 73, ROOT = 74;

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
  CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
` + ['201_advisors_table_in_ledger', '202_advisor_profile_fields', '203_advisor_services', '204_advisor_proof',
  '205_advisor_booking_amounts', '206_advisor_cohort_assignments', '241_advisor_money_model', '369_advisor_client_notes',
  '238_advisor_engagements', '239_advisor_deliverables', '202611062152_advisor_deliverable_recipients',
  '240_advisor_sessions_config', '218_advisor_client_grants', '394_advisor_practice', '202611071547_advisor_engagement_events', '202611082054_advisor_engagement_corrections',
  // #4702: the advisor's recorded answer and who cancelled, written by every booking transition.
  '202611071558_advisor_booking_decision'].map(mig).join('\n');

const DAY = 86_400_000;
const HOUR = 3_600_000;
const at = (ms: number) => new Date(ms).toISOString();

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
  u.run(GUS, 'founder', null, 'Gus', 'gus@example.test');
  u.run(ROOT, 'admin', null, 'Root', 'root@example.test');
  db.prepare("INSERT INTO advisors (id, uid, user_id, display_name, email) VALUES (1, 'adv-1', ?, 'Ada', 'ada@example.test')").run(ADA);
  db.prepare(`INSERT INTO advisor_session_types (id, uid, advisor_id, name, duration_minutes, price_cents, is_included, is_free_intro)
    VALUES (1, 'type-paid', 1, 'Paid session', 60, 20000, 0, 0), (2, 'type-included', 1, 'Included session', 60, 0, 1, 0)`).run();
  db.prepare("INSERT INTO advisor_booking_links (id, uid, advisor_id, slug, session_type_id) VALUES (1, 'link-paid', 1, 'ada/paid', 1)").run();
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: wrapped };
  async function call(who: number, role: string, method: string, path: string, body?: unknown) {
    const token = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const res = await advisors.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env, { waitUntil() {}, passThroughOnException() {} } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  }
  const ada = (m: string, p: string, b?: unknown) => call(ADA, 'advisor', m, p, b);
  const fran = (m: string, p: string, b?: unknown) => call(FRAN, 'founder', m, p, b);
  const gus = (m: string, p: string, b?: unknown) => call(GUS, 'founder', m, p, b);
  const row = (sql: string, ...a: unknown[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  const rows = (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
  let n = 100;
  const slot = (startMs: number, o: { hours?: number; capacity?: number; blocked?: string | null } = {}) => {
    n += 1;
    db.prepare('INSERT INTO advisor_office_hour_slots (id, uid, advisor_id, starts_at, ends_at, capacity, blocked_reason) VALUES (?,?,1,?,?,?,?)')
      .run(n, `slot-${n}`, at(startMs), at(startMs + (o.hours ?? 1) * HOUR), o.capacity ?? 1, o.blocked ?? null);
    return n;
  };
  const rules = (o: Record<string, unknown>) => db.prepare(
    `INSERT OR REPLACE INTO advisor_availability_rules (advisor_id, weekly_paid_cap, buffer_minutes, min_notice_hours, blackouts_json, timezone)
     VALUES (1, ?, ?, ?, ?, ?)`).run(o.cap ?? null, o.buffer ?? null, o.notice ?? null, JSON.stringify(o.blackouts ?? []), (o.tz as string) ?? null);
  const bookings = (slotId: number) => rows('SELECT founder_user_id, status, cancel_reason FROM advisor_bookings WHERE slot_id = ? ORDER BY id', slotId);
  return { db, env, hooks, ada, fran, gus, row, rows, slot, rules, bookings, call };
}

const book = (f: ReturnType<typeof fixture>, slotId: number, o: Record<string, unknown> = {}, who: 'fran' | 'gus' = 'fran') =>
  f[who]('POST', `/slots/${slotId}/book`, { session_type_id: 1, ...o });
const NOW = () => Date.now();

// 1 ───────────────────────────────────────────────────────────────────────────
test('a blocked slot is not listed and cannot be booked by slot or by link; a block that lands after the checks still wins', async () => {
  // Mutations checked: the blocked check removed from /slots/:id/book; the list not filtered; the INSERT's slot guard removed.
  const f = fixture();
  const s1 = f.slot(NOW() + 3 * DAY);
  const s2 = f.slot(NOW() + 4 * DAY);
  const blocked = await f.ada('POST', '/me/slots/block', { from: at(NOW() + 2 * DAY), until: at(NOW() + 3.5 * DAY), reason: 'Away' });
  assert.deepEqual([blocked.body.blocked, blocked.body.skipped_booked], [1, 0]);
  const listed = await f.fran('GET', '/adv-1/slots');
  assert.deepEqual(listed.body.items.map((s: any) => s.id), [s2], 'the blocked slot is not offered');
  for (const extra of [{}, { booking_link_slug: 'ada/paid' }]) {
    const r = await book(f, s1, extra);
    assert.deepEqual([r.status, r.body.code], [409, 'slot_blocked'], JSON.stringify(extra));
  }
  assert.equal((await book(f, s1, { session_type_id: undefined })).status, 409, 'with no type either');
  assert.deepEqual(f.bookings(s1), []);

  // The block lands between the route's reads and its INSERT.
  let raced = false;
  f.hooks.before = (sql) => { if (!raced && sql.startsWith('INSERT INTO advisor_bookings')) { raced = true; f.db.exec(`UPDATE advisor_office_hour_slots SET blocked_reason = 'Away' WHERE id = ${s2}`); } };
  const late = await book(f, s2);
  f.hooks.before = null;
  assert.deepEqual([late.status, late.body.code], [409, 'slot_blocked']);
  assert.deepEqual(f.bookings(s2), [], 'no booking was made');

  // A cancel that lands there is a 404, also with no booking.
  const s3 = f.slot(NOW() + 5 * DAY);
  raced = false;
  f.hooks.before = (sql) => { if (!raced && sql.startsWith('INSERT INTO advisor_bookings')) { raced = true; f.db.exec(`UPDATE advisor_office_hour_slots SET is_cancelled = 1 WHERE id = ${s3}`); } };
  assert.equal((await book(f, s3)).status, 404);
  f.hooks.before = null;
  assert.deepEqual(f.bookings(s3), []);
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('blocking never takes a seat someone holds: the UPDATE itself refuses a slot with a booking', async () => {
  // Mutations checked: the NOT EXISTS removed from the block UPDATE (a count read first, then an unconditional write).
  const f = fixture();
  const s = f.slot(NOW() + 3 * DAY);
  let raced = false;
  f.hooks.before = (sql) => {
    if (!raced && sql.startsWith('UPDATE advisor_office_hour_slots SET blocked_reason')) {
      raced = true;
      f.db.prepare("INSERT INTO advisor_bookings (uid, slot_id, advisor_id, founder_user_id, status) VALUES ('late-1', ?, 1, ?, 'pending')").run(s, FRAN);
    }
  };
  const r = await f.ada('POST', '/me/slots/block', { from: at(NOW() + 2 * DAY), until: at(NOW() + 4 * DAY) });
  f.hooks.before = null;
  assert.deepEqual([r.body.blocked, r.body.skipped_booked], [0, 1]);
  assert.equal(f.row('SELECT blocked_reason FROM advisor_office_hour_slots WHERE id = ?', s).blocked_reason, null);
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('minimum notice and the weekly paid cap: a 24 h rule refuses a paid booking in 1 h; a zero cap refuses any paid booking', async () => {
  // Mutations checked: min notice not compared; cap 0 read as no cap; the cap compared with > instead of >=; free sessions counted as paid.
  const f = fixture();
  f.rules({ notice: 24 });
  const soon = f.slot(NOW() + HOUR);
  const later = f.slot(NOW() + 2 * DAY);
  const tooSoon = await book(f, soon);
  assert.deepEqual([tooSoon.status, tooSoon.body.code], [409, 'min_notice']);
  assert.equal((await book(f, later)).status, 200);

  const g = fixture();
  g.rules({ cap: 0 });
  const s = g.slot(NOW() + 3 * DAY);
  const t = g.slot(NOW() + 3 * DAY + 2 * HOUR);
  const paid = await book(g, s);
  assert.deepEqual([paid.status, paid.body.code], [409, 'weekly_cap'], 'a cap of 0 accepts no paid session');
  assert.equal((await book(g, t, { session_type_id: 2 })).status, 200, 'an included session is not paid');
  const none = fixture();
  none.rules({});
  assert.equal((await book(none, none.slot(NOW() + 3 * DAY))).status, 200, 'no cap set is no limit');

  // A cap of 1: the first paid session fits, the second in that week does not; the next week is open.
  const h = fixture();
  h.rules({ cap: 1, tz: 'UTC' });
  const monday = (() => { const d = new Date(Date.UTC(2037, 5, 1, 9)); return d.getTime(); })();
  const a = h.slot(monday), b = h.slot(monday + 2 * DAY), c2 = h.slot(monday + 8 * DAY);
  assert.equal((await book(h, a)).status, 200);
  assert.equal((await book(h, b, {}, 'gus')).body.code, 'weekly_cap');
  assert.equal((await book(h, c2, {}, 'gus')).status, 200);

  // A competing paid booking lands between the cap read and the INSERT: the INSERT's own count decides.
  const r = fixture();
  r.rules({ cap: 1, tz: 'UTC' });
  const x = r.slot(monday), y = r.slot(monday + DAY);
  let raced = false;
  r.hooks.before = (sql) => {
    if (!raced && sql.startsWith('INSERT INTO advisor_bookings')) {
      raced = true;
      r.db.prepare("INSERT INTO advisor_bookings (uid, slot_id, advisor_id, founder_user_id, status, session_type_id) VALUES ('rival', ?, 1, ?, 'pending', 1)").run(y, GUS);
    }
  };
  const lost = await book(r, x);
  r.hooks.before = null;
  assert.deepEqual([lost.status, lost.body.code], [409, 'weekly_cap']);
  assert.deepEqual(r.bookings(x), [], 'the cap held under the race');
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('blackouts and the week are read in the advisor\'s timezone, not UTC', async () => {
  // Mutations checked: wallClock reading UTC; the week starting at UTC Monday; the blackout compared as UTC times.
  const f = fixture();
  f.rules({ tz: 'America/New_York', blackouts: [{ day: 'fri', from: '12:00', to: '18:00' }] });
  // Friday 2037-06-05 17:00Z is 13:00 in New York (UTC-4): inside the blackout. 23:00Z is 19:00: outside it.
  const inside = f.slot(Date.UTC(2037, 5, 5, 17));
  const outside = f.slot(Date.UTC(2037, 5, 5, 23));
  assert.equal((await book(f, inside)).body.code, 'blackout');
  assert.equal((await book(f, outside)).status, 200);

  // Sunday 22:00 in New York is Monday 02:00 UTC. It belongs to the week that is ending there.
  const w = fixture();
  w.rules({ cap: 1, tz: 'America/New_York' });
  const mon = Date.UTC(2037, 5, 1, 14);              // Monday 10:00 NY
  const sundayNight = Date.UTC(2037, 5, 8, 2);       // Sunday 22:00 NY (Monday 02:00 UTC), the next week's Monday UTC
  const first = w.slot(mon), second = w.slot(sundayNight);
  assert.equal((await book(w, first)).status, 200);
  const r = await book(w, second, {}, 'gus');
  assert.deepEqual([r.status, r.body.code], [409, 'weekly_cap'], 'same New York week as Monday morning, though UTC calls it the next week');
  // The same booking is allowed once the advisor's week is UTC.
  const u = fixture();
  u.rules({ cap: 1, tz: 'UTC' });
  assert.equal((await book(u, u.slot(mon))).status, 200);
  assert.equal((await book(u, u.slot(sundayNight), {}, 'gus')).status, 200);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('a buffer keeps booked sessions apart; the gap may equal the buffer', async () => {
  // Mutations checked: the buffer ignored; the comparison made inclusive.
  const f = fixture();
  f.rules({ buffer: 30, tz: 'UTC' });
  const base = Date.UTC(2037, 5, 2, 10);
  const first = f.slot(base);
  assert.equal((await book(f, first)).status, 200);
  const close = f.slot(base + HOUR + 15 * 60_000);
  const exact = f.slot(base + HOUR + 30 * 60_000);
  const r = await book(f, close, {}, 'gus');
  assert.deepEqual([r.status, r.body.code], [409, 'buffer']);
  assert.equal((await book(f, exact, {}, 'gus')).status, 200);
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('a capacity-1 slot has one durable winner; the loser leaves no row and can book when a seat frees; a cancelled client can book again', async () => {
  // Mutations checked: capacity checked only before the INSERT; the cancelled-row takeover removed; the capacity subquery removed.
  const f = fixture();
  const s = f.slot(NOW() + 3 * DAY);
  assert.equal((await book(f, s)).status, 200);
  const full = await book(f, s, {}, 'gus');
  assert.deepEqual([full.status, full.body.detail], [409, 'Slot full']);
  assert.deepEqual(f.bookings(s).map((b) => b.founder_user_id), [FRAN], 'the loser left nothing behind');

  // The race: a rival takes the last seat between the read and the INSERT.
  const t = f.slot(NOW() + 4 * DAY);
  let raced = false;
  f.hooks.before = (sql) => {
    if (!raced && sql.startsWith('INSERT INTO advisor_bookings')) {
      raced = true;
      f.db.prepare("INSERT INTO advisor_bookings (uid, slot_id, advisor_id, founder_user_id, status) VALUES ('rival', ?, 1, ?, 'pending')").run(t, FRAN);
    }
  };
  const lost = await book(f, t, {}, 'gus');
  f.hooks.before = null;
  assert.deepEqual([lost.status, lost.body.detail], [409, 'Slot full']);
  assert.deepEqual(f.bookings(t).map((b) => b.founder_user_id), [FRAN], 'exactly one winner, no stranded row for the loser');
  f.db.exec(`UPDATE advisor_bookings SET status = 'cancelled' WHERE slot_id = ${t}`);
  const retry = await book(f, t, {}, 'gus');
  assert.equal(retry.status, 200, 'the loser can book once a seat frees');

  // A client who cancelled books the slot again: the cancelled row is taken over, not left to block the UNIQUE index.
  const mine = f.row('SELECT id FROM advisor_bookings WHERE slot_id = ? AND founder_user_id = ?', s, FRAN);
  assert.equal((await f.fran('POST', `/bookings/${mine.id}/cancel`, { reason: 'Clash' })).status, 200);
  const again = await book(f, s);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.deepEqual(f.row('SELECT id, status, cancel_reason FROM advisor_bookings WHERE slot_id = ? AND founder_user_id = ?', s, FRAN),
    { id: mine.id, status: 'pending', cancel_reason: null });
  assert.deepEqual([(await book(f, s)).status, (await book(f, s)).body.detail], [409, 'Already booked this slot']);
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('a stale confirmation cannot overwrite a cancellation, even when the cancel lands between the read and the write', async () => {
  // Mutations checked: `AND status = ?` removed from the transition UPDATE.
  const f = fixture();
  const s = f.slot(NOW() + 3 * DAY);
  const made = await book(f, s);
  const id = made.body.id;
  assert.equal((await f.fran('POST', `/bookings/${id}/cancel`, { reason: 'Clash' })).status, 200);
  const stale = await f.ada('POST', `/bookings/${id}/confirm`);
  assert.equal(stale.status, 409);
  assert.equal(f.row('SELECT status FROM advisor_bookings WHERE id = ?', id).status, 'cancelled');

  const g = fixture();
  const s2 = g.slot(NOW() + 3 * DAY);
  const id2 = (await book(g, s2)).body.id;
  let raced = false;
  g.hooks.before = (sql) => { if (!raced && sql.startsWith('UPDATE advisor_bookings SET status')) { raced = true; g.db.exec(`UPDATE advisor_bookings SET status = 'cancelled' WHERE id = ${id2}`); } };
  const r = await g.ada('POST', `/bookings/${id2}/confirm`);
  g.hooks.before = null;
  assert.equal(r.status, 409);
  assert.equal(g.row('SELECT status FROM advisor_bookings WHERE id = ?', id2).status, 'cancelled', 'the cancel stands');
});

// 8 ───────────────────────────────────────────────────────────────────────────
test('a slot is stored as the UTC instant it names; a string that is not a date is refused', async () => {
  // Mutations checked: canonicalInstant not applied; the date check removed.
  const f = fixture();
  const ok = await f.ada('POST', '/me/slots', { starts_at: '2037-06-02T10:00:00+02:00', ends_at: '2037-06-02T11:00:00+02:00' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.starts_at, '2037-06-02T08:00:00.000Z');
  for (const bad of [{ starts_at: 'tomorrow', ends_at: '2037-06-02T11:00:00Z' }, { starts_at: '2037-06-02T10:00:00Z', ends_at: 'later' }]) {
    assert.equal((await f.ada('POST', '/me/slots', bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await f.ada('POST', '/me/slots', { starts_at: '2037-06-02T11:00:00Z', ends_at: '2037-06-02T10:00:00Z' })).status, 400);
  assert.equal(f.rows('SELECT id FROM advisor_office_hour_slots').length, 1);
});

// 9 ───────────────────────────────────────────────────────────────────────────
const sign = async (f: ReturnType<typeof fixture>, name = 'Acme') => {
  const made = await f.ada('POST', '/me/engagements', { client_name: name });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const signed = await f.ada('POST', `/me/engagements/${made.body.id}/advance`, { lane: 'signed' });
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  return signed.body;
};

test('an engagement moves only along the state graph; a stale lane is a 409; the same advance twice is one change', async () => {
  // Mutations checked: the graph check removed; expected_lane ignored; the UPDATE not conditional on the lane; a same-lane advance refused.
  const f = fixture();
  const e = await sign(f);
  const back = await f.ada('POST', `/me/engagements/${e.id}/advance`, { lane: 'drafting' });
  assert.deepEqual([back.status, back.body.code], [409, 'lane_not_allowed'], 'a signed engagement never returns to an unsigned lane');
  assert.equal((await f.ada('POST', `/me/engagements/${e.id}/advance`, { lane: 'proposed' })).status, 409);
  const draft = (await f.ada('POST', '/me/engagements', { client_name: 'Draft Co' })).body;
  assert.equal((await f.ada('POST', `/me/engagements/${draft.id}/advance`, { lane: 'renewal_due' })).body.code, 'lane_not_allowed');
  const proposed = await f.ada('POST', `/me/engagements/${draft.id}/advance`, { lane: 'proposed' });
  assert.equal(proposed.body.lane, 'proposed');
  const replay = await f.ada('POST', `/me/engagements/${draft.id}/advance`, { lane: 'proposed' });
  assert.deepEqual([replay.status, replay.body.lane], [200, 'proposed'], 'a retry finds the lane already there');
  const stale = await f.ada('POST', `/me/engagements/${draft.id}/advance`, { lane: 'signed', expected_lane: 'drafting' });
  assert.deepEqual([stale.status, stale.body.code, stale.body.current_lane], [409, 'lane_changed', 'proposed']);

  // The lane moves between the route's read and its UPDATE: the UPDATE changes no row.
  let raced = false;
  f.hooks.before = (sql) => { if (!raced && sql.startsWith('UPDATE advisor_engagements')) { raced = true; f.db.exec(`UPDATE advisor_engagements SET lane = 'ended', ended_at = '2037-01-01' WHERE id = ${draft.id}`); } };
  const lost = await f.ada('POST', `/me/engagements/${draft.id}/advance`, { lane: 'signed' });
  f.hooks.before = null;
  assert.deepEqual([lost.status, lost.body.code], [409, 'lane_changed']);
  assert.equal(f.row('SELECT lane, cycles FROM advisor_engagements WHERE id = ?', draft.id).lane, 'ended', 'the racing change stands');
  assert.equal(f.row('SELECT cycles FROM advisor_engagements WHERE id = ?', draft.id).cycles, 0);
});

// 10 ──────────────────────────────────────────────────────────────────────────
test('no path leaves an ended engagement with an active outcome', async () => {
  // Mutations checked: the lane graph removed; the outcome rewrite on ending removed.
  const f = fixture();
  const e = await sign(f);
  assert.equal(e.outcome, 'active');
  assert.equal((await f.ada('POST', `/me/engagements/${e.id}/advance`, { lane: 'drafting' })).status, 409);
  assert.equal((await f.ada('POST', `/me/engagements/${e.id}/advance`, { lane: 'ended' })).status, 409, 'a signed engagement ends only through a decision');
  // A row that already carries an outcome while unsigned (written before the graph existed) does not end as 'active'.
  const legacy = (await f.ada('POST', '/me/engagements', { client_name: 'Legacy' })).body;
  f.db.exec(`UPDATE advisor_engagements SET outcome = 'active', cycles = 1 WHERE id = ${legacy.id}`);
  const ended = await f.ada('POST', `/me/engagements/${legacy.id}/advance`, { lane: 'ended' });
  assert.deepEqual([ended.body.lane, ended.body.outcome], ['ended', 'ended']);
  assert.deepEqual(f.rows("SELECT id FROM advisor_engagements WHERE lane = 'ended' AND outcome = 'active'"), []);
  const decided = await f.ada('POST', `/me/engagements/${e.id}/renewal`, { decision: 'ended', expected_cycles: 1 });
  assert.deepEqual([decided.body.lane, decided.body.outcome], ['ended', 'ended']);
});

// 11 ──────────────────────────────────────────────────────────────────────────
test('a renewal names the term it decides; the same command twice is one cycle and one event', async () => {
  // Mutations checked: expected_cycles not required; cycles incremented without the term guard; the events insert removed; the replay path removed.
  const f = fixture();
  const e = await sign(f);
  const url = `/me/engagements/${e.id}/renewal`;
  const noTerm = await f.ada('POST', url, { decision: 'renewed' });
  assert.deepEqual([noTerm.status, noTerm.body.code], [400, 'expected_cycles_required']);
  assert.equal((await f.ada('POST', url, { decision: 'renewed', expected_cycles: 0 })).status, 400);
  const wrong = await f.ada('POST', url, { decision: 'renewed', expected_cycles: 5 });
  assert.deepEqual([wrong.status, wrong.body.code, wrong.body.current_cycles], [409, 'cycles_changed', 1]);

  const first = await f.ada('POST', url, { decision: 'renewed', expected_cycles: 1, note: 'Second year' });
  assert.deepEqual([first.status, first.body.cycles, first.body.replayed], [200, 2, undefined]);
  const retry = await f.ada('POST', url, { decision: 'renewed', expected_cycles: 1, note: 'Second year' });
  assert.deepEqual([retry.status, retry.body.cycles, retry.body.replayed], [200, 2, true], 'the retry is not a second cycle');
  const other = await f.ada('POST', url, { decision: 'ended', expected_cycles: 1 });
  assert.deepEqual([other.status, other.body.code], [409, 'term_decided'], 'a different decision on a decided term is refused');
  assert.equal(f.row('SELECT cycles FROM advisor_engagements WHERE id = ?', e.id).cycles, 2);

  const next = await f.ada('POST', url, { decision: 'renewed', expected_cycles: 2 });
  assert.equal(next.body.cycles, 3, 'the next term is its own decision');
  const history = await f.ada('GET', `/me/engagements/${e.id}/events`);
  assert.deepEqual(history.body.items.map((x: any) => [x.kind, x.cycles_before, x.cycles_after]),
    [['signed', 0, 1], ['renewed', 1, 2], ['renewed', 2, 3]]);
  assert.equal(history.body.items[1].note, 'Second year');
});

// 12 ──────────────────────────────────────────────────────────────────────────
test('a renewal racing itself counts one cycle: the loser is a replay, and a conflicting decision is a conflict', async () => {
  // Mutations checked: the UPDATE not conditional on the term; the event's unique index removed.
  const f = fixture();
  const e = await sign(f);
  const url = `/me/engagements/${e.id}/renewal`;
  // The same renewal commits between this request's reads and its writes.
  let raced = false;
  f.hooks.before = (sql) => {
    if (!raced && sql.startsWith('UPDATE advisor_engagements')) {
      raced = true;
      f.db.exec(`UPDATE advisor_engagements SET cycles = 2, outcome = 'renewed', updated_at = 'rival' WHERE id = ${e.id}`);
      f.db.prepare(`INSERT INTO advisor_engagement_events (uid, engagement_id, kind, from_lane, to_lane, cycles_before, cycles_after)
        VALUES ('rival-event', ?, 'renewed', 'signed', 'signed', 1, 2)`).run(e.id);
    }
  };
  const same = await f.ada('POST', url, { decision: 'renewed', expected_cycles: 1 });
  f.hooks.before = null;
  assert.deepEqual([same.status, same.body.replayed, same.body.cycles], [200, true, 2]);
  assert.equal(f.rows('SELECT id FROM advisor_engagement_events WHERE kind = \'renewed\'').length, 1);

  const g = fixture();
  const e2 = await sign(g);
  raced = false;
  g.hooks.before = (sql) => {
    if (!raced && sql.startsWith('UPDATE advisor_engagements')) {
      raced = true;
      g.db.exec(`UPDATE advisor_engagements SET cycles = 2, outcome = 'renewed', updated_at = 'rival' WHERE id = ${e2.id}`);
      g.db.prepare(`INSERT INTO advisor_engagement_events (uid, engagement_id, kind, from_lane, to_lane, cycles_before, cycles_after)
        VALUES ('rival-event', ?, 'renewed', 'signed', 'signed', 1, 2)`).run(e2.id);
    }
  };
  const clash = await g.ada('POST', `/me/engagements/${e2.id}/renewal`, { decision: 'ended', expected_cycles: 1 });
  g.hooks.before = null;
  assert.deepEqual([clash.status, clash.body.code], [409, 'term_decided']);
  assert.deepEqual(g.row('SELECT lane, cycles, outcome FROM advisor_engagements WHERE id = ?', e2.id), { lane: 'signed', cycles: 2, outcome: 'renewed' });
});

// 13 ──────────────────────────────────────────────────────────────────────────
test('the rules service: wall clock, week bounds, blackouts, notice, buffer and the paid test, as pure functions', () => {
  // Mutations checked: weekBounds using UTC; blackoutHit ignoring the day; isPaidType counting included sessions.
  assert.deepEqual(wallClock(Date.UTC(2037, 5, 8, 2), 'America/New_York'), { y: 2037, m: 6, d: 7, h: 22, min: 0, weekday: 6 });
  assert.equal(wallClock(Date.UTC(2037, 5, 8, 2), 'Not/AZone').weekday, 0, 'an unknown zone reads as UTC');
  const wk = weekBounds(Date.UTC(2037, 5, 3, 12), 'America/New_York');
  assert.equal(new Date(wk.from).toISOString(), '2037-06-01T04:00:00.000Z');
  assert.equal(new Date(wk.until).toISOString(), '2037-06-08T04:00:00.000Z');
  const rules = rulesFromRow({ blackouts_json: JSON.stringify([{ day: 'tue', from: '09:00', to: '12:00' }, { day: 'xyz', from: '1', to: '2' }]), timezone: 'UTC', min_notice_hours: 2 });
  assert.equal(rules.blackouts.length, 1, 'a malformed window is dropped, not thrown');
  assert.ok(blackoutHit(rules, Date.UTC(2037, 5, 2, 11), Date.UTC(2037, 5, 2, 12)));
  assert.equal(blackoutHit(rules, Date.UTC(2037, 5, 3, 11), Date.UTC(2037, 5, 3, 12)), null, 'Wednesday is not Tuesday');
  assert.equal(ruleRefusal({ slot: { starts_at: at(Date.now() + HOUR), ends_at: at(Date.now() + 2 * HOUR) }, rules, now: Date.now(), paid: false, paidThisWeek: null, booked: [] })?.code, 'min_notice');
  // The service decides on its own too, so the route's early answer and the INSERT's guard agree with it.
  const slot = { starts_at: at(Date.now() + 3 * DAY), ends_at: at(Date.now() + 3 * DAY + HOUR) };
  const cap = (weekly_paid_cap: number | null) => ({ ...rulesFromRow({ weekly_paid_cap }), timezone: 'UTC' });
  const refuse = (rules: any, paidThisWeek: number | null, paid = true, extra: any = {}) =>
    ruleRefusal({ slot: { ...slot, ...extra }, rules, now: Date.now(), paid, paidThisWeek, booked: [] })?.code ?? null;
  assert.equal(refuse(cap(1), 1), 'weekly_cap', 'a week at its cap is full');
  assert.equal(refuse(cap(1), 0), null, 'one below the cap is open');
  assert.equal(refuse(cap(0), 0), 'weekly_cap', 'a cap of 0 accepts no paid session');
  assert.equal(refuse(cap(0), 0, false), null, 'and does not touch a session that is not paid');
  assert.equal(refuse(cap(null), 99), null, 'no cap is no limit');
  assert.equal(refuse(cap(null), null, true, { blocked_reason: 'Away' }), 'slot_blocked');
  assert.equal(isBlocked({ blocked_reason: '  ' }), false);
  assert.equal(isBlocked({ blocked_reason: 'Away' }), true);
  assert.equal(isPaidType({ price_cents: 100, is_included: 1 }), false);
  assert.equal(isPaidType({ price_cents: 100, is_free_intro: 0, is_included: 0 }), true);
  assert.equal(canonicalInstant('2037-06-02T10:00:00+02:00'), '2037-06-02T08:00:00.000Z');
  assert.equal(canonicalInstant('soon'), null);
});

// D4692 ─────────────────────────────────────────────────────────────────────
test('D4692: the slot list says what the booking would say — notice, blackout, buffer and the paid cap — and still lists the slot', async () => {
  // Mutations checked: notice not applied; buffer not applied; the paid cap flag dropped; a held slot's own span counted against itself.
  const f = fixture();
  f.rules({ notice: 24, buffer: 30, cap: 1, tz: 'UTC' });
  const soon = f.slot(NOW() + 2 * HOUR);
  const far = f.slot(NOW() + 4 * DAY);
  const held = f.slot(NOW() + 6 * DAY);
  const next = f.slot(NOW() + 6 * DAY + 1.2 * HOUR);
  assert.equal((await book(f, held, { session_type_id: 2 })).status, 200);
  const list = await f.gus('GET', '/adv-1/slots');
  const by = (id: number) => list.body.items.find((s: any) => s.id === id);
  assert.equal(by(soon).unavailable_code, 'min_notice');
  assert.equal(by(far).unavailable_code, null);
  assert.equal(by(held).unavailable_code, null, 'a slot is not too close to itself');
  assert.equal(by(next).unavailable_code, 'buffer', 'the free session next door keeps the buffer');
  assert.equal(by(far).paid_cap_reached, false);
  // The list agrees with the booking.
  assert.deepEqual([(await book(f, soon)).status, (await book(f, soon)).body.code], [409, 'min_notice']);
  assert.equal((await book(f, next, { session_type_id: 2 })).body.code, 'buffer');
  // One paid session in the week fills a cap of 1; the list says so for every slot in that week.
  assert.equal((await book(f, far)).status, 200);
  const after = await f.gus('GET', '/adv-1/slots');
  assert.equal(after.body.items.find((s: any) => s.id === far).paid_cap_reached, true);
  assert.equal((await book(f, far, {}, 'gus')).status, 409);
});
