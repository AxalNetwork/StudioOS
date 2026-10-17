import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import build from '../src/routes/cycle_build.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { cardView, figureValue } from '../../frontend/src/pages/cycles/cycleModel.js';

const JWT_SECRET = 'x'.repeat(64); // synthetic test fixture
const migration = readFileSync('cloudflare-worker/sql/migrations/441_build_cycle_stores.sql', 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, founder_id INTEGER, spinout_lab_active INTEGER DEFAULT 0, name TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0);
    CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY);
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE projects(id INTEGER PRIMARY KEY, founder_id INTEGER, company_id INTEGER, entity_id INTEGER, incorporation_meta TEXT, cofounder_decision_meta TEXT, deleted_at TEXT);
    CREATE TABLE mvp_features(id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT, added_value TEXT DEFAULT 'High', effort TEXT DEFAULT 'M', delivery_status TEXT DEFAULT 'Backlog', sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE pain_groups(id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT);
    CREATE TABLE hypotheses(id INTEGER PRIMARY KEY, project_id INTEGER, claim TEXT);
    CREATE TABLE roadmap_okrs(id INTEGER PRIMARY KEY, project_id INTEGER, objective TEXT, kanban_status TEXT, sort_order INTEGER DEFAULT 0, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE okr_column_moves(id INTEGER PRIMARY KEY, project_id INTEGER, okr_id INTEGER, to_status TEXT, moved_at TEXT);
    CREATE TABLE cap_table_holders(id INTEGER PRIMARY KEY, user_id INTEGER, project_id INTEGER, name TEXT, shares REAL, ownership_pct REAL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE cap_table_vesting(id INTEGER PRIMARY KEY, user_id INTEGER, holder_id INTEGER, start_date TEXT, cliff_months INTEGER, total_months INTEGER, vested_shares REAL);
    CREATE TABLE documents(id INTEGER PRIMARY KEY, project_id INTEGER, status TEXT, template_name TEXT, created_at TEXT);
    CREATE TABLE cofounder_agreement_parties(id INTEGER PRIMARY KEY, document_id INTEGER, user_id INTEGER);
    CREATE TABLE entity_obligations(id INTEGER PRIMARY KEY, entity_id INTEGER, title TEXT, due_date TEXT, status TEXT, kind TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE entities(id INTEGER PRIMARY KEY, jurisdiction TEXT);
    CREATE TABLE incorporations(id INTEGER PRIMARY KEY, project_id INTEGER, status TEXT, paid_at TEXT, packet_ready_at TEXT, filed_on TEXT, jurisdiction_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT, user_id INTEGER, provider_key TEXT, display_name TEXT, status TEXT, last_synced_at TEXT, last_error_at TEXT, config_json TEXT);
    CREATE TABLE cap_table_scenarios(id INTEGER PRIMARY KEY, project_id INTEGER, is_variant INTEGER DEFAULT 0, inputs_json TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integration_companies(integration_id INTEGER, company_id INTEGER, enabled INTEGER);
    CREATE TABLE ritual_runs(id INTEGER PRIMARY KEY, project_id INTEGER, run_date TEXT, state TEXT);
    CREATE TABLE spinout_applications(id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, answers_json TEXT);
    CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, project_id INTEGER, user_id INTEGER, action TEXT, details TEXT, actor TEXT, entity_type TEXT, entity_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users(id, role, founder_id, name) VALUES (1, 'founder', 11, 'One'), (2, 'founder', 22, 'Two'), (3, 'admin', NULL, 'Admin');
    INSERT INTO projects(id, founder_id, company_id, entity_id) VALUES (101, 11, 10, 501), (202, 22, 20, 502);
    INSERT INTO user_company_links VALUES (1, 10), (2, 20);
    INSERT INTO entities VALUES (501, 'DE'), (502, 'NY');
  `);
  db.exec(migration);
  db.exec(readFileSync('cloudflare-worker/sql/migrations/455_core_systems_workspace.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/459_cycle_activity_convention.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/461_build_record_stores.sql', 'utf8'));
  db.exec('CREATE TABLE google_oauth_tokens(user_id INTEGER PRIMARY KEY); CREATE TABLE microsoft_oauth_tokens(user_id INTEGER PRIMARY KEY)');
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any;
  return { db, env };
}

const app = new Hono<any>();
app.route('/api/cycles/build', build);
app.onError((error, c) => c.json({ error: error.message }, 500));
async function call(env: any, path: string, user = 1, method = 'GET', body?: unknown) {
  const token = await new SignJWT({ user_id: user, role: user === 3 ? 'admin' : 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const response = await app.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  return { status: response.status, body: await response.json() as any };
}

test('missing MVP target date is not_recorded, not zero days; status transition records completion', async () => {
  const { db, env } = fixture();
  db.exec("INSERT INTO mvp_features(id, project_id, title, is_must_have) VALUES (11, 101, 'Core flow', 1)");
  let overview = await call(env, '/api/cycles/build/overview?project=101');
  assert.equal(overview.status, 200);
  assert.equal(overview.body.figures[1].state, 'not_recorded');
  assert.equal(overview.body.figures[1].value, null);
  assert.deepEqual(overview.body.figures[0].value, [0, 1]);
  assert.equal(figureValue(overview.body.figures[0]), '0 of 1');
  db.exec("UPDATE mvp_features SET delivery_status = 'Done' WHERE id = 11");
  assert.ok(db.prepare('SELECT done_at FROM mvp_features WHERE id = 11').get()?.done_at);
  overview = await call(env, '/api/cycles/build/overview?project=101');
  assert.deepEqual(overview.body.figures[0].value, [1, 1]);
  db.close();
});

test('only company-enabled connectors count; a failed system keeps the last good sync', async () => {
  const { db, env } = fixture();
  db.exec(`INSERT INTO integrations(id,user_id,provider_key,display_name,status,last_synced_at) VALUES (1, 1, 'hubspot', 'HubSpot', 'active', '2026-10-01');
    INSERT INTO integrations(id,user_id,provider_key,display_name,status,last_synced_at) VALUES (2, 1, 'payroll_tool', 'Payroll', 'error', '2026-10-03');
    INSERT INTO integrations(id,user_id,provider_key,display_name,status,last_synced_at) VALUES (3, 1, 'private_bank', 'Private bank', 'active', '2026-10-04');
    INSERT INTO integration_companies VALUES (1, 10, 1), (2, 10, 1), (3, 10, 0);
    INSERT INTO project_core_systems(project_id, kind, integration_id, updated_by) VALUES (101, 'crm', 1, 1), (101, 'payroll', 2, 1), (101, 'bank', 3, 1);`);
  const module = await call(env, '/api/cycles/build/modules/operating-systems?project=101');
  assert.equal(module.status, 200);
  const payroll = module.body.records.rows.find((row: any) => row.id === 'payroll');
  const bank = module.body.records.rows.find((row: any) => row.id === 'bank');
  assert.equal(payroll.cells.state, 'Failing');
  assert.equal(cardView(module.body.card).state, 'ok');
  assert.equal(payroll.cells.last_sync, '2026-10-03');
  assert.equal(bank.cells.state, 'Not connected');
  assert.equal(bank.cells.provider, null);
  const overview = await call(env, '/api/cycles/build/overview?project=101');
  assert.deepEqual(overview.body.figures[3].value, [1, 5]);
  assert.equal(overview.body.cards[5].next.text, 'Reconnect Payroll');
  db.exec('DELETE FROM user_company_links WHERE user_id = 1 AND company_id = 10');
  const revoked = await call(env, '/api/cycles/build/modules/operating-systems?project=101');
  assert.equal(revoked.body.records.rows.find((row: any) => row.id === 'crm').cells.provider, null);
  db.close();
});

test('one failing source makes only its own card unreadable', async () => {
  const { db, env } = fixture();
  db.exec('DROP TABLE venture_risks');
  const overview = await call(env, '/api/cycles/build/overview?project=101');
  assert.equal(overview.status, 200);
  assert.equal(overview.body.cards[0].state, 'unreadable');
  assert.match(overview.body.cards[0].reason, /venture_risks/);
  assert.notEqual(overview.body.cards[1].state, 'unreadable');
  assert.notEqual(overview.body.cards[5].state, 'unreadable');
  db.close();
});

test('founder vesting follows both holder and user and never mixes projects', async () => {
  const { db, env } = fixture();
  db.exec(`INSERT INTO cap_table_holders(id,user_id,project_id,name,shares,ownership_pct,founder_role) VALUES
      (1,1,101,'Founder A',100,60,'CEO'), (2,2,202,'Founder B',100,40,'CTO'),
      (4,1,202,'Founder A on another project',100,10,'CFO');
    INSERT INTO cap_table_vesting(id,user_id,holder_id,start_date,cliff_months,total_months,vested_shares) VALUES
      (1,1,1,'2026-01-01',12,48,25), (2,2,2,'2025-01-01',6,24,75),
      (3,2,1,'2020-01-01',1,12,100), (4,1,4,'2024-01-01',6,24,10);
    INSERT INTO documents VALUES (1,101,'generated','cofounder_agreement','2026-10-01'),
      (2,202,'signed','cofounder_agreement','2026-10-02');
    INSERT INTO cofounder_agreement_parties VALUES (1,1,1), (2,2,1);`);
  const one = await call(env, '/api/cycles/build/modules/founding-team?project=101');
  assert.equal(one.status, 200);
  assert.equal(one.body.records.rows.length, 1);
  assert.equal(cardView(one.body.card).state, 'ok');
  assert.equal(one.body.records.rows[0].cells.vesting, '4y · cliff 1 Jan 2027');
  assert.match(one.body.card.series[1].items[0].label, /12m cliff/);
  assert.equal(one.body.records.rows[0].cells.agreement, 'Awaiting');
  assert.doesNotMatch(one.body.records.rows[0].cells.vesting, /1 Feb 2020/);
  assert.doesNotMatch(one.body.records.rows[0].cells.vesting, /1 Jul 2024/);
  const other = await call(env, '/api/cycles/build/modules/founding-team?project=202');
  assert.equal(other.status, 403);
  const two = await call(env, '/api/cycles/build/modules/founding-team?project=202', 2);
  assert.equal(two.body.records.rows[0].cells.founder, 'Founder B');
  assert.equal(two.body.records.rows[0].cells.vesting, '2y · cliff 1 Jul 2025');
  const secondCompanyFounder = two.body.records.rows.find((row: any) => row.cells.founder === 'Founder A on another project');
  assert.equal(secondCompanyFounder.cells.vesting, '2y · cliff 1 Jul 2024');
  assert.equal(secondCompanyFounder.cells.agreement, 'Signed');
  db.close();
});

test('unknown vested shares remain unrecorded and created risks have an atomic audit', async () => {
  const { db, env } = fixture();
  db.exec(`INSERT INTO cap_table_holders(id,user_id,project_id,name,shares,ownership_pct,founder_role)
    VALUES (7,1,101,'Founder C',100,100,'CEO');
    INSERT INTO cap_table_vesting(id,user_id,holder_id,start_date,cliff_months,total_months)
    VALUES (7,1,7,'2026-01-01',12,48);`);
  const founders = await call(env, '/api/cycles/build/modules/founding-team?project=101');
  assert.equal(founders.body.card.series[1].items[0].pct, null);
  db.exec("CREATE TRIGGER reject_risk_audit BEFORE INSERT ON activity_logs WHEN NEW.action = 'build_risk_created' BEGIN SELECT RAISE(ABORT, 'audit failure'); END");
  const failed = await call(env, '/api/cycles/build/risks?project=101', 1, 'POST', { title: 'Rollback risk', severity: 'low' });
  assert.equal(failed.status, 500);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM venture_risks').get()?.n, 0);
  db.close();
});

test('new fields reject cross-project links and disabled or foreign connector mappings', async () => {
  const { db, env } = fixture();
  db.exec(`INSERT INTO mvp_features(id,project_id,title) VALUES (1,101,'Build');
    INSERT INTO pain_groups(id, project_id, title) VALUES (10,202,'Their pain');
    INSERT INTO integrations(id,user_id,provider_key,display_name,status,last_synced_at) VALUES (11,1,'hubspot','CRM','active',NULL);
    INSERT INTO integration_companies VALUES (11,10,0);`);
  let r = await call(env, '/api/cycles/build/features/1?project=101', 1, 'PATCH', { pain_group_id: 10 });
  // D690 (#1695 decision 16): another venture's pain theme in a body is a 404.
  assert.equal(r.status, 404);
  assert.equal(db.prepare('SELECT pain_group_id FROM mvp_features WHERE id = 1').get()?.pain_group_id, null);
  r = await call(env, '/api/cycles/build/systems/crm?project=101', 1, 'PUT', { integration_id: 11 });
  assert.equal(r.status, 403);
  db.exec('UPDATE integration_companies SET enabled = 1 WHERE integration_id = 11');
  r = await call(env, '/api/cycles/build/systems/crm?project=101', 1, 'PUT', { integration_id: 11, used_by: 'Sales' });
  assert.equal(r.status, 200);
  assert.equal(db.prepare("SELECT integration_id FROM project_core_systems WHERE project_id = 101 AND kind = 'crm'").get()?.integration_id, 11);
  assert.equal(db.prepare("SELECT user_id FROM activity_logs WHERE action = 'build_system_mapping_changed'").get()?.user_id, 1);
  db.close();
});

test('MVP target is marked on a real completion line and records can be searched and paged', async () => {
  const { db, env } = fixture();
  db.exec(`INSERT INTO mvp_features(id,project_id,title,is_must_have,delivery_status,done_at) VALUES
    (1,101,'First',1,'Done','2026-07-02'), (2,101,'Second',1,'Done','2026-08-02'),
    (3,101,'Third',1,'Done','2026-09-02'), (4,101,'Future',1,'Backlog',NULL);`);
  const target = await call(env, '/api/cycles/build/project/target?project=101', 1, 'PATCH', { mvp_target_date: '2026-11-30' });
  assert.equal(target.status, 200);
  const module = await call(env, '/api/cycles/build/modules/prototype-mvp?project=101&q=Third');
  assert.equal(module.body.records.total, 1);
  assert.equal(module.body.records.rows[0].cells.must_have, 'Third');
  assert.ok(module.body.records.filters.some((f: any) => f.key === 'state'));
  assert.ok(module.body.records.sorts.some((s: any) => s.key === '-due'));
  assert.equal(module.body.card.state, 'ok');
  assert.equal(cardView(module.body.card).state, 'ok');
  const line = module.body.card.series[0];
  assert.equal(line.kind, 'line');
  assert.equal(line.values[line.mark], null);
  assert.equal(line.mark_label, 'Ship 2026-11-30');
  db.close();
});

test('Lab formation and IP reuse project data; obligations are scoped by project entity', async () => {
  const { db, env } = fixture();
  db.exec(`INSERT INTO incorporations(id, project_id, status, paid_at, packet_ready_at, filed_on, jurisdiction_id)
      VALUES (8,101,'filed','2026-09-01','2026-09-03','2026-09-05','DE');
    INSERT INTO entity_obligations(id, entity_id, title, due_date, status, kind) VALUES
      (31,501,'Annual report','2027-03-01','open','annual_report'),
      (32,502,'Other company filing','2027-03-01','open','annual_report');
    INSERT INTO spinout_applications VALUES (91,1,'accepted','{"origin":"university","institution":"Test University","ip":["patent_filed"]}');`);
  const copied = await call(env, '/api/cycles/build/project/ip-copy?project=101', 1, 'POST', { application_id: 91 });
  assert.equal(copied.status, 200);
  assert.equal(copied.body.ip.institution, 'Test University');
  const module = await call(env, '/api/cycles/build/modules/company-creation?project=101');
  assert.equal(module.status, 200);
  assert.equal(module.body.card.state, 'ok');
  assert.equal(cardView(module.body.card).state, 'ok');
  assert.equal(module.body.facts.ip.origin, 'university');
  assert.ok(module.body.records.rows.some((row: any) => row.cells.filing === 'Filed with state'));
  assert.ok(module.body.records.rows.some((row: any) => row.cells.filing === 'Annual report'));
  assert.ok(!module.body.records.rows.some((row: any) => row.cells.filing === 'Other company filing'));
  const wrong = await call(env, '/api/cycles/build/obligations/32/proof?project=101', 1, 'PATCH', { proof_file_key: 'proof/test' });
  assert.equal(wrong.status, 404);
  db.close();
});

test('solution links and founder risks share the project but not the analyst register', async () => {
  const { db, env } = fixture();
  db.exec(`INSERT INTO pain_groups(id, project_id, title) VALUES (1,101,'Slow reporting');
    INSERT INTO hypotheses(id, project_id, claim) VALUES (2,101,'Automate the monthly close');
    INSERT INTO mvp_features(id,project_id,title,added_value,effort,pain_group_id,hypothesis_id)
      VALUES (3,101,'Auto report','High','M',1,2);`);
  const added = await call(env, '/api/cycles/build/risks?project=101', 1, 'POST', { title: 'Vendor outage', severity: 'high', mitigation: 'Keep an export' });
  assert.equal(added.status, 201);
  const module = await call(env, '/api/cycles/build/modules/solution-design?project=101');
  assert.equal(module.body.records.rows[0].cells.pain_theme, 'Slow reporting');
  assert.equal(cardView(module.body.card).state, 'ok');
  assert.equal(module.body.records.rows[0].cells.hypothesis, 'Automate the monthly close');
  assert.equal(module.body.facts.risks[0].title, 'Vendor outage');
  assert.equal(module.body.card.series[1].rows[0].parts[0], 1);
  assert.equal(db.prepare("SELECT user_id FROM activity_logs WHERE action = 'build_risk_created'").get()?.user_id, 1);
  const denied = await call(env, '/api/cycles/build/risks?project=101', 2, 'POST', { title: 'Other', severity: 'low' });
  assert.equal(denied.status, 403);
  db.close();
});

test('roadmap uses recorded done moves, owner, KPI and target date', async () => {
  const { db, env } = fixture();
  const month = new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);
  db.exec(`INSERT INTO roadmap_okrs(id,project_id,objective,kanban_status) VALUES
      (1,101,'Launch beta','now'), (2,101,'Run pilots','done'), (3,101,'Ship report','done');
    INSERT INTO okr_column_moves(id,project_id,okr_id,to_status,moved_at) VALUES
      (1,101,2,'done','${month}-01 12:00:00'), (2,101,2,'done','${month}-01 13:00:00'),
      (3,101,3,'done','${today}T00:00:00Z');`);
  const edited = await call(env, '/api/cycles/build/roadmap/1?project=101', 1, 'PATCH', { owner_user_id: 1, target_date: '2026-11-30', kpi_key: 'activation' });
  assert.equal(edited.status, 200);
  const module = await call(env, '/api/cycles/build/modules/product-roadmap?project=101&filter=column:now');
  assert.equal(module.body.records.total, 1);
  assert.equal(module.body.records.rows[0].cells.owner, 'One');
  assert.equal(cardView(module.body.card).state, 'ok');
  assert.equal(module.body.records.rows[0].cells.moves, 'activation');
  assert.equal(module.body.records.rows[0].cells.date, '2026-11-30');
  const overview = await call(env, '/api/cycles/build/overview?project=101');
  assert.equal(overview.body.figures[2].value, 2);
  db.close();
});

test('sparse recorded Build cards never become an unreadable chart in the D661 renderer', async () => {
  const { db, env } = fixture();
  db.exec(`INSERT INTO venture_risks(project_id,title,severity,state,created_by) VALUES (101,'Closed risk','high','closed',1);
    INSERT INTO roadmap_okrs(id,project_id,objective,kanban_status) VALUES (5,101,'Shipped before history','done');
    INSERT INTO formation_steps(project_id,title,created_by) VALUES (101,'File certificate',1);
    INSERT INTO cap_table_holders(id,user_id,project_id,name,shares,ownership_pct,founder_role)
      VALUES (8,1,101,'Zero allocation',100,0,'CEO');`);
  for (const slug of ['solution-design', 'product-roadmap', 'company-creation']) {
    const module = await call(env, `/api/cycles/build/modules/${slug}?project=101`);
    assert.equal(module.status, 200, slug);
    assert.equal(cardView(module.body.card).state, 'ok', slug);
  }
  const founders = await call(env, '/api/cycles/build/modules/founding-team?project=101');
  assert.equal(cardView(founders.body.card).state, 'too_little');
  assert.match(founders.body.card.reason, /sum to zero/);
  db.close();
});

test('Build field writes persist only within the owned project and record their actor', async () => {
  const { db, env } = fixture();
  db.exec(`INSERT INTO cap_table_holders(id,user_id,project_id,name) VALUES (10,1,101,'Founder One');
    INSERT INTO entity_obligations(id,entity_id,title,status) VALUES (50,501,'Annual return','open');
    INSERT INTO pain_groups(id, project_id, title) VALUES (11,101,'Slow reporting');
    INSERT INTO hypotheses(id, project_id, claim) VALUES (12,101,'Automate the close');
    INSERT INTO mvp_features(id,project_id,title) VALUES (20,101,'Auto report');`);
  const feature = await call(env, '/api/cycles/build/features/20?project=101', 1, 'PATCH',
    { pain_group_id: 11, hypothesis_id: 12, is_must_have: true });
  assert.equal(feature.status, 200);
  assert.deepEqual({ ...db.prepare('SELECT pain_group_id, hypothesis_id, is_must_have FROM mvp_features WHERE id = 20').get() },
    { pain_group_id: 11, hypothesis_id: 12, is_must_have: 1 });
  const role = await call(env, '/api/cycles/build/founders/10?project=101', 1, 'PATCH', { role: 'CEO' });
  assert.equal(role.status, 200);
  assert.equal(db.prepare('SELECT founder_role FROM cap_table_holders WHERE id = 10').get()?.founder_role, 'CEO');
  const formation = await call(env, '/api/cycles/build/formation-steps?project=101', 1, 'POST',
    { title: 'File certificate', due_date: '2026-12-01' });
  assert.equal(formation.status, 201);
  assert.equal(db.prepare('SELECT due_date FROM formation_steps WHERE id = ?').get(formation.body.id)?.due_date, '2026-12-01');
  assert.equal(db.prepare("SELECT entity_id FROM activity_logs WHERE action = 'build_formation_step_created'").get()?.entity_id,
    `step-${formation.body.id}`);
  const proof = await call(env, '/api/cycles/build/obligations/50/proof?project=101', 1, 'PATCH', { proof_file_key: 'proof/annual-return' });
  assert.equal(proof.status, 200);
  assert.equal(db.prepare('SELECT proof_file_key FROM entity_obligations WHERE id = 50').get()?.proof_file_key, 'proof/annual-return');
  const denied = await call(env, '/api/cycles/build/founders/10?project=202', 2, 'PATCH', { role: 'CEO' });
  assert.equal(denied.status, 404);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE user_id = 2 AND action = 'build_founder_role_changed'").get()?.n, 0);
  db.close();
});
