/**
 * #5314 part 2 (D4822) — a stored Blocked section on status reports, and an
 * append-only history of the client's reviews. Synthetic records only.
 *
 *   BLOCKED   a report saved before the section existed reads "Not recorded",
 *             never "nothing blocked"; a written section reads back; an
 *             omitted `blocked` leaves it as it was; a sent report's section
 *             is frozen in the database.
 *   HISTORY   each change to the client's score appends one row; a save that
 *             leaves the review as it was appends nothing; a row is never
 *             updated or deleted (the triggers refuse); a score saved before
 *             history began says so.
 *
 * HARNESS: `partner_delivery_report_access_4673.test.ts`'s, applying the same
 * migration files production runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import partnerDelivery, { blockedSection } from '../src/routes/partner_delivery.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const OURS_USER = 60;
const THEIRS_USER = 62;
const FOUNDER_USER = 64;
const OUR_ENGAGEMENT = 901;

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
    // D1's batch is one transaction: all of it, or none of it.
    async batch(x: any[]) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const st of x || []) out.push(await st.run());
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

const migration = (name: string) => readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');
const NEW_MIGRATION = '202611111140_5314_status_report_blocked_history';

function freshDb({ withNew = true } = {}) {
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
    CREATE TABLE founders (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, name TEXT NOT NULL, email TEXT);
    CREATE TABLE founder_needs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      project_id INTEGER NOT NULL, founder_id INTEGER NOT NULL,
      category TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
      budget_min REAL, budget_max REAL, timeline TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  db.exec(migration('230_partner_capacity'));
  db.exec(migration('231_partner_internal_hours'));
  db.exec(migration('232_partner_engagement_health'));
  // #5314 part 3: every Delivery store carries the revision a write states.
  db.exec(migration('202611111141_5314_delivery_write_versions'));
  if (withNew) db.exec(migration(NEW_MIGRATION));

  const u = db.prepare('INSERT INTO users (id, role, partner_id, name, email) VALUES (?,?,?,?,?)');
  u.run(OURS_USER, 'partner', 1, 'Ours', 'ours@example.com');
  u.run(THEIRS_USER, 'partner', 2, 'Theirs', 'theirs@example.com');
  u.run(FOUNDER_USER, 'founder', null, 'Fran', 'fran@example.com');
  db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(FOUNDER_USER, 'Fran', 'fran@example.com');
  const p = db.prepare('INSERT INTO partners (id, uid, name, email) VALUES (?,?,?,?)');
  p.run(1, 'p-1', 'Ours', 'ours@example.com');
  p.run(2, 'p-2', 'Theirs', 'theirs@example.com');
  db.prepare("INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description) VALUES (501, 'need-1', 9, ?, 'engineering', 'Payments migration', 'x')").run(FOUNDER_USER);
  db.prepare(`INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price)
              VALUES (?, 'e-ours', 501, 601, 1, ?, 9, 42000)`).run(OUR_ENGAGEMENT, FOUNDER_USER);
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(e: any, method: string, path: string, who: { user: number; role: string }, body?: any) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(who.user, who.role)}` };
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
const P = '2026-11';
const save = (e: any, body: any) => call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/${P}`, ours,
  { engagement_id: OUR_ENGAGEMENT, period: P, ...body });
const listed = async (e: any) => (await call(e, 'GET', '/status-reports', ours)).body.items[0];

test('an older report, saved before the Blocked section existed, reads Not recorded — never "nothing blocked"', async () => {
  const db = freshDb();
  // Written as a report saved before this migration was: no Blocked section.
  db.prepare(`INSERT INTO engagement_status_reports (uid, engagement_id, period, state, shipped, next_up)
              VALUES ('r-old', ?, ?, 'draft', 'Old shipped', 'Old next')`).run(OUR_ENGAGEMENT, P);
  const row = await listed(env(db));
  // Mutation checked: return `blocked_recorded: true` whenever `blocked` is null -> this fails.
  assert.deepEqual([row.blocked, row.blocked_recorded, row.blocked_recorded_at], [null, false, null]);
  assert.match(row.blocked_state_note, /^Not recorded/);
  // A save of Shipped alone, as the old page sends it, does not invent a section.
  assert.equal((await save(env(db), { shipped: 'Shipped again', next_up: 'Old next' })).status, 200);
  assert.equal((await listed(env(db))).blocked_recorded, false);
});

test('a written Blocked section reads back; an omitted one is left as it was; null states nothing is blocked', async () => {
  const db = freshDb();
  const e = env(db);
  const first = await save(e, { shipped: 'Shipped', next_up: 'Next', blocked: '  Waiting on CRM export  ' });
  assert.equal(first.status, 200);
  assert.deepEqual([first.body.blocked, first.body.blocked_recorded], ['Waiting on CRM export', true]);
  assert.match(first.body.blocked_recorded_at, /^\d{4}-\d{2}-\d{2}T/);
  // Mutation checked: write `trimOrNull(b.blocked)` whether or not the key was sent -> the
  // omitted save below clears the section and this fails.
  const omitted = await save(e, { shipped: 'Shipped v2', next_up: 'Next' });
  assert.equal(omitted.body.blocked, 'Waiting on CRM export', 'an omitted key leaves the section untouched');
  const cleared = await save(e, { shipped: 'Shipped v2', next_up: 'Next', blocked: null });
  assert.deepEqual([cleared.body.blocked, cleared.body.blocked_recorded], [null, true],
    'a recorded empty section is a statement, not an absence');
  assert.equal(cleared.body.blocked_state_note, null);
});

test('blockedSection: a row without the column (migration not applied) is Not recorded', () => {
  assert.equal(blockedSection({ shipped: 'x' }).blocked_recorded, false);
  assert.equal(blockedSection({ blocked: 'x', blocked_recorded_at: null }).blocked, null,
    'words with no recorded time are not shown as the section');
  assert.equal(blockedSection({ blocked: null, blocked_recorded_at: '2026-11-11T10:00:00Z' }).blocked_recorded, true);
});

test('a sent report\'s Blocked section is frozen in the database', async () => {
  const db = freshDb();
  const e = env(db);
  const saved = await save(e, { shipped: 'S', next_up: 'N', blocked: 'Waiting on access' });
  assert.equal((await call(e, 'POST', `/status-reports/${saved.body.id}/send`, ours, {})).status, 200);
  // Mutation checked: drop trg_status_report_sent_blocked_frozen -> the UPDATE succeeds and this fails.
  assert.throws(
    () => db.prepare("UPDATE engagement_status_reports SET blocked = 'rewritten' WHERE id = ?").run(saved.body.id),
    /status_report_sent/,
  );
  assert.equal((await listed(e)).blocked, 'Waiting on access');
});

const health = (e: any, body: any, who = ours) => call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/health`, who, body);
const reviews = (e: any, who = ours) => call(e, 'GET', `/engagements/${OUR_ENGAGEMENT}/reviews`, who);

test('each change to the client review appends one row; a save that leaves it as it was appends nothing', async () => {
  const db = freshDb();
  const e = env(db);
  assert.equal((await health(e, { satisfaction: 4, satisfaction_source: 'QBR call', satisfaction_at: '2026-10-01' })).status, 200);
  // An owner-only save does not touch the review, so nothing is appended.
  // Mutation checked: append on every save -> three rows below, and this fails.
  assert.equal((await health(e, { scope_state: 'within' })).status, 200);
  assert.equal((await health(e, { satisfaction: 3, satisfaction_source: 'Email from CEO', satisfaction_at: '2026-11-05' })).status, 200);
  const r = await reviews(e);
  assert.equal(r.status, 200);
  assert.equal(r.body.available, true);
  assert.deepEqual(r.body.items.map((x: any) => [x.satisfaction, x.source, x.said_at]),
    [[4, 'QBR call', '2026-10-01'], [3, 'Email from CEO', '2026-11-05']]);
  assert.equal(r.body.items[0].recorded_by_name, 'Ours');
  assert.equal(r.body.earlier_not_recorded, false);
  // Clearing the score is itself a recorded review.
  await health(e, { satisfaction: null });
  const after = (await reviews(e)).body.items;
  assert.equal(after.length, 3);
  assert.equal(after[2].cleared, true);
});

test('the history never rewrites: the triggers refuse an update or a delete', async () => {
  const db = freshDb();
  await health(env(db), { satisfaction: 5, satisfaction_source: 'Renewal call' });
  // Mutation checked: drop either trigger from the migration -> its assertion fails.
  assert.throws(() => db.prepare('UPDATE engagement_client_reviews SET satisfaction = 1').run(), /append_only/);
  assert.throws(() => db.prepare('DELETE FROM engagement_client_reviews').run(), /append_only/);
});

test('a score saved before history began says earlier reviews are Not recorded', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO partner_engagement_health (engagement_id, satisfaction, satisfaction_source)
              VALUES (?, 4, 'Kick-off call')`).run(OUR_ENGAGEMENT);
  const r = (await reviews(env(db))).body;
  assert.deepEqual([r.available, r.items, r.earlier_not_recorded], [true, [], true]);
  assert.match(r.earlier_note, /^Not recorded/);
});

test('an unreadable history is Unreadable, never an empty list', async () => {
  const db = freshDb({ withNew: false });
  const r = await reviews(env(db));
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.available, r.body.items], [false, null]);
  assert.match(r.body.reason, /^Unreadable/);
});

test('another firm cannot read this engagement\'s reviews', async () => {
  const r = await reviews(env(freshDb()), theirs);
  assert.equal(r.status, 404);
});
