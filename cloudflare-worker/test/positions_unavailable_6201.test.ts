/** D6201 (#6201): failed Portfolio sub-reads never become successful empty sets. */
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

// Only inject the failure; every successful statement still executes against the schema.
function failingRead(db: DatabaseSync, table: string, failure: string) {
  const binding = d1Over(db);
  return {
    ...binding,
    prepare(sql: string) {
      const stmt = binding.prepare(sql);
      if (!table || !new RegExp(`\\bFROM\\s+${table}\\b`, 'i').test(sql)) return stmt;
      const fail = {
        bind() { return fail; },
        async all() {
          if (failure === 'throw') throw new Error('injected read failure');
          if (failure === 'unsuccessful') return { success: false, results: [] };
          return { success: true };
        },
      };
      return fail;
    },
  };
}

const app = new Hono<any>();
app.route('/api/positions', positions);

async function call(db: DatabaseSync, path: string, failedTable = '', failure = 'throw') {
  const token = await new SignJWT({ user_id: ADMIN, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  let res: Response;
  try {
    res = await app.fetch(new Request(`http://t/api${path}`, { headers: { Authorization: `Bearer ${token}` } }),
      { JWT_SECRET, ENVIRONMENT: 'development', DB: failingRead(db, failedTable, failure) } as any);
  } catch (e) {
    if (e instanceof Response) res = e; else throw e;
  }
  return { status: res.status, body: JSON.parse(await res.text()) };
}


for (const [path, table, reason] of [
  ['/positions/analytics', 'portfolio_distributions', 'Portfolio distributions could not be read.'],
  ['/positions/kpi-compliance', 'portfolio_kpi_definitions', 'Required KPIs could not be read.'],
  ['/positions/kpi-compliance', 'portfolio_updates', 'Submitted portfolio updates could not be read.'],
]) {
  for (const failure of ['throw', 'unsuccessful', 'malformed']) {
    test(`${table}: ${failure} is unavailable, never fabricated successful figures or a chase population`, async () => {
      const db = fixture();
      try {
        const r = await call(db, path, table, failure);
        assert.equal(r.status, 503);
        assert.deepEqual(r.body, { available: false, reason, detail: reason });
      } finally { db.close(); }
    });
  }
}

test('successful empty reads still answer the existing analytics and compliance shapes', async () => {
  const db = fixture();
  try {
    const a = await call(db, '/positions/analytics');
    assert.equal(a.status, 200);
    assert.equal(a.body.distributed, 0);
    const c = await call(db, '/positions/kpi-compliance');
    assert.equal(c.status, 200);
    assert.equal(c.body.companies.length, 2);
    assert.equal(c.body.reported_count, 0);
  } finally { db.close(); }
});
