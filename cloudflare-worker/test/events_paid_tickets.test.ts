/**
 * Task #14 — Paid event tickets can never be skipped.
 *
 * Task #6 hardened a single invariant across many code paths: a check-in code
 * (the proof of a paid seat) is issued ONLY after payment settles, and no
 * anonymous caller can reserve a paid seat without paying. These regression
 * tests lock that invariant in so a future change can't silently reopen the
 * hole. They drive the real route module + services against an in-memory
 * SQLite database loaded with the actual sql/migrations/109_events_core.sql,
 * through the same tiny D1 adapter used by events.test.ts.
 *
 * Coverage — for a PAID (non-comp) event, NO check-in code is minted while
 * `payment_status='pending'` across every path:
 *   - new registration (registerPrincipal)
 *   - the "already registered" retry branch
 *   - automatic waitlist promotion (promoteWaitlist)
 *   - the manual host approve + manual host promote routes
 * …and the webhook (fulfillEventTicket) DOES mint one after payment, is
 * idempotent, and never resurrects a cancelled/declined registration. Also:
 * public/invite registration for a paid event returns needs_payment/
 * auth_required WITHOUT claiming a seat; free/comp seats still get codes.
 *
 * Run via the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/events_paid_tickets.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import events, { registerPrincipal } from '../src/routes/events.ts';
import eventsPublic from '../src/routes/events_public.ts';
import { promoteWaitlist } from '../src/services/eventCapacity.ts';
import { fulfillEventTicket } from '../src/services/eventTickets.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // >= 32 bytes

// ── Tiny D1 adapter over node:sqlite (mirrors events.test.ts) ───────────────
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
  // the events tables don't require the entire referenced-table graph to exist.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const schema = readFileSync(new URL('../sql/migrations/109_events_core.sql', import.meta.url), 'utf8');
  db.exec(schema);
  return db;
}

function makeEnv(db: InstanceType<typeof DatabaseSync>): any {
  // No STRIPE_SECRET_KEY: the self-register PaymentIntent attempt fails fast
  // and is swallowed (best-effort), so the seat still lands pending + code-less.
  return { DB: makeD1(db), ENVIRONMENT: 'development', JWT_SECRET };
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

// getCurrentUser does `SELECT * FROM users` + a best-effort mi_pro_subscriptions
// lookup. Seed both so the authenticated approve/promote routes resolve a
// caller (id 1 = admin → canManage passes for any event) and registerPrincipal's
// payer lookup (ids 2/3) succeeds.
function seedAuthTables(db: InstanceType<typeof DatabaseSync>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, uid TEXT, email TEXT, name TEXT, role TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, stripe_customer_id TEXT
    );
    CREATE TABLE IF NOT EXISTS mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT,
      plan TEXT, period_end TEXT, stripe_customer_id TEXT
    );
  `);
  db.prepare(`INSERT INTO users (id, uid, email, name, role, is_active) VALUES (1, 'u-admin', 'admin@x.com', 'Admin', 'admin', 1)`).run();
  db.prepare(`INSERT INTO users (id, uid, email, name, role, is_active) VALUES (2, 'u-2', 'buyer@x.com', 'Buyer', 'founder', 1)`).run();
  db.prepare(`INSERT INTO users (id, uid, email, name, role, is_active) VALUES (3, 'u-3', 'comp@x.com', 'Comp', 'founder', 1)`).run();
}

async function mintToken(userId: number, role: string): Promise<string> {
  // No `jti` so getCurrentUser skips the user_sessions revocation lookup.
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function authInit(token: string, method = 'POST', body?: unknown): RequestInit {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return init;
}

function insertEvent(db: InstanceType<typeof DatabaseSync>, e: Record<string, any>): number {
  const cols = Object.keys(e);
  const r = db
    .prepare(`INSERT INTO events (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...coerce(cols.map((k) => e[k])));
  return Number(r.lastInsertRowid);
}

function insertReg(db: InstanceType<typeof DatabaseSync>, r: Record<string, any>): number {
  const cols = Object.keys(r);
  const row = db
    .prepare(`INSERT INTO event_registrations (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...coerce(cols.map((k) => r[k])));
  return Number(row.lastInsertRowid);
}

function loadEvent(db: InstanceType<typeof DatabaseSync>, id: number): any {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id);
}

function loadReg(db: InstanceType<typeof DatabaseSync>, id: number): any {
  return db.prepare('SELECT * FROM event_registrations WHERE id = ?').get(id);
}

function checkinCount(db: InstanceType<typeof DatabaseSync>, eventId: number, regId: number): number {
  const r: any = db
    .prepare('SELECT COUNT(*) AS n FROM event_checkins WHERE event_id = ? AND registration_id = ?')
    .get(eventId, regId);
  return Number(r.n);
}

const PAID_EVENT = {
  visibility: 'public', status: 'published', admin_published: 1,
  capacity: null, waitlist_enabled: 1, approval_required: 0,
  price_cents: 5000, currency: 'usd',
};

// ── 1. New registration (registerPrincipal) ────────────────────────────────
test('registerPrincipal: a paid seated registration lands pending with NO check-in code', async () => {
  const db = freshDb();
  seedAuthTables(db);
  const env = makeEnv(db);
  const id = insertEvent(db, { ...PAID_EVENT, slug: 'paid-new', title: 'Paid New', starts_at: '2090-01-01T18:00:00Z' });

  const res = await registerPrincipal(makeCtx(env), loadEvent(db, id), {
    ...REG_BASE, paid: true, userId: 2, email: 'buyer@x.com', name: 'Buyer',
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.status, 'confirmed', 'the paid registrant still holds the seat');
  assert.equal(body.needs_payment, true, 'the response signals payment is required');
  assert.equal(body.checkin_code, null, 'NO check-in code is issued before payment settles');

  const reg: any = db.prepare(`SELECT * FROM event_registrations WHERE event_id = ? AND lower(email) = 'buyer@x.com'`).get(id);
  assert.equal(reg.payment_status, 'pending');
  assert.equal(checkinCount(db, id, reg.id), 0, 'no check-in row exists for an unpaid paid ticket');
});

// ── 2. The "already registered" retry branch ───────────────────────────────
test('registerPrincipal: the already-registered retry branch never mints a code while pending', async () => {
  const db = freshDb();
  seedAuthTables(db);
  const env = makeEnv(db);
  const id = insertEvent(db, { ...PAID_EVENT, slug: 'paid-retry', title: 'Retry', starts_at: '2090-02-02T18:00:00Z' });
  // An existing paid, seated-but-unpaid registration for user 2.
  const rid = insertReg(db, {
    event_id: id, user_id: 2, email: 'buyer@x.com', name: 'Buyer',
    status: 'confirmed', source: 'self', comp: 0, payment_status: 'pending', amount_cents: 5000,
  });

  const res = await registerPrincipal(makeCtx(env), loadEvent(db, id), {
    ...REG_BASE, paid: true, userId: 2, email: 'buyer@x.com', name: 'Buyer',
  });
  const body = await res.json();
  assert.equal(body.already_registered, true);
  assert.equal(body.needs_payment, true, 'a pending retry still needs payment');
  assert.ok(!body.checkin_code, 'the retry branch returns no check-in code');
  assert.equal(checkinCount(db, id, rid), 0, 'no code is minted on a pending retry');
});

// ── 3. Automatic waitlist promotion (promoteWaitlist) ──────────────────────
test('promoteWaitlist: a paid pending waitlist row is promoted WITHOUT a check-in code', async () => {
  const db = freshDb();
  seedAuthTables(db);
  const env = makeEnv(db);
  const id = insertEvent(db, { ...PAID_EVENT, slug: 'paid-promo', title: 'Promo', starts_at: '2090-03-03T18:00:00Z', capacity: 1 });

  // A comp seat-holder occupies the single seat, then cancels to free it.
  const holder = insertReg(db, { event_id: id, user_id: 2, name: 'Holder', status: 'confirmed', comp: 1, payment_status: 'none' });
  // A paid, pending registrant waits.
  const waiter = insertReg(db, {
    event_id: id, user_id: 3, email: 'wait@x.com', name: 'Waiter',
    status: 'waitlisted', waitlist_position: 1, comp: 0, payment_status: 'pending', amount_cents: 5000,
  });
  db.prepare(`UPDATE event_registrations SET status = 'cancelled' WHERE id = ?`).run(holder);

  const promoted = await promoteWaitlist(env, loadEvent(db, id));
  assert.equal(promoted.length, 1, 'the freed seat promotes exactly one row');
  assert.equal(Number(promoted[0].id), waiter);
  assert.equal(promoted[0].status, 'confirmed');

  const w = loadReg(db, waiter);
  assert.equal(w.status, 'confirmed', 'the seat is granted');
  assert.equal(w.payment_status, 'pending', 'the row is still awaiting payment');
  assert.equal(checkinCount(db, id, waiter), 0, 'promoting an unpaid paid row mints NO code');
});

// ── 4. Manual host approve route ───────────────────────────────────────────
test('approve route: approving a paid pending registration mints no code; a comp one does', async () => {
  const db = freshDb();
  seedAuthTables(db);
  const env = makeEnv(db);
  const token = await mintToken(1, 'admin');
  const id = insertEvent(db, { ...PAID_EVENT, slug: 'paid-approve', title: 'Approve', starts_at: '2090-04-04T18:00:00Z', approval_required: 1 });

  // Paid, seated (registered = approval-pending), unpaid → must NOT get a code.
  const paidRid = insertReg(db, { event_id: id, email: 'paid@x.com', name: 'Paid', status: 'registered', comp: 0, payment_status: 'pending', amount_cents: 5000 });
  // Comp, seated, owes no payment → SHOULD get a code on approval.
  const compRid = insertReg(db, { event_id: id, email: 'comp@x.com', name: 'Comp', status: 'registered', comp: 1, payment_status: 'none' });

  const rPaid = await events.request(`/${id}/registrations/${paidRid}/approve`, authInit(token, 'POST', {}), env, ctx);
  assert.equal(rPaid.status, 200);
  assert.equal((await rPaid.json()).registration.status, 'confirmed');
  assert.equal(checkinCount(db, id, paidRid), 0, 'approving an unpaid paid ticket mints NO code');

  const rComp = await events.request(`/${id}/registrations/${compRid}/approve`, authInit(token, 'POST', {}), env, ctx);
  assert.equal(rComp.status, 200);
  assert.equal((await rComp.json()).registration.status, 'confirmed');
  assert.equal(checkinCount(db, id, compRid), 1, 'approving a comp (no-payment) seat mints a code');
});

// ── 5. Manual host promote route ───────────────────────────────────────────
test('promote route: promoting a paid pending waitlist row mints no code; a comp one does', async () => {
  const db = freshDb();
  seedAuthTables(db);
  const env = makeEnv(db);
  const token = await mintToken(1, 'admin');
  const id = insertEvent(db, { ...PAID_EVENT, slug: 'paid-promote-route', title: 'PromoteRoute', starts_at: '2090-05-05T18:00:00Z' });

  const paidRid = insertReg(db, { event_id: id, email: 'paid@x.com', name: 'Paid', status: 'waitlisted', waitlist_position: 1, comp: 0, payment_status: 'pending', amount_cents: 5000 });
  const compRid = insertReg(db, { event_id: id, email: 'comp@x.com', name: 'Comp', status: 'waitlisted', waitlist_position: 2, comp: 1, payment_status: 'none' });

  const rPaid = await events.request(`/${id}/registrations/${paidRid}/promote`, authInit(token, 'POST', {}), env, ctx);
  assert.equal(rPaid.status, 200);
  assert.equal((await rPaid.json()).registration.status, 'confirmed');
  assert.equal(checkinCount(db, id, paidRid), 0, 'manually promoting an unpaid paid row mints NO code');

  const rComp = await events.request(`/${id}/registrations/${compRid}/promote`, authInit(token, 'POST', {}), env, ctx);
  assert.equal(rComp.status, 200);
  assert.equal((await rComp.json()).registration.status, 'confirmed');
  assert.equal(checkinCount(db, id, compRid), 1, 'manually promoting a comp seat mints a code');
});

// ── 6. Webhook (fulfillEventTicket) — settles, mints once, idempotent ──────
test('fulfillEventTicket: settles payment, mints exactly one code, and is idempotent', async () => {
  const db = freshDb();
  seedAuthTables(db);
  const env = makeEnv(db);
  const id = insertEvent(db, { ...PAID_EVENT, slug: 'paid-webhook', title: 'Webhook', starts_at: '2090-06-06T18:00:00Z' });
  const rid = insertReg(db, { event_id: id, email: 'buyer@x.com', name: 'Buyer', status: 'registered', comp: 0, payment_status: 'pending', amount_cents: 5000 });

  const pi: Record<string, unknown> = {
    id: 'pi_test_1', amount: 5000, amount_received: 5000,
    metadata: { kind: 'event_ticket', event_id: String(id), registration_id: String(rid) },
  };
  await fulfillEventTicket(env, pi);

  let reg = loadReg(db, rid);
  assert.equal(reg.payment_status, 'paid');
  assert.equal(reg.status, 'confirmed', 'a seated paid ticket is confirmed after payment');
  assert.equal(checkinCount(db, id, rid), 1, 'payment settlement mints the check-in code');
  const code1 = (db.prepare('SELECT code FROM event_checkins WHERE registration_id = ?').get(rid) as any).code;

  // A replayed webhook delivery mints nothing new.
  await fulfillEventTicket(env, pi);
  assert.equal(checkinCount(db, id, rid), 1, 'a replayed webhook does not mint a second code');
  const code2 = (db.prepare('SELECT code FROM event_checkins WHERE registration_id = ?').get(rid) as any).code;
  assert.equal(code2, code1, 'the same check-in code is preserved');
});

// ── 6b. Webhook never resurrects a cancelled / declined seat ───────────────
test('fulfillEventTicket: a late webhook never resurrects a cancelled or declined seat', async () => {
  const db = freshDb();
  seedAuthTables(db);
  const env = makeEnv(db);
  const id = insertEvent(db, { ...PAID_EVENT, slug: 'paid-noresurrect', title: 'NoResurrect', starts_at: '2090-07-07T18:00:00Z' });

  for (const status of ['cancelled', 'declined']) {
    const rid = insertReg(db, { event_id: id, email: `${status}@x.com`, name: status, status, comp: 0, payment_status: 'pending', amount_cents: 5000 });
    const pi: Record<string, unknown> = {
      id: `pi_${status}`, amount: 5000, amount_received: 5000,
      metadata: { kind: 'event_ticket', event_id: String(id), registration_id: String(rid) },
    };
    await fulfillEventTicket(env, pi);

    const reg = loadReg(db, rid);
    assert.equal(reg.payment_status, 'paid', `${status}: the captured payment is still recorded`);
    assert.equal(reg.status, status, `${status}: the seat is NOT resurrected to confirmed`);
    assert.equal(checkinCount(db, id, rid), 0, `${status}: no check-in code is minted for a non-seated row`);
  }
});

// ── 7. Public/invite registration for a paid event claims no seat ──────────
test('public register: a paid event returns needs_payment/auth_required and claims no seat', async () => {
  const db = freshDb();
  seedAuthTables(db);
  const env = makeEnv(db);
  const id = insertEvent(db, { ...PAID_EVENT, slug: 'paid-public', title: 'Public Paid', starts_at: '2090-08-08T18:00:00Z' });

  const res = await eventsPublic.request('/events/paid-public/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'anon@x.com', name: 'Anon' }),
  }, env, ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.needs_payment, true);
  assert.equal(body.auth_required, true);

  const n: any = db.prepare('SELECT COUNT(*) AS n FROM event_registrations WHERE event_id = ?').get(id);
  assert.equal(Number(n.n), 0, 'an anonymous paid registration claims no seat');
});

test('invite respond: accepting a paid (non-comp) invite needs payment and claims no seat', async () => {
  const db = freshDb();
  seedAuthTables(db);
  const env = makeEnv(db);
  const id = insertEvent(db, { ...PAID_EVENT, slug: 'paid-invite', title: 'Invite Paid', starts_at: '2090-09-09T18:00:00Z', visibility: 'private', admin_published: 0 });
  db.prepare(`INSERT INTO event_invitations (event_id, invited_email, token, status, comp) VALUES (?, 'guest@x.com', 'tok-paid', 'pending', 0)`).run(id);

  const res = await eventsPublic.request('/invite/tok-paid/respond', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'accept' }),
  }, env, ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'accepted');
  assert.equal(body.needs_payment, true);
  assert.equal(body.auth_required, true);

  const inv: any = db.prepare(`SELECT status FROM event_invitations WHERE token = 'tok-paid'`).get();
  assert.equal(inv.status, 'accepted', 'the acceptance is recorded even though no seat is claimed');
  const n: any = db.prepare('SELECT COUNT(*) AS n FROM event_registrations WHERE event_id = ?').get(id);
  assert.equal(Number(n.n), 0, 'a paid invite accept claims no seat until payment');
});

// ── 8. Free / comp seats still get codes immediately ───────────────────────
test('free and comp seated registrations still receive a check-in code immediately', async () => {
  const db = freshDb();
  seedAuthTables(db);
  const env = makeEnv(db);

  // Free event (price_cents = 0).
  const freeId = insertEvent(db, { ...PAID_EVENT, slug: 'free-evt', title: 'Free', starts_at: '2090-10-10T18:00:00Z', price_cents: 0 });
  const rFree = await registerPrincipal(makeCtx(env), loadEvent(db, freeId), { ...REG_BASE, paid: false, userId: 2, email: 'free@x.com', name: 'Free' });
  const bFree = await rFree.json();
  assert.equal(bFree.status, 'confirmed');
  assert.ok(bFree.checkin_code, 'a free seated registration gets a code immediately');
  const freeReg: any = db.prepare(`SELECT * FROM event_registrations WHERE event_id = ? AND lower(email) = 'free@x.com'`).get(freeId);
  assert.equal(checkinCount(db, freeId, freeReg.id), 1);

  // Comp registration in a PAID event (comp ⇒ owes no payment).
  const paidId = insertEvent(db, { ...PAID_EVENT, slug: 'comp-in-paid', title: 'CompInPaid', starts_at: '2090-11-11T18:00:00Z' });
  const rComp = await registerPrincipal(makeCtx(env), loadEvent(db, paidId), { ...REG_BASE, comp: true, paid: false, userId: 3, email: 'comp@x.com', name: 'Comp' });
  const bComp = await rComp.json();
  assert.equal(bComp.status, 'confirmed');
  assert.ok(bComp.checkin_code, 'a comp seat in a paid event gets a code immediately');
  const compReg: any = db.prepare(`SELECT * FROM event_registrations WHERE event_id = ? AND lower(email) = 'comp@x.com'`).get(paidId);
  assert.equal(compReg.payment_status, 'none', 'a comp seat owes no payment');
  assert.equal(checkinCount(db, paidId, compReg.id), 1);
});
