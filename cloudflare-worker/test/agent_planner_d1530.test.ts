// D1530 (#3848, E4 of #3742) — the goal planner, the role templates and the
// "team from a goal" wizard on /api/teams.
//
//   · the plan: unknown modules and roles are dropped and each drop is noted;
//     a dependency loop invalidates the whole plan (422 plan_invalid, nothing
//     proposed); more than 20 items keeps 20;
//   · Accept creates every task in ONE batch (source_kind 'plan', the
//     dependencies, the agent of the role when it may work there); a batch
//     that fails creates none and frees the plan; a plan is decided once;
//   · the CEO / Chief of staff agent runs it when the scope has one, else the
//     asking manager's own Eadwyn;
//   · the wizard per stage, "Already on the team", an open task's module;
//     the month estimate is { available: false } when it cannot be read or
//     there is no duty, never 0;
//   · the templates' duties are their roles' own options; the capabilities.
//
// Real SQLite with migrations 712 and 727. The model runs are stubbed.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/agent_planner_d1530.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { addColumnsFrom, stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import agentEngine from '../src/routes/agent_engine.ts';
import teamAgents from '../src/routes/team_agents.ts';
import { proposeRail } from '../src/services/railProposals.ts';
import { PLAN_MAX, PLAN_OPTION, acceptPlan, applyEdits, draftPlan, hasCycle, parsePlan } from '../src/services/agents/planner.ts';
import { STAGE_ROLES, TEMPLATES, monthEstimate, suggestRoles } from '../src/services/agents/templates.ts';
import { ALWAYS_ASKS_FLOOR, roleOf } from '../src/services/agents/catalogue.ts';
import { optionRowIn, textOption } from '../src/services/agents/agentRun.ts';
import { loadScope } from '../src/services/agents/teams.ts';
import { goalByUid } from '../src/services/agents/goals.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const MIGRATION = sql('migrations/727_scope_goals_and_tasks.sql');

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const EDITOR = 10, MEMBER = 11, STRANGER = 12, PROJECT_OWNER = 15, ADVISOR = 16;
const IN_CO = 7, ALONE = 8, OTHER_CO_PROJECT = 9;
const CO = '/company/co-uid-1';

function world() {
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects', 'roadmap_okrs'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  db.exec(sql('migrations/712_team_agents.sql'));
  db.exec(stripForeignKeys(MIGRATION));
  db.exec(`CREATE TABLE IF NOT EXISTS project_members (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'cofounder', status TEXT NOT NULL DEFAULT 'accepted', source TEXT, invited_by INTEGER, created_at TEXT, updated_at TEXT)`);
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, 'growth', 'active')");
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100);
  user.run(MEMBER, 'u-member', 'member@example.test', 'Max Member', 'founder', 101);
  user.run(STRANGER, 'u-stranger', 'stranger@example.test', 'Sam Stranger', 'founder', 102);
  user.run(PROJECT_OWNER, 'u-powner', 'powner@example.test', 'Pat Owner', 'founder', 200);
  user.run(ADVISOR, 'u-advisor', 'advisor@example.test', 'Al Advisor', 'founder', 104);
  db.prepare("INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme'), (2, 'co-uid-2', 'Other')").run();
  const link = db.prepare('INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES (?, ?, ?, ?)');
  link.run('l1', EDITOR, 1, 'Founder'); link.run('l2', MEMBER, 1, 'Member');
  const project = db.prepare('INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (?, ?, ?, 200, ?)');
  project.run(IN_CO, 'p7', 'Rocket', 1); project.run(ALONE, 'p8', 'Solo', null); project.run(OTHER_CO_PROJECT, 'p9', 'Elsewhere', 2);
  db.prepare("INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'advisor', 'accepted')").run(ALONE, ADVISOR);
  db.prepare("INSERT INTO roadmap_okrs (id, project_id, objective) VALUES (1, ?, 'Ship v1'), (2, ?, 'Elsewhere')").run(IN_CO, ALONE);
  const env: any = { DB, JWT_SECRET: 'd1530-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true', AGENT_ENGINE: 'on' };
  return { db, env };
}
type W = ReturnType<typeof world>;

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  // As index.ts mounts them: the engine first, then team agents.
  a.route('/api/teams', agentEngine);
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
function noPrivateKeys(text: string) {
  assert.ok(!/"email"\s*:/.test(text), 'an email key');
  assert.ok(!/@example\.test/.test(text), 'an email address');
  assert.ok(!/"(user_id|assignee_user_id|created_by|created_by_user_id|actor_user_id)"\s*:/.test(text), 'a numeric user id key');
}
/** A live CFO on the company, through part 1's own route. */
async function cfo(w: W, scope = CO) {
  const r = await call(w, scope === CO ? EDITOR : PROJECT_OWNER, 'POST', `${scope}/agents`, { role_key: 'cfo', first_name: 'Carla', last_name: 'Cash', model_id: MODEL, monthly_cap_microusd: 5_000_000 });
  assert.equal(r.status, 201, r.text);
  return r.body.agent.uid as string;
}
const task = async (w: W, body: Record<string, unknown>, scope = CO, who = EDITOR) => {
  const r = await call(w, who, 'POST', `${scope}/tasks`, body);
  assert.equal(r.status, 201, r.text);
  return r.body.task;
};

// 1 ───────────────────────────────────────────────────────────────────────────
const goal = async (w: W, scope = CO, who = EDITOR) => {
  const r = await call(w, who, 'POST', `${scope}/goals`, { title: 'Close the seed round' });
  assert.equal(r.status, 201, r.text);
  return r.body.goal.uid as string;
};
const PLAN = JSON.stringify({ items: [
  { title: 'Update the runway', module: 'use-of-funds', suggested_assignee: { role_key: 'cfo' }, depends_on: [], due_in_days: 7 },
  { title: 'Book investor calls', module: 'capital-relationships', suggested_assignee: { person: true }, depends_on: [0], due_in_days: 14 },
  { title: 'Paint the office', module: 'interior-design', suggested_assignee: { person: true }, depends_on: [] },
  { title: 'Hire a wizard', module: 'team-expansion', suggested_assignee: { role_key: 'wizard' }, depends_on: [] },
  { title: 'Send the deck', module: 'pitch-deck', suggested_assignee: { person: true }, depends_on: [1, 2] },
] });
/** draftPlan with the Eadwyn run stubbed to answer `output`. */
async function plan(w: W, g: string, output: string, who = EDITOR) {
  const goalRow = (await goalByUid(w.env, g))!;
  const s = (await loadScope(w.env, 'company', 'co-uid-1'))!;
  const user = w.db.prepare('SELECT * FROM users WHERE id = ?').get(who) as any;
  return draftPlan(w.env, s, goalRow, user, { run: (async () => ({ ok: true, output, usage: { model: 'stub' }, usageLogId: null })) as any });
}

test('parsePlan: unknown modules and roles drop their items, each noted; a wait on a dropped item is removed and noted', () => {
  // Mutations checked: an unknown module kept → 5 items; the drop notes removed → dropped is empty.
  const r = parsePlan(PLAN);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.items.map((i) => [i.title, i.module, i.depends_on]), [
    ['Update the runway', 'use-of-funds', []], ['Book investor calls', 'capital-relationships', [0]], ['Send the deck', 'pitch-deck', [1]],
  ]);
  assert.deepEqual(r.plan.items.map((i) => i.suggested_assignee), [{ role_key: 'cfo' }, { person: true }, { person: true }]);
  assert.equal(r.plan.dropped.length, 3);
  assert.match(r.plan.dropped[0], /Paint the office.*interior-design/);
  assert.match(r.plan.dropped[1], /Hire a wizard.*wizard/);
  assert.match(r.plan.dropped[2], /Send the deck.*left out/);
  assert.deepEqual(r.plan.items.map((i) => i.due_in_days), [7, 14, null]);
});

test('parsePlan: a dependency loop invalidates the whole plan; more than 20 items keeps 20; prose around the JSON is fine', () => {
  // Mutation checked: hasCycle always false → the loop is accepted.
  const loop = parsePlan(JSON.stringify([
    { title: 'A', module: 'studio', suggested_assignee: { person: true }, depends_on: [1] },
    { title: 'B', module: 'studio', suggested_assignee: { person: true }, depends_on: [0] },
  ]));
  assert.deepEqual(loop, { ok: false, code: 'plan_invalid', message: loop.ok ? '' : loop.message });
  assert.equal(hasCycle([{ depends_on: [0] }]), true, 'an item waiting on itself');
  const many = parsePlan('Here is the plan:\n```json\n' + JSON.stringify({ items: Array.from({ length: 25 }, (_, i) => ({ title: `T${i}`, module: 'studio', suggested_assignee: { person: true }, depends_on: [] })) }) + '\n```');
  assert.ok(many.ok);
  assert.equal(many.plan.items.length, PLAN_MAX);
  assert.match(many.plan.dropped[0], /first 20.*5 more/);
  assert.equal(parsePlan('no json at all').ok, false);
  assert.equal(parsePlan('[]').ok, false, 'nothing usable is not a plan');
});

test('draftPlan: with no CEO agent the manager’s own Eadwyn runs it; the plan is kept on one proposal; an invalid plan is discarded and 422', async () => {
  const w = world();
  try {
    const g = await goal(w);
    const r = await plan(w, g, PLAN);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.proposal.by, 'eadwyn');
    const row = w.db.prepare('SELECT rail_option, record_ref, status, payload_json FROM ai_rail_proposals WHERE uid = ?').get(r.proposal.uid) as any;
    assert.deepEqual([row.rail_option, row.record_ref, row.status], [PLAN_OPTION, `goal:${g}`, 'proposed']);
    assert.equal(JSON.parse(row.payload_json).plan.items.length, 3);
    assert.equal(JSON.parse(row.payload_json).plan.dropped.length, 3, 'the drops are noted in the proposal');
    const bad = await plan(w, g, JSON.stringify([{ title: 'A', module: 'studio', suggested_assignee: { person: true }, depends_on: [0] }]));
    assert.deepEqual([bad.ok, (bad as any).status, (bad as any).code], [false, 422, 'plan_invalid']);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM ai_rail_proposals WHERE status = 'proposed'").get() as any).n, 1, 'the invalid plan proposes nothing');
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM scope_tasks').get() as any).n, 0, 'a draft creates no task');
  } finally { w.db.close(); }
});

test('draftPlan: the scope’s CEO / Chief of staff agent runs it through agentRun, on propose:goal-plan in Studio', async () => {
  const w = world();
  try {
    const r0 = await call(w, EDITOR, 'POST', `${CO}/agents`, { role_key: 'ceo', first_name: 'Cleo', last_name: 'Chief', model_id: MODEL, monthly_cap_microusd: 5_000_000 });
    assert.equal(r0.status, 201, r0.text);
    assert.ok(roleOf('ceo')!.default_rules.may_propose.includes(PLAN_OPTION), 'the CEO may propose a plan');
    const g = await goal(w);
    const goalRow = (await goalByUid(w.env, g))!;
    const s = (await loadScope(w.env, 'company', 'co-uid-1'))!;
    const asked: any[] = [];
    const r = await draftPlan(w.env, s, goalRow, w.db.prepare('SELECT * FROM users WHERE id = ?').get(EDITOR) as any, {
      agentRun: (async (_env: any, input: any) => {
        asked.push({ role: input.agent.role_key, module: input.module, option: input.option, record: input.record, sees: input.prompt });
        const p = await proposeRail(w.env, { userId: EDITOR, page: 'Founder · Studio', option: PLAN_OPTION, record: input.record, kind: 'draft', payload: { text: PLAN } });
        return { ok: true, proposal: p, charged: { available: false }, usageLogId: null };
      }) as any,
    });
    assert.ok(r.ok);
    assert.equal(r.proposal.by, 'agent');
    assert.deepEqual(asked.map(({ sees, ...x }) => x), [{ role: 'ceo', module: 'studio', option: PLAN_OPTION, record: `goal:${g}` }]);
    assert.match(asked[0].sees, /Goal: Close the seed round/);
    assert.match(asked[0].sees, /Agents on the team: CEO \/ Chief of staff/);
    assert.doesNotMatch(asked[0].sees, /@example\.test/, 'the planner never sees an email');
    assert.ok(optionRowIn('studio', PLAN_OPTION) && textOption(optionRowIn('studio', PLAN_OPTION)!), 'the rail row exists and is a text run');
  } finally { w.db.close(); }
});

test('Accept: every task in one batch with source_kind plan, its dependencies, the agent of its role; decided once', async () => {
  // Mutations checked: tasks inserted one by one outside the batch (the failing-batch case below leaves rows);
  // source_kind 'manual' → the source assertion; a second accept is refused 409 plan_decided.
  const w = world();
  try {
    await cfo(w);
    const g = await goal(w);
    const r = await plan(w, g, PLAN);
    assert.ok(r.ok);
    const a = await call(w, EDITOR, 'POST', `/goals/${g}/plan/accept`, { proposal: r.proposal.uid });
    assert.equal(a.status, 201, a.text);
    noPrivateKeys(a.text);
    assert.deepEqual(a.body.tasks.map((t: any) => [t.title, t.module, t.assignee.kind, t.depends_on.length, t.goal.uid]), [
      ['Update the runway', 'use-of-funds', 'agent', 0, g], ['Book investor calls', 'capital-relationships', 'none', 1, g], ['Send the deck', 'pitch-deck', 'none', 1, g],
    ]);
    assert.equal(a.body.tasks[0].assignee.agent.role_key, 'cfo');
    assert.equal(a.body.tasks[1].depends_on[0], a.body.tasks[0].uid);
    assert.match(a.body.tasks[0].due_at, /^\d{4}-\d{2}-\d{2}$/);
    const rows = w.db.prepare("SELECT source_kind, source_ref FROM scope_tasks").all() as any[];
    assert.deepEqual([...new Set(rows.map((x) => `${x.source_kind}:${x.source_ref}`))], [`plan:${r.proposal.uid}`]);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM scope_task_events WHERE kind = 'created'").get() as any).n, 3);
    assert.equal((w.db.prepare('SELECT status FROM ai_rail_proposals WHERE uid = ?').get(r.proposal.uid) as any).status, 'accepted');
    const again = await call(w, EDITOR, 'POST', `/goals/${g}/plan/accept`, { proposal: r.proposal.uid });
    assert.deepEqual([again.status, again.body.code ?? again.body.error], [409, 'plan_decided']);
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM scope_tasks').get() as any).n, 3);
  } finally { w.db.close(); }
});

test('Accept: a role agent outside its modules is not assigned; two accepts at once write the tasks once', async () => {
  // Mutations checked: the agentFits check dropped → the CFO gets the Distribution task; the claim's
  // `status = 'proposed'` guard removed → both racing accepts write their tasks.
  const w = world();
  try {
    await cfo(w);
    const g = await goal(w);
    const r = await plan(w, g, JSON.stringify({ items: [
      { title: 'Update the runway', module: 'use-of-funds', suggested_assignee: { role_key: 'cfo' }, depends_on: [] },
      { title: 'Draft outreach', module: 'distribution', suggested_assignee: { role_key: 'cfo' }, depends_on: [] },
    ] }));
    assert.ok(r.ok);
    const s = (await loadScope(w.env, 'company', 'co-uid-1'))!;
    const row = (await goalByUid(w.env, g))!;
    const user = w.db.prepare('SELECT * FROM users WHERE id = ?').get(EDITOR) as any;
    const both = await Promise.all([acceptPlan(w.env, s, row, r.proposal.uid, {}, user), acceptPlan(w.env, s, row, r.proposal.uid, {}, user)]);
    assert.deepEqual(both.map((x) => x.ok).sort(), [false, true]);
    assert.equal((both.find((x) => !x.ok) as any).code, 'plan_decided');
    const tasks = w.db.prepare('SELECT title, assignee_kind FROM scope_tasks ORDER BY id').all() as any[];
    assert.deepEqual(tasks.map((t) => [t.title, t.assignee_kind]), [['Update the runway', 'agent'], ['Draft outreach', 'none']]);
  } finally { w.db.close(); }
});

test('Accept with edits: removed items go (with every wait on them), retitled items are renamed, and the proposal is recorded as edited', async () => {
  const w = world();
  try {
    const g = await goal(w);
    const r = await plan(w, g, PLAN);
    assert.ok(r.ok);
    const a = await call(w, EDITOR, 'POST', `/goals/${g}/plan/accept`, { proposal: r.proposal.uid, remove: [0], titles: { 2: 'Send the deck to five funds' } });
    assert.equal(a.status, 201, a.text);
    assert.deepEqual(a.body.tasks.map((t: any) => [t.title, t.depends_on.length]), [['Book investor calls', 0], ['Send the deck to five funds', 1]]);
    assert.equal((w.db.prepare('SELECT status FROM ai_rail_proposals WHERE uid = ?').get(r.proposal.uid) as any).status, 'edited');
    assert.deepEqual(applyEdits(r.proposal.plan, { remove: [0, 1, 2] }).ok, false, 'keep at least one item');
    assert.equal(applyEdits(r.proposal.plan, { titles: { 9: 'x' } }).ok, false);
  } finally { w.db.close(); }
});

test('Accept: a batch that fails creates no task and frees the plan to accept again; a stranger, a member and another goal are refused', async () => {
  const w = world();
  try {
    const g = await goal(w);
    const r = await plan(w, g, PLAN);
    assert.ok(r.ok);
    w.db.exec('ALTER TABLE scope_task_deps RENAME TO scope_task_deps_gone');
    const s = (await loadScope(w.env, 'company', 'co-uid-1'))!;
    const failed = await acceptPlan(w.env, s, (await goalByUid(w.env, g))!, r.proposal.uid, {}, w.db.prepare('SELECT * FROM users WHERE id = ?').get(EDITOR) as any);
    assert.deepEqual([failed.ok, (failed as any).code], [false, 'plan_not_saved']);
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM scope_tasks').get() as any).n, 0, 'one batch: none of the tasks exists');
    assert.equal((w.db.prepare('SELECT status FROM ai_rail_proposals WHERE uid = ?').get(r.proposal.uid) as any).status, 'proposed');
    w.db.exec('ALTER TABLE scope_task_deps_gone RENAME TO scope_task_deps');
    assert.equal((await call(w, STRANGER, 'POST', `/goals/${g}/plan/accept`, { proposal: r.proposal.uid })).status, 404);
    assert.equal((await call(w, MEMBER, 'POST', `/goals/${g}/plan/accept`, { proposal: r.proposal.uid })).status, 403);
    const other = await goal(w);
    assert.equal((await call(w, EDITOR, 'POST', `/goals/${other}/plan/accept`, { proposal: r.proposal.uid })).status, 404, 'a plan of another goal');
    assert.equal((await call(w, EDITOR, 'POST', `/goals/${g}/plan/accept`, { proposal: r.proposal.uid })).status, 201);
  } finally { w.db.close(); }
});

test('the wizard: the stage’s roles, a company’s, an open task’s module; Already on the team; no model and nothing written', async () => {
  // Mutations checked: the stage mapping for raise without investor_relations → the deepEqual; the route
  // counting done tasks, or ignoring open ones → the company read.
  assert.deepEqual(suggestRoles({ scopeKind: 'project', stage: 'raise', openTaskModules: [] }).map((s) => s.role_key), ['cfo', 'investor_relations', 'general_counsel']);
  assert.deepEqual(suggestRoles({ scopeKind: 'project', stage: 'build', openTaskModules: [] }).map((s) => s.role_key), ['cto', 'cpo', 'coo']);
  assert.deepEqual(suggestRoles({ scopeKind: 'project', stage: 'idea', openTaskModules: [] }).map((s) => s.role_key), ['research_analyst', 'cpo']);
  assert.deepEqual(suggestRoles({ scopeKind: 'project', stage: 'launch', openTaskModules: [] }).map((s) => s.role_key), ['cmo', 'sales']);
  assert.deepEqual(suggestRoles({ scopeKind: 'project', stage: 'grow', openTaskModules: [] }).map((s) => s.role_key), ['cmo', 'sales', 'people']);
  assert.deepEqual(suggestRoles({ scopeKind: 'company', stage: 'build', openTaskModules: [] }).map((s) => s.role_key), ['ceo', 'cfo', 'general_counsel']);
  const withTask = suggestRoles({ scopeKind: 'project', stage: 'launch', openTaskModules: ['data-room'] });
  assert.deepEqual(withTask.map((s) => s.role_key), ['cmo', 'sales', 'general_counsel', 'investor_relations']);
  assert.match(withTask[2].why, /Data room/);
  for (const keys of Object.values(STAGE_ROLES)) for (const k of keys) assert.ok(roleOf(k), k);
  const w = world();
  try {
    w.db.prepare("UPDATE projects SET lifecycle_stage = 'raise' WHERE id = ?").run(IN_CO);
    await cfo(w, `/project/${IN_CO}`);
    const before = (w.db.prepare('SELECT COUNT(*) AS n FROM team_agents').get() as any).n;
    const r = await call(w, PROJECT_OWNER, 'GET', `/project/${IN_CO}/suggested-team`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.stage, 'raise');
    assert.deepEqual(r.body.suggestions.map((s: any) => [s.role_key, s.already_on_team]), [['cfo', true], ['investor_relations', false], ['general_counsel', false]]);
    assert.ok(r.body.suggestions.every((s: any) => s.est_month_microusd.available === false || s.est_month_microusd.value > 0), 'never a 0 for unknown');
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM team_agents').get() as any).n, before, 'the read creates nothing');
    assert.equal((await call(w, ADVISOR, 'GET', `/project/${ALONE}/suggested-team`)).status, 403, 'manage only');
    // Through the route: a company's open task in Data room adds Investor relations; a done one adds nothing.
    await task(w, { title: 'Fill the data room', module: 'data-room' });
    const done = await task(w, { title: 'Ship the site', module: 'distribution' });
    assert.equal((await call(w, EDITOR, 'PATCH', `/tasks/${done.uid}`, { status: 'done' })).status, 200);
    const co = await call(w, EDITOR, 'GET', `${CO}/suggested-team`);
    assert.equal(co.status, 200, co.text);
    assert.deepEqual(co.body.suggestions.map((s: any) => s.role_key), ['ceo', 'cfo', 'general_counsel', 'investor_relations']);
    assert.match(co.body.suggestions[3].why, /Data room/);
  } finally { w.db.close(); }
});

test('the month estimate: quote × runs; { available: false } when a quote fails or there is no duty, never 0', async () => {
  // Mutation checked: a failed quote counted as 0 → the second assertion.
  const cfoT = TEMPLATES.find((t) => t.role_key === 'cfo')!;
  assert.deepEqual(await monthEstimate(cfoT, async () => 1000), { available: true, value: cfoT.duties.reduce((n, d) => n + 1000 * d.runs_per_month, 0) });
  assert.deepEqual(await monthEstimate(cfoT, async () => null), { available: false });
  assert.deepEqual(await monthEstimate(cfoT, async () => { throw new Error('down'); }), { available: false });
  const none = TEMPLATES.find((t) => t.duties.length === 0)!;
  assert.deepEqual(await monthEstimate(none, async () => 1000), { available: false }, `${none.role_key}: nothing scheduled is not $0`);
});

test('templates: one per role, each duty an option its role may propose and runs as text in a module it works in; GET /templates and /capabilities', async () => {
  assert.equal(TEMPLATES.length, 11);
  for (const t of TEMPLATES) {
    const r = roleOf(t.role_key)!;
    assert.ok(t.suggested_cap_microusd > 0, t.key);
    for (const d of t.duties) {
      assert.ok(r.default_rules.works_in.includes(d.module) && r.default_rules.may_propose.includes(d.option), `${t.key}: ${d.key}`);
      const row = optionRowIn(d.module, d.option);
      assert.ok(row && textOption(row), `${t.key}: ${d.key} is a text run`);
    }
  }
  const w = world();
  try {
    const t = await call(w, MEMBER, 'GET', '/templates');
    assert.equal(t.status, 200);
    assert.deepEqual(Object.keys(t.body.templates[0]).sort(), ['duties', 'key', 'model_tier', 'name', 'role_key', 'suggested_cap_microusd']);
    const cap = await call(w, MEMBER, 'GET', '/capabilities');
    assert.deepEqual(cap.body.floor, [...ALWAYS_ASKS_FLOOR]);
    assert.ok(cap.body.options.studio.includes(PLAN_OPTION));
    w.env.AGENT_ENGINE = 'off';
    for (const p of ['/templates', '/capabilities', `/goals/${'a'.repeat(32)}/plan/quote`]) assert.equal((await call(w, MEMBER, 'GET', p)).status, 404, p);
  } finally { w.db.close(); }
});
