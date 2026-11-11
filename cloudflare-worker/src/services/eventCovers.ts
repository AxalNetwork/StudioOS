/**
 * #5309 (D5309, D3724 §gaps 8 to 11) — an event cover a member UPLOADS, and
 * four drawn variants per press.
 *
 * Two things the single drawn cover (#3935, `coverDraws.ts`) does not do:
 *
 *  1. **Upload.** A JPG or PNG the member already has, at least 1200 × 675,
 *     with alt text, a focal point and the three crops NE2 draws (card 16:9,
 *     social 1.91:1, square). ONE image is stored in R2; the three crops are
 *     recorded as rectangles in fractions of that image, and the focal point
 *     as a fraction too, so no Worker ever has to crop pixels and a re-crop
 *     costs no upload. The event records them with `cover_source = 'uploaded'`
 *     (migration `202611110745_5309`).
 *  2. **Four variants per press.** One quote covers all four draws and their
 *     checks; the member's balance covers the whole figure or nothing runs.
 *     Each variant carries its own idempotency key off the quote's uid, so a
 *     retry of the same quote replays and charges nothing again (#3846).
 *     "More like this one" is the same press with the chosen variant's own
 *     prompt, which is why `drawVariantsOptions` takes the prompt it is given.
 *
 * Nothing here writes the event. The upload answers a URL, the alt text, the
 * focal point and the crops; the member's own Save (`PATCH /api/events/:id`)
 * writes them, exactly as the drawn cover works today.
 */
import type { Env } from '../types';
import { run, type RunOptions } from './aiRouter';
import { EVENT_COVER, coverRunOptions, drawCover, quoteCover, type CoverDrawn, type CoverQuote, type CoverRefusal } from './coverDraws';
import { deckBrandKitFor } from './decks/brandKit';
import type { PostDrawDeps } from './ai/postDraw';
import { MAX_DRAW_PROMPT_CHARS } from './ai/shapes';

export const COVER_MIN = Object.freeze({ width: 1200, height: 675 });
export const COVER_UPLOAD_MIMES = Object.freeze(['image/jpeg', 'image/png'] as const);
export const MAX_COVER_BYTES = 8 * 1024 * 1024;
export const COVER_ALT_MAX = 200;
export const VARIANTS_PER_DRAW = 4;

/** NE2's three crops and the aspect each one must be, within `CROP_TOLERANCE`. */
export const CROP_RATIOS = Object.freeze({ card: 16 / 9, social: 1.91, square: 1 });
export const CROP_KEYS = Object.freeze(['card', 'social', 'square'] as const);
export const CROP_TOLERANCE = 0.06;

export type CropKey = typeof CROP_KEYS[number];
export type Rect = { x: number; y: number; w: number; h: number };
export type Focal = { x: number; y: number };
export type Crops = Record<CropKey, Rect>;

export const UPLOAD_MESSAGES = Object.freeze({
  multipart_required: 'Send the image and its fields as multipart form data.',
  file_required: 'Choose a JPG or PNG image to upload.',
  file_too_large: `The image is larger than ${MAX_COVER_BYTES / (1024 * 1024)} MB. Use a smaller file.`,
  wrong_type: 'Use a JPG or PNG image.',
  unreadable_image: 'That file could not be read as a JPG or PNG. Nothing was stored.',
  too_small: `The image is too small. Use one at least ${COVER_MIN.width} × ${COVER_MIN.height} pixels.`,
  alt_required: 'Say what the image shows, so it can be read aloud.',
  alt_too_long: `Alt text can be at most ${COVER_ALT_MAX} characters.`,
  bad_focal: 'The focal point must be a point inside the image.',
  bad_crops: 'Each of the three crops must be a rectangle inside the image, at its own shape.',
  storage_unavailable: 'Image storage is not available. Nothing was stored.',
  storage_failed: 'The image could not be stored. Try again.',
});

const be32 = (b: Uint8Array, at: number) => (b[at] << 24 | b[at + 1] << 16 | b[at + 2] << 8 | b[at + 3]) >>> 0;
const be16 = (b: Uint8Array, at: number) => (b[at] << 8 | b[at + 1]) >>> 0;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * An image's pixel size, read from its own header: PNG's IHDR, or JPEG's first
 * start-of-frame. Null when the bytes are neither, which is the only size claim
 * we trust — the browser's numbers decide nothing a route depends on.
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length >= 24 && PNG_MAGIC.every((v, i) => bytes[i] === v)) {
    // IHDR is always the first chunk: length, type, then width and height.
    if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') return null;
    const width = be32(bytes, 16);
    const height = be32(bytes, 20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) { at += 1; continue; }
      const marker = bytes[at + 1];
      // Padding and the standalone markers carry no length.
      if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { at += 2; continue; }
      const length = be16(bytes, at + 2);
      if (length < 2) return null;
      // SOF0–3, 5–7, 9–11, 13–15: every start of frame but the arithmetic DNL markers.
      const sof = (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (sof) {
        const height = be16(bytes, at + 5);
        const width = be16(bytes, at + 7);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      at += 2 + length;
    }
  }
  return null;
}

const refusal = (status: 400 | 413 | 503, code: keyof typeof UPLOAD_MESSAGES): CoverRefusal =>
  ({ ok: false, status: status as 400 | 503, code, message: UPLOAD_MESSAGES[code] });

const fraction = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
};

/** `{"x":…,"y":…}`, both fractions of the stored image. Missing reads as the centre. */
export function focalAsk(raw: unknown): { ok: true; focal: Focal } | CoverRefusal {
  if (raw == null || raw === '') return { ok: true, focal: { x: 0.5, y: 0.5 } };
  let value: unknown = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch { return refusal(400, 'bad_focal'); } }
  const x = fraction((value as Focal)?.x);
  const y = fraction((value as Focal)?.y);
  if (x === null || y === null) return refusal(400, 'bad_focal');
  return { ok: true, focal: { x, y } };
}

const rect = (raw: unknown): Rect | null => {
  const x = fraction((raw as Rect)?.x);
  const y = fraction((raw as Rect)?.y);
  const w = fraction((raw as Rect)?.w);
  const h = fraction((raw as Rect)?.h);
  if (x === null || y === null || w === null || h === null) return null;
  if (!(w > 0 && h > 0) || x + w > 1.0001 || y + h > 1.0001) return null;
  return { x, y, w, h };
};

/**
 * The three crops, as rectangles in fractions of the stored image: all three
 * keys, each a rectangle that lies inside the image.
 *
 * The SHAPE of each crop is checked only where the image's own aspect is known,
 * which is at the upload, against the bytes (`cropsAsk`). A later Save carries
 * the crops the upload already answered and no image, so it checks the
 * rectangles and not their aspects — re-checking them against a guessed aspect
 * would refuse every crop of an image that is not 16:9.
 */
export function rectsAsk(raw: unknown): { ok: true; crops: Crops } | CoverRefusal {
  let value: unknown = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch { return refusal(400, 'bad_crops'); } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return refusal(400, 'bad_crops');
  const crops = {} as Crops;
  for (const key of CROP_KEYS) {
    const r = rect((value as Record<string, unknown>)[key]);
    if (!r) return refusal(400, 'bad_crops');
    crops[key] = r;
  }
  return { ok: true, crops };
}

/**
 * The three crops with each one's shape checked too: a "square" crop that is
 * not square would frame something the card never shows. `imageRatio` is the
 * stored image's own aspect, because a rectangle's shape is only an aspect once
 * the image it cuts is known.
 */
export function cropsAsk(raw: unknown, imageRatio: number): { ok: true; crops: Crops } | CoverRefusal {
  const read = rectsAsk(raw);
  if (!read.ok) return read;
  if (!(imageRatio > 0)) return refusal(400, 'bad_crops');
  for (const key of CROP_KEYS) {
    const r = read.crops[key];
    const want = CROP_RATIOS[key];
    const got = (r.w * imageRatio) / r.h;
    if (Math.abs(got - want) / want > CROP_TOLERANCE) return refusal(400, 'bad_crops');
  }
  return read;
}

/** The member's own words for what the cover shows. Required: §gap 11 exists because nothing read it. */
export function altAsk(raw: unknown): { ok: true; alt: string } | CoverRefusal {
  const alt = typeof raw === 'string' ? raw.trim() : '';
  if (!alt) return refusal(400, 'alt_required');
  if (alt.length > COVER_ALT_MAX) return refusal(400, 'alt_too_long');
  return { ok: true, alt };
}

export type CoverUploadAsk = { ok: true; bytes: Uint8Array; mime: 'image/jpeg' | 'image/png'; alt: string; focal: Focal; crops: Crops; width: number; height: number };

/**
 * One uploaded cover, checked whole before a byte is stored: the type and size
 * from the bytes themselves, then the alt text, the focal point and the crops.
 * The first thing wrong is the answer; nothing is stored on any refusal.
 */
export function coverUploadAsk(fields: { file?: { type?: string; size?: number } | null; bytes?: Uint8Array | null; alt?: unknown; focal?: unknown; crops?: unknown }): CoverUploadAsk | CoverRefusal {
  const bytes = fields.bytes;
  if (!bytes || !bytes.length) return refusal(400, 'file_required');
  if (bytes.length > MAX_COVER_BYTES) return refusal(413, 'file_too_large');
  const size = imageSize(bytes);
  if (!size) return refusal(400, 'unreadable_image');
  // The declared type decides nothing: the bytes do.
  const mime = bytes[0] === 0x89 ? 'image/png' : 'image/jpeg';
  if (!(COVER_UPLOAD_MIMES as readonly string[]).includes(mime)) return refusal(400, 'wrong_type');
  if (size.width < COVER_MIN.width || size.height < COVER_MIN.height) return refusal(400, 'too_small');
  const alt = altAsk(fields.alt);
  if (!alt.ok) return alt;
  const focal = focalAsk(fields.focal);
  if (!focal.ok) return focal;
  const crops = cropsAsk(fields.crops, size.width / size.height);
  if (!crops.ok) return crops;
  return { ok: true, bytes, mime, alt: alt.alt, focal: focal.focal, crops: crops.crops, width: size.width, height: size.height };
}

export const UPLOAD_FILENAME = /^upload-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$/;

/** Store one uploaded cover under `prefix`. Answers its filename, or why nothing was stored. */
export async function storeCoverUpload(env: Env, prefix: string, ask: CoverUploadAsk, userId: number): Promise<{ ok: true; filename: string } | CoverRefusal> {
  if (!env.FILES) return refusal(503, 'storage_unavailable');
  const filename = `upload-${crypto.randomUUID()}.${ask.mime === 'image/png' ? 'png' : 'jpg'}`;
  try {
    await env.FILES.put(`${prefix}${filename}`, ask.bytes, {
      httpMetadata: { contentType: ask.mime },
      customMetadata: { userId: String(userId), source: 'uploaded' },
    });
  } catch {
    return refusal(503, 'storage_failed');
  }
  return { ok: true, filename };
}

/** A stored upload's bytes, by its exact name. Null when absent or the name is not an upload's. */
export async function readCoverUpload(env: Env, prefix: string, filename: string): Promise<{ body: ReadableStream; mime: string } | null> {
  if (!UPLOAD_FILENAME.test(filename) || !env.FILES) return null;
  const obj = await env.FILES.get(`${prefix}${filename}`);
  if (!obj) return null;
  return { body: obj.body, mime: filename.endsWith('.png') ? 'image/png' : 'image/jpeg' };
}

// ── §gap 10: the brand kit's colours in the generate prompt ────────────────
// A venture's deck brand kit (D1562) already holds the palette the member
// chose. An event that names a venture draws its cover in those colours; one
// that names none says so, and the prompt is unchanged. Only `#rrggbb` values
// reach the prompt, in the kit's own key order, so nothing a kit holds can
// become an instruction.
export const PALETTE_ORDER = Object.freeze(['ground', 'ink', 'accent', 'secondary', 'highlight'] as const);

export async function brandColours(env: Env, projectId: number | null | undefined): Promise<{ colours: string[]; recorded: boolean }> {
  const id = Number(projectId);
  if (!Number.isSafeInteger(id) || id < 1) return { colours: [], recorded: false };
  let kit: Awaited<ReturnType<typeof deckBrandKitFor>> = null;
  try { kit = await deckBrandKitFor(env, id); } catch { return { colours: [], recorded: false }; }
  if (!kit) return { colours: [], recorded: false };
  // `deckBrandKitFor` answers a SANITIZED kit: a role it holds is a lowercase
  // `#rrggbb` and nothing else (`sanitizeBrandKit`), and a role it does not
  // hold is absent. So nothing a kit's row carries can reach the prompt as
  // words; this only projects the roles it does hold, in the kit's key order.
  const palette = (kit.palette || {}) as Record<string, unknown>;
  const colours = PALETTE_ORDER
    .map((key) => palette[key])
    .filter((v): v is string => typeof v === 'string' && v !== '');
  return { colours, recorded: colours.length > 0 };
}

/** The prompt with the kit's colours named, or the prompt as it came when none is recorded. */
export function promptWithColours(prompt: string, colours: string[]): string {
  if (!colours.length) return prompt;
  return `${prompt}. Use this brand palette: ${colours.join(', ')}`.slice(0, MAX_DRAW_PROMPT_CHARS);
}

// ── §gap 9: four variants per press ───────────────────────────────────────

export type VariantsQuote = { ok: true; variants: number; per_draw_microusd: number; hold_microusd: number; model: string; model_label: string | null; brand_colours: string[]; brand_colours_recorded: boolean };

/** What four variants cost, in one figure, and whether the member's tokens cover it. */
export async function quoteVariants(env: Env, opts: RunOptions, deps?: PostDrawDeps): Promise<VariantsQuote | CoverRefusal> {
  const one = await quoteCover(env, opts, deps);
  if (!one.ok) return one;
  const hold = one.hold_microusd * VARIANTS_PER_DRAW;
  if (!one.balance.ok) return { ok: false, status: 402, code: one.balance.code, message: one.balance.message };
  return {
    ok: true, variants: VARIANTS_PER_DRAW, per_draw_microusd: one.hold_microusd, hold_microusd: hold,
    model: one.model, model_label: one.model_label, brand_colours: [], brand_colours_recorded: false,
  };
}

export type Variant = { index: number; filename: string; alt: string | null; alt_reason: string | null; model: string; model_label: string | null; usage_log_id: number | null };
export type VariantsDrawn = { ok: true; variants: Variant[]; refused: Array<{ index: number; code: string; message: string }>; model: string };

/**
 * Four draws on one quote. Each carries its own idempotency key off `quoteUid`,
 * so the same press retried replays and charges nothing again. A variant that
 * refuses is named and the rest still stand: four presses are four images, and
 * three of four is three, never nothing. All four refusing is the refusal of
 * the first, so the member reads a reason rather than an empty grid.
 */
export async function drawVariants(
  env: Env,
  opts: RunOptions,
  prefix: string,
  quoteUid: string,
  deps?: PostDrawDeps & { run?: typeof run },
): Promise<VariantsDrawn | CoverRefusal> {
  const variants: Variant[] = [];
  const refused: Array<{ index: number; code: string; message: string }> = [];
  let first: CoverRefusal | null = null;
  let model = '';
  for (let index = 0; index < VARIANTS_PER_DRAW; index += 1) {
    const r: CoverDrawn | CoverRefusal = await drawCover(
      env,
      { ...opts, idempotencyKey: `event-cover-variant:${opts.userId}:${quoteUid}:${index}` },
      prefix,
      deps,
    );
    if (!r.ok) {
      // A balance that ran out part-way, a paused rail or a locked plan stops the press: the rest would refuse the same way.
      if (r.status === 402 || r.status === 403) { first = first || r; break; }
      refused.push({ index, code: r.code, message: r.message });
      first = first || r;
      continue;
    }
    model = model || r.model;
    variants.push({ index, filename: r.filename, alt: r.alt, alt_reason: r.alt_reason, model: r.model, model_label: r.model_label, usage_log_id: r.usage_log_id });
  }
  if (!variants.length) return first || { ok: false, status: 503, code: 'model_unavailable', message: 'No variant could be drawn. Nothing was saved.' };
  return { ok: true, variants, refused, model };
}

/** The run options for a variants press: #3935's own options, with the brand palette in the prompt. */
export function variantsRunOptions(userId: number, prompt: string, colours: string[]): RunOptions {
  return coverRunOptions(EVENT_COVER, userId, promptWithColours(prompt, colours));
}

export type { CoverQuote };
