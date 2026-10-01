/**
 * D365 — GET /api/progress/metrics/:projectId refuses a failed read.
 *
 * It used to catch a failed SELECT, log it and answer 200 with `[]`, so every
 * page that reads snapshots (the Lab Revenue log, Use of Funds' burn, the KPI
 * ledger, the Grow desk) drew "nothing recorded" for data nobody read. D360
 * filed it; D363 left it filed beside the ledger.
 *
 * The REAL router against real SQLite (node:sqlite through _d1_sqlite.mjs's
 * d1Over), with migration 249 itself executed. The failure is injected at the
 * adapter for the one snapshot SELECT, so everything before it — auth, the
 * company-scoped project load, the view check, the schema bootstrap — runs
 * unmocked.
 *
 * Run:
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/metrics_read_refusal_d365.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import progress from '../src/routes/progress.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MIGRATION = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/249_project_metrics.sql'), 'utf8');
const FOUNDER = 10, OTHER = 20, PROJECT = 1;
const SNAPSHOT_SELECT = 'SELECT * FROM project_metrics WHERE project_id = ?';
const SQLITE_TEXT = 'disk I/O error: database page 7 is corrupt';

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, email TEXT, name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, founder_id INTEGER, spinout_lab_active INTEGER);
    CREATE TABLE user_company_links (id INTEGER PRIMARY KEY, company_id INTEGER, user_id INTEGER);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER);
    CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT,
      plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    INSERT INTO users (id, role, founder_id) VALUES (10, 'founder', 1001), (20, 'founder', 1002);
    INSERT INTO projects (id, name, founder_id) VALUES (1, 'Acme', 1001);
  `);
  for (const stmt of MIGRATION.split(';')) {
    const sql = stmt.replace(/--[^\n]*/g, '').trim();
    if (sql) db.exec(sql);
  }
  return db;
}

/** The same D1 over `db`, except the snapshot SELECT throws what SQLite would. */
function failingSnapshotRead(db: InstanceType<typeof DatabaseSync>, seen = { reached: false }) {
  const d1: any = d1Over(db);
  const prepare = d1.prepare.bind(d1);
  d1.prepare = (sql: string) => {
    const stmt = prepare(sql);
    if (!sql.includes(SNAPSHOT_SELECT)) return stmt;
    seen.reached = true;
    const bind = stmt.bind.bind(stmt);
    stmt.bind = (...a: unknown[]) => {
      const bound = bind(...a);
      bound.all = async () => { throw new Error(SQLITE_TEXT); };
      return bound;
    };
    return stmt;
  };
  return d1;
}

async function get(DB: unknown, who: number) {
  const tok = await new SignJWT({ user_id: who, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await progress.request(`/metrics/${PROJECT}`, { headers: { Authorization: `Bearer ${tok}` } }, { JWT_SECRET, ENVIRONMENT: 'development', DB });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

test('a failed snapshot read is a 500 refusal with our sentence, never an empty list', async () => {
  const db = freshDb();
  const errors: unknown[][] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { errors.push(a); };
  let r;
  try { r = await get(failingSnapshotRead(db), FOUNDER); } finally { console.error = orig; }
  assert.equal(r.status, 500);
  assert.equal(r.body.error, 'metrics_read_failed');
  assert.match(r.body.message, /not a claim that none are recorded/);
  assert.equal('items' in r.body, false, 'no list rides on a refusal');
  assert.equal('snapshots' in r.body, false);
  assert.doesNotMatch(JSON.stringify(r.body), /disk I\/O|corrupt/, 'SQLite\'s text never reaches the body');
  assert.ok(errors.some((a) => a.join(' ').includes(SQLITE_TEXT)), 'it is logged instead');
});

test('an empty store is still 200 with an empty list — the two answers differ', async () => {
  const r = await get(d1Over(freshDb()), FOUNDER);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { items: [], snapshots: [] });
});

test('recorded snapshots come back newest first, in both keys', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO project_metrics (project_id, snapshot_date, mrr, net_burn, source) VALUES (?, ?, ?, ?, ?)`).run(PROJECT, '2026-08-01', 1000, 5000, 'manual');
  db.prepare(`INSERT INTO project_metrics (project_id, snapshot_date, mrr, net_burn, source) VALUES (?, ?, ?, ?, ?)`).run(PROJECT, '2026-09-01', 2500, null, 'manual');
  const r = await get(d1Over(db), FOUNDER);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((s: any) => s.snapshot_date), ['2026-09-01', '2026-08-01']);
  assert.equal(r.body.items[0].net_burn, null, 'an unrecorded burn stays null');
  assert.deepEqual(r.body.snapshots, r.body.items);
});

test('the refusal comes after the access checks: another founder never reaches the read', async () => {
  // Under the bare sub-app a thrown 'Forbidden' has no onError to map it to
  // 403 (index.ts does that), so the status is not the point here: the read is.
  const seen = { reached: false };
  const orig = console.error;
  console.error = () => {};
  let r;
  try { r = await get(failingSnapshotRead(freshDb(), seen), OTHER); } finally { console.error = orig; }
  assert.equal(seen.reached, false, 'the snapshot SELECT is never prepared for a caller without access');
  assert.notEqual(r.status, 200);
  assert.notEqual(r.body?.error, 'metrics_read_failed');
});
