/**
 * The three writers of `calendar_events`, and the two that could never work.
 *
 * `calendar_events` was created by `018_calendly_integration.sql` as the
 * CALENDLY PROJECTION: `uid`, `user_id`, `source` and `external_uri` are all
 * NOT NULL with no default, and there was no `kind` column. Migration 062's
 * header promised the extra columns "in a separate migration in follow-up
 * Task #58". That migration was never written — no `ALTER TABLE
 * calendar_events` existed anywhere in the repository — and two writers were
 * built against the shape that had been promised:
 *
 *   · `services/wellbeing/bookings.ts` — a CONFIRMED, PAID expert session.
 *     It named four columns that did not exist and omitted three NOT NULL
 *     ones. It also declared its own version of the table first, guarded
 *     IF NOT EXISTS, which was a no-op against the table that already
 *     existed — so nothing surfaced the mismatch until the INSERT threw.
 *   · `routes/calendar.ts` POST /events — named `kind`, and separately never
 *     supplied `uid` at all.
 *
 * WHY THE DDL BELOW IS COPIED VERBATIM and not written to suit. A harness
 * that invents its own schema only ever confirms its own assumptions: one
 * week earlier a query in this repository joined `founders.user_id`, a column
 * that has never existed, and its unit test passed because the harness had
 * invented that column too. `schema_guards` caught it; the test could not.
 * So this file's `calendar_events` is `018_calendly_integration.sql` character
 * for character, plus migration 235's four ALTERs applied as ALTERs — which is
 * exactly what a real database will have.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { attachPushRecords, fetchUserEvents, fetchUserEventsWithSources, KNOWN_KINDS } from '../src/services/calendar.ts';
import { mirrorBookingToCalendar } from '../src/services/wellbeing/bookings.ts';
import calendar from '../src/routes/calendar.ts';
import { SignJWT } from 'jose';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = 90;
const OTHER = 91;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { return x; },
  };
}

/** The `calendar_events` block of a real migration file, lifted as text. */
function ddlFrom(rel: string, table: string): string {
  const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
  const i = src.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  assert.ok(i >= 0, `${table} is not defined in ${rel}`);
  const end = src.indexOf(');', i);
  assert.ok(end > i, `${table}'s definition in ${rel} does not terminate`);
  return src.slice(i, end + 2);
}
/** Migration 235's ALTERs, lifted as text so the test cannot drift from it. */
function altersFrom(rel: string): string[] {
  const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
  return src.split('\n')
    .filter((l) => l.trim().startsWith('ALTER TABLE calendar_events'))
    .map((l) => l.trim());
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(ddlFrom('cloudflare-worker/sql/migrations/018_calendly_integration.sql', 'calendar_events'));
  const alters = altersFrom('cloudflare-worker/sql/migrations/235_calendar_events_kind.sql');
  assert.equal(alters.length, 4, 'migration 235 no longer adds exactly the four columns this suite expects');
  for (const a of alters) db.exec(a);
  return db;
}

const env = (db: any): any => ({ DB: makeD1(db) });
const WINDOW = ['2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z'] as const;
/**
 * The two kinds that live in `calendar_events`.
 *
 * `fetchUserEvents` with no `kinds` dispatches all six readers, and the other
 * four query tables this file deliberately does not define — inventing DDL for
 * `ic_meetings` and friends to satisfy a test about a different table is
 * exactly the harness-writes-its-own-schema trap the header warns about. The
 * `kinds` parameter is the real API, so the tests use it.
 */
const IN_TABLE = ['expert_booking', 'calendly_event'];

test('migration 235 gives the table the four columns its writers name', () => {
  const db = freshDb();
  const cols = new Set(db.prepare("PRAGMA table_info('calendar_events')").all().map((r: any) => r.name));
  for (const c of ['kind', 'source_id', 'source_uid', 'attendees_json']) {
    assert.ok(cols.has(c), `${c} is still missing after migration 235`);
  }
  // And the NOT NULL columns a writer must still satisfy are unchanged — the
  // migration is additive, so nothing that used to be required stopped being.
  const notNull = db.prepare("PRAGMA table_info('calendar_events')").all()
    .filter((r: any) => r.notnull && r.dflt_value === null && r.name !== 'id')
    .map((r: any) => r.name).sort();
  assert.deepEqual(notNull, ['end_at', 'external_uri', 'source', 'start_at', 'uid', 'user_id']);
});

/**
 * The booking tables `mirrorBookingToCalendar` joins, so the REAL writer can
 * run rather than a copy of its SQL pasted here.
 *
 * A first draft of this file transcribed the INSERT instead, and every
 * mutation of the actual statement — dropping the owner, writing it as
 * 'calendly', losing the attendees — sailed through green, because the test
 * was asserting its own copy. Only these three tables are invented, they hold
 * nothing the assertions read beyond what is bound into them, and the
 * statement under test is the shipped one.
 */
function seedBooking(db: InstanceType<typeof DatabaseSync>) {
  db.exec(`
    CREATE TABLE expert_bookings (
      id INTEGER PRIMARY KEY, uid TEXT, user_id INTEGER, expert_id INTEGER,
      service_id INTEGER, scheduled_at TEXT, duration_minutes INTEGER,
      meet_link TEXT, booker_note TEXT
    );
    CREATE TABLE experts (id INTEGER PRIMARY KEY, name TEXT, user_id INTEGER);
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT);
  `);
  db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').run(FOUNDER, 'f@example.test', 'F');
  db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').run(500, 'expert@example.test', 'Dr Reyes');
  db.prepare('INSERT INTO experts (id, name, user_id) VALUES (7, ?, 500)').run('Dr Reyes');
  db.prepare(
    `INSERT INTO expert_bookings (id, uid, user_id, expert_id, scheduled_at, duration_minutes, meet_link, booker_note)
     VALUES (11, 'bk1', ?, 7, '2026-06-01T09:00:00Z', 60, 'https://meet.example/x', null)`,
  ).run(FOUNDER);
}

test('a confirmed expert booking writes a row the calendar can read', async () => {
  const db = freshDb();
  seedBooking(db);
  // THE SHIPPED WRITER, not a copy of it.
  await mirrorBookingToCalendar(env(db), 11);

  const events = await fetchUserEvents(env(db), FOUNDER, 'founder', WINDOW[0], WINDOW[1], ['expert_booking']);
  assert.equal(events.length, 1, 'the booking never reached the calendar');
  assert.equal(events[0].source_uid, 'bk1');
  assert.match(events[0].title, /Dr Reyes/);
  assert.equal(events[0].location_uri, 'https://meet.example/x');
  // The attendee list is what `organizer_email`/`invitee_email` could not hold.
  assert.ok(events[0].attendees.some((a: any) => a.role === 'founder' && a.email === 'f@example.test'),
    'the booker is not among the attendees');
  assert.ok(events[0].attendees.some((a: any) => a.role === 'expert'),
    'the expert is not among the attendees');
});

test('re-mirroring a rescheduled booking updates the row rather than duplicating it', async () => {
  // `mirrorBookingToCalendar` is deliberately re-runnable — it upserts on
  // `uid` — and the reschedule path is the reason. Without a second call the
  // whole ON CONFLICT clause is untested, and dropping a column from it looks
  // exactly like passing.
  const db = freshDb();
  seedBooking(db);
  await mirrorBookingToCalendar(env(db), 11);

  db.prepare("UPDATE expert_bookings SET scheduled_at = '2026-06-05T14:00:00Z', meet_link = 'https://meet.example/moved' WHERE id = 11").run();
  db.prepare("UPDATE experts SET name = 'Dr Reyes-Alvarez' WHERE id = 7").run();
  // The expert's address changes too, so the attendee blob genuinely differs
  // between the two calls — asserting only that a list is still >= 2 long
  // passes on the STALE value and lets the column drop out of the upsert.
  db.prepare("UPDATE users SET email = 'moved@example.test' WHERE id = 500").run();
  await mirrorBookingToCalendar(env(db), 11);

  const rows = db.prepare('SELECT * FROM calendar_events').all() as any[];
  assert.equal(rows.length, 1, 'the reschedule wrote a second row instead of updating the first');
  const events = await fetchUserEvents(env(db), FOUNDER, 'founder', WINDOW[0], WINDOW[1], ['expert_booking']);
  assert.equal(events[0].start_at, '2026-06-05T14:00:00.000Z', 'the new time did not carry through');
  assert.equal(events[0].location_uri, 'https://meet.example/moved', 'the new link did not carry through');
  assert.match(events[0].title, /Reyes-Alvarez/, 'the new title did not carry through');
  // The attendee list is in the upsert too, and it changed.
  assert.ok(events[0].attendees.some((a: any) => a.email === 'moved@example.test'),
    'the attendee list was not refreshed on update');
});

test('it belongs to the booker and nobody else', async () => {
  const db = freshDb();
  seedBooking(db);
  await mirrorBookingToCalendar(env(db), 11);
  const theirs = await fetchUserEvents(env(db), OTHER, 'founder', WINDOW[0], WINDOW[1], ['expert_booking']);
  assert.equal(theirs.length, 0, 'another user can read someone else’s booking');
});

test('an axal row is not mistaken for a Calendly one, and vice versa', async () => {
  // The two readers of this table are told apart by `source`, not by `kind`.
  // If either filter slipped, one row would be returned twice under two kinds.
  const db = freshDb();
  db.prepare(
    `INSERT INTO calendar_events (uid, user_id, source, external_uri, kind, source_id, source_uid,
                                  title, start_at, end_at, status)
     VALUES (?, ?, 'axal', ?, 'expert_booking', 7, 'bk1', 'Expert session', ?, ?, 'confirmed')`,
  ).run('expert_booking:bk1', FOUNDER, 'axal:expert_booking:bk1',
        '2026-06-01T09:00:00Z', '2026-06-01T10:00:00Z');
  // A Calendly row CARRYING THE SAME KIND. Without `source <> 'calendly'` the
  // direct reader would return this too, and the same row would appear under
  // two kinds — which a `kind = ?` filter alone cannot prevent.
  db.prepare(
    `INSERT INTO calendar_events (uid, user_id, source, external_uri, kind, title, start_at, end_at, status)
     VALUES (?, ?, 'calendly', ?, 'expert_booking', 'Intro call', ?, ?, 'scheduled')`,
  ).run('calendly:c1', FOUNDER, 'https://calendly.com/x/c1',
        '2026-06-02T09:00:00Z', '2026-06-02T09:30:00Z');

  const events = await fetchUserEvents(env(db), FOUNDER, 'founder', WINDOW[0], WINDOW[1], IN_TABLE);
  assert.deepEqual(events.map((e) => e.kind).sort(), ['calendly_event', 'expert_booking']);
  assert.equal(events.length, 2, 'a row was returned under more than one kind');
});

test('POST /events writes a row instead of throwing on uid', async () => {
  // This one never named `uid`, which is NOT NULL UNIQUE — so even once `kind`
  // existed the insert could not land. Driven through the real router, because
  // a transcribed INSERT here would pass whatever the route actually does.
  const db = freshDb();
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER, founder_id INTEGER, partner_id INTEGER, name TEXT, email TEXT)');
  db.prepare("INSERT INTO users (id, role) VALUES (?, 'founder')").run(FOUNDER);
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));

  const res = await calendar.fetch(
    new Request('http://x/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Board prep', start_at: '2026-06-03T09:00:00Z', end_at: '2026-06-03T10:00:00Z' }),
    }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any,
  );
  assert.equal(res.status, 200, 'the manual event write still fails');
  const row: any = db.prepare('SELECT uid, external_uri, kind, user_id FROM calendar_events').get();
  assert.ok(row, 'no row was written');
  assert.ok(row.uid, 'uid is NOT NULL UNIQUE and was left empty');
  assert.equal(row.external_uri, row.uid);
  assert.equal(row.kind, 'other');
  assert.equal(row.user_id, FOUNDER);
});

test('KNOWN_KINDS is every kind the aggregator can emit, and the union agrees', () => {
  // The list the page derives its filters from. It has to be the whole set, or
  // a kind ships with no way to reach it — which is what happened to
  // `partner_office_hour`, and what the canvas asks never to happen again.
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/calendar.ts'), 'utf8');
  const union = src.match(/kind: ((?:'[a-z_]+'\s*\|\s*)*'[a-z_]+');/)?.[1] || '';
  const declared = [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.ok(declared.length >= 6, 'the CalendarEvent kind union could not be parsed');
  assert.deepEqual([...KNOWN_KINDS].sort(), declared,
    'KNOWN_KINDS and the CalendarEvent union have diverged');

  // WAS a scan of `fetchUserEvents` for a `wanted.has('<kind>')` line per kind.
  // That aggregator was a run of six hand-written `if`s and the scan was the
  // only thing holding them in step with the union. It is now a
  // `Record<CalendarEvent['kind'], CalendarReader>` that tsc will not let
  // drift, and KNOWN_KINDS is its key list — so the check is that every kind
  // resolves to a reader, which the string scan could never actually prove.
  const readers = src.match(/const READERS: Readonly<Record<CalendarEvent\['kind'\], CalendarReader>> = \{([\s\S]*?)\n\};/)?.[1] || '';
  const wired = [...readers.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(wired, declared, 'a kind in the union has no reader, or a reader has no kind');
});

test('one unreadable source degrades the agenda instead of blanking it', async () => {
  // Before this, every reader ran inside one un-caught await chain, so a
  // single broken source turned the whole request into a 500 — a founder with
  // five working sources saw nothing, and nothing in the response could say
  // which one was at fault.
  const db = freshDb();
  db.prepare(
    `INSERT INTO calendar_events (uid, user_id, source, external_uri, kind, source_id, source_uid,
                                  title, start_at, end_at, status)
     VALUES (?, ?, 'axal', ?, 'expert_booking', 7, 'bk1', 'Expert session', ?, ?, 'confirmed')`,
  ).run('expert_booking:bk1', FOUNDER, 'axal:expert_booking:bk1',
        '2026-06-01T09:00:00Z', '2026-06-01T10:00:00Z');
  // `ic_meetings` is deliberately NOT created, so that reader throws for a
  // reason the readers' own missing-table catch does not swallow.
  const { events, sources } = await fetchUserEventsWithSources(
    env(db), FOUNDER, 'founder', WINDOW[0], WINDOW[1], ['expert_booking', 'ic_meeting'],
  );
  assert.equal(events.length, 1, 'the source that worked was dropped along with the one that did not');
  assert.equal(events[0].kind, 'expert_booking');
  assert.deepEqual(sources.map((s) => [s.kind, s.ok]).sort(),
    [['expert_booking', true], ['ic_meeting', false]].sort(),
    'the response does not say which source failed');
  const bad = sources.find((s) => !s.ok);
  assert.ok(bad && bad.error && bad.error.length > 0, 'a failed source carries no reason');
  assert.ok(sources.every((s) => s.ok || s.error), 'a source is marked failed with nothing to show for it');
  assert.equal(sources.find((s) => s.ok)?.error, null, 'a source that answered carries an error');
});

test('the strict read still refuses a partial answer', async () => {
  // .ics export and the push lookup use `fetchUserEvents`, and both would be
  // WRONG with a shorter list: a feed that quietly dropped a source writes an
  // incomplete calendar into someone's client, and a push lookup would report
  // "event not found" when the truth is that its source broke.
  const db = freshDb();
  await assert.rejects(
    () => fetchUserEvents(env(db), FOUNDER, 'founder', WINDOW[0], WINDOW[1], ['ic_meeting']),
    /calendar source ic_meeting failed/,
    'the strict read swallowed a source failure',
  );
});

test('an event says which calendars it has already been copied to', async () => {
  // `calendar_sync_records` has recorded every push since Task #52 and nothing
  // ever read it back to the feed, so `/calendar` could not tell a copied
  // event from one still to push — and push is one-time, so the only way to
  // find out was to press the button again.
  const db = freshDb();
  db.exec(`
    CREATE TABLE calendar_sync_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, provider TEXT NOT NULL,
      source_kind TEXT NOT NULL, source_id INTEGER NOT NULL, external_event_id TEXT NOT NULL,
      last_synced_at TEXT, last_error TEXT
    );
  `);
  const ev: any = {
    id: 'expert_booking:7', kind: 'expert_booking', source_id: 7, source_uid: 'bk1',
    title: 'Expert session', start_at: '2026-06-01T09:00:00Z', end_at: '2026-06-01T10:00:00Z',
    status: 'confirmed', location_kind: 'video', location_uri: null, organizer_email: null,
    attendees: [], notes: null,
  };
  const other: any = { ...ev, id: 'expert_booking:8', source_id: 8 };

  const ins = db.prepare(
    `INSERT INTO calendar_sync_records (user_id, provider, source_kind, source_id, external_event_id, last_error)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  ins.run(FOUNDER, 'google', 'expert_booking', 7, 'g-1', null);
  // A record whose CANCEL was refused (migration 181). The copy is still on
  // their calendar, so it counts as pushed — filtering these out would tell a
  // reader the event is not there when it demonstrably is.
  ins.run(FOUNDER, 'microsoft', 'expert_booking', 7, 'm-1', 'graph said no');
  // Another user's push must not leak onto this reader's event.
  ins.run(OTHER, 'google', 'expert_booking', 8, 'g-2', null);

  const [a, b] = await attachPushRecords(env(db), FOUNDER, [ev, other]);
  assert.deepEqual([...(a.pushed_to || [])].sort(), ['google', 'microsoft'],
    'a pushed event does not report both providers');
  assert.equal(b.pushed_to, undefined, 'an event nobody pushed is reported as pushed');
});

test('a reader who has never pushed anything still gets their agenda', async () => {
  // THE COMMON CASE, and the one a mutation slipped through: with the table
  // present but empty there is an early return, and returning the wrong thing
  // from it would empty the calendar for every user who has never pressed
  // push — which is most of them.
  const db = freshDb();
  db.exec(`
    CREATE TABLE calendar_sync_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, provider TEXT NOT NULL,
      source_kind TEXT NOT NULL, source_id INTEGER NOT NULL, external_event_id TEXT NOT NULL,
      last_synced_at TEXT, last_error TEXT
    );
  `);
  const ev: any = {
    id: 'expert_booking:7', kind: 'expert_booking', source_id: 7, source_uid: 'bk1',
    title: 'Expert session', start_at: '2026-06-01T09:00:00Z', end_at: '2026-06-01T10:00:00Z',
    status: 'confirmed', location_kind: 'video', location_uri: null, organizer_email: null,
    attendees: [], notes: null,
  };
  const out = await attachPushRecords(env(db), FOUNDER, [ev]);
  assert.equal(out.length, 1, 'an empty push ledger emptied the agenda');
  assert.equal(out[0].id, 'expert_booking:7');
  assert.equal(out[0].pushed_to, undefined, 'an event nobody pushed claims to be pushed');
});

test('a missing sync-record table costs the pill, never the agenda', async () => {
  const db = freshDb();
  const ev: any = {
    id: 'expert_booking:7', kind: 'expert_booking', source_id: 7, source_uid: 'bk1',
    title: 'Expert session', start_at: '2026-06-01T09:00:00Z', end_at: '2026-06-01T10:00:00Z',
    status: 'confirmed', location_kind: 'video', location_uri: null, organizer_email: null,
    attendees: [], notes: null,
  };
  const out = await attachPushRecords(env(db), FOUNDER, [ev]);
  assert.equal(out.length, 1, 'the event was lost with the table');
  assert.equal(out[0].pushed_to, undefined);
});
