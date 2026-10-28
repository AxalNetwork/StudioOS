/**
 * D903 (#2682, part 9 of #2434): pure words and derivations of the image
 * lightbox (PD12, PD12b, PD12c, PD12e) and the placed image (PD12d).
 *
 * The overlay's contrast is the Worker's rule (`services/decks/images.ts`,
 * `overlayContrast`), so the lightbox greys "Keep as background" exactly when
 * the Worker would refuse it: the worst case, the overlay in the brand ink
 * over a white pixel, against the background's light text, must reach 4.5:1.
 */
import { addBlock, firstFree } from './editorModel';
import { aiTokens } from './newDeckModel';
import { CONTRAST_MIN, DEFAULT_INK, OVERLAY_ALPHA, inkChannels, overlayContrast } from './imageContrast.js';

export { BACKGROUND_TEXT, CONTRAST_MIN, DEFAULT_INK, OVERLAY_ALPHA, overlayContrast } from './imageContrast.js';

export const USE_OPTIONS = Object.freeze([['content', 'Content image'], ['card', 'Card background'], ['deck', 'Deck background']]);
export const USE_LINES = Object.freeze({
  content: 'Placed on the card as an image, tagged Illustration. An image never replaces a chart.',
  card: 'Behind this card’s content, with an overlay in your brand ink so text keeps 4.5:1.',
  deck: 'Behind every card, set in the theme. Cards with a chart keep a solid panel behind the chart.',
});
export const STYLE_OPTIONS = Object.freeze([['line', 'Line'], ['isometric', 'Isometric'], ['flat', 'Flat'], ['scene', 'Scene'], ['diagram', 'Diagram']]);
export const PALETTE_OPTIONS = Object.freeze([['brand', 'Brand'], ['neutral', 'Neutral']]);
export const ASPECT_OPTIONS = Object.freeze(['16:9', '4:3', '1:1', '3:4']);
export const OVERLAY_OPTIONS = Object.freeze([['none', 'None'], ['light', 'Light'], ['strong', 'Strong']]);
export const COUNT_OPTIONS = Object.freeze([1, 2, 3, 4]);
export const FIT_OPTIONS = Object.freeze([['cover', 'Fill the range'], ['contain', 'Show it whole']]);

export const REAL_PERSON = 'Eadwyn does not draw real people. Upload a photo the person agreed to share.';
export const FIGURES_LINE = 'Text points shape the description; image points go to the model as references. Figures stay in charts and never go into an image.';
export const NO_REFERENCES = 'FLUX.1 Schnell takes no reference images, so image points cannot be chosen. A team photo goes in as an upload.';
export const CONSENT_LINE = 'This photo shows a person, and they agreed to share it.';
export const ALT_HELP = 'Alt text travels with every export: the share link, present mode, PDF and PowerPoint.';

/** PD12b, PD12c: the contrast check's line. A content image needs none. */
export function contrastLine(use, overlay, ink) {
  if (use === 'content') return null;
  const ratio = overlayContrast(overlay, ink);
  const ok = ratio >= CONTRAST_MIN;
  return { ratio, ok, figure: `${ratio.toFixed(1)}:1`, text: ok ? 'Readable' : 'Too low. Keep waits until the text reaches 4.5:1.' };
}

export const imageTag = (use) => (use === 'content' ? 'Illustration' : 'Illustration · Background');
export const keepLabel = (use) => (use === 'content' ? 'Keep' : 'Keep as background');

/**
 * PD12: the description, prefilled from the card: its heading, then its first
 * paragraph. A sentence with a figure is left out (figures never go into an
 * image, and the Worker refuses one).
 */
export function defaultDescription(card) {
  const blocks = Array.isArray(card?.blocks) ? card.blocks : [];
  const heading = blocks.find((b) => b?.kind === 'text' && b.style === 'heading')?.text || card?.title || '';
  const para = blocks.find((b) => b?.kind === 'text' && b.style !== 'heading')?.text || '';
  // Retain the separator punctuation before trimming, just as the old split did.
  const parts = `${heading}. ${para}`.split(/([.!?])\s+/);
  const sentences = [];
  for (let i = 0; i < parts.length; i += 2) {
    const sentence = (parts[i] + (parts[i + 1] || '')).trim().replace(/[.!?]+$/, '');
    if (sentence && !/\d/.test(sentence)) sentences.push(sentence);
  }
  return sentences.join('. ').slice(0, 400);
}

/** PD12: the cost line. It names the model and the total; the balance is the Worker's word. */
export function costLine(quote) {
  if (!quote) return 'Pricing…';
  if (quote.ai === false) return quote.message || 'AI assistance is off on this page.';
  const per = aiTokens(quote.per_image_microusd);
  const total = aiTokens(quote.total_microusd);
  if (!per || !total) return `${quote.model_label || 'The image model'} · Price not recorded`;
  return `${quote.model_label} · ${quote.count} × ${per} = ${total}${quote.balance?.ok === false ? '' : ' · covered by your AI tokens'}`;
}

/** PD12d: the line under a placed image: the model, the day and the cost, or that it was uploaded. */
export function placedLine(image) {
  if (!image) return null;
  const when = (() => {
    const d = new Date(typeof image.created_at === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(image.created_at) ? `${image.created_at.replace(' ', 'T')}Z` : image.created_at || NaN);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  })();
  if (image.source === 'upload') return `Uploaded${when ? ` ${when}` : ''}${image.shows_person ? ' · the person’s agreement recorded' : ''}`;
  const cost = image.charged_microusd == null ? 'cost not recorded' : aiTokens(image.charged_microusd);
  return `${image.model_label || 'Generated'} · generated${when ? ` ${when}` : ''} · ${cost}`;
}

/** The body a press sends: what the Worker reads (`askOf`). */
export function askBody({ use, description, style, palette, aspect, count, card, points = [], colours = [] }) {
  return { use, description: String(description || '').trim(), style, palette, aspect, count, ...(card == null ? {} : { card }), points, colours };
}

/**
 * Where a kept image goes: a content image as a block on the card (6 × 4
 * where it fits, else 4 × 3), a card background on the card, the deck
 * background in the theme. Returns the new card and theme, or why not.
 */
export function placeImage({ card, theme, model }, image, use) {
  const url = image?.url;
  if (!url) return { error: 'The image has no address to place.' };
  if (use === 'card') return { card: { ...card, background: { color: null, image_url: url, image_id: image.uid, overlay: image.overlay || 'light' } }, theme };
  if (use === 'deck') return { card, theme: { ...(theme || { kind: 'brand' }), background: { color: null, image_url: url, image_id: image.uid, overlay: image.overlay || 'light' } } };
  const big = firstFree(card, 6, 4, model);
  const at = big || firstFree(card, 4, 3, model);
  if (!at) return { error: 'This card has no free 4 × 3 range for an image. Remove or resize a block first.' };
  const [cols, rows] = big ? [6, 4] : [4, 3];
  const grid = { c1: at.c1, r1: at.r1, c2: at.c1 + cols - 1, r2: at.r1 + rows - 1 };
  const r = addBlock(card, { kind: 'image', grid, image_url: url, image_id: image.uid, alt: image.alt || '', tag: image.source === 'upload' ? 'photo' : 'illustration', fit: 'cover', crop: { x: 50, y: 50 } }, model);
  return r.error ? { error: r.error } : { card: r.card, theme, block: r.card.blocks[r.card.blocks.length - 1] };
}

/** The overlay drawn over a background image, in the brand ink. */
export function overlayStyle(overlay, ink) {
  const a = OVERLAY_ALPHA[overlay] ?? 0;
  if (!a) return null;
  const [r, g, b] = inkChannels(ink || DEFAULT_INK);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export { objectPosition } from './presentExportModel';
