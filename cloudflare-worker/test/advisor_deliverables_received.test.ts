/**
 * The client's half of migration 239 — `GET /received/deliverables` and the
 * receipt.
 *
 * WHAT THIS FILE IS FOR. `advisor_deliverables_scope.test.ts` proves the advisor
 * cannot write `opened_at`; this one proves somebody can, that it is the right
 * somebody, and that the stamp behaves like a receipt rather than a counter.
 * Four things fail silently if they are wrong, and each would corrupt a figure
 * the advisor's page prints as a measurement:
 *
 *   * A FOUNDER SEES ONLY WHAT WAS SENT TO THEM. The scope is
 *     deliverable → engagement → `founder_user_id`, and anyone else's row must be
 *     404 rather than 403 — indistinguishable from one that does not exist.
 *   * A DRAFT IS NOT VISIBLE AND NOT OPENABLE. A version with no `sent_at` is
 *     the advisor's work in progress. If a client could stamp one,
 *     `median_to_open_hours` would be measuring an interval that never happened.
 *   * FIRST OPEN WINS. A founder reloading the page must not move the stamp, so
 *     the guard is `WHERE opened_at IS NULL` in the UPDATE and the second call is
 *     a no-op that returns the original — not a 409, because reading something
 *     twice is not an error.
 *   * THE TWO SIDES AGREE. Opening here must move the advisor's own tiles: the
 *     row's state becomes `opened`, `unopened` falls, and `median_to_open_hours`
 *     stops being null. That round trip is the only proof the receipt is wired to
 *     the thing it is a receipt for.
 *
 * HARNESS. The real router against real in-memory SQLite, tables from the
 * MIGRATION FILES themselves (238 and 239), driven through HTTP as two different
 * people.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import advisors from '../src/routes/advisors.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADVISOR_USER = 80;
const FOUNDER_USER = 81;
const OTHER_FOUNDER = 82;

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
    CREATE TABLE advisor_client_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      project_id INTEGER NOT NULL, advisor_user_id INTEGER NOT NULL,
      granted_by_user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', expires_at TEXT,
      scope_project INTEGER NOT NULL DEFAULT 1,
      scope_data_room INTEGER NOT NULL DEFAULT 0,
      scope_sessions INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(migration('238_advisor_engagements'));
  db.exec(migration('239_advisor_deliverables'));

  const u = db.prepare('INSERT INTO users (id, role, advisor_id, name, email) VALUES (?,?,?,?,?)');
  u.run(ADVISOR_USER, 'advisor', 1, 'Ada', 'ada@example.com');
  u.run(FOUNDER_USER, 'founder', null, 'Fran', 'fran@example.com');
  u.run(OTHER_FOUNDER, 'founder', null, 'Otto', 'otto@example.com');

  db.prepare('INSERT INTO advisors (id, uid, user_id, display_name, email) VALUES (?,?,?,?,?)')
    .run(1, 'adv-1', ADVISOR_USER, 'Ada Lovelace', 'ada@example.com');

  // Both founders have booked Ada, so both are linkable — which is what makes
  // the scope assertions meaningful rather than accidental.
  db.prepare(
    `INSERT INTO advisor_office_hour_slots (id, uid, advisor_id, starts_at, ends_at)
     VALUES (1, 'slot-1', 1, '2026-08-01T10:00:00Z', '2026-08-01T11:00:00Z'),
            (2, 'slot-2', 1, '2026-08-02T10:00:00Z', '2026-08-02T11:00:00Z')`
  ).run();
  const bk = db.prepare(
    `INSERT INTO advisor_bookings (uid, slot_id, advisor_id, founder_user_id, status)
     VALUES (?,?,?,?,'completed')`);
  bk.run('bk-1', 1, 1, FOUNDER_USER);
  bk.run('bk-2', 2, 1, OTHER_FOUNDER);

  // THREE ENGAGEMENTS: Fran's, Otto's, and one that is a name only. The third is
  // what proves an unlinked client reaches nobody's inbox.
  const e = db.prepare(
    `INSERT INTO advisor_engagements (id, uid, advisor_id, founder_user_id, client_name, lane)
     VALUES (?,?,?,?,?,?)`);
  e.run(1, 'eng-fran', 1, FOUNDER_USER, 'Halverton', 'signed');
  e.run(2, 'eng-otto', 1, OTHER_FOUNDER, 'Verwood', 'signed');
  e.run(3, 'eng-name-only', 1, null, 'Kelp Bio', 'signed');

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
  // THROWS when absent, so a deferred-hook guard becomes a 500 in tests only.
  const res = await advisors.request(path, init, e, {
    waitUntil() {}, passThroughOnException() {},
  } as any);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const ada = { user: ADVISOR_USER, role: 'advisor' };
const fran = { user: FOUNDER_USER, role: 'founder' };
const otto = { user: OTHER_FOUNDER, role: 'founder' };

/** One work product on one engagement, with `n` versions, `sent` of them sent. */
async function seed(e: any, engagementId: number, title: string, versions = 1, send = 1) {
  const d = await call(e, 'POST', '/me/deliverables', ada, { title, engagement_id: engagementId });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  for (let i = 2; i <= versions; i += 1) {
    const v = await call(e, 'POST', `/me/deliverables/${d.body.id}/versions`, ada, {});
    assert.equal(v.status, 201, JSON.stringify(v.body));
  }
  for (let i = 1; i <= send; i += 1) {
    const s = await call(e, 'POST', `/me/deliverables/${d.body.id}/versions/${i}/send`, ada);
    assert.equal(s.status, 200, JSON.stringify(s.body));
  }
  return d.body;
}

const received = async (e: any, who = fran) =>
  (await call(e, 'GET', '/received/deliverables', who)).body;
const mine = async (e: any) => (await call(e, 'GET', '/me/deliverables', ada)).body;

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------
test('a founder sees the work products sent under their own engagements, and no others', async () => {
  const e = env(freshDb());
  await seed(e, 1, 'Q2 advisory review');
  await seed(e, 2, "Otto's board brief");

  const forFran = await received(e, fran);
  assert.deepEqual(forFran.items.map((i: any) => i.title), ['Q2 advisory review']);
  const forOtto = await received(e, otto);
  assert.deepEqual(forOtto.items.map((i: any) => i.title), ["Otto's board brief"]);

  // The advisor's own name travels with the row: a founder with three advisors
  // needs to know which one sent a thing.
  assert.equal(forFran.items[0].advisor_name, 'Ada Lovelace');
  assert.equal(forFran.totals.advisors, 1);
  assert.equal(forFran.totals.work_products, 1);
});

test('an unsent version is invisible, and a deliverable with only drafts does not appear', async () => {
  const e = env(freshDb());
  // Two versions, only the first sent.
  const d = await seed(e, 1, 'Pricing tier model', 2, 1);
  // A second work product with nothing sent at all.
  const draftOnly = await call(e, 'POST', '/me/deliverables', ada,
    { title: 'Retention teardown', engagement_id: 1 });
  assert.equal(draftOnly.status, 201);

  const list = await received(e);
  assert.deepEqual(list.items.map((i: any) => i.title), ['Pricing tier model']);
  // The one row carries ONLY the sent version — the client is not reading the
  // advisor's work in progress.
  assert.equal(list.items[0].version_count, 1);
  assert.deepEqual(list.items[0].versions.map((v: any) => v.version), [1]);
  assert.ok(list.items[0].versions.every((v: any) => v.sent_at));
  assert.equal(d.id > 0, true);
});

test('a work product whose client is a name only reaches nobody', async () => {
  const e = env(freshDb());
  // Engagement 3 has no linked account, so the send is refused — which is
  // migration 239's rule and the reason this list can be trusted.
  const d = await call(e, 'POST', '/me/deliverables', ada,
    { title: 'Kelp Bio teardown', engagement_id: 3 });
  assert.equal(d.status, 201);
  const sent = await call(e, 'POST', `/me/deliverables/${d.body.id}/versions/1/send`, ada);
  assert.equal(sent.status, 409);
  assert.equal((await received(e, fran)).items.length, 0);
  assert.equal((await received(e, otto)).items.length, 0);
});

test("someone else's version is 404, never 403", async () => {
  const e = env(freshDb());
  await seed(e, 2, "Otto's board brief");
  const ottoList = await received(e, otto);
  const uid = ottoList.items[0].versions[0].uid;

  const stolen = await call(e, 'POST', `/received/deliverables/${uid}/open`, fran);
  assert.equal(stolen.status, 404, 'a 403 would confirm the row exists');
  assert.match(String(stolen.body.detail), /not found/i);
  // And it really was not stamped.
  assert.equal((await received(e, otto)).items[0].versions[0].opened_at, null);
});

test('the advisor cannot open on the client\'s behalf through this route either', async () => {
  const e = env(freshDb());
  await seed(e, 1, 'Q2 advisory review');
  const uid = (await received(e, fran)).items[0].versions[0].uid;
  // Ada is not the founder on any engagement, so the same join refuses her.
  const asAdvisor = await call(e, 'POST', `/received/deliverables/${uid}/open`, ada);
  assert.equal(asAdvisor.status, 404);
  assert.equal((await received(e, fran)).items[0].versions[0].opened_at, null);
});

// ---------------------------------------------------------------------------
// The receipt
// ---------------------------------------------------------------------------
test('first open wins — a reload cannot move the stamp', async () => {
  const e = env(freshDb());
  await seed(e, 1, 'Q2 advisory review');
  const uid = (await received(e)).items[0].versions[0].uid;

  const first = await call(e, 'POST', `/received/deliverables/${uid}/open`, fran);
  assert.equal(first.status, 200);
  const stamp = first.body.opened_at;
  assert.ok(stamp, 'the first open must stamp');

  const second = await call(e, 'POST', `/received/deliverables/${uid}/open`, fran);
  assert.equal(second.status, 200, 'reading something twice is not an error');
  assert.equal(second.body.opened_at, stamp, 'the receipt is a first-read time, not a last-read one');
});

test('a draft cannot be opened, so the median never measures an interval that did not happen', async () => {
  const e = env(freshDb());
  const d = await seed(e, 1, 'Pricing tier model', 2, 1);
  // v2 exists and was never sent. Its uid is not in the client's payload at all,
  // so take it from the advisor's own view — which is exactly how a hostile
  // client would get one.
  const advisorView = (await mine(e)).items.find((i: any) => i.id === d.id);
  const unsent = advisorView.versions.find((v: any) => v.version === 2);
  assert.equal(unsent.sent_at, null);

  const tried = await call(e, 'POST', `/received/deliverables/${unsent.uid}/open`, fran);
  assert.equal(tried.status, 404);
  const after = (await mine(e)).items.find((i: any) => i.id === d.id);
  assert.equal(after.versions.find((v: any) => v.version === 2).opened_at, null);
});

test('opening moves the advisor\'s own tiles — the two sides agree', async () => {
  const e = env(freshDb());
  await seed(e, 1, 'Q2 advisory review');

  const before = await mine(e);
  assert.equal(before.items[0].state, 'sent');
  assert.equal(before.totals.unopened, 1);
  assert.equal(before.totals.opened, 0);
  assert.equal(before.totals.median_to_open_hours, null,
    'null before the first open — never 0, which would read as "opened instantly"');
  assert.equal(before.totals.never_opened, 1);

  const uid = (await received(e)).items[0].versions[0].uid;
  assert.equal((await call(e, 'POST', `/received/deliverables/${uid}/open`, fran)).status, 200);

  const after = await mine(e);
  assert.equal(after.items[0].state, 'opened');
  assert.equal(after.totals.unopened, 0);
  assert.equal(after.totals.opened, 1);
  assert.equal(after.totals.never_opened, 0);
  assert.ok(after.totals.median_to_open_hours != null,
    'the median becomes a measurement the moment there is something to measure');
  assert.equal(after.totals.oldest_never_opened, null);

  // And the founder's own view agrees about the state it just caused.
  const clientAfter = await received(e);
  assert.equal(clientAfter.items[0].state, 'opened');
  assert.equal(clientAfter.totals.unread, 0);
});

test('the client\'s unread count is its own, not a copy of the advisor\'s', async () => {
  const e = env(freshDb());
  await seed(e, 1, 'Q2 advisory review');
  await seed(e, 1, 'Board brief · Aug');
  await seed(e, 2, "Otto's brief");

  const fransList = await received(e, fran);
  assert.equal(fransList.totals.work_products, 2);
  assert.equal(fransList.totals.unread, 2);

  const uid = fransList.items[0].versions[0].uid;
  await call(e, 'POST', `/received/deliverables/${uid}/open`, fran);
  assert.equal((await received(e, fran)).totals.unread, 1);
  // Otto's own unread count is untouched by Fran reading hers.
  assert.equal((await received(e, otto)).totals.unread, 1);
});

test('a version sent after an earlier one was opened leaves the row opened and lists both', async () => {
  // THE STATE IS OVER ANY VERSION, not the latest — `deliverableState` is shared
  // with the advisor's page, so a two-state copy here would drift from it.
  const e = env(freshDb());
  const d = await seed(e, 1, 'Pricing tier model', 1, 1);
  const uid = (await received(e)).items[0].versions[0].uid;
  await call(e, 'POST', `/received/deliverables/${uid}/open`, fran);

  const v2 = await call(e, 'POST', `/me/deliverables/${d.id}/versions`, ada, {});
  assert.equal(v2.status, 201);
  await call(e, 'POST', `/me/deliverables/${d.id}/versions/2/send`, ada);

  const list = await received(e);
  assert.deepEqual(list.items[0].versions.map((v: any) => v.version), [2, 1], 'newest first');
  assert.equal(list.items[0].state, 'opened');
  assert.equal(list.items[0].versions[0].opened_at, null, 'the new version is unread');
  assert.ok(list.items[0].versions[1].opened_at, 'and the old one keeps its receipt');
});
