/** D918 / #2701: the Events desk's reads — overview, paged list, summary, history, free-seat preview. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import adminEvents from '../src/routes/admin_events.ts';
import {
  clashesOf, hasEnded, mondayOf, needsAttention, parseListQuery, readCompPreview, readEventHistory, readEventList, readEventSummary, readOverview, seatSource,
} from '../src/services/adminEventsReads.ts';

const SECRET = 'synthetic-events-desk-reads-key-'.repeat(2);
// Wednesday 21 October 2026, noon UTC. Its Monday is 19 October.
const NOW = Date.parse('2026-10-21T12:00:00Z');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['109_events_core.sql', '111_event_notifications.sql', '392_event_organiser.sql', '546_events_review_columns.sql']) {
    db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  }
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, uid TEXT, email TEXT, name TEXT, display_name TEXT, role TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE activity_logs (user_id INTEGER, action TEXT, details TEXT, actor TEXT);
    CREATE TABLE admin_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER, action TEXT, report_type TEXT, filters_json TEXT, actor TEXT, viewed_user_id INTEGER, exported_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE partners (id INTEGER PRIMARY KEY, email TEXT, name TEXT, status TEXT);
    CREATE TABLE limited_partners (id INTEGER PRIMARY KEY, user_id INTEGER, invested_amount REAL);
    INSERT INTO users (id, uid, email, name, display_name, role) VALUES
      (1, 'admin', 'admin@example.test', 'Admin fixture', NULL, 'admin'),
      (2, 'host', 'host@example.test', 'Host fixture', 'Host display fixture', 'founder'),
      (10, 'u10', 'u10@example.test', 'Member ten fixture', NULL, 'founder'),
      (11, 'u11', 'u11@example.test', 'Member eleven fixture', NULL, 'partner'),
      (12, 'u12', 'u12@example.test', 'Member twelve fixture', NULL, 'investor'),
      (13, 'u13', 'u13@example.test', 'Member thirteen fixture', NULL, 'exploring'),
      (14, 'u14', 'u14@example.test', 'Member fourteen fixture', NULL, 'admin');
    INSERT INTO projects VALUES (1, 'Acme Fixture Ventures');
    INSERT INTO events (id, slug, host_user_id, project_id, type, title, starts_at, ends_at, location_kind, capacity, visibility, status,
                        featured, price_cents, submitted_at, changed_after_approval_at, audience_rules_json, created_at) VALUES
      (1, 'e1', 2, 1, 'workshop', 'Overdue fixture', '2026-11-01T10:00:00Z', NULL, 'physical', 10, 'public', 'pending_review', 0, 0, '2026-10-17T00:00:00Z', NULL,
          '{"comp_official_partners":true,"comp_invested_lps":true,"comp_investors":true}', '2026-09-01 00:00:00'),
      (2, 'e2', 2, NULL, 'webinar', 'Legacy queue fixture', '2026-11-02T10:00:00Z', NULL, 'virtual', NULL, 'public', 'pending_review', 0, 0, NULL, NULL, '{}', '2026-09-02 00:00:00'),
      (3, 'e3', 2, 1, 'demo_day', 'Low fixture', '2026-10-25T10:00:00Z', NULL, 'in_person', 20, 'public', 'published', 0, 0, NULL, NULL, '{}', '2026-09-03 00:00:00'),
      (4, 'e4', 1, NULL, 'conference', 'Full fixture', '2026-10-25T10:30:00Z', '2026-10-25T12:00:00Z', 'hybrid', 2, 'public', 'published', 0, 1500, NULL, NULL, '{}', '2026-09-04 00:00:00'),
      (5, 'e5', 2, NULL, 'meetup', 'Held fixture', '2026-10-10T10:00:00Z', '2026-10-10T12:00:00Z', 'virtual', 10, 'public', 'published', 0, 0, NULL, '2026-10-01T00:00:00Z', '{}', '2026-09-05 00:00:00'),
      (6, 'e6', 2, NULL, 'meetup', 'Cancelled fixture', '2026-10-25T10:15:00Z', NULL, 'virtual', NULL, 'public', 'cancelled', 0, 500, NULL, NULL, '{}', '2026-09-06 00:00:00'),
      (7, 'e7', 2, NULL, 'meetup', 'Sent back fixture', '2026-12-01T10:00:00Z', NULL, 'virtual', NULL, 'public', 'rejected', 0, 0, NULL, NULL, '{}', '2026-09-07 00:00:00'),
      (8, 'e8', 2, NULL, 'meetup', 'Draft fixture', '2026-10-30T10:00:00Z', NULL, 'virtual', NULL, 'private', 'draft', 0, 0, NULL, NULL, '{}', '2026-09-08 00:00:00'),
      (9, 'e9', 2, NULL, 'social', 'Changed fixture', '2026-11-05T10:00:00Z', NULL, 'virtual', NULL, 'public', 'published', 1, 0, NULL, '2026-10-20T00:00:00Z', '{}', '2026-09-09 00:00:00');
    INSERT INTO event_invitations (id, event_id, token, invited_user_id, invited_email, source, comp, status) VALUES
      (1, 4, 't1', 11, NULL, 'auto_partner', 1, 'accepted'),
      (2, 4, 't2', NULL, 'guest@example.test', 'manual', 0, 'pending'),
      (3, 1, 't3', 11, NULL, 'auto_partner', 1, 'pending');
    INSERT INTO event_registrations (event_id, user_id, email, status, comp, invitation_id, payment_status, amount_cents, registered_at) VALUES
      (3, 10, NULL, 'registered', 0, NULL, 'none', 0, '2026-10-20 10:00:00'),
      (3, NULL, 'g1@example.test', 'confirmed', 1, NULL, 'none', 0, '2026-10-14T09:00:00Z'),
      (4, 11, NULL, 'confirmed', 1, 1, 'paid', 1500, '2026-10-13 09:00:00'),
      (4, 12, NULL, 'registered', 0, NULL, 'pending', 1500, '2026-10-02 09:00:00'),
      (4, 13, NULL, 'waitlisted', 0, NULL, 'none', 0, '2026-10-20 11:00:00'),
      (5, 10, NULL, 'attended', 0, NULL, 'none', 0, '2026-10-05 09:00:00'),
      (5, 14, NULL, 'attended', 0, NULL, 'none', 0, '2026-10-05 09:00:00'),
      (5, NULL, 'g2@example.test', 'attended', 0, NULL, 'none', 0, '2026-10-05 09:00:00'),
      (5, 99, NULL, 'registered', 0, NULL, 'none', 0, '2026-10-05 09:00:00'),
      (5, 12, NULL, 'cancelled', 0, NULL, 'paid', 700, '2026-09-10 09:00:00'),
      (5, 13, NULL, 'cancelled', 0, NULL, 'none', 0, '2026-08-30 13:00:00'),
      (6, 10, NULL, 'cancelled', 0, NULL, 'paid', 500, '2026-10-01 09:00:00');
    INSERT INTO event_checkins (event_id, registration_id, code, checked_in_at) VALUES
      (5, 6, 'c1', '2026-10-10 10:01:00'), (5, 7, 'c2', '2026-10-10 10:02:00'), (5, 8, 'c3', '2026-10-10T10:03:00Z');
    INSERT INTO event_notifications (event_id, principal_key, kind) VALUES (4, 'u:11', 'reminder_24h'), (4, 'u:12', 'reminder_24h'), (4, 'u:11', 'reminder_1h');
    INSERT INTO partners VALUES (1, 'u11@example.test', 'Partner fixture', 'active'), (2, 'p2@example.test', 'Partner two fixture', 'active'), (3, 'p3@example.test', 'Old partner fixture', 'inactive');
    INSERT INTO limited_partners VALUES (1, 12, 100), (2, 13, 0);`);
  const failing: string[] = [];
  const DB: any = { prepare(sql: string) {
    let args: any[] = [];
    const check = () => { for (const f of failing) if (sql.includes(f)) throw new Error('SQLITE_ERROR: synthetic store failure fixture-secret-text'); };
    const statement: any = {
      bind(...values: any[]) { args = values.map((v) => v ?? null); return statement; },
      async first() { check(); return db.prepare(sql).get(...args) || null; },
      async all() { check(); return { results: db.prepare(sql).all(...args) }; },
      async run() { check(); const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    };
    return statement;
  }, async batch(stmts: any[]) { return Promise.all(stmts.map((s) => s.run())); } };
  const env: any = { DB, ENVIRONMENT: 'development', JWT_SECRET: SECRET };
  async function get(path: string, user = 1) {
    const token = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    return adminEvents.request(path, { headers: { Authorization: `Bearer ${token}` } }, env);
  }
  const event = (id: number) => db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  return { db, env, get, event, fail: (s: string) => failing.push(s) };
}

const unreadableShape = (b: any) => {
  assert.equal(b.available, false);
  assert.equal(b.unreadable, true);
  assert.match(b.reason, /could not be read/);
  assert.doesNotMatch(b.reason, /SQLITE|fixture-secret-text/);
  for (const k of Object.keys(b)) assert.ok(['available', 'unreadable', 'reason'].includes(k), `no counts beside a failed block: ${k}`);
};
const NAMES = /fixture@|@example\.test|Member \w+ fixture|Admin fixture|Partner fixture|g1@|g2@/;

test('D918 overview: every block reads the shared rules on a fixed clock', async () => {
  const f = fixture();
  const o: any = await readOverview(f.env, 4, NOW);
  assert.equal(o.weeks, 4);
  assert.equal(o.period.start, '2026-09-28T00:00:00.000Z');
  assert.equal(o.period.end, '2026-10-26T00:00:00.000Z');
  // Event 2 has no submitted_at: its wait counts from creation (2 September), as the Approvals lane's does.
  assert.deepEqual(o.queue, { available: true, count: 2, oldest_since: '2026-09-02T00:00:00.000Z', oldest_hours: 1188, overdue: 2, overdue_after_hours: 72, waiting_from_created_at: 1 });
  assert.deepEqual(o.upcoming_30d, { available: true, events: 5, seats_taken: 4, full: 1 });
  assert.deepEqual(o.waitlisted, { available: true, registrations: 1, events: 1 });
  assert.deepEqual(o.weekly.weeks, [
    { week_start: '2026-09-28', registrations: 2, checkins: 0 },
    { week_start: '2026-10-05', registrations: 4, checkins: 3 },
    { week_start: '2026-10-12', registrations: 2, checkins: 0 },
    { week_start: '2026-10-19', registrations: 2, checkins: 0, to_date: true },
  ]);
  assert.deepEqual(o.weekly.registrations, { this_period: 10, previous_period: 1 });
  assert.equal(o.show_up.events, 1);assert.equal(o.show_up.seats_taken, 4);assert.equal(o.show_up.attended, 3);assert.equal(o.show_up.rate, 0.75);
  assert.deepEqual(o.show_up.recent.map((r: any) => [r.id, r.rate]), [[5, 0.75]]);
  assert.deepEqual(o.by_status.counts, { draft: 1, pending_review: 2, published: 4, rejected: 1, cancelled: 1, other: 0 });
  assert.equal(o.by_type.counts.demo_day, 1);assert.equal(o.by_type.counts.conference, 1);assert.equal(o.by_type.counts.meetup, 1);
  assert.equal(o.by_type.counts.workshop, 0, 'a queued event starting after the period is not in it');
  assert.equal(Object.values(o.by_type.counts).reduce((a: any, b: any) => a + b, 0), 3);
  assert.deepEqual(o.by_format.counts, { online: 1, in_person: 1, hybrid: 1, not_recorded: 0 });
  assert.deepEqual(o.by_role.counts, { founder: 2, partner: 1, exploring: 0, advisor: 0, investor: 1, admin: 1, guest: 2, not_recorded: 1 });
  assert.deepEqual(o.by_source.counts, { invitation: 1, free_seat: 1, signed_up: 6 });
  assert.equal(o.by_source.added_by_admin.recorded, false);
  assert.deepEqual(o.paid, { available: true, count: 2, by_currency: [{ currency: 'usd', count: 2, amount_cents: 2000, amount_not_recorded: 0 }] });
  assert.deepEqual(o.payment_pending, { available: true, count: 1 });
  assert.deepEqual(o.free_seats, { available: true, count: 2 });
  assert.deepEqual(o.cancelled, { available: true, events: 1, with_paid_tickets: 1, counted_by: 'starts_at' });
  assert.deepEqual(o.needs_attention.counts, { overdue: 2, full: 1, low_signups: 1, clash: 2, changed_after_approval: 1, paid_on_cancelled: 1 });
  assert.equal(o.needs_attention.total, 8);
  const kinds = o.needs_attention.items.map((i: any) => `${i.kind}:${i.event_id}`).sort();
  assert.deepEqual(kinds, ['changed_after_approval:9', 'clash:3', 'clash:4', 'full:4', 'low_signups:3', 'overdue:1', 'overdue:2', 'paid_on_cancelled:6']);
  assert.deepEqual(o.views, { recorded: false, reason: 'No store counts views of an event page, so the funnel starts at registration.' });
  assert.deepEqual(o.feedback, { recorded: false, reason: 'Events have no feedback form yet.' });
  assert.doesNotMatch(JSON.stringify(o), NAMES);
});

test('D918 overview: a failed store fails only the blocks that read it, never as zero', async () => {
  const checkins = fixture();checkins.fail('FROM event_checkins');
  const a: any = await readOverview(checkins.env, 12, NOW);
  unreadableShape(a.weekly);
  assert.equal(a.queue.available, true);assert.equal(a.paid.available, true);assert.equal(a.by_role.available, true);

  const roles = fixture();roles.fail('LEFT JOIN users u ON u.id = r.user_id');
  const b: any = await readOverview(roles.env, 12, NOW);
  unreadableShape(b.by_role);
  assert.equal(b.by_source.available, true);assert.equal(b.weekly.available, true);

  const events = fixture();events.fail('LEFT JOIN projects p');
  const c: any = await readOverview(events.env, 12, NOW);
  for (const k of ['queue', 'upcoming_30d', 'waitlisted', 'show_up', 'by_status', 'by_type', 'by_format', 'cancelled', 'needs_attention']) unreadableShape(c[k]);
  for (const k of ['weekly', 'by_role', 'by_source', 'paid', 'payment_pending', 'free_seats']) assert.equal(c[k].available, true, k);
  assert.equal(c.views.recorded, false);
});

test('D918 overview route: admin only, weeks limited to 4, 12 or 52, default 12', async () => {
  const f = fixture();
  assert.equal((await f.get('/overview', 10)).status, 403);
  for (const w of ['5', '0', 'x', '-4']) assert.equal((await f.get(`/overview?weeks=${w}`)).status, 400);
  const res = await f.get('/overview');assert.equal(res.status, 200);
  const body: any = await res.json();assert.equal(body.weeks, 12);assert.equal(body.weekly.weeks.length, 12);
  assert.equal(body.weekly.weeks.at(-1).to_date, true);assert.equal(body.weekly.weeks.filter((w: any) => w.to_date).length, 1);
  for (const w of [4, 52]) assert.equal(((await (await f.get(`/overview?weeks=${w}`)).json()) as any).weekly.weeks.length, w);
});

test('D918 shared rules: clash, Monday weeks and how a seat was got', () => {
  const ev = (id: number, starts_at: string, ends_at: string | null, status = 'published') =>
    ({ id, starts_at, ends_at, status, seats_taken: 0, attended: 0, waitlisted: 0, paid_tickets: 0, host_user_id: null });
  const m = clashesOf([
    ev(1, '2026-10-25T10:00:00Z', null), ev(2, '2026-10-25T10:59:00Z', null), ev(3, '2026-10-25T11:00:00Z', null),
    ev(4, '2026-10-25T09:00:00Z', '2026-10-25T13:00:00Z', 'cancelled'), ev(5, '2026-10-26T09:00:00Z', '2026-10-26T18:00:00Z'), ev(6, '2026-10-26T17:00:00Z', null, 'draft'),
  ]);
  assert.deepEqual([...m.entries()].sort(), [[1, [2]], [2, [1, 3]], [3, [2]], [5, [6]], [6, [5]]]);
  assert.equal(new Date(mondayOf(Date.parse('2026-10-25T23:59:00Z'))).toISOString(), '2026-10-19T00:00:00.000Z');
  assert.equal(new Date(mondayOf(Date.parse('2026-10-26T00:00:00Z'))).toISOString(), '2026-10-26T00:00:00.000Z');
  const h = (n: number) => new Date(NOW - n * 3600e3).toISOString();
  assert.equal(hasEnded({ starts_at: h(10), ends_at: null }, NOW), false, 'with no end, an event ends a day after its start');
  assert.equal(hasEnded({ starts_at: h(25), ends_at: null }, NOW), true);
  assert.equal(hasEnded({ starts_at: h(30), ends_at: h(-1) }, NOW), false, 'a stored end wins');
  const row = (id: number, extra: Record<string, unknown>) => ({ id, title: 't', status: 'published', starts_at: h(-48), ends_at: null, capacity: null,
    seats_taken: 0, attended: 0, waitlisted: 0, paid_tickets: 0, host_user_id: null, created_at: h(500), ...extra });
  const kinds = (rows: any[]) => needsAttention(rows, NOW).items.map((i) => `${i.kind}:${i.event_id}`).sort();
  assert.deepEqual(kinds([row(1, { status: 'pending_review', submitted_at: h(60) }), row(2, { status: 'pending_review', submitted_at: h(72.5), starts_at: h(-60) })]), ['overdue:2'], 'overdue past 72 hours');
  assert.deepEqual(kinds([row(1, { capacity: 20, seats_taken: 4 }), row(2, { capacity: 20, seats_taken: 5, starts_at: h(-49) }), row(3, { capacity: 20, seats_taken: 6, starts_at: h(-50) }),
    row(4, { capacity: 20, seats_taken: 0, starts_at: h(-24 * 8) }), row(5, { capacity: null, starts_at: h(-51) })]), ['low_signups:1'], 'under a quarter, within 7 days, with a cap');
  assert.equal(seatSource({ invitation_id: 3, comp: 1 }), 'invitation');
  assert.equal(seatSource({ invitation_id: null, comp: 1 }), 'free_seat');
  assert.equal(seatSource({ invitation_id: null, comp: 0 }), 'signed_up');
});

test('D918 list: filters, sorts, total, per-row counts, host, venture and clash', async () => {
  const f = fixture();
  const q = (qs: Record<string, string | string[]>) => {
    const p = parseListQuery((k) => (Array.isArray(qs[k]) ? (qs[k] as string[])[0] : (qs[k] as string | undefined)),
      (k) => (qs[k] == null ? undefined : ([] as string[]).concat(qs[k])));
    assert.ok(!('error' in p));return p as any;
  };
  const ids = async (qs: Record<string, string | string[]>) => (await readEventList(f.env, q(qs), NOW)).rows.map((r) => r.row.id);
  assert.deepEqual(await ids({}), [9, 8, 7, 6, 5, 4, 3, 2, 1], 'no sort keeps newest created first');
  assert.deepEqual(await ids({ status: 'pending_review,rejected' }), [7, 2, 1]);
  assert.deepEqual(await ids({ status: ['pending_review', 'rejected'] }), [7, 2, 1]);
  assert.deepEqual(await ids({ visibility: 'private' }), [8]);
  assert.deepEqual(await ids({ when: 'ended' }), [5]);
  assert.deepEqual(await ids({ when: 'this_week' }), [6, 4, 3]);
  assert.deepEqual(await ids({ price: 'paid' }), [6, 4]);
  assert.deepEqual(await ids({ featured: '1' }), [9]);
  assert.deepEqual(await ids({ q: 'ACME' }), [3, 1], 'searches the venture');
  assert.deepEqual(await ids({ q: 'host display' }), [9, 8, 7, 6, 5, 3, 2, 1], 'searches the host');
  assert.deepEqual(await ids({ q: 'held' }), [5], 'searches the title');
  assert.deepEqual((await ids({ sort: 'fill' })).slice(0, 4), [4, 5, 3, 1]);
  assert.deepEqual((await ids({ sort: 'show_up' })).slice(0, 1), [5]);
  assert.deepEqual((await ids({ sort: 'waiting' })).slice(0, 3), [2, 1, 9], 'longest wait first; the not-waiting sort last');
  assert.deepEqual((await ids({ sort: 'starts' })).slice(0, 3), [5, 3, 6]);
  assert.deepEqual((await ids({ sort: 'seats_taken', dir: 'desc' })).slice(0, 1), [5]);
  const page = await readEventList(f.env, q({ limit: '2', offset: '1' }), NOW);
  assert.equal(page.total, 9);assert.deepEqual(page.rows.map((r) => r.row.id), [8, 7]);
  const byId = new Map((await readEventList(f.env, q({}), NOW)).rows.map((r) => [r.row.id, r.counts]));
  assert.deepEqual(byId.get(4), { seats_taken: 2, attended: 0, waitlisted: 1, fill: 1, ended: false, show_up: null, waiting_hours: null,
    host: { name: 'Admin fixture', role: 'admin' }, venture: null, clash: true });
  assert.deepEqual(byId.get(3)!.host, { name: 'Host display fixture', role: 'founder' });
  assert.deepEqual(byId.get(3)!.venture, { name: 'Acme Fixture Ventures' });
  assert.equal(byId.get(6)!.clash, false, 'a cancelled event never clashes');
  assert.equal(byId.get(5)!.show_up, 0.75);assert.equal(byId.get(3)!.show_up, null, 'not held yet is null, not 0');
  assert.equal(byId.get(1)!.waiting_hours, 108);assert.equal(byId.get(2)!.waiting_hours, 1188);assert.equal(byId.get(3)!.waiting_hours, null);
});

test('D918 list route keeps today\'s fields and refuses unknown filter words', async () => {
  const f = fixture();
  assert.equal((await f.get('/', 10)).status, 403);
  for (const qs of ['sort=title', 'dir=up', 'when=soon', 'price=cheap', 'featured=maybe', 'visibility=secret']) assert.equal((await f.get('/?' + qs)).status, 400, qs);
  const body: any = await (await f.get('/?status=published&limit=2')).json();
  assert.equal(body.total, 4);assert.equal(body.limit, 2);assert.equal(body.offset, 0);assert.equal(body.events.length, 2);
  const row = body.events[0];
  for (const k of ['id', 'slug', 'title', 'status', 'visibility', 'starts_at', 'capacity', 'admin_published', 'created_at', 'seats_taken', 'attended', 'waitlisted', 'host', 'venture', 'clash']) assert.ok(k in row, k);
});

test('D918 summary: counts only, by status, source, role and payment, with free seats, check-ins, invitations, reminders and seats by day', async () => {
  const f = fixture();
  const s: any = await readEventSummary(f.env, f.event(4), NOW);
  assert.deepEqual(s.host, { available: true, host: { name: 'Admin fixture', role: 'admin' }, venture: null });
  assert.deepEqual(s.registrations.by_status, { registered: 1, confirmed: 1, attended: 0, waitlisted: 1, declined: 0, cancelled: 0, other: 0 });
  assert.equal(s.registrations.seats_taken, 2);assert.equal(s.registrations.capacity, 2);assert.equal(s.registrations.ended, false);assert.equal(s.registrations.show_up, null);
  assert.deepEqual(s.by_source.counts, { invitation: 1, free_seat: 0, signed_up: 1 });
  assert.equal(s.by_role.counts.partner, 1);assert.equal(s.by_role.counts.investor, 1);assert.equal(s.by_role.counts.exploring, 0, 'the waitlisted hold no seat');
  assert.deepEqual(s.payments.by_payment_status, { none: 1, free: 0, pending: 1, paid: 1, refunded: 0, not_recorded: 0, other: 0 });
  assert.deepEqual(s.payments.paid, { count: 1, by_currency: [{ currency: 'usd', count: 1, amount_cents: 1500, amount_not_recorded: 0 }] });
  assert.equal(s.payments.payment_pending, 1);assert.equal(s.payments.refunds.recorded, false);
  assert.deepEqual(s.free_seats, { available: true, count: 1 });
  assert.deepEqual(s.checkins, { available: true, count: 0 });
  assert.deepEqual(s.invitations, { available: true, total: 2, free_seat: 1,
    by_status: { pending: 1, accepted: 1, declined: 0, revoked: 0, other: 0 }, by_source: { manual: 1, auto_partner: 1, auto_lp: 0, other: 0 } });
  assert.deepEqual(s.reminders, { available: true, sent: 3, by_kind: { reminder_24h: 2, reminder_1h: 1, other: 0 } });
  assert.deepEqual(s.seats_by_day.days, [{ day: '2026-10-02', seats: 1, total: 1 }, { day: '2026-10-13', seats: 1, total: 2 }]);
  const held: any = await readEventSummary(f.env, f.event(5), NOW);
  assert.equal(held.registrations.ended, true);assert.equal(held.registrations.show_up, 0.75);assert.equal(held.checkins.count, 3);
  assert.deepEqual(held.seats_by_day.days, [{ day: '2026-10-05', seats: 4, total: 4 }]);
  assert.equal(held.by_role.counts.not_recorded, 1);assert.equal(held.by_role.counts.guest, 1);
  assert.doesNotMatch(JSON.stringify({ ...s, host: null }) + JSON.stringify({ ...held, host: null }), NAMES, "only the host line carries a name");

  const broken = fixture();broken.fail('FROM event_notifications');
  const b: any = await readEventSummary(broken.env, broken.event(4), NOW);
  unreadableShape(b.reminders);assert.equal(b.invitations.available, true);assert.equal(b.registrations.available, true);
  const res = await f.get('/4/summary');assert.equal(res.status, 200);assert.equal(((await res.json()) as any).event_id, 4);
  assert.equal((await f.get('/404/summary')).status, 404);assert.equal((await f.get('/4/summary', 10)).status, 403);
});

test('D918 history: the desk\'s actions and the host\'s, actors unnamed, a send-back with its reason', async () => {
  const f = fixture();
  f.db.exec(`INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json, exported_at) VALUES
    (2, 'event_submitted', NULL, '{"event_id":1}', '2026-10-17 00:00:00'),
    (1, 'event_rejected', 'events', '{"event_id":1,"reason":"Add a venue"}', '2026-10-18 00:00:00'),
    (2, 'event_updated', NULL, '{"event_id":1,"fields":["location_text"]}', '2026-10-18 06:00:00'),
    (1, 'event_updated', NULL, '{"event_id":1,"fields":["title"]}', '2026-10-18 07:00:00'),
    (1, 'event_featured', 'events', '{"event_id":1,"featured":true}', '2026-10-19 00:00:00'),
    (1, 'event_approved', 'events', '{"event_id":2}', '2026-10-19 00:00:00'),
    (1, 'analytics_export', 'events', '{"event_id":1}', '2026-10-19 00:00:00');`);
  const h: any = await readEventHistory(f.env, f.event(1));
  assert.equal(h.available, true);assert.equal(h.created_at, '2026-09-01 00:00:00');assert.equal(h.submitted_at, '2026-10-17T00:00:00Z');
  assert.deepEqual(h.items, [
    { at: '2026-10-17 00:00:00', action: 'event_submitted', actor: 'host' },
    { at: '2026-10-18 00:00:00', action: 'event_rejected', actor: 'admin', reason: 'Add a venue' },
    { at: '2026-10-18 06:00:00', action: 'event_updated', actor: 'host', fields: ['location_text'] },
    { at: '2026-10-18 07:00:00', action: 'event_updated', actor: 'admin', fields: ['title'] },
    { at: '2026-10-19 00:00:00', action: 'event_featured', actor: 'admin', featured: true },
  ]);
  const res = await f.get('/1/history');assert.equal(res.status, 200);
  const text = await res.text();assert.doesNotMatch(text, NAMES);assert.doesNotMatch(text, /admin_user_id|"actor":"(?!admin|host)/);
  f.db.exec(`INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json, exported_at) VALUES
    (1, 'event_featured', 'events', '{"event_id":4,"featured":false}', '2026-10-19 00:00:00'),
    (1, 'event_updated', NULL, '{"event_id":4,"fields":["title"]}', '2026-10-19 01:00:00');`);
  const admins: any = await readEventHistory(f.env, f.event(4));
  assert.deepEqual(admins.items.map((i: any) => i.actor), ['admin', 'host'], 'a desk action is an admin\'s even when an admin hosts');
  const broken = fixture();broken.fail('FROM admin_audit_log');
  unreadableShape(await readEventHistory(broken.env, broken.event(1)));
});

test('D918 comp preview: counts what approve would invite, minus the invited, and mints nothing', async () => {
  const f = fixture();
  const before = f.db.prepare('SELECT COUNT(*) AS n FROM event_invitations').get()!.n;
  const p: any = await readCompPreview(f.env, f.event(1));
  assert.deepEqual(p.sources, { available: true,
    official_partners: { on: true, eligible: 2, already_invited: 1, would_invite: 1 },
    invested_lps: { on: true, eligible: 1, already_invited: 0, would_invite: 1 } });
  assert.deepEqual(p.seat_at_sign_up, ['comp_investors']);assert.equal(p.minted, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM event_invitations').get()!.n, before);
  const off: any = await readCompPreview(f.env, f.event(2));
  assert.deepEqual(off.sources.official_partners, { on: false, eligible: null, already_invited: null, would_invite: null });
  const broken = fixture();broken.fail('FROM limited_partners');
  unreadableShape((await readCompPreview(broken.env, broken.event(1))).sources);
  const res = await f.get('/1/comp-preview');assert.equal(res.status, 200);assert.doesNotMatch(await res.text(), NAMES);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM event_invitations').get()!.n, before);
});
