/**
 * D6084 (#6084): the Use of funds plan as CSV and PDF, and a dated snapshot in
 * the data room. Mounted handlers over canonical SQLite DDL, synthetic users.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/use_of_funds_export_6084.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleRaise from '../src/routes/cycle_raise.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { SECTION_KEYS } from '../src/services/useOfFunds/plan.ts';
import { planTables } from '../src/services/useOfFunds/exportPlan.ts';

const secret = 'synthetic-d6084-test-jwt-not-a-credential';
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migrations = ['442_raise_cycle_stores.sql', '463_raise_record_stores.sql', '436_round_calls.sql', '520_mercury_raise_feeds.sql', '249_project_metrics.sql',
  '606_use_of_funds_scenarios.sql', '202611082130_uof_scenario_revision.sql', '202611101555_5375_uof_hire_revision.sql', '607_raise_money_cents.sql', '596_data_room_file_source.sql']
  .map((n) => readFileSync(new URL(`../sql/migrations/${n}`, import.meta.url), 'utf8'));
// 1 founder (owns venture 1), 2 founder of another venture, 3 admin, 4 investor.
const roles = ['founder', 'founder', 'admin', 'investor'];
const app = new Hono(); app.route('/api/cycles/raise', cycleRaise as any);
const TODAY = new Date().toISOString().slice(0, 10);

function fixture({ files = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const name of ['founders', 'users', 'projects', 'activity_logs', 'user_company_links', 'company_profiles', 'super_admins', 'mi_pro_subscriptions',
    'roadmap_okrs', 'integrations', 'cap_table_scenarios', 'financial_models', 'raise_rounds', 'raise_prospects', 'raise_pro_rata', 'raise_closes',
    'spinout_deck_overrides', 'pitch_decks', 'pitch_deck_share_tokens', 'data_room_files']) db.exec(tableFromBaseline(baseline, name));
  for (const m of migrations) db.exec(m);
  db.exec(readFileSync(new URL('../sql/migrations/597_company_archive_and_events.sql', import.meta.url), 'utf8'));
  db.exec("INSERT INTO founders(id,name,email) VALUES(11,'Synthetic owner','owner@example.test'),(22,'Other owner','other@example.test'); INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES(1,'venture-one','Synthetic venture',11,10),(2,'venture-two','Other venture',22,20);");
  roles.forEach((role, i) => db.prepare('INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES(?,?,?,?,?,1)').run(i + 1, role, `Synthetic ${i + 1}`, `member-${i + 1}@example.test`, i === 1 ? 22 : 11));
  db.exec("INSERT INTO user_company_links(uid,user_id,company_id) VALUES('link-one',1,10)");
  const stored = new Map<string, Uint8Array>();
  const FILES = { async put(k: string, v: Uint8Array) { stored.set(k, v); }, async delete(k: string) { stored.delete(k); }, async get() { return null; }, async head() { return null; } };
  return { db, stored, env: { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development', ...(files ? { FILES } : {}) } as any };
}
async function call(f: any, method: string, path: string, body?: unknown, who = 1, extra: Record<string, unknown> = {}) {
  const token = await new SignJWT({ user_id: who, role: roles[who - 1], ...extra }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const res = await app.request(`/api/cycles/raise/use-of-funds${path}${path.includes('?') ? '&' : '?'}project=1`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, f.env);
  const type = res.headers.get('Content-Type') || '';
  return { status: res.status, type, disposition: res.headers.get('Content-Disposition'),
    body: type.includes('json') ? await res.json() as any : null, text: type.includes('csv') ? await res.text() : null,
    bytes: type.includes('pdf') ? new Uint8Array(await res.arrayBuffer()) : null };
}
const rows = (f: any, sql: string) => JSON.parse(JSON.stringify(f.db.prepare(sql).all()));
const lines = SECTION_KEYS.map((key, i) => ({ key, share_pct: i === 0 ? 60 : i === 1 ? 40 : 0 }));

/** A planned base: $1,200.00 raised in January, a split, one costed and one uncosted milestone, one hire. */
async function planned(f: any) {
  const plan = (await call(f, 'GET', '/plan')).body;
  const base = plan.base.value;
  const put = await call(f, 'PATCH', `/scenarios/${base.id}`, { expected_revision: base.revision ?? 0, amount_to_raise_cents: 120000, target_runway_months: 12, start_month: '2027-01', raise_month: '2027-01', cash_cents: 0, lines });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const rev = () => Number((rows(f, `SELECT revision FROM uof_scenarios WHERE id=${base.id}`)[0]).revision);
  assert.equal((await call(f, 'POST', '/milestones', { expected_revision: rev(), scenario_id: base.id, label: 'Launch', category_key: 'product', cost_cents: 50000, due_on: '2027-06-01' })).status, 201);
  assert.equal((await call(f, 'POST', '/milestones', { expected_revision: rev(), scenario_id: base.id, label: '=Hire a lead', category_key: 'go-to-market', due_on: null })).status, 201);
  f.db.exec("INSERT INTO use_of_funds_hires(project_id,category_key,role,start_month,annual_cents,currency) VALUES(1,'product','Engineer','2027-03',12000000,'usd')");
  return base;
}

test('D6084: the CSV holds the base plan, labels every modelled figure, and leaves a missing value empty', async () => {
  const f = fixture(); await planned(f);
  const r = await call(f, 'GET', '/export.csv');
  assert.equal(r.status, 200);
  assert.equal(r.disposition, `attachment; filename="use-of-funds-1-${TODAY}.csv"`);
  const csv = r.text!.split('\r\n');
  assert.equal(csv[0], `Use of funds: Synthetic venture,As of ${TODAY}`);
  assert.ok(csv.includes('Raise,1200.00,Typed,'));
  assert.ok(csv.includes('Opening cash,0.00,Typed,'), 'a typed zero is 0.00');
  assert.ok(csv.some((l) => /^Runway after the raise \(months\),[^,]*,Modelled,/.test(l)));
  assert.ok(csv.includes('Product & engineering,60,Typed,720.00,Modelled'));
  assert.ok(csv.includes('"Operations, legal & compliance",0,Typed,0.00,Modelled'), 'a typed 0% share is 0, its amount 0.00');
  assert.ok(csv.includes('Launch,Product & engineering,2027-06-01,500.00,Typed,Funded,Modelled'));
  assert.ok(csv.includes("'=Hire a lead,GTM: sales and marketing,,,,Not costed,Modelled"), 'no due date or cost: empty cells; a formula is neutralised');
  assert.ok(csv.includes('Engineer,Product & engineering,2027-03,120000.00,USD,Typed'));
  assert.doesNotMatch(r.text!, /Mercury|runway today/i);
  assert.deepEqual(rows(f, "SELECT action, details FROM activity_logs WHERE action LIKE 'uof_plan_%'"), [{ action: 'uof_plan_exported', details: 'Exported the plan as CSV.' }]);
});

test('D6084: the PDF is a PDF with the same tables, and is audited', async () => {
  const f = fixture(); await planned(f);
  const r = await call(f, 'GET', '/export.pdf');
  assert.equal(r.status, 200);
  assert.equal(r.type, 'application/pdf');
  assert.equal(new TextDecoder().decode(r.bytes!.slice(0, 5)), '%PDF-');
  assert.deepEqual(rows(f, "SELECT details FROM activity_logs WHERE action='uof_plan_exported'"), [{ details: 'Exported the plan as PDF.' }]);
});

test('D6084: Add to the data room files a dated PDF under NDA for nobody, and says where', async () => {
  const f = fixture(); await planned(f);
  const r = await call(f, 'POST', '/snapshot', {});
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.file.name, `Use of funds as of ${TODAY}.pdf`);
  assert.match(r.body.file.where, /^Data room, under NDA/);
  assert.deepEqual(rows(f, 'SELECT name, visibility, access_tier, source_kind, source_ref, project_id FROM data_room_files'),
    [{ name: `Use of funds as of ${TODAY}.pdf`, visibility: 'nda', access_tier: 'nobody', source_kind: 'document', source_ref: 'use_of_funds', project_id: 1 }]);
  assert.deepEqual([...f.stored.keys()], [`data-room/venture-one/${r.body.file.uid}`]);
  assert.equal(rows(f, "SELECT action FROM activity_logs WHERE action='uof_plan_snapshot_filed'").length, 1);
});

test('D6084: a failed filing removes the stored object and files nothing', async () => {
  const f = fixture(); await planned(f);
  f.db.exec('DROP TABLE data_room_files');
  const r = await call(f, 'POST', '/snapshot', {});
  assert.deepEqual([r.status, r.body.code], [500, 'snapshot_not_filed']);
  assert.equal(f.stored.size, 0);
  assert.equal(rows(f, "SELECT action FROM activity_logs WHERE action='uof_plan_snapshot_filed'").length, 0);
  const none = fixture({ files: false }); await planned(none);
  assert.equal((await call(none, 'POST', '/snapshot', {})).status, 503);
});

test('D6084: an unreadable plan exports nothing, and the plan read turns Export off', async () => {
  const f = fixture(); await planned(f);
  assert.deepEqual((await call(f, 'GET', '/plan')).body.viewer.capabilities, { export: true, add_to_data_room: true });
  f.db.exec('DROP TABLE use_of_funds_hires');
  for (const path of ['/export.csv', '/export.pdf']) {
    const r = await call(f, 'GET', path);
    assert.deepEqual([r.status, r.body.code], [503, 'plan_unreadable'], path);
  }
  assert.equal((await call(f, 'POST', '/snapshot', {})).status, 503);
  assert.deepEqual((await call(f, 'GET', '/plan')).body.viewer.capabilities, { export: false, add_to_data_room: false });
  assert.equal(rows(f, "SELECT id FROM activity_logs WHERE action LIKE 'uof_plan_%'").length, 0);
});

test('D6084: only the venture founder or an admin may export; a support session exports and cannot file', async () => {
  const f = fixture(); await planned(f);
  for (const who of [2, 4]) for (const [m, p] of [['GET', '/export.csv'], ['GET', '/export.pdf'], ['POST', '/snapshot']]) {
    assert.equal((await call(f, m, p, m === 'POST' ? {} : undefined, who)).status, 403, `${who} ${p}`);
  }
  assert.equal((await call(f, 'GET', '/export.csv', undefined, 3)).status, 200, 'an admin exports');
  assert.match(rows(f, "SELECT details FROM activity_logs WHERE action='uof_plan_exported'")[0].details, /^Studio admin: /);
  const support = { impersonated_by: 3 };
  assert.equal((await call(f, 'GET', '/export.csv', undefined, 1, support)).status, 200);
  assert.equal((await call(f, 'POST', '/snapshot', {}, 1, support)).status, 403);
  assert.equal((await call(f, 'GET', '/plan', undefined, 1, support)).body.viewer.capabilities.add_to_data_room, false);
  assert.equal(rows(f, 'SELECT id FROM data_room_files').length, 0);
});

test('D6084: a plan with nothing recorded exports empty cells, never zeroes', () => {
  const t = planTables({ name: 'Base', currency: 'usd', amount_to_raise_cents: null, cash_cents: null, lines: [], milestones: [],
    hires: { state: 'ok', items: [] }, model: { sections: SECTION_KEYS.map((key) => ({ key, allocation: { value: null } })), runway: { value: null, reason: 'Opening cash is Not recorded.' }, spend: { value: null, reason: 'Not recorded.' }, milestones: { value: [] } } });
  const plan = Object.fromEntries(t[0].rows.map((r) => [r[0], r.slice(1)]));
  assert.deepEqual(plan.Raise, [null, null, null]);
  assert.deepEqual(plan['Runway after the raise (months)'], [null, 'Modelled', 'Opening cash is Not recorded.']);
  assert.deepEqual(t[1].rows[0], ['Product & engineering', null, null, null, 'Modelled']);
  assert.deepEqual([t[2].rows, t[3].rows], [[], []]);
});
