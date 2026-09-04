/**
 * The partner Delivery routes — migration 208's four Delivery zones.
 *
 * THREE REFUSALS CARRY THIS FILE, and each is a decision that could have gone
 * the other way and would be invisible if it had:
 *
 *   1. HEALTH IS NULL WHEN NOTHING IS RECORDED. Not `'on_track'`. An engagement
 *      with no milestone, blocker, deliverable or retainer is not rated, and it
 *      says so. Green-because-empty is the most confident wrong answer this
 *      product could give, and it is one line of code away at all times.
 *
 *   2. `opened_at` AND `signed_off_at` ARE IGNORED ON EVERY WRITE. They are the
 *      client's to set — 208:160 — so a body carrying them leaves the row
 *      unchanged. Ignored rather than rejected: a caller sending a whole DTO
 *      back should not get a 400 for a field it read from us.
 *
 *   3. THERE IS NO CAPACITY CAP, so `cap_hours` is null with a reason and no
 *      route invents one. The canvas hardcodes 40; adopting it would invent the
 *      firm's cap and present the result as a finding.
 *
 * Plus the authz hole 208 left open and this router closes: `holder_user_id`
 * references `users(id)` with no partner constraint, so the schema alone would
 * let a firm put any account in the product into a register of who has access
 * inside a client's systems.
 *
 * HARNESS. As `partner_pipeline_stores.test.ts`: the real router against real
 * in-memory SQLite, tables built FROM the migration file rather than copied.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import partnerDelivery from '../src/routes/partner_delivery.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const OURS_USER = 60;
const OUR_STAFF = 61;      // partner_id 1, can hold a seat
const THEIRS_USER = 62;
const THEIR_STAFF = 63;    // partner_id 2, cannot
const FOUNDER_USER = 64;
const OUR_ENGAGEMENT = 901;
const THEIR_ENGAGEMENT = 902;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) {
      const out = [];
      for (const st of x || []) out.push(await st.run().catch(() => ({})));
      return out;
    },
  };
}

const migration = (name: string) => readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, partner_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL, company TEXT, email TEXT UNIQUE NOT NULL,
      specialization TEXT, status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE founder_needs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      project_id INTEGER NOT NULL, founder_id INTEGER NOT NULL,
      category TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
      budget_min REAL, budget_max REAL, timeline TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      need_id INTEGER NOT NULL, rfp_id INTEGER, partner_id INTEGER NOT NULL,
      price REAL NOT NULL, timeline_weeks INTEGER, deliverables TEXT NOT NULL,
      notes TEXT, status TEXT NOT NULL DEFAULT 'submitted', decided_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (need_id, partner_id)
    );
    CREATE TABLE engagements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      need_id INTEGER NOT NULL, quote_id INTEGER NOT NULL UNIQUE,
      partner_id INTEGER NOT NULL, founder_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL, price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'accepted',
      delivered_at TEXT, delivery_notes TEXT, cancelled_at TEXT, cancel_reason TEXT,
      invoice_id TEXT, invoiced_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(migration('208_partner_delivery_stores'));

  const u = db.prepare('INSERT INTO users (id, role, partner_id, name, email) VALUES (?,?,?,?,?)');
  u.run(OURS_USER, 'partner', 1, 'Ours', 'ours@example.com');
  u.run(OUR_STAFF, 'partner', 1, 'Sam', 'sam@example.com');
  u.run(THEIRS_USER, 'partner', 2, 'Theirs', 'theirs@example.com');
  u.run(THEIR_STAFF, 'partner', 2, 'Robin', 'robin@example.com');
  u.run(FOUNDER_USER, 'founder', null, 'Fran', 'fran@example.com');

  const p = db.prepare('INSERT INTO partners (id, uid, name, email) VALUES (?,?,?,?)');
  p.run(1, 'p-1', 'Ours', 'ours@example.com');
  p.run(2, 'p-2', 'Theirs', 'theirs@example.com');

  const n = db.prepare(
    'INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description) VALUES (?,?,?,?,?,?,?)');
  n.run(501, 'need-1', 9, FOUNDER_USER, 'engineering', 'Payments migration', 'x');
  n.run(502, 'need-2', 9, FOUNDER_USER, 'design', 'Brand refresh', 'y');

  const e = db.prepare(
    `INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price)
     VALUES (?,?,?,?,?,?,?,?)`);
  e.run(OUR_ENGAGEMENT, 'e-ours', 501, 601, 1, FOUNDER_USER, 9, 42000);
  e.run(THEIR_ENGAGEMENT, 'e-theirs', 502, 602, 2, FOUNDER_USER, 9, 15000);

  return db;
}

function env(db: InstanceType<typeof DatabaseSync>) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) };
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  e: any, method: string, path: string, who: { user: number; role: string }, body?: any,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    (init as any).body = JSON.stringify(body);
  }
  const res = await partnerDelivery.request(path, init, e);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const ours = { user: OURS_USER, role: 'partner' };
const theirs = { user: THEIRS_USER, role: 'partner' };
const fran = { user: FOUNDER_USER, role: 'founder' };

function nowPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const past = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

// ---------------------------------------------------------------------------
// Health — the refusal that matters most
// ---------------------------------------------------------------------------

test('an engagement with nothing recorded is NOT rated, and says why', async () => {
  const e = env(freshDb());
  const r = (await call(e, 'GET', '/health', ours)).body;
  assert.equal(r.items.length, 1);
  const row = r.items[0];
  // The single most important assertion in this file. `'on_track'` here would
  // rate an empty engagement as healthy, which is the failure the zone's old
  // no-store card was written about.
  assert.equal(row.health, null);
  assert.match(row.health_note, /Silence is not good news/);
  assert.deepEqual(row.health_reasons, []);
  assert.equal(r.rated_count, 0);
  assert.equal(r.unrated_count, 1);
  assert.match(r.unrated_note, /nothing recorded/i);
});

test('an overdue milestone rates at risk, and the reason is returned', async () => {
  const e = env(freshDb());
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/milestones`, ours, {
    title: 'Cutover', due_at: past(10),
  });
  const row = (await call(e, 'GET', '/health', ours)).body.items[0];
  assert.equal(row.health, 'at_risk');
  assert.equal(row.overdue_count, 1);
  // A judgement a reader cannot explain is not one they should act on.
  assert.ok(row.health_reasons.some((x: string) => /past due/.test(x)));
});

test('an open blocker beats an overdue milestone', async () => {
  const e = env(freshDb());
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/milestones`, ours, {
    title: 'Cutover', due_at: past(10),
  });
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/blockers`, ours, {
    summary: 'Waiting on their security review', side: 'client',
  });
  const row = (await call(e, 'GET', '/health', ours)).body.items[0];
  assert.equal(row.health, 'blocked');
  // The side survives to the read — a blockers list with no side would make
  // every delay the firm's, including in the report drafted from it.
  assert.equal(row.open_blockers[0].side, 'client');
  assert.ok(row.health_reasons.some((x: string) => /client's side/.test(x)));
});

test('a completed milestone with nothing else open rates on track', async () => {
  const e = env(freshDb());
  const m = await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/milestones`, ours, {
    title: 'Kickoff', due_at: past(30),
  });
  await call(e, 'PATCH', `/milestones/${m.body.id}`, ours, { completed_at: past(29) });
  const row = (await call(e, 'GET', '/health', ours)).body.items[0];
  assert.equal(row.health, 'on_track');
  assert.equal(row.overdue_count, 0);
});

test('a cleared blocker stops counting', async () => {
  const e = env(freshDb());
  const b = await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/blockers`, ours, {
    summary: 'Access', side: 'ours',
  });
  assert.equal((await call(e, 'GET', '/health', ours)).body.items[0].health, 'blocked');
  await call(e, 'PATCH', `/blockers/${b.body.id}`, ours, { cleared_at: new Date().toISOString() });
  const row = (await call(e, 'GET', '/health', ours)).body.items[0];
  assert.equal(row.open_blockers.length, 0);
  // STILL RATED, and this is the inconsistency the test found. A cleared
  // blocker is something recorded — somebody raised it and dealt with it — so
  // the engagement is rated rather than falling back to "we have nothing to go
  // on", which is what a completed milestone already did. `hasSignal` counts
  // both; only the open ones move the rating.
  assert.equal(row.health, 'on_track');
});

test('an unknown blocker side is refused', async () => {
  const e = env(freshDb());
  const r = await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/blockers`, ours, {
    summary: 'x', side: 'theirs',
  });
  assert.equal(r.status, 400);
  assert.match(r.body.detail, /ours.*client/i);
});

// ---------------------------------------------------------------------------
// Deliverables — the client's columns
// ---------------------------------------------------------------------------

test('a body carrying opened_at leaves the row unchanged', async () => {
  const db = freshDb();
  const e = env(db);
  const made = await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours, {
    title: 'Architecture review', sent_at: past(5),
    // Both of the client's columns, on create.
    opened_at: '2026-09-01T00:00:00Z', signed_off_at: '2026-09-02T00:00:00Z',
  });
  assert.equal(made.status, 200);
  assert.equal(made.body.opened_at, null, 'a firm-side create set opened_at');
  assert.equal(made.body.signed_off_at, null, 'a firm-side create set signed_off_at');

  // And on patch.
  const patched = await call(e, 'PATCH', `/deliverables/${made.body.id}`, ours, {
    title: 'Architecture review', opened_at: '2026-09-01T00:00:00Z',
    signed_off_at: '2026-09-02T00:00:00Z',
  });
  assert.equal(patched.status, 200, 'the write is ignored, not rejected');
  assert.equal(patched.body.opened_at, null, 'a firm-side patch set opened_at');
  assert.equal(patched.body.signed_off_at, null);

  const row = db.prepare('SELECT opened_at, signed_off_at FROM engagement_deliverables').get() as any;
  assert.equal(row.opened_at, null);
  assert.equal(row.signed_off_at, null);
});

test('the median time to open is refused outright, with the reason', async () => {
  const e = env(freshDb());
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours, {
    title: 'Spec', sent_at: past(20),
  });
  const r = (await call(e, 'GET', '/deliverables', ours)).body;
  assert.equal(r.sent_count, 1);
  assert.equal(r.unopened_count, 1);
  // A median over a column nobody writes is a number about our own silence.
  assert.equal(r.median_days_to_open, null);
  assert.match(r.median_days_to_open_note, /client's to set/i);
  // And the unopened count is framed as OUR gap, not the client's behaviour.
  assert.match(r.unopened_note, /we do not know/i);
});

test('an unsent deliverable is not counted as unopened', async () => {
  const e = env(freshDb());
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours, { title: 'Draft' });
  const r = (await call(e, 'GET', '/deliverables', ours)).body;
  assert.equal(r.sent_count, 0);
  // Never sent is a different state from sent-and-unopened, and only the second
  // is the expensive one the zone is about.
  assert.equal(r.unopened_count, 0);
  assert.equal(r.items[0].is_unopened, false);
});

test('an unopened deliverable moves health to at risk', async () => {
  const e = env(freshDb());
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours, {
    title: 'Spec', sent_at: past(20),
  });
  const row = (await call(e, 'GET', '/health', ours)).body.items[0];
  assert.equal(row.deliverables_unopened, 1);
  assert.equal(row.health, 'at_risk');
});

// ---------------------------------------------------------------------------
// Capacity — the cap that does not exist, and the seat register
// ---------------------------------------------------------------------------

test('there is no capacity cap, and the response says so', async () => {
  const e = env(freshDb());
  const r = (await call(e, 'GET', '/capacity', ours)).body;
  // The canvas hardcodes 40. Adopting it would invent the firm's cap and then
  // present the result as a finding.
  assert.equal(r.cap_hours, null);
  assert.match(r.cap_note, /no capacity cap is recorded/i);
  // No FIELD claims it. Asserting over the whole JSON caught the cap_note
  // itself, which uses the phrase to refuse the claim — the assertion has to
  // look at what the response asserts, not at what it says.
  const keys = new Set([
    ...Object.keys(r),
    ...r.people.flatMap((x: any) => Object.keys(x)),
    ...r.seats.flatMap((x: any) => Object.keys(x)),
  ]);
  for (const k of keys) {
    assert.doesNotMatch(k, /over/i, `the response carries a field named ${k}`);
  }
});

test('a seat cannot be granted to someone outside the firm', async () => {
  const db = freshDb();
  const e = env(db);
  // 208's holder_user_id references users(id) with NO partner constraint, so
  // without this check a firm could enter any account in the product into a
  // register of who has access inside a client's systems.
  for (const outsider of [THEIR_STAFF, FOUNDER_USER]) {
    const r = await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/seats`, ours, {
      holder_user_id: outsider, scope: 'Board, KPIs',
    });
    assert.equal(r.status, 400, `user ${outsider} was accepted as a seat holder`);
    assert.match(r.body.detail, /attached to this firm/i);
  }
  assert.equal(db.prepare('SELECT COUNT(*) c FROM engagement_seats').get<any>().c, 0);

  const ok = await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/seats`, ours, {
    holder_user_id: OUR_STAFF, scope: 'Board, KPIs',
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.holder_name, 'Sam');
});

test('a revoked seat is still returned', async () => {
  const db = freshDb();
  const e = env(db);
  const seat = await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/seats`, ours, {
    holder_user_id: OUR_STAFF, scope: 'prod read-only',
  });
  await call(e, 'POST', `/seats/${seat.body.id}/revoke`, ours);

  const r = (await call(e, 'GET', '/capacity', ours)).body;
  // `revoked_at` is a column rather than a delete precisely so the record that
  // access once existed cannot quietly disappear.
  assert.equal(r.seats.length, 1);
  assert.ok(r.seats[0].revoked_at);
  assert.equal(r.people[0].live_seats, 0);
  assert.equal(r.people[0].revoked_seats, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM engagement_seats').get<any>().c, 1);

  // And revoking twice is refused rather than silently re-stamping the date.
  const again = await call(e, 'POST', `/seats/${seat.body.id}/revoke`, ours);
  assert.equal(again.status, 400);
});

test('a person with no logged hours reads null, not zero', async () => {
  const e = env(freshDb());
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/seats`, ours, {
    holder_user_id: OUR_STAFF,
  });
  const r = (await call(e, 'GET', '/capacity', ours)).body;
  // Nobody logging hours for a person is not the same as that person doing no
  // work, and this page cannot tell the difference — so it does not claim to.
  assert.equal(r.people[0].hours, null);
  assert.match(r.people[0].hours_note, /no hours logged/i);

  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/${nowPeriod()}`, ours, {
    hours: 31.5,
  });
  const after = (await call(e, 'GET', '/capacity', ours)).body;
  assert.equal(after.people[0].hours, 31.5);
  assert.equal(after.people[0].hours_note, null);
});

test('hours are upserted per person per period, not appended', async () => {
  const db = freshDb();
  const e = env(db);
  const p = nowPeriod();
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/${p}`, ours, { hours: 10 });
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/${p}`, ours, { hours: 22 });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM engagement_hours').get<any>().c, 1);
  assert.equal((await call(e, 'GET', '/capacity', ours)).body.people[0].hours, 22);

  // Clearing is a delete, not a zero — zero claims they worked none.
  await call(e, 'DELETE', `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/${p}`, ours);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM engagement_hours').get<any>().c, 0);
});

test('hours cannot be logged for someone outside the firm', async () => {
  const e = env(freshDb());
  const r = await call(e, 'PUT',
    `/engagements/${OUR_ENGAGEMENT}/hours/${THEIR_STAFF}/${nowPeriod()}`, ours, { hours: 5 });
  assert.equal(r.status, 400);
});

test('the people list is this firm only', async () => {
  const e = env(freshDb());
  const r = (await call(e, 'GET', '/people', ours)).body;
  const ids = r.items.map((x: any) => x.user_id).sort();
  assert.deepEqual(ids, [OURS_USER, OUR_STAFF].sort());
});

// ---------------------------------------------------------------------------
// Status reports
// ---------------------------------------------------------------------------

test('a draft is composed from the record, and blockers are read not stored', async () => {
  const db = freshDb();
  const e = env(db);
  const p = nowPeriod();
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours, {
    title: 'Spec v2', version: 'v2', sent_at: `${p}-04T00:00:00Z`,
  });
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/milestones`, ours, { title: 'Cutover' });
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/blockers`, ours, {
    summary: 'Their DPA is unsigned', side: 'client',
  });

  const draft = (await call(e, 'GET', `/engagements/${OUR_ENGAGEMENT}/report-draft/${p}`, ours)).body;
  assert.equal(draft.shipped_from_log.length, 1);
  assert.equal(draft.shipped_from_log[0].version, 'v2');
  assert.equal(draft.next_from_milestones.length, 1);
  assert.equal(draft.blocked.length, 1);
  assert.equal(draft.blocked[0].side, 'client');
  // The sentence that makes the editorial call visible to the author.
  assert.match(draft.blocked_note, /without treating it as an excuse|say so plainly/i);

  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/${p}`, ours, {
    shipped: 'Spec v2 went out.', next_up: 'Cutover.',
  });
  // Nothing about the blocker is copied into the row — a prose copy would go
  // stale the moment it cleared, and the side is what a stale copy loses.
  const row = db.prepare('SELECT * FROM engagement_status_reports').get() as any;
  assert.doesNotMatch(JSON.stringify(row), /DPA/);
});

test('a sent report cannot be edited, re-sent or deleted', async () => {
  const e = env(freshDb());
  const p = nowPeriod();
  const saved = await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/${p}`, ours, {
    shipped: 'Spec v2 went out.',
  });
  const sent = await call(e, 'POST', `/status-reports/${saved.body.id}/send`, ours);
  assert.equal(sent.status, 200);
  assert.equal(sent.body.state, 'sent');
  assert.ok(sent.body.sent_at);

  // A record of what a client already received. Editing it in place would make
  // our record disagree with theirs with no trace of the difference.
  const edit = await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/${p}`, ours, {
    shipped: 'Actually something else.',
  });
  assert.equal(edit.status, 409);
  const resend = await call(e, 'POST', `/status-reports/${saved.body.id}/send`, ours);
  assert.equal(resend.status, 409);
  const gone = await call(e, 'DELETE', `/status-reports/${saved.body.id}`, ours);
  assert.equal(gone.status, 409);
});

test('an empty report cannot be sent', async () => {
  const e = env(freshDb());
  const p = nowPeriod();
  const saved = await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/${p}`, ours, {
    shipped: 'x',
  });
  // Clear it back to empty, then try to send.
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/${p}`, ours, {
    shipped: null, next_up: null,
  });
  const r = await call(e, 'POST', `/status-reports/${saved.body.id}/send`, ours);
  assert.equal(r.status, 400);
});

test('the reports read says nothing is delivered', async () => {
  const e = env(freshDb());
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/${nowPeriod()}`, ours, {
    shipped: 'x',
  });
  const r = (await call(e, 'GET', '/status-reports', ours)).body;
  // In the RESPONSE, not only in page copy: marking sent records a person's
  // act, and a page that implied delivery would claim a capability the product
  // does not have.
  assert.equal(r.delivery, 'manual');
  assert.match(r.delivery_note, /no email, no notification/i);
});

test('a quarterly period label is refused for a monthly report', async () => {
  const e = env(freshDb());
  const r = await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/2026-Q3`, ours, {
    shipped: 'x',
  });
  assert.equal(r.status, 400);
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

test('another firm gets 404 on every write and sees none of the rows', async () => {
  const e = env(freshDb());
  const m = await call(e, 'POST', `/engagements/${THEIR_ENGAGEMENT}/milestones`, theirs, { title: 'x' });
  const b = await call(e, 'POST', `/engagements/${THEIR_ENGAGEMENT}/blockers`, theirs, { summary: 'y' });
  const d = await call(e, 'POST', `/engagements/${THEIR_ENGAGEMENT}/deliverables`, theirs, { title: 'z' });
  const s = await call(e, 'POST', `/engagements/${THEIR_ENGAGEMENT}/seats`, theirs, {
    holder_user_id: THEIR_STAFF,
  });
  const rep = await call(e, 'PUT', `/engagements/${THEIR_ENGAGEMENT}/status-reports/${nowPeriod()}`,
    theirs, { shipped: 'x' });

  for (const [method, path, bd] of [
    ['PATCH', `/milestones/${m.body.id}`, { title: 'mine' }],
    ['DELETE', `/milestones/${m.body.id}`, undefined],
    ['PATCH', `/blockers/${b.body.id}`, { summary: 'mine', side: 'ours' }],
    ['PATCH', `/deliverables/${d.body.id}`, { title: 'mine' }],
    ['DELETE', `/deliverables/${d.body.id}`, undefined],
    ['PATCH', `/seats/${s.body.id}`, { scope: 'mine' }],
    ['POST', `/seats/${s.body.id}/revoke`, undefined],
    ['POST', `/status-reports/${rep.body.id}/send`, undefined],
    ['DELETE', `/status-reports/${rep.body.id}`, undefined],
    ['POST', `/engagements/${THEIR_ENGAGEMENT}/milestones`, { title: 'x' }],
  ] as const) {
    const r = await call(e, method as string, path as string, ours, bd as any);
    assert.equal(r.status, 404, `${method} ${path} answered ${r.status}, not 404`);
  }

  assert.equal((await call(e, 'GET', '/health', ours)).body.items.length, 1);
  assert.equal((await call(e, 'GET', '/deliverables', ours)).body.items.length, 0);
  assert.equal((await call(e, 'GET', '/capacity', ours)).body.seats.length, 0);
  assert.equal((await call(e, 'GET', '/status-reports', ours)).body.items.length, 0);
});

test('a founder is refused outright', async () => {
  const e = env(freshDb());
  for (const path of ['/health', '/deliverables', '/capacity', '/status-reports', '/people']) {
    assert.equal((await call(e, 'GET', path, fran)).status, 403, `${path} was readable by a founder`);
  }
});

test('a read writes nothing', async () => {
  const db = freshDb();
  const e = env(db);
  const p = nowPeriod();
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/milestones`, ours, { title: 'x', due_at: past(3) });
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/blockers`, ours, { summary: 'y', side: 'client' });
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours, { title: 'z', sent_at: past(2) });
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/seats`, ours, { holder_user_id: OUR_STAFF });
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/${p}`, ours, { hours: 8 });
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/${p}`, ours, { shipped: 'x' });

  const snapshot = () => JSON.stringify([
    db.prepare('SELECT * FROM engagement_milestones ORDER BY id').all(),
    db.prepare('SELECT * FROM engagement_blockers ORDER BY id').all(),
    db.prepare('SELECT * FROM engagement_deliverables ORDER BY id').all(),
    db.prepare('SELECT * FROM engagement_seats ORDER BY id').all(),
    db.prepare('SELECT * FROM engagement_hours ORDER BY id').all(),
    db.prepare('SELECT * FROM engagement_status_reports ORDER BY id').all(),
  ]);

  const before = snapshot();
  await call(e, 'GET', '/health', ours);
  await call(e, 'GET', '/deliverables', ours);
  await call(e, 'GET', '/capacity', ours);
  await call(e, 'GET', '/status-reports', ours);
  await call(e, 'GET', `/engagements/${OUR_ENGAGEMENT}/report-draft/${p}`, ours);
  assert.equal(snapshot(), before, 'a GET changed a stored row');
});

// ---------------------------------------------------------------------------
// The routes store nothing they derive
// ---------------------------------------------------------------------------

test('no route writes a value it computes', () => {
  const src = readFileSync(resolve(HERE, '../src/routes/partner_delivery.ts'), 'utf8');
  // EVERY SQL STRING, then the write ones — rather than scanning forward from
  // `INSERT INTO` to the next backtick. That earlier form worked only for
  // template-literal SQL: a single-quoted `'UPDATE ... WHERE id = ?'` ran on to
  // whatever backtick came next and swallowed unrelated code, which made this
  // test report `is_unopened` — a DTO field thirty lines away — as a written
  // column. A test that fails on code it never meant to read is worse than no
  // test, because the next author edits the wrong thing.
  const literals = [...src.matchAll(/`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'/g)].map((m) => m[0]);
  const writes = literals.filter((x) => /\b(?:INSERT INTO|UPDATE)\s+\w/.test(x)).join('\n');
  assert.ok(writes.length > 0, 'no write statements were found — the scan is broken');
  const named = new Set(writes.split(/[^A-Za-z0-9_]+/).filter(Boolean));
  // 208 has no `health` column BECAUSE it is a read over five tables; the same
  // reasoning keeps `utilisation` and `days_overdue` out. And `opened_at` must
  // not appear in any write at all, which is the client-columns rule expressed
  // as a property of the source rather than of one handler.
  for (const derived of ['health', 'utilisation', 'days_overdue', 'is_unopened', 'cap_hours', 'opened_at', 'signed_off_at']) {
    assert.ok(!named.has(derived),
      `a write names \`${derived}\` — it is derived or the client's, and must not be written here`);
  }
});
