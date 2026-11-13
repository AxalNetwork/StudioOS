/**
 * D1121 (#3001, part of #2367) — the Worker side of the Community gaps on D930:
 *
 *   - D918's Show-up block counts Confirmed (confirmed or attended), so the
 *     Events funnel's middle step is a count, not a note;
 *   - D918's list takes `type`, CM3's Type ▾, and refuses a type it does not store;
 *   - the activity read's Wellbeing rows link the Wellbeing console;
 *   - an approve records when a posting went live (`published_at`, migration 609).
 *
 * Every event, person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/community_gaps_d1121.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import adminJobsRoute from '../src/routes/admin_jobs.ts';
import adminEvents from '../src/routes/admin_events.ts';
import { parseListQuery, readEventList, readOverview } from '../src/services/adminEventsReads.ts';
import { CONSOLE_HREF } from '../src/services/communityActivity.ts';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'synthetic-community-gaps-d1121-key-'.repeat(2);
// Wednesday 21 October 2026, noon UTC.
const NOW = Date.parse('2026-10-21T12:00:00Z');

/**
 * Four events:
 *   1 ended 10 Oct, a workshop: registered, confirmed, confirmed, attended, waitlisted, cancelled;
 *   2 published, a webinar, 25 Oct;
 *   3 waiting for review, a workshop, 30 Oct;
 *   4 published, a meetup, 1 Dec.
 */
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['109_events_core.sql', '111_event_notifications.sql', '392_event_organiser.sql', '546_events_review_columns.sql']) {
    db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  }
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, uid TEXT, email TEXT, name TEXT, display_name TEXT, role TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO users (id, uid, email, name, role) VALUES (1, 'admin', 'admin@example.test', 'Admin', 'admin'), (2, 'host', 'host@example.test', 'Host', 'founder');
    INSERT INTO events (id, slug, host_user_id, type, title, starts_at, ends_at, location_kind, capacity, visibility, status, featured, price_cents, created_at) VALUES
      (1, 'e1', 2, 'workshop', 'Ended workshop', '2026-10-10T10:00:00Z', '2026-10-10T12:00:00Z', 'virtual', 10, 'public', 'published', 0, 0, '2026-09-01 00:00:00'),
      (2, 'e2', 2, 'webinar', 'Upcoming webinar', '2026-10-25T10:00:00Z', NULL, 'virtual', 20, 'public', 'published', 0, 0, '2026-09-02 00:00:00'),
      (3, 'e3', 2, 'workshop', 'Waiting workshop', '2026-10-30T10:00:00Z', NULL, 'virtual', 5, 'public', 'pending_review', 0, 0, '2026-09-03 00:00:00'),
      (4, 'e4', 2, 'meetup', 'Far meetup', '2026-12-01T10:00:00Z', NULL, 'virtual', NULL, 'public', 'published', 0, 0, '2026-09-04 00:00:00');
    INSERT INTO event_registrations (event_id, user_id, email, status, comp, payment_status, amount_cents, registered_at) VALUES
      (1, NULL, 'a@example.test', 'registered', 0, 'none', 0, '2026-10-01 09:00:00'),
      (1, NULL, 'b@example.test', 'confirmed', 0, 'paid', 900, '2026-10-01 09:00:00'),
      (1, NULL, 'c@example.test', 'confirmed', 0, 'paid', 900, '2026-10-02 09:00:00'),
      (1, NULL, 'd@example.test', 'attended', 0, 'none', 0, '2026-10-02 09:00:00'),
      (1, NULL, 'e@example.test', 'waitlisted', 0, 'none', 0, '2026-10-03 09:00:00'),
      (1, NULL, 'f@example.test', 'cancelled', 0, 'none', 0, '2026-10-03 09:00:00'),
      (2, NULL, 'g@example.test', 'registered', 0, 'none', 0, '2026-10-15 09:00:00'),
      (3, NULL, 'h@example.test', 'confirmed', 0, 'paid', 900, '2026-10-16 09:00:00');`);
  const env: any = { DB: d1Over(db), ENVIRONMENT: 'development', JWT_SECRET: SECRET };
  async function get(path: string) {
    const token = await new SignJWT({ user_id: 1 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try {
      const res = await adminEvents.request(path, { headers: { Authorization: `Bearer ${token}` } }, env);
      return { status: res.status, body: await res.json().catch(() => null) as any };
    } finally { [console.warn, console.error] = saved; }
  }
  return { db, env, get };
}

const query = (qs: Record<string, string>) => parseListQuery((k) => qs[k], (k) => (qs[k] == null ? undefined : [qs[k]]));

test('1. Show-up counts Confirmed: the seats past confirmation, confirmed or attended, never the waitlist or a cancellation', async () => {
  // Mutation checked: `confirmed` counting only 'confirmed' → 2; counting 'registered' too → 4; the field left out of the block → undefined.
  const f = fixture();
  const o: any = await readOverview(f.env, 4, NOW);
  assert.equal(o.show_up.available, true);
  assert.deepEqual([o.show_up.events, o.show_up.seats_taken, o.show_up.confirmed, o.show_up.attended], [1, 4, 3, 1]);
  assert.ok(o.show_up.confirmed <= o.show_up.seats_taken && o.show_up.confirmed >= o.show_up.attended, 'Confirmed sits between the two steps');
  // The upcoming block the Community tile reads: published or waiting, in the next 30 days, D915's seats.
  assert.deepEqual([o.upcoming_30d.events, o.upcoming_30d.seats_taken], [2, 2]);
});

test('2. the list filters by type, CM3\'s Type ▾, and refuses a type it does not store', async () => {
  // Mutation checked: the filter line removed → the workshop list holds the webinar; the type check removed → `nonsense` lists none instead of 400.
  const f = fixture();
  const q = query({ type: 'workshop' });
  assert.ok(!('error' in q));
  assert.deepEqual((await readEventList(f.env, q as any, NOW)).rows.map((r) => r.row.id).sort(), [1, 3]);
  assert.deepEqual(query({ type: 'nonsense' }), { error: 'invalid_type' });
  assert.equal((query({}) as any).type, null, 'no type is every type');
  const route = await f.get('/?type=webinar');
  assert.equal(route.status, 200);
  assert.deepEqual(route.body.events.map((e: any) => e.id), [2]);
  assert.equal(route.body.total, 1);
  const bad = await f.get('/?type=nonsense');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_type');
  // Type combines with the other filters.
  const both = await f.get('/?type=workshop&status=pending_review');
  assert.deepEqual(both.body.events.map((e: any) => e.id), [3]);
});

test('3. a Wellbeing activity row links the Wellbeing console, not a tab on /admin', () => {
  // Mutation checked: back to /admin?tab=wellbeing → fails.
  assert.equal(CONSOLE_HREF.wellbeing, '/admin/wellbeing');
  for (const href of Object.values(CONSOLE_HREF)) assert.doesNotMatch(href, /\?tab=/);
});

/** The job board's tables as the baseline declares them, then migrations 550 and 609 as written. */
function jobsFixture() {
  const sql = new URL('../sql/', import.meta.url);
  const baseline = readFileSync(new URL('schema_baseline.sql', sql), 'utf8');
  const ddl = (name: string) => {
    const at = `\n${baseline}`.indexOf(`\nCREATE TABLE ${name} (`);
    assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
    return baseline.slice(at, baseline.indexOf(');', at) + 2);
  };
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'super_admins', 'user_sessions', 'projects', 'job_postings', 'job_applications', 'admin_audit_log']) db.exec(ddl(t));
  for (const m of ['550_job_postings_submitted_at.sql', '609_job_postings_published_at.sql']) db.exec(readFileSync(new URL(`migrations/${m}`, sql), 'utf8'));
  db.exec(`INSERT INTO users (id, email, name, role, is_active) VALUES (1, 'admin@example.test', 'Admin', 'admin', 1), (2, 'host@example.test', 'Host', 'founder', 1);
    INSERT INTO job_postings (id, slug, host_user_id, title, status, admin_published, created_at) VALUES
      (1, 'live-before', 2, 'Approved before 609', 'published', 1, '2026-01-01 09:00:00'),
      (2, 'waiting', 2, 'Waiting role', 'pending_review', 0, '2026-10-01 09:00:00');`);
  const env: any = { DB: d1Over(db), ENVIRONMENT: 'development', JWT_SECRET: SECRET };
  const app = new Hono<any>();
  app.route('/jobs', adminJobsRoute);
  async function call(path: string, method = 'GET') {
    const token = await new SignJWT({ user_id: 1 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try {
      const res = await app.request(path, { method, headers: { Authorization: `Bearer ${token}` } }, env);
      return { status: res.status, body: await res.json() as any };
    } finally { [console.warn, console.error] = saved; }
  }
  const publishedAt = (id: number) => (db.prepare('SELECT published_at FROM job_postings WHERE id = ?').get(id) as any).published_at;
  return { db, env, call, publishedAt };
}

test('4. approving a posting records when it went live (migration 609); one approved before 609 stays not recorded, never backfilled', async () => {
  // Mutation checked: the approve's `published_at = datetime('now')` removed → null after approve;
  // the shape's `published_at` dropped → undefined in the list; a backfill in 609 → posting 1 dated.
  const f = jobsFixture();
  assert.equal(f.publishedAt(1), null, '609 backfills nothing');
  assert.equal(f.publishedAt(2), null);
  const before = Date.now();
  const r = await f.call('/jobs/2/approve', 'POST');
  assert.equal(r.status, 200);
  assert.equal(r.body.job.status, 'published');
  const stamp = Date.parse(String(r.body.job.published_at).replace(' ', 'T') + 'Z');
  assert.ok(Number.isFinite(stamp) && stamp >= before - 2000 && stamp <= Date.now() + 2000, 'written by the approve, now');
  const list = await f.call('/jobs');
  const byId = Object.fromEntries(list.body.jobs.map((j: any) => [j.id, j]));
  assert.equal(byId[1].published_at, null, 'approved before 609: not recorded');
  assert.equal(byId[2].published_at, r.body.job.published_at);
  // Unpublishing leaves the day; a later approve writes the new one.
  f.db.prepare("UPDATE job_postings SET published_at = '2026-09-01 10:00:00' WHERE id = 2").run();
  await f.call('/jobs/2/unpublish', 'POST');
  assert.equal(f.publishedAt(2), '2026-09-01 10:00:00', 'unpublishing keeps when it was last approved');
  await f.call('/jobs/2/approve', 'POST');
  assert.notEqual(f.publishedAt(2), '2026-09-01 10:00:00', 'each approve records the day it went live again');
});
