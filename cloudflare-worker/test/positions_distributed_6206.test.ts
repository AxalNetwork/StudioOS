/**
 * D6206 (#6206): `GET /api/positions` returns each company's distributed total.
 *
 *   - each row carries `distributed`, Σ its recorded `portfolio_distributions`
 *     (a positive amount with a YYYY-MM-DD date), the rule `/analytics` uses;
 *   - a company with no distribution reads a measured 0, not null;
 *   - `?as_of=` cuts the distributions at the date, as it cuts the cheques;
 *   - the rows' Σ distributed plus `distributions.unlisted` equals
 *     `distributions.total`, which equals the analytics `distributed`;
 *   - a failed distributions read (thrown, unsuccessful, malformed, missing)
 *     makes only the distributions unavailable: rows, invested and marks still
 *     answer, each row's `distributed` is null, and the read is 200.
 *
 * Fixed dates throughout; nothing reads the clock.
 *
 * Mutation checked (fails with the mutation, passes without):
 *   - the `asOf` cut dropped from `distributedByProject` → tests 3, 4, 5;
 *   - `date > asOf` changed to `date >= asOf` → tests 3, 4, 5;
 *   - the positive-amount and dated filter dropped → tests 1, 3, 4, 5;
 *   - a company with no distribution answered null instead of 0 → test 2;
 *   - the `hasQueryResults` check replaced by an empty set → every test 6;
 *   - `unlisted` always 0 → test 5.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/positions_distributed_6206.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import positions from '../src/routes/positions.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d6206-0123456789abcdef';
const ADMIN = 1;
const CUT = '2026-06-30';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.prepare(`INSERT INTO users (id, role, founder_id, name, email, is_active, investor_tier, investor_subscription_status)
    VALUES (?, 'admin', NULL, 'Ada', 'ada@axal.example', 1, 'free', 'active')`).run(ADMIN);
  db.exec(`
    INSERT INTO projects (id, uid, name, founder_id) VALUES
      (6, 'p6', 'Venture Six', 60), (7, 'p7', 'Venture Seven', 70), (9, 'p9', 'Venture Nine', 90);
    INSERT INTO portfolio_positions (uid, fund_id, project_id, round_name, invested_amount, ownership_pct, position_date, created_by, created_at) VALUES
      ('pos6', NULL, 6, 'Seed', 600, 6, '2025-02-01', ${ADMIN}, '2025-02-01 09:00:00'),
      ('pos7', NULL, 7, 'Seed', 500, 5, '2026-01-10', ${ADMIN}, '2026-01-10 09:00:00');
    INSERT INTO portfolio_marks (uid, fund_id, project_id, as_of_date, fmv, basis) VALUES
      ('m6', NULL, 6, '2026-03-31', 900, 'gp_estimate');
    INSERT INTO portfolio_distributions (uid, fund_id, project_id, distribution_date, amount, kind) VALUES
      -- Six: one before the cut, one on it, one after.
      ('d6a', NULL, 6, '2026-03-01', 100, 'dividend'),
      ('d6b', NULL, 6, '${CUT}', 50, 'dividend'),
      ('d6c', NULL, 6, '2026-09-01', 200, 'secondary'),
      -- Six: not counted by analytics either (no usable date; not a positive amount).
      ('d6d', NULL, 6, 'sometime', 999, 'exit'),
      ('d6e', NULL, 6, '2026-04-01', 0, 'exit'),
      -- Nine: a distribution recorded against a company with no position.
      ('d9', NULL, 9, '2026-05-01', 70, 'exit');
  `);
  return db;
}

// Only inject the failure; every other statement still runs against the schema.
function failingRead(db: DatabaseSync, failure: string | null) {
  const binding = d1Over(db);
  if (!failure) return binding;
  return {
    ...binding,
    prepare(sql: string) {
      const stmt = binding.prepare(sql);
      if (!/\bFROM\s+portfolio_distributions\b/i.test(sql)) return stmt;
      const fail = {
        bind() { return fail; },
        async all() {
          if (failure === 'throw') throw new Error('injected read failure');
          if (failure === 'unsuccessful') return { success: false, results: [] };
          if (failure === 'missing') return undefined;
          return { success: true };
        },
      };
      return fail;
    },
  };
}

const app = new Hono<any>();
app.route('/api/positions', positions);

async function call(db: DatabaseSync, path: string, failure: string | null = null) {
  const token = await new SignJWT({ user_id: ADMIN, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  let res: Response;
  try {
    res = await app.fetch(new Request(`http://t/api${path}`, { headers: { Authorization: `Bearer ${token}` } }),
      { JWT_SECRET, ENVIRONMENT: 'development', DB: failingRead(db, failure) } as any);
  } catch (e) {
    if (e instanceof Response) res = e; else throw e;
  }
  return { status: res.status, body: JSON.parse(await res.text()) };
}

const row = (body: any, pid: number) => body.items.find((i: any) => i.project_id === pid);
const listed = (body: any) => body.items.reduce((s: number, i: any) => s + i.distributed, 0);

test('1. each company carries its recorded distributed total, by the analytics rule', async () => {
  const r = await call(fixture(), '/positions');
  assert.equal(r.status, 200);
  assert.equal(row(r.body, 6).distributed, 350, 'undated and zero rows are not distributions');
  assert.equal(r.body.distributions.available, true);
});

test('2. a company with no distribution reads a measured 0, not null', async () => {
  const r = await call(fixture(), '/positions');
  assert.strictEqual(row(r.body, 7).distributed, 0);
});

test('3. as_of cuts the distributions at the date', async () => {
  const r = await call(fixture(), `/positions?as_of=${CUT}`);
  assert.equal(row(r.body, 6).distributed, 150, 'the September secondary is after the cut');
  assert.equal(r.body.distributions.total, 150 + 70);
});

test('4. a distribution dated on as_of counts', async () => {
  const r = await call(fixture(), '/positions?as_of=2026-03-01');
  assert.equal(row(r.body, 6).distributed, 100);
});

test('5. the rows plus the unlisted part reconcile to the analytics distributed', async () => {
  const db = fixture();
  for (const q of ['', `?as_of=${CUT}`]) {
    const list = await call(db, `/positions${q}`);
    const an = await call(db, `/positions/analytics${q}`);
    assert.equal(an.status, 200);
    assert.equal(list.body.distributions.unlisted, 70, 'Nine has a distribution and no position');
    assert.equal(listed(list.body) + list.body.distributions.unlisted, list.body.distributions.total);
    assert.equal(list.body.distributions.total, an.body.distributed);
  }
});

for (const failure of ['throw', 'unsuccessful', 'malformed', 'missing']) {
  test(`6. a ${failure} distributions read is unavailable for distributions only`, async () => {
    const r = await call(fixture(), '/positions', failure);
    assert.equal(r.status, 200, 'the rest of the read still answers');
    assert.deepEqual(r.body.distributions, { available: false, reason: 'Portfolio distributions could not be read.' });
    const six = row(r.body, 6);
    assert.strictEqual(six.distributed, null, 'never a fabricated 0');
    assert.strictEqual(row(r.body, 7).distributed, null);
    assert.equal(six.total_invested, 600);
    assert.equal(six.fmv, 900);
  });
}
