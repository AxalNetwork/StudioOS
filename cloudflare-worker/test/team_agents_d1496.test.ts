// D1496 (#3840, part 1 of #3727) — team agents: the registry, the rule books
// and their routes at /api/teams.
//
//   · the gates: read (company link / canAccessProject), manage (canEdit /
//     isProjectManager), plan (a paid Founder plan, owner Q6 = A), the flag;
//   · the registry: role_taken (a removed agent frees the role),
//     model_not_offered, invalid_name, tool_not_approved (fail closed);
//   · the rule book: the floor (rule_floor), versions, diff, authors by name;
//   · include=projects for a company's editors only; month spend is
//     { available: false } when it cannot be read, never 0;
//   · no answer carries an email or a numeric user id.
//
// Real SQLite with migration 712 over the baseline's tables. Each case names
// the mutations it was checked against.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/team_agents_d1496.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { addColumnsFrom, stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_BUDGET_MIGRATION, AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest, holdOperation } from '../src/services/aiRouter.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import teamAgents from '../src/routes/team_agents.ts';
import { ALWAYS_ASKS_FLOOR, MODULES, ROLES, optionsIn, roleOf } from '../src/services/agents/catalogue.ts';
import { checkRules, diffRules } from '../src/services/agents/rulebook.ts';
import { MODULES as VALIDATE } from '../src/services/cycleValidate.ts';
import { MODULES as RAISE } from '../src/services/raiseCycle.ts';
import { GROW_MODULES as GROW } from '../src/services/growCycle.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const MIGRATION = sql('migrations/712_team_agents.sql');

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const CAP = 5_000_000;
// People: the company's editor, a plain member, a stranger, an editor on a free plan,
// a project's owner (founder 200), a project advisor, HQ's admin.
const EDITOR = 10, MEMBER = 11, STRANGER = 12, FREE_EDITOR = 13, PROJECT_OWNER = 15, ADVISOR = 16, ADMIN = 1;
const IN_CO = 7, ALONE = 8;

function world() {
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  db.exec(MIGRATION);
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')");
  user.run(ADMIN, 'u-admin', 'admin@example.test', 'Ada Admin', 'admin', null, 'free');
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100, 'growth');
  user.run(MEMBER, 'u-member', 'member@example.test', 'Max Member', 'founder', 101, 'growth');
  user.run(STRANGER, 'u-stranger', 'stranger@example.test', 'Sam Stranger', 'founder', 102, 'growth');
  user.run(FREE_EDITOR, 'u-free', 'free@example.test', 'Fay Free', 'founder', 103, 'free');
  user.run(PROJECT_OWNER, 'u-powner', 'powner@example.test', 'Pat Owner', 'founder', 200, 'growth');
  user.run(ADVISOR, 'u-advisor', 'advisor@example.test', 'Al Advisor', 'founder', 104, 'growth');
  db.prepare("INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme')").run();
  const link = db.prepare("INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES (?, ?, 1, ?)");
  link.run('l1', EDITOR, 'Founder'); link.run('l2', MEMBER, 'Member'); link.run('l3', FREE_EDITOR, 'Owner');
  db.prepare("INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (?, ?, ?, 200, ?)").run(IN_CO, 'p7', 'Rocket', 1);
  db.prepare("INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (?, ?, ?, 200, NULL)").run(ALONE, 'p8', 'Solo');
  const env: any = { DB, JWT_SECRET: 'd1496-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
  return { db, env };
}
type W = ReturnType<typeof world>;

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/teams', teamAgents);
  return a;
}
async function call(w: W, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(`/api/teams${path}`, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any, text };
}
const cfo = (over: Record<string, unknown> = {}) => ({ role_key: 'cfo', first_name: 'Carla', last_name: 'Cash', model_id: MODEL, monthly_cap_microusd: CAP, ...over });
const CO = '/company/co-uid-1';
/** No answer names a person by email or by numeric id. */
function noPrivateKeys(text: string) {
  assert.ok(!/"email"\s*:/.test(text), 'an email key');
  assert.ok(!/@example\.test/.test(text), 'an email address');
  assert.ok(!/"(sponsor_user_id|created_by|actor_user_id|user_id)"\s*:/.test(text), 'a numeric user id key');
}

// 1 ───────────────────────────────────────────────────────────────────────────
test('the catalogue: eleven roles whose defaults pass their own validator, on real module and option keys', () => {
  assert.equal(ROLES.length, 11);
  assert.deepEqual(ROLES.map((r) => r.key), ['ceo', 'cto', 'cpo', 'cfo', 'cmo', 'sales', 'coo', 'general_counsel', 'people', 'research_analyst', 'investor_relations']);
  for (const r of ROLES) {
    const c = checkRules(r.default_rules);
    assert.ok(c.ok, `${r.key}: ${JSON.stringify(c)}`);
    assert.deepEqual(r.default_rules.may_do_automatically, []);
    for (const k of ALWAYS_ASKS_FLOOR) assert.ok(r.default_rules.always_asks_human.includes(k), `${r.key} floor ${k}`);
  }
  // Counsel's disclaimer is a key for the owner's wording, never text.
  assert.equal(roleOf('general_counsel')!.disclaimer_key, 'agents.general_counsel.disclaimer');
  // The module keys are the cycles' own slugs.
  const ours = new Set(MODULES.map((m) => m.key));
  for (const m of [...VALIDATE, ...RAISE, ...GROW]) assert.ok(ours.has(m.slug), m.slug);
  for (const s of ['solution-design', 'prototype-mvp', 'product-roadmap', 'founding-team', 'company-creation', 'operating-systems']) assert.ok(ours.has(s), s);
  assert.ok(optionsIn('cap-table').includes('draft:raise/capital'));
  assert.ok(optionsIn('revenue-and-traction').includes('draft:update'), 'a cycle page’s option belongs to each of its modules');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('the floor: dropping send_email or adding an automatic item is rule_floor; other faults are invalid_rules', () => {
  // Mutations checked: floorBreach returning null (the floor widened open) → both rule_floor asserts fail;
  // the may_propose reach check dropped → the stray-option assert fails.
  const base = roleOf('cfo')!.default_rules;
  const drop = checkRules({ ...base, always_asks_human: base.always_asks_human.filter((k) => k !== 'send_email') });
  assert.equal(drop.ok, false); assert.equal((drop as any).code, 'rule_floor');
  const auto = checkRules({ ...base, may_do_automatically: ['draft:raise/capital'] });
  assert.equal(auto.ok, false); assert.equal((auto as any).code, 'rule_floor');
  assert.equal((checkRules({ ...base, works_in: ['nowhere'] }) as any).code, 'invalid_rules');
  assert.equal((checkRules({ ...base, extra: 1 }) as any).code, 'invalid_rules');
  assert.equal((checkRules({ ...base, may_propose: ['deck:build'] }) as any).code, 'invalid_rules', 'an option outside its modules');
  const d = diffRules(base, { ...base, kpis: [...base.kpis, 'Cash checked weekly'], tone: 'Brisk' });
  assert.deepEqual(d, [{ section: 'kpis', added: ['Cash checked weekly'], removed: [] }, { section: 'tone', added: ['Brisk'], removed: ['Careful and numerate'] }]);
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('off: every route answers 404 team_agents_off', async () => {
  const w = world(); w.env.TEAM_AGENTS_ENABLED = 'false';
  for (const [m, p] of [['GET', '/roles'], ['GET', `${CO}/agents`], ['POST', `${CO}/agents`], ['GET', '/agents/00000000000000000000000000000000'],
    ['PATCH', '/agents/00000000000000000000000000000000'], ['DELETE', '/agents/00000000000000000000000000000000'], ['GET', `${CO}/rulebooks/cfo`], ['PUT', `${CO}/rulebooks/cfo`]]) {
    const r = await call(w, EDITOR, m, p, m === 'GET' || m === 'DELETE' ? undefined : {});
    assert.deepEqual([r.status, r.body?.error], [404, 'team_agents_off'], `${m} ${p}`);
  }
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('the gates: stranger 403, member refused every write, advisor refused, free plan plan_required', async () => {
  // Mutations checked: canManage always true (the manage gate removed) → the member's POST/PATCH/PUT asserts fail;
  // planOk always true (the plan gate dropped) → the free editor's plan_required assert fails.
  const w = world();
  w.db.exec(`CREATE TABLE IF NOT EXISTS project_members (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'cofounder', status TEXT NOT NULL DEFAULT 'accepted', source TEXT, invited_by INTEGER, created_at TEXT, updated_at TEXT)`);
  w.db.prepare("INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'advisor', 'accepted')").run(ALONE, ADVISOR);

  assert.equal((await call(w, STRANGER, 'GET', `${CO}/agents`)).body.error, 'not_member');
  assert.equal((await call(w, STRANGER, 'GET', `${CO}/agents`)).status, 403);
  assert.equal((await call(w, STRANGER, 'POST', `${CO}/agents`, cfo())).status, 403);

  const added = await call(w, EDITOR, 'POST', `${CO}/agents`, cfo());
  assert.equal(added.status, 201, added.text);
  const uid = added.body.agent.uid;

  const list = await call(w, MEMBER, 'GET', `${CO}/agents`);
  assert.deepEqual([list.status, list.body.can_manage, list.body.agents.length], [200, false, 1]);
  assert.deepEqual([(await call(w, MEMBER, 'POST', `${CO}/agents`, cfo({ role_key: 'cto' }))).body.error], ['not_manager']);
  assert.equal((await call(w, MEMBER, 'PATCH', `/agents/${uid}`, { status: 'paused' })).status, 403);
  assert.equal((await call(w, MEMBER, 'DELETE', `/agents/${uid}`)).status, 403);
  assert.equal((await call(w, MEMBER, 'PUT', `${CO}/rulebooks/cfo`, { rules: roleOf('cfo')!.default_rules })).status, 403);

  const adv = await call(w, ADVISOR, 'POST', `/project/${ALONE}/agents`, cfo());
  assert.deepEqual([adv.status, adv.body.error], [403, 'not_manager']);
  assert.equal((await call(w, ADVISOR, 'GET', `/project/${ALONE}/agents`)).status, 200, 'an advisor reads');

  const free = await call(w, FREE_EDITOR, 'POST', `${CO}/agents`, cfo({ role_key: 'cto' }));
  assert.deepEqual([free.status, free.body.error], [403, 'plan_required']);
  assert.equal((await call(w, FREE_EDITOR, 'GET', `${CO}/agents`)).body.plan_ok, false);
  assert.equal((await call(w, EDITOR, 'GET', `${CO}/agents`)).body.plan_ok, true);
  assert.equal((await call(w, EDITOR, 'GET', '/company/no-such/agents')).status, 404);
});

test.todo('a company editor manages agents on a project inside the company once #3697 part 2 gives isProjectManager its company branch (https://github.com/AxalNetwork/StudioOS/issues/3697)');

// 5 ───────────────────────────────────────────────────────────────────────────
test('the registry: role_taken until removed, model_not_offered, invalid_name, tool_not_approved, and remove withdraws open proposals', async () => {
  // Mutations checked: the partial unique index keyed on raw company_id/project_id (NULLs distinct) → the role_taken assert fails;
  // namePart without the 40 limit → invalid_name fails; the tool grant accepted → tool_not_approved fails;
  // the withdraw UPDATE dropped → the withdrawn assert fails.
  const w = world();
  const a = await call(w, EDITOR, 'POST', `${CO}/agents`, cfo());
  assert.equal(a.status, 201);
  assert.deepEqual([a.body.agent.first_name, a.body.agent.last_name, a.body.agent.role_name, a.body.agent.status], ['Carla', 'Cash', 'CFO', 'active']);
  assert.deepEqual(a.body.agent.sponsor, { uid: 'u-editor', name: 'Eve Editor' });
  assert.deepEqual(a.body.agent.month_spend, { available: true, value_microusd: 0 });
  assert.equal((await call(w, EDITOR, 'POST', `${CO}/agents`, cfo())).body.error, 'role_taken');
  assert.equal((await call(w, EDITOR, 'POST', `${CO}/agents`, cfo({ role_key: 'cto', model_id: 'nope/not-a-model' }))).body.error, 'model_not_offered');
  assert.equal((await call(w, EDITOR, 'POST', `${CO}/agents`, cfo({ role_key: 'cto', first_name: 'x'.repeat(41) }))).body.error, 'invalid_name');
  assert.equal((await call(w, EDITOR, 'POST', `${CO}/agents`, cfo({ role_key: 'cto', first_name: 'x'.repeat(40) }))).status, 201, '40 is allowed');
  const tool = await call(w, EDITOR, 'POST', `${CO}/agents`, cfo({ role_key: 'coo', tool_grants: [{ integration_uid: 'i1', tool: 'read' }] }));
  assert.deepEqual([tool.status, tool.body.error], [422, 'tool_not_approved']);
  assert.equal((await call(w, EDITOR, 'POST', `${CO}/agents`, cfo({ role_key: 'coo', monthly_cap_microusd: 0 }))).body.error, 'invalid_cap');
  assert.equal((await call(w, EDITOR, 'POST', `${CO}/agents`, cfo({ role_key: 'nobody' }))).body.error, 'invalid_role');

  const id = (w.db.prepare('SELECT id FROM team_agents WHERE uid = ?').get(a.body.agent.uid) as any).id;
  w.db.prepare("INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, kind, payload_json, agent_id) VALUES ('pp1', ?, 'Founder · Raise · Cap table', 'draft:raise/capital', 'draft', '{}', ?)").run(EDITOR, id);
  w.db.prepare("INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, kind, payload_json, agent_id, status) VALUES ('pp2', ?, 'Founder · Raise · Cap table', 'draft:raise/capital', 'draft', '{}', ?, 'accepted')").run(EDITOR, id);

  const paused = await call(w, EDITOR, 'PATCH', `/agents/${a.body.agent.uid}`, { status: 'paused', monthly_cap_microusd: CAP * 2, last_name: '  Flow ' });
  assert.deepEqual([paused.body.agent.status, paused.body.agent.paused_reason, paused.body.agent.monthly_cap_microusd, paused.body.agent.last_name], ['paused', 'manual', CAP * 2, 'Flow']);
  assert.deepEqual((await call(w, EDITOR, 'PATCH', `/agents/${a.body.agent.uid}`, { status: 'active' })).body.agent.paused_reason, null);

  assert.deepEqual((await call(w, EDITOR, 'DELETE', `/agents/${a.body.agent.uid}`)).body, { ok: true });
  assert.deepEqual(w.db.prepare("SELECT uid, status FROM ai_rail_proposals ORDER BY uid").all().map((r: any) => [r.uid, r.status]), [['pp1', 'withdrawn'], ['pp2', 'accepted']]);
  assert.equal((await call(w, EDITOR, 'PATCH', `/agents/${a.body.agent.uid}`, { status: 'active' })).body.error, 'removed');
  assert.equal((await call(w, EDITOR, 'POST', `${CO}/agents`, cfo())).status, 201, 'a removed agent frees its role');

  const profile = await call(w, EDITOR, 'GET', `/agents/${a.body.agent.uid}`);
  assert.deepEqual(profile.body.events.map((e: any) => e.kind), ['removed', 'resumed', 'cap_changed', 'paused', 'added']);
  assert.deepEqual(profile.body.events[0].actor, { uid: 'u-editor', name: 'Eve Editor' });
  assert.deepEqual(profile.body.proposals, { proposed: 0, accepted: 1, edited: 0, discarded: 0, withdrawn: 1 });
  noPrivateKeys(profile.text);
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('the rule book: versions count up, the diff is against the default, authors by name, the floor refused at the route', async () => {
  const w = world();
  await call(w, EDITOR, 'POST', `${CO}/agents`, cfo());
  const first = await call(w, EDITOR, 'GET', `${CO}/rulebooks/cfo`);
  assert.deepEqual([first.body.version, first.body.versions, first.body.diff, first.body.floor], [0, [], [], [...ALWAYS_ASKS_FLOOR]]);
  const base = roleOf('cfo')!.default_rules;
  const v1 = await call(w, EDITOR, 'PUT', `${CO}/rulebooks/cfo`, { rules: { ...base, kpis: [...base.kpis, 'Cash checked weekly'] } });
  assert.deepEqual([v1.status, v1.body.version], [200, 1]);
  const v2 = await call(w, EDITOR, 'PUT', `${CO}/rulebooks/cfo`, { rules: { ...base, works_in: ['use-of-funds', 'cap-table'], may_propose: ['draft:raise/capital'] } });
  assert.equal(v2.body.version, 2);
  const floor = await call(w, EDITOR, 'PUT', `${CO}/rulebooks/cfo`, { rules: { ...base, always_asks_human: base.always_asks_human.filter((k) => k !== 'send_email') } });
  assert.deepEqual([floor.status, floor.body.error, floor.body.section], [422, 'rule_floor', 'always_asks_human']);
  assert.equal((await call(w, EDITOR, 'PUT', `${CO}/rulebooks/cfo`, { rules: { ...base, may_do_automatically: ['draft:raise/capital'] } })).body.error, 'rule_floor');
  assert.equal((await call(w, EDITOR, 'PUT', `${CO}/rulebooks/cfo`, { rules: { ...base, tone: '' } })).body.error, 'invalid_rules');

  const read = await call(w, MEMBER, 'GET', `${CO}/rulebooks/cfo`);
  assert.equal(read.body.version, 2);
  assert.deepEqual(read.body.versions.map((v: any) => [v.version, v.by]), [[2, { uid: 'u-editor', name: 'Eve Editor' }], [1, { uid: 'u-editor', name: 'Eve Editor' }]]);
  assert.deepEqual(read.body.diff, [
    { section: 'works_in', added: [], removed: ['fundraising-readiness', 'company-creation'] },
    { section: 'may_propose', added: [], removed: ['draft:raise/use-of-funds-runway', 'draft:raise/use-of-funds-check', 'draft:raise/liquidity'] },
  ]);
  noPrivateKeys(read.text);

  // The agent works where its effective rule book says.
  const agents = (await call(w, EDITOR, 'GET', `${CO}/agents?module=company-creation`)).body.agents;
  assert.equal(agents.length, 0, 'the edit took company-creation away');
  assert.equal((await call(w, EDITOR, 'GET', `${CO}/agents?module=cap-table`)).body.agents.length, 1);
  const profile = (await call(w, EDITOR, 'GET', `/agents/${(w.db.prepare('SELECT uid FROM team_agents').get() as any).uid}`)).body;
  const cell = (k: string) => profile.matrix.find((m: any) => m.module === k);
  assert.deepEqual(cell('cap-table'), { module: 'cap-table', label: 'Cap table', read: true, propose: true, auto: false });
  assert.deepEqual(cell('use-of-funds'), { module: 'use-of-funds', label: 'Use of funds', read: true, propose: false, auto: false });
  assert.deepEqual(cell('pitch-deck').read, false);
  assert.ok(profile.events.some((e: any) => e.kind === 'rulebook_changed' && e.detail.version === 2));
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('include=projects: a company editor sees a project-under-company agent, a plain member does not, and it leaves with the project', async () => {
  const w = world();
  const p = await call(w, PROJECT_OWNER, 'POST', `/project/${IN_CO}/agents`, cfo({ role_key: 'cto' }));
  assert.equal(p.status, 201, p.text);
  assert.deepEqual(p.body.agent.project, { id: IN_CO, name: 'Rocket' });
  await call(w, EDITOR, 'POST', `${CO}/agents`, cfo());
  const editor = await call(w, EDITOR, 'GET', `${CO}/agents?include=projects`);
  assert.deepEqual(editor.body.agents.map((a: any) => [a.role_key, a.scope_kind]), [['cfo', 'company'], ['cto', 'project']]);
  const member = await call(w, MEMBER, 'GET', `${CO}/agents?include=projects`);
  assert.deepEqual(member.body.agents.map((a: any) => a.role_key), ['cfo']);
  w.db.prepare('UPDATE projects SET company_id = NULL WHERE id = ?').run(IN_CO);
  assert.deepEqual((await call(w, EDITOR, 'GET', `${CO}/agents?include=projects`)).body.agents.map((a: any) => a.role_key), ['cfo']);
  noPrivateKeys(editor.text);
});

// 8 ───────────────────────────────────────────────────────────────────────────
test('month spend: the sum of this month’s charges; unknown when a charge is unrecorded or the read throws; never 0 for unknown', async () => {
  // Mutations checked: SUM(COALESCE(charged_microusd, 0)) with the unrecorded count dropped → the unrecorded assert reads 300 and fails;
  // the catch returning { available: true, value_microusd: 0 } → the throwing assert fails.
  const w = world();
  const a = (await call(w, EDITOR, 'POST', `${CO}/agents`, cfo())).body.agent;
  const id = (w.db.prepare('SELECT id FROM team_agents WHERE uid = ?').get(a.uid) as any).id;
  const log = w.db.prepare("INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, agent_id, created_at) VALUES (?, 'rail', ?, ?, ?, ?)");
  log.run(EDITOR, MODEL, 100, id, new Date().toISOString().slice(0, 19).replace('T', ' '));
  log.run(EDITOR, MODEL, 200, id, new Date().toISOString().slice(0, 19).replace('T', ' '));
  log.run(EDITOR, MODEL, 9_999, id, '2000-01-01 00:00:00');
  log.run(EDITOR, MODEL, 9_999, id + 1, new Date().toISOString().slice(0, 19).replace('T', ' '));
  assert.deepEqual((await call(w, EDITOR, 'GET', `/agents/${a.uid}`)).body.month_spend, { available: true, value_microusd: 300 });
  log.run(EDITOR, MODEL, null, id, new Date().toISOString().slice(0, 19).replace('T', ' '));
  assert.deepEqual((await call(w, EDITOR, 'GET', `/agents/${a.uid}`)).body.month_spend, { available: false });
  w.db.exec('ALTER TABLE ai_usage_logs RENAME TO ai_usage_logs_gone');
  const listed = (await call(w, EDITOR, 'GET', `${CO}/agents`)).body.agents[0];
  assert.deepEqual(listed.month_spend, { available: false });
  assert.ok(listed.last_activity_at, 'the added event is activity');
});

// 9 ───────────────────────────────────────────────────────────────────────────
test('no answer carries an email: roles, list, profile, add, patch', async () => {
  // Mutation checked: personOf returning the sponsor's email → every noPrivateKeys assert fails.
  const w = world();
  const added = await call(w, EDITOR, 'POST', `${CO}/agents`, cfo());
  for (const r of [added, await call(w, EDITOR, 'GET', '/roles'), await call(w, MEMBER, 'GET', `${CO}/agents`),
    await call(w, MEMBER, 'GET', `/agents/${added.body.agent.uid}`), await call(w, EDITOR, 'PATCH', `/agents/${added.body.agent.uid}`, { first_name: 'Cara' })]) {
    assert.equal(r.status < 300, true, r.text);
    noPrivateKeys(r.text);
  }
  const roles = (await call(w, MEMBER, 'GET', '/roles')).body.roles;
  assert.equal(roles.length, 11);
  assert.deepEqual(roles.find((r: any) => r.key === 'cfo').works_in[0], { key: 'use-of-funds', label: 'Use of funds' });
});

// ═════════════════════════════════════════════════════════════════════════════
// Part 2 (#3842): the agent run path, the per-agent cap and agent_id on usage.
// The real run(): its hold, its guard (stubbed safe), its usage rows; only the
// model is a stub. The sponsor is the company editor on a paid plan.
// ═════════════════════════════════════════════════════════════════════════════

const RUN_MODEL = '@cf/openai/gpt-oss-120b';
const RUN_BODY = { module: 'use-of-funds', option: 'draft:raise/use-of-funds-runway', record: 'project:7', prompt: 'How long is our cash horizon?' };

function runWorld(answer: (model: string, input: any) => any = () => ({ response: 'Eighteen months.', usage: { prompt_tokens: 40, completion_tokens: 10 } })) {
  __resetForTest();
  const w = world();
  w.db.exec(AI_BUDGET_MIGRATION + sql('migrations/465_ai_rail_preferences.sql') + sql('migrations/510_member_ai_pauses.sql')
    + sql('migrations/525_ai_reservation_idempotency.sql') + sql('migrations/632_ai_hold_context.sql'));
  w.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('founder:growth',0,0,1)").run();
  w.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,50000000)').run(EDITOR);
  const calls: string[] = [];
  w.env.AI = withGuard({ run: async (model: string, input: any) => { calls.push(model); return answer(model, input); } });
  return { ...w, calls };
}
type RW = ReturnType<typeof runWorld>;
async function addCfo(w: RW, cap = CAP) {
  const r = await call(w, EDITOR, 'POST', `${CO}/agents`, cfo({ model_id: RUN_MODEL, monthly_cap_microusd: cap }));
  assert.equal(r.status, 201, r.text);
  return r.body.agent.uid as string;
}
const agentRow = (w: RW, uid: string) => w.db.prepare('SELECT * FROM team_agents WHERE uid = ?').get(uid) as any;
const eventsOf = (w: RW, uid: string) => w.db.prepare('SELECT e.* FROM team_agent_events e JOIN team_agents a ON a.id = e.agent_id WHERE a.uid = ? ORDER BY e.id').all(uid) as any[];
const charge = (w: RW, agentId: number, micro: number | null) => w.db.prepare(
  "INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, agent_id) VALUES (?, 'rail_numbers', ?, ?, ?)",
).run(EDITOR, RUN_MODEL, micro, agentId);

// 9 ───────────────────────────────────────────────────────────────────────────
test('a sponsor runs their CFO: one proposal with agent_id under the sponsor, usage rows with agent_id, a run event, the hold named agent.cfo', async () => {
  // Mutations checked: recordUsage without agent_id → the usage asserts fail; proposeRail without agent_id →
  // the proposal assert fails; the hold named ai.<task> → the operation assert fails.
  const w = runWorld();
  try {
    const uid = await addCfo(w);
    const r = await call(w, EDITOR, 'POST', `/agents/${uid}/run`, RUN_BODY);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(w.calls.filter((m) => m !== '@cf/meta/llama-guard-3-8b'), [RUN_MODEL], 'the agent\'s own model ran, once');
    const a = agentRow(w, uid);
    const rows = w.db.prepare('SELECT * FROM ai_usage_logs ORDER BY id').all() as any[];
    assert.ok(rows.length >= 1);
    for (const row of rows) {
      assert.equal(row.agent_id, a.id, `usage row ${row.id} (${row.task}) names the agent`);
      assert.equal(row.user_id, EDITOR, 'charged to the sponsor');
    }
    const run = rows.find((x) => x.task === 'rail_numbers');
    assert.equal(run.rail_page, 'Founder · Raise · Use of funds');
    assert.equal(run.rail_option, 'draft:raise/use-of-funds-runway');
    assert.equal(run.record_ref, 'project:7');
    assert.equal(run.surface, '/raise/use-of-funds', 'D552: the module\'s own page');
    const p = w.db.prepare('SELECT * FROM ai_rail_proposals').get() as any;
    assert.equal(p.agent_id, a.id);
    assert.equal(p.user_id, EDITOR, 'the proposal is the sponsor\'s row');
    assert.equal(p.status, 'proposed');
    assert.equal(p.usage_log_id, run.id);
    assert.equal(r.body.proposal.uid, p.uid);
    assert.deepEqual(r.body.charged, { available: true, value_microusd: rows.reduce((s, x) => s + x.charged_microusd, 0) });
    const hold = w.db.prepare('SELECT operation, surface FROM ai_budget_reservations').get() as any;
    assert.deepEqual({ ...hold }, { operation: 'agent.cfo', surface: 'ai' });
    const ev = eventsOf(w, uid).find((e) => e.kind === 'run');
    assert.equal(ev.usage_log_id, run.id);
    assert.equal(ev.proposal_uid, p.uid);
    assert.equal(ev.actor_user_id, EDITOR);
    assert.ok(!String(ev.detail_json).includes('horizon'), 'the prompt is never written to an event');
    // The profile fills month_spend and the run event from these writes.
    const prof = await call(w, EDITOR, 'GET', `/agents/${uid}`);
    assert.deepEqual(prof.body.month_spend, r.body.charged);
    assert.equal(prof.body.events[0].kind, 'run');
    assert.equal(prof.body.events[0].proposal_uid, p.uid);
    noPrivateKeys(r.text); noPrivateKeys(prof.text);
  } finally { w.db.close(); }
});

// 10 ──────────────────────────────────────────────────────────────────────────
test('only the sponsor runs it; a module outside works_in and an option outside may_propose are refused, with a refused event and no model call', async () => {
  // Mutations checked: the works_in check dropped → module_not_allowed fails; the may_propose check dropped →
  // option_not_allowed fails; the sponsor test dropped → the not_sponsor assert fails.
  const w = runWorld();
  try {
    const uid = await addCfo(w);
    const other = await call(w, FREE_EDITOR, 'POST', `/agents/${uid}/run`, RUN_BODY);
    assert.equal(other.status, 403); assert.equal(other.body.error, 'not_sponsor');
    assert.equal((await call(w, STRANGER, 'POST', `/agents/${uid}/run`, RUN_BODY)).status, 404, 'outside the team it does not exist');
    const mod = await call(w, EDITOR, 'POST', `/agents/${uid}/run`, { ...RUN_BODY, module: 'distribution' });
    assert.equal(mod.status, 403); assert.equal(mod.body.error, 'module_not_allowed');
    const opt = await call(w, EDITOR, 'POST', `/agents/${uid}/run`, { ...RUN_BODY, option: 'draft:update' });
    assert.equal(opt.status, 403); assert.equal(opt.body.error, 'option_not_allowed');
    // An option the module offers that the rule book does not list.
    const unlisted = await call(w, EDITOR, 'POST', `/agents/${uid}/run`, { ...RUN_BODY, option: 'form:uof-milestone-wording' });
    assert.equal(unlisted.status, 403); assert.equal(unlisted.body.error, 'option_not_allowed');
    // An option the rule book lists, but in a module that does not offer it.
    const elsewhere = await call(w, EDITOR, 'POST', `/agents/${uid}/run`, { ...RUN_BODY, module: 'cap-table' });
    assert.equal(elsewhere.status, 403); assert.equal(elsewhere.body.error, 'option_not_allowed');
    assert.equal((await call(w, EDITOR, 'POST', `/agents/${uid}/run`, { ...RUN_BODY, prompt: '  ' })).body.error, 'invalid_prompt');
    assert.deepEqual(w.calls, [], 'nothing ran, not even the guard');
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_usage_logs').get().n, 0);
    assert.deepEqual(eventsOf(w, uid).filter((e) => e.kind === 'refused').map((e) => JSON.parse(e.detail_json).code),
      ['module_not_allowed', 'option_not_allowed', 'option_not_allowed', 'option_not_allowed', 'invalid_prompt']);
    // A paused agent.
    await call(w, EDITOR, 'PATCH', `/agents/${uid}`, { status: 'paused' });
    const paused = await call(w, EDITOR, 'POST', `/agents/${uid}/run`, RUN_BODY);
    assert.equal(paused.status, 403); assert.equal(paused.body.error, 'agent_paused');
  } finally { w.db.close(); }
});

// 11 ──────────────────────────────────────────────────────────────────────────
test('the cap: one micro-dollar under runs; exactly at the cap is 402 agent_cap_reached and pauses it with cap; a failed spend read refuses', async () => {
  // Mutations checked: `>=` turned `>` → the at-the-cap run is let through; the spend read as
  // COALESCE(SUM(...), 0) with unrecorded rows ignored → the unreadable case runs.
  const w = runWorld();
  try {
    const uid = await addCfo(w, 1_000_000);
    const a = agentRow(w, uid);
    charge(w, a.id, 999_999);
    const under = await call(w, EDITOR, 'GET', `/agents/${uid}/run/quote?module=use-of-funds&option=draft:raise/use-of-funds-runway`);
    assert.equal(under.status, 200, under.text);
    w.db.prepare('UPDATE ai_usage_logs SET charged_microusd = 1000000 WHERE agent_id = ?').run(a.id);
    const at = await call(w, EDITOR, 'POST', `/agents/${uid}/run`, RUN_BODY);
    assert.equal(at.status, 402); assert.equal(at.body.error, 'agent_cap_reached');
    assert.equal(agentRow(w, uid).status, 'paused'); assert.equal(agentRow(w, uid).paused_reason, 'cap');
    assert.ok(eventsOf(w, uid).some((e) => e.kind === 'paused' && JSON.parse(e.detail_json).reason === 'cap'));
    assert.deepEqual(w.calls, []);
    // Resumed with a higher cap, but a charge that is not recorded: the spend is unknown, so it does not run.
    await call(w, EDITOR, 'PATCH', `/agents/${uid}`, { status: 'active', monthly_cap_microusd: 5_000_000 });
    charge(w, a.id, null);
    const unknown = await call(w, EDITOR, 'POST', `/agents/${uid}/run`, RUN_BODY);
    assert.equal(unknown.status, 503); assert.equal(unknown.body.error, 'agent_spend_unreadable');
    assert.equal(agentRow(w, uid).status, 'active', 'an unreadable spend refuses the run; it does not pause the agent');
    // A read that throws refuses too.
    w.db.prepare('DELETE FROM ai_usage_logs WHERE charged_microusd IS NULL').run();
    const prepare = w.env.DB.prepare.bind(w.env.DB);
    w.env.DB.prepare = (q: string) => { if (/FROM ai_usage_logs WHERE agent_id/.test(q)) throw new Error('D1 down'); return prepare(q); };
    const threw = await call(w, EDITOR, 'POST', `/agents/${uid}/run`, RUN_BODY);
    assert.equal(threw.body.error, 'agent_spend_unreadable');
    assert.deepEqual(w.calls, []);
  } finally { w.db.close(); }
});

// 12 ──────────────────────────────────────────────────────────────────────────
test('a sponsor who left the company: the run is 403 sponsor_lost_access and the agent is paused sponsor_left', async () => {
  // Mutation checked: the sponsor's manage gate removed → the run goes ahead and the asserts fail.
  const w = runWorld();
  try {
    const uid = await addCfo(w);
    w.db.prepare('DELETE FROM user_company_links WHERE user_id = ?').run(EDITOR);
    const r = await call(w, EDITOR, 'POST', `/agents/${uid}/run`, RUN_BODY);
    // Outside the team, the agent is not theirs to see: the route says so before the run's own gate.
    assert.equal(r.status, 404);
    // Still a member, no longer an editor: the run's own gate pauses it.
    w.db.prepare("INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES ('l9', ?, 1, 'Member')").run(EDITOR);
    const demoted = await call(w, EDITOR, 'POST', `/agents/${uid}/run`, RUN_BODY);
    assert.equal(demoted.status, 403); assert.equal(demoted.body.error, 'sponsor_lost_access');
    assert.equal(agentRow(w, uid).status, 'paused'); assert.equal(agentRow(w, uid).paused_reason, 'sponsor_left');
    const ev = eventsOf(w, uid);
    assert.ok(ev.some((e) => e.kind === 'paused' && JSON.parse(e.detail_json).reason === 'sponsor_left'));
    assert.ok(ev.some((e) => e.kind === 'refused' && JSON.parse(e.detail_json).code === 'sponsor_lost_access'));
    assert.deepEqual(w.calls, []);
  } finally { w.db.close(); }
});

// 13 ──────────────────────────────────────────────────────────────────────────
test('run() refusals pass through in their own words; the quote is an upper bound, and available: false when it cannot be read', async () => {
  const w = runWorld();
  try {
    const uid = await addCfo(w);
    const q = await call(w, EDITOR, 'GET', `/agents/${uid}/run/quote?module=use-of-funds&option=draft:raise/use-of-funds-runway`);
    assert.equal(q.status, 200, q.text);
    assert.equal(q.body.quote.available, true);
    assert.ok(Number.isSafeInteger(q.body.quote.value_microusd) && q.body.quote.value_microusd > 0);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n, 0, 'a quote holds nothing');
    // The sponsor turned AI assistance off on the module's page: run()'s own refusal and words.
    w.db.prepare("INSERT INTO ai_rail_preferences(uid,user_id,section,task,mode) VALUES('off',?,'founder · raise · use of funds','','manual')").run(EDITOR);
    const off = await call(w, EDITOR, 'POST', `/agents/${uid}/run`, RUN_BODY);
    assert.equal(off.status, 403); assert.equal(off.body.error, 'assist_off');
    assert.equal(off.body.message, 'AI assistance is off on this page.');
    assert.ok(eventsOf(w, uid).some((e) => e.kind === 'refused' && JSON.parse(e.detail_json).code === 'assist_off'));
    w.db.prepare("DELETE FROM ai_rail_preferences").run();
    // The price cannot be worked out (the sponsor's multiplier is unreadable): available false, never 0.
    w.env.AI_BILLING = 'charged';
    const prepare = w.env.DB.prepare.bind(w.env.DB);
    // Armed once the run's checks read the rule book, so signing in still reads the caller.
    let armed = false;
    w.env.DB.prepare = (q: string) => {
      if (/FROM team_rulebooks/.test(q)) armed = true;
      if (armed && q === 'SELECT * FROM users WHERE id = ?') throw new Error('down');
      return prepare(q);
    };
    const broken = await call(w, EDITOR, 'GET', `/agents/${uid}/run/quote?module=use-of-funds&option=draft:raise/use-of-funds-runway`);
    assert.equal(broken.status, 200, broken.text);
    assert.deepEqual(broken.body.quote, { available: false });
  } finally { w.db.close(); }
});

// 14 ──────────────────────────────────────────────────────────────────────────
test('roles lists the models an agent may run on, and plan_locked agrees with the add route', async () => {
  const w = world();
  try {
    const paid = (await call(w, EDITOR, 'GET', '/roles')).body.models as any[];
    assert.ok(paid.length > 3);
    const llama = paid.find((m) => m.id === MODEL);
    assert.deepEqual(llama, { id: MODEL, label: 'llama-3.3-70b-instruct-fp8-fast', kind: 'Text Generation', beta: false, plan_locked: false });
    assert.ok(!paid.some((m) => m.id === '@cf/black-forest-labs/flux-1-schnell'), 'only text models');
    for (const m of paid) {
      const r = await call(w, EDITOR, 'POST', `${CO}/agents`, { ...cfo({ model_id: m.id }), role_key: 'cto' });
      assert.equal(r.status === 201, !m.plan_locked, `${m.id}: listed ${m.plan_locked ? 'locked' : 'open'}, added ${r.status}`);
      if (r.status === 201) await call(w, EDITOR, 'DELETE', `/agents/${r.body.agent.uid}`);
    }
    // A free plan sees every model locked.
    assert.ok(((await call(w, FREE_EDITOR, 'GET', '/roles')).body.models as any[]).every((m) => m.plan_locked));
  } finally { w.db.close(); }
});

test('holdOperation: an agent run is agent.<role> on the ai surface; anything else is ai.<task>', () => {
  assert.equal(holdOperation({ task: 'rail_numbers', agentId: 4, agentRole: 'cfo' }), 'agent.cfo');
  assert.equal(holdOperation({ task: 'rail_numbers' }), 'ai.rail_numbers');
  assert.equal(holdOperation({ task: 'rail_numbers', agentId: 4, agentRole: 'Bad Role!' }), 'ai.rail_numbers');
  assert.equal(holdOperation({ task: 'rail_numbers', agentId: 0, agentRole: 'cfo' }), 'ai.rail_numbers');
});
