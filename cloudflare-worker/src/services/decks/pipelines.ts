/**
 * D1505 (#3756, deck v2 A12) — the image pipeline: expand, draw to size,
 * check, alt text, provenance, as named steps every image of a deck runs.
 *
 *   PIPELINES       the steps of each pipeline, in order
 *   seedOf          seed = hash(seed_base, card_uid, area, variant): the same
 *                   request draws the same picture
 *   sizeFor         the size an image is drawn at for its area, so the slide
 *                   never shows it enlarged more than UPSCALE_MAX (null for a
 *                   model that takes no size, FLUX.1 Schnell)
 *   pipelineQuote   one figure for every step of one image, step by step (pd14)
 *   runPipeline     the steps, one after another, with no press between them,
 *                   so the one-click run can call it under its parent hold
 *
 * THE STEPS.
 *   expand      the description rewritten as one visual prompt (rail_chat's
 *               model). A rewrite that names a number is not used (figures
 *               come from records, never from a picture); a rewrite that fails
 *               is skipped and the description is drawn as written.
 *   draw        the image, at sizeFor's size with seedOf's seed.
 *   check       moondream: a face, then text in the picture; then Llama 4
 *               Scout's screen. Each fails CLOSED: a check that cannot run or
 *               answers something unreadable refuses the image.
 *   style       Llama 4 Scout: does the picture match the deck's art direction?
 *               No refuses it, like a failed check (dk-auto gap d).
 *   alt         one sentence for a reader who cannot see it; none is null with
 *               its reason, never an empty string, and never a refusal.
 *   provenance  the record the route writes: models, seed, prompt hash, steps.
 *
 * A REFUSED IMAGE IS NEVER SHOWN AND NEVER CHARGED. `runPipeline` answers the
 * refusal with its step lines; the route keeps the row as discarded with its
 * `qa_json`, settles every run of that image at zero (`refundSettled`) and
 * offers one redraw.
 *
 * Pure: the runs come in through `deps`, so the tests drive every branch.
 */
import type { RunOptions, RunResult, RailContext } from '../aiRouter';
import { IMAGE_SPECS, MIN_SIDE_PX, aspectSize, type Aspect } from '../ai/shapes';
import { FACE_MODEL, FACE_QUESTION, SCREEN_QUESTION, ALT_QUESTION, ALT_MAX_CHARS, SCREEN_BLOCKED_MESSAGE, CHECK_UNAVAILABLE_MESSAGE } from '../ai/postDraw';
import { REAL_PERSON_MESSAGE } from '../aiImages';

export const PIPELINES = Object.freeze({
  deck_image: ['expand', 'draw', 'check', 'style', 'alt', 'provenance'] as const,
});
export type StepName = typeof PIPELINES.deck_image[number];
/** pd15's words for each step. */
export const STEP_WORDS: Readonly<Record<StepName, string>> = Object.freeze({
  expand: 'Expand', draw: 'Draw', check: 'Image check', style: 'Style check', alt: 'Alt text', provenance: 'Provenance',
});

export type StepStatus = 'done' | 'skipped' | 'refused' | 'failed';
/** One step's line: what it did and what it charged (null when not known). */
export type StepLine = { step: StepName; label: string; status: StepStatus; charged_microusd: number | null; note?: string };

/** The most a slide may enlarge a drawn image before it reads soft (the 1.25× test). */
export const UPSCALE_MAX = 1.25;

export const TEXT_QUESTION = 'Answer with a single word, YES or NO. Does this image contain any written text, letters, words or numbers?';
export const TEXT_IN_IMAGE_MESSAGE = 'Not used: the image check found text in the picture. You were not charged for it.';
export const OFF_STYLE_MESSAGE = 'Not used: the picture did not match the deck’s art direction. You were not charged for it.';
export const EXPAND_SYSTEM = 'You write one prompt for an image model. Keep the subject. Add composition, light and material in plain words. '
  + 'Never add people, faces, text, letters, numbers, logos or charts. Answer with the prompt only, in at most 60 words.';
/** What every prompt ends with, whatever the expansion said. */
export const SAFETY_SUFFIX = 'An illustration only: no identifiable people, no faces, no text, no letters, no numbers, no charts or graphs.';

/** The deck's one art direction (D903 §10's `artDirection`), which every image inherits. */
export type ArtDirection = { style: string; palette: 'brand' | 'neutral'; colours: string[]; reference?: string | null };

/** 32-bit FNV-1a over the parts: a seed FLUX accepts (a whole number, 0 to 2^32 − 1). */
export function seedOf(seedBase: string, cardUid: string | null, area: string | null, variant: number): number {
  const text = [seedBase, cardUid ?? '', area ?? '', String(variant)].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A new deck's seed base: 32 hex characters, stored once and never changed. */
export const newSeedBase = (): string => crypto.randomUUID().replace(/-/g, '');

const up16 = (n: number) => Math.ceil(n / 16) * 16;

/**
 * The size to draw for an area of `box` slide pixels (or, with no area, the
 * aspect's own size), on `model`. Each side is the area's side over
 * UPSCALE_MAX, rounded up to FLUX's 16-pixel grid, at least the model's
 * minimum, and no more than its maximum (scaled down together, so the aspect
 * holds). Null for a model that takes no size.
 */
export function sizeFor(model: string, aspect: Aspect, box: { w: number; h: number } | null = null): { width: number; height: number } | null {
  const spec = IMAGE_SPECS[model];
  if (!spec || spec.maxSide == null) return null;
  if (!box || !(box.w > 0) || !(box.h > 0)) return aspectSize(aspect);
  let w = up16(Math.max(MIN_SIDE_PX, box.w / UPSCALE_MAX));
  let h = up16(Math.max(MIN_SIDE_PX, box.h / UPSCALE_MAX));
  const over = Math.max(w, h) / spec.maxSide;
  if (over > 1) { w = Math.floor(w / over / 16) * 16; h = Math.floor(h / over / 16) * 16; }
  return { width: w, height: h };
}

/** The question the style check asks of the deck's art direction. */
export function styleQuestion(art: ArtDirection): string {
  const palette = art.palette === 'brand' && art.colours.length ? `in or near the colours ${art.colours.slice(0, 3).join(', ')}` : 'in neutral, muted tones';
  return `Answer with a single word, YES or NO. Is this image a ${art.style} illustration, ${palette}?`;
}

/** The prompt to draw: the expansion when it is usable, else the description; the safety words always last. */
export function promptFrom(base: string, expansion: string | null): { prompt: string; expanded: boolean; note: string | null } {
  const clean = (expansion ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return { prompt: base, expanded: false, note: expansion == null ? 'not run' : 'the rewrite was empty' };
  // Any digit, in any script: a picture asked to show a number draws a wrong one.
  if (/\p{Nd}/u.test(clean)) return { prompt: base, expanded: false, note: 'the rewrite named a number, so the description was drawn as written' };
  return { prompt: `${clean.slice(0, 1500)} ${SAFETY_SUFFIX}`, expanded: true, note: null };
}

export interface PipelineDeps {
  run: (opts: RunOptions) => Promise<RunResult>;
  quoteRun: (opts: RunOptions) => Promise<{ ok: true; hold_microusd: number; model: string } | { ok: false; refusal: string; error: string }>;
  /** A run's recorded charge, from its usage row; null when not known. */
  charged: (usageLogId: number | null | undefined) => Promise<number | null>;
}

export type PipelineInput = {
  userId: number;
  surface?: string;
  rail: RailContext;
  /** The description's prompt, as `promptOf` writes it. */
  base: string;
  /** The draw's options: task, job, model pick and rail. Its text and draw are set here. */
  draw: RunOptions;
  size: { width: number; height: number } | null;
  seed: number;
  art: ArtDirection;
  parentHold?: { uid: string; userId: number };
};

/** A 1 by 1 PNG: a vision run's quote counts images, not their bytes. */
const QUOTE_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** The runs of one image, as options: the same objects the quote prices and the pipeline runs. */
export function stepRuns(input: PipelineInput, image: string = QUOTE_IMAGE, prompt: string = input.base) {
  const common = { userId: input.userId, surface: input.surface, rail: input.rail, ...(input.parentHold ? { parentHold: input.parentHold } : {}) };
  const vision = { ...common, images: [image], maxTokens: 8 };
  return {
    expand: { ...common, task: 'rail_chat', systemPrompt: EXPAND_SYSTEM, text: input.base.slice(0, 2000), maxTokens: 160, temperature: 0.4 } as RunOptions,
    draw: { ...input.draw, ...common, text: prompt.slice(0, 2048), draw: { ...(input.size ?? {}), seed: input.seed } } as RunOptions,
    face: { ...vision, task: 'module_vision', model: FACE_MODEL, text: FACE_QUESTION } as RunOptions,
    text: { ...vision, task: 'module_vision', model: FACE_MODEL, text: TEXT_QUESTION } as RunOptions,
    screen: { ...vision, task: 'image_screen', text: SCREEN_QUESTION } as RunOptions,
    style: { ...vision, task: 'image_screen', text: styleQuestion(input.art) } as RunOptions,
    alt: { ...common, images: [image], task: 'image_alt_text', text: ALT_QUESTION, maxTokens: 80 } as RunOptions,
  };
}

export type PipelineQuote =
  | { ok: true; model: string; hold_microusd: number; steps: Array<{ step: StepName; label: string; hold_microusd: number }> }
  | { ok: false; refusal: string; error: string };

/** One image's every step, priced by the router's own quote, under one figure (pd14). */
export async function pipelineQuote(input: PipelineInput, deps: Pick<PipelineDeps, 'quoteRun'>): Promise<PipelineQuote> {
  const r = stepRuns(input);
  const parts: Array<[StepName, RunOptions[]]> = [['expand', [r.expand]], ['draw', [r.draw]], ['check', [r.face, r.text, r.screen]], ['style', [r.style]], ['alt', [r.alt]]];
  const steps: Array<{ step: StepName; label: string; hold_microusd: number }> = [];
  let model = '';
  for (const [step, opts] of parts) {
    let hold = 0;
    for (const o of opts) {
      const q = await deps.quoteRun(o);
      if (!q.ok) return { ok: false, refusal: q.refusal, error: q.error };
      hold += q.hold_microusd;
      if (step === 'draw') model = q.model;
    }
    steps.push({ step, label: STEP_WORDS[step], hold_microusd: hold });
  }
  steps.push({ step: 'provenance', label: STEP_WORDS.provenance, hold_microusd: 0 });
  return { ok: true, model, hold_microusd: steps.reduce((s, x) => s + x.hold_microusd, 0), steps };
}

export type QaRecord = { face: boolean | null; text: boolean | null; screen: boolean | null; on_style: boolean | null };
export type PipelineResult =
  | { ok: true; image: NonNullable<RunResult['image']>; model: string; prompt: string; expanded: boolean; alt: string | null; alt_reason: string | null;
      steps: StepLine[]; usage_log_ids: number[]; qa: QaRecord }
  | { ok: false; code: string; message: string; image: RunResult['image'] | null; model: string | null; prompt: string;
      steps: StepLine[]; usage_log_ids: number[]; qa: QaRecord };

const yes = (r: RunResult): boolean | null => {
  if (!r.ok) return null;
  const w = String(r.output ?? '').trim().toLowerCase();
  if (w.startsWith('yes')) return true;
  if (w.startsWith('no')) return false;
  return null;
};

const toDataUri = (img: NonNullable<RunResult['image']>): string => {
  let bin = '';
  for (let i = 0; i < img.bytes.length; i += 0x8000) bin += String.fromCharCode(...img.bytes.subarray(i, i + 0x8000));
  return `data:${img.mime};base64,${btoa(bin)}`;
};

/** Every step of one image, one after another, with no press between them. */
export async function runPipeline(input: PipelineInput, deps: PipelineDeps): Promise<PipelineResult> {
  const steps: StepLine[] = [];
  const ids: number[] = [];
  const qa: QaRecord = { face: null, text: null, screen: null, on_style: null };
  const line = async (step: StepName, status: StepStatus, runs: RunResult[], note?: string) => {
    let charged: number | null = 0;
    for (const r of runs) {
      if (r.usageLogId != null) ids.push(r.usageLogId);
      const c = await deps.charged(r.usageLogId);
      charged = c == null || charged == null ? null : charged + c;
    }
    steps.push({ step, label: STEP_WORDS[step], status, charged_microusd: charged, ...(note ? { note } : {}) });
  };
  const stop = (code: string, message: string, image: RunResult['image'] | null, model: string | null, prompt: string): PipelineResult =>
    ({ ok: false, code, message, image, model, prompt, steps, usage_log_ids: ids, qa });

  // 1. Expand.
  const first = stepRuns(input);
  const ex = await deps.run(first.expand);
  const p = promptFrom(input.base, ex.ok ? String(ex.output ?? '') : null);
  await line('expand', p.expanded ? 'done' : 'skipped', [ex], p.note ?? undefined);

  // 2. Draw, at the area's size with the request's seed.
  const drawn = await deps.run(stepRuns(input, QUOTE_IMAGE, p.prompt).draw);
  if (!drawn.ok || !drawn.image) {
    await line('draw', 'failed', [drawn], drawn.error ?? drawn.refusal ?? 'the model did not answer');
    return stop(drawn.refusal || 'model_unavailable', 'Eadwyn could not draw the image. Nothing was charged and nothing changed.', null, null, p.prompt);
  }
  await line('draw', 'done', [drawn]);
  const model = drawn.usage?.model ?? String(input.draw.model ?? '');
  const runs = stepRuns(input, toDataUri(drawn.image), p.prompt);

  // 3. The image check: a face, text, the screen. Each fails closed.
  const checks: RunResult[] = [];
  const ask = async (o: RunOptions) => { const r = await deps.run(o); checks.push(r); return yes(r); };
  qa.face = await ask(runs.face);
  if (qa.face !== false) {
    await line('check', 'refused', checks, qa.face ? 'a face' : 'the face check could not run');
    return qa.face ? stop('real_person', REAL_PERSON_MESSAGE, drawn.image, model, p.prompt) : stop('check_unavailable', CHECK_UNAVAILABLE_MESSAGE, drawn.image, model, p.prompt);
  }
  qa.text = await ask(runs.text);
  if (qa.text !== false) {
    await line('check', 'refused', checks, qa.text ? 'text in the picture' : 'the text check could not run');
    return qa.text ? stop('text_in_image', TEXT_IN_IMAGE_MESSAGE, drawn.image, model, p.prompt) : stop('check_unavailable', CHECK_UNAVAILABLE_MESSAGE, drawn.image, model, p.prompt);
  }
  qa.screen = await ask(runs.screen);
  if (qa.screen !== false) {
    await line('check', 'refused', checks, qa.screen ? 'the screen flagged it' : 'the screen could not run');
    return qa.screen ? stop('image_blocked', SCREEN_BLOCKED_MESSAGE, drawn.image, model, p.prompt) : stop('check_unavailable', CHECK_UNAVAILABLE_MESSAGE, drawn.image, model, p.prompt);
  }
  await line('check', 'done', checks);

  // 4. The deck's one style.
  const st = await deps.run(runs.style);
  qa.on_style = yes(st);
  if (qa.on_style !== true) {
    await line('style', 'refused', [st], qa.on_style === false ? 'off the art direction' : 'the style check could not run');
    return qa.on_style === false ? stop('off_style', OFF_STYLE_MESSAGE, drawn.image, model, p.prompt) : stop('check_unavailable', CHECK_UNAVAILABLE_MESSAGE, drawn.image, model, p.prompt);
  }
  await line('style', 'done', [st]);

  // 5. Alt text: never a refusal; none is null with its reason.
  const al = await deps.run(runs.alt);
  const alt = al.ok ? String(al.output ?? '').replace(/\s+/g, ' ').trim().slice(0, ALT_MAX_CHARS) : '';
  await line('alt', alt ? 'done' : 'skipped', [al], alt ? undefined : (al.ok ? 'the describer returned nothing' : 'the describer could not run'));

  // 6. Provenance is the route's record; its line closes the run.
  steps.push({ step: 'provenance', label: STEP_WORDS.provenance, status: 'done', charged_microusd: 0 });
  return {
    ok: true, image: drawn.image, model, prompt: p.prompt, expanded: p.expanded,
    alt: alt || null, alt_reason: alt ? null : (al.ok ? 'the describer returned nothing' : 'the describer could not run'),
    steps, usage_log_ids: ids, qa,
  };
}
