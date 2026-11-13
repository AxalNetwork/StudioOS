/**
 * #3936 (D1478 task 2): which model a speech job runs — Listen (a file or a
 * live stream), Speak, and turn-taking.
 *
 * Each speech job of the use-case plan (§2, `modelUseCases.ts`) has a Default
 * and maybe a fallback. `speechChoice` picks between them, and between a model
 * the caller named or the member's stored pick, by the tests `drawChoice`
 * uses (`drawJobs.ts`), in the same order:
 *
 *   1. **The catalogue.** The model is offered (`isOffered`: ga or partner,
 *      priced, and the partner switch `AI_PARTNER_MODELS` on), and it does the
 *      job's work: a file is billed per minute (`audio_minutes`), a live
 *      stream per WebSocket minute (`audio_minutes_websocket`), a voice is a
 *      text-to-speech model.
 *   2. **The format.** GR9's prospect voice notes are Opus in Ogg; only an
 *      Aura voice makes it, so MeloTTS (MP3) is refused there.
 *   3. **The plan lock** (C (b): partner models on paid plans only).
 *   4. **Never swapped silently** (A (c)). A named or stored model the plan
 *      locks is refused with `plan_locked`, never replaced.
 *
 * The automatic choice is the job's Default, else its fallback. **MeloTTS
 * answers every Speak job while the gate is off** (owner answer C (b) and the
 * plan's §6 PR 2): it is the one voice that is neither a partner model nor
 * locked, and the table names it as every Speak job's Default or fallback
 * except GR9's (`speech_jobs_3936.test.ts` holds that). A job neither can run
 * answers `press_hidden`, and GR9 says why in its own words.
 *
 * `WALKTHROUGH_CAPTIONS` is the Listen job F11 (#3837) calls for a walkthrough's
 * captions: the DK11 class (Whisper Large v3 Turbo, or Whisper), whose segments
 * carry timestamps (`captionsOf`).
 */
import { LOCK_LABELS, MODEL_LOCKS, jobChoices, jobStep, type Lock, type UseJob } from './modelUseCases';
import { isOffered, modelById, type CatalogueSwitches } from './catalogue';
import { lockAllows, type PlanTier } from './drawJobs';
import type { SttTranscript } from '../sttFormats';

export const MELOTTS = '@cf/myshell-ai/melotts';

/** F11's walkthrough captions: the DK11 Listen class, with timestamps. */
export const WALKTHROUGH_CAPTIONS = 'DK11C';

/** The speech jobs of §6 PR 2, each as the job step that listens, speaks or takes turns. */
export const SPEECH_JOB_STEPS: Readonly<Record<string, { id: string; step: number }>> = Object.freeze({
  ST6: { id: 'ST6', step: 0 },
  ST7: { id: 'ST7', step: 0 },
  ST8: { id: 'ST8', step: 0 },
  ST10: { id: 'ST10', step: 0 },
  ST11: { id: 'ST11', step: 0 },
  VA1: { id: 'VA1', step: 0 },
  VA2: { id: 'VA2', step: 0 },
  VA3: { id: 'VA3', step: 0 },
  VA4: { id: 'VA4', step: 0 },
  VA10: { id: 'VA10', step: 0 },
  DK10: { id: 'DK10', step: 0 },
  DK11: { id: 'DK11', step: 0 },
  [WALKTHROUGH_CAPTIONS]: { id: 'DK11', step: 0 },
  AR5: { id: 'AR5', step: 0 },
  LE1: { id: 'LE1', step: 0 },
  LE2: { id: 'LE2', step: 0 },
  LE11: { id: 'LE11', step: 0 },
  GR9: { id: 'GR9', step: 0 },
  GR15: { id: 'GR15', step: 0 },
  IN12: { id: 'IN12', step: 0 },
  CA5: { id: 'CA5', step: 0 },
  AG11: { id: 'AG11', step: 0 },
  'AG11.speak': { id: 'AG11', step: 2 },
});
export type SpeechJobId = keyof typeof SPEECH_JOB_STEPS;
export const isSpeechJob = (id: unknown): id is SpeechJobId => typeof id === 'string' && Object.prototype.hasOwnProperty.call(SPEECH_JOB_STEPS, id);

/** The job step a speech job runs, or null for an unknown id. */
export function speechJob(id: string): UseJob | null {
  const ref = isSpeechJob(id) ? SPEECH_JOB_STEPS[id] : null;
  return ref ? jobStep(ref.id, ref.step) : null;
}

/** Speak jobs whose audio must be Opus in Ogg. */
export const OPUS_JOBS: ReadonlySet<string> = new Set(['GR9']);
export const OPUS_REFUSAL = 'This voice note must be Opus in Ogg, which only a Deepgram Aura voice makes, and Aura is not available on your plan yet. Nothing was run.';

export interface SpeechContext {
  switches: CatalogueSwitches;
  tier: PlanTier;
  /** A model the caller named for this press. */
  caller?: string | null;
  /** The member's stored pick for the press's option. */
  pick?: string | null;
}

export type SpeechSource = 'default' | 'fallback' | 'caller' | 'pick';
export type SpeechSkip = 'not_offered' | 'plan_locked' | 'format';
export type SpeechChoice =
  | { ok: true; model: string; source: SpeechSource; job: string; skipped: null | { model: string; reason: SpeechSkip } }
  | { ok: false; code: 'plan_locked'; model: string; label: string; message: string }
  | { ok: false; code: 'model_not_offered'; model: string; message: string }
  | { ok: false; code: 'press_hidden'; job: string; message: string };

/** Whether a model does the work of a speech kind, by how the catalogue bills it. */
function doesWork(kind: UseJob['kind'], model: string): boolean {
  const m = modelById(model);
  if (!m) return false;
  if (kind === 'listen_file') return m.kind === 'Automatic Speech Recognition' && m.prices.audio_minutes != null;
  if (kind === 'listen_live') return m.kind === 'Automatic Speech Recognition' && m.prices.audio_minutes_websocket != null;
  if (kind === 'speak') return m.kind === 'Text-to-Speech';
  if (kind === 'turn_taking') return m.kind === 'Voice Activity Detection';
  return false;
}

/** Why a model cannot run for this job and plan, or null when it can. */
export function speechBlock(jobId: string, job: UseJob, model: string, ctx: SpeechContext): SpeechSkip | null {
  const m = modelById(model);
  if (!m || !isOffered(m, ctx.switches) || MODEL_LOCKS[model] === 'hidden' || !doesWork(job.kind, model)) return 'not_offered';
  if (OPUS_JOBS.has(jobId) && model === MELOTTS) return 'format';
  if (!lockAllows(MODEL_LOCKS[model] ?? 'all', ctx.tier)) return 'plan_locked';
  return null;
}

const lockedRefusal = (model: string): SpeechChoice => {
  const label = LOCK_LABELS[MODEL_LOCKS[model] as Exclude<Lock, 'all'>] ?? 'Paid plans';
  return { ok: false, code: 'plan_locked', model, label, message: `This model is on ${label}. Pick another model, or change your plan.` };
};

/** The model a speech job runs. See the file header for the order. */
export function speechChoice(jobId: string, ctx: SpeechContext): SpeechChoice {
  const job = speechJob(jobId);
  if (!job) return { ok: false, code: 'press_hidden', job: jobId, message: 'This press has no speech job.' };
  const listed = new Set(jobChoices(job));
  const notOffered = (model: string): SpeechChoice => ({ ok: false, code: 'model_not_offered', model, message: `${model} is not offered for this press` });
  for (const [named, source] of [[ctx.caller, 'caller'], [ctx.pick, 'pick']] as const) {
    if (!named) continue;
    if (!listed.has(named)) {
      if (source === 'caller') return notOffered(named);
      continue; // a stored pick the job no longer lists reads as none
    }
    const why = speechBlock(jobId, job, named, ctx);
    if (why === 'plan_locked') return lockedRefusal(named);
    if (!why) return { ok: true, model: named, source, job: job.id, skipped: null };
    if (source === 'caller') return notOffered(named);
  }
  const why = speechBlock(jobId, job, job.default, ctx);
  if (!why) return { ok: true, model: job.default, source: 'default', job: job.id, skipped: null };
  if (job.fallback && !speechBlock(jobId, job, job.fallback, ctx)) {
    return { ok: true, model: job.fallback, source: 'fallback', job: job.id, skipped: { model: job.default, reason: why } };
  }
  return { ok: false, code: 'press_hidden', job: job.id, message: OPUS_JOBS.has(jobId) ? OPUS_REFUSAL : 'This press is not available on your plan yet.' };
}

/** Every speech job's step, for the tests and the coverage file. */
export const SPEECH_JOBS: readonly UseJob[] = Object.freeze(Object.values(SPEECH_JOB_STEPS).map((r) => jobStep(r.id, r.step)).filter((j): j is UseJob => !!j));

/** One caption: what was said, and when, in milliseconds from the start. */
export interface Caption { start_ms: number; end_ms: number; text: string }

/**
 * A transcript's captions, from its timed segments. A segment with no times,
 * or with an end before its start, is left out: a caption without a time is
 * not a caption. Empty when the transcript has none.
 */
export function captionsOf(t: SttTranscript | null | undefined): Caption[] {
  return (t?.segments ?? [])
    .filter((s) => s.start_ms != null && s.end_ms != null && s.end_ms >= s.start_ms && String(s.text ?? '').trim())
    .map((s) => ({ start_ms: s.start_ms as number, end_ms: s.end_ms as number, text: String(s.text).trim() }));
}
