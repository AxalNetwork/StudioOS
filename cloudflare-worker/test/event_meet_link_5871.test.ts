/**
 * #5871 (D3724 gap 13, D5871): "Create the meeting for me" from the event
 * editor (NE1). `add_meet: true` on the event's own Save, POST /api/events or
 * PATCH /api/events/:id. Synthetic data, the mounted router and the real
 * migrated schema in memory; Google is stubbed at `fetch`.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/event_meet_link_5871.test.ts
 *
 *   · the link is made on the host's own Google account with the event's
 *     title, start and length, saved as `location_url`, and recorded as the
 *     host's Google copy of the event (`event_hosted`), so Cancel removes it;
 *   · a save that fails deletes the Meet event again; a refusal saves nothing;
 *   · only the host asks, never a support session, never for in person;
 *   · the public read carries no join link it did not carry before.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import events, { MEET_REFUSALS, meetMinutes } from '../src/routes/events.ts';
import { MEETING_ERRORS } from '../src/services/channels/meetings.ts';
import { encryptString } from '../src/services/cryptoBox.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'synthetic-5871-only-not-a-real-credential'.repeat(2);
const ORIGIN = 'https://axal.vc';
const HOST = 2, OTHER = 3, ADMIN = 9;
const MEET_URL = 'https://meet.google.com/xyz-abcd-efg';
const START = '2026-12-04T18:00:00.000Z';
const END = '2026-12-04T20:30:00.000Z';

type Call = { url: string; method: string; body: any };

async function fixture({ googleRefuses = false } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const insert = db.prepare('INSERT INTO users(id, uid, role, name, email, is_active) VALUES (?, ?, ?, ?, ?, 1)');
  for (const [id, role] of [[HOST, 'founder'], [OTHER, 'founder'], [ADMIN, 'admin']] as const) insert.run(id, `u${id}`.padEnd(32, '0'), role, `Synthetic ${id}`, `synthetic-${id}@example.invalid`);
  const ev = db.prepare("INSERT INTO events(id, slug, host_user_id, title, starts_at, ends_at, timezone, status, visibility, location_kind, location_url) VALUES (?, ?, ?, ?, ?, ?, 'UTC', ?, ?, ?, ?)");
  ev.run(1, 'synthetic-online', HOST, 'Synthetic demo night', START, END, 'published', 'unlisted', 'virtual', null);
  ev.run(2, 'synthetic-room', HOST, 'Synthetic dinner', START, null, 'draft', 'private', 'in_person', null);
  ev.run(3, 'synthetic-gone', HOST, 'Synthetic gone', START, null, 'cancelled', 'private', 'virtual', null);
  // A save that fails at the write: the row's title says so.
  db.exec(`CREATE TRIGGER synthetic_fail_insert BEFORE INSERT ON events WHEN NEW.title = 'Write fails' BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END;
           CREATE TRIGGER synthetic_fail_update BEFORE UPDATE ON events WHEN NEW.title = 'Write fails' BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END;`);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', APP_URL: ORIGIN,
    GOOGLE_CAL_CLIENT_ID: 'synthetic-client', GOOGLE_CAL_CLIENT_SECRET: 'synthetic-secret' };
  const app = new Hono<any>().route('/api/events', events);
  app.onError((err, c) => c.json({ detail: 'failed' }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const calls: Call[] = [];
  let made = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const u = String(url);
    if (u.includes('/token')) return Response.json({ access_token: 'synthetic-access', expires_in: 3600 });
    calls.push({ url: u, method: String(init.method || 'GET'), body: init.body ? JSON.parse(init.body) : null });
    if (u.includes('conferenceDataVersion=1')) {
      if (googleRefuses) return new Response('{}', { status: 403 });
      made += 1;
      return Response.json({ id: `synthmeet${made}x`, hangoutLink: made === 1 ? MEET_URL : `https://meet.google.com/abc-defg-hi${'abcdefgh'[made]}` });
    }
    if (String(init.method) === 'DELETE') return new Response(null, { status: 204 });
    return Response.json({ id: 'synthetic-other' });
  }) as typeof fetch;
  const connect = async (userId: number) => {
    db.prepare('INSERT INTO google_oauth_tokens (user_id, refresh_token, scope) VALUES (?, ?, ?)').run(userId, await encryptString(env, 'synthetic-refresh'), 'https://www.googleapis.com/auth/calendar.events');
  };
  const send = async (who: number, path: string, json: unknown, method = 'POST', support = false) => {
    const token = await new SignJWT({ user_id: who, ...(support ? { impersonated_by: ADMIN } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const res = await app.request(ORIGIN + path, { method, headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, body: method === 'GET' ? undefined : JSON.stringify(json) }, env);
    return { status: res.status, body: await res.json() as any };
  };
  const creates = () => calls.filter((c) => c.url.includes('conferenceDataVersion=1'));
  const deletes = () => calls.filter((c) => c.method === 'DELETE');
  const copy = (eventId: number) => db.prepare("SELECT external_event_id AS id, last_error FROM calendar_sync_records WHERE user_id = ? AND provider = 'google' AND source_kind = 'event_hosted' AND source_id = ?").get(HOST, eventId) as any;
  const row = (eventId: number) => db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as any;
  return { db, env, send, connect, creates, deletes, copy, row, close() { globalThis.fetch = real; db.close(); } };
}

test('the meeting length is start to end, or an hour with no end', () => {
  assert.equal(meetMinutes(START, END), 150);
  assert.equal(meetMinutes(START, null), 60);
  assert.equal(meetMinutes(START, START), 60, 'an end at the start is no length');
  assert.equal(meetMinutes(START, '2026-12-04T18:01:00Z'), 5, 'never under five minutes');
});

test('the host\'s press on a saved event: the link is made on their Google account, saved, and becomes their copy', async () => {
  const f = await fixture();
  try {
    await f.connect(HOST);
    const res = await f.send(HOST, '/api/events/1', { add_meet: true, location_url: 'https://example.invalid/typed' }, 'PATCH');
    assert.equal(res.status, 200);
    assert.equal(res.body.event.location_url, MEET_URL, 'the Meet link wins over a typed one');
    assert.equal(f.row(1).location_url, MEET_URL, 'saved with the event');
    const [create] = f.creates();
    assert.equal(f.creates().length, 1);
    assert.equal(create.body.summary, 'Synthetic demo night', 'the event\'s title');
    assert.equal(create.body.start.dateTime, START, 'the event\'s start');
    assert.equal(create.body.end.dateTime, END, 'the event\'s length');
    assert.deepEqual({ ...f.copy(1) }, { id: 'synthmeet1x', last_error: null }, 'recorded as the host\'s Google copy of the event');

    // A second press makes a new link and deletes the copy it replaces, so the host keeps one.
    const again = await f.send(HOST, '/api/events/1', { add_meet: true, title: 'Synthetic demo night, moved', starts_at: '2026-12-05T18:00:00Z' }, 'PATCH');
    assert.equal(again.status, 200);
    assert.equal(f.creates()[1].body.summary, 'Synthetic demo night, moved', 'the title as it is being saved');
    assert.equal(f.creates()[1].body.start.dateTime, '2026-12-05T18:00:00.000Z', 'the start as it is being saved');
    assert.equal(f.copy(1).id, 'synthmeet2x');
    assert.equal(f.deletes().length, 1);
    assert.match(f.deletes()[0].url, /\/events\/synthmeet1x$/);

    // A plain save makes nothing.
    await f.send(HOST, '/api/events/1', { summary: 'No meeting asked' }, 'PATCH');
    assert.equal(f.creates().length, 2);
  } finally { f.close(); }
});

test('cancelling the event removes its Meet event from the host\'s Google Calendar', async () => {
  const f = await fixture();
  try {
    await f.connect(HOST);
    assert.equal((await f.send(HOST, '/api/events/1', { add_meet: true }, 'PATCH')).status, 200);
    const cancelled = await f.send(HOST, '/api/events/1/cancel', {});
    assert.equal(cancelled.status, 200);
    assert.ok(f.deletes().some((c) => /\/events\/synthmeet1x$/.test(c.url)), 'the existing cancellation deletes the copy');
    assert.equal(f.copy(1), undefined, 'and drops the record once Google confirms');
  } finally { f.close(); }
});

test('a new event: the press works before the first save, and the link is created with the event', async () => {
  const f = await fixture();
  try {
    await f.connect(HOST);
    const res = await f.send(HOST, '/api/events', { title: 'Synthetic launch', starts_at: START, ends_at: END, timezone: 'UTC', location_kind: 'hybrid', add_meet: true });
    assert.equal(res.status, 201);
    assert.equal(res.body.event.location_url, MEET_URL);
    assert.equal(f.creates()[0].body.summary, 'Synthetic launch');
    assert.equal(f.copy(Number(res.body.event.id)).id, 'synthmeet1x');
  } finally { f.close(); }
});

test('a save that fails deletes the Meet event again', async () => {
  const f = await fixture();
  try {
    await f.connect(HOST);
    const created = await f.send(HOST, '/api/events', { title: 'Write fails', starts_at: START, location_kind: 'virtual', add_meet: true });
    assert.equal(created.status, 500);
    assert.equal(f.creates().length, 1);
    assert.equal(f.deletes().length, 1, 'the create\'s Meet event is undone');
    assert.match(f.deletes()[0].url, /\/events\/synthmeet1x$/);
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM calendar_sync_records").get() as any).n, 0);

    const edited = await f.send(HOST, '/api/events/1', { title: 'Write fails', add_meet: true }, 'PATCH');
    assert.equal(edited.status, 500);
    assert.equal(f.deletes().length, 2, 'the edit\'s Meet event is undone');
    assert.match(f.deletes()[1].url, /\/events\/synthmeet2x$/);
    assert.equal(f.row(1).location_url, null, 'nothing saved');
    assert.equal(f.copy(1), undefined);
  } finally { f.close(); }
});

test('no connected Google account: the helper\'s refusal, in our words, and nothing is saved', async () => {
  const f = await fixture();
  try {
    const res = await f.send(HOST, '/api/events/1', { add_meet: true, summary: 'Changed' }, 'PATCH');
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'meet_not_connected');
    assert.equal(res.body.message, MEETING_ERRORS.meet_not_connected);
    assert.equal(f.creates().length, 0, 'Google is not asked');
    assert.equal(f.row(1).summary, null, 'the rest of the save waits too');
    // The typed link still saves.
    const typed = await f.send(HOST, '/api/events/1', { location_url: 'https://example.invalid/room' }, 'PATCH');
    assert.equal(typed.status, 200);
    assert.equal(f.row(1).location_url, 'https://example.invalid/room');
  } finally { f.close(); }
  const g = await fixture({ googleRefuses: true });
  try {
    await g.connect(HOST);
    const res = await g.send(HOST, '/api/events', { title: 'Synthetic refused', starts_at: START, add_meet: true });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'meet_reconnect');
    assert.equal((g.db.prepare("SELECT COUNT(*) AS n FROM events WHERE title = 'Synthetic refused'").get() as any).n, 0);
  } finally { g.close(); }
});

test('only the host asks: an admin, another member and a support session are refused before Google is asked', async () => {
  const f = await fixture();
  try {
    for (const who of [HOST, OTHER, ADMIN]) await f.connect(who);
    const admin = await f.send(ADMIN, '/api/events/1', { add_meet: true }, 'PATCH');
    assert.equal(admin.status, 403);
    assert.deepEqual([admin.body.error, admin.body.message], ['meet_host_only', MEET_REFUSALS.host_only]);
    assert.equal((await f.send(OTHER, '/api/events/1', { add_meet: true }, 'PATCH')).status, 403, 'the edit gate still stands');
    const support = await f.send(HOST, '/api/events/1', { add_meet: true }, 'PATCH', true);
    assert.equal(support.status, 403);
    assert.deepEqual([support.body.error, support.body.message], ['support_session_refused', MEET_REFUSALS.support]);
    const supportNew = await f.send(HOST, '/api/events', { title: 'Synthetic support', starts_at: START, add_meet: true }, 'POST', true);
    assert.equal(supportNew.body.error, 'support_session_refused');
    assert.equal(f.creates().length, 0);
    assert.equal(f.row(1).location_url, null);
  } finally { f.close(); }
});

test('never for in person or a cancelled event', async () => {
  const f = await fixture();
  try {
    await f.connect(HOST);
    const room = await f.send(HOST, '/api/events/2', { add_meet: true }, 'PATCH');
    assert.deepEqual([room.status, room.body.error], [400, 'meet_in_person']);
    const toRoom = await f.send(HOST, '/api/events/1', { add_meet: true, location_kind: 'in_person' }, 'PATCH');
    assert.equal(toRoom.body.error, 'meet_in_person', 'the format being saved decides');
    const fresh = await f.send(HOST, '/api/events', { title: 'Synthetic room', starts_at: START, location_kind: 'in_person', add_meet: true });
    assert.equal(fresh.body.error, 'meet_in_person');
    const gone = await f.send(HOST, '/api/events/3', { add_meet: true }, 'PATCH');
    assert.deepEqual([gone.status, gone.body.error], [409, 'meet_event_cancelled']);
    assert.equal(f.creates().length, 0);
  } finally { f.close(); }
});

test('the join link stays out of a reader\'s view that did not carry it', async () => {
  const f = await fixture();
  try {
    await f.connect(HOST);
    assert.equal((await f.send(HOST, '/api/events/1', { add_meet: true }, 'PATCH')).status, 200);
    const reader = await f.send(OTHER, '/api/events/1', null, 'GET');
    assert.equal(reader.status, 200, 'an unlisted published event is readable by link');
    assert.equal(reader.body.event.location_url, null, 'without a seat, no join link');
    assert.doesNotMatch(JSON.stringify(reader.body), /meet\.google\.com/);
  } finally { f.close(); }
});
