/**
 * #5314 part 3 (D4822) — every Delivery edit states the version it was read
 * at, and a stale one answers 409 and changes nothing.
 *
 * One case per kind of write the Delivery page makes:
 *   - a child record's PATCH (milestone, blocker, deliverable, seat scope),
 *   - a child record's DELETE (the revision travels in the query),
 *   - a state change (seat revoke, report send, report delete),
 *   - each upsert keyed by a natural key (health, capacity cap, internal hours,
 *     client hours), where `expected_revision: null` means "I read no row".
 * For each: a stale write is 409 `delivery_changed` with the current version,
 * and the row is byte-for-byte what it was; a fresh write succeeds and bumps.
 *
 * HARNESS. Copied from `partner_delivery_routes.test.ts`: the real router
 * against in-memory SQLite, tables built from the migration files.
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
let hook: { re: RegExp; fn: () => void } | null = null;
/** As `delivery_concurrency_4682.test.ts`: run `fn` once, right after the next
 * read whose SQL matches `re` — another request that completed between this
 * request's read and its write. */
function after(re: RegExp, fn: () => void) { hook = { re, fn }; }
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const fire = (sql: string) => {
    if (hook && hook.re.test(sql)) { const h = hook; hook = null; h.fn(); }
  };
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { const r = db.prepare(sql).get(...b) ?? null; fire(sql); return r; },
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
    -- #4673: an engagement's founder_id is a FOUNDER PROFILE (founders.id), and the client's name is
    -- read from it. These fixtures keep the founder's id equal to the user's (FOUNDER_USER) on purpose;
    -- partner_delivery_report_access_4673.test.ts proves the two apart.
    CREATE TABLE founders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, name TEXT NOT NULL, email TEXT
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
  db.exec(migration('202611072115_delivery_revisions'));
  // APPLIED, NOT MIRRORED. The two capacity stores are read by `/capacity` and
  // written by its two `PUT`s, so the harness runs their migration files for
  // the same reason it runs 208's: a hand-copied DDL that drifts from the file
  // makes every assertion below true of a schema production does not have.
  db.exec(migration('230_partner_capacity'));
  db.exec(migration('231_partner_internal_hours'));
  db.exec(migration('232_partner_engagement_health'));
  // #5314 part 3: the revisions on health, caps, internal and client hours.
  db.exec(migration('202611111141_5314_delivery_write_versions'));

  const u = db.prepare('INSERT INTO users (id, role, partner_id, name, email) VALUES (?,?,?,?,?)');
  u.run(OURS_USER, 'partner', 1, 'Ours', 'ours@example.com');
  u.run(OUR_STAFF, 'partner', 1, 'Sam', 'sam@example.com');
  u.run(THEIRS_USER, 'partner', 2, 'Theirs', 'theirs@example.com');
  u.run(THEIR_STAFF, 'partner', 2, 'Robin', 'robin@example.com');
  u.run(FOUNDER_USER, 'founder', null, 'Fran', 'fran@example.com');
  db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(FOUNDER_USER, 'Fran', 'fran@example.com');

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
// #5314 part 3
// ---------------------------------------------------------------------------

function setup() {
  const db = freshDb();
  return { db, e: env(db) };
}
const one = (db: any, sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;

/** The refusal every stale write must give: 409, the code, and the version now. */
function assertStale(r: { status: number; body: any }, now: number | null) {
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, 'delivery_changed');
  assert.equal(r.body.current_version, now);
  assert.equal(r.body.revision, now);
}

test('#5314: a milestone edit states its revision; a stale one is 409 and changes nothing', async () => {
  const { db, e } = setup();
  const m = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/milestones`, ours, { title: 'Cutover' })).body;
  const listed = (await call(e, 'GET', `/engagements/${OUR_ENGAGEMENT}/milestones`, ours)).body.items[0];
  assert.equal(listed.revision, 0, 'the read hands back the revision an edit must state');

  const first = await call(e, 'PATCH', `/milestones/${m.id}`, ours, { title: 'Cutover A', expected_revision: 0 });
  assert.equal(first.status, 200);
  assert.equal(first.body.revision, 1);

  // A second person read revision 0 too, and saves after the first.
  const stale = await call(e, 'PATCH', `/milestones/${m.id}`, ours, { title: 'Cutover B', expected_revision: 0 });
  assertStale(stale, 1);
  const kept = one(db, 'SELECT title, revision FROM engagement_milestones WHERE id = ?', m.id);
  assert.deepEqual([kept.title, kept.revision], ['Cutover A', 1]);
});

test('#5314: a delete names the revision in its query; a stale one keeps the record', async () => {
  const { db, e } = setup();
  const m = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/milestones`, ours, { title: 'Cutover' })).body;
  await call(e, 'PATCH', `/milestones/${m.id}`, ours, { title: 'Moved', expected_revision: 0 });

  assertStale(await call(e, 'DELETE', `/milestones/${m.id}?expected_revision=0`, ours), 1);
  assert.ok(one(db, 'SELECT id FROM engagement_milestones WHERE id = ?', m.id), 'a stale delete removed the milestone');

  const ok = await call(e, 'DELETE', `/milestones/${m.id}?expected_revision=1`, ours);
  assert.equal(ok.status, 200);
  assert.equal(one(db, 'SELECT id FROM engagement_milestones WHERE id = ?', m.id), undefined);
});

test('#5314: blockers and deliverables refuse a stale edit and a stale delete', async () => {
  const { db, e } = setup();
  const b = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/blockers`, ours, { summary: 'Waiting', side: 'client' })).body;
  assert.equal(b.revision, 0);
  assert.equal((await call(e, 'PATCH', `/blockers/${b.id}`, ours, { cleared_at: past(0), expected_revision: 0 })).status, 200);
  assertStale(await call(e, 'PATCH', `/blockers/${b.id}`, ours, { cleared_at: null, expected_revision: 0 }), 1);
  assert.ok(one(db, 'SELECT cleared_at FROM engagement_blockers WHERE id = ?', b.id).cleared_at, 'a stale reopen undid the clear');
  assertStale(await call(e, 'DELETE', `/blockers/${b.id}?expected_revision=0`, ours), 1);
  assert.ok(one(db, 'SELECT id FROM engagement_blockers WHERE id = ?', b.id));

  const d = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours, { title: 'Spec' })).body;
  assert.equal(d.revision, 0);
  const listed = (await call(e, 'GET', '/deliverables', ours)).body.items.find((x: any) => x.id === d.id);
  assert.equal(listed.revision, 0);
  assert.equal((await call(e, 'PATCH', `/deliverables/${d.id}`, ours, { version: 'v2', expected_revision: 0 })).status, 200);
  assertStale(await call(e, 'PATCH', `/deliverables/${d.id}`, ours, { version: 'v1', expected_revision: 0 }), 1);
  assert.equal(one(db, 'SELECT version FROM engagement_deliverables WHERE id = ?', d.id).version, 'v2');
  assertStale(await call(e, 'DELETE', `/deliverables/${d.id}?expected_revision=0`, ours), 1);
  assert.ok(one(db, 'SELECT id FROM engagement_deliverables WHERE id = ?', d.id));
});

test('#5314: a seat scope edit and a revoke state the revision; a stale revoke leaves the seat live', async () => {
  const { db, e } = setup();
  const s = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/seats`, ours, { holder_user_id: OUR_STAFF, scope: 'Board' })).body;
  assert.equal(s.revision, 0);
  const listed = (await call(e, 'GET', '/capacity', ours)).body.seats.find((x: any) => x.id === s.id);
  assert.equal(listed.revision, 0);

  assert.equal((await call(e, 'PATCH', `/seats/${s.id}`, ours, { scope: 'Board, KPIs', expected_revision: 0 })).status, 200);
  assertStale(await call(e, 'PATCH', `/seats/${s.id}`, ours, { scope: 'Roadmap', expected_revision: 0 }), 1);
  assert.equal(one(db, 'SELECT scope FROM engagement_seats WHERE id = ?', s.id).scope, 'Board, KPIs');

  assertStale(await call(e, 'POST', `/seats/${s.id}/revoke`, ours, { expected_revision: 0 }), 1);
  assert.equal(one(db, 'SELECT revoked_at FROM engagement_seats WHERE id = ?', s.id).revoked_at, null);
  const ok = await call(e, 'POST', `/seats/${s.id}/revoke`, ours, { expected_revision: 1 });
  assert.equal(ok.status, 200);
  assert.ok(one(db, 'SELECT revoked_at FROM engagement_seats WHERE id = ?', s.id).revoked_at);
});

test('#5314: a status report edit, send and delete each refuse a stale revision', async () => {
  const { db, e } = setup();
  const p = nowPeriod();
  const base = { engagement_id: OUR_ENGAGEMENT, period: p };
  const saved = (await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/${p}`, ours, {
    ...base, shipped: 'One', expected_revision: null,
  })).body;
  assert.equal(saved.revision, 0);
  // A second first-save that read no report: one exists now.
  assertStale(await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/${p}`, ours, {
    ...base, shipped: 'Other', expected_revision: null,
  }), 0);

  assert.equal((await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/${p}`, ours, {
    ...base, shipped: 'Two', expected_revision: 0,
  })).status, 200);
  assertStale(await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/${p}`, ours, {
    ...base, shipped: 'Stale', expected_revision: 0,
  }), 1);
  assertStale(await call(e, 'POST', `/status-reports/${saved.id}/send`, ours, { expected_revision: 0 }), 1);
  assertStale(await call(e, 'DELETE', `/status-reports/${saved.id}?expected_revision=0`, ours), 1);
  const row = one(db, 'SELECT shipped, state, revision FROM engagement_status_reports WHERE id = ?', saved.id);
  assert.deepEqual([row.shipped, row.state, row.revision], ['Two', 'draft', 1]);
});

test('#5314: the health statement is created once from "no row", then edited only at its revision', async () => {
  const { db, e } = setup();
  const before = (await call(e, 'GET', '/health', ours)).body.items[0];
  assert.equal(before.health_revision, null, 'nothing stated reads null, not 0');

  const first = await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/health`, ours, { scope_state: 'within', expected_revision: null });
  assert.equal(first.status, 200);
  assert.equal(first.body.revision, 0);
  // Someone else also read "nothing stated" and saves second.
  assertStale(await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/health`, ours, { scope_state: 'drift', expected_revision: null }), 0);

  const edit = await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/health`, ours, { scope_state: 'drift', scope_note: 'New module', expected_revision: 0 });
  assert.equal(edit.body.revision, 1);
  assertStale(await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/health`, ours, { scope_state: 'within', expected_revision: 0 }), 1);
  const row = one(db, 'SELECT scope_state, revision FROM partner_engagement_health WHERE engagement_id = ?', OUR_ENGAGEMENT);
  assert.deepEqual([row.scope_state, row.revision], ['drift', 1]);
  assert.equal((await call(e, 'GET', '/health', ours)).body.items[0].health_revision, 1);
});

test('#5314: a capacity cap is set, edited and cleared only at the revision read', async () => {
  const { db, e } = setup();
  assert.equal((await call(e, 'GET', '/capacity', ours)).body.cap_revision, null);
  assert.equal((await call(e, 'PUT', '/capacity/cap', ours, { weekly_hours: 38, expected_revision: null })).body.revision, 0);
  assertStale(await call(e, 'PUT', '/capacity/cap', ours, { weekly_hours: 40, expected_revision: null }), 0);
  assert.equal((await call(e, 'PUT', '/capacity/cap', ours, { weekly_hours: 36, expected_revision: 0 })).body.revision, 1);
  // A stale clear keeps the cap someone has since changed.
  assertStale(await call(e, 'PUT', '/capacity/cap', ours, { weekly_hours: null, expected_revision: 0 }), 1);
  assert.equal(one(db, 'SELECT weekly_hours FROM partner_capacity WHERE partner_id = 1 AND person_user_id IS NULL').weekly_hours, 36);
  assert.equal((await call(e, 'GET', '/capacity', ours)).body.cap_revision, 1);

  // A person's own cap carries its own revision on the person's row.
  await call(e, 'PUT', '/capacity/cap', ours, { person_user_id: OUR_STAFF, weekly_hours: 20, expected_revision: null });
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/${nowPeriod()}`, ours, { hours: 4, expected_revision: null });
  const person = (await call(e, 'GET', '/capacity', ours)).body.people.find((x: any) => x.user_id === OUR_STAFF);
  assert.equal(person.cap_revision, 0);

  assert.equal((await call(e, 'PUT', '/capacity/cap', ours, { weekly_hours: null, expected_revision: 1 })).status, 200);
  assert.equal(one(db, 'SELECT id FROM partner_capacity WHERE partner_id = 1 AND person_user_id IS NULL'), undefined);
});

test('#5314: internal hours and client hours refuse a stale write and a stale removal', async () => {
  const { db, e } = setup();
  const p = nowPeriod();
  const put = (b: any) => call(e, 'PUT', '/capacity/internal-hours', ours, { person_user_id: OUR_STAFF, period: p, ...b });
  assert.equal((await put({ hours: 10, expected_revision: null })).body.revision, 0);
  assertStale(await put({ hours: 12, expected_revision: null }), 0);
  assert.equal((await put({ hours: 14, expected_revision: 0 })).body.revision, 1);
  assertStale(await put({ hours: null, expected_revision: 0 }), 1);
  assert.equal(one(db, 'SELECT hours FROM partner_internal_hours WHERE person_user_id = ?', OUR_STAFF).hours, 14);
  const person = (await call(e, 'GET', '/capacity', ours)).body.people.find((x: any) => x.user_id === OUR_STAFF);
  assert.equal(person.internal_revision, 1);

  const path = `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/${p}`;
  assert.equal((await call(e, 'PUT', path, ours, { hours: 6, expected_revision: null })).body.revision, 0);
  assertStale(await call(e, 'PUT', path, ours, { hours: 9, expected_revision: null }), 0);
  assert.equal((await call(e, 'PUT', path, ours, { hours: 8, expected_revision: 0 })).body.revision, 1);
  const entries = (await call(e, 'GET', `/capacity/hours?period=${p}`, ours)).body.entries;
  assert.equal(entries[0].revisions[p], 1);
  assertStale(await call(e, 'DELETE', `${path}?expected_revision=0`, ours), 1);
  assert.equal(one(db, 'SELECT hours FROM engagement_hours WHERE person_user_id = ?', OUR_STAFF).hours, 8);
  assert.equal((await call(e, 'DELETE', `${path}?expected_revision=1`, ours)).status, 200);
});

test('#5314: a malformed expected_revision is refused, never read as "said nothing"', async () => {
  const { e } = setup();
  const m = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/milestones`, ours, { title: 'Cutover' })).body;
  for (const bad of ['', 'abc', -1, 1.5, true]) {
    const r = await call(e, 'PATCH', `/milestones/${m.id}`, ours, { title: 'x', expected_revision: bad });
    assert.equal(r.status, 400, `expected_revision ${JSON.stringify(bad)} was accepted`);
    assert.equal(r.body.code, 'bad_expected_revision');
  }
  assert.equal((await call(e, 'DELETE', `/milestones/${m.id}?expected_revision=abc`, ours)).status, 400);
});

test('#5314: a write that states no revision (a page from before this build) keeps the D4682 guard', async () => {
  const { e } = setup();
  const m = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/milestones`, ours, { title: 'Cutover' })).body;
  const r = await call(e, 'PATCH', `/milestones/${m.id}`, ours, { title: 'Moved' });
  assert.equal(r.status, 200);
  assert.equal(r.body.revision, 1);
  const cap = await call(e, 'PUT', '/capacity/cap', ours, { weekly_hours: 38 });
  assert.equal(cap.status, 200);
  assert.equal((await call(e, 'PUT', '/capacity/cap', ours, { weekly_hours: 40 })).body.revision, 1);
});

test('#5314: a write that lands between the read and the write wins; the later request changes nothing', async () => {
  const { db, e } = setup();
  // Cap: both read revision 0; the other request's edit lands first.
  await call(e, 'PUT', '/capacity/cap', ours, { weekly_hours: 38, expected_revision: null });
  after(/FROM partner_capacity WHERE partner_id = \? AND person_user_id IS NULL/, () => {
    db.prepare('UPDATE partner_capacity SET weekly_hours = 30, revision = revision + 1 WHERE partner_id = 1').run();
  });
  assertStale(await call(e, 'PUT', '/capacity/cap', ours, { weekly_hours: 45, expected_revision: 0 }), 1);
  assert.equal(one(db, 'SELECT weekly_hours FROM partner_capacity WHERE partner_id = 1').weekly_hours, 30);

  // Health: both read "no row"; the other request's insert lands first.
  after(/SELECT \* FROM partner_engagement_health WHERE engagement_id = \?/, () => {
    db.prepare(`INSERT INTO partner_engagement_health (engagement_id, scope_state, created_at, updated_at)
                VALUES (?, 'within', 'x', 'x')`).run(OUR_ENGAGEMENT);
  });
  assertStale(await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/health`, ours, { scope_state: 'drift', expected_revision: null }), 0);
  assert.equal(one(db, 'SELECT scope_state FROM partner_engagement_health WHERE engagement_id = ?', OUR_ENGAGEMENT).scope_state, 'within');

  // Client hours: both read revision 0; the other request's edit lands first.
  const path = `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/${nowPeriod()}`;
  await call(e, 'PUT', path, ours, { hours: 6, expected_revision: null });
  after(/SELECT id, revision FROM engagement_hours WHERE engagement_id = \?/, () => {
    db.prepare('UPDATE engagement_hours SET hours = 7, revision = revision + 1').run();
  });
  assertStale(await call(e, 'PUT', path, ours, { hours: 9, expected_revision: 0 }), 1);
  assert.equal(one(db, 'SELECT hours FROM engagement_hours').hours, 7);

  // Internal hours: a removal racing an edit keeps the edit.
  const p = nowPeriod();
  await call(e, 'PUT', '/capacity/internal-hours', ours, { person_user_id: OUR_STAFF, period: p, hours: 10, expected_revision: null });
  after(/SELECT \* FROM partner_internal_hours WHERE partner_id = \?/, () => {
    db.prepare('UPDATE partner_internal_hours SET hours = 11, revision = revision + 1').run();
  });
  assertStale(await call(e, 'PUT', '/capacity/internal-hours', ours, { person_user_id: OUR_STAFF, period: p, hours: null, expected_revision: 0 }), 1);
  assert.equal(one(db, 'SELECT hours FROM partner_internal_hours').hours, 11);
});
