/**
 * D1033 (#2874) item 2: "Subscribe to my events", the my-events `.ics` at a
 * per-member token URL a calendar client fetches with no session (migration
 * 603).
 *
 * The router is mounted as `index.ts` mounts it: the investor Professional gate
 * on `/api/calendar`, then the calendar routes. The fixture is the production
 * baseline plus the real migrations. Every row is synthetic: `example.test`
 * addresses, `Fixture` names, made-up titles and join links.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import calendar from '../src/routes/calendar.ts';
import { requireInvestorTierExcept } from '../src/middleware/requireInvestorTier.ts';
import { sha256Hex } from '../src/services/calendar/feedTokens.ts';

const SECRET = 'synthetic-calendar-feed-d1033-'.repeat(3);
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const JOIN = 'https://meet.example.test/fixture-room';
const ROOM = 'fixture-room';
const FEED = '/api/calendar/feed/my-events.ics';

// Users: 1 admin, 2 founder (a host), 3 Professional investor (holds tickets),
// 4 Free investor, 5 Professional investor (waitlisted only).
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  for (const name of ['235_calendar_events_kind.sql', '277_user_recovery_state.sql', '603_calendar_feed_tokens.sql']) {
    db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  }
  const users: Array<[number, string, string]> = [
    [1, 'admin', 'free'], [2, 'founder', 'free'], [3, 'investor', 'professional'],
    [4, 'investor', 'free'], [5, 'investor', 'professional'],
  ];
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
  const env: any = { DB, ENVIRONMENT: 'production', JWT_SECRET: SECRET, APP_URL: 'https://app.example.test' };

  // As index.ts mounts it: the Professional gate on the prefix, then the router.
  const app = new Hono<any>();
  const gate = requireInvestorTierExcept('professional');
  app.use('/api/calendar', gate);
  app.use('/api/calendar/*', gate);
  app.route('/api/calendar', calendar);
  app.onError((e, c) => (e.message === 'Unauthorized' ? c.json({ detail: 'Not authenticated' }, 401) : c.json({ error: e.message }, 500)));

  const ctx = { waitUntil() {}, passThroughOnException() {} };
  async function signedIn(path: string, user: number | null, method = 'GET') {
    const headers: Record<string, string> = {};
    if (user != null) {
      const token = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
      headers.Cookie = `studioos_auth=${token}`;
    }
    const res = await app.request(`https://axal.example.test${path}`, { method, headers }, env, ctx as any);
    let body: any = null;
    try { body = await res.clone().json(); } catch { /* not JSON */ }
    return { status: res.status, body, res };
  }
  /** The feed as a calendar client fetches it: no cookie, no header, only the URL. */
  async function fetchFeed(url: string) {
    const res = await app.request(url, { method: 'GET' }, env, ctx as any);
    return { status: res.status, res, text: await res.text() };
  }
  return { db, env, signedIn, fetchFeed };
}

function event(db: DatabaseSync, id: number, o: Record<string, unknown> = {}) {
  const row = {
    slug: `fixture-${id}`, host_user_id: 2, title: `Fixture event ${id}`, summary: `Summary ${id}`,
    starts_at: day(id), ends_at: day(id), location_kind: 'virtual', location_text: null, location_url: JOIN,
    visibility: 'unlisted', status: 'published', ...o,
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
 * 1 member 3 Going; 2 member 3 waitlisted #3; 3 member 3 cancelled their place;
 * 4 member 3 hosts; 5 member 5 waitlisted #1. Plus one row of an older kind
 * for member 3, which the my-events feed leaves out.
 */
function seed(db: DatabaseSync) {
  for (const id of [1, 2, 3, 5]) event(db, id);
  event(db, 4, { host_user_id: 3 });
  reg(db, 11, 1, 3, 'confirmed');
  reg(db, 12, 2, 3, 'waitlisted', { waitlist_position: 3 });
  reg(db, 13, 3, 3, 'cancelled');
  reg(db, 15, 5, 5, 'waitlisted', { waitlist_position: 1 });
  db.prepare(`INSERT INTO calendar_events (uid,user_id,source,external_uri,title,start_at,end_at,kind)
              VALUES ('axal-fixture',3,'axal','axal:fixture','Fixture expert session',?,?,'expert_booking')`).run(day(3), day(3));
}

/** One VEVENT per block, so a check can name the event it is about. */
function vevents(ics: string): string[] {
  return ics.split('BEGIN:VEVENT').slice(1).map(b => b.split('END:VEVENT')[0]);
}
const withTitle = (ics: string, title: string) => vevents(ics).find(b => b.replace(/\r?\n /g, '').includes(title));

test('migration 603: only a hash of the right shape, one known scope, one token per member', () => {
  const { db } = fixture();
  const hash = 'a'.repeat(64);
  db.prepare('INSERT INTO calendar_feed_tokens (user_id, token_sha256) VALUES (3, ?)').run(hash);
  const row = db.prepare('SELECT scope, created_at, last_used_at FROM calendar_feed_tokens WHERE user_id = 3').get() as any;
  assert.equal(row.scope, 'my_events');
  assert.ok(row.created_at);
  assert.equal(row.last_used_at, null);
  assert.throws(() => db.prepare('INSERT INTO calendar_feed_tokens (user_id, token_sha256) VALUES (3, ?)').run('b'.repeat(64)), /UNIQUE/);
  assert.throws(() => db.prepare('INSERT INTO calendar_feed_tokens (user_id, token_sha256) VALUES (4, ?)').run(hash), /UNIQUE/);
  for (const bad of ['a'.repeat(63), 'A'.repeat(64), `${'a'.repeat(63)}g`, 'plain-token']) {
    assert.throws(() => db.prepare('INSERT INTO calendar_feed_tokens (user_id, token_sha256) VALUES (4, ?)').run(bad), /CHECK/, bad);
  }
  assert.throws(() => db.prepare("INSERT INTO calendar_feed_tokens (user_id, scope, token_sha256) VALUES (4, 'all', ?)").run('c'.repeat(64)), /CHECK/);
});

test('making the subscription: the URL once, only its hash stored, the token in the query and never the path', async () => {
  const f = fixture();
  seed(f.db);
  assert.deepEqual((await f.signedIn('/api/calendar/my-events/feed', 3)).body, { subscribed: false, created_at: null, last_used_at: null });

  const made = await f.signedIn('/api/calendar/my-events/feed', 3, 'POST');
  assert.equal(made.status, 201);
  assert.equal(made.body.replaced, false);
  const url = new URL(made.body.url);
  assert.equal(url.origin, 'https://axal.example.test');
  assert.equal(url.pathname, FEED, 'the path is the same for every member: the observability logs record it');
  const token = url.searchParams.get('token')!;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(made.body.webcal_url, made.body.url.replace(/^https:/, 'webcal:'));

  const rows = f.db.prepare('SELECT * FROM calendar_feed_tokens').all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, 3);
  assert.equal(rows[0].token_sha256, await sha256Hex(token));
  assert.ok(!JSON.stringify(rows).includes(token), 'the token itself is never stored');

  const status = await f.signedIn('/api/calendar/my-events/feed', 3);
  assert.equal(status.body.subscribed, true);
  assert.equal(status.body.created_at, made.body.created_at);
  assert.ok(!JSON.stringify(status.body).includes(token), 'the status read never hands the URL back');
  assert.deepEqual(Object.keys(status.body).sort(), ['created_at', 'last_used_at', 'subscribed'],
    'nor anything stored beside it: the hash stays in the database');

  // Signed out, nothing is made, read or removed.
  for (const method of ['GET', 'POST', 'DELETE']) {
    assert.equal((await f.signedIn('/api/calendar/my-events/feed', null, method)).status, 401, method);
  }
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM calendar_feed_tokens').get() as any).n, 1);
});

test('the feed with no session: my events alone, a cancelled place gone, the waitlist marked, the join link only on a held seat', async () => {
  const f = fixture();
  seed(f.db);
  const made = await f.signedIn('/api/calendar/my-events/feed', 3, 'POST');
  const feed = await f.fetchFeed(made.body.url);
  assert.equal(feed.status, 200);
  assert.match(feed.res.headers.get('content-type') || '', /^text\/calendar/);
  assert.equal(feed.res.headers.get('cache-control'), 'private, no-store');
  assert.match(feed.res.headers.get('content-disposition') || '', /^inline/);

  const blocks = vevents(feed.text);
  assert.equal(blocks.length, 3, 'Going, the waitlist place and the hosted event');
  const going = withTitle(feed.text, 'Fixture event 1')!;
  assert.ok(going.includes(ROOM), 'a held seat carries the join link');
  assert.match(going, /STATUS:CONFIRMED/);
  const waitlisted = withTitle(feed.text, 'Waitlist · #3: Fixture event 2')!;
  assert.ok(waitlisted, 'the waitlist place is marked in the title');
  assert.ok(!waitlisted.includes(ROOM), 'a waitlist place never carries the join link');
  assert.match(waitlisted, /STATUS:TENTATIVE/);
  assert.ok(withTitle(feed.text, 'Fixture event 4')!.includes(ROOM), 'the host reads their own link');
  assert.ok(!feed.text.includes('Fixture event 3'), 'a cancelled place is not in the feed');
  assert.ok(!feed.text.includes('Fixture expert session'), 'an older kind is not in the my-events feed');

  // A member with only a waitlist place: their feed has no join link anywhere.
  const other = await f.signedIn('/api/calendar/my-events/feed', 5, 'POST');
  const theirs = await f.fetchFeed(other.body.url);
  assert.equal(theirs.status, 200);
  assert.equal(vevents(theirs.text).length, 1);
  assert.ok(!theirs.text.includes(ROOM), 'a non-holder\'s feed has no join link');
  assert.ok(!theirs.text.includes('Fixture event 1'), 'one member\'s token never reads another\'s events');

  // Cancelling the place takes it off the next fetch.
  f.db.prepare("UPDATE event_registrations SET status = 'cancelled' WHERE id = 11").run();
  const after = await f.fetchFeed(made.body.url);
  assert.ok(!after.text.includes('Fixture event 1'), 'a cancelled place leaves the feed');

  const used = f.db.prepare('SELECT last_used_at FROM calendar_feed_tokens WHERE user_id = 3').get() as any;
  assert.ok(used.last_used_at, 'a fetch records when the feed was last read');
  assert.equal((await f.signedIn('/api/calendar/my-events/feed', 3)).body.last_used_at, used.last_used_at);
});

test('a new URL stops the old one; removing it stops it with no replacement', async () => {
  const f = fixture();
  seed(f.db);
  const first = await f.signedIn('/api/calendar/my-events/feed', 3, 'POST');
  await f.fetchFeed(first.body.url);
  const second = await f.signedIn('/api/calendar/my-events/feed', 3, 'POST');
  assert.equal(second.body.replaced, true);
  assert.notEqual(second.body.url, first.body.url);
  assert.equal((await f.fetchFeed(first.body.url)).status, 404, 'the replaced URL stops at once');
  assert.equal((await f.fetchFeed(second.body.url)).status, 200);
  const row = f.db.prepare('SELECT COUNT(*) AS n FROM calendar_feed_tokens WHERE user_id = 3').get() as any;
  assert.equal(row.n, 1, 'one row per member, replaced in place');

  const removed = await f.signedIn('/api/calendar/my-events/feed', 3, 'DELETE');
  assert.deepEqual(removed.body, { revoked: true });
  assert.equal((await f.fetchFeed(second.body.url)).status, 404);
  assert.deepEqual((await f.signedIn('/api/calendar/my-events/feed', 3, 'DELETE')).body, { revoked: false });
  assert.equal((await f.signedIn('/api/calendar/my-events/feed', 3)).body.subscribed, false);
});

test('every refusal reads the same: no token, a malformed one, an unknown one, and an account that can no longer sign in', async () => {
  const f = fixture();
  seed(f.db);
  const made = await f.signedIn('/api/calendar/my-events/feed', 3, 'POST');
  const url = made.body.url as string;
  const token = new URL(url).searchParams.get('token')!;
  const expected = { detail: 'Calendar feed not found' };
  const refused = async (u: string, why: string) => {
    const r = await f.fetchFeed(u);
    assert.equal(r.status, 404, why);
    assert.deepEqual(JSON.parse(r.text), expected, why);
    assert.ok(!r.text.includes('BEGIN:VCALENDAR'), why);
  };
  await refused(`https://axal.example.test${FEED}`, 'no token');
  await refused(`https://axal.example.test${FEED}?token=short`, 'malformed');
  await refused(`https://axal.example.test${FEED}?token=${'A'.repeat(43)}`, 'unknown');
  // A session cookie is not a token: the feed answers only to its own.
  const withCookie = await f.signedIn(FEED, 3);
  assert.equal(withCookie.status, 404, 'a signed-in fetch with no token is refused too');

  f.db.prepare('UPDATE users SET is_active = 0 WHERE id = 3').run();
  await refused(url, 'an inactive account');
  f.db.prepare('UPDATE users SET is_active = 1, deletion_requested_at = CURRENT_TIMESTAMP WHERE id = 3').run();
  await refused(url, 'an account that asked to be deleted');
  f.db.prepare('UPDATE users SET deletion_requested_at = NULL WHERE id = 3').run();
  assert.equal((await f.fetchFeed(url)).status, 200);

  // "Sign out everywhere" after the token was made ends it; one before does not.
  const createdSec = Math.floor(Date.parse(`${(f.db.prepare('SELECT created_at FROM calendar_feed_tokens WHERE user_id = 3').get() as any).created_at.replace(' ', 'T')}Z`) / 1000);
  f.db.prepare('UPDATE users SET jwt_min_iat = ? WHERE id = 3').run(createdSec - 60);
  assert.equal((await f.fetchFeed(url)).status, 200, 'a sign-out before the token was made leaves it working');
  f.db.prepare('UPDATE users SET jwt_min_iat = ? WHERE id = 3').run(createdSec + 60);
  await refused(url, 'a sign-out everywhere after the token was made');
  assert.ok(token);
});

test('the paywall: the feed passes the session gate and applies its rule to the token\'s member', async () => {
  const f = fixture();
  seed(f.db);
  // A Free investor cannot make one: the gate answers the signed-in route.
  const free = await f.signedIn('/api/calendar/my-events/feed', 4, 'POST');
  assert.equal(free.status, 402);
  assert.equal(free.body.error, 'investor_tier_required');

  // A Professional investor who made one and then dropped to Free gets the same 402.
  const made = await f.signedIn('/api/calendar/my-events/feed', 3, 'POST');
  assert.equal((await f.fetchFeed(made.body.url)).status, 200);
  f.db.prepare("UPDATE users SET investor_subscription_status = 'cancelled' WHERE id = 3").run();
  const lapsed = await f.fetchFeed(made.body.url);
  assert.equal(lapsed.status, 402);
  assert.equal(JSON.parse(lapsed.text).required, 'professional');
  assert.ok(!lapsed.text.includes(ROOM));

  // Every role the gate passes reads its feed: an admin and a founder host.
  for (const id of [1, 2]) {
    const own = await f.signedIn('/api/calendar/my-events/feed', id, 'POST');
    assert.equal(own.status, 201, `user ${id} makes one`);
    assert.equal((await f.fetchFeed(own.body.url)).status, 200, `user ${id} reads it`);
  }
  // The exemption is that one GET path: the old signed-in file is still gated without a session.
  assert.equal((await f.signedIn('/api/calendar/events.ics', null)).status, 401);
});
