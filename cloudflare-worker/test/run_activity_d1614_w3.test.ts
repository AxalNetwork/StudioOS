// D1614 W3 (#3971) — an agent run in full, its retry, and a project's activity feed.
//
//   1. The run's detail: agent, work, sources and tools by name, proposals with who decided,
//      times, and cost (held, charged, tokens, model). Unread cost is { available: false }, never 0.
//   2. Outcomes: a failure's reason in words and whether it may be retried; the skipped reasons;
//      cancelled; completed.
//   3. Retry: only the latest attempt of a transient failure, by the team's editors or the sponsor,
//      admitted as a fresh start is.
//   4. The feed: people's and agents' task events, runs and decisions, newest first, filtered and paged;
//      a person's and an agent's lists; project scope only; the read gate; no email.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/run_activity_d1614_w3.test.ts
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { AGENT, MEMBER, PROJECT, SPONSOR, STRANGER, hex, world, type World } from './_agent_engine_fixture.ts';
import engineRoutes, { __setEngineRouteDeps } from '../src/routes/agent_engine.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { FEED_PAGE, outcomeOf, sourcesOf } from '../src/services/agents/runActivity.ts';

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

const STEPS_DONE = JSON.stringify([
  { name: 'load', status: 'done', at: '2026-11-02 10:00:00', summary: 'Ready to work.' },
  { name: 'context', status: 'done', at: '2026-11-02 10:00:01', summary: 'Read build.records, raise.records and 2 notes.' },
  { name: 'run', status: 'done', at: '2026-11-02 10:00:05', summary: 'Drafted the plan.' },
]);
const STEPS_FAILED = JSON.stringify([
  { name: 'load', status: 'done', at: '2026-11-02 10:00:00', summary: 'Ready to work.' },
  { name: 'run', status: 'failed', at: '2026-11-02 10:00:05', summary: 'The platform\'s agent limit was reached.' },
]);

/** A run row, as E3's loop leaves it. */
function run(w: World, o: { id: number; task: number; attempt?: number; status: string; refusal?: string | null; steps?: string; usage?: number | null; proposal?: string | null;
  started?: string | null; ended?: string | null }) {
  w.db.prepare(`INSERT INTO agent_task_runs (id, uid, agent_id, task_id, attempt, status, refusal, steps_json, usage_log_id, proposal_uid, started_at, ended_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(o.id, `run-0000-${o.id}`, AGENT, o.task, o.attempt ?? 1, o.status, o.refusal ?? null, o.steps ?? '[]', o.usage ?? null,
    o.proposal ?? null, o.started === undefined ? '2026-11-02 10:00:00' : o.started, o.ended === undefined ? '2026-11-02 10:00:30' : o.ended, '2026-11-02 10:00:00');
  return `run-0000-${o.id}`;
}

test('W3: a run in full — agent, work, sources and tools by name, proposals and who decided, cost', async () => {
  const w = world();
  try {
    w.agent(AGENT);
    w.db.prepare("UPDATE team_agents SET persona_key = 'juno', tool_grants_json = ? WHERE id = ?").run(JSON.stringify([{ integration_uid: 'i1', tool: 'linear.read_issues' }]), AGENT);
    w.task(200, AGENT, { title: 'Draft the Q4 plan' });
    w.db.prepare("UPDATE scope_tasks SET detail = 'Use the board and the raise.' WHERE id = 200").run();
    w.db.prepare(`INSERT INTO ai_usage_logs (id, user_id, task, model, prompt_tokens, completion_tokens, charged_microusd, agent_id)
      VALUES (900, ${SPONSOR}, 'module_chat', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 1200, 300, 4200, ${AGENT})`).run();
    w.db.prepare(`INSERT INTO ai_budget_reservations (uid, user_id, day_key, month_key, included_microusd, topup_microusd, expires_at, execution_id)
      VALUES ('hold-1', ${SPONSOR}, '2026-11-02', '2026-11', 9000, 1000, '2026-11-03 00:00:00', 'run-0000-1')`).run();
    w.db.prepare(`INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, kind, payload_json, status, decided_at, decided_by_user_id, task_id, run_key, agent_id)
      VALUES ('prop-1', ${SPONSOR}, 'build', 'plan', 'proposal', '{}', 'accepted', '2026-11-02 11:00:00', ${SPONSOR}, 200, 'agent:run-0000-1', ${AGENT})`).run();
    const uid = run(w, { id: 1, task: 200, status: 'done', steps: STEPS_DONE, usage: 900, proposal: 'prop-1' });
    const r = await call(w, SPONSOR, 'GET', `/runs/${uid}`);
    assert.equal(r.status, 200, r.text);
    const d = r.body.detail;
    assert.deepEqual(d.agent, { uid: hex(AGENT, 'b'), name: 'Juno', role_key: 'ceo', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' });
    assert.equal(d.skill, null, 'no run names a skill before #3954');
    assert.deepEqual(d.work, { task: { uid: hex(200, 'c'), title: 'Draft the Q4 plan' }, instruction: 'Use the board and the raise.', module: 'product-roadmap', option: 'draft:build/plan' });
    // Mutation checked: `sourcesOf` returning [] → the names are lost and this fails.
    assert.deepEqual(d.sources, ['build.records', 'raise.records']);
    assert.deepEqual(d.tools, ['linear.read_issues']);
    assert.deepEqual(d.proposals, [{ uid: 'prop-1', status: 'accepted', decided_at: '2026-11-02 11:00:00', decided_by: { uid: 'u-sponsor', name: 'Sam Sponsor' } }]);
    assert.deepEqual(d.outcome, { kind: 'completed', awaiting_decision: false });
    assert.deepEqual([d.started_at, d.finished_at, d.duration_ms], ['2026-11-02 10:00:00', '2026-11-02 10:00:30', 30_000]);
    assert.deepEqual(d.cost, {
      held: { available: true, value_microusd: 10_000 }, charged: { available: true, value_microusd: 4200 },
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', tokens: { available: true, input: 1200, output: 300 },
    });
    // No usage row and no hold: not recorded, never 0.
    w.task(201, AGENT);
    const bare = await call(w, SPONSOR, 'GET', `/runs/${run(w, { id: 2, task: 201, status: 'running', started: '2026-11-02 12:00:00', ended: null })}`);
    // Mutation checked: `heldFor` answering { available: true, value_microusd: 0 } on no row → this fails.
    assert.deepEqual(bare.body.detail.cost, { held: { available: false }, charged: { available: false }, model: null, tokens: { available: false } });
    assert.deepEqual([bare.body.detail.outcome, bare.body.detail.duration_ms], [{ kind: 'in_progress' }, null]);
    // The read gate, and no email or numeric id in any of it.
    assert.equal((await call(w, STRANGER, 'GET', `/runs/${uid}`)).status, 404);
    assert.ok(!/@example\.test/.test(r.text + bare.text), 'no email');
    assert.ok(!/"(user_id|decided_by_user_id|sponsor_user_id|agent_id|task_id)"/.test(r.text), 'no numeric id key');
    assert.ok(!/Use the board and the raise\.\s*<agent_data|prompt/.test(JSON.stringify(d.sources)), 'names only, never a prompt');
  } finally { __setEngineRouteDeps(null); w.close(); }
});

test('W3: outcomes — a failure in words and whether to retry; skipped reasons; cancelled', () => {
  const failed = JSON.parse(STEPS_FAILED);
  assert.equal(outcomeOf({ status: 'failed', refusal: 'gateway_limit' }, failed, true).kind, 'skipped', 'the platform limit is out of tokens, not a failure');
  assert.deepEqual(outcomeOf({ status: 'step_lost', refusal: 'step_lost' }, failed, true),
    { kind: 'failed', reason_code: 'step_lost', reason_text: 'The platform\'s agent limit was reached.', retryable: true });
  // Mutation checked: `retryable` ignoring `isLatestAttempt` → an older failure reads retryable and this fails.
  assert.equal((outcomeOf({ status: 'step_lost', refusal: 'step_lost' }, failed, false) as any).retryable, false, 'only the latest attempt');
  assert.equal((outcomeOf({ status: 'refused', refusal: 'not_ready' }, failed, true) as any).retryable, false, 'a refusal a retry would repeat');
  assert.equal((outcomeOf({ status: 'scope_moved', refusal: 'scope_moved' }, [], true) as any).reason_text, 'The run did not finish.');
  // Mutation checked: the PAUSED set emptied → a paused team reads as failed and this fails.
  assert.deepEqual(outcomeOf({ status: 'refused', refusal: 'scope_paused' }, [], true), { kind: 'skipped', reason: 'paused', reason_text: 'Skipped: the agent or its team was paused.' });
  assert.equal((outcomeOf({ status: 'refused', refusal: 'spend_limit' }, [], true) as any).reason, 'out_of_tokens');
  assert.equal((outcomeOf({ status: 'refused', refusal: 'tool_disconnected' }, [], true) as any).reason, 'tool_disconnected');
  assert.equal((outcomeOf({ status: 'halted', refusal: 'halted' }, [], true) as any).reason, 'paused');
  assert.deepEqual(outcomeOf({ status: 'cancelled', refusal: 'cancelled_by_person' }, [], true), { kind: 'cancelled', reason_text: 'Cancelled by a person.' });
  assert.deepEqual(outcomeOf({ status: 'waiting_decision', refusal: null }, [], true), { kind: 'completed', awaiting_decision: true });
  assert.deepEqual(sourcesOf([{ name: 'context', status: 'done', at: '', summary: 'Read nothing and 0 notes.' }]), []);
});

test('W3: retry only the latest transient failure, by an editor or the sponsor, admitted like a start', async () => {
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const old = run(w, { id: 1, task: 200, attempt: 1, status: 'failed', refusal: 'gateway_limit_x', steps: STEPS_FAILED });
    const latest = run(w, { id: 2, task: 200, attempt: 2, status: 'failed', refusal: 'agent_run_transient', steps: STEPS_FAILED });
    assert.equal((await call(w, STRANGER, 'POST', `/runs/${latest}/retry`)).status, 404, 'a stranger cannot see it');
    const notRetry = await call(w, SPONSOR, 'POST', `/runs/${old}/retry`);
    assert.deepEqual([notRetry.status, notRetry.body.error], [409, 'not_retryable'], 'an older attempt is not retried');
    const r = await call(w, SPONSOR, 'POST', `/runs/${latest}/retry`);
    assert.equal(r.status, 202, r.text);
    assert.equal(r.body.run.attempt, 3);
    assert.equal(r.body.run.status, 'admitted');
    // A second retry meets the same single flight a fresh start does.
    assert.equal((await call(w, SPONSOR, 'POST', `/runs/${latest}/retry`)).body.error, 'not_retryable', 'it is no longer the latest attempt');
    w.task(201, AGENT);
    const refused = run(w, { id: 103, task: 201, status: 'refused', refusal: 'not_ready' });
    assert.equal((await call(w, SPONSOR, 'POST', `/runs/${refused}/retry`)).body.error, 'not_retryable', 'a refusal is not retried');
  } finally { __setEngineRouteDeps(null); w.close(); }
});

test('W3: a member who neither manages the team nor sponsors the agent cannot retry', async () => {
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    // MEMBER is on the project (a cofounder seat), so reads it, but is not its founder-owner: no manager.
    w.db.prepare("INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'cofounder', 'accepted')").run(PROJECT, MEMBER);
    const latest = run(w, { id: 1, task: 200, status: 'failed', refusal: 'agent_run_transient', steps: STEPS_FAILED });
    const read = await call(w, MEMBER, 'GET', `/runs/${latest}`);
    const retry = await call(w, MEMBER, 'POST', `/runs/${latest}/retry`);
    // Mutation checked: the manage-or-sponsor check dropped → the member's retry is admitted and this fails.
    assert.equal(read.status, 200, 'a company member reads the project\'s runs');
    assert.deepEqual([retry.status, retry.body.error], [403, 'not_manager']);
  } finally { __setEngineRouteDeps(null); w.close(); }
});

test('W3: the project feed — people and agents, filtered, paged, and a person\'s and an agent\'s lists', async () => {
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT, { title: 'Agent task' }); w.task(201, AGENT, { title: 'Person task' });
    w.db.prepare("UPDATE scope_tasks SET assignee_kind = 'person', assignee_user_id = ?, assignee_agent_id = NULL, status = 'done', board_column = 'done' WHERE id = 201").run(SPONSOR);
    const ev = w.db.prepare('INSERT INTO scope_task_events (task_id, actor_user_id, actor_agent_id, kind, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    ev.run(201, SPONSOR, null, 'created', null, '2026-11-02 09:00:00');
    ev.run(201, SPONSOR, null, 'status', JSON.stringify({ from: 'in_progress', to: 'done' }), new Date(Date.now() - 60_000).toISOString().slice(0, 19).replace('T', ' '));
    ev.run(200, null, AGENT, 'status', JSON.stringify({ from: 'open', to: 'in_progress' }), '2026-11-02 10:00:00');
    ev.run(200, SPONSOR, null, 'updated', JSON.stringify({ fields: ['title'] }), '2026-11-02 10:30:00');
    run(w, { id: 1, task: 200, status: 'done', steps: STEPS_DONE, ended: '2026-11-02 10:01:00' });
    w.db.prepare(`INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, kind, payload_json, status, decided_at, decided_by_user_id, task_id, run_key, agent_id)
      VALUES ('prop-1', ${SPONSOR}, 'build', 'plan', 'proposal', '{}', 'discarded', '2026-11-02 11:00:00', ${SPONSOR}, 200, 'agent:run-0000-1', ${AGENT})`).run();

    const feed = await call(w, SPONSOR, 'GET', `/project/${PROJECT}/activity`);
    assert.equal(feed.status, 200, feed.text);
    const kinds = feed.body.items.map((i: any) => `${i.type}:${i.verb ?? i.decision ?? i.outcome?.kind}`);
    // Newest first; an `updated` event is not activity.
    assert.deepEqual(kinds, ['task_event:completed', 'proposal_decision:discarded', 'agent_run:completed', 'task_event:moved', 'task_event:created']);
    const runItem = feed.body.items.find((i: any) => i.type === 'agent_run');
    assert.deepEqual([runItem.by, runItem.task.title, runItem.cost], [{ kind: 'agent', uid: hex(AGENT, 'b'), name: `Agent${AGENT}`, role_key: 'ceo' }, 'Agent task', { available: false }]);
    assert.deepEqual(feed.body.items.find((i: any) => i.type === 'proposal_decision').by, { kind: 'person', uid: 'u-sponsor', name: 'Sam Sponsor' });
    assert.ok(!/@example\.test/.test(feed.text), 'no email');
    // Filters. Mutation checked: `who` ignored → the agents-only feed holds the person's events and this fails.
    assert.ok((await call(w, SPONSOR, 'GET', `/project/${PROJECT}/activity?who=agents`)).body.items.every((i: any) => i.by?.kind === 'agent'));
    assert.ok((await call(w, SPONSOR, 'GET', `/project/${PROJECT}/activity?who=people`)).body.items.every((i: any) => i.by?.kind === 'person'));
    assert.deepEqual((await call(w, SPONSOR, 'GET', `/project/${PROJECT}/activity?task=${hex(200, 'c')}`)).body.items.map((i: any) => i.task.title).filter((t: string) => t !== 'Agent task'), []);
    const mine = await call(w, SPONSOR, 'GET', `/project/${PROJECT}/activity?person=u-sponsor`);
    assert.deepEqual(mine.body.lists, { worked_on: [], completed: [{ uid: hex(201, 'c'), title: 'Person task' }], completed_last_7_days: 1 });
    const its = await call(w, SPONSOR, 'GET', `/project/${PROJECT}/activity?agent=${hex(AGENT, 'b')}`);
    assert.deepEqual(its.body.lists.worked_on.map((t: any) => t.title), ['Agent task']);
    assert.ok(its.body.items.every((i: any) => i.by?.kind === 'agent'));
    assert.equal((await call(w, SPONSOR, 'GET', `/project/${PROJECT}/activity?who=all`)).body.error, 'invalid_who');
    assert.equal((await call(w, SPONSOR, 'GET', `/project/${PROJECT}/activity?agent=${'f'.repeat(32)}`)).status, 404);
    // Project scope only; the read gate.
    assert.equal((await call(w, SPONSOR, 'GET', '/company/co-1/activity')).status, 404, 'a company has no feed');
    assert.equal((await call(w, STRANGER, 'GET', `/project/${PROJECT}/activity`)).body.error, 'not_member');
  } finally { __setEngineRouteDeps(null); w.close(); }
});

test('W3: a board move is one item — W1\'s `moved` and its paired `status` read once', async () => {
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const ev = w.db.prepare('INSERT INTO scope_task_events (task_id, actor_user_id, kind, detail_json, created_at) VALUES (200, ?, ?, ?, ?)');
    ev.run(SPONSOR, 'moved', JSON.stringify({ change: 'c1', from: 'ready', to: 'in_progress', from_status: 'open', to_status: 'in_progress' }), '2026-11-02 10:00:00');
    ev.run(SPONSOR, 'status', JSON.stringify({ change: 'c1', from: 'open', to: 'in_progress' }), '2026-11-02 10:00:00');
    ev.run(SPONSOR, 'moved', JSON.stringify({ change: 'c2', from: 'in_review', to: 'done', from_status: 'waiting_decision', to_status: 'done' }), '2026-11-02 11:00:00');
    ev.run(SPONSOR, 'status', JSON.stringify({ change: 'c2', from: 'waiting_decision', to: 'done' }), '2026-11-02 11:00:00');
    const r = await call(w, SPONSOR, 'GET', `/project/${PROJECT}/activity`);
    // Mutation checked: `moved` events dropped → the board's moves vanish from the feed and this fails.
    assert.deepEqual(r.body.items.map((i: any) => [i.verb, i.to]), [['completed', null], ['moved', 'in_progress']]);
  } finally { __setEngineRouteDeps(null); w.close(); }
});

test('W3: the feed pages by its cursor, 50 at a time, with no item twice and none lost', async () => {
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const ev = w.db.prepare("INSERT INTO scope_task_events (task_id, actor_user_id, kind, created_at) VALUES (200, ?, 'created', ?)");
    // Two events share each second: the cursor still orders them.
    for (let i = 0; i < 120; i += 1) ev.run(SPONSOR, `2026-11-02 10:${String(Math.floor(i / 2)).padStart(2, '0')}:00`);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r = await call(w, SPONSOR, 'GET', `/project/${PROJECT}/activity${cursor ? `?before=${encodeURIComponent(cursor)}` : ''}`);
      assert.equal(r.status, 200, r.text);
      assert.ok(r.body.items.length <= FEED_PAGE);
      seen.push(...r.body.items.map((i: any) => i.id));
      cursor = r.body.next_cursor;
      pages += 1;
    } while (cursor && pages < 10);
    // Mutation checked: `older` comparing `<=` → the boundary item repeats and this fails.
    assert.equal(pages, 3);
    assert.equal(seen.length, 120);
    assert.equal(new Set(seen).size, 120);
    assert.equal((await call(w, SPONSOR, 'GET', `/project/${PROJECT}/activity?before=nope`)).body.error, 'invalid_cursor');
  } finally { __setEngineRouteDeps(null); w.close(); }
});
