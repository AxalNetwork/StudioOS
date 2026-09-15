/**
 * `advisor_deliverables` — migration 239 and the advisor's half of the routes.
 *
 * WHAT THIS FILE IS FOR. The Delivery zone's blurb is "Every work product, every
 * version, and whether anyone opened it", and three of its four tiles are open
 * RECEIPTS. A receipt is only worth drawing if the person who set it is the
 * person who read the thing — so the two assertions that matter most here are
 * about what this side of the product is NOT allowed to do:
 *
 *   * NO ROUTE IN `advisors.ts` WRITES `opened_at`. Migration 208's header
 *     states the rule 239 inherits: "Only the founder side can truthfully say a
 *     thing was read, so a partner-side write to either would be the firm
 *     reporting a metric about itself." This is checked against the SQL in the
 *     file rather than against behaviour, because the failure mode is someone
 *     adding a convenient `SET opened_at = ?` two years from now.
 *   * SENDING REFUSES A CLIENT WITH NO ACCOUNT. A version nobody can open would
 *     sit in `unopened` forever, inflate `never_opened`, and bias
 *     `median_to_open_hours` toward whichever clients happen to be linked. The
 *     409 is what keeps all three honest, and it is the reason the founder side
 *     (PR3c) can be trusted as the only writer.
 *
 * And the ordinary half: the version sequence and its UNIQUE, derived state,
 * and 404-not-403 on every verb.
 *
 * HARNESS. The real router against real in-memory SQLite, with both tables built
 * from the MIGRATION FILES themselves — 238 as well as 239, because a
 * deliverable reaches its client through an engagement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import advisors, { deliverableState } from '../src/routes/advisors.ts';

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
  // Both verbatim from the migrations. If either stops parsing these tests stop
  // running, which is the point.
  db.exec(migration('238_advisor_engagements'));
  db.exec(migration('239_advisor_deliverables'));

  const u = db.prepare('INSERT INTO users (id, role, advisor_id, name, email) VALUES (?,?,?,?,?)');
  u.run(ADVISOR_USER, 'advisor', 1, 'Ada', 'ada@example.com');
  u.run(OTHER_ADVISOR_USER, 'advisor', 2, 'Grace', 'grace@example.com');
  u.run(FOUNDER_USER, 'founder', null, 'Fran', 'fran@example.com');

  const a = db.prepare(
    'INSERT INTO advisors (id, uid, user_id, display_name, email) VALUES (?,?,?,?,?)');
  a.run(1, 'adv-1', ADVISOR_USER, 'Ada', 'ada@example.com');
  a.run(2, 'adv-2', OTHER_ADVISOR_USER, 'Grace', 'grace@example.com');

  // TWO ENGAGEMENTS PER ADVISOR, and the difference between them is the whole
  // send rule: one client has an Axal account, the other is a name only —
  // which migration 238 permits on purpose.
  const e = db.prepare(
    `INSERT INTO advisor_engagements (id, uid, advisor_id, founder_user_id, client_name, lane)
     VALUES (?,?,?,?,?,?)`);
  e.run(1, 'eng-linked', 1, FOUNDER_USER, 'Halverton', 'signed');
  e.run(2, 'eng-unlinked', 1, null, 'Verwood', 'signed');
  e.run(3, 'eng-grace', 2, FOUNDER_USER, 'Thornbury Capital', 'signed');

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

/** Create one work product. Defaults to the LINKED engagement. */
async function create(e: any, who = ada, over: Record<string, unknown> = {}) {
  const r = await call(e, 'POST', '/me/deliverables', who,
    { title: 'Q2 advisory review', engagement_id: 1, ...over });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

const listOf = async (e: any, who = ada) => (await call(e, 'GET', '/me/deliverables', who)).body;

/** What PR3c will do, and what nothing on this side may. */
function clientOpens(db: InstanceType<typeof DatabaseSync>, uid: string, at: string) {
  db.prepare('UPDATE advisor_deliverable_versions SET opened_at = ? WHERE uid = ?').run(at, uid);
}

// ---------------------------------------------------------------------------
// The two invariants
// ---------------------------------------------------------------------------
test('the only writer of opened_at is the client\'s own route', () => {
  // CHECKED AGAINST THE SQL, not against behaviour, because the failure mode is
  // someone adding a convenient `SET opened_at = ?` long after this zone ships.
  // Reading the statements rather than the whole file also sidesteps the
  // self-matching trap: this module's own comments and its DTO name the column
  // constantly, and a blanket ban on the string would fail against correct code.
  //
  // THIS TEST SAID "NO ROUTE IN advisors.ts WRITES opened_at" UNTIL PR3C, and
  // the change is a tightening rather than a concession. The rule was never
  // "nothing in this file writes it" — it is "the ADVISOR cannot write it" — and
  // PR3c put the client's own route in the same router, because the relationship
  // carrying a deliverable is the engagement and no grant is involved. So the
  // file is split at that handler: everything before it is the advisor's side
  // and may not touch either stamp, and the one writer after it must be the
  // founder's route and must be guarded so a reload cannot move the stamp.
  const src = readFileSync(resolve(HERE, '../src/routes/advisors.ts'), 'utf8');
  const CLIENT_ROUTE = "advisors.post('/received/deliverables/:uid/open'";
  const at = src.indexOf(CLIENT_ROUTE);
  assert.ok(at > 0, 'the client\'s open route must exist, or this file has no writer at all');
  const advisorSide = src.slice(0, at);
  const clientSide = src.slice(at);

  const updatesIn = (region: string) =>
    [...region.matchAll(/UPDATE\s+advisor_deliverable_versions\s+SET\s+([^`]*?)WHERE/gs)];

  // The advisor's half: an UPDATE exists (the send), and no stamp that belongs
  // to the client appears in any SET clause.
  const advisorUpdates = updatesIn(advisorSide);
  assert.ok(advisorUpdates.length > 0, 'the send route must still be an UPDATE, or this test is vacuous');
  for (const [, setClause] of advisorUpdates) {
    assert.ok(!/opened_at/.test(setClause),
      `an advisor route sets opened_at: ${setClause.trim().slice(0, 120)}`);
    assert.ok(!/signed_off_at/.test(setClause),
      'signed_off_at is the client\'s too — 208\'s header names both');
  }

  // The client's half: exactly one UPDATE, it sets `opened_at`, and it carries
  // the `opened_at IS NULL` guard that makes first-open-wins a property of the
  // statement rather than of the handler's control flow.
  const clientUpdates = updatesIn(clientSide);
  assert.equal(clientUpdates.length, 1, 'the client side has exactly one write');
  assert.match(clientUpdates[0][1], /opened_at/);
  assert.match(clientSide, /WHERE id = \? AND opened_at IS NULL/,
    'first open wins must be enforced in SQL, not by reading first');
  // AND SIGN-OFF STILL HAS NO WRITER ANYWHERE. 239 carries the column; no
  // artboard draws it and no page renders it, so writing it would be a fact
  // nothing reads.
  for (const [, setClause] of clientUpdates) {
    assert.ok(!/signed_off_at/.test(setClause),
      'nothing sets signed_off_at yet — no surface asks for it');
  }

  const inserts = [...src.matchAll(/INSERT INTO\s+advisor_deliverable_versions\s*\(([^)]*)\)/g)];
  assert.ok(inserts.length > 0);
  for (const [, cols] of inserts) {
    assert.ok(!/opened_at/.test(cols), `a route inserts opened_at: ${cols.trim()}`);
  }
});

test('sending refuses a client with no Axal account, and says what is missing', async () => {
  const e = env(freshDb());
  // The unlinked engagement — a name with no user, which 238 allows on purpose.
  const d = await create(e, ada, { engagement_id: 2, title: 'Board brief' });
  const sent = await call(e, 'POST', `/me/deliverables/${d.id}/versions/1/send`, ada);
  assert.equal(sent.status, 409);
  assert.match(String(sent.body.detail), /Axal account/);
  // The reason names the consequence, not just the rule.
  assert.match(String(sent.body.detail), /opened/);
  // ...and nothing moved.
  const list = await listOf(e);
  assert.equal(list.items[0].state, 'not_started');
  assert.equal(list.items[0].latest_version.sent_at, null);
  assert.equal(list.totals.unopened, 0, 'an unsendable row must not reach the receipt tiles');
});

test('a deliverable with no engagement at all cannot be sent either', async () => {
  const e = env(freshDb());
  const d = await create(e, ada, { engagement_id: null, client_name: 'Kelp Bio' });
  assert.equal(d.engagement_id, null);
  const sent = await call(e, 'POST', `/me/deliverables/${d.id}/versions/1/send`, ada);
  assert.equal(sent.status, 409);
});

test('creating and versioning stay open to an unlinked client — only the send is gated', async () => {
  // The draft half of the zone must keep working for a client who is a name.
  // Gating creation too would make the store unusable for the rows the artboard
  // actually draws.
  const e = env(freshDb());
  const d = await create(e, ada, { engagement_id: 2, title: 'Board brief' });
  const v2 = await call(e, 'POST', `/me/deliverables/${d.id}/versions`, ada,
    { summary: 'Second pass', label: 'v2 draft' });
  assert.equal(v2.status, 201);
  assert.equal(v2.body.version, 2);
  assert.equal(v2.body.label, 'v2 draft');
});

// ---------------------------------------------------------------------------
// The lifecycle
// ---------------------------------------------------------------------------
test('a work product is born with version 1 and nothing sent', async () => {
  const e = env(freshDb());
  const d = await create(e);
  assert.equal(d.state, 'not_started');
  assert.equal(d.version_count, 1);
  const list = await listOf(e);
  const [item] = list.items;
  assert.equal(item.version_count, 1);
  assert.equal(item.latest_version.version, 1);
  assert.equal(item.latest_version.sent_at, null);
  assert.equal(item.latest_version.opened_at, null);
  assert.equal(item.state, 'not_started');
  // The client came from the engagement, so the two cannot disagree about who
  // this is for.
  assert.equal(item.client_name, 'Halverton');
  assert.equal(item.client_user_id, FOUNDER_USER);
  assert.equal(item.client_user_email, 'fran@example.com');
});

test('a typed client name is overridden by the engagement it is linked to', async () => {
  const e = env(freshDb());
  const d = await create(e, ada, { engagement_id: 1, client_name: 'Something Else' });
  assert.equal(d.client_name, 'Halverton', 'the contract is the authority on the client');
});

test('versions are a sequence, and the ordinal is never reused', async () => {
  const e = env(freshDb());
  const d = await create(e);
  for (const expected of [2, 3, 4]) {
    const r = await call(e, 'POST', `/me/deliverables/${d.id}/versions`, ada,
      { summary: `Pass ${expected}` });
    assert.equal(r.status, 201);
    assert.equal(r.body.version, expected);
  }
  const list = await listOf(e);
  const [item] = list.items;
  assert.equal(item.version_count, 4);
  // Newest first, which is the order the trail card draws.
  assert.deepEqual(item.versions.map((v: any) => v.version), [4, 3, 2, 1]);
  assert.equal(item.latest_version.version, 4);
});

test('sending stamps the version and refuses a second send of the same one', async () => {
  const e = env(freshDb());
  const d = await create(e);
  const sent = await call(e, 'POST', `/me/deliverables/${d.id}/versions/1/send`, ada);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.ok(sent.body.sent_at);
  assert.equal(sent.body.opened_at, null, 'sending is not opening');

  const again = await call(e, 'POST', `/me/deliverables/${d.id}/versions/1/send`, ada);
  assert.equal(again.status, 409, 'a sent date is a fact, not something to overwrite');

  const missing = await call(e, 'POST', `/me/deliverables/${d.id}/versions/9/send`, ada);
  assert.equal(missing.status, 404);
});

test('state is derived from the stamps and there is no column for it', async () => {
  const db = freshDb();
  const e = env(db);
  const d = await create(e);
  assert.equal((await listOf(e)).items[0].state, 'not_started');

  await call(e, 'POST', `/me/deliverables/${d.id}/versions/1/send`, ada);
  assert.equal((await listOf(e)).items[0].state, 'sent');

  const uid = (await listOf(e)).items[0].latest_version.uid;
  clientOpens(db, uid, '2026-09-12T09:00:00.000Z');
  assert.equal((await listOf(e)).items[0].state, 'opened');

  // And the migration really does not carry one, so nothing can drift.
  const sql = migration('239_advisor_deliverables');
  assert.ok(!/^\s*state\s+TEXT/m.test(sql), 'a stored state is a second source of truth');
  // The pure helper agrees with the endpoint, in all three directions.
  assert.equal(deliverableState([]), 'not_started');
  assert.equal(deliverableState([{ sent_at: 'x', opened_at: null }]), 'sent');
  assert.equal(deliverableState([{ sent_at: 'x', opened_at: 'y' }]), 'opened');
  assert.equal(deliverableState([{ sent_at: null, opened_at: null }, { sent_at: 'x', opened_at: 'y' }]),
    'opened', 'one opened version is enough — the work product was read');
});

// ---------------------------------------------------------------------------
// The receipts
// ---------------------------------------------------------------------------
test('the median to open is null before any open, and a real measurement after', async () => {
  const db = freshDb();
  const e = env(db);
  // Three deliverables, all sent. Two get opened, at 2 h and 6 h.
  const made = [];
  for (const title of ['A', 'B', 'C']) {
    const d = await create(e, ada, { title });
    await call(e, 'POST', `/me/deliverables/${d.id}/versions/1/send`, ada);
    made.push(d);
  }
  let t = await listOf(e);
  assert.equal(t.totals.median_to_open_hours, null, 'nothing opened is not "opened instantly"');
  assert.equal(t.totals.unopened, 3);

  const uidOf = (title: string) => t.items.find((i: any) => i.title === title).latest_version.uid;
  const sentOf = (title: string) => t.items.find((i: any) => i.title === title).latest_version.sent_at;
  db.prepare('UPDATE advisor_deliverable_versions SET sent_at = ? WHERE uid = ?')
    .run('2026-09-12T00:00:00.000Z', uidOf('A'));
  db.prepare('UPDATE advisor_deliverable_versions SET sent_at = ? WHERE uid = ?')
    .run('2026-09-12T00:00:00.000Z', uidOf('B'));
  assert.ok(sentOf('C'), 'C stays sent-but-unopened');
  clientOpens(db, uidOf('A'), '2026-09-12T02:00:00.000Z');
  clientOpens(db, uidOf('B'), '2026-09-12T06:00:00.000Z');

  t = await listOf(e);
  assert.equal(t.totals.median_to_open_hours, 4, 'the mean of the two middle values of {2, 6}');
  assert.equal(t.totals.unopened, 1);
  assert.equal(t.totals.opened, 2);
});

test('the median measures the FIRST open of a work product, not the latest', async () => {
  // A second version read a month later says nothing about how fast the work
  // reached its reader, and letting it win would make the tile drift upward
  // every time a client revisits an old deliverable. Two opened versions on one
  // work product is the only shape that can tell the two readings apart, which
  // is why this is its own test rather than a line in the one above.
  const db = freshDb();
  const e = env(db);
  const d = await create(e, ada, { title: 'Pricing tier model' });
  await call(e, 'POST', `/me/deliverables/${d.id}/versions/1/send`, ada);
  await call(e, 'POST', `/me/deliverables/${d.id}/versions`, ada, { summary: 'Second pass' });
  await call(e, 'POST', `/me/deliverables/${d.id}/versions/2/send`, ada);

  const t0 = await listOf(e);
  const v = (n: number) => t0.items[0].versions.find((x: any) => x.version === n).uid;
  const set = (uid: string, sent: string, opened: string) => {
    db.prepare('UPDATE advisor_deliverable_versions SET sent_at = ?, opened_at = ? WHERE uid = ?')
      .run(sent, opened, uid);
  };
  // v1: read after ONE hour. v2: read after TWENTY.
  set(v(1), '2026-09-01T00:00:00.000Z', '2026-09-01T01:00:00.000Z');
  set(v(2), '2026-09-10T00:00:00.000Z', '2026-09-10T20:00:00.000Z');

  const t = await listOf(e);
  assert.equal(t.totals.median_to_open_hours, 1,
    'the first open is the measurement; the later re-read must not replace it');
});

test('a reversed pair of stamps is dropped rather than counted as negative time', async () => {
  // Clock skew and a bad backfill both produce `opened_at < sent_at`. A negative
  // duration in the set would pull the median below zero, and a tile reading
  // "-3 h to open" is worse than one reading nothing.
  const db = freshDb();
  const e = env(db);
  const bad = await create(e, ada, { title: 'Reversed' });
  await call(e, 'POST', `/me/deliverables/${bad.id}/versions/1/send`, ada);
  const t0 = await listOf(e);
  db.prepare('UPDATE advisor_deliverable_versions SET sent_at = ?, opened_at = ? WHERE uid = ?')
    .run('2026-09-10T12:00:00.000Z', '2026-09-10T09:00:00.000Z', t0.items[0].latest_version.uid);

  const t = await listOf(e);
  assert.equal(t.totals.opened, 1, 'it still counts as opened — the stamp exists');
  assert.equal(t.totals.median_to_open_hours, null,
    'but it contributes no duration, so the median reports nothing rather than a negative');
});

test('an unopened row can lose its address, which is why addressable is its own number', async () => {
  // The send rule means every row is addressable AT THE MOMENT IT IS SENT, so
  // `unopened` and `addressable` are equal in the ordinary case — and that is
  // exactly what makes this gap invisible without staging the unordinary one.
  // Unlinking the engagement after a send leaves a row that went out and can
  // never be nudged, and the tile has to be able to say so.
  const e = env(freshDb());
  const d = await create(e, ada, { engagement_id: 1, title: 'Sent then unlinked' });
  await call(e, 'POST', `/me/deliverables/${d.id}/versions/1/send`, ada);
  const before = await listOf(e);
  assert.equal(before.totals.unopened, 1);
  assert.equal(before.totals.addressable, 1);

  const unlinked = await call(e, 'PATCH', `/me/deliverables/${d.id}`, ada, { engagement_id: null });
  assert.equal(unlinked.status, 200);

  const after = await listOf(e);
  assert.equal(after.totals.unopened, 1, 'it was still sent and still unread');
  assert.equal(after.totals.addressable, 0, 'but nothing can reach the client any more');
  assert.equal(after.items[0].client_user_email, null);
});

test('the table refuses two versions with the same ordinal', () => {
  // The route reads MAX(version) + 1, so a duplicate can only arrive through a
  // lost race that a single-threaded test cannot stage. The constraint is
  // therefore asserted directly against the schema the migration builds — which
  // is the only place the protection actually lives.
  const db = freshDb();
  db.prepare(`INSERT INTO advisor_deliverables (uid, advisor_id, client_name, title)
              VALUES ('d-race', 1, 'Halverton', 'Q2 review')`).run();
  const id = Number(db.prepare("SELECT id FROM advisor_deliverables WHERE uid = 'd-race'").get().id);
  const insert = (uid: string, version: number) => db.prepare(
    'INSERT INTO advisor_deliverable_versions (uid, deliverable_id, version) VALUES (?, ?, ?)',
  ).run(uid, id, version);
  insert('r1', 1);
  assert.throws(() => insert('r1-dup', 1), /UNIQUE|constraint/i,
    'two rows both calling themselves v1 is the race this constraint exists for');
  // A different work product may of course have its own v1.
  db.prepare(`INSERT INTO advisor_deliverables (uid, advisor_id, client_name, title)
              VALUES ('d-other', 1, 'Verwood', 'Board brief')`).run();
  const other = Number(db.prepare("SELECT id FROM advisor_deliverables WHERE uid = 'd-other'").get().id);
  db.prepare('INSERT INTO advisor_deliverable_versions (uid, deliverable_id, version) VALUES (?, ?, 1)')
    .run('o1', other);
  // And version 0 is not a version.
  assert.throws(() => insert('r0', 0), /CHECK|constraint/i);
});

test('never opened excludes anything that was ever opened, and names the oldest', async () => {
  const db = freshDb();
  const e = env(db);
  const older = await create(e, ada, { title: 'Board brief' });
  const newer = await create(e, ada, { title: 'Packaging teardown' });
  const read = await create(e, ada, { title: 'Q2 review' });
  for (const d of [older, newer, read]) {
    await call(e, 'POST', `/me/deliverables/${d.id}/versions/1/send`, ada);
  }
  let t = await listOf(e);
  const uidOf = (title: string) => t.items.find((i: any) => i.title === title).latest_version.uid;
  db.prepare('UPDATE advisor_deliverable_versions SET sent_at = ? WHERE uid = ?')
    .run('2026-08-22T00:00:00.000Z', uidOf('Board brief'));
  db.prepare('UPDATE advisor_deliverable_versions SET sent_at = ? WHERE uid = ?')
    .run('2026-09-01T00:00:00.000Z', uidOf('Packaging teardown'));
  clientOpens(db, uidOf('Q2 review'), '2026-09-02T00:00:00.000Z');

  t = await listOf(e);
  assert.equal(t.totals.never_opened, 2);
  assert.equal(t.totals.oldest_never_opened.title, 'Board brief',
    'the tile note names the one that has waited longest');
  assert.equal(t.totals.oldest_never_opened.sent_at, '2026-08-22T00:00:00.000Z');
  // A deliverable with an OPENED version is out, even though it also has unsent
  // ones — the work product was read.
  await call(e, 'POST', `/me/deliverables/${read.id}/versions`, ada, { summary: 'v2' });
  t = await listOf(e);
  assert.equal(t.totals.never_opened, 2, 'a later unsent version does not un-read a deliverable');
});

test('the addressable count reports how many rows a nudge could actually reach', async () => {
  // The zone reports the gap rather than skipping rows quietly — and because
  // sending requires a linked client, this should equal `unopened` in practice.
  // Asserting both together is what would catch the two drifting apart.
  const e = env(freshDb());
  const linked = await create(e, ada, { engagement_id: 1, title: 'Sent one' });
  await call(e, 'POST', `/me/deliverables/${linked.id}/versions/1/send`, ada);
  await create(e, ada, { engagement_id: 2, title: 'Unsendable' });
  const t = await listOf(e);
  assert.equal(t.totals.unopened, 1);
  assert.equal(t.totals.addressable, 1);
  assert.equal(t.totals.drafts, 1, 'the unsendable one is a draft, not an unopened send');
});

test('the totals count work products and their distinct clients', async () => {
  const e = env(freshDb());
  await create(e, ada, { engagement_id: 1, title: 'One' });
  await create(e, ada, { engagement_id: 1, title: 'Two' });
  await create(e, ada, { engagement_id: 2, title: 'Three' });
  const t = await listOf(e);
  assert.equal(t.totals.work_products, 3);
  assert.equal(t.totals.clients, 2, 'Halverton and Verwood');
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------
test("another advisor's deliverable is Not Found on every verb, never Forbidden", async () => {
  const e = env(freshDb());
  const hers = await create(e, grace, { engagement_id: 3, title: 'Diligence memo' });
  for (const [method, path, body] of [
    ['PATCH', `/me/deliverables/${hers.id}`, { title: 'Stolen' }],
    ['POST', `/me/deliverables/${hers.id}/versions`, { summary: 'x' }],
    ['POST', `/me/deliverables/${hers.id}/versions/1/send`, undefined],
  ] as const) {
    const r = await call(e, method, path, ada, body);
    // 404 rather than 403: a 403 confirms to a non-owner that the row exists.
    assert.equal(r.status, 404, `${method} ${path}`);
    assert.match(String(r.body.detail), /not found/i);
  }
  const mine = await listOf(e, ada);
  assert.deepEqual(mine.items, []);
  assert.equal(mine.totals.work_products, 0);
  // Grace still has hers, so the 404s are scope and not a broken id.
  assert.equal((await listOf(e, grace)).items.length, 1);
});

test('a deliverable cannot be linked to another advisor\'s engagement', async () => {
  // The engagement link goes through `requireOwnEngagement`, so borrowing
  // someone else's contract is Not Found rather than a cross-advisor row.
  const e = env(freshDb());
  const r = await call(e, 'POST', '/me/deliverables', ada, { title: 'X', engagement_id: 3 });
  assert.equal(r.status, 404);
  const moved = await create(e);
  const patched = await call(e, 'PATCH', `/me/deliverables/${moved.id}`, ada, { engagement_id: 3 });
  assert.equal(patched.status, 404);
});

test('a work product needs a title and a client', async () => {
  const e = env(freshDb());
  const noTitle = await call(e, 'POST', '/me/deliverables', ada, { title: '  ', engagement_id: 1 });
  assert.equal(noTitle.status, 400);
  assert.match(String(noTitle.body.detail), /title/);
  const noClient = await call(e, 'POST', '/me/deliverables', ada, { title: 'X' });
  assert.equal(noClient.status, 400);
  assert.match(String(noClient.body.detail), /client/);
});

test('an account with no advisor profile cannot reach the store at all', async () => {
  const e = env(freshDb());
  const fran = { user: FOUNDER_USER, role: 'founder' };
  for (const [method, path, body] of [
    ['GET', '/me/deliverables', undefined],
    ['POST', '/me/deliverables', { title: 'X', client_name: 'Y' }],
  ] as const) {
    const r = await call(e, method, path, fran, body);
    assert.equal(r.status, 400, `${method} ${path}`);
    assert.match(String(r.body.detail), /No advisor profile/);
  }
});
