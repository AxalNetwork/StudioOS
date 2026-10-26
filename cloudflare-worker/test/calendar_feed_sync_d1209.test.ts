/**
 * D1209 (#3175), Calendar part 4: the whole-calendar private feed, the sync
 * error state, and a disconnect that keeps the copies (migration 610).
 *
 * The router is mounted as `index.ts` mounts it: the investor Professional
 * gate on `/api/calendar`, then the calendar routes. The fixture is the
 * production baseline plus the real migrations. Google and Microsoft are
 * stubbed: `fetch` answers their hosts from the test, and any other host
 * fails the test. Every row is synthetic: `example.test` addresses, `Fixture`
 * names, made-up titles, ids and join links.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/calendar_feed_sync_d1209.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import calendar from '../src/routes/calendar.ts';
import { onAxalSessionCreated } from '../src/services/calendar/sync.ts';
import { accountMarker, takeRetainedMarker, retainCopies, SYNC_ERRORS } from '../src/services/calendar/syncState.ts';

const SECRET = 'synthetic-calendar-d1209-'.repeat(3);
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const SUB = 'fixture-google-sub-3';
const MS_SUB = 'fixture-microsoft-sub-3';

// ─────────────────────────────────────────────── the provider stub
type Call = { url: string; method: string; body: string };
const calls: Call[] = [];
let answer: (url: URL, method: string, body: string) => Response | null = () => null;
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const PROVIDER_HOSTS = ['oauth2.googleapis.com', 'www.googleapis.com', 'login.microsoftonline.com', 'graph.microsoft.com'];
(globalThis as any).fetch = async (input: any, init: any = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = String(init.method || 'GET').toUpperCase();
  const body = init.body == null ? '' : String(init.body);
  if (!PROVIDER_HOSTS.includes(url.hostname)) throw new Error(`unstubbed host ${url.hostname}`);
  calls.push({ url: url.toString(), method, body });
  const r = answer(url, method, body);
  if (!r) throw new Error(`unstubbed ${method} ${url.hostname}${url.pathname}`);
  return r;
};
/** A provider that works: tokens refresh, events are made, deleted and revoked. */
function providersWork() {
  let n = 0;
  answer = (url, method) => {
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') return json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh-new', scope: 'openid email https://www.googleapis.com/auth/calendar.events' });
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/revoke') return new Response('', { status: 200 });
    if (url.hostname === 'www.googleapis.com' && url.pathname.includes('/userinfo')) return json({ id: SUB, email: 'member-3@example.test', verified_email: true });
    if (url.hostname === 'www.googleapis.com' && method === 'DELETE') return new Response(null, { status: 204 });
    if (url.hostname === 'www.googleapis.com') return json({ id: `g-made-${++n}` });
    if (url.hostname === 'login.microsoftonline.com') return json({ access_token: 'fixture-ms-access', refresh_token: 'fixture-ms-refresh', scope: 'Calendars.ReadWrite offline_access' });
    if (url.hostname === 'graph.microsoft.com' && url.pathname === '/v1.0/me') return json({ id: MS_SUB, mail: 'member-3@example.test' });
    if (url.hostname === 'graph.microsoft.com' && method === 'DELETE') return new Response(null, { status: 204 });
    if (url.hostname === 'graph.microsoft.com') return json({ id: `m-made-${++n}` });
    return null;
  };
}

// ─────────────────────────────────────────────── the fixture
// Users: 1 admin, 2 founder, 3 Professional investor (the member), 4 Free investor.
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  for (const name of ['235_calendar_events_kind.sql', '277_user_recovery_state.sql', '603_calendar_feed_tokens.sql']) {
    db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  }
  // A my-events token made before 610: the rebuild must keep it working.
  db.prepare('INSERT INTO users (id,email,name,role,investor_tier,investor_subscription_status) VALUES (9,?,?,?,?,?)')
    .run('member-9@example.test', 'Fixture 9', 'founder', 'free', 'free');
  db.prepare("INSERT INTO calendar_feed_tokens (id, user_id, scope, token_sha256) VALUES (41, 9, 'my_events', ?)").run('d'.repeat(64));
  db.exec(readFileSync(new URL('../sql/migrations/610_calendar_feed_scope_sync_errors.sql', import.meta.url), 'utf8'));
  const users: Array<[number, string, string]> = [[1, 'admin', 'free'], [2, 'founder', 'free'], [3, 'investor', 'professional'], [4, 'investor', 'free']];
  for (const [id, role, tier] of users) {
    db.prepare('INSERT INTO users (id,email,name,role,investor_tier,investor_subscription_status) VALUES (?,?,?,?,?,?)')
      .run(id, `member-${id}@example.test`, `Fixture ${id}`, role, tier, tier === 'free' ? 'free' : 'active');
  }
  const DB = { prepare(sql: string) { let args: any[] = []; const statement: any = {
    bind(...values: any[]) { args = values.map(v => v ?? null); return statement; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  }; return statement; }, async exec(sql: string) { db.exec(sql); } };
  const env: any = {
    DB, ENVIRONMENT: 'production', JWT_SECRET: SECRET, APP_URL: 'https://app.example.test',
    GOOGLE_CLIENT_ID: 'fixture-google-client', GOOGLE_CLIENT_SECRET: 'fixture-google-secret',
    GOOGLE_CALENDAR_REDIRECT_URI: 'https://app.example.test/api/calendar/google/callback',
    MICROSOFT_CLIENT_ID: 'fixture-ms-client', MICROSOFT_CLIENT_SECRET: 'fixture-ms-secret',
    MICROSOFT_CALENDAR_REDIRECT_URI: 'https://app.example.test/api/calendar/microsoft/callback',
  };
  const app = new Hono<any>();
  // D1206: match index.ts; calendar reads/subscriptions have no broad tier gate.
  app.route('/api/calendar', calendar);
  app.onError((e, c) => (e.message === 'Unauthorized' ? c.json({ detail: 'Not authenticated' }, 401) : c.json({ error: e.message }, 500)));
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  async function signedIn(path: string, user: number, method = 'GET', body?: unknown) {
    const token = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const headers: Record<string, string> = { Cookie: `studioos_auth=${token}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await app.request(`https://axal.example.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env, ctx as any);
    let parsed: any = null;
    try { parsed = await res.clone().json(); } catch { /* not JSON */ }
    return { status: res.status, body: parsed, res };
  }
  async function anonymous(url: string) {
    const res = await app.request(url, { method: 'GET' }, env, ctx as any);
    return { status: res.status, res, text: await res.text() };
  }
  return { db, env, signedIn, anonymous };
}

function connectGoogle(db: DatabaseSync, userId = 3, sub: string | null = SUB) {
  db.prepare('INSERT INTO google_oauth_tokens (user_id, refresh_token, scope, google_email, google_sub) VALUES (?,?,?,?,?)')
    .run(userId, 'fixture-refresh-plain', 'https://www.googleapis.com/auth/calendar.events', `member-${userId}@example.test`, sub);
}
function connectMicrosoft(db: DatabaseSync, userId = 3, sub: string | null = MS_SUB) {
  db.prepare('INSERT INTO microsoft_oauth_tokens (user_id, refresh_token, scope, microsoft_email, microsoft_sub) VALUES (?,?,?,?,?)')
    .run(userId, 'fixture-ms-refresh-plain', 'Calendars.ReadWrite', `member-${userId}@example.test`, sub);
}
function copy(db: DatabaseSync, provider: 'google' | 'microsoft', sourceId: number, userId = 3) {
  db.prepare(`INSERT INTO calendar_sync_records (user_id, provider, source_kind, source_id, external_event_id)
              VALUES (?, ?, 'expert_booking', ?, ?)`).run(userId, provider, sourceId, `${provider}-copy-${sourceId}`);
}
const copies = (db: DatabaseSync, provider: string, userId = 3) =>
  (db.prepare('SELECT source_id FROM calendar_sync_records WHERE user_id = ? AND provider = ? ORDER BY source_id').all(userId, provider) as any[]).map(r => r.source_id);

/** Member 3's own rows of three kinds, and others' rows the feed must leave out. */
function seed(db: DatabaseSync) {
  const direct = db.prepare(`INSERT INTO calendar_events (uid,user_id,source,external_uri,title,start_at,end_at,kind)
                             VALUES (?,?,'axal',?,?,?,?,'expert_booking')`);
  direct.run('axal-own', 3, 'axal:own', 'Fixture own expert session', day(2), day(2));
  direct.run('axal-other', 1, 'axal:other', 'Fixture admin expert session', day(2), day(2));
  const ic = db.prepare(`INSERT INTO ic_meetings (id, uid, title, start_at, duration_min, organizer_user_id, location_kind, location_uri, status)
                         VALUES (?, ?, ?, ?, 30, ?, 'video', ?, 'scheduled')`);
  ic.run(1, 'ic-fixture-1', 'Fixture IC with member 3', day(3), 2, 'https://meet.example.test/ic-one');
  ic.run(2, 'ic-fixture-2', 'Fixture IC without member 3', day(3), 2, 'https://meet.example.test/ic-two');
  db.prepare("INSERT INTO ic_meeting_attendees (meeting_id, user_id, rsvp) VALUES (1, 3, 'accepted')").run();
  db.prepare(`INSERT INTO events (id,slug,host_user_id,title,summary,starts_at,ends_at,location_kind,location_url,visibility,status)
              VALUES (7,'fixture-7',2,'Fixture ticketed event','Summary',?,?,'virtual','https://meet.example.test/ev','unlisted','published')`).run(day(4), day(4));
  db.prepare(`INSERT INTO event_registrations (id,event_id,user_id,email,status,payment_status) VALUES (71,7,3,'member-3@example.test','confirmed','none')`).run();
}
const titles = (ics: string) => ics.split('BEGIN:VEVENT').slice(1).map(b => (/SUMMARY:([^\r\n]*)/.exec(b.replace(/\r?\n /g, '')) || [])[1]);

test.beforeEach(() => { calls.length = 0; providersWork(); });

// ─────────────────────────────────────────────── migration 610
test('migration 610: a token made before it keeps working; the calendar scope is its own; the new columns and table', () => {
  const { db } = fixture();
  const kept = db.prepare('SELECT id, scope, token_sha256 FROM calendar_feed_tokens WHERE user_id = 9').get() as any;
  assert.deepEqual({ ...kept }, { id: 41, scope: 'my_events', token_sha256: 'd'.repeat(64) });
  db.prepare("INSERT INTO calendar_feed_tokens (user_id, scope, token_sha256) VALUES (9, 'calendar', ?)").run('e'.repeat(64));
  assert.throws(() => db.prepare("INSERT INTO calendar_feed_tokens (user_id, scope, token_sha256) VALUES (9, 'calendar', ?)").run('f'.repeat(64)), /UNIQUE/);
  assert.throws(() => db.prepare("INSERT INTO calendar_feed_tokens (user_id, scope, token_sha256) VALUES (3, 'all', ?)").run('a'.repeat(64)), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO calendar_feed_tokens (user_id, scope, token_sha256) VALUES (3, 'calendar', 'plain')").run(), /CHECK/);
  for (const t of ['google_oauth_tokens', 'microsoft_oauth_tokens']) {
    const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map(c => c.name);
    assert.ok(cols.includes('last_sync_error') && cols.includes('last_sync_error_at'), t);
  }
  db.prepare("INSERT INTO calendar_sync_retained (user_id, provider, account_marker) VALUES (3, 'google', 'm')").run();
  assert.throws(() => db.prepare("INSERT INTO calendar_sync_retained (user_id, provider, account_marker) VALUES (3, 'google', 'n')").run(), /UNIQUE/);
  assert.throws(() => db.prepare("INSERT INTO calendar_sync_retained (user_id, provider, account_marker) VALUES (3, 'calendly', 'n')").run(), /CHECK/);
});

// ─────────────────────────────────────────────── the whole-calendar feed
test('the whole-calendar feed holds only Mine: every kind the member is party to, nobody else\'s, and no wider read for an admin', async () => {
  const f = fixture();
  seed(f.db);
  const made = await f.signedIn('/api/calendar/subscription', 3, 'POST');
  assert.equal(made.status, 201);
  assert.match(made.body.url, /^https:\/\/axal\.example\.test\/api\/calendar\/feed\/calendar\.ics\?token=[A-Za-z0-9_-]{43}$/);
  assert.ok(made.body.webcal_url.startsWith('webcal://axal.example.test/api/calendar/feed/calendar.ics?token='));
  const feed = await f.anonymous(made.body.url);
  assert.equal(feed.status, 200);
  assert.match(feed.res.headers.get('content-type') || '', /^text\/calendar/);
  assert.equal(feed.res.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(titles(feed.text).sort(), ['Fixture IC with member 3', 'Fixture own expert session', 'Fixture ticketed event'].sort());

  // The admin's feed: what the admin is party to, never the studio's calendar.
  seedAdminOwnIc(f.db);
  const adminMade = await f.signedIn('/api/calendar/subscription', 1, 'POST');
  const adminFeed = await f.anonymous(adminMade.body.url);
  assert.equal(adminFeed.status, 200);
  assert.deepEqual(titles(adminFeed.text).sort(), ['Fixture admin expert session', 'Fixture IC the admin organises'].sort());
});
function seedAdminOwnIc(db: DatabaseSync) {
  db.prepare(`INSERT INTO ic_meetings (id, uid, title, start_at, duration_min, organizer_user_id, location_kind, location_uri, status)
              VALUES (3, 'ic-fixture-3', 'Fixture IC the admin organises', ?, 30, 1, 'video', 'https://meet.example.test/ic-three', 'scheduled')`).run(day(5));
}

test('a rotated token stops at once, a removed one too, and each token answers only its own feed', async () => {
  const f = fixture();
  seed(f.db);
  assert.deepEqual((await f.signedIn('/api/calendar/subscription', 3)).body, { subscribed: false, created_at: null, last_used_at: null });
  const first = (await f.signedIn('/api/calendar/subscription', 3, 'POST')).body;
  assert.equal(first.replaced, false);
  assert.equal((await f.anonymous(first.url)).status, 200);
  assert.equal((await f.signedIn('/api/calendar/subscription', 3)).body.subscribed, true);

  const second = (await f.signedIn('/api/calendar/subscription', 3, 'POST')).body;
  assert.equal(second.replaced, true);
  assert.notEqual(second.url, first.url);
  assert.equal((await f.anonymous(first.url)).status, 404, 'the old address stops');
  assert.equal((await f.anonymous(second.url)).status, 200);

  // The my-events token is another credential: neither opens the other's feed.
  const mine = (await f.signedIn('/api/calendar/my-events/feed', 3, 'POST')).body;
  const token = (u: string) => new URL(u).searchParams.get('token');
  assert.equal((await f.anonymous(`https://axal.example.test/api/calendar/feed/calendar.ics?token=${token(mine.url)}`)).status, 404);
  assert.equal((await f.anonymous(`https://axal.example.test/api/calendar/feed/my-events.ics?token=${token(second.url)}`)).status, 404);
  assert.equal((await f.anonymous(mine.url)).status, 200);

  assert.deepEqual((await f.signedIn('/api/calendar/subscription', 3, 'DELETE')).body, { revoked: true });
  assert.equal((await f.anonymous(second.url)).status, 404, 'a removed address stops');
  assert.equal((await f.anonymous(mine.url)).status, 200, 'removing one leaves the other');
  // Only the hash is kept, and the token never rides in the path.
  const stored = f.db.prepare("SELECT token_sha256 FROM calendar_feed_tokens WHERE user_id = 3 AND scope = 'my_events'").get() as any;
  assert.ok(!mine.url.includes(stored.token_sha256));
  assert.equal((await f.anonymous('https://axal.example.test/api/calendar/feed/calendar.ics')).status, 404);
});

test('D1206: both subscriptions remain readable for a Free or lapsed investor', async () => {
  const f = fixture();
  const free = (await f.signedIn('/api/calendar/subscription', 4, 'POST'));
  assert.equal(free.status, 201, 'subscription creation is available on Free');
  assert.equal((await f.anonymous(free.body.url)).status,200);
  // A token made while on Professional, after the plan lapsed.
  const made = (await f.signedIn('/api/calendar/subscription', 3, 'POST')).body;
  f.db.prepare("UPDATE users SET investor_tier = 'free', investor_subscription_status = 'free' WHERE id = 3").run();
  assert.equal((await f.anonymous(made.url)).status, 200);
});

// ─────────────────────────────────────────────── the sync error state
test('a failed sync is still on the status read after a reload, and a clean sync clears it', async () => {
  const f = fixture();
  seed(f.db);
  connectGoogle(f.db);
  const before = (await f.signedIn('/api/calendar/google/status', 3)).body;
  assert.equal(before.sync_error, null);
  assert.equal(before.sync_error_read, true);

  // The saved grant is refused at the token endpoint.
  answer = (url) => (url.pathname === '/token' ? json({ error: 'invalid_grant' }, 400) : null);
  const refused = await f.signedIn('/api/calendar/google/sync', 3, 'POST');
  assert.equal(refused.status, 502);
  const reload = (await f.signedIn('/api/calendar/google/status', 3)).body;
  assert.equal(reload.connected, true);
  assert.equal(reload.sync_error.code, 'connection_refused');
  assert.equal(reload.sync_error.message, SYNC_ERRORS.connection_refused);
  assert.ok(reload.sync_error.at);

  // The grant works, but Google refuses to make one copy.
  providersWork();
  const base = answer;
  answer = (url, method, body) => (url.hostname === 'www.googleapis.com' && method === 'POST' && body.includes('Fixture ticketed event')
    ? json({ error: 'fixture refusal' }, 500) : base(url, method, body));
  const partial = await f.signedIn('/api/calendar/google/sync', 3, 'POST');
  assert.equal(partial.status, 200);
  assert.equal(partial.body.failed, 1);
  assert.equal((await f.signedIn('/api/calendar/google/status', 3)).body.sync_error.code, 'copy_refused');

  providersWork();
  assert.equal((await f.signedIn('/api/calendar/google/sync', 3, 'POST')).status, 200);
  assert.equal((await f.signedIn('/api/calendar/google/status', 3)).body.sync_error, null);
  // The provider's own words are never stored.
  const raw = f.db.prepare('SELECT last_sync_error FROM google_oauth_tokens WHERE user_id = 3').get() as any;
  assert.equal(raw.last_sync_error, null);
});

test('Outlook\'s sync leaves its error on its own status read', async () => {
  const f = fixture();
  seed(f.db);
  connectMicrosoft(f.db);
  answer = (url) => (url.hostname === 'login.microsoftonline.com' ? json({ error: 'invalid_grant' }, 400) : null);
  assert.equal((await f.signedIn('/api/calendar/microsoft/sync', 3, 'POST')).status, 502);
  const status = (await f.signedIn('/api/calendar/microsoft/status', 3)).body;
  assert.equal(status.sync_error.code, 'connection_refused');
  assert.equal(status.sync_error_read, true);
});

test('a booking\'s create hook writes the error state, and a refresh that works clears only "connection refused"', async () => {
  const f = fixture();
  connectGoogle(f.db);
  const ev: any = {
    id: 'ic_meeting:1', kind: 'ic_meeting', source_id: 1, source_uid: 'ic-fixture-1', title: 'Fixture hook session',
    start_at: day(2), end_at: day(2), status: 'scheduled', location_kind: 'video', location_uri: null,
    organizer_email: 'member-3@example.test', attendees: [], notes: null, project_id: null,
  };
  answer = (url) => (url.pathname === '/token' ? json({ error: 'invalid_grant' }, 400) : null);
  await onAxalSessionCreated(f.env, ev);
  assert.equal((await f.signedIn('/api/calendar/google/status', 3)).body.sync_error.code, 'connection_refused');

  providersWork();
  const base = answer;
  answer = (url, method, body) => (url.hostname === 'www.googleapis.com' ? json({}, 500) : base(url, method, body));
  await onAxalSessionCreated(f.env, ev);
  assert.equal((await f.signedIn('/api/calendar/google/status', 3)).body.sync_error.code, 'copy_refused',
    'the refresh cleared "connection refused"; the refused copy wrote its own');
  providersWork();
  await onAxalSessionCreated(f.env, ev);
  assert.equal((await f.signedIn('/api/calendar/google/status', 3)).body.sync_error.code, 'copy_refused',
    'one copy made does not clear a refused one: only a full sync does');
});

test('a status read with no migration-610 columns says it could not read the state, never a clean sync', async () => {
  const f = fixture();
  connectGoogle(f.db);
  f.db.exec('ALTER TABLE google_oauth_tokens DROP COLUMN last_sync_error');
  const status = await f.signedIn('/api/calendar/google/status', 3);
  assert.equal(status.status, 200);
  assert.equal(status.body.connected, true);
  assert.equal(status.body.sync_error, null);
  assert.equal(status.body.sync_error_read, false);
});

// ─────────────────────────────────────────────── disconnect keeps the copies
for (const [verb, path] of [['DELETE', '/api/calendar/google'], ['POST', '/api/calendar/google/disconnect']] as const) {
  test(`${verb} ${path}: revokes at Google, keeps the copies and their mappings, and remembers whose they are`, async () => {
    const f = fixture();
    connectGoogle(f.db);
    copy(f.db, 'google', 11);
    copy(f.db, 'google', 12);
    const r = await f.signedIn(path, 3, verb);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, copies: 'kept' });
    assert.ok(calls.some(c => c.url === 'https://oauth2.googleapis.com/revoke' && c.method === 'POST'), 'revoked at Google');
    assert.equal(calls.filter(c => c.method === 'DELETE').length, 0, 'no copy was deleted');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM google_oauth_tokens WHERE user_id = 3').get().n, 0);
    assert.deepEqual(copies(f.db, 'google'), [11, 12]);
    const kept = f.db.prepare("SELECT account_marker FROM calendar_sync_retained WHERE user_id = 3 AND provider = 'google'").get() as any;
    assert.equal(kept.account_marker, await accountMarker(SECRET, 'google', SUB));
    assert.ok(!kept.account_marker.includes(SUB), 'never the account id itself');
  });
}

test('a refused revocation keeps everything, so the member can retry', async () => {
  const f = fixture();
  connectGoogle(f.db);
  copy(f.db, 'google', 11);
  answer = (url) => (url.pathname === '/revoke' ? new Response('', { status: 500 }) : null);
  const r = await f.signedIn('/api/calendar/google/disconnect', 3, 'POST');
  assert.equal(r.status, 502);
  assert.equal(r.body.error.code, 'google_revocation_failed');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM google_oauth_tokens WHERE user_id = 3').get().n, 1);
  assert.deepEqual(copies(f.db, 'google'), [11]);
});

test('"Remove the copies first": every copy is deleted at Google, then the disconnect; a refused copy stops it', async () => {
  const f = fixture();
  connectGoogle(f.db);
  copy(f.db, 'google', 11);
  copy(f.db, 'google', 12);
  // Google refuses one copy: nothing is disconnected and the refused mapping stays.
  const base = answer;
  answer = (url, method, body) => (method === 'DELETE' && url.pathname.endsWith('google-copy-12') ? json({}, 500) : base(url, method, body));
  const stopped = await f.signedIn('/api/calendar/google/disconnect', 3, 'POST', { remove_copies: true });
  assert.equal(stopped.status, 502);
  assert.equal(stopped.body.error.code, 'copies_not_removed');
  assert.ok(!JSON.stringify(stopped.body).match(/\d/), 'no figure in the error');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM google_oauth_tokens WHERE user_id = 3').get().n, 1);
  assert.deepEqual(copies(f.db, 'google'), [12]);
  assert.ok(!calls.some(c => c.url.endsWith('/revoke')), 'not revoked');

  providersWork();
  const done = await f.signedIn('/api/calendar/google?remove_copies=1', 3, 'DELETE');
  assert.deepEqual(done.body, { ok: true, copies: 'removed' });
  assert.deepEqual(copies(f.db, 'google'), []);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM calendar_sync_retained WHERE user_id = 3").get().n, 0);
});

test('Microsoft: both verbs keep the copies; "Remove the copies first" deletes them at Microsoft', async () => {
  for (const [verb, path] of [['DELETE', '/api/calendar/microsoft'], ['POST', '/api/calendar/microsoft/disconnect']] as const) {
    const f = fixture();
    connectMicrosoft(f.db);
    copy(f.db, 'microsoft', 21);
    assert.deepEqual((await f.signedIn(path, 3, verb)).body, { ok: true, copies: 'kept' }, verb);
    assert.deepEqual(copies(f.db, 'microsoft'), [21], verb);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM microsoft_oauth_tokens WHERE user_id = 3').get().n, 0);
  }
  const f = fixture();
  connectMicrosoft(f.db);
  copy(f.db, 'microsoft', 21);
  calls.length = 0;
  assert.deepEqual((await f.signedIn('/api/calendar/microsoft/disconnect', 3, 'POST', { remove_copies: true })).body, { ok: true, copies: 'removed' });
  assert.ok(calls.some(c => c.method === 'DELETE' && c.url.endsWith('/me/events/microsoft-copy-21')));
  assert.deepEqual(copies(f.db, 'microsoft'), []);
});

test('force-disconnect after a refused revocation keeps the copies too', async () => {
  const f = fixture();
  connectGoogle(f.db);
  copy(f.db, 'google', 11);
  const r = await f.signedIn('/api/calendar/google/force-disconnect', 3, 'POST');
  assert.equal(r.status, 200);
  assert.deepEqual(copies(f.db, 'google'), [11]);
  assert.ok(f.db.prepare("SELECT 1 FROM calendar_sync_retained WHERE user_id = 3 AND provider = 'google'").get());
});

// ─────────────────────────────────────────────── the next connect
async function googleRoundTrip(f: ReturnType<typeof fixture>, sub: string) {
  const start = await f.signedIn('/api/calendar/google/connect', 3, 'POST');
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const state = new URL(start.body.auth_url || start.body.url).searchParams.get('state')!;
  providersWork();
  const base = answer;
  answer = (url, method, body) => (url.pathname.includes('/userinfo') ? json({ id: sub, email: 'member-3@example.test', verified_email: true }) : base(url, method, body));
  // The browser returns signed in: the plan gate on `/api/calendar/*` reads its cookie.
  const cb = await f.signedIn(`/api/calendar/google/callback?code=fixture-code&state=${encodeURIComponent(state)}`, 3);
  assert.equal(cb.status, 302);
  assert.ok(!(cb.res.headers.get('location') || '').includes('error'), 'the connect succeeded');
}

test('the next Google connect keeps the kept copies for the same account and drops them for another', async () => {
  const f = fixture();
  connectGoogle(f.db);
  copy(f.db, 'google', 11);
  await f.signedIn('/api/calendar/google', 3, 'DELETE');
  await googleRoundTrip(f, SUB);
  assert.deepEqual(copies(f.db, 'google'), [11], 'same account: the mappings are used again, so nothing is copied twice');
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM calendar_sync_retained WHERE user_id = 3").get().n, 0, 'the marker decides one connect');

  await f.signedIn('/api/calendar/google', 3, 'DELETE');
  await googleRoundTrip(f, 'fixture-google-sub-other');
  assert.deepEqual(copies(f.db, 'google'), [], 'another account: the old account\'s mappings go');
});

async function microsoftRoundTrip(f: ReturnType<typeof fixture>, sub: string) {
  const start = await f.signedIn('/api/calendar/microsoft/connect', 3, 'POST');
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const state = new URL(start.body.auth_url || start.body.url).searchParams.get('state')!;
  providersWork();
  const base = answer;
  answer = (url, method, body) => (url.pathname === '/v1.0/me' ? json({ id: sub, mail: 'member-3@example.test' }) : base(url, method, body));
  // The browser returns signed in: the plan gate on `/api/calendar/*` reads its cookie.
  const cb = await f.signedIn(`/api/calendar/microsoft/callback?code=fixture-code&state=${encodeURIComponent(state)}`, 3);
  assert.equal(cb.status, 302);
  assert.ok(!(cb.res.headers.get('location') || '').includes('error'), 'the connect succeeded');
}

test('the next Microsoft connect does the same', async () => {
  const f = fixture();
  connectMicrosoft(f.db);
  copy(f.db, 'microsoft', 21);
  await f.signedIn('/api/calendar/microsoft', 3, 'DELETE');
  await microsoftRoundTrip(f, MS_SUB);
  assert.deepEqual(copies(f.db, 'microsoft'), [21]);
  await f.signedIn('/api/calendar/microsoft', 3, 'DELETE');
  await microsoftRoundTrip(f, 'fixture-microsoft-sub-other');
  assert.deepEqual(copies(f.db, 'microsoft'), []);
});

test('the retained marker is read once, and it is an HMAC that differs by provider and account', async () => {
  const { env } = fixture();
  await retainCopies(env, 3, 'google', 'fixture-marker');
  assert.equal(await takeRetainedMarker(env, 3, 'google'), 'fixture-marker');
  assert.equal(await takeRetainedMarker(env, 3, 'google'), null);
  const a = await accountMarker(SECRET, 'google', SUB);
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, await accountMarker(SECRET, 'microsoft', SUB));
  assert.notEqual(a, await accountMarker(SECRET, 'google', 'fixture-google-sub-other'));
  assert.notEqual(a, await accountMarker(`${SECRET}x`, 'google', SUB));
});
