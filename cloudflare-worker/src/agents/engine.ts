/**
 * D1528 (#3847, E3 of #3742) — the agent engine's rows in D1 (migration 728):
 * a scope's settings, admission, a run's record and its timeline, pauses and
 * who hears of them. D1 is the record; the `AgentScope` object is the single
 * writer that serialises admission per scope and keeps the live view.
 *
 * ADMISSION, in order, each refusing in its own code:
 *   engine off, paused, halted, or canary with no admin starting  403 engine_paused
 *   the scope paused (`agent_scope_settings.engine_paused`)       403 scope_paused
 *   the agent not active in this scope                            409 agent_not_live
 *   the task not this agent's, not ready, or with no option       409 not_ready
 *   the agent already has a live run (single flight)              409 agent_busy
 *   the scope already runs `max_parallel_runs`                     409 scope_busy
 *   the scope already has 5 proposals waiting                     409 queue_full
 * The insert itself is the last check: the single-flight index refuses a
 * second live run of one agent even if two objects raced (409 agent_busy).
 *
 * Bound SQL only. Codes in logs, never a prompt, an output or a name. A cost
 * that cannot be read is `{ available: false }`, never 0.
 */
import type { Env } from '../types';
import { notify } from '../services/notify';
import { chargedFor } from '../services/agents/agentRun';
import { depsOf, isReady, taskEvent, type TaskRow } from '../services/agents/tasks';
import { logEvent, type AgentRow, type Spend } from '../services/agents/teams';
import {
  DAILY_LIMIT, OPEN_PROPOSALS_MAX, engineMode, haltedAll, scopeName,
  type Admission, type Refusal, type ScopeRef, type Trigger,
} from './runtime';

export const RUN_STEPS = ['load', 'context', 'run', 'propose', 'wait', 'after'] as const;
export type RunStep = (typeof RUN_STEPS)[number];
export const LIVE_STATUSES = ['admitted', 'running'] as const;
/** Statuses in which a Workflow instance may still exist and wait. */
export const OPEN_STATUSES = ['admitted', 'running', 'waiting_decision'] as const;
/** The reasons a run ends without a proposal that do not count toward the daily limit. */
const UNCOUNTED = ['refused', 'cancelled', 'halted', 'scope_moved'] as const;

/** #3727's `paused_reason` vocabulary with D1528's four added. 712 holds no CHECK, so none needs a migration. */
export const PAUSE_REASONS = ['cap', 'sponsor_left', 'tool_disconnected', 'spend_limit', 'ai_paused', 'daily_limit', 'scope_archived'] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

export type RunRow = {
  id: number; uid: string; agent_id: number; task_id: number; attempt: number; status: string; step: RunStep | null;
  steps_json: string; workflow_instance_id: string | null; admitted_company_id: number | null; usage_log_id: number | null;
  proposal_uid: string | null; refusal: string | null; created_at: string; started_at: string | null; ended_at: string | null; updated_at: string;
};
export type StepEntry = { name: RunStep; status: 'done' | 'refused' | 'failed' | 'waiting' | 'halted'; at: string; summary: string };

const no = (status: number, code: string, message: string): Refusal => ({ ok: false, status, code, message });
const sqlNow = (d = new Date()) => d.toISOString().slice(0, 19).replace('T', ' ');
export const dayStart = (d = new Date()) => `${d.toISOString().slice(0, 10)} 00:00:00`;

export const scopeOfRow = (r: { scope_kind: 'company' | 'project'; company_id: number | null; project_id: number | null }): ScopeRef =>
  r.scope_kind === 'company' ? { kind: 'company', id: Number(r.company_id) } : { kind: 'project', id: Number(r.project_id) };

/** `scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ?`, as binds. */
const scopeBinds = (s: ScopeRef): [string, number, number] => [s.kind, s.kind === 'company' ? s.id : 0, s.kind === 'project' ? s.id : 0];

// ── Settings ────────────────────────────────────────────────────────────────

export type ScopeSettings = { engine_paused: boolean; max_parallel_runs: number };

/** A missing row is the defaults: not paused, 2 at once. */
export async function scopeSettings(env: Env, s: ScopeRef): Promise<ScopeSettings> {
  const row = await env.DB.prepare(
    `SELECT engine_paused, max_parallel_runs FROM agent_scope_settings
      WHERE scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ?`,
  ).bind(...scopeBinds(s)).first<{ engine_paused: number; max_parallel_runs: number }>();
  return { engine_paused: !!row?.engine_paused, max_parallel_runs: row ? Number(row.max_parallel_runs) : 2 };
}

export async function putScopeSettings(env: Env, s: ScopeRef, w: { paused?: boolean; max_parallel_runs?: number }, by: number | null): Promise<ScopeSettings> {
  const cur = await scopeSettings(env, s);
  const paused = w.paused ?? cur.engine_paused;
  const max = w.max_parallel_runs ?? cur.max_parallel_runs;
  const [kind, companyId, projectId] = scopeBinds(s);
  const upd = await env.DB.prepare(
    `UPDATE agent_scope_settings SET engine_paused = ?, max_parallel_runs = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ?`,
  ).bind(paused ? 1 : 0, max, by, kind, companyId, projectId).run();
  if (!upd.meta?.changes) {
    await env.DB.prepare(
      `INSERT INTO agent_scope_settings (scope_kind, company_id, project_id, engine_paused, max_parallel_runs, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(kind, companyId || null, projectId || null, paused ? 1 : 0, max, by).run();
  }
  return scopeSettings(env, s);
}

// ── Admission ───────────────────────────────────────────────────────────────

/** Runs of this scope's agents in these statuses. */
async function countInScope(env: Env, s: ScopeRef, statuses: readonly string[]): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM agent_task_runs r JOIN team_agents a ON a.id = r.agent_id
      WHERE a.scope_kind = ? AND IFNULL(a.company_id, 0) = ? AND IFNULL(a.project_id, 0) = ?
        AND r.status IN (SELECT value FROM json_each(?))`,
  ).bind(...scopeBinds(s), JSON.stringify(statuses)).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

const inScope = (a: AgentRow, s: ScopeRef) =>
  a.scope_kind === s.kind && (s.kind === 'company' ? a.company_id === s.id : a.project_id === s.id);

/** The engine and the halt, as admission reads them. */
export async function engineRefusal(env: Env, by: number | null): Promise<Refusal | null> {
  const mode = await engineMode(env);
  const paused = no(403, 'engine_paused', 'Agents are paused on the platform. You can still run them yourself.');
  if (mode === 'off' || mode === 'paused' || await haltedAll(env)) return paused;
  if (mode === 'canary') {
    // Canary: only a platform admin's own start is admitted; the sweep and `after` admit nothing.
    const admin = by ? await env.DB.prepare("SELECT 1 AS ok FROM users WHERE id = ? AND role = 'admin' AND is_active = 1").bind(by).first<{ ok: number }>() : null;
    if (!admin) return paused;
  }
  return null;
}

/**
 * Admit one run: every check above, then the row. Called only by the scope's
 * object, which runs one admission at a time, so the counts cannot race
 * within a scope; the single-flight index covers anything else.
 */
export async function admitInScope(env: Env, s: ScopeRef, t: Trigger): Promise<Admission> {
  const engine = await engineRefusal(env, t.by);
  if (engine) return engine;
  const settings = await scopeSettings(env, s);
  if (settings.engine_paused) return no(403, 'scope_paused', 'Agents are paused on this team. An editor can resume them.');
  const a = await env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(t.agentId).first<AgentRow>();
  if (!a || !inScope(a, s) || a.status === 'removed') return no(409, 'agent_not_live', 'That agent is not working on this team right now.');
  if (a.status !== 'active') return no(409, 'agent_not_live', 'That agent is paused. Resume it first.');
  const task = await env.DB.prepare('SELECT * FROM scope_tasks WHERE id = ?').bind(t.taskId).first<TaskRow & { board_column?: string | null }>();
  const deps = task ? (await depsOf(env, [task.id])).get(task.id) ?? [] : [];
  if (!task || task.assignee_kind !== 'agent' || task.assignee_agent_id !== a.id || !isReady(task, deps) || !task.module || !task.option) {
    return no(409, 'not_ready', 'That task is not ready for this agent: it must be open, assigned to it, with nothing left to wait on.');
  }
  const live = await env.DB.prepare("SELECT 1 AS ok FROM agent_task_runs WHERE agent_id = ? AND status IN ('admitted', 'running')").bind(a.id).first<{ ok: number }>();
  if (live) return no(409, 'agent_busy', 'This agent is already working on a task.');
  if (await countInScope(env, s, LIVE_STATUSES) >= settings.max_parallel_runs) {
    return no(409, 'scope_busy', `This team runs at most ${settings.max_parallel_runs} agents at once. Try again when one finishes.`);
  }
  if (await countInScope(env, s, ['waiting_decision']) >= OPEN_PROPOSALS_MAX) {
    return no(409, 'queue_full', `${OPEN_PROPOSALS_MAX} proposals are waiting for a decision. Decide one first.`);
  }
  let admittedCompany: number | null = null;
  if (s.kind === 'project') {
    const p = await env.DB.prepare('SELECT company_id FROM projects WHERE id = ?').bind(s.id).first<{ company_id: number | null }>();
    admittedCompany = p?.company_id ?? null;
  }
  const attempt = Number((await env.DB.prepare('SELECT MAX(attempt) AS n FROM agent_task_runs WHERE task_id = ?').bind(task.id).first<{ n: number | null }>())?.n ?? 0) + 1;
  const uid = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO agent_task_runs (uid, agent_id, task_id, attempt, status, workflow_instance_id, admitted_company_id)
       VALUES (?, ?, ?, ?, 'admitted', ?, ?)`,
    ).bind(uid, a.id, task.id, attempt, uid, admittedCompany).run();
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error)?.message))) return no(409, 'agent_busy', 'This agent is already working on a task.');
    throw e;
  }
  if (await moveTask(env, task.id, 'in_progress', ['open'])) await taskEvent(env, task.id, t.by, 'status', { from: 'open', to: 'in_progress', run: 'admitted' });
  return { ok: true, run: { uid, attempt } };
}

// ── A task's status ─────────────────────────────────────────────────────────

/** D1614's board column for each status a run moves a task to (migration 762's CHECK). */
const BOARD_FOR = { open: 'ready', in_progress: 'in_progress', waiting_decision: 'in_review', done: 'done', blocked: 'backlog' } as const;
export type TaskMove = keyof typeof BOARD_FOR;

/**
 * Move a task from one of `from` to `to`, keeping a project board's column in
 * step (a task with no column keeps none). Conditional on `from`, so a retried
 * step moves nothing twice. Returns whether it moved.
 */
export async function moveTask(env: Env, taskId: number, to: TaskMove, from: readonly string[],
  o: { blockedReason?: string | null; attemptsPlus?: boolean; attemptsWere?: number } = {}): Promise<boolean> {
  const r = await env.DB.prepare(
    `UPDATE scope_tasks
        SET status = ?, board_column = CASE WHEN board_column IS NULL THEN NULL ELSE ? END,
            close_reason = CASE WHEN board_column IS NOT NULL AND ? = 'done' THEN 'completed' ELSE NULL END,
            blocked_reason = ?, attempts = attempts + ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN (SELECT value FROM json_each(?)) AND (? IS NULL OR attempts = ?)`,
  ).bind(to, BOARD_FOR[to], to, to === 'blocked' ? o.blockedReason ?? null : null, o.attemptsPlus ? 1 : 0,
    taskId, JSON.stringify(from), o.attemptsWere ?? null, o.attemptsWere ?? null).run();
  return !!r.meta?.changes;
}

// ── Runs ────────────────────────────────────────────────────────────────────

export async function runByUid(env: Env, uid: string): Promise<RunRow | null> {
  if (typeof uid !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(uid)) return null;
  return env.DB.prepare('SELECT * FROM agent_task_runs WHERE uid = ?').bind(uid).first<RunRow>();
}

/** One step's line on the timeline. A summary is a short sentence or a code, never a prompt or an output. */
export async function markRun(env: Env, uid: string, step: RunStep, entry: Omit<StepEntry, 'name' | 'at'>,
  patch: { status?: string; refusal?: string | null; ended?: boolean; started?: boolean; usageLogId?: number | null; proposalUid?: string | null } = {}) {
  const line: StepEntry = { name: step, at: sqlNow(), ...entry, summary: entry.summary.slice(0, 200) };
  await env.DB.prepare(
    `UPDATE agent_task_runs
        SET step = ?, steps_json = json_insert(steps_json, '$[#]', json(?)),
            status = COALESCE(?, status), refusal = CASE WHEN ? THEN ? ELSE refusal END,
            usage_log_id = COALESCE(?, usage_log_id), proposal_uid = COALESCE(?, proposal_uid),
            started_at = CASE WHEN ? AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
            ended_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE ended_at END,
            updated_at = CURRENT_TIMESTAMP
      WHERE uid = ?`,
  ).bind(step, JSON.stringify(line), patch.status ?? null, 'refusal' in patch ? 1 : 0, patch.refusal ?? null,
    patch.usageLogId ?? null, patch.proposalUid ?? null, patch.started ? 1 : 0, patch.ended ? 1 : 0, uid).run();
}

export function stepsOf(r: Pick<RunRow, 'steps_json'>): StepEntry[] {
  try { const v = JSON.parse(r.steps_json); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Runs of this agent that are not over, newest first. */
export async function openRunsOf(env: Env, agentId: number): Promise<RunRow[]> {
  const r = await env.DB.prepare(
    "SELECT * FROM agent_task_runs WHERE agent_id = ? AND status IN ('admitted', 'running', 'waiting_decision') ORDER BY id DESC",
  ).bind(agentId).all<RunRow>();
  return r.results ?? [];
}

/** Runs of this scope's agents that are not over. */
export async function openRunsInScope(env: Env, s: ScopeRef): Promise<RunRow[]> {
  const r = await env.DB.prepare(
    `SELECT r.* FROM agent_task_runs r JOIN team_agents a ON a.id = r.agent_id
      WHERE a.scope_kind = ? AND IFNULL(a.company_id, 0) = ? AND IFNULL(a.project_id, 0) = ?
        AND r.status IN ('admitted', 'running', 'waiting_decision')
      ORDER BY r.id`,
  ).bind(...scopeBinds(s)).all<RunRow>();
  return r.results ?? [];
}

/** Active duties of this scope's agents, for `rebuild`. */
export async function dutiesInScope(env: Env, s: ScopeRef): Promise<{ id: number; next_due_at: string }[]> {
  const r = await env.DB.prepare(
    `SELECT d.id, d.next_due_at FROM agent_duties d JOIN team_agents a ON a.id = d.agent_id
      WHERE a.scope_kind = ? AND IFNULL(a.company_id, 0) = ? AND IFNULL(a.project_id, 0) = ?
        AND d.status = 'active' AND a.status <> 'removed'
      ORDER BY d.id`,
  ).bind(...scopeBinds(s)).all<{ id: number; next_due_at: string }>();
  return r.results ?? [];
}

/** Runs this agent started today that count toward its daily limit, this one excluded. */
export async function runsToday(env: Env, agentId: number, exceptId: number, now = new Date()): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM agent_task_runs
      WHERE agent_id = ? AND id <> ? AND created_at >= ? AND status NOT IN (SELECT value FROM json_each(?))`,
  ).bind(agentId, exceptId, dayStart(now), JSON.stringify(UNCOUNTED)).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export const dailyLimitReached = (n: number) => n >= DAILY_LIMIT;

// ── The answer ──────────────────────────────────────────────────────────────

export type RunDto = {
  uid: string;
  agent: { uid: string; role_key: string; first_name: string | null; last_name: string | null };
  task: { uid: string; title: string };
  attempt: number; status: string; step: string | null; refusal: string | null; proposal_uid: string | null;
  started_at: string | null; ended_at: string | null; cost: Spend;
};

export async function runDto(env: Env, r: RunRow): Promise<RunDto> {
  const a = await env.DB.prepare('SELECT uid, role_key, first_name, last_name FROM team_agents WHERE id = ?').bind(r.agent_id)
    .first<{ uid: string; role_key: string; first_name: string | null; last_name: string | null }>();
  const t = await env.DB.prepare('SELECT uid, title FROM scope_tasks WHERE id = ?').bind(r.task_id).first<{ uid: string; title: string }>();
  return {
    uid: r.uid,
    agent: { uid: a?.uid ?? '', role_key: a?.role_key ?? '', first_name: a?.first_name ?? null, last_name: a?.last_name ?? null },
    task: { uid: t?.uid ?? '', title: t?.title ?? '' },
    attempt: r.attempt, status: r.status, step: r.step, refusal: r.refusal, proposal_uid: r.proposal_uid,
    started_at: r.started_at, ended_at: r.ended_at,
    cost: await chargedFor(env, r.usage_log_id),
  };
}

// ── Pauses and who hears of them ────────────────────────────────────────────

/** The sponsor and the scope's managers, by id, at most 20. Never an email. */
export async function teamToTell(env: Env, a: AgentRow): Promise<number[]> {
  const ids = new Set<number>([a.sponsor_user_id]);
  try {
    if (a.scope_kind === 'company') {
      const r = await env.DB.prepare(
        `SELECT l.user_id AS id FROM user_company_links l JOIN users u ON u.id = l.user_id
          WHERE l.company_id = ? AND u.is_active = 1 AND (l.is_primary_admin = 1 OR l.role_in_company IN ('Owner', 'Admin', 'Founder'))
          LIMIT 20`,
      ).bind(a.company_id).all<{ id: number }>();
      for (const x of r.results ?? []) ids.add(Number(x.id));
    } else {
      const r = await env.DB.prepare(
        `SELECT u.id FROM projects p JOIN users u ON u.founder_id = p.founder_id
          WHERE p.id = ? AND p.founder_id IS NOT NULL AND u.role = 'founder' AND u.is_active = 1
          LIMIT 20`,
      ).bind(a.project_id).all<{ id: number }>();
      for (const x of r.results ?? []) ids.add(Number(x.id));
    }
  } catch { /* the sponsor still hears */ }
  return [...ids].slice(0, 20);
}

const agentName = (a: Pick<AgentRow, 'first_name' | 'last_name' | 'role_key'>) =>
  [a.first_name, a.last_name].filter(Boolean).join(' ') || a.role_key;

/** In-app, `proactive_nudges`, to the sponsor and the managers. Best effort. */
export async function tellTeam(env: Env, a: AgentRow, n: { type: string; title: string; body: string; link?: string | null }) {
  for (const userId of await teamToTell(env, a)) {
    try {
      await notify(env, { userId, type: n.type, title: n.title, body: n.body, link: n.link ?? null, channels: ['in_app'], category: 'proactive_nudges' });
    } catch { /* one person's inbox never stops the run */ }
  }
}

const PAUSE_WORDS: Record<PauseReason, string> = {
  cap: 'it reached its monthly cap',
  sponsor_left: 'the person who added it can no longer manage this team',
  tool_disconnected: 'one of its tools is disconnected',
  spend_limit: 'its sponsor reached their AI spend limit',
  ai_paused: 'AI is paused for its sponsor',
  daily_limit: `it ran ${DAILY_LIMIT} times today`,
  scope_archived: 'its team was archived',
};

/** Pause an active agent with a reason, and tell the team once per agent, reason and UTC day. */
export async function pauseAgent(env: Env, agentId: number, reason: PauseReason, now = new Date()) {
  const a = await env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(agentId).first<AgentRow>();
  if (!a || a.status === 'removed') return;
  if (a.status === 'active') {
    const r = await env.DB.prepare(
      "UPDATE team_agents SET status = 'paused', paused_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'",
    ).bind(reason, a.id).run();
    if (r.meta?.changes) await logEvent(env, a.id, null, 'paused', { reason });
  }
  await notifyPauseOnce(env, a, reason, now);
}

/** KV, two days: a pause told today is not told again today. A key that cannot be read is told again rather than never. */
export async function notifyPauseOnce(env: Env, a: AgentRow, reason: PauseReason, now = new Date()) {
  const key = `agents:told:${a.id}:${reason}:${now.toISOString().slice(0, 10)}`;
  try {
    if (await env.RATE_LIMITS.get(key)) return;
    await env.RATE_LIMITS.put(key, '1', { expirationTtl: 2 * 86400 });
  } catch { /* tell anyway */ }
  await tellTeam(env, a, {
    type: 'agent_paused',
    title: `${agentName(a)} is paused`,
    body: `${agentName(a)} is paused because ${PAUSE_WORDS[reason]}.`,
  });
}

/** Only a run of this scope's agents, by uid, for someone who may see it. */
export async function runInScope(env: Env, uid: string): Promise<{ run: RunRow; agent: AgentRow } | null> {
  const run = await runByUid(env, uid);
  if (!run) return null;
  const agent = await env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(run.agent_id).first<AgentRow>();
  return agent ? { run, agent } : null;
}

/** The scope of an agent as the object names it. */
export const objectNameOf = (a: Pick<AgentRow, 'scope_kind' | 'company_id' | 'project_id'>) => scopeName(scopeOfRow(a));

