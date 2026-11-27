/**
 * D4536 part 4 (#4536) — the skill catalogue's executions, read for HQ's library response.
 *
 * WHAT A RUN IS HERE. A completed run: the model answered and the run wrote its proposal. `agentRun` tags that run's
 * usage row (and its guard rows) with `ai_usage_logs.skill_id` and `skill_version` at run time (`tagUsage`, after the
 * answer), on the manual and the scheduled path alike. It is the only record that names the skill AND the version a
 * run used:
 *  - a refused or failed run is not tagged (`tagUsage` is not reached). From D4536 part 4 on (owner answer A), its
 *    `refused` event names the skill, the version once read, the HTTP status and `outcome_v: 1`, as every `run` event
 *    carries `outcome_v: 1`; the rates (`outcomes`) count marked events only, so nothing from before the change
 *    enters a denominator, and `attributed_since` says where they start;
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
 *
 * D8912 (#8912): a company's editors read the same block over their own skills (`subject: 'company'`). The run, the
 * charge and the outcome are defined once: `COMPANY_EXECUTIONS_SQL` and `COMPANY_OUTCOMES_SQL` share the HQ reads'
 * text and only narrow them, in SQL, to that company's skills, so no other company's run, uid or count is read out.
 */
import { matchesSkill, type SkillFilters, type Subject, type Unavailable } from './skillCoverage.ts';

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

// The completed runs and what each one cost, written once for both reads (D8912). Bound: since, until, model, model.
const RUNS_FROM = `WITH runs AS (
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
      AND (? IS NULL OR u.model = ?)`;
// The groups and their sums, written once for both reads.
const RUN_GROUPS = `r.skill_version AS version, r.model, a.role_key, r.scheduled,
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
 * Completed runs, grouped by skill, executed version, model, agent role and path. Bound: since, until, model, model.
 * The per-run subqueries use `idx_ai_usage_logs_guard_for`, `idx_team_agent_events_agent` and
 * `idx_agent_task_runs_agent` (each keyed by the run's own agent), so no table is scanned once per run.
 */
export const EXECUTIONS_SQL = `${RUNS_FROM}
  )
  SELECT s.id AS skill_id, s.scope, s.status, s.current_version,
    CASE WHEN s.scope = 'hq' THEN s.uid END AS uid,
    CASE WHEN s.scope = 'hq' THEN v.roles_json END AS published_roles_json,
    CASE WHEN s.scope = 'hq' THEN v.taxonomy_json END AS published_tags_json,
    ${RUN_GROUPS}`;

/**
 * D8912: the same runs, one company's skills only, narrowed inside `runs` so no other company's usage row is read
 * further. Its own skills are named (uid, current roles and tags). Bound: since, until, model, model, company id.
 */
export const COMPANY_EXECUTIONS_SQL = `${RUNS_FROM}
      AND u.skill_id IN (SELECT id FROM agent_skills WHERE scope = 'company' AND company_id = ?)
  )
  SELECT s.id AS skill_id, s.scope, s.status, s.current_version, s.uid,
    v.roles_json AS published_roles_json, v.taxonomy_json AS published_tags_json,
    ${RUN_GROUPS}`;

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

/**
 * D4536-p4 (owner answer A): outcomes over the `run` and `refused` events marked `outcome_v = 1` (agentRun's and the
 * loop's, from the change on), for HQ skills. Bound: since, until. Events have no model, so a model filter makes the
 * outcomes unavailable. A company skill is never joined (`s.scope = 'hq'`), so its uid never leaves SQL.
 */
const OUTCOMES_SELECT = `SELECT s.id AS skill_id, s.uid, s.status, s.current_version, s.scope,
    v.roles_json AS published_roles_json, v.taxonomy_json AS published_tags_json,
    e.kind, json_extract(e.detail_json, '$.code') AS code, json_extract(e.detail_json, '$.status') AS http_status,
    json_extract(e.detail_json, '$.skill.version') AS version, COUNT(*) AS n, MIN(e.created_at) AS first_at
  FROM team_agent_events e
  JOIN agent_skills s ON s.uid = json_extract(e.detail_json, '$.skill.uid')`;
const OUTCOMES_WHERE = `LEFT JOIN agent_skill_versions v ON v.skill_id = s.id AND v.version = s.current_version
  WHERE e.kind IN ('run', 'refused') AND json_extract(e.detail_json, '$.outcome_v') = 1
    AND datetime(e.created_at) >= datetime(?) AND datetime(e.created_at) < datetime(?)
  GROUP BY s.id, e.kind, code, http_status, version`;
export const OUTCOMES_SQL = `${OUTCOMES_SELECT} AND s.scope = 'hq'
  ${OUTCOMES_WHERE}`;
/** D8912: the same outcomes, one company's skills only. Bound: company id, since, until. */
export const COMPANY_OUTCOMES_SQL = `${OUTCOMES_SELECT} AND s.scope = 'company' AND s.company_id = ?
  ${OUTCOMES_WHERE}`;

/** A run that reached the model and did not finish: the model, the gateway, the accounts, the guard, or saving it. */
export const FAILED_CODES: ReadonlySet<string> = new Set([
  'gateway_limit', 'model_throttled', 'run_failed', 'all_models_failed', 'step_lost', 'proposal_not_saved',
  'accounts_unconfigured', 'accounts_exhausted', 'account_failed', 'guard_blocked', 'guard_unavailable',
  'gateway_required', 'gateway_misconfigured',
]);
/** Not an outcome: the step is retried (a step still in flight, or another 5xx the engine retries). */
export const isRetryable = (code: string, status: number | null) => code === 'step_in_flight' || (status != null && status >= 500 && !FAILED_CODES.has(code));

export type OutcomeRow = {
  skill_id: number; uid: string; status: string; current_version: number; scope: Subject;
  published_roles_json: string | null; published_tags_json: string | null;
  kind: 'run' | 'refused'; code: string | null; http_status: number | null; version: number | null; n: number; first_at: string;
};

export type ExecutionRow = {
  skill_id: number; scope: 'hq' | 'company'; status: string; current_version: number; uid: string | null;
  published_roles_json: string | null; published_tags_json: string | null;
  version: number; model: string; role_key: string | null; scheduled: number;
  completed: number; tokens: number; charge_recorded: number; charge_unrecorded: number; charge_incomplete: number; charge_microusd: number;
};
export type LatencyRow = { kind: 'version' | 'overall'; skill_id: number | null; skill_version: number | null; latency_ms: number; rn: number; n: number };
/** A published skill of the subject as coverage read it, to name the ones with no completed run. */
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
  published: readonly PublishedSkill[]; outcomes?: readonly OutcomeRow[] | 'unreadable';
  /**
   * D8912: whose skills are detailed (default HQ). In a company's read every row is that company's (its SQL says so);
   * a row of any other scope is dropped, never counted, and `by_scope` is the company's own count only.
   */
  subject?: Subject;
}) {
  const f = ctx.filters;
  const subject: Subject = ctx.subject ?? 'hq';
  // The window and the model narrow every run in SQL, a company skill's included. A skill term (scope, status, uid,
  // version, category, tag, role) cannot match a company skill, whose tags and roles are never read.
  const bySkillTerm = f != null && [f.scope, f.status, f.uid, f.version, f.category, f.tag, f.role].some((v) => v != null);
  const skillTerms = f ? { ...f, version: null } : null;
  const company = tally();
  const hq = tally();
  const bySkill = new Map<string, { status: string; current_version: number; t: Tally; versions: Map<number, Tally>; skill_id: number;
    models: Record<string, number>; roles: Record<string, number> }>();
  for (const r of rows) {
    if (r.scope !== subject) { if (subject === 'hq') add(company, r); continue; }
    if (skillTerms && !matchesSkill(r, skillTerms, ctx.category, subject)) continue;
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
  const idle = ctx.published.filter((p) => p.scope === subject && p.status === 'published' && p.uid && !ran.has(p.uid)).map((p) => p.uid as string).sort();
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
    // D8912: a company's read counts its own runs (in `hq`'s tally, the subject's) and nothing of HQ's.
    by_scope: subject === 'company' ? { company: { completed: hq.completed } } as { hq?: undefined; company: { completed: number } } : {
      hq: { completed: hq.completed },
      company: bySkillTerm ? { available: false, reason: "A company skill's tags and roles are never read, so no filter can match it." } as Unavailable : { completed: company.completed },
    },
    outcomes: outcomesOf(ctx.outcomes ?? [], f, skillTerms, ctx.category, subject),
    run_latency: { available: false, reason: 'No run records when the whole run started and ended; model_latency_ms is the model call only.' } as Unavailable,
    workflows: { available: false, reason: 'Waits on a workflow\'s stable identity (#4535).' } as Unavailable,
    published_without_completed_runs: { count: idle.length, skill_uids: idle },
    skills,
  };
}
export type SkillExecutions = ReturnType<typeof skillExecutions>;

type OutcomeTally = { completed: number; refused: number; failed: number; retryable: number; by_code: Record<string, number> };
const rate = (n: number, d: number): number | Unavailable => d > 0 ? Math.round((n / d) * 10_000) / 10_000
  : { available: false, reason: 'No attributed run ended in this window.' };
const outcomeShape = (t: OutcomeTally) => {
  const ended = t.completed + t.refused + t.failed;
  return { ...t, ended, rates: { success: rate(t.completed, ended), refusal: rate(t.refused, ended), failure: rate(t.failed, ended) } };
};

/**
 * Outcome rates over marked events only. A run is completed (a `run` event), failed (a code in FAILED_CODES), or
 * refused (any other code); a retryable refusal is counted apart and never enters `ended`, the rates' denominator.
 */
function outcomesOf(rows: readonly OutcomeRow[] | 'unreadable', f: SkillFilters | null, skillTerms: SkillFilters | null, category: ReadonlyMap<string, string>, subject: Subject) {
  if (rows === 'unreadable') return { available: false, reason: 'The run and refusal events could not be read.' } as Unavailable;
  if (f?.model != null) return { available: false, reason: 'A run or refusal event records no model, so a model filter cannot narrow the outcomes.' } as Unavailable;
  const kept = rows.filter((r) => r.scope === subject && (!skillTerms || matchesSkill(r, skillTerms, category, subject)) && (f?.version == null || Number(r.version) === f.version));
  if (!kept.length) return { available: false, reason: 'No run or refusal in this window carries its skill: attribution started with D4536 part 4.' } as Unavailable;
  const blank = (): OutcomeTally => ({ completed: 0, refused: 0, failed: 0, retryable: 0, by_code: {} });
  const all = blank();
  const bySkill = new Map<string, OutcomeTally>();
  let first: string | null = null;
  for (const r of kept) {
    const n = Number(r.n);
    if (first == null || r.first_at < first) first = r.first_at;
    const t = bySkill.get(r.uid) ?? blank();
    bySkill.set(r.uid, t);
    for (const x of [all, t]) {
      if (r.kind === 'run') { x.completed += n; continue; }
      const code = String(r.code ?? 'not_recorded');
      x.by_code[code] = (x.by_code[code] ?? 0) + n;
      const status = r.http_status == null ? null : Number(r.http_status);
      if (isRetryable(code, status)) x.retryable += n;
      else if (FAILED_CODES.has(code)) x.failed += n;
      else x.refused += n;
    }
  }
  return {
    available: true as const,
    attributed_since: first,
    totals: outcomeShape(all),
    skills: [...bySkill.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([skill_uid, t]) => ({ skill_uid, ...outcomeShape(t) })),
  };
}
