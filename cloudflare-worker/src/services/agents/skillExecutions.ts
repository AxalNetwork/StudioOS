/**
 * D4536 part 4 (#4536) — the skill catalogue's executions, read for HQ's library response.
 *
 * WHAT A RUN IS HERE. A completed run: the model answered and the run wrote its proposal. `agentRun` tags that run's
 * usage row (and its guard rows) with `ai_usage_logs.skill_id` and `skill_version` at run time (`tagUsage`, after the
 * answer), on the manual and the scheduled path alike. It is the only record that names the skill AND the version a
 * run used:
 *  - a refused or failed run never names its skill (`refused()` logs `{ code, module, option }`; `tagUsage` is not
 *    reached), so refusal, failure and success RATES have no denominator and are `{ available: false }`;
 *  - `agent_task_runs` has no skill column, and a session's `agent_duties.skill_version` is rewritten on a re-pin, so
 *    a scheduled run's skill is never derived from its session at read time;
 *  - evaluation runs (`agent_skill_version_evals`, `agent_skill_eval_results`, the rubric) never call `tagUsage`, so
 *    they are not counted as executions.
 *
 * WHAT IS MEASURED, per completed run (the parent usage row, `guard_for IS NULL`, and its guard rows):
 *  - tokens: prompt + completion over the parent and its guard rows;
 *  - charge: `charged_microusd` summed over the same rows, as `agentRun.chargedFor` sums it, in integer micro-USD.
 *    A run with any row's charge NULL is `unrecorded`. A run whose `run` event says an earlier account attempt was
 *    tried (`accounts_tried > 1`) is `incomplete`: those attempts' rows are not skill-tagged, so its charge is not
 *    the run's whole spend. Neither kind is summed, so the total is never an estimate;
 *  - model-call latency: the parent row's `latency_ms` (> 0), nearest-rank p50 and p95. It is the model call, not the
 *    run (no run records a start and an end for the whole run; a scheduled run's `ended_at` includes a person's wait);
 *  - the path: scheduled when an `agent_task_runs` row names the usage row, else manual.
 *
 * Detail is HQ skills only. A company skill's runs are counted by scope, never by skill (the D4161 boundary).
 * Every figure is defined in `documentation/architecture/SKILL_ANALYTICS_METRICS.md`. The proposal board of #3851 is
 * not read.
 */
import { matchesSkill, type SkillFilters, type Unavailable } from './skillCoverage.ts';

/** With no `from`/`to` filter, the window is the last 30 whole UTC days ending today (today included). */
export const EXECUTIONS_DEFAULT_DAYS = 30;
const DAY_MS = 86_400_000;
const sqlDay = (ms: number) => `${new Date(ms).toISOString().slice(0, 10)} 00:00:00`;

/** The window a read covers: the filter's, else the default. `since` inclusive, `until` exclusive, both UTC. */
export function executionsWindow(f: SkillFilters | null, now: Date): { since: string; until: string; days: number; source: 'filter' | 'default' } {
  if (f?.window) return { since: f.window.since, until: f.window.until, days: f.window.days, source: 'filter' };
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { since: sqlDay(today - (EXECUTIONS_DEFAULT_DAYS - 1) * DAY_MS), until: sqlDay(today + DAY_MS), days: EXECUTIONS_DEFAULT_DAYS, source: 'default' };
}

/**
 * Completed runs, grouped by skill, executed version, model, agent role and path. Bound: since, until, model, model.
 * The per-run subqueries use `idx_ai_usage_logs_guard_for`, `idx_team_agent_events_agent` and
 * `idx_agent_task_runs_agent` (each keyed by the run's own agent), so no table is scanned once per run.
 */
export const EXECUTIONS_SQL = `WITH runs AS (
    SELECT u.id, u.skill_id, u.skill_version, u.model, u.agent_id,
      u.prompt_tokens + u.completion_tokens
        + COALESCE((SELECT SUM(g.prompt_tokens + g.completion_tokens) FROM ai_usage_logs g WHERE g.guard_for = u.id), 0) AS tokens,
      CASE WHEN u.charged_microusd IS NULL
          OR EXISTS (SELECT 1 FROM ai_usage_logs g WHERE g.guard_for = u.id AND g.charged_microusd IS NULL) THEN NULL
        ELSE u.charged_microusd + COALESCE((SELECT SUM(g.charged_microusd) FROM ai_usage_logs g WHERE g.guard_for = u.id), 0)
      END AS charge,
      EXISTS (SELECT 1 FROM team_agent_events e WHERE e.agent_id = u.agent_id AND e.usage_log_id = u.id AND e.kind = 'run'
        AND COALESCE(json_extract(e.detail_json, '$.accounts_tried'), 1) > 1) AS earlier_attempts,
      EXISTS (SELECT 1 FROM agent_task_runs t WHERE t.agent_id = u.agent_id AND t.usage_log_id = u.id) AS scheduled
    FROM ai_usage_logs u
    WHERE u.skill_id IS NOT NULL AND u.guard_for IS NULL
      AND datetime(u.created_at) >= datetime(?) AND datetime(u.created_at) < datetime(?)
      AND (? IS NULL OR u.model = ?)
  )
  SELECT s.id AS skill_id, s.scope, s.status, s.current_version,
    CASE WHEN s.scope = 'hq' THEN s.uid END AS uid,
    CASE WHEN s.scope = 'hq' THEN v.roles_json END AS published_roles_json,
    CASE WHEN s.scope = 'hq' THEN v.taxonomy_json END AS published_tags_json,
    r.skill_version AS version, r.model, a.role_key, r.scheduled,
    COUNT(*) AS completed, SUM(r.tokens) AS tokens,
    SUM(CASE WHEN r.charge IS NOT NULL AND NOT r.earlier_attempts THEN 1 ELSE 0 END) AS charge_recorded,
    SUM(CASE WHEN r.charge IS NULL THEN 1 ELSE 0 END) AS charge_unrecorded,
    SUM(CASE WHEN r.charge IS NOT NULL AND r.earlier_attempts THEN 1 ELSE 0 END) AS charge_incomplete,
    SUM(CASE WHEN r.charge IS NOT NULL AND NOT r.earlier_attempts THEN r.charge ELSE 0 END) AS charge_microusd
  FROM runs r JOIN agent_skills s ON s.id = r.skill_id
  LEFT JOIN agent_skill_versions v ON v.skill_id = s.id AND v.version = s.current_version
  LEFT JOIN team_agents a ON a.id = r.agent_id
  GROUP BY s.id, r.skill_version, r.model, a.role_key, r.scheduled`;

/**
 * Nearest-rank p50 and p95 of the model call's `latency_ms`, per (skill, version) and over every run read, for the
 * skills the filters kept. Only the rows at those ranks leave SQL. Bound: skill ids (JSON array), since, until, model,
 * model, version, version.
 */
export const EXECUTION_LATENCY_SQL = `WITH r AS (
    SELECT u.skill_id, u.skill_version, u.latency_ms FROM ai_usage_logs u
    WHERE u.skill_id IN (SELECT value FROM json_each(?)) AND u.guard_for IS NULL AND u.latency_ms > 0
      AND datetime(u.created_at) >= datetime(?) AND datetime(u.created_at) < datetime(?)
      AND (? IS NULL OR u.model = ?) AND (? IS NULL OR u.skill_version = ?)
  ), per AS (
    SELECT skill_id, skill_version, latency_ms,
      ROW_NUMBER() OVER (PARTITION BY skill_id, skill_version ORDER BY latency_ms) AS rn,
      COUNT(*) OVER (PARTITION BY skill_id, skill_version) AS n FROM r
  ), overall AS (
    SELECT latency_ms, ROW_NUMBER() OVER (ORDER BY latency_ms) AS rn, COUNT(*) OVER () AS n FROM r
  )
  SELECT 'version' AS kind, skill_id, skill_version, latency_ms, rn, n FROM per
    WHERE rn = (n * 50 + 99) / 100 OR rn = (n * 95 + 99) / 100
  UNION ALL
  SELECT 'overall' AS kind, NULL, NULL, latency_ms, rn, n FROM overall
    WHERE rn = (n * 50 + 99) / 100 OR rn = (n * 95 + 99) / 100`;

export type ExecutionRow = {
  skill_id: number; scope: 'hq' | 'company'; status: string; current_version: number; uid: string | null;
  published_roles_json: string | null; published_tags_json: string | null;
  version: number; model: string; role_key: string | null; scheduled: number;
  completed: number; tokens: number; charge_recorded: number; charge_unrecorded: number; charge_incomplete: number; charge_microusd: number;
};
export type LatencyRow = { kind: 'version' | 'overall'; skill_id: number | null; skill_version: number | null; latency_ms: number; rn: number; n: number };
/** A published HQ skill as coverage read it, to name the ones with no completed run. */
export type PublishedSkill = { uid?: string | null; status: string; scope: 'hq' | 'company' };

type Charge = { microusd: number; runs_recorded: number; runs_unrecorded: number; runs_incomplete: number };
type Latency = { p50: number; p95: number; runs_measured: number } | Unavailable;
type Tally = { completed: number; tokens: number; charge: Charge; scheduled: number; manual: number };

const NO_LATENCY: Unavailable = { available: false, reason: 'No completed run in this window recorded a model-call latency.' };
const tally = (): Tally => ({ completed: 0, tokens: 0, charge: { microusd: 0, runs_recorded: 0, runs_unrecorded: 0, runs_incomplete: 0 }, scheduled: 0, manual: 0 });
function add(t: Tally, r: ExecutionRow) {
  const n = Number(r.completed);
  t.completed += n;
  t.tokens += Number(r.tokens) || 0;
  t.charge.microusd += Number(r.charge_microusd) || 0;
  t.charge.runs_recorded += Number(r.charge_recorded) || 0;
  t.charge.runs_unrecorded += Number(r.charge_unrecorded) || 0;
  t.charge.runs_incomplete += Number(r.charge_incomplete) || 0;
  if (Number(r.scheduled)) t.scheduled += n; else t.manual += n;
}
/** Actual charge per completed run, over the runs whose whole charge is recorded; rounded to the nearest micro-USD. */
const perRun = (c: Charge): number | Unavailable => c.runs_recorded > 0
  ? Math.round(c.microusd / c.runs_recorded)
  : { available: false, reason: 'No completed run in this window has its whole charge recorded.' };
const shape = (t: Tally) => ({
  completed: t.completed, tokens: t.tokens, charge: t.charge,
  cost_per_completed_microusd: perRun(t.charge), by_path: { scheduled: t.scheduled, manual: t.manual },
});

function latencyOf(rows: readonly LatencyRow[]): Latency {
  if (!rows.length) return NO_LATENCY;
  const n = Number(rows[0].n);
  const at = (p: number) => rows.find((r) => Number(r.rn) === Math.floor((n * p + 99) / 100))?.latency_ms;
  const p50 = at(50), p95 = at(95);
  return p50 == null || p95 == null ? NO_LATENCY : { p50: Number(p50), p95: Number(p95), runs_measured: n };
}

/**
 * The `executions` block, pure over the two reads. `rows` is every group the window read; the filters' skill terms
 * keep HQ skills (by their current published version, as coverage does), except `version`, which keeps that EXECUTED
 * version. `published` is coverage's rows after the same filters, so "no completed run" names the matched skills only.
 */
export function skillExecutions(rows: readonly ExecutionRow[], latency: readonly LatencyRow[] | 'unreadable', ctx: {
  filters: SkillFilters | null; category: ReadonlyMap<string, string>; window: ReturnType<typeof executionsWindow>;
  published: readonly PublishedSkill[];
}) {
  const f = ctx.filters;
  // The window and the model narrow every run in SQL, a company skill's included. A skill term (scope, status, uid,
  // version, category, tag, role) cannot match a company skill, whose tags and roles are never read.
  const bySkillTerm = f != null && [f.scope, f.status, f.uid, f.version, f.category, f.tag, f.role].some((v) => v != null);
  const skillTerms = f ? { ...f, version: null } : null;
  const company = tally();
  const hq = tally();
  const bySkill = new Map<string, { status: string; current_version: number; t: Tally; versions: Map<number, Tally>; skill_id: number;
    models: Record<string, number>; roles: Record<string, number> }>();
  for (const r of rows) {
    if (r.scope !== 'hq') { add(company, r); continue; }
    if (skillTerms && !matchesSkill(r, skillTerms, ctx.category)) continue;
    if (f?.version != null && Number(r.version) !== f.version) continue;
    add(hq, r);
    const uid = r.uid as string;
    let s = bySkill.get(uid);
    if (!s) bySkill.set(uid, s = { status: r.status, current_version: Number(r.current_version), t: tally(), versions: new Map(), skill_id: Number(r.skill_id), models: {}, roles: {} });
    add(s.t, r);
    const v = Number(r.version);
    if (!s.versions.has(v)) s.versions.set(v, tally());
    add(s.versions.get(v)!, r);
    s.models[r.model] = (s.models[r.model] ?? 0) + Number(r.completed);
    const role = r.role_key ?? 'not_recorded';
    s.roles[role] = (s.roles[role] ?? 0) + Number(r.completed);
  }
  const lat = latency === 'unreadable' ? null : latency;
  const latencyFor = (skillId: number | null, version: number | null): Latency => lat == null
    ? { available: false, reason: 'The latency read failed.' }
    : latencyOf(lat.filter((l) => l.kind === (skillId == null ? 'overall' : 'version') && (skillId == null || (Number(l.skill_id) === skillId && Number(l.skill_version) === version))));
  const ran = new Set(bySkill.keys());
  const idle = ctx.published.filter((p) => p.scope === 'hq' && p.status === 'published' && p.uid && !ran.has(p.uid)).map((p) => p.uid as string).sort();
  const skills = [...bySkill.entries()]
    .sort(([a, x], [b, y]) => y.t.completed - x.t.completed || (a < b ? -1 : a > b ? 1 : 0))
    .map(([uid, s]) => ({
      skill_uid: uid, status: s.status, current_version: s.current_version || null, ...shape(s.t),
      by_model: s.models, by_role: s.roles,
      by_version: [...s.versions.entries()].sort(([a], [b]) => b - a).map(([version, t]) => ({ version, ...shape(t), model_latency_ms: latencyFor(s.skill_id, version) })),
    }));
  return {
    available: true as const,
    counts: 'completed_runs' as const,
    window: ctx.window,
    totals: { ...shape(hq), model_latency_ms: latencyFor(null, null) },
    by_scope: {
      hq: { completed: hq.completed },
      company: bySkillTerm ? { available: false, reason: "A company skill's tags and roles are never read, so no filter can match it." } as Unavailable : { completed: company.completed },
    },
    outcomes: { available: false, reason: 'A refused or failed run records no skill, so success, refusal and failure rates have no denominator.' } as Unavailable,
    run_latency: { available: false, reason: 'No run records when the whole run started and ended; model_latency_ms is the model call only.' } as Unavailable,
    workflows: { available: false, reason: 'Waits on a workflow\'s stable identity (#4535).' } as Unavailable,
    published_without_completed_runs: { count: idle.length, skill_uids: idle },
    skills,
  };
}
export type SkillExecutions = ReturnType<typeof skillExecutions>;
