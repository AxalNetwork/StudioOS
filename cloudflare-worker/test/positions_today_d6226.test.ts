/**
 * D6226 (#6226) — the three positions reads carry the Worker's own UTC date as
 * `today`, so a page ages a mark against the Worker and never the browser.
 *
 *   GET /api/positions            → `today`
 *   GET /api/positions/analytics  → `today`, and `as_of` still null when no
 *                                   date was asked (its meaning is unchanged)
 *   GET /api/positions/:uid       → `today`
 *
 * The clock is fixed at 2026-11-14 23:59:30Z, so a read that used a local
 * date or a fixed string instead of the Worker's UTC day would show.
 *
 * Mutations checked (each fails here, and passes again when reverted):
 *   - drop `today` from the list read                 → test 1 fails
 *   - drop `today` from the analytics read            → test 2 fails
 *   - analytics `today` set to the asked `as_of`      → test 2 fails
 *   - analytics `as_of` set to the Worker's date      → test 2 fails
 *   - drop `today` from the per-company read          → test 3 fails
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/positions_today_d6226.test.ts
 */
import test, { before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import positions from '../src/routes/positions.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const NOW = Date.parse('2026-11-14T23:59:30Z');
before(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
after(() => mock.timers.reset());

const JWT_SECRET = 'unit-test-jwt-secret-d6226-positions-today-0123';
const ADMIN = 1;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`
    INSERT INTO users (id, role, name, email, is_active, investor_tier, investor_subscription_status)
      VALUES (${ADMIN}, 'admin', 'Ada', 'ada@axal.example', 1, 'free', 'active');
    INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p7', 'Venture Seven', 70);
    INSERT INTO portfolio_positions (uid, fund_id, project_id, round_name, invested_amount, ownership_pct, position_date, created_by)
      VALUES ('pos7', NULL, 7, 'Seed', 500, 5, '2026-01-10', ${ADMIN});
    INSERT INTO portfolio_marks (uid, project_id, as_of_date, fmv, basis) VALUES ('m7', 7, '2026-03-31', 900, 'round_price');
  `);
  return db;
}

const app = new Hono<any>();
app.route('/api/positions', positions);

async function call(db: DatabaseSync, path: string) {
  const token = await new SignJWT({ user_id: ADMIN, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t/api${path}`, { headers: { Authorization: `Bearer ${token}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: await res.json() as any };
}

test('the list read carries the Worker date beside its items', async () => {
  const { status, body } = await call(fixture(), '/positions');
  assert.equal(status, 200);
  assert.equal(body.today, '2026-11-14');
  assert.equal(body.items.length, 1, 'the items are unchanged');
  assert.equal(body.items[0].mark_as_of, '2026-03-31');
  // An as-of read still says the Worker's date, not the date asked.
  assert.equal((await call(fixture(), '/positions?as_of=2026-06-30')).body.today, '2026-11-14');
});

test('the analytics read carries the Worker date, and as_of keeps its meaning', async () => {
  const db = fixture();
  const latest = await call(db, '/positions/analytics');
  assert.equal(latest.status, 200);
  assert.equal(latest.body.today, '2026-11-14');
  assert.equal(latest.body.as_of, null, 'no date was asked, so as_of stays null');
  assert.equal(latest.body.position_count, 1);

  const dated = await call(db, '/positions/analytics?as_of=2026-06-30');
  assert.equal(dated.body.as_of, '2026-06-30');
  assert.equal(dated.body.today, '2026-11-14', 'today is the Worker date, not the date asked');
});

test('the per-company read carries the Worker date beside its marks', async () => {
  const { status, body } = await call(fixture(), '/positions/p7');
  assert.equal(status, 200);
  assert.equal(body.today, '2026-11-14');
  assert.equal(body.rollup.latest_mark_as_of, '2026-03-31');
});
