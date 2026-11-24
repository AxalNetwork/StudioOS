/**
 * D8071 (#8071) — execution budgets: per agent, per task and per workspace, reserved before the model call and
 * settled once after, halting the run `budget_exhausted`.
 *
 * The real task loop, routes and service over the migrated schema. The model is the engine fixture's fake
 * `agentRun`; every row is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_budgets_8071.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { grantWriteBar } from './_write_bar_session.mjs';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { ADMIN, AGENT, COMPANY, MEMBER, PROJECT, SPONSOR, fakeAgentRun, harness, hex, loopDeps, world, type World } from './_agent_engine_fixture.ts';
import { runTaskLoop } from '../src/agents/loop.ts';
import policyRoutes from '../src/routes/admin_ai_agents_policy.ts';
import teamRoutes from '../src/routes/team_agents.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import {
  computeMicrousd, monthKey, reserve, reservePublish, settle, settlePublish, workspaceCaps, type BudgetRun,
} from '../src/services/agentBudgets.ts';

test.after(() => removeMigratedDatabases());

const P = { kind: 'project' as const, id: PROJECT };
const POLICY = '/api/admin/ai-agents/policy';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const NOW = new Date('2026-11-22T12:00:00Z');

function setup(o: { tasks?: number[] } = {}) {
  const w = world();
  w.db.exec('INSERT OR IGNORE INTO ai_agent_policy (id) VALUES (1)');
  w.agent(AGENT);
  for (const t of o.tasks ?? [200]) w.task(t, AGENT);
  return w;
}
const caps = (w: World, agentId: number, c: { tokens?: number | null; minutes?: number | null; prs?: number | null; retries?: number | null }) => w.db.prepare(
  `INSERT INTO agent_budgets (agent_id, tokens_cap, minutes_cap, prs_per_day_cap, retries_per_task_cap, set_by) VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(agent_id) DO UPDATE SET tokens_cap = excluded.tokens_cap, minutes_cap = excluded.minutes_cap,
     prs_per_day_cap = excluded.prs_per_day_cap, retries_per_task_cap = excluded.retries_per_task_cap`,
).run(agentId, c.tokens ?? null, c.minutes ?? null, c.prs ?? null, c.retries ?? null, ADMIN);
const used = (w: World, agentId: number, period: string, tokens: number, ms = 0, prs = 0) => w.db.prepare(
  'INSERT INTO agent_budget_usage (agent_id, period_key, tokens_used, ms_used, prs_opened) VALUES (?, ?, ?, ?, ?)',
).run(agentId, period, tokens, ms, prs);
const usage = (w: World, agentId = AGENT, period = monthKey(NOW)) =>
  w.db.prepare('SELECT tokens_used, ms_used, prs_opened FROM agent_budget_usage WHERE agent_id = ? AND period_key = ?').get(agentId, period) as any;
const run = (o: Partial<BudgetRun> = {}): BudgetRun => ({
  uid: 'run-budget-0001', agent_id: AGENT, task_id: 200, attempt: 1, scope_kind: 'project', company_id: null, project_id: PROJECT, ...o,
});
const runRow = (w: World, uid: string) => w.db.prepare('SELECT status, refusal, steps_json FROM agent_task_runs WHERE uid = ?').get(uid) as any;
const admit = (w: World, taskId = 200) => w.runtime.admit(P, { agentId: AGENT, taskId, by: SPONSOR, source: 'person' }) as Promise<any>;

// ── The schema ──────────────────────────────────────────────────────────────

test('the migration adds the three tables and the nullable ceilings; the CHECKs refuse out-of-range caps', () => {
  const w = setup();
  try {
    caps(w, AGENT, { tokens: 1000 });
    for (const bad of ['tokens_cap = 0', 'minutes_cap = 0', 'prs_per_day_cap = -1', 'retries_per_task_cap = 101', "period = 'rolling_30_days'"]) {
      assert.throws(() => w.db.exec(`UPDATE agent_budgets SET ${bad}`), /CHECK/, bad);
    }
    assert.throws(() => w.db.exec(`INSERT INTO agent_budget_usage (agent_id, period_key, tokens_used) VALUES (${AGENT}, '2026-11', -1)`), /CHECK/);
    w.db.exec(`INSERT INTO agent_scope_settings (scope_kind, project_id) VALUES ('project', ${PROJECT})`);
    const row = w.db.prepare('SELECT agents_cap, live_agents_cap, ai_spend_cap_cents, compute_spend_cap_cents FROM agent_scope_settings').get() as any;
    assert.deepEqual({ ...row }, { agents_cap: null, live_agents_cap: null, ai_spend_cap_cents: null, compute_spend_cap_cents: null });
    const task = w.db.prepare('SELECT budget_tokens_cap, budget_minutes_cap, budget_retries_cap FROM scope_tasks WHERE id = 200').get() as any;
    assert.deepEqual({ ...task }, { budget_tokens_cap: null, budget_minutes_cap: null, budget_retries_cap: null });
  } finally { w.close(); }
});

// ── Reserve: each cap ───────────────────────────────────────────────────────

test('with no caps anywhere, every run is let through', async () => {
  const w = setup();
  try { assert.deepEqual(await reserve(w.env, run(), { tokens: 10_000_000 }, 'run', NOW), { ok: true }); } finally { w.close(); }
});

test('each agent and task cap halts with budget_exhausted, naming the cap, used and limit', async () => {
  // Mutations checked: `used >= limit` dropped from `over` → the exact-fit month at 1000 of 1000 lets a 0-token run in;
  // the estimate ignored → 900 + 200 over 1000 is let in; the task's retry cap ignored for the agent's → task_retries reads retries.
  const w = setup();
  try {
    const month = monthKey(NOW);
    caps(w, AGENT, { tokens: 1000 });
    used(w, AGENT, month, 900);
    assert.deepEqual(await reserve(w.env, run(), { tokens: 100 }, 'run', NOW), { ok: true }, 'an exact fit is let in');
    assert.deepEqual(await reserve(w.env, run(), { tokens: 200 }, 'run', NOW), { ok: false, code: 'budget_exhausted', cap: 'tokens', used: 900, limit: 1000 });
    w.db.exec(`UPDATE agent_budget_usage SET tokens_used = 1000`);
    assert.equal((await reserve(w.env, run(), { tokens: 0 }, 'run', NOW) as any).cap, 'tokens', 'at the cap, nothing more');

    caps(w, AGENT, { minutes: 2 });
    w.db.exec(`UPDATE agent_budget_usage SET tokens_used = 0, ms_used = 120000`);
    assert.deepEqual(await reserve(w.env, run(), { tokens: 1 }, 'run', NOW), { ok: false, code: 'budget_exhausted', cap: 'minutes', used: 2, limit: 2 });
    w.db.exec(`UPDATE agent_budget_usage SET ms_used = 60000`);
    assert.deepEqual(await reserve(w.env, run(), { tokens: 1 }, 'run', NOW), { ok: true });

    caps(w, AGENT, { retries: 1 });
    assert.deepEqual(await reserve(w.env, run({ attempt: 2 }), { tokens: 1 }, 'run', NOW), { ok: true }, 'one retry of one allowed');
    assert.deepEqual(await reserve(w.env, run({ attempt: 3 }), { tokens: 1 }, 'run', NOW), { ok: false, code: 'budget_exhausted', cap: 'retries', used: 2, limit: 1 });
    w.db.exec('UPDATE scope_tasks SET budget_retries_cap = 0 WHERE id = 200');
    assert.deepEqual(await reserve(w.env, run({ attempt: 2 }), { tokens: 1 }, 'run', NOW), { ok: false, code: 'budget_exhausted', cap: 'task_retries', used: 1, limit: 0 },
      'the task\'s own cap wins over the agent\'s');

    w.db.exec('UPDATE scope_tasks SET budget_retries_cap = NULL, budget_tokens_cap = 500 WHERE id = 200');
    w.db.prepare(`INSERT INTO agent_budget_settlements (settle_key, agent_id, task_id, period_key, tokens, ms, applied) VALUES ('run:earlier-run-1:run', ?, 200, ?, 450, 0, 1)`).run(AGENT, month);
    assert.deepEqual(await reserve(w.env, run({ uid: 'run-budget-0002' }), { tokens: 100 }, 'run', NOW), { ok: false, code: 'budget_exhausted', cap: 'task_tokens', used: 450, limit: 500 });
    w.db.exec('UPDATE scope_tasks SET budget_tokens_cap = NULL, budget_minutes_cap = 1 WHERE id = 200');
    w.db.exec("UPDATE agent_budget_settlements SET ms = 60000 WHERE settle_key = 'run:earlier-run-1:run'");
    assert.equal((await reserve(w.env, run({ uid: 'run-budget-0002' }), { tokens: 1 }, 'run', NOW) as any).cap, 'task_minutes');
  } finally { w.close(); }
});

test('workspace ceilings: agents, live agents, AI spend and compute spend; NULL falls back to the platform figure, never above it', async () => {
  // Mutations checked: `own ?? platform` without Math.min → a workspace row above a lowered platform figure is let through;
  // the unrecorded-charge branch read as 0 → an unknown month is let in.
  const w = setup();
  try {
    const scope = { kind: 'project' as const, id: PROJECT };
    assert.deepEqual(await workspaceCaps(w.env, scope), { agents_cap: null, live_agents_cap: null, ai_spend_cap_cents: null, compute_spend_cap_cents: null });
    w.db.exec('UPDATE ai_agent_policy SET workspace_agents_cap = 3, workspace_ai_spend_cap_cents = 100 WHERE id = 1');
    assert.equal((await workspaceCaps(w.env, scope)).agents_cap, 3, 'no workspace row: the platform figure');
    w.db.exec(`INSERT INTO agent_scope_settings (scope_kind, project_id, agents_cap) VALUES ('project', ${PROJECT}, 1)`);
    assert.equal((await workspaceCaps(w.env, scope)).agents_cap, 1, 'the workspace\'s own, lower');
    w.db.exec('UPDATE agent_scope_settings SET agents_cap = 9');
    assert.equal((await workspaceCaps(w.env, scope)).agents_cap, 3, 'never above the platform figure');

    w.db.exec('UPDATE agent_scope_settings SET agents_cap = 0');
    assert.deepEqual(await reserve(w.env, run(), { tokens: 1 }, 'run', NOW), { ok: false, code: 'budget_exhausted', cap: 'workspace_agents', used: 1, limit: 0 });
    w.db.exec('UPDATE agent_scope_settings SET agents_cap = NULL, live_agents_cap = 0');
    assert.deepEqual(await reserve(w.env, run(), { tokens: 1 }, 'run', NOW), { ok: true }, 'no live run yet');
    w.db.prepare("INSERT INTO agent_task_runs (uid, agent_id, task_id, attempt, status) VALUES ('live-run-0001', ?, 200, 1, 'running')").run(AGENT);
    assert.equal((await reserve(w.env, run(), { tokens: 1 }, 'run', NOW) as any).cap, 'workspace_live_agents');
    w.db.exec('UPDATE agent_scope_settings SET live_agents_cap = NULL');

    // AI spend: 100 cents = 1,000,000 microusd, from the usage ledger.
    w.db.prepare("INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, agent_id, created_at) VALUES (?, 'rail_numbers', ?, 999999, ?, '2026-11-20 10:00:00')").run(SPONSOR, MODEL, AGENT);
    assert.deepEqual(await reserve(w.env, run(), { tokens: 1 }, 'run', NOW), { ok: true });
    w.db.prepare("INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, agent_id, created_at) VALUES (?, 'rail_numbers', ?, 1, ?, '2026-11-20 10:00:00')").run(SPONSOR, MODEL, AGENT);
    assert.deepEqual(await reserve(w.env, run(), { tokens: 1 }, 'run', NOW), { ok: false, code: 'budget_exhausted', cap: 'workspace_ai_spend', used: 100, limit: 100 });
    w.db.prepare("INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, agent_id, created_at) VALUES (?, 'rail_numbers', ?, NULL, ?, '2026-11-20 10:00:00')").run(SPONSOR, MODEL, AGENT);
    assert.deepEqual(await reserve(w.env, run(), { tokens: 1 }, 'run', NOW), { ok: false, code: 'budget_unreadable', cap: 'workspace_ai_spend' }, 'unknown is never zero');
    w.db.exec('UPDATE ai_agent_policy SET workspace_ai_spend_cap_cents = NULL WHERE id = 1');

    // Compute spend, priced by the rate card.
    assert.equal(computeMicrousd(1000, 4000), 30, '1000 cpu-ms × 0.02 + 4000 wall-ms × 0.0025');
    w.db.exec(`UPDATE agent_scope_settings SET compute_spend_cap_cents = 1`);
    w.db.prepare(`INSERT INTO agent_compute_jobs (uid, run_uid, agent_id, scope_kind, scope_id, workload, idempotency_key, status, cpu_ms, wall_ms, created_at)
      VALUES (?, 'live-run-0001', ?, 'project', ?, 'python', 'compute-key-0001', 'succeeded', 500000, 0, '2026-11-20 10:00:00')`).run(hex(1, 'f'), AGENT, PROJECT);
    assert.deepEqual(await reserve(w.env, run(), { tokens: 1 }, 'run', NOW), { ok: false, code: 'budget_exhausted', cap: 'workspace_compute_spend', used: 1, limit: 1 });
  } finally { w.close(); }
});

// ── Settle: once per step ───────────────────────────────────────────────────

test('settle adds the usage ledger\'s tokens and time once per step, however often it is called', async () => {
  // Mutation checked: the `applied = 0` guard dropped from the usage UPDATE → the second call doubles the month.
  const w = setup();
  try {
    const id = Number(w.db.prepare(`INSERT INTO ai_usage_logs (user_id, task, model, prompt_tokens, completion_tokens, latency_ms, charged_microusd, agent_id)
      VALUES (?, 'rail_numbers', ?, 300, 200, 1500, 10, ?)`).run(SPONSOR, MODEL, AGENT).lastInsertRowid);
    w.db.prepare(`INSERT INTO ai_usage_logs (user_id, task, model, prompt_tokens, completion_tokens, latency_ms, charged_microusd, agent_id, guard_for)
      VALUES (?, 'rail_guard', ?, 40, 10, 500, 1, ?, ?)`).run(SPONSOR, MODEL, AGENT, id);
    assert.deepEqual(await settle(w.env, run(), id, 'run', NOW), { tokens: 550, ms: 2000 }, 'the call and its guard rows');
    await settle(w.env, run(), id, 'run', NOW);
    await settle(w.env, run(), id, 'run', NOW);
    assert.deepEqual({ ...usage(w) }, { tokens_used: 550, ms_used: 2000, prs_opened: 0 });
    await settle(w.env, run({ uid: 'run-budget-0009' }), id, 'run', NOW);
    assert.equal(usage(w).tokens_used, 1100, 'another run is its own settlement');
    assert.deepEqual(await reserve(w.env, run(), { tokens: 10_000_000 }, 'run', NOW), { ok: true }, 'a settled step is let through on its replay');
  } finally { w.close(); }
});

test('PRs per day: reserved before a publish, counted once after, refused at the cap', async () => {
  // Mutation checked: `>=` turned `>` in reservePublish → a third PR is let in on a cap of two.
  const w = setup();
  try {
    caps(w, AGENT, { prs: 2 });
    assert.deepEqual(await reservePublish(w.env, AGENT, 'publish:task-1:1', NOW), { ok: true });
    await settlePublish(w.env, AGENT, 'publish:task-1:1', NOW);
    await settlePublish(w.env, AGENT, 'publish:task-1:1', NOW);
    assert.equal(usage(w, AGENT, '2026-11-22').prs_opened, 1, 'the same publication counts once');
    await settlePublish(w.env, AGENT, 'publish:task-2:1', NOW);
    assert.deepEqual(await reservePublish(w.env, AGENT, 'publish:task-3:1', NOW), { ok: false, code: 'budget_exhausted', cap: 'prs_per_day', used: 2, limit: 2 });
    assert.deepEqual(await reservePublish(w.env, AGENT, 'publish:task-2:1', NOW), { ok: true }, 'a publication already counted is answered again');
    caps(w, AGENT, { prs: 0 });
    assert.equal((await reservePublish(w.env, AGENT, 'publish:task-9:1', NOW) as any).code, 'budget_exhausted', 'zero PRs for this agent');
  } finally { w.close(); }
});

// ── The loop ────────────────────────────────────────────────────────────────

test('the loop: a run past its cap halts at the run step with budget_exhausted, calls no model, and the task is open again', async () => {
  // Mutation checked: the reserve call removed from runStep → the model is called and the run proposes.
  const w = setup();
  try {
    caps(w, AGENT, { tokens: 100 });
    const a = await admit(w);
    assert.equal(a.ok, true);
    const fake = fakeAgentRun(w);
    const h = harness();
    const out = await runTaskLoop(a.run.uid, h.step, { ...loopDeps(w, fake.fn), now: () => NOW });
    assert.deepEqual(out, { go: false, status: 'halted', refusal: 'budget_exhausted' });
    assert.equal(fake.state.calls, 0, 'no model call');
    const r = runRow(w, a.run.uid);
    assert.deepEqual([r.status, r.refusal], ['halted', 'budget_exhausted']);
    const last = JSON.parse(r.steps_json).at(-1);
    assert.equal(last.name, 'run');
    assert.match(last.summary, /^Halted: budget exhausted, the agent's tokens this month: 0 of 100\.$/);
    assert.equal((w.db.prepare('SELECT status FROM scope_tasks WHERE id = 200').get() as any).status, 'open');
  } finally { w.close(); }
});

test('the loop: a run within its cap settles its usage once, even when the run step is replayed', async () => {
  // Mutation checked: the settle call removed from runStep → the month stays at 0 after a proposal.
  const w = setup();
  try {
    caps(w, AGENT, { tokens: 1_000_000 });
    const a = await admit(w);
    const fake = fakeAgentRun(w);
    const id = Number(w.db.prepare(`INSERT INTO ai_usage_logs (user_id, task, model, prompt_tokens, completion_tokens, latency_ms, charged_microusd, agent_id)
      VALUES (?, 'rail_numbers', ?, 700, 300, 3000, 10, ?)`).run(SPONSOR, MODEL, AGENT).lastInsertRowid);
    const withLog: typeof fake.fn = async (env, input) => {
      const r = await fake.fn(env, input);
      return r.ok ? { ...r, usageLogId: id } : r;
    };
    const h = harness();
    h.opts.crashBeforeSave = 'run';
    await assert.rejects(runTaskLoop(a.run.uid, h.step, { ...loopDeps(w, withLog), now: () => NOW }), (e) => h.isCrash(e));
    const out = await runTaskLoop(a.run.uid, h.step, { ...loopDeps(w, withLog), now: () => NOW });
    assert.equal(out.go, false, 'waiting for a decision');
    assert.equal(runRow(w, a.run.uid).status, 'waiting_decision');
    assert.deepEqual({ ...usage(w) }, { tokens_used: 1000, ms_used: 3000, prs_opened: 0 }, 'settled once across the replay');
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM agent_budget_settlements').get() as any).n, 1);
  } finally { w.close(); }
});

test('the loop: a run step that already proposed is not halted on its replay, even at the cap', async () => {
  // Mutation checked: the proposal guard around reserve removed → the replay halts and strands the proposal.
  const w = setup();
  try {
    caps(w, AGENT, { tokens: 100 });
    used(w, AGENT, monthKey(NOW), 100);
    const a = await admit(w);
    // The model ran and its proposal was written before the step's settlement (the worker died in between).
    w.db.prepare(`INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, kind, payload_json, agent_id, task_id, run_key)
      VALUES (?, ?, 'Founder · Build', 'draft:build/plan', 'draft', '{"text":"a draft"}', ?, 200, ?)`).run(`prop-${a.run.uid}`, SPONSOR, AGENT, `agent:${a.run.uid}`);
    const out = await runTaskLoop(a.run.uid, harness().step, { ...loopDeps(w, fakeAgentRun(w).fn), now: () => NOW });
    assert.equal(out.go, false);
    assert.equal(runRow(w, a.run.uid).status, 'waiting_decision', 'the replay answers its proposal');
  } finally { w.close(); }
});

// ── Routes ──────────────────────────────────────────────────────────────────

function app(w: World) {
  w.db.exec(`INSERT OR IGNORE INTO super_admins (user_id) VALUES (${ADMIN})`);
  grantWriteBar(w.db, ADMIN);
  const a = new Hono<any>().route(POLICY, policyRoutes).route('/api/teams', teamRoutes);
  a.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return a;
}
async function call(w: World, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, ...(who === ADMIN ? { jti: `write-bar-${ADMIN}` } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const res = await app(w).request(path, { method, headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { text }; }
  return { status: res.status, body: parsed };
}
const audits = (w: World) => w.db.prepare("SELECT action, subject, before_json, after_json, reason FROM ai_admin_audit WHERE action LIKE 'policy.budget%' ORDER BY id").all() as any[];

test('routes: super admin only; each write is audited with before, after and reason; bad caps and a raise above the platform are refused', async () => {
  // Mutations checked: aboveCeiling skipped → the 9-agent workspace is saved past the platform's 3; the audit statement left
  // out of the batch → no row; requireSuperAdmin dropped from GET → a founder reads every agent's budget.
  const w = setup();
  try {
    const agentUid = hex(AGENT, 'b');
    for (const [method, path] of [['GET', `${POLICY}/budgets`], ['PUT', `${POLICY}/budgets/agents/${agentUid}`], ['PUT', `${POLICY}/budgets/platform`]] as const) {
      const r = await call(w, SPONSOR, method, path, method === 'PUT' ? { tokens_cap: 5, reason: 'x' } : undefined);
      assert.equal(r.status, 403, `${method} ${path} is HQ's`);
    }
    assert.equal(audits(w).length, 0);

    assert.equal((await call(w, ADMIN, 'PUT', `${POLICY}/budgets/agents/${agentUid}`, { tokens_cap: 5000 })).body.error ?? 'reason', 'reason_required');
    const bad = await call(w, ADMIN, 'PUT', `${POLICY}/budgets/agents/${agentUid}`, { tokens_cap: 0, reason: 'Pilot month' });
    assert.deepEqual([bad.status, bad.body.error], [400, 'invalid_cap']);
    assert.equal((await call(w, ADMIN, 'PUT', `${POLICY}/budgets/agents/${hex(999, 'b')}`, { tokens_cap: 5, reason: 'x' })).status, 404);

    const ok = await call(w, ADMIN, 'PUT', `${POLICY}/budgets/agents/${agentUid}`, { tokens_cap: 5000, prs_per_day_cap: 2, reason: 'Pilot month' });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.caps, { tokens: 5000, minutes: null, prs_per_day: 2, retries_per_task: null });
    const [row] = audits(w);
    assert.deepEqual([row.action, row.subject, row.reason], ['policy.budget_agent', `agent:${agentUid}`, 'Pilot month']);
    assert.deepEqual(JSON.parse(row.before_json), { tokens_cap: null, minutes_cap: null, prs_per_day_cap: null, retries_per_task_cap: null });
    assert.equal(JSON.parse(row.after_json).tokens_cap, 5000);
    const again = await call(w, ADMIN, 'PUT', `${POLICY}/budgets/agents/${agentUid}`, { minutes_cap: 60, reason: 'Add minutes' });
    assert.deepEqual(again.body.caps, { tokens: 5000, minutes: 60, prs_per_day: 2, retries_per_task: null }, 'a field not sent is kept');

    const plat = await call(w, ADMIN, 'PUT', `${POLICY}/budgets/platform`, { agents_cap: 3, reason: 'Platform figure' });
    assert.equal(plat.body.platform.agents_cap, 3);
    const above = await call(w, ADMIN, 'PUT', `${POLICY}/budgets/workspace`, { scope_kind: 'project', scope_id: PROJECT, agents_cap: 9, reason: 'More' });
    assert.deepEqual([above.status, above.body.error], [409, 'above_platform_ceiling']);
    assert.equal((await call(w, ADMIN, 'PUT', `${POLICY}/budgets/workspace`, { scope_kind: 'project', scope_id: 9999, agents_cap: 1, reason: 'x' })).status, 404);
    const ws = await call(w, ADMIN, 'PUT', `${POLICY}/budgets/workspace`, { scope_kind: 'project', scope_id: PROJECT, agents_cap: 2, ai_spend_cap_cents: 500, reason: 'Kestrel pilot' });
    assert.equal(ws.status, 200);
    assert.deepEqual({ ...(w.db.prepare('SELECT agents_cap, ai_spend_cap_cents FROM agent_scope_settings').get() as any) }, { agents_cap: 2, ai_spend_cap_cents: 500 });
    const cws = await call(w, ADMIN, 'PUT', `${POLICY}/budgets/workspace`, { scope_kind: 'company', scope_id: COMPANY, live_agents_cap: 1, reason: 'Acme' });
    assert.equal(cws.status, 200);

    const task = await call(w, ADMIN, 'PUT', `${POLICY}/budgets/tasks/${hex(200, 'c')}`, { retries_cap: 1, reason: 'Hard task' });
    assert.deepEqual(task.body.caps, { tokens: null, minutes: null, retries: 1 });
    assert.deepEqual(audits(w).map((a) => a.action),
      ['policy.budget_agent', 'policy.budget_agent', 'policy.budget_platform', 'policy.budget_workspace', 'policy.budget_workspace', 'policy.budget_task']);

    const view = await call(w, ADMIN, 'GET', `${POLICY}/budgets`);
    assert.equal(view.status, 200);
    assert.equal(view.body.platform.agents_cap, 3);
    assert.deepEqual(view.body.agents.map((a: any) => [a.agent_uid, a.caps.tokens, a.used.tokens]), [[agentUid, 5000, 0]]);
    assert.deepEqual(view.body.halted, []);
  } finally { w.close(); }
});

test('the sponsor reads their own agent\'s budget, read-only; another member does not', async () => {
  const w = setup();
  try {
    caps(w, AGENT, { tokens: 800 });
    const agentUid = hex(AGENT, 'b');
    const mine = await call(w, SPONSOR, 'GET', `/api/teams/agents/${agentUid}/budget`);
    assert.equal(mine.status, 200);
    assert.deepEqual([mine.body.budget.caps.tokens, mine.body.budget.used.tokens, mine.body.budget.period.kind], [800, 0, 'calendar_month_utc']);
    assert.deepEqual(mine.body.halted, []);
    const other = await call(w, MEMBER, 'GET', `/api/teams/agents/${agentUid}/budget`);
    assert.ok([403, 404].includes(other.status), `a member who is not the sponsor is refused (${other.status})`);
    assert.equal((await call(w, SPONSOR, 'PUT', `/api/teams/agents/${agentUid}/budget`, { tokens_cap: 1 })).status, 404, 'no write here');
  } finally { w.close(); }
});
