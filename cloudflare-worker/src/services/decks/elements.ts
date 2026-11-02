/**
 * D1541 (#3779, deck v2 B3) — the elements library: icons, shapes, dividers
 * and procedural textures a card's decor draws, and the SVG sanitiser every
 * drawn element passes.
 *
 * ICONS are Lucide (`iconSet.json`, written by `scripts/gen-deck-icon-set.mjs`
 * from the installed lucide-react): 1,877 line icons under ISC, the set's
 * licence text and its Feather notice recorded with it. An icon decor item
 * carries `{ set, version, spdx }` (`ICON_LICENCE`), so the licence travels
 * with the block into every export.
 *
 * SHAPES, DIVIDERS and TEXTURES are drawn here from parameters: no file, no
 * third-party art. A texture is procedural (dots, grid, diagonal, cross,
 * waves, noise from a seed), so the same item always draws the same SVG.
 *
 * THE SANITISER (`sanitizeSvg`) is the one gate for any SVG a card holds:
 * only the drawing elements and attributes listed below, and it refuses
 * `script`, `foreignObject`, any `href` (and `xlink:`), event handlers,
 * `javascript:`, entities, `<style>`, and a `url()` that is not a local `#id`.
 * Phase 2's generated icons (`grid_icon`) will pass through it too.
 *
 * Pure: no binding, no fetch.
 */
import iconData from './iconSet.json';

export const MAX_DECOR = 16;
export const SEGMENTS = ['icons', 'shapes', 'dividers', 'textures'] as const;
export type Segment = typeof SEGMENTS[number];
export const DECOR_KINDS = ['icon', 'shape', 'divider', 'texture'] as const;
export type DecorKind = typeof DECOR_KINDS[number];

type Node = [string, Record<string, string | number>];
const SET = (iconData as any).set as { id: string; name: string; version: string; spdx: string; url: string; copyright: string; derived: string; licence_text: string };
const ICONS = (iconData as any).icons as Record<string, Node[]>;
const ICON_NAMES: readonly string[] = Object.freeze(Object.keys(ICONS));

/** What an icon decor item records: the set, its version and its licence. */
export const ICON_LICENCE = Object.freeze({ set: SET.id, version: SET.version, spdx: SET.spdx });
/** The licence record the panel's "Open licence · recorded" names. */
export const LICENCE_RECORD = Object.freeze({
  id: SET.id, name: SET.name, version: SET.version, spdx: SET.spdx, url: SET.url, copyright: SET.copyright, derived: SET.derived,
});
export const licenceText = () => SET.licence_text;
export const iconCount = () => ICON_NAMES.length;
export const isIcon = (name: unknown): name is string => typeof name === 'string' && Object.hasOwn(ICONS, name);

// ── Tones ───────────────────────────────────────────────────────────────────
// A decor item names a theme tone, never a colour: the theme's own tokens fill it.
export const TONES = ['ink', 'accent', 'muted', 'surface'] as const;
export type Tone = typeof TONES[number];
export const toneOf = (v: unknown): Tone => ((TONES as readonly string[]).includes(String(v)) ? v as Tone : 'ink');
const VAR = (t: Tone) => `var(--deck-${t})`;

// ── The sanitiser ───────────────────────────────────────────────────────────

const TAGS = new Set(['svg', 'g', 'path', 'circle', 'rect', 'line', 'ellipse', 'polyline', 'polygon', 'defs', 'pattern', 'title']);
const ATTRS = new Set([
  'xmlns', 'viewbox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points',
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity', 'fill-opacity',
  'stroke-opacity', 'transform', 'id', 'patternunits', 'preserveaspectratio', 'role', 'aria-hidden', 'class',
]);
export type SvgCheck = { ok: true; svg: string } | { ok: false; reason: string };
const BAD: Array<[RegExp, string]> = [
  [/<\s*script/i, 'script'],
  [/<\s*foreignobject/i, 'foreignObject'],
  [/\bhref\s*=|xlink\s*:/i, 'href'],
  [/\son[a-z]+\s*=/i, 'event handler'],
  [/javascript\s*:/i, 'javascript: URL'],
  [/<!\s*(entity|doctype)|&[a-z0-9#]+;/i, 'entity'],
  [/<\s*style/i, 'style'],
  [/url\(\s*['"]?\s*(?!#[A-Za-z][\w-]*\s*['"]?\s*\))/i, 'external url()'],
];

/** The one gate for a card's SVG: the listed elements and attributes only, and none of `BAD`. */
export function sanitizeSvg(raw: unknown): SvgCheck {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 64_000) return { ok: false, reason: 'not an SVG' };
  for (const [re, why] of BAD) if (re.test(raw)) return { ok: false, reason: why };
  const svg = raw.trim();
  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) return { ok: false, reason: 'not an SVG' };
  for (const m of svg.matchAll(/<\s*\/?\s*([A-Za-z][\w:.-]*)([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    if (!TAGS.has(tag)) return { ok: false, reason: `the ${m[1]} element` };
    for (const a of m[2].matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*("[^"]*"|'[^']*')/g)) {
      if (!ATTRS.has(a[1].toLowerCase())) return { ok: false, reason: `the ${a[1]} attribute` };
    }
  }
  if (/<\s*!|<\s*\?/.test(svg)) return { ok: false, reason: 'markup that is not drawing' };
  return { ok: true, svg };
}

const esc = (v: string | number) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const attrs = (o: Record<string, string | number>) => Object.entries(o).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
/** Every SVG this file draws passes the sanitiser; a failure is a bug, so it throws. */
const checked = (svg: string): string => {
  const r = sanitizeSvg(svg);
  if (!r.ok) throw new Error(`elements: a drawn SVG failed the sanitiser (${r.reason})`);
  return r.svg;
};

// ── Icons ───────────────────────────────────────────────────────────────────

export function iconSvg(name: string, tone: Tone = 'ink'): string | null {
  const nodes = ICONS[name];
  if (!nodes) return null;
  const body = nodes.map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join('');
  return checked(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${VAR(tone)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`);
}

/** Icons by name, a search over the names' words, in the set's order. */
export function searchIcons(q: string, offset = 0, limit = 60): { total: number; names: string[] } {
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const hits = words.length ? ICON_NAMES.filter((n) => words.every((w) => n.includes(w))) : ICON_NAMES;
  const lim = Math.max(1, Math.min(120, Math.trunc(limit) || 60));
  const off = Math.max(0, Math.trunc(offset) || 0);
  return { total: hits.length, names: hits.slice(off, off + lim) };
}

// ── Shapes, dividers and textures ───────────────────────────────────────────

type Drawn = { id: string; label: string };
const svgOf = (viewBox: string, body: string, ratio = 'xMidYMid meet') =>
  checked(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="${ratio}" aria-hidden="true">${body}</svg>`);

const SHAPE_BODIES: Record<string, { label: string; draw: (f: string) => string }> = {
  rect: { label: 'Rectangle', draw: (f) => `<rect x="2" y="2" width="96" height="96" fill="${f}"/>` },
  rounded: { label: 'Rounded rectangle', draw: (f) => `<rect x="2" y="2" width="96" height="96" rx="16" fill="${f}"/>` },
  circle: { label: 'Circle', draw: (f) => `<circle cx="50" cy="50" r="48" fill="${f}"/>` },
  pill: { label: 'Pill', draw: (f) => `<rect x="2" y="30" width="96" height="40" rx="20" fill="${f}"/>` },
  triangle: { label: 'Triangle', draw: (f) => `<polygon points="50,4 96,96 4,96" fill="${f}"/>` },
  diamond: { label: 'Diamond', draw: (f) => `<polygon points="50,2 98,50 50,98 2,50" fill="${f}"/>` },
  arrow: { label: 'Arrow', draw: (f) => `<polygon points="2,38 64,38 64,18 98,50 64,82 64,62 2,62" fill="${f}"/>` },
  chevron: { label: 'Chevron', draw: (f) => `<polygon points="2,2 66,2 98,50 66,98 2,98 34,50" fill="${f}"/>` },
  ring: { label: 'Ring', draw: (f) => `<circle cx="50" cy="50" r="42" fill="none" stroke="${f}" stroke-width="10"/>` },
  corner: { label: 'Corner bracket', draw: (f) => `<path d="M4 40 V4 H40" fill="none" stroke="${f}" stroke-width="8"/>` },
};
export const SHAPES: readonly Drawn[] = Object.freeze(Object.entries(SHAPE_BODIES).map(([id, s]) => ({ id, label: s.label })));

const DIVIDER_BODIES: Record<string, { label: string; draw: (f: string) => string }> = {
  line: { label: 'Line', draw: (f) => `<line x1="0" y1="10" x2="400" y2="10" stroke="${f}" stroke-width="2"/>` },
  double: { label: 'Double line', draw: (f) => `<line x1="0" y1="7" x2="400" y2="7" stroke="${f}" stroke-width="2"/><line x1="0" y1="13" x2="400" y2="13" stroke="${f}" stroke-width="2"/>` },
  dashed: { label: 'Dashed', draw: (f) => `<line x1="0" y1="10" x2="400" y2="10" stroke="${f}" stroke-width="2" stroke-dasharray="12 8"/>` },
  dotted: { label: 'Dotted', draw: (f) => `<line x1="2" y1="10" x2="398" y2="10" stroke="${f}" stroke-width="4" stroke-linecap="round" stroke-dasharray="0 12"/>` },
  wave: { label: 'Wave', draw: (f) => `<path d="M0 10 ${Array.from({ length: 10 }, (_, i) => `Q ${i * 40 + 10} ${i % 2 ? 18 : 2} ${i * 40 + 20} 10 T ${i * 40 + 40} 10`).join(' ')}" fill="none" stroke="${f}" stroke-width="2"/>` },
  zigzag: { label: 'Zigzag', draw: (f) => `<polyline points="${Array.from({ length: 41 }, (_, i) => `${i * 10},${i % 2 ? 4 : 16}`).join(' ')}" fill="none" stroke="${f}" stroke-width="2"/>` },
  accent: { label: 'Accent bar', draw: (f) => `<rect x="0" y="6" width="64" height="8" rx="4" fill="${f}"/>` },
};
export const DIVIDERS: readonly Drawn[] = Object.freeze(Object.entries(DIVIDER_BODIES).map(([id, s]) => ({ id, label: s.label })));

/** A small seeded generator, so a texture draws the same every time. */
function rng(seed: number) {
  let s = (Math.trunc(seed) >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const TEXTURE_BODIES: Record<string, { label: string; draw: (f: string, seed: number) => string }> = {
  dots: { label: 'Dots', draw: (f) => `<defs><pattern id="t" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="1.5" fill="${f}"/></pattern></defs><rect width="400" height="240" fill="url(#t)"/>` },
  grid: { label: 'Grid', draw: (f) => `<defs><pattern id="t" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0 H0 V24" fill="none" stroke="${f}" stroke-width="1"/></pattern></defs><rect width="400" height="240" fill="url(#t)"/>` },
  diagonal: { label: 'Diagonal lines', draw: (f) => `<defs><pattern id="t" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M0 12 L12 0" stroke="${f}" stroke-width="1"/></pattern></defs><rect width="400" height="240" fill="url(#t)"/>` },
  cross: { label: 'Crosses', draw: (f) => `<defs><pattern id="t" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M10 6 V14 M6 10 H14" stroke="${f}" stroke-width="1"/></pattern></defs><rect width="400" height="240" fill="url(#t)"/>` },
  waves: { label: 'Waves', draw: (f) => Array.from({ length: 8 }, (_, r) => `<path d="M0 ${r * 30 + 15} ${Array.from({ length: 10 }, (_, i) => `Q ${i * 40 + 10} ${r * 30 + (i % 2 ? 24 : 6)} ${i * 40 + 20} ${r * 30 + 15} T ${i * 40 + 40} ${r * 30 + 15}`).join(' ')}" fill="none" stroke="${f}" stroke-width="1"/>`).join('') },
  noise: {
    label: 'Grain', draw: (f, seed) => {
      const next = rng(seed);
      return Array.from({ length: 240 }, () => `<circle cx="${(next() * 400).toFixed(1)}" cy="${(next() * 240).toFixed(1)}" r="${(0.6 + next()).toFixed(2)}" fill="${f}"/>`).join('');
    },
  },
};
export const TEXTURES: readonly Drawn[] = Object.freeze(Object.entries(TEXTURE_BODIES).map(([id, s]) => ({ id, label: s.label })));

const REFS: Record<Exclude<DecorKind, 'icon'>, Record<string, unknown>> = { shape: SHAPE_BODIES, divider: DIVIDER_BODIES, texture: TEXTURE_BODIES };

/** Whether `ref` names an item of `kind`. */
export function isRef(kind: string, ref: unknown): boolean {
  if (typeof ref !== 'string') return false;
  if (kind === 'icon') return isIcon(ref);
  const table = (REFS as Record<string, Record<string, unknown>>)[kind];
  return !!table && Object.hasOwn(table, ref);
}

/** The SVG a decor item draws, through the sanitiser; null for an unknown item. */
export function decorSvg(item: { kind: string; ref?: string; tone?: string; seed?: number }): string | null {
  const tone = toneOf(item.tone);
  const f = VAR(tone);
  if (item.kind === 'icon') return item.ref ? iconSvg(item.ref, tone) : null;
  if (!item.ref || !isRef(item.kind, item.ref)) return null;
  if (item.kind === 'shape') return svgOf('0 0 100 100', SHAPE_BODIES[item.ref].draw(f));
  if (item.kind === 'divider') return svgOf('0 0 400 20', DIVIDER_BODIES[item.ref].draw(f), 'none');
  if (item.kind === 'texture') return svgOf('0 0 400 240', TEXTURE_BODIES[item.ref].draw(f, Number(item.seed) || 1), 'xMidYMid slice');
  return null;
}

/**
 * A decor item as a card stores it: a known kind and ref, a tone, and for an
 * icon its licence, set here and never taken from the client. Null for an
 * item the library cannot draw. A kind outside the library (D1500's earlier
 * free kinds) is the caller's to keep as it was.
 */
export function cleanDecorItem(raw: any): { kind: DecorKind; ref: string; tone: Tone; seed?: number; licence?: typeof ICON_LICENCE } | null {
  const kind = String(raw?.kind ?? '');
  if (!(DECOR_KINDS as readonly string[]).includes(kind) || !isRef(kind, raw?.ref)) return null;
  const out: { kind: DecorKind; ref: string; tone: Tone; seed?: number; licence?: typeof ICON_LICENCE } = { kind: kind as DecorKind, ref: raw.ref, tone: toneOf(raw?.tone) };
  if (kind === 'texture' && Number.isSafeInteger(raw?.seed) && raw.seed > 0) out.seed = raw.seed;
  if (kind === 'icon') out.licence = ICON_LICENCE;
  return out;
}
