/**
 * D1534 (#3778 phase 1, deck v2 B2) — an image block's crop and filter in the
 * browser: the editor, Present and the print page (which the PDF and the
 * PowerPoint download are taken from) all draw a placed image through
 * `imageLookStyle`. The table and the rules are the Worker's
 * (`cloudflare-worker/src/services/decks/imageLook.ts`), which the editable
 * PowerPoint reads; `deck_image_look_d1534.test.ts` fails when the two differ.
 *
 * The crop is the focus point (`x`, `y`) and an optional zoom window
 * (`rect: { x, y, w, h }`, percent of the block's frame, `h = w`: aspect
 * locked, never stretched). The filter is one of eight presets.
 */
import { DEFAULT_INK } from './imageContrast.js';

export const FILTERS = Object.freeze(['original', 'warm', 'cool', 'mono', 'soft', 'vivid', 'fade', 'brand']);
export const FILTER_WORDS = Object.freeze({
  original: 'Original', warm: 'Warm', cool: 'Cool', mono: 'Mono', soft: 'Soft', vivid: 'Vivid', fade: 'Fade', brand: 'Brand tint',
});
export const FILTER_SPECS = Object.freeze({
  original: { saturate: 0, brightness: 0, contrast: 0, grayscale: false, wash: null },
  warm: { saturate: 0.1, brightness: 0, contrast: 0, grayscale: false, wash: { colour: '#F59E0B', alpha: 0.12 } },
  cool: { saturate: 0, brightness: 0, contrast: 0, grayscale: false, wash: { colour: '#3B82F6', alpha: 0.12 } },
  mono: { saturate: 0, brightness: 0, contrast: 0, grayscale: true, wash: null },
  soft: { saturate: 0, brightness: 0.05, contrast: -0.15, grayscale: false, wash: null },
  vivid: { saturate: 0.3, brightness: 0, contrast: 0.1, grayscale: false, wash: null },
  fade: { saturate: -0.2, brightness: 0.1, contrast: -0.25, grayscale: false, wash: null },
  brand: { saturate: 0, brightness: 0, contrast: 0, grayscale: false, wash: { colour: 'brand', alpha: 0.18 } },
});
export const ZOOM_MIN_W = 10;

/** pd27's words. */
export const CROP_WORDS = Object.freeze({
  aspect: 'Aspect locked · 16:9',
  replaceKeeps: 'Replace image keeps the crop.',
  altNeeded: 'Alt text is needed before this image can be inserted',
  comingLater: 'COMING LATER',
});
/** pd27's "Coming later" list: B8's generative edits and phase 2's models, each greyed. */
export const COMING_LATER = Object.freeze(['Erase', 'Expand', 'Vary', 'Remove background', 'Upscale']);

const pct = (v, lo = 0, hi = 100) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v)) * 10) / 10 : null);

/** A zoom window made whole: `h = w`, at least `ZOOM_MIN_W`, inside the frame; null for none or the whole frame. */
export function rectOf(v) {
  if (!v || typeof v !== 'object') return null;
  const w = pct(v.w, ZOOM_MIN_W, 100);
  if (w === null || w >= 100) return null;
  const x = pct(v.x, 0, 100 - w), y = pct(v.y, 0, 100 - w);
  if (x === null || y === null) return null;
  return { x, y, w, h: w };
}

export const filterOf = (v) => (typeof v === 'string' && FILTERS.includes(v) && v !== 'original' ? v : null);

export function washColour(spec, brandInk) {
  if (!spec?.wash) return null;
  if (spec.wash.colour !== 'brand') return spec.wash.colour;
  return /^#[0-9a-fA-F]{6}$/.test(String(brandInk ?? '')) ? String(brandInk).toUpperCase() : DEFAULT_INK.toUpperCase();
}

export function cssFilter(filter) {
  const s = FILTER_SPECS[filter || 'original'] || FILTER_SPECS.original;
  const out = [];
  if (s.grayscale) out.push('grayscale(1)');
  if (s.saturate) out.push(`saturate(${1 + s.saturate})`);
  if (s.brightness) out.push(`brightness(${1 + s.brightness})`);
  if (s.contrast) out.push(`contrast(${1 + s.contrast})`);
  return out.join(' ');
}

const hexRgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/**
 * How the browser draws a placed image: the <img>'s style (the cover fit at
 * the focus point, scaled and offset to the zoom window, and the filter) and
 * the wash over it (a colour at an alpha), or null.
 */
export function imageLookStyle(block, brandInk = DEFAULT_INK) {
  const contain = block?.fit === 'contain';
  const crop = block?.crop || {};
  const focus = Number.isFinite(crop.x) && Number.isFinite(crop.y) ? `${crop.x}% ${crop.y}%` : '50% 50%';
  const r = contain ? null : rectOf(crop.rect);
  const img = { objectFit: contain ? 'contain' : 'cover', objectPosition: focus };
  if (r) Object.assign(img, { position: 'absolute', width: `${(100 * 100) / r.w}%`, height: `${(100 * 100) / r.h}%`, left: `${(-100 * r.x) / r.w}%`, top: `${(-100 * r.y) / r.h}%`, maxWidth: 'none' });
  else Object.assign(img, { width: '100%', height: '100%' });
  const filter = filterOf(block?.filter);
  const css = cssFilter(filter);
  if (css) img.filter = css;
  const spec = FILTER_SPECS[filter || 'original'];
  const colour = washColour(spec, brandInk);
  return { img, wash: colour ? hexRgba(colour, spec.wash.alpha) : null, zoomed: !!r };
}

/** The crop after a zoom change: the window keeps its centre where it can, inside the frame. */
export function zoomTo(crop, w) {
  const base = crop || { x: 50, y: 50 };
  const old = rectOf(base.rect) || { x: 0, y: 0, w: 100, h: 100 };
  const nw = pct(w, ZOOM_MIN_W, 100);
  if (nw === null || nw >= 100) { const { rect, ...rest } = base; return rest; }
  const cx = old.x + old.w / 2, cy = old.y + old.h / 2;
  return { ...base, rect: rectOf({ x: cx - nw / 2, y: cy - nw / 2, w: nw }) };
}

/** The crop after a pan, in percent of the frame, kept inside it. */
export function panTo(crop, dx, dy) {
  const base = crop || { x: 50, y: 50 };
  const r = rectOf(base.rect);
  if (!r) return base;
  return { ...base, rect: rectOf({ x: r.x + dx, y: r.y + dy, w: r.w }) };
}

/** Replace keeps the crop: the new image takes the old block's place, crop, filter and fit; its own alt when it has one. */
export function keepLook(oldBlock, newBlock) {
  if (!oldBlock || oldBlock.kind !== 'image') return newBlock;
  const out = { ...newBlock, id: oldBlock.id, grid: oldBlock.grid };
  if (oldBlock.crop) out.crop = oldBlock.crop;
  if (oldBlock.fit) out.fit = oldBlock.fit;
  if (oldBlock.filter) out.filter = oldBlock.filter; else delete out.filter;
  if (!out.alt && oldBlock.alt) out.alt = oldBlock.alt;
  return out;
}
