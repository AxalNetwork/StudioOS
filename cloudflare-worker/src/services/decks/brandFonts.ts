/**
 * D1562 (#3809): the fonts a brand kit may name. Google Fonts under the SIL
 * Open Font License only (owner decision K, A): free to embed and export, so
 * the choice needs no spend and no licence wording. A module with no imports,
 * so the slide model and the brand kit both read it without a cycle.
 */
export const BRAND_FONTS = Object.freeze([
  'Inter', 'Space Grotesk', 'Manrope', 'DM Sans', 'Work Sans', 'IBM Plex Sans', 'Montserrat', 'Poppins',
  'Lora', 'Merriweather', 'Playfair Display', 'Source Serif 4',
] as const);
export type BrandFont = typeof BRAND_FONTS[number];

/** A theme's font pair, kept only when both are on the list. */
export function fontPairOf(v: any): { display: BrandFont; body: BrandFont } | null {
  const ok = (f: unknown) => (BRAND_FONTS as readonly string[]).includes(String(f));
  return v && ok(v.display) && ok(v.body) ? { display: v.display, body: v.body } : null;
}
