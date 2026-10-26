/** D1149: real routers and SQLite; no provider requests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import deals, { serializeDeal } from '../src/routes/deals.ts';
import dd from '../src/routes/dd.ts';
import { requireInvestorTierExcept } from '../src/middleware/requireInvestorTier.ts';
import { mintDownloadToken } from '../src/services/signedDownload.ts';
import { investorHasDealRelationship } from '../src/services/dealAccess.ts';

const SECRET = 'x'.repeat(64);
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, '');
function fixture() {
  const { DB, db } = makeD1('');
  for (const name of ['users', 'founders', 'projects', 'partners', 'deals', 'deal_invitations', 'commitments', 'investor_dealroom_members', 'user_company_links', 'activity_logs', 'deal_stage_events', 'dd_cases', 'dd_sections', 'dd_checklist_items', 'dd_audit_log', 'dd_reviewers']) { try { db.exec(stripForeignKeys(tableFromBaseline(baseline, name))); } catch (e) { throw new Error('Fixture table: ' + name, { cause: e }); } }
  // Read the new column's actual migration, including its backfill default.
  db.exec(readFileSync(new URL('../sql/migrations/599_deal_currency.sql', import.meta.url), 'utf8'));
  db.exec("ALTER TABLE deals ADD COLUMN source TEXT;");
  // D1246: the DD router reads and writes migration 620's case lifecycle columns.
  db.exec(readFileSync(new URL('../sql/migrations/620_dd_case_lifecycle.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../sql/migrations/623_dd_team_templates.sql', import.meta.url), 'utf8'));
  for (const [id, role, tier, fid] of [[1, 'investor', 'professional', null], [2, 'investor', 'professional', null], [3, 'investor', 'professional', null], [4, 'investor', 'free', null], [5, 'founder', null, 50], [6, 'admin', null, null], [7, 'investor', 'free', null]] as const) {
    db.prepare("INSERT INTO users(id,email,name,role,founder_id,investor_tier,investor_subscription_status) VALUES(?,?,?,?,?,?,'active')").run(id, `synthetic${id}@example.test`, `Synthetic ${id}`, role, fid, tier ?? 'free');
  }
  db.exec(`INSERT INTO founders(id,name,email) VALUES(50,'Synthetic owner','synthetic5@example.test');
    INSERT INTO projects(id,name,sector,founder_id) VALUES(10,'Synthetic venture','Synthetic sector',50);
    INSERT INTO deals(id,project_id,status,notes,description,target_raise,minimum_check,valuation_cap,closing_deadline,instrument) VALUES(100,10,'active','PRIVATE STUDIO NOTE','PRIVATE DESCRIPTION',100000,1000,500000,'2026-12-01','SAFE');
    INSERT INTO investor_dealroom_members(investor_user_id,deal_id) VALUES(1,100);
    INSERT INTO deal_invitations(deal_id,investor_user_id,status) VALUES(100,2,'invited'),(100,4,'invited');
    INSERT INTO commitments(uid,deal_id,investor_user_id,amount,status) VALUES('paid',100,3,25000,'confirmed');`);
  const env: any = { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono(); const gate = requireInvestorTierExcept('professional');
  app.use('/api/deals', gate); app.use('/api/deals/*', gate); app.use('/api/dd/*', gate);
  app.route('/api/deals', deals); app.route('/api/dd', dd);
  app.onError((e, c) => e instanceof Response ? e : c.json({ error: e.message === 'Unauthorized' ? 'Unauthorized' : 'fixture_error' }, e.message === 'Unauthorized' ? 401 : 500));
  return { DB, db, env, app };
}
async function call(f: ReturnType<typeof fixture>, who: number | null, method: string, path: string, body?: unknown) {
  const headers: Record<string,string> = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await f.app.request('/api' + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, f.env).catch((e) => { if (e instanceof Response) return e; throw e; });
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

test('a joined-only investor is refused the deal and DD; invited and committed investors use the same rule', async () => {
  const f = fixture();
  for (const who of [1, 2, 3]) {
    assert.equal(await investorHasDealRelationship(f.env, who, 100), who !== 1);
    assert.equal((await call(f, who, 'GET', '/deals/100')).status, who === 1 ? 403 : 200);
    const result = await call(f, who, 'POST', '/dd/cases', { subject_type: 'project', subject_id: 10, subject_label: 'Synthetic venture' });
    assert.equal(result.status, who === 1 ? 403 : 201, JSON.stringify(result.body));
  }
  const before = f.db.prepare('SELECT count(*) n FROM dd_cases').get().n;
  assert.equal((await call(f, 2, 'POST', '/dd/cases', { subject_type: 'project', subject_id: 999, subject_label: 'Other' })).status, 403);
  assert.equal(f.db.prepare('SELECT count(*) n FROM dd_cases').get().n, before);
  assert.equal((await call(f, null, 'GET', '/deals/100')).status, 401);
});

test('Free gets an authorized header/key strip only; all other deal reads and DD remain Professional', async () => {
  const f = fixture();
  const free = await call(f, 4, 'GET', '/deals/100');
  assert.equal(free.status, 200); assert.equal(free.body.plan_limited, true);
  assert.equal(free.body.project_name, 'Synthetic venture'); assert.equal(free.body.currency, 'USD');
  assert.equal(free.body.capital_committed, 25000);
  for (const name of ['notes','description','minimum_check','valuation_cap','project_id','founder_user_id','partner_name']) assert.equal(name in free.body, false, name);
  for (const path of ['/deals','/deals/100/documents','/deals/100/commitments','/deals/100/activity','/deals/dealroom/quota','/dd/cases']) assert.equal((await call(f, 4, 'GET', path)).status, 402, path);
  assert.equal((await call(f, 7, 'GET', '/deals/100')).status, 403);
  assert.equal((await call(f, 4, 'POST', '/deals/100/commitments', { amount: 5000 })).status, 402);
  const paid = await call(f, 2, 'GET', '/deals/100');
  assert.equal(paid.body.plan_limited, undefined); assert.equal(paid.body.description, 'PRIVATE DESCRIPTION'); assert.equal(paid.body.notes, undefined);
  assert.equal((await call(f, 5, 'GET', '/deals/100')).status, 200);
});

test('missing target or timestamps remain null while actual zero elapsed days and zero commitment remain zero', async () => {
  const f = fixture();
  f.db.exec("UPDATE deals SET target_raise=NULL,amount=NULL,stage_changed_at=NULL,updated_at='',created_at='' WHERE id=100");
  const read = await call(f, 2, 'GET', '/deals/100');
  assert.equal(read.status, 200); assert.equal(read.body.progress_pct, null); assert.equal(read.body.days_in_stage, null);
  assert.equal(serializeDeal({ target_raise: 100, capital_committed: 0, stage_changed_at: new Date().toISOString() }, 'investor').progress_pct, 0);
  assert.equal(serializeDeal({ target_raise: 100, capital_committed: 0, stage_changed_at: new Date().toISOString() }, 'investor').days_in_stage, 0);
  assert.equal(serializeDeal({ target_raise: 100, capital_committed: null }, 'investor').progress_pct, null);
});

test('migration gives old deals USD and preserves an explicit currency on reads', async () => {
  const f = fixture();
  assert.equal(f.db.prepare('SELECT currency FROM deals WHERE id=100').get().currency, 'USD');
  f.db.exec("UPDATE deals SET currency='EUR' WHERE id=100");
  assert.equal((await call(f, 2, 'GET', '/deals/100')).body.currency, 'EUR');
  assert.equal((await call(f, 4, 'GET', '/deals/100')).body.currency, 'EUR');
  assert.equal((await call(f, 6, 'PUT', '/deals/100', { currency: 'GBP', amount: 999 })).status, 409);
  assert.equal(f.db.prepare('SELECT currency FROM deals WHERE id=100').get().currency, 'EUR');
  assert.throws(() => f.db.exec("UPDATE deals SET currency='invalid' WHERE id=100"));
  const created = await call(f, 5, 'POST', '/deals', { project_id: 10, amount: 1000, currency: 'usd' });
  assert.equal(created.status, 201, JSON.stringify(created.body)); assert.equal(created.body.currency, 'USD');
  const count = f.db.prepare('SELECT count(*) n FROM deals').get().n;
  for (const [who, path] of [[5, '/deals'], [6, '/deals/draft']] as const) {
    const unsupported = await call(f, who, 'POST', path, { project_id: 10, amount: 1000, currency: 'EUR' });
    assert.equal(unsupported.status, 400); assert.equal(unsupported.body.code, 'currency_not_supported');
  }
  assert.equal(f.db.prepare('SELECT count(*) n FROM deals').get().n, count);
  assert.equal((await call(f, 5, 'POST', '/deals', { project_id: 10, currency: 'bad-code' })).status, 400);
});

test('join is an invitation request, never an entitlement to the deal or diligence', async () => {
  const f = fixture(); f.db.exec('DELETE FROM investor_dealroom_members WHERE investor_user_id=1');
  const request = await call(f, 1, 'POST', '/deals/100/dealroom/join');
  assert.equal(request.status, 200); assert.equal(request.body.requested, true);
  assert.equal(f.db.prepare('SELECT count(*) n FROM investor_dealroom_members WHERE investor_user_id=1').get().n, 1);
  assert.equal((await call(f, 1, 'GET', '/deals/100')).status, 403);
  assert.equal((await call(f, 1, 'POST', '/dd/cases', { subject_type: 'project', subject_id: 10, subject_label: 'Synthetic venture' })).status, 403);
  assert.equal((await call(f, 1, 'POST', '/deals/100/dealroom/join')).body.already_requested, true);
  const pending = (await call(f, 6, 'GET', '/deals/100/invitations')).body;
  assert.deepEqual(pending.filter((r: any) => r.status === 'requested').map((r: any) => r.investor_user_id), [1]);
  f.db.exec("INSERT INTO deal_invitations(deal_id,investor_user_id,status) VALUES(100,1,'invited')");
  const invited = (await call(f, 6, 'GET', '/deals/100/invitations')).body;
  assert.equal(invited.filter((r: any) => r.investor_user_id === 1).length, 1);
  assert.equal(invited.find((r: any) => r.investor_user_id === 1).status, 'invited');
});

test('an unreadable own commitment leaves the authorized Free header available', async () => {
  const f = fixture(); const prepare = f.DB.prepare;
  f.DB.prepare = (sql) => {
    const statement = prepare(sql);
    if (sql.includes('SELECT amount, status, created_at FROM commitments')) statement.first = async () => { throw new Error('synthetic read failure'); };
    return statement;
  };
  const read = await call(f, 4, 'GET', '/deals/100');
  assert.equal(read.status, 200); assert.equal(read.body.project_name, 'Synthetic venture');
  assert.equal(read.body.my_commitment_unreadable, true);
});


test('signed DD downloads retain token-only authentication, audience and replay checks', async () => {
  const f = fixture();
  f.db.exec(stripForeignKeys(tableFromBaseline(baseline, 'dd_reports')));
  const tokens = new Map();
  f.env.TOKENS = { put: async (k, v) => { tokens.set(k, v); }, get: async (k) => tokens.get(k), delete: async (k) => { tokens.delete(k); } };
  f.env.FILES = { get: async () => ({ body: 'Synthetic report' }) };
  const mint = (audience) => mintDownloadToken(f.env, { key: 'synthetic.html', audience });
  const download = (token) => f.app.request('/api/dd/reports/download/' + token, {}, f.env);
  const valid = await mint('dd_report');
  const response = await download(valid.token);
  assert.equal(response.status, 200); assert.equal(await response.text(), 'Synthetic report');
  assert.equal((await download(valid.token)).status, 403);
  assert.equal((await download((await mint('other')).token)).status, 403);
  const altered = await mint('dd_report');
  const [payload, signature] = altered.token.split('.');
  assert.equal((await download(payload + '.' + (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1))).status, 403);
  assert.equal((await call(f, null, 'GET', '/dd/cases')).status, 401);
});
