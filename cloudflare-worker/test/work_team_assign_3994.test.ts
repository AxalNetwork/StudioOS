// D1614 W8 (#3994): a task goes only to the Team (people and agents together),
// the assignable read, My tasks, the seat-end flag and the assignment notice.
// Real SQLite and authenticated Hono; every row is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { addColumnsFrom, stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import engine from '../src/routes/agent_engine.ts';
import { updateWorkTask, createWorkTask, type WorkTask } from '../src/services/agents/workBoard.ts';
import { taskByUid } from '../src/services/agents/tasks.ts';
import { loadScope } from '../src/services/agents/teams.ts';
import { seatEndStatements } from '../src/services/agents/teamRoster.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const baseline = sql('schema_baseline.sql');
const secret = 'fixture'.repeat(12);
// Licences: the owner (founder), a co-founder, an advisor, an operating partner
// and an admin on the Team; an admin and a stranger off it; one whose seat ended.
const OWNER = 10, COFOUNDER = 11, ADVISOR = 12, PARTNER = 13, ADMIN_ON = 14, ADMIN_OFF = 15, STRANGER = 16, LEFT = 17;
const AGENT = 'a'.repeat(32), PAUSED = 'b'.repeat(32), OTHER_PROJECT = 'c'.repeat(32), COMPANY = 'd'.repeat(32), REMOVED = 'e'.repeat(32);

function world() {
  const { DB, db } = makeD1(['users', 'company_profiles', 'user_company_links', 'projects', 'roadmap_okrs'].map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'));
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  db.exec(sql('migrations/712_team_agents.sql'));
  db.exec(stripForeignKeys(sql('migrations/727_scope_goals_and_tasks.sql')));
  db.exec(sql('migrations/762_scope_task_work_board.sql'));
  db.exec(sql('migrations/763_task_comments_labels_milestones.sql'));
  db.exec(sql('migrations/202611022015_scope_task_needs_reassignment.sql'));
  db.exec(sql('migrations/202611022205_work_workload.sql')); // D1614 W4 (#4195): the board writes the time block
  db.exec(`CREATE TABLE project_members (id INTEGER PRIMARY KEY, project_id INTEGER, user_id INTEGER, role TEXT, status TEXT, removed_at TEXT, created_at TEXT, updated_at TEXT)`);
  const people: Array<[number, string, string, number | null]> = [
    [OWNER, 'Pat Owner', 'founder', 100], [COFOUNDER, 'Cleo Cofounder', 'founder', 101], [ADVISOR, 'Ada Advisor', 'advisor', null],
    [PARTNER, 'Paolo Partner', 'partner', null], [ADMIN_ON, 'Ana Admin', 'admin', null], [ADMIN_OFF, 'Hal HQ', 'admin', null],
    [STRANGER, 'Sam Stranger', 'founder', 103], [LEFT, 'Lee Left', 'advisor', null],
  ];
  for (const [id, name, role, founder] of people) {
    db.prepare("INSERT INTO users (id,uid,email,name,role,founder_id,subscription_tier,subscription_status,is_active) VALUES (?,?,?,?,?,?,'growth','active',1)")
      .run(id, `u-${id}`, `fixture-${id}@example.test`, name, role, founder);
  }
  db.exec("INSERT INTO company_profiles (id,uid,company_name) VALUES (1,'co-one','Company One')");
  db.exec("INSERT INTO user_company_links (uid,user_id,company_id,role_in_company) VALUES ('link-owner',10,1,'Founder')");
  db.exec("INSERT INTO projects (id,uid,name,founder_id,company_id) VALUES (7,'p-seven','Project Seven',100,1),(8,'p-eight','Project Eight',100,NULL)");
  db.exec(`INSERT INTO project_members (project_id,user_id,role,status,created_at) VALUES
    (7,11,'cofounder','accepted','2026-01-01'),(7,12,'advisor','accepted','2026-01-02'),(7,13,'advisor','accepted','2026-01-03'),
    (7,14,'advisor','accepted','2026-01-04'),(7,17,'advisor','removed','2026-01-05'),(8,12,'advisor','accepted','2026-01-02')`);
  const agent = db.prepare(`INSERT INTO team_agents (uid,scope_kind,company_id,project_id,role_key,first_name,last_name,model_id,sponsor_user_id,monthly_cap_microusd,status,created_by)
    VALUES (?,?,?,?,?,?,?,'@cf/m',10,1000000,?,10)`);
  agent.run(AGENT, 'project', null, 7, 'cfo', 'Carla', 'Cash', 'active');
  agent.run(PAUSED, 'project', null, 7, 'cmo', 'Mo', 'Market', 'paused');
  agent.run(OTHER_PROJECT, 'project', null, 8, 'cfo', 'Otto', 'Other', 'active');
  agent.run(COMPANY, 'company', 1, null, 'cfo', 'Cora', 'Company', 'active');
  agent.run(REMOVED, 'project', null, 7, 'coo', 'Rex', 'Gone', 'removed');
  const env: any = { DB, JWT_SECRET: secret, ENVIRONMENT: 'development', AGENT_ENGINE: 'on', TEAM_AGENTS_ENABLED: 'true' };
  const app = new Hono(); app.route('/api/teams', engine);
  return { DB, db, env, app };
}
type W = ReturnType<typeof world>;
async function call(w: W, who: number | null, method: string, path: string, b?: unknown) {
  const token = who === null ? null : await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const r = await w.app.request(`/api/teams${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }, w.env);
  const text = await r.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}
const person = (id: number) => ({ kind: 'person', uid: `u-${id}` });
const agentRef = (uid: string) => ({ kind: 'agent', uid });
const FOR_CFO = { module: 'use-of-funds' }; // #3845: an agent takes only a module in its rule book's works_in
async function create(w: W, b: any = {}, project = 7) {
  const r = await call(w, OWNER, 'POST', `/project/${project}/tasks`, { title: 'Prepare launch', ...b });
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.task;
}

test('every licence on the Team can be given a task; a project grant without a seat cannot', async () => {
  const w = world(); try {
    for (const id of [OWNER, COFOUNDER, ADVISOR, PARTNER, ADMIN_ON]) {
      const t = await create(w, { title: `For ${id}`, assignee: person(id) });
      assert.equal(t.assignee.kind, 'person', String(id));
    }
    // An admin reads every project from HQ, which is read-only: without a seat, refused.
    const hq = await call(w, OWNER, 'POST', '/project/7/tasks', { title: 'x', assignee: person(ADMIN_OFF) });
    assert.deepEqual([hq.status, hq.body.error], [422, 'read_only_admin']);
    for (const id of [STRANGER, LEFT]) {
      const r = await call(w, OWNER, 'POST', '/project/7/tasks', { title: 'x', assignee: person(id) });
      assert.deepEqual([r.status, r.body.error], [422, 'assignee_not_member'], `${id} has no seat on project 7`);
    }
    // The same advisor is on project 8's Team too, and assignable there.
    assert.equal((await create(w, { assignee: person(ADVISOR) }, 8)).assignee.kind, 'person');
    // Reassigning goes through the same gate.
    const t = await create(w);
    const re = await call(w, OWNER, 'PATCH', `/tasks/${t.uid}`, { assignee: person(STRANGER) });
    assert.deepEqual([re.status, re.body.error], [422, 'assignee_not_member']);
  } finally { w.db.close(); }
});

test('agents: only this Team\'s; another project\'s, the company\'s or a removed one is not a member; a paused one is not live', async () => {
  const w = world(); try {
    assert.equal((await create(w, { ...FOR_CFO, assignee: agentRef(AGENT) })).assignee.kind, 'agent');
    for (const uid of [OTHER_PROJECT, COMPANY, REMOVED]) {
      const r = await call(w, OWNER, 'POST', '/project/7/tasks', { title: 'x', ...FOR_CFO, assignee: agentRef(uid) });
      assert.deepEqual([r.status, r.body.error], [422, 'assignee_not_member'], uid);
    }
    const paused = await call(w, OWNER, 'POST', '/project/7/tasks', { title: 'x', ...FOR_CFO, assignee: agentRef(PAUSED) });
    assert.deepEqual([paused.status, paused.body.error], [409, 'agent_not_live']);
  } finally { w.db.close(); }
});

test('the assignable read is one team list of this Team only, with role, licence and open tasks, and no email', async () => {
  const w = world(); try {
    await create(w, { assignee: person(ADVISOR) }); await create(w, { assignee: person(ADVISOR) });
    const closed = await create(w, { assignee: person(ADVISOR) });
    await call(w, OWNER, 'PATCH', `/tasks/${closed.uid}`, { state: 'closed', close_reason: 'completed' });
    await create(w, { ...FOR_CFO, assignee: agentRef(AGENT) });
    const r = await call(w, ADVISOR, 'GET', '/project/7/assignable');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.team.map((m: any) => [m.kind, m.uid]), [
      ['person', 'u-10'], ['person', 'u-11'], ['person', 'u-12'], ['person', 'u-13'], ['person', 'u-14'],
      ['agent', AGENT], ['agent', PAUSED],
    ], 'owner first, then seats by age, then live and paused agents; no removed seat, no HQ admin, no other scope\'s agent');
    const advisor = r.body.team.find((m: any) => m.uid === 'u-12');
    assert.deepEqual(advisor, { kind: 'person', uid: 'u-12', name: 'Ada Advisor', team_role: 'advisor', licence: 'advisor', open_tasks: 2, capacity: null });
    assert.deepEqual(r.body.team.find((m: any) => m.uid === AGENT), { kind: 'agent', uid: AGENT, name: 'Carla Cash', role: 'cfo', status: 'active', open_tasks: 1 });
    assert.equal(r.body.team.find((m: any) => m.uid === 'u-10').team_role, 'owner');
    assert.ok(!JSON.stringify(r.body).includes('@example.test'), 'no email');
    assert.equal((await call(w, STRANGER, 'GET', '/project/7/assignable')).status, 403);
    assert.equal((await call(w, null, 'GET', '/project/7/assignable')).status, 401);
    assert.equal((await call(w, OWNER, 'GET', '/company/co-one/assignable')).status, 404);
  } finally { w.db.close(); }
});

test('My tasks: every project task given to me, grouped by project, filtered, only where I still read or sit; compliance fixed empty', async () => {
  const w = world(); try {
    const a = await create(w, { title: 'Due soon', assignee: person(ADVISOR), due_at: '2026-11-03' });
    const b = await create(w, { title: 'Overdue', assignee: person(ADVISOR), due_at: '2026-10-01' });
    const c = await create(w, { title: 'No date', assignee: person(ADVISOR) });
    const d = await create(w, { title: 'Elsewhere', assignee: person(ADVISOR) }, 8);
    await create(w, { title: 'Not mine', assignee: person(COFOUNDER) });
    await call(w, OWNER, 'PUT', `/tasks/${c.uid}/deps`, { depends_on: [a.uid] });
    const r = await call(w, ADVISOR, 'GET', '/me/tasks');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.projects.map((g: any) => [g.project.id, g.tasks.map((t: any) => t.title)]),
      [[7, ['Overdue', 'Due soon', 'No date']], [8, ['Elsewhere']]]);
    assert.deepEqual(r.body.compliance, [], 'the compliance group is empty until #3976');
    const nd = r.body.projects[0].tasks.find((t: any) => t.uid === c.uid);
    assert.deepEqual([nd.column, nd.state, nd.blocked, nd.needs_reassignment, nd.due_at], ['backlog', 'open', true, false, null]);
    assert.ok(!JSON.stringify(r.body).includes('@example.test') && !JSON.stringify(r.body).includes('assignee_user_id'));
    const only = async (q: string) => (await call(w, ADVISOR, 'GET', `/me/tasks?${q}`)).body.projects.flatMap((g: any) => g.tasks.map((t: any) => t.title));
    assert.deepEqual(await only('project=8'), ['Elsewhere']);
    assert.deepEqual(await only('due=none'), ['No date', 'Elsewhere']);
    // Synthetic clock: the read compares against today, so pin due dates far apart.
    assert.ok((await only('due=overdue')).includes('Overdue'));
    await call(w, OWNER, 'PATCH', `/tasks/${b.uid}`, { state: 'closed', close_reason: 'completed' });
    assert.ok(!(await only('')).includes('Overdue'), 'open by default');
    assert.deepEqual(await only('state=closed'), ['Overdue']);
    for (const q of ['state=maybe', 'due=soon', 'project=abc']) assert.equal((await call(w, ADVISOR, 'GET', `/me/tasks?${q}`)).body.error, 'invalid_filter', q);
    // A project I neither read nor sit on no longer lists my old task there.
    w.db.exec("UPDATE project_members SET status = 'removed' WHERE project_id = 8 AND user_id = 12");
    assert.deepEqual((await call(w, ADVISOR, 'GET', '/me/tasks')).body.projects.map((g: any) => g.project.id), [7]);
    void d;
    assert.equal((await call(w, null, 'GET', '/me/tasks')).status, 401);
  } finally { w.db.close(); }
});

test('a seat that ends flags its open tasks for reassignment, with an event; nothing is reassigned; assigning clears it', async () => {
  const w = world(); try {
    const open = await create(w, { title: 'Open', assignee: person(PARTNER) });
    const done = await create(w, { title: 'Done', assignee: person(PARTNER) });
    await call(w, OWNER, 'PATCH', `/tasks/${done.uid}`, { state: 'closed', close_reason: 'completed' });
    const theirs = await create(w, { title: 'Someone else', assignee: person(ADVISOR) });
    w.db.exec("UPDATE project_members SET status = 'removed' WHERE project_id = 7 AND user_id = 13");
    await w.DB.batch(seatEndStatements(w.env, 7, PARTNER, OWNER));
    await w.DB.batch(seatEndStatements(w.env, 7, PARTNER, OWNER)); // twice is once
    const flags = w.db.prepare('SELECT uid, needs_reassignment, assignee_user_id FROM scope_tasks ORDER BY id').all() as any[];
    assert.deepEqual(flags.map((r) => [r.uid, r.needs_reassignment, r.assignee_user_id]),
      [[open.uid, 1, PARTNER], [done.uid, 0, PARTNER], [theirs.uid, 0, ADVISOR]], 'only the open task; never auto-reassigned');
    const ev = w.db.prepare("SELECT e.kind, e.detail_json, e.actor_user_id FROM scope_task_events e JOIN scope_tasks t ON t.id = e.task_id WHERE t.uid = ? AND e.detail_json LIKE '%seat_ended%'").all(open.uid) as any[];
    assert.deepEqual(ev.map((e) => [e.kind, JSON.parse(e.detail_json), e.actor_user_id]), [['updated', { needs_reassignment: true, reason: 'seat_ended' }, OWNER]]);
    const board = (await call(w, OWNER, 'GET', '/project/7/work/board')).body;
    assert.equal(board.items.find((t: any) => t.uid === open.uid).needs_reassignment, true);
    // A move keeps the flag; a reassignment clears it.
    await call(w, OWNER, 'PATCH', `/tasks/${open.uid}/move`, { column: 'ready' });
    assert.equal((await taskByUid(w.env, open.uid) as WorkTask).needs_reassignment, 1);
    const re = await call(w, OWNER, 'PATCH', `/tasks/${open.uid}`, { assignee: person(ADVISOR) });
    assert.equal(re.status, 200, JSON.stringify(re.body));
    assert.equal((await taskByUid(w.env, open.uid) as WorkTask).needs_reassignment, 0);
    // The removal route runs these statements in its own batch.
    const route = readFileSync(new URL('../src/routes/projects.ts', import.meta.url), 'utf8');
    const del = route.slice(route.indexOf("projects.delete('/:id/members/:userId'"), route.indexOf("projects.post('/invitations/accept'"));
    assert.match(del, /\.\.\.\(seat\.length \? seatEndStatements\(c\.env, id, memberUserId, user\.id\) : \[\]\),\n\s+\]\);/);
  } finally { w.db.close(); }
});

test('assigning a person notifies them in their own inbox, never yourself; a failed notice does not undo the assignment', async () => {
  const w = world(); try {
    const sent: any[] = [];
    const publish = async (_env: any, args: any) => { sent.push(args); };
    const owner = w.db.prepare('SELECT * FROM users WHERE id = ?').get(OWNER) as any;
    const s = (await loadScope(w.env, 'project', '7'))! as any;
    const t = await createWorkTask(w.env, s, { title: 'Book the venue', assignee: person(ADVISOR) }, owner, {}, publish);
    assert.deepEqual(sent.map((n) => [n.userId, n.type, n.body, n.link, n.channels]), [[ADVISOR, 'task_assigned', 'Book the venue', `/projects/7/work?item=${t.uid}`, ['in_app']]]);
    await updateWorkTask(w.env, t, { assignee: person(COFOUNDER) }, { user: owner }, publish);
    assert.deepEqual(sent.map((n) => n.userId), [ADVISOR, COFOUNDER]);
    const mine = await createWorkTask(w.env, s, { title: 'Mine', assignee: person(OWNER) }, owner, {}, publish);
    await updateWorkTask(w.env, (await taskByUid(w.env, t.uid)) as WorkTask, { title: 'Book the hall' }, { user: owner }, publish);
    assert.equal(sent.length, 2, 'not for assigning yourself, nor for an edit that keeps the assignee');
    const failing = async () => { throw new Error('inbox down'); };
    const kept = await updateWorkTask(w.env, mine, { assignee: person(PARTNER) }, { user: owner }, failing);
    assert.equal(kept.assignee_user_id, PARTNER);
  } finally { w.db.close(); }
});
