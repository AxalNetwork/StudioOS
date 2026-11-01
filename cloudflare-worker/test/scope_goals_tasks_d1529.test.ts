// D1529 (#3845, E1 of #3742) — goals, tasks and dependencies on a company or
// a project, at /api/teams (routes/agent_engine.ts, migration 727).
//
//   · the flag: 404 agent_engine_off unless AGENT_ENGINE and TEAM_AGENTS_ENABLED;
//   · the gates: a stranger 403, a project advisor reads and cannot create, a
//     person assignee changes status only;
//   · goals: roll-up only within the company, the project's own OKR only;
//   · tasks: an agent within its rule book and live, a person on the team, a
//     company task about its own project only;
//   · dependencies: no cycle (direct and three hops), no other scope; ready is
//     derived; module= filters;
//   · cost is { available: false } until E3, and when the read throws;
//   · no answer carries an email or a numeric user id.
//
// Real SQLite with migrations 712 and 727 over the baseline's tables. Each case
// names the mutations it was checked against.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/scope_goals_tasks_d1529.test.ts
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
import { DEP_WALK_MAX, taskCosts } from '../src/services/agents/tasks.ts';
import { sumCosts } from '../src/services/agents/goals.ts';

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
  // D1614 W1 (#3969): the project board's columns on the same task store; project tasks now go through it.
  db.exec(stripForeignKeys(sql('migrations/762_scope_task_work_board.sql')));
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
  const env: any = { DB, JWT_SECRET: 'd1529-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true', AGENT_ENGINE: 'on' };
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
test('off: every route is 404 agent_engine_off unless AGENT_ENGINE is on and team agents are; team agents keep their own paths', async () => {
  // Mutation checked: the flag reading only AGENT_ENGINE → the TEAM_AGENTS_ENABLED=false row answers 200.
  for (const env of [{ AGENT_ENGINE: 'off' }, { AGENT_ENGINE: undefined }, { TEAM_AGENTS_ENABLED: 'false' }]) {
    const w = world(); Object.assign(w.env, env);
    try {
      for (const [m, p] of [['GET', `${CO}/goals`], ['POST', `${CO}/goals`], ['PATCH', '/goals/abc'], ['GET', `${CO}/tasks`], ['POST', `${CO}/tasks`], ['PATCH', '/tasks/abc'], ['PUT', '/tasks/abc/deps']]) {
        const r = await call(w, EDITOR, m, p, m === 'GET' ? undefined : {});
        assert.deepEqual([r.status, r.body?.error], [404, 'agent_engine_off'], `${JSON.stringify(env)} ${m} ${p}`);
      }
    } finally { w.db.close(); }
  }
  const w = world(); w.env.AGENT_ENGINE = 'off';
  try { assert.equal((await call(w, EDITOR, 'GET', '/roles')).status, 200, 'the engine being off leaves team agents alone'); }
  finally { w.db.close(); }
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('the gates: a stranger 403, a member reads and cannot write, a project advisor reads and cannot create', async () => {
  // Mutation checked: canManage always true → the member's and the advisor's writes go through.
  const w = world();
  try {
    assert.equal((await call(w, STRANGER, 'GET', `${CO}/goals`)).status, 403);
    assert.equal((await call(w, STRANGER, 'GET', `${CO}/tasks`)).status, 403);
    assert.equal((await call(w, MEMBER, 'GET', `${CO}/goals`)).status, 200);
    const m = await call(w, MEMBER, 'POST', `${CO}/goals`, { title: 'Grow' });
    assert.deepEqual([m.status, m.body.error], [403, 'not_manager']);
    assert.equal((await call(w, MEMBER, 'POST', `${CO}/tasks`, { title: 'Do' })).status, 403);
    assert.equal((await call(w, ADVISOR, 'GET', `/project/${ALONE}/tasks`)).status, 200, 'an advisor reads');
    const adv = await call(w, ADVISOR, 'POST', `/project/${ALONE}/goals`, { title: 'Ship' });
    assert.deepEqual([adv.status, adv.body.error], [403, 'not_manager']);
    assert.equal((await call(w, ADVISOR, 'POST', `/project/${ALONE}/tasks`, { title: 'Ship' })).status, 403);
    assert.equal((await call(w, EDITOR, 'GET', '/company/nope/goals')).status, 404);
  } finally { w.db.close(); }
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('goals: a project goal rolls up only to its own company\'s goal; an OKR only of its own project; a stage only on a project', async () => {
  // Mutations checked: the parent's company test dropped → the OTHER_CO_PROJECT and ALONE roll-ups go through;
  // the OKR's project test dropped → okr 2 is accepted on project 7.
  const w = world();
  try {
    const top = await call(w, EDITOR, 'POST', `${CO}/goals`, { title: 'Reach $1M ARR', why: 'Series A', metric: 'ARR', target_date: '2027-06-30', priority: 5 });
    assert.equal(top.status, 201, top.text);
    const parent = top.body.goal.uid;
    const ok = await call(w, PROJECT_OWNER, 'POST', `/project/${IN_CO}/goals`, { title: 'Launch v1', stage: 'launch', parent_goal_uid: parent, okr_id: 1 });
    assert.equal(ok.status, 201, ok.text);
    assert.deepEqual(ok.body.goal.parent, { uid: parent, title: 'Reach $1M ARR' });
    assert.equal(ok.body.goal.okr_id, 1);
    for (const [pid, who] of [[ALONE, PROJECT_OWNER], [OTHER_CO_PROJECT, PROJECT_OWNER]] as const) {
      const r = await call(w, who, 'POST', `/project/${pid}/goals`, { title: 'x', parent_goal_uid: parent });
      assert.deepEqual([r.status, r.body.error], [422, 'parent_not_in_company'], `project ${pid}`);
    }
    // A project goal is never a parent.
    const child = await call(w, PROJECT_OWNER, 'POST', `/project/${IN_CO}/goals`, { title: 'y', parent_goal_uid: ok.body.goal.uid });
    assert.equal(child.body.error, 'parent_not_in_company');
    const okr = await call(w, PROJECT_OWNER, 'POST', `/project/${IN_CO}/goals`, { title: 'z', okr_id: 2 });
    assert.deepEqual([okr.status, okr.body.error], [422, 'okr_not_in_project']);
    assert.equal((await call(w, EDITOR, 'POST', `${CO}/goals`, { title: 'z', okr_id: 1 })).body.error, 'okr_not_in_project');
    assert.equal((await call(w, EDITOR, 'POST', `${CO}/goals`, { title: 'z', stage: 'grow' })).body.error, 'invalid_goal');
    assert.equal((await call(w, EDITOR, 'POST', `${CO}/goals`, { title: '' })).body.error, 'invalid_goal');
    assert.equal((await call(w, EDITOR, 'POST', `${CO}/goals`, { title: 'q', target_date: 'soon' })).body.error, 'invalid_goal');
    // The roll-up holds only while the project is in the company.
    w.db.prepare('UPDATE projects SET company_id = NULL WHERE id = ?').run(IN_CO);
    const moved = (await call(w, PROJECT_OWNER, 'GET', `/project/${IN_CO}/goals`)).body.goals.find((g: any) => g.title === 'Launch v1');
    assert.equal(moved.parent, null);
    w.db.prepare('UPDATE projects SET company_id = 1 WHERE id = ?').run(IN_CO);
    // PATCH: status, and the refusals in their own words.
    const p = await call(w, EDITOR, 'PATCH', `/goals/${parent}`, { status: 'achieved' });
    assert.equal(p.body.goal.status, 'achieved');
    assert.equal((await call(w, MEMBER, 'PATCH', `/goals/${parent}`, { status: 'open' })).status, 403);
    assert.equal((await call(w, STRANGER, 'PATCH', `/goals/${parent}`, { status: 'open' })).status, 404);
    noPrivateKeys(top.text); noPrivateKeys(ok.text);
  } finally { w.db.close(); }
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('tasks: an agent only within its works_in and may_propose and only while live; a person only on the team; a company task about its own project', async () => {
  // Mutations checked: the works_in check dropped → module_not_allowed goes through; the may_propose check dropped →
  // option_not_allowed goes through; the live check dropped → the paused agent is assigned; the person's read gate
  // dropped → the stranger is assigned; the project's company test dropped → project 9 is accepted.
  const w = world();
  try {
    const agent = await cfo(w);
    const good = await task(w, { title: 'Runway', module: 'use-of-funds', option: 'draft:raise/use-of-funds-runway', assignee: { kind: 'agent', uid: agent } });
    assert.equal(good.assignee.kind, 'agent');
    assert.deepEqual(good.assignee.agent, { uid: agent, role_key: 'cfo', first_name: 'Carla', last_name: 'Cash' });
    const mod = await call(w, EDITOR, 'POST', `${CO}/tasks`, { title: 'x', module: 'distribution', assignee: { kind: 'agent', uid: agent } });
    assert.deepEqual([mod.status, mod.body.error], [422, 'module_not_allowed']);
    const opt = await call(w, EDITOR, 'POST', `${CO}/tasks`, { title: 'x', module: 'use-of-funds', option: 'form:uof-milestone-wording', assignee: { kind: 'agent', uid: agent } });
    assert.deepEqual([opt.status, opt.body.error], [422, 'option_not_allowed']);
    // Moving the agent's task to a module it does not work in is refused too.
    assert.equal((await call(w, EDITOR, 'PATCH', `/tasks/${good.uid}`, { module: 'distribution', option: null })).body.error, 'module_not_allowed');
    await call(w, EDITOR, 'PATCH', `/agents/${agent}`, { status: 'paused' });
    const paused = await call(w, EDITOR, 'POST', `${CO}/tasks`, { title: 'x', module: 'use-of-funds', assignee: { kind: 'agent', uid: agent } });
    assert.deepEqual([paused.status, paused.body.error], [409, 'agent_not_live']);
    const projectAgent = await cfo(w, `/project/${ALONE}`);
    assert.equal((await call(w, EDITOR, 'POST', `${CO}/tasks`, { title: 'x', module: 'use-of-funds', assignee: { kind: 'agent', uid: projectAgent } })).body.error,
      'agent_not_live', 'another scope\'s agent is not this team\'s');
    const person = await task(w, { title: 'Call the bank', assignee: { kind: 'person', uid: 'u-member' } });
    assert.deepEqual(person.assignee, { kind: 'person', person: { uid: 'u-member', name: 'Max Member' } });
    const outsider = await call(w, EDITOR, 'POST', `${CO}/tasks`, { title: 'x', assignee: { kind: 'person', uid: 'u-stranger' } });
    assert.deepEqual([outsider.status, outsider.body.error], [422, 'assignee_not_member']);
    const about = await task(w, { title: 'Review Rocket', context_project_id: IN_CO });
    assert.deepEqual(about.context_project, { id: IN_CO, name: 'Rocket' });
    for (const pid of [ALONE, OTHER_CO_PROJECT]) {
      assert.equal((await call(w, EDITOR, 'POST', `${CO}/tasks`, { title: 'x', context_project_id: pid })).body.error, 'project_not_in_company');
    }
    assert.equal((await call(w, PROJECT_OWNER, 'POST', `/project/${IN_CO}/tasks`, { title: 'x', context_project_id: IN_CO })).body.error,
      'project_not_in_company', 'only a company task is about a project');
    noPrivateKeys(JSON.stringify(person));
  } finally { w.db.close(); }
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('a person assignee moves the status and nothing else; a non-assignee member moves nothing', async () => {
  // Mutation checked: the status-only key test dropped → the assignee's title change goes through.
  const w = world();
  try {
    const t = await task(w, { title: 'Call the bank', assignee: { kind: 'person', uid: 'u-member' } });
    const moved = await call(w, MEMBER, 'PATCH', `/tasks/${t.uid}`, { status: 'in_progress' });
    assert.equal(moved.status, 200, moved.text);
    assert.equal(moved.body.task.status, 'in_progress');
    const blocked = await call(w, MEMBER, 'PATCH', `/tasks/${t.uid}`, { status: 'blocked', blocked_reason: 'Bank closed' });
    assert.equal(blocked.body.task.blocked_reason, 'Bank closed');
    const title = await call(w, MEMBER, 'PATCH', `/tasks/${t.uid}`, { status: 'done', title: 'Renamed' });
    assert.deepEqual([title.status, title.body.error], [403, 'not_manager']);
    const other = await task(w, { title: 'Not theirs' });
    assert.equal((await call(w, MEMBER, 'PATCH', `/tasks/${other.uid}`, { status: 'done' })).status, 403);
    assert.equal((await call(w, MEMBER, 'PUT', `/tasks/${t.uid}/deps`, { depends_on: [other.uid] })).status, 403);
    const events = w.db.prepare("SELECT kind FROM scope_task_events ORDER BY id").all().map((e: any) => e.kind);
    assert.ok(events.includes('created') && events.includes('status'));
  } finally { w.db.close(); }
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('dependencies: a direct and a three-hop cycle are refused, another scope is refused, and ready is derived from what they wait on', async () => {
  // Mutations checked: closesCycle always false → both cycle asserts fail; the scope test dropped → cross_scope goes
  // through; isReady ignoring deps → B reads ready while A is open.
  const w = world();
  try {
    const [a, b, c, d] = [await task(w, { title: 'A' }), await task(w, { title: 'B' }), await task(w, { title: 'C' }), await task(w, { title: 'D' })];
    const bOnA = await call(w, EDITOR, 'PUT', `/tasks/${b.uid}/deps`, { depends_on: [a.uid] });
    assert.equal(bOnA.status, 200, bOnA.text);
    assert.deepEqual(bOnA.body.task.depends_on, [a.uid]);
    assert.equal(bOnA.body.task.ready, false, 'B waits on an open A');
    const direct = await call(w, EDITOR, 'PUT', `/tasks/${a.uid}/deps`, { depends_on: [b.uid] });
    assert.deepEqual([direct.status, direct.body.error], [422, 'dependency_cycle']);
    assert.equal((await call(w, EDITOR, 'PUT', `/tasks/${a.uid}/deps`, { depends_on: [a.uid] })).body.error, 'dependency_cycle', 'not on itself');
    await call(w, EDITOR, 'PUT', `/tasks/${c.uid}/deps`, { depends_on: [b.uid] });
    await call(w, EDITOR, 'PUT', `/tasks/${d.uid}/deps`, { depends_on: [c.uid] });
    const hops = await call(w, EDITOR, 'PUT', `/tasks/${a.uid}/deps`, { depends_on: [d.uid] });
    assert.deepEqual([hops.status, hops.body.error], [422, 'dependency_cycle'], 'A → D → C → B → A');
    const elsewhere = await task(w, { title: 'Elsewhere' }, `/project/${IN_CO}`, PROJECT_OWNER);
    const cross = await call(w, EDITOR, 'PUT', `/tasks/${a.uid}/deps`, { depends_on: [elsewhere.uid] });
    assert.deepEqual([cross.status, cross.body.error], [422, 'cross_scope']);
    assert.equal((await call(w, EDITOR, 'PUT', `/tasks/${a.uid}/deps`, { depends_on: ['f'.repeat(32)] })).body.error, 'cross_scope');
    // Ready follows A.
    await call(w, EDITOR, 'PATCH', `/tasks/${a.uid}`, { status: 'done' });
    const list = (await call(w, EDITOR, 'GET', `${CO}/tasks`)).body.tasks;
    const ready = Object.fromEntries(list.map((t: any) => [t.title, t.ready]));
    assert.deepEqual(ready, { A: false, B: true, C: false, D: false }, 'done is not ready; B is, its one wait done');
    // Clearing the deps.
    assert.deepEqual((await call(w, EDITOR, 'PUT', `/tasks/${d.uid}/deps`, { depends_on: [] })).body.task.depends_on, []);
    assert.equal(DEP_WALK_MAX, 200);
  } finally { w.db.close(); }
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('the list filters by goal, assignee, status and module, and progress counts a goal\'s tasks', async () => {
  // Mutation checked: the module filter unbound (`? IS NULL OR module = ?` → always true) → the module list holds every task.
  const w = world();
  try {
    const agent = await cfo(w);
    const g = (await call(w, EDITOR, 'POST', `${CO}/goals`, { title: 'Extend runway' })).body.goal;
    await task(w, { title: 'Runway', goal_uid: g.uid, module: 'use-of-funds', assignee: { kind: 'agent', uid: agent } });
    await task(w, { title: 'Cap table', goal_uid: g.uid, module: 'cap-table', assignee: { kind: 'person', uid: 'u-member' } });
    const loose = await task(w, { title: 'Loose' });
    await call(w, EDITOR, 'PATCH', `/tasks/${loose.uid}`, { status: 'done' });
    const titles = async (q: string) => (await call(w, EDITOR, 'GET', `${CO}/tasks${q}`)).body.tasks.map((t: any) => t.title).sort();
    assert.deepEqual(await titles('?module=use-of-funds'), ['Runway']);
    assert.deepEqual(await titles(`?goal=${g.uid}`), ['Cap table', 'Runway']);
    assert.deepEqual(await titles('?assignee=agent'), ['Runway']);
    assert.deepEqual(await titles('?assignee=none'), ['Loose']);
    assert.deepEqual(await titles('?status=done'), ['Loose']);
    assert.deepEqual(await titles(''), ['Cap table', 'Loose', 'Runway']);
    assert.equal((await call(w, EDITOR, 'GET', `${CO}/tasks?assignee=robot`)).status, 400);
    const goal = (await call(w, EDITOR, 'GET', `${CO}/goals`)).body.goals[0];
    assert.deepEqual(goal.progress, { done: 0, total: 2 });
    const goalOfOther = (await call(w, PROJECT_OWNER, 'POST', `/project/${IN_CO}/goals`, { title: 'P' })).body.goal;
    assert.equal((await call(w, EDITOR, 'POST', `${CO}/tasks`, { title: 'x', goal_uid: goalOfOther.uid })).body.error, 'goal_not_in_scope');
    assert.deepEqual(await titles(`?goal=${goalOfOther.uid}`), [], 'another scope\'s goal matches nothing here');
  } finally { w.db.close(); }
});

// 8 ───────────────────────────────────────────────────────────────────────────
test('cost is { available: false } until E3 and when the read throws; a known cost is summed, an unknown one never becomes 0', async () => {
  // Mutations checked: COALESCE(cost, 0) (an unknown task read as 0) → the default and the throwing reader read
  // { available: true, value_microusd: 0 }; sumCosts skipping unknowns → the mixed sum reads 5.
  const w = world();
  try {
    const t = await task(w, { title: 'A' });
    const listed = (await call(w, EDITOR, 'GET', `${CO}/tasks`)).body.tasks[0];
    assert.deepEqual(listed.cost, { available: false });
    const g = (await call(w, EDITOR, 'POST', `${CO}/goals`, { title: 'G' })).body.goal;
    assert.deepEqual(g.cost, { available: false });
    const id = (w.db.prepare('SELECT id FROM scope_tasks WHERE uid = ?').get(t.uid) as any).id;
    assert.deepEqual((await taskCosts(w.env, [id])).get(id), { available: false }, 'until E3, nothing is recorded');
    assert.deepEqual((await taskCosts(w.env, [id], async () => { throw new Error('D1 down'); })).get(id), { available: false });
    assert.deepEqual((await taskCosts(w.env, [id], async () => new Map([[id, 1200]]))).get(id), { available: true, value_microusd: 1200 });
    assert.deepEqual(sumCosts([{ available: true, value_microusd: 5 }, { available: false }]), { available: false });
    assert.deepEqual(sumCosts([{ available: true, value_microusd: 5 }, { available: true, value_microusd: 7 }]), { available: true, value_microusd: 12 });
  } finally { w.db.close(); }
});

// 9 ───────────────────────────────────────────────────────────────────────────
test('migration 727: the scope CHECKs, the one-assignee CHECK, no self-dependency, and the run_key index are in the schema', () => {
  const w = world();
  try {
    const ins = (sql: string) => () => w.db.prepare(sql).run();
    assert.throws(ins("INSERT INTO scope_tasks (uid, scope_kind, company_id, project_id, title) VALUES ('a', 'company', 1, 7, 't')"), /CHECK/);
    assert.throws(ins("INSERT INTO scope_tasks (uid, scope_kind, company_id, title, assignee_kind) VALUES ('b', 'company', 1, 't', 'agent')"), /CHECK/);
    assert.throws(ins("INSERT INTO scope_tasks (uid, scope_kind, project_id, title, context_project_id) VALUES ('c', 'project', 7, 't', 7)"), /CHECK/);
    assert.throws(ins("INSERT INTO scope_goals (uid, scope_kind, company_id, title, stage, created_by) VALUES ('d', 'company', 1, 't', 'grow', 10)"), /CHECK/);
    w.db.prepare("INSERT INTO scope_tasks (id, uid, scope_kind, company_id, title) VALUES (50, 'e', 'company', 1, 't')").run();
    assert.throws(ins('INSERT INTO scope_task_deps (task_id, depends_on_task_id) VALUES (50, 50)'), /CHECK/);
    w.db.prepare("INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, kind, payload_json, run_key) VALUES ('p1', 10, 'x', 'y', 'draft', '{}', 'k1')").run();
    assert.throws(ins("INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, kind, payload_json, run_key) VALUES ('p2', 10, 'x', 'y', 'draft', '{}', 'k1')"), /UNIQUE/);
    const text = MIGRATION.split('\n').filter((l) => !l.startsWith('--')).join('\n');
    assert.doesNotMatch(text, /\b(BEGIN|COMMIT|PRAGMA)\b/);
    assert.match(MIGRATION, /NON-IDEMPOTENT[\s\S]*ledger/);
  } finally { w.db.close(); }
});
