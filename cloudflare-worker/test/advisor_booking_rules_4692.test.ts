/**
 * D4692 (#4692) — Practice audit 2/6: every scheduling restriction is enforced at the
 * booking write, and a booking or engagement change is conditional on the state it read.
 *
 * The real router over the real migrated schema (every migration, including the
 * lifecycle ledger), synthetic rows only. A race is simulated deterministically by
 * running the competing write BETWEEN the handler's read and its write (a hook on the
 * D1 binding), which is the interleaving D1 allows between two requests.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/advisor_booking_rules_4692.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import advisors from '../src/routes/advisors.ts';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import {
  BOOKING_TRANSITIONS, ENGAGEMENT_ADVANCE, bookingMoveAllowed, bookingSourcesOf, everSigned,
} from '../src/services/advisorLifecycle.ts';
import { weekBounds } from '../src/services/advisorBookability.ts';

const SECRET = 'synthetic-booking-rules-4692-'.repeat(3);
test.after(() => removeMigratedDatabases());

const DAY = 86_400_000;
// A Monday at least ten days out, so every slot below is in the future and in one known week.
const base = (() => {
  const t = new Date(); t.setUTCHours(0, 0, 0, 0);
  let ms = t.getTime() + 10 * DAY;
  while (new Date(ms).getUTCDay() !== 1) ms += DAY;
  return ms;
})();
/** An instant: `dayOffset` days after the base Monday, at `hour` UTC (fractions allowed). */
const at = (dayOffset: number, hour: number) => new Date(base + dayOffset * DAY + hour * 3_600_000).toISOString();
const MON = 0, TUE = 1, WED = 2, THU = 3, FRI = 4, NEXT_MON = 7;

const ADVISOR = 21, OTHER_ADVISOR = 22, F1 = 11, F2 = 12, F3 = 13, ADMIN = 51;
const who = {
  ada: { user: ADVISOR, role: 'advisor' }, grace: { user: OTHER_ADVISOR, role: 'advisor' },
  f1: { user: F1, role: 'founder' }, f2: { user: F2, role: 'founder' }, f3: { user: F3, role: 'founder' },
  admin: { user: ADMIN, role: 'admin' },
};

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,name,email,role,is_active,subscription_tier) VALUES
      (11,'Fran','f1@example.test','founder',1,'studio'),(12,'Finn','f2@example.test','founder',1,'studio'),
      (13,'Fay','f3@example.test','founder',1,'studio'),(21,'Ada','a@example.test','advisor',1,'free'),
      (22,'Grace','g@example.test','advisor',1,'free'),(51,'Root','r@example.test','admin',1,'studio');
    INSERT INTO advisors(id,uid,user_id,display_name,email,is_active,timezone) VALUES
      (201,'adv-1',21,'Ada','a@example.test',1,'UTC'),(202,'adv-2',22,'Grace','g@example.test',1,'UTC');
    UPDATE users SET advisor_id = 201 WHERE id = 21;
    UPDATE users SET advisor_id = 202 WHERE id = 22;
    INSERT INTO advisor_session_types(id,uid,advisor_id,name,duration_minutes,price_cents,is_free_intro,is_included,is_active) VALUES
      (1,'t-free',201,'Intro',60,NULL,1,0,1),(2,'t-paid',201,'Deep dive',60,9000,0,0,1),(3,'t-incl',201,'Included',60,0,0,1,1);
  `);
  const slot = (id: number, from: string, to: string, extra: { capacity?: number; advisor?: number; blocked?: string; cancelled?: boolean } = {}) =>
    db.prepare('INSERT INTO advisor_office_hour_slots(id,uid,advisor_id,starts_at,ends_at,capacity,blocked_reason,is_cancelled) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, `s-${id}`, extra.advisor ?? 201, from, to, extra.capacity ?? 1, extra.blocked ?? null, extra.cancelled ? 1 : 0);
  const rules = (r: { cap?: number | null; buffer?: number | null; notice?: number | null; blackouts?: unknown[]; tz?: string | null }) =>
    db.prepare(`INSERT OR REPLACE INTO advisor_availability_rules(advisor_id,weekly_paid_cap,buffer_minutes,min_notice_hours,blackouts_json,timezone) VALUES (201,?,?,?,?,?)`)
      .run(r.cap ?? null, r.buffer ?? null, r.notice ?? null, JSON.stringify(r.blackouts ?? []), r.tz ?? null);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  return { db, slot, rules, env };
}

async function call(env: any, method: string, path: string, w: { user: number; role: string }, body?: unknown) {
  const jwt = await new SignJWT({ user_id: w.user, role: w.role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const init: any = { method, headers: { Authorization: `Bearer ${jwt}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await advisors.request(path, init, env, { waitUntil() {}, passThroughOnException() {} } as any);
  const text = await res.text();
  return { status: res.status, text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}
const book = (env: any, slotId: number, w = who.f1, extra: Record<string, unknown> = {}) => call(env, 'POST', `/slots/${slotId}/book`, w, { topic: 'Synthetic', ...extra });
const listed = async (env: any, extra = '') => ((await call(env, 'GET', `/adv-1/slots${extra}`, who.f1)).body?.items ?? []).map((s: any) => s.id).sort((a: number, b: number) => a - b);
const count = (db: any, sql = "SELECT COUNT(*) AS n FROM advisor_bookings WHERE status != 'cancelled'") => Number((db.prepare(sql).get() as any).n);

/** Runs `competing` once, just before the handler's first batch or matching statement reaches the database. */
function raceBefore(env: any, when: RegExp | 'batch', competing: () => Promise<unknown> | unknown) {
  let fired = false;
  const real = env.DB;
  const fire = async () => { if (!fired) { fired = true; await competing(); } };
  return {
    ...env,
    DB: {
      prepare(sql: string) {
        const st = real.prepare(sql);
        if (when === 'batch' || !when.test(sql)) return st;
        return { ...st, bind: (...a: any[]) => { const b = st.bind(...a); return { ...b, run: async () => { await fire(); return b.run(); } }; } };
      },
      batch: async (s: any[]) => { if (when === 'batch') await fire(); return real.batch(s); },
      exec: (s: string) => real.exec(s),
    },
  };
}

// ── findings 1 and 2: blocked slot, saved rules ────────────────────────────────────────────────
test('a blocked slot is not listed and not bookable, and its reason never leaves the advisor', async () => {
  const f = fixture();
  f.slot(1, at(WED, 10), at(WED, 11));
  f.slot(2, at(WED, 12), at(WED, 13));
  const blocked = await call(f.env, 'POST', '/me/slots/block', who.ada, { from: at(WED, 9), until: at(WED, 11.5), reason: 'Private dentist visit' });
  assert.deepEqual([blocked.status, blocked.body.blocked, blocked.body.skipped_booked], [200, 1, 0]);
  assert.deepEqual(await listed(f.env), [2], 'the list no longer offers the blocked slot');
  const refused = await book(f.env, 1);
  assert.equal(refused.status, 404);
  assert.ok(!refused.text.includes('dentist'), 'the advisor\'s private reason is never sent');
  assert.equal(count(f.db), 0);
  assert.equal((await book(f.env, 2)).status, 200, 'the neighbouring slot still books');
});

test('blocking never touches an existing booking, and a block and a booking racing leave one winner', async () => {
  const f = fixture();
  f.slot(1, at(WED, 10), at(WED, 11));
  f.slot(2, at(WED, 12), at(WED, 13));
  assert.equal((await book(f.env, 1)).status, 200);
  const r = await call(f.env, 'POST', '/me/slots/block', who.ada, { from: at(WED, 9), until: at(WED, 14) });
  assert.deepEqual([r.body.blocked, r.body.skipped_booked], [1, 1], 'the booked hour is reported, not blocked');
  assert.equal((f.db.prepare('SELECT status FROM advisor_bookings WHERE slot_id = 1').get() as any).status, 'pending');
  assert.equal((f.db.prepare('SELECT blocked_reason FROM advisor_office_hour_slots WHERE id = 1').get() as any).blocked_reason, null);

  // A booking lands after the block read the slot as free: the conditional UPDATE blocks nothing.
  const g = fixture();
  g.slot(5, at(THU, 10), at(THU, 11));
  const racing = raceBefore(g.env, /UPDATE advisor_office_hour_slots SET blocked_reason/, async () => {
    g.db.prepare("INSERT INTO advisor_bookings(uid,slot_id,advisor_id,founder_user_id,status) VALUES ('b-x',5,201,11,'pending')").run();
  });
  const blockedRace = await call(racing, 'POST', '/me/slots/block', who.ada, { from: at(THU, 9), until: at(THU, 12) });
  assert.deepEqual([blockedRace.body.blocked, blockedRace.body.skipped_booked], [0, 1]);
  assert.equal((g.db.prepare('SELECT blocked_reason FROM advisor_office_hour_slots WHERE id = 5').get() as any).blocked_reason, null);

  // The block lands after the booking handler read the slot as open: the INSERT refuses it.
  const h = fixture();
  h.slot(6, at(THU, 10), at(THU, 11));
  const racing2 = raceBefore(h.env, /INSERT INTO advisor_bookings/, () => { h.db.prepare("UPDATE advisor_office_hour_slots SET blocked_reason = 'Away' WHERE id = 6").run(); });
  const lost = await book(racing2, 6);
  assert.equal(lost.status, 404);
  assert.equal(count(h.db), 0, 'a blocked slot never carries a booking');
});

test('a slot that fills between the list and the write: only the winning booking succeeds', async () => {
  const f = fixture();
  f.slot(1, at(WED, 10), at(WED, 11), { capacity: 1 });
  assert.deepEqual(await listed(f.env), [1], 'both founders were shown the slot');
  const racing = raceBefore(f.env, /INSERT INTO advisor_bookings/, async () => {
    assert.equal((await book(f.env, 1, who.f2)).status, 200);   // the winner lands first
  });
  const loser = await book(racing, 1, who.f1);
  assert.equal(loser.status, 409);
  assert.match(loser.body.detail, /full/i);
  assert.equal(count(f.db), 1);
  assert.equal((f.db.prepare('SELECT founder_user_id AS u FROM advisor_bookings').get() as any).u, F2);
  assert.deepEqual(await listed(f.env), [], 'a full slot is no longer offered');

  // Capacity 2: two succeed, the third is refused, and the count never exceeds capacity.
  const g = fixture();
  g.slot(1, at(WED, 10), at(WED, 11), { capacity: 2 });
  const results = [(await book(g.env, 1, who.f1)).status, (await book(g.env, 1, who.f2)).status, (await book(g.env, 1, who.f3)).status];
  assert.deepEqual(results, [200, 200, 409]);
});

test('a zero paid-session cap refuses a paid booking and leaves free and included sessions alone', async () => {
  const f = fixture();
  f.rules({ cap: 0 });
  f.slot(1, at(WED, 10), at(WED, 11));
  f.slot(2, at(WED, 12), at(WED, 13));
  f.slot(3, at(WED, 14), at(WED, 15));
  const paid = await book(f.env, 1, who.f1, { session_type_id: 2 });
  assert.equal(paid.status, 409);
  assert.equal(paid.body.code, 'weekly_cap');
  assert.equal(count(f.db), 0);
  assert.equal((await book(f.env, 2, who.f1, { session_type_id: 1 })).status, 200);
  assert.equal((await book(f.env, 3, who.f2, { session_type_id: 3 })).status, 200);
  assert.deepEqual(await listed(f.env, '?session_type_id=2'), [], 'the paid list offers nothing');
  assert.deepEqual(await listed(f.env, '?session_type_id=1'), [1], 'the slot the paid booking was refused on is still open to a free type');
});

test('a weekly paid cap counts that week only, in the advisor\'s zone', async () => {
  const f = fixture();
  f.rules({ cap: 1 });
  f.slot(1, at(TUE, 10), at(TUE, 11));
  f.slot(2, at(THU, 10), at(THU, 11));
  f.slot(3, at(NEXT_MON, 10), at(NEXT_MON, 11));
  assert.equal((await book(f.env, 1, who.f1, { session_type_id: 2 })).status, 200);
  assert.equal((await book(f.env, 2, who.f2, { session_type_id: 2 })).status, 409, 'second paid session in the same week');
  assert.equal((await book(f.env, 3, who.f2, { session_type_id: 2 })).status, 200, 'the next week is a new count');
  // A cancelled paid booking frees its place.
  f.db.exec("UPDATE advisor_bookings SET status = 'cancelled' WHERE slot_id = 1");
  assert.equal((await book(f.env, 2, who.f3, { session_type_id: 2 })).status, 200);
  // Week edges follow the zone: Monday 00:00 in New York is 04:00/05:00 UTC.
  const w = weekBounds(Date.parse(at(WED, 12)), 'America/New_York');
  assert.ok(w.start >= base && w.start <= base + 6 * 3_600_000 && w.end - w.start === 7 * DAY);
});

test('a paid cap race: the second paid booking that reads the cap as open loses at the write', async () => {
  const f = fixture();
  f.rules({ cap: 1 });
  f.slot(1, at(TUE, 10), at(TUE, 11));
  f.slot(2, at(THU, 10), at(THU, 11));
  const racing = raceBefore(f.env, /INSERT INTO advisor_bookings/, async () => {
    assert.equal((await book(f.env, 1, who.f2, { session_type_id: 2 })).status, 200);
  });
  const loser = await book(racing, 2, who.f1, { session_type_id: 2 });
  assert.equal(loser.status, 409);
  assert.equal(count(f.db), 1);
});

test('notice window, buffer and blackout are enforced', async () => {
  const f = fixture();
  f.slot(1, at(WED, 10), at(WED, 11));
  // Notice: 24 hours is fine for a slot ten days out; a notice longer than the lead refuses it.
  f.rules({ notice: 24 });
  assert.equal((await book(f.env, 1, who.f1)).status, 200);
  f.db.exec('DELETE FROM advisor_bookings');
  f.rules({ notice: 24 * 30 });
  const late = await book(f.env, 1, who.f1);
  assert.deepEqual([late.status, late.body.code], [409, 'inside_notice']);
  assert.deepEqual(await listed(f.env), []);
  f.rules({ notice: null });

  // Buffer: a booked 10-11 pushes a 11:15 slot out when the buffer is 30 minutes, not when it is 10.
  f.slot(2, at(WED, 11.25), at(WED, 12.25));
  f.slot(3, at(WED, 14), at(WED, 15));
  assert.equal((await book(f.env, 1, who.f1)).status, 200);
  f.rules({ buffer: 30 });
  const close = await book(f.env, 2, who.f2);
  assert.deepEqual([close.status, close.body.code], [409, 'buffer']);
  assert.deepEqual(await listed(f.env), [3]);
  f.rules({ buffer: 10 });
  assert.equal((await book(f.env, 2, who.f2)).status, 200);

  // Blackout: Wednesday 09:00-12:00 in the advisor's zone.
  const g = fixture();
  g.slot(1, at(WED, 10), at(WED, 11));
  g.slot(2, at(WED, 13), at(WED, 14));
  g.rules({ blackouts: [{ day: 'wed', from: '09:00', to: '12:00' }] });
  const dark = await book(g.env, 1);
  assert.deepEqual([dark.status, dark.body.code], [409, 'blackout']);
  assert.deepEqual(await listed(g.env), [2]);
  assert.equal((await book(g.env, 2)).status, 200);
  // The same window read in New York (UTC-5 or -4) moves: Wed 10:00 UTC is before it opens there.
  const h = fixture();
  h.slot(1, at(WED, 10), at(WED, 11));
  h.rules({ blackouts: [{ day: 'wed', from: '09:00', to: '12:00' }], tz: 'America/New_York' });
  assert.equal((await book(h.env, 1)).status, 200, 'Wed 10:00 UTC is early morning in New York, outside 09:00-12:00 local');
});

test('an inactive or paused advisor takes no booking and lists no slot', async () => {
  const f = fixture();
  f.slot(1, at(WED, 10), at(WED, 11));
  f.db.exec('UPDATE advisors SET is_active = 0 WHERE id = 201');
  assert.equal((await book(f.env, 1)).status, 404);
  assert.deepEqual(await listed(f.env), []);
  f.db.exec('UPDATE advisors SET is_active = 1 WHERE id = 201');
  f.db.exec("INSERT INTO network_member_states(user_id, paused_at) VALUES (21, '2026-11-01T00:00:00Z')");
  const paused = await book(f.env, 1);
  assert.deepEqual([paused.status, paused.body.code], [409, 'advisor_paused']);
  assert.deepEqual(await listed(f.env), []);
});

// ── the list and the booking endpoint agree ─────────────────────────────────────────────────────
test('property: for a matrix of rules, every listed slot books and every unlisted slot is refused', async () => {
  const ruleSets: Array<Record<string, unknown>> = [
    {}, { cap: 0 }, { cap: 1 }, { notice: 24 * 12 }, { buffer: 45 },
    { blackouts: [{ day: 'wed', from: '09:00', to: '12:00' }, { day: 'fri', from: '00:00', to: '23:59' }] },
    { cap: 0, buffer: 30, notice: 24 * 11, blackouts: [{ day: 'thu', from: '13:00', to: '16:00' }], tz: 'Asia/Tokyo' },
  ];
  let checked = 0;
  for (const rs of ruleSets) {
    for (const typeId of [null, 1, 2, 3]) {
      const f = fixture();
      f.rules(rs as any);
      // Slots across days, with a standing booking at Tue 10:00 so the buffer and the cap have something to meet.
      let id = 10;
      for (const [d, h] of [[MON, 9], [TUE, 10], [TUE, 11.25], [WED, 10], [WED, 13], [THU, 14], [FRI, 10], [NEXT_MON, 9]] as number[][]) {
        f.slot(id++, at(d, h), at(d, h + 1));
      }
      f.slot(id++, at(WED, 15), at(WED, 16), { blocked: 'Away' });
      f.slot(id++, at(WED, 17), at(WED, 18), { cancelled: true });
      f.slot(id++, at(THU, 9), at(THU, 10), { capacity: 1 });
      f.db.prepare("INSERT INTO advisor_bookings(uid,slot_id,advisor_id,founder_user_id,status,session_type_id) VALUES ('b-0',11,201,12,'confirmed',2)").run();
      f.db.prepare("INSERT INTO advisor_bookings(uid,slot_id,advisor_id,founder_user_id,status) VALUES ('b-1',20,201,13,'pending')").run();
      const query = typeId == null ? '' : `?session_type_id=${typeId}`;
      const shown = new Set<number>(await listed(f.env, query));
      for (let s = 10; s < id; s++) {
        const before = count(f.db, 'SELECT COUNT(*) AS n FROM advisor_bookings');
        const r = await book(f.env, s, who.f1, typeId == null ? {} : { session_type_id: typeId });
        assert.equal(r.status === 200, shown.has(s), `rules ${JSON.stringify(rs)} type ${typeId} slot ${s}: listed=${shown.has(s)} booking=${r.status} ${r.body?.code ?? ''}`);
        if (r.status === 200) f.db.prepare('DELETE FROM advisor_bookings WHERE id = ?').run(r.body.id);   // reset: each slot is judged on the same footing
        assert.equal(count(f.db, 'SELECT COUNT(*) AS n FROM advisor_bookings'), before);
        checked++;
      }
    }
  }
  assert.ok(checked > 200, 'the matrix really ran');
});

// ── booking transitions ─────────────────────────────────────────────────────────────────────────
function bookedFixture() {
  const f = fixture();
  f.slot(1, at(WED, 10), at(WED, 11));
  f.slot(2, at(WED, 12), at(WED, 13));
  f.db.exec(`INSERT INTO advisor_bookings(id,uid,slot_id,advisor_id,founder_user_id,status) VALUES (1,'bk-1',1,201,11,'pending'),(2,'bk-2',2,202,12,'confirmed')`);
  return f;
}
const status = (db: any, id = 1) => (db.prepare('SELECT status FROM advisor_bookings WHERE id = ?').get(id) as any).status;
const events = (db: any, kind = 'booking') => db.prepare('SELECT * FROM advisor_lifecycle_events WHERE subject_kind = ? ORDER BY id').all(kind) as any[];

test('the booking graph is one table: finals have no exits, every target is a state, the routes read it', () => {
  const states = Object.keys(BOOKING_TRANSITIONS);
  for (const s of ['completed', 'cancelled', 'no_show']) assert.deepEqual(BOOKING_TRANSITIONS[s as 'completed'], []);
  for (const to of Object.values(BOOKING_TRANSITIONS).flat()) assert.ok(states.includes(to));
  assert.equal(bookingMoveAllowed('completed', 'confirmed'), false);
  assert.equal(bookingMoveAllowed('pending', 'confirmed'), true);
  assert.deepEqual(bookingSourcesOf('cancelled'), ['pending', 'confirmed'], 'the slot-delete batch cancels exactly these');
});

test('confirm, complete and cancel record who decided and when; the booking answers with the new state', async () => {
  const f = bookedFixture();
  const r = await call(f.env, 'POST', '/bookings/1/confirm', who.ada);
  assert.deepEqual([r.status, r.body.status], [200, 'confirmed']);
  assert.equal((await call(f.env, 'POST', '/bookings/1/complete', who.ada)).status, 200);
  const rows = events(f.db);
  assert.deepEqual(rows.map((e) => [e.from_state, e.to_state, e.actor_user_id, e.actor_role, e.advisor_id, e.subject_id]),
    [['pending', 'confirmed', ADVISOR, 'advisor', 201, 1], ['confirmed', 'completed', ADVISOR, 'advisor', 201, 1]]);
  assert.ok(rows.every((e) => /^\d{4}-\d{2}-\d{2}/.test(e.created_at)), 'a timestamp is recorded');
  const g = bookedFixture();
  assert.equal((await call(g.env, 'POST', '/bookings/1/cancel', who.f1, { reason: 'Clash' })).status, 200);
  assert.deepEqual(events(g.db).map((e) => [e.to_state, e.actor_user_id, e.actor_role, e.reason]), [['cancelled', F1, 'founder', 'Clash']]);
});

test('a delayed confirmation cannot overwrite a completion: the stale request is a 409 and nothing is rewritten', async () => {
  const f = bookedFixture();
  const racing = raceBefore(f.env, 'batch', async () => {
    assert.equal((await call(f.env, 'POST', '/bookings/1/complete', who.ada)).status, 200);
  });
  const stale = await call(racing, 'POST', '/bookings/1/confirm', who.ada);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'changed_while_looking');
  assert.match(stale.body.detail, /Reload it and try again/);
  assert.equal(status(f.db), 'completed', 'one valid final state');
  assert.deepEqual(events(f.db).map((e) => e.to_state), ['completed'], 'the loser left no decision row');
});

test('confirm against cancel, and cancel against complete: one final state each way round', async () => {
  const f = bookedFixture();
  const racing = raceBefore(f.env, 'batch', async () => { await call(f.env, 'POST', '/bookings/1/cancel', who.f1); });
  assert.equal((await call(racing, 'POST', '/bookings/1/confirm', who.ada)).status, 409);
  assert.equal(status(f.db), 'cancelled');
  const g = bookedFixture();
  const racing2 = raceBefore(g.env, 'batch', async () => { await call(g.env, 'POST', '/bookings/1/confirm', who.ada); });
  // The cancel read `pending`, the confirm moved it to `confirmed`: the cancel's write expects `pending`, so it loses.
  assert.equal((await call(racing2, 'POST', '/bookings/1/cancel', who.f1)).status, 409);
  assert.equal(status(g.db), 'confirmed');
  const h = bookedFixture();
  const racing3 = raceBefore(h.env, 'batch', async () => { await call(h.env, 'POST', '/bookings/1/cancel', who.f1); });
  assert.equal((await call(racing3, 'POST', '/bookings/1/complete', who.ada)).status, 409);
  assert.equal(status(h.db), 'cancelled');
  assert.equal(events(h.db).length, 1);
});

test('transitions the graph forbids are refused and leave the booking as it was', async () => {
  const f = bookedFixture();
  await call(f.env, 'POST', '/bookings/1/complete', who.ada);
  for (const verb of ['confirm', 'cancel', 'no-show', 'complete']) {
    const r = await call(f.env, 'POST', `/bookings/1/${verb}`, verb === 'cancel' ? who.f1 : who.ada);
    assert.equal(r.status, 409, verb);
    assert.equal(r.body.error, 'booking_move_not_allowed', verb);
  }
  assert.equal(status(f.db), 'completed');
  assert.equal(events(f.db).length, 1);
});

test('another party\'s booking answers exactly like one that does not exist', async () => {
  const f = bookedFixture();
  const missing = await call(f.env, 'POST', '/bookings/999/cancel', who.f2);
  // Booking 1 belongs to advisor 201 and founder 11: neither f2 nor advisor 202 is a party to it.
  for (const [verb, w] of [['cancel', who.f2], ['confirm', who.grace], ['complete', who.f3], ['no-show', who.grace]] as const) {
    const r = await call(f.env, 'POST', `/bookings/1/${verb}`, w);
    assert.deepEqual([r.status, r.text], [404, missing.text], verb);
  }
  assert.equal(status(f.db), 'pending');
  assert.equal(events(f.db).length, 0);
  // A party who may not do THAT verb is told so (it is their own booking).
  assert.equal((await call(f.env, 'POST', '/bookings/1/confirm', who.f1)).status, 403);
});

test('cancelling a slot cancels its open bookings in one batch and attributes each to the advisor', async () => {
  const f = fixture();
  f.slot(1, at(WED, 10), at(WED, 11), { capacity: 3 });
  f.db.exec(`INSERT INTO advisor_bookings(id,uid,slot_id,advisor_id,founder_user_id,status) VALUES
    (1,'b1',1,201,11,'pending'),(2,'b2',1,201,12,'confirmed'),(3,'b3',1,201,13,'completed')`);
  const r = await call(f.env, 'DELETE', '/me/slots/1', who.ada);
  assert.deepEqual([r.status, r.body.bookings_cancelled], [200, 2]);
  assert.deepEqual(f.db.prepare('SELECT status FROM advisor_bookings ORDER BY id').all().map((x: any) => x.status), ['cancelled', 'cancelled', 'completed']);
  assert.deepEqual(events(f.db).map((e) => [e.subject_id, e.from_state, e.to_state, e.actor_user_id, e.reason]),
    [[1, 'pending', 'cancelled', ADVISOR, 'slot_cancelled'], [2, 'confirmed', 'cancelled', ADVISOR, 'slot_cancelled']]);
  assert.equal((await book(f.env, 1, who.f3)).status, 404, 'the cancelled slot books nothing');
});

// ── engagements ─────────────────────────────────────────────────────────────────────────────────
async function newEngagement(f: ReturnType<typeof fixture>) {
  const r = await call(f.env, 'POST', '/me/engagements', who.ada, { client_name: 'Synthetic client' });
  return r.body.id as number;
}
const advance = (f: any, id: number, lane: string, env = f.env) => call(env, 'POST', `/me/engagements/${id}/advance`, who.ada, { lane });
const eng = (db: any, id: number) => db.prepare('SELECT * FROM advisor_engagements WHERE id = ?').get(id) as any;

test('the engagement graph offers only the moves the board offers; ending a signed one is not among them', () => {
  assert.deepEqual(ENGAGEMENT_ADVANCE.ended, []);
  for (const lane of ['signed', 'renewal_due']) assert.ok(!ENGAGEMENT_ADVANCE[lane].includes('ended'));
  assert.deepEqual([...ENGAGEMENT_ADVANCE.signed], ['renewal_due']);
  assert.equal(everSigned({ lane: 'proposed', cycles: 1 }), true);
  assert.equal(everSigned({ lane: 'proposed', cycles: 0 }), false);
  assert.equal(everSigned({ lane: 'proposed', cycles: 0, started_at: '2026-11-01' }), true);
});

test('signed → intermediate lane → ended still demands the outcome decision', async () => {
  const f = fixture();
  const id = await newEngagement(f);
  assert.equal((await advance(f, id, 'signed')).body.ever_signed, true);
  // The route no longer lets a signed engagement drop back to Proposed at all.
  const back = await advance(f, id, 'proposed');
  assert.deepEqual([back.status, back.body.error], [409, 'lane_move_not_allowed']);
  // And a row that reached an earlier lane some other way (older data) is held to the same rule.
  f.db.exec(`UPDATE advisor_engagements SET lane = 'proposed' WHERE id = ${id}`);
  const ended = await advance(f, id, 'ended');
  assert.deepEqual([ended.status, ended.body.error], [409, 'outcome_required']);
  assert.match(ended.body.detail, /renewal decision/);
  assert.equal(eng(f.db, id).lane, 'proposed');
  assert.equal(eng(f.db, id).outcome, 'active');
  const wrongDecision = await call(f.env, 'POST', `/me/engagements/${id}/renewal`, who.ada, { decision: 'renewed' });
  assert.deepEqual([wrongDecision.status, wrongDecision.body.error], [409, 'not_signed']);
  const done = await call(f.env, 'POST', `/me/engagements/${id}/renewal`, who.ada, { decision: 'ended', note: 'Scope changed' });
  assert.deepEqual([done.status, done.body.lane, done.body.outcome], [200, 'ended', 'ended']);
  assert.equal(eng(f.db, id).cycles, 1, 'the term that ran is still counted');
  const totals = (await call(f.env, 'GET', '/me/engagements', who.ada)).body.totals;
  assert.deepEqual([totals.ended, totals.decided], [1, 1], 'the lost renewal is in the denominator');
});

test('an unsigned draft still ends without an outcome; a signed one still cannot end directly', async () => {
  const f = fixture();
  const draft = await newEngagement(f);
  const r = await advance(f, draft, 'ended');
  assert.deepEqual([r.status, r.body.lane, r.body.outcome, r.body.ever_signed], [200, 'ended', null, false]);
  const signed = await newEngagement(f);
  await advance(f, signed, 'signed');
  const direct = await advance(f, signed, 'ended');
  assert.deepEqual([direct.status, direct.body.error], [409, 'outcome_required']);
  const due = await advance(f, signed, 'renewal_due');
  assert.equal(due.status, 200);
  assert.equal((await advance(f, signed, 'ended')).status, 409);
  assert.equal((await advance(f, draft, 'drafting')).status, 409, 'ended is terminal');
});

test('engagement sign, move and outcome are recorded with the actor and the time', async () => {
  const f = fixture();
  const id = await newEngagement(f);
  await advance(f, id, 'signed');
  await call(f.env, 'POST', `/me/engagements/${id}/renewal`, who.ada, { decision: 'renewed' });
  await call(f.env, 'POST', `/me/engagements/${id}/renewal`, who.ada, { decision: 'ended', note: 'Done' });
  const rows = events(f.db, 'engagement');
  assert.deepEqual(rows.map((e) => [e.from_state, e.to_state, e.decision, e.actor_user_id, e.actor_role]),
    [['drafting', 'signed', null, ADVISOR, 'advisor'], ['signed', 'signed', 'renewed', ADVISOR, 'advisor'], ['signed', 'ended', 'ended', ADVISOR, 'advisor']]);
  assert.ok(rows.every((e) => e.created_at && e.advisor_id === 201));
});

test('a stale engagement write is a 409 and the row keeps its one valid state', async () => {
  const f = fixture();
  const id = await newEngagement(f);
  await advance(f, id, 'signed');
  // The renewal decision read `signed`; the lane moved to renewal_due before it wrote.
  const racing = raceBefore(f.env, 'batch', async () => { await advance(f, id, 'renewal_due'); });
  const stale = await call(racing, 'POST', `/me/engagements/${id}/renewal`, who.ada, { decision: 'ended' });
  assert.deepEqual([stale.status, stale.body.error], [409, 'changed_while_looking']);
  assert.equal(eng(f.db, id).lane, 'renewal_due');
  assert.equal(events(f.db, 'engagement').length, 2, 'signing and the renewal_due move; the loser wrote nothing');
  // Two advances racing: the loser does not restore the old lane.
  const g = fixture();
  const gid = await newEngagement(g);
  const racing2 = raceBefore(g.env, 'batch', async () => { await advance(g, gid, 'signed'); });
  const lost = await advance(g, gid, 'proposed', racing2);
  assert.deepEqual([lost.status, lost.body.error], [409, 'changed_while_looking']);
  assert.equal(eng(g.db, gid).lane, 'signed');
  // A race that moves ONLY the lane (term count and outcome untouched): the lane alone must be enough to refuse.
  const h = fixture();
  const hid = await newEngagement(h);
  await advance(h, hid, 'signed');
  const racing3 = raceBefore(h.env, 'batch', async () => { await advance(h, hid, 'renewal_due'); });
  const same = await advance(h, hid, 'renewal_due', racing3);
  assert.deepEqual([same.status, same.body.error], [409, 'changed_while_looking']);
  assert.equal(events(h.db, 'engagement').filter((e) => e.to_state === 'renewal_due').length, 1);
});

test('another advisor\'s engagement is a 404 for every verb, as for one that does not exist', async () => {
  const f = fixture();
  const id = await newEngagement(f);
  const missing = await call(f.env, 'POST', '/me/engagements/999/advance', who.grace, { lane: 'signed' });
  for (const [verb, body] of [['advance', { lane: 'signed' }], ['renewal', { decision: 'ended' }]] as const) {
    const r = await call(f.env, 'POST', `/me/engagements/${id}/${verb}`, who.grace, body);
    assert.deepEqual([r.status, r.text], [404, missing.text], verb);
  }
  assert.equal(eng(f.db, id).lane, 'drafting');
});
