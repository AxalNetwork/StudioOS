/**
 * #3935 (D1478 task 1): which model a draw job runs.
 *
 * Each draw job of the use-case plan (§2, `modelUseCases.ts`) has a Default
 * and a fallback. `drawChoice` picks between them, and between a model the
 * caller named or the member's stored pick, by four tests, in this order:
 *
 *   1. **The legal hold** (owner answer D (a)). Until Legal reads each image
 *      vendor's terms, only FLUX.1 Schnell and FLUX.2 Klein 4B are offered.
 *      `LEGAL_HOLD` names the rest; lifting the hold is a one-line change to
 *      that list, not to this code.
 *   2. **The catalogue.** The model is offered (`isOffered`: ga or partner,
 *      priced, and the partner switch `AI_PARTNER_MODELS` on), and it draws
 *      (`IMAGE_SPECS`). An edit job also needs a model that takes references.
 *   3. **The plan lock** (A (c), C (b)). `MODEL_LOCKS` gives each model the
 *      plans that may run it: every plan, paid plans, or the top paid plan.
 *      A member pays a plan when `planAllowanceFor` finds one. There is no
 *      reliable signal yet for the top paid plan, so a `top_paid` model is
 *      locked for everyone until there is (fail closed).
 *   4. **Never swapped silently** (A (c)). A model the caller named, or the
 *      member's stored pick, that the plan locks is refused with
 *      `plan_locked` and the plan's label. It is never replaced by another
 *      model. The automatic choice is the job's Default when it passes all
 *      three tests, else the job's fallback, and the receipt names the model
 *      that ran (`source: 'fallback'`, with the reason the Default did not).
 *
 * A job with no fallback (DK5 edit, EV3 lettered cover) whose Default cannot
 * run answers `press_hidden`: the page hides the press.
 */
import { LEGAL_HOLD, LOCK_LABELS, MODEL_LOCKS, jobChoices, jobStep, type Lock, type UseJob } from './modelUseCases';
import { isOffered, modelById, type CatalogueSwitches } from './catalogue';
import { IMAGE_SPECS } from './shapes';
import { planAllowanceFor } from '../planAllowance';
import type { Env } from '../../types';

/** The draw and edit jobs of §6 PR 1, each as the job step that draws. */
export const DRAW_JOB_STEPS: Readonly<Record<string, { id: string; step: number }>> = Object.freeze({
  DK4: { id: 'DK4', step: 0 },
  DK5: { id: 'DK5', step: 0 },
  GR3: { id: 'GR3', step: 0 },
  GR6: { id: 'GR6', step: 0 },
  GR7: { id: 'GR7', step: 0 },
  EV2: { id: 'EV2', step: 0 },
  EV3: { id: 'EV3', step: 0 },
  AR4: { id: 'AR4', step: 0 },
  LE8: { id: 'LE8', step: 0 },
  BU7: { id: 'BU7', step: 0 },
  VA17: { id: 'VA17', step: 0 },
  AG6: { id: 'AG6', step: 1 },
});
export type DrawJobId = keyof typeof DRAW_JOB_STEPS;
export const isDrawJob = (id: unknown): id is DrawJobId => typeof id === 'string' && Object.prototype.hasOwnProperty.call(DRAW_JOB_STEPS, id);

/** The job step a draw job runs, or null for an unknown id. */
export function drawJob(id: string): UseJob | null {
  const ref = isDrawJob(id) ? DRAW_JOB_STEPS[id] : null;
  return ref ? jobStep(ref.id, ref.step) : null;
}

/** A member's plan, as the lock reads it. `paid` when `planAllowanceFor` finds a paid plan. */
export type PlanTier = 'free' | 'paid';

/** Whether a plan may run a model under its lock. `top_paid` has no signal yet, so it is locked (fail closed). */
export function lockAllows(lock: Lock, tier: PlanTier): boolean {
  if (lock === 'all') return true;
  if (lock === 'lowest_paid') return tier === 'paid';
  return false;
}

export interface DrawContext {
  switches: CatalogueSwitches;
  tier: PlanTier;
  /** The models Legal has not cleared; `LEGAL_HOLD` unless a test passes its own. */
  held?: ReadonlySet<string>;
  /** A model the caller named for this press. */
  caller?: string | null;
  /** The member's stored pick for the press's option. */
  pick?: string | null;
}

export type DrawSource = 'default' | 'fallback' | 'caller' | 'pick';
export type DrawChoice =
  | { ok: true; model: string; source: DrawSource; job: string; skipped: null | { model: string; reason: DrawSkip } }
  | { ok: false; code: 'plan_locked'; model: string; label: string; message: string }
  | { ok: false; code: 'model_not_offered'; model: string; message: string }
  | { ok: false; code: 'press_hidden'; job: string; message: string };
export type DrawSkip = 'legal_hold' | 'not_offered' | 'plan_locked';

const LEGAL: ReadonlySet<string> = LEGAL_HOLD;

/** Every model a press may accept: what its selector can show (`jobChoices`), Default first. */
export const jobModels = (job: UseJob): string[] => jobChoices(job);

/** Why a model cannot run for this job and plan, or null when it can. */
export function drawBlock(job: UseJob, model: string, ctx: DrawContext): DrawSkip | null {
  const held = ctx.held ?? LEGAL;
  if (held.has(model)) return 'legal_hold';
  const m = modelById(model);
  const spec = IMAGE_SPECS[model];
  if (!m || !spec || !isOffered(m, ctx.switches) || MODEL_LOCKS[model] === 'hidden') return 'not_offered';
  if (job.kind === 'edit_image' && spec.maxReferences < 1) return 'not_offered';
  if (!lockAllows(MODEL_LOCKS[model] ?? 'all', ctx.tier)) return 'plan_locked';
  return null;
}

const lockedRefusal = (model: string): DrawChoice => {
  const label = LOCK_LABELS[MODEL_LOCKS[model] as Exclude<Lock, 'all'>] ?? 'Paid plans';
  return { ok: false, code: 'plan_locked', model, label, message: `This model is on ${label}. Pick another model, or change your plan.` };
};

/**
 * The model a draw job runs. See the file header for the order; a named model
 * or a stored pick must be one the job lists.
 */
export function drawChoice(jobId: string, ctx: DrawContext): DrawChoice {
  const job = drawJob(jobId);
  if (!job) return { ok: false, code: 'press_hidden', job: jobId, message: 'This press draws nothing.' };
  const listed = new Set(jobModels(job));
  if (ctx.caller) {
    if (!listed.has(ctx.caller)) return { ok: false, code: 'model_not_offered', model: ctx.caller, message: `${ctx.caller} is not offered for this press` };
    const why = drawBlock(job, ctx.caller, ctx);
    if (why === 'plan_locked') return lockedRefusal(ctx.caller);
    if (why) return { ok: false, code: 'model_not_offered', model: ctx.caller, message: `${ctx.caller} is not offered for this press` };
    return { ok: true, model: ctx.caller, source: 'caller', job: job.id, skipped: null };
  }
  if (ctx.pick && listed.has(ctx.pick)) {
    const why = drawBlock(job, ctx.pick, ctx);
    // A locked pick is refused, never swapped (A (c)); a pick that is no longer offered reads as none.
    if (why === 'plan_locked') return lockedRefusal(ctx.pick);
    if (!why) return { ok: true, model: ctx.pick, source: 'pick', job: job.id, skipped: null };
  }
  const why = drawBlock(job, job.default, ctx);
  if (!why) return { ok: true, model: job.default, source: 'default', job: job.id, skipped: null };
  if (job.fallback && !drawBlock(job, job.fallback, ctx)) {
    return { ok: true, model: job.fallback, source: 'fallback', job: job.id, skipped: { model: job.default, reason: why } };
  }
  return { ok: false, code: 'press_hidden', job: job.id, message: 'This press is not available on your plan yet.' };
}

/** Every draw job's step, for the tests and the coverage file. */
export const DRAW_JOBS: readonly UseJob[] = Object.freeze(Object.values(DRAW_JOB_STEPS).map((r) => jobStep(r.id, r.step)).filter((j): j is UseJob => !!j));

/**
 * A member's plan for the lock: `paid` when `planAllowanceFor` finds a plan
 * they pay, else `free`. A system run (no member) is `free`. A failed read
 * throws, so a paying member is never read as free (D1049); the router
 * answers `misconfigured` and runs nothing.
 */
export async function memberPlanTier(env: Env, userId: number): Promise<PlanTier> {
  if (!(userId > 0)) return 'free';
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<Record<string, unknown>>();
  if (!user) return 'free';
  const plan = await planAllowanceFor(env, user);
  return plan.parts.length > 0 ? 'paid' : 'free';
}
