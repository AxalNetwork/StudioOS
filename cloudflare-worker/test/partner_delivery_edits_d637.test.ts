/**
 * D637 (#1395) — the partner's delivery edits: Clear keeps a blocker on record
 * and Delete removes it, a live seat's scope is edited in place, and an hours
 * entry is deleted (not zeroed), reading back as no entry. Every write records
 * its actor in `activity_logs`.
 *
 * HARNESS. `partner_delivery_routes.test.ts`'s: the real router against real
 * in-memory SQLite, tables built from the migration files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import partnerDelivery, { periodMinus } from '../src/routes/partner_delivery.ts';

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
  db.exec(`CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, user_id INTEGER,
    action TEXT NOT NULL, details TEXT, actor TEXT)`);

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

function nowPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}


const logs = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare('SELECT user_id, action, details, actor FROM activity_logs ORDER BY id').all() as any[];

test('D637: Clear keeps the blocker with its date; Delete removes it; each says so in the log', async () => {
  const db = freshDb();
  const e = env(db);
  const made = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/blockers`, ours, { summary: 'Waiting on API keys', side: 'client' })).body;
  const cleared = await call(e, 'PATCH', `/blockers/${made.id}`, ours, { cleared_at: '2026-10-07T10:00:00.000Z' });
  assert.equal(cleared.status, 200);
  let list = (await call(e, 'GET', `/engagements/${OUR_ENGAGEMENT}/blockers`, ours)).body.items;
  assert.equal(list.length, 1, 'a cleared blocker stays on record');
  assert.equal(list[0].cleared_at, '2026-10-07T10:00:00.000Z');

  await call(e, 'PATCH', `/blockers/${made.id}`, ours, { cleared_at: null });
  const gone = await call(e, 'DELETE', `/blockers/${made.id}`, ours);
  assert.equal(gone.status, 200);
  assert.equal(gone.body.deleted, made.id);
  list = (await call(e, 'GET', `/engagements/${OUR_ENGAGEMENT}/blockers`, ours)).body.items;
  assert.equal(list.length, 0, 'a deleted blocker is gone');

  assert.deepEqual(logs(db).map((r) => [r.action, r.user_id]), [
    ['delivery_blocker_raised', OURS_USER],
    ['delivery_blocker_cleared', OURS_USER],
    ['delivery_blocker_reopened', OURS_USER],
    ['delivery_blocker_deleted', OURS_USER],
  ]);
  for (const r of logs(db)) {
    assert.match(r.actor, /^[0-9a-f]{16,}$/);
    assert.equal(JSON.parse(r.details).blocker_id, made.id);
    assert.ok(!r.details.includes('API keys'), 'no typed text in the log line');
  }
  assert.equal(JSON.parse(logs(db)[3].details).was_cleared, false);
});

test('D637: another firm cannot clear or delete our blocker', async () => {
  const db = freshDb();
  const e = env(db);
  const made = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/blockers`, ours, { summary: 'x', side: 'ours' })).body;
  assert.equal((await call(e, 'DELETE', `/blockers/${made.id}`, theirs)).status, 404);
  assert.equal((await call(e, 'PATCH', `/blockers/${made.id}`, theirs, { cleared_at: '2026-10-07' })).status, 404);
  assert.equal(logs(db).filter((r) => r.user_id === THEIRS_USER).length, 0);
});

test('D637: a live seat\'s scope is edited in place; a revoked seat\'s is not', async () => {
  const db = freshDb();
  const e = env(db);
  const seat = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/seats`, ours, { holder_user_id: OUR_STAFF, scope: 'Board' })).body;
  const edited = await call(e, 'PATCH', `/seats/${seat.id}`, ours, { scope: 'Board, KPIs' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.scope, 'Board, KPIs');
  const cap = (await call(e, 'GET', `/capacity?period=${nowPeriod()}`, ours)).body;
  assert.equal(cap.seats.find((s: any) => s.id === seat.id).scope, 'Board, KPIs');

  await call(e, 'POST', `/seats/${seat.id}/revoke`, ours);
  const late = await call(e, 'PATCH', `/seats/${seat.id}`, ours, { scope: 'Everything' });
  assert.equal(late.status, 409);
  assert.match(late.body.detail, /revoked, so its scope can no longer change/);
  assert.deepEqual(logs(db).map((r) => r.action), ['delivery_seat_granted', 'delivery_seat_scope_edited', 'delivery_seat_revoked']);
});

test('D637: deleting an hours entry removes it, and it reads back as no entry, not 0', async () => {
  const db = freshDb();
  const e = env(db);
  const now = nowPeriod();
  const prev = periodMinus(now, 1);
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/${now}`, ours, { hours: 12.5 });
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/${prev}`, ours, { hours: 8 });
  let read = (await call(e, 'GET', `/capacity/hours?period=${now}`, ours)).body;
  assert.deepEqual(read.periods, [now, prev, periodMinus(now, 2)]);
  assert.equal(read.entries.length, 1);
  assert.deepEqual(read.entries[0].hours, { [now]: 12.5, [prev]: 8, [periodMinus(now, 2)]: null });
  assert.equal(read.entries[0].person_name, 'Sam');
  assert.equal(read.entries[0].client, 'Fran');

  const del = await call(e, 'DELETE', `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/${prev}`, ours);
  assert.equal(del.status, 200);
  read = (await call(e, 'GET', `/capacity/hours?period=${now}`, ours)).body;
  assert.equal(read.entries[0].hours[prev], null, 'deleted reads as no entry');
  assert.equal(read.entries[0].hours[now], 12.5);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM engagement_hours WHERE period = ?').get(prev) as any).n, 0, 'a delete, not a zero');

  const again = await call(e, 'DELETE', `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/${prev}`, ours);
  assert.equal(again.status, 404);
  assert.match(again.body.detail, /No hours are logged/);
  const bad = await call(e, 'DELETE', `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/2026-W41`, ours);
  assert.equal(bad.status, 400);
  assert.match(bad.body.detail, /Period must look like/);
  assert.equal((await call(e, 'DELETE', `/engagements/${OUR_ENGAGEMENT}/hours/0/${now}`, ours)).status, 400);
  assert.equal((await call(e, 'DELETE', `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/${now}`, theirs)).status, 404);

  assert.deepEqual(logs(db).map((r) => r.action), ['delivery_hours_logged', 'delivery_hours_logged', 'delivery_hours_deleted']);
  assert.deepEqual(JSON.parse(logs(db)[2].details), { engagement_id: OUR_ENGAGEMENT, person_user_id: OUR_STAFF, period: prev });
});

test('D637: the hours read is the firm\'s own, and an empty firm reads no entries', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/${nowPeriod()}`, ours, { hours: 3 });
  const mine = (await call(e, 'GET', '/capacity/hours', ours)).body;
  assert.equal(mine.entries.length, 1);
  const other = (await call(e, 'GET', '/capacity/hours', theirs)).body;
  assert.deepEqual(other.entries, []);
  assert.equal((await call(e, 'GET', '/capacity/hours?period=nope', ours)).status, 400);
});

test('D637: a failed log line never undoes the write', async () => {
  const db = freshDb();
  const e = env(db);
  db.exec('DROP TABLE activity_logs');
  const made = await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/blockers`, ours, { summary: 'x', side: 'ours' });
  assert.equal(made.status, 200);
  assert.equal((await call(e, 'DELETE', `/blockers/${made.body.id}`, ours)).status, 200);
});

test('D637: periodMinus crosses a year', () => {
  assert.equal(periodMinus('2026-01', 1), '2025-12');
  assert.equal(periodMinus('2026-03', 2), '2026-01');
  assert.equal(periodMinus('2026-10', 0), '2026-10');
});
