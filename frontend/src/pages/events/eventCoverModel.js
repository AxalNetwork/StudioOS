/**
 * D3724 (#3724 Part E, board NE2): the New event cover step's rules and words.
 * `EventCoverStep.jsx` draws them. #5309 (D5309) switched uploading and four
 * variants on; one drawn cover per press is #3935's and still works.
 */

export const COVER_MIN = Object.freeze({ width: 1200, height: 675 });
export const COVER_TYPES = Object.freeze(['image/jpeg', 'image/png']);
export const COVER_RULE = 'Eadwyn does not draw real people. Logos and speaker photos are uploads only.';
export const TOO_SMALL = `The image is too small. Use one at least ${COVER_MIN.width} × ${COVER_MIN.height} pixels.`;
export const WRONG_TYPE = 'Use a JPG or PNG image.';
export const SAVE_FIRST = 'Save the event first, then draw its cover.';

/** NE2's crops, in the board's order. */
export const COVER_RATIOS = Object.freeze([
  { key: 'card', label: 'Card 16:9', ratio: 16 / 9 },
  { key: 'social', label: 'Social 1.91:1', ratio: 1.91 },
  { key: 'square', label: 'Square', ratio: 1 },
]);

/** NE2's style chips and text overlays. */
export const COVER_STYLES = Object.freeze([
  { key: 'photo', label: 'Photo', words: 'a photograph' },
  { key: 'illustration', label: 'Illustration', words: 'a flat illustration' },
  { key: 'abstract', label: 'Abstract', words: 'an abstract composition' },
  { key: 'typographic', label: 'Typographic', words: 'a typographic poster with no lettering of its own' },
]);
export const COVER_OVERLAYS = Object.freeze([
  { key: 'none', label: 'No text' },
  { key: 'title_date', label: 'Title and date' },
]);

/** A chosen file, checked before anything is sent. `{ ok, error? }`. */
export function checkCoverFile({ type, width, height } = {}) {
  if (!COVER_TYPES.includes(type)) return { ok: false, error: WRONG_TYPE };
  if (!(Number(width) >= COVER_MIN.width && Number(height) >= COVER_MIN.height)) return { ok: false, error: TOO_SMALL };
  return { ok: true };
}

/**
 * The prompt Eadwyn starts from, written from the event's own fields (title,
 * summary, type, city). The member edits it before pricing. No person's name
 * goes in: the press refuses real people anyway.
 */
export function coverPrompt(form = {}, { style = 'photo', overlay = 'none' } = {}) {
  const s = COVER_STYLES.find((x) => x.key === style) || COVER_STYLES[0];
  const type = String(form.type || 'event').replace(/_/g, ' ');
  const bits = [`${s.words} for a ${type}`];
  const title = String(form.title || '').trim();
  if (title) bits.push(`about “${title.slice(0, 120)}”`);
  const summary = String(form.summary || '').trim();
  if (summary) bits.push(summary.slice(0, 200));
  const city = String(form.location_kind === 'virtual' ? '' : form.location_text || '').trim();
  if (city) bits.push(`set in ${city.slice(0, 80)}`);
  bits.push('no people, no faces, no logos');
  if (overlay === 'title_date') bits.push('leave calm space at the top left for a title and date');
  return bits.join(', ').slice(0, 600);
}

// ── #5309 (D5309, D3724 §gap 8): one focal point, three recorded crops ──────
// The upload stores ONE image. NE2's three crops are recorded as rectangles in
// fractions of that image, each the largest rectangle of its own shape that
// fits and keeps the focal point in frame. So a re-crop costs no upload, and no
// Worker ever crops pixels.
export const CENTRE = Object.freeze({ x: 0.5, y: 0.5 });

/**
 * A fraction, or the centre. `null`, `''` and `undefined` all coerce to 0
 * through `Number`, and a focal point pinned to the top-left edge is not what
 * "not recorded" means, so they are read as the centre before any coercion.
 */
const clamp01 = (raw) => {
  if (raw == null || raw === '') return 0.5;
  const v = Number(raw);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
};

/** The focal point as a pair of fractions. Anything unreadable is the centre, not a guess at one. */
export function readFocal(focal) {
  return { x: clamp01(focal?.x), y: clamp01(focal?.y) };
}

/**
 * One crop rectangle, in fractions of an image whose pixel aspect is
 * `imageRatio` (width ÷ height): the largest rectangle of aspect `want` that
 * fits inside the image, slid so the focal point sits at its centre wherever
 * the edges allow. Returns null when the image's aspect is not a number.
 */
export function cropRect(imageRatio, want, focal = CENTRE) {
  const r = Number(imageRatio);
  const a = Number(want);
  if (!(r > 0) || !(a > 0)) return null;
  const w = a <= r ? a / r : 1;
  const h = a <= r ? 1 : r / a;
  const f = readFocal(focal);
  const round = (v) => Math.round(v * 1e6) / 1e6;
  return {
    x: round(Math.min(1 - w, Math.max(0, f.x - w / 2))),
    y: round(Math.min(1 - h, Math.max(0, f.y - h / 2))),
    w: round(w),
    h: round(h),
  };
}

/** NE2's three crops, by key, from the image's aspect and the focal point. Null when the aspect is unknown. */
export function cropsFromFocal(imageRatio, focal = CENTRE) {
  if (!(Number(imageRatio) > 0)) return null;
  const crops = {};
  for (const ratio of COVER_RATIOS) {
    const rect = cropRect(imageRatio, ratio.ratio, focal);
    if (!rect) return null;
    crops[ratio.key] = rect;
  }
  return crops;
}

export const ALT_REQUIRED = 'Say what the image shows, so it can be read aloud.';
export const ALT_MAX = 200;

/** Whether this upload may be sent: a checked file and alt text. `{ ok, error? }`. */
export function canSendUpload({ file, alt } = {}) {
  if (!file) return { ok: false, error: 'Choose a JPG or PNG image first.' };
  if (!String(alt || '').trim()) return { ok: false, error: ALT_REQUIRED };
  return { ok: true };
}

// ── #5309 (D3724 §gap 9): four variants per press ──────────────────────────
export const VARIANTS_PER_DRAW = 4;
export const VARIANTS_PRICE_FIRST = 'Four variants are priced before anything is drawn.';
export const VARIANTS_NONE = 'No variant could be drawn. Nothing was saved.';

/** `n of 4 drawn` — and what the rest refused, when some did. Never "0 variants". */
export function variantsLine(answer) {
  const drawn = Array.isArray(answer?.variants) ? answer.variants.length : 0;
  const asked = Number(answer?.asked) || VARIANTS_PER_DRAW;
  if (!drawn) return VARIANTS_NONE;
  if (drawn >= asked) return `${drawn} variants drawn. Nothing is placed until you choose one.`;
  return `${drawn} of ${asked} drawn. The rest were refused: ${(answer.refused || []).map((r) => r.message).join(' ')}`.trim();
}

/** The colours line for the generate tab: the kit's own values, or that none is recorded. */
export function brandColoursLine(answer) {
  const colours = Array.isArray(answer?.brand_colours) ? answer.brand_colours : [];
  if (!answer?.brand_colours_recorded || !colours.length) return 'No brand colours are recorded for this venture.';
  return `Drawn in the venture's brand colours: ${colours.join(', ')}.`;
}
