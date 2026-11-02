/**
 * D4163 (#4163, H5 of #4137) — what HQ › AI agents reads about every team's
 * agents: the Overview tiles (SA0), the run log and one run (SA7), and spend
 * against the platform budget (SA7b). Read-only.
 *
 * Two rules hold everywhere here:
 *   - **Not recorded is never 0.** A figure whose source cannot be read, or
 *     whose rows carry an unrecorded charge, is `null`; a rate with nothing to
 *     rate is `null`. A count read from its table is a count, 0 included.
 *   - **People by name, never by email.** Agents by their persona name, teams
 *     as company › project by name, and every free text that reaches a
 *     response (a step's summary, a proposal's payload) has any email address
 *     replaced (`redactEmails`).
 *
 * The platform budget is H4's (#4162): `ai_agent_policy` row 1, which this
 * migration creates empty. Until H4 sets it the budget reads `null`, and so
 * does anything measured against it.
 */
import type { Env } from '../../types';
import { RADAR_AXES } from '../skillsTaxonomySchema';

export const RUN_STATUSES = ['succeeded', 'failed', 'refused', 'running', 'cancelled'] as const;
export type RunStatus = typeof RUN_STATUSES[number];
export const SPEND_BY = ['agent', 'skill', 'company', 'model'] as const;
export type SpendBy = typeof SPEND_BY[number];
export const RUNS_PAGE = 50;
/** A model error burst: this many failed or refused agent calls on one model within one hour, in the last day. */
export const BURST_MIN = 5;
/** The pause reasons that mean an agent hit a cap (`agents/engine.ts` PAUSE_REASONS); the SQL below names the same three. */
const PAUSED_FOR_CAP = ['cap', 'spend_limit', 'daily_limit'];
const AREA_SLUGS = RADAR_AXES.map((a) => a.slug) as readonly string[];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Any email address in a value, at any depth, replaced: nothing a member typed reaches HQ with an address in it. */
export function redactEmails<T>(v: T): T {
  if (typeof v === 'string') return v.replace(EMAIL, '[email removed]') as unknown as T;
  if (Array.isArray(v)) return v.map((x) => redactEmails(x)) as unknown as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, redactEmails(x)])) as T;
  return v;
}

/** The status the panel shows for an engine status (`agent_task_runs.status`). */
export const runStatusOf = (s: string): RunStatus =>
  s === 'done' ? 'succeeded'
    : s === 'refused' ? 'refused'
      : s === 'failed' || s === 'step_lost' || s === 'halted' ? 'failed'
        : s === 'cancelled' || s === 'scope_moved' ? 'cancelled' : 'running';
const ENGINE_STATUSES: Record<RunStatus, string[]> = {
  succeeded: ['done'], refused: ['refused'], failed: ['failed', 'step_lost', 'halted'],
  cancelled: ['cancelled', 'scope_moved'], running: ['admitted', 'running', 'waiting_decision'],
};

/** The proposal outcome of a run: accepted (an edit is an acceptance), rejected, pending, or null when it proposed nothing. */
export const outcomeOf = (s: string | null | undefined): 'accepted' | 'rejected' | 'pending' | 'withdrawn' | null =>
  s == null ? null : s === 'accepted' || s === 'edited' ? 'accepted' : s === 'discarded' ? 'rejected' : s === 'proposed' ? 'pending' : s === 'withdrawn' ? 'withdrawn' : null;

const personaName = (r: { first_name?: string | null; last_name?: string | null }): string | null =>
  [r.first_name, r.last_name].map((x) => (x ?? '').trim()).filter(Boolean).join(' ') || null;

/** A team as company › project, by name. */
function teamOf(r: any): { kind: 'company' | 'project'; id: number; company: string | null; project: string | null } {
  return r.scope_kind === 'company'
    ? { kind: 'company', id: Number(r.company_id), company: r.company_name ?? null, project: null }
    : { kind: 'project', id: Number(r.project_id), company: r.project_company_name ?? null, project: r.project_name ?? null };
}

const monthStart = (d: Date) => `${d.toISOString().slice(0, 7)}-01 00:00:00`;
const ago = (d: Date, days: number) => new Date(d.getTime() - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');

/** This month's agent spend; only known when every row's charge is: any NULL makes it null, never a smaller number. */
async function monthSpend(env: Env, since: string): Promise<number | null> {
  try {
    const r = await env.DB.prepare(
      'SELECT COUNT(*) AS n, COUNT(charged_microusd) AS known, SUM(charged_microusd) AS s FROM ai_usage_logs WHERE agent_id IS NOT NULL AND created_at >= ?',
    ).bind(since).first<any>();
    if (!r) return null;
    if (Number(r.known) !== Number(r.n)) return null;
    return Number(r.s ?? 0);
  } catch { return null; }
}

async function count(env: Env, sql: string, args: unknown[] = []): Promise<number | null> {
  try { const r = await env.DB.prepare(sql).bind(...args).first<{ n: number }>(); return r ? Number(r.n) : null; } catch { return null; }
}

/** H4's platform monthly budget, or null while H4 has not set one. */
export async function platformBudget(env: Env): Promise<number | null> {
  try {
    const r = await env.DB.prepare('SELECT platform_budget_microusd AS b FROM ai_agent_policy WHERE id = 1').first<{ b: number | null }>();
    return r?.b == null ? null : Number(r.b);
  } catch { return null; }
}

/** Each agent's area: the radar axis most of its linked skills' tags fall in, or null when its skills tag none. */
export async function agentAreas(env: Env): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  try {
    const rs = await env.DB.prepare(
      `SELECT l.agent_id, s.category_slug AS area, COUNT(*) AS n
         FROM agent_skill_links l JOIN agent_skill_tags t ON t.skill_id = l.skill_id JOIN skills s ON s.slug = t.taxonomy_skill_slug
        GROUP BY l.agent_id, s.category_slug ORDER BY l.agent_id, n DESC, s.category_slug`,
    ).all<any>();
    for (const r of rs.results ?? []) if (!out.has(Number(r.agent_id)) && AREA_SLUGS.includes(r.area)) out.set(Number(r.agent_id), r.area);
  } catch { /* no skills tables: every agent's area is unknown */ }
  return out;
}

const pct = (num: number | null, den: number | null): number | null => (num == null || den == null || den === 0 ? null : Math.round((num / den) * 1000) / 10);

// ── SA0 · Overview ──────────────────────────────────────────────────────────

export type Attention = { kind: string; label: string; items: unknown[] } | { kind: string; label: string; available: false; reason: string };

export async function overview(env: Env, now = new Date()) {
  const d7 = ago(now, 7), d30 = ago(now, 30), d1 = ago(now, 1), m = monthStart(now);
  const [agentsActive, teams, axal, companies, runsWeek, runs30, budget, spend, decided, accepted, ended, failed] = await Promise.all([
    count(env, "SELECT COUNT(*) AS n FROM team_agents WHERE status = 'active'"),
    count(env, "SELECT COUNT(DISTINCT scope_kind || ':' || IFNULL(company_id, project_id)) AS n FROM team_agents WHERE status = 'active'"),
    count(env, "SELECT COUNT(*) AS n FROM agent_skills WHERE scope = 'hq' AND status = 'published'"),
    count(env, "SELECT COUNT(*) AS n FROM agent_skills WHERE scope = 'company' AND status = 'published'"),
    count(env, 'SELECT COUNT(*) AS n FROM agent_task_runs WHERE created_at >= ?', [d7]),
    count(env, 'SELECT COUNT(*) AS n FROM agent_task_runs WHERE created_at >= ?', [d30]),
    platformBudget(env),
    monthSpend(env, m),
    count(env, "SELECT COUNT(*) AS n FROM ai_rail_proposals WHERE agent_id IS NOT NULL AND status IN ('accepted', 'edited', 'discarded') AND decided_at >= ?", [d30]),
    count(env, "SELECT COUNT(*) AS n FROM ai_rail_proposals WHERE agent_id IS NOT NULL AND status IN ('accepted', 'edited') AND decided_at >= ?", [d30]),
    count(env, "SELECT COUNT(*) AS n FROM agent_task_runs WHERE created_at >= ? AND status IN ('done', 'refused', 'failed', 'step_lost', 'halted')", [d30]),
    count(env, "SELECT COUNT(*) AS n FROM agent_task_runs WHERE created_at >= ? AND status IN ('failed', 'step_lost', 'halted')", [d30]),
  ]);

  const attention: Attention[] = [];
  try {
    const rs = await env.DB.prepare(
      `SELECT a.uid, a.first_name, a.last_name, a.paused_reason, a.scope_kind, a.company_id, a.project_id,
              cp.company_name, p.name AS project_name, pc.company_name AS project_company_name
         FROM team_agents a LEFT JOIN company_profiles cp ON cp.id = a.company_id
         LEFT JOIN projects p ON p.id = a.project_id LEFT JOIN company_profiles pc ON pc.id = p.company_id
        WHERE a.status = 'paused' AND a.paused_reason IN ('cap', 'spend_limit', 'daily_limit') ORDER BY a.updated_at DESC LIMIT 50`,
    ).all<any>();
    attention.push({ kind: 'paused_for_cap', label: 'Agents paused for their cap', items: (rs.results ?? []).map((r) => ({ agent: { uid: r.uid, name: personaName(r) }, team: teamOf(r), reason: r.paused_reason })) });
  } catch { attention.push({ kind: 'paused_for_cap', label: 'Agents paused for their cap', available: false, reason: 'Not recorded' }); }
  // H2 and H3 record these; until they land nothing does, so the panel says so instead of showing an empty list.
  attention.push({ kind: 'failing_golden_cases', label: 'Skills failing golden cases', available: false, reason: 'Not recorded' });
  attention.push({ kind: 'imports_waiting', label: 'Imports waiting for review', available: false, reason: 'Not recorded' });
  try {
    const rs = await env.DB.prepare(
      `SELECT model, strftime('%Y-%m-%d %H:00', created_at) AS hour, COUNT(*) AS n
         FROM ai_usage_logs WHERE agent_id IS NOT NULL AND refusal IS NOT NULL AND created_at >= ?
        GROUP BY model, hour HAVING COUNT(*) >= ? ORDER BY hour DESC LIMIT 20`,
    ).bind(d1, BURST_MIN).all<any>();
    attention.push({ kind: 'model_error_bursts', label: 'Model errors', items: (rs.results ?? []).map((r) => ({ model: r.model, hour: r.hour, errors: Number(r.n) })) });
  } catch { attention.push({ kind: 'model_error_bursts', label: 'Model errors', available: false, reason: 'Not recorded' }); }
  attention.push({ kind: 'flagged_company_skills', label: 'Flagged company skills', available: false, reason: 'Not recorded' });

  return {
    agents_active: agentsActive, teams,
    skills_published: { axal, companies },
    runs: { week: runsWeek, days_30: runs30 },
    spend_month: { spent_microusd: spend, budget_microusd: budget, share: budget && spend != null ? Math.round((spend / budget) * 1000) / 1000 : null },
    proposals_accepted_pct: pct(accepted, decided),
    runs_failed_pct: pct(failed, ended),
    needs_attention: attention,
    spend_by_area_30d: await spendByArea(env, d30),
  };
}

/** Spend over a window by the agent's area; an area whose rows carry an unrecorded charge reads null. */
async function spendByArea(env: Env, since: string) {
  const areas = await agentAreas(env);
  const sums = new Map<string, { s: number; unknown: boolean }>();
  let rows: any[] = [];
  try {
    rows = (await env.DB.prepare('SELECT agent_id, charged_microusd FROM ai_usage_logs WHERE agent_id IS NOT NULL AND created_at >= ?').bind(since).all<any>()).results ?? [];
  } catch { return RADAR_AXES.map((a) => ({ area: a.slug, label: a.label, spent_microusd: null })); }
  for (const r of rows) {
    const k = areas.get(Number(r.agent_id)) ?? 'unassigned';
    const cur = sums.get(k) ?? { s: 0, unknown: false };
    if (r.charged_microusd == null) cur.unknown = true; else cur.s += Number(r.charged_microusd);
    sums.set(k, cur);
  }
  const of = (k: string) => { const v = sums.get(k); return v ? (v.unknown ? null : v.s) : 0; };
  return [
    ...RADAR_AXES.map((a) => ({ area: a.slug, label: a.label, spent_microusd: of(a.slug) })),
    ...(sums.has('unassigned') ? [{ area: 'unassigned', label: 'No skill area', spent_microusd: of('unassigned') }] : []),
  ];
}

// ── SA7 · Runs ──────────────────────────────────────────────────────────────

export type RunFilters = { agent?: string; skill?: string; area?: string; team?: { kind: 'company' | 'project'; id: number }; status?: RunStatus; from?: string; to?: string; before?: number };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UID = /^[0-9A-Za-z-]{8,64}$/;

/** The run filters a query string asks for, or the name of the one that is wrong. */
export function runFiltersOf(q: Record<string, string | undefined>): RunFilters | { error: string } {
  const f: RunFilters = {};
  if (q.agent) { if (!UID.test(q.agent)) return { error: 'agent' }; f.agent = q.agent; }
  if (q.skill) { if (!UID.test(q.skill)) return { error: 'skill' }; f.skill = q.skill; }
  if (q.area) { if (!AREA_SLUGS.includes(q.area)) return { error: 'area' }; f.area = q.area; }
  if (q.team) {
    const m = /^(company|project):(\d{1,12})$/.exec(q.team);
    if (!m) return { error: 'team' };
    f.team = { kind: m[1] as 'company' | 'project', id: Number(m[2]) };
  }
  if (q.status) { if (!(RUN_STATUSES as readonly string[]).includes(q.status)) return { error: 'status' }; f.status = q.status as RunStatus; }
  if (q.from) { if (!DATE.test(q.from)) return { error: 'from' }; f.from = q.from; }
  if (q.to) { if (!DATE.test(q.to)) return { error: 'to' }; f.to = q.to; }
  if (q.cursor) { const n = Number(q.cursor); if (!Number.isSafeInteger(n) || n <= 0) return { error: 'cursor' }; f.before = n; }
  return f;
}

/** The run query: every filter is a nullable parameter (`? IS NULL OR …`), so the SQL text never changes. */
const RUN_QUERY = `SELECT r.id, r.uid, r.created_at, r.started_at, r.ended_at, r.status, r.step, r.steps_json, r.refusal, r.proposal_uid, r.usage_log_id,
         a.id AS agent_id, a.uid AS agent_uid, a.first_name, a.last_name, a.scope_kind, a.company_id, a.project_id,
         cp.company_name, p.name AS project_name, pc.company_name AS project_company_name,
         t.uid AS task_uid, t.title AS task_title, t.module AS task_module, t.option AS task_option, g.uid AS goal_uid,
         u.model, u.prompt_tokens, u.completion_tokens, u.charged_microusd, u.reservation_uid,
         pr.status AS proposal_status, pr.kind AS proposal_kind, pr.payload_json AS proposal_payload, pr.decided_at AS proposal_decided_at
    FROM agent_task_runs r
    JOIN team_agents a ON a.id = r.agent_id
    LEFT JOIN company_profiles cp ON cp.id = a.company_id
    LEFT JOIN projects p ON p.id = a.project_id
    LEFT JOIN company_profiles pc ON pc.id = p.company_id
    LEFT JOIN scope_tasks t ON t.id = r.task_id
    LEFT JOIN scope_goals g ON g.id = t.goal_id
    LEFT JOIN ai_usage_logs u ON u.id = r.usage_log_id
    LEFT JOIN ai_rail_proposals pr ON pr.uid = r.proposal_uid
   WHERE (? IS NULL OR r.uid = ?)
     AND (? IS NULL OR a.uid = ?)
     AND (? IS NULL OR EXISTS (SELECT 1 FROM agent_skill_links l JOIN agent_skills s ON s.id = l.skill_id WHERE l.agent_id = a.id AND s.uid = ?))
     AND (? IS NULL OR (a.scope_kind = ? AND IFNULL(a.company_id, a.project_id) = ?))
     AND (? IS NULL OR r.status IN (SELECT value FROM json_each(?)))
     AND (? IS NULL OR r.created_at >= ?)
     AND (? IS NULL OR r.created_at < datetime(?, '+1 day'))
     AND (? IS NULL OR r.id < ?)
     AND (? IS NULL OR a.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)))
   ORDER BY r.id DESC LIMIT ?`;

type RunQuery = RunFilters & { uid?: string; agentIds?: number[] };
function runBinds(f: RunQuery, limit: number): unknown[] {
  const two = (v: unknown) => [v ?? null, v ?? null];
  const status = f.status ? JSON.stringify(ENGINE_STATUSES[f.status]) : null;
  return [
    ...two(f.uid), ...two(f.agent), ...two(f.skill),
    f.team ? 1 : null, f.team?.kind ?? null, f.team?.id ?? null,
    ...two(status),
    ...two(f.from ? `${f.from} 00:00:00` : null), ...two(f.to ? `${f.to} 00:00:00` : null),
    ...two(f.before), ...two(f.agentIds ? JSON.stringify(f.agentIds) : null),
    limit,
  ];
}

async function skillsOf(env: Env, agentIds: number[]): Promise<Map<number, Array<{ uid: string; name: string; version: number }>>> {
  const out = new Map<number, Array<{ uid: string; name: string; version: number }>>();
  if (!agentIds.length) return out;
  try {
    const rs = await env.DB.prepare(
      `SELECT l.agent_id, s.uid, s.name, l.version FROM agent_skill_links l JOIN agent_skills s ON s.id = l.skill_id
        WHERE l.agent_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) ORDER BY s.name`,
    ).bind(JSON.stringify(agentIds)).all<any>();
    for (const r of rs.results ?? []) {
      const list = out.get(Number(r.agent_id)) ?? [];
      list.push({ uid: r.uid, name: r.name, version: Number(r.version) });
      out.set(Number(r.agent_id), list);
    }
  } catch { /* no skills tables: skills read as none */ }
  return out;
}

function runLine(r: any, skills: Array<{ uid: string; name: string; version: number }>, area: string | null) {
  return {
    uid: r.uid, at: r.created_at,
    agent: { uid: r.agent_uid, name: personaName(r) },
    skills, area,
    team: teamOf(r),
    model: r.model ?? null,
    tokens: r.usage_log_id == null ? null : Number(r.prompt_tokens ?? 0) + Number(r.completion_tokens ?? 0),
    cost_microusd: r.usage_log_id == null || r.charged_microusd == null ? null : Number(r.charged_microusd),
    status: runStatusOf(r.status),
    proposal_outcome: outcomeOf(r.proposal_status),
  };
}

export async function runLog(env: Env, f: RunFilters, limit = RUNS_PAGE) {
  const areas = await agentAreas(env);
  const agentIds = f.area ? [...areas].filter(([, a]) => a === f.area).map(([id]) => id) : undefined;
  const rs = await env.DB.prepare(RUN_QUERY).bind(...runBinds({ ...f, agentIds }, limit + 1)).all<any>();
  const all = rs.results ?? [];
  const page = all.slice(0, limit);
  const skills = await skillsOf(env, [...new Set(page.map((r) => Number(r.agent_id)))]);
  return {
    runs: page.map((r) => runLine(r, skills.get(Number(r.agent_id)) ?? [], areas.get(Number(r.agent_id)) ?? null)),
    next_cursor: all.length > limit ? Number(page[page.length - 1].id) : null,
  };
}

const parse = (s: unknown) => { if (typeof s !== 'string') return null; try { return JSON.parse(s); } catch { return null; } };

/** One run: its steps, its inputs as record references (never a member's email), its output, its cost against the hold, its errors. */
export async function runDetail(env: Env, uid: string) {
  const r = await env.DB.prepare(RUN_QUERY).bind(...runBinds({ uid }, 1)).first<any>();
  if (!r) return null;
  const [skills, areas] = await Promise.all([skillsOf(env, [Number(r.agent_id)]), agentAreas(env)]);
  const steps = (Array.isArray(parse(r.steps_json)) ? parse(r.steps_json) : []) as Array<Record<string, unknown>>;
  let hold: number | null = null;
  if (r.reservation_uid) {
    try {
      const h = await env.DB.prepare('SELECT included_microusd + topup_microusd AS held FROM ai_budget_reservations WHERE uid = ?').bind(r.reservation_uid).first<{ held: number }>();
      hold = h?.held == null ? null : Number(h.held);
    } catch { hold = null; }
  }
  const team = teamOf(r);
  const inputs = [
    r.task_uid ? { kind: 'task', ref: `task:${r.task_uid}`, label: r.task_title ?? null } : null,
    r.goal_uid ? { kind: 'goal', ref: `goal:${r.goal_uid}` } : null,
    { kind: 'team', ref: `${team.kind}:${team.id}` },
    r.task_module ? { kind: 'module', ref: `module:${r.task_module}${r.task_option ? `:${r.task_option}` : ''}` } : null,
    ...(skills.get(Number(r.agent_id)) ?? []).map((s) => ({ kind: 'skill', ref: `skill:${s.uid}@${s.version}`, label: s.name })),
  ].filter(Boolean);
  const line = runLine(r, skills.get(Number(r.agent_id)) ?? [], areas.get(Number(r.agent_id)) ?? null);
  return redactEmails({
    ...line,
    started_at: r.started_at ?? null, ended_at: r.ended_at ?? null, step: r.step ?? null,
    steps: steps.map((s) => ({ name: s.name ?? null, status: s.status ?? null, at: s.at ?? null, summary: typeof s.summary === 'string' ? s.summary : null })),
    inputs,
    output: r.proposal_uid
      ? { proposal: `proposal:${r.proposal_uid}`, kind: r.proposal_kind ?? null, outcome: outcomeOf(r.proposal_status), decided_at: r.proposal_decided_at ?? null, payload: parse(r.proposal_payload) }
      : null,
    cost: { charged_microusd: line.cost_microusd, hold_microusd: hold },
    errors: [
      ...(r.refusal ? [{ code: r.refusal }] : []),
      ...steps.filter((s) => s.status === 'failed' || s.status === 'refused' || s.status === 'halted').map((s) => ({ step: s.name ?? null, status: s.status, summary: typeof s.summary === 'string' ? s.summary : null })),
    ],
  });
}

// ── SA7b · Spend ────────────────────────────────────────────────────────────

/** Month-to-date spend grouped by agent, skill, company or model, the budget, the projection at the last 7 days' pace, and the teams at their cap. */
export async function spend(env: Env, by: SpendBy, now = new Date()) {
  const m = monthStart(now), d7 = ago(now, 7);
  const budget = await platformBudget(env);
  let rows: any[] = [];
  let readable = true;
  try {
    rows = (await env.DB.prepare(
      `SELECT u.agent_id, u.model, u.charged_microusd, u.created_at, a.uid AS agent_uid, a.first_name, a.last_name,
              COALESCE(a.company_id, p.company_id) AS company_id, COALESCE(cp.company_name, pc.company_name) AS company_name
         FROM ai_usage_logs u LEFT JOIN team_agents a ON a.id = u.agent_id
         LEFT JOIN company_profiles cp ON cp.id = a.company_id LEFT JOIN projects p ON p.id = a.project_id
         LEFT JOIN company_profiles pc ON pc.id = p.company_id
        WHERE u.agent_id IS NOT NULL AND u.created_at >= ?`,
    ).bind(m < d7 ? m : d7).all<any>()).results ?? [];
  } catch { readable = false; }
  const month = rows.filter((r) => String(r.created_at) >= m);
  const week = rows.filter((r) => String(r.created_at) >= d7);
  const sum = (xs: any[]) => (xs.some((x) => x.charged_microusd == null) ? null : xs.reduce((s, x) => s + Number(x.charged_microusd), 0));
  const spent = readable ? sum(month) : null;
  const weekSum = readable ? sum(week) : null;
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const daysLeft = daysInMonth - now.getUTCDate();
  const projected = spent == null || weekSum == null ? null : Math.round(spent + (weekSum / 7) * daysLeft);

  const groups = new Map<string, { key: string; label: string | null; rows: any[]; share?: number }>();
  const add = (key: string, label: string | null, r: any, share = 1) => {
    const g = groups.get(key) ?? { key, label, rows: [] };
    g.rows.push(share === 1 ? r : { ...r, charged_microusd: r.charged_microusd == null ? null : Number(r.charged_microusd) * share });
    groups.set(key, g);
  };
  if (by === 'skill') {
    const skills = await skillsOf(env, [...new Set(month.map((r) => Number(r.agent_id)))]);
    // A run's charge is shared evenly among the skills its agent carried; an agent with none counts under "No skill".
    for (const r of month) {
      const list = skills.get(Number(r.agent_id)) ?? [];
      if (!list.length) add('none', null, r);
      else for (const s of list) add(`skill:${s.uid}`, s.name, r, 1 / list.length);
    }
  } else {
    for (const r of month) {
      if (by === 'agent') add(`agent:${r.agent_uid ?? r.agent_id}`, personaName(r), r);
      else if (by === 'company') add(r.company_id == null ? 'none' : `company:${r.company_id}`, r.company_name ?? null, r);
      else add(`model:${r.model}`, r.model ?? null, r);
    }
  }
  const lines = [...groups.values()]
    .map((g) => { const s = sum(g.rows); return { key: g.key, label: g.label, spent_microusd: s == null ? null : Math.round(s), runs: g.rows.length }; })
    .sort((a, b) => (b.spent_microusd ?? -1) - (a.spent_microusd ?? -1));

  let atCap: unknown[] = [];
  try {
    const rs = await env.DB.prepare(
      `SELECT a.uid, a.first_name, a.last_name, a.monthly_cap_microusd, a.status, a.paused_reason, a.scope_kind, a.company_id, a.project_id,
              cp.company_name, p.name AS project_name, pc.company_name AS project_company_name,
              (SELECT COUNT(*) FROM ai_usage_logs u WHERE u.agent_id = a.id AND u.created_at >= ?) AS n,
              (SELECT COUNT(u.charged_microusd) FROM ai_usage_logs u WHERE u.agent_id = a.id AND u.created_at >= ?) AS known,
              (SELECT SUM(u.charged_microusd) FROM ai_usage_logs u WHERE u.agent_id = a.id AND u.created_at >= ?) AS spent
         FROM team_agents a LEFT JOIN company_profiles cp ON cp.id = a.company_id
         LEFT JOIN projects p ON p.id = a.project_id LEFT JOIN company_profiles pc ON pc.id = p.company_id
        WHERE a.status <> 'removed'`,
    ).bind(m, m, m).all<any>();
    atCap = (rs.results ?? [])
      .filter((r) => (r.status === 'paused' && PAUSED_FOR_CAP.includes(r.paused_reason)) || (Number(r.known) === Number(r.n) && Number(r.spent ?? 0) >= Number(r.monthly_cap_microusd)))
      .map((r) => ({ agent: { uid: r.uid, name: personaName(r) }, team: teamOf(r), cap_microusd: Number(r.monthly_cap_microusd), spent_microusd: Number(r.known) === Number(r.n) ? Number(r.spent ?? 0) : null }));
  } catch { atCap = []; }

  return {
    by, month: now.toISOString().slice(0, 7),
    spent_microusd: spent, budget_microusd: budget, projected_microusd: projected,
    lines, teams_at_cap: atCap,
  };
}
