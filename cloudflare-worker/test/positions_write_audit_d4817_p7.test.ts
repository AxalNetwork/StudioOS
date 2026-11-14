/**
 * D4817 part 7 (#5311, canvas PF-07): the two money writes an admin records
 * against a company's position, `POST /api/positions/:projectUid/marks` and
 * `/distributions`, now leave an audit row in both stores
 * (`logAdminAction`: `activity_logs` and `admin_audit_log`). A mark or a
 * distribution moves the figures every holder of the company reads, so it is
 * a write on their behalf; before this part neither route recorded who made
 * it anywhere but the row's `created_by`.
 *
 * Real schema (`loadSchema`), the real route, synthetic fixtures only.
 *
 * Mutation checked, each both ways (fails with the mutation, passes without):
 *   - the mark route's `logAdminAction` call removed → test 1;
 *   - the distribution route's `logAdminAction` call removed → test 2;
 *   - the audit written before the validation (so a refused write is
 *     audited) → test 3.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/positions_write_audit_d4817_p7.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import positions from '../src/routes/positions.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d4817-part7-0123456789';
const ADMIN = 1, INVESTOR = 2;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare(`INSERT INTO users (id, role, founder_id, name, email, is_active, investor_tier, investor_subscription_status)
    VALUES (?, ?, NULL, ?, ?, 1, ?, 'active')`);
  u.run(ADMIN, 'admin', 'Ada', 'ada@axal.example', 'free');
  u.run(INVESTOR, 'investor', 'Ivo', 'ivo@fund.example', 'professional');
  db.exec(`INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p7', 'Venture Seven', 70);`);
  return db;
}

const app = new Hono<any>();
app.route('/api/positions', positions);

async function post(db: DatabaseSync, userId: number, path: string, body: unknown) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any)?.role ?? 'founder';
  const token = await new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  let res: Response;
  try {
    res = await app.fetch(new Request(`http://t/api${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  } catch (e) {
    if (e instanceof Response) res = e; else throw e;
  }
  const text = await res.text();
  let parsed: any = null; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

const activity = (db: DatabaseSync, action: string) =>
  db.prepare('SELECT action, details, user_id FROM activity_logs WHERE action = ?').all(action) as any[];
const auditLog = (db: DatabaseSync, action: string) => {
  try { return db.prepare('SELECT admin_user_id, action, filters_json FROM admin_audit_log WHERE action = ?').all(action) as any[]; }
  catch { return []; }
};

test('a recorded mark leaves one audit row in each store, naming the company and the mark', async () => {
  const db = fixture();
  const res = await post(db, ADMIN, '/positions/p7/marks', { fmv: 2100000, as_of_date: '2026-09-30', basis: 'gp_estimate', event: 'Down round' });
  assert.equal(res.status, 201);
  const [row] = activity(db, 'portfolio.mark_recorded');
  assert.ok(row, 'no activity_logs row for the mark (mutation: the call removed)');
  assert.equal(Number(row.user_id), ADMIN);
  const details = JSON.parse(row.details);
  assert.deepEqual(details, { project_uid: 'p7', mark_uid: res.body.uid, as_of_date: '2026-09-30', fmv: 2100000, basis: 'gp_estimate', fund_id: null });
  const [admin] = auditLog(db, 'portfolio.mark_recorded');
  assert.ok(admin, 'no admin_audit_log row for the mark');
  assert.equal(Number(admin.admin_user_id), ADMIN);
});

test('a recorded distribution leaves one audit row in each store, naming the company and the distribution', async () => {
  const db = fixture();
  const res = await post(db, ADMIN, '/positions/p7/distributions', { amount: 150000, distribution_date: '2026-11-05', kind: 'secondary' });
  assert.equal(res.status, 201);
  const rows = activity(db, 'portfolio.distribution_recorded');
  assert.equal(rows.length, 1, 'expected one activity_logs row (mutation: the call removed)');
  assert.deepEqual(JSON.parse(rows[0].details), {
    project_uid: 'p7', distribution_uid: res.body.uid, distribution_date: '2026-11-05', amount: 150000, kind: 'secondary', fund_id: null,
  });
  assert.equal(auditLog(db, 'portfolio.distribution_recorded').length, 1);
});

test('a refused write is not audited, and a non-admin is refused', async () => {
  const db = fixture();
  assert.equal((await post(db, ADMIN, '/positions/p7/marks', { fmv: -1, as_of_date: '2026-09-30' })).status, 400);
  assert.equal((await post(db, ADMIN, '/positions/p7/distributions', { amount: 0, distribution_date: '2026-11-05' })).status, 400);
  assert.notEqual((await post(db, INVESTOR, '/positions/p7/marks', { fmv: 5, as_of_date: '2026-09-30' })).status, 201);
  assert.equal(activity(db, 'portfolio.mark_recorded').length, 0, 'a refused mark was audited');
  assert.equal(activity(db, 'portfolio.distribution_recorded').length, 0, 'a refused distribution was audited');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM portfolio_marks').get() as any).n, 0);
});
