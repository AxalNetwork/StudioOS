/**
 * D1032 (#2873), part 2 of My events (#2387): the Worker reads and writes the
 * page needs. On `node:sqlite` with the events migrations (109, 392, 546) and
 * the routers themselves.
 *
 *   · GET /api/events: each place's registration, payment, comp source,
 *     check-in, decision and speaker flag; Past with cancelled and declined
 *     places, paged with an exact total; counts per hosted event; the review
 *     note; a failed read answers 5xx.
 *   · GET /api/events/invitations and POST /api/events/:id/invitation: my
 *     pending invitations, answered signed in, without the token.
 *   · POST /api/events/:id/cancel: the host's cancel, with the desk's effects
 *     and the paid tickets handed to the desk.
 *   · GET /api/public/events: format, price and an exact total.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/my_events_d1032.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import events from '../src/routes/events.ts';
import eventsPublic from '../src/routes/events_public.ts';

const SECRET = 'synthetic-my-events-d1032-key-'.repeat(2);
const FUTURE = '2099-03-01T10:00:00Z';
const LATER = '2099-04-01T10:00:00Z';
const ENDED = '2020-01-01T10:00:00Z';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['109_events_core.sql', '392_event_organiser.sql', '546_events_review_columns.sql']) {
    db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  }
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, uid TEXT, email TEXT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1,
      notification_prefs TEXT, stripe_customer_id TEXT);
    CREATE TABLE activity_logs (user_id INTEGER, action TEXT, details TEXT, actor TEXT);
    CREATE TABLE admin_audit_log (admin_user_id INTEGER, action TEXT, report_type TEXT, filters_json TEXT, actor TEXT);
    INSERT INTO users (id, uid, email, name, role) VALUES
      (1, 'admin', 'admin@example.test', 'Admin fixture', 'admin'),
      (2, 'host', 'host@example.test', 'Host fixture', 'founder'),
      (3, 'member', 'member@example.test', 'Member fixture', 'founder'),
      (4, 'other', 'other@example.test', 'Other fixture', 'investor');`);
  const log: Array<{ sql: string; args: any[] }> = [];
  let failOn: RegExp | null = null;
  // A desk or second tab cancels the event between the route's read and its update.
  let raceCancel = false;
  const DB: any = {
    prepare(sql: string) {
      let args: any[] = [];
      const fail = () => { if (failOn && failOn.test(sql)) throw new Error('synthetic read failure'); };
      const statement: any = {
        bind(...values: any[]) { args = values.map((v) => v ?? null); return statement; },
        async first() {
          log.push({ sql, args }); fail();
          if (raceCancel && sql.trimStart().startsWith('UPDATE events')) { db.exec("UPDATE events SET status = 'cancelled'"); raceCancel = false; }
          return db.prepare(sql).get(...args) || null;
        },
        async all() { log.push({ sql, args }); fail(); return { results: db.prepare(sql).all(...args) }; },
        async run() { log.push({ sql, args }); fail(); const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      };
      return statement;
    },
    async batch(stmts: any[]) { return Promise.all(stmts.map((s) => s.run())); },
  };
  const env: any = { DB, ENVIRONMENT: 'development', JWT_SECRET: SECRET };
  async function call(path: string, user: number | null, opts: { method?: string; body?: unknown; router?: any } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (user != null) {
      const token = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
        .sign(new TextEncoder().encode(SECRET));
      headers.Authorization = `Bearer ${token}`;
    }
    const router = opts.router || events;
    return router.request(path, { method: opts.method || 'GET', headers, ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }) }, env);
  }
  const ev = (o: Record<string, unknown>) => {
    const row = { host_user_id: 2, type: 'meetup', title: `Event ${o.id}`, starts_at: FUTURE, visibility: 'public', status: 'published', admin_published: 1, price_cents: 0, ...o };
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO events (slug, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`).run(`event-${o.id}`, ...cols.map((k) => (row as any)[k]));
  };
  const reg = (o: Record<string, unknown>) => {
    const row = { status: 'confirmed', payment_status: 'none', amount_cents: 0, comp: 0, source: 'self', ...o };
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO event_registrations (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((k) => (row as any)[k]));
  };
  /** Who `notify` was asked to tell: it first reads each recipient's preferences. */
  const notified = () => log.filter((l) => l.sql.includes('SELECT notification_prefs FROM users WHERE id = ?')).map((l) => Number(l.args[0])).sort();
  return { db, env, call, ev, reg, log, notified, failOn: (re: RegExp | null) => { failOn = re; }, race: () => { raceCancel = true; } };
}

const json = async (res: Response) => ({ status: res.status, body: await res.json() as any });

test('GET /api/events: each place carries its registration, payment, comp source, check-in, decision and speaker flag', async () => {
  // Mutation checked: `comp_source` from every invitation (not only a comp one) → the manual non-comp row reads "invitation";
  // the check-in gate's `payment_status != 'pending'` dropped → the unpaid seat shows a code; `is_speaker` without the
  // speaker match → every place reads true.
  const f = fixture();
  for (const id of [1, 2, 3, 4]) f.ev({ id });
  f.db.exec(`INSERT INTO event_invitations (id, event_id, token, invited_user_id, source, comp, status) VALUES
      (11, 1, 'tok-11', 3, 'auto_partner', 1, 'accepted'), (12, 3, 'tok-12', 3, 'manual', 0, 'accepted');
    INSERT INTO event_agenda_items (event_id, title, speaker_user_id) VALUES (1, 'Keynote', 3), (2, 'Panel', 4);`);
  f.reg({ id: 21, event_id: 1, user_id: 3, comp: 1, source: 'invite', invitation_id: 11 });
  f.reg({ id: 22, event_id: 2, user_id: 3, comp: 1 });
  f.reg({ id: 23, event_id: 3, user_id: 3, status: 'confirmed', payment_status: 'pending', amount_cents: 2500, invitation_id: 12, decision_reason: 'Approved fixture' });
  f.reg({ id: 24, event_id: 4, user_id: 3, status: 'waitlisted', waitlist_position: 2 });
  f.db.exec(`INSERT INTO event_checkins (event_id, registration_id, code, checked_in_at) VALUES
      (1, 21, 'CODE-21', '2099-03-01T10:05:00Z'), (3, 23, 'CODE-23', NULL);`);
  const { status, body } = await json(await f.call('/', 3));
  assert.equal(status, 200);
  const byId = Object.fromEntries(body.attending.map((p: any) => [p.id, p]));
  assert.deepEqual(Object.keys(byId).map(Number).sort(), [1, 2, 3, 4]);
  assert.deepEqual(
    (({ registration_id, reg_status, payment_status, amount_cents, comp, comp_source, comp_source_recorded, checked_in_at, decision_reason, is_speaker, checkin_code }) =>
      ({ registration_id, reg_status, payment_status, amount_cents, comp, comp_source, comp_source_recorded, checked_in_at, decision_reason, is_speaker, checkin_code }))(byId[1]),
    { registration_id: 21, reg_status: 'confirmed', payment_status: 'none', amount_cents: 0, comp: true, comp_source: 'official_partner', comp_source_recorded: true,
      checked_in_at: '2099-03-01T10:05:00Z', decision_reason: null, is_speaker: true, checkin_code: 'CODE-21' });
  // A free seat an audience rule gave: the rule is not stored, so its source is null and said to be unrecorded.
  assert.equal(byId[2].comp, true);
  assert.equal(byId[2].comp_source, null);
  assert.equal(byId[2].comp_source_recorded, false);
  assert.equal(byId[2].is_speaker, false, 'another member speaks there');
  // Paid and not yet paid: the amount and status travel, the code does not; the invitation was not a comp.
  assert.equal(byId[3].payment_status, 'pending');
  assert.equal(byId[3].amount_cents, 2500);
  assert.equal(byId[3].checkin_code, null);
  assert.equal(byId[3].comp, false);
  assert.equal(byId[3].comp_source, null);
  assert.equal(byId[3].comp_source_recorded, null, 'not a free seat at all');
  assert.equal(byId[3].decision_reason, 'Approved fixture');
  assert.equal(byId[4].reg_waitlist_position, 2);
  assert.equal(byId[4].checkin_code, null);
  // The old fields the D1030 page reads are still there.
  for (const p of body.attending) for (const k of ['reg_status', 'reg_waitlist_position', 'checkin_code', 'comp']) assert.ok(k in p, k);
});

test('GET /api/events: Past holds ended, cancelled and declined places, marked, newest first, paged with an exact total', async () => {
  // Mutation checked: the past predicate without the cancelled/declined clause → places 32 and 33 are missing;
  // the total counted from the page → 3, not 5; `pastOutcome` without the event-cancelled branch → 34 reads "ended".
  const f = fixture();
  f.ev({ id: 1, starts_at: ENDED });
  f.ev({ id: 2, starts_at: FUTURE });
  f.ev({ id: 3, starts_at: LATER });
  f.ev({ id: 4, starts_at: FUTURE, status: 'cancelled' });
  f.ev({ id: 5, starts_at: '2021-06-01T10:00:00Z' });
  f.ev({ id: 6, starts_at: FUTURE });
  f.reg({ id: 31, event_id: 1, user_id: 3, status: 'attended' });
  f.reg({ id: 32, event_id: 2, user_id: 3, status: 'cancelled' });
  f.reg({ id: 33, event_id: 3, user_id: 3, status: 'declined', decision_reason: 'Full fixture' });
  f.reg({ id: 34, event_id: 4, user_id: 3, status: 'confirmed' });
  f.reg({ id: 35, event_id: 5, user_id: 3, status: 'confirmed' });
  f.reg({ id: 36, event_id: 6, user_id: 3, status: 'confirmed' });
  const all = (await json(await f.call('/?past_limit=10', 3))).body;
  assert.deepEqual(all.past.places.map((p: any) => [p.registration_id, p.outcome]),
    [[33, 'declined'], [34, 'event_cancelled'], [32, 'cancelled'], [35, 'ended'], [31, 'attended']], 'newest event first; a tie by the newer place');
  assert.equal(all.past.total, 5);
  assert.equal(all.past.places.find((p: any) => p.registration_id === 33).decision_reason, 'Full fixture');
  // Cancelled and declined places are not Upcoming.
  assert.deepEqual(all.attending.map((p: any) => p.registration_id).sort(), [31, 34, 35, 36]);
  const page = (await json(await f.call('/?past_limit=2&past_offset=2', 3))).body;
  assert.deepEqual(page.past.places.map((p: any) => p.registration_id), [32, 35]);
  assert.deepEqual([page.past.total, page.past.limit, page.past.offset], [5, 2, 2]);
  const beyond = (await json(await f.call('/?past_limit=2&past_offset=40', 3))).body;
  assert.deepEqual([beyond.past.places.length, beyond.past.total], [0, 5], 'a page past the end keeps the exact total');
  // Defaults, and nonsense falls back to them.
  const dflt = (await json(await f.call('/?past_limit=-3&past_offset=x', 3))).body;
  assert.deepEqual([dflt.past.limit, dflt.past.offset], [20, 0]);
  // A cancelled place never carries its join link.
  assert.equal(all.past.places.find((p: any) => p.registration_id === 32).location_url, null);
});

test('GET /api/events: each hosted event carries its counts and the desk\'s review note', async () => {
  // Mutation checked: pending_approvals counted from confirmed → 2, not 1; checked_in without the NULL check → 2, not 1;
  // invitations_open counting accepted ones → 2, not 1.
  const f = fixture();
  f.ev({ id: 1, approval_required: 1 });
  f.ev({ id: 2, status: 'rejected', review_note: 'Add a venue fixture' });
  f.reg({ id: 41, event_id: 1, user_id: 3, status: 'confirmed' });
  f.reg({ id: 42, event_id: 1, user_id: 4, status: 'registered' });
  f.reg({ id: 43, event_id: 1, email: 'guest@example.test', status: 'attended' });
  f.reg({ id: 44, event_id: 1, email: 'wait@example.test', status: 'waitlisted' });
  f.reg({ id: 45, event_id: 1, email: 'gone@example.test', status: 'cancelled' });
  f.db.exec(`INSERT INTO event_checkins (event_id, registration_id, code, checked_in_at) VALUES
      (1, 43, 'C43', '2099-03-01T10:00:00Z'), (1, 41, 'C41', NULL);
    INSERT INTO event_invitations (event_id, token, invited_email, status) VALUES
      (1, 't1', 'a@example.test', 'pending'), (1, 't2', 'b@example.test', 'accepted'), (1, 't3', 'c@example.test', 'revoked');`);
  const { body } = await json(await f.call('/', 2));
  const one = body.hosting.find((e: any) => e.id === 1);
  assert.deepEqual(one.counts, { seats_taken: 3, waitlisted: 1, pending_approvals: 1, checked_in: 1, invitations_open: 1 });
  const two = body.hosting.find((e: any) => e.id === 2);
  assert.deepEqual(two.counts, { seats_taken: 0, waitlisted: 0, pending_approvals: 0, checked_in: 0, invitations_open: 0 });
  assert.equal(two.status, 'rejected');
  assert.equal(two.review_note, 'Add a venue fixture');
  // Counts are the host's own: a member reads no hosting at all.
  assert.deepEqual((await json(await f.call('/', 3))).body.hosting, []);
});

test('GET /api/events: a read that fails answers 5xx, never an empty list', async () => {
  // Mutation checked: the counts read caught to an empty list → the status is 200.
  for (const failing of [/AS pending_approvals/, /event_agenda_items a WHERE/, /SELECT COUNT\(\*\) AS n FROM events e JOIN event_registrations/, /FROM event_checkins ch JOIN events/, /FROM event_invitations i JOIN events e ON e.id = i.event_id\s+WHERE e.host_user_id/]) {
    const f = fixture();
    f.ev({ id: 1 });
    f.reg({ id: 51, event_id: 1, user_id: 3 });
    f.failOn(failing);
    const res = await f.call('/', 3);
    assert.ok(res.status >= 500, `${failing} → ${res.status}`);
  }
  assert.equal((await fixture().call('/', null)).status, 401);
});

test('GET /api/events/invitations: my pending invitations by user id or email, for open events, without the token', async () => {
  // Mutation checked: the email match dropped → invitation 62 is missing; the ended-event clause dropped → 65 appears;
  // `status = 'pending'` dropped → 63 appears.
  const f = fixture();
  f.ev({ id: 1 });
  f.ev({ id: 2, visibility: 'private' });
  f.ev({ id: 3 });
  f.ev({ id: 4, status: 'cancelled' });
  f.ev({ id: 5, starts_at: ENDED });
  f.db.exec(`INSERT INTO event_invitations (id, event_id, token, invited_user_id, invited_email, comp, status, personal_message) VALUES
      (61, 1, 'secret-61', 3, NULL, 1, 'pending', 'Come along'),
      (62, 2, 'secret-62', NULL, 'MEMBER@example.test', 0, 'pending', NULL),
      (63, 3, 'secret-63', 3, NULL, 0, 'accepted', NULL),
      (64, 4, 'secret-64', 3, NULL, 0, 'pending', NULL),
      (65, 5, 'secret-65', 3, NULL, 0, 'pending', NULL),
      (66, 1, 'secret-66', 4, NULL, 0, 'pending', NULL);`);
  const res = await f.call('/invitations', 3);
  const text = await res.clone().text();
  const { status, body } = await json(res);
  assert.equal(status, 200);
  assert.deepEqual(body.invitations.map((i: any) => [i.invitation_id, i.event.id, i.comp]), [[61, 1, true], [62, 2, false]]);
  assert.equal(body.invitations[0].personal_message, 'Come along');
  assert.equal(body.invitations[0].host_name, 'Host fixture');
  assert.doesNotMatch(text, /secret-/, 'the RSVP token never travels');
  assert.equal(body.invitations[1].event.location_url, null, 'no join link before a seat');
});

test('POST /api/events/:id/invitation: decline, and accept registers and records the acceptance only once the seat is held', async () => {
  // Mutation checked: acceptance written before `registerPrincipal` → the full event leaves it "accepted";
  // the revoked check dropped → a revoked invitation registers.
  const f = fixture();
  f.ev({ id: 1, visibility: 'private' });
  f.ev({ id: 2, capacity: 1, waitlist_enabled: 0 });
  f.ev({ id: 3 });
  f.ev({ id: 4, status: 'draft' });
  f.db.exec(`INSERT INTO event_invitations (id, event_id, token, invited_user_id, invited_email, comp, status, source) VALUES
      (71, 1, 'tok-71', 3, NULL, 1, 'pending', 'manual'),
      (72, 2, 'tok-72', NULL, 'member@example.test', 0, 'pending', 'manual'),
      (73, 3, 'tok-73', 3, NULL, 0, 'revoked', 'manual'),
      (74, 4, 'tok-74', 3, NULL, 0, 'pending', 'manual');`);
  f.reg({ id: 81, event_id: 2, user_id: 4 });
  const invStatus = (id: number) => (f.db.prepare('SELECT status FROM event_invitations WHERE id = ?').get(id) as any).status;
  const accepted = await json(await f.call('/1/invitation', 3, { method: 'POST', body: { action: 'accept' } }));
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.comp, true);
  const row: any = f.db.prepare('SELECT * FROM event_registrations WHERE event_id = 1 AND user_id = 3').get();
  assert.deepEqual([row.status, row.source, row.invitation_id, row.comp], ['confirmed', 'invite', 71, 1]);
  assert.equal(invStatus(71), 'accepted');
  // Full and no waitlist: refused, and the invitation stays pending.
  const full = await f.call('/2/invitation', 3, { method: 'POST', body: { action: 'accept' } });
  assert.equal(full.status, 409);
  assert.equal(invStatus(72), 'pending');
  // Decline needs no open event.
  assert.deepEqual((await json(await f.call('/2/invitation', 3, { method: 'POST', body: { action: 'decline' } }))).body, { ok: true, status: 'declined' });
  assert.equal(invStatus(72), 'declined');
  const revoked = await json(await f.call('/3/invitation', 3, { method: 'POST', body: { action: 'accept' } }));
  assert.deepEqual([revoked.status, revoked.body.error], [409, 'invite_revoked']);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM event_registrations WHERE event_id = 3').get()!.n, 0);
  const closed = await json(await f.call('/4/invitation', 3, { method: 'POST', body: { action: 'accept' } }));
  assert.deepEqual([closed.status, closed.body.error], [400, 'not_open']);
  assert.equal(invStatus(74), 'pending');
  const none = await json(await f.call('/1/invitation', 4, { method: 'POST', body: { action: 'accept' } }));
  assert.deepEqual([none.status, none.body.error], [404, 'no_invitation']);
  const bad = await json(await f.call('/1/invitation', 3, { method: 'POST', body: { action: 'maybe' } }));
  assert.deepEqual([bad.status, bad.body.error], [400, 'invalid_action']);
  assert.equal(typeof bad.body.message, 'string', 'refusals carry a sentence');
});

test('POST /api/events/:id/invitation: a paid ticket accepted signed in gets its PaymentIntent, as /register does', async () => {
  // Mutation checked: `selfPay` not passed (or not honoured) → no Stripe call and no client_secret.
  const f = fixture();
  f.ev({ id: 1, price_cents: 4000, currency: 'usd' });
  f.db.exec(`INSERT INTO event_invitations (id, event_id, token, invited_user_id, comp, status, source) VALUES (91, 1, 'tok-91', 3, 0, 'pending', 'manual');`);
  f.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input?.url || input);
    calls.push(url);
    const body = /\/customers/.test(url) ? { id: 'cus_fixture' } : { id: 'pi_fixture', client_secret: 'pi_fixture_secret', amount: 4000, currency: 'usd' };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
  try {
    const res = await json(await f.call('/1/invitation', 3, { method: 'POST', body: { action: 'accept' } }));
    assert.equal(res.status, 201);
    assert.equal(res.body.needs_payment, true);
    assert.equal(res.body.client_secret, 'pi_fixture_secret');
    assert.ok(calls.some((u) => /payment_intents/.test(u)), 'a PaymentIntent was created');
    const row: any = f.db.prepare('SELECT status, payment_status, amount_cents FROM event_registrations WHERE event_id = 1 AND user_id = 3').get();
    assert.deepEqual([row.status, row.payment_status, row.amount_cents], ['confirmed', 'pending', 4000]);
  } finally { globalThis.fetch = realFetch; }
});

test('POST /api/events/:id/cancel: the host cancels with the desk\'s effects, and the paid tickets go to the desk', async () => {
  // Mutation checked: `canManage` dropped → the member cancels; the update's `status != 'cancelled'` dropped → the raced
  // cancel is 200 and notifies again; the seated filter dropped → the cancelled place is told too.
  const f = fixture();
  f.ev({ id: 1, price_cents: 3000, currency: 'usd' });
  f.reg({ id: 101, event_id: 1, user_id: 3, payment_status: 'paid', amount_cents: 3000 });
  f.reg({ id: 102, event_id: 1, user_id: 4, status: 'waitlisted' });
  f.reg({ id: 103, event_id: 1, email: 'guest@example.test', payment_status: 'paid', amount_cents: 3000 });
  f.reg({ id: 104, event_id: 1, user_id: 1, status: 'cancelled' });
  const refused = await json(await f.call('/1/cancel', 3, { method: 'POST', body: {} }));
  assert.deepEqual([refused.status, refused.body.error], [403, 'forbidden']);
  assert.equal(typeof refused.body.message, 'string');
  assert.equal((f.db.prepare('SELECT status FROM events WHERE id = 1').get() as any).status, 'published');
  const done = await json(await f.call('/1/cancel', 2, { method: 'POST', body: { note: 'Venue fell through' } }));
  assert.equal(done.status, 200);
  assert.equal(done.body.event.status, 'cancelled');
  assert.equal(done.body.event.admin_published, false, 'it leaves the public feed');
  assert.deepEqual(done.body.paid_tickets, { count: 2, by_currency: [{ currency: 'usd', amount_cents: 6000 }], refunds_by: 'events_desk' });
  assert.deepEqual(f.notified(), [3, 4], 'every place holder is told, and no one who cancelled');
  const audit: any = f.db.prepare("SELECT details FROM activity_logs WHERE action = 'event_cancelled_by_host'").get();
  assert.ok(audit && JSON.parse(audit.details).paid_tickets === 2);
  const again = await json(await f.call('/1/cancel', 2, { method: 'POST', body: {} }));
  assert.deepEqual([again.status, again.body.error], [409, 'already_cancelled']);
  // An admin manages every event; a missing one is 404.
  f.ev({ id: 2 });
  assert.equal((await f.call('/2/cancel', 1, { method: 'POST', body: {} })).status, 200);
  assert.equal((await f.call('/99/cancel', 2, { method: 'POST', body: {} })).status, 404);
  // Cancelled by someone else between the read and the update: refused, and no one is told twice.
  const r = fixture();
  r.ev({ id: 1 });
  r.reg({ id: 105, event_id: 1, user_id: 3 });
  r.race();
  const raced = await json(await r.call('/1/cancel', 2, { method: 'POST', body: {} }));
  assert.deepEqual([raced.status, raced.body.error], [409, 'already_cancelled']);
  assert.deepEqual(r.notified(), []);
  assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'event_cancelled_by_host'").get()!.n, 0);
  // An unreadable payment ledger fails the cancel before anything changes.
  const g = fixture();
  g.ev({ id: 1 });
  g.failOn(/SUM\(r.amount_cents\)/);
  const broken = await g.call('/1/cancel', 2, { method: 'POST', body: {} });
  assert.ok(broken.status >= 500);
  assert.equal((g.db.prepare('SELECT status FROM events WHERE id = 1').get() as any).status, 'published');
});

test('GET /api/public/events: format and price filter, the total is exact, and a value outside the list is refused', async () => {
  // Mutation checked: the total counted without the filters → 5; `price=free` read as `>= 0` → paid events appear;
  // an unknown format ignored → 200 with every event.
  const f = fixture();
  f.ev({ id: 1, location_kind: 'virtual', price_cents: 0 });
  f.ev({ id: 2, location_kind: 'in_person', price_cents: 0, starts_at: LATER });
  f.ev({ id: 3, location_kind: 'in_person', price_cents: 1500 });
  f.ev({ id: 4, location_kind: 'hybrid', price_cents: 0 });
  f.ev({ id: 5, location_kind: 'in_person', price_cents: 0, admin_published: 0 });
  const pub = (q: string) => f.call(`/events${q}`, null, { router: eventsPublic }).then(json);
  const inPerson = await pub('?format=in_person');
  assert.deepEqual(inPerson.body.events.map((e: any) => e.id), [3, 2]);
  assert.equal(inPerson.body.total, 2);
  const free = await pub('?price=free');
  assert.deepEqual(free.body.events.map((e: any) => e.id).sort(), [1, 2, 4]);
  assert.equal(free.body.total, 3);
  assert.deepEqual((await pub('?price=paid')).body.events.map((e: any) => e.id), [3]);
  const paged = await pub('?price=free&limit=1&offset=1');
  assert.deepEqual([paged.body.events.length, paged.body.total, paged.body.limit, paged.body.offset], [1, 3, 1, 1]);
  assert.equal((await pub('')).body.total, 4, 'the feed predicate still holds');
  for (const [q, code] of [['?format=boat', 'invalid_format'], ['?price=cheap', 'invalid_price']]) {
    const r = await pub(q);
    assert.deepEqual([r.status, r.body.error], [400, code]);
    assert.equal(typeof r.body.message, 'string');
  }
});
