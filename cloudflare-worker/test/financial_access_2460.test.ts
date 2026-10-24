/** #2460: real mounted routers and SQLite, synthetic principals only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import financials from '../src/routes/financials.ts';
import revenue from '../src/routes/revenue.ts';
import legal from '../src/routes/legal.ts';
import { userMayReadDeal } from '../src/routes/deals.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';

const JWT_SECRET = 'synthetic-2460-test-secret-not-a-credential';
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const roles = ['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring', 'partner', 'founder'];
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const name of ['users', 'projects', 'documents', 'deals', 'deal_invitations', 'commitments']) db.exec(tableFromBaseline(baseline, name));
  db.exec('CREATE TABLE user_company_links (id INTEGER PRIMARY KEY, company_id INTEGER, user_id INTEGER)');
  const user = db.prepare('INSERT INTO users (id, role, founder_id, email, name, is_active) VALUES (?, ?, ?, ?, ?, 1)');
  // All external roles carry a residual matching founder_id: role must still gate access.
  roles.forEach((role, i) => user.run(i + 1, role, i === 7 ? 200 : i === 6 ? null : 100, `fixture-${i}@example.invalid`, `Synthetic member ${i}`));
  db.exec("INSERT INTO projects (id, name, founder_id, company_id) VALUES (1, 'Synthetic venture', 100, 10)");
  db.exec("INSERT INTO documents (id, project_id, title, doc_type, content) VALUES (1, 1, 'Synthetic document', 'other', 'private fixture')");
  db.exec('INSERT INTO deals (id, project_id) VALUES (1, 1)');
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  return { db, env };
}
const app = new Hono();
app.route('/financials', financials as any);
app.route('/revenue', revenue as any);
app.route('/legal', legal as any);
app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function call(env: any, who: number, method: string, path: string, body?: unknown, company?: number) {
  const token = await new SignJWT({ user_id: who, role: roles[who - 1] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (company !== undefined) headers['X-Company-Id'] = String(company);
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
}
// #2462: a save records every driver; a partial set is refused with 400.
const drivers = { starting_cash: 12345, price_per_unit: 10, units_month_0: 5, monthly_growth_pct: 2, cac: 4, monthly_churn_pct: 3, salaries_monthly: 10, opex_monthly: 10, gross_margin_pct: 70, horizon_months: 24 };
async function seed(env: any) {
  assert.equal((await call(env, 2, 'PUT', '/financials/1', { assumptions: drivers })).status, 200);
}
for (const who of [3, 4, 5, 6, 7, 8]) {
  test(`${roles[who - 1]} ${who}: no model, export, recompute, save, revenue or legal document access`, async () => {
    const { db, env } = fixture();
    try {
      await seed(env);
      const before = db.prepare('SELECT * FROM financial_models').all();
      for (const [method, path] of [
        ['GET', '/financials/1'], ['GET', '/financials/1/export.xlsx'],
        ['POST', '/financials/1/recompute'], ['PUT', '/financials/1'],
        ['GET', '/revenue/projects/1/entries'],
      ]) {
        const response = await call(env, who, method, path, method === 'PUT' ? { assumptions: {} } : undefined);
        assert.ok([403, 404].includes(response.status), `${method} ${path}: ${response.status}`);
      }
      for (const path of ['/legal/documents', '/legal/documents?project_id=1']) {
        const response = await call(env, who, 'GET', path);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), []);
      }
      assert.equal((await call(env, who, 'GET', '/legal/documents/1')).status, 403);
      assert.deepEqual(db.prepare('SELECT * FROM financial_models').all(), before, 'refused callers cannot alter any stored model field');
    } finally { db.close(); }
  });
}
for (const who of [1, 2]) {
  test(`${roles[who - 1]}: reads, saves, exports and recomputes the model`, async () => {
    const { db, env } = fixture();
    try {
      await seed(env);
      assert.equal((await call(env, who, 'GET', '/financials/1')).status, 200);
      assert.equal((await call(env, who, 'PUT', '/financials/1', { assumptions: { ...drivers, starting_cash: 54321 } })).status, 200);
      db.exec("UPDATE financial_models SET computed_json = '{}', updated_at = 'unchanged-sentinel'");
      assert.equal((await call(env, who, 'POST', '/financials/1/recompute')).status, 200);
      const row = db.prepare('SELECT computed_json, updated_at FROM financial_models').get() as any;
      assert.notEqual(row.computed_json, '{}');
      assert.notEqual(row.updated_at, 'unchanged-sentinel');
      assert.equal((await call(env, who, 'GET', '/financials/1/export.xlsx')).status, 200);
      assert.equal((await call(env, who, 'GET', '/revenue/projects/1/entries')).status, 200);
      assert.equal((await call(env, who, 'GET', '/legal/documents/1')).status, 200);
    } finally { db.close(); }
  });
}
test('partner has no company exemption; admin keeps its exemption, founder stays in the selected company', async () => {
  const { db, env } = fixture();
  try {
    db.exec('INSERT INTO user_company_links (company_id, user_id) VALUES (99, 3), (10, 2), (99, 2), (99, 1)');
    for (const path of ['/financials/1', '/financials/1/export.xlsx', '/revenue/projects/1/entries']) {
      assert.equal((await call(env, 3, 'GET', path, undefined, 99)).status, 404);
      assert.equal((await call(env, 2, 'GET', path, undefined, 99)).status, 404);
      assert.equal((await call(env, 2, 'GET', path, undefined, 10)).status, 200);
      assert.equal((await call(env, 1, 'GET', path, undefined, 99)).status, 200);
    }
  } finally { db.close(); }
});
test('deal-room reader preserves the separate partner permission', async () => {
  const { db, env } = fixture();
  try {
    assert.equal(await userMayReadDeal(env, { id: 3, role: 'partner' } as any, 1), true);
    assert.equal(await userMayReadDeal(env, { id: 4, role: 'investor' } as any, 1), false);
  } finally { db.close(); }
});
// After removing blanket reads, financials currently has no read-only principal.
// Pin the write gate independently so adding a future relationship reader cannot
// silently reintroduce writes through a view check. Mounted tests above verify
// refusals leave both computed results and timestamps unchanged.
test('recompute is protected by the edit policy before schema or model work', () => {
  const source = readFileSync(new URL('../src/routes/financials.ts', import.meta.url), 'utf8');
  const handler = source.split("financials.post('/:projectId/recompute',")[1].split('// CSV export')[0];
  assert.match(handler, /ensureCanEdit\(project, user\);\s*await ensureFinancialsModelSchema/);
  assert.doesNotMatch(handler, /ensureCanView\(/);
});
