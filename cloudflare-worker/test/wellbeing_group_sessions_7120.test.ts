/**
 * D7120 (#7120): Wellness group sessions on the real routers over node:sqlite.
 * Two members after the last seat, repeated requests, a released seat, the
 * cancellation window, a cancelled occurrence, confidential attendance, the
 * calendar entry, a recommendation to a reservation, and the 1:1 path left
 * alone.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import { groupSessions, groupReservations, facilitator, sessionDraft, reservationIcs, SAMPLE_PREFIX_IN_SQL } from '../src/routes/wellbeing_group_sessions.ts';
import { SAMPLE_EXPERT_UID_PREFIX } from '../src/services/wellbeing/seedExperts.ts';
import { preferences, recommendations } from '../src/routes/wellbeing_recommendations.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MIA = 1, OTTO = 2, ANA = 3, FAC = 10, OTHER_FAC = 11, ADMIN = 20, INVESTOR = 30;
const ROLE: Record<number, string> = { [MIA]: 'founder', [OTTO]: 'founder', [ANA]: 'founder', [FAC]: 'advisor', [OTHER_FAC]: 'advisor', [ADMIN]: 'admin', [INVESTOR]: 'investor' };
const NOW = Date.parse('2026-11-17T12:00:00Z');
const START = '2026-11-19T15:00:00.000Z';
test.beforeEach(() => { mock.timers.enable({ apis: ['Date'], now: NOW }); });
test.afterEach(() => { mock.timers.reset(); });

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const ddl = (name: string) => {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is not in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
};

function setup() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, email TEXT, name TEXT,
             is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, subscription_tier TEXT, subscription_status TEXT);
           CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
           CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT, body TEXT, link TEXT, payload TEXT, created_at TEXT);`);
  for (const t of ['experts', 'expert_services', 'expert_availability', 'wellbeing_daily_pulses']) db.exec(ddl(t));
  for (const m of ['202611171643_7118_wellbeing_reflections', '202611171711_7119_wellbeing_preferences', '202611171724_7120_wellbeing_group_sessions']) {
    db.exec(read(`cloudflare-worker/sql/migrations/${m}.sql`));
  }
  const u = db.prepare('INSERT INTO users (id, role, email, name) VALUES (?, ?, ?, ?)');
  for (const [id, name] of [[MIA, 'Mia'], [OTTO, 'Otto'], [ANA, 'Ana'], [FAC, 'Fay Facilitator'], [OTHER_FAC, 'Oz Other'], [ADMIN, 'Ada Admin'], [INVESTOR, 'Ivy']] as const) {
    u.run(id, ROLE[id], `${String(name).split(' ')[0].toLowerCase()}@example.test`, name);
  }
  const e = db.prepare(`INSERT INTO experts (uid, user_id, name, headline, is_active, verified, profile_completion_pct, hidden_by_admin, categories_json, languages_json)
                        VALUES (?, ?, ?, 'Synthetic', 1, ?, 90, 0, ?, '["en"]')`);
  e.run('fay', FAC, 'Fay Facilitator', 1, '["nutritionist","mindfulness_coach"]');
  e.run('oz', OTHER_FAC, 'Oz Other', 1, '["executive_coach"]');
  return db;
}
const envOf = (db: any) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) }) as any;

async function call(router: any, e: any, method: string, path: string, who: number, body?: unknown) {
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const w = console.warn, er = console.error, i = console.info, l = console.log;
  console.warn = () => {}; console.error = () => {}; console.info = () => {}; console.log = () => {};
  try {
    const res = await router.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, e);
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text, headers: res.headers };
  } finally { console.warn = w; console.error = er; console.info = i; console.log = l; }
}
const draft = (extra: Record<string, unknown> = {}) => ({
  support_type: 'nutrition', title: 'Eating well under pressure', description: 'A small group.', language: 'en',
  timezone: 'Europe/Paris', starts_at: START, duration_minutes: 60, capacity: 2, cancellation_hours: 24, ...extra,
});
async function schedule(e: any, extra: Record<string, unknown> = {}) {
  const r = await call(facilitator, e, 'POST', '/', FAC, draft(extra));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.uid as string;
}
const reserve = (e: any, uid: string, who: number, body: unknown = {}) => call(groupSessions, e, 'POST', `/${uid}/reserve`, who, body);
const names = /Mia|Otto|Ana|mia@|otto@|ana@/;

// ---------------------------------------------------------------------------

test('scheduling: an approved expert, within their practice, free, in the future', async () => {
  const db = setup(); const e = envOf(db);
  assert.equal((await call(facilitator, e, 'POST', '/', FAC, draft({ price_cents: 2000 }))).body.error, 'paid_groups_not_open');
  assert.equal((await call(facilitator, e, 'POST', '/', FAC, draft({ support_type: 'therapy' }))).body.error, 'support_type_outside_practice');
  assert.equal((await call(facilitator, e, 'POST', '/', FAC, draft({ capacity: 1 }))).body.error, 'invalid_capacity');
  assert.equal((await call(facilitator, e, 'POST', '/', FAC, draft({ starts_at: '2026-11-17T12:30:00Z' }))).body.error, 'invalid_starts_at');
  assert.equal((await call(facilitator, e, 'POST', '/', MIA, draft())).body.error, 'not_an_expert');
  db.prepare(`UPDATE experts SET verified = 0 WHERE uid = 'oz'`).run();
  assert.equal((await call(facilitator, e, 'POST', '/', OTHER_FAC, draft({ support_type: 'coaching' }))).body.error, 'expert_not_approved');
  const ok = await call(facilitator, e, 'POST', '/', FAC, draft({ starts_at: '2026-11-19T16:00:00+01:00' }));
  assert.equal(ok.status, 201);
  assert.equal(ok.body.starts_at, START, 'a start with an offset is stored in UTC');
  assert.deepEqual([ok.body.free, ok.body.price_cents, ok.body.capacity, ok.body.seats_left, ok.body.state], [true, 0, 2, 2, 'open']);
  assert.equal(sessionDraft({ ...draft(), price_cents: 0 }, ['nutritionist'], NOW).ok, true);
});

test('a member reserves, is confirmed, finds it in their bookings, and a repeat never takes a second seat', async () => {
  const db = setup(); const e = envOf(db); const uid = await schedule(e);
  const list = await call(groupSessions, e, 'GET', '/', MIA);
  assert.deepEqual(list.body.sessions.map((s: any) => [s.uid, s.seats_left, s.state]), [[uid, 2, 'open']]);
  assert.match(list.body.sessions[0].what_facilitator_learns, /name and email/);
  assert.match(list.body.sessions[0].what_other_members_learn, /^Nothing/);
  const r = await reserve(e, uid, MIA, { calendar: 'discreet' });
  assert.equal(r.status, 201);
  assert.equal(r.body.seats_left, 1);
  assert.equal(r.body.my_reservation.status, 'reserved');
  assert.equal(r.body.bookable, false);
  const again = await reserve(e, uid, MIA);
  assert.equal(again.status, 200);
  assert.equal(again.body.already_reserved, true);
  assert.equal(again.body.seats_left, 1, 'a repeated request took a second seat');
  const mine = await call(groupReservations, e, 'GET', '/mine', MIA);
  assert.deepEqual(mine.body.reservations.map((x: any) => [x.status, x.session.uid]), [['reserved', uid]]);
  const note = db.prepare(`SELECT user_id, title FROM notifications_inbox WHERE type = 'wellbeing_group_reserved'`).all() as any[];
  assert.deepEqual(note.map((n) => n.user_id), [MIA]);
});

test('two members after the last seat: exactly one gets it, the other is told, nothing oversells', async () => {
  const db = setup(); const e = envOf(db); const uid = await schedule(e);
  await reserve(e, uid, MIA);
  const results = await Promise.all([reserve(e, uid, OTTO), reserve(e, uid, ANA)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const loser = results.find((r) => r.status === 409)!;
  assert.equal(loser.body.error, 'session_full');
  assert.ok(!names.test(loser.text), 'the refusal named who took the seat');
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM wellbeing_group_reservations WHERE status = 'reserved'`).get() as any).n;
  assert.equal(count, 2);
  const full = await call(groupSessions, e, 'GET', `/${uid}`, ANA);
  assert.deepEqual([full.body.state, full.body.seats_left, full.body.bookable], ['full', 0, false]);
});

test('a released seat can be taken again, and a member may re-reserve after cancelling', async () => {
  const db = setup(); const e = envOf(db); const uid = await schedule(e);
  const a = await reserve(e, uid, MIA);
  await reserve(e, uid, OTTO);
  assert.equal((await reserve(e, uid, ANA)).status, 409);
  const cancel = await call(groupReservations, e, 'POST', `/${a.body.my_reservation.uid}/cancel`, MIA);
  assert.equal(cancel.status, 200);
  assert.deepEqual([cancel.body.seat_released, cancel.body.refund.applicable], [true, false]);
  assert.equal((await call(groupReservations, e, 'POST', `/${a.body.my_reservation.uid}/cancel`, MIA)).body.error, 'reservation_not_open');
  assert.equal((await reserve(e, uid, ANA)).status, 201, 'the released seat was not offered');
  assert.equal((await reserve(e, uid, MIA)).status, 409, 'cancelled member took a seat that is no longer free');
  await call(groupReservations, e, 'POST', `/${(await call(groupSessions, e, 'GET', `/${uid}`, ANA)).body.my_reservation.uid}/cancel`, ANA);
  const back = await reserve(e, uid, MIA);
  assert.equal(back.status, 201, 'a member who cancelled could not reserve again');
});

test('the cancellation window: open before the cutoff, closed after it, in UTC whatever the member\'s zone', async () => {
  const db = setup(); const e = envOf(db); const uid = await schedule(e, { cancellation_hours: 24 });
  const r = await reserve(e, uid, MIA);
  assert.equal(r.body.cancellation.cutoff_at, '2026-11-18T15:00:00.000Z');
  mock.timers.setTime(Date.parse('2026-11-18T15:30:00Z'));
  const late = await call(groupReservations, e, 'POST', `/${r.body.my_reservation.uid}/cancel`, MIA);
  assert.equal(late.status, 409);
  assert.equal(late.body.error, 'cancellation_window_closed');
  assert.equal(late.body.cutoff_at, '2026-11-18T15:00:00.000Z');
  mock.timers.setTime(Date.parse('2026-11-19T15:00:00Z'));
  assert.equal((await reserve(e, uid, OTTO)).body.error, 'session_started');
});

test('a cancelled occurrence: each member is told alone, no seat can be taken, bookings show it cancelled', async () => {
  const db = setup(); const e = envOf(db); const uid = await schedule(e);
  await reserve(e, uid, MIA); await reserve(e, uid, OTTO);
  assert.equal((await call(groupSessions, e, 'POST', `/${uid}/cancel`, OTHER_FAC, { reason: 'x' })).status, 404, 'another expert cancelled it');
  assert.equal((await call(groupSessions, e, 'POST', `/${uid}/cancel`, FAC, {})).body.error, 'reason_required');
  const c = await call(groupSessions, e, 'POST', `/${uid}/cancel`, FAC, { reason: 'The facilitator is unwell.' });
  assert.equal(c.status, 200);
  assert.equal(c.body.told, 2);
  const notes = db.prepare(`SELECT user_id, body FROM notifications_inbox WHERE type = 'wellbeing_group_cancelled' ORDER BY user_id`).all() as any[];
  assert.deepEqual(notes.map((n) => n.user_id), [MIA, OTTO]);
  for (const n of notes) assert.ok(!names.test(n.body), 'a cancellation notice named another member');
  assert.equal((await reserve(e, uid, ANA)).body.error, 'session_cancelled');
  assert.equal((await call(groupSessions, e, 'GET', '/', ANA)).body.sessions.length, 0);
  assert.equal((await call(groupSessions, e, 'GET', `/${uid}`, ANA)).status, 404, 'a cancelled session was shown to a member who never reserved');
  const mine = await call(groupReservations, e, 'GET', '/mine', MIA);
  assert.deepEqual([mine.body.reservations[0].session.state, mine.body.reservations[0].session.cancelled.reason], ['cancelled', 'The facilitator is unwell.']);
  const tryCancel = await call(groupReservations, e, 'POST', `/${mine.body.reservations[0].uid}/cancel`, MIA);
  assert.equal(tryCancel.body.error, 'session_cancelled');
  const admin = await schedule(e);
  assert.equal((await call(groupSessions, e, 'POST', `/${admin}/cancel`, ADMIN, { reason: 'Taken down by HQ.' })).status, 200);
});

test('confidential attendance: only the facilitator sees who reserved; members see a count', async () => {
  const db = setup(); const e = envOf(db); const uid = await schedule(e, { capacity: 5 });
  await reserve(e, uid, MIA); await reserve(e, uid, OTTO);
  for (const who of [MIA, OTTO, ANA]) {
    const one = await call(groupSessions, e, 'GET', `/${uid}`, who);
    assert.ok(!('attendees' in one.body), 'a member was given the attendee list');
    assert.ok(!names.test(one.text.replace(/what_facilitator_learns[^,]*,/, '')), `member ${who} saw another member`);
    const all = await call(groupSessions, e, 'GET', '/', who);
    assert.ok(!names.test(all.text));
  }
  const fac = await call(facilitator, e, 'GET', '/', FAC);
  assert.deepEqual(fac.body.sessions[0].attendees.map((a: any) => a.name).sort(), ['Mia', 'Otto']);
  const ana = await reserve(e, uid, ANA);
  await call(groupReservations, e, 'POST', `/${ana.body.my_reservation.uid}/cancel`, ANA);
  const after = await call(facilitator, e, 'GET', '/', FAC);
  assert.deepEqual(after.body.sessions[0].attendees.map((a: any) => a.name).sort(), ['Mia', 'Otto'], 'a member who cancelled is still listed');
  const other = await call(facilitator, e, 'GET', '/', OTHER_FAC);
  assert.equal(other.body.sessions.length, 0, 'another expert saw this session\'s attendees');
  assert.equal((await call(groupSessions, e, 'GET', '/', INVESTOR)).status, 403);
});

test('the calendar entry lists no attendee; discreet hides the title; none and another member\'s have none', async () => {
  const db = setup(); const e = envOf(db); const uid = await schedule(e, { capacity: 5 });
  const d = await reserve(e, uid, MIA, { calendar: 'discreet' });
  const n = await reserve(e, uid, OTTO, { calendar: 'named' });
  const x = await reserve(e, uid, ANA, { calendar: 'none' });
  assert.equal((await reserve(e, uid, ANA, { calendar: 'loud' })).body.error, 'invalid_calendar');
  const ics = await call(groupReservations, e, 'GET', `/${d.body.my_reservation.uid}/calendar.ics`, MIA);
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get('content-type') || '', /text\/calendar/);
  assert.match(ics.text, /SUMMARY:Private appointment/);
  assert.match(ics.text, /DTSTART:20261119T150000Z/);
  assert.doesNotMatch(ics.text, /ATTENDEE|ORGANIZER|Eating well|Mia|Otto/);
  const named = await call(groupReservations, e, 'GET', `/${n.body.my_reservation.uid}/calendar.ics`, OTTO);
  assert.match(named.text, /SUMMARY:Axal · Eating well under pressure/);
  assert.doesNotMatch(named.text, /ATTENDEE|Mia/);
  assert.equal((await call(groupReservations, e, 'GET', `/${x.body.my_reservation.uid}/calendar.ics`, ANA)).status, 404);
  assert.equal((await call(groupReservations, e, 'GET', `/${d.body.my_reservation.uid}/calendar.ics`, OTTO)).status, 404, 'another member read the entry');
  assert.match(reservationIcs({ uid: 'u', title: 'T', starts_at: START, duration_minutes: 30, status: 'cancelled' }, 'discreet'), /STATUS:CANCELLED/);
});

test('a facilitator who stops being eligible: sessions leave the list and a reservation is refused at commit', async () => {
  const db = setup(); const e = envOf(db); const uid = await schedule(e);
  db.prepare(`UPDATE experts SET hidden_by_admin = 1 WHERE uid = 'fay'`).run();
  assert.equal((await call(groupSessions, e, 'GET', '/', MIA)).body.sessions.length, 0);
  assert.equal((await reserve(e, uid, MIA)).body.error, 'facilitator_unavailable');
});

test('from a recommendation: a nutrition interest and the group format suggest the session with its reason, and it can be reserved', async () => {
  const db = setup(); const e = envOf(db); const uid = await schedule(e);
  await call(preferences, e, 'PUT', '/', MIA, { support_types: ['nutrition'], formats: ['group'], base_revision: 0 });
  const recs = await call(recommendations, e, 'GET', '/', MIA);
  assert.equal(recs.body.state, 'ok');
  assert.equal(recs.body.group_sessions.offered, true);
  const item = recs.body.items.find((x: any) => x.kind === 'session');
  assert.equal(item.uid, uid);
  assert.ok(item.why.used.some((w: any) => /General nutrition support/.test(w.label)));
  assert.ok(item.why.used.some((w: any) => /group sessions/.test(w.label)));
  assert.ok(!recs.body.items.some((x: any) => x.kind === 'expert'), 'a 1:1 expert was suggested for a group-only member');
  assert.equal((await reserve(e, item.uid, MIA)).status, 201);
  await reserve(e, uid, OTTO);
  const full = await call(recommendations, e, 'GET', '/', ANA);
  assert.equal(full.body.state, 'choose_interests');
  await call(preferences, e, 'PUT', '/', ANA, { support_types: ['nutrition'], formats: ['group'], base_revision: 0 });
  const anaRecs = await call(recommendations, e, 'GET', '/', ANA);
  const fullItem = anaRecs.body.items.find((x: any) => x.uid === uid);
  assert.deepEqual([fullItem.state, fullItem.available, fullItem.seats_left], ['full', false, 0], 'a full session was hidden instead of said');
  await call(preferences, e, 'PUT', '/', ANA, { formats: ['one_to_one'], base_revision: 1 });
  const oneToOne = await call(recommendations, e, 'GET', '/', ANA);
  assert.ok(!oneToOne.body.items.some((x: any) => x.kind === 'session'), 'a group was suggested to a 1:1-only member');
  assert.equal(oneToOne.body.excluded.format, 1);
  await call(preferences, e, 'PUT', '/', ANA, { formats: ['group'], base_revision: 2 });
  await call(recommendations, e, 'POST', '/dismiss', ANA, { kind: 'session', uid });
  assert.ok(!(await call(recommendations, e, 'GET', '/', ANA)).body.items.some((x: any) => x.uid === uid));
});

test('the 1:1 path is untouched: booking an expert still goes through its own route', () => {
  const src = read('cloudflare-worker/src/routes/wellbeing.ts');
  assert.match(src, /wellbeing\.post\('\/experts\/:uid\/book'/);
  assert.match(src, /wellbeing\.post\('\/bookings\/:uid\/cancel'/);
  const groups = read('cloudflare-worker/src/routes/wellbeing_group_sessions.ts');
  assert.doesNotMatch(groups, /expert_bookings/, 'group seats wrote into the 1:1 bookings table');
});

test('the sample prefix written into the literal queries is the seed prefix', () => {
  assert.equal(SAMPLE_PREFIX_IN_SQL, SAMPLE_EXPERT_UID_PREFIX);
  const src = read('cloudflare-worker/src/routes/wellbeing_group_sessions.ts');
  const n = SAMPLE_PREFIX_IN_SQL.length;
  assert.equal((src.match(new RegExp(`substr\\(e\\.uid, 1, ${n}\\) <> '${SAMPLE_PREFIX_IN_SQL}'`, 'g')) || []).length >= 5, true);
});
