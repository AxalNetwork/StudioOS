/**
 * D4536 (#4536) — the skill catalogue's coverage, read for HQ's library response.
 *
 * Pure over aggregate rows, so the route reads it in a fixed number of queries and the counts are tested without D1.
 * Every figure is defined in `documentation/architecture/SKILL_ANALYTICS_METRICS.md` (source, grouping, denominator,
 * availability). Nothing here is a run: linked agents are adoption, never usage, and a measure with no source is
 * `{ available: false, reason }`, never 0.
 *
 * Published coverage reads each skill's CURRENT published version (`agent_skill_versions.roles_json` and
 * `taxonomy_json`), which is what an agent can attach and run. Draft completeness reads the working draft's tables.
 * A company skill is counted by scope and status only: no company slug, role or tag leaves this function.
 *
 * D4536-p2 (#5969): `publishedEvaluation`, the published versions' evaluation across the catalogue, from the
 * published history alone (`agent_skill_version_evals`); never the draft history. See its section below.
 *
 * D5970 (#5970): `parseSkillFilters` and `matchesSkill`, the validated filters that narrow both blocks. See the last
 * section below; which filter applies to which block is `FILTER_BLOCKS`.
 *
 * D8912 (#8912): the same measures for one company's own skills (`subject: 'company'`), read by that company's
 * editors (`routes/team_skill_analytics.ts`). The definitions are these functions, never a copy: `subject` only says
 * whose skills are detailed. The company's rows are narrowed to its own skills in SQL (`COMPANY_COVERAGE_SQL`,
 * `COMPANY_LINKS_SQL`), so no HQ draft and no other company's uid, slug or count reaches this function.
 */
import { RADAR_AXES } from '../skillsTaxonomySchema.ts';
import { CATALOGUE } from '../ai/catalogue.ts';
import { MODEL_CONNECTIONS } from '../ai/moduleConnections.ts';
import { compareResults, pairOutcome, type PairOutcome, type ResultRow } from './skillEvalCompare.ts';

/** Whose skills a read details: HQ's catalogue (the Super Admin read), or one company's own (D8912). */
export type Subject = 'hq' | 'company';

/** One `agent_skills` row with its aggregates; in the HQ read, `slug` and `uid` are null for a company skill. */
export type CoverageRow = {
  scope: 'hq' | 'company';
  status: 'draft' | 'published' | 'retired';
  slug: string | null;
  /** D5970: what a `uid` filter matches; read for an HQ skill only, and in a company's read (D8912) for its own. */
  uid?: string | null;
  current_version: number;
  published_roles_json: string | null;
  published_tags_json: string | null;
  live_cases: number;
  draft_roles: number;
  draft_tags: number;
  review_requested: number;
};
export type AdoptionRow = { links: number; agents: number; behind_current: number; published_without_links: number };
export type Unavailable = { available: false; reason: string };

// D8912: the per-skill aggregates coverage counts, written once for both reads so the two never define them apart.
const COVERAGE_AGGREGATES = `(SELECT COUNT(*) FROM agent_skill_cases k WHERE k.skill_id = s.id AND k.removed_at IS NULL) AS live_cases,
        (SELECT COUNT(*) FROM agent_skill_roles r WHERE r.skill_id = s.id) AS draft_roles,
        (SELECT COUNT(*) FROM agent_skill_tags t WHERE t.skill_id = s.id) AS draft_tags,
        EXISTS (SELECT 1 FROM agent_skill_reviews q WHERE q.skill_id = s.id AND q.status = 'requested') AS review_requested`;
/** D4536: every skill's scope and status, and an HQ skill's current published roles and tags. No bind. */
export const HQ_COVERAGE_SQL = `SELECT s.scope, s.status, s.current_version,
        CASE WHEN s.scope = 'hq' THEN s.uid END AS uid,
        CASE WHEN s.scope = 'hq' THEN s.slug END AS slug,
        CASE WHEN s.scope = 'hq' THEN v.roles_json END AS published_roles_json,
        CASE WHEN s.scope = 'hq' THEN v.taxonomy_json END AS published_tags_json,
        ${COVERAGE_AGGREGATES}
      FROM agent_skills s LEFT JOIN agent_skill_versions v ON v.skill_id = s.id AND v.version = s.current_version`;
/** D8912: one company's own skills, with their current published roles and tags. Bound: the company id. */
export const COMPANY_COVERAGE_SQL = `SELECT s.scope, s.status, s.current_version, s.uid, s.slug,
        v.roles_json AS published_roles_json, v.taxonomy_json AS published_tags_json,
        ${COVERAGE_AGGREGATES}
      FROM agent_skills s LEFT JOIN agent_skill_versions v ON v.skill_id = s.id AND v.version = s.current_version
      WHERE s.scope = 'company' AND s.company_id = ?`;
const LINKS_SELECT = `SELECT s.uid, COUNT(l.id) AS links, group_concat(DISTINCT l.agent_id) AS agent_ids,
        COALESCE(SUM(CASE WHEN l.version < s.current_version THEN 1 ELSE 0 END), 0) AS behind_current
      FROM agent_skill_links l`;
const LINKS_AGENTS = `JOIN team_agents a ON a.id = l.agent_id AND a.status <> 'removed'
      GROUP BY s.id`;
/** D4536: the pins per linked HQ skill, active agents only. No bind. */
export const HQ_LINKS_SQL = `${LINKS_SELECT} JOIN agent_skills s ON s.id = l.skill_id AND s.scope = 'hq'
      ${LINKS_AGENTS}`;
/** D8912: the pins per linked skill of one company, active agents only. Bound: the company id. */
export const COMPANY_LINKS_SQL = `${LINKS_SELECT} JOIN agent_skills s ON s.id = l.skill_id AND s.scope = 'company' AND s.company_id = ?
      ${LINKS_AGENTS}`;

/** An area with fewer published skills than this, by primary tag, is `thin`; none at all is `none`. */
export const THIN_BELOW = 3;

const parse = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};

type Counts = { draft: number; published: number; retired: number; review_requested: number };
const counts = (): Counts => ({ draft: 0, published: 0, retired: 0, review_requested: 0 });

export function catalogueCoverage(rows: readonly CoverageRow[], ctx: {
  /**
   * D8912: whose skills are detailed (default HQ). A company's read holds that company's rows only: `by_scope` is its
   * own counts, and the source library (Axal's files) and draft evaluation (HQ release evidence, D4533) are unavailable.
   */
  subject?: Subject;
  category: ReadonlyMap<string, string>;
  roleKeys: readonly string[];
  librarySlugs: readonly string[];
  adoption: AdoptionRow;
  /** HQ drafts whose required runs under the current evidence are not all recorded; null when this read did not compute them. */
  draftsWithoutCurrentEvaluation: number | null;
  /**
   * D5970: the rows were narrowed by a filter. A company skill's tags and roles are never read, so no filter can
   * match it: its counts are unavailable, never 0. The library files and the drafts' evaluation are not filtered.
   */
  filtered?: boolean;
}) {
  const subject: Subject = ctx.subject ?? 'hq';
  const byScope = { hq: counts(), company: counts() };
  const byRole = new Map<string, number>(ctx.roleKeys.map((k) => [k, 0]));
  const byArea = new Map<string, { primary: number; any: number }>(RADAR_AXES.map((a) => [a.slug, { primary: 0, any: 0 }]));
  const byTag = new Map<string, { primary: number; secondary: number }>();
  const byLevel = new Map<string, number>();
  const drafts = { total: 0, without_cases: 0, without_roles: 0, without_tags: 0 };
  const hqSlugs = new Map<string, CoverageRow>();
  let untaggedPublished = 0;

  for (const r of rows) {
    const c = byScope[r.scope];
    c[r.status]++;
    if (r.status !== 'retired' && r.review_requested) c.review_requested++;
    if (r.scope !== subject) continue;
    if (r.slug) hqSlugs.set(r.slug, r);
    if (r.status === 'draft') {
      drafts.total++;
      if (!r.live_cases) drafts.without_cases++;
      if (!r.draft_roles) drafts.without_roles++;
      if (!r.draft_tags) drafts.without_tags++;
    }
    // Retired skills cannot be attached, so they cover nothing; a draft never published has no version to run.
    if (r.status !== 'published' || r.current_version < 1) continue;
    for (const role of new Set(parse<string[]>(r.published_roles_json, []))) {
      if (byRole.has(role)) byRole.set(role, byRole.get(role)! + 1);
    }
    const tags = parse<Array<{ slug: string; level: string }>>(r.published_tags_json, []);
    if (!tags.length) untaggedPublished++;
    const areas = new Set<string>();
    tags.forEach((t, i) => {
      const entry = byTag.get(t.slug) ?? { primary: 0, secondary: 0 };
      if (i === 0) entry.primary++; else entry.secondary++;
      byTag.set(t.slug, entry);
      const area = ctx.category.get(t.slug);
      if (area && byArea.has(area)) {
        if (i === 0) byArea.get(area)!.primary++;
        areas.add(area);
      }
    });
    if (tags[0]) byLevel.set(tags[0].level, (byLevel.get(tags[0].level) ?? 0) + 1);
    for (const a of areas) byArea.get(a)!.any++;
  }

  const library = new Set(ctx.librarySlugs);
  const sourceOnly = [...library].filter((s) => !hqSlugs.has(s)).sort();
  const seeded = [...library].filter((s) => hqSlugs.has(s));

  const company = subject === 'company';
  return {
    by_scope: company
      ? { company: byScope.company } as { hq?: undefined; company: Counts }
      : ctx.filtered
        ? { hq: byScope.hq, company: { available: false, reason: 'A filtered read is HQ only: a company skill\'s tags and roles are never read.' } as Unavailable }
        : byScope as { hq: Counts; company: Counts | Unavailable },
    by_role: ctx.roleKeys.map((role) => ({ role, published: byRole.get(role)! })),
    roles_without_published: ctx.roleKeys.filter((k) => byRole.get(k) === 0),
    by_area: RADAR_AXES.map((a) => {
      const n = byArea.get(a.slug)!;
      return { area: a.slug, label: a.label, published_primary: n.primary, published_any: n.any, coverage: n.primary === 0 ? 'none' : n.primary < THIN_BELOW ? 'thin' : 'covered' };
    }),
    thin_below: THIN_BELOW,
    by_tag: [...byTag].map(([slug, n]) => ({ slug, ...n })).sort((a, b) => a.slug.localeCompare(b.slug)),
    by_primary_level: Object.fromEntries([...byLevel].sort()),
    published_untagged: untaggedPublished,
    drafts: {
      ...drafts,
      without_current_evaluation: company
        ? { available: false, reason: 'A company draft has no release evidence to evaluate against (#4533).' } as Unavailable
        : ctx.filtered
        ? { available: false, reason: 'Computed on the unfiltered full list only.' } as Unavailable
        : ctx.draftsWithoutCurrentEvaluation == null
          ? { available: false, reason: 'Computed on the full list only (read without ?page).' } as Unavailable
          : ctx.draftsWithoutCurrentEvaluation,
    },
    sources: company
      ? { available: false, reason: 'The source library is Axal\'s files; a company skill has none.' } as Unavailable
      : ctx.filtered
      ? { available: false, reason: 'The source library files are not filtered.' } as Unavailable
      : {
        library_files: library.size,
        source_only: sourceOnly,
        seeded: seeded.length,
        seeded_published: seeded.filter((s) => hqSlugs.get(s)!.current_version >= 1).length,
        authored_in_store: [...hqSlugs.keys()].filter((s) => !library.has(s)).length,
      } as { library_files: number; source_only: string[]; seeded: number; seeded_published: number; authored_in_store: number } | Unavailable,
    adoption: {
      // Catalogue adoption: which agents pin a skill. Never a run count.
      links: ctx.adoption.links,
      agents: ctx.adoption.agents,
      pinned_behind_current: ctx.adoption.behind_current,
      published_without_links: ctx.adoption.published_without_links,
    },
    executions: { available: false, reason: 'Served beside coverage as `executions` (D4536-p4): completed runs only, which is adoption apart from usage.' } as Unavailable,
  };
}

export type CatalogueCoverage = ReturnType<typeof catalogueCoverage>;

// ── D4536-p2 (#5969): the published versions' evaluation, across the catalogue ──────────────────────────────────────
//
// Read ONLY from `agent_skill_version_evals`, the published history: one row per golden case, model and immutable
// version. The draft history (`agent_skill_eval_results`, keyed by draft and evidence hash) is never read here, so no
// figure below blends the two. Each published HQ skill is read at its CURRENT version; a retired or draft skill has no
// current version to measure and is not in the block. The latest row per version, case key and model is the one
// counted: running a case again replaces its result, it never adds a second one.

/** A published HQ skill at its current version: the cases a run on it takes and the models it must pass on. */
export type PublishedVersionRow = {
  skill_uid: string;
  version: number;
  /** `goldenCasesFrom`'s keys: the starter case (unless a live case carries its text) and each live case's uid. */
  case_keys: readonly string[];
  required_models: readonly string[];
  /** Where the required set came from: the version's release manifest, else the skill's declared set, else the default. */
  models_source: 'version_evidence' | 'declared' | 'default';
};
/**
 * One row of the published history, already reduced in SQL: `latest` is the newest row per version, case key and
 * model (current and previous version); `prior` is, on the current version, the newest earlier row that ran.
 */
export type VersionEvalRow = ResultRow & { skill_uid: string; version: number; kind: 'latest' | 'prior'; run_at: string | null };
/** The latest campaign (#4668) and its manifest's states; null when none ever started. */
export type CampaignCoverageRow = {
  uid: string; status: 'running' | 'complete' | 'cancelled'; started_at: string; finished_at: string | null;
  total: number; done: number; skipped: number; pending: number;
  /** Published HQ skills whose CURRENT version this campaign has not finished (published later, skipped, or pending). */
  published_not_done: number;
};

type Outcomes = Record<PairOutcome, number>;
type Results = { pass: number; fail: number; not_run: number };
const outcomes = (): Outcomes => ({
  regressed: 0, improved: 0, still_pass: 0, still_fail: 0, case_changed: 0, evaluator_changed: 0,
  not_recorded: 0, not_run: 0, only_baseline: 0, only_candidate: 0,
});
const addOutcomes = (into: Outcomes, from: Outcomes) => { for (const k of Object.keys(into) as PairOutcome[]) into[k] += from[k]; };
const unitKey = (caseKey: string, model: string) => `${caseKey}\u0000${model}`;
/** `run_at` is stored as `CURRENT_TIMESTAMP` (`YYYY-MM-DD HH:MM:SS`, UTC); null when it does not parse. */
const msOf = (at: string | null | undefined): number | null => {
  if (!at) return null;
  const iso = at.replace(' ', 'T');
  const ms = Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(ms) ? ms : null;
};
const hoursSince = (at: string | null, now: Date): number | null => {
  const ms = msOf(at);
  return ms == null ? null : Math.max(0, Math.floor((now.getTime() - ms) / 3_600_000));
};
const later = (a: string | null, b: string | null) => (msOf(a) ?? -Infinity) > (msOf(b) ?? -Infinity);
const NOT_EVALUATED: Unavailable = { available: false, reason: 'No result is recorded on this published version.' };

export function publishedEvaluation(versions: readonly PublishedVersionRow[], rows: readonly VersionEvalRow[], ctx: {
  currentEvaluatorVersion: number;
  now: Date;
  /**
   * The latest campaign; null when none started; `unreadable` when the campaign tables could not be read; `filtered`
   * (D5970) when the read is filtered: a campaign's progress is the whole catalogue's.
   */
  campaign: CampaignCoverageRow | null | 'unreadable' | 'filtered';
}) {
  const bySkill = new Map<string, VersionEvalRow[]>();
  for (const r of rows) {
    const list = bySkill.get(r.skill_uid);
    if (list) list.push(r); else bySkill.set(r.skill_uid, [r]);
  }

  const results: Results = { pass: 0, fail: 0, not_run: 0 };
  const required = { units: 0, recorded: 0, missing: 0, model_pairs: 0, models_without_result: 0, versions_incomplete: 0 };
  const sincePreviousRun = outcomes();
  const sincePreviousVersion = outcomes();
  const evaluators = new Set<number>();
  const identity = { rows_on_current_evaluator: 0, rows_on_other_evaluator: 0, rows_evaluator_not_recorded: 0, rows_case_text_not_recorded: 0 };
  let newest: string | null = null, oldest: string | null = null, evaluated = 0, withPrevious = 0;

  const skills = versions.map((v) => {
    const latest = new Map<string, VersionEvalRow>();
    const prior = new Map<string, VersionEvalRow>();
    const previous: VersionEvalRow[] = [];
    for (const r of bySkill.get(v.skill_uid) ?? []) {
      const k = unitKey(r.case_key, r.model_id);
      if (r.kind === 'latest' && r.version === v.version) {
        // The SQL keeps one latest row per unit; should two arrive, the unit still counts once and the later one wins.
        const had = latest.get(k);
        if (!had || !later(had.run_at, r.run_at)) latest.set(k, r);
      } else if (r.kind === 'prior' && r.version === v.version) prior.set(k, r);
      else if (r.kind === 'latest' && r.version === v.version - 1) previous.push(r);
    }

    // The required units: every case the version runs, on every model it must pass on. A unit with no row is missing.
    const missing: Array<{ case_key: string; model_id: string }> = [];
    const modelsWithResult = new Set<string>();
    for (const k of v.case_keys) for (const m of v.required_models) {
      if (latest.has(unitKey(k, m))) modelsWithResult.add(m); else missing.push({ case_key: k, model_id: m });
    }
    const modelsWithout = v.required_models.filter((m) => !modelsWithResult.has(m));
    const units = v.case_keys.length * v.required_models.length;
    required.units += units;
    required.recorded += units - missing.length;
    required.missing += missing.length;
    required.model_pairs += v.required_models.length;
    required.models_without_result += modelsWithout.length;
    if (missing.length) required.versions_incomplete++;
    const req = {
      cases: [...v.case_keys], models: [...v.required_models], models_source: v.models_source,
      units, recorded: units - missing.length, missing, models_without_result: modelsWithout,
    };

    if (!latest.size) {
      return {
        skill_uid: v.skill_uid, version: v.version, evaluated: false, required: req,
        results: NOT_EVALUATED as Results | Unavailable, by_model: NOT_EVALUATED as Record<string, Results> | Unavailable, cases: [] as EvalCell[],
        regressions: NOT_EVALUATED as SkillRegressions | Unavailable, last_run_at: null as string | null, hours_since_last_run: null as number | null,
        identity: NOT_EVALUATED as SkillIdentity | Unavailable,
      };
    }
    evaluated++;
    const totals: Results = { pass: 0, fail: 0, not_run: 0 };
    const byModel: Record<string, Results> = {};
    const own = outcomes();
    const ev = new Set<number>();
    let last: string | null = null;
    let evNotRecorded = 0, caseNotRecorded = 0, onCurrent = 0;
    const cases: EvalCell[] = [...latest.values()]
      .sort((a, b) => a.case_key.localeCompare(b.case_key) || a.model_id.localeCompare(b.model_id))
      .map((r) => {
        totals[r.result]++;
        (byModel[r.model_id] ??= { pass: 0, fail: 0, not_run: 0 })[r.result]++;
        // skillEvalCompare's rule: the newest earlier run on this version that ran, against the latest.
        own[pairOutcome(prior.get(unitKey(r.case_key, r.model_id)), r)]++;
        if (r.evaluator_version == null) evNotRecorded++; else { ev.add(r.evaluator_version); evaluators.add(r.evaluator_version); }
        if (r.evaluator_version != null && r.evaluator_version === ctx.currentEvaluatorVersion) onCurrent++;
        if (r.case_sha256 == null) caseNotRecorded++;
        if (r.run_at && (last == null || later(r.run_at, last))) last = r.run_at;
        return { case_key: r.case_key, model_id: r.model_id, result: r.result, run_at: r.run_at, evaluator_version: r.evaluator_version, case_sha256: r.case_sha256 };
      });
    for (const k of Object.keys(results) as Array<keyof Results>) results[k] += totals[k];
    addOutcomes(sincePreviousRun, own);
    // Against the previous published version's latest rows, case by case; v1 has no previous version.
    const vsPrevious = v.version > 1 ? compareResults(previous, [...latest.values()]).totals : null;
    if (vsPrevious) { addOutcomes(sincePreviousVersion, vsPrevious); withPrevious++; }
    identity.rows_on_current_evaluator += onCurrent;
    identity.rows_evaluator_not_recorded += evNotRecorded;
    identity.rows_on_other_evaluator += latest.size - onCurrent - evNotRecorded;
    identity.rows_case_text_not_recorded += caseNotRecorded;
    if (last != null) {
      if (newest == null || later(last, newest)) newest = last;
      if (oldest == null || later(oldest, last)) oldest = last;
    }
    return {
      skill_uid: v.skill_uid, version: v.version, evaluated: true, required: req,
      results: totals as Results | Unavailable, by_model: byModel as Record<string, Results> | Unavailable, cases,
      regressions: { since_previous_run: own.regressed, since_previous_version: vsPrevious ? vsPrevious.regressed : null } as SkillRegressions | Unavailable,
      last_run_at: last as string | null, hours_since_last_run: hoursSince(last, ctx.now) as number | null,
      identity: {
        evaluator_versions: [...ev].sort((a, b) => a - b), on_current_evaluator: onCurrent === latest.size,
        evaluator_not_recorded: evNotRecorded, case_text_not_recorded: caseNotRecorded,
      } as SkillIdentity | Unavailable,
    };
  });

  const c = ctx.campaign;
  const campaign = c === 'unreadable'
    ? { available: false, reason: 'The evaluation campaigns could not be read.' } as Unavailable
    : c === 'filtered'
      ? { available: false, reason: 'A campaign\'s progress is the whole catalogue\'s; it is not filtered.' } as Unavailable
    : c == null
      ? { available: false, reason: 'No evaluation campaign has started (#4668).' } as Unavailable
      : {
        uid: c.uid, status: c.status, started_at: c.started_at, finished_at: c.finished_at,
        manifest: { total: Number(c.total), done: Number(c.done), skipped: Number(c.skipped), pending: Number(c.pending) },
        published_not_done: Number(c.published_not_done),
        // #4668: a batch is progress, never coverage. Full only when the campaign completed AND it finished every
        // published skill's current version (one published or republished since its start is not covered).
        full_coverage: c.status === 'complete' && Number(c.pending) === 0 && Number(c.published_not_done) === 0,
      };

  return {
    history: 'published' as const,
    versions: {
      published: versions.length, evaluated, unevaluated: versions.length - evaluated,
      unevaluated_skills: skills.filter((s) => !s.evaluated).map((s) => s.skill_uid).sort(),
    },
    results: evaluated ? results : NOT_EVALUATED,
    required,
    regressions: {
      rule: 'A pass turned fail on the same case text, model and evaluator (skillEvalCompare COMPARABLE).',
      since_previous_run: evaluated ? sincePreviousRun : NOT_EVALUATED,
      since_previous_version: withPrevious ? sincePreviousVersion : { available: false, reason: 'No evaluated published version has a previous version.' } as Unavailable,
      time_to_resolve: { available: false, reason: 'Needs the fixing version linked to the regression; not recorded.' } as Unavailable,
    },
    freshness: evaluated
      ? { newest_run_at: newest as string | null, hours_since_newest: hoursSince(newest, ctx.now), oldest_last_run_at: oldest as string | null, hours_since_oldest: hoursSince(oldest, ctx.now) }
      : NOT_EVALUATED,
    identity: evaluated
      ? { current_evaluator_version: ctx.currentEvaluatorVersion, evaluator_versions: [...evaluators].sort((a, b) => a - b), ...identity }
      : NOT_EVALUATED,
    campaign,
    skills,
  };
}

type EvalCell = { case_key: string; model_id: string; result: ResultRow['result']; run_at: string | null; evaluator_version: number | null; case_sha256: string | null };
type SkillRegressions = { since_previous_run: number; since_previous_version: number | null };
type SkillIdentity = { evaluator_versions: number[]; on_current_evaluator: boolean; evaluator_not_recorded: number; case_text_not_recorded: number };

export type PublishedEvaluation = ReturnType<typeof publishedEvaluation>;

// ── D5970 (#5970): validated filters on the two blocks ──────────────────────────────────────────────────────────────
//
// Every filter is checked before anything is served: an unknown name or value is refused with a code, never read as
// "all". A filter narrows the skills each block counts; one that matches nothing gives observed zeros for counts and
// `{ available: false }` for measures that need a row, never the unfiltered figures. The paged `skills` list is not
// filtered. Matching is in memory over rows the fixed reads already return, and the window and model are bound
// parameters of the history read, so a filter adds no read and no per-skill query.

/** The longest window on evaluation `run_at`, in whole UTC days counting both ends. */
export const FILTER_WINDOW_MAX_DAYS = 366;
export const FILTER_KEYS = ['scope', 'status', 'uid', 'version', 'category', 'tag', 'role', 'model', 'from', 'to'] as const;
export type FilterKey = typeof FILTER_KEYS[number];
/** Which filter narrows which block. `coverage` is the catalogue as it is now: it has no run time and no model. */
export const FILTER_BLOCKS: Readonly<Record<'coverage' | 'published_evaluation' | 'executions', readonly FilterKey[]>> = {
  coverage: ['scope', 'status', 'uid', 'version', 'category', 'tag', 'role'],
  published_evaluation: FILTER_KEYS,
  // D4536-p4: `version` keeps that EXECUTED version; the window is on the run's usage row (`created_at`).
  executions: FILTER_KEYS,
};
const STATUSES = ['draft', 'published', 'retired'] as const;
/** D5970: the models a `model` filter may name: every chat model in the catalogue, a deprecated one included (its rows stay). */
export const FILTER_MODEL_IDS: readonly string[] = CATALOGUE.filter((m) => MODEL_CONNECTIONS[m.id]?.operation === 'chat').map((m) => m.id);
const UID = /^[0-9a-f]{32}$/;
const VERSION = /^[1-9][0-9]{0,5}$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export type SkillFilters = {
  /** The subject's own scope: `hq` on the HQ read, `company` on a company's read (D8912). */
  scope: Subject | null;
  status: CoverageRow['status'] | null;
  uid: string | null;
  version: number | null;
  /** A radar axis (`RADAR_AXES`): a skill matches when any tag of its current version is in it. */
  category: string | null;
  tag: string | null;
  role: string | null;
  model: string | null;
  /** On evaluation `run_at`, UTC: `since` (the `from` day's 00:00:00) inclusive, `until` (the day after `to`) exclusive. */
  window: { from: string; to: string; days: number; since: string; until: string } | null;
};
export type FilterRefusal = { ok: false; code: string; message: string };

const dayMs = (s: string): number | null => {
  const m = DAY.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const t = new Date(ms);
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? ms : null;
};
const sqlTime = (ms: number) => `${new Date(ms).toISOString().slice(0, 10)} 00:00:00`;

/**
 * The query's filters, each checked: names against `FILTER_KEYS` (plus `allowed`, e.g. `page`), each given once;
 * values against the taxonomy, the catalogue's roles, the model catalogue and their formats. `filters` is null when
 * none is given, so an unfiltered read is the read it was before.
 */
export function parseSkillFilters(query: Record<string, string[]>, ctx: {
  categories: readonly string[];
  tags: { has(slug: string): boolean };
  roleKeys: readonly string[];
  modelIds: readonly string[];
  allowed?: readonly string[];
  /** D8912: the one scope the read serves (default `hq`). */
  scope?: Subject;
}): { ok: true; filters: SkillFilters | null } | FilterRefusal {
  const no = (code: string, message: string): FilterRefusal => ({ ok: false, code, message });
  const given = new Map<FilterKey, string>();
  for (const [name, values] of Object.entries(query)) {
    if (ctx.allowed?.includes(name)) continue;
    if (!(FILTER_KEYS as readonly string[]).includes(name)) return no('filter_unknown', `There is no filter named "${name.slice(0, 40)}". The filters are: ${FILTER_KEYS.join(', ')}.`);
    if (values.length !== 1) return no('filter_repeated', `Give the ${name} filter once.`);
    given.set(name as FilterKey, values[0]);
  }
  if (!given.size) return { ok: true, filters: null };
  const v = (k: FilterKey) => given.get(k) as string;
  const f: SkillFilters = { scope: null, status: null, uid: null, version: null, category: null, tag: null, role: null, model: null, window: null };

  if (given.has('scope')) {
    const served = ctx.scope ?? 'hq';
    if (v('scope') !== served) {
      return no('scope_not_served', served === 'hq'
        ? 'This read serves HQ skills only: the scope filter takes "hq".'
        : 'This read serves your company\'s own skills only: the scope filter takes "company".');
    }
    f.scope = served;
  }
  if (given.has('status')) {
    if (!(STATUSES as readonly string[]).includes(v('status'))) return no('status_unknown', `The status filter takes one of: ${STATUSES.join(', ')}.`);
    f.status = v('status') as SkillFilters['status'];
  }
  if (given.has('uid')) {
    if (!UID.test(v('uid'))) return no('uid_malformed', 'A skill uid is 32 lower-case hexadecimal characters.');
    f.uid = v('uid');
  }
  if (given.has('version')) {
    if (!VERSION.test(v('version'))) return no('version_malformed', 'A version is a whole number from 1.');
    f.version = Number(v('version'));
  }
  if (given.has('category')) {
    if (!ctx.categories.includes(v('category'))) return no('category_unknown', 'That category is not in the skills taxonomy.');
    f.category = v('category');
  }
  if (given.has('tag')) {
    if (!ctx.tags.has(v('tag'))) return no('tag_unknown', 'That tag is not an active skill in the taxonomy.');
    f.tag = v('tag');
  }
  if (given.has('role')) {
    if (!ctx.roleKeys.includes(v('role'))) return no('role_unknown', 'That role is not one of the catalogue\'s agent roles.');
    f.role = v('role');
  }
  if (given.has('model')) {
    if (!ctx.modelIds.includes(v('model'))) return no('model_unknown', 'That model is not in the model catalogue.');
    f.model = v('model');
  }
  if (given.has('from') || given.has('to')) {
    if (!given.has('from') || !given.has('to')) return no('window_incomplete', 'A date range needs both from and to (YYYY-MM-DD, UTC).');
    const from = dayMs(v('from')), to = dayMs(v('to'));
    if (from == null || to == null) return no('window_malformed', 'Give from and to as calendar dates, YYYY-MM-DD (UTC).');
    if (to < from) return no('window_reversed', 'The range ends before it starts.');
    const days = (to - from) / DAY_MS + 1;
    if (days > FILTER_WINDOW_MAX_DAYS) return no('window_too_long', `A date range covers at most ${FILTER_WINDOW_MAX_DAYS} days, both ends counted.`);
    f.window = { from: v('from'), to: v('to'), days, since: sqlTime(from), until: sqlTime(to + DAY_MS) };
  }
  return { ok: true, filters: f };
}

/** A skill as the filters read it: its CURRENT published version's roles and tags, as coverage counts them. */
export type MatchableSkill = {
  scope: 'hq' | 'company'; status: string; uid?: string | null; current_version: number;
  published_roles_json: string | null; published_tags_json: string | null;
};

/**
 * Whether a skill passes the filters' skill-level terms. Only the subject's skills can (HQ's by default): in the HQ
 * read a company skill never does, its tags and roles are not read; in a company's read (D8912) an HQ skill never does.
 * Role, tag and category read the current published version, so a skill with no version matches none of them.
 */
export function matchesSkill(s: MatchableSkill, f: SkillFilters, category: ReadonlyMap<string, string>, subject: Subject = 'hq'): boolean {
  if (s.scope !== subject) return false;
  if (f.status != null && s.status !== f.status) return false;
  if (f.uid != null && s.uid !== f.uid) return false;
  if (f.version != null && Number(s.current_version) !== f.version) return false;
  if (f.role == null && f.tag == null && f.category == null) return true;
  if (Number(s.current_version) < 1) return false;
  if (f.role != null && !parse<string[]>(s.published_roles_json, []).includes(f.role)) return false;
  const tags = parse<Array<{ slug: string }>>(s.published_tags_json, []);
  if (f.tag != null && !tags.some((t) => t.slug === f.tag)) return false;
  if (f.category != null && !tags.some((t) => category.get(t.slug) === f.category)) return false;
  return true;
}

/** The pins per linked skill of the subject (active agents only), one row each; `agent_ids` is a comma list. */
export type SkillLinkRow = { uid: string; links: number; agent_ids: string | null; behind_current: number };

/** Coverage's adoption over the subject's skills in `rows` (HQ's by default): every one unfiltered, the matched ones filtered. */
export function adoptionOf(links: readonly SkillLinkRow[], rows: readonly CoverageRow[], subject: Subject = 'hq'): AdoptionRow {
  const hq = new Map(rows.filter((r) => r.scope === subject && r.uid).map((r) => [r.uid as string, r]));
  const agents = new Set<string>();
  const linked = new Set<string>();
  let n = 0, behind = 0;
  for (const l of links) {
    if (!hq.has(l.uid)) continue;
    linked.add(l.uid);
    n += Number(l.links);
    behind += Number(l.behind_current);
    for (const a of String(l.agent_ids ?? '').split(',')) if (a) agents.add(a);
  }
  const unlinked = [...hq.values()].filter((r) => r.status === 'published' && !linked.has(r.uid as string)).length;
  return { links: n, agents: agents.size, behind_current: behind, published_without_links: unlinked };
}

/** What the response says about its filters: the values applied, and which block each one narrowed. */
export function filtersApplied(f: SkillFilters) {
  const applied: Partial<Record<FilterKey, string | number>> = {};
  for (const k of FILTER_KEYS) {
    if (k === 'from' || k === 'to') { if (f.window) applied[k] = f.window[k]; continue; }
    const value = f[k];
    if (value != null) applied[k] = value;
  }
  const keys = FILTER_KEYS.filter((k) => k in applied);
  const block = (b: keyof typeof FILTER_BLOCKS) => ({
    applied: keys.filter((k) => FILTER_BLOCKS[b].includes(k)),
    not_applicable: keys.filter((k) => !FILTER_BLOCKS[b].includes(k)),
  });
  return {
    applied,
    window: f.window ? { since: f.window.since, until: f.window.until, days: f.window.days, max_days: FILTER_WINDOW_MAX_DAYS } : null,
    coverage: block('coverage'),
    published_evaluation: block('published_evaluation'),
    executions: block('executions'),
    // The paged list is the catalogue's rows, never filtered here.
    skills: { applied: [] as FilterKey[], not_applicable: keys },
  };
}
