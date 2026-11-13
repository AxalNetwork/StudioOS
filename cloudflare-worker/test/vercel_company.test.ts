/**
 * D1099 (#2964, Vercel part 4): Vercel feeds Build › Company creation, where
 * production runs.
 *
 * - The facts: the account (personal or team, from the installation's
 *   `teamId`) and the plan (from `GET /v9/projects/{id}`, else Hobby for a
 *   personal account, else not recorded).
 * - A Hobby project proposes "Move the production project to the company's
 *   Vercel team on a paid plan" once; Pro, Enterprise and an unknown plan
 *   propose nothing; leaving Hobby withdraws a pending one.
 * - Accept claims once and writes one formation step and its ledger row in one
 *   batch; a failed batch hands the claim back; a decided one answers 409;
 *   Dismiss stays dismissed; only the venture's writer decides.
 * - Disconnecting deletes the facts and the pending proposals.
 *
 * Real SQL on node:sqlite and real JWT routes; Vercel is the in-process fake
 * (`_vercel_api_fake.mjs`): no test reaches api.vercel.com, and no request but
 * a GET is made. Each case names the mutations it was checked against.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/vercel_company.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import build from '../src/routes/cycle_build.ts';
import { vercelClient } from '../src/services/vercel/api.ts';
import {
  MOVE_STEP_REASON, MOVE_STEP_TITLE, deleteVercelCompanyOf, projectFacts, syncVercelCompany,
} from '../src/services/vercel/company.ts';
import { fakeVercel } from './_vercel_api_fake.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'x'.repeat(64); // synthetic test fixture
const mig = (n: string) => readFileSync(`cloudflare-worker/sql/migrations/${n}`, 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, founder_id INTEGER, spinout_lab_active INTEGER DEFAULT 0, name TEXT, email TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0, subscription_tier TEXT DEFAULT 'free');
    CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY);
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE company_profiles(id INTEGER PRIMARY KEY);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE projects(id INTEGER PRIMARY KEY, founder_id INTEGER, company_id INTEGER, entity_id INTEGER, incorporation_meta TEXT, cofounder_decision_meta TEXT, deleted_at TEXT);
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT UNIQUE, user_id INTEGER, provider_key TEXT, display_name TEXT, status TEXT DEFAULT 'active', auth_type TEXT,
      credentials_enc TEXT, config_json TEXT, last_synced_at TEXT, last_error_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integration_companies(integration_id INTEGER, company_id INTEGER, enabled INTEGER DEFAULT 1);
    CREATE TABLE mvp_features(id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT, added_value TEXT DEFAULT 'High', effort TEXT DEFAULT 'M', delivery_status TEXT DEFAULT 'Backlog', sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE pain_groups(id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT);
    CREATE TABLE hypotheses(id INTEGER PRIMARY KEY, project_id INTEGER, claim TEXT);
    CREATE TABLE roadmap_okrs(id INTEGER PRIMARY KEY, project_id INTEGER, objective TEXT, kanban_status TEXT, sort_order INTEGER DEFAULT 0, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE okr_column_moves(id INTEGER PRIMARY KEY, project_id INTEGER, okr_id INTEGER, to_status TEXT, moved_at TEXT);
    CREATE TABLE spinout_applications(id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, answers_json TEXT);
    CREATE TABLE ritual_runs(id INTEGER PRIMARY KEY, project_id INTEGER, run_date TEXT, state TEXT);
    CREATE TABLE cap_table_holders(id INTEGER PRIMARY KEY, user_id INTEGER, project_id INTEGER, name TEXT, shares REAL, ownership_pct REAL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE cap_table_vesting(id INTEGER PRIMARY KEY, user_id INTEGER, holder_id INTEGER, start_date TEXT, cliff_months INTEGER, total_months INTEGER, vested_shares REAL);
    CREATE TABLE cap_table_scenarios(id INTEGER PRIMARY KEY, project_id INTEGER, is_variant INTEGER DEFAULT 0, inputs_json TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE documents(id INTEGER PRIMARY KEY, project_id INTEGER, status TEXT, template_name TEXT, created_at TEXT);
    CREATE TABLE cofounder_agreement_parties(id INTEGER PRIMARY KEY, document_id INTEGER, user_id INTEGER);
    CREATE TABLE entity_obligations(id INTEGER PRIMARY KEY, entity_id INTEGER, title TEXT, due_date TEXT, status TEXT, kind TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE entities(id INTEGER PRIMARY KEY, jurisdiction TEXT);
    CREATE TABLE incorporations(id INTEGER PRIMARY KEY, project_id INTEGER, status TEXT, paid_at TEXT, packet_ready_at TEXT, filed_on TEXT, jurisdiction_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, project_id INTEGER, user_id INTEGER, action TEXT, details TEXT, actor TEXT, entity_type TEXT, entity_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users(id, role, founder_id, name, email) VALUES (1, 'founder', 11, 'One', 'one@example.test'), (2, 'founder', 22, 'Two', 'two@example.test'), (4, 'partner', NULL, 'Partner', 'partner@example.test');
    INSERT INTO company_profiles VALUES (10), (20);
    INSERT INTO projects(id, founder_id, company_id) VALUES (101, 11, 10), (202, 22, 20);
    INSERT INTO user_company_links VALUES (1, 10), (2, 20);
  `);
  for (const m of ['441_build_cycle_stores.sql', '445_connector_fed_items.sql', '459_cycle_activity_convention.sql', '461_build_record_stores.sql', '502_github_team_company.sql', '592_vercel_company_proposals.sql']) db.exec(mig(m));
  db.exec(`INSERT INTO integrations(id, uid, user_id, provider_key, status, auth_type, config_json)
      VALUES (31, 'vc-one', 1, 'vercel', 'active', 'oauth2', '{}');
    INSERT INTO integration_companies(integration_id, company_id, enabled) VALUES (31, 10, 1);
    INSERT INTO cap_table_holders(id, user_id, project_id, name, ownership_pct, founder_role) VALUES (7, 1, 101, 'Ada', 60, 'CEO'), (8, NULL, 101, 'Investor', 10, NULL), (9, 2, 202, 'Bo', 100, 'CEO');`);
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any;
  const one = (sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any;
  const all = (sql: string, ...args: any[]) => db.prepare(sql).all(...args).map((r: any) => ({ ...r }));
  return { db, env, one, all };
}

const app = (() => {
  const a = new Hono<any>();
  a.route('/api/cycles/build', build);
  a.onError((e, c) => c.json({ error: e.message }, 500));
  return a;
})();
async function call(env: any, path: string, id = 1, method = 'GET', body?: unknown) {
  const token = await new SignJWT({ user_id: id, role: id === 4 ? 'partner' : 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.request(path, { method, headers: { Authorization: 'Bearer ' + token, 'X-Company-Id': id === 2 ? '20' : '10', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, env);
  return { status: r.status, text: await r.text() };
}
const json = (r: { text: string }) => JSON.parse(r.text);
const part = async (env: any, id = 1) => json(await call(env, '/api/cycles/build/modules/company-creation?project=101', id)).parts.vercel;


// ───────────────────────────────────────────── a stubbed Vercel

const auth = (teamId: string | null) => ({ access_token: 'fixture_vercel_token', configuration_id: 'icfg_fixture', team_id: teamId });
/** The fake with one project on `plan` (undefined: Vercel says no plan). Every call is a GET to api.vercel.com. */
function vercel(plan?: string, teamId: string | null = null) {
  const f = fakeVercel({ projects: [{ id: 'prj_fixture', name: 'acme-web', ...(plan === undefined ? {} : { plan }) } as any], teamId: teamId as any });
  globalThis.fetch = f.fetch as typeof fetch;
  return { client: vercelClient(auth(teamId)), calls: f.calls, installation: { teamId } };
}
const sync = (env: any, v: ReturnType<typeof vercel>) => syncVercelCompany(env, 31, 101, v.client, 'prj_fixture', v.installation);

test('the facts: the account from teamId, the plan from the project, Hobby for a personal account, else not recorded', () => {
  // Mutations checked: a team read as personal; a personal account's plan not Hobby; a team with no plan read as Hobby; an unknown plan word kept.
  assert.deepEqual(projectFacts({}, { teamId: null }), { account_kind: 'personal', plan: 'hobby', plan_source: 'personal_account' });
  assert.deepEqual(projectFacts({ plan: 'pro' }, { teamId: 'team_1' }), { account_kind: 'team', plan: 'pro', plan_source: 'project' });
  assert.deepEqual(projectFacts({ plan: 'Enterprise' }, { teamId: 'team_1' }), { account_kind: 'team', plan: 'enterprise', plan_source: 'project' });
  assert.deepEqual(projectFacts({ plan: 'hobby' }, { teamId: 'team_1' }), { account_kind: 'team', plan: 'hobby', plan_source: 'project' });
  assert.deepEqual(projectFacts({}, { teamId: 'team_1' }), { account_kind: 'team', plan: null, plan_source: 'none' });
  assert.deepEqual(projectFacts({ plan: 'business' }, { teamId: 'team_1' }), { account_kind: 'team', plan: null, plan_source: 'none' });
  assert.deepEqual(projectFacts(null, null), { account_kind: 'personal', plan: 'hobby', plan_source: 'personal_account' });
});

test('a Hobby project proposes once; Pro, Enterprise and an unknown plan propose nothing; leaving Hobby withdraws a pending one', async () => {
  // Mutations checked: the proposal made again on a re-sync; Pro proposing; an unknown plan proposing; a pending one kept after the move to Pro; a non-GET made.
  const { env, all } = fixture();
  const hobby = vercel();
  assert.equal((await sync(env, hobby)).proposed, true);
  assert.equal((await sync(env, hobby)).proposed, false, 'proposed once');
  assert.ok(hobby.calls.every((c: any) => c.method === 'GET'), 'nothing but a read reaches Vercel');
  const own = await part(env);
  assert.equal(own.state, 'ok');
  assert.deepEqual(own.projects.map((p: any) => [p.project, p.account, p.plan_word]), [['acme-web', 'Personal Vercel account', 'Hobby']]);
  assert.deepEqual(own.proposals.map((p: any) => [p.title, p.reason, p.project]), [[MOVE_STEP_TITLE, MOVE_STEP_REASON, 'acme-web']]);
  assert.equal(all('SELECT * FROM formation_steps').length, 0, 'nothing is written before Accept');

  await sync(env, vercel('pro', 'team_acme'));
  assert.deepEqual(all("SELECT * FROM vercel_company_proposals WHERE status = 'pending'"), [], 'the move happened');
  const pro = await part(env);
  assert.deepEqual(pro.projects.map((p: any) => [p.account, p.plan_word]), [['Vercel team', 'Pro']]);

  const f2 = fixture();
  assert.equal((await syncVercelCompany(f2.env, 31, 101, vercel('enterprise', 'team_acme').client, 'prj_fixture', { teamId: 'team_acme' })).proposed, false);
  assert.equal((await syncVercelCompany(f2.env, 31, 101, vercel(undefined, 'team_acme').client, 'prj_fixture', { teamId: 'team_acme' })).proposed, false);
  assert.deepEqual(f2.all('SELECT * FROM vercel_company_proposals'), []);
  const unknown = await part(f2.env);
  assert.deepEqual([unknown.projects[0].plan, unknown.projects[0].plan_word], [null, null]);
  assert.match(unknown.projects[0].plan_note, /^Not recorded/);
});

test('Accept claims once and writes one formation step and its ledger row; a decided one is 409; only the venture\'s writer decides', async () => {
  // Mutations checked: Accept twice; Accept without its ledger row; Accept by another founder; the step not 'todo' or not 'other'; the activity line dropped.
  const { env, all, one } = fixture();
  await sync(env, vercel());
  const id = (await part(env)).proposals[0].id;
  const decide = (how: string, user = 1, pid = id) => call(env, `/api/cycles/build/company-creation/vercel-proposals/${pid}/${how}?project=101`, user, 'POST');
  assert.equal((await decide('accept', 2)).status, 403);
  assert.equal((await decide('accept', 4)).status, 403, 'a non-member cannot');
  assert.equal((await decide('accept')).status, 200);
  assert.equal((await decide('accept')).status, 409);
  assert.equal((await decide('dismiss')).status, 409);
  assert.equal((await decide('accept', 1, 999)).status, 404);
  assert.deepEqual(all('SELECT title, state, kind FROM formation_steps'), [{ title: MOVE_STEP_TITLE, state: 'todo', kind: 'other' }]);
  const step = one('SELECT id FROM formation_steps').id;
  assert.equal(one('SELECT step_id FROM vercel_company_proposals WHERE id = ?', id).step_id, step);
  assert.deepEqual({ ...one("SELECT module, kind, external_id, local_table, local_id FROM connector_fed_items WHERE kind = 'hosting_step'") },
    { module: 'company_creation', kind: 'hosting_step', external_id: 'hosting_step:101:prj_fixture', local_table: 'formation_steps', local_id: step });
  assert.equal(all("SELECT * FROM activity_logs WHERE action = 'build_hosting_step_accepted'").length, 1);
  await sync(env, vercel());
  assert.equal((await part(env)).proposals.length, 0, 'an accepted one is not proposed again');
});

test('a failed batch hands the claim back; Dismiss stays dismissed', async () => {
  // Mutations checked: the claim kept after a failed batch; a dismissed proposal brought back by a re-sync.
  const { env, db, one, all } = fixture();
  await sync(env, vercel());
  const id = (await part(env)).proposals[0].id;
  db.exec('ALTER TABLE formation_steps RENAME TO formation_steps_away');
  const failed = await call(env, `/api/cycles/build/company-creation/vercel-proposals/${id}/accept?project=101`, 1, 'POST');
  assert.equal(failed.status, 500);
  assert.deepEqual({ ...one('SELECT status, step_id, decided_by FROM vercel_company_proposals WHERE id = ?', id) }, { status: 'pending', step_id: null, decided_by: null });
  assert.deepEqual(all("SELECT * FROM connector_fed_items WHERE kind = 'hosting_step'"), []);
  db.exec('ALTER TABLE formation_steps_away RENAME TO formation_steps');
  assert.equal((await call(env, `/api/cycles/build/company-creation/vercel-proposals/${id}/dismiss?project=101`, 1, 'POST')).status, 200);
  await sync(env, vercel());
  assert.equal((await part(env)).proposals.length, 0);
  assert.equal(one('SELECT status FROM vercel_company_proposals WHERE id = ?', id).status, 'dismissed');
  assert.deepEqual(all('SELECT * FROM formation_steps'), []);
});

test('a non-member reads how many projects, never one; a broken store leaves the module readable', async () => {
  // Mutations checked: a project shown to a non-member; a failed read blanking the module.
  const { env, db } = fixture();
  await sync(env, vercel());
  const partner = await call(env, '/api/cycles/build/modules/company-creation?project=101', 4);
  const theirs = json(partner).parts.vercel;
  assert.deepEqual({ members_only: theirs.members_only, total: theirs.projects_total, projects: theirs.projects, proposals: theirs.proposals }, { members_only: true, total: 1, projects: [], proposals: [] });
  assert.doesNotMatch(partner.text, /acme-web|prj_fixture/);
  db.exec('DROP TABLE vercel_company_facts');
  const r = await call(env, '/api/cycles/build/modules/company-creation?project=101');
  assert.equal(r.status, 200);
  assert.deepEqual(json(r).parts.vercel, { state: 'unreadable', reason: 'What Vercel brought could not be read.' });
  assert.equal(json(r).parts.github.state, 'ok', 'the other part stays');
});

test('disconnecting deletes the facts and the pending proposals; a decided one stays as history; the migration holds its keys', async () => {
  // Mutations checked: the facts kept; a pending proposal kept; a decided one deleted.
  const { env, all, db } = fixture();
  await sync(env, vercel());
  db.exec(`INSERT INTO vercel_company_proposals (integration_id, project_id, vercel_project_id, kind, status) VALUES (31, 101, 'prj_old', 'move_to_team', 'dismissed')`);
  await deleteVercelCompanyOf(env, 31);
  assert.deepEqual(all('SELECT * FROM vercel_company_facts'), []);
  assert.deepEqual(all('SELECT vercel_project_id, status FROM vercel_company_proposals'), [{ vercel_project_id: 'prj_old', status: 'dismissed' }]);
  const sql = mig('592_vercel_company_proposals.sql');
  assert.match(sql, /UNIQUE \(integration_id, project_id, vercel_project_id, kind\)/);
  assert.match(sql, /kind TEXT NOT NULL DEFAULT 'move_to_team' CHECK \(kind IN \('move_to_team'\)\)/);
  assert.match(sql, /vercel_company_facts \([\s\S]*?integration_id INTEGER NOT NULL REFERENCES integrations\(id\) ON DELETE CASCADE/);
  assert.throws(() => db.exec(`INSERT INTO vercel_company_proposals (integration_id, project_id, vercel_project_id, kind) VALUES (31, 101, 'x', 'move_to_org')`), /CHECK/);
  const src = readFileSync('cloudflare-worker/src/services/vercel/company.ts', 'utf8');
  assert.doesNotMatch(src, /fetch\(|method:\s*'(POST|PUT|PATCH|DELETE)'/, 'nothing is sent to Vercel but the read');
});
