/**
 * #5847 — a failed read is Unreadable, never an empty list.
 *
 * WHAT IS PINNED
 *   · `GET /api/positions/:uid`: when the marks or the distributions query
 *     fails, the route answers 503 `{ available: false, source, reason }`
 *     instead of an empty history and a $0 rollup. The company page reads a
 *     refused read as Unreadable (`readOf` in portfolioModel.js).
 *   · `GET /api/portfolio-support`: when the entries query fails, the route
 *     answers 503 the same way instead of an empty ledger.
 *   · An empty but SUCCESSFUL read keeps its shape: [] and 200.
 *   · Only the ledger's figures failing still leaves a readable page with
 *     Unreadable totals (#4647, portfolio_periods_pages_4647.test.ts).
 *
 * Failures are injected per statement: the SQLite D1 stand-in throws for the
 * statements whose SQL matches, every other statement runs as normal.
 * Synthetic data only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/portfolio_unreadable_reads_5847.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import positions from '../src/routes/positions.ts';
import support from '../src/routes/portfolio_support.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-5847-0123456789-abcdef';
const ADMIN = 1;

/** The D1 stand-in, with every statement whose SQL matches `fail` rejecting when read. */
function failingD1(db: DatabaseSync, fail: RegExp | null) {
  const real = d1Over(db) as any;
  if (!fail) return real;
  const refuse = () => Promise.reject(new Error('synthetic read failure'));
  return {
    ...real,
    prepare(sql: string) {
      if (!fail.test(sql)) return real.prepare(sql);
      const stmt: any = { bind: () => stmt, all: refuse, first: refuse, run: refuse, raw: refuse };
      return stmt;
    },
  };
}

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.prepare(`INSERT INTO users (id, role, founder_id, name, email, is_active) VALUES (?, 'admin', NULL, 'Ada', 'ada@axal.example', 1)`).run(ADMIN);
  db.exec(`
    INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p7', 'Venture Seven', 70), (8, 'p8', 'Venture Eight', 80);
    INSERT INTO portfolio_positions (uid, fund_id, project_id, round_name, invested_amount, ownership_pct, position_date, created_by) VALUES
      ('pos7', NULL, 7, 'Seed', 500, 5, '2026-01-10', ${ADMIN}),
      ('pos8', NULL, 8, 'Seed', 800, 8, '2026-02-10', ${ADMIN});
    INSERT INTO portfolio_marks (uid, fund_id, project_id, as_of_date, fmv, basis) VALUES ('m7', NULL, 7, '2026-06-30', 900, 'round_price');
    INSERT INTO portfolio_distributions (uid, fund_id, project_id, distribution_date, amount, kind) VALUES ('d7', NULL, 7, '2026-07-01', 100, 'secondary');
    INSERT INTO portfolio_support_entries (uid, project_id, kind, state, hours, summary, recorded_by, created_at, updated_at)
      VALUES ('s7', 7, 'intro', 'delivered', 2, 'Synthetic intro', ${ADMIN}, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z');
  `);
  return db;
}

const app = new Hono<any>();
app.route('/api/positions', positions);
app.route('/api/portfolio-support', support);
const ctx = { waitUntil() {}, passThroughOnException() {} };

async function get(db: DatabaseSync, path: string, fail: RegExp | null = null) {
  const token = await new SignJWT({ user_id: ADMIN, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  let res: Response;
  try {
    res = await app.fetch(new Request(`http://t/api${path}`, { headers: { Authorization: `Bearer ${token}` } }),
      { JWT_SECRET, ENVIRONMENT: 'development', DB: failingD1(db, fail) } as any, ctx as any);
  } catch (e) {
    if (e instanceof Response) res = e; else throw e;
  }
  const text = await res.text();
  let body: any = null; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const MARKS = /FROM portfolio_marks\s+WHERE project_id = \?/;
const DISTRIBUTIONS = /FROM portfolio_distributions\s+WHERE project_id = \?/;
const ENTRIES = /SELECT s\.uid, s\.fund_id/;
const FIGURES = /GROUP BY s\.(project_id|kind)/;

test('positions/:uid: a failed marks read is Unreadable with its reason, never an empty history or a $0 rollup', async () => {
  // Mutation checked: the marks catch back to `results: []` → 200 with marks [] and this fails.
  const res = await get(fixture(), '/positions/p7', MARKS);
  assert.equal(res.status, 503);
  assert.equal(res.body.available, false);
  assert.equal(res.body.source, 'marks');
  assert.match(res.body.reason, /^Unreadable — this company's valuation marks could not be read/);
  assert.equal(res.body.detail, res.body.reason);
  assert.equal('marks' in res.body || 'rollup' in res.body, false, 'no history and no rollup are claimed');
});

test('positions/:uid: a failed distributions read is Unreadable, never "None recorded" or $0 distributed', async () => {
  // Mutation checked: the distributions catch back to `results: []`; the check reading only `marks`.
  const res = await get(fixture(), '/positions/p7', DISTRIBUTIONS);
  assert.equal(res.status, 503);
  assert.equal(res.body.available, false);
  assert.equal(res.body.source, 'distributions');
  assert.match(res.body.reason, /^Unreadable — this company's distributions could not be read/);
});

test('positions/:uid: a successful read keeps its shape, and an empty one is still an empty list', async () => {
  const db = fixture();
  const full = await get(db, '/positions/p7');
  assert.equal(full.status, 200);
  assert.deepEqual(full.body.marks.map((m: any) => m.uid), ['m7']);
  assert.deepEqual(full.body.distributions.map((d: any) => d.uid), ['d7']);
  assert.equal(full.body.rollup.distributed, 100);
  const empty = await get(db, '/positions/p8');
  assert.equal(empty.status, 200, 'nothing recorded is not a failure');
  assert.deepEqual(empty.body.marks, []);
  assert.deepEqual(empty.body.distributions, []);
  assert.equal(empty.body.rollup.distributed, 0);
});

test('portfolio-support: a failed entries read is Unreadable, never an empty ledger', async () => {
  // Mutation checked: the entries catch back to `results: []` → 200 with entries [] and this fails.
  const res = await get(fixture(), '/portfolio-support', ENTRIES);
  assert.equal(res.status, 503);
  assert.equal(res.body.available, false);
  assert.equal(res.body.source, 'entries');
  assert.match(res.body.reason, /^Unreadable — the support ledger's entries could not be read/);
  assert.equal('entries' in res.body, false, 'no ledger is claimed');
});

test('portfolio-support: the figures failing alone still leaves a readable page with Unreadable totals, and success is unchanged', async () => {
  const db = fixture();
  const partial = await get(db, '/portfolio-support', FIGURES);
  assert.equal(partial.status, 200);
  assert.deepEqual(partial.body.entries.map((e: any) => e.uid), ['s7']);
  assert.equal(partial.body.totals, null);
  assert.equal(partial.body.page_state, 'unreadable');
  const ok = await get(db, '/portfolio-support');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.entries.map((e: any) => e.uid), ['s7']);
  assert.equal(ok.body.page_state, 'recorded');
  db.exec('DELETE FROM portfolio_support_entries');
  const none = await get(db, '/portfolio-support');
  assert.equal(none.status, 200, 'an empty ledger that was read is still an empty ledger');
  assert.deepEqual(none.body.entries, []);
});
