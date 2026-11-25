/**
 * D8081 (#8081) — planner, worker and reviewer roles over agent_handoffs; the parent's budget bounds its children.
 * On E3's world (`_agent_engine_fixture.ts`: the real migrated schema). Every row is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_hierarchy_8081.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { PROJECT, SPONSOR, world, type World } from './_agent_engine_fixture.ts';
import { DEPTH_MAX, parseHandoff, proposeHandoff, type HandoffAsk } from '../src/services/agents/handoffs.ts';
import { MIN_SHARE_TOKENS, PLANNER_MAX_WORKERS_DEFAULT, askedRole, roleRefusal, shareStillFits } from '../src/services/agentHierarchy.ts';
import { reserve, settle, taskTreeTokens, type BudgetRun } from '../src/services/agentBudgets.ts';
import { decideRail } from '../src/services/railProposals.ts';
import engineRoutes from '../src/routes/agent_engine.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

test.after(() => removeMigratedDatabases());

const CFO = 52, GC = 53, IR = 55, CEO = 56;
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const row = (w: World, sql: string, ...b: unknown[]) => w.db.prepare(sql).get(...b) as any;
const agentRow = (w: World, id: number) => row(w, 'SELECT * FROM team_agents WHERE id = ?', id);
const taskRow = (w: World, id: number) => row(w, 'SELECT * FROM scope_tasks WHERE id = ?', id);
const ask = (to: string, extra: Partial<HandoffAsk> = {}): HandoffAsk => ({ to_role: to, title: 'Do the part', why: null, note: null, role: 'worker', reviews: null, ...extra });

function setup() {
  const w = world();
  w.agent(CFO, 'cfo'); w.agent(GC, 'general_counsel'); w.agent(IR, 'investor_relations'); w.agent(CEO, 'ceo');
  return w;
}
let attempt = 0;
/** A finished run of `agentId` on `taskId`: the run a handoff `ho-<uid>` came from. */
function ran(w: World, agentId: number, taskId: number, uid: string) {
  attempt += 1;
  w.db.prepare("INSERT INTO agent_task_runs (uid, agent_id, task_id, attempt, status) VALUES (?, ?, ?, ?, 'done')").run(uid, agentId, taskId, attempt);
  return uid;
}
async function propose(w: World, fromId: number, taskId: number, runUid: string, a: HandoffAsk) {
  ran(w, fromId, taskId, runUid);
  return proposeHandoff(w.env, { from: agentRow(w, fromId), task: taskRow(w, taskId), runUid, ask: a });
}
async function accept(w: World, h: any) {
  await decideRail(w.env, SPONSOR, h.proposal_uid, 'accept');
  return row(w, 'SELECT * FROM agent_handoffs WHERE id = ?', h.id);
}
const childTask = (w: World, h: any) => taskRow(w, h.created_task_id);
const budgetRun = (w: World, uid: string): BudgetRun => {
  const r = row(w, 'SELECT r.*, a.scope_kind, a.company_id, a.project_id FROM agent_task_runs r JOIN team_agents a ON a.id = r.agent_id WHERE r.uid = ?', uid);
  return { uid: r.uid, agent_id: r.agent_id, task_id: r.task_id, attempt: r.attempt, scope_kind: r.scope_kind, company_id: r.company_id, project_id: r.project_id };
};
/** `tokens` the child's run used, settled through D8071's own settle (from the usage ledger). */
async function used(w: World, runUid: string, tokens: number) {
  const id = Number(w.db.prepare(`INSERT INTO ai_usage_logs (user_id, task, model, prompt_tokens, completion_tokens, latency_ms, charged_microusd, agent_id)
    VALUES (?, 'rail_numbers', ?, ?, 0, 100, 1, ?)`).run(SPONSOR, MODEL, tokens, budgetRun(w, runUid).agent_id).lastInsertRowid);
  return settle(w.env, budgetRun(w, runUid), id, 'run');
}

test('the handoff line carries a role (default worker) and, for a reviewer, the run it reviews; a bad role is no handoff', () => {
  const line = (extra: string) => `done.\n{"handoff":{"to_role":"general_counsel","title":"Check it"${extra}}}`;
  assert.equal(parseHandoff(line(''))!.role, 'worker');
  assert.deepEqual([parseHandoff(line(',"role":"reviewer","reviews":"run-0000-0001"'))!.role, parseHandoff(line(',"role":"reviewer","reviews":"run-0000-0001"'))!.reviews], ['reviewer', 'run-0000-0001']);
  assert.equal(parseHandoff(line(',"role":"worker","reviews":"run-0000-0001"'))!.reviews, null, 'only a reviewer names a run');
  assert.equal(parseHandoff(line(',"role":"boss"')), null);
  assert.equal(parseHandoff(line(',"role":"reviewer","reviews":"x; DROP"')), null);
  assert.deepEqual(askedRole({ role: 'planner' }), { role: 'planner', reviews: null });
  // The pure rule: only the root or a planner hands off to a planner.
  assert.equal(roleRefusal('planner', 'planner'), null);
  assert.equal(roleRefusal('worker', 'planner'), 'planner_not_allowed');
  assert.equal(roleRefusal('reviewer', 'planner'), 'planner_not_allowed');
  assert.equal(roleRefusal('worker', 'worker'), null);
  assert.equal(roleRefusal('worker', 'reviewer'), null);
});

test('roles: a worker may not create a planner; a planner hands off at most N workers (agent_scope_settings)', async () => {
  // Mutation checked: roleRefusal always null → the worker's planner is proposed; the N count dropped → the second worker is proposed.
  const w = setup();
  try {
    w.task(400, CFO);
    // The root plans: a planner step is allowed from it.
    const planner = await propose(w, CFO, 400, 'run-root-0001', ask('general_counsel', { role: 'planner' }));
    assert.equal(planner.status, 'proposed');
    assert.equal(planner.handoff!.hierarchy_role, 'planner');
    // A worker step's task asks for a planner: refused.
    w.db.prepare(`INSERT INTO agent_handoffs (uid, chain_uid, depth, from_agent_id, to_role_key, to_agent_id, title, status, hierarchy_role)
      VALUES ('ho-w1', 'chain-w', 1, ?, 'general_counsel', ?, 'Work', 'accepted', 'worker')`).run(CFO, GC);
    w.task(410, GC);
    w.db.prepare("UPDATE scope_tasks SET source_kind = 'handoff', source_ref = 'ho-w1' WHERE id = 410").run();
    const byWorker = await propose(w, GC, 410, 'run-work-0001', ask('ceo', { role: 'planner' }));
    assert.deepEqual([byWorker.status, (byWorker as any).code], ['refused', 'planner_not_allowed']);
    assert.equal(byWorker.handoff!.hierarchy_role, 'planner', 'the refused step records what was asked');
    // N = 1 in this scope: the root's second worker is refused.
    w.db.prepare("INSERT INTO agent_scope_settings (scope_kind, project_id, planner_max_workers) VALUES ('project', ?, 1)").run(PROJECT);
    w.task(420, CFO);
    assert.equal((await propose(w, CFO, 420, 'run-root-0002', ask('general_counsel'))).status, 'proposed');
    const second = await propose(w, CFO, 420, 'run-root-0003', ask('investor_relations'));
    assert.deepEqual([second.status, (second as any).code], ['refused', 'too_many_workers']);
    assert.equal(PLANNER_MAX_WORKERS_DEFAULT, 3);
    assert.equal(DEPTH_MAX, 3, 'D1528 depth stays the bound (agent_duties_handoffs_d1530 holds depth_exceeded)');
  } finally { w.close(); }
});

test('a reviewer names the run it reviews and is never its author, on propose and again on Accept', async () => {
  // Mutation checked: the author comparison removed → the self-review is proposed.
  const w = setup();
  try {
    w.task(500, CFO);
    w.task(501, GC);
    const gcRun = ran(w, GC, 501, 'run-gc-work-01');
    const missing = await propose(w, CFO, 500, 'run-cfo-0001', ask('general_counsel', { role: 'reviewer', reviews: null }));
    assert.deepEqual([missing.status, (missing as any).code], ['refused', 'review_target_missing']);
    const unknown = await propose(w, CFO, 500, 'run-cfo-0002', ask('general_counsel', { role: 'reviewer', reviews: 'run-not-there' }));
    assert.equal((unknown as any).code, 'review_target_missing');
    const self = await propose(w, CFO, 500, 'run-cfo-0003', ask('general_counsel', { role: 'reviewer', reviews: gcRun }));
    assert.deepEqual([self.status, (self as any).code], ['refused', 'self_review'], 'GC would review its own run');
    const cfoRun = ran(w, CFO, 500, 'run-cfo-work-1');
    const ok = await propose(w, CFO, 500, 'run-cfo-0004', ask('general_counsel', { role: 'reviewer', reviews: cfoRun }));
    assert.equal(ok.status, 'proposed');
    assert.equal(ok.handoff!.reviews_run_uid, cfoRun);
    // Between propose and Accept the reviewed run turns out to be the target's (the target is read again at Accept).
    w.db.prepare('UPDATE agent_task_runs SET agent_id = ? WHERE uid = ?').run(GC, cfoRun);
    const decided = await accept(w, ok.handoff);
    assert.deepEqual([decided.status, decided.refusal, decided.created_task_id], ['refused', 'self_review', null]);
    // The schema holds the pairing too: only a reviewer step carries a reviewed run.
    assert.throws(() => w.db.prepare(`INSERT INTO agent_handoffs (uid, chain_uid, depth, from_agent_id, to_role_key, title, status, hierarchy_role, reviews_run_uid)
      VALUES ('ho-bad', 'c-bad', 1, ?, 'cfo', 't', 'proposed', 'worker', 'run-x-0001')`).run(GC), /CHECK/);
  } finally { w.close(); }
});

test('budgets: each child gets a share at Accept; together they never pass the parent; a child over its share halts', async () => {
  // Mutation checked: the "+ 1" part the parent keeps removed → the shares sum to the cap and the parent's own reserve passes.
  const w = setup();
  try {
    w.task(600, CFO);
    w.db.prepare('UPDATE scope_tasks SET budget_tokens_cap = 12000 WHERE id = 600').run();
    const shares: number[] = [];
    for (const [i, to] of ['general_counsel', 'investor_relations', 'ceo'].entries()) {
      const p = await propose(w, CFO, 600, `run-plan-000${i}`, ask(to));
      const h = await accept(w, p.handoff);
      assert.equal(h.status, 'accepted', `${to}: ${h.refusal}`);
      shares.push(childTask(w, h).budget_tokens_cap);
    }
    // left ÷ (worker slots left + 1): 12000/4, then 9000/3, then 6000/2.
    assert.deepEqual(shares, [3000, 3000, 3000]);
    assert.equal(await taskTreeTokens(w.env, 600), 9000);
    assert.ok(await taskTreeTokens(w.env, 600) <= 12000, 'the children together hold no more than the parent reserved');
    // The parent's own next call sees its children's holds (D8071's task_tokens counts the tree).
    const parentRun = budgetRun(w, 'run-plan-0000');
    const own = await reserve(w.env, parentRun, { tokens: 3500 });
    assert.deepEqual(own.ok ? null : [own.code, (own as any).cap, (own as any).used], ['budget_exhausted', 'task_tokens', 9000]);
    // A child over its share halts.
    const child = childTask(w, row(w, "SELECT * FROM agent_handoffs WHERE to_role_key = 'general_counsel' AND status = 'accepted'"));
    const childRun = ran(w, GC, child.id, 'run-child-gc-1');
    await used(w, childRun, 2500);
    // Its next run (a settled step is let through as a replay, so the check is on a new one).
    const next = ran(w, GC, child.id, 'run-child-gc-2');
    const over = await reserve(w.env, budgetRun(w, next), { tokens: 600 });
    assert.deepEqual(over.ok ? null : [over.code, (over as any).cap, (over as any).limit], ['budget_exhausted', 'task_tokens', 3000]);
    assert.equal((await reserve(w.env, budgetRun(w, next), { tokens: 500 })).ok, true, 'within its share it runs');
  } finally { w.close(); }
});

test('budgets: what a child does not use returns to the parent when its task ends; a retried settle or Accept counts once', async () => {
  // Mutation checked: a finished child still holds its full share → the parent's tree stays 4000.
  const w = setup();
  try {
    w.task(700, CFO);
    w.db.prepare('UPDATE scope_tasks SET budget_tokens_cap = 16000 WHERE id = 700').run();
    const p = await propose(w, CFO, 700, 'run-ret-0001', ask('general_counsel'));
    const h = await accept(w, p.handoff);
    const child = childTask(w, h);
    assert.equal(child.budget_tokens_cap, 4000);
    assert.equal(await accept(w, h).then((x) => x.created_task_id), child.id, 'a second Accept creates no second child');
    assert.equal(row(w, "SELECT COUNT(*) AS n FROM scope_tasks WHERE source_kind = 'handoff'").n, 1);
    const childRun = ran(w, GC, child.id, 'run-ret-child1');
    const id = Number(w.db.prepare(`INSERT INTO ai_usage_logs (user_id, task, model, prompt_tokens, completion_tokens, latency_ms, charged_microusd, agent_id)
      VALUES (?, 'rail_numbers', ?, 1500, 0, 100, 1, ?)`).run(SPONSOR, MODEL, GC).lastInsertRowid);
    await settle(w.env, budgetRun(w, childRun), id, 'run');
    await settle(w.env, budgetRun(w, childRun), id, 'run'); // a retried step
    assert.equal(await taskTreeTokens(w.env, child.id), 1500, 'settled once');
    assert.equal(await taskTreeTokens(w.env, 700), 4000, 'open: the child holds its share');
    w.db.prepare("UPDATE scope_tasks SET status = 'done' WHERE id = ?").run(child.id);
    assert.equal(await taskTreeTokens(w.env, 700), 1500, 'done: it holds what it used; 2500 returned');
    await settle(w.env, budgetRun(w, childRun), id, 'run');
    assert.equal(await taskTreeTokens(w.env, 700), 1500, 'a settle after the end returns nothing twice');
    // The returned share is the parent's to give again: the next child's share is computed from 14500 left.
    const p2 = await propose(w, CFO, 700, 'run-ret-0002', ask('investor_relations'));
    assert.equal(childTask(w, await accept(w, p2.handoff)).budget_tokens_cap, Math.floor(14500 / 3));
  } finally { w.close(); }
});

test('budgets: a share too small refuses at Accept, with no task; with no cap anywhere the child has none either', async () => {
  // Mutation checked: the MIN_SHARE_TOKENS check removed → the child is created with a 750-token share;
  // the parent's reserve() verdict ignored → the month-capped share is accepted.
  const w = setup();
  try {
    w.task(800, CFO);
    w.db.prepare('UPDATE scope_tasks SET budget_tokens_cap = 3000 WHERE id = 800').run();
    const p = await propose(w, CFO, 800, 'run-small-001', ask('general_counsel'));
    const h = await accept(w, p.handoff);
    assert.deepEqual([h.status, h.refusal, h.created_task_id], ['refused', 'share_exhausted', null]);
    assert.ok(3000 / 4 < MIN_SHARE_TOKENS);
    // The agent's monthly cap stands in for a task with none (D8071).
    w.task(810, CFO);
    w.db.prepare('INSERT INTO agent_budgets (agent_id, tokens_cap) VALUES (?, 40000)').run(CFO);
    const capped = await accept(w, (await propose(w, CFO, 810, 'run-small-002', ask('general_counsel'))).handoff);
    assert.equal(childTask(w, capped).budget_tokens_cap, 10000);
    w.db.prepare('DELETE FROM agent_budgets WHERE agent_id = ?').run(CFO);
    w.task(820, CFO);
    const free = await accept(w, (await propose(w, CFO, 820, 'run-small-003', ask('general_counsel'))).handoff);
    assert.deepEqual([free.status, childTask(w, free).budget_tokens_cap], ['accepted', null]);
    // D8071's reserve still speaks for the parent: its month is nearly spent, so the share is refused there.
    w.task(830, CFO);
    w.db.prepare('UPDATE scope_tasks SET budget_tokens_cap = 12000 WHERE id = 830').run();
    w.db.prepare('INSERT INTO agent_budgets (agent_id, tokens_cap) VALUES (?, 5000)').run(CFO);
    w.db.prepare('INSERT INTO agent_budget_usage (agent_id, period_key, tokens_used) VALUES (?, ?, 4500)').run(CFO, new Date().toISOString().slice(0, 7));
    const month = await accept(w, (await propose(w, CFO, 830, 'run-small-004', ask('general_counsel'))).handoff);
    assert.deepEqual([month.status, month.refusal, month.created_task_id], ['refused', 'budget_exhausted', null]);
    w.db.prepare('DELETE FROM agent_budgets WHERE agent_id = ?').run(CFO);
    // The after-check a second Accept would trip: a tree over its cap does not fit.
    w.db.prepare('UPDATE scope_tasks SET budget_tokens_cap = 5000 WHERE id = 810').run();
    assert.equal(await shareStillFits(w.env, CFO, 810), false);
    w.db.prepare('UPDATE scope_tasks SET budget_tokens_cap = 10000 WHERE id = 810').run();
    assert.equal(await shareStillFits(w.env, CFO, 810), true);
  } finally { w.close(); }
});

test('GET /handoffs carries each step\'s role and depth', async () => {
  const w = setup();
  try {
    w.task(900, CFO);
    await propose(w, CFO, 900, 'run-read-0001', ask('general_counsel', { role: 'planner' }));
    w.db.prepare(`INSERT INTO agent_handoffs (uid, chain_uid, depth, from_agent_id, to_role_key, to_agent_id, title, status)
      VALUES ('ho-legacy', 'chain-legacy', 2, ?, 'cfo', ?, 'Earlier', 'accepted')`).run(GC, CFO);
    const a = new Hono();
    a.onError((e: any, c) => c.json({ detail: e.message }, (AUTH_ERROR_STATUSES[e?.message] ?? 500) as any));
    a.route('/api/teams', engineRoutes);
    const jwt = await new SignJWT({ user_id: SPONSOR }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(w.env.JWT_SECRET));
    const r = await a.request(`/api/teams/project/${PROJECT}/handoffs`, { headers: { Authorization: `Bearer ${jwt}` } }, w.env);
    assert.equal(r.status, 200);
    const steps = ((await r.json()) as any).chains.flatMap((c: any) => c.steps);
    const planner = steps.find((s: any) => s.to.role_key === 'general_counsel');
    assert.deepEqual([planner.hierarchy_role, planner.depth], ['planner', 1]);
    const legacy = steps.find((s: any) => s.uid === 'ho-legacy');
    assert.deepEqual([legacy.hierarchy_role, legacy.depth], ['worker', 2], 'a step from before D8081 reads as a worker');
  } finally { w.close(); }
});
