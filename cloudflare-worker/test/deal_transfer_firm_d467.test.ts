/**
 * D467 — IC work is scoped by firm, and a recorded transfer carries its firm.
 *
 * Drives the REAL `deals` router against real SQLite, with migrations 335 and
 * 340 themselves executed for `deal_transfers`, so the column under test is
 * the one production gets.
 *
 *   - `POST /deals/:id/transfers` stamps the firm it can prove: the verified
 *     active company, else the caller's only firm. A caller in several firms
 *     who has not chosen one is refused and nothing is written; a caller in
 *     no firm writes NULL.
 *   - A row with no firm (every row before migration 340) reads as "not
 *     recorded" on both reads, never as a firm.
 *   - The wire gate's count goes through `icDecisionScope`: another firm's
 *     open condition still refuses the wire, but the refusal carries no count
 *     and no text of it. A failed gate read refuses (it used to read as 0).
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_transfer_firm_d467.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import deals from '../src/routes/deals.ts';

const app = new Hono();
app.onError((err: any, c: any) => {
  const msg = String(err?.message || '');
  if (msg === 'Forbidden') return c.json({ detail: msg }, 403);
  if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
  return c.json({ detail: 'Internal server error' }, 500);
});
app.route('/api/deals', deals);

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MIG = (f: string) => readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations', f), 'utf8');

const SOLO = 20;      // partner in exactly one firm (FIRM_A)
const MULTI = 21;     // partner in FIRM_A and FIRM_B
const LONE = 22;      // partner in no firm
const RIVAL = 23;     // partner in FIRM_C only
const FIRM_A = 501, FIRM_B = 502, FIRM_C = 503;
const DEAL = 71;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>, failOn: string | null = null) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const fail = failOn != null && sql.includes(failOn);
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { if (fail) throw new Error('D1_ERROR: database is locked'); return db.prepare(sql).get(...b) ?? null; },
        async all() { if (fail) throw new Error('D1_ERROR: database is locked'); return { results: db.prepare(sql).all(...b) }; },
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

function runMigration(db: InstanceType<typeof DatabaseSync>, file: string) {
  for (const stmt of MIG(file).replace(/--[^\n]*/g, '').split(';')) {
    const sql = stmt.trim();
    if (sql) db.exec(sql);
  }
}

function freshDb(withColumn = true) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, name TEXT, email TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, investor_tier TEXT, partner_id INTEGER, founder_id INTEGER);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, sector TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
    CREATE TABLE deals (id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER, partner_id INTEGER,
      status TEXT NOT NULL DEFAULT 'applied', notes TEXT, amount REAL, target_raise REAL, capital_committed REAL DEFAULT 0,
      created_at TEXT, updated_at TEXT);
    CREATE TABLE deal_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER, investor_user_id INTEGER, status TEXT, created_at TEXT);
    CREATE TABLE commitments (id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER, investor_user_id INTEGER, amount REAL, status TEXT, created_at TEXT);
    CREATE TABLE ic_decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL, project_id INTEGER,
      deal_id INTEGER, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_by INTEGER, company_id INTEGER,
      created_at TEXT, updated_at TEXT);
    CREATE TABLE ic_votes (id INTEGER PRIMARY KEY AUTOINCREMENT, ic_decision_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      vote TEXT NOT NULL, rationale TEXT, created_at TEXT);
    CREATE TABLE ic_conditions (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL, ic_decision_id INTEGER NOT NULL,
      body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_by INTEGER NOT NULL, created_at TEXT,
      resolved_at TEXT, resolved_by INTEGER);
    CREATE TABLE user_company_links (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, company_id INTEGER NOT NULL,
      is_primary_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT);
    CREATE TABLE company_profiles (id INTEGER PRIMARY KEY, company_name TEXT);
    CREATE TABLE legal_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
  `);
  runMigration(db, '335_deal_transfers_and_closing_checklists.sql');
  if (withColumn) runMigration(db, '340_deal_transfer_company.sql');
  const u = db.prepare('INSERT INTO users (id, role, name) VALUES (?, ?, ?)');
  u.run(SOLO, 'partner', 'Sol Solo'); u.run(MULTI, 'partner', 'Mia Multi');
  u.run(LONE, 'partner', 'Lou Lone'); u.run(RIVAL, 'partner', 'Rex Rival');
  const cp = db.prepare('INSERT INTO company_profiles (id, company_name) VALUES (?, ?)');
  cp.run(FIRM_A, 'Alder Ventures'); cp.run(FIRM_B, 'Birch Capital'); cp.run(FIRM_C, 'Cedar Partners');
  const l = db.prepare('INSERT INTO user_company_links (user_id, company_id) VALUES (?, ?)');
  l.run(SOLO, FIRM_A); l.run(MULTI, FIRM_A); l.run(MULTI, FIRM_B); l.run(RIVAL, FIRM_C);
  db.prepare('INSERT INTO projects (id, name) VALUES (7, ?)').run('Alpha');
  db.prepare(`INSERT INTO deals (id, uid, project_id, status) VALUES (?, 'd-alpha', 7, 'funded')`).run(DEAL);
  return db;
}

async function call(user: number, path: string, db: InstanceType<typeof DatabaseSync>,
  init: { method?: string; body?: any; company?: string } = {}, failOn: string | null = null) {
  const tok = await new SignJWT({ user_id: user, role: 'partner' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
  if (init.company) headers['X-Company-Id'] = init.company;
  const res = await app.request(`/api/deals${path}`, {
    method: init.method || 'GET', headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, failOn) } as any);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

const record = (user: number, db: InstanceType<typeof DatabaseSync>, company?: string) =>
  call(user, `/${DEAL}/transfers`, db, { method: 'POST', body: { amount_cents: 100000 }, company });
const stored = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare('SELECT company_id FROM deal_transfers ORDER BY id').all().map((r: any) => r.company_id);

// ---- the firm on the write ----------------------------------------------------

test('migration 340 adds a nullable company_id to deal_transfers and backfills nothing', () => {
  const db = freshDb(false);
  db.prepare(`INSERT INTO deal_transfers (uid, deal_id, amount_cents, recorded_by) VALUES ('t-old', ?, 500, ?)`).run(DEAL, SOLO);
  runMigration(db, '340_deal_transfer_company.sql');
  const cols = db.prepare('PRAGMA table_info(deal_transfers)').all() as any[];
  const col = cols.find((c) => c.name === 'company_id');
  assert.ok(col, 'the column exists');
  assert.equal(col.notnull, 0, 'nullable');
  assert.deepEqual(stored(db), [null], 'an old row is not given a firm');
});

test('a partner in one firm, with no switcher choice, records the transfer for that firm', async () => {
  const db = freshDb();
  const r = await record(SOLO, db);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.item.company_id, FIRM_A);
  assert.equal(r.body.item.company_name, 'Alder Ventures');
  assert.equal(r.body.item.firm_not_recorded, null);
  assert.deepEqual(stored(db), [FIRM_A]);
});

test('a partner in several firms is never guessed at: no choice is refused and nothing is written', async () => {
  const db = freshDb();
  const r = await record(MULTI, db);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'transfer_firm_required');
  assert.match(r.body.message, /more than one firm.*Nothing was recorded/);
  assert.deepEqual(stored(db), [], 'no row');
  // A forged or stale switcher id (a firm they are not in) is the same refusal.
  const forged = await record(MULTI, db, String(FIRM_C));
  assert.equal(forged.status, 400);
  assert.equal(forged.body.error, 'transfer_firm_required');
  assert.deepEqual(stored(db), []);
});

test('a partner in several firms who chose one in the switcher records it for that firm', async () => {
  const db = freshDb();
  const r = await record(MULTI, db, String(FIRM_B));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.item.company_id, FIRM_B);
  assert.equal(r.body.item.company_name, 'Birch Capital');
  assert.deepEqual(stored(db), [FIRM_B]);
});

test('a partner in no firm records no firm, and the row says so', async () => {
  const db = freshDb();
  const r = await record(LONE, db);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.item.company_id, null);
  assert.equal(r.body.item.company_name, null);
  assert.equal(r.body.item.firm_not_recorded, 'No firm is recorded for this transfer.');
  assert.deepEqual(stored(db), [null]);
});

// ---- the firm on the reads ----------------------------------------------------

test('both reads give the recorded firm, and a row without one as not recorded', async () => {
  const db = freshDb();
  await record(SOLO, db);
  db.prepare(`INSERT INTO deal_transfers (uid, deal_id, amount_cents, recorded_by, recorded_at) VALUES ('t-legacy', ?, 700, ?, '2026-01-01 00:00:00')`).run(DEAL, SOLO);
  for (const path of ['/transfers', `/${DEAL}/transfers`]) {
    const r = await call(SOLO, path, db);
    assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.body)}`);
    const legacy = r.body.items.find((t: any) => t.amount_cents === 700);
    const fresh = r.body.items.find((t: any) => t.amount_cents === 100000);
    assert.ok(legacy && fresh, path);
    assert.equal(fresh.company_name, 'Alder Ventures', path);
    assert.equal(fresh.firm_not_recorded, null, path);
    assert.equal(legacy.company_id, null, path);
    assert.equal(legacy.company_name, null, `${path}: never the recorder's firm today`);
    assert.equal(legacy.firm_not_recorded, 'No firm is recorded for this transfer.', path);
  }
});

// ---- the wire gate through icDecisionScope --------------------------------------

function condition(db: InstanceType<typeof DatabaseSync>, decUid: string, author: number, firm: number | null, body: string) {
  db.prepare(`INSERT INTO ic_decisions (uid, deal_id, title, created_by, company_id) VALUES (?, ?, 'IC', ?, ?)`)
    .run(decUid, DEAL, author, firm);
  db.prepare(`INSERT INTO ic_conditions (uid, ic_decision_id, body, status, created_by)
              VALUES (?, (SELECT id FROM ic_decisions WHERE uid = ?), ?, 'open', ?)`)
    .run(`c-${decUid}`, decUid, body, author);
}

test('the caller\'s own firm\'s open condition is counted in the refusal', async () => {
  const db = freshDb();
  condition(db, 'dec-a', SOLO, FIRM_A, 'IP assignment signed');
  const r = await record(SOLO, db);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'open_conditions_block_transfer');
  assert.equal(r.body.open_conditions, 1);
  assert.deepEqual(stored(db), []);
});

test('another firm\'s open condition still refuses the wire, but its count and text never cross firms', async () => {
  const db = freshDb();
  condition(db, 'dec-c1', RIVAL, FIRM_C, 'Cedar-only: board seat side letter');
  condition(db, 'dec-c2', RIVAL, FIRM_C, 'Cedar-only: key-person clause');
  const r = await record(SOLO, db);
  assert.equal(r.status, 409, 'the gate still holds');
  assert.equal(r.body.error, 'open_conditions_block_transfer');
  assert.equal('open_conditions' in r.body, false, 'no count from another firm');
  assert.doesNotMatch(JSON.stringify(r.body), /Cedar|board seat|key-person|\b2\b/);
  assert.match(r.body.message, /decision you cannot see/);
  assert.deepEqual(stored(db), []);
  // The other firm sees its own count.
  const own = await record(RIVAL, db);
  assert.equal(own.body.open_conditions, 2);
});

test('with both, the caller is told only their own count', async () => {
  const db = freshDb();
  condition(db, 'dec-a', SOLO, FIRM_A, 'mine');
  condition(db, 'dec-c1', RIVAL, FIRM_C, 'theirs 1');
  condition(db, 'dec-c2', RIVAL, FIRM_C, 'theirs 2');
  const r = await record(SOLO, db);
  assert.equal(r.status, 409);
  assert.equal(r.body.open_conditions, 1);
  assert.match(r.body.message, /^1 open IC condition on this deal/);
});

test('a failed gate read refuses the transfer and writes nothing — it used to read as 0', async () => {
  const db = freshDb();
  const orig = console.error; console.error = () => {};
  let r;
  try { r = await call(SOLO, `/${DEAL}/transfers`, db, { method: 'POST', body: { amount_cents: 100000 } }, 'FROM ic_conditions cond'); }
  finally { console.error = orig; }
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'transfer_gate_unreadable');
  assert.doesNotMatch(JSON.stringify(r.body), /locked|D1_ERROR/);
  assert.deepEqual(stored(db), []);
});
