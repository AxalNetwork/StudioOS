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
  // APPLIED, NOT MIRRORED. The two capacity stores are read by `/capacity` and
  // written by its two `PUT`s, so the harness runs their migration files for
  // the same reason it runs 208's: a hand-copied DDL that drifts from the file
  // makes every assertion below true of a schema production does not have.
  db.exec(migration('230_partner_capacity'));
  db.exec(migration('231_partner_internal_hours'));
  db.exec(migration('232_partner_engagement_health'));

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

/**
 * THE THREE FACTS NOTHING DERIVES (migration 232).
 *
 * Health is read across five stores, and the `pd5` artboard asks for three
 * things none of them holds: who at the firm owns an engagement, whether it has
 * drifted from its scope, and what the client thinks. Each is a sentence
 * somebody states, and until they do all three are ABSENT — `scope_state` most
 * of all, because defaulting it to "within" would clear a client of drift by
 * never having looked.
 */
test('owner, scope and satisfaction are absent until stated', async () => {
  const e = env(freshDb());
  const r = (await call(e, 'GET', '/health', ours)).body;
  const row = r.items[0];
  assert.equal(row.owner_user_id, null);
  assert.equal(row.scope_state, null, 'an unassessed engagement was defaulted to a scope state');
  assert.equal(row.satisfaction, null);
  assert.equal(r.drift_count, 0);
  assert.equal(r.scope_unassessed_count, 1);
  // AND THE FIRM-WIDE AVERAGE IS REFUSED, with the artboard's own reason.
  assert.equal(r.satisfaction_avg, null);
  assert.equal(r.satisfaction_unscored_count, 1);
  assert.match(r.satisfaction_note, /averaging the rest would present/i);
});

test('a satisfaction score cannot be saved without saying where it was said', async () => {
  const e = env(freshDb());
  // 208:160 made `opened_at` the client's to set because a partner-side write
  // would be the firm reporting a metric about itself. A score typed by the
  // person who wants the renewal, on the page that decides one, is that
  // failure — provenance is the whole difference.
  const bare = await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/health`, ours, {
    satisfaction: 4.2,
  });
  assert.equal(bare.status, 400);
  assert.match(bare.body.detail, /needs a source/i);

  const ok = await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/health`, ours, {
    satisfaction: 4.2, satisfaction_source: 'quarterly review call, 14 Aug',
  });
  assert.equal(ok.status, 200);
  const row = (await call(e, 'GET', '/health', ours)).body.items[0];
  assert.equal(row.satisfaction, 4.2);
  assert.equal(row.satisfaction_source, 'quarterly review call, 14 Aug');

  for (const bad of [0, 0.9, 5.1, 11]) {
    const r = await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/health`, ours, {
      satisfaction: bad, satisfaction_source: 'x',
    });
    assert.equal(r.status, 400, `${bad} was accepted as a satisfaction score`);
  }
});

test('one write does not wipe the facts it was not carrying', async () => {
  const e = env(freshDb());
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/health`, ours, {
    satisfaction: 4, satisfaction_source: 'review call', scope_state: 'drift',
    scope_note: 'requests beyond SOW §2',
  });
  // An OMITTED key is untouched — a page saving only the owner must not clear
  // a score it never loaded.
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/health`, ours, {
    owner_user_id: OUR_STAFF,
  });
  let row = (await call(e, 'GET', '/health', ours)).body.items[0];
  assert.equal(row.owner_name, 'Sam');
  assert.equal(row.satisfaction, 4);
  assert.equal(row.scope_state, 'drift');
  assert.equal(row.scope_note, 'requests beyond SOW §2');

  // An EXPLICIT null clears.
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/health`, ours, {
    owner_user_id: null, satisfaction: null,
  });
  row = (await call(e, 'GET', '/health', ours)).body.items[0];
  assert.equal(row.owner_user_id, null);
  assert.equal(row.satisfaction, null);
  assert.equal(row.scope_state, 'drift', 'clearing one fact cleared another');
});

test('an owner must belong to this firm, and a scope state must be one of two', async () => {
  const e = env(freshDb());
  for (const outsider of [THEIR_STAFF, FOUNDER_USER]) {
    const r = await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/health`, ours, {
      owner_user_id: outsider,
    });
    assert.equal(r.status, 400, `user ${outsider} was made the owner of our engagement`);
  }
  const bad = await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/health`, ours, {
    scope_state: 'probably fine',
  });
  assert.equal(bad.status, 400);
  // AND ANOTHER FIRM CANNOT WRITE OURS AT ALL.
  const theirWrite = await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/health`, theirs, {
    scope_state: 'drift',
  });
  assert.equal(theirWrite.status, 404);
});

/**
 * LOWEST, NOT FIRST AND NOT AVERAGE.
 *
 * The renewal risk this page exists to surface is the ONE client not using what
 * they pay for. An average hides them behind four who are, and taking whichever
 * row happened to come back first is the same bug wearing a different mistake.
 */
test('the lowest utilisation is the lowest, whatever order the rows arrive in', async () => {
  const db = freshDb();
  const e = env(db);
  db.prepare(
    `INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(904, 'e-ours-3', 502, 604, 1, FOUNDER_USER, 9, 9000);
  const r = db.prepare(
    `INSERT INTO partner_retainers (uid, engagement_id, retained_hours) VALUES (?,?,?)`);
  r.run('ret-1', OUR_ENGAGEMENT, 100);
  r.run('ret-2', 904, 100);
  const u = db.prepare(
    'INSERT INTO retainer_usage (retainer_id, period, hours_used) VALUES (?,?,?)');
  // The high one is on the engagement the listing returns FIRST, so a read that
  // takes `withUtil[0]` reports 95% as the lowest.
  u.run(2, nowPeriod(), 34);
  u.run(1, nowPeriod(), 95);

  const body = (await call(e, 'GET', '/health', ours)).body;
  assert.equal(body.lowest_utilisation_pct, 34, 'the strip reported something other than the lowest');
  assert.equal(body.items[0].utilisation_pct, 95, 'the first row is not the high one — the fixture no longer tests order');
});

test('the strip figures come from the book, and the average waits for all of it', async () => {
  const db = freshDb();
  const e = env(db);
  // A second engagement for this firm, so "all of it" means more than one.
  db.prepare(
    `INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(903, 'e-ours-2', 502, 603, 1, FOUNDER_USER, 9, 9000);

  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/health`, ours, {
    scope_state: 'drift', satisfaction: 4, satisfaction_source: 'review call',
  });
  let r = (await call(e, 'GET', '/health', ours)).body;
  assert.equal(r.drift_count, 1);
  assert.equal(r.scope_unassessed_count, 1);
  // ONE SCORE IS NOT A FIRM-WIDE FACT while the other engagement has none.
  assert.equal(r.satisfaction_avg, null);
  assert.equal(r.satisfaction_scored_count, 1);

  await call(e, 'PUT', '/engagements/903/health', ours, {
    scope_state: 'within', satisfaction: 3, satisfaction_source: 'email',
  });
  r = (await call(e, 'GET', '/health', ours)).body;
  assert.equal(r.satisfaction_avg, 3.5);
  assert.equal(r.satisfaction_note, null);
  assert.equal(r.scope_unassessed_count, 0);
  assert.equal(r.drift_count, 1);
});

// ---------------------------------------------------------------------------
// Capacity — the cap that does not exist, and the seat register
// ---------------------------------------------------------------------------

/**
 * THE REFUSAL, AS IT STANDS AFTER MIGRATION 230.
 *
 * This test used to assert that NO FIELD in the response was named anything
 * matching /over/, because on that build "over" was unsayable: nothing recorded
 * a cap and the canvas's hardcoded 40 was the only number available. Migration
 * 230 gives a firm somewhere to state its own, so the field now exists — and
 * the assertion moves from the field's NAME to its VALUE, which is the thing
 * that was ever actually at stake. A firm that has stated nothing still gets
 * null everywhere and the same sentence, and no number anywhere is 40.
 */
test('with no cap stated, nothing is over anything and the response says why', async () => {
  const db = freshDb();
  const e = env(db);
  // Hours exist, so the refusal is not simply an empty page: this person has a
  // real week and is still not marked over, because there is no cap to be over.
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/${nowPeriod()}`, ours, { hours: 62 });
  const r = (await call(e, 'GET', '/capacity', ours)).body;
  assert.equal(r.cap_hours, null);
  assert.equal(r.cap_source, null);
  assert.match(r.cap_note, /no capacity cap is recorded/i);
  assert.equal(r.over_committed_count, null);
  assert.equal(r.people.length, 1);
  assert.equal(r.people[0].hours, 62);
  // NULL, NOT FALSE. "Not over" would be a judgement against a threshold
  // nobody set; null is the absence of one.
  assert.equal(r.people[0].over_committed, null);
  assert.equal(r.people[0].cap_hours, null);
  assert.equal(r.people[0].cap_source, null);
  // THE CANVAS'S FORTY APPEARS NOWHERE. Adopting it would invent the firm's
  // cap and then present the result as a finding — which is what the whole
  // refusal is about, and what a value assertion catches that a name one
  // cannot.
  const numbers = JSON.stringify(r).match(/\d+(?:\.\d+)?/g) || [];
  assert.ok(!numbers.includes('40'), 'the response carries the canvas fixture 40');
});

test('a stated cap is the firm’s number, and clearing it restores the refusal', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/${nowPeriod()}`, ours, { hours: 44 });

  const set = await call(e, 'PUT', '/capacity/cap', ours, { weekly_hours: 38, note: 'four days, one for internal' });
  assert.equal(set.status, 200);
  let r = (await call(e, 'GET', '/capacity', ours)).body;
  assert.equal(r.cap_hours, 38);
  assert.equal(r.cap_source, 'firm');
  assert.equal(r.cap_note, 'four days, one for internal');
  assert.equal(r.over_committed_count, 1);
  assert.equal(r.people[0].over_committed, true);
  assert.equal(r.people[0].cap_source, 'firm');

  // A PERSON'S OWN NUMBER WINS over the firm's, and moves the same week back
  // under the line — which is the whole reason the override exists.
  await call(e, 'PUT', '/capacity/cap', ours, { person_user_id: OUR_STAFF, weekly_hours: 50 });
  r = (await call(e, 'GET', '/capacity', ours)).body;
  assert.equal(r.people[0].cap_hours, 50);
  assert.equal(r.people[0].cap_source, 'person');
  assert.equal(r.people[0].over_committed, false);
  assert.equal(r.over_committed_count, 0);
  // The firm's default is untouched by the override.
  assert.equal(r.cap_hours, 38);

  // CLEARING IS A DELETE, NOT A ZERO. A cap that could be set and not unset
  // would make the first number typed permanent.
  await call(e, 'PUT', '/capacity/cap', ours, { person_user_id: OUR_STAFF, weekly_hours: null });
  await call(e, 'PUT', '/capacity/cap', ours, { weekly_hours: null });
  r = (await call(e, 'GET', '/capacity', ours)).body;
  assert.equal(r.cap_hours, null);
  assert.equal(r.over_committed_count, null);
  assert.equal(r.people[0].over_committed, null);
  assert.match(r.cap_note, /no capacity cap is recorded/i);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS c FROM partner_capacity').get().c, 0,
    'clearing wrote a row instead of removing one',
  );
});

test('a cap is refused for a person outside the firm, and for an impossible week', async () => {
  const e = env(freshDb());
  for (const outsider of [THEIR_STAFF, FOUNDER_USER]) {
    const r = await call(e, 'PUT', '/capacity/cap', ours, { person_user_id: outsider, weekly_hours: 40 });
    assert.equal(r.status, 404, `a cap was written against user ${outsider}`);
  }
  for (const bad of [0, -1, 168, 900]) {
    const r = await call(e, 'PUT', '/capacity/cap', ours, { weekly_hours: bad });
    assert.equal(r.status, 400, `${bad} hours a week was accepted as a cap`);
  }
});

/**
 * THE THIRD COLUMN, AND WHY THE TOTAL IS A FLOOR WITHOUT IT.
 *
 * `engagement_hours.engagement_id` is NOT NULL, so the client book cannot hold
 * admin, recruiting or the proposal that lost. A week assembled from it alone
 * under-reports every person by exactly the part nobody is billed for — and in
 * the reassuring direction, which is the failure this bucket is least allowed
 * to have. Migration 231 holds the rest.
 */
test('internal hours are stated, not inferred, and they change who is over cap', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/${nowPeriod()}`, ours, { hours: 36 });
  await call(e, 'PUT', '/capacity/cap', ours, { weekly_hours: 40 });

  let r = (await call(e, 'GET', '/capacity', ours)).body;
  // NULL, NOT ZERO. Nobody has said, and a zero here would claim this person
  // spends no time on the firm — the one thing that is certainly false.
  assert.equal(r.people[0].internal_hours, null);
  assert.equal(r.internal_hours_total, null);
  assert.equal(r.people[0].total_hours, 36);
  assert.equal(r.people[0].over_committed, false);

  const put = await call(e, 'PUT', '/capacity/internal-hours', ours, {
    person_user_id: OUR_STAFF, period: nowPeriod(), hours: 7, note: 'recruiting',
  });
  assert.equal(put.status, 200);
  r = (await call(e, 'GET', '/capacity', ours)).body;
  assert.equal(r.people[0].internal_hours, 7);
  assert.equal(r.people[0].internal_note, 'recruiting');
  assert.equal(r.internal_hours_total, 7);
  // 36 + 7 crosses a cap 36 alone did not. The billable book called this week
  // safe; the whole week is not.
  assert.equal(r.people[0].total_hours, 43);
  assert.equal(r.people[0].over_committed, true);

  // ZERO IS A STATEMENT AND SURVIVES AS ONE.
  await call(e, 'PUT', '/capacity/internal-hours', ours, {
    person_user_id: OUR_STAFF, period: nowPeriod(), hours: 0,
  });
  r = (await call(e, 'GET', '/capacity', ours)).body;
  assert.equal(r.people[0].internal_hours, 0);
  assert.equal(r.internal_hours_total, 0);
  assert.equal(r.people[0].over_committed, false);

  // Clearing removes the row rather than writing a zero, so the read goes back
  // to "nobody said" and not to "they said none".
  await call(e, 'PUT', '/capacity/internal-hours', ours, {
    person_user_id: OUR_STAFF, period: nowPeriod(), hours: null,
  });
  r = (await call(e, 'GET', '/capacity', ours)).body;
  assert.equal(r.people[0].internal_hours, null);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS c FROM partner_internal_hours').get().c, 0,
    'clearing wrote a row instead of removing one',
  );
});

test('internal hours are refused for outsiders and for a period that is not one', async () => {
  const e = env(freshDb());
  for (const outsider of [THEIR_STAFF, FOUNDER_USER]) {
    const r = await call(e, 'PUT', '/capacity/internal-hours', ours, {
      person_user_id: outsider, period: nowPeriod(), hours: 4,
    });
    assert.equal(r.status, 404, `internal hours were written against user ${outsider}`);
  }
  for (const bad of ['2026', '2026-13', 'last week', '']) {
    const r = await call(e, 'PUT', '/capacity/internal-hours', ours, {
      person_user_id: OUR_STAFF, period: bad, hours: 4,
    });
    assert.equal(r.status, 400, `"${bad}" was accepted as a period`);
  }
});

/**
 * SEAT HOURS ARE THE HOURS OF THE PERSON HOLDING THE SEAT, not of everyone on
 * an embedded engagement. Two people can work one engagement while only one of
 * them is inside the client's systems, and the one who is not did project work.
 */
test('hours split by whose seat it is, and a revoked seat keeps its hours', async () => {
  const db = freshDb();
  const e = env(db);
  const seat = await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/seats`, ours, {
    holder_user_id: OUR_STAFF, scope: 'Board, KPIs',
  });
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/${nowPeriod()}`, ours, { hours: 31 });
  // The same engagement, a person with no seat on it.
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/hours/${OURS_USER}/${nowPeriod()}`, ours, { hours: 12 });

  let r = (await call(e, 'GET', '/capacity', ours)).body;
  const holder = r.people.find((p: any) => p.user_id === OUR_STAFF);
  const other = r.people.find((p: any) => p.user_id === OURS_USER);
  assert.equal(holder.seat_hours, 31);
  assert.equal(holder.project_hours, 0);
  assert.equal(other.seat_hours, 0);
  assert.equal(other.project_hours, 12);
  assert.equal(r.seat_hours_total, 31);
  assert.equal(r.project_hours_total, 12);
  assert.equal(r.live_seats, 1);
  assert.deepEqual(holder.seat_places.map((s: any) => [s.scope, s.revoked]), [['Board, KPIs', false]]);

  // REVOKING DOES NOT REWRITE THE PAST. The access ended; the work done while
  // it was open was still done inside the client's systems, so the hours stay
  // seat hours rather than sliding into the project column.
  await call(e, 'POST', `/seats/${seat.body.id}/revoke`, ours);
  r = (await call(e, 'GET', '/capacity', ours)).body;
  const after = r.people.find((p: any) => p.user_id === OUR_STAFF);
  assert.equal(after.seat_hours, 31);
  assert.equal(after.project_hours, 0);
  assert.equal(r.seat_hours_total, 31);
  assert.equal(r.live_seats, 0);
  assert.equal(after.seat_places[0].revoked, true);
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

/**
 * THE THREE CHIPS THAT SELECTED NOTHING, AND THE TWO FIELDS THEY WAITED ON.
 *
 * `With blockers` filtered on `r.blockers`, `This cycle` and `Archive` on
 * `d.period` — neither of which this listing returned. The compose endpoint had
 * been reading blockers live since it was written; the listing simply never
 * joined them, so on every build one chip showed everything and two showed
 * nothing.
 */
test('the reports listing carries the cycle and each report’s live blockers', async () => {
  const db = freshDb();
  const e = env(db);
  const p = nowPeriod();
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/${p}`, ours, { shipped: 'x' });

  let r = (await call(e, 'GET', '/status-reports', ours)).body;
  assert.equal(r.period, p, 'the listing does not say which cycle it is');
  assert.deepEqual(r.items[0].blockers, [], 'a report with nothing open has no blockers array');
  assert.equal(r.blocked_count, 0);
  assert.equal(r.client_blocked_count, 0);
  assert.equal(r.sent_this_cycle, 0);

  const b = await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/blockers`, ours, {
    side: 'client', summary: 'Waiting on a direction',
  });
  r = (await call(e, 'GET', '/status-reports', ours)).body;
  assert.equal(r.items[0].blockers.length, 1);
  assert.equal(r.items[0].blockers[0].side, 'client');
  assert.equal(r.items[0].blockers[0].summary, 'Waiting on a direction');
  assert.equal(r.blocked_count, 1);
  assert.equal(r.client_blocked_count, 1);

  // CLEARED IS NOT BLOCKED. A blocker cleared since the report was written is
  // what it USED to be blocked on; returning it would report a solved problem
  // as a live one — and it is exactly what a prose copy on the report row
  // would have done.
  await call(e, 'PATCH', `/blockers/${b.body.id}`, ours, { cleared_at: new Date().toISOString() });
  r = (await call(e, 'GET', '/status-reports', ours)).body;
  assert.deepEqual(r.items[0].blockers, []);
  assert.equal(r.blocked_count, 0);

  // SENT THIS CYCLE COUNTS THE CYCLE, not every report ever sent — so an
  // earlier period's sent report is in `sent_count` and out of this tile.
  const older = await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/2024-01`, ours, {
    shipped: 'last year',
  });
  await call(e, 'POST', `/status-reports/${older.body.id}/send`, ours);
  const thisCycle = (await call(e, 'GET', '/status-reports', ours)).body.items
    .find((x: any) => x.period === p);
  await call(e, 'POST', `/status-reports/${thisCycle.id}/send`, ours);
  r = (await call(e, 'GET', '/status-reports', ours)).body;
  assert.equal(r.sent_count, 2, 'both sent reports should be counted overall');
  assert.equal(r.sent_this_cycle, 1, 'an earlier cycle’s report was counted as this cycle’s');
  assert.equal(r.draft_count, 0);
});

test('a read time is refused rather than timed from our own send', async () => {
  const e = env(freshDb());
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/${nowPeriod()}`, ours, {
    shipped: 'x',
  });
  const r = (await call(e, 'GET', '/status-reports', ours)).body;
  // A read needs an open; an open is the client's act; no client-side surface
  // exists to record one. Timing from the send would measure our own silence.
  assert.equal(r.read_time_median_days, null);
  assert.match(r.read_time_note, /no client-side surface to record it on/i);
});

test('another firm’s blockers never reach this firm’s report feed', async () => {
  const db = freshDb();
  const e = env(db);
  const p = nowPeriod();
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/${p}`, ours, { shipped: 'x' });
  await call(e, 'POST', `/engagements/${THEIR_ENGAGEMENT}/blockers`, theirs, {
    side: 'client', summary: 'Theirs, not ours',
  });
  const r = (await call(e, 'GET', '/status-reports', ours)).body;
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.items[0].blockers, [], 'a blocker crossed a firm boundary into the feed');
  assert.equal(r.blocked_count, 0);
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
