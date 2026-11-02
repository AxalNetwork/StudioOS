/**
 * D1562 (#3809, deck v2 D1, pd7) — the Brand kit sheet's words and
 * derivations, pure. No React, no network.
 *
 * The kit is the Worker's (`GET /api/decks/brand-kit`, `services/decks/brandKit.ts`):
 * the landing page's kit with the deck kit of migration 737 over it. This file
 * draws it as pd7's card does — the logo, five palette swatches ("No palette
 * recorded" when none is), the font pair (Google Fonts under the OFL only,
 * owner decision K = A), the image style, the reference images — and turns
 * the sheet's draft into the body `PUT /api/decks/brand-kit` takes. The lists
 * it offers (fonts, styles, roles) come with the read (`choices`); this file
 * keeps no copy of them.
 *
 * Apply brand (`POST /api/decks/:id/apply-brand`) answers the whole restyled
 * deck; `applyOps` turns that answer into ONE editor op, so one Undo takes it
 * back (D1515's history).
 */

export const NO_PALETTE = 'No palette recorded';
export const NO_LOGO = 'No logo recorded';
export const NO_FONTS = 'No font pair recorded · the theme\'s own fonts';
export const NO_STYLE = 'No image style recorded';
export const NO_REFERENCES = 'No reference images';
export const FONTS_NOTE = 'Google Fonts under the Open Font Licence';
export const APPLY_BRAND = 'Apply brand';
export const ONE_STEP = 'One undo step';
export const APPLY_NO_KIT = 'Record a logo, a palette or a font pair first, then apply it.';
export const KIT_SAVED = 'Brand kit saved.';

const str = (v) => (v == null ? '' : String(v).trim());
const HEX = /^#[0-9a-f]{6}$/i;

/** The kit, or null, from the sheet's read (`{ status, data }`). */
export const kitOf = (read) => (read?.status === 'ok' ? read.data?.kit ?? null : null);
/** The lists the sheet picks from, from the same read; empty until it is read. */
export const choicesOf = (read) => {
  const c = read?.status === 'ok' ? read.data?.choices : null;
  return {
    fonts: Array.isArray(c?.fonts) ? c.fonts : [],
    imageStyles: Array.isArray(c?.image_styles) ? c.image_styles : [],
    roles: Array.isArray(c?.palette_roles) ? c.palette_roles : [],
    libraryMax: Number.isInteger(c?.library_max) ? c.library_max : 0,
    referencesMax: Number.isInteger(c?.references_max) ? c.references_max : 0,
  };
};

/** pd7's five swatches, each `{ role, label, hex }`, and whether any is recorded. */
export function swatchesOf(kit) {
  const roles = Array.isArray(kit?.roles) ? kit.roles : [];
  const swatches = roles.slice(0, 5).map((r) => ({ role: r.role, label: str(r.label) || r.role, hex: HEX.test(str(r.hex)) ? str(r.hex).toLowerCase() : null }));
  return { swatches, recorded: swatches.some((s) => s.hex) };
}

/** "Fraunces · Inter", or the line for none. */
export const fontPairLine = (kit) => (kit?.font_pair ? `${kit.font_pair.heading.family} · ${kit.font_pair.body.family}` : NO_FONTS);

/** The image style's label, from the read's choices, or the line for none. */
export function imageStyleLine(kit, choices) {
  if (!kit?.image_style) return NO_STYLE;
  return choices.imageStyles.find((s) => s.id === kit.image_style)?.label || kit.image_style;
}

/** The sheet's draft of the kit, from the kit as read (or an empty one for a venture with none). */
export function draftOf(kit) {
  const palette = {};
  for (const r of Array.isArray(kit?.roles) ? kit.roles : []) palette[r.role] = HEX.test(str(r.hex)) ? str(r.hex).toLowerCase() : '';
  return {
    heading: kit?.font_pair?.heading?.family || '',
    body: kit?.font_pair?.body?.family || '',
    logo_url: str(kit?.logo?.light),
    palette,
    image_style: kit?.image_style || '',
    library: (Array.isArray(kit?.library) ? kit.library : []).map((i) => ({ url: str(i.url), alt: str(i.alt), reference: i.reference === true })),
  };
}

/** What is wrong with a draft, as a sentence, or null. The Worker checks again; this only saves a round trip. */
export function draftProblem(d, choices) {
  if (Boolean(d.heading) !== Boolean(d.body)) return 'Pick both fonts, or neither.';
  for (const [role, v] of Object.entries(d.palette || {})) {
    if (str(v) && !HEX.test(str(v))) return `${choices.roles.find((r) => r.role === role)?.label || role} must be a colour like #1a2b3c.`;
  }
  if (choices.referencesMax && d.library.filter((i) => i.reference).length > choices.referencesMax) return `Pick at most ${choices.referencesMax} reference images.`;
  if (choices.libraryMax && d.library.length > choices.libraryMax) return `The image library holds at most ${choices.libraryMax} images.`;
  return null;
}

/** The `PUT /api/decks/brand-kit` body for a draft: the whole kit, empty fields cleared. */
export function saveBody(d) {
  const palette = {};
  for (const [role, v] of Object.entries(d.palette || {})) if (str(v)) palette[role] = str(v).toLowerCase();
  return {
    fonts: d.heading && d.body ? { heading: d.heading, body: d.body } : null,
    logo_url: str(d.logo_url) || null,
    palette,
    image_style: d.image_style || null,
    library: d.library.filter((i) => str(i.url)).map((i) => ({ url: str(i.url), ...(str(i.alt) ? { alt: str(i.alt) } : {}), reference: i.reference === true })),
  };
}

/** A library image flipped in or out of the references, unless that would pass the cap. */
export function flipReference(d, index, max) {
  const lib = d.library.map((i, j) => (j === index ? { ...i, reference: !i.reference } : i));
  if (max && lib.filter((i) => i.reference).length > max) return d;
  return { ...d, library: lib };
}

/**
 * Apply brand's answer as the editor's ONE op: the cards and the theme
 * together (`setDoc`), so the history keeps one step and one Undo puts both
 * back. Null when the answer carries no deck.
 */
export function applyOps(reply) {
  if (!reply || !Array.isArray(reply.cards) || !reply.theme) return null;
  return { type: 'setDoc', parts: { cards: reply.cards, theme: reply.theme } };
}

/** "Applied your brand to 12 cards · one undo step." */
export function appliedLine(reply) {
  const n = Number(reply?.changed);
  const cards = Number.isInteger(n) && n > 0 ? `${n} card${n === 1 ? '' : 's'} restyled` : 'the theme applied; no card needed restyling';
  return `${APPLY_BRAND}: ${cards}. ${ONE_STEP}: Undo puts it back.`;
}
