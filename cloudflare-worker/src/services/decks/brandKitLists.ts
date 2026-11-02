/**
 * D1562 (#3809, deck v2 D1) — the fixed lists a brand kit picks from: the
 * font families it may name and the image styles it may ask for.
 *
 * OWNER DECISION K = A: Google Fonts under the SIL Open Font Licence 1.1 only.
 * Those families are free to embed in a page and in every export, so a pick
 * needs no spend and no licence wording. Uploading a font of one's own (K's
 * part B) needs a licence confirmation that the owner and counsel would word;
 * it is a later task, and nothing here accepts a family off this list.
 *
 * Each family is named with its licence and its kind, so the sheet can say
 * what it is and a test can hold every entry to OFL-1.1. The list is fixed:
 * adding a family is a code change, reviewed, never a request field.
 *
 * No imports, so `slideModel.ts` (which keeps a theme's font pair) and the
 * brand kit can both read it without a cycle.
 */

export const FONT_LICENCE = 'OFL-1.1' as const;

export type FontKind = 'sans' | 'serif' | 'display';
export type FontFamily = { family: string; kind: FontKind; licence: typeof FONT_LICENCE; source: 'google_fonts' };

const f = (family: string, kind: FontKind): FontFamily => Object.freeze({ family, kind, licence: FONT_LICENCE, source: 'google_fonts' as const });

/** The families a kit may pick, in the order the sheet lists them. Space Grotesk and Inter are the themes' own (`designSystem.ts` FONTS). */
export const BRAND_FONTS: readonly FontFamily[] = Object.freeze([
  f('Space Grotesk', 'sans'),
  f('Inter', 'sans'),
  f('DM Sans', 'sans'),
  f('Manrope', 'sans'),
  f('Work Sans', 'sans'),
  f('Public Sans', 'sans'),
  f('IBM Plex Sans', 'sans'),
  f('Outfit', 'sans'),
  f('Sora', 'sans'),
  f('Montserrat', 'sans'),
  f('Poppins', 'sans'),
  f('Bricolage Grotesque', 'display'),
  f('Fraunces', 'serif'),
  f('Playfair Display', 'serif'),
  f('DM Serif Display', 'serif'),
  f('Lora', 'serif'),
  f('Merriweather', 'serif'),
  f('Source Serif 4', 'serif'),
  f('IBM Plex Serif', 'serif'),
  f('Libre Baskerville', 'serif'),
]);

/** The family's entry, by its exact name, or null: a name off the list is never kept. */
export function brandFont(name: unknown): FontFamily | null {
  if (typeof name !== 'string') return null;
  const n = name.trim();
  return BRAND_FONTS.find((x) => x.family === n) ?? null;
}

/** A heading and a body family, both on the list, or null. Either half off the list drops the pair. */
export function fontPairOf(v: unknown): { heading: string; body: string } | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const heading = brandFont(o.heading);
  const body = brandFont(o.body);
  return heading && body ? { heading: heading.family, body: body.family } : null;
}

/**
 * The image styles a kit may ask for (pd7: Photo · Illustration · Screenshot).
 * `visuals.ts` IMAGE_STYLE_DIRECTION says how each one is drawn; every image
 * is still an illustration (`images.ts`).
 */
export const BRAND_IMAGE_STYLES = ['photo', 'illustration', 'screenshot'] as const;
export type BrandImageStyle = (typeof BRAND_IMAGE_STYLES)[number];
export const IMAGE_STYLE_LABELS: Readonly<Record<BrandImageStyle, string>> = Object.freeze({ photo: 'Photo', illustration: 'Illustration', screenshot: 'Screenshot' });

/** The style, or null for anything off the list. */
export const imageStyleOf = (v: unknown): BrandImageStyle | null => ((BRAND_IMAGE_STYLES as readonly unknown[]).includes(v) ? v as BrandImageStyle : null);
