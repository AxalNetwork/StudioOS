// D7075 (#7075, part of #7072) — recruits: a plan that names a role the team
// has no agent for asks the team to add it.
//
//   · accept files one request per missing role, in the plan's own batch, with
//     the tasks waiting on it; a second plan adds its tasks to the open request;
//     a role with a paused agent files none; a losing accept files none;
//   · only the team's managers decide (D1): a member is 403, a stranger 404;
//   · approve goes through the add path with every check (a model that is not
//     offered is refused and the request stays open; a role added by hand
//     meanwhile is 409 role_taken), the approver is the sponsor, and the
//     waiting tasks in the new agent's modules are assigned to it;
//   · decline leaves the tasks unassigned, each saying why; a request is decided once;
//   · never an email, never a numeric user id.
//
// Real SQLite with migrations 712, 727 and this issue's. The model runs are stubbed.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/agent_recruits_7075.test.ts
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
import recruitRoutes, { __setRecruitRouteDeps } from '../src/routes/agent_recruits.ts';
import { acceptPlan, draftPlan } from '../src/services/agents/planner.ts';
import { loadScope } from '../src/services/agents/teams.ts';
import { goalByUid } from '../src/services/agents/goals.ts';

const admitted: any[] = [];
const runtime = { admit: async (s: any, t: any) => { admitted.push({ s, t }); return { ok: true, run: { uid: 'r1', attempt: 1 } }; } };
__setRecruitRouteDeps({ runtime: async () => runtime as any });

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
  db.exec(sql('migrations/202611021724_team_agents_persona.sql')); // D4117: persona_key
  db.exec(stripForeignKeys(MIGRATION));
  db.exec(stripForeignKeys(sql('migrations/202611170937_7075_agent_recruits.sql'))); // D7075: recruits, filed in accept's batch
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
  const env: any = { DB, JWT_SECRET: 'd7075-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true', AGENT_ENGINE: 'on' };
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
  a.route('/api/team-recruits', recruitRoutes);
  return a;
}
async function call(w: W, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(path.startsWith('/api/') ? path : `/api/teams${path}`, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any, text };
}
function noPrivateKeys(text: string) {
  assert.ok(!/"email"\s*:/.test(text), 'an email key');
  assert.ok(!/@example\.test/.test(text), 'an email address');
  assert.ok(!/"(user_id|assignee_user_id|created_by|created_by_user_id|actor_user_id)"\s*:/.test(text), 'a numeric user id key');
}

const goal = async (w: W, scope = CO, who = EDITOR) => {
  const r = await call(w, who, 'POST', `${scope}/goals`, { title: 'Close the seed round' });
  assert.equal(r.status, 201, r.text);
  return r.body.goal.uid as string;
};
async function plan(w: W, g: string, items: unknown[], who = EDITOR) {
  const goalRow = (await goalByUid(w.env, g))!;
  const s = (await loadScope(w.env, 'company', 'co-uid-1'))!;
  const user = w.db.prepare('SELECT * FROM users WHERE id = ?').get(who) as any;
  const r = await draftPlan(w.env, s, goalRow, user, { run: (async () => ({ ok: true, output: JSON.stringify({ items }), usage: { model: 'stub' }, usageLogId: null })) as any });
  assert.ok(r.ok, JSON.stringify(r));
  return r.proposal.uid as string;
}
const RUNWAY = { title: 'Update the runway', module: 'use-of-funds', suggested_assignee: { role_key: 'cfo' }, depends_on: [] };
const CAPTABLE = { title: 'Clean the cap table', module: 'cap-table', suggested_assignee: { role_key: 'cfo' }, depends_on: [0] };
const OUTREACH = { title: 'Draft outreach', module: 'distribution', suggested_assignee: { role_key: 'cfo' }, depends_on: [] };
const LEGAL = { title: 'Review the SAFE', module: 'data-room', suggested_assignee: { role_key: 'general_counsel' }, depends_on: [] };
const PERSON = { title: 'Book investor calls', module: 'capital-relationships', suggested_assignee: { person: true }, depends_on: [] };

const accept = async (w: W, g: string, proposal: string) => {
  const a = await call(w, EDITOR, 'POST', `/goals/${g}/plan/accept`, { proposal });
  assert.equal(a.status, 201, a.text);
  return a.body.tasks as any[];
};
const recruits = (w: W, who = EDITOR, q = '') => call(w, who, 'GET', `/api/team-recruits/company/co-uid-1${q}`);
const approve = (w: W, uid: string, who = EDITOR, body: unknown = { model_id: MODEL, monthly_cap_microusd: 5_000_000, first_name: 'Carla' }) =>
  call(w, who, 'POST', `/api/team-recruits/${uid}/approve`, body);

test('accept: one request per missing role, with its waiting tasks, in the plan’s batch; a second plan joins the open request', async () => {
  // Mutations checked: the role filter dropped (a person item files a request) → 2 requests;
  // INSERT OR IGNORE → INSERT (the second plan fails its batch, plan_not_saved).
  const w = world();
  try {
    const g = await goal(w);
    const tasks = await accept(w, g, await plan(w, g, [RUNWAY, CAPTABLE, LEGAL, PERSON]));
    assert.deepEqual(tasks.map((t) => t.assignee.kind), ['none', 'none', 'none', 'none'], 'a role with no agent is still unassigned');
    const r = await recruits(w);
    assert.equal(r.status, 200, r.text);
    noPrivateKeys(r.text);
    assert.equal(r.body.can_manage, true);
    assert.deepEqual(r.body.requests.map((x: any) => [x.role.key, x.status, x.tasks.map((t: any) => t.title)]).sort(), [
      ['cfo', 'open', ['Update the runway', 'Clean the cap table']],
      ['general_counsel', 'open', ['Review the SAFE']],
    ]);
    const cfoReq = r.body.requests.find((x: any) => x.role.key === 'cfo');
    assert.deepEqual(cfoReq.modules.map((m: any) => m.key), ['use-of-funds', 'cap-table']);
    assert.equal(cfoReq.requested_by.uid, 'u-editor');
    assert.equal(cfoReq.asked_by, null, 'Eadwyn planned: no agent asked');
    // A second plan that needs a CFO adds to the open request.
    const g2 = await goal(w);
    await accept(w, g2, await plan(w, g2, [OUTREACH]));
    const again = await recruits(w);
    assert.equal(again.body.requests.length, 2);
    assert.deepEqual(again.body.requests.find((x: any) => x.role.key === 'cfo').tasks.map((t: any) => t.title), ['Update the runway', 'Clean the cap table', 'Draft outreach']);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM agent_recruit_requests WHERE status = 'open'").get() as any).n, 2);
  } finally { w.db.close(); }
});

test('accept: a role with a paused agent files no request; a losing accept files none', async () => {
  // Mutation checked: `status <> 'removed'` → `status = 'active'` → the paused CFO's role files a request.
  const w = world();
  try {
    const add = await call(w, EDITOR, 'POST', `${CO}/agents`, { role_key: 'cfo', first_name: 'Carla', model_id: MODEL, monthly_cap_microusd: 5_000_000 });
    assert.equal(add.status, 201, add.text);
    assert.equal((await call(w, EDITOR, 'PATCH', `/agents/${add.body.agent.uid}`, { status: 'paused' })).status, 200);
    const g = await goal(w);
    const p = await plan(w, g, [RUNWAY, LEGAL]);
    const s = (await loadScope(w.env, 'company', 'co-uid-1'))!;
    const row = (await goalByUid(w.env, g))!;
    const user = w.db.prepare('SELECT * FROM users WHERE id = ?').get(EDITOR) as any;
    const both = await Promise.all([acceptPlan(w.env, s, row, p, {}, user), acceptPlan(w.env, s, row, p, {}, user)]);
    assert.deepEqual(both.map((x) => x.ok).sort(), [false, true]);
    assert.deepEqual((both.find((x) => x.ok) as any).recruits, ['general_counsel']);
    const reqs = w.db.prepare('SELECT role_key FROM agent_recruit_requests').all() as any[];
    assert.deepEqual(reqs.map((x) => x.role_key), ['general_counsel']);
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM agent_recruit_tasks').get() as any).n, 1);
  } finally { w.db.close(); }
});

test('decide: only the team’s managers; a member is 403, a stranger 404; a stranger cannot list', async () => {
  const w = world();
  try {
    const g = await goal(w);
    await accept(w, g, await plan(w, g, [RUNWAY]));
    const uid = (await recruits(w)).body.requests[0].uid;
    assert.equal((await recruits(w, MEMBER)).status, 200, 'a member reads');
    assert.equal((await recruits(w, MEMBER)).body.can_manage, false);
    assert.equal((await recruits(w, STRANGER)).status, 403);
    const m = await approve(w, uid, MEMBER);
    assert.deepEqual([m.status, m.body.code ?? m.body.error], [403, 'not_manager']);
    assert.equal((await approve(w, uid, STRANGER)).status, 404);
    assert.equal((await call(w, MEMBER, 'POST', `/api/team-recruits/${uid}/decline`, {})).status, 403);
    assert.equal((await call(w, STRANGER, 'POST', `/api/team-recruits/${uid}/decline`, {})).status, 404);
    assert.equal((await approve(w, 'no-such-uid')).status, 404);
    assert.equal((w.db.prepare("SELECT status FROM agent_recruit_requests").get() as any).status, 'open');
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM team_agents').get() as any).n, 0, 'nothing was added');
  } finally { w.db.close(); }
});

test('approve: through the add path; the approver sponsors; the waiting tasks in its modules are assigned; decided once', async () => {
  // Mutations checked: the agentFits check in settleApproved dropped → the Distribution task is assigned;
  // the add path bypassed (a direct INSERT) → the unoffered model is accepted.
  const w = world();
  try {
    const g = await goal(w);
    await accept(w, g, await plan(w, g, [RUNWAY, CAPTABLE, OUTREACH, PERSON]));
    const uid = (await recruits(w)).body.requests[0].uid;
    // The add path's own checks hold: a model that is not offered is refused and the request stays open.
    const bad = await approve(w, uid, EDITOR, { model_id: '@cf/not/offered', monthly_cap_microusd: 5_000_000 });
    assert.deepEqual([bad.status, (bad.body.code ?? bad.body.error)], [422, 'model_not_offered']);
    const noCap = await approve(w, uid, EDITOR, { model_id: MODEL });
    assert.deepEqual([noCap.status, (noCap.body.code ?? noCap.body.error)], [400, 'invalid_cap']);
    assert.equal((w.db.prepare("SELECT status FROM agent_recruit_requests").get() as any).status, 'open');
    const ok = await approve(w, uid);
    assert.equal(ok.status, 201, ok.text);
    noPrivateKeys(ok.text);
    assert.equal(ok.body.agent.role_key, 'cfo');
    assert.equal(ok.body.request.status, 'approved');
    assert.equal(ok.body.request.agent.uid, ok.body.agent.uid);
    assert.equal(ok.body.request.decided_by.uid, 'u-editor');
    const a = w.db.prepare('SELECT id, sponsor_user_id, created_by, tool_grants_json FROM team_agents WHERE uid = ?').get(ok.body.agent.uid) as any;
    assert.deepEqual([a.sponsor_user_id, a.created_by, a.tool_grants_json], [EDITOR, EDITOR, '[]'], 'the approver sponsors; no grants');
    const rows = w.db.prepare('SELECT title, assignee_kind, assignee_agent_id FROM scope_tasks ORDER BY id').all() as any[];
    assert.deepEqual(rows.map((t) => [t.title, t.assignee_kind]), [
      ['Update the runway', 'agent'], ['Clean the cap table', 'agent'], ['Draft outreach', 'none'], ['Book investor calls', 'none'],
    ], 'only tasks in modules its rule book lists');
    assert.equal(rows[0].assignee_agent_id, a.id);
    assert.equal(ok.body.assigned.length, 2);
    assert.equal(ok.body.left_unassigned.length, 1);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM scope_task_events WHERE kind = 'assigned'").get() as any).n, 2);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM team_agent_events WHERE kind = 'added'").get() as any).n, 1);
    assert.equal(ok.body.admission, null, 'manual autonomy: nothing is admitted');
    assert.equal(admitted.length, 0);
    const again = await approve(w, uid);
    assert.deepEqual([again.status, (again.body.code ?? again.body.error)], [409, 'recruit_decided']);
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM team_agents').get() as any).n, 1);
    // Approved requests leave the open list, and stay in all.
    assert.equal((await recruits(w)).body.requests.length, 0);
    assert.equal((await recruits(w, EDITOR, '?status=all')).body.requests.length, 1);
  } finally { w.db.close(); }
});

test('approve: a role added by hand meanwhile is 409 role_taken and the request stays open', async () => {
  const w = world();
  try {
    const g = await goal(w);
    await accept(w, g, await plan(w, g, [RUNWAY]));
    const uid = (await recruits(w)).body.requests[0].uid;
    assert.equal((await call(w, EDITOR, 'POST', `${CO}/agents`, { role_key: 'cfo', model_id: MODEL, monthly_cap_microusd: 5_000_000 })).status, 201);
    const r = await approve(w, uid);
    assert.deepEqual([r.status, (r.body.code ?? r.body.error)], [409, 'role_taken']);
    assert.equal((w.db.prepare("SELECT status FROM agent_recruit_requests").get() as any).status, 'open');
  } finally { w.db.close(); }
});

test('decline: the tasks stay unassigned and each says why; a reason over 500 characters is refused; decided once', async () => {
  // Mutation checked: the task events on decline dropped → the timeline count.
  const w = world();
  try {
    const g = await goal(w);
    await accept(w, g, await plan(w, g, [RUNWAY, CAPTABLE]));
    const uid = (await recruits(w)).body.requests[0].uid;
    const long = await call(w, EDITOR, 'POST', `/api/team-recruits/${uid}/decline`, { reason: 'x'.repeat(501) });
    assert.deepEqual([long.status, (long.body.code ?? long.body.error)], [400, 'invalid_reason']);
    const d = await call(w, EDITOR, 'POST', `/api/team-recruits/${uid}/decline`, { reason: 'We will do the finance work ourselves.' });
    assert.equal(d.status, 200, d.text);
    noPrivateKeys(d.text);
    assert.deepEqual([d.body.request.status, d.body.request.decline_reason], ['declined', 'We will do the finance work ourselves.']);
    assert.deepEqual((w.db.prepare('SELECT assignee_kind FROM scope_tasks').all() as any[]).map((t) => t.assignee_kind), ['none', 'none']);
    const ev = w.db.prepare("SELECT detail_json FROM scope_task_events WHERE kind = 'updated'").all() as any[];
    assert.equal(ev.length, 2);
    assert.equal(JSON.parse(ev[0].detail_json).recruit_declined, true);
    assert.equal((await call(w, EDITOR, 'POST', `/api/team-recruits/${uid}/decline`, {})).status, 409);
    assert.equal((await approve(w, uid)).status, 409);
    // A later plan that needs a CFO files a new request.
    const g2 = await goal(w);
    await accept(w, g2, await plan(w, g2, [OUTREACH]));
    assert.equal((await recruits(w)).body.requests.length, 1);
  } finally { w.db.close(); }
});

test('approve with self_start: the scope’s object is asked to admit only a task it could start', async () => {
  // Plan tasks carry no rail option, so none is ready to admit; the approval still assigns them.
  const w = world();
  try {
    w.env.AGENT_AUTONOMY = 'self_start';
    w.env.RATE_LIMITS = { get: async () => null }; // no breaker set (an unreadable one counts as set: nothing is admitted)
    const g = await goal(w);
    await accept(w, g, await plan(w, g, [RUNWAY]));
    const uid = (await recruits(w)).body.requests[0].uid;
    const before = admitted.length;
    const ok = await approve(w, uid);
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.body.assigned.length, 1);
    assert.equal(admitted.length, before, 'no task with an option, no admission');
    // Give the task an option, and a second recruit's approval asks to admit it.
    const g2 = await goal(w);
    await accept(w, g2, await plan(w, g2, [LEGAL]));
    w.db.prepare("UPDATE scope_tasks SET option = 'draft:raise/legal' WHERE title = 'Review the SAFE'").run();
    const uid2 = (await recruits(w)).body.requests[0].uid;
    const ok2 = await approve(w, uid2);
    assert.equal(ok2.status, 201, ok2.text);
    assert.deepEqual(ok2.body.admission, { ok: true }, ok2.text);
    const last = admitted[admitted.length - 1];
    assert.deepEqual([last.s.kind, last.t.source, last.t.by], ['company', 'person', EDITOR]);
  } finally { w.db.close(); }
});
