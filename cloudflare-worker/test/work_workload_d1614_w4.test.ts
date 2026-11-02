// D1614 W4 (#3972) — workload on the Calendar.
//
//   1. The workload: per person and per agent and per week, the items and the summed estimate;
//      unset capacity is "Not recorded" and never over; set capacity flags over-capacity.
//   2. Capacity: one's own, or a project editor's; only for someone on the project; 0–1,000 or null.
//   3. A time block on W1's PATCH: both or neither, the end after the start; the assignee may set their own.
//   4. Reassignment through W1's PATCH keeps E1's agent checks (works_in, live).
//   5. The calendar's Work items source shows only the projects the member can read.
//   6. Projects only; the read gate.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/work_workload_d1614_w4.test.ts
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { AGENT, MEMBER, PROJECT, SPONSOR, STRANGER, hex, world, type World } from './_agent_engine_fixture.ts';
import engineRoutes, { __setEngineRouteDeps } from '../src/routes/agent_engine.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { WORKLOAD_DEPS, weekStart } from '../src/services/agents/workWorkload.ts';
import { workItemEvents } from '../src/services/calendar/workItems.ts';

after(() => removeMigratedDatabases());

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
async function call(w: World, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app(w).request(`/api/teams${path}`, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }, w.env);
  const text = await r.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: r.status, body: parsed, text };
}

const DAY = 86_400_000;
const W0 = weekStart(new Date());
const at = (ms: number, time = '10:00:00') => `${new Date(ms).toISOString().slice(0, 10)} ${time}`;
/** A task for a person on the project, in its board's ready column. */
function personTask(w: World, id: number, userId: number, o: { estimate?: number | null; due?: string | null; start?: string | null; end?: string | null; status?: string; board?: string } = {}) {
  w.task(id, AGENT, { title: `Task ${id}` });
  w.db.prepare(`UPDATE scope_tasks SET assignee_kind = 'person', assignee_user_id = ?, assignee_agent_id = NULL, estimate_points = ?, due_at = ?,
    scheduled_start = ?, scheduled_end = ?, status = ?, board_column = ? WHERE id = ?`)
    .run(userId, o.estimate ?? null, o.due ?? null, o.start ?? null, o.end ?? null, o.status ?? 'open', o.board ?? 'ready', id);
}
const member = (w: World, userId: number) => w.db.prepare("INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'cofounder', 'accepted')").run(PROJECT, userId);

test('W4: the workload sums each week per person and agent; unset capacity is Not recorded, never over', async () => {
  const w = world();
  try {
    w.agent(AGENT);
    member(w, MEMBER);
    // SPONSOR: week 0 holds 3 + 4 (one scheduled, one due), week 1 holds 2 and one unestimated; one unscheduled; one done (never counts).
    personTask(w, 300, SPONSOR, { estimate: 3, start: at(W0 + DAY), end: at(W0 + DAY, '12:00:00') });
    personTask(w, 301, SPONSOR, { estimate: 4, due: at(W0 + 2 * DAY) });
    personTask(w, 302, SPONSOR, { estimate: 2, due: at(W0 + 8 * DAY) });
    personTask(w, 303, SPONSOR, { estimate: null, due: at(W0 + 9 * DAY) });
    personTask(w, 304, SPONSOR, { estimate: 5 });
    personTask(w, 305, SPONSOR, { estimate: 50, due: at(W0 + DAY), status: 'done', board: 'done' });
    // MEMBER: one task and no capacity.
    personTask(w, 310, MEMBER, { estimate: 1, due: at(W0 + DAY) });
    // The agent: one task this week.
    w.task(320, AGENT, { title: 'Agent work' });
    w.db.prepare('UPDATE scope_tasks SET estimate_points = 2, due_at = ? WHERE id = 320').run(at(W0 + 3 * DAY));
    assert.equal((await call(w, SPONSOR, 'PUT', `/project/${PROJECT}/work/capacity/u-sponsor`, { weekly_capacity_points: 6 })).status, 200);

    const r = await call(w, SPONSOR, 'GET', `/project/${PROJECT}/work/workload?weeks=2`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.weeks.length, 2);
    const sponsor = r.body.people.find((p: any) => p.person.uid === 'u-sponsor');
    // Mutation checked: the status filter dropped → the done task's 50 points count and this fails.
    assert.deepEqual(sponsor.weeks.map((x: any) => [x.estimate_points, x.unestimated, x.over_capacity, x.items.length]), [[7, 0, true, 2], [2, 1, false, 2]]);
    assert.deepEqual(sponsor.capacity, { available: true, value: 6 });
    assert.deepEqual(sponsor.unscheduled.map((i: any) => i.uid), [hex(304, 'c')]);
    assert.deepEqual(sponsor.weeks[0].items.map((i: any) => i.when.kind).sort(), ['due', 'scheduled'], 'a block counts in its week, else the due date');
    const mem = r.body.people.find((p: any) => p.person.uid === 'u-member');
    // Mutation checked: `over_capacity` comparing against 0 when unset → MEMBER reads over and this fails.
    assert.deepEqual([mem.capacity, mem.weeks[0].over_capacity, mem.weeks[0].estimate_points], [{ available: false, reason: 'Not recorded' }, null, 1]);
    const agent = r.body.agents.find((a: any) => a.agent.uid === hex(AGENT, 'b'));
    assert.deepEqual([agent.capacity, agent.weeks[0].estimate_points, agent.weeks[0].over_capacity], [null, 2, null]);
    assert.ok(!/@example\.test/.test(r.text), 'no email');
    assert.ok(!/"(user_id|assignee_user_id|agent_id)"/.test(r.text), 'no numeric id key');
    assert.equal((await call(w, SPONSOR, 'GET', `/project/${PROJECT}/work/workload?weeks=13`)).body.error, 'invalid_weeks');
    assert.equal((await call(w, SPONSOR, 'GET', '/company/co-1/work/workload')).status, 404, 'projects only');
    assert.equal((await call(w, STRANGER, 'GET', `/project/${PROJECT}/work/workload`)).body.error, 'not_member');
  } finally { __setEngineRouteDeps(null); w.close(); }
});

test('W4: agents\' sessions join through the #3957 seam without changing the shape', async () => {
  const w = world();
  const saved = WORKLOAD_DEPS.agentSessions;
  try {
    w.agent(AGENT);
    WORKLOAD_DEPS.agentSessions = async () => [{ agent_id: AGENT, item: { uid: 'session-1', title: 'Weekly brief', estimate_points: 1, when: { kind: 'scheduled', at: at(W0 + DAY) } } }];
    const r = await call(w, SPONSOR, 'GET', `/project/${PROJECT}/work/workload?weeks=1`);
    assert.deepEqual(r.body.agents[0].weeks[0].items.map((i: any) => i.uid), ['session-1']);
  } finally { WORKLOAD_DEPS.agentSessions = saved; __setEngineRouteDeps(null); w.close(); }
});

test('W4: capacity is one\'s own or an editor\'s, for someone on the project, 0 to 1,000 or cleared', async () => {
  const w = world();
  try {
    w.agent(AGENT);
    member(w, MEMBER);
    const own = await call(w, MEMBER, 'PUT', `/project/${PROJECT}/work/capacity/u-member`, { weekly_capacity_points: 8 });
    assert.deepEqual([own.status, own.body.capacity], [200, { available: true, value: 8 }]);
    // Mutation checked: the self-or-editor check dropped → the member sets the founder's capacity and this fails.
    assert.equal((await call(w, MEMBER, 'PUT', `/project/${PROJECT}/work/capacity/u-sponsor`, { weekly_capacity_points: 1 })).body.error, 'not_manager');
    assert.equal((await call(w, SPONSOR, 'PUT', `/project/${PROJECT}/work/capacity/u-member`, { weekly_capacity_points: 12 })).body.capacity.value, 12, 'an editor sets anyone\'s');
    assert.equal((await call(w, SPONSOR, 'PUT', `/project/${PROJECT}/work/capacity/u-stranger`, { weekly_capacity_points: 3 })).status, 404, 'not on the project');
    for (const v of [-1, 1001, '8', undefined]) {
      assert.equal((await call(w, SPONSOR, 'PUT', `/project/${PROJECT}/work/capacity/u-member`, v === undefined ? {} : { weekly_capacity_points: v })).body.error, 'invalid_capacity', String(v));
    }
    const cleared = await call(w, SPONSOR, 'PUT', `/project/${PROJECT}/work/capacity/u-member`, { weekly_capacity_points: null });
    assert.deepEqual(cleared.body.capacity, { available: false, reason: 'Not recorded' });
    assert.equal(Number((w.db.prepare('SELECT COUNT(*) AS n FROM work_capacity').get() as any).n), 0);
  } finally { __setEngineRouteDeps(null); w.close(); }
});

test('W4: a time block on W1\'s PATCH — both or neither, the end after the start; the assignee sets their own', async () => {
  const w = world();
  try {
    w.agent(AGENT);
    member(w, MEMBER);
    personTask(w, 400, MEMBER, { estimate: 1 });
    const T = hex(400, 'c');
    const ok = await call(w, MEMBER, 'PATCH', `/tasks/${T}`, { scheduled_start: '2026-11-04T09:00Z', scheduled_end: '2026-11-04T11:30Z' });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(ok.body.task.scheduled, { start: '2026-11-04 09:00:00', end: '2026-11-04 11:30:00' });
    // Mutation checked: the end-after-start check dropped → the backwards block saves (and the CHECK refuses it as a 500), so this fails.
    const backwards = await call(w, MEMBER, 'PATCH', `/tasks/${T}`, { scheduled_end: '2026-11-04T08:00Z' });
    assert.deepEqual([backwards.status, backwards.body.error], [400, 'invalid_task']);
    assert.match(backwards.body.message, /ends after it starts/);
    assert.equal((await call(w, MEMBER, 'PATCH', `/tasks/${T}`, { scheduled_start: null })).status, 400, 'both or neither');
    assert.equal((await call(w, MEMBER, 'PATCH', `/tasks/${T}`, { scheduled_start: '2026-11-04', scheduled_end: '2026-11-05' })).status, 400, 'a time, not a day');
    assert.equal((await call(w, MEMBER, 'PATCH', `/tasks/${T}`, { scheduled_start: '2026-11-04T09:00Z', scheduled_end: '2026-11-12T09:00Z' })).status, 400, 'at most 7 days');
    const cleared = await call(w, MEMBER, 'PATCH', `/tasks/${T}`, { scheduled_start: null, scheduled_end: null });
    assert.deepEqual([cleared.status, cleared.body.task.scheduled], [200, null]);
    // Someone else's task: the assignee rule still holds.
    personTask(w, 401, SPONSOR);
    assert.equal((await call(w, MEMBER, 'PATCH', `/tasks/${hex(401, 'c')}`, { scheduled_start: '2026-11-04T09:00Z', scheduled_end: '2026-11-04T10:00Z' })).status, 403);
  } finally { __setEngineRouteDeps(null); w.close(); }
});

test('W4: reassigning to an agent keeps E1\'s checks — the agent must be live and work in the task\'s module', async () => {
  const w = world();
  try {
    w.agent(AGENT);
    w.agent(51, 'cto', { status: 'paused' });
    personTask(w, 500, SPONSOR, { estimate: 2 });
    const T = hex(500, 'c');
    const paused = await call(w, SPONSOR, 'PATCH', `/tasks/${T}`, { assignee: { kind: 'agent', uid: hex(51, 'b') } });
    assert.deepEqual([paused.status, paused.body.error], [409, 'agent_not_live']);
    w.db.prepare("UPDATE scope_tasks SET module = 'not-a-module' WHERE id = 500").run();
    const outside = await call(w, SPONSOR, 'PATCH', `/tasks/${T}`, { assignee: { kind: 'agent', uid: hex(AGENT, 'b') } });
    assert.deepEqual([outside.status, outside.body.error], [422, 'module_not_allowed']);
    w.db.prepare("UPDATE scope_tasks SET module = 'product-roadmap' WHERE id = 500").run();
    const moved = await call(w, SPONSOR, 'PATCH', `/tasks/${T}`, { assignee: { kind: 'agent', uid: hex(AGENT, 'b') } });
    assert.equal(moved.status, 200, moved.text);
    assert.equal(moved.body.task.assignee.kind, 'agent');
    const r = await call(w, SPONSOR, 'GET', `/project/${PROJECT}/work/workload?weeks=1`);
    assert.ok(r.body.agents.some((a: any) => a.unscheduled.some((i: any) => i.uid === T)), 'the work moved to the agent\'s row');
  } finally { __setEngineRouteDeps(null); w.close(); }
});

test('W4: the calendar\'s Work items show only the projects the member can read', async () => {
  const w = world();
  try {
    w.agent(AGENT);
    personTask(w, 600, SPONSOR, { due: '2026-11-10 00:00:00' });
    personTask(w, 601, SPONSOR, { start: '2026-11-11 09:00:00', end: '2026-11-11 10:00:00', due: '2026-11-30 00:00:00' });
    personTask(w, 602, SPONSOR, { due: '2026-11-12 00:00:00', status: 'done', board: 'done' });
    const from = '2026-11-01T00:00:00.000Z', to = '2026-12-01T00:00:00.000Z';
    const mine = await workItemEvents(w.env, SPONSOR, from, to);
    assert.deepEqual(mine.map((e: any) => [e.source_uid, e.all_day, e.start_at]), [
      [hex(600, 'c'), true, '2026-11-10'],
      [hex(601, 'c'), false, '2026-11-11T09:00:00.000Z'],
    ], 'a block in its time, else all day on the due date; done hidden');
    // Mutation checked: the project-reader condition dropped → the stranger sees the project's items and this fails.
    assert.deepEqual(await workItemEvents(w.env, STRANGER, from, to), [], 'a stranger reads none');
    assert.deepEqual(await workItemEvents(w.env, MEMBER, from, to), [], 'not yet a member');
    member(w, MEMBER);
    assert.equal((await workItemEvents(w.env, MEMBER, from, to)).length, 2, 'an accepted member reads them');
  } finally { __setEngineRouteDeps(null); w.close(); }
});
