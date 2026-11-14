/**
 * D6207 (#6207): `/api/positions/analytics` names the date its figures speak
 * for and the instant it was read, from the Worker's clock, without changing
 * what `as_of` means.
 *
 *   - without `?as_of=`: `as_of` stays null (every flow counts, the latest
 *     mark per company), `as_of_default` is the Worker's UTC date and
 *     `read_at` the ISO instant of the read, the same day;
 *   - with `?as_of=`: `as_of` is the date asked and the figures are cut at it,
 *     as before; `as_of_default` and `read_at` still name the Worker's clock.
 *
 * Mutation checked (fails with the mutation, passes without):
 *   - `as_of: asOf` changed to `as_of: today` → test 1 (a default read would
 *     claim a pinned date);
 *   - `as_of_default: today` (the asked date instead of the Worker's) → test 2.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/positions_analytics_dated_basis_6207.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import positions from '../src/routes/positions.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d6207-0123456789abcdef';
const ADMIN = 1;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.prepare(`INSERT INTO users (id, role, founder_id, name, email, is_active, investor_tier, investor_subscription_status)
    VALUES (?, 'admin', NULL, 'Ada', 'ada@axal.example', 1, 'free', 'active')`).run(ADMIN);
  db.exec(`
    INSERT INTO projects (id, uid, name, founder_id) VALUES (6, 'p6', 'Venture Six', 60), (7, 'p7', 'Venture Seven', 70);
    INSERT INTO portfolio_positions (uid, fund_id, project_id, round_name, invested_amount, ownership_pct, position_date, created_by) VALUES
      ('pos6', NULL, 6, 'Seed', 600, 6, '2026-02-01', ${ADMIN}),
      ('pos7', NULL, 7, 'Seed', 500, 5, '2026-08-10', ${ADMIN});
    INSERT INTO portfolio_marks (uid, fund_id, project_id, as_of_date, fmv, basis) VALUES
      ('m6a', NULL, 6, '2026-06-30', 900, 'gp_estimate'),
      ('m6b', NULL, 6, '2026-09-30', 1200, 'round_price');
  `);
  return db;
}

const app = new Hono<any>();
app.route('/api/positions', positions);

async function call(db: DatabaseSync, path: string) {
  const token = await new SignJWT({ user_id: ADMIN, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  let res: Response;
  try {
    res = await app.fetch(new Request(`http://t/api${path}`, { headers: { Authorization: `Bearer ${token}` } }),
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  } catch (e) {
    if (e instanceof Response) res = e; else throw e;
  }
  return { status: res.status, body: JSON.parse(await res.text()) };
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

test('1. the default read: as_of stays null; as_of_default is the Worker\'s UTC date and read_at the instant', async () => {
  const before = Date.now();
  const r = await call(fixture(), '/positions/analytics');
  const after = Date.now();
  assert.equal(r.status, 200);
  assert.equal(r.body.as_of, null, 'as_of keeps its meaning: no cut was asked');
  assert.match(r.body.read_at, ISO_INSTANT);
  const at = Date.parse(r.body.read_at);
  assert.ok(at >= before - 5 && at <= after + 5, 'read_at is the moment of this read');
  assert.equal(r.body.as_of_default, r.body.read_at.slice(0, 10), 'the default date is read_at\'s UTC day');
  // Every flow and the latest mark count, as before.
  assert.equal(r.body.position_count, 2);
  assert.equal(r.body.paid_in, 1100);
  assert.equal(r.body.nav, 1200 + 500, 'latest mark for 6, cost for unmarked 7');
});

test('2. an explicit as_of still cuts the read at that date; the Worker clock fields ride along', async () => {
  const r = await call(fixture(), '/positions/analytics?as_of=2026-06-30');
  assert.equal(r.status, 200);
  assert.equal(r.body.as_of, '2026-06-30');
  assert.equal(r.body.position_count, 1, 'the August cheque is after the cut');
  assert.equal(r.body.nav, 900, 'the June mark, not the September one');
  assert.match(r.body.read_at, ISO_INSTANT);
  assert.equal(r.body.as_of_default, r.body.read_at.slice(0, 10), 'as_of_default is the Worker\'s date, not the date asked');
  assert.notEqual(r.body.as_of_default, r.body.as_of);
});
