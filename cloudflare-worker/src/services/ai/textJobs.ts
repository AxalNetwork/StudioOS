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
});

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
