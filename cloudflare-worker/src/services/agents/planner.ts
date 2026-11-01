/**
 * D1530 (#3848, E4 of #3742) — the goal planner: a proposal of tasks for one
 * goal, accepted as one batch.
 *
 * WHO RUNS IT. The scope's CEO / Chief of staff agent, through `agentRun`
 * (its rule book, cap and sponsor; charged to that sponsor), on the rail
 * option `propose:goal-plan` in Studio. With no such agent, the asking
 * manager's own Eadwyn runs the same option, charged to them. Either way the
 * cost is shown first (`planQuote`).
 *
 * WHAT IT SEES. The goal; the stage and its aim; the open build plan items;
 * the open tasks; the team: people by name and agents by role. Never an
 * email, never a numeric id.
 *
 * WHAT IT MAY ANSWER. At most 20 items `{ title, module, suggested_assignee:
 * { role_key } | { person: true }, depends_on: [index], due_in_days }`. An
 * unknown module or role drops its item, and each drop is noted in the
 * proposal. A dependency loop invalidates the whole plan (`plan_invalid`):
 * nothing is proposed.
 *
 * ACCEPT. One proposal is one plan. A manager may remove or retitle items
 * first; every kept item becomes a task in ONE D1 batch with `source_kind =
 * 'plan'`, its dependencies included, so a failure creates none.
 */
import type { Env, User } from '../../types';
import { quoteRun, run, type TaskClass } from '../aiRouter';
import { proposeRail } from '../railProposals';
import { newUid } from '../../routes/_t13t14t15_helpers';
import { moduleOf, roleOf, MODULES } from './catalogue';
import { agentQuote, agentRun, moduleSurface, optionRowIn, runRefusalStatus, type AgentRefusal } from './agentRun';
import { scopeCols, type AgentRow, type Scope, type Spend } from './teams';
import { agentFits } from './tasks';
import type { GoalRow } from './goals';

export const PLAN_OPTION = 'propose:goal-plan';
export const PLAN_MODULE = 'studio';
export const PLAN_MAX = 20;
export const TITLE_MAX = 200;
export const DUE_MAX_DAYS = 365;

export type PlanAssignee = { role_key: string } | { person: true };
export type PlanItem = { title: string; module: string; suggested_assignee: PlanAssignee; depends_on: number[]; due_in_days: number | null };
export type Plan = { items: PlanItem[]; dropped: string[] };
export type PlanParse = { ok: true; plan: Plan } | { ok: false; code: 'plan_invalid'; message: string };

const invalid = (message: string): PlanParse => ({ ok: false, code: 'plan_invalid', message });

/** The model's answer: a JSON list of items, or `{ items: [...] }`, possibly inside prose or a code fence. */
function jsonOf(text: string): unknown {
  const t = String(text ?? '');
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const a = t.indexOf(open), b = t.lastIndexOf(close);
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* try the other shape */ } }
  }
  return null;
}

/** True when the items' dependencies loop. */
export function hasCycle(items: Pick<PlanItem, 'depends_on'>[]): boolean {
  const state = new Array(items.length).fill(0);
  const visit = (i: number): boolean => {
    if (state[i] === 1) return true;
    if (state[i] === 2) return false;
    state[i] = 1;
    for (const d of items[i].depends_on) if (visit(d)) return true;
    state[i] = 2;
    return false;
  };
  return items.some((_, i) => visit(i));
}

/**
 * Read the model's plan. Unknown modules and roles drop their items (noted);
 * a dependency on a dropped item is removed (noted); a loop among the kept
 * items invalidates the plan. More than 20 items keeps the first 20 (noted).
 */
export function parsePlan(output: string): PlanParse {
  const raw = jsonOf(output);
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as any).items) ? (raw as any).items : null;
  if (!list) return invalid('The plan could not be read. Nothing was proposed.');
  const dropped: string[] = [];
  if (list.length > PLAN_MAX) dropped.push(`Only the first ${PLAN_MAX} items were kept; ${list.length - PLAN_MAX} more were left out.`);
  const kept: Array<{ from: number; item: Omit<PlanItem, 'depends_on'> & { deps: unknown } }> = [];
  list.slice(0, PLAN_MAX).forEach((x: any, i: number) => {
    const n = i + 1;
    const title = typeof x?.title === 'string' ? x.title.trim().slice(0, TITLE_MAX) : '';
    if (!title) { dropped.push(`Item ${n} had no title.`); return; }
    const mod = typeof x?.module === 'string' ? moduleOf(x.module) : null;
    if (!mod) { dropped.push(`“${title}” named a module StudioOS does not have (${String(x?.module ?? 'none')}).`); return; }
    const a = x?.suggested_assignee;
    let assignee: PlanAssignee;
    if (a && typeof a === 'object' && a.person === true) assignee = { person: true };
    else if (a && typeof a === 'object' && typeof a.role_key === 'string' && roleOf(a.role_key)) assignee = { role_key: a.role_key };
    else { dropped.push(`“${title}” named a role there is no agent role for (${String(a?.role_key ?? 'none')}).`); return; }
    const due = x?.due_in_days;
    const due_in_days = Number.isInteger(due) && due >= 0 && due <= DUE_MAX_DAYS ? due : null;
    kept.push({ from: i, item: { title, module: mod.key, suggested_assignee: assignee, due_in_days, deps: x?.depends_on } });
  });
  const index = new Map(kept.map((k, j) => [k.from, j]));
  const items: PlanItem[] = kept.map(({ item }) => {
    const deps: number[] = [];
    for (const d of Array.isArray(item.deps) ? item.deps : []) {
      if (!Number.isInteger(d)) continue;
      const to = index.get(d as number);
      if (to == null) { dropped.push(`“${item.title}” waited on an item that was left out; that wait was removed.`); continue; }
      if (!deps.includes(to)) deps.push(to);
    }
    const { deps: _drop, ...rest } = item;
    return { ...rest, depends_on: deps };
  });
  if (!items.length) return invalid('The plan had no item StudioOS could use. Nothing was proposed.');
  if (hasCycle(items)) return invalid('The plan’s items wait on each other in a loop, so it cannot be followed. Nothing was proposed.');
  return { ok: true, plan: { items, dropped } };
}

// ─────────────────────────────────────────────────────────────── the context

const STAGE_AIM: Record<string, string> = {
  idea: 'Shape the concept and capture it', validate: 'Prove someone wants it', build: 'Ship the MVP with the right people',
  launch: 'Get to market', raise: 'Fund the next stage', grow: 'Find repeatable traction',
};

/** What the planner is told: names and roles, never an email or an id. Each part that cannot be read is said so. */
export async function planContext(env: Env, s: Scope, goal: GoalRow): Promise<string> {
  const [companyId, projectId] = scopeCols(s);
  const lines: string[] = [`Goal: ${goal.title}`];
  if (goal.why) lines.push(`Why: ${goal.why}`);
  if (goal.metric) lines.push(`Measure: ${goal.metric}`);
  if (goal.target_date) lines.push(`Target date: ${goal.target_date}`);
  let stage: string | null = goal.stage;
  if (s.kind === 'project' && !stage) {
    try { stage = (await env.DB.prepare('SELECT lifecycle_stage FROM projects WHERE id = ?').bind(s.id).first<{ lifecycle_stage: string | null }>())?.lifecycle_stage ?? null; } catch { stage = null; }
  }
  lines.push(stage ? `Stage: ${stage} (${STAGE_AIM[stage] ?? 'no stated aim'})` : 'Stage: not recorded');
  try {
    const open = await env.DB.prepare(
      `SELECT title, module FROM scope_tasks WHERE scope_kind = ? AND company_id IS ? AND project_id IS ? AND status NOT IN ('done', 'cancelled') ORDER BY priority DESC, id LIMIT 40`,
    ).bind(s.kind, companyId, projectId).all<{ title: string; module: string | null }>();
    lines.push('Open tasks:', ...((open.results || []).map((t) => `- ${t.title}${t.module ? ` (${t.module})` : ''}`)), ...(open.results?.length ? [] : ['- none']));
  } catch { lines.push('Open tasks: could not be read'); }
  if (s.kind === 'project') {
    try {
      // An item is open until it lands in its module (`landed_id`).
      const items = await env.DB.prepare(
        'SELECT kind, item_key, module FROM build_plan_items WHERE project_id = ? AND landed_id IS NULL ORDER BY created_at LIMIT 30',
      ).bind(s.id).all<{ kind: string; item_key: string; module: string }>();
      lines.push('Open build plan items:', ...((items.results || []).map((t) => `- ${t.kind}: ${t.item_key} (${t.module})`)), ...(items.results?.length ? [] : ['- none']));
    } catch { lines.push('Open build plan items: none recorded'); }
  }
  try {
    const agents = await env.DB.prepare(
      "SELECT role_key FROM team_agents WHERE scope_kind = ? AND company_id IS ? AND project_id IS ? AND status = 'active' ORDER BY id",
    ).bind(s.kind, companyId, projectId).all<{ role_key: string }>();
    lines.push(`Agents on the team: ${(agents.results || []).map((a) => roleOf(a.role_key)?.name ?? a.role_key).join(', ') || 'none'}`);
  } catch { lines.push('Agents on the team: could not be read'); }
  lines.push(`Modules (use these keys): ${MODULES.map((m) => m.key).join(', ')}`);
  return lines.join('\n');
}

const INSTRUCTION = [
  'Propose a plan for the goal above as JSON: {"items": [{"title", "module", "suggested_assignee", "depends_on", "due_in_days"}]}.',
  `At most ${PLAN_MAX} items. "module" is one of the module keys listed. "suggested_assignee" is {"role_key": "<agent role>"} for an agent role`,
  `(${['ceo', 'cto', 'cpo', 'cfo', 'cmo', 'sales', 'coo', 'general_counsel', 'people', 'research_analyst', 'investor_relations'].join(', ')}) or {"person": true} for a person.`,
  '"depends_on" lists earlier items\' indexes (0-based) this item waits on. "due_in_days" is a whole number of days from now.',
  'Answer with the JSON only.',
].join(' ');

// ─────────────────────────────────────────────────────────────── run and quote

/** The scope's active CEO / Chief of staff agent, or null. */
export async function plannerAgent(env: Env, s: Scope): Promise<AgentRow | null> {
  const [companyId, projectId] = scopeCols(s);
  return env.DB.prepare(
    "SELECT * FROM team_agents WHERE scope_kind = ? AND company_id IS ? AND project_id IS ? AND role_key = 'ceo' AND status = 'active' ORDER BY id LIMIT 1",
  ).bind(s.kind, companyId, projectId).first<AgentRow>();
}

export type PlanDeps = {
  agentRun?: typeof agentRun; agentQuote?: typeof agentQuote; run?: typeof run; quoteRun?: typeof quoteRun;
};
export type PlanRefusal = { ok: false; status: number; code: string; message: string; extra?: Record<string, unknown> };

const record = (goal: GoalRow) => `goal:${goal.uid}`;
const eadwynOpts = (row: NonNullable<ReturnType<typeof optionRowIn>>, user: User, prompt: string) => ({
  task: row.routeTask as TaskClass, userId: Number(user.id), role: user.role ?? null,
  systemPrompt: 'You are Eadwyn, planning a team’s work toward one goal. Everything you write is a proposal a person reviews.',
  messages: [{ role: 'user' as const, content: prompt }], guardText: prompt,
});

/** What a plan would hold: an upper bound; `{ available: false }` when it cannot be read, never 0. */
export async function planQuote(env: Env, s: Scope, goal: GoalRow, user: User, deps: PlanDeps = {}): Promise<{ ok: true; quote: Spend; by: 'agent' | 'eadwyn' } | PlanRefusal> {
  const agent = await plannerAgent(env, s);
  if (agent) {
    const q = await (deps.agentQuote ?? agentQuote)(env, { agent, module: PLAN_MODULE, option: PLAN_OPTION, record: record(goal) });
    return q.ok ? { ok: true, quote: q.quote, by: 'agent' } : q;
  }
  const row = optionRowIn(PLAN_MODULE, PLAN_OPTION);
  if (!row) return { ok: false, status: 503, code: 'plan_option_missing', message: 'The planner is not set up yet.' };
  try {
    const m = moduleOf(PLAN_MODULE)!;
    const q = await (deps.quoteRun ?? quoteRun)(env, { ...eadwynOpts(row, user, ' '), rail: { page: row.pageKey, option: row.optionKey, record: record(goal) }, surface: moduleSurface(m) });
    if (!q.ok && q.refusal === 'misconfigured') return { ok: true, quote: { available: false }, by: 'eadwyn' };
    if (!q.ok) return { ok: false, status: runRefusalStatus(q.refusal), code: String(q.refusal), message: q.error };
    return { ok: true, quote: { available: true, value_microusd: q.hold_microusd }, by: 'eadwyn' };
  } catch {
    return { ok: true, quote: { available: false }, by: 'eadwyn' };
  }
}

async function setPayload(env: Env, uid: string, payload: Record<string, unknown>, status?: 'discarded') {
  await env.DB.prepare(
    `UPDATE ai_rail_proposals SET payload_json = ?, ${status ? "status = 'discarded', decided_at = CURRENT_TIMESTAMP," : ''} updated_at = CURRENT_TIMESTAMP WHERE uid = ?`,
  ).bind(JSON.stringify(payload), uid).run();
}

/**
 * Run the planner and keep its plan as one proposal on `goal:<uid>`. An
 * unreadable or looping plan is discarded and answers 422 `plan_invalid`.
 */
export async function draftPlan(env: Env, s: Scope, goal: GoalRow, user: User, deps: PlanDeps = {}): Promise<{ ok: true; proposal: { uid: string; by: 'agent' | 'eadwyn'; plan: Plan } } | PlanRefusal> {
  const prompt = `${await planContext(env, s, goal)}\n\n${INSTRUCTION}`;
  const agent = await plannerAgent(env, s);
  let uid: string;
  let text: string;
  let by: 'agent' | 'eadwyn';
  if (agent) {
    const r = await (deps.agentRun ?? agentRun)(env, { agent, module: PLAN_MODULE, option: PLAN_OPTION, record: record(goal), prompt });
    if (!r.ok) return r as AgentRefusal;
    uid = r.proposal.uid; text = String((r.proposal.payload as any)?.text ?? ''); by = 'agent';
  } else {
    const row = optionRowIn(PLAN_MODULE, PLAN_OPTION);
    if (!row) return { ok: false, status: 503, code: 'plan_option_missing', message: 'The planner is not set up yet.' };
    const r = await (deps.run ?? run)(env, { ...eadwynOpts(row, user, prompt), rail: { page: row.pageKey, option: row.optionKey, record: record(goal) }, surface: moduleSurface(moduleOf(PLAN_MODULE)!) });
    if (!r.ok) return { ok: false, status: runRefusalStatus(r.refusal), code: r.refusal ?? 'run_failed', message: r.guard?.refusal?.message ?? r.error ?? 'The planner could not run.' };
    const p = await proposeRail(env, { userId: Number(user.id), page: row.pageKey, option: row.optionKey, record: record(goal), kind: 'proposal', payload: { text: r.output ?? '' }, model: r.usage?.model ?? null, usageLogId: r.usageLogId ?? null });
    uid = p.uid; text = r.output ?? ''; by = 'eadwyn';
  }
  const parsed = parsePlan(text);
  if (!parsed.ok) {
    await setPayload(env, uid, { goal: goal.uid, invalid: parsed.message }, 'discarded');
    return { ok: false, status: 422, code: parsed.code, message: parsed.message };
  }
  await setPayload(env, uid, { goal: goal.uid, by, plan: parsed.plan });
  return { ok: true, proposal: { uid, by, plan: parsed.plan } };
}

// ─────────────────────────────────────────────────────────────── accept

export type PlanEdits = { remove?: unknown; titles?: unknown };

/** The plan as the person kept it: removed items gone (and every wait on them), retitled items renamed. */
export function applyEdits(plan: Plan, edits: PlanEdits): { ok: true; items: PlanItem[] } | { ok: false; message: string } {
  const remove = new Set<number>();
  if (edits.remove != null) {
    if (!Array.isArray(edits.remove) || !edits.remove.every((i) => Number.isInteger(i) && i >= 0 && i < plan.items.length)) return { ok: false, message: 'remove lists item indexes of this plan.' };
    for (const i of edits.remove as number[]) remove.add(i);
  }
  const titles = new Map<number, string>();
  if (edits.titles != null) {
    if (typeof edits.titles !== 'object' || Array.isArray(edits.titles)) return { ok: false, message: 'titles maps an item index to its new title.' };
    for (const [k, v] of Object.entries(edits.titles as Record<string, unknown>)) {
      const i = Number(k);
      if (!Number.isInteger(i) || i < 0 || i >= plan.items.length || typeof v !== 'string' || !v.trim() || v.trim().length > TITLE_MAX) {
        return { ok: false, message: `Each new title is 1 to ${TITLE_MAX} characters, for an item of this plan.` };
      }
      titles.set(i, v.trim());
    }
  }
  const keep = plan.items.map((_, i) => i).filter((i) => !remove.has(i));
  const at = new Map(keep.map((i, j) => [i, j]));
  const items = keep.map((i) => ({ ...plan.items[i], title: titles.get(i) ?? plan.items[i].title, depends_on: plan.items[i].depends_on.filter((d) => at.has(d)).map((d) => at.get(d)!) }));
  if (!items.length) return { ok: false, message: 'Keep at least one item, or discard the plan.' };
  return { ok: true, items };
}

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Accept a plan: claim the proposal (only an open one, once), then write every
 * task, its dependencies and its event in ONE batch. If the batch fails the
 * claim is released and no task exists.
 */
export async function acceptPlan(env: Env, s: Scope, goal: GoalRow, proposalUid: unknown, edits: PlanEdits, user: User): Promise<{ ok: true; tasks: string[] } | PlanRefusal> {
  if (typeof proposalUid !== 'string' || !proposalUid) return { ok: false, status: 400, code: 'invalid_plan', message: 'Name the plan to accept.' };
  const row = await env.DB.prepare(
    `SELECT uid, status, payload_json FROM ai_rail_proposals WHERE uid = ? AND rail_option = ? AND record_ref = ?`,
  ).bind(proposalUid, PLAN_OPTION, record(goal)).first<{ uid: string; status: string; payload_json: string }>();
  if (!row) return { ok: false, status: 404, code: 'not_found', message: 'There is no such plan for this goal.' };
  if (row.status !== 'proposed') return { ok: false, status: 409, code: 'plan_decided', message: 'This plan was already accepted or discarded.' };
  let plan: Plan | null = null;
  try { plan = (JSON.parse(row.payload_json) as any)?.plan ?? null; } catch { plan = null; }
  if (!plan || !Array.isArray(plan.items)) return { ok: false, status: 409, code: 'plan_invalid', message: 'This plan cannot be accepted.' };
  const kept = applyEdits(plan, edits);
  if (!kept.ok) return { ok: false, status: 400, code: 'invalid_plan', message: kept.message };
  const edited = kept.items.length !== plan.items.length || kept.items.some((it, i) => it.title !== plan!.items[i]?.title);

  // Who each item goes to: the scope's active agent of that role, when it may work in the module; else nobody yet.
  const [companyId, projectId] = scopeCols(s);
  const agents = (await env.DB.prepare(
    "SELECT * FROM team_agents WHERE scope_kind = ? AND company_id IS ? AND project_id IS ? AND status = 'active'",
  ).bind(s.kind, companyId, projectId).all<AgentRow>()).results || [];
  const assignees: Array<number | null> = [];
  for (const it of kept.items) {
    const a = 'role_key' in it.suggested_assignee ? agents.find((x) => x.role_key === (it.suggested_assignee as any).role_key) ?? null : null;
    assignees.push(a && !(await agentFits(env, a, it.module, null)) ? a.id : null);
  }

  const claim = await env.DB.prepare(
    `UPDATE ai_rail_proposals SET status = ?, decided_payload_json = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE uid = ? AND status = 'proposed'`,
  ).bind(edited ? 'edited' : 'accepted', edited ? JSON.stringify({ goal: goal.uid, plan: { items: kept.items, dropped: plan.dropped } }) : null, row.uid).run();
  if (!claim.meta?.changes) return { ok: false, status: 409, code: 'plan_decided', message: 'This plan was already accepted or discarded.' };

  const uids = kept.items.map(() => newUid());
  const statements: D1PreparedStatement[] = [];
  kept.items.forEach((it, i) => {
    statements.push(env.DB.prepare(
      `INSERT INTO scope_tasks (uid, scope_kind, company_id, project_id, goal_id, title, module, kind, assignee_kind, assignee_agent_id, status, due_at, source_kind, source_ref, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'work', ?, ?, 'open', ?, 'plan', ?, ?)`,
    ).bind(uids[i], s.kind, companyId, projectId, goal.id, it.title, it.module, assignees[i] ? 'agent' : 'none', assignees[i], it.due_in_days == null ? null : addDays(it.due_in_days), row.uid, Number(user.id)));
  });
  kept.items.forEach((it, i) => {
    statements.push(env.DB.prepare(
      `INSERT INTO scope_task_events (task_id, actor_user_id, kind, detail_json) SELECT id, ?, 'created', ? FROM scope_tasks WHERE uid = ?`,
    ).bind(Number(user.id), JSON.stringify({ source: 'plan', proposal: row.uid }), uids[i]));
    for (const d of it.depends_on) {
      statements.push(env.DB.prepare(
        'INSERT INTO scope_task_deps (task_id, depends_on_task_id) SELECT t.id, d.id FROM scope_tasks t, scope_tasks d WHERE t.uid = ? AND d.uid = ?',
      ).bind(uids[i], uids[d]));
    }
  });
  try {
    await env.DB.batch(statements);
  } catch {
    await env.DB.prepare(
      "UPDATE ai_rail_proposals SET status = 'proposed', decided_payload_json = NULL, decided_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE uid = ?",
    ).bind(row.uid).run();
    return { ok: false, status: 503, code: 'plan_not_saved', message: 'The plan’s tasks could not be saved, so none were. Try again.' };
  }
  return { ok: true, tasks: uids };
}
