/**
 * D1207 (#3173, part 2 of #2420) — what each Calendar item carries, cancelled
 * and pending rows, Reschedule moving the calendar copies, and the people and
 * deal pickers.
 *
 * Runs on the production baseline plus the calendar migrations, as
 * `calendar_privacy_2440` does. Google is stubbed: `fetch` answers the token
 * endpoint and records every other call, so no test reaches a provider host.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import calendar from '../src/routes/calendar.ts';
import * as service from '../src/services/calendar.ts';
import { canOf, COPYABLE_KINDS, hrefOf } from '../src/services/calendar/items.ts';
import { encryptString } from '../src/services/cryptoBox.ts';

const SECRET = 'synthetic-calendar-1207-'.repeat(3);
const at = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const FROM = at(-48);
const TO = at(30 * 24);
const uidOf = (n: number) => n.toString(16).padStart(32, 'a');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  for (const name of ['235_calendar_events_kind.sql', '277_user_recovery_state.sql']) db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  // 1 admin · 2, 3 founders · 4, 5, 6 investors · 7 cofounder · 8 removed advisor ·
  // 9 advisor with a sessions grant · 10 someone else's person · 11 lead partner ·
  // 12 a partner with a commitment row (not a party: only an investor commits) ·
  // 13 an investor account on Fixture venture's founder record (not a founder).
  for (let i = 1; i <= 13; i++) db.prepare('INSERT INTO users (id,uid,email,name,role,founder_id) VALUES (?,?,?,?,?,?)')
    .run(i, uidOf(i), `member-${i}@example.test`, `Fixture ${i}`, i === 1 ? 'admin' : i === 2 || i === 3 ? 'founder' : 'investor', i === 2 ? 102 : i === 3 ? 103 : null);
  db.exec("UPDATE users SET investor_tier='professional' WHERE role='investor'");
  db.exec(`INSERT INTO projects (id,name,founder_id) VALUES (20,'Fixture venture',102),(30,'Other venture',103);
    INSERT INTO deals (id,project_id) VALUES (200,20),(300,30);
    INSERT INTO deal_invitations (deal_id,investor_user_id) VALUES (200,4),(300,5);
    INSERT INTO commitments (deal_id,investor_user_id,amount) VALUES (200,6,100),(200,12,50);
    INSERT INTO project_members (project_id,user_id,role,status) VALUES (20,7,'cofounder','accepted'),(20,8,'advisor','removed');
    UPDATE users SET role='founder' WHERE id=7;
    UPDATE users SET role='advisor' WHERE id IN (8,9);
    UPDATE users SET role='partner' WHERE id IN (11,12);
    UPDATE deals SET lead_partner_id=11 WHERE id=200;
    UPDATE users SET founder_id=102 WHERE id=13;
    INSERT INTO advisor_client_grants (uid,project_id,advisor_user_id,granted_by_user_id,scope_sessions)
      VALUES ('fixture-grant',20,9,2,1);`);
  const DB = { prepare(sql: string) { let args: any[] = []; const statement: any = {
    bind(...values: any[]) { args = values.map(v => v ?? null); return statement; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  }; return statement; }, async exec(sql: string) { db.exec(sql); } };
  const env: any = { DB, ENVIRONMENT: 'production', JWT_SECRET: SECRET, APP_URL: 'https://example.test',
    GOOGLE_CAL_CLIENT_ID: 'synthetic-client', GOOGLE_CAL_CLIENT_SECRET: 'synthetic-secret' };
  let pending: Promise<unknown>[] = [];
  async function request(path: string, user = 1, method = 'GET', body?: unknown) {
    const token = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    return calendar.request(path, { method, headers: { Cookie: `studioos_auth=${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env, { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {} });
  }
  async function settle() { const p = pending; pending = []; await Promise.all(p); }
  return { db, env, request, settle, async close() { await settle(); db.close(); } };
}

/** Google stubbed: the token endpoint answers, every other call is recorded and answered with an id. */
function stubGoogle() {
  const oldFetch = globalThis.fetch;
  const calls: { url: string; method: string; body: any }[] = [];
  globalThis.fetch = (async (url: any, init: any = {}) => {
    if (String(url).includes('/token')) return Response.json({ access_token: 'synthetic-access', expires_in: 3600 });
    calls.push({ url: String(url), method: String(init.method || 'GET'), body: init.body ? JSON.parse(init.body) : null });
    return Response.json({ id: `synthetic-${calls.length}` });
  }) as typeof fetch;
  return { calls, restore() { globalThis.fetch = oldFetch; } };
}

function seedItems(db: DatabaseSync) {
  db.exec(`INSERT INTO ic_meetings (id,uid,title,start_at,duration_min,deal_id,organizer_user_id) VALUES
      (40,'ic-40','Fixture IC','${at(24)}',60,200,4),
      (41,'ic-41','Cancelled IC','${at(30)}',60,200,4);
    UPDATE ic_meetings SET status='cancelled', cancel_reason='Moved to next week' WHERE id=41;
    INSERT INTO ic_meeting_attendees (meeting_id,user_id,rsvp) VALUES (40,4,'accepted'),(40,6,'invited'),(41,4,'accepted'),(41,6,'invited');
    INSERT INTO founder_checkins (id,uid,founder_user_id,counterpart_user_id,project_id,title,start_at,status) VALUES
      (50,'ck-50',2,9,20,'Weekly','${at(26)}','scheduled'),
      (51,'ck-51',2,9,20,'Cancelled weekly','${at(28)}','cancelled');
    INSERT INTO advisors (id,uid,user_id,display_name,timezone) VALUES (70,'advisor-uid-70',9,'Fixture 9','Europe/Lisbon');
    UPDATE users SET advisor_id=70 WHERE id=9;
    INSERT INTO advisor_office_hour_slots (id,uid,advisor_id,starts_at,ends_at) VALUES (60,'slot-60',70,'${at(27)}','${at(28)}'),(61,'slot-61',70,'${at(29)}','${at(30)}');
    INSERT INTO advisor_bookings (uid,slot_id,advisor_id,founder_user_id,topic) VALUES ('ab-60',60,70,2,'Pricing');
    INSERT INTO advisor_bookings (uid,slot_id,advisor_id,founder_user_id,topic,status,cancel_reason) VALUES ('ab-61',61,70,2,'Hiring','cancelled','slot_cancelled');`);
}

const byId = (items: any[]) => new Map(items.map((i) => [i.id, i]));

test('D1207: each item carries its family, role, actions, page, names and reason; a cancelled row comes back, a pending one stays pending', async () => {
  const f = fixture();
  try {
    seedItems(f.db);
    const res = await f.request(`/events?from=${FROM}&to=${TO}`, 4);
    assert.equal(res.status, 200);
    const mine = byId((await res.json()).items);
    const ic = mine.get('ic_meeting:40');
    assert.equal(ic.family, 'meetings');
    assert.deepEqual(ic.my_role, { code: 'organiser', words: 'Organiser' });
    assert.deepEqual(ic.can, { rsvp: false, reschedule: true, cancel: true, copy: true });
    assert.equal(ic.href, '/deals/200');
    assert.equal(ic.deal_name, 'Fixture venture');
    assert.equal(ic.project_name, null);
    assert.equal(ic.all_day, false);
    assert.equal(ic.time_zone, null, 'nothing records an IC meeting\'s zone: null, never a guess');
    assert.equal(ic.cancel_reason, null);
    assert.equal('advisor_uid' in ic, false);
    const gone = mine.get('ic_meeting:41');
    assert.ok(gone, 'a cancelled IC meeting in range comes back');
    assert.equal(gone.status, 'cancelled');
    assert.equal(gone.cancel_reason, 'Moved to next week');
    assert.deepEqual(gone.can, { rsvp: false, reschedule: false, cancel: false, copy: false }, 'no actions on a cancelled meeting');

    const invited = byId((await (await f.request(`/events?from=${FROM}&to=${TO}`, 6)).json()).items).get('ic_meeting:40');
    assert.deepEqual(invited.my_role, { code: 'invited', words: 'Invited' });
    assert.deepEqual(invited.can, { rsvp: true, reschedule: false, cancel: false, copy: true });

    const founder = byId((await (await f.request(`/events?from=${FROM}&to=${TO}`, 2)).json()).items);
    const ck = founder.get('founder_checkin:50');
    assert.equal(ck.family, 'meetings');
    assert.equal(ck.project_name, 'Fixture venture');
    assert.equal(ck.href, '/projects/20');
    assert.deepEqual(ck.my_role, { code: 'invited', words: 'Invited' }, 'the counterpart organises, as organizer_email has always said');
    assert.equal(ck.can.reschedule, true);
    const ckGone = founder.get('founder_checkin:51');
    assert.equal(ckGone.status, 'cancelled');
    assert.equal(ckGone.cancel_reason, null, 'founder_checkins records no reason');
    const booking = [...founder.values()].find((i) => i.kind === 'advisor_booking' && i.status !== 'cancelled');
    assert.equal(booking.status, 'pending', 'a pending booking stays pending');
    assert.equal(booking.family, 'sessions');
    assert.deepEqual(booking.my_role, { code: 'booked', words: 'Booked by you' });
    assert.equal(booking.time_zone, 'Europe/Lisbon');
    assert.equal(booking.href, '/advisors/advisor-uid-70');
    assert.equal('advisor_uid' in booking, false, 'the advisor uid builds the page and is not carried');
    assert.deepEqual(booking.can, { rsvp: false, reschedule: false, cancel: false, copy: true }, 'the booking page handles its cancel');
    const bookingGone = [...founder.values()].find((i) => i.kind === 'advisor_booking' && i.status === 'cancelled');
    assert.equal(bookingGone.cancel_reason, 'The host cancelled this time.');

    const giving = [...byId((await (await f.request(`/events?from=${FROM}&to=${TO}`, 9)).json()).items).values()].find((i) => i.kind === 'advisor_booking');
    assert.deepEqual(giving.my_role, { code: 'giving', words: 'You give this session' });
    assert.equal(giving.href, '/practice/sessions');

    // The feed, the sync and the push never see a cancelled row.
    const strict = await service.fetchUserEvents(f.env, 4, 'investor', FROM, TO);
    assert.deepEqual(strict.map((e) => e.id).sort(), ['ic_meeting:40']);
    const ics = await (await f.request(`/events.ics?from=${FROM}&to=${TO}`, 4)).text();
    assert.match(ics, /SUMMARY:Fixture IC/);
    assert.equal(ics.includes('Cancelled IC'), false);
    const founderStrict = await service.fetchUserEvents(f.env, 2, 'founder', FROM, TO);
    assert.equal(founderStrict.some((e) => e.status === 'cancelled'), false);
  } finally { await f.close(); }
});

test('D1207: an item offers Copy for exactly the kinds the push route accepts', () => {
  const route = readFileSync(new URL('../src/routes/calendar.ts', import.meta.url), 'utf8');
  const set = route.match(/const PUSHABLE_KINDS = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
  const kinds = [...set.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
  assert.equal(kinds.length, 6, 'the route PUSHABLE_KINDS set did not parse');
  assert.deepEqual([...COPYABLE_KINDS].sort(), kinds);
});

test('D1207: the item rules, case by case', () => {
  const base: any = { id: 'x', kind: 'ic_meeting', source_id: 1, source_uid: 'u', title: 't', start_at: at(1), end_at: at(2), status: 'scheduled', location_kind: null, location_uri: null, organizer_email: null, attendees: [], notes: null };
  assert.equal(canOf({ ...base, my_role: 'invited' }, true).reschedule, true, 'an admin attendee may move an IC meeting');
  assert.equal(canOf({ ...base, my_role: 'invited' }, false).reschedule, false);
  assert.equal(canOf({ ...base, my_role: 'organiser', end_at: at(-1) }, false).reschedule, false, 'an ended meeting is not moved');
  assert.equal(canOf({ ...base, my_role: 'organiser', end_at: at(-1) }, false).copy, true);
  assert.equal(canOf({ ...base, kind: 'calendly_event' }, true).copy, false, 'StudioOS cannot copy a Calendly booking');
  assert.equal(hrefOf({ ...base, kind: 'event_ticket', event_id: 9 }), '/my/events/ticket/9');
  assert.equal(hrefOf({ ...base, kind: 'event_hosted', event_id: 9 }), '/my/events/hosting/9');
  assert.equal(hrefOf({ ...base, kind: 'calendly_event' }), null);
  assert.equal(hrefOf({ ...base, kind: 'ic_meeting', deal_id: null }), null);
});

test('D1207: Reschedule moves the meeting and its calendar copies; only the organiser or an admin moves an IC meeting', async () => {
  const f = fixture();
  const google = stubGoogle();
  try {
    seedItems(f.db);
    const token = await encryptString(f.env, 'synthetic-refresh');
    f.db.prepare('INSERT INTO google_oauth_tokens (user_id,refresh_token) VALUES (6,?)').run(token);
    f.db.prepare("INSERT INTO calendar_sync_records (user_id,provider,source_kind,source_id,external_event_id,last_synced_at) VALUES (6,'google','ic_meeting',40,'copy-of-40',?)").run(at(-1));
    const next = at(72);
    assert.equal((await f.request('/ic-meetings/40', 6, 'PATCH', { start_at: next })).status, 403, 'an invitee does not move it');
    assert.equal((await f.request('/ic-meetings/40', 4, 'PATCH', { start_at: at(-2) })).status, 400, 'a start in the past');
    assert.equal((await f.request('/ic-meetings/40', 4, 'PATCH', {})).status, 400, 'no start');
    assert.equal((await f.request('/ic-meetings/999', 4, 'PATCH', { start_at: next })).status, 404);
    const cancelled = await f.request('/ic-meetings/41', 4, 'PATCH', { start_at: next });
    assert.equal(cancelled.status, 409);
    assert.equal((await cancelled.json()).error, 'cancelled');
    await f.settle();
    assert.equal(google.calls.length, 0, 'a refused reschedule copies nothing');

    const moved = await f.request('/ic-meetings/40', 4, 'PATCH', { start_at: next, duration_min: 90 });
    assert.equal(moved.status, 200);
    const body = await moved.json();
    assert.equal(body.start_at, next);
    assert.equal(body.duration_min, 90);
    assert.deepEqual({ ...f.db.prepare('SELECT start_at, duration_min FROM ic_meetings WHERE id=40').get() }, { start_at: next, duration_min: 90 });
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM activity_logs WHERE action='calendar_ic_rescheduled' AND user_id=4").get()?.n, 1);
    await f.settle();
    const patch = google.calls.find((c) => c.url.endsWith('/events/copy-of-40'));
    assert.ok(patch, 'the attendee\'s existing copy is updated, not duplicated');
    assert.equal(patch.method, 'PATCH');
    assert.equal(patch.body.start.dateTime, next);
    assert.equal(patch.body.end.dateTime, new Date(new Date(next).getTime() + 90 * 60_000).toISOString());
    assert.equal(google.calls.some((c) => c.method === 'POST'), false);

    // An admin moves it too; the length is kept when none is given.
    const later = at(96);
    assert.equal((await f.request('/ic-meetings/40', 1, 'PATCH', { start_at: later })).status, 200);
    assert.equal(f.db.prepare('SELECT duration_min FROM ic_meetings WHERE id=40').get()?.duration_min, 90);
  } finally { await f.close(); google.restore(); }
});

test('D1207: either person on a check-in, or an admin, reschedules it, and the copies move', async () => {
  const f = fixture();
  const google = stubGoogle();
  try {
    seedItems(f.db);
    f.db.prepare('INSERT INTO google_oauth_tokens (user_id,refresh_token) VALUES (2,?)').run(await encryptString(f.env, 'synthetic-refresh'));
    f.db.prepare("INSERT INTO calendar_sync_records (user_id,provider,source_kind,source_id,external_event_id,last_synced_at) VALUES (2,'google','founder_checkin',50,'copy-of-50',?)").run(at(-1));
    const next = at(50);
    assert.equal((await f.request('/founder-checkins/50', 10, 'PATCH', { start_at: next })).status, 403);
    assert.equal((await f.request('/founder-checkins/51', 2, 'PATCH', { start_at: next })).status, 409);
    const moved = await f.request('/founder-checkins/50', 9, 'PATCH', { start_at: next, duration_min: 999 });
    assert.equal(moved.status, 200);
    assert.equal((await moved.json()).duration_min, 240, 'held to the check-in range, as create holds it');
    assert.equal(f.db.prepare('SELECT start_at FROM founder_checkins WHERE id=50').get()?.start_at, next);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM activity_logs WHERE action='calendar_checkin_rescheduled'").get()?.n, 1);
    await f.settle();
    const patch = google.calls.find((c) => c.url.endsWith('/events/copy-of-50'));
    assert.ok(patch);
    assert.equal(patch.method, 'PATCH');
    assert.equal(patch.body.start.dateTime, next);
  } finally { await f.close(); google.restore(); }
});

function assertNoContact(json: string) {
  assert.equal(/@/.test(json), false, 'no email in the response');
  assert.equal(/"(email|user_id|id)":/.test(json.replace(/"ventures":\[[^\]]*\]/g, '')), false, 'no user number or email key on a person');
}

test('D1207: the IC people picker offers only the deal\'s people, by uid and name, never an email or another venture\'s people', async () => {
  const f = fixture();
  try {
    const res = await f.request('/people?for=ic&deal_id=200', 4);
    assert.equal(res.status, 200);
    const text = await res.text();
    assertNoContact(text);
    const items = JSON.parse(text).items;
    assert.deepEqual(items.map((p: any) => p.uid).sort(), [2, 6, 7, 9, 11].map(uidOf).sort(), 'the deal\'s founder, committed investor, team, advisor and lead; not the caller, the removed advisor or anyone else');
    const lead = items.find((p: any) => p.uid === uidOf(11));
    assert.deepEqual(lead.how, ['Lead partner on Fixture venture']);
    assert.equal(lead.profile, 'Operating Partner');
    assert.equal(lead.name, 'Fixture 11');
    assert.deepEqual(items.find((p: any) => p.uid === uidOf(6)).how, ['Committed to Fixture venture']);
    assert.deepEqual(items.find((p: any) => p.uid === uidOf(9)).how, ['Advisor to Fixture venture']);
    const q = await (await f.request('/people?for=ic&deal_id=200&q=fixture%2011', 4)).json();
    assert.deepEqual(q.items.map((p: any) => p.uid), [uidOf(11)]);
    assert.equal((await f.request('/people?for=ic', 4)).status, 400, 'the deal comes first');
    assert.equal((await f.request('/people?for=ic&deal_id=200', 2)).status, 403, 'a founder does not schedule an IC meeting');
    assert.equal((await f.request('/people?for=ic&deal_id=200', 5)).status, 403, 'an investor of another deal');
    assert.equal((await f.request('/people', 4)).status, 400);
    f.db.exec("UPDATE deal_invitations SET status='passed' WHERE investor_user_id=4");
    assert.equal((await f.request('/people?for=ic&deal_id=200', 4)).status, 403, 'an investor who passed no longer schedules on the deal');
  } finally { await f.close(); }
});

test('D1207: the check-in people picker offers the people you work with, and the creates take their uids', async () => {
  const f = fixture();
  const google = stubGoogle();
  try {
    const asFounder = await f.request('/people?for=checkin', 2);
    const text = await asFounder.text();
    assertNoContact(text);
    const items = JSON.parse(text).items;
    assert.deepEqual(items.map((p: any) => p.uid).sort(), [4, 6, 7, 9, 11].map(uidOf).sort());
    assert.deepEqual(items.find((p: any) => p.uid === uidOf(4)).ventures, [{ id: 20, name: 'Fixture venture' }]);
    const asAdvisor = await (await f.request('/people?for=checkin', 9)).json();
    assert.deepEqual(asAdvisor.items.map((p: any) => [p.uid, p.how]), [[uidOf(2), ['Founder of Fixture venture']]]);
    f.db.exec('UPDATE advisor_client_grants SET scope_sessions=0');
    assert.deepEqual((await (await f.request('/people?for=checkin', 9)).json()).items, [], 'a grant without sessions books nobody, as the create refuses it');
    f.db.exec('UPDATE advisor_client_grants SET scope_sessions=1');
    const asOutsider = await (await f.request('/people?for=checkin', 10)).json();
    assert.deepEqual(asOutsider.items, [], 'someone who works on no venture is offered nobody');

    const ck = await f.request('/founder-checkins', 2, 'POST', { title: 'Picker check-in', founder_uid: uidOf(2), counterpart_uid: uidOf(9), project_id: 20, start_at: at(24) });
    assert.equal(ck.status, 200);
    assert.equal(f.db.prepare("SELECT counterpart_user_id FROM founder_checkins WHERE title='Picker check-in'").get()?.counterpart_user_id, 9);
    assert.equal((await f.request('/founder-checkins', 2, 'POST', { title: 'Picker check-in', founder_uid: uidOf(2), counterpart_uid: uidOf(10), project_id: 20, start_at: at(24) })).status, 403, 'the create\'s rule still applies to a uid');
    assert.equal((await f.request('/founder-checkins', 2, 'POST', { title: 'Picker check-in', founder_uid: 'not-a-uid', start_at: at(24) })).status, 404);

    const ic = await f.request('/ic-meetings', 4, 'POST', { title: 'Picker IC', deal_id: 200, start_at: at(24), attendee_uids: [uidOf(6)] });
    assert.equal(ic.status, 200);
    const meeting = await ic.json();
    assert.deepEqual(f.db.prepare('SELECT user_id FROM ic_meeting_attendees WHERE meeting_id=? ORDER BY user_id').all(meeting.id).map((r: any) => r.user_id), [4, 6]);
    assert.equal((await f.request('/ic-meetings', 4, 'POST', { title: 'Picker IC', deal_id: 200, start_at: at(24), attendee_uids: [uidOf(5)] })).status, 403);
    assert.equal((await f.request('/ic-meetings', 4, 'POST', { title: 'Picker IC', deal_id: 200, start_at: at(24), attendee_uids: ['nobody'] })).status, 400);
  } finally { await f.close(); google.restore(); }
});

test('D1207: the deal picker lists the deals the caller can open, by venture name', async () => {
  const f = fixture();
  try {
    assert.deepEqual((await (await f.request('/deals', 4)).json()).items, [{ id: 200, name: 'Fixture venture', status: 'applied' }]);
    assert.deepEqual((await (await f.request('/deals', 5)).json()).items.map((d: any) => d.id), [300]);
    assert.deepEqual((await (await f.request('/deals', 1)).json()).items.map((d: any) => d.id), [200, 300]);
    assert.deepEqual((await (await f.request('/deals?q=other', 1)).json()).items.map((d: any) => d.id), [300]);
    f.db.exec("UPDATE deal_invitations SET status='passed' WHERE investor_user_id=4");
    assert.deepEqual((await (await f.request('/deals', 4)).json()).items, [], 'an investor who passed no longer schedules on it');
    assert.deepEqual((await (await f.request('/deals', 10)).json()).items, []);
    assert.deepEqual((await (await f.request('/deals', 2)).json()).items.map((d: any) => d.id), [200], 'a founder opens their own venture\'s deal only');
  } finally { await f.close(); }
});
