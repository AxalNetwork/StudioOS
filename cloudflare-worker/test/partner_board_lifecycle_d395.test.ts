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

  const u = db.prepare('INSERT INTO users (id, role, partner_id, name, email) VALUES (?,?,?,?,?)');
  u.run(OURS, 'partner', 1, 'Ours', 'ours@example.com');
  u.run(THEIRS, 'partner', 2, 'Theirs', 'theirs@example.com');
  u.run(UNLINKED, 'partner', null, 'Nobody', 'nobody@example.com');
  u.run(FOUNDER, 'founder', null, 'Verwood', 'fran@example.com');
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
