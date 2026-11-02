/**
 * D1562 (#3809, deck v2 D1) — the deck brand kit: fonts, logo, palette roles,
 * image style, reference images and an image library, its pure pick for the
 * one-click run, and Apply brand.
 *
 * WHERE THE KIT LIVES. The venture's newest live landing page holds the kit
 * the studio has always read (palette, font pairing, logos, voice). Migration
 * 737 adds the deck's own kit over it (`deck_brand_kits`, one row per venture,
 * and `deck_brand_kit_images`): a value the deck kit records wins; one it
 * leaves out falls back to the page's. `readKitView` reads both, and the view
 * it answers is what `GET /api/decks/brand-kit` sends.
 *
 * THE PICK IS PURE (`brandKitPick`). Given the kit, it answers the theme the
 * one-click run applies without asking — Brand, the kit's font pair, the logo
 * in the corner, the image style as the art direction — and the reason in
 * words. The palette roles reach the deck through the brand theme's tokens
 * (`designSystem.ts` themeTokens), which repair any pair under its minimum,
 * so a picked theme never draws an unreadable pair. No clock, no D1, no model.
 *
 * APPLY BRAND IS PURE TOO (`applyBrandToDeck`): the picked theme, every card's
 * own background colour cleared so it sits on the brand ground (a background
 * image stays), and every accent run recoloured to the brand accent where it
 * reads at the slide model's 4.5:1, else left plain. The route answers the
 * whole deck at once and writes nothing; the editor applies it as one edit,
 * one undo step. No model is ever called.
 *
 * All SQL is bound; none is interpolated.
 */
import type { Env } from '../../types';
import { BODY_CONTRAST, contrast, themeProblems, themeTokens, type BrandKit, type ThemeTokens } from './designSystem';
import { ACCENT_CONTRAST, groundOf, type UrlGuard } from './slideModel';
import { BRAND_FONTS, BRAND_IMAGE_STYLES, IMAGE_STYLE_LABELS, brandFont, fontPairOf, imageStyleOf, type BrandImageStyle } from './brandKitLists';
import { IMAGE_STYLE_DIRECTION } from './visuals';

export const PALETTE_ROLES = ['ground', 'ink', 'accent', 'secondary', 'muted'] as const;
export type PaletteRole = (typeof PALETTE_ROLES)[number];
/** The five swatches pd7 draws, in its order, with their names. */
export const ROLE_LABELS: Readonly<Record<PaletteRole, string>> = Object.freeze({ ground: 'Background', ink: 'Text', accent: 'Accent', secondary: 'Secondary', muted: 'Muted text' });
export const LIBRARY_MAX = 24;
export const REFERENCES_MAX = 3;
export const ALT_MAX = 200;
export const NO_PALETTE = 'No palette recorded';

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : null);

/** What the sheet may pick from, sent beside every kit read so the page keeps no copy of the lists. */
export const KIT_CHOICES = Object.freeze({
  fonts: BRAND_FONTS,
  image_styles: BRAND_IMAGE_STYLES.map((id) => ({ id, label: IMAGE_STYLE_LABELS[id] })),
  palette_roles: PALETTE_ROLES.map((role) => ({ role, label: ROLE_LABELS[role] })),
  library_max: LIBRARY_MAX,
  references_max: REFERENCES_MAX,
});

export type LandingRow = {
  name: string | null; theme_color: string | null; palette_bg: string | null; palette_ink: string | null; palette_secondary: string | null;
  palette_accent: string | null; font_pairing: string | null; voice_json: string | null; logo_url: string | null; logo_dark_url: string | null;
  logo_svg: string | null; logo_dark_svg: string | null; updated_at: string | null;
};
export type DeckKitRow = { heading_font: string | null; body_font: string | null; logo_url: string | null; palette_json: string | null; image_style: string | null; updated_at: string | null };
export type LibraryImage = { url: string; alt: string | null; reference: boolean };

/** What `GET /api/decks/brand-kit` sends as `kit`: D898's fields, then D1562's. */
export type KitView = {
  name: string | null;
  palette: { bg: string | null; ink: string | null; accent: string | null; secondary: string | null };
  fonts: string | null;
  voice: string[];
  logo: { light: string | null; dark: string | null; inline: boolean };
  updated_at: string | null;
  roles: Array<{ role: PaletteRole; label: string; hex: string | null }>;
  font_pair: { heading: { family: string; licence: string }; body: { family: string; licence: string } } | null;
  image_style: BrandImageStyle | null;
  references: Array<{ url: string; alt: string | null }>;
  library: LibraryImage[];
  deck_kit: { updated_at: string | null } | null;
  pick: BrandPick;
};

export type BrandPick = { theme: Record<string, unknown>; reason: string; adjustments: string[] };

// ───────────────────────────────────────────────────────────── reads

/** The deck kit's palette roles as stored, each a colour or absent. */
function rolesOf(json: string | null): Partial<Record<PaletteRole, string>> {
  let o: any = null;
  try { o = JSON.parse(json || 'null'); } catch { o = null; }
  const out: Partial<Record<PaletteRole, string>> = {};
  if (o && typeof o === 'object' && !Array.isArray(o)) for (const r of PALETTE_ROLES) { const h = hex(o[r]); if (h) out[r] = h; }
  return out;
}

/** The kit `themeTokens` reads: the deck kit's values over the landing page's. */
export function mergeKit(landing: Partial<LandingRow> | null, deck: DeckKitRow | null): BrandKit {
  const roles = rolesOf(deck?.palette_json ?? null);
  const pair = fontPairOf({ heading: deck?.heading_font, body: deck?.body_font });
  return {
    palette_bg: roles.ground ?? hex(landing?.palette_bg),
    palette_ink: roles.ink ?? hex(landing?.palette_ink),
    palette_accent: roles.accent ?? hex(landing?.palette_accent) ?? hex(landing?.theme_color),
    theme_color: hex(landing?.theme_color),
    palette_secondary: roles.secondary ?? hex(landing?.palette_secondary),
    palette_muted: roles.muted ?? null,
    font_heading: pair?.heading ?? null,
    font_body: pair?.body ?? null,
    image_style: imageStyleOf(deck?.image_style),
  };
}

/**
 * The kit view, or null when the venture has neither a live landing page nor
 * a deck kit. The inline logo SVG is never sent (the page would have to inject
 * it); its URL forms are, through the image guard.
 */
export function kitView(landing: LandingRow | null, deck: DeckKitRow | null, images: LibraryImage[], url: UrlGuard): KitView | null {
  if (!landing && !deck && !images.length) return null;
  let voice: string[] = [];
  try {
    const parsed = JSON.parse(landing?.voice_json || '[]');
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tags) ? parsed.tags : [];
    voice = list.filter((t: unknown) => typeof t === 'string' && t.trim()).map((t: string) => t.trim().slice(0, 40)).slice(0, 8);
  } catch { voice = []; }
  const merged = mergeKit(landing, deck);
  const heading = brandFont(merged.font_heading);
  const body = brandFont(merged.font_body);
  const logoLight = url(deck?.logo_url) ?? url(landing?.logo_url);
  const library = images.map((i) => ({ url: url(i.url), alt: i.alt, reference: i.reference })).filter((i): i is LibraryImage => Boolean(i.url));
  const view: Omit<KitView, 'pick'> = {
    name: typeof landing?.name === 'string' ? landing.name.slice(0, 120) : null,
    palette: { bg: merged.palette_bg ?? null, ink: merged.palette_ink ?? null, accent: merged.palette_accent ?? null, secondary: merged.palette_secondary ?? null },
    fonts: typeof landing?.font_pairing === 'string' && landing.font_pairing.trim() ? landing.font_pairing.trim().slice(0, 120) : null,
    voice,
    logo: { light: logoLight, dark: url(landing?.logo_dark_url), inline: Boolean(landing?.logo_svg || landing?.logo_dark_svg) },
    updated_at: deck?.updated_at ?? landing?.updated_at ?? null,
    roles: PALETTE_ROLES.map((role) => ({ role, label: ROLE_LABELS[role], hex: ({ ground: merged.palette_bg, ink: merged.palette_ink, accent: merged.palette_accent, secondary: merged.palette_secondary, muted: merged.palette_muted } as Record<PaletteRole, string | null | undefined>)[role] ?? null })),
    font_pair: heading && body ? { heading: { family: heading.family, licence: heading.licence }, body: { family: body.family, licence: body.licence } } : null,
    image_style: imageStyleOf(merged.image_style),
    references: library.filter((i) => i.reference).slice(0, REFERENCES_MAX).map((i) => ({ url: i.url, alt: i.alt })),
    library,
    deck_kit: deck ? { updated_at: deck.updated_at ?? null } : null,
  };
  return { ...view, pick: brandKitPick(view) };
}

/** Both reads, or a throw: a failed read is never an empty kit (the route answers 503). */
export async function readKitView(env: Env, projectId: number, url: UrlGuard): Promise<KitView | null> {
  const landing = await env.DB.prepare(
    `SELECT name, theme_color, palette_bg, palette_ink, palette_secondary, palette_accent, font_pairing, voice_json,
            logo_url, logo_dark_url, logo_svg, logo_dark_svg, updated_at
       FROM landing_pages WHERE project_id = ? AND archived_at IS NULL ORDER BY id DESC LIMIT 1`,
  ).bind(projectId).first<LandingRow>();
  const deck = await env.DB.prepare(
    'SELECT heading_font, body_font, logo_url, palette_json, image_style, updated_at FROM deck_brand_kits WHERE project_id = ?',
  ).bind(projectId).first<DeckKitRow>();
  const rows = await env.DB.prepare(
    'SELECT url, alt, reference FROM deck_brand_kit_images WHERE project_id = ? ORDER BY id LIMIT ?',
  ).bind(projectId, LIBRARY_MAX).all<{ url: string; alt: string | null; reference: number }>();
  const images = (rows.results || []).map((r) => ({ url: r.url, alt: r.alt ?? null, reference: Number(r.reference) === 1 }));
  return kitView(landing ?? null, deck ?? null, images, url);
}

/** The merged kit for a reader that draws (the images plan), or null when none is recorded or the read fails. */
export async function brandKitFor(env: Env, projectId: number, url: UrlGuard): Promise<BrandKit | null> {
  try {
    const v = await readKitView(env, projectId, url);
    return v ? kitOfView(v) : null;
  } catch { return null; }
}

/** The view's colours and choices as `themeTokens` reads them. */
export function kitOfView(v: Pick<KitView, 'palette' | 'roles' | 'font_pair' | 'image_style'>): BrandKit {
  return {
    palette_bg: v.palette.bg, palette_ink: v.palette.ink, palette_accent: v.palette.accent, palette_secondary: v.palette.secondary,
    palette_muted: v.roles.find((r) => r.role === 'muted')?.hex ?? null,
    font_heading: v.font_pair?.heading.family ?? null, font_body: v.font_pair?.body.family ?? null, image_style: v.image_style,
  };
}

// ───────────────────────────────────────────────────────────── the write

export type KitBody = {
  heading_font: string | null; body_font: string | null; logo_url: string | null;
  palette: Partial<Record<PaletteRole, string>>; image_style: BrandImageStyle | null; library: LibraryImage[];
};
type Refusal = { status: 400 | 422; code: string; message: string };

/**
 * A `PUT /api/decks/brand-kit` body, checked, or the refusal. The body is the
 * whole deck kit (the sheet sends every field), so a field left out is cleared:
 *   { fonts: { heading, body } | null, logo_url, palette: { ground?, ink?,
 *     accent?, secondary?, muted? }, image_style, library: [{ url, alt?, reference? }] }
 */
export function kitBody(body: any, url: UrlGuard): KitBody | Refusal {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, code: 'invalid_body', message: 'Send the brand kit as an object.' };
  let pair: { heading: string; body: string } | null = null;
  if (body.fonts != null) {
    pair = fontPairOf(body.fonts);
    if (!pair) return { status: 400, code: 'font_not_listed', message: `Pick both fonts from the list: Google Fonts under the Open Font Licence (${BRAND_FONTS.length} families). Nothing was saved.` };
  }
  let logo: string | null = null;
  if (body.logo_url != null && body.logo_url !== '') {
    logo = typeof body.logo_url === 'string' ? url(body.logo_url) : null;
    if (!logo) return { status: 422, code: 'unsafe_url', message: 'The logo must be a public https image address. Nothing was saved.' };
  }
  const palette: Partial<Record<PaletteRole, string>> = {};
  if (body.palette != null) {
    if (typeof body.palette !== 'object' || Array.isArray(body.palette)) return { status: 400, code: 'invalid_palette', message: 'The palette is its five roles, each a colour like #1a2b3c.' };
    for (const [k, v] of Object.entries(body.palette)) {
      if (!(PALETTE_ROLES as readonly string[]).includes(k)) return { status: 400, code: 'invalid_palette', message: `${k.slice(0, 20)} is not a palette role. The roles are ${PALETTE_ROLES.join(', ')}.` };
      if (v == null || v === '') continue;
      const h = hex(v);
      if (!h) return { status: 400, code: 'invalid_colour', message: `${ROLE_LABELS[k as PaletteRole]} must be a colour like #1a2b3c.` };
      palette[k as PaletteRole] = h;
    }
  }
  let style: BrandImageStyle | null = null;
  if (body.image_style != null && body.image_style !== '') {
    style = imageStyleOf(body.image_style);
    if (!style) return { status: 400, code: 'invalid_image_style', message: 'The image style is Photo, Illustration or Screenshot.' };
  }
  const raw = body.library == null ? [] : body.library;
  if (!Array.isArray(raw)) return { status: 400, code: 'invalid_library', message: 'The image library is a list of images.' };
  if (raw.length > LIBRARY_MAX) return { status: 400, code: 'too_many_images', message: `The image library holds at most ${LIBRARY_MAX} images.` };
  const library: LibraryImage[] = [];
  for (const i of raw) {
    const u = typeof i?.url === 'string' ? url(i.url) : null;
    if (!u) return { status: 422, code: 'unsafe_url', message: 'Every image must be a public https image address. Nothing was saved.' };
    if (library.some((x) => x.url === u)) continue;
    const alt = typeof i?.alt === 'string' && i.alt.trim() ? i.alt.trim().slice(0, ALT_MAX) : null;
    library.push({ url: u, alt, reference: i?.reference === true });
  }
  if (library.filter((i) => i.reference).length > REFERENCES_MAX) return { status: 400, code: 'too_many_references', message: `Pick at most ${REFERENCES_MAX} reference images.` };
  return { heading_font: pair?.heading ?? null, body_font: pair?.body ?? null, logo_url: logo, palette, image_style: style, library };
}

/** The kit row and its library, replaced in one batch: either both land or neither does. */
export async function writeDeckKit(env: Env, projectId: number, userId: number, k: KitBody): Promise<void> {
  const stmts = [
    env.DB.prepare(
      `INSERT INTO deck_brand_kits (project_id, heading_font, body_font, logo_url, palette_json, image_style, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(project_id) DO UPDATE SET heading_font = excluded.heading_font, body_font = excluded.body_font, logo_url = excluded.logo_url,
         palette_json = excluded.palette_json, image_style = excluded.image_style, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(projectId, k.heading_font, k.body_font, k.logo_url, Object.keys(k.palette).length ? JSON.stringify(k.palette) : null, k.image_style, userId),
    env.DB.prepare('DELETE FROM deck_brand_kit_images WHERE project_id = ?').bind(projectId),
    ...k.library.map((i) => env.DB.prepare('INSERT INTO deck_brand_kit_images (project_id, url, alt, reference, added_by) VALUES (?, ?, ?, ?, ?)')
      .bind(projectId, i.url, i.alt, i.reference ? 1 : 0, userId)),
  ];
  await env.DB.batch(stmts);
}

// ───────────────────────────────────────────────────────────── the pick

/**
 * The theme a kit gives a deck, and why (dk-auto AUTO-2's brand-kit
 * precedence): Brand; the kit's font pair; the logo in every card's corner
 * when a logo is recorded; the image style as the art direction's style.
 * `base` is the theme the deck has now: its own settings (size, language,
 * Confidential, footer, the art direction's seed and note) are kept, and a
 * background colour is cleared so the cards sit on the brand ground (a
 * background image stays). Pure.
 */
export function brandKitPick(v: Pick<KitView, 'palette' | 'roles' | 'font_pair' | 'image_style' | 'logo'>, base: Record<string, any> | null = null): BrandPick {
  const { adjustments } = themeTokens('brand', kitOfView(v));
  const theme: Record<string, unknown> = { ...(base && typeof base === 'object' ? base : {}), kind: 'brand' };
  const bg = base?.background;
  theme.background = bg && typeof bg === 'object' && bg.image_url ? bg : null;
  if (v.font_pair) theme.fonts = { heading: v.font_pair.heading.family, body: v.font_pair.body.family };
  const logo = Boolean(v.logo?.light || v.logo?.dark || v.logo?.inline);
  if (logo) {
    const c = base?.chrome && typeof base.chrome === 'object' ? base.chrome : {};
    theme.chrome = { page_number: c.page_number === true, footer_text: c.footer_text ?? null, logo_corner: true, confidential: c.confidential === true };
  }
  const style = v.image_style ? IMAGE_STYLE_DIRECTION[v.image_style].style : null;
  if (style) {
    const a = base?.art_direction;
    theme.art_direction = { ...(a && typeof a === 'object' ? a : typeof a === 'string' && a.trim() ? { note: a } : {}), style };
  }
  const recorded = v.roles.filter((r) => r.hex).length;
  const parts = [
    v.font_pair ? `${v.font_pair.heading.family} and ${v.font_pair.body.family}` : 'the theme\'s own fonts',
    recorded ? `${recorded} of ${PALETTE_ROLES.length} palette roles` : NO_PALETTE.toLowerCase(),
    logo ? 'the logo' : 'no logo recorded',
    v.image_style ? `${IMAGE_STYLE_LABELS[v.image_style]} images` : 'no image style recorded',
  ];
  return { theme, reason: `Brand, because your brand kit is recorded: ${parts.join(', ')}.`, adjustments };
}

// ───────────────────────────────────────────────────────────── apply brand

export type Applied = { theme: Record<string, unknown>; cards: any[]; tokens: ThemeTokens; changed: number; problems: string[]; reason: string; adjustments: string[] };

/** One card restyled: its colour background cleared, its accent runs in the brand accent or plain. */
function restyleCard(card: any, accent: string, deckGround: string): any {
  if (!card || typeof card !== 'object') return card;
  let next = card;
  const bg = card.background;
  if (bg && typeof bg === 'object' && bg.color && !bg.image_url) { const { background: _bg, ...rest } = card; next = rest; }
  const ground = groundOf(next);
  const reads = contrast(accent, ground) >= ACCENT_CONTRAST && contrast(accent, deckGround) >= ACCENT_CONTRAST;
  if (Array.isArray(next.blocks)) {
    let touched = false;
    const blocks = next.blocks.map((b: any) => {
      if (b?.kind !== 'text' || !Array.isArray(b.paras)) return b;
      let changed = false;
      const paras = b.paras.map((p: any) => ({
        ...p,
        runs: (Array.isArray(p?.runs) ? p.runs : []).map((r: any) => {
          if (r?.accent == null) return r;
          if (reads && r.accent === accent) return r;
          changed = true;
          if (reads) return { ...r, accent };
          const { accent: _a, ...plain } = r;
          return plain;
        }),
      }));
      if (!changed) return b;
      touched = true;
      return { ...b, paras };
    });
    if (touched) next = { ...next, blocks };
  }
  return next;
}

/** Every pair a restyled card draws that is under its minimum, as sentences; [] when sound. */
export function cardContrastProblems(cards: any[], tokens: ThemeTokens): string[] {
  const out: string[] = [];
  cards.forEach((card, i) => {
    const ground = groundOf(card);
    if (card?.background?.color && !card.background.image_url && contrast(tokens.colours.ink, ground) < BODY_CONTRAST) out.push(`Card ${i + 1}: the text on its background is under ${BODY_CONTRAST}:1.`);
    for (const b of Array.isArray(card?.blocks) ? card.blocks : []) {
      for (const p of Array.isArray(b?.paras) ? b.paras : []) {
        for (const r of Array.isArray(p?.runs) ? p.runs : []) {
          if (typeof r?.accent === 'string' && (contrast(r.accent, ground) < ACCENT_CONTRAST || contrast(r.accent, tokens.colours.ground) < ACCENT_CONTRAST)) out.push(`Card ${i + 1}: an accent run is under ${ACCENT_CONTRAST}:1.`);
        }
      }
    }
  });
  return out;
}

/**
 * Apply brand: the deck restyled by the kit, whole, in one answer. Cards
 * nothing changed are the same objects, so the editor's one edit replaces
 * only what moved. `problems` is the theme's and the cards' contrast
 * problems, and is [] by construction; the route refuses a deck where it is
 * not rather than hand back a deck that cannot be read.
 */
export function applyBrandToDeck(cards: unknown, theme: Record<string, any> | null, v: KitView): Applied {
  const pick = brandKitPick(v, theme);
  const { tokens } = themeTokens('brand', kitOfView(v));
  const list = Array.isArray(cards) ? cards : [];
  let changed = 0;
  const out = list.map((c) => { const n = restyleCard(c, tokens.colours.accent, tokens.colours.ground); if (n !== c) changed += 1; return n; });
  return { theme: pick.theme, cards: out, tokens, changed, problems: [...themeProblems(tokens), ...cardContrastProblems(out, tokens)], reason: pick.reason, adjustments: pick.adjustments };
}
