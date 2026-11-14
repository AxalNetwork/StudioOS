/**
 * D1544 (#3784, deck builder v2 B8, dk-auto gap d) — the deck's own art
 * direction, kept on the theme of each version (`theme.art_direction`).
 *
 * Two shapes, both kept:
 *   - a string (D1500's): a sentence of direction, at most 500 characters,
 *     which every image prompt carries as written;
 *   - an object (D1544's): `{ style?, palette?, seed_base?, reference_uid?, note? }`.
 *       style, palette   the image's own style and palette when a request names
 *                        none (`STYLES`, `PALETTES` of `images.ts`)
 *       seed_base        a whole number; image n of a run draws with seed
 *                        `seed_base + n`, so a deck's images share a seed family
 *       reference_uid    a kept image of the venture that a model taking
 *                        references (FLUX.2) draws in the style of; a model that
 *                        takes none draws without it, and says so
 *       note             a sentence of direction, as the string shape's
 *
 * Every image request on the deck inherits it: a request's own style or
 * palette wins, anything it leaves out comes from here. An empty object is
 * not kept, so a theme saved without it hashes as it did.
 */
const STYLE_IDS = ['line', 'isometric', 'flat', 'scene', 'diagram'] as const;
const PALETTE_IDS = ['brand', 'neutral'] as const;
const UID = /^[0-9a-f-]{36}$/;
export const ART_NOTE_MAX = 500;
export const SEED_MAX = 2_147_483_647;

export type ArtDirection = {
  style?: typeof STYLE_IDS[number];
  palette?: typeof PALETTE_IDS[number];
  seed_base?: number;
  reference_uid?: string;
  note?: string;
};

/** The theme's art direction as stored: a string, a checked object, or null when there is none worth keeping. */
export function sanitizeArtDirection(v: unknown): string | ArtDirection | null {
  if (typeof v === 'string') {
    const s = v.trim().slice(0, ART_NOTE_MAX);
    return s || null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out: ArtDirection = {};
  if ((STYLE_IDS as readonly string[]).includes(o.style as string)) out.style = o.style as ArtDirection['style'];
  if ((PALETTE_IDS as readonly string[]).includes(o.palette as string)) out.palette = o.palette as ArtDirection['palette'];
  if (Number.isSafeInteger(o.seed_base) && (o.seed_base as number) >= 0 && (o.seed_base as number) <= SEED_MAX) out.seed_base = o.seed_base as number;
  if (typeof o.reference_uid === 'string' && UID.test(o.reference_uid)) out.reference_uid = o.reference_uid;
  if (typeof o.note === 'string' && o.note.trim()) out.note = o.note.trim().slice(0, ART_NOTE_MAX);
  return Object.keys(out).length ? out : null;
}

/** The art direction a theme carries, always as the object shape (a string becomes its note). */
export function artDirectionOfTheme(theme: unknown): ArtDirection {
  const raw = theme && typeof theme === 'object' ? (theme as Record<string, unknown>).art_direction : null;
  const a = sanitizeArtDirection(raw);
  if (!a) return {};
  return typeof a === 'string' ? { note: a } : a;
}

/** The seed image `n` (from 0) of a run draws with, or undefined when the deck keeps no seed base. */
export const seedFor = (a: ArtDirection, n: number): number | undefined =>
  a.seed_base == null ? undefined : (a.seed_base + n) % (SEED_MAX + 1);
