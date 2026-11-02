/**
 * #3935 (D1478 task 1, part 2): the drawn cover, for an event (EV2) and a
 * course (LE8).
 *
 * One press, in this order, each step refusing before the next costs anything:
 *   1. **The prompt.** A face word in the description is refused before any
 *      quote (`personIn`, the deck's rule): 422 `real_person`.
 *   2. **One quote.** The draw plus its three checks (`drawPressQuote`), for the
 *      model the job will run (`drawChoice`: the legal hold, the partner switch,
 *      the member's plan). The member's balance covers the whole figure, or
 *      nothing runs.
 *   3. **The draw**, through `run()` under the member, with the job's aspect
 *      (16:9 for both covers).
 *   4. **The checks** (`postDrawCheck`): a face → 422 with
 *      `REAL_PERSON_MESSAGE`; a flagged screen or a check that cannot run → 422.
 *      Nothing is stored. The runs that happened are charged, as any run is.
 *   5. **Stored** in R2 under the record's own prefix, and answered with an
 *      app URL, the alt text and the model that drew it.
 *
 * The cover is a proposal: the press fills the form's cover field, and the
 * member's own Save writes it (`PATCH /api/events/:id`, `PATCH
 * /api/admin/learning/courses/:uid`). Nothing here writes the record.
 */
import type { Env } from '../types';
import { run, type RailContext, type RunOptions, type TaskClass } from './aiRouter';
import { EXTENSION, MIMES, REAL_PERSON_MESSAGE, balanceRefusal, imageModelLabel, personIn, sniffMime } from './aiImages';
import { drawPressQuote, postDrawCheck, type PostDrawDeps } from './ai/postDraw';
import { MAX_DRAW_PROMPT_CHARS } from './ai/shapes';
import { AI_SURFACE } from './aiSurfaces';

export const COVER_PROMPT_MAX = 600;
/** A course's covers in R2. The uid is the course's own, checked to be one before any read or write. */
export const courseCoverPrefix = (uid: string) => `learning/courses/${uid}/covers/`;
export const COURSE_UID = /^[A-Za-z0-9_-]{1,64}$/;

export const COVER_FILENAME = /^cover-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;

export interface CoverKind { task: TaskClass; job: 'EV2' | 'LE8'; surface: string; style: string }
export const EVENT_COVER: CoverKind = { task: 'event_cover', job: 'EV2', surface: AI_SURFACE.eventCover, style: 'An illustrative event cover, wide format, no text, no logos, no identifiable people.' };
export const COURSE_COVER: CoverKind = { task: 'course_cover', job: 'LE8', surface: AI_SURFACE.courseCover, style: 'A course cover illustration, wide format, no text, no logos, no identifiable people.' };

export type CoverRefusal = { ok: false; status: 400 | 402 | 403 | 422 | 503; code: string; message: string };

/** The member's description, checked: present, bounded, and asking for no real person. */
export function coverAsk(body: unknown): { ok: true; prompt: string } | CoverRefusal {
  const prompt = typeof (body as { prompt?: unknown })?.prompt === 'string' ? (body as { prompt: string }).prompt.trim() : '';
  if (!prompt) return { ok: false, status: 400, code: 'invalid_input', message: 'Describe the cover you want.' };
  if (prompt.length > COVER_PROMPT_MAX) return { ok: false, status: 400, code: 'invalid_input', message: `At most ${COVER_PROMPT_MAX} characters.` };
  if (personIn(prompt, [])) return { ok: false, status: 422, code: 'real_person', message: REAL_PERSON_MESSAGE };
  return { ok: true, prompt };
}

export function coverRunOptions(kind: CoverKind, userId: number, prompt: string, rail?: RailContext): RunOptions {
  return {
    task: kind.task, drawJob: kind.job, userId, surface: kind.surface, rail,
    text: `${prompt}. ${kind.style}`.slice(0, MAX_DRAW_PROMPT_CHARS),
    draw: { aspect: '16:9' },
  };
}

const runRefusal = (refusal: string | undefined, error: string | undefined): CoverRefusal => {
  if (refusal === 'plan_locked') return { ok: false, status: 403, code: refusal, message: error || 'This model is not on your plan.' };
  if (refusal && /^budget_|^spend_limit$|^ai_paused$/.test(refusal)) return { ok: false, status: 402, code: refusal, message: error || 'Not enough AI tokens for this cover.' };
  if (refusal === 'assist_off') return { ok: false, status: 403, code: refusal, message: error || 'AI assistance is off on this page.' };
  if (refusal === 'guard_blocked') return { ok: false, status: 422, code: refusal, message: error || 'Eadwyn cannot help with that.' };
  return { ok: false, status: 503, code: refusal || 'model_unavailable', message: error || 'The cover could not be drawn. Nothing was saved.' };
};

export type CoverQuote = { ok: true; model: string; model_label: string | null; hold_microusd: number; draw_microusd: number; checks_microusd: number; draw: unknown; balance: { ok: true } | { ok: false; code: string; message: string } };

/** What a cover costs, in one figure, and whether the member's tokens cover it. */
export async function quoteCover(env: Env, opts: RunOptions, deps?: PostDrawDeps): Promise<CoverQuote | CoverRefusal> {
  const q = await drawPressQuote(env, opts, deps);
  if (!q.ok) return runRefusal(q.refusal, q.error);
  const short = await balanceRefusal(env, opts.userId, q.hold_microusd);
  return {
    ok: true, model: q.model, model_label: imageModelLabel(q.model), hold_microusd: q.hold_microusd,
    draw_microusd: q.draw_microusd, checks_microusd: q.checks_microusd, draw: q.draw,
    balance: short ? { ok: false, code: short.code, message: short.message } : { ok: true },
  };
}

export type CoverDrawn = { ok: true; filename: string; key: string; model: string; model_label: string | null; alt: string | null; alt_reason: string | null; draw: unknown; usage_log_id: number | null };

const dataUri = (mime: string, bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
};

/**
 * Quote, draw, check and store one cover under `prefix` (an R2 path ending in
 * `/`). `deps` lets a test stub the router.
 */
export async function drawCover(env: Env, opts: RunOptions, prefix: string, deps?: PostDrawDeps & { run?: typeof run }): Promise<CoverDrawn | CoverRefusal> {
  if (!env.FILES) return { ok: false, status: 503, code: 'storage_unavailable', message: 'Image storage is not available. Nothing was run.' };
  const q = await quoteCover(env, opts, deps);
  if (!q.ok) return q;
  if (!q.balance.ok) return { ok: false, status: 402, code: q.balance.code, message: q.balance.message };
  const runner = deps?.run ?? run;
  const r = await runner(env, opts);
  if (!r.ok || !r.image) return runRefusal(r.refusal, r.error);
  const mime = (MIMES as readonly string[]).includes(r.image.mime) ? r.image.mime as typeof MIMES[number] : sniffMime(r.image.bytes);
  if (!mime) return { ok: false, status: 503, code: 'image_unreadable', message: 'The cover came back in a format the page cannot show. Nothing was saved.' };
  const checked = await postDrawCheck(env, dataUri(mime, r.image.bytes), { userId: opts.userId, surface: opts.surface, rail: opts.rail }, deps);
  if (!checked.ok) return { ok: false, status: 422, code: checked.code, message: checked.message };
  const filename = `cover-${crypto.randomUUID()}.${EXTENSION[mime]}`;
  const key = `${prefix}${filename}`;
  try {
    await env.FILES.put(key, r.image.bytes, { httpMetadata: { contentType: mime }, customMetadata: { userId: String(opts.userId), job: String(opts.drawJob ?? '') } });
  } catch {
    return { ok: false, status: 503, code: 'image_unsaved', message: 'The cover was drawn but could not be stored. Try again in a moment.' };
  }
  const model = r.usage?.model ?? q.model;
  return { ok: true, filename, key, model, model_label: imageModelLabel(model), alt: checked.alt, alt_reason: checked.alt_reason, draw: q.draw, usage_log_id: r.usageLogId ?? null };
}

/** A stored cover's bytes, by its exact key, with its type from the extension. Null when absent or the name is not a cover's. */
export async function readCover(env: Env, prefix: string, filename: string): Promise<{ body: ReadableStream; mime: string } | null> {
  if (!COVER_FILENAME.test(filename) || !env.FILES) return null;
  const obj = await env.FILES.get(`${prefix}${filename}`);
  if (!obj) return null;
  const ext = filename.split('.').pop();
  const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
  return { body: obj.body, mime };
}
