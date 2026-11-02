/**
 * D1614 W3 (#3971) — one agent run in full, whether it may be retried, and a
 * project's activity feed of people's and agents' work.
 *
 * THE RUN (`runDetail`). Read from E3's `agent_task_runs` (migration 728), its
 * task, its proposals (`ai_rail_proposals.run_key`), its hold
 * (`ai_budget_reservations.execution_id`) and its usage row(s)
 * (`ai_usage_logs`). What it read is the names the run recorded on its
 * `context` step ("Read a, b and N notes"), and the agent's granted tool
 * names: never a raw prompt and never an output.
 *
 * OUTCOME. Every run status reads as one of:
 *   in_progress  admitted or running
 *   completed    done, or waiting on a person's decision on its proposal
 *   skipped      refused because the agent or team was paused (`paused`), it
 *                ran out of budget (`out_of_tokens`), or a tool it reads was
 *                disconnected (`tool_disconnected`); or halted (`paused`)
 *   cancelled    a person cancelled it, or its agent was erased
 *   failed       anything else, with `reason_text` (the run's own step line,
 *                which is already plain words) and `retryable`
 * A failure is retryable when it was transient (`failed`, `step_lost`) and
 * the run is its task's latest attempt; a refusal that a retry would only
 * repeat (`not_ready`, `read_unavailable`, `scope_moved`, …) is not.
 *
 * COST. `held` is the hold the run took, `charged` what its usage rows
 * charged (with their guard rows); either is `{ available: false }` when it
 * was never recorded or cannot be read, never 0. Tokens and the model come
 * from the usage row.
 *
 * THE FEED (`projectActivity`). Project scope only (owner revision,
 * 2026-11-01): task events by people and agents (created, assigned, moved,
 * completed), agent runs (outcome and cost), and proposal decisions, newest
 * first, 50 a page, paged by `before` (an opaque cursor). Filters: `who`
 * (people, agents, both), `person`, `agent`, `task`. With `person` or
 * `agent` it also answers that one's "Worked on" and "Completed" tasks and
 * how many they completed in the last 7 days.
 *
 * A person is `{ uid, name }`; an agent `{ uid, name, role_key }`. Never an email.
 */
import type { Env } from '../../types';
import type { RunRow, StepEntry } from '../../agents/engine';
import { chargedFor } from './agentRun';
import { grantsOf } from './agentTools';
import { personaOf } from './personas';
import type { AgentRow, Spend } from './teams';
import { skillOfUsage } from './skillEval';

const parse = <T>(json: string | null | undefined, fallback: T): T => { try { const v = JSON.parse(json ?? ''); return v ?? fallback; } catch { return fallback; } };
const all = async <T>(env: Env, sql: string, ...binds: unknown[]) => ((await env.DB.prepare(sql).bind(...binds).all<T>()).results ?? []) as T[];

export type Person = { uid: string; name: string | null };
export type AgentRef = { uid: string; name: string; role_key: string };

export function agentRef(a: Pick<AgentRow, 'uid' | 'role_key' | 'first_name' | 'last_name'> & { persona_key?: string | null }): AgentRef {
  const name = personaOf(a.persona_key)?.name ?? ([a.first_name, a.last_name].filter(Boolean).join(' ') || a.role_key);
  return { uid: a.uid, name, role_key: a.role_key };
}

export async function personOf(env: Env, id: number | null | undefined): Promise<Person | null> {
  if (!id) return null;
  const u = await env.DB.prepare('SELECT uid, name FROM users WHERE id = ?').bind(id).first<{ uid: string; name: string | null }>();
  return u ? { uid: u.uid, name: u.name } : null;
}

// ── Outcome ─────────────────────────────────────────────────────────────────

export type Outcome =
  | { kind: 'in_progress' }
  | { kind: 'completed'; awaiting_decision: boolean }
  | { kind: 'skipped'; reason: 'paused' | 'out_of_tokens' | 'tool_disconnected'; reason_text: string }
  | { kind: 'cancelled'; reason_text: string }
  | { kind: 'failed'; reason_code: string | null; reason_text: string; retryable: boolean };

const PAUSED = new Set(['scope_paused', 'engine_paused', 'agent_not_active', 'ai_paused', 'sponsor_lost_access', 'scope_archived']);
const OUT_OF_TOKENS = new Set(['spend_limit', 'agent_cap_reached', 'daily_limit', 'gateway_limit']);
/** Refusals and failures a second attempt could get past. */
const TRANSIENT = new Set(['failed', 'step_lost']);

const SKIP_WORDS = {
  paused: 'Skipped: the agent or its team was paused.',
  out_of_tokens: 'Skipped: the agent ran out of its budget for now.',
  tool_disconnected: 'Skipped: a tool it reads was disconnected.',
} as const;

/** The last line the run wrote, which the loop writes in plain words. */
const lastLine = (steps: StepEntry[]) => [...steps].reverse().find((s) => s.summary)?.summary ?? null;

export function outcomeOf(r: Pick<RunRow, 'status' | 'refusal'>, steps: StepEntry[], isLatestAttempt: boolean): Outcome {
  if (r.status === 'admitted' || r.status === 'running') return { kind: 'in_progress' };
  if (r.status === 'done' || r.status === 'waiting_decision') return { kind: 'completed', awaiting_decision: r.status === 'waiting_decision' };
  if (r.status === 'cancelled') return { kind: 'cancelled', reason_text: r.refusal === 'erased' ? 'Cancelled: the agent was removed.' : 'Cancelled by a person.' };
  if (r.status === 'halted') return { kind: 'skipped', reason: 'paused', reason_text: 'Skipped: every agent was halted.' };
  const code = r.refusal ?? null;
  if (r.status === 'refused' && code) {
    if (code === 'tool_disconnected') return { kind: 'skipped', reason: 'tool_disconnected', reason_text: SKIP_WORDS.tool_disconnected };
    if (PAUSED.has(code)) return { kind: 'skipped', reason: 'paused', reason_text: SKIP_WORDS.paused };
    if (OUT_OF_TOKENS.has(code)) return { kind: 'skipped', reason: 'out_of_tokens', reason_text: SKIP_WORDS.out_of_tokens };
  }
  if (r.status === 'failed' && code && OUT_OF_TOKENS.has(code)) return { kind: 'skipped', reason: 'out_of_tokens', reason_text: SKIP_WORDS.out_of_tokens };
  return {
    kind: 'failed', reason_code: code,
    reason_text: lastLine(steps) ?? 'The run did not finish.',
    retryable: TRANSIENT.has(r.status) && isLatestAttempt,
  };
}

// ── Cost ────────────────────────────────────────────────────────────────────

export async function heldFor(env: Env, runUid: string): Promise<Spend> {
  try {
    const row = await env.DB.prepare('SELECT SUM(included_microusd + topup_microusd) AS held, COUNT(*) AS n FROM ai_budget_reservations WHERE execution_id = ?')
      .bind(runUid).first<{ held: number | null; n: number }>();
    return row && Number(row.n) > 0 && row.held != null ? { available: true, value_microusd: Number(row.held) } : { available: false };
  } catch {
    return { available: false };
  }
}

async function usageOf(env: Env, usageLogId: number | null) {
  if (!usageLogId) return { model: null, tokens: { available: false as const } };
  try {
    const u = await env.DB.prepare('SELECT model, prompt_tokens, completion_tokens FROM ai_usage_logs WHERE id = ?').bind(usageLogId)
      .first<{ model: string; prompt_tokens: number | null; completion_tokens: number | null }>();
    if (!u) return { model: null, tokens: { available: false as const } };
    return { model: u.model, tokens: { available: true as const, input: Number(u.prompt_tokens ?? 0), output: Number(u.completion_tokens ?? 0) } };
  } catch {
    return { model: null, tokens: { available: false as const } };
  }
}

// ── One run ─────────────────────────────────────────────────────────────────

export const stepsOfRow = (r: Pick<RunRow, 'steps_json'>): StepEntry[] => parse<StepEntry[]>(r.steps_json, []);

/** What the run read, by name, from its own context line ("Read a, b and N notes"). */
export function sourcesOf(steps: StepEntry[]): string[] {
  const line = steps.find((s) => s.name === 'context' && s.status === 'done')?.summary ?? '';
  const m = /^Read (.+?) and \d+ notes?/.exec(line);
  if (!m || m[1] === 'nothing') return [];
  return m[1].split(/,\s*/).map((s) => s.trim()).filter(Boolean);
}

export async function isLatestAttempt(env: Env, r: Pick<RunRow, 'task_id' | 'attempt'>): Promise<boolean> {
  const row = await env.DB.prepare('SELECT MAX(attempt) AS n FROM agent_task_runs WHERE task_id = ?').bind(r.task_id).first<{ n: number }>();
  return Number(row?.n ?? 0) === r.attempt;
}

const ms = (a: string | null, b: string | null) => {
  if (!a || !b) return null;
  const d = Date.parse(`${b.replace(' ', 'T')}Z`) - Date.parse(`${a.replace(' ', 'T')}Z`);
  return Number.isFinite(d) && d >= 0 ? d : null;
};

export async function runDetail(env: Env, r: RunRow, a: AgentRow) {
  const steps = stepsOfRow(r);
  const t = await env.DB.prepare('SELECT uid, title, detail, module, option FROM scope_tasks WHERE id = ?').bind(r.task_id)
    .first<{ uid: string; title: string; detail: string | null; module: string | null; option: string | null }>();
  const proposals = await all<{ uid: string; status: string; decided_at: string | null; decided_by_user_id: number | null }>(env,
    'SELECT uid, status, decided_at, decided_by_user_id FROM ai_rail_proposals WHERE run_key = ? OR uid = ? ORDER BY id', `agent:${r.uid}`, r.proposal_uid ?? '');
  const usage = await usageOf(env, r.usage_log_id);
  return {
    agent: { ...agentRef(a), model: a.model_id },
    // D1612 part D (#3954): the skill and pinned version the run's usage row names; null when it used none.
    skill: await skillOfUsage(env, r.usage_log_id),
    work: t ? { task: { uid: t.uid, title: t.title }, instruction: t.detail ?? null, module: t.module, option: t.option } : null,
    sources: sourcesOf(steps),
    tools: grantsOf(a.tool_grants_json).map((g) => g.tool),
    proposals: await Promise.all(proposals.map(async (p) => ({
      uid: p.uid, status: p.status, decided_at: p.decided_at, decided_by: await personOf(env, p.decided_by_user_id),
    }))),
    outcome: outcomeOf(r, steps, await isLatestAttempt(env, r)),
    started_at: r.started_at, finished_at: r.ended_at, duration_ms: ms(r.started_at, r.ended_at),
    cost: { held: await heldFor(env, r.uid), charged: await chargedFor(env, r.usage_log_id), model: usage.model, tokens: usage.tokens },
  };
}

// ── The feed ────────────────────────────────────────────────────────────────

export const FEED_PAGE = 50;
export type FeedFilter = { who: 'people' | 'agents' | 'both'; personId: number | null; agentId: number | null; taskId: number | null; before: string | null };

type Item = { at: string; key: string; [k: string]: unknown };

/** `before` is `<at>|<key>`; the page holds items strictly older. */
export function cursorOf(i: Pick<Item, 'at' | 'key'>) { return `${i.at}|${i.key}`; }
const older = (i: Pick<Item, 'at' | 'key'>, before: string | null) => !before || cursorOf(i) < before;

/**
 * A task event as activity, or null. W1's board writes a column move as `moved`
 * ({ change, to, to_status }) and, when the status changes with it, a `status`
 * event carrying the same `change`: the pair is one item, read from `moved`.
 * E1's and the engine's `status` events carry no `change` and stand alone.
 */
const EVENT_VERB = (kind: string, detail: any): string | null => {
  if (kind === 'created') return 'created';
  if (kind === 'assigned') return 'assigned';
  if (kind === 'moved') return detail?.to_status === 'done' ? 'completed' : 'moved';
  if (kind === 'status') return detail?.change ? null : detail?.to === 'done' ? 'completed' : 'moved';
  return null;
};

export async function projectActivity(env: Env, projectId: number, f: FeedFilter) {
  const tasks = await all<{ id: number; uid: string; title: string; status: string; assignee_kind: string; assignee_user_id: number | null; assignee_agent_id: number | null }>(env,
    "SELECT id, uid, title, status, assignee_kind, assignee_user_id, assignee_agent_id FROM scope_tasks WHERE scope_kind = 'project' AND project_id = ?", projectId);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ids = JSON.stringify(tasks.filter((t) => f.taskId == null || t.id === f.taskId).map((t) => t.id));
  const agents = new Map((await all<AgentRow>(env, 'SELECT * FROM team_agents WHERE id IN (SELECT DISTINCT agent_id FROM agent_task_runs WHERE task_id IN (SELECT value FROM json_each(?))) OR (scope_kind = \'project\' AND project_id = ?)', ids, projectId))
    .map((a) => [a.id, a]));
  const people = new Map<number, Person | null>();
  const person = async (id: number | null) => {
    if (!id) return null;
    if (!people.has(id)) people.set(id, await personOf(env, id));
    return people.get(id)!;
  };
  const taskRef = (id: number) => { const t = byId.get(id); return t ? { uid: t.uid, title: t.title } : null; };
  const wantPeople = f.who !== 'agents' && f.agentId == null;
  const wantAgents = f.who !== 'people' && f.personId == null;
  const items: Item[] = [];

  // Task events, by a person or an agent.
  const events = await all<{ id: number; task_id: number; actor_user_id: number | null; actor_agent_id: number | null; kind: string; detail_json: string | null; created_at: string }>(env,
    `SELECT id, task_id, actor_user_id, actor_agent_id, kind, detail_json, created_at FROM scope_task_events
      WHERE task_id IN (SELECT value FROM json_each(?)) ORDER BY id DESC LIMIT 2000`, ids);
  for (const e of events) {
    const detail = parse<any>(e.detail_json, null);
    const verb = EVENT_VERB(e.kind, detail);
    if (!verb) continue;
    const byAgent = e.actor_agent_id != null;
    if (byAgent ? !wantAgents : !wantPeople) continue;
    if (f.personId != null && e.actor_user_id !== f.personId) continue;
    if (f.agentId != null && e.actor_agent_id !== f.agentId) continue;
    const a = byAgent ? agents.get(e.actor_agent_id!) : null;
    items.push({
      at: e.created_at, key: `e${String(e.id).padStart(12, '0')}`, type: 'task_event', verb,
      by: byAgent ? (a ? { kind: 'agent', ...agentRef(a) } : null) : (e.actor_user_id ? { kind: 'person', ...(await person(e.actor_user_id))! } : null),
      // `to`: a column for a board move, else the status.
      task: taskRef(e.task_id), to: verb === 'moved' ? detail?.to ?? null : null,
    });
  }

  // Agent runs: their outcome and cost.
  if (wantAgents) {
    const runs = await all<RunRow>(env, `SELECT * FROM agent_task_runs WHERE task_id IN (SELECT value FROM json_each(?)) ORDER BY id DESC LIMIT 1000`, ids);
    for (const r of runs) {
      if (f.agentId != null && r.agent_id !== f.agentId) continue;
      const a = agents.get(r.agent_id);
      const latest = !runs.some((x) => x.task_id === r.task_id && x.attempt > r.attempt);
      items.push({
        at: r.ended_at ?? r.started_at ?? r.created_at, key: `r${String(r.id).padStart(12, '0')}`, type: 'agent_run', run_uid: r.uid,
        by: a ? { kind: 'agent', ...agentRef(a) } : null, task: taskRef(r.task_id),
        outcome: outcomeOf(r, stepsOfRow(r), latest), cost: await chargedFor(env, r.usage_log_id),
      });
    }
  }

  // Proposal decisions, by a person.
  if (wantPeople) {
    const decided = await all<{ id: number; uid: string; task_id: number; status: string; decided_at: string; decided_by_user_id: number | null }>(env,
      `SELECT id, uid, task_id, status, decided_at, decided_by_user_id FROM ai_rail_proposals
        WHERE task_id IN (SELECT value FROM json_each(?)) AND decided_at IS NOT NULL ORDER BY id DESC LIMIT 1000`, ids);
    for (const p of decided) {
      if (f.personId != null && p.decided_by_user_id !== f.personId) continue;
      items.push({
        at: p.decided_at, key: `p${String(p.id).padStart(12, '0')}`, type: 'proposal_decision', proposal_uid: p.uid, decision: p.status,
        by: p.decided_by_user_id ? { kind: 'person', ...(await person(p.decided_by_user_id))! } : null, task: taskRef(p.task_id),
      });
    }
  }

  items.sort((x, y) => (cursorOf(y) < cursorOf(x) ? -1 : cursorOf(y) > cursorOf(x) ? 1 : 0));
  const page = items.filter((i) => older(i, f.before)).slice(0, FEED_PAGE);
  const nextCursor = page.length === FEED_PAGE && items.filter((i) => older(i, f.before)).length > FEED_PAGE ? cursorOf(page[page.length - 1]) : null;

  // One person's or one agent's lists.
  let lists = null;
  if (f.personId != null || f.agentId != null) {
    const mine = tasks.filter((t) => (f.personId != null ? t.assignee_kind === 'person' && t.assignee_user_id === f.personId : t.assignee_kind === 'agent' && t.assignee_agent_id === f.agentId));
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
    const completedThisWeek = items.filter((i) => i.type === 'task_event' && i.verb === 'completed' && i.at >= weekAgo).length;
    lists = {
      worked_on: mine.filter((t) => t.status !== 'done').map((t) => ({ uid: t.uid, title: t.title, status: t.status })),
      completed: mine.filter((t) => t.status === 'done').map((t) => ({ uid: t.uid, title: t.title })),
      completed_last_7_days: completedThisWeek,
    };
  }
  return { items: page.map(({ key, ...rest }) => ({ id: key, ...rest })), next_cursor: nextCursor, ...(lists ? { lists } : {}) };
}
