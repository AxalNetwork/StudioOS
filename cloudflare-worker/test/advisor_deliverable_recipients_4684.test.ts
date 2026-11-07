/**
 * #4684 (Practice audit 1/6) — a sent work product belongs to the account it
 * was sent to, and a receipt to the account that recorded it.
 *
 * Before this, every client read and receipt was authorised through the
 * engagement's CURRENT client, so relinking an engagement moved everything it
 * had already delivered: the first client lost it and the new one saw it, with
 * the first client's receipts on it. These tests run the whole sequence:
 * send → relink → read and receipt, a send after the relink, a race between a
 * relink and a receipt, and the migration's backfill. Synthetic users only.
 *
 * HARNESS: the same as `advisor_deliverables_received.test.ts` (real router,
 * real in-memory SQLite from the migration files), plus migration
 * 202611062152.
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

function freshDb(withRecipients = true) {
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
  if (withRecipients) db.exec(migration('202611062152_advisor_deliverable_recipients'));

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


const relink = (e: any, to: number | null) => call(e, 'PATCH', '/me/engagements/1', ada, { founder_user_id: to });
const titles = (r: any) => (r.items || []).map((i: any) => i.title);

test('send v1 to A, relink the engagement to B: A keeps it, B does not inherit it', async () => {
  const db = freshDb();
  const e = env(db);
  await seed(e, 1, 'Pricing memo');
  assert.deepEqual(titles(await received(e, fran)), ['Pricing memo']);
  const r = await relink(e, OTHER_FOUNDER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // Mutation checked: authorise the received list through e.founder_user_id again -> both lines below fail.
  assert.deepEqual(titles(await received(e, fran)), ['Pricing memo'], 'A still has what was sent to A');
  assert.deepEqual(titles(await received(e, otto)), [], 'B inherits nothing already sent');
  const row = db.prepare('SELECT recipient_user_id FROM advisor_deliverable_versions').get() as any;
  assert.equal(row.recipient_user_id, FOUNDER_USER, 'the version records who it went to');
});

test('a version sent after the relink goes to B, and only that version', async () => {
  const e = env(freshDb());
  const d = await seed(e, 1, 'Pricing memo');
  await relink(e, OTHER_FOUNDER);
  assert.equal((await call(e, 'POST', `/me/deliverables/${d.id}/versions`, ada, {})).status, 201);
  assert.equal((await call(e, 'POST', `/me/deliverables/${d.id}/versions/2/send`, ada)).status, 200);
  const a = await received(e, fran);
  const b = await received(e, otto);
  assert.deepEqual(a.items[0].versions.map((v: any) => v.version), [1], 'A sees only v1');
  assert.deepEqual(b.items[0].versions.map((v: any) => v.version), [2], 'B sees only v2');
  // The advisor sees who each went to; the engagement now names B.
  const m = await mine(e);
  const item = m.items.find((i: any) => i.id === d.id);
  assert.deepEqual(item.versions.map((v: any) => [v.version, v.recipient_name]), [[2, 'Otto'], [1, 'Fran']]);
  assert.equal(item.client_user_name, 'Otto');
});

test("A's open and sign-off stay A's: B can neither see nor stamp them", async () => {
  const db = freshDb();
  const e = env(db);
  await seed(e, 1, 'Pricing memo');
  const uid = (await received(e, fran)).items[0].versions[0].uid;
  assert.equal((await call(e, 'POST', `/received/deliverables/${uid}/open`, fran)).status, 200);
  assert.equal((await call(e, 'POST', `/received/deliverables/${uid}/accept`, fran)).status, 200);
  await relink(e, OTHER_FOUNDER);
  // Mutation checked: scope the receipt routes by the engagement's client -> B's calls return 200 and this fails.
  assert.equal((await call(e, 'POST', `/received/deliverables/${uid}/open`, otto)).status, 404);
  assert.equal((await call(e, 'POST', `/received/deliverables/${uid}/accept`, otto)).status, 404);
  const row = db.prepare('SELECT opened_by_user_id, signed_off_by_user_id, opened_at, signed_off_at FROM advisor_deliverable_versions WHERE uid = ?').get(uid) as any;
  assert.deepEqual([row.opened_by_user_id, row.signed_off_by_user_id], [FOUNDER_USER, FOUNDER_USER]);
  assert.ok(row.opened_at && row.signed_off_at);
  // A can still read it, with A's own receipts on it.
  const v = (await received(e, fran)).items[0].versions[0];
  assert.equal(v.signed_off_at, row.signed_off_at);
});

test('a sign-off on an unopened version records the opener too, as the same account', async () => {
  const db = freshDb();
  const e = env(db);
  await seed(e, 1, 'Pricing memo');
  const uid = (await received(e, fran)).items[0].versions[0].uid;
  assert.equal((await call(e, 'POST', `/received/deliverables/${uid}/accept`, fran)).status, 200);
  const row = db.prepare('SELECT opened_by_user_id, signed_off_by_user_id FROM advisor_deliverable_versions WHERE uid = ?').get(uid) as any;
  assert.deepEqual([row.opened_by_user_id, row.signed_off_by_user_id], [FOUNDER_USER, FOUNDER_USER]);
});

test('unrelated clients and other advisors stay refused, as 404', async () => {
  const e = env(freshDb());
  await seed(e, 1, 'Pricing memo');
  const uid = (await received(e, fran)).items[0].versions[0].uid;
  for (const who of [otto, ada]) {
    assert.equal((await call(e, 'POST', `/received/deliverables/${uid}/open`, who)).status, 404);
    assert.equal((await call(e, 'POST', `/received/deliverables/${uid}/accept`, who)).status, 404);
  }
  assert.deepEqual(titles(await received(e, otto)), []);
});

test('a relink racing a receipt cannot move either: the recipient and the receipt actors are write-once', async () => {
  const db = freshDb();
  const e = env(db);
  await seed(e, 1, 'Pricing memo');
  const uid = (await received(e, fran)).items[0].versions[0].uid;
  // The relink lands between B's (refused) read and any write: nothing B sends can stamp A's version,
  // because the receipt's UPDATE repeats the recipient in its WHERE.
  await relink(e, OTHER_FOUNDER);
  await Promise.all([
    call(e, 'POST', `/received/deliverables/${uid}/open`, otto),
    call(e, 'POST', `/received/deliverables/${uid}/open`, fran),
  ]);
  const row = db.prepare('SELECT recipient_user_id, opened_by_user_id FROM advisor_deliverable_versions WHERE uid = ?').get(uid) as any;
  assert.deepEqual([row.recipient_user_id, row.opened_by_user_id], [FOUNDER_USER, FOUNDER_USER]);
  // And the store itself refuses to move them, whatever writes next.
  // Mutation checked: drop the recipient trigger -> the first throw is not raised and this fails.
  assert.throws(() => db.prepare('UPDATE advisor_deliverable_versions SET recipient_user_id = ? WHERE uid = ?').run(OTHER_FOUNDER, uid), /keeps the recipient/);
  assert.throws(() => db.prepare('UPDATE advisor_deliverable_versions SET opened_by_user_id = ? WHERE uid = ?').run(OTHER_FOUNDER, uid), /keeps the account/);
});

test('a send racing another send is one send: the loser is 409 and the winner keeps its recipient', async () => {
  const db = freshDb();
  const e: any = env(db);
  const d = (await call(e, 'POST', '/me/deliverables', ada, { title: 'Memo', engagement_id: 1 })).body;
  // The race, made deterministic: just before this route writes its stamp, a competing send lands
  // (as if another tab had sent first, to the client of that moment).
  const inner = e.DB;
  let raced = false;
  e.DB = { ...inner, prepare(sql: string) {
    if (!raced && /SET sent_at = \?, recipient_user_id = \?/.test(sql)) {
      raced = true;
      db.prepare("UPDATE advisor_deliverable_versions SET sent_at = '2026-11-06T00:00:00Z', recipient_user_id = ? WHERE deliverable_id = ?").run(OTHER_FOUNDER, d.id);
    }
    return inner.prepare(sql);
  } };
  // Mutation checked: drop `sent_at IS NULL` from the send's WHERE -> the route overwrites (or the trigger aborts) and this fails.
  const r = await call(e, 'POST', `/me/deliverables/${d.id}/versions/1/send`, ada);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  const row = db.prepare('SELECT recipient_user_id FROM advisor_deliverable_versions WHERE deliverable_id = ?').get(d.id) as any;
  assert.equal(row.recipient_user_id, OTHER_FOUNDER, 'the first send keeps its recipient');
});

test('the migration pins versions sent before it to the client of the day, and leaves their receipt actors unknown', () => {
  const db = freshDb(false);
  db.prepare(`INSERT INTO advisor_deliverables (id, uid, advisor_id, engagement_id, client_name, title) VALUES (9, 'd9', 1, 1, 'Halverton', 'Old memo')`).run();
  db.prepare(`INSERT INTO advisor_deliverable_versions (uid, deliverable_id, version, sent_at, opened_at) VALUES ('v9a', 9, 1, '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z')`).run();
  db.prepare(`INSERT INTO advisor_deliverable_versions (uid, deliverable_id, version) VALUES ('v9b', 9, 2)`).run();
  db.exec(migration('202611062152_advisor_deliverable_recipients'));
  const rows = db.prepare('SELECT uid, recipient_user_id, opened_by_user_id FROM advisor_deliverable_versions ORDER BY uid').all() as any[];
  assert.deepEqual(rows.map((r) => [r.uid, r.recipient_user_id, r.opened_by_user_id]), [['v9a', FOUNDER_USER, null], ['v9b', null, null]],
    'sent: pinned; unsent: nothing yet; who opened it was never recorded, so null');
  const sql = migration('202611062152_advisor_deliverable_recipients');
  assert.match(sql, /ADD COLUMN recipient_user_id INTEGER/);
  assert.doesNotMatch(sql, /^\s*INSERT\b/im, 'no rows invented');
});
