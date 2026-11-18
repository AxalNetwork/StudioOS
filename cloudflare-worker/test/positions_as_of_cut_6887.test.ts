/**
 * D6887 (#6887): `GET /api/positions?as_of=` cuts the rows at the date, not
 * only the marks. A cheque is dated as `/positions/analytics` dates it (its
 * position date when that is YYYY-MM-DD, else when it was recorded) and counts
 * on or before `as_of`, so:
 *
 *   - the rows' summed `total_invested` equals the analytics `paid_in` for the
 *     same date (and without a date);
 *   - a company funded only after the date is not listed;
 *   - `rounds`, `latest_round` and `latest_ownership_pct` stop at the date;
 *   - each row carries `first_date`, the first cheque's date;
 *   - without `as_of` the list is unchanged.
 *
 * Fixed dates throughout; nothing reads the clock.
 *
 * Mutation checked (fails with the mutation, passes without):
 *   - the rows query's cut made always-true (`<= ? OR 1`) → tests 1, 2, 3, 6, 7;
 *   - `null` bound for the rows query's date → tests 1, 2, 3, 6, 7;
 *   - the latest-round subquery's cut made always-true → test 3;
 *   - the rows query's YYYY-MM-DD check dropped (always `position_date`) → tests 1, 2, 4;
 *   - the latest-round subquery's YYYY-MM-DD check dropped → test 4;
 *   - `<= ?` changed to `< ?` in the rows query → test 7;
 *   - the `first_date` field removed → tests 3, 5.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/positions_as_of_cut_6887.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import positions from '../src/routes/positions.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d6887-0123456789abcdef';
const ADMIN = 1;
const CUT = '2026-06-30';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.prepare(`INSERT INTO users (id, role, founder_id, name, email, is_active, investor_tier, investor_subscription_status)
    VALUES (?, 'admin', NULL, 'Ada', 'ada@axal.example', 1, 'free', 'active')`).run(ADMIN);
  db.exec(`
    INSERT INTO projects (id, uid, name, founder_id) VALUES
      (6, 'p6', 'Venture Six', 60), (7, 'p7', 'Venture Seven', 70), (8, 'p8', 'Venture Eight', 80);
    INSERT INTO portfolio_positions (uid, fund_id, project_id, round_name, invested_amount, ownership_pct, position_date, created_by, created_at) VALUES
      -- Six: one cheque before the cut, one after.
      ('pos6a', NULL, 6, 'Seed', 600, 6, '2026-02-01', ${ADMIN}, '2026-02-01 09:00:00'),
      ('pos6b', NULL, 6, 'Series A', 400, 9, '2026-09-01', ${ADMIN}, '2026-09-01 09:00:00'),
      -- Seven: funded only after the cut.
      ('pos7', NULL, 7, 'Seed', 500, 5, '2026-08-10', ${ADMIN}, '2026-08-10 09:00:00'),
      -- Eight: a free-text position date; analytics dates it by when it was recorded (March).
      ('pos8', NULL, 8, 'Pre-seed', 250, 3, 'Q1 2026', ${ADMIN}, '2026-03-15 10:00:00');
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

const ids = (items: any[]) => items.map((i) => i.project_id).sort((a, b) => a - b);
const invested = (items: any[]) => items.reduce((s, i) => s + i.total_invested, 0);

test('1. with as_of, the rows\' invested total equals the analytics paid_in for that date', async () => {
  const db = fixture();
  const list = await call(db, `/positions?as_of=${CUT}`);
  const an = await call(db, `/positions/analytics?as_of=${CUT}`);
  assert.equal(list.status, 200);
  assert.equal(an.status, 200);
  assert.equal(an.body.paid_in, 600 + 250);
  assert.equal(invested(list.body.items), an.body.paid_in);
});

test('2. a company funded only after the date is not listed; it is without a date', async () => {
  const db = fixture();
  const cut = await call(db, `/positions?as_of=${CUT}`);
  assert.deepEqual(ids(cut.body.items), [6, 8], 'Seven\'s only cheque is in August');
  const all = await call(db, '/positions');
  assert.deepEqual(ids(all.body.items), [6, 7, 8]);
});

test('3. rounds and the latest round stop at the date', async () => {
  const r = await call(fixture(), `/positions?as_of=${CUT}`);
  const six = r.body.items.find((i: any) => i.project_id === 6);
  assert.equal(six.total_invested, 600);
  assert.equal(six.rounds, 1);
  assert.equal(six.latest_round, 'Seed', 'the September Series A is after the cut');
  assert.equal(six.latest_ownership_pct, 6);
  assert.equal(six.latest_date, '2026-02-01');
  assert.equal(six.first_date, '2026-02-01');
  assert.equal(six.vintage, 2026);
});

test('4. a free-text position date is dated by when the cheque was recorded, as analytics does', async () => {
  const r = await call(fixture(), `/positions?as_of=${CUT}`);
  const eight = r.body.items.find((i: any) => i.project_id === 8);
  assert.ok(eight, 'recorded in March, so on or before the cut');
  assert.equal(eight.total_invested, 250);
  assert.equal(eight.latest_round, 'Pre-seed', 'the latest-round lookup dates it the same way');
});

test('5. without as_of the list is the whole book, still equal to analytics paid_in', async () => {
  const db = fixture();
  const list = await call(db, '/positions');
  const an = await call(db, '/positions/analytics');
  const six = list.body.items.find((i: any) => i.project_id === 6);
  assert.equal(six.total_invested, 1000);
  assert.equal(six.rounds, 2);
  assert.equal(six.latest_round, 'Series A');
  assert.equal(six.latest_ownership_pct, 9);
  assert.equal(six.first_date, '2026-02-01');
  assert.equal(invested(list.body.items), 1750);
  assert.equal(invested(list.body.items), an.body.paid_in);
});

test('6. a date before every cheque lists nothing, and analytics agrees', async () => {
  const db = fixture();
  const list = await call(db, '/positions?as_of=2026-01-01');
  const an = await call(db, '/positions/analytics?as_of=2026-01-01');
  assert.deepEqual(list.body.items, []);
  assert.equal(an.body.paid_in, 0);
});

test('7. a cheque dated on as_of counts, as it does in analytics', async () => {
  const db = fixture();
  const list = await call(db, '/positions?as_of=2026-02-01');
  const an = await call(db, '/positions/analytics?as_of=2026-02-01');
  assert.deepEqual(ids(list.body.items), [6]);
  assert.equal(invested(list.body.items), 600);
  assert.equal(an.body.paid_in, 600);
});
