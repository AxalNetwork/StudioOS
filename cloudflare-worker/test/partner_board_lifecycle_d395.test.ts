/**
 * D395 — the Delivery board carries each engagement's lifecycle dates, because
 * the lifecycle and the invoice ledger moved onto it from the retired
 * `/partner/operations/engagements`.
 *
 * `GET /partner/delivery/board` rows gain `delivered_at`, `invoiced_at`,
 * `invoice_id` and `cancelled_at`: the engagement's own columns, null until
 * that step happened, and never another firm's.
 *
 * Harness: node:sqlite with the real migration files (208, 230–232), the same
 * shape partner_home_p2_d394.test.ts uses.
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

const OURS = 60;       // partner_id 1
const THEIRS = 62;     // partner_id 2
const UNLINKED = 66;   // role partner, no firm
const FOUNDER = 64;
const OUR_ENG = 901;
const THEIR_ENG = 902;

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
    async batch(x: any[]) { return x; },
  };
}

const migration = (name: string) => readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, partner_id INTEGER, founder_id INTEGER,
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
      budget_min REAL, budget_max REAL, timeline TEXT, status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    -- #4673: an engagement's founder_id is a founder profile (founders.id); the client's name is read
    -- from it. This fixture keeps the founder's id equal to the user's on purpose.
    CREATE TABLE founders (id INTEGER PRIMARY KEY, uid TEXT, name TEXT NOT NULL, email TEXT);
    CREATE TABLE engagements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      need_id INTEGER NOT NULL, quote_id INTEGER NOT NULL UNIQUE,
      partner_id INTEGER NOT NULL, founder_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL, price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'accepted',
      delivered_at TEXT, delivery_notes TEXT, cancelled_at TEXT, cancel_reason TEXT,
      invoice_id TEXT, invoiced_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE research_zone_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      owner_user_id INTEGER NOT NULL, surface TEXT NOT NULL, scope_key TEXT,
      body TEXT NOT NULL, model TEXT, cost_micro_usd INTEGER NOT NULL DEFAULT 0,
      accepted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(migration('208_partner_delivery_stores'));
  db.exec(migration('230_partner_capacity'));
  db.exec(migration('231_partner_internal_hours'));
  db.exec(migration('232_partner_engagement_health'));
  // #5314 part 3: the revisions on health, caps, internal and client hours.
  db.exec(migration('202611111141_5314_delivery_write_versions'));

  const u = db.prepare('INSERT INTO users (id, role, partner_id, name, email) VALUES (?,?,?,?,?)');
  u.run(OURS, 'partner', 1, 'Ours', 'ours@example.com');
  u.run(THEIRS, 'partner', 2, 'Theirs', 'theirs@example.com');
  u.run(UNLINKED, 'partner', null, 'Nobody', 'nobody@example.com');
  u.run(FOUNDER, 'founder', null, 'Verwood', 'fran@example.com');
  db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(FOUNDER, 'Verwood', 'fran@example.com');
  db.prepare('INSERT INTO partners (id, uid, name, email) VALUES (?,?,?,?)').run(1, 'p-1', 'Ours', 'ours@example.com');
  db.prepare('INSERT INTO partners (id, uid, name, email) VALUES (?,?,?,?)').run(2, 'p-2', 'Theirs', 'theirs@example.com');
  const n = db.prepare('INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description) VALUES (?,?,?,?,?,?,?)');
  n.run(501, 'need-1', 9, FOUNDER, 'engineering', 'Payments migration', 'x');
  n.run(502, 'need-2', 9, FOUNDER, 'design', 'Their brand refresh', 'y');
  const e = db.prepare(`INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price)
                        VALUES (?,?,?,?,?,?,?,?)`);
  e.run(OUR_ENG, 'e-ours', 501, 601, 1, FOUNDER, 9, 42000);
  e.run(THEIR_ENG, 'e-theirs', 502, 602, 2, FOUNDER, 9, 15000);
  return db;
}

async function token(userId: number, role: string) {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function board(db: any, userId: number) {
  const res = await partnerDelivery.request('/board', {
    headers: { Authorization: `Bearer ${await token(userId, 'partner')}` },
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}


test('D395: an engagement not yet delivered carries every lifecycle date as null', async () => {
  const r = await board(freshDb(), OURS);
  assert.equal(r.status, 200);
  const row = r.body.items.find((i: any) => i.engagement_id === OUR_ENG);
  assert.equal(row.status, 'accepted');
  for (const k of ['delivered_at', 'invoiced_at', 'invoice_id', 'cancelled_at']) {
    assert.ok(k in row, `${k} is missing from the row rather than null`);
    assert.equal(row[k], null, `${k} is not null on an engagement that has not reached it`);
  }
});

test('D395: a delivered and invoiced engagement carries its own dates and invoice number', async () => {
  const db = freshDb();
  db.prepare(`UPDATE engagements SET status = 'invoiced', delivered_at = ?, invoiced_at = ?, invoice_id = ? WHERE id = ?`)
    .run('2026-09-18T10:00:00Z', '2026-09-20T10:00:00Z', 'INV-0042', OUR_ENG);
  db.prepare(`UPDATE engagements SET status = 'cancelled', cancelled_at = ? WHERE id = ?`)
    .run('2026-09-19T10:00:00Z', THEIR_ENG);
  const r = await board(db, OURS);
  const row = r.body.items.find((i: any) => i.engagement_id === OUR_ENG);
  assert.equal(row.status, 'invoiced');
  assert.equal(row.delivered_at, '2026-09-18T10:00:00Z');
  assert.equal(row.invoiced_at, '2026-09-20T10:00:00Z');
  assert.equal(row.invoice_id, 'INV-0042');
  assert.equal(row.cancelled_at, null);
  assert.ok(!r.body.items.some((i: any) => i.engagement_id === THEIR_ENG), 'another firm\'s engagement came back');
});

test('D395: the other firm reads its own cancellation, and not our invoice', async () => {
  const db = freshDb();
  db.prepare(`UPDATE engagements SET status = 'invoiced', invoiced_at = ?, invoice_id = ? WHERE id = ?`)
    .run('2026-09-20T10:00:00Z', 'INV-0042', OUR_ENG);
  db.prepare(`UPDATE engagements SET status = 'cancelled', cancelled_at = ? WHERE id = ?`)
    .run('2026-09-19T10:00:00Z', THEIR_ENG);
  const r = await board(db, THEIRS);
  assert.deepEqual(r.body.items.map((i: any) => i.engagement_id), [THEIR_ENG]);
  assert.equal(r.body.items[0].cancelled_at, '2026-09-19T10:00:00Z');
  assert.equal(r.body.items[0].invoice_id, null);
  assert.ok(!JSON.stringify(r.body).includes('INV-0042'), 'our invoice number reached another firm');
});

test('D395: a sign-in with no firm is refused the board', async () => {
  const r = await board(freshDb(), UNLINKED);
  assert.ok(r.status >= 400, `a sign-in with no firm read the board (${r.status})`);
});

// ─────────────────────────────────────────────── D4822 (#4822): what Board v2 reads beside the work

test('D4822: a row carries its owner, scope assessment, overdue milestones, open blockers, deliverables and this period’s report', async () => {
  const db = freshDb();
  const r0 = await board(db, OURS);
  const bare = r0.body.items.find((i: any) => i.engagement_id === OUR_ENG);
  // Nothing recorded: every one is absent or zero-counted, never invented.
  assert.deepEqual(
    [bare.owner_user_id, bare.owner_name, bare.scope_state, bare.report_state, bare.milestones_overdue, bare.open_blockers, bare.deliverables_sent],
    [null, null, null, null, 0, 0, 0],
  );
  assert.equal(bare.report_period, r0.body.period);

  const past = '2020-01-01';
  const future = '2999-01-01';
  const m = db.prepare('INSERT INTO engagement_milestones (uid, engagement_id, title, due_at, completed_at) VALUES (?, ?, ?, ?, ?)');
  m.run('m1', OUR_ENG, 'Overdue, open', past, null);
  m.run('m2', OUR_ENG, 'Overdue, done', past, '2020-01-02');
  m.run('m3', OUR_ENG, 'Later', future, null);
  m.run('m4', OUR_ENG, 'Undated', null, null);
  const b = db.prepare('INSERT INTO engagement_blockers (uid, engagement_id, side, summary, cleared_at) VALUES (?, ?, ?, ?, ?)');
  b.run('b1', OUR_ENG, 'client', 'Waiting on data access', null);
  b.run('b2', OUR_ENG, 'ours', 'Cleared one', '2026-10-01');
  const d = db.prepare('INSERT INTO engagement_deliverables (uid, engagement_id, title, sent_at, signed_off_at) VALUES (?, ?, ?, ?, ?)');
  d.run('d1', OUR_ENG, 'GTM plan', '2026-10-01', '2026-10-03');
  d.run('d2', OUR_ENG, 'Pricing model', '2026-10-05', null);
  d.run('d3', OUR_ENG, 'Not sent yet', null, null);
  db.prepare('INSERT INTO partner_engagement_health (engagement_id, owner_user_id, scope_state) VALUES (?, ?, ?)').run(OUR_ENG, OURS, 'drift');
  db.prepare("INSERT INTO engagement_status_reports (uid, engagement_id, period, state) VALUES ('r1', ?, ?, 'draft')").run(OUR_ENG, r0.body.period);
  // Another firm's report for the same period must not reach our row.
  db.prepare("INSERT INTO engagement_status_reports (uid, engagement_id, period, state, sent_at) VALUES ('r2', ?, ?, 'sent', '2026-11-01')").run(THEIR_ENG, r0.body.period);

  const r = await board(db, OURS);
  const row = r.body.items.find((i: any) => i.engagement_id === OUR_ENG);
  assert.equal(row.milestones_overdue, 1, 'a completed or undated milestone counted as overdue');
  assert.deepEqual([row.open_blockers, row.open_blockers_client_side], [1, 1], 'a cleared blocker counted as open');
  assert.deepEqual([row.deliverables_sent, row.deliverables_signed_off], [2, 1]);
  assert.deepEqual([row.owner_user_id, row.owner_name, row.scope_state], [OURS, 'Ours', 'drift']);
  assert.equal(row.report_state, 'draft');
  assert.ok(!r.body.items.some((i: any) => i.engagement_id === THEIR_ENG));
  db.prepare("UPDATE engagement_status_reports SET state = 'sent', sent_at = '2026-11-02' WHERE uid = 'r1'").run();
  assert.equal((await board(db, OURS)).body.items.find((i: any) => i.engagement_id === OUR_ENG).report_state, 'sent');
});
