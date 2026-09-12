/**
 * `advisor_engagements` — migration 238 and the four verbs over it.
 *
 * WHAT THESE TESTS ARE FOR. This store exists because the artboard's
 * load-bearing instrument had nowhere to live: "Renewal history · Only here ·
 * the number that judges a practice". A rate is only worth drawing if its
 * denominator is right, and every way of getting it wrong is silent — the page
 * would render a confident percentage either way. So the tests here are mostly
 * about WHICH ROWS COUNT:
 *
 *   * a signed contract cannot be ended through the lane verb, because that
 *     would drop a lost renewal out of the denominator — the canvas's own
 *     words, "a rate that excludes its failures is not a rate";
 *   * an abandoned DRAFT ends with no outcome at all, because it never had a
 *     renewal to lose, and giving it one would pad the denominator instead;
 *   * a lane correction (renewal_due and back) must not add a cycle;
 *   * no decision yet reads as NULL, never as 0% — D56/D68. A practice that
 *     has not reached its first renewal has not failed to renew.
 *
 * And the ordinary half: every read and write is scoped to the signed-in
 * advisor and answers 404 rather than 403, so someone else's engagement is
 * indistinguishable from one that does not exist.
 *
 * HARNESS. The real router against real in-memory SQLite, with
 * `advisor_engagements` built from the MIGRATION FILE itself rather than a
 * hand-copied shape — the same rule `advisor_stores.test.ts` states, for the
 * same reason: a test that copies a schema passes against a database
 * production does not have.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import advisors, { ENGAGEMENT_LANES, ENGAGEMENT_SHAPES } from '../src/routes/advisors.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADVISOR_USER = 70;
const OTHER_ADVISOR_USER = 71;
const FOUNDER_USER = 72;

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
  // The t13 tables the router's schema bootstrap expects to find. It tolerates
  // their absence, but `advisors` is the one every handler here joins through.
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, advisor_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE advisors (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, user_id INTEGER UNIQUE,
      display_name TEXT NOT NULL, email TEXT, bio TEXT,
      expertise_json TEXT NOT NULL DEFAULT '[]', sectors_json TEXT NOT NULL DEFAULT '[]',
      linkedin_url TEXT, hourly_rate_usd INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE advisor_office_hour_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      advisor_id INTEGER NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 1, meeting_url TEXT, notes TEXT,
      is_cancelled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE advisor_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      slot_id INTEGER NOT NULL, advisor_id INTEGER NOT NULL,
      founder_user_id INTEGER NOT NULL, topic TEXT, notes TEXT,
      status TEXT NOT NULL DEFAULT 'pending', cancel_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (slot_id, founder_user_id)
    );
  `);
  // Verbatim from the migration. If it stops parsing, these tests stop running.
  db.exec(migration('238_advisor_engagements'));

  const u = db.prepare('INSERT INTO users (id, role, advisor_id, name, email) VALUES (?,?,?,?,?)');
  u.run(ADVISOR_USER, 'advisor', 1, 'Ada', 'ada@example.com');
  u.run(OTHER_ADVISOR_USER, 'advisor', 2, 'Grace', 'grace@example.com');
  u.run(FOUNDER_USER, 'founder', null, 'Fran', 'fran@example.com');

  const a = db.prepare(
    'INSERT INTO advisors (id, uid, user_id, display_name, email) VALUES (?,?,?,?,?)');
  a.run(1, 'adv-1', ADVISOR_USER, 'Ada', 'ada@example.com');
  a.run(2, 'adv-2', OTHER_ADVISOR_USER, 'Grace', 'grace@example.com');

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
  // The ExecutionContext stub is not optional: Hono's `c.executionCtx` getter
  // THROWS when absent, so the deferred-hook guard other advisor handlers use
  // becomes a 500 in tests and only in tests.
  const res = await advisors.request(path, init, e, {
    waitUntil() {}, passThroughOnException() {},
  } as any);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const ada = { user: ADVISOR_USER, role: 'advisor' };
const grace = { user: OTHER_ADVISOR_USER, role: 'advisor' };

/** Create one engagement for `who` and return its row. */
async function create(e: any, who = ada, over: Record<string, unknown> = {}) {
  const r = await call(e, 'POST', '/me/engagements', who, { client_name: 'Meridian Labs', ...over });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

/** Take a fresh engagement all the way to signed. */
async function sign(e: any, who = ada, over: Record<string, unknown> = {}) {
  const row = await create(e, who, over);
  const r = await call(e, 'POST', `/me/engagements/${row.id}/advance`, who, { lane: 'signed' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

// ---------------------------------------------------------------------------
// The lifecycle, one transition at a time
// ---------------------------------------------------------------------------
test('an engagement is born drafting, with no outcome and no cycle behind it', async () => {
  const e = env(freshDb());
  const row = await create(e);
  assert.equal(row.lane, 'drafting');
  assert.equal(row.cycles, 0, 'nothing has run yet');
  // THE DEFAULT THAT MATTERS. The canvas fixture stamps `outcome:'Active'` on
  // an unsent draft and its own comment calls that "the placeholder outcome
  // field"; storing it would put drafts into the renewal rate's arithmetic.
  assert.equal(row.outcome, null, 'a draft has no renewal outcome to report');
  assert.equal(row.started_at, null);
  assert.equal(row.proposed_at, null);
  assert.equal(row.ended_at, null);
  // Not zero. An equity engagement is the ordinary case of a row with no cents.
  assert.equal(row.amount_cents, null, 'an unpriced engagement is unpriced, not free');
});

test('a caller cannot open an engagement straight into a signed lane', async () => {
  // Signing stamps a start, opens the first cycle and gives the row an
  // outcome. Two code paths for that event is one too many.
  const e = env(freshDb());
  const row = await create(e, ada, { lane: 'signed', cycles: 4, outcome: 'renewed' });
  assert.equal(row.lane, 'drafting');
  assert.equal(row.cycles, 0);
  assert.equal(row.outcome, null);
});

test('sending a proposal stamps the date the board renders as "Sent"', async () => {
  const e = env(freshDb());
  const row = await create(e);
  const sent = await call(e, 'POST', `/me/engagements/${row.id}/advance`, ada,
    { lane: 'proposed', proposed_at: '2026-08-21' });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.lane, 'proposed');
  assert.equal(sent.body.proposed_at, '2026-08-21');
  // And it is NOT filed as the day the work began — the mislabel migration
  // 238's header refuses.
  assert.equal(sent.body.started_at, null, 'a proposal sent is not a contract started');
});

test('signing stamps a start, opens the first cycle and gives the row an outcome', async () => {
  const e = env(freshDb());
  const row = await sign(e, ada, { term_ends_at: '2026-11-04' });
  assert.equal(row.lane, 'signed');
  assert.ok(row.started_at, 'the term has a start');
  // cycles counts TERMS RUN, including the one in progress — the fixture is
  // explicit ("First cycle ending" at cycles:1), so a first term is 1, not 0.
  assert.equal(row.cycles, 1);
  assert.equal(row.outcome, 'active');
  assert.equal(row.term_ends_at, '2026-11-04');
});

test('a lane correction cannot inflate the cycle count', async () => {
  // renewal_due is a state inside the Signed lane, not a term. Moving in and
  // out of it records no decision, so it must add nothing — otherwise an
  // advisor clicking twice out-earns one who renewed.
  const e = env(freshDb());
  const row = await sign(e);
  for (const lane of ['renewal_due', 'signed', 'renewal_due']) {
    const r = await call(e, 'POST', `/me/engagements/${row.id}/advance`, ada, { lane });
    assert.equal(r.status, 200);
    assert.equal(r.body.cycles, 1, `${lane} must not add a cycle`);
    assert.equal(r.body.outcome, 'active', 'and it records no decision');
  }
});

// ---------------------------------------------------------------------------
// Which rows reach the denominator — the whole point of the store
// ---------------------------------------------------------------------------
test('a signed engagement cannot be ended through the lane verb', async () => {
  const e = env(freshDb());
  const row = await sign(e);
  const r = await call(e, 'POST', `/me/engagements/${row.id}/advance`, ada, { lane: 'ended' });
  assert.equal(r.status, 409);
  // The refusal names the route that does record it, because a 409 that only
  // says no leaves the caller with no way to end a contract at all.
  assert.match(String(r.body.detail), /renewal/);
  const after = await call(e, 'GET', '/me/engagements', ada);
  assert.equal(after.body.items[0].lane, 'signed', 'and nothing moved');
});

test('an abandoned draft ends with no outcome, and stays out of the rate', async () => {
  const e = env(freshDb());
  const draft = await create(e, ada, { client_name: 'Kelp Bio' });
  const ended = await call(e, 'POST', `/me/engagements/${draft.id}/advance`, ada, { lane: 'ended' });
  assert.equal(ended.status, 200, 'an unsigned row may be abandoned here');
  assert.equal(ended.body.lane, 'ended');
  assert.ok(ended.body.ended_at, 'and the day it was abandoned is recorded');
  // THE ASYMMETRY THIS TEST EXISTS FOR. It ended, but it never had a renewal
  // to lose, so it is not a failed renewal.
  assert.equal(ended.body.outcome, null);
  assert.equal(ended.body.cycles, 0);

  const read = await call(e, 'GET', '/me/engagements', ada);
  assert.equal(read.body.totals.ended, 0, 'not counted as a lost renewal');
  assert.equal(read.body.totals.ended_lane, 1, 'but it is in the Ended lane');
  assert.equal(read.body.totals.decided, 0);
  assert.equal(read.body.totals.renewal_rate, null);
});

test('a renewal adds a cycle; ending one records the loss and closes the lane', async () => {
  const e = env(freshDb());
  const row = await sign(e);
  const renewed = await call(e, 'POST', `/me/engagements/${row.id}/renewal`, ada,
    { decision: 'renewed', note: 'Fifth cycle. Longest-running.', term_ends_at: '2027-02-04' });
  assert.equal(renewed.status, 200);
  assert.equal(renewed.body.cycles, 2, 'a renewal starts a term');
  assert.equal(renewed.body.outcome, 'renewed');
  assert.equal(renewed.body.lane, 'signed', 'and it is under contract again');
  assert.equal(renewed.body.renewal_note, 'Fifth cycle. Longest-running.');
  assert.equal(renewed.body.term_ends_at, '2027-02-04');

  const ended = await call(e, 'POST', `/me/engagements/${row.id}/renewal`, ada,
    { decision: 'ended', note: 'Two cycles, then they hired in-house. Good outcome.' });
  assert.equal(ended.status, 200);
  assert.equal(ended.body.lane, 'ended');
  assert.equal(ended.body.outcome, 'ended');
  assert.ok(ended.body.ended_at);
  // Ending does NOT add a cycle: the term that just ran was counted when it
  // began, and counting it twice would reward a contract for failing.
  assert.equal(ended.body.cycles, 2);
});

test('an unsigned engagement has no renewal to decide', async () => {
  const e = env(freshDb());
  const draft = await create(e);
  for (const decision of ['renewed', 'ended']) {
    const r = await call(e, 'POST', `/me/engagements/${draft.id}/renewal`, ada, { decision });
    assert.equal(r.status, 409, decision);
    assert.match(String(r.body.detail), /only a signed engagement/);
  }
  const read = await call(e, 'GET', '/me/engagements', ada);
  assert.equal(read.body.totals.decided, 0, 'and the denominator is untouched');
});

test('an engagement that has ended is terminal on both verbs', async () => {
  const e = env(freshDb());
  const row = await sign(e);
  await call(e, 'POST', `/me/engagements/${row.id}/renewal`, ada, { decision: 'ended' });
  const lane = await call(e, 'POST', `/me/engagements/${row.id}/advance`, ada, { lane: 'signed' });
  assert.equal(lane.status, 409, 'a recorded outcome cannot be quietly un-recorded');
  const again = await call(e, 'POST', `/me/engagements/${row.id}/renewal`, ada, { decision: 'renewed' });
  assert.equal(again.status, 409);
  assert.match(String(again.body.detail), /already ended/);
});

test('the renewal rate counts its failures, and reports nothing before the first decision', async () => {
  const e = env(freshDb());
  // Three that renewed, two that ended — the canvas's own 3-of-5.
  for (const name of ['Meridian Labs', 'Halverton', 'Verwood']) {
    const row = await sign(e, ada, { client_name: name });
    await call(e, 'POST', `/me/engagements/${row.id}/renewal`, ada, { decision: 'renewed' });
  }
  for (const name of ['Solano Health', 'Brackish']) {
    const row = await sign(e, ada, { client_name: name });
    await call(e, 'POST', `/me/engagements/${row.id}/renewal`, ada, { decision: 'ended' });
  }
  // Plus a draft and a signed-but-undecided row, neither of which is a decision.
  await create(e, ada, { client_name: 'Kelp Bio' });
  await sign(e, ada, { client_name: 'Novacraft Labs' });

  const t = (await call(e, 'GET', '/me/engagements', ada)).body.totals;
  assert.equal(t.renewed, 3);
  assert.equal(t.ended, 2, 'the two that ended are in the denominator');
  assert.equal(t.decided, 5);
  assert.equal(t.renewal_rate, 60);

  // And with nothing decided it is NULL rather than 0% — D56/D68. A practice
  // that has not reached a renewal has not failed to renew.
  const blank = env(freshDb());
  await sign(blank, ada);
  assert.equal((await call(blank, 'GET', '/me/engagements', ada)).body.totals.renewal_rate, null);
});

test('Active counts lanes, not outcomes', async () => {
  const e = env(freshDb());
  await create(e, ada, { client_name: 'Kelp Bio' });                        // drafting
  const prop = await create(e, ada, { client_name: 'Aperture' });
  await call(e, 'POST', `/me/engagements/${prop.id}/advance`, ada, { lane: 'proposed' });
  await sign(e, ada, { client_name: 'Meridian Labs', shape: 'retainer' });
  const due = await sign(e, ada, { client_name: 'Novacraft Labs', shape: 'sprint' });
  await call(e, 'POST', `/me/engagements/${due.id}/advance`, ada, { lane: 'renewal_due' });
  await sign(e, ada, { client_name: 'Verwood', shape: 'equity' });
  // THE ROW THAT SEPARATES THE TWO FILTERS, and without it this test passes
  // against a tile that reads `outcome === 'active'`. A contract that has
  // RENEWED is the most active thing on the board and its outcome is
  // 'renewed' — in the canvas's own data three of the five active clients are
  // exactly this, so an outcome filter would report 2 where the tile says 5.
  const renewed = await sign(e, ada, { client_name: 'Halverton', shape: 'retainer' });
  await call(e, 'POST', `/me/engagements/${renewed.id}/renewal`, ada, { decision: 'renewed' });
  // ...and one that ended, which is in neither count.
  const gone = await sign(e, ada, { client_name: 'Solano Health', shape: 'retainer' });
  await call(e, 'POST', `/me/engagements/${gone.id}/renewal`, ada, { decision: 'ended' });

  const t = (await call(e, 'GET', '/me/engagements', ada)).body.totals;
  // The canvas comment, enforced: "A draft that was never sent and a proposal
  // awaiting an answer are not engagements."
  assert.equal(t.active, 4, 'signed and renewal_due only — whatever their outcome');
  assert.equal(t.renewal_due, 1);
  assert.equal(t.ended_lane, 1);
  // The breakdown note the Active tile carries, over the same lane filter: the
  // renewed retainer is in it, the ended one is not.
  assert.deepEqual(t.by_shape, { retainer: 2, sprint: 1, equity: 1, per_call: 0 });
});

// ---------------------------------------------------------------------------
// The PATCH boundary
// ---------------------------------------------------------------------------
test('PATCH edits the description and cannot touch the three columns the rate reads', async () => {
  const e = env(freshDb());
  const row = await sign(e);
  const r = await call(e, 'PATCH', `/me/engagements/${row.id}`, ada, {
    client_name: 'Meridian Labs Inc',
    scope_label: '2 sessions/mo',
    scope_includes: 'Two sessions a month, one written review per cycle.',
    scope_excludes: 'Not in scope: fundraising introductions, board attendance.',
    amount_cents: 1350000,
    shape: 'equity',
    // The three the verbs own. A merge-PATCH that accepted them would let a
    // caller assert a renewal that never happened.
    lane: 'ended', cycles: 99, outcome: 'renewed',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.client_name, 'Meridian Labs Inc');
  assert.equal(r.body.scope_includes, 'Two sessions a month, one written review per cycle.');
  assert.equal(r.body.scope_excludes, 'Not in scope: fundraising introductions, board attendance.');
  assert.equal(r.body.amount_cents, 1350000);
  assert.equal(r.body.shape, 'equity');
  assert.equal(r.body.lane, 'signed', 'lane moves through /advance only');
  assert.equal(r.body.cycles, 1, 'a cycle comes from a term, not from a field');
  assert.equal(r.body.outcome, 'active', 'and an outcome from a decision');
});

test('PATCH merges rather than replaces, and an empty name does not blank a card', async () => {
  const e = env(freshDb());
  const row = await create(e, ada, { scope_label: '2 sessions/mo', amount_cents: 1350000 });
  const r = await call(e, 'PATCH', `/me/engagements/${row.id}`, ada, { client_name: '   ' });
  assert.equal(r.status, 200);
  assert.equal(r.body.client_name, 'Meridian Labs', 'the board edits one field at a time');
  assert.equal(r.body.scope_label, '2 sessions/mo', 'untouched fields survive');
  assert.equal(r.body.amount_cents, 1350000);
});

test('the exclusions are stored as their own text, not folded into the inclusions', async () => {
  // The artboard is explicit: "Exclusions are stored as first-class text, not
  // as an absence." One column for both would lose the half that does the work.
  const e = env(freshDb());
  const row = await create(e, ada, {
    scope_includes: 'Monthly session, quarterly written review.',
    scope_excludes: 'Not in scope: cash invoicing — this one is equity only.',
  });
  assert.equal(row.scope_includes, 'Monthly session, quarterly written review.');
  assert.equal(row.scope_excludes, 'Not in scope: cash invoicing — this one is equity only.');
});

// ---------------------------------------------------------------------------
// Validation, and the vocabulary the CHECK constraints hold
// ---------------------------------------------------------------------------
test('a client name is required and every enumerated value is validated at the route', async () => {
  const e = env(freshDb());
  const noName = await call(e, 'POST', '/me/engagements', ada, { client_name: '  ' });
  assert.equal(noName.status, 400);

  for (const [body, path] of [
    [{ client_name: 'X', shape: 'barter' }, '/me/engagements'],
  ] as const) {
    const r = await call(e, 'POST', path, ada, body);
    assert.equal(r.status, 400, 'an unknown shape is refused before the CHECK sees it');
    assert.match(String(r.body.detail), /shape must be one of/);
  }
  const row = await create(e);
  const badLane = await call(e, 'POST', `/me/engagements/${row.id}/advance`, ada, { lane: 'parked' });
  assert.equal(badLane.status, 400);
  const badDecision = await call(e, 'POST', `/me/engagements/${row.id}/renewal`, ada, { decision: 'maybe' });
  assert.equal(badDecision.status, 400);
});

test('the route vocabularies are exactly the migration CHECK constraints', async () => {
  // DERIVED FROM THE MIGRATION, not copied from it. A value added to one and
  // not the other is either a 400 on a legal state or a 500 on an illegal one,
  // and neither is visible from reading either file alone.
  const sql = migration('238_advisor_engagements');
  // EVERY plain `CHECK (col IN (…))` in the file, read in one pass with one
  // LITERAL regex. Building the pattern per column from an interpolated name
  // was the first shape of this test and Semgrep was right to flag it
  // (`detect-non-literal-regexp`): the repo already fixed one of those on main,
  // and a constructed pattern is not distinguishable by reading from an unsafe
  // one. Reading them all at once is also the stronger test — see the size
  // assertion below.
  const checks = new Map(
    [...sql.replace(/\s+/g, ' ').matchAll(/CHECK \((\w+) IN \(([^)]*)\)/g)]
      .map((m) => [m[1], [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()] as const),
  );
  assert.deepEqual([...ENGAGEMENT_LANES].sort(), checks.get('lane'));
  assert.deepEqual([...ENGAGEMENT_SHAPES].sort(), checks.get('shape'));
  // Exactly two, and `outcome` is deliberately not among them: its CHECK is
  // GUARDED (`outcome IS NULL OR outcome IN …`) because NULL is one of its
  // values, so the pattern above cannot match it. Pinning the count means a
  // third enumerated column cannot be added later with no route validating it.
  assert.equal(checks.size, 2, [...checks.keys()].join(', '));
  assert.match(sql, /CHECK \(outcome IS NULL\s*\n?\s*OR outcome IN \('active', 'renewed', 'ended'\)\)/);
});

test('a malformed date is dropped rather than stored', async () => {
  const e = env(freshDb());
  const row = await create(e, ada, { term_ends_at: 'next November' });
  assert.equal(row.term_ends_at, null, 'a date nobody can compare is not a date');
  const ok = await call(e, 'PATCH', `/me/engagements/${row.id}`, ada, { term_ends_at: '2026-11-04' });
  assert.equal(ok.body.term_ends_at, '2026-11-04');
});

test('the client link is only written when it resolves to a real account', async () => {
  // The client is a NAME first and a user second — migration 238 inverts how
  // `advisor_bookings` keys a counterparty on purpose. A dangling id would
  // make the join to a booking history silently empty.
  const e = env(freshDb());
  const linked = await create(e, ada, { founder_user_id: FOUNDER_USER });
  assert.equal(linked.founder_user_id, FOUNDER_USER);
  const dangling = await create(e, ada, { client_name: 'Halverton', founder_user_id: 99999 });
  assert.equal(dangling.founder_user_id, null, 'and the name still carries the card');
  const cleared = await call(e, 'PATCH', `/me/engagements/${linked.id}`, ada, { founder_user_id: null });
  assert.equal(cleared.body.founder_user_id, null);
});

// ---------------------------------------------------------------------------
// Scope — someone else's engagement does not exist
// ---------------------------------------------------------------------------
test("another advisor's engagement is Not Found on every verb, never Forbidden", async () => {
  const e = env(freshDb());
  const mine = await sign(e, grace, { client_name: 'Thornbury Capital' });
  for (const [method, path, body] of [
    ['PATCH', `/me/engagements/${mine.id}`, { client_name: 'Stolen' }],
    ['POST', `/me/engagements/${mine.id}/advance`, { lane: 'renewal_due' }],
    ['POST', `/me/engagements/${mine.id}/renewal`, { decision: 'ended' }],
  ] as const) {
    const r = await call(e, method, path, ada, body);
    // 404 rather than 403: a 403 confirms to a non-owner that the row exists.
    assert.equal(r.status, 404, `${method} ${path}`);
    assert.match(String(r.body.detail), /not found/i);
  }
  // And it is not readable either — the list is scoped, not filtered on the way out.
  const read = await call(e, 'GET', '/me/engagements', ada);
  assert.deepEqual(read.body.items, []);
  assert.equal(read.body.totals.active, 0);
  // Grace still has hers, so the 404s above are scope and not a broken id.
  assert.equal((await call(e, 'GET', '/me/engagements', grace)).body.items.length, 1);
});

test('an account with no advisor profile cannot reach the store at all', async () => {
  const e = env(freshDb());
  const fran = { user: FOUNDER_USER, role: 'founder' };
  for (const [method, path, body] of [
    ['GET', '/me/engagements', undefined],
    ['POST', '/me/engagements', { client_name: 'X' }],
  ] as const) {
    const r = await call(e, method, path, fran, body);
    assert.equal(r.status, 400, `${method} ${path}`);
    assert.match(String(r.body.detail), /No advisor profile/);
  }
});
