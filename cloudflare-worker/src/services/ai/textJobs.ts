/**
 * #3937 (D1478 task 3, part 2): which model a text job runs.
 *
 * Each text job of the use-case plan (§2, `modelUseCases.ts`) has a Default,
 * an Alternative, a Deeper model and maybe a fallback. `textChoice` orders
 * them for one run, by the tests `drawChoice` and `speechChoice` use, plus
 * one of its own:
 *
 *   1. **The catalogue.** The model is offered (`isOffered`, the partner
 *      switch, HQ's switch-offs), not hidden and not on Legal's hold, and it
 *      writes text (a Text Generation model).
 *   2. **The plan lock** (A (c)): `MODEL_LOCKS`.
 *   3. **The input fits** (§4.2, "no 24K or 32K Default for a long input").
 *      A model whose context window cannot hold the run's input and its
 *      output allowance is skipped, and the receipt says so (`too_long`). A
 *      window the catalogue does not state is taken as fitting, as the router
 *      already does (`shapes.fitsContext`).
 *   4. **Never swapped silently** (A (c)). A model the caller named, or the
 *      member's stored pick, that the plan locks is refused (`plan_locked`).
 *      A named model the job does not list is refused (`model_not_offered`).
 *
 * The run's chain is what is left of Default, Alternative, Deeper and
 * fallback, in that order: a failed call moves down it as any chain does.
 * When nothing listed can take the input, the press is refused with
 * `input_too_long`, naming the job's longest-window model, so the quote says
 * what would take it rather than an empty price.
 */
import { LEGAL_HOLD, LOCK_LABELS, MODEL_LOCKS, jobChoices, jobStep, type Lock, type UseJob, type UseKind } from './modelUseCases';
import { isOffered, modelById, type CatalogueSwitches } from './catalogue';
import { lockAllows, type PlanTier } from './drawJobs';

/** The kinds a text job writes in. */
export const TEXT_KINDS: ReadonlySet<UseKind> = new Set(['chat', 'write', 'synth', 'plan', 'reason', 'legal', 'numbers', 'research', 'code', 'agent']);

/** A text job's step: the first step of the job whose kind writes text, or null. */
export function textJob(id: string): UseJob | null {
  for (let step = 0; step < 4; step++) {
    const j = jobStep(id, step);
    if (!j) return null;
    if (TEXT_KINDS.has(j.kind)) return j;
  }
  return null;
}
export const isTextJob = (id: unknown): id is string => typeof id === 'string' && !!textJob(id);

export interface TextContext {
  switches: CatalogueSwitches;
  tier: PlanTier;
  /** The run's input, in tokens (an upper bound), and its output allowance. */
  inputTokens: number;
  outputTokens: number;
  /** A model the caller named for this run. */
  caller?: string | null;
  /** The member's stored pick for the run's option. */
  pick?: string | null;
}

export type TextSource = 'default' | 'alternative' | 'deeper' | 'fallback' | 'caller' | 'pick';
export type TextSkip = 'not_offered' | 'plan_locked' | 'too_long';
export type TextChoice =
  | { ok: true; model: string; chain: string[]; source: TextSource; job: string; skipped: Array<{ model: string; reason: TextSkip }> }
  | { ok: false; code: 'plan_locked'; model: string; label: string; message: string }
  | { ok: false; code: 'model_not_offered'; model: string; message: string }
  | { ok: false; code: 'input_too_long'; job: string; longest: string | null; message: string }
  | { ok: false; code: 'press_hidden'; job: string; message: string };

/** Whether the model's window holds the input and the output; an unstated window fits. */
export function fits(model: string, inputTokens: number, outputTokens: number): boolean {
  const w = modelById(model)?.context_window;
  return w == null || inputTokens + outputTokens <= w;
}

/**
 * Models a job's ladder lists that no route or rail row runs yet. Running one
 * would wire a new model, which the owner's spend rule puts behind a stated
 * monthly cost and an approval (#3721). Until then a ladder passes over it as
 * not offered. `text_jobs_part2_d1478.test.ts` holds this list equal to the
 * ladder models nothing else runs.
 */
export const AWAITING_SPEND_APPROVAL: ReadonlySet<string> = new Set<string>(); // nemotron left it when #4063 wired it (memo_write's fallback)

/** Why a model cannot run this job for this plan and input, or null when it can. */
export function textBlock(model: string, ctx: TextContext): TextSkip | null {
  const m = modelById(model);
  if (!m || m.kind !== 'Text Generation' || !isOffered(m, ctx.switches) || MODEL_LOCKS[model] === 'hidden' || LEGAL_HOLD.has(model) || AWAITING_SPEND_APPROVAL.has(model)) return 'not_offered';
  if (!lockAllows(MODEL_LOCKS[model] ?? 'all', ctx.tier)) return 'plan_locked';
  if (!fits(model, ctx.inputTokens, ctx.outputTokens)) return 'too_long';
  return null;
}

const lockedRefusal = (model: string): TextChoice => {
  const label = LOCK_LABELS[MODEL_LOCKS[model] as Exclude<Lock, 'all'>] ?? 'Paid plans';
  return { ok: false, code: 'plan_locked', model, label, message: `This model is on ${label}. Pick another model, or change your plan.` };
};

/** The job's own four, in the order a run tries them, each with its role. */
function ladder(job: UseJob): Array<{ model: string; source: TextSource }> {
  const rows: Array<{ model: string | null; source: TextSource }> = [
    { model: job.default, source: 'default' }, { model: job.alternative, source: 'alternative' },
    { model: job.deeper, source: 'deeper' }, { model: job.fallback, source: 'fallback' },
  ];
  const seen = new Set<string>();
  return rows.filter((r): r is { model: string; source: TextSource } => !!r.model && !seen.has(r.model) && !!seen.add(r.model));
}

/**
 * #4351 (D4351): the plan-lock and input-fit checks `textChoice` applies to its
 * own picks, for a model the caller names (an All models choice, a persona
 * module) on a page whose job is `jobId`. Whether the model is on the page's
 * list is the caller's check; this one never chooses another model. Null when
 * the model may run; otherwise the refusal, in words that say why and what to do.
 */
export function namedModelCheck(jobId: string, model: string, ctx: TextContext):
  | null
  | { code: 'plan_locked'; message: string }
  | { code: 'input_too_long'; message: string } {
  const why = textBlock(model, ctx);
  if (why === 'plan_locked') {
    return { code: 'plan_locked', message: (lockedRefusal(model) as { message: string }).message };
  }
  if (why === 'too_long') {
    const job = textJob(jobId);
    const name = modelById(model)?.name ?? model;
    return { code: 'input_too_long', message: job ? `${tooLongMessage(job, model)} Or pick another model.` : `This material is too long for ${name}. Pick another model, or shorten it. Nothing was run.` };
  }
  return null;
}

/** The model a text job runs, and the chain after it. See the file header for the order. */
export function textChoice(jobId: string, ctx: TextContext): TextChoice {
  const job = textJob(jobId);
  if (!job) return { ok: false, code: 'press_hidden', job: jobId, message: 'This press has no text job.' };
  const steps = ladder(job);
  const skipped: Array<{ model: string; reason: TextSkip }> = [];
  const usable = steps.filter((s) => {
    const why = textBlock(s.model, ctx);
    if (why) skipped.push({ model: s.model, reason: why });
    return !why;
  });
  const chainAfter = (first: string) => usable.map((s) => s.model).filter((m) => m !== first);
  const listed = new Set(jobChoices(job));
  for (const [named, source] of [[ctx.caller, 'caller'], [ctx.pick, 'pick']] as const) {
    if (!named) continue;
    if (!listed.has(named)) {
      if (source === 'caller') return { ok: false, code: 'model_not_offered', model: named, message: `${named} is not offered for this press` };
      continue; // a stored pick the job no longer lists reads as none
    }
    const why = textBlock(named, ctx);
    if (why === 'plan_locked') return lockedRefusal(named);
    if (!why) return { ok: true, model: named, chain: chainAfter(named), source, job: job.id, skipped: [] };
    if (source === 'caller') {
      return why === 'too_long'
        ? { ok: false, code: 'input_too_long', job: job.id, longest: longestOf(job), message: tooLongMessage(job, named) }
        : { ok: false, code: 'model_not_offered', model: named, message: `${named} is not offered for this press` };
    }
  }
  if (usable.length) {
    const [first, ...rest] = usable;
    return { ok: true, model: first.model, chain: rest.map((s) => s.model), source: first.source, job: job.id, skipped: skipped.filter((s) => steps.findIndex((x) => x.model === s.model) < steps.findIndex((x) => x.model === first.model)) };
  }
  if (skipped.some((s) => s.reason === 'too_long')) return { ok: false, code: 'input_too_long', job: job.id, longest: longestOf(job), message: tooLongMessage(job, null) };
  return { ok: false, code: 'press_hidden', job: job.id, message: 'This press is not available on your plan yet.' };
}

/** The job's longest-window model, for the refusal's words; an unstated window counts as none. */
function longestOf(job: UseJob): string | null {
  return ladder(job).map((s) => s.model).sort((a, b) => (modelById(b)?.context_window ?? 0) - (modelById(a)?.context_window ?? 0))[0] ?? null;
}

function tooLongMessage(job: UseJob, named: string | null): string {
  const longest = longestOf(job);
  const name = (id: string | null) => (id ? modelById(id)?.name ?? id : 'any model');
  const lead = named ? `This material is too long for ${name(named)}.` : 'This material is too long for every model this press runs.';
  return longest && longest !== named ? `${lead} ${name(longest)} reads the most; shorten it to fit. Nothing was run.` : `${lead} Shorten it to fit. Nothing was run.`;
}

/**
 * The text jobs a route task runs, when its caller names none. Each maps a
 * task to the job its callers serve, so the job's ladder and receipt apply.
 * A rail press on a page the matrix lists keeps that page's row (D764): the
 * router applies a task's job only when no page row decides, so Research's
 * drafts, Readiness and Use of funds (all `workspace_explain`) run their pages'
 * rows, and a caller that names `RunOptions.textJob` still gets its job.
 *
 * Part 3 (#3937): most rows keep the model the task ran first (the job's
 * Default is the route's model). `TASK_MODEL_MOVES` names the rows whose
 * Default is another model the platform already runs; none wires a new one.
 */
export const TASK_TEXT_JOBS: Readonly<Record<string, string>> = Object.freeze({
  paraphrase: 'MI1', // snippets de-identified (fix 5)
  system_job: 'IN5', // valuation and equity queue jobs (fix 14)
  system_legal: 'IN6', // LPA drafting (fix 14)
  ops_summary: 'AD3', // the monitoring summary: the one system job on the 8B
  // Part 3: the remaining single-purpose text tasks.
  tool_call: 'ST3', // Studio interview, Send: tool calls (glm-4.7-flash, fix 1)
  workspace_explain: 'ST2', // "Read this page back" on every workspace and Research
  advisor_explain: 'ST4', // the Personal Advisor's "Explain this question"
  onboarding_chat: 'ON1', // an onboarding chat turn
  structure_interview: 'VA5', // structure, summarise and extract items
  summarise_interview: 'VA5',
  extract_conversation_items: 'VA5',
  validate_tag_pains: 'VA11', // problem discovery: tag phrases
  validate_draft_hypotheses: 'VA15', // experiments: draft a hypothesis
  market_sizing_inputs: 'VA13', // market sizing
  competitor_scan: 'VA13', // competitor scan
  memo_write: 'IN1', // the IC memo (`derive:memo`)
  dd_synthesis: 'DK8', // map a deck's text to sections; review the deck or a version
  publication: 'AD1', // a publication summary
  brand_autofill: 'GR2', // landing auto-fill, palette and taglines
  brand_palette: 'GR2',
  brand_taglines: 'GR2',
  grow_theme_feedback: 'GR1', // feedback themes
  mail_draft: 'EM1', // a draft from ticked records
  distribution_draft: 'GR5', // D4488: Distribution posts, creatives and outreach
});

/**
 * #4313 (D4313): the job each rail option runs, so a press resolves its model
 * through `textChoice` (the job's ladder, the plan lock, the input's fit) and
 * not through its page's row (D764). Every option `railMatrix.json` registers
 * has a row; `rail_option_jobs_4313.test.ts` fails on one that has none.
 *
 * Most rows follow the plan's job for the press (§2). Where the plan names no
 * job for a press (several partner and investor reads), the row is the job
 * whose kind and Default match the press's own, and says "nearest". An option
 * whose job has no text step (a recording, an image, an upload) keeps its own
 * path: the router applies the table to text runs only.
 *
 * `RAIL_OPTION_PAGE_JOBS` holds the one option key that two pages use for
 * different work (`draft:renewal-risk`: numbers on Retainers, a summary on Health).
 */
export const RAIL_OPTION_JOBS: Readonly<Record<string, string>> = Object.freeze({
  // Studio and Eadwyn, onboarding
  'ask:studio': 'ST1', 'explain:question': 'ST4', 'transcribe:voice-answer': 'ST6',
  'answer:interview': 'ON1',
  'studio:layout': 'CA1', // nearest: a plan run on glm (D1420's layout proposal)
  'propose:goal-plan': 'BU2',
  'sessions:block': 'CA1', // runs no model (D1596)
  // Validate
  'fill:pain_tag': 'VA11', 'transcribe:interview': 'VA1', 'transcribe:session': 'VA1', 'transcribe:recording': 'VA1',
  'summarise:session': 'VA5', 'structure:transcript': 'VA5', 'ask:transcript': 'VA6', 'fill:hypothesis': 'VA15',
  // Build
  'draft:build/plan': 'BU1', 'draft:build/roadmap': 'BU2', 'draft:build/this-week': 'BU2', 'draft:build/retro': 'BU2', 'draft:build/kpi': 'BU3',
  // Raise
  'draft:raise/use-of-funds-check': 'RA8', 'draft:raise/use-of-funds-runway': 'RA8',
  'form:uof-milestone-wording': 'BU1', // nearest: plan wording on the 70B
  'draft:raise/pmf-explain': 'RA6', 'draft:raise/legal': 'RA6',
  'draft:raise/pmf-questions': 'RA1', // nearest: Raise writing on the 70B
  'draft:raise/data-room': 'RA2',
  'draft:raise/narrative-fix': 'RA1', 'draft:narrative-positioning': 'RA1', 'draft:narrative-section': 'RA1', 'draft:narrative-objection': 'RA1', 'review:narrative-coach': 'DK8',
  'draft:raise/capital': 'RA8', 'draft:raise/liquidity': 'RA8', 'draft:update': 'RA12',
  // The deck
  'form:deck': 'DK1', 'form:deck-template': 'DK1', 'deck:outline': 'DK1', 'deck:build': 'DK1',
  'deck:rewrite': 'DK2', 'deck:shorten': 'DK2', 'deck:expand': 'DK2', 'deck:tone': 'DK2', 'deck:translate': 'DK2',
  'deck:notes': 'DK2', 'deck:chart': 'DK2', 'deck:table': 'DK2', 'deck:timeline': 'DK2',
  'deck:critic': 'DK8', 'deck:wording': 'DK8', 'deck:image': 'DK4',
  'transcribe:rehearsal': 'DK11', 'transcribe:rehearsal-live': 'DK11', 'rehearse:coach': 'DK12',
  'review:deck-file': 'DK7', 'review:deck-text': 'DK8', 'review:deck-again': 'DK8', 'review:deck-version': 'DK8',
  'derive:memo': 'IN1',
  // Grow
  'fill:feedback_theme': 'GR1', 'draft:grow/customers': 'GR2', 'form:landing': 'GR2', 'form:palette': 'GR2', 'draft:taglines': 'GR2',
  'draft:logo': 'GR3', 'draft:grow/talent': 'GR4',
  'draft:distribution': 'GR5', // D4488: campaign assets and outreach text
  'draft:publish': 'GR2', // #4046: Publish to…'s post text, as Grow's other marketing writing
  // Network
  'draft:network/re-engagement': 'NE2', 'draft:network/intro-email': 'NE2',
  'draft:network/relationships': 'NE1', 'draft:network/introductions': 'NE1',
  'draft:orphan-reassignment': 'NE1', 'suggest:paths': 'NE1', 'draft:pass-reasons': 'NE1',
  // Research
  'ask:research': 'RE1', 'ask:library': 'RE1', 'ask:evidence': 'RE1', 'ask:question': 'RE1',
  'draft:research/ask': 'RE3', 'draft:research/funds': 'RE3', 'draft:research/library': 'RE3', 'draft:index-gaps': 'RE3',
  'analyse:competitors': 'RE3', 'analyse:again': 'RE3', 'analyse:sources': 'RE3', 'extract:candidate': 'RE3', 'extract:site': 'RE3',
  'analyze:competitors': 'RE3', 'rerun:analysis': 'RE3', 'refresh:sources': 'RE3',
  'upload:document': 'RE2', 'upload:reindex': 'RE2', 'reindex:document': 'RE2',
  'draft:session-brief': 'CA2', 'draft:checkpoint-brief': 'CA2',
  // Invest, the fund and the portfolio
  'draft:ic-memo': 'IN1', 'draft:closing-cover-note': 'IN1', 'draft:thin-evidence': 'IN1',
  'draft:multiple-narrative': 'IN5',
  'draft:updates-read': 'IN13', // nearest: a summary on the 70B (IN9 reads sentiment and writes nothing)
  'draft:support-summary': 'IN11', 'draft:lp-reminder': 'RA10',
  // Advisor and Operating Partner practice
  'draft:terms': 'IN11', 'draft:proposal': 'IN11', 'draft:chases': 'IN11', 'draft:weekly-reports': 'IN11',
  'draft:catalog-read': 'IN11', 'draft:consent-requests': 'IN11',
  'draft:period-narrative': 'GR16', 'draft:quarter-narrative': 'GR16', 'draft:attribution-read': 'GR16', 'draft:renewal-risk': 'GR16',
  'draft:win-loss-read': 'IN13', 'draft:single-contact-exposure': 'IN13', // nearest: a summary on the 70B
  'draft:counter': 'IN3',
  'draft:operating-brief': 'CA1', 'draft:board-read': 'CA1', 'draft:capacity-findings': 'CA1',
  'draft:expiry-consequences': 'CA4',
  // HQ
  'draft:publication-summary': 'AD1',
});

/**
 * The options whose job's Default is not the model their kind's list ran
 * first (`RAIL_KIND_JOBS`, D1478). Each follows the plan's job for the press,
 * and each model already runs elsewhere, so none is newly wired.
 * `rail_option_jobs_4313.test.ts` holds this list equal to the table.
 */
export const OPTION_MODEL_MOVES: Readonly<Record<string, { from: string; to: string }>> = Object.freeze({
  'draft:build/retro': { from: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', to: '@cf/zai-org/glm-4.7-flash' }, // BU2: roadmap, this-week and retro
  'draft:closing-cover-note': { from: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', to: '@cf/openai/gpt-oss-120b' }, // IN1: the closing note
  'draft:index-gaps': { from: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', to: '@cf/openai/gpt-oss-120b' }, // RE3: research drafts
});

/** The option key two pages use for different work: the page's own job wins. */
export const RAIL_OPTION_PAGE_JOBS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  'draft:renewal-risk': Object.freeze({ 'operating partner · delivery · health': 'IN13' }),
});

/** The job a rail option runs on a page, or null when the table has no row for it. */
export function railOptionJob(page: string | null | undefined, option: string | null | undefined): string | null {
  if (typeof option !== 'string') return null;
  const byPage = RAIL_OPTION_PAGE_JOBS[option];
  const onPage = byPage && typeof page === 'string' ? byPage[page.trim().toLowerCase()] : undefined;
  return onPage ?? RAIL_OPTION_JOBS[option] ?? null;
}

/** The text job a rail option runs, or null when its job writes no text (it keeps its own path). */
export function railOptionTextJob(page: string | null | undefined, option: string | null | undefined): string | null {
  const id = railOptionJob(page, option);
  return id && textJob(id) ? id : null;
}

/**
 * The tasks whose job's Default is not the model the route ran first. Every
 * model here already runs elsewhere, so none is newly wired; each moves the
 * task's first model to the plan's Default. A test holds this list equal to
 * the table, so a row that silently changes a member's model is red.
 */
export const TASK_MODEL_MOVES: Readonly<Record<string, { from: string; to: string }>> = Object.freeze({
  advisor_explain: { from: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', to: '@cf/zai-org/glm-4.7-flash' },
  onboarding_chat: { from: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', to: '@cf/zai-org/glm-4.7-flash' },
  validate_draft_hypotheses: { from: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', to: '@cf/openai/gpt-oss-120b' },
  market_sizing_inputs: { from: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', to: '@cf/openai/gpt-oss-120b' },
  competitor_scan: { from: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', to: '@cf/openai/gpt-oss-120b' },
  dd_synthesis: { from: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', to: '@cf/openai/gpt-oss-120b' },
});
