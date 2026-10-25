/**
 * D1031 / #2872: My events part 1, the fixes. Real routes over migrations 109,
 * 392 and 546:
 *   - an unlisted or private event publishes from submit-review, a public one queues;
 *   - every in-app event notice opens the recipient's own page, never the
 *     public slug reader (which serves only approved public and unlisted events);
 *   - a registrant can read the event their notice points at, a stranger cannot;
 *   - advisors are an audience role.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import adminEvents from '../src/routes/admin_events.ts';
import events from '../src/routes/events.ts';
import { sweepEventReminders } from '../src/services/eventReminders.ts';
import { EVENT_ROLES, registrationEligibility, validateRegistrationRules } from '../src/services/eventOrganiser.ts';
import { hostEventLink, memberEventLink } from '../src/services/eventLinks.ts';

const SECRET = 'synthetic-my-events-fixes-test-key-'.repeat(2);
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['109_events_core.sql', '392_event_organiser.sql', '546_events_review_columns.sql']) {
    db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  }
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, uid TEXT, email TEXT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE activity_logs (user_id INTEGER, action TEXT, details TEXT, actor TEXT);
    CREATE TABLE admin_audit_log (admin_user_id INTEGER, action TEXT, report_type TEXT, filters_json TEXT, actor TEXT);
    INSERT INTO users VALUES (1, 'admin', 'admin@example.test', 'Admin fixture', 'admin', 1),
      (2, 'host', 'host@example.test', 'Host fixture', 'founder', 1),
      (3, 'seated', 'seated@example.test', 'Seated fixture', 'founder', 1),
      (4, 'waiting', 'waiting@example.test', 'Waiting fixture', 'advisor', 1),
      (5, 'stranger', 'stranger@example.test', 'Stranger fixture', 'founder', 1);
    INSERT INTO events (id, slug, host_user_id, title, starts_at, visibility, status, created_at)
      VALUES (1, 'fixture-event', 2, 'Fixture event', '2099-01-01T10:00:00Z', 'public', 'pending_review', '2026-01-01T00:00:00Z');`);
  const DB: any = { prepare(sql: string) {
    let args: any[] = [];
    const statement: any = {
      bind(...values: any[]) { args = values.map(v => v ?? null); return statement; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    };
    return statement;
  }, async batch(stmts: any[]) { return Promise.all(stmts.map(s => s.run())); } };
  const env: any = { DB, ENVIRONMENT: 'development', JWT_SECRET: SECRET };
  async function request(path: string, user = 1, body?: unknown, method = 'POST', router: any = adminEvents) {
    const token = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    return router.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  }
  const notices = (type: string): any[] => db.prepare('SELECT user_id, link FROM notifications_inbox WHERE type = ? ORDER BY user_id').all(type).map((r: any) => ({ ...r }));
  return { db, env, request, notices };
}
const status = (db: DatabaseSync): string => (db.prepare('SELECT status FROM events WHERE id = 1').get() as any).status;

test('D1031 the link helpers: a member opens the signed-in event page, a host the manage page', () => {
  assert.equal(memberEventLink(42), '/events/42');
  assert.equal(memberEventLink('42'), '/events/42');
  assert.equal(hostEventLink(42), '/events/42/manage');
});

test('D1031 submit-review publishes an unlisted or private draft or sent-back event at once, and queues a public one', async () => {
  for (const [visibility, from, expected] of [
    ['unlisted', 'draft', 'published'], ['private', 'draft', 'published'], ['private', 'rejected', 'published'],
    ['public', 'draft', 'pending_review'], ['public', 'rejected', 'pending_review'],
  ]) {
    const f = fixture();
    f.db.prepare('UPDATE events SET visibility = ?, status = ?').run(visibility, from);
    const res = await f.request('/1/submit-review', 2, {}, 'POST', events);
    assert.equal(res.status, 200, `${visibility} ${from}`);
    const body: any = await res.json();
    assert.equal(body.event.status, expected, `${visibility} ${from}: the reply's status`);
    assert.equal(status(f.db), expected, `${visibility} ${from}: the stored status`);
  }
  // The failure case: only the host or an admin may publish.
  const f = fixture();
  f.db.exec("UPDATE events SET visibility = 'private', status = 'draft'");
  const res = await f.request('/1/submit-review', 5, {}, 'POST', events);
  assert.equal(res.status, 403);
  assert.equal(status(f.db), 'draft');
});

test('D1031 the host\'s live, sent-back and unpublished notices open the manage page', async () => {
  const f = fixture();
  assert.equal((await f.request('/1/reject', 1, { reason: 'Fixture reason' })).status, 200);
  f.db.exec("UPDATE events SET status = 'pending_review'");
  assert.equal((await f.request('/1/approve')).status, 200);
  assert.equal((await f.request('/1/unpublish', 1, {})).status, 200);
  for (const type of ['event_rejected', 'event_approved', 'event_unpublished']) {
    assert.deepEqual(f.notices(type), [{ user_id: 2, link: '/events/1/manage' }], type);
  }
});

test('D1031 the cancelled and off-the-waitlist notices from the admin desk open the member\'s event page', async () => {
  const f = fixture();
  f.db.exec(`UPDATE events SET status = 'published', admin_published = 1, capacity = 1;
    INSERT INTO event_registrations (event_id, user_id, status) VALUES (1, 3, 'confirmed');
    INSERT INTO event_registrations (event_id, user_id, status, waitlist_position) VALUES (1, 4, 'waitlisted', 1);`);
  assert.equal((await f.request('/1/capacity', 1, { capacity: 2 })).status, 200);
  assert.deepEqual(f.notices('event_waitlist_promoted'), [{ user_id: 4, link: '/events/1' }]);
  assert.equal((await f.request('/1/cancel', 1, {})).status, 200);
  assert.deepEqual(f.notices('event_cancelled'), [{ user_id: 3, link: '/events/1' }, { user_id: 4, link: '/events/1' }]);
});

test('D1031 the host\'s confirm, decline and waitlist notices open the member\'s event page', async () => {
  const f = fixture();
  f.db.exec(`UPDATE events SET status = 'published', admin_published = 1, capacity = 1, approval_required = 1;
    INSERT INTO event_registrations (id, event_id, user_id, status) VALUES (10, 1, 3, 'registered');
    INSERT INTO event_registrations (id, event_id, user_id, status, waitlist_position) VALUES (11, 1, 4, 'waitlisted', 1);`);
  assert.equal((await f.request('/1/registrations/10/approve', 2, {}, 'POST', events)).status, 200);
  assert.deepEqual(f.notices('event_confirmed'), [{ user_id: 3, link: '/events/1' }]);
  assert.equal((await f.request('/1/registrations/10/decline', 2, {}, 'POST', events)).status, 200);
  assert.deepEqual(f.notices('event_declined'), [{ user_id: 3, link: '/events/1' }]);
  assert.deepEqual(f.notices('event_promoted'), [{ user_id: 4, link: '/events/1' }]);
  // The failure case: a stranger cannot decide a registration, and nobody is told.
  assert.equal((await f.request('/1/registrations/11/decline', 5, {}, 'POST', events)).status, 403);
  assert.equal(f.notices('event_declined').length, 1);
});

test('D1031 the reminder notice opens the member\'s event page; the email-only registrant\'s email keeps the public link', async () => {
  const f = fixture();
  const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  f.db.prepare("UPDATE events SET status = 'published', admin_published = 1, starts_at = ?").run(soon);
  f.db.exec(`INSERT INTO event_registrations (event_id, user_id, status) VALUES (1, 3, 'confirmed');`);
  const sweep = await sweepEventReminders(f.env);
  assert.equal(sweep.sent, 1);
  assert.deepEqual(f.notices('event_reminder'), [{ user_id: 3, link: '/events/1' }]);
  const source = readFileSync(new URL('../src/services/eventReminders.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('const eventUrl = `${base}/events/${encodeURIComponent(event.slug)}`;'), 'an email reader is not signed in');
});

test('D1031 no in-app event notice links the public slug reader', () => {
  for (const path of ['routes/admin_events.ts', 'routes/events.ts', 'services/eventReminders.ts', 'services/eventTickets.ts', 'services/eventMessaging.ts']) {
    const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /link: `\/events\/\$\{[^}]*slug\}`/, path);
  }
});

test('D1031 a registrant reads the event their notice opens, also once cancelled; a stranger cannot', async () => {
  const f = fixture();
  f.db.exec(`UPDATE events SET status = 'cancelled', admin_published = 0;
    INSERT INTO event_registrations (event_id, user_id, status) VALUES (1, 3, 'cancelled');`);
  const seated = await f.request('/1', 3, undefined, 'GET', events);
  assert.equal(seated.status, 200);
  const body: any = await seated.json();
  assert.equal(body.event.status, 'cancelled');
  assert.equal(body.registration.status, 'cancelled');
  assert.equal('review_note' in body.event, false, 'a registrant gets no private fields');
  const stranger = await f.request('/1', 5, undefined, 'GET', events);
  assert.equal(stranger.status, 403);
});

test('D1031 advisors are an audience role, and an unknown role is still refused', async () => {
  assert.ok((EVENT_ROLES as readonly string[]).includes('advisor'));
  assert.deepEqual(validateRegistrationRules({ mode: 'selected', roles: ['advisor'] }), { mode: 'selected', roles: ['advisor'] });
  assert.throws(() => validateRegistrationRules({ mode: 'selected', roles: ['mentor'] }), /invalid_audience_rules/);
  const f = fixture();
  const event = { id: 1, audience_rules_json: JSON.stringify({ mode: 'selected', roles: ['advisor'] }) };
  assert.equal((await registrationEligibility(f.env, event, 4, 'waiting@example.test')).eligible, true, 'the advisor');
  assert.equal((await registrationEligibility(f.env, event, 3, 'seated@example.test')).eligible, false, 'a founder');
});
