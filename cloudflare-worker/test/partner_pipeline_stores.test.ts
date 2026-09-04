/**
 * The partner Pipeline stores — migration 208's negotiation and retainer
 * tables, and the routes over them.
 *
 * EVERY TEST HERE PINS A DECISION THAT COULD HAVE GONE THE OTHER WAY and would
 * be invisible if it did:
 *
 *   * another firm's quote and engagement answer 404, NOT 403 — a non-owner
 *     must not learn the row exists;
 *   * utilisation is null in two different ways and is NEVER 0% — a retainer
 *     not sold by the hour has none, and a period nobody logged has one nobody
 *     recorded, and zero would say the client used none of what they bought;
 *   * editing only the open question does NOT reset the stalled clock, because
 *     if it did the "stalled 7d+" count could be cleared by typing;
 *   * an amount rejects 12.5, −1 and 'free' — a cents column that accepts a
 *     fraction has a name promising exactness and a value that does not;
 *   * MRR skips an unpriced retainer rather than summing it as zero, and says
 *     how many rows it counted;
 *   * a quarterly period cannot be logged against a monthly retainer;
 *   * deleting a retainer takes its usage with it, and deleting a period is a
 *     real delete rather than a write of zero.
 *
 * HARNESS. Same shape as `advisor_stores.test.ts`: the real router against real
 * in-memory SQLite, with the new tables built FROM THE MIGRATION FILE rather
 * than hand-copied. Copying a shape into a test is how a test ends up passing
 * against a schema production does not have.
 *
 * PRODUCTION HAS NO ENGAGEMENTS AND NO QUOTES — the marketplace is pre-launch —
 * so nothing below could be observed against live data. That reduces product
 * confidence, not test coverage: every row here is seeded against the real DDL,
 * so every derivation, refusal and envelope is exercised at full fidelity.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import partnerPipeline from '../src/routes/partner_pipeline.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const OURS_USER = 80;      // partner_id 1
const THEIRS_USER = 81;    // partner_id 2
const FOUNDER_USER = 82;
const ORPHAN_USER = 83;    // partner role, no partners row at all

const OUR_QUOTE = 501;
const THEIR_QUOTE = 502;
const OUR_ENGAGEMENT = 601;
const THEIR_ENGAGEMENT = 602;

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
  // The tables 208 hangs off, in their live shapes. `partners` is schema.sql's;
  // `founder_needs`, `quotes` and `engagements` are t13_t14_t15.sql's.
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

  // The new tables come from the migration file verbatim. If it stops parsing,
  // these tests stop running — which is the point.
  db.exec(migration('208_partner_delivery_stores'));

  const u = db.prepare('INSERT INTO users (id, role, partner_id, name, email) VALUES (?,?,?,?,?)');
  u.run(OURS_USER, 'partner', 1, 'Ours', 'ours@example.com');
  u.run(THEIRS_USER, 'partner', 2, 'Theirs', 'theirs@example.com');
  u.run(FOUNDER_USER, 'founder', null, 'Fran', 'fran@example.com');
  // No `partners` row and an email that matches none — the state 19 of 26 live
  // partner accounts are in. `requirePartnerProfile` refuses it by design.
  u.run(ORPHAN_USER, 'partner', null, 'Orphan', 'orphan@example.com');

  const p = db.prepare('INSERT INTO partners (id, uid, name, email) VALUES (?,?,?,?)');
  p.run(1, 'p-1', 'Ours', 'ours@example.com');
  p.run(2, 'p-2', 'Theirs', 'theirs@example.com');

  const n = db.prepare(
    'INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description) VALUES (?,?,?,?,?,?,?)');
  n.run(301, 'need-1', 9, FOUNDER_USER, 'engineering', 'Payments migration', 'Move off the old rails');
  n.run(302, 'need-2', 9, FOUNDER_USER, 'design', 'Brand refresh', 'New identity');

  const q = db.prepare(
    'INSERT INTO quotes (id, uid, need_id, partner_id, price, deliverables) VALUES (?,?,?,?,?,?)');
  q.run(OUR_QUOTE, 'q-ours', 301, 1, 42000, 'Discovery, build, handover');
  q.run(THEIR_QUOTE, 'q-theirs', 302, 2, 15000, 'Identity system');

  const e = db.prepare(
    `INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price)
     VALUES (?,?,?,?,?,?,?,?)`);
  e.run(OUR_ENGAGEMENT, 'e-ours', 301, OUR_QUOTE, 1, FOUNDER_USER, 9, 42000);
  e.run(THEIR_ENGAGEMENT, 'e-theirs', 302, THEIR_QUOTE, 2, FOUNDER_USER, 9, 15000);

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
  const res = await partnerPipeline.request(path, init, e);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const ours = { user: OURS_USER, role: 'partner' };
const theirs = { user: THEIRS_USER, role: 'partner' };
const fran = { user: FOUNDER_USER, role: 'founder' };
const orphan = { user: ORPHAN_USER, role: 'partner' };

/**
 * Every row in the four tables 208 added, as JSON.
 *
 * Four literal statements rather than one built by interpolating a table name.
 * The loop form read better and was safe — the names are this file's own
 * constants — but a query assembled with `${}` is the shape CodeQL's
 * `js/sql-injection` reports whatever the source turns out to be, and a
 * security alert a reviewer has to dismiss by hand costs more than four lines.
 * If a fifth table is added, add a fifth line: a snapshot that silently omits a
 * table would let a read write to it undetected, which is the one thing this
 * function exists to catch.
 */
function snapshot(db: InstanceType<typeof DatabaseSync>): string {
  return JSON.stringify([
    db.prepare('SELECT * FROM quote_negotiations ORDER BY id').all(),
    db.prepare('SELECT * FROM quote_terms ORDER BY id').all(),
    db.prepare('SELECT * FROM partner_retainers ORDER BY id').all(),
    db.prepare('SELECT * FROM retainer_usage ORDER BY id').all(),
  ]);
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

test('a partner sees only its own quotes and engagements', async () => {
  const e = env(freshDb());

  const negs = await call(e, 'GET', '/negotiations', ours);
  assert.equal(negs.status, 200);
  assert.equal(negs.body.items.length, 1);
  assert.equal(negs.body.items[0].quote_id, OUR_QUOTE);

  const rets = await call(e, 'GET', '/retainers', ours);
  assert.equal(rets.status, 200);
  assert.equal(rets.body.items.length, 1);
  assert.equal(rets.body.items[0].engagement_id, OUR_ENGAGEMENT);
});

test('another firm\'s row is 404, never 403', async () => {
  const e = env(freshDb());
  // 403 would confirm the row exists to someone who has no business knowing.
  // Every one of these is a write, so a wrong status is not merely a leak of
  // existence — it is the shape of a probe that works.
  for (const [method, path, body] of [
    ['PUT', `/negotiations/${THEIR_QUOTE}`, { stage: 'terms' }],
    ['POST', `/negotiations/${THEIR_QUOTE}/terms`, { label: 'Payment days' }],
    ['PUT', `/retainers/${THEIR_ENGAGEMENT}`, { shape: 'retainer' }],
    ['DELETE', `/retainers/${THEIR_ENGAGEMENT}`, undefined],
    ['PUT', `/retainers/${THEIR_ENGAGEMENT}/usage/2026-09`, { hours_used: 4 }],
  ] as const) {
    const r = await call(e, method as string, path as string, ours, body as any);
    assert.equal(r.status, 404, `${method} ${path} answered ${r.status}, not 404`);
    assert.match(String(r.body?.detail || ''), /not found/i);
  }
});

test('a term on another firm\'s negotiation is 404 for both edit and delete', async () => {
  const db = freshDb();
  const e = env(db);
  const made = await call(e, 'POST', `/negotiations/${THEIR_QUOTE}/terms`, theirs, { label: 'Exclusivity' });
  assert.equal(made.status, 200);

  for (const method of ['PATCH', 'DELETE']) {
    const r = await call(e, method, `/negotiation-terms/${made.body.id}`, ours, { label: 'Mine now' });
    assert.equal(r.status, 404);
  }
  // And the row is untouched, not merely unreported.
  const row = db.prepare('SELECT label FROM quote_terms WHERE id = ?').get(made.body.id) as any;
  assert.equal(row.label, 'Exclusivity');
});

test('a partner account with no firm gets the boundary, not an empty list', async () => {
  const e = env(freshDb());
  // The distinction the zone body depends on: an orphaned account must NOT
  // read as "your store is empty", because that is a different fact and the
  // remedy is an admin's rather than the user's.
  const r = await call(e, 'GET', '/negotiations', orphan);
  assert.equal(r.status, 400);
  assert.match(String(r.body?.detail || ''), /no partner profile/i);
});

test('a founder is refused outright', async () => {
  const e = env(freshDb());
  const r = await call(e, 'GET', '/retainers', fran);
  assert.equal(r.status, 403);
});

test('a read writes nothing', async () => {
  const db = freshDb();
  const e = env(db);
  // Seed enough that a read has something to derive from — a read that finds
  // nothing could not write anything either, so it would prove nothing.
  await call(e, 'PUT', `/negotiations/${OUR_QUOTE}`, ours, { stage: 'terms', ball: 'us' });
  await call(e, 'POST', `/negotiations/${OUR_QUOTE}/terms`, ours, { label: 'Payment days' });
  await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}`, ours, { amount_cents: 800000, retained_hours: 40 });
  await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}/usage/${nowPeriod()}`, ours, { hours_used: 31 });

  const before = snapshot(db);
  await call(e, 'GET', '/negotiations', ours);
  await call(e, 'GET', '/retainers', ours);
  assert.equal(snapshot(db), before, 'a GET changed a stored row');
});

/** The monthly period label the worker would pick right now. */
function nowPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Negotiations
// ---------------------------------------------------------------------------

test('a quote with no negotiation is listed, not hidden', async () => {
  const e = env(freshDb());
  const r = await call(e, 'GET', '/negotiations', ours);
  assert.equal(r.body.items.length, 1);
  // `negotiation: null` rather than an omitted row: the zone offers it as
  // something to start tracking. Hiding it would make an untracked deal
  // indistinguishable from one that does not exist.
  assert.equal(r.body.items[0].negotiation, null);
  assert.deepEqual(r.body.items[0].terms, []);
});

test('editing only the open question does not reset the stalled clock', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/negotiations/${OUR_QUOTE}`, ours, { stage: 'terms', ball: 'us' });

  // Backdate the move so a reset would be unmistakable.
  const old = '2026-01-01T00:00:00.000Z';
  db.prepare('UPDATE quote_negotiations SET last_moved_at = ? WHERE quote_id = ?').run(old, OUR_QUOTE);

  const reworded = await call(e, 'PUT', `/negotiations/${OUR_QUOTE}`, ours, {
    stage: 'terms', ball: 'us', open_question: 'Who owns the migration window?',
  });
  assert.equal(reworded.status, 200);
  assert.equal(reworded.body.last_moved_at, old,
    'rewording the question moved the clock — the stalled count could then be cleared by typing');
  assert.equal(reworded.body.open_question, 'Who owns the migration window?');
  assert.ok(reworded.body.days_stalled > 100);

  // A stage change DOES move it, and so does an explicit touch.
  const moved = await call(e, 'PUT', `/negotiations/${OUR_QUOTE}`, ours, { stage: 'legal' });
  assert.notEqual(moved.body.last_moved_at, old);

  db.prepare('UPDATE quote_negotiations SET last_moved_at = ? WHERE quote_id = ?').run(old, OUR_QUOTE);
  const touched = await call(e, 'PUT', `/negotiations/${OUR_QUOTE}`, ours, { touch: true });
  assert.notEqual(touched.body.last_moved_at, old);
});

test('a negotiation is one per quote — the second PUT updates rather than duplicating', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/negotiations/${OUR_QUOTE}`, ours, { stage: 'scoping' });
  await call(e, 'PUT', `/negotiations/${OUR_QUOTE}`, ours, { stage: 'legal' });
  const rows = db.prepare('SELECT * FROM quote_negotiations WHERE quote_id = ?').all(OUR_QUOTE);
  assert.equal(rows.length, 1);
  assert.equal((rows[0] as any).stage, 'legal');
});

test('an unknown stage or court is refused with a sentence naming the choices', async () => {
  const e = env(freshDb());
  const bad = await call(e, 'PUT', `/negotiations/${OUR_QUOTE}`, ours, { stage: 'nearly_signed' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.detail, /scoping/);
  const badBall = await call(e, 'PUT', `/negotiations/${OUR_QUOTE}`, ours, { ball: 'legal' });
  assert.equal(badBall.status, 400);
});

test('adding a term creates the negotiation it implies', async () => {
  const db = freshDb();
  const e = env(db);
  // Making the caller create the parent first would be a round trip that exists
  // only because of our table layout.
  const t = await call(e, 'POST', `/negotiations/${OUR_QUOTE}/terms`, ours, {
    label: 'Payment days', our_position: 'Net 30', their_position: 'Net 90',
  });
  assert.equal(t.status, 200);
  assert.equal(t.body.state, 'open');
  assert.equal(t.body.landing, null, 'an unlanded term is null, not an empty string');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM quote_negotiations').get<any>().c, 1);
});

test('a term needs a label', async () => {
  const e = env(freshDb());
  const r = await call(e, 'POST', `/negotiations/${OUR_QUOTE}/terms`, ours, { our_position: 'Net 30' });
  assert.equal(r.status, 400);
  assert.match(r.body.detail, /label/i);
});

test('a PATCH leaves an absent key alone and an explicit null clears it', async () => {
  const e = env(freshDb());
  const made = await call(e, 'POST', `/negotiations/${OUR_QUOTE}/terms`, ours, {
    label: 'Scope cap', our_position: '3 sprints', their_position: 'unbounded', landing: '4 sprints',
  });

  // Absent → untouched. This is the whole difference between a PATCH and a PUT,
  // and an object spread cannot tell "not sent" from "sent as null".
  const one = await call(e, 'PATCH', `/negotiation-terms/${made.body.id}`, ours, { state: 'agreed' });
  assert.equal(one.body.our_position, '3 sprints');
  assert.equal(one.body.landing, '4 sprints');
  assert.equal(one.body.state, 'agreed');

  // Explicit null → cleared.
  const two = await call(e, 'PATCH', `/negotiation-terms/${made.body.id}`, ours, { landing: null });
  assert.equal(two.body.landing, null);
  assert.equal(two.body.our_position, '3 sprints');
});

test('there is no way to delete a negotiation, only to close it', async () => {
  const e = env(freshDb());
  // `stage: 'closed'` is in the CHECK constraint for exactly this reason:
  // deleting the row would lose the conversation that produced the decision,
  // which is the only part worth keeping afterwards.
  const gone = await call(e, 'DELETE', `/negotiations/${OUR_QUOTE}`, ours);
  assert.equal(gone.status, 404, 'a DELETE route on a negotiation exists');
  const closed = await call(e, 'PUT', `/negotiations/${OUR_QUOTE}`, ours, { stage: 'closed' });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.stage, 'closed');
});

// ---------------------------------------------------------------------------
// Retainers
// ---------------------------------------------------------------------------

test('an engagement with no retainer is listed with retainer: null', async () => {
  const e = env(freshDb());
  const r = await call(e, 'GET', '/retainers', ours);
  const row = r.body.items[0];
  assert.equal(row.retainer, null);
  assert.equal(r.body.retainer_count, 0);
  assert.equal(r.body.mrr_cents, null, 'no priced retainer must be null, never 0');
  assert.match(r.body.mrr_note, /no recurring total/i);
});

test('utilisation is null two different ways and never zero', async () => {
  const e = env(freshDb());

  // (a) Sold, but not by the hour. This retainer HAS no utilisation — a
  // different shape of deal rather than a missing figure.
  await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}`, ours, {
    shape: 'retainer', cadence: 'monthly', amount_cents: 800000,
  });
  const noHours = (await call(e, 'GET', '/retainers', ours)).body.items[0];
  assert.equal(noHours.utilisation_pct, null);
  assert.match(noHours.utilisation_note, /not sold by the hour/i);

  // (b) Sold by the hour, but nobody has logged the period. A gap, and a
  // different sentence — somebody can close this one.
  await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}`, ours, { retained_hours: 40 });
  const noUsage = (await call(e, 'GET', '/retainers', ours)).body.items[0];
  assert.equal(noUsage.utilisation_pct, null);
  assert.match(noUsage.utilisation_note, /logged for this period/i);
  assert.notEqual(noUsage.utilisation_note, noHours.utilisation_note,
    'the two nulls must not read the same — they are different facts');

  // And with hours logged it is a real percentage with no note at all.
  await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}/usage/${nowPeriod()}`, ours, { hours_used: 30 });
  const real = (await call(e, 'GET', '/retainers', ours)).body.items[0];
  assert.equal(real.utilisation_pct, 75);
  assert.equal(real.utilisation_note, null);
  assert.equal(real.hours_used, 30);
  assert.equal(real.retained_hours, 40);
});

test('a fraction, a negative and a word are all refused as an amount', async () => {
  const e = env(freshDb());
  for (const [amount, why] of [
    [12.5, 'a fraction of a cent'],
    [-1, 'a negative amount'],
    ['free', 'a word'],
  ] as const) {
    const r = await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}`, ours, { amount_cents: amount });
    assert.equal(r.status, 400, `${why} was accepted`);
    assert.match(String(r.body.detail), /cents|negative/i);
  }
  // And an explicit null is accepted — it means "not priced", which is a real
  // state and the one MRR skips rather than counts as zero.
  const cleared = await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}`, ours, { amount_cents: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.amount_cents, null);
});

test('MRR skips an unpriced retainer and says how many it counted', async () => {
  const db = freshDb();
  // A second engagement for the same firm, so one can be priced and one not.
  db.prepare(
    `INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(603, 'e-ours-2', 302, 503, 1, FOUNDER_USER, 9, 9000);
  const e = env(db);

  await call(e, 'PUT', '/retainers/601', ours, { cadence: 'monthly', amount_cents: 800000 });
  await call(e, 'PUT', '/retainers/603', ours, { cadence: 'monthly' });

  const r = (await call(e, 'GET', '/retainers', ours)).body;
  assert.equal(r.retainer_count, 2);
  assert.equal(r.mrr_cents, 800000, 'the unpriced retainer was summed as zero');
  assert.match(r.mrr_basis, /^1 retainer with a recorded amount/);
  assert.match(r.mrr_note, /1 retainer has no amount recorded/);
});

test('a quarterly amount is divided by three rather than counted whole', async () => {
  const e = env(freshDb());
  await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}`, ours, {
    cadence: 'quarterly', amount_cents: 900000,
  });
  const r = (await call(e, 'GET', '/retainers', ours)).body;
  // Summing raw would make MRR three times too big on every quarterly line.
  assert.equal(r.mrr_cents, 300000);
  assert.match(r.mrr_basis, /quarterly amounts divided by three/);
});

test('a monthly retainer refuses a quarterly period label', async () => {
  const e = env(freshDb());
  await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}`, ours, { cadence: 'monthly', retained_hours: 40 });
  // `period` is free TEXT, so without this a monthly retainer accumulates a
  // quarterly usage row and utilisation divides one period's hours by another's
  // allowance.
  const bad = await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}/usage/2026-Q3`, ours, { hours_used: 90 });
  assert.equal(bad.status, 400);
  assert.match(bad.body.detail, /2026-09/);

  await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}`, ours, { cadence: 'quarterly' });
  const ok = await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}/usage/2026-Q3`, ours, { hours_used: 90 });
  assert.equal(ok.status, 200);
});

test('hours cannot be logged before the retainer they are against', async () => {
  const e = env(freshDb());
  const r = await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}/usage/${nowPeriod()}`, ours, { hours_used: 4 });
  assert.equal(r.status, 404);
  assert.match(r.body.detail, /record the retainer/i);
});

test('a period is upserted, not appended', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}`, ours, { retained_hours: 40 });
  await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}/usage/${nowPeriod()}`, ours, { hours_used: 10 });
  const second = await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}/usage/${nowPeriod()}`, ours, { hours_used: 22 });
  assert.equal(second.body.hours_used, 22);
  assert.equal(second.body.utilisation_pct, 55);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM retainer_usage').get<any>().c, 1);
});

test('clearing a period deletes the row rather than writing zero', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}`, ours, { retained_hours: 40 });
  await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}/usage/${nowPeriod()}`, ours, { hours_used: 10 });

  const gone = await call(e, 'DELETE', `/retainers/${OUR_ENGAGEMENT}/usage/${nowPeriod()}`, ours);
  assert.equal(gone.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM retainer_usage').get<any>().c, 0,
    'a zero row was written instead of the record being removed — zero claims they worked none');

  // And utilisation reverts to the "nobody logged it" null rather than 0%.
  const after = (await call(e, 'GET', '/retainers', ours)).body.items[0];
  assert.equal(after.utilisation_pct, null);
  assert.match(after.utilisation_note, /logged for this period/i);
});

test('deleting a retainer takes its usage with it', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}`, ours, { retained_hours: 40 });
  await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}/usage/${nowPeriod()}`, ours, { hours_used: 10 });

  const gone = await call(e, 'DELETE', `/retainers/${OUR_ENGAGEMENT}`, ours);
  assert.equal(gone.status, 200);
  // Orphaned usage rows would be counted by nothing and deleted by nothing —
  // and would come back attached to the next retainer if ids were reused.
  assert.equal(db.prepare('SELECT COUNT(*) c FROM retainer_usage').get<any>().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM partner_retainers').get<any>().c, 0);

  // The ENGAGEMENT survives — removing the retainer record is not ending the
  // work, and the row must still be offered as something to record against.
  const after = (await call(e, 'GET', '/retainers', ours)).body;
  assert.equal(after.items.length, 1);
  assert.equal(after.items[0].retainer, null);
});

test('an unknown shape or cadence is refused', async () => {
  const e = env(freshDb());
  const badShape = await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}`, ours, { shape: 'subscription' });
  assert.equal(badShape.status, 400);
  assert.match(badShape.body.detail, /embedded_seat/);
  const badCadence = await call(e, 'PUT', `/retainers/${OUR_ENGAGEMENT}`, ours, { cadence: 'weekly' });
  assert.equal(badCadence.status, 400);
});

// ---------------------------------------------------------------------------
// The routes store nothing they derive
// ---------------------------------------------------------------------------

test('no route writes a value it computes', () => {
  // The route-side twin of `partner_delivery_stores.test.mjs`'s schema check.
  // 208 has no `health`, `utilisation` or `days_stalled` column BECAUSE each is
  // a read over rows that move; a route that wrote one anyway would create the
  // second source of truth the schema was shaped to prevent, and the schema
  // test would still pass.
  const src = readFileSync(resolve(HERE, '../src/routes/partner_pipeline.ts'), 'utf8');
  // Every SQL string literal, then the write ones — not a forward scan from
  // `INSERT INTO` to the next backtick. That form only worked for
  // template-literal SQL: a single-quoted UPDATE ran on to whatever backtick
  // came next and swallowed unrelated code. It happened to be harmless in this
  // file and was not in `partner_delivery_routes.test.ts`, where it reported a
  // DTO field as a written column.
  const literals = [...src.matchAll(/`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'/g)].map((m) => m[0]);
  const writes = literals.filter((x) => /\b(?:INSERT INTO|UPDATE)\s+\w/.test(x)).join('\n');
  assert.ok(writes.length > 0, 'no write statements were found — the scan is broken');
  // Word-split and set membership rather than a regex built per name. Same
  // reasoning as `frontend/test/_zoneGuards.mjs`: nothing here needs a pattern
  // assembled at runtime, and one that is assembled gets reported as regex
  // injection by security-extended no matter how local its input is.
  const DERIVED = new Set(['health', 'utilisation', 'days_stalled', 'is_published', 'mrr']);
  const named = new Set(writes.split(/[^A-Za-z0-9_]+/).filter(Boolean));
  for (const derived of DERIVED) {
    assert.ok(!named.has(derived),
      `a write names \`${derived}\` — that value is derived and must not be stored`);
  }
});
