/**
 * D1562 (#3809, deck v2 D1) — the deck brand kit, and applying it.
 *
 * THE KIT. A venture's landing page holds its palette and logo (D898's
 * `GET /api/decks/brand-kit`). `deck_brand_kits` (migration 737) adds what pd7's
 * Brand kit card draws beyond that:
 *   · a font pair from `BRAND_FONTS`: Google Fonts under the OFL only (owner
 *     decision K, A). They are free to embed and export, so the choice needs no
 *     spend and no licence wording; uploads are a later task;
 *   · palette roles (ground, ink, accent, secondary, highlight), each #rrggbb,
 *     winning over the landing page's where set;
 *   · an image style (photo, illustration, screenshot);
 *   · up to three reference images, and a logo, each a kept deck image of the
 *     venture.
 *
 * APPLYING IT. `applyBrand(theme, kit)` is pure and never calls a model. It
 * gives the deck's theme: kind `brand`, the kit's fonts, the logo corner on,
 * and an art direction from the image style and the first reference image.
 * The palette is checked by `themeTokens`: a colour that would fail contrast
 * is left out and named, so the result has zero contrast failures
 * (`themeProblems`). `POST /api/decks/:id/apply-brand` saves it as one new
 * version: one undo step.
 *
 * THE ONE-CLICK PICK. `brandKitPick(kit)` is what a one-click run applies
 * first when a kit exists (AUTO-2's precedence): the same theme, and the reason
 * it records ("Brand · from your brand kit"). With no kit it answers null and
 * the run picks as before.
 */
import { themeProblems, themeTokens, type BrandKit as PaletteKit } from './designSystem';
import { sanitizeArtDirection, type ArtDirection } from './artDirection';
import { fontPairOf, type BrandFont } from './brandFonts';

export { BRAND_FONTS, type BrandFont } from './brandFonts';
export const IMAGE_STYLES = Object.freeze(['photo', 'illustration', 'screenshot'] as const);
export type ImageStyle = typeof IMAGE_STYLES[number];
export const PALETTE_ROLES = Object.freeze(['ground', 'ink', 'accent', 'secondary', 'highlight'] as const);
export const MAX_REFERENCES = 3;
export const PICK_REASON = 'Brand · from your brand kit';

const HEX = /^#[0-9a-f]{6}$/;
const UID = /^[0-9a-f-]{36}$/;

export type DeckBrandKit = {
  fonts: { display: BrandFont; body: BrandFont } | null;
  palette: Partial<Record<typeof PALETTE_ROLES[number], string>>;
  image_style: ImageStyle | null;
  references: string[];
  logo_uid: string | null;
};

/** The kit a request or a row holds, checked; anything malformed is dropped, not guessed. */
export function sanitizeBrandKit(v: any): DeckBrandKit {
  const fonts = fontPairOf(v?.fonts);
  const palette: DeckBrandKit['palette'] = {};
  for (const role of PALETTE_ROLES) {
    const c = typeof v?.palette?.[role] === 'string' ? v.palette[role].trim().toLowerCase() : '';
    if (HEX.test(c)) palette[role] = c;
  }
  const refs = (Array.isArray(v?.references) ? v.references : []).filter((u: unknown) => typeof u === 'string' && UID.test(u));
  return {
    fonts,
    palette,
    image_style: (IMAGE_STYLES as readonly string[]).includes(v?.image_style) ? v.image_style : null,
    references: [...new Set<string>(refs)].slice(0, MAX_REFERENCES),
    logo_uid: typeof v?.logo_uid === 'string' && UID.test(v.logo_uid) ? v.logo_uid : null,
  };
}

/** The landing page's palette with the kit's roles over it, in `themeTokens`' shape. */
export function paletteOf(landing: PaletteKit | null, kit: DeckBrandKit): PaletteKit {
  const p = kit.palette;
  return {
    palette_bg: p.ground ?? landing?.palette_bg ?? null,
    palette_ink: p.ink ?? landing?.palette_ink ?? null,
    palette_accent: p.accent ?? landing?.palette_accent ?? landing?.theme_color ?? null,
    palette_secondary: p.secondary ?? landing?.palette_secondary ?? null,
  };
}

/** The image style as the deck's art direction (D1544): the style the image models draw in, and the first reference. */
export function artDirectionOf(kit: DeckBrandKit, current: unknown): ArtDirection | string | null {
  const base = sanitizeArtDirection(current);
  const into: ArtDirection = typeof base === 'string' ? { note: base } : { ...(base ?? {}) };
  if (kit.image_style === 'illustration') { into.style = 'flat'; into.palette = 'brand'; }
  if (kit.image_style === 'photo') into.style = 'scene';
  if (kit.image_style === 'screenshot') into.style = 'diagram';
  if (kit.image_style) {
    const words = { photo: 'photographs', illustration: 'flat illustrations in the brand palette', screenshot: 'clean product screenshots' }[kit.image_style];
    into.note = `Images are ${words}, as the brand kit sets.`;
  }
  if (kit.references[0]) into.reference_uid = kit.references[0];
  return sanitizeArtDirection(into);
}

export type AppliedBrand = { theme: Record<string, any>; adjustments: string[]; problems: string[] };

/** The deck's theme with the brand applied: never a model, never a contrast failure. */
export function applyBrand(theme: Record<string, any> | null, landing: PaletteKit | null, kit: DeckBrandKit): AppliedBrand {
  const out: Record<string, any> = { ...(theme ?? {}), kind: 'brand' };
  if (kit.fonts) out.fonts = { ...kit.fonts }; else delete out.fonts;
  out.chrome = { ...(theme?.chrome ?? {}), logo_corner: true };
  const art = artDirectionOf(kit, theme?.art_direction);
  if (art) out.art_direction = art; else delete out.art_direction;
  const { tokens, adjustments } = themeTokens('brand', paletteOf(landing, kit));
  return { theme: out, adjustments, problems: themeProblems(tokens) };
}

/** What a one-click run applies first when a kit exists; null with no kit, so the run picks as before. */
export function brandKitPick(landing: PaletteKit | null, kit: DeckBrandKit | null): { theme: Record<string, any>; reason: string; adjustments: string[] } | null {
  if (!kit) return null;
  const hasPalette = Object.keys(kit.palette).length > 0 || Boolean(landing?.palette_bg || landing?.palette_ink || landing?.palette_accent || landing?.theme_color);
  if (!hasPalette && !kit.fonts && !kit.image_style) return null;
  const applied = applyBrand(null, landing, kit);
  return { theme: applied.theme, reason: PICK_REASON, adjustments: applied.adjustments };
}

// ---------------------------------------------------------------------------
// The store (migration 737)
// ---------------------------------------------------------------------------

type KitRow = { display_font: string | null; body_font: string | null; palette_json: string | null; image_style: string | null; reference_uids_json: string | null; logo_uid: string | null; updated_at: string | null };

/** The venture's deck brand kit as stored, or null when none was saved. A store that cannot be read throws. */
export async function deckBrandKitFor(env: { DB: D1Database }, projectId: number): Promise<(DeckBrandKit & { updated_at: string | null }) | null> {
  const row = await env.DB.prepare(
    'SELECT display_font, body_font, palette_json, image_style, reference_uids_json, logo_uid, updated_at FROM deck_brand_kits WHERE project_id = ?',
  ).bind(projectId).first<KitRow>();
  if (!row) return null;
  const json = (s: string | null, d: unknown) => { try { return JSON.parse(s || ''); } catch { return d; } };
  const kit = sanitizeBrandKit({
    fonts: { display: row.display_font, body: row.body_font }, palette: json(row.palette_json, {}),
    image_style: row.image_style, references: json(row.reference_uids_json, []), logo_uid: row.logo_uid,
  });
  return { ...kit, updated_at: row.updated_at };
}

/** The image uids of `uids` that are kept deck images of this venture: a reference or a logo is never another venture's. */
export async function keptImagesOf(env: { DB: D1Database }, projectId: number, uids: string[]): Promise<Set<string>> {
  if (!uids.length) return new Set();
  const rows = (await env.DB.prepare(
    `SELECT uid FROM deck_images WHERE project_id = ? AND state = 'kept' AND uid IN (SELECT value FROM json_each(?))`,
  ).bind(projectId, JSON.stringify(uids)).all<{ uid: string }>()).results || [];
  return new Set(rows.map((r) => String(r.uid)));
}

/** Store the kit: one row per venture, replaced whole. */
export async function saveDeckBrandKit(env: { DB: D1Database }, projectId: number, kit: DeckBrandKit, userId: number | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO deck_brand_kits (project_id, display_font, body_font, palette_json, image_style, reference_uids_json, logo_uid, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(project_id) DO UPDATE SET display_font = excluded.display_font, body_font = excluded.body_font, palette_json = excluded.palette_json,
       image_style = excluded.image_style, reference_uids_json = excluded.reference_uids_json, logo_uid = excluded.logo_uid,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(projectId, kit.fonts?.display ?? null, kit.fonts?.body ?? null, JSON.stringify(kit.palette), kit.image_style,
    JSON.stringify(kit.references), kit.logo_uid, userId).run();
}
