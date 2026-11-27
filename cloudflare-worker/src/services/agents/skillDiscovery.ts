/**
 * D4538 part 4 (#5966, of #4538) — task-to-skill discovery as a pure service: the hard eligibility gate, then
 * ranking stages 1 to 3, in the response shape of `documentation/architecture/SKILL_DISCOVERY_CONTRACT.md`.
 *
 * Pure: it takes the agent's facts (role, company, granted tools) and the catalogue's skill facts (each skill's
 * published version) and returns `{ outcome, candidates, blocked, clarify, abstain_reason, stages }`. It reads no
 * store, writes nothing, calls no model and sends nothing anywhere; it never attaches a skill (attaching stays
 * `PUT /api/teams/agents/:uid/skills`, through `attachCheck`). `POST /api/teams/skills/discover` (`routes/team_skills.ts`, #5967) serves it.
 *
 * THE GATE (`gateOf`), in `attachCheck`'s order (`skillLinks.ts`), then discovery's:
 *   not_found              another company's skill, or a draft the caller may not read: listed nowhere
 *   version_not_published  no published version, so nothing an attach could pin
 *   skill_retired          retired
 *   skill_suspended        HQ suspended it (D4161, D4534): the caller passes `skillRunRefusal`'s answer
 *   role_mismatch          the version does not list the agent's role
 *   tool_not_approved      a tool of the version is not in the agent's grants, named `{ key, label }`
 *   output_mismatch        `output_kind` was asked for, and the skill produces another
 *   input_unavailable      #4667's preflight says a required input cannot be read for this scope (`inputs`), or the
 *                          `seams.inputs` seam says so; never guessed here
 *   not_runnable           the run path refuses this agent (`runnable`, #4534: `agent_paused`, `outside_assistant`),
 *                          or `seams.runnable` says so
 * A skill that fails is never a candidate. `blocked` lists the task-relevant ones with their code, except
 * `not_found`, which would disclose the skill.
 *
 * RANKING, over eligible skills only:
 *   1. role and taxonomy fit: the role is already required by the gate; a tag that `taxonomy_focus` names, or whose
 *      slug words the task uses, is reported and multiplies the score (FOCUS_BOOST, AREA_BOOST);
 *   2. task relevance: BM25 (k1 1.2, b 0.75) of the task's terms against the version's name (x3), purpose (x2),
 *      steps (x1) and tag slug words (x1), IDF over the skills the caller may read; terms are lower-cased, stop
 *      words dropped, lightly stemmed (`terms`). Lexical, in the Worker: nothing leaves it (D4538-p4.md);
 *   3. input and output compatibility: an asked-for kind is already a gate; a task that says "draft" or "write"
 *      prefers a draft (OUTPUT_BOOST). Inputs are a gate where #4667 reports them, and "not recorded" elsewhere;
 *   4. quality evidence (D4538-p8, #5968): the facts `skillDiscoveryEvidence.ts` reads for the skill's published
 *      version (`quality`): its release manifest (D4533) and the current version's golden-case results in
 *      `agent_skill_version_evals`, with their freshness. `evaluationOf` names the exact version, suite, models and
 *      evaluator it used. Only complete, fresh results on the current evaluator move the score: at the bar
 *      x(1 + QUALITY_BOOST), below it x(1 - QUALITY_PENALTY). Stale, incomplete or absent evidence moves nothing and
 *      says why; it is never read as zero;
 *   5. operational evidence (D4538-p8): #4536's served measures for the executed version, counted over this
 *      company's agents only (`operations`). `operationalOf` reports them; only the failure rate moves the score,
 *      down, and only over OPS_MIN_ENDED ended runs. A measure #4536 does not serve, or one with too few runs, is
 *      `{ available: false, reason }` and moves nothing.
 * A skill fact absent (`quality`, `operations`, `inputs`, `runnable` undefined) is "not recorded": the block says so
 * and the score is not touched. Use count, and the number of completed runs, never raise a rank.
 *
 * INPUTS AND RUNNABILITY (D4538-p8). `inputs` is #4667's `preflight` for the skill and the agent's scope, as the
 * route read it; `inputGapsOf` turns it into the gate: a required input the scope cannot supply (no reader, not in
 * the rule book, withheld, unreadable, the wrong shape; nothing recorded when the read named the agent's venture)
 * is `input_unavailable`. An input a run supplies when it starts (a selected document or fund, a person's evidence,
 * a venture a company agent's run names) is reported as deferred, never assumed available. `runnable` is what the run
 * path (`agentRun`) refuses before any skill text for this agent: `not_runnable` with its code.
 *
 * OUTCOMES. `no_suitable_skill` when the task asks for an act no skill does (sending, booking, paying: `ACTS`) or
 * when no eligible skill reaches MIN_COVERAGE of the task's terms; `ambiguous` (every candidate `low`, with a
 * `clarify` question) when the second candidate scores within AMBIGUOUS_RATIO of the first, or the task names one
 * term two skills share; otherwise `recommend`. `version` is always the published version an attach would pin.
 */
import { missingTools, type OutputKind, type Tag } from './skills';
import { toolLabel, type AttachCode } from './skillLinks';

// D8768: `attachCheck` no longer refuses `role_mismatch` (fit only sorts); discovery's contract still gates on the
// role for a task recommendation (SKILL_DISCOVERY_CONTRACT.md), so the code is discovery's own until that contract moves.
export type DiscoveryCode = AttachCode | 'role_mismatch' | 'output_mismatch' | 'input_unavailable' | 'not_runnable';

/** The agent the skill would run on, as the server reads it (`agentByUid`), never as a client claims it. */
export type DiscoveryAgent = { role: string; company: number | string | null; tools: readonly string[] };

/** One catalogue skill, described by its current published version. */
export type DiscoverySkill = {
  uid: string; scope: 'hq' | 'company'; company: number | string | null;
  status: 'draft' | 'published' | 'retired';
  /** The caller's read gate on the skill (a draft they may not read is false). */
  readable: boolean;
  /** The current published version; null or 0 when none was ever published. */
  version: number | null;
  /** `skillRunRefusal` at `version` (D4534): true when HQ's suspension covers it. */
  suspended: boolean;
  name: string; purpose: string; steps: readonly string[];
  roles: readonly string[]; tools: readonly string[]; output_kind: string; taxonomy: readonly Pick<Tag, 'slug'>[];
  /** Adoption, carried for display by a caller. Never a ranking input. */
  use_count?: number | null;
  /** The skill's slug: #4667's input matrix names skills by it, as the run path does. */
  slug?: string | null;
  /** #4667's preflight for this skill and the agent's scope; absent when no binding is reported ("not recorded"). */
  inputs?: InputFacts | null;
  /** What the run path refuses for this agent (#4534); absent when not checked. */
  runnable?: RunFacts | null;
  /** Stage 4's facts for the published version (D4533); absent when not read, `Unavailable` when they could not be. */
  quality?: QualityFacts | Unavailable | null;
  /** Stage 5's facts: #4536's served measures for this company's runs; absent when not read. */
  operations?: OperationalFacts | Unavailable | null;
};

/** One input as `preflight` reports it: statuses and reasons only, never a record's figures. */
export type InputLine = { field: string; read: string; required: boolean; status: string; reason?: string; source?: string };
/**
 * #4667's `preflight` (`skillInputs.ts`) for one skill and the agent's scope, read with the agent's rule book as the
 * binding. `venture`: the read named the agent's own venture (a project agent); a company agent's run names one when
 * it starts, so what such a read found missing is deferred, not refused.
 */
export type InputFacts = {
  state: 'ready' | 'conditional' | 'not_ready'; inputs: readonly InputLine[]; limits: readonly string[]; venture: boolean;
  paths?: { default_context: string; scheduled: string } | null;
};
/** The run path's refusals a published, granted skill still meets for this agent (`agentRun`, #4534). */
export type RunCode = 'agent_paused' | 'outside_assistant';
export type RunFacts = { ok: true } | { ok: false; code: RunCode };

export type ResultCounts = { pass: number; fail: number; not_run: number };
/**
 * The published version's quality evidence, as read (`skillDiscoveryEvidence.ts`). `release` is the version's D4533
 * manifest, null when it has none (released before D4533). `results` are the latest row per case key and model on
 * this version in `agent_skill_version_evals`, over the cases the version runs and its required models.
 */
export type QualityFacts = {
  version: number;
  release: {
    evidence_hash: string; suite_revision: string; cases: number; evaluator_version: number;
    models: readonly string[]; models_source: string; pass: number; total: number; approved_at: string | null;
  } | null;
  /** What the skill's release evidence would be bound to now, to tell a stale manifest. */
  now: { suite_revision: string | null; evaluator_version: number; models: readonly string[] };
  suite: { cases: number; models: readonly string[]; models_source: 'version_evidence' | 'declared' | 'default' };
  results: {
    units: number; recorded: number; counts: ResultCounts; by_model: Readonly<Record<string, ResultCounts>>;
    evaluator_versions: readonly number[]; on_current_evaluator: number; case_text_not_recorded: number;
    newest_run_at: string | null; oldest_run_at: string | null; hours_since_oldest: number | null;
  };
};
/** #4536's served measures for the executed version, over this company's agents' runs in the window. */
export type OperationalFacts = {
  version: number; window: { since: string; until: string; days: number };
  outcomes: { completed: number; refused: number; failed: number; retryable: number; version_not_recorded: number; attributed_since: string | null };
  model_latency_ms: { p50: number; p95: number; runs_measured: number } | Unavailable;
};

export type DiscoveryRequest = { task: string; output_kind?: OutputKind | null; taxonomy_focus?: readonly string[]; limit?: number };

/**
 * The gate's two seams. Discovery does not guess either: without one, its code is never returned and stage 3 or
 * the gate reports that the check did not run.
 */
export type DiscoverySeams = {
  /** #4667: false when the skill's inputs cannot be read for this scope. */
  inputs?: (s: DiscoverySkill) => boolean;
  /** #4534: false when the execution contract refuses the skill for this agent. */
  runnable?: (s: DiscoverySkill) => boolean;
};

export type Refusal = { code: DiscoveryCode; tool?: { key: string; label: string }; inputs?: InputLine[]; run?: RunCode };
export type Unavailable = { available: false; reason: string };
export type Reason = { signal: 'task' | 'role' | 'taxonomy' | 'output' | 'quality' | 'operational'; text: string };
/** How a stage's evidence moved the score: a factor of 1 is no move, and says why. */
export type RankEffect = { effect: 'raised' | 'lowered' | 'none'; factor: number; reason: string };
export type EvaluationBlock = {
  available: true; version: number;
  suite: { cases: number; models: string[]; models_source: string };
  results: {
    units: number; recorded: number; missing: number; pass: number; fail: number; not_run: number; meets_bar: boolean | null;
    by_model: Record<string, ResultCounts>; evaluator_versions: number[]; current_evaluator_version: number; on_current_evaluator: boolean;
    case_text_not_recorded: number; newest_run_at: string | null; oldest_run_at: string | null;
  } | Unavailable;
  release: {
    available: true; evidence_hash: string; suite_revision: string; cases: number; evaluator_version: number;
    models: string[]; models_source: string; pass: number; total: number; approved_at: string | null; stale: boolean; stale_reasons: string[];
  } | Unavailable;
  freshness: 'fresh' | 'stale' | 'incomplete' | 'not_recorded'; stale_reasons: string[];
  rank: RankEffect;
};
export type OperationalBlock = {
  available: true; version: number; window: { since: string; until: string; days: number }; scope: 'company_runs';
  outcomes: {
    completed: number; refused: number; failed: number; retryable: number; ended: number; version_not_recorded: number; attributed_since: string | null;
    rates: { success: number | Unavailable; refusal: number | Unavailable; failure: number | Unavailable };
  };
  model_latency_ms: { p50: number; p95: number; runs_measured: number } | Unavailable;
  cost_per_completed_run: Unavailable; run_latency: Unavailable; workflows: Unavailable;
  rank: RankEffect;
};
export type InputsBlock = {
  available: true; state: 'ready' | 'conditional'; inputs: InputLine[]; limits: string[];
  deferred: Array<{ field: string; read: string; why: string }>;
} | Unavailable;
export type Candidate = {
  skill_uid: string; name: string; version: number; reasons: Reason[];
  fit: { role: true; taxonomy: string[] }; missing: never[];
  inputs: InputsBlock;
  evaluation: EvaluationBlock | Unavailable; operational: OperationalBlock | Unavailable;
  confidence: 'high' | 'medium' | 'low'; uncertainty: string | null;
  /** Stage 2's numbers, so a reader can inspect the order: BM25 after the stage 1 and 3 boosts, and coverage. */
  score: number; coverage: number;
};
export type BlockedSkill = {
  skill_uid: string; name: string; code: Exclude<DiscoveryCode, 'not_found'>; tool?: { key: string; label: string };
  /** `input_unavailable`: the required inputs the scope cannot supply, and why. */
  inputs?: InputLine[];
  /** `not_runnable`: the run path's code. */
  run?: RunCode;
};
export type Stage = { stage: 1 | 2 | 3 | 4 | 5; name: string; used: string | null; available: boolean; reason: string | null };
export type Discovery = {
  outcome: 'recommend' | 'ambiguous' | 'no_suitable_skill';
  candidates: Candidate[]; blocked: BlockedSkill[]; clarify: string | null; abstain_reason: string | null; stages: Stage[];
};

export const LIMIT_DEFAULT = 5;
export const LIMIT_MAX = 10;
export const TASK_MAX = 500;
export const FOCUS_MAX = 3;
/** The share of the task's term weight (IDF) a skill must match to be a candidate, or to be listed as blocked. */
export const MIN_COVERAGE = 0.2;
/** A candidate below this share of the top score is dropped. */
export const KEEP_RATIO = 0.5;
/** The second candidate within this share of the first makes the request ambiguous. */
export const AMBIGUOUS_RATIO = 0.85;
/** High confidence: this much coverage, and the second candidate below RUNNER_UP_RATIO of the first. */
export const HIGH_COVERAGE = 0.5;
export const RUNNER_UP_RATIO = 0.6;
export const FOCUS_BOOST = 0.25;
export const AREA_BOOST = 0.1;
export const OUTPUT_BOOST = 0.1;

const FIELD_WEIGHT = { name: 3, purpose: 2, steps: 1, tags: 1 } as const;
const K1 = 1.2;
const B = 0.75;

/** Stage 4: results this old, or older, are stale (a quarter). */
export const QUALITY_FRESH_DAYS = 90;
export const QUALITY_BOOST = 0.1;
export const QUALITY_PENALTY = 0.25;
/** Stage 5: the failure rate moves the score only over at least this many ended runs, and only down. */
export const OPS_MIN_ENDED = 10;
export const OPS_PENALTY = 0.5;

export const EVALUATION_UNAVAILABLE: Unavailable = { available: false, reason: 'Not recorded: no quality evidence was read for this skill.' };
export const OPERATIONAL_UNAVAILABLE: Unavailable = { available: false, reason: 'Not recorded: no run measures were read for this skill.' };
export const INPUTS_NOT_RECORDED: Unavailable = { available: false, reason: 'Not recorded: no input binding is reported for this skill (#4667 covers the first ten skills).' };
/** #4536 serves these on the HQ library read only, or not at all; discovery names them and never ranks on them. */
export const COST_NOT_READ: Unavailable = { available: false, reason: 'Not read by discovery: cost per completed run is served on the HQ library read (D4536-p4), and discovery does not rank on cost.' };
export const RUN_LATENCY_UNAVAILABLE: Unavailable = { available: false, reason: 'No run records when the whole run started and ended; model_latency_ms is the model call only (D4536-p4).' };
export const WORKFLOWS_UNAVAILABLE: Unavailable = { available: false, reason: 'Waits on a workflow\'s stable identity (#4535).' };

/** Required-input statuses that say the scope cannot supply the input at all (#4667's HARD, less "nothing recorded"). */
const SCOPE_UNAVAILABLE = new Set(['unavailable_reader', 'not_granted', 'withheld', 'unreadable']);
const NOTHING_RECORDED = new Set(['missing', 'empty']);
/** A run supplies these when it starts: the document or fund it selects, and a person's evidence. */
const RUN_SUPPLIED = new Set(['not_selected', 'manual']);

/**
 * Which required inputs the scope cannot supply (`unmet`: the gate), and which a run supplies when it starts
 * (`deferred`: reported, never assumed available). Pure over `preflight`'s statuses.
 */
export function inputGapsOf(f: InputFacts): { unmet: InputLine[]; deferred: Array<{ field: string; read: string; why: string }> } {
  const unmet: InputLine[] = [];
  const deferred: Array<{ field: string; read: string; why: string }> = [];
  for (const i of f.inputs) {
    if (!i.required) continue;
    if (SCOPE_UNAVAILABLE.has(i.status) || i.reason === 'wrong_shape') { unmet.push(i); continue; }
    if (!NOTHING_RECORDED.has(i.status)) continue;
    if ((i.reason && RUN_SUPPLIED.has(i.reason)) || i.source === 'manual') {
      deferred.push({ field: i.field, read: i.read, why: i.read.startsWith('manual:') ? 'A person supplies it when the run starts.' : 'The run selects it when it starts.' });
    } else if (!f.venture) {
      deferred.push({ field: i.field, read: i.read, why: 'Read for the venture a run names; this agent works for the whole company.' });
    } else unmet.push(i);
  }
  return { unmet, deferred };
}

const line = (i: InputLine): InputLine => ({
  field: i.field, read: i.read, required: i.required, status: i.status, ...(i.reason ? { reason: i.reason } : {}), ...(i.source ? { source: i.source } : {}),
});

function inputsBlockOf(f: InputFacts | null | undefined): InputsBlock {
  if (!f) return INPUTS_NOT_RECORDED;
  const { deferred } = inputGapsOf(f);
  const lacking = f.inputs.some((i) => i.status !== 'available');
  return { available: true, state: lacking || deferred.length ? 'conditional' : 'ready', inputs: f.inputs.map(line), limits: [...f.limits], deferred };
}

const NONE = (reason: string): RankEffect => ({ effect: 'none', factor: 1, reason });
const isUnavailable = (v: unknown): v is Unavailable => !!v && typeof v === 'object' && (v as { available?: unknown }).available === false;

/**
 * Stage 4: the evaluation block for `version`, and how it moves the score. Only the current version's own results,
 * complete on every required case and model, on the current evaluator and newer than QUALITY_FRESH_DAYS, move it.
 * The release manifest is reported with its staleness and never moves it: every manifest met the bar to publish.
 */
export function evaluationOf(q: QualityFacts | Unavailable | null | undefined, version: number): EvaluationBlock | Unavailable {
  if (!q) return EVALUATION_UNAVAILABLE;
  if (isUnavailable(q)) return q;
  if (q.version !== version) return { available: false, reason: `The evidence read is for v${q.version}, not the published v${version}.` };
  const r = q.results;
  const release: EvaluationBlock['release'] = q.release
    ? (() => {
      const why: string[] = [];
      if (q.release.evaluator_version !== q.now.evaluator_version) why.push(`released on evaluator v${q.release.evaluator_version}; the current evaluator is v${q.now.evaluator_version}`);
      if (q.now.suite_revision != null && q.release.suite_revision !== q.now.suite_revision) why.push('the golden cases changed after this version was released');
      if (JSON.stringify([...q.release.models].sort()) !== JSON.stringify([...q.now.models].sort())) why.push('the required models changed after this version was released');
      return {
        available: true as const, evidence_hash: q.release.evidence_hash, suite_revision: q.release.suite_revision, cases: q.release.cases,
        evaluator_version: q.release.evaluator_version, models: [...q.release.models], models_source: q.release.models_source,
        pass: q.release.pass, total: q.release.total, approved_at: q.release.approved_at, stale: why.length > 0, stale_reasons: why,
      };
    })()
    : { available: false, reason: `v${version} has no release manifest: it was published before D4533 recorded one.` };
  if (!r.recorded) {
    if (!q.release) return { available: false, reason: `No golden-case result is recorded on v${version}, and it has no release manifest.` };
    return {
      available: true, version, suite: { cases: q.suite.cases, models: [...q.suite.models], models_source: q.suite.models_source },
      results: { available: false, reason: `No golden-case result is recorded on v${version} since it was published.` },
      release, freshness: 'not_recorded', stale_reasons: [],
      rank: NONE('No result on this version to rank on; the release manifest met the bar to publish and does not separate skills.'),
    };
  }
  const missing = r.units - r.recorded;
  const onCurrent = r.on_current_evaluator === r.recorded;
  const why: string[] = [];
  if (!onCurrent) why.push(`${r.recorded - r.on_current_evaluator} of ${r.recorded} results were judged by an earlier evaluator (or one not recorded); the current one is v${q.now.evaluator_version}`);
  if (r.hours_since_oldest == null) why.push('when a result was run is not recorded');
  else if (r.hours_since_oldest > QUALITY_FRESH_DAYS * 24) why.push(`the oldest result is ${Math.floor(r.hours_since_oldest / 24)} days old; results older than ${QUALITY_FRESH_DAYS} days are stale`);
  const freshness: EvaluationBlock['freshness'] = why.length ? 'stale' : missing > 0 ? 'incomplete' : 'fresh';
  const total = r.counts.pass + r.counts.fail + r.counts.not_run;
  // 9 of 10 over every required unit, as the publish bar counts it: a unit with no result is never a pass.
  const meets = missing > 0 ? null : r.units > 0 && r.counts.pass * 10 >= r.units * 9;
  let rank: RankEffect;
  if (freshness === 'stale') rank = NONE(`Stale evidence does not move the score: ${why.join('; ')}.`);
  else if (freshness === 'incomplete') rank = NONE(`${missing} of ${r.units} required runs have no result on v${version}, so the bar is not judged.`);
  else if (meets) rank = { effect: 'raised', factor: 1 + QUALITY_BOOST, reason: `Passes ${r.counts.pass} of ${r.units} golden-case runs on v${version}, at the 9 of 10 bar, on fresh results.` };
  else rank = { effect: 'lowered', factor: 1 - QUALITY_PENALTY, reason: `Passes ${r.counts.pass} of ${r.units} golden-case runs on v${version}, below the 9 of 10 bar, on fresh results.` };
  return {
    available: true, version, suite: { cases: q.suite.cases, models: [...q.suite.models], models_source: q.suite.models_source },
    results: {
      units: r.units, recorded: r.recorded, missing, pass: r.counts.pass, fail: r.counts.fail, not_run: r.counts.not_run, meets_bar: total ? meets : null,
      by_model: Object.fromEntries(Object.entries(r.by_model).map(([m, c]) => [m, { ...c }])), evaluator_versions: [...r.evaluator_versions],
      current_evaluator_version: q.now.evaluator_version, on_current_evaluator: onCurrent, case_text_not_recorded: r.case_text_not_recorded,
      newest_run_at: r.newest_run_at, oldest_run_at: r.oldest_run_at,
    },
    release, freshness, stale_reasons: why, rank,
  };
}

const rateOf = (n: number, d: number): number | Unavailable => d > 0 ? Math.round((n / d) * 10_000) / 10_000
  : { available: false, reason: 'No attributed run of this version ended in the window.' };

/**
 * Stage 5: #4536's served measures for `version`, and how they move the score. Only the failure rate moves it, only
 * down, and only over OPS_MIN_ENDED ended runs. How many runs completed is reported, and never raises a rank.
 */
export function operationalOf(o: OperationalFacts | Unavailable | null | undefined, version: number): OperationalBlock | Unavailable {
  if (!o) return OPERATIONAL_UNAVAILABLE;
  if (isUnavailable(o)) return o;
  if (o.version !== version) return { available: false, reason: `The runs read are for v${o.version}, not the published v${version}.` };
  const t = o.outcomes;
  const ended = t.completed + t.refused + t.failed;
  const failure = rateOf(t.failed, ended);
  let rank: RankEffect;
  if (ended < OPS_MIN_ENDED) rank = NONE(`${ended} attributed run${ended === 1 ? '' : 's'} of v${version} ended in the window; the failure rate moves the score from ${OPS_MIN_ENDED}.`);
  else if (typeof failure === 'number' && failure > 0) {
    rank = { effect: 'lowered', factor: Math.round((1 - OPS_PENALTY * failure) * 10_000) / 10_000, reason: `${t.failed} of ${ended} runs of v${version} by this company's agents failed after reaching the model in the last ${o.window.days} days.` };
  } else rank = NONE(`No run of v${version} by this company's agents failed in the last ${o.window.days} days; a clean record does not raise the score.`);
  return {
    available: true, version, window: { ...o.window }, scope: 'company_runs',
    outcomes: { ...t, ended, rates: { success: rateOf(t.completed, ended), refusal: rateOf(t.refused, ended), failure } },
    model_latency_ms: isUnavailable(o.model_latency_ms) ? o.model_latency_ms : { ...o.model_latency_ms },
    cost_per_completed_run: COST_NOT_READ, run_latency: RUN_LATENCY_UNAVAILABLE, workflows: WORKFLOWS_UNAVAILABLE, rank,
  };
}

const STOP = new Set((
  'a an and are as at be been being but by can could do does did for from get give go had has have help how i if in into is it '
  + 'its let me my need of on or our ours please should so some than that the their them then there these this those to up us '
  + 'want was we what when where which who why will with would you your yours left current new next last per each any all just '
  + 'tell show make look likely like much many'
).split(' '));

/** Acts no skill performs: skills read records and write briefs, drafts or proposed record changes for a person. */
export const ACTS: ReadonlyMap<string, string> = new Map([
  ['send', 'send messages'], ['email', 'send email'], ['mail', 'send email'], ['book', 'make bookings'], ['reserve', 'make bookings'],
  ['pay', 'make payments'], ['wire', 'move money'], ['transfer', 'move money'], ['buy', 'make purchases'], ['purchase', 'make purchases'],
  ['sign', 'sign documents'], ['submit', 'submit filings'], ['tweet', 'post publicly'], ['delete', 'delete records'],
]);

const DRAFT_WORDS = new Set(['draft', 'write', 'writ']);

/** A word's light stem: plural, -ing and -ed off, a doubled final consonant and a final e dropped. Deterministic. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 3 && /([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|ff|zz)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

/** The text's content terms, in order: lower-cased words, stop words dropped, stemmed. */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const raw of String(text ?? '').toLowerCase().replace(/['’]s\b/g, '').split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw) || /^\d+$/.test(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

const tagWords = (slug: string) => terms(slug.replace(/_/g, ' '));

/** Why `agent` may not be offered `s` for this request; null when it may. `attachCheck`'s order, then discovery's. */
export function gateOf(s: DiscoverySkill, agent: DiscoveryAgent, outputKind?: string | null, seams: DiscoverySeams = {}): Refusal | null {
  if (s.scope === 'company' && (s.company == null || String(s.company) !== String(agent.company ?? ''))) return { code: 'not_found' };
  if (!s.readable) return { code: 'not_found' };
  if (!Number.isSafeInteger(s.version) || (s.version ?? 0) < 1) return { code: 'version_not_published' };
  if (s.status === 'retired') return { code: 'skill_retired' };
  if (s.suspended) return { code: 'skill_suspended' };
  if (!s.roles.includes(agent.role)) return { code: 'role_mismatch' };
  const missing = missingTools(s.tools, agent.tools.map((tool) => ({ integration_uid: '', tool })));
  if (missing.length) return { code: 'tool_not_approved', tool: { key: missing[0], label: toolLabel(missing[0]) } };
  if (outputKind && s.output_kind !== outputKind) return { code: 'output_mismatch' };
  if (s.inputs) {
    const { unmet } = inputGapsOf(s.inputs);
    if (unmet.length) return { code: 'input_unavailable', inputs: unmet.map(line) };
  }
  if (seams.inputs && !seams.inputs(s)) return { code: 'input_unavailable' };
  if (s.runnable && !s.runnable.ok) return { code: 'not_runnable', run: s.runnable.code };
  if (seams.runnable && !seams.runnable(s)) return { code: 'not_runnable' };
  return null;
}

/** A request's bounds (the contract's), or the reason it is refused. Unknown keys are ignored. */
export function checkDiscoveryRequest(body: unknown): { ok: true; request: Required<DiscoveryRequest> } | { ok: false; code: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const task = typeof b.task === 'string' ? b.task.trim() : '';
  if (!task || task.length > TASK_MAX) return { ok: false, code: 'task_invalid' };
  const output = b.output_kind ?? null;
  if (output !== null && output !== 'brief' && output !== 'draft' && output !== 'record_change') return { ok: false, code: 'output_kind_invalid' };
  const focus = b.taxonomy_focus ?? [];
  if (!Array.isArray(focus) || focus.length > FOCUS_MAX || !focus.every((f) => typeof f === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(f))) {
    return { ok: false, code: 'taxonomy_focus_invalid' };
  }
  const limit = b.limit ?? LIMIT_DEFAULT;
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > LIMIT_MAX) return { ok: false, code: 'limit_invalid' };
  return { ok: true, request: { task, output_kind: output as OutputKind | null, taxonomy_focus: focus as string[], limit: limit as number } };
}

type Doc = { tf: Map<string, number>; length: number };

/** One skill's weighted term counts: name x3, purpose x2, steps x1, tag slug words x1. */
function docOf(s: DiscoverySkill): Doc {
  const tf = new Map<string, number>();
  let length = 0;
  const add = (words: string[], w: number) => { for (const t of words) { tf.set(t, (tf.get(t) ?? 0) + w); length += w; } };
  add(terms(s.name), FIELD_WEIGHT.name);
  add(terms(s.purpose), FIELD_WEIGHT.purpose);
  for (const step of s.steps) add(terms(step), FIELD_WEIGHT.steps);
  for (const tag of s.taxonomy) add(tagWords(tag.slug), FIELD_WEIGHT.tags);
  return { tf, length };
}

type Scored = {
  s: DiscoverySkill; score: number; coverage: number; matched: string[]; focus: string[]; areas: string[]; draftPreferred: boolean;
  evaluation: EvaluationBlock | Unavailable; operational: OperationalBlock | Unavailable;
};

const sentence = (text: string) => text.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase());

/**
 * The recommendation for `request` on `agent` over `skills`. Pure and deterministic: the same facts give the same
 * answer, ties broken by name then uid.
 */
export function discoverSkills(request: DiscoveryRequest, agent: DiscoveryAgent, skills: readonly DiscoverySkill[], seams: DiscoverySeams = {}): Discovery {
  const limit = Math.min(LIMIT_MAX, Math.max(1, Number.isSafeInteger(request.limit) ? request.limit as number : LIMIT_DEFAULT));
  const focusSet = new Set(request.taxonomy_focus ?? []);
  const outputKind = request.output_kind ?? null;
  const words = String(request.task ?? '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const queryTerms = [...new Set(terms(request.task))];
  const act = words.map((w) => ACTS.get(w)).find(Boolean) ?? null;
  const draftAsked = outputKind === null && queryTerms.some((t) => DRAFT_WORDS.has(t));

  // The read gate first: IDF is taken only over skills the caller may read, so a hidden skill shapes no score.
  const visible = skills.map((s) => ({ s, why: gateOf(s, agent, outputKind, seams) })).filter((x) => x.why?.code !== 'not_found');
  const docs = new Map(visible.map((x) => [x.s, docOf(x.s)]));
  const n = visible.length;
  const avgLength = n ? [...docs.values()].reduce((a, d) => a + d.length, 0) / n : 1;
  const df = new Map<string, number>();
  for (const d of docs.values()) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + (n - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
  const mass = queryTerms.reduce((a, t) => a + idf(t), 0);

  const score = (s: DiscoverySkill): Scored => {
    const d = docs.get(s)!;
    let bm25 = 0; let hit = 0; const matched: string[] = [];
    for (const t of queryTerms) {
      const f = d.tf.get(t) ?? 0;
      if (!f) continue;
      matched.push(t);
      hit += idf(t);
      bm25 += idf(t) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * d.length / avgLength));
    }
    const focus = s.taxonomy.map((g) => g.slug).filter((g) => focusSet.has(g));
    const areas = s.taxonomy.map((g) => g.slug).filter((g) => !focusSet.has(g) && tagWords(g).some((w) => queryTerms.includes(w)));
    const draftPreferred = draftAsked && s.output_kind === 'draft';
    const boost = (1 + FOCUS_BOOST * focus.length) * (1 + AREA_BOOST * Math.min(1, areas.length)) * (1 + (draftPreferred ? OUTPUT_BOOST : 0));
    // Stages 4 and 5: a factor of 1 unless the evidence is there, complete and fresh. Never a use count.
    const version = Number(s.version);
    const evaluation = evaluationOf(s.quality, version);
    const operational = operationalOf(s.operations, version);
    const evidence = (evaluation.available ? evaluation.rank.factor : 1) * (operational.available ? operational.rank.factor : 1);
    return { s, score: bm25 * boost * evidence, coverage: mass > 0 ? hit / mass : 0, matched, focus, areas, draftPreferred, evaluation, operational };
  };
  const order = (a: Scored, b: Scored) => b.score - a.score || a.s.name.localeCompare(b.s.name) || a.s.uid.localeCompare(b.s.uid);

  const eligible = visible.filter((x) => x.why === null).map((x) => score(x.s)).filter((x) => x.score > 0 && x.coverage >= MIN_COVERAGE).sort(order);
  const top = eligible[0]?.score ?? 0;
  const kept = eligible.filter((x) => x.score >= KEEP_RATIO * top).slice(0, limit);

  const blocked: BlockedSkill[] = visible.filter((x) => x.why !== null)
    .map((x) => ({ x, sc: score(x.s) })).filter(({ sc }) => sc.score > 0 && sc.coverage >= MIN_COVERAGE).sort((a, b) => order(a.sc, b.sc)).slice(0, limit)
    .map(({ x }) => ({
      skill_uid: x.s.uid, name: x.s.name, code: x.why!.code as BlockedSkill['code'], ...(x.why!.tool ? { tool: x.why!.tool } : {}),
      ...(x.why!.inputs ? { inputs: x.why!.inputs } : {}), ...(x.why!.run ? { run: x.why!.run } : {}),
    }));

  const vague = queryTerms.length <= 1;
  const ambiguous = !act && kept.length >= 2 && (kept[1].score >= AMBIGUOUS_RATIO * kept[0].score || vague);
  const outcome: Discovery['outcome'] = act || !kept.length ? 'no_suitable_skill' : ambiguous ? 'ambiguous' : 'recommend';

  const candidates: Candidate[] = kept.map((x, i) => {
    const reasons: Reason[] = [
      { signal: 'task', text: `The task's terms ${x.matched.map((t) => `"${t}"`).join(', ')} appear in the skill's name, purpose or steps.` },
      { signal: 'role', text: `Listed for ${agent.role}.` },
    ];
    if (x.focus.length) reasons.push({ signal: 'taxonomy', text: `Tagged ${x.focus.join(', ')}, as the request's taxonomy focus asks.` });
    if (x.areas.length) reasons.push({ signal: 'taxonomy', text: `Tagged ${x.areas.join(', ')}, an area the task names.` });
    if (outputKind) reasons.push({ signal: 'output', text: `Produces a ${outputKind}, as asked.` });
    else if (x.draftPreferred) reasons.push({ signal: 'output', text: 'Produces a draft, which the task asks for.' });
    if (x.evaluation.available && x.evaluation.rank.effect !== 'none') reasons.push({ signal: 'quality', text: x.evaluation.rank.reason });
    if (x.operational.available && x.operational.rank.effect !== 'none') reasons.push({ signal: 'operational', text: x.operational.rank.reason });
    let confidence: Candidate['confidence'] = 'medium';
    let uncertainty: string | null = null;
    if (outcome === 'no_suitable_skill') {
      confidence = 'low';
      uncertainty = `The task asks to ${act}, which no skill does; this skill only prepares a ${x.s.output_kind} for a person to act on.`;
    } else if (outcome === 'ambiguous') {
      confidence = 'low';
      uncertainty = 'The task fits more than one skill about equally; see the clarifying question.';
    } else if (i === 0 && x.coverage >= HIGH_COVERAGE && (kept.length < 2 || kept[1].score < RUNNER_UP_RATIO * x.score)) {
      confidence = 'high';
    } else {
      uncertainty = i === 0
        ? `The skill matches ${Math.round(x.coverage * 100)}% of the task's term weight${kept.length > 1 ? ', and another skill scores close to it' : ''}.`
        : 'Ranked below the first candidate on task relevance.';
    }
    return {
      skill_uid: x.s.uid, name: x.s.name, version: x.s.version as number, reasons,
      fit: { role: true, taxonomy: [...x.focus, ...x.areas] }, missing: [],
      inputs: inputsBlockOf(x.s.inputs), evaluation: x.evaluation, operational: x.operational,
      confidence, uncertainty, score: Math.round(x.score * 1000) / 1000, coverage: Math.round(x.coverage * 1000) / 1000,
    };
  });

  let abstain: string | null = null;
  if (outcome === 'no_suitable_skill') {
    if (act) abstain = `The task asks to ${act}. Skills read records and prepare briefs, drafts or proposed changes for a person; none can do that.`;
    else if (blocked.length) {
      const b = blocked[0];
      abstain = b.code === 'tool_not_approved'
        ? `No skill this agent can run fits the task. ${b.name} fits, but needs ${b.tool!.label}, which this agent is not granted.`
        : b.code === 'input_unavailable' && b.inputs?.length
          ? `No skill this agent can run fits the task. ${b.name} fits, but its inputs cannot be read for this agent: ${b.inputs.map((i) => `${i.field} (${i.reason === 'wrong_shape' ? 'wrong_shape' : i.status})`).join('; ')}.`
          : `No skill this agent can run fits the task. ${b.name} fits, but is blocked for it (${b.code}${b.run ? `: ${b.run}` : ''}).`;
    } else abstain = 'No skill in the catalogue fits the task well enough to offer.';
  }
  const clarify = outcome === 'ambiguous'
    ? `Which do you mean: ${kept[0].s.name} (${sentence(kept[0].s.purpose)}), or ${kept[1].s.name} (${sentence(kept[1].s.purpose)})?`
    : null;

  const checked = visible.filter((x) => x.s.inputs).length;
  const evaluated = candidates.filter((c) => c.evaluation.available).length;
  const measured = candidates.filter((c) => c.operational.available).length;
  const stages: Stage[] = [
    { stage: 1, name: 'role and taxonomy fit', used: `role ${agent.role}; taxonomy_focus ${focusSet.size ? [...focusSet].join(', ') : 'none'}; tag slug words in the task`, available: true, reason: null },
    { stage: 2, name: 'task relevance', used: 'BM25 over the published version\'s name, purpose, steps and tags, in the Worker', available: true, reason: null },
    {
      stage: 3, name: 'input and output compatibility',
      used: [outputKind ? `output_kind ${outputKind} (a gate)` : draftAsked ? 'a draft, which the task asks for' : null,
        checked ? `#4667's preflight for ${checked} skill${checked === 1 ? '' : 's'} on this agent's scope (a gate)` : null].filter(Boolean).join('; ') || null,
      available: true,
      reason: checked || seams.inputs ? (checked ? 'Skills outside #4667\'s first ten have no input binding reported: their inputs are Not recorded, never assumed available.' : null)
        : 'Inputs are not checked: no input binding is reported for any skill read (#4667).',
    },
    {
      stage: 4, name: 'quality evidence',
      used: evaluated ? `the published version's release manifest (D4533) and its golden-case results, fresh within ${QUALITY_FRESH_DAYS} days, for ${evaluated} candidate${evaluated === 1 ? '' : 's'}` : null,
      available: evaluated > 0, reason: evaluated ? null : candidates.length ? 'No candidate has quality evidence recorded; nothing is scored on it.' : 'There is no candidate to read quality evidence for.',
    },
    {
      stage: 5, name: 'operational evidence',
      used: measured ? `#4536's attributed outcomes and model-call latency for the executed version, over this company's agents' runs, for ${measured} candidate${measured === 1 ? '' : 's'}` : null,
      available: measured > 0, reason: measured ? null : candidates.length ? 'No candidate has run measures recorded; nothing is scored on them.' : 'There is no candidate to read run measures for.',
    },
  ];

  return { outcome, candidates, blocked, clarify, abstain_reason: abstain, stages };
}
