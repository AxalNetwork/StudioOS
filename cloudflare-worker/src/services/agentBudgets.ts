/**
 * D8071 (#8071) — execution budgets: an agent cannot spend past what HQ set for it, its task, or its workspace.
 *
 *   reserve(run, estimate)    before the `run` step's model call. Refuses `budget_exhausted` (naming the cap) when
 *                             the agent's tokens or minutes this month, the task's tokens, minutes or retries, or the
 *                             workspace's agents, live agents, AI spend or compute spend would pass a cap. A step
 *                             already settled is let through: its retry replays the same proposal and charges nothing.
 *   settle(run, step)         after a model call: the tokens and model time the usage ledger (`ai_usage_logs`, D1528 /
 *                             #7073) recorded for that call, added to the agent's month exactly once per step
 *                             (`agent_budget_settlements`, keyed `run:<uid>:<step>`). No second ledger of charges.
 *   reservePublish / settlePublish   the same, before and after an agent opens a pull request: PRs per UTC day.
 *
 * Periods: tokens and minutes are per calendar month, UTC ('YYYY-MM'); PRs per UTC day ('YYYY-MM-DD').
 * A NULL cap is no cap. A task's NULL cap is the agent's cap. A workspace's NULL ceiling is the platform
 * figure on `ai_agent_policy`; a NULL platform figure is no ceiling. A cap that is set but whose usage cannot be
 * read refuses `budget_unreadable`: a budget is never passed silently.
 *
 * Compute spend is priced by the rate card below (D8071). Bound SQL only; nothing here holds a prompt or an output.
 */
import type { Env } from '../types';
import { monthStart } from './agents/teams';

type DbEnv = Pick<Env, 'DB'>;

/** D8071's rate card, in micro-USD: a vCPU-millisecond and a wall-clock millisecond (1 GiB held) of a compute job. */
export const RATE_CARD = Object.freeze({ cpu_ms_microusd: 0.02, wall_ms_microusd: 0.0025 });
export const MICROUSD_PER_CENT = 10_000;

export const CAP_KINDS = ['tokens', 'minutes', 'retries', 'prs_per_day', 'task_tokens', 'task_minutes', 'task_retries',
  'workspace_agents', 'workspace_live_agents', 'workspace_ai_spend', 'workspace_compute_spend'] as const;
export type CapKind = (typeof CAP_KINDS)[number];

export type AgentCaps = { tokens_cap: number | null; minutes_cap: number | null; prs_per_day_cap: number | null; retries_per_task_cap: number | null };
export type WorkspaceCaps = { agents_cap: number | null; live_agents_cap: number | null; ai_spend_cap_cents: number | null; compute_spend_cap_cents: number | null };
export const NO_AGENT_CAPS: AgentCaps = { tokens_cap: null, minutes_cap: null, prs_per_day_cap: null, retries_per_task_cap: null };
export const NO_WORKSPACE_CAPS: WorkspaceCaps = { agents_cap: null, live_agents_cap: null, ai_spend_cap_cents: null, compute_spend_cap_cents: null };

export type Verdict =
  | { ok: true }
  | { ok: false; code: 'budget_exhausted'; cap: CapKind; used: number; limit: number }
  | { ok: false; code: 'budget_unreadable'; cap: CapKind | null };

/** The run as the budget needs it. */
export type BudgetRun = {
  uid: string; agent_id: number; task_id: number; attempt: number;
  scope_kind: 'company' | 'project'; company_id: number | null; project_id: number | null;
};
export type Estimate = { tokens: number; minutes?: number };

export const monthKey = (now = new Date()) => now.toISOString().slice(0, 7);
export const dayKey = (now = new Date()) => now.toISOString().slice(0, 10);
export const settleKey = (runUid: string, step: string) => `run:${runUid}:${step}`;
export const publishKey = (idempotencyKey: string) => `publish:${idempotencyKey}`;

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
/** `used + estimate` passes `limit`, or the limit is already reached. */
const over = (used: number, estimate: number, limit: number) => used >= limit || used + estimate > limit;
const exhausted = (cap: CapKind, used: number, limit: number): Verdict => ({ ok: false, code: 'budget_exhausted', cap, used, limit });

/** The microusd a compute job's resources cost on the rate card. */
export const computeMicrousd = (cpuMs: number, wallMs: number) =>
  Math.ceil(cpuMs * RATE_CARD.cpu_ms_microusd + wallMs * RATE_CARD.wall_ms_microusd);

// ── Reads ───────────────────────────────────────────────────────────────────

export async function agentCaps(env: DbEnv, agentId: number): Promise<AgentCaps & { set_by: number | null; set_at: string | null }> {
  const r = await env.DB.prepare('SELECT tokens_cap, minutes_cap, prs_per_day_cap, retries_per_task_cap, set_by, set_at FROM agent_budgets WHERE agent_id = ?')
    .bind(agentId).first<Record<string, unknown>>();
  return {
    tokens_cap: num(r?.tokens_cap), minutes_cap: num(r?.minutes_cap), prs_per_day_cap: num(r?.prs_per_day_cap),
    retries_per_task_cap: num(r?.retries_per_task_cap), set_by: num(r?.set_by), set_at: (r?.set_at as string | undefined) ?? null,
  };
}

export async function usageOf(env: DbEnv, agentId: number, periodKey: string): Promise<{ tokens: number; ms: number; prs: number }> {
  const r = await env.DB.prepare('SELECT tokens_used, ms_used, prs_opened FROM agent_budget_usage WHERE agent_id = ? AND period_key = ?')
    .bind(agentId, periodKey).first<{ tokens_used: number; ms_used: number; prs_opened: number }>();
  return { tokens: Number(r?.tokens_used ?? 0), ms: Number(r?.ms_used ?? 0), prs: Number(r?.prs_opened ?? 0) };
}

/** The platform's workspace figures (NULL = no ceiling). */
export async function platformWorkspaceCaps(env: DbEnv): Promise<WorkspaceCaps> {
  const r = await env.DB.prepare(
    `SELECT workspace_agents_cap, workspace_live_agents_cap, workspace_ai_spend_cap_cents, workspace_compute_spend_cap_cents
       FROM ai_agent_policy WHERE id = 1`,
  ).first<Record<string, unknown>>();
  return {
    agents_cap: num(r?.workspace_agents_cap), live_agents_cap: num(r?.workspace_live_agents_cap),
    ai_spend_cap_cents: num(r?.workspace_ai_spend_cap_cents), compute_spend_cap_cents: num(r?.workspace_compute_spend_cap_cents),
  };
}

type ScopeKey = { kind: 'company' | 'project'; id: number };
const scopeKeyOf = (r: { scope_kind: 'company' | 'project'; company_id: number | null; project_id: number | null }): ScopeKey =>
  r.scope_kind === 'company' ? { kind: 'company', id: Number(r.company_id) } : { kind: 'project', id: Number(r.project_id) };
const scopeBinds = (s: ScopeKey): [string, number, number] => [s.kind, s.kind === 'company' ? s.id : 0, s.kind === 'project' ? s.id : 0];

/** The workspace's own ceilings (NULL each) as stored. */
export async function workspaceOwnCaps(env: DbEnv, s: ScopeKey): Promise<WorkspaceCaps> {
  const r = await env.DB.prepare(
    `SELECT agents_cap, live_agents_cap, ai_spend_cap_cents, compute_spend_cap_cents FROM agent_scope_settings
      WHERE scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ?`,
  ).bind(...scopeBinds(s)).first<Record<string, unknown>>();
  return {
    agents_cap: num(r?.agents_cap), live_agents_cap: num(r?.live_agents_cap),
    ai_spend_cap_cents: num(r?.ai_spend_cap_cents), compute_spend_cap_cents: num(r?.compute_spend_cap_cents),
  };
}

/** The ceilings in force: the workspace's own, else the platform's; never above the platform's when both are set. */
export async function workspaceCaps(env: DbEnv, s: ScopeKey): Promise<WorkspaceCaps> {
  const [own, platform] = await Promise.all([workspaceOwnCaps(env, s), platformWorkspaceCaps(env)]);
  const pick = (a: number | null, p: number | null) => (a == null ? p : p == null ? a : Math.min(a, p));
  return {
    agents_cap: pick(own.agents_cap, platform.agents_cap),
    live_agents_cap: pick(own.live_agents_cap, platform.live_agents_cap),
    ai_spend_cap_cents: pick(own.ai_spend_cap_cents, platform.ai_spend_cap_cents),
    compute_spend_cap_cents: pick(own.compute_spend_cap_cents, platform.compute_spend_cap_cents),
  };
}

/** The workspace's usage against its ceilings this month. Spend is null when a charge is unrecorded. */
export async function workspaceUsage(env: DbEnv, s: ScopeKey, now = new Date()) {
  const b = scopeBinds(s);
  const since = monthStart(now);
  const [agents, live, ai, compute] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM team_agents WHERE scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ? AND status <> 'removed'`)
      .bind(...b).first<{ n: number }>(),
    env.DB.prepare(`SELECT COUNT(DISTINCT agent_id) AS n FROM agent_task_runs WHERE status IN ('admitted', 'running') AND agent_id IN (SELECT id FROM team_agents WHERE scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ?)`)
      .bind(...b).first<{ n: number }>(),
    env.DB.prepare(
      `SELECT SUM(charged_microusd) AS charged, SUM(CASE WHEN charged_microusd IS NULL THEN 1 ELSE 0 END) AS unrecorded
         FROM ai_usage_logs WHERE datetime(created_at) >= datetime(?) AND agent_id IN (SELECT id FROM team_agents WHERE scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ?)`,
    ).bind(since, ...b).first<{ charged: number | null; unrecorded: number | null }>(),
    // A job still running has no figures yet and costs nothing until it ends.
    env.DB.prepare(
      `SELECT SUM(IFNULL(cpu_ms, 0)) AS cpu, SUM(IFNULL(wall_ms, 0)) AS wall FROM agent_compute_jobs
        WHERE scope_kind = ? AND scope_id = ? AND datetime(created_at) >= datetime(?)`,
    ).bind(s.kind, s.id, since).first<{ cpu: number | null; wall: number | null }>(),
  ]);
  return {
    agents: Number(agents?.n ?? 0),
    live_agents: Number(live?.n ?? 0),
    ai_spend_microusd: ai && Number(ai.unrecorded) > 0 ? null : Number(ai?.charged ?? 0),
    compute_spend_microusd: computeMicrousd(Number(compute?.cpu ?? 0), Number(compute?.wall ?? 0)),
  };
}

/**
 * D8081 (#8081): the tokens a task's tree holds. Its own settled tokens, plus each child it handed off
 * (an accepted `agent_handoffs` step whose `from_task_id` is this task): while the child's task is open
 * it holds its share (its `budget_tokens_cap`) or what its own tree used if that is more; once the
 * child's task is done or cancelled it holds only what it used, so the unused share returns to the parent.
 * Derived from settled rows, never written, so a retried step or a second settle cannot count twice.
 */
export async function taskTreeTokens(env: DbEnv, taskId: number, depth = 0): Promise<number> {
  const own = await env.DB.prepare('SELECT SUM(tokens) AS tokens FROM agent_budget_settlements WHERE task_id = ?').bind(taskId).first<{ tokens: number | null }>();
  return Number(own?.tokens ?? 0) + await childHoldTokens(env, taskId, depth);
}

/** D8081: what this task's children hold against it (see `taskTreeTokens`). A chain is at most 3 deep. */
export async function childHoldTokens(env: DbEnv, taskId: number, depth = 0): Promise<number> {
  if (depth >= 4) return 0;
  const children = (await env.DB.prepare(
    `SELECT t.id, t.status, t.budget_tokens_cap FROM agent_handoffs h JOIN scope_tasks t ON t.id = h.created_task_id
      WHERE h.from_task_id = ? AND h.status = 'accepted' AND h.created_task_id IS NOT NULL`,
  ).bind(taskId).all<{ id: number; status: string; budget_tokens_cap: number | null }>()).results ?? [];
  let held = 0;
  for (const c of children) {
    const used = await taskTreeTokens(env, c.id, depth + 1);
    const open = c.status !== 'done' && c.status !== 'cancelled';
    held += open ? Math.max(Number(c.budget_tokens_cap ?? 0), used) : used;
  }
  return held;
}

/** The task's caps (NULL = the agent's) and what its runs have settled, with its children's holds (D8081). */
async function taskBudget(env: DbEnv, taskId: number) {
  const [t, used, tokens] = await Promise.all([
    env.DB.prepare('SELECT budget_tokens_cap, budget_minutes_cap, budget_retries_cap FROM scope_tasks WHERE id = ?').bind(taskId).first<Record<string, unknown>>(),
    env.DB.prepare('SELECT SUM(ms) AS ms FROM agent_budget_settlements WHERE task_id = ?').bind(taskId).first<{ ms: number | null }>(),
    taskTreeTokens(env, taskId),
  ]);
  return {
    tokens_cap: num(t?.budget_tokens_cap), minutes_cap: num(t?.budget_minutes_cap), retries_cap: num(t?.budget_retries_cap),
    tokens, ms: Number(used?.ms ?? 0),
  };
}

// ── Reserve and settle ──────────────────────────────────────────────────────

async function settled(env: DbEnv, key: string): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 AS ok FROM agent_budget_settlements WHERE settle_key = ?').bind(key).first());
}

/** Before a model call: may this run spend `estimate`? */
export async function reserve(env: DbEnv, run: BudgetRun, estimate: Estimate, step = 'run', now = new Date()): Promise<Verdict> {
  let stage: CapKind | null = null;
  try {
    if (await settled(env, settleKey(run.uid, step))) return { ok: true };
    const [caps, month, task] = await Promise.all([agentCaps(env, run.agent_id), usageOf(env, run.agent_id, monthKey(now)), taskBudget(env, run.task_id)]);
    const minutes = estimate.minutes ?? 0;
    const retries = Math.max(0, Number(run.attempt) - 1);
    stage = 'retries';
    const retryCap = task.retries_cap ?? caps.retries_per_task_cap;
    if (retryCap != null && retries > retryCap) return exhausted(task.retries_cap != null ? 'task_retries' : 'retries', retries, retryCap);
    stage = 'tokens';
    if (caps.tokens_cap != null && over(month.tokens, estimate.tokens, caps.tokens_cap)) return exhausted('tokens', month.tokens, caps.tokens_cap);
    stage = 'minutes';
    if (caps.minutes_cap != null && over(month.ms / 60_000, minutes, caps.minutes_cap)) return exhausted('minutes', Math.ceil(month.ms / 60_000), caps.minutes_cap);
    stage = 'task_tokens';
    if (task.tokens_cap != null && over(task.tokens, estimate.tokens, task.tokens_cap)) return exhausted('task_tokens', task.tokens, task.tokens_cap);
    stage = 'task_minutes';
    if (task.minutes_cap != null && over(task.ms / 60_000, minutes, task.minutes_cap)) return exhausted('task_minutes', Math.ceil(task.ms / 60_000), task.minutes_cap);
    stage = null;
    const scope = scopeKeyOf(run);
    const ws = await workspaceCaps(env, scope);
    if (ws.agents_cap == null && ws.live_agents_cap == null && ws.ai_spend_cap_cents == null && ws.compute_spend_cap_cents == null) return { ok: true };
    const used = await workspaceUsage(env, scope, now);
    // The run being reserved is itself live, so it counts toward the live agents.
    if (ws.agents_cap != null && used.agents > ws.agents_cap) return exhausted('workspace_agents', used.agents, ws.agents_cap);
    if (ws.live_agents_cap != null && used.live_agents > ws.live_agents_cap) return exhausted('workspace_live_agents', used.live_agents, ws.live_agents_cap);
    if (ws.ai_spend_cap_cents != null) {
      if (used.ai_spend_microusd == null) return { ok: false, code: 'budget_unreadable', cap: 'workspace_ai_spend' };
      const cap = ws.ai_spend_cap_cents * MICROUSD_PER_CENT;
      if (used.ai_spend_microusd >= cap) return exhausted('workspace_ai_spend', Math.ceil(used.ai_spend_microusd / MICROUSD_PER_CENT), ws.ai_spend_cap_cents);
    }
    if (ws.compute_spend_cap_cents != null) {
      const cap = ws.compute_spend_cap_cents * MICROUSD_PER_CENT;
      if (used.compute_spend_microusd >= cap) return exhausted('workspace_compute_spend', Math.ceil(used.compute_spend_microusd / MICROUSD_PER_CENT), ws.compute_spend_cap_cents);
    }
    return { ok: true };
  } catch {
    return { ok: false, code: 'budget_unreadable', cap: stage };
  }
}

/** One settlement and its usage, applied once: the row is claimed, the usage added only while it is unapplied, then marked. */
function applyStatements(env: DbEnv, o: { key: string; agentId: number; taskId: number | null; periodKey: string; tokens: number; ms: number; prs: 0 | 1 }) {
  return [
    env.DB.prepare(`INSERT OR IGNORE INTO agent_budget_settlements (settle_key, agent_id, task_id, period_key, tokens, ms, prs) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(o.key, o.agentId, o.taskId, o.periodKey, o.tokens, o.ms, o.prs),
    env.DB.prepare('INSERT OR IGNORE INTO agent_budget_usage (agent_id, period_key) VALUES (?, ?)').bind(o.agentId, o.periodKey),
    env.DB.prepare(
      `UPDATE agent_budget_usage SET tokens_used = tokens_used + s.tokens, ms_used = ms_used + s.ms, prs_opened = prs_opened + s.prs,
              updated_at = CURRENT_TIMESTAMP
         FROM (SELECT tokens, ms, prs FROM agent_budget_settlements WHERE settle_key = ? AND applied = 0) AS s
        WHERE agent_budget_usage.agent_id = ? AND agent_budget_usage.period_key = ?`,
    ).bind(o.key, o.agentId, o.periodKey),
    env.DB.prepare('UPDATE agent_budget_settlements SET applied = 1 WHERE settle_key = ?').bind(o.key),
  ];
}

/** After a model call: the call's tokens and model time from the usage ledger, settled once for (run, step). */
export async function settle(env: DbEnv, run: BudgetRun, usageLogId: number | null, step = 'run', now = new Date()): Promise<{ tokens: number; ms: number }> {
  const row = usageLogId
    ? await env.DB.prepare(
      `SELECT SUM(prompt_tokens + completion_tokens) AS tokens, SUM(latency_ms) AS ms FROM ai_usage_logs WHERE id = ? OR guard_for = ?`,
    ).bind(usageLogId, usageLogId).first<{ tokens: number | null; ms: number | null }>()
    : null;
  const tokens = Math.max(0, Math.round(Number(row?.tokens ?? 0)));
  const ms = Math.max(0, Math.round(Number(row?.ms ?? 0)));
  await env.DB.batch(applyStatements(env, { key: settleKey(run.uid, step), agentId: run.agent_id, taskId: run.task_id, periodKey: monthKey(now), tokens, ms, prs: 0 }));
  return { tokens, ms };
}

/** Before an agent opens a pull request: its PRs today against its daily cap. A publication already counted passes. */
export async function reservePublish(env: DbEnv, agentId: number, idempotencyKey: string, now = new Date()): Promise<Verdict> {
  try {
    if (await settled(env, publishKey(idempotencyKey))) return { ok: true };
    const caps = await agentCaps(env, agentId);
    if (caps.prs_per_day_cap == null) return { ok: true };
    const today = await usageOf(env, agentId, dayKey(now));
    return today.prs >= caps.prs_per_day_cap ? exhausted('prs_per_day', today.prs, caps.prs_per_day_cap) : { ok: true };
  } catch {
    return { ok: false, code: 'budget_unreadable', cap: 'prs_per_day' };
  }
}

/** After the pull request is open: one PR on today's count, once per publication. */
export async function settlePublish(env: DbEnv, agentId: number, idempotencyKey: string, now = new Date()): Promise<void> {
  await env.DB.batch(applyStatements(env, { key: publishKey(idempotencyKey), agentId, taskId: null, periodKey: dayKey(now), tokens: 0, ms: 0, prs: 1 }));
}

/** The line a halted run's timeline shows: which cap, used and limit. Never a prompt or a name. */
const CAP_WORDS: Record<CapKind, string> = {
  tokens: "the agent's tokens this month", minutes: "the agent's minutes this month", retries: "the agent's retries on one task",
  prs_per_day: "the agent's PRs today", task_tokens: "this task's tokens", task_minutes: "this task's minutes", task_retries: "this task's retries",
  workspace_agents: "the workspace's agents", workspace_live_agents: "the workspace's live agents",
  workspace_ai_spend: "the workspace's AI spend this month (cents)", workspace_compute_spend: "the workspace's compute spend this month (cents)",
};
export function verdictSummary(v: Exclude<Verdict, { ok: true }>): string {
  if (v.code === 'budget_unreadable') return `Halted: the budget${v.cap ? ` for ${CAP_WORDS[v.cap]}` : ''} could not be read.`;
  return `Halted: budget exhausted, ${CAP_WORDS[v.cap]}: ${v.used} of ${v.limit}.`;
}

// ── Writes (validated here, written by the routes with their audit row) ──────

type Problem = { code: string; message: string; status?: number };
type Parsed<T> = { ok: true; value: T } | { ok: false; problem: Problem };

const capField = (b: Record<string, unknown>, k: string, cur: number | null, min: number, max: number): number | null | undefined => {
  if (!(k in b)) return cur;
  const v = b[k];
  if (v === null) return null;
  return Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : undefined;
};

export function agentCapsOf(b: Record<string, unknown>, cur: AgentCaps): Parsed<AgentCaps> {
  const out: AgentCaps = {
    tokens_cap: capField(b, 'tokens_cap', cur.tokens_cap, 1, 10_000_000_000) as number | null,
    minutes_cap: capField(b, 'minutes_cap', cur.minutes_cap, 1, 1_000_000) as number | null,
    prs_per_day_cap: capField(b, 'prs_per_day_cap', cur.prs_per_day_cap, 0, 1000) as number | null,
    retries_per_task_cap: capField(b, 'retries_per_task_cap', cur.retries_per_task_cap, 0, 100) as number | null,
  };
  const bad = (Object.keys(out) as (keyof AgentCaps)[]).find((k) => out[k] === undefined);
  return bad ? { ok: false, problem: { code: 'invalid_cap', message: `${bad} is a whole number in range, or null for no cap.` } } : { ok: true, value: out };
}

export type TaskCaps = { budget_tokens_cap: number | null; budget_minutes_cap: number | null; budget_retries_cap: number | null };
export function taskCapsOf(b: Record<string, unknown>, cur: TaskCaps): Parsed<TaskCaps> {
  const out: TaskCaps = {
    budget_tokens_cap: capField(b, 'tokens_cap', cur.budget_tokens_cap, 1, 10_000_000_000) as number | null,
    budget_minutes_cap: capField(b, 'minutes_cap', cur.budget_minutes_cap, 1, 1_000_000) as number | null,
    budget_retries_cap: capField(b, 'retries_cap', cur.budget_retries_cap, 0, 100) as number | null,
  };
  const bad = (Object.keys(out) as (keyof TaskCaps)[]).find((k) => out[k] === undefined);
  return bad ? { ok: false, problem: { code: 'invalid_cap', message: 'Each task cap is a whole number in range, or null for the agent\'s cap.' } } : { ok: true, value: out };
}

const WS_KEYS = ['agents_cap', 'live_agents_cap', 'ai_spend_cap_cents', 'compute_spend_cap_cents'] as const;
const WS_MAX: Record<(typeof WS_KEYS)[number], number> = { agents_cap: 10_000, live_agents_cap: 10_000, ai_spend_cap_cents: 100_000_000, compute_spend_cap_cents: 100_000_000 };

export function workspaceCapsOf(b: Record<string, unknown>, cur: WorkspaceCaps): Parsed<WorkspaceCaps> {
  const out = { ...cur };
  for (const k of WS_KEYS) {
    const v = capField(b, k, cur[k], 0, WS_MAX[k]);
    if (v === undefined) return { ok: false, problem: { code: 'invalid_cap', message: `${k} is a whole number in range, or null.` } };
    out[k] = v;
  }
  return { ok: true, value: out };
}

/** Owner default (D4137-p3): nobody raises a workspace above the platform figure here; the figure is edited on Policies. */
export function aboveCeiling(ws: WorkspaceCaps, platform: WorkspaceCaps): (typeof WS_KEYS)[number] | null {
  return WS_KEYS.find((k) => ws[k] != null && platform[k] != null && (ws[k] as number) > (platform[k] as number)) ?? null;
}

/** The name of the admin who set an agent's caps (D9111), or null when none is recorded or the account has no name. */
async function setterName(env: DbEnv, userId: number | null): Promise<string | null> {
  if (userId == null) return null;
  const u = await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(userId).first<{ name: string | null }>();
  return u?.name ? String(u.name) : null;
}

/** An agent's budget as a page shows it: caps, used this period, the period, and who set the caps and when (D9111). */
export async function agentBudgetView(env: DbEnv, agentId: number, now = new Date()) {
  const [caps, month, day] = await Promise.all([agentCaps(env, agentId), usageOf(env, agentId, monthKey(now)), usageOf(env, agentId, dayKey(now))]);
  const setBy = await setterName(env, caps.set_by);
  return {
    period: { month: monthKey(now), day: dayKey(now), kind: 'calendar_month_utc' as const },
    caps: { tokens: caps.tokens_cap, minutes: caps.minutes_cap, prs_per_day: caps.prs_per_day_cap, retries_per_task: caps.retries_per_task_cap },
    used: { tokens: month.tokens, minutes: Math.round((month.ms / 60_000) * 100) / 100, prs_today: day.prs },
    set_at: caps.set_at,
    set_by: setBy,
  };
}

/** The runs this agent had halted for budget, newest first. */
export async function haltedRuns(env: DbEnv, agentId: number | null, limit = 50) {
  const rows = await env.DB.prepare(
    `SELECT r.uid AS run_uid, r.agent_id, a.uid AS agent_uid, t.uid AS task_uid, r.refusal, r.ended_at
       FROM agent_task_runs r JOIN team_agents a ON a.id = r.agent_id JOIN scope_tasks t ON t.id = r.task_id
      WHERE r.refusal IN ('budget_exhausted', 'budget_unreadable') AND (? IS NULL OR r.agent_id = ?)
      ORDER BY r.id DESC LIMIT ?`,
  ).bind(agentId, agentId, limit).all<{ run_uid: string; agent_id: number; agent_uid: string; task_uid: string; refusal: string; ended_at: string | null }>();
  return (rows.results ?? []).map(({ agent_id: _id, ...rest }) => rest);
}
