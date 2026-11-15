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
 */
import { RADAR_AXES } from '../skillsTaxonomySchema.ts';
import { compareResults, pairOutcome, type PairOutcome, type ResultRow } from './skillEvalCompare.ts';

/** One `agent_skills` row with its aggregates; `slug` is null for a company skill. */
export type CoverageRow = {
  scope: 'hq' | 'company';
  status: 'draft' | 'published' | 'retired';
  slug: string | null;
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

/** An area with fewer published skills than this, by primary tag, is `thin`; none at all is `none`. */
export const THIN_BELOW = 3;

const parse = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};

type Counts = { draft: number; published: number; retired: number; review_requested: number };
const counts = (): Counts => ({ draft: 0, published: 0, retired: 0, review_requested: 0 });

export function catalogueCoverage(rows: readonly CoverageRow[], ctx: {
  category: ReadonlyMap<string, string>;
  roleKeys: readonly string[];
  librarySlugs: readonly string[];
  adoption: AdoptionRow;
  /** HQ drafts whose required runs under the current evidence are not all recorded; null when this read did not compute them. */
  draftsWithoutCurrentEvaluation: number | null;
}) {
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
    if (r.scope !== 'hq') continue;
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

  return {
    by_scope: byScope,
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
      without_current_evaluation: ctx.draftsWithoutCurrentEvaluation == null
        ? { available: false, reason: 'Computed on the full list only (read without ?page).' } as Unavailable
        : ctx.draftsWithoutCurrentEvaluation,
    },
    sources: {
      library_files: library.size,
      source_only: sourceOnly,
      seeded: seeded.length,
      seeded_published: seeded.filter((s) => hqSlugs.get(s)!.current_version >= 1).length,
      authored_in_store: [...hqSlugs.keys()].filter((s) => !library.has(s)).length,
    },
    adoption: {
      // Catalogue adoption: which agents pin a skill. Never a run count.
      links: ctx.adoption.links,
      agents: ctx.adoption.agents,
      pinned_behind_current: ctx.adoption.behind_current,
      published_without_links: ctx.adoption.published_without_links,
    },
    overlap: { available: false, reason: 'Overlap suggestions are not computed yet.' } as Unavailable,
    executions: { available: false, reason: 'Waits on a reliable run status (#4667).' } as Unavailable,
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
  /** The latest campaign; null when none started; `unreadable` when the campaign tables could not be read. */
  campaign: CampaignCoverageRow | null | 'unreadable';
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
