/**
 * D1528 §4.4 (#3850, E6 of #3742) — what a project's move and an owner-seat
 * transfer do to the agent engine: the transfer statements in the move's own
 * batch (`projectMoveStatements`), the runs in flight ended `scope_moved` after
 * it commits (`onProjectMoved`), the run's own re-check at its `context` step,
 * the sponsor who left, and the moves read. The database is the real migrated
 * schema (`_agent_engine_fixture.ts`); the scope objects and inboxes are faked.
 * Every row is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_transfer_d1528.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { COMPANY, PROJECT, SPONSOR, STRANGER, MEMBER, AGENT, fakeAgentRun, loopDeps, world, type World } from './_agent_engine_fixture.ts';
import { context, load } from '../src/agents/loop.ts';
import { projectMoveStatements } from '../src/services/projectMove.ts';
import { afterMove, movesOf, onProjectMoved, sponsorsLeft, transferStatements, type MovedDeps } from '../src/services/agents/transfer.ts';
import engineRoutes, { __setEngineRouteDeps } from '../src/routes/agent_engine.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

test.after(() => removeMigratedDatabases());

const OTHER = 2;
const CO_AGENT = 60;
const P = { kind: 'project' as const, id: PROJECT };
const C = { kind: 'company' as const, id: COMPANY };

/** Company 1 holds the project; company 2 is where it goes. A company goal, a project goal rolling up to it, a company agent with tasks. */
function moving() {
  const w = world();
  w.db.exec(`
    INSERT INTO company_profiles (id, uid, company_name) VALUES (${OTHER}, 'co-2', 'Borealis');
    INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES ('l1', ${SPONSOR}, ${COMPANY}, 'Founder');
    INSERT INTO scope_goals (id, uid, scope_kind, company_id, project_id, title, parent_goal_id, created_by) VALUES
      (1, 'g-co', 'company', ${COMPANY}, NULL, 'Ship the fleet', NULL, ${SPONSOR}),
      (2, 'g-other', 'company', ${OTHER}, NULL, 'Borealis goal', NULL, ${SPONSOR}),
      (3, 'g-up', 'project', NULL, ${PROJECT}, 'Fly one drone', 1, ${SPONSOR}),
      (4, 'g-own', 'project', NULL, ${PROJECT}, 'Its own', NULL, ${SPONSOR});
  `);
  w.agent(AGENT);
  w.agent(CO_AGENT, 'ceo', { scope: 'company' });
  return w;
}
const move = (w: World, to: number | null = OTHER, extra: D1PreparedStatement[] = []) =>
  w.DB.batch([...projectMoveStatements(w.env, { projectId: PROJECT, from: COMPANY, to, actorUserId: SPONSOR }), ...extra]);
const goals = (w: World) => Object.fromEntries((w.db.prepare('SELECT id, parent_goal_id FROM scope_goals ORDER BY id').all() as any[]).map((r) => [r.id, r.parent_goal_id]));
const tasks = (w: World) => Object.fromEntries((w.db.prepare('SELECT id, status, blocked_reason, context_project_id FROM scope_tasks ORDER BY id').all() as any[])
  .map((r) => [r.id, [r.status, r.blocked_reason, r.context_project_id]]));
const runRow = (w: World, uid: string) => w.db.prepare('SELECT * FROM agent_task_runs WHERE uid = ?').get(uid) as any;
const projectCompany = (w: World) => (w.db.prepare('SELECT company_id FROM projects WHERE id = ?').get(PROJECT) as any).company_id;

function fakeDeps() {
  const told: { scope: string; move: any }[] = [];
  const notified: { agentId: number; body: string }[] = [];
  const deps: MovedDeps = {
    tell: async (s, m) => { told.push({ scope: `${s.kind}:${s.id}`, move: m }); },
    notify: async (_e, agentId, body) => { notified.push({ agentId, body }); },
  };
  return { deps, told, notified };
}

// ── The move's batch ────────────────────────────────────────────────────────

test('a move cuts the goal roll-up and blocks the old company\'s open tasks about the project, project_left, in the same batch; project agents stay active', async () => {
  // Mutation checked: the transfer statements run after the batch (not in it) leaves the failed-batch case below with blocked tasks.
  const w = moving();
  try {
    w.task(300, CO_AGENT, { scope: 'company', contextProject: PROJECT });
    w.task(301, CO_AGENT, { scope: 'company', contextProject: PROJECT, status: 'done' });
    w.task(302, CO_AGENT, { scope: 'company' });
    w.task(303, AGENT);
    await move(w);
    assert.equal(projectCompany(w), OTHER);
    assert.deepEqual(goals(w), { 1: null, 2: null, 3: null, 4: null }, 'the project goal no longer rolls up to the old company\'s goal');
    assert.deepEqual(tasks(w), {
      300: ['blocked', 'project_left', null],
      301: ['done', null, null], // finished: keeps its status, loses the project
      302: ['open', null, null],
      303: ['open', null, null], // the project's own task travels untouched
    });
    const ev = w.db.prepare("SELECT task_id, actor_user_id, kind, detail_json FROM scope_task_events WHERE json_extract(detail_json, '$.reason') = 'project_left'").all() as any[];
    assert.deepEqual(ev.map((e) => [e.task_id, e.actor_user_id, e.kind, JSON.parse(e.detail_json)]),
      [[300, SPONSOR, 'status', { reason: 'project_left', project_id: PROJECT, from: COMPANY, to: OTHER, status_from: 'open', status_to: 'blocked' }]]);
    assert.deepEqual((w.db.prepare('SELECT id, status FROM team_agents ORDER BY id').all() as any[]).map((r) => [r.id, r.status]),
      [[AGENT, 'active'], [CO_AGENT, 'active']]);
    const e = w.db.prepare("SELECT created_at FROM company_membership_events WHERE kind = 'project_move'").get() as any;
    assert.ok(e, 'the move\'s own record is in the same batch');
  } finally { w.close(); }
});

test('a failed move batch changes no goal, no task and not the project', async () => {
  const w = moving();
  try {
    w.task(300, CO_AGENT, { scope: 'company', contextProject: PROJECT });
    const before = [goals(w), tasks(w)];
    await assert.rejects(move(w, OTHER, [w.DB.prepare('INSERT INTO no_such_table (x) VALUES (1)')]));
    assert.equal(projectCompany(w), COMPANY);
    assert.deepEqual([goals(w), tasks(w)], before);
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM scope_task_events').get() as any).n, 0);
  } finally { w.close(); }
});

test('the transfer statements: none when the project left no company or stayed; the move into no company still blocks', async () => {
  const w = moving();
  try {
    assert.deepEqual(transferStatements(w.env, { projectId: PROJECT, from: null, to: OTHER, actorUserId: SPONSOR }), []);
    assert.deepEqual(transferStatements(w.env, { projectId: PROJECT, from: COMPANY, to: COMPANY, actorUserId: SPONSOR }), []);
    w.task(300, CO_AGENT, { scope: 'company', contextProject: PROJECT, status: 'in_progress' });
    await move(w, null);
    assert.deepEqual(tasks(w)[300], ['blocked', 'project_left', null]);
    assert.equal(goals(w)[3], null);
  } finally { w.close(); }
});

test('the filing\'s move (into a new company) carries the transfer statements in its batch too', () => {
  const src = readFileSync(new URL('../src/services/projectMove.ts', import.meta.url), 'utf8');
  // Both branches of projectMoveStatements end with the transfer statements, inside the returned array.
  assert.equal((src.match(/\.\.\.transferStatements\(env, /g) ?? []).length, 2);
});

// ── After the batch: runs in flight ─────────────────────────────────────────

test('a project agent\'s run in flight ends scope_moved after the batch; its task reopens; the three boards and the teams hear once', async () => {
  // Mutation checked: onProjectMoved called before the batch commits finds the project still in its old company and ends nothing
  // (the source-order check below pins the callers).
  const w = moving();
  try {
    w.task(300, AGENT);
    w.task(310, CO_AGENT, { scope: 'company', contextProject: PROJECT });
    const a = await w.runtime.admit(P, { agentId: AGENT, taskId: 300, by: SPONSOR, source: 'person' });
    assert.ok(a.ok, JSON.stringify(a));
    const ca = await w.runtime.admit(C, { agentId: CO_AGENT, taskId: 310, by: SPONSOR, source: 'person' });
    assert.ok(ca.ok, JSON.stringify(ca));
    const d = loopDeps(w, fakeAgentRun(w).fn);
    assert.ok((await load(d, a.run.uid)).go);
    assert.ok((await load(d, ca.run.uid)).go);
    await move(w);
    const f = fakeDeps();
    const out = await onProjectMoved(w.env, { projectId: PROJECT, from: COMPANY, to: OTHER, actorUserId: SPONSOR }, f.deps);
    assert.equal(out.ended, 2);
    for (const uid of [a.run.uid, ca.run.uid]) {
      const r = runRow(w, uid);
      assert.deepEqual([r.status, r.refusal, Boolean(r.ended_at)], ['scope_moved', 'scope_moved', true]);
      assert.equal(JSON.parse(r.steps_json).at(-1).summary, 'The project moved to another company.');
    }
    assert.deepEqual(tasks(w)[300], ['open', null, null], 'the project agent\'s task travels, open for its next run');
    assert.equal((w.db.prepare('SELECT board_column FROM scope_tasks WHERE id = 300').get() as any).board_column, 'ready', 'back on its board\'s ready column');
    assert.deepEqual(tasks(w)[310], ['blocked', 'project_left', null], 'the old company\'s task stays blocked');
    assert.deepEqual(f.told.map((t) => t.scope), ['project:7', 'company:1', 'company:2']);
    assert.deepEqual(f.told[0].move, { project_id: PROJECT, from: COMPANY, to: OTHER, ended: [a.run.uid, ca.run.uid] });
    assert.deepEqual(f.notified.map((n) => n.agentId).sort(), [AGENT, CO_AGENT]);
    // The run's next step stops as it stands, with nothing new written.
    const steps = runRow(w, a.run.uid).steps_json;
    assert.deepEqual(await context(d, a.run.uid), { go: false, status: 'scope_moved', refusal: 'scope_moved' });
    assert.equal(runRow(w, a.run.uid).steps_json, steps);
    // Called twice (a retry), it ends nothing more.
    assert.equal((await onProjectMoved(w.env, { projectId: PROJECT, from: COMPANY, to: OTHER, actorUserId: SPONSOR }, fakeDeps().deps)).ended, 0);
  } finally { w.close(); }
});

test('a run waiting for a decision is not ended: its proposal stays decidable (Q5 A)', async () => {
  const w = moving();
  try {
    w.task(300, AGENT, { status: 'waiting_decision', board: 'in_review' });
    w.db.prepare("INSERT INTO agent_task_runs (uid, agent_id, task_id, attempt, status, admitted_company_id) VALUES ('wait-1', ?, 300, 1, 'waiting_decision', ?)").run(AGENT, COMPANY);
    await move(w);
    assert.equal((await onProjectMoved(w.env, { projectId: PROJECT, from: COMPANY, to: OTHER, actorUserId: SPONSOR }, fakeDeps().deps)).ended, 0);
    assert.equal(runRow(w, 'wait-1').status, 'waiting_decision');
  } finally { w.close(); }
});

test('a run the update misses ends at its context step: the project\'s company is checked again there', async () => {
  // Mutation checked: the company_id re-check skipped in buildContext lets the run through context with status running.
  const w = moving();
  try {
    w.task(300, AGENT);
    const a = await w.runtime.admit(P, { agentId: AGENT, taskId: 300, by: SPONSOR, source: 'person' });
    assert.ok(a.ok);
    const d = loopDeps(w, fakeAgentRun(w).fn);
    assert.ok((await load(d, a.run.uid)).go);
    await move(w); // and no onProjectMoved: it failed, or has not reached this run yet
    assert.deepEqual(await context(d, a.run.uid), { go: false, status: 'scope_moved', refusal: 'scope_moved' });
    assert.equal(runRow(w, a.run.uid).status, 'scope_moved');
  } finally { w.close(); }
});

test('the old company\'s agent can no longer read the project: a task naming it is refused at context', async () => {
  const w = moving();
  try {
    w.task(310, CO_AGENT, { scope: 'company', contextProject: PROJECT });
    const ca = await w.runtime.admit(C, { agentId: CO_AGENT, taskId: 310, by: SPONSOR, source: 'person' });
    assert.ok(ca.ok, JSON.stringify(ca));
    const d = loopDeps(w, fakeAgentRun(w).fn);
    assert.ok((await load(d, ca.run.uid)).go);
    // The project leaves outside the move's statements (the only way it can still be named by the task).
    w.db.prepare('UPDATE projects SET company_id = ? WHERE id = ?').run(OTHER, PROJECT);
    assert.deepEqual(await context(d, ca.run.uid), { go: false, status: 'refused', refusal: 'project_not_in_company' });
  } finally { w.close(); }
});

test('afterMove never throws: a failing board or inbox leaves the runs ended', async () => {
  const w = moving();
  try {
    w.task(300, AGENT);
    const a = await w.runtime.admit(P, { agentId: AGENT, taskId: 300, by: SPONSOR, source: 'person' });
    assert.ok(a.ok);
    await move(w);
    const boom = async () => { throw new Error('down'); };
    assert.equal((await afterMove(w.env, { projectId: PROJECT, from: COMPANY, to: OTHER, actorUserId: SPONSOR }, { tell: boom, notify: boom })).ended, 1);
    assert.equal(runRow(w, a.run.uid).status, 'scope_moved');
    // With no scope-object binding (tests, dev), the live deps tell nobody and still end the runs.
    w.task(301, AGENT, { status: 'in_progress', board: 'in_progress' });
    w.db.prepare("INSERT INTO agent_task_runs (uid, agent_id, task_id, attempt, status, admitted_company_id) VALUES ('r-live', ?, 301, 1, 'running', ?)").run(AGENT, OTHER);
    assert.equal((await afterMove(w.env, { projectId: PROJECT, from: OTHER, to: null, actorUserId: SPONSOR })).ended, 1);
  } finally { w.close(); }
});

test('the callers run onProjectMoved only after their batch commits', () => {
  // Mutation checked: afterMove moved above the batch in the move route turns this red.
  const route = readFileSync(new URL('../src/routes/project_lifecycle.ts', import.meta.url), 'utf8');
  const batch = route.indexOf('await c.env.DB.batch(projectMoveStatements(');
  assert.ok(batch > 0 && route.indexOf('await afterMove(') > batch);
  const filing = readFileSync(new URL('../src/services/incorporationFiling.ts', import.meta.url), 'utf8');
  const fb = filing.indexOf('await env.DB.batch(');
  assert.ok(fb > 0 && filing.indexOf('await afterMove(') > fb);
  // The live board learns which runs ended.
  const rt = readFileSync(new URL('../src/agents/doRuntime.ts', import.meta.url), 'utf8');
  assert.match(rt, /case '\/moved':/);
});

test('the scope object drops the ended runs from its live view', async () => {
  const w = moving();
  try {
    w.task(300, AGENT);
    const a = await w.runtime.admit(P, { agentId: AGENT, taskId: 300, by: SPONSOR, source: 'person' });
    assert.ok(a.ok);
    assert.equal((await w.core('project:7').status(P) as any).live.length, 1);
    await w.core('project:7').track({ run_uid: a.run.uid, agent_id: 0, task_id: 0, status: 'scope_moved' });
    assert.equal((await w.core('project:7').status(P) as any).live.length, 0);
  } finally { w.close(); }
});

// ── The owner seat ──────────────────────────────────────────────────────────

test('sponsorsLeft: the old owner\'s agents pause sponsor_left when they can no longer manage; not when they still can', async () => {
  const w = moving();
  try {
    w.agent(51, 'cto', { sponsor: MEMBER });
    const paused: number[] = [];
    const pause = async (_e: any, id: number) => { paused.push(id); };
    assert.equal(await sponsorsLeft(w.env, PROJECT, SPONSOR, pause, async () => true), 0);
    assert.equal(await sponsorsLeft(w.env, PROJECT, null, pause, async () => false), 0);
    assert.deepEqual(paused, []);
    assert.equal(await sponsorsLeft(w.env, PROJECT, SPONSOR, pause, async () => false), 1);
    assert.deepEqual(paused, [AGENT], 'only the agents the old owner sponsored');
    // One pause failing leaves the rest paused.
    w.agent(52, 'cfo');
    const seen: number[] = [];
    assert.equal(await sponsorsLeft(w.env, PROJECT, SPONSOR, async (_e, id) => { seen.push(id); if (id === AGENT) throw new Error('x'); }, async () => false), 2);
    assert.deepEqual(seen.sort(), [AGENT, 52]);
  } finally { w.close(); }
});

// ── The moves read ──────────────────────────────────────────────────────────

function app(w: World) {
  __setEngineRouteDeps({ runtime: async () => w.runtime });
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/teams', engineRoutes);
  return a;
}
async function call(w: World, who: number, path: string) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app(w).request(`/api/teams${path}`, { headers: { Authorization: `Bearer ${jwt}` } }, w.env);
  return { status: r.status, body: await r.json() as any };
}

test('GET /:scope/:id/moves: newest first, in or out, the blocked count, behind the read gate; no email and no numeric user id', async () => {
  // Mutation checked: the canRead gate dropped lets the stranger read the company's moves.
  const w = moving();
  try {
    w.task(300, CO_AGENT, { scope: 'company', contextProject: PROJECT });
    w.task(301, CO_AGENT, { scope: 'company', contextProject: PROJECT });
    await move(w);
    w.db.prepare("UPDATE company_membership_events SET created_at = '2026-10-01 10:00:00' WHERE kind = 'project_move'").run();
    w.db.prepare("UPDATE scope_task_events SET created_at = '2026-10-01 10:00:00' WHERE json_extract(detail_json, '$.reason') = 'project_left'").run();
    await w.DB.batch(projectMoveStatements(w.env, { projectId: PROJECT, from: OTHER, to: COMPANY, actorUserId: SPONSOR }));

    const co = await call(w, SPONSOR, '/company/co-1/moves');
    assert.equal(co.status, 200, JSON.stringify(co.body));
    assert.deepEqual(co.body.moves.map((m: any) => [m.direction, m.from?.uid, m.to?.uid, m.blocked_tasks]), [['in', 'co-2', 'co-1', 0], ['out', 'co-1', 'co-2', 2]]);
    assert.deepEqual(co.body.moves[0].project, { id: PROJECT, name: 'Kestrel' });
    assert.deepEqual(co.body.moves[0].by, { uid: 'u-sponsor', name: 'Sam Sponsor' });
    assert.doesNotMatch(JSON.stringify(co.body), /@example\.test|"user_id"|"actor_user_id"/);
    assert.equal((await call(w, SPONSOR, '/company/co-1/moves?limit=1')).body.moves.length, 1);
    assert.equal((await call(w, SPONSOR, '/company/co-1/moves?limit=999')).body.moves.length, 2, 'capped, never an error');

    const pr = await call(w, SPONSOR, `/project/${PROJECT}/moves`);
    assert.deepEqual(pr.body.moves.map((m: any) => m.direction), ['in', 'in']);
    assert.deepEqual((await movesOf(w.env, { kind: 'company', id: OTHER }, 5)).map((m) => m.direction), ['out', 'in']);

    assert.equal((await call(w, STRANGER, '/company/co-1/moves')).status, 403);
    assert.equal((await call(w, STRANGER, `/project/${PROJECT}/moves`)).status, 403);
    assert.equal((await call(w, SPONSOR, '/company/co-nope/moves')).status, 404);
  } finally { __setEngineRouteDeps(null); w.close(); }
});

test('#4394 (TM18b): an out move names the runs it stopped, each scope only its own agents\', by persona and task; an in move names none', async () => {
  // Mutation checked: the scope filter dropped → the company reads the project agent's run too.
  const w = moving();
  try {
    w.db.prepare("UPDATE team_agents SET persona_key = 'solen' WHERE id = ?").run(AGENT);
    w.db.prepare("UPDATE team_agents SET persona_key = NULL WHERE id = ?").run(CO_AGENT);
    w.task(300, AGENT);
    w.task(310, CO_AGENT, { scope: 'company', contextProject: PROJECT });
    const a = await w.runtime.admit(P, { agentId: AGENT, taskId: 300, by: SPONSOR, source: 'person' });
    const ca = await w.runtime.admit(C, { agentId: CO_AGENT, taskId: 310, by: SPONSOR, source: 'person' });
    assert.ok(a.ok && ca.ok);
    const d = loopDeps(w, fakeAgentRun(w).fn);
    assert.ok((await load(d, a.run.uid)).go);
    assert.ok((await load(d, ca.run.uid)).go);
    await move(w, null); // out of every company: an out move for both the company and the project
    assert.equal((await onProjectMoved(w.env, { projectId: PROJECT, from: COMPANY, to: null, actorUserId: SPONSOR }, fakeDeps().deps)).ended, 2);
    const t = (id: number) => w.db.prepare('SELECT uid, title FROM scope_tasks WHERE id = ?').get(id) as any;
    const agentUid = (id: number) => (w.db.prepare('SELECT uid FROM team_agents WHERE id = ?').get(id) as any).uid;

    const co = await call(w, SPONSOR, '/company/co-1/moves');
    assert.equal(co.status, 200, JSON.stringify(co.body));
    assert.equal(co.body.moves[0].direction, 'out');
    assert.deepEqual(co.body.moves[0].stopped_runs, [{ agent: { uid: agentUid(CO_AGENT), persona: null }, task: { uid: t(310).uid, title: t(310).title } }]);
    const pr = await call(w, SPONSOR, `/project/${PROJECT}/moves`);
    assert.equal(pr.body.moves[0].direction, 'out');
    assert.deepEqual(pr.body.moves[0].stopped_runs, [{ agent: { uid: agentUid(AGENT), persona: { key: 'solen', name: 'Solen' } }, task: { uid: t(300).uid, title: t(300).title } }]);
    assert.doesNotMatch(JSON.stringify([co.body, pr.body]), /"role_key"|@example\.test|"user_id"/, 'no job title, no email, no numeric id');

    // Moving back in names no stopped runs, and the earlier out move keeps only its own.
    await w.DB.batch(projectMoveStatements(w.env, { projectId: PROJECT, from: null, to: COMPANY, actorUserId: SPONSOR }));
    const back = await call(w, SPONSOR, `/project/${PROJECT}/moves`);
    assert.equal(back.body.moves[0].direction, 'in');
    assert.equal('stopped_runs' in back.body.moves[0], false, 'an in move carries no stopped_runs');
    assert.deepEqual(back.body.moves[1].stopped_runs.map((r: any) => r.task.uid), [t(300).uid], 'the earlier out move keeps its own');
  } finally { __setEngineRouteDeps(null); w.close(); }
});
