/**
 * D1033 (#2874): event tickets and hosted events in the unified calendar, its
 * .ics feed and the Google and Outlook sync, and the add-to links.
 *
 * The fixture is the production baseline plus the real additive migrations the
 * calendar suites already apply. Every row is synthetic: `example.test`
 * addresses, `Fixture` names, made-up titles and join links.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import calendar from '../src/routes/calendar.ts';
import * as service from '../src/services/calendar.ts';
import { placeOf, addToCalendarLinks, eventVisibleTo } from '../src/services/calendar/myEvents.ts';
import { canViewEvent } from '../src/routes/events.ts';
import { encryptString } from '../src/services/cryptoBox.ts';

const SECRET = 'synthetic-calendar-d1033-'.repeat(3);
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const FROM = day(-2);
const TO = day(60);
const JOIN = 'https://meet.example.test/fixture-room';
const MAPS = 'https://maps.example.test/fixture-venue';

// Users: 1 admin, 2 founder (a host), 3-6 investors (ticket holders).
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  for (const name of ['235_calendar_events_kind.sql', '277_user_recovery_state.sql']) {
    db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  }
  for (let i = 1; i <= 6; i++) {
    db.prepare('INSERT INTO users (id,email,name,role) VALUES (?,?,?,?)')
      .run(i, `member-${i}@example.test`, `Fixture ${i}`, i === 1 ? 'admin' : i === 2 ? 'founder' : 'investor');
  }
  const DB = { prepare(sql: string) { let args: any[] = []; const statement: any = {
    bind(...values: any[]) { args = values.map(v => v ?? null); return statement; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  }; return statement; }, async exec(sql: string) { db.exec(sql); } };
  const env: any = { DB, ENVIRONMENT: 'production', JWT_SECRET: SECRET, APP_URL: 'https://app.example.test',
    GOOGLE_CAL_CLIENT_ID: 'synthetic-client', GOOGLE_CAL_CLIENT_SECRET: 'synthetic-secret',
    MICROSOFT_CLIENT_ID: 'synthetic-client', MICROSOFT_CLIENT_SECRET: 'synthetic-secret' };
  async function request(path: string, user: number, body?: unknown) {
    const token = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    return calendar.request(path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: `studioos_auth=${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env, { waitUntil() {}, passThroughOnException() {} });
  }
  return { db, env, request };
}

function event(db: DatabaseSync, id: number, o: Record<string, unknown> = {}) {
  const row = {
    slug: `fixture-${id}`, host_user_id: 2, title: `Fixture event ${id}`, summary: `Summary ${id}`,
    starts_at: day(id), ends_at: day(id).replace(/T(\d\d)/, (_m, h) => `T${String((Number(h) + 2) % 24).padStart(2, '0')}`),
    location_kind: 'virtual', location_text: null, location_url: JOIN, visibility: 'unlisted', status: 'published', ...o,
  } as Record<string, any>;
  db.prepare(`INSERT INTO events (id,slug,host_user_id,title,summary,starts_at,ends_at,location_kind,location_text,location_url,visibility,status)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, row.slug, row.host_user_id, row.title, row.summary, row.starts_at, row.ends_at, row.location_kind,
      row.location_text, row.location_url, row.visibility, row.status);
}
function reg(db: DatabaseSync, id: number, eventId: number, userId: number, status: string, o: Record<string, unknown> = {}) {
  db.prepare(`INSERT INTO event_registrations (id,event_id,user_id,email,status,payment_status,waitlist_position)
              VALUES (?,?,?,?,?,?,?)`)
    .run(id, eventId, userId, `member-${userId}@example.test`, status, (o.payment_status as string) ?? 'none', (o.waitlist_position as number) ?? null);
}

/**
 * Events 1-9 (online unless said):
 *   1 published, 3 holds a confirmed seat (Going)      reg 11
 *   2 published, 3 is waitlisted #3                     reg 12
 *   3 published, 3 waits for the host's approval        reg 13
 *   4 published, 3 holds a seat with payment pending    reg 14
 *   5 published, 3 cancelled their place                reg 15
 *   6 published, 3 was declined                         reg 16
 *   7 cancelled event, 3 still holds a confirmed row    reg 17
 *   8 in person, 3 is waitlisted                        reg 18
 *   9 hosted by 3 (who also registered for it)          reg 19
 * Host 2 also has 10 draft, 11 rejected, 12 cancelled.
 */
function seed(db: DatabaseSync) {
  for (const id of [1, 2, 3, 4, 5, 6]) event(db, id);
  event(db, 7, { status: 'cancelled' });
  event(db, 8, { location_kind: 'in_person', location_text: 'Fixture Hall, 1 Example Street', location_url: MAPS });
  event(db, 9, { host_user_id: 3 });
  event(db, 10, { status: 'draft' });
  event(db, 11, { status: 'rejected' });
  event(db, 12, { status: 'cancelled' });
  event(db, 13, { visibility: 'private', host_user_id: 2 });
  reg(db, 11, 1, 3, 'confirmed');
  reg(db, 12, 2, 3, 'waitlisted', { waitlist_position: 3 });
  reg(db, 13, 3, 3, 'registered');
  reg(db, 14, 4, 3, 'confirmed', { payment_status: 'pending' });
  reg(db, 15, 5, 3, 'cancelled');
  reg(db, 16, 6, 3, 'declined');
  reg(db, 17, 7, 3, 'confirmed');
  reg(db, 18, 8, 3, 'waitlisted', { waitlist_position: 1 });
  reg(db, 19, 9, 3, 'confirmed');
  // A second member waitlisted on event 1, whose join link member 3 may read.
  reg(db, 21, 1, 4, 'waitlisted', { waitlist_position: 1 });
  // One row of an older kind, which a my-events feed must leave out.
  db.prepare(`INSERT INTO calendar_events (uid,user_id,source,external_uri,title,start_at,end_at,kind)
              VALUES ('axal-fixture',3,'axal','axal:fixture','Fixture expert session',?,?,'expert_booking')`).run(day(3), day(3));
}

test('placeOf names every place in the canvas words, and nothing else is a place', () => {
  assert.deepEqual(placeOf({ status: 'confirmed', payment_status: 'none' })?.words, 'Going');
  assert.deepEqual(placeOf({ status: 'confirmed', payment_status: 'paid' })?.words, 'Going');
  assert.deepEqual(placeOf({ status: 'confirmed', payment_status: 'pending' })?.words, 'Pay to confirm');
  assert.deepEqual(placeOf({ status: 'registered' })?.words, 'Waiting for the host');
  assert.deepEqual(placeOf({ status: 'waitlisted', waitlist_position: 3 })?.words, 'Waitlist · #3');
  assert.deepEqual(placeOf({ status: 'waitlisted', waitlist_position: null })?.words, 'Waitlist');
  assert.deepEqual(placeOf({ status: 'attended' })?.words, 'Checked in');
  for (const status of ['cancelled', 'declined', '', null]) assert.equal(placeOf({ status }), null, String(status));
});

test('tickets and hosted events are calendar kinds: each place marked, cancelled places and events gone', async () => {
  const f = fixture();
  seed(f.db);
  const mine = await service.fetchUserEvents(f.env, 3, 'investor', FROM, TO, ['event_ticket', 'event_hosted']);
  const byId = new Map(mine.map(e => [e.id, e]));
  assert.deepEqual([...byId.keys()].sort(), [
    'event_hosted:9',
    'event_ticket:11', 'event_ticket:12', 'event_ticket:13', 'event_ticket:14', 'event_ticket:18',
  ]);
  // Going: plain title, the join link, held.
  const going = byId.get('event_ticket:11')!;
  assert.equal(going.title, 'Fixture event 1');
  assert.equal(going.location_uri, JOIN);
  assert.equal(going.ics_status, 'CONFIRMED');
  assert.equal(going.status, 'going');
  assert.equal(going.url, 'https://app.example.test/events/1');
  assert.deepEqual(going.attendees, []);
  assert.equal(going.organizer_email, null);
  // Waitlist: marked in the title, no join link, tentative, and the reason said.
  const wait = byId.get('event_ticket:12')!;
  assert.equal(wait.title, 'Waitlist · #3: Fixture event 2');
  assert.equal(wait.location_uri, null);
  assert.equal(wait.ics_status, 'TENTATIVE');
  assert.match(wait.notes || '', /The join link shows once you hold a seat\./);
  assert.equal(byId.get('event_ticket:13')!.title, 'Waiting for the host: Fixture event 3');
  assert.equal(byId.get('event_ticket:13')!.location_uri, null);
  assert.equal(byId.get('event_ticket:14')!.title, 'Pay to confirm: Fixture event 4');
  assert.equal(byId.get('event_ticket:14')!.location_uri, null);
  // In person: the address is not a join link, so a waitlisted member has it.
  const room = byId.get('event_ticket:18')!;
  assert.equal(room.location_uri, MAPS);
  assert.equal(room.place, 'Fixture Hall, 1 Example Street');
  assert.equal(room.location_kind, 'room');
  // Hosting their own event lists it once, as hosted, with the link.
  assert.equal(byId.get('event_hosted:9')!.location_uri, JOIN);
  assert.equal(byId.has('event_ticket:19'), false);

  const host = await service.fetchUserEvents(f.env, 2, 'founder', FROM, TO, ['event_ticket', 'event_hosted']);
  const hosted = new Map(host.map(e => [e.source_id, e]));
  assert.deepEqual([...hosted.keys()].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 8, 10, 11, 13]);
  assert.equal(hosted.get(1)!.title, 'Fixture event 1');
  assert.equal(hosted.get(10)!.title, 'Draft: Fixture event 10');
  assert.equal(hosted.get(11)!.title, 'Sent back: Fixture event 11');
  assert.equal(hosted.get(10)!.ics_status, 'TENTATIVE');
  assert.equal(hosted.get(1)!.ics_status, 'CONFIRMED');

  // The page's read reports both new sources.
  const page = await f.request(`/events?from=${FROM}&to=${TO}&kinds=event_ticket,event_hosted`, 3);
  assert.equal(page.status, 200);
  const body: any = await page.json();
  assert.deepEqual(body.sources.map((s: any) => [s.kind, s.ok]), [['event_ticket', true], ['event_hosted', true]]);
  assert.equal(body.items.length, 6);
  assert.equal(body.items.some((e: any) => e.kind === 'expert_booking'), false);
});

test('the .ics feed: my events alone, places marked, a cancelled place leaves, a non-holder has no join link', async () => {
  const f = fixture();
  seed(f.db);
  const feed = async (user: number) => {
    const r = await f.request(`/events.ics?from=${FROM}&to=${TO}&kinds=event_ticket,event_hosted`, user);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'text/calendar');
    return r.text();
  };
  let ics = await feed(3);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 6);
  assert.match(ics, /SUMMARY:Waitlist · #3: Fixture event 2/);
  assert.match(ics, /UID:event_ticket-reg-12@axal\.vc/);
  assert.match(ics, /URL:https:\/\/app\.example\.test\/events\/2/);
  // Event 2's VEVENT is tentative and carries no join link.
  const ev2 = ics.split('BEGIN:VEVENT').find(b => b.includes('Fixture event 2'))!;
  assert.match(ev2, /STATUS:TENTATIVE/);
  assert.equal(ev2.includes(JOIN), false, 'a waitlisted ticket must not carry the join link');
  const ev1 = ics.split('BEGIN:VEVENT').find(b => b.includes('SUMMARY:Fixture event 1'))!;
  assert.match(ev1, /STATUS:CONFIRMED/);
  assert.ok(ev1.includes(`LOCATION:${JOIN.replace(/:/g, ':')}`), 'a held seat carries the join link');
  for (const gone of ['Fixture event 5', 'Fixture event 6', 'Fixture event 7', 'Fixture expert session']) assert.equal(ics.includes(gone), false, gone);
  const ev8 = ics.split('BEGIN:VEVENT').find(b => b.includes('Fixture event 8'))!;
  assert.ok(ev8.includes(`LOCATION:Fixture Hall\\, 1 Example Street — ${MAPS}`), 'the venue words left the LOCATION line');
  // Without `kinds` the whole calendar answers, the older kind included.
  assert.match(await (await f.request(`/events.ics?from=${FROM}&to=${TO}`, 3)).text(), /SUMMARY:Fixture expert session/);

  // Cancelling a place takes it out of the feed.
  f.db.prepare("UPDATE event_registrations SET status = 'cancelled' WHERE id = 11").run();
  ics = await feed(3);
  assert.equal(ics.includes('SUMMARY:Fixture event 1'), false, 'a cancelled place stayed in the feed');
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 5);

  // Member 4 is waitlisted on event 1: their feed has the event and no join link.
  const other = await feed(4);
  assert.match(other, /SUMMARY:Waitlist · #1: Fixture event 1/);
  assert.equal(other.includes(JOIN), false, "a non-holder's feed carries the join link");

  // The six older kinds stay out of a my-events feed, and an unknown kind is refused.
  assert.equal((await f.request(`/events.ics?kinds=event_ticket,ticket`, 3)).status, 400);
  assert.equal((await f.request(`/events.ics?from=nonsense`, 3)).status, 400);
});

test('Google and Outlook sync: private copies, places marked, and a cancelled place is removed on the next sync', async () => {
  for (const provider of ['Google', 'Microsoft'] as const) {
    const f = fixture();
    seed(f.db);
    const oldFetch = globalThis.fetch;
    const calls: { method: string; url: string; body: any }[] = [];
    let refuseDelete = false;
    globalThis.fetch = async (url: any, init: any = {}) => {
      if (String(url).includes('/token')) return Response.json({ access_token: 'synthetic-access', expires_in: 3600 });
      const method = init.method || 'GET';
      calls.push({ method, url: String(url), body: init.body ? JSON.parse(init.body) : null });
      if (method === 'DELETE') return new Response(null, { status: refuseDelete ? 500 : 204 });
      return Response.json({ id: `synthetic-${calls.length}` });
    };
    try {
      const encrypted = await encryptString(f.env, 'synthetic-refresh');
      f.db.prepare(`INSERT INTO ${provider === 'Google' ? 'google_oauth_tokens' : 'microsoft_oauth_tokens'} (user_id,refresh_token) VALUES (3,?)`).run(encrypted);
      const first = await service[`syncUserTo${provider}`](f.env, 3, 'investor', FROM, TO);
      assert.deepEqual([first.total, first.pushed, first.failed, first.removed], [7, 7, 0, 0], provider);
      const bodies = calls.filter(c => c.method === 'POST').map(c => c.body);
      const title = (b: any) => b.summary ?? b.subject;
      const wait = bodies.find(b => title(b) === 'Waitlist · #3: Fixture event 2');
      assert.ok(wait, `${provider} copy of the waitlisted ticket is not marked`);
      assert.equal(JSON.stringify(wait).includes(JOIN), false, `${provider} copy of a waitlisted ticket carries the join link`);
      if (provider === 'Google') assert.equal(wait.status, 'tentative');
      else assert.equal(wait.showAs, 'tentative');
      const going = bodies.find(b => title(b) === 'Fixture event 1');
      assert.ok(JSON.stringify(going).includes(JOIN), `${provider} copy of a held seat lost the join link`);
      for (const b of bodies) assert.equal(b.attendees, undefined, `${provider} copy invites someone`);

      // Member 3 cancels event 1's place; event 4 is cancelled under a place that
      // was never cancelled; member 3 cancels event 9, which they host. All leave.
      f.db.prepare("UPDATE event_registrations SET status = 'cancelled' WHERE id = 11").run();
      f.db.prepare("UPDATE events SET status = 'cancelled' WHERE id = 4").run();
      f.db.prepare("UPDATE events SET status = 'cancelled' WHERE id = 9").run();
      calls.length = 0;
      const second = await service[`syncUserTo${provider}`](f.env, 3, 'investor', FROM, TO);
      assert.equal(second.removed, 3, provider);
      assert.equal(calls.filter(c => c.method === 'DELETE').length, 3);
      const left = f.db.prepare("SELECT source_kind, source_id FROM calendar_sync_records WHERE user_id = 3 AND source_kind IN ('event_ticket', 'event_hosted') ORDER BY source_kind, source_id").all()
        .map((r: any) => `${r.source_kind}:${r.source_id}`);
      assert.deepEqual(left, ['event_ticket:12', 'event_ticket:13', 'event_ticket:18']);

      // A refused delete keeps its mapping, with the error, for the next sync.
      f.db.prepare("UPDATE event_registrations SET status = 'declined' WHERE id = 13").run();
      refuseDelete = true;
      const third = await service[`syncUserTo${provider}`](f.env, 3, 'investor', FROM, TO);
      assert.equal(third.removed, 0);
      const kept: any = f.db.prepare("SELECT last_error FROM calendar_sync_records WHERE user_id = 3 AND source_kind = 'event_ticket' AND source_id = 13").get();
      assert.equal(kept?.last_error, 'delete_refused');
    } finally { globalThis.fetch = oldFetch; }
  }
});

test('one ticket or hosted event can be pushed by its owner, and by nobody else', async () => {
  const f = fixture();
  seed(f.db);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url: any) => String(url).includes('/token')
    ? Response.json({ access_token: 'synthetic-access' }) : Response.json({ id: 'synthetic-pushed' });
  try {
    for (const user of [3, 4]) {
      f.db.prepare('INSERT INTO google_oauth_tokens (user_id,refresh_token) VALUES (?,?)').run(user, await encryptString(f.env, 'synthetic-refresh'));
    }
    assert.equal((await f.request('/push/event_ticket/12', 3, {})).status, 200);
    assert.equal((await f.request('/push/event_hosted/9', 3, {})).status, 200);
    // Registration 12 is member 3's; member 4 cannot push it, nor event 9 as a host.
    assert.equal((await f.request('/push/event_ticket/12', 4, {})).status, 404);
    assert.equal((await f.request('/push/event_hosted/9', 4, {})).status, 404);
  } finally { globalThis.fetch = oldFetch; }
});

test('add-to links: title, times, place and page; the join link only for a seat holder, the host or an admin', async () => {
  const f = fixture();
  seed(f.db);
  const links = async (eventId: number, user: number) => {
    const r = await f.request(`/event-links/${eventId}`, user);
    return { status: r.status, body: r.status === 200 ? await r.json() as any : null };
  };
  const holder = await links(1, 3);
  assert.equal(holder.status, 200);
  const g = new URL(holder.body.google);
  assert.equal(g.origin + g.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(g.searchParams.get('action'), 'TEMPLATE');
  assert.equal(g.searchParams.get('text'), 'Fixture event 1');
  assert.match(g.searchParams.get('dates') || '', /^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/);
  assert.equal(g.searchParams.get('location'), JOIN);
  assert.match(g.searchParams.get('details') || '', /Event page: https:\/\/app\.example\.test\/events\/1/);
  const o = new URL(holder.body.outlook);
  assert.equal(o.origin, 'https://outlook.live.com');
  assert.equal(o.searchParams.get('subject'), 'Fixture event 1');
  assert.equal(o.searchParams.get('location'), JOIN);
  assert.equal(new URL(holder.body.office365).origin, 'https://outlook.office.com');
  assert.equal(holder.body.join_link_included, true);
  assert.equal(holder.body.ics, '/api/events/1/ics');

  // Waitlisted, approval-pending, unpaid, or no place at all: no join link anywhere.
  for (const [eventId, user] of [[1, 4], [2, 3], [3, 3], [4, 3], [5, 5]] as const) {
    const r = await links(eventId, user);
    assert.equal(r.status, 200, `${eventId}/${user}`);
    assert.equal(r.body.join_link_included, false, `${eventId}/${user}`);
    for (const k of ['google', 'outlook', 'office365']) assert.equal(r.body[k].includes(encodeURIComponent(JOIN)), false, `${k} ${eventId}/${user}`);
  }
  // The host and an admin have it.
  for (const user of [2, 1]) assert.equal((await links(2, user)).body.join_link_included, true, String(user));
  // In person: the place words and the address, for anyone who may see it.
  const room = await links(8, 5);
  assert.equal(new URL(room.body.google).searchParams.get('location'), `Fixture Hall, 1 Example Street — ${MAPS}`);
  // A private event the caller was not invited to, and an unknown one.
  assert.equal((await links(13, 5)).status, 403);
  assert.equal((await links(999, 5)).status, 404);
  assert.equal((await links(0, 5)).status, 404);
});

test('addToCalendarLinks refuses an unreadable time rather than writing a wrong one', () => {
  assert.throws(() => addToCalendarLinks({ APP_URL: 'https://app.example.test' } as any, { id: 1, title: 'x', starts_at: 'not a date' }, false), /event_time_unreadable/);
});

test('eventVisibleTo gives canViewEvent\'s answer on every case, so the links route keeps the event routes\' gate', async () => {
  const f = fixture();
  seed(f.db);
  // Public before and after an admin approves, a private one with a live, a
  // revoked and an email-only invitation, and a draft.
  event(f.db, 20, { visibility: 'public' });
  event(f.db, 21, { visibility: 'public' });
  f.db.prepare('UPDATE events SET admin_published = 1 WHERE id = 21').run();
  event(f.db, 22, { visibility: 'private' });
  f.db.exec(`INSERT INTO event_invitations (event_id, token, invited_user_id, status) VALUES (22, 'tok-a', 4, 'pending'), (22, 'tok-b', 5, 'revoked');
             INSERT INTO event_invitations (event_id, token, invited_email, status) VALUES (22, 'tok-c', 'MEMBER-6@example.test', 'pending');`);
  const events = f.db.prepare('SELECT * FROM events ORDER BY id').all() as any[];
  const users = f.db.prepare('SELECT * FROM users ORDER BY id').all() as any[];
  let compared = 0;
  const answers = new Set<string>();
  for (const ev of events) for (const u of users) {
    const want = await canViewEvent(f.env, ev, u);
    assert.equal(await eventVisibleTo(f.env, ev, u), want, `event ${ev.id} for user ${u.id}`);
    answers.add(`${ev.id}:${want}`);
    compared++;
  }
  assert.equal(compared, events.length * users.length);
  // Both answers occur, on the cases that decide them.
  for (const k of ['20:false', '21:true', '22:true', '22:false', '10:false', '13:false']) assert.ok(answers.has(k), k);
});
