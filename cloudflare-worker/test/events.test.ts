/**
 * Task #39 — Event engine backend.
 *
 * Drives the real route module + services against an in-memory SQLite database
 * loaded with the actual sql/migrations/109_events_core.sql, through a tiny D1
 * adapter (so the same code that runs on Cloudflare D1 runs here unchanged).
 *
 * Coverage:
 *   1. Public feed predicate (§1.3): only visibility='public' + status=
 *      'published' + admin_published=1 + upcoming events are listed.
 *   2. Capacity → waitlist → promotion (§3): a full event waitlists, and
 *      freeing a seat promotes the head of the waitlist transactionally.
 *   3. Comp eligibility + auto-mint (§7): partners/LPs are eligible and
 *      mintCompInvitations is idempotent (auto_partner/auto_lp only).
 *
 * Run via the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/events.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import eventsPublic from '../src/routes/events_public.ts';
import { registerPrincipal, canViewEvent } from '../src/routes/events.ts';
import {
  classifyNewSeat,
  promoteWaitlist,
  seatsTaken,
} from '../src/services/eventCapacity.ts';
import {
  evaluateCompEligibility,
  isPrincipalCompEligible,
  mintCompInvitations,
} from '../src/services/eventAudience.ts';

// ── Tiny D1 adapter over node:sqlite ───────────────────────────────────────
function coerce(args: any[]): any[] {
  return args.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let binds: any[] = [];
      const api: any = {
        bind: (...a: any[]) => { binds = coerce(a); return api; },
        async first() {
          const row = db.prepare(sql).get(...binds);
          return row ?? null;
        },
        async all() {
          return { results: db.prepare(sql).all(...binds) };
        },
        async run() {
          const r = db.prepare(sql).run(...binds);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(stmts: any[]) { return stmts; },
  };
}

function freshDb() {
  // D1 does not enforce FK constraints; node:sqlite does by default. Disable so
  // the events tables don't require the entire referenced-table graph (users,
  // projects, …) to exist for this focused unit test.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const schema = readFileSync(new URL('../sql/migrations/109_events_core.sql', import.meta.url), 'utf8');
  db.exec(schema);
  return db;
}

function makeEnv(db: InstanceType<typeof DatabaseSync>): any {
  return { DB: makeD1(db), ENVIRONMENT: 'development', JWT_SECRET: 'x'.repeat(40) };
}

const ctx: any = { waitUntil() {}, passThroughOnException() {} };

// Minimal Hono-ish context for calling registerPrincipal() directly.
function makeCtx(env: any): any {
  return {
    env,
    json: (obj: any, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } }),
  };
}
const REG_BASE = { comp: false, paid: false, source: 'self', invitationId: null, answers: null };

function insertEvent(db: InstanceType<typeof DatabaseSync>, e: Record<string, any>): number {
  const cols = Object.keys(e);
  const r = db
    .prepare(`INSERT INTO events (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...coerce(cols.map((k) => e[k])));
  return Number(r.lastInsertRowid);
}

// ── 1. Public feed predicate ───────────────────────────────────────────────
test('public feed lists only public + published + admin_published upcoming events', async () => {
  const db = freshDb();
  const future = '2090-01-01T18:00:00Z';
  const past = '2000-01-01T18:00:00Z';
  // Should appear: public, published, admin_published, upcoming.
  insertEvent(db, { slug: 'live', title: 'Live Meetup', starts_at: future, visibility: 'public', status: 'published', admin_published: 1 });
  // Should NOT: not yet admin-approved.
  insertEvent(db, { slug: 'pending', title: 'Pending', starts_at: future, visibility: 'public', status: 'pending_review', admin_published: 0 });
  // Should NOT: approved row but admin_published flag off.
  insertEvent(db, { slug: 'flagoff', title: 'Flag Off', starts_at: future, visibility: 'public', status: 'published', admin_published: 0 });
  // Should NOT: private.
  insertEvent(db, { slug: 'secret', title: 'Secret', starts_at: future, visibility: 'private', status: 'published', admin_published: 1 });
  // Should NOT: in the past (default upcoming filter).
  insertEvent(db, { slug: 'old', title: 'Old', starts_at: past, visibility: 'public', status: 'published', admin_published: 1 });

  const env = makeEnv(db);
  const res = await eventsPublic.request('/events', {}, env, ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  const slugs = body.events.map((e: any) => e.slug);
  assert.deepEqual(slugs, ['live'], 'only the live public upcoming event is listed');
  // Boolean coercion is applied in the public shape.
  assert.equal(body.events[0].waitlist_enabled, true);
  assert.equal(typeof body.events[0].admin_published, 'undefined', 'public shape must not leak admin flags');

  // ?past=1 is the ARCHIVE, not "everything". The old behaviour merely dropped
  // the date predicate, so the Past tab led with the same upcoming events the
  // visitor had just been looking at — asserting only `.some(slug === 'old')`
  // could not tell the two apart, which is how it went unnoticed.
  const resPast = await eventsPublic.request('/events?past=1', {}, env, ctx);
  const bodyPast = await resPast.json();
  const pastSlugs = bodyPast.events.map((e: any) => e.slug);
  assert.deepEqual(pastSlugs, ['old'], 'past=1 returns finished events only');
});

test('an event that has started but not ended is still upcoming, and the archive reads backwards', async () => {
  const db = freshDb();
  const pub = { visibility: 'public', status: 'published', admin_published: 1 };
  // Running right now: started yesterday, ends tomorrow. `starts_at >= now`
  // would have dropped it off both tabs — upcoming (it started) and past (it
  // has not finished).
  insertEvent(db, {
    slug: 'in-progress', title: 'In Progress',
    starts_at: `2000-01-01T00:00:00Z`, ends_at: '2090-01-01T00:00:00Z', ...pub,
  });
  insertEvent(db, { slug: 'older', title: 'Older', starts_at: '2000-01-01T18:00:00Z', ...pub });
  insertEvent(db, { slug: 'newer', title: 'Newer', starts_at: '2020-01-01T18:00:00Z', ...pub });

  const env = makeEnv(db);
  const up = await (await eventsPublic.request('/events', {}, env, ctx)).json();
  assert.deepEqual(up.events.map((e: any) => e.slug), ['in-progress'],
    'a session in progress belongs on the upcoming tab');

  const past = await (await eventsPublic.request('/events?past=1', {}, env, ctx)).json();
  assert.deepEqual(past.events.map((e: any) => e.slug), ['newer', 'older'],
    'the archive is most-recent-first, and excludes the event still running');
});

test('private events 404 on the public detail endpoint; unlisted resolve by slug', async () => {
  const db = freshDb();
  const future = '2090-01-01T18:00:00Z';
  insertEvent(db, { slug: 'unlisted-talk', title: 'Unlisted', starts_at: future, visibility: 'unlisted', status: 'published', admin_published: 0 });
  insertEvent(db, { slug: 'private-talk', title: 'Private', starts_at: future, visibility: 'private', status: 'published', admin_published: 1 });
  const env = makeEnv(db);

  const ok = await eventsPublic.request('/events/unlisted-talk', {}, env, ctx);
  assert.equal(ok.status, 200, 'unlisted events are reachable by direct slug');

  const denied = await eventsPublic.request('/events/private-talk', {}, env, ctx);
  assert.equal(denied.status, 404, 'private events are invite-only (404 on public detail)');
});

// ── 2. Capacity → waitlist → promotion ─────────────────────────────────────
test('a full event waitlists, and freeing a seat promotes the waitlist head', async () => {
  const db = freshDb();
  const id = insertEvent(db, {
    slug: 'cap1', title: 'Cap 1', starts_at: '2090-02-02T18:00:00Z',
    visibility: 'public', status: 'published', admin_published: 1,
    capacity: 1, waitlist_enabled: 1, approval_required: 0,
  });
  const env = makeEnv(db);
  const event: any = db.prepare('SELECT * FROM events WHERE id = ?').get(id);

  // Seat A.
  db.prepare(`INSERT INTO event_registrations (event_id, user_id, name, status) VALUES (?, 1, 'A', 'confirmed')`).run(id);
  assert.equal(await seatsTaken(env, id), 1);

  // B arrives to a full event → waitlisted at position 1.
  const decision = await classifyNewSeat(env, event, { comp: false });
  assert.deepEqual(decision, { status: 'waitlisted', waitlistPosition: 1 });
  db.prepare(`INSERT INTO event_registrations (event_id, user_id, name, status, waitlist_position) VALUES (?, 2, 'B', 'waitlisted', 1)`).run(id);

  // C also waitlisted at position 2.
  const decision2 = await classifyNewSeat(env, event, { comp: false });
  assert.equal(decision2.status, 'waitlisted');
  assert.equal(decision2.waitlistPosition, 2);
  db.prepare(`INSERT INTO event_registrations (event_id, user_id, name, status, waitlist_position) VALUES (?, 3, 'C', 'waitlisted', 2)`).run(id);

  // A cancels → exactly one seat frees → B (head) is promoted, C stays.
  db.prepare(`UPDATE event_registrations SET status = 'cancelled' WHERE user_id = 1 AND event_id = ?`).run(id);
  const promoted = await promoteWaitlist(env, event);
  assert.equal(promoted.length, 1, 'only one seat freed → one promotion');
  assert.equal(promoted[0].name, 'B');
  assert.equal(promoted[0].status, 'confirmed');

  const b: any = db.prepare(`SELECT * FROM event_registrations WHERE user_id = 2 AND event_id = ?`).get(id);
  assert.equal(b.status, 'confirmed');
  assert.equal(b.waitlist_position, null, 'promoted row clears its waitlist position');
  const cRow: any = db.prepare(`SELECT * FROM event_registrations WHERE user_id = 3 AND event_id = ?`).get(id);
  assert.equal(cRow.status, 'waitlisted', 'C remains waitlisted (no free seat left)');

  // Promotion minted a check-in code for the seated registration.
  const code: any = db.prepare(`SELECT code FROM event_checkins WHERE event_id = ? AND registration_id = ?`).get(id, b.id);
  assert.ok(code?.code, 'promoted registration receives a check-in code');
  assert.equal(await seatsTaken(env, id), 1, 'capacity still respected after promotion');
});

test('unlimited capacity (NULL) drains the whole waitlist on promotion', async () => {
  const db = freshDb();
  const id = insertEvent(db, {
    slug: 'unl', title: 'Unlimited', starts_at: '2090-03-03T18:00:00Z',
    visibility: 'public', status: 'published', admin_published: 1,
    capacity: null, waitlist_enabled: 1, approval_required: 0,
  });
  const env = makeEnv(db);
  const event: any = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  // Two stray waitlisted rows (e.g. capacity was lowered then cleared).
  db.prepare(`INSERT INTO event_registrations (event_id, user_id, name, status, waitlist_position) VALUES (?, 1, 'A', 'waitlisted', 1)`).run(id);
  db.prepare(`INSERT INTO event_registrations (event_id, user_id, name, status, waitlist_position) VALUES (?, 2, 'B', 'waitlisted', 2)`).run(id);
  const promoted = await promoteWaitlist(env, event);
  assert.equal(promoted.length, 2, 'NULL capacity promotes everyone');
});

test('registerPrincipal claims a seat atomically and waitlists once the house is full', async () => {
  const db = freshDb();
  const id = insertEvent(db, {
    slug: 'atomic', title: 'Atomic', starts_at: '2090-05-05T18:00:00Z',
    visibility: 'public', status: 'published', admin_published: 1,
    capacity: 1, waitlist_enabled: 1, approval_required: 0,
  });
  const env = makeEnv(db);
  const event: any = db.prepare('SELECT * FROM events WHERE id = ?').get(id);

  const rA = await registerPrincipal(makeCtx(env), event, { ...REG_BASE, userId: 1, email: 'a@x.com', name: 'A' });
  assert.equal(rA.status, 201);
  const bodyA = await rA.json();
  assert.equal(bodyA.status, 'confirmed');
  assert.ok(bodyA.checkin_code, 'a seated registration receives a check-in code');

  // Second registrant finds the single seat already claimed → waitlisted.
  const rB = await registerPrincipal(makeCtx(env), event, { ...REG_BASE, userId: 2, email: 'b@x.com', name: 'B' });
  const bodyB = await rB.json();
  assert.equal(bodyB.status, 'waitlisted');
  assert.equal(bodyB.waitlist_position, 1);
  assert.equal(bodyB.checkin_code, null, 'a waitlisted registration gets no check-in code');
  assert.equal(await seatsTaken(env, id), 1, 'the capacity-1 event never over-allocates');
});

test('registerPrincipal refuses a full event when the waitlist is disabled', async () => {
  const db = freshDb();
  const id = insertEvent(db, {
    slug: 'nowait', title: 'No Wait', starts_at: '2090-06-06T18:00:00Z',
    visibility: 'public', status: 'published', admin_published: 1,
    capacity: 1, waitlist_enabled: 0, approval_required: 0,
  });
  const env = makeEnv(db);
  const event: any = db.prepare('SELECT * FROM events WHERE id = ?').get(id);

  const rA = await registerPrincipal(makeCtx(env), event, { ...REG_BASE, userId: 1, email: 'a@x.com', name: 'A' });
  assert.equal((await rA.json()).status, 'confirmed');

  const rB = await registerPrincipal(makeCtx(env), event, { ...REG_BASE, userId: 2, email: 'b@x.com', name: 'B' });
  assert.equal(rB.status, 409);
  assert.equal((await rB.json()).full, true);
  assert.equal(await seatsTaken(env, id), 1, 'a refused registration claims no seat');
});

// ── Invite lifecycle (design §2) ───────────────────────────────────────────
test('invite respond blocks a revoked invite and refuses accept on an unopened event', async () => {
  const db = freshDb();
  const future = '2090-07-07T18:00:00Z';
  const liveId = insertEvent(db, { slug: 'inv-live', title: 'Live', starts_at: future, visibility: 'private', status: 'published', admin_published: 0 });
  db.prepare(`INSERT INTO event_invitations (event_id, invited_email, token, status) VALUES (?, 'rev@x.com', 'tok-rev', 'revoked')`).run(liveId);
  const draftId = insertEvent(db, { slug: 'inv-draft', title: 'Draft', starts_at: future, visibility: 'public', status: 'pending_review', admin_published: 0 });
  db.prepare(`INSERT INTO event_invitations (event_id, invited_email, token, status) VALUES (?, 'p@x.com', 'tok-pending', 'pending')`).run(draftId);

  const env = makeEnv(db);
  const post = (token: string, action: string) =>
    eventsPublic.request(`/invite/${token}/respond`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }),
    }, env, ctx);

  const revoked = await post('tok-rev', 'accept');
  assert.equal(revoked.status, 409);
  assert.equal((await revoked.json()).error, 'invite_revoked');

  const notOpen = await post('tok-pending', 'accept');
  assert.equal(notOpen.status, 400);
  assert.equal((await notOpen.json()).error, 'not_open');
});

test('invite respond accepts a valid comp invite and creates a confirmed registration', async () => {
  const db = freshDb();
  const id = insertEvent(db, {
    slug: 'inv-ok', title: 'OK', starts_at: '2090-08-08T18:00:00Z',
    visibility: 'private', status: 'published', admin_published: 0,
    capacity: null, waitlist_enabled: 0, approval_required: 0,
  });
  db.prepare(`INSERT INTO event_invitations (event_id, invited_email, token, status, comp) VALUES (?, 'guest@x.com', 'tok-ok', 'pending', 1)`).run(id);
  // The accept path resolves the inviter's email against users (none here → null).
  db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT)`);

  const env = makeEnv(db);
  const res = await eventsPublic.request('/invite/tok-ok/respond', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'accept' }),
  }, env, ctx);
  assert.equal(res.status, 201);
  assert.equal((await res.json()).status, 'confirmed');

  const inv: any = db.prepare(`SELECT status FROM event_invitations WHERE token = 'tok-ok'`).get();
  assert.equal(inv.status, 'accepted', 'accepting flips the invite to accepted');
  const reg: any = db.prepare(`SELECT * FROM event_registrations WHERE event_id = ? AND lower(email) = 'guest@x.com'`).get(id);
  assert.equal(reg.status, 'confirmed');
  assert.equal(reg.comp, 1, 'a comp invite carries comp onto the registration');
});

// ── Read access control (design §1.3) ──────────────────────────────────────
test('canViewEvent gates reads by manager, publish state, visibility, and invite', async () => {
  const db = freshDb();
  const env = makeEnv(db);
  const host = { id: 7, email: 'host@x.com', role: 'founder' } as any;
  const admin = { id: 1, email: 'admin@x.com', role: 'admin' } as any;
  const stranger = { id: 99, email: 'stranger@x.com', role: 'founder' } as any;
  const load = (id: number): any => db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  const at = '2090-01-01T00:00:00Z';

  const draftPrivate = load(insertEvent(db, { slug: 'cv1', title: 'D', starts_at: at, host_user_id: 7, visibility: 'private', status: 'draft', admin_published: 0 }));
  assert.equal(await canViewEvent(env, draftPrivate, host), true, 'host always sees their own event');
  assert.equal(await canViewEvent(env, draftPrivate, admin), true, 'admin always sees any event');
  assert.equal(await canViewEvent(env, draftPrivate, stranger), false, 'a stranger cannot see a private draft');

  const pubPending = load(insertEvent(db, { slug: 'cv2', title: 'P', starts_at: at, host_user_id: 7, visibility: 'public', status: 'published', admin_published: 0 }));
  assert.equal(await canViewEvent(env, pubPending, stranger), false, 'public is invisible until an admin publishes it');

  const pubLive = load(insertEvent(db, { slug: 'cv3', title: 'L', starts_at: at, host_user_id: 7, visibility: 'public', status: 'published', admin_published: 1 }));
  assert.equal(await canViewEvent(env, pubLive, stranger), true, 'admin-published public is viewable by anyone');

  const unlisted = load(insertEvent(db, { slug: 'cv4', title: 'U', starts_at: at, host_user_id: 7, visibility: 'unlisted', status: 'published', admin_published: 0 }));
  assert.equal(await canViewEvent(env, unlisted, stranger), true, 'unlisted published is reachable by link');

  const invited = load(insertEvent(db, { slug: 'cv5', title: 'I', starts_at: at, host_user_id: 7, visibility: 'private', status: 'published', admin_published: 0 }));
  db.prepare(`INSERT INTO event_invitations (event_id, invited_email, token, status) VALUES (?, 'stranger@x.com', 'cv-inv', 'pending')`).run(invited.id);
  assert.equal(await canViewEvent(env, invited, stranger), true, 'a pending invite unlocks a private event');

  const revokedOnly = load(insertEvent(db, { slug: 'cv6', title: 'R', starts_at: at, host_user_id: 7, visibility: 'private', status: 'published', admin_published: 0 }));
  db.prepare(`INSERT INTO event_invitations (event_id, invited_email, token, status) VALUES (?, 'stranger@x.com', 'cv-rev', 'revoked')`).run(revokedOnly.id);
  assert.equal(await canViewEvent(env, revokedOnly, stranger), false, 'a revoked invite no longer unlocks the event');
});

test('public invite read refuses a revoked token without leaking the event', async () => {
  const db = freshDb();
  const id = insertEvent(db, { slug: 'rev-read', title: 'Secret', starts_at: '2090-02-02T00:00:00Z', visibility: 'private', status: 'published', admin_published: 0 });
  db.prepare(`INSERT INTO event_invitations (event_id, invited_email, token, status) VALUES (?, 'g@x.com', 'tok-revread', 'revoked')`).run(id);
  const env = makeEnv(db);
  const res = await eventsPublic.request('/invite/tok-revread', { method: 'GET' }, env, ctx);
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, 'invite_revoked');
  assert.equal(body.event, undefined, 'a revoked invite read discloses nothing about the event');
});

// ── 3. Comp eligibility + auto-mint ────────────────────────────────────────
function seedAudienceTables(db: InstanceType<typeof DatabaseSync>) {
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT);
    CREATE TABLE partners (id INTEGER PRIMARY KEY, email TEXT, name TEXT, status TEXT);
    CREATE TABLE limited_partners (user_id INTEGER, invested_amount INTEGER, status TEXT);
    CREATE TABLE investor_profiles (user_id INTEGER PRIMARY KEY, contribute_to_signals INTEGER);
  `);
  db.prepare(`INSERT INTO users (id, email, name, role) VALUES (1, 'partner@x.com', 'Pat', 'partner')`).run();
  db.prepare(`INSERT INTO users (id, email, name, role) VALUES (2, 'lp@x.com', 'El', 'investor')`).run();
  db.prepare(`INSERT INTO users (id, email, name, role) VALUES (3, 'nobody@x.com', 'No', 'founder')`).run();
  db.prepare(`INSERT INTO partners (id, email, name, status) VALUES (1, 'partner@x.com', 'Pat Co', 'active')`).run();
  db.prepare(`INSERT INTO partners (id, email, name, status) VALUES (2, 'inactive@x.com', 'Old Co', 'inactive')`).run();
  db.prepare(`INSERT INTO limited_partners (user_id, invested_amount, status) VALUES (2, 50000, 'active')`).run();
}

test('comp eligibility resolves partners + invested LPs; mint is partners/LPs only and idempotent', async () => {
  const db = freshDb();
  seedAudienceTables(db);
  const env = makeEnv(db);
  const rules = { comp_official_partners: true, comp_invested_lps: true };

  const set = await evaluateCompEligibility(env, rules, null);
  const bySource = Object.fromEntries(set.map((p) => [p.source, p]));
  assert.ok(bySource.auto_partner, 'active partner is eligible');
  assert.equal(bySource.auto_partner.email, 'partner@x.com');
  assert.equal(Number(bySource.auto_partner.user_id), 1, 'partner is linked to its user by email');
  assert.ok(bySource.auto_lp, 'invested LP is eligible');
  assert.equal(Number(bySource.auto_lp.user_id), 2);
  assert.equal(set.length, 2, 'inactive partner is excluded');

  // Targeted checks.
  assert.equal((await isPrincipalCompEligible(env, rules, { email: 'partner@x.com' }, null)).eligible, true);
  assert.equal((await isPrincipalCompEligible(env, rules, { userId: 2 }, null)).eligible, true);
  assert.equal((await isPrincipalCompEligible(env, rules, { email: 'random@x.com' }, null)).eligible, false);

  // Mint into a real event; second mint is a no-op (idempotent).
  const eventId = insertEvent(db, { slug: 'comp-evt', title: 'Comp', starts_at: '2090-04-04T18:00:00Z' });
  const first = await mintCompInvitations(env, eventId, rules, null, 1);
  assert.equal(first.minted, 2, 'mints one comp invite per partner + LP');
  const second = await mintCompInvitations(env, eventId, rules, null, 1);
  assert.equal(second.minted, 0, 'second mint creates no duplicates');
  const total: any = db.prepare(`SELECT COUNT(*) AS n FROM event_invitations WHERE event_id = ? AND comp = 1`).get(eventId);
  assert.equal(Number(total.n), 2);
});
