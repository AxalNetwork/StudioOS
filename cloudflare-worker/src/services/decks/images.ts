/**
 * D903 (#2682, part 9 of #2434) — images for the pitch deck's cards and
 * backgrounds: what a request may ask for, what is refused before anything
 * runs, the prompt FLUX.1 Schnell is given, the overlay's contrast rule and
 * the balance check before the hold.
 *
 * REFUSED BEFORE THE QUOTE OR THE HOLD, so they cost nothing:
 *   · a real person (#2434 owner question 7, A): a description asking for a
 *     face (a portrait, a headshot, a selfie, "our team", "the founder"), or
 *     naming one of the venture's own people. 422 `real_person`, in the
 *     canvas's words: "Eadwyn does not draw real people. Upload a photo the
 *     person agreed to share." A name check reads the venture's people only;
 *     a public figure's name with no face word is not caught here
 *     (UNVERIFIED: the prompt's own "no identifiable people" is the backstop);
 *   · a figure (`figureRefusal`, D897's one rule): figures come from records;
 *   · a chart or a graph: an image is illustrative only, never a figure.
 *
 * THE OVERLAY. A background's text is light on an overlay in the brand ink.
 * The image under it could be anything, so the check is the worst case: the
 * overlay over a white pixel. "Keep as background" is refused until that
 * reaches 4.5:1 (WCAG AA), so with no overlay it is always refused (PD12c).
 */
import type { Env } from '../../types';
// The parts every image press shares (the deck's and D1409's article images) live in `../aiImages`.
export {
  EXTENSION, IMAGE_BYTES_ESTIMATE, IMAGE_MODEL, IMAGE_MODEL_LABEL, IMAGE_MODEL_LABELS, MIMES, REAL_PERSON_MESSAGE, balanceRefusal,
  imageModelLabel, personIn, sniffMime,
} from '../aiImages';

export const IMAGE_PAGE = 'Founder · Raise · Pitch deck';
export const IMAGE_OPTION = 'deck:image';

export const USES = ['content', 'card', 'deck'] as const;
export const STYLES = ['line', 'isometric', 'flat', 'scene', 'diagram'] as const;
export const PALETTES = ['brand', 'neutral'] as const;
export const ASPECTS = ['16:9', '4:3', '1:1', '3:4'] as const;
export const OVERLAYS = ['none', 'light', 'strong'] as const;
export type Use = typeof USES[number];
export type Style = typeof STYLES[number];
export type Overlay = typeof OVERLAYS[number];

export const COUNT_MAX = 4;
export const DESCRIPTION_MIN = 3;
export const DESCRIPTION_MAX = 400;
export const ALT_MAX = 200;
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/** The overlay's opacity in the brand ink; "none" has none. */
export const OVERLAY_ALPHA: Record<Overlay, number> = { none: 0, light: 0.65, strong: 0.8 };
/** A background's text colour, as the canvas draws it. */
export const BACKGROUND_TEXT = '#fbfaf7';
export const DEFAULT_INK = '#0f2a3d';
export const CONTRAST_MIN = 4.5;

export const NOT_ILLUSTRATIVE_MESSAGE = 'Images are illustrations only. A chart comes from your records: use Add › Chart. Nothing was run.';
export const PERSON_CONSENT_MESSAGE = 'Record that this person agreed to share their photo before you upload it. Nothing was saved.';

const STYLE_WORDS: Record<Style, string> = {
  line: 'clean line art', isometric: 'isometric illustration', flat: 'flat vector illustration',
  scene: 'soft illustrated scene', diagram: 'abstract diagrammatic illustration without labels',
};
const ASPECT_WORDS: Record<typeof ASPECTS[number], string> = {
  '16:9': 'a wide 16:9 composition', '4:3': 'a 4:3 composition', '1:1': 'a square composition', '3:4': 'a tall 3:4 composition',
};

const CHART = /\b(charts?|graphs?|infographics?|histograms?|pie chart|bar chart|line chart|dashboard (?:with|showing) (?:numbers|figures|metrics))\b/i;

/** The venture's own people's names, as written: the founders and the members (`project_members`). */
export async function ventureNames(env: Env, projectId: number): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT u.name FROM users u JOIN projects p ON p.founder_id IS NOT NULL AND u.founder_id = p.founder_id WHERE p.id = ?
     UNION SELECT u.name FROM project_members m JOIN users u ON u.id = m.user_id
       WHERE m.project_id = ? AND m.status = 'accepted' AND m.removed_at IS NULL`,
  ).bind(projectId, projectId).all<{ name: string | null }>();
  return (rows.results ?? []).map((r) => String(r.name ?? '').trim()).filter((n) => n.length >= 3);
}

/** A chart, a graph or an infographic: an image is never one. */
export const asksForChart = (description: string): boolean => CHART.test(description);

/** One image request, read and checked: the parts every route shares. */
export type ImageAsk = { use: Use; description: string; style: Style; palette: typeof PALETTES[number]; aspect: typeof ASPECTS[number]; count: number; card: number | null; card_uid: string | null; points: string[] };

const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T : fallback);

/** The request's fields, or the sentence that refuses it. */
export function askOf(body: any): { ask: ImageAsk } | { error: string } {
  const use = oneOf(body?.use, USES, 'content');
  const description = typeof body?.description === 'string' ? body.description.replace(/\s+/g, ' ').trim() : '';
  if (description.length < DESCRIPTION_MIN) return { error: 'Describe the image first.' };
  if (description.length > DESCRIPTION_MAX) return { error: `The description is at most ${DESCRIPTION_MAX} characters.` };
  const count = Number(body?.count ?? 2);
  if (!Number.isInteger(count) || count < 1 || count > COUNT_MAX) return { error: `Ask for 1 to ${COUNT_MAX} images.` };
  const card = body?.card == null ? null : Number(body.card);
  if (card !== null && (!Number.isInteger(card) || card < 0 || card > 59)) return { error: 'card must be a card of the deck, from 0.' };
  // D1500: the card's own uid, which the route records beside its place (`cardRefOf`).
  const card_uid = body?.card_uid == null || body.card_uid === '' ? null : body.card_uid;
  if (card_uid !== null && !(typeof card_uid === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(card_uid))) return { error: 'card_uid must be a card of the deck.' };
  // PD12e's text points shape the description: their labels only, never their values.
  const points = (Array.isArray(body?.points) ? body.points : []).filter((p: unknown): p is string => typeof p === 'string')
    .map((p: string) => p.replace(/\s+/g, ' ').trim().slice(0, 80)).filter(Boolean).slice(0, 4);
  return { ask: {
    use, description, count, card, card_uid, points,
    style: oneOf(body?.style, STYLES, 'flat'),
    palette: oneOf(body?.palette, PALETTES, 'brand'),
    aspect: oneOf(body?.aspect, ASPECTS, use === 'content' ? '4:3' : '16:9'),
  } };
}

/** The text FLUX.1 Schnell is given. Illustrative only: no people, no words, no figures. */
export function promptOf(ask: ImageAsk, brandColours: readonly string[] = []): string {
  const palette = ask.palette === 'brand' && brandColours.length ? `the brand colours ${brandColours.slice(0, 4).join(', ')}` : 'neutral, muted tones';
  const about = ask.points.length ? ` About: ${ask.points.join('; ')}.` : '';
  return `${ask.description}.${about} ${STYLE_WORDS[ask.style]}, ${palette}, ${ASPECT_WORDS[ask.aspect]}. `
    + 'An illustration only: no identifiable people, no faces, no text, no letters, no numbers, no charts or graphs.';
}

// ── The overlay's contrast (WCAG 2.x relative luminance) ──────────────────────

const HEX = /^#[0-9a-f]{6}$/i;
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** The worst-case contrast of a background's text on this overlay, to two places. */
export function overlayContrast(overlay: Overlay, ink: string = DEFAULT_INK, text: string = BACKGROUND_TEXT): number {
  const a = OVERLAY_ALPHA[overlay];
  const inkRgb = channels(HEX.test(ink) ? ink : DEFAULT_INK);
  // The overlay composited over a white pixel, the brightest the image can be under it.
  const under = inkRgb.map((c) => Math.round(a * c + (1 - a) * 255));
  const [hi, lo] = [luminance(channels(text)), luminance(under)].sort((x, y) => y - x);
  return Math.floor(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}
export const readable = (overlay: Overlay, ink?: string) => overlayContrast(overlay, ink) >= CONTRAST_MIN;
