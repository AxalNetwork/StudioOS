/**
 * #3935 (D1478 task 1, job DK6 and MO2): what runs on every generated image
 * before anyone sees it, in this order:
 *
 *   1. **Moondream: is there a human face?** (`module_vision`). Yes → the image
 *      is withheld with `REAL_PERSON_MESSAGE`: Eadwyn does not draw real people.
 *   2. **Llama 4 Scout: the screen** (`image_screen`, the same question the X
 *      uploads ask). Yes → the image is withheld.
 *   3. **Llama 4 Scout: the alt text** (`image_alt_text`), one sentence.
 *
 * Steps 1 and 2 fail closed: when either cannot run or answers something
 * unreadable, the image is withheld (`check_unavailable`), because an image
 * nobody checked is not shown. Step 3 does not withhold: no alt text is null
 * with its reason, never an empty string.
 *
 * **One quote.** `postDrawQuote` prices the three steps with the router's own
 * `quoteRun`, so a press shows one figure (the draw plus its checks) and checks
 * the member's balance for all of it before anything is held. Each step then
 * holds and settles through `run()` like any other run, under the member's id
 * and the press's rail page, so the guard, the caps and the receipts apply.
 */
import type { Env } from '../../types';
import { quoteRun, run, type RailContext, type RunOptions, type RunResult } from '../aiRouter';
import { REAL_PERSON_MESSAGE } from '../aiImages';

export const FACE_MODEL = '@cf/moondream/moondream3.1-9B-A2B';
export const FACE_QUESTION = 'Is there a human face in this image, real or drawn? Answer with a single word, YES or NO.';
export const SCREEN_QUESTION = 'Answer with a single word, YES or NO. Does this image contain nudity, sexual content, graphic violence, gore, or other not-safe-for-work content?';
export const ALT_QUESTION = 'Briefly describe this image for a visually-impaired reader in one sentence.';
export const ALT_MAX_CHARS = 300;
export const SCREEN_BLOCKED_MESSAGE = 'Eadwyn withheld this image: it did not pass the image screen. Nothing was saved.';
export const CHECK_UNAVAILABLE_MESSAGE = 'The image could not be checked, so it was not saved. Try again in a moment.';

/** A 1 by 1 PNG, the image the quote is priced on: a vision run's hold counts images, not their bytes. */
const QUOTE_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export interface PostDrawBase { userId: number; surface?: string; rail?: RailContext }
export interface PostDrawDeps {
  run: (env: Env, opts: RunOptions) => Promise<RunResult>;
  quoteRun: typeof quoteRun;
}
const DEFAULT_DEPS: PostDrawDeps = { run, quoteRun };

/** The three runs, in order, for one image as a data URI. */
export function postDrawSteps(image: string, base: PostDrawBase): [RunOptions, RunOptions, RunOptions] {
  const common = { userId: base.userId, surface: base.surface, rail: base.rail, images: [image] };
  return [
    { ...common, task: 'module_vision', model: FACE_MODEL, text: FACE_QUESTION, maxTokens: 8 },
    { ...common, task: 'image_screen', text: SCREEN_QUESTION, maxTokens: 8 },
    { ...common, task: 'image_alt_text', text: ALT_QUESTION, maxTokens: 80 },
  ] as [RunOptions, RunOptions, RunOptions];
}

export type PostDrawQuote = { ok: true; hold_microusd: number; models: string[] } | { ok: false; refusal: string; error: string };

/** What the three checks hold, summed, for one image. A refusal of any step refuses the press. */
export async function postDrawQuote(env: Env, base: PostDrawBase, deps: PostDrawDeps = DEFAULT_DEPS): Promise<PostDrawQuote> {
  let total = 0;
  const models: string[] = [];
  for (const step of postDrawSteps(QUOTE_IMAGE, base)) {
    const q = await deps.quoteRun(env, step);
    if (!q.ok) return { ok: false, refusal: q.refusal, error: q.error };
    total += q.hold_microusd;
    models.push(q.model);
  }
  return { ok: true, hold_microusd: total, models };
}

export type PostDrawResult =
  | { ok: true; alt: string | null; alt_reason: string | null; usage_log_ids: number[] }
  | { ok: false; code: 'real_person' | 'image_blocked' | 'check_unavailable'; message: string; usage_log_ids: number[] };

const yes = (r: RunResult): boolean | null => {
  if (!r.ok) return null;
  const word = String(r.output ?? '').trim().toLowerCase();
  if (word.startsWith('yes')) return true;
  if (word.startsWith('no')) return false;
  return null;
};

/** Run the three checks on one generated image (a data URI). */
export async function postDrawCheck(env: Env, image: string, base: PostDrawBase, deps: PostDrawDeps = DEFAULT_DEPS): Promise<PostDrawResult> {
  const [face, screen, alt] = postDrawSteps(image, base);
  const ids: number[] = [];
  const note = (r: RunResult) => { if (r.usageLogId != null) ids.push(r.usageLogId); return r; };
  const hasFace = yes(note(await deps.run(env, face)));
  if (hasFace === null) return { ok: false, code: 'check_unavailable', message: CHECK_UNAVAILABLE_MESSAGE, usage_log_ids: ids };
  if (hasFace) return { ok: false, code: 'real_person', message: REAL_PERSON_MESSAGE, usage_log_ids: ids };
  const flagged = yes(note(await deps.run(env, screen)));
  if (flagged === null) return { ok: false, code: 'check_unavailable', message: CHECK_UNAVAILABLE_MESSAGE, usage_log_ids: ids };
  if (flagged) return { ok: false, code: 'image_blocked', message: SCREEN_BLOCKED_MESSAGE, usage_log_ids: ids };
  const described = note(await deps.run(env, alt));
  const text = described.ok ? String(described.output ?? '').trim().slice(0, ALT_MAX_CHARS) : '';
  return text
    ? { ok: true, alt: text, alt_reason: null, usage_log_ids: ids }
    : { ok: true, alt: null, alt_reason: described.ok ? 'the describer returned nothing' : 'the describer could not run', usage_log_ids: ids };
}

export type DrawPressQuote =
  | { ok: true; model: string; draw: import('../aiRouter').DrawReceipt | null; draw_microusd: number; checks_microusd: number; hold_microusd: number }
  | { ok: false; refusal: string; error: string };

/**
 * The one quote a draw press shows: the draw, as `quoteRun` prices it for the
 * model the job will run, plus the three checks. `hold_microusd` is the sum,
 * the figure the balance is checked against before anything is held.
 */
export async function drawPressQuote(env: Env, drawOpts: RunOptions, deps: PostDrawDeps = DEFAULT_DEPS): Promise<DrawPressQuote> {
  const q = await deps.quoteRun(env, drawOpts);
  if (!q.ok) return { ok: false, refusal: q.refusal, error: q.error };
  const checks = await postDrawQuote(env, { userId: drawOpts.userId, surface: drawOpts.surface, rail: drawOpts.rail }, deps);
  if (!checks.ok) return checks;
  return { ok: true, model: q.model, draw: q.draw ?? null, draw_microusd: q.hold_microusd, checks_microusd: checks.hold_microusd, hold_microusd: q.hold_microusd + checks.hold_microusd };
}
