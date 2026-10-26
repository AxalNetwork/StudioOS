/**
 * D1211 (#3177, part 6 of #2420) — one Calendar item for the drawer
 * (`GET /calendar/item/:kind/:id`) and a Google Meet link made at create.
 *
 * Runs on the production baseline plus the calendar migrations, as
 * `calendar_items_d1207` does. Google is stubbed: `fetch` answers the token
 * endpoint, makes a Meet event on the conference request, and records every
 * call, so no test reaches a provider host.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import calendar from '../src/routes/calendar.ts';
import { NOT_PARTY } from '../src/services/calendar/itemRead.ts';
import { encryptString } from '../src/services/cryptoBox.ts';

const SECRET = 'synthetic-calendar-1211-'.repeat(3);
const at = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const uidOf = (n: number) => n.toString(16).padStart(32, 'a');
const EMAIL = /@example\.test/;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  for (const name of ['235_calendar_events_kind.sql', '277_user_recovery_state.sql']) db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  // 1 admin · 2 founder · 4, 6 investors on deal 200 · 5 another deal's investor · 9 advisor with a sessions grant.
  for (const i of [1, 2, 4, 5, 6, 9]) db.prepare('INSERT INTO users (id,uid,email,name,role,founder_id) VALUES (?,?,?,?,?,?)')
    .run(i, uidOf(i), `member-${i}@example.test`, `Fixture ${i}`, i === 1 ? 'admin' : i === 2 ? 'founder' : i === 9 ? 'advisor' : 'investor', i === 2 ? 102 : null);
  db.exec(`UPDATE users SET investor_tier='professional' WHERE role='investor';
    UPDATE users SET display_name='Ada Investor' WHERE id=6;
    INSERT INTO projects (id,name,founder_id) VALUES (20,'Fixture venture',102),(30,'Other venture',103);
    INSERT INTO deals (id,project_id) VALUES (200,20),(300,30);
    INSERT INTO deal_invitations (deal_id,investor_user_id) VALUES (200,4),(300,5);
    INSERT INTO commitments (deal_id,investor_user_id,amount) VALUES (200,6,100);
    INSERT INTO advisor_client_grants (uid,project_id,advisor_user_id,granted_by_user_id,scope_sessions) VALUES ('fixture-grant',20,9,2,1);
    INSERT INTO ic_meetings (id,uid,title,agenda,start_at,duration_min,deal_id,organizer_user_id,location_uri) VALUES
      (40,'ic-40','Fixture IC','Traction. Terms. Vote.','${at(24)}',60,200,4,'https://meet.google.com/abc-defg-hij'),
      (41,'ic-41','Cancelled IC',NULL,'${at(30)}',60,200,4,NULL),
      (42,'ic-42','Far IC',NULL,'${at(24 * 700)}',60,200,4,NULL);
    UPDATE ic_meetings SET status='cancelled', cancel_reason='Moved to next week' WHERE id=41;
    INSERT INTO ic_meeting_attendees (meeting_id,user_id,rsvp) VALUES
      (40,4,'accepted'),(40,6,'tentative'),(40,1,'invited'),(41,4,'accepted'),(41,6,'invited'),(42,4,'accepted'),(42,6,'invited');
    INSERT INTO founder_checkins (id,uid,founder_user_id,counterpart_user_id,project_id,title,start_at,status) VALUES
      (50,'ck-50',2,9,20,'Weekly','${at(26)}','scheduled');`);
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
  async function connect(userId: number) {
    db.prepare('INSERT INTO google_oauth_tokens (user_id,refresh_token,scope) VALUES (?,?,?)').run(userId, await encryptString(env, 'synthetic-refresh'), 'https://www.googleapis.com/auth/calendar.events');
  }
  return { db, env, request, settle, connect, async close() { await settle(); db.close(); } };
}

/**
 * Google stubbed. A conference request answers a Meet event; `refuse` makes
 * it answer 403, the way a withdrawn grant does. Every other call is recorded
 * and answered with an id.
 */
function stubGoogle({ refuse = false } = {}) {
  const oldFetch = globalThis.fetch;
  const calls: { url: string; method: string; body: any }[] = [];
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const u = String(url);
    if (u.includes('/token')) return Response.json({ access_token: 'synthetic-access', expires_in: 3600 });
    calls.push({ url: u, method: String(init.method || 'GET'), body: init.body ? JSON.parse(init.body) : null });
    if (u.includes('conferenceDataVersion=1')) {
      if (refuse) return new Response('{}', { status: 403 });
      return Response.json({ id: 'synthmeetevent1', hangoutLink: 'https://meet.google.com/xyz-abcd-efg' });
    }
    return Response.json({ id: u.includes('/events/') ? u.split('/events/')[1] : `synthetic-${calls.length}` });
  }) as typeof fetch;
  return { calls, restore() { globalThis.fetch = oldFetch; } };
}

test('D1211: the drawer\'s item is the page read\'s item, with people by name and the reader\'s own answer', async () => {
  const f = fixture();
  try {
    const res = await f.request('/item/ic_meeting/40', 6);
    assert.equal(res.status, 200);
    const { item } = await res.json();
    assert.equal(item.id, 'ic_meeting:40');
    assert.equal(item.title, 'Fixture IC');
    assert.equal(item.family, 'meetings');
    assert.deepEqual(item.my_role, { code: 'invited', words: 'Invited' });
    assert.deepEqual(item.can, { rsvp: true, reschedule: false, cancel: false, copy: true });
    assert.equal(item.deal_name, 'Fixture venture');
    assert.equal(item.href, '/deals/200');
    assert.equal(item.notes, 'Traction. Terms. Vote.');
    assert.equal(item.location_uri, 'https://meet.google.com/abc-defg-hij');
    assert.equal(item.my_rsvp, 'tentative', 'the reader\'s own answer');
    assert.deepEqual(item.people.map((p: any) => [p.name, p.profile, p.stands, p.answer]).sort(), [
      ['Fixture 1', 'Admin', 'Invited', 'Not answered yet'],
      ['Fixture 4', 'Investor', 'Organiser', 'Going'],
      ['Fixture 6', 'Investor', 'Invited', 'Maybe'],
    ]);
    const text = JSON.stringify(item);
    assert.doesNotMatch(text, EMAIL, 'never an email');
    assert.equal('attendees' in item || 'organizer_email' in item, false);
    assert.equal(item.people.some((p: any) => 'id' in p || 'user_id' in p), false, 'never a user number');

    const organiser = (await (await f.request('/item/ic_meeting/40', 4)).json()).item;
    assert.deepEqual(organiser.can, { rsvp: false, reschedule: true, cancel: true, copy: true });
    assert.equal(organiser.my_rsvp, 'accepted');

    const gone = (await (await f.request('/item/ic_meeting/41', 6)).json()).item;
    assert.equal(gone.status, 'cancelled', 'a cancelled meeting opens, with its reason');
    assert.equal(gone.cancel_reason, 'Moved to next week');
    assert.deepEqual(gone.can, { rsvp: false, reschedule: false, cancel: false, copy: false });

    const far = await f.request('/item/ic_meeting/42', 6);
    assert.equal(far.status, 200, 'an IC meeting is found around its own start, however far out');

    const ck = (await (await f.request('/item/founder_checkin/50', 9)).json()).item;
    assert.equal(ck.project_name, 'Fixture venture');
    assert.deepEqual(ck.people.map((p: any) => [p.name, p.profile, p.stands]), [['Fixture 2', 'Founder', 'Founder'], ['Fixture 9', 'Advisor', 'With the founder']]);
    assert.equal(ck.my_rsvp, null, 'a check-in records no answers: none is invented');
  } finally { await f.close(); }
});

test('D1211 CAL18: a meeting the reader is not part of answers as one that does not exist, and says nothing about it', async () => {
  const f = fixture();
  try {
    for (const [path, user] of [['/item/ic_meeting/40', 5], ['/item/ic_meeting/40', 2], ['/item/ic_meeting/999', 4], ['/item/founder_checkin/50', 4]] as const) {
      const res = await f.request(path, user);
      assert.equal(res.status, 404, `${path} for ${user}`);
      const body = await res.json();
      assert.deepEqual(body, { error: 'not_party', detail: NOT_PARTY });
      assert.doesNotMatch(JSON.stringify(body), /Fixture IC|Weekly|200/);
    }
    assert.equal((await f.request('/item/not_a_kind/40', 4)).status, 400);
    // A source that fails is said, never read as "not part of it".
    f.db.exec('DROP TABLE ic_meeting_attendees');
    const broken = await f.request('/item/ic_meeting/40', 4);
    assert.equal(broken.status, 503);
    assert.equal((await broken.json()).error, 'unreadable');
    assert.equal((await f.request('/item/ic_meeting/x', 4)).status, 400);
  } finally { await f.close(); }
});

test('D1211: "Add a Google Meet link" makes it on the organiser\'s Google account, and that event becomes their copy', async () => {
  const f = fixture();
  const google = stubGoogle();
  try {
    await f.connect(4);
    const start = at(48);
    const res = await f.request('/ic-meetings', 4, 'POST', { title: 'Meet IC', start_at: start, duration_min: 45, deal_id: 200, attendee_uids: [uidOf(6)], add_meet: true });
    assert.equal(res.status, 200);
    const made = await res.json();
    assert.equal(made.location_uri, 'https://meet.google.com/xyz-abcd-efg');
    assert.equal(made.location_kind, 'video');
    const create = google.calls.find((c) => c.url.includes('conferenceDataVersion=1'));
    assert.ok(create, 'createMeeting was asked for a Meet conference');
    assert.equal(create.body.summary, 'Meet IC');
    assert.equal(create.body.start.dateTime, new Date(start).toISOString());
    assert.equal(create.body.end.dateTime, new Date(Date.parse(start) + 45 * 60_000).toISOString());
    assert.equal(f.db.prepare("SELECT external_event_id AS id FROM calendar_sync_records WHERE user_id=4 AND provider='google' AND source_kind='ic_meeting' AND source_id=?").get(made.id)?.id,
      'synthmeetevent1', 'the Meet event is recorded as the organiser\'s copy');
    await f.settle();
    const copies = google.calls.filter((c) => c.url.includes('synthmeetevent1'));
    assert.equal(copies.length, 1, 'the copy hook updates the Meet event');
    assert.equal(copies[0].method, 'PATCH');
    assert.equal(google.calls.filter((c) => c.method === 'POST').length, 1, 'no second event beside it');

    await f.connect(5);
    const ck = await f.request('/founder-checkins', 5, 'POST', { founder_uid: uidOf(2), title: 'Meet check-in', start_at: at(50), add_meet: true });
    assert.equal(ck.status, 403, 'the check-in rules still apply before any link is made');
    assert.equal(google.calls.filter((c) => c.url.includes('conferenceDataVersion=1')).length, 1, 'no link for a refused booking');

    await f.connect(9);
    const ok = await f.request('/founder-checkins', 9, 'POST', { founder_uid: uidOf(2), title: 'Meet check-in', start_at: at(50), add_meet: true });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).location_uri, 'https://meet.google.com/xyz-abcd-efg');
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM calendar_sync_records WHERE user_id=9 AND source_kind='founder_checkin'").get()?.n, 1);

    const plain = await f.request('/ic-meetings', 4, 'POST', { title: 'Plain IC', start_at: start, deal_id: 200, location_uri: 'https://example.test/room' });
    assert.equal((await plain.json()).location_uri, 'https://example.test/room', 'without the switch a pasted link is kept and no Meet is made');
    assert.equal(google.calls.filter((c) => c.url.includes('conferenceDataVersion=1')).length, 2);
  } finally { google.restore(); await f.close(); }
});

test('D1211: a Meet link that cannot be made saves nothing and says why, in our words', async () => {
  const f = fixture();
  const google = stubGoogle({ refuse: true });
  try {
    const none = await f.request('/ic-meetings', 4, 'POST', { title: 'Meet IC', start_at: at(48), deal_id: 200, add_meet: true });
    assert.equal(none.status, 409);
    const said = await none.json();
    assert.equal(said.error, 'meet_not_connected');
    assert.match(said.message, /Google is not connected/);
    assert.equal(google.calls.length, 0, 'nobody connected: Google is not asked');

    await f.connect(4);
    const refused = await f.request('/ic-meetings', 4, 'POST', { title: 'Meet IC', start_at: at(48), deal_id: 200, add_meet: true });
    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).error, 'meet_reconnect');
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM ic_meetings WHERE title='Meet IC'").get()?.n, 0, 'nothing saved');
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM calendar_sync_records').get()?.n, 0);
  } finally { google.restore(); await f.close(); }
});

test('D1211 CAL8: a founder booking a check-in picks only who it is with; the founder is themselves', async () => {
  const f = fixture();
  try {
    const res = await f.request('/founder-checkins', 2, 'POST', { counterpart_uid: uidOf(9), title: 'Weekly with my advisor', start_at: at(60) });
    assert.equal(res.status, 200);
    const made = await res.json();
    assert.equal(made.founder.user_id, 2);
    assert.equal(made.counterpart.user_id, 9);
    const other = await f.request('/founder-checkins', 9, 'POST', { title: 'No founder named', start_at: at(60) });
    assert.equal(other.status, 400, 'anyone else still names the founder');
  } finally { await f.close(); }
});
