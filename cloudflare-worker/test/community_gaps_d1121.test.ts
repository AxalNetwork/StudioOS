/**
 * D1121 (#3001, part of #2367) — the Worker side of the Community gaps on D930:
 *
 *   - D918's Show-up block counts Confirmed (confirmed or attended), so the
 *     Events funnel's middle step is a count, not a note;
 *   - D918's list takes `type`, CM3's Type ▾, and refuses a type it does not store;
 *   - the activity read's Wellbeing rows link the Wellbeing console.
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
