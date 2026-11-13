/**
 * D1534 (#3778 phase 1, deck v2 B2) — an image block's crop and filter, as
 * one rule every renderer reads, so an edited image looks the same in the
 * editor, the print page (which the PDF and the PowerPoint download are taken
 * from) and the editable PowerPoint (`pptxEditable.ts`).
 *
 * THE CROP is the image's FOCUS POINT (`x`, `y`, D903: the point that stays in
 * view when the image covers its range), and optionally a ZOOM WINDOW
 * (`rect: { x, y, w, h }`, in percent of the block's own frame). The window
 * keeps the block's aspect ("Aspect locked"), so `h` is always `w`: the
 * picture is never stretched. `w` runs from 10 (ten times closer) to 100
 * (the whole frame, the same as no window), and the window stays inside the
 * frame. A block shown whole (`fit: 'contain'`) has no window.
 *
 * THE FILTER is one of eight presets. Each preset is the same four numbers
 * for every renderer — saturation, brightness and contrast as a change from 1,
 * and grayscale — plus an optional colour wash drawn over the picture at an
 * alpha (the brand tint washes in the deck's own ink). The browser applies
 * them as a CSS filter and an overlay; PowerPoint as the picture's own
 * `<a:hsl>`, `<a:lum>` and `<a:grayscl>` and a filled rectangle over it.
 *
 * `frontend/src/pages/raise/pitch/imageLook.js` holds the same table;
 * `deck_image_look_d1534.test.ts` fails when the two differ.
 */

export const FILTERS = ['original', 'warm', 'cool', 'mono', 'soft', 'vivid', 'fade', 'brand'] as const;
export type FilterKey = typeof FILTERS[number];

export type FilterSpec = { saturate: number; brightness: number; contrast: number; grayscale: boolean; wash: { colour: string | 'brand'; alpha: number } | null };

export const FILTER_SPECS: Readonly<Record<FilterKey, FilterSpec>> = Object.freeze({
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
export type CropRect = { x: number; y: number; w: number; h: number };
export type Crop = { x: number; y: number; rect?: CropRect };

const pct = (v: unknown, lo = 0, hi = 100): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v)) * 10) / 10 : null);

/** A stored zoom window, made whole: `h = w`, at least `ZOOM_MIN_W`, inside the frame; null for none, or the whole frame. */
export function rectOf(v: any): CropRect | null {
  if (!v || typeof v !== 'object') return null;
  const w = pct(v.w, ZOOM_MIN_W, 100);
  if (w === null || w >= 100) return null;
  const x = pct(v.x, 0, 100 - w), y = pct(v.y, 0, 100 - w);
  if (x === null || y === null) return null;
  return { x, y, w, h: w };
}

export const filterOf = (v: unknown): FilterKey | null => (typeof v === 'string' && (FILTERS as readonly string[]).includes(v) && v !== 'original' ? v as FilterKey : null);

/** The wash's colour for a deck: the brand tint takes the deck's ink, a `#RRGGBB`. */
export function washColour(spec: FilterSpec, brandInk: string | null | undefined): string | null {
  if (!spec.wash) return null;
  if (spec.wash.colour !== 'brand') return spec.wash.colour;
  return /^#[0-9a-fA-F]{6}$/.test(String(brandInk ?? '')) ? String(brandInk).toUpperCase() : '#5B21B6';
}

/**
 * The part of the SOURCE image that shows, as fractions of its width and
 * height: the cover fit at the focus point (CSS `object-fit: cover` with
 * `object-position: x% y%`), then the zoom window inside it. `box` and `img`
 * are pixel sizes. With `fit: 'contain'` the whole image shows.
 */
export function visibleSource(crop: Crop | null | undefined, fit: string | null | undefined, box: { w: number; h: number }, img: { w: number; h: number }):
  { l: number; t: number; w: number; h: number } {
  if (fit === 'contain' || !(box.w > 0 && box.h > 0 && img.w > 0 && img.h > 0)) return { l: 0, t: 0, w: 1, h: 1 };
  const fx = (crop?.x ?? 50) / 100, fy = (crop?.y ?? 50) / 100;
  const B = box.w / box.h, I = img.w / img.h;
  const fw = I > B ? B / I : 1, fh = I > B ? 1 : I / B;
  let l = (1 - fw) * fx, t = (1 - fh) * fy, w = fw, h = fh;
  const r = crop?.rect ? rectOf(crop.rect) : null;
  if (r) { l += w * r.x / 100; t += h * r.y / 100; w = w * r.w / 100; h = h * r.h / 100; }
  return { l, t, w, h };
}

/** DrawingML's `<a:srcRect>` for that window (thousandths of a percent from each edge); '' when the whole image shows. */
export function srcRectXml(v: { l: number; t: number; w: number; h: number }): string {
  const k = (n: number) => Math.round(Math.max(0, n) * 100_000);
  const l = k(v.l), t = k(v.t), r = k(1 - v.l - v.w), b = k(1 - v.t - v.h);
  return l || t || r || b ? `<a:srcRect l="${l}" t="${t}" r="${r}" b="${b}"/>` : '';
}

/** The filter as the blip's own effects, inside `<a:blip>`. */
export function blipEffectsXml(filter: FilterKey | null | undefined): string {
  const s = FILTER_SPECS[filter ?? 'original'] ?? FILTER_SPECS.original;
  const out: string[] = [];
  if (s.grayscale) out.push('<a:grayscl/>');
  if (s.saturate) out.push(`<a:hsl hue="0" sat="${Math.round(s.saturate * 100_000)}" lum="0"/>`);
  if (s.brightness || s.contrast) out.push(`<a:lum bright="${Math.round(s.brightness * 100_000)}" contrast="${Math.round(s.contrast * 100_000)}"/>`);
  return out.join('');
}

/** The filter as CSS, for the browser renderers; '' for none. */
export function cssFilter(filter: FilterKey | null | undefined): string {
  const s = FILTER_SPECS[filter ?? 'original'] ?? FILTER_SPECS.original;
  const out: string[] = [];
  if (s.grayscale) out.push('grayscale(1)');
  if (s.saturate) out.push(`saturate(${1 + s.saturate})`);
  if (s.brightness) out.push(`brightness(${1 + s.brightness})`);
  if (s.contrast) out.push(`contrast(${1 + s.contrast})`);
  return out.join(' ');
}
