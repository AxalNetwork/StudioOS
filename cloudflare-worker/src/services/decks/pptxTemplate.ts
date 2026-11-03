/**
 * D1572 (#3819, deck v2 D11) — a company's .pptx template, read into a theme
 * and its own layouts on The Grid (pd30, "Import a .pptx template").
 *
 * One shared module: #3810 reuses `readPptxZip` and `parseTemplate`.
 *
 * WHAT IS READ. Only what maps the layouts:
 *   - `ppt/presentation.xml`: the slide size;
 *   - the first theme (`ppt/theme/theme<n>.xml`): its colour scheme (dk1,
 *     lt1, accent1–3) and its major and minor Latin fonts;
 *   - each slide layout (`ppt/slideLayouts/slideLayout<n>.xml`): its name and
 *     its placeholders' boxes, a box the layout does not set taken from the
 *     slide master's placeholder of the same type.
 * No slide is opened, no text on a slide is read, and nothing here reaches a
 * model. A layout's name is the one piece of the file's text kept; when a
 * prompt ever names a saved layout it goes in through `layoutPromptLine`,
 * framed by `untrustedBlock('deck_import', …)` (D1506), never as an
 * instruction.
 *
 * THE MAPPING. Each box is scaled to the 1920 × 1080 card and each edge
 * snapped to the nearest line of The Grid (`designSystem.boxOf`'s 12 × 6
 * cells, margins 112 / 96 / 88, a 24 px gutter). An edge more than
 * `SNAP_TOLERANCE` of a cell pitch from every line sits between columns (or
 * rows), and the layout is listed with that reason, never forced onto cells.
 * Two areas that land on the same cell, or a layout with no box, are listed
 * too.
 *
 * THE THEME. The colours become the kit's palette roles (ground = lt1,
 * ink = dk1, accent = accent1, secondary = accent2, highlight = accent3). A
 * font is kept when it is one of `BRAND_FONTS` (Google Fonts under the OFL,
 * owner decision K); otherwise the nearest of the list stands in and the
 * report says so (`fallback: true`).
 *
 * LIMITS. A file of at most `TEMPLATE_MAX_BYTES`; each part read inflates to at
 * most `PART_MAX_BYTES`, so a zip bomb stops at the cap; at most
 * `LAYOUTS_MAX` layouts. Pure apart from `DecompressionStream`: no binding,
 * no fetch, nothing logged.
 */
import { CELL, FRAME, SLIDE } from './designSystem';
import { BRAND_FONTS, type BrandFont } from './brandFonts';
import { untrustedBlock } from '../ai/untrusted';

export const TEMPLATE_MAX_BYTES = 50 * 1024 * 1024;
export const PART_MAX_BYTES = 4 * 1024 * 1024;
export const LAYOUTS_MAX = 60;
/** How far an edge may sit from a grid line, as a share of a cell pitch, and still snap to it. */
export const SNAP_TOLERANCE = 0.3;

export const UNPLACED = Object.freeze({
  between_columns: 'A box sits between columns',
  between_rows: 'A box sits between rows',
  overlap: 'Two boxes share a cell',
  empty: 'The layout has no boxes to place',
});
export type UnplacedReason = keyof typeof UNPLACED;

export type AreaKind = 'heading' | 'text' | 'image' | 'chart' | 'table' | 'graphic';
export type TemplateArea = { kind: AreaKind; c1: number; c2: number; r1: number; r2: number };
export type TemplateLayout =
  | { name: string; placed: true; areas: TemplateArea[] }
  | { name: string; placed: false; reason: UnplacedReason; why: string };
export type TemplateFont = { role: 'display' | 'body'; found: string | null; use: BrandFont; fallback: boolean };
export type TemplateReport = {
  palette: { ground?: string; ink?: string; accent?: string; secondary?: string; highlight?: string };
  colours: Array<{ role: string; hex: string }>;
  fonts: TemplateFont[];
  layouts: TemplateLayout[];
  counts: { found: number; placed: number; not_placed: number };
};

export class TemplateError extends Error {
  code: 'not_a_pptx' | 'too_large' | 'unreadable';
  constructor(code: 'not_a_pptx' | 'too_large' | 'unreadable') { super(code); this.code = code; }
}

// ── the zip ──────────────────────────────────────────────────────────────────

type ZipPart = { name: string; read: () => Promise<Uint8Array> };

async function inflate(raw: Uint8Array, max: number): Promise<Uint8Array> {
  const reader = new Response(raw).body!.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); throw new TemplateError('too_large'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

/** The parts of a zip, each read (and inflated, capped) on demand. Throws `not_a_pptx` for anything else. */
export function readPptxZip(buf: Uint8Array, maxPart = PART_MAX_BYTES): ZipPart[] {
  if (buf.byteLength > TEMPLATE_MAX_BYTES) throw new TemplateError('too_large');
  const sig = (i: number, d: number) => buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === (d >> 8) && buf[i + 3] === (d & 0xff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) if (sig(i, 0x0506)) { eocd = i; break; }
  if (eocd < 0) throw new TemplateError('not_a_pptx');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const parts: ZipPart[] = [];
  for (let i = 0; i < count && p + 46 <= buf.length; i += 1) {
    if (!sig(p, 0x0102)) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const skip = nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + skip;
    parts.push({
      name,
      read: async () => {
        if (local + 30 > buf.length || !sig(local, 0x0304)) throw new TemplateError('unreadable');
        const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
        const raw = buf.subarray(start, Math.min(buf.length, start + size));
        if (method === 0) { if (raw.byteLength > maxPart) throw new TemplateError('too_large'); return raw.slice(); }
        if (method === 8) return inflate(raw, maxPart);
        throw new TemplateError('unreadable');
      },
    });
  }
  if (!parts.some((x) => x.name === 'ppt/presentation.xml')) throw new TemplateError('not_a_pptx');
  return parts;
}

// ── the XML, read with patterns: only the attributes named here ─────────────

/** The attributes this reader takes, each a literal pattern (no pattern is built from input). */
const ATTR = {
  x: /\sx="([^"]*)"/, y: /\sy="([^"]*)"/, cx: /\scx="([^"]*)"/, cy: /\scy="([^"]*)"/,
  val: /\sval="([^"]*)"/, lastClr: /\slastClr="([^"]*)"/, typeface: /\stypeface="([^"]*)"/,
  type: /\stype="([^"]*)"/, idx: /\sidx="([^"]*)"/, name: /\sname="([^"]*)"/,
} as const;
const attr = (tag: string, name: keyof typeof ATTR) => {
  const m = ATTR[name].exec(tag);
  return m ? m[1] : null;
};
const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const HEX = /^[0-9a-f]{6}$/i;

/** A layout's name: its `<p:cSld name>`, without control characters, at most 80 characters. */
export function cleanName(raw: string | null, fallback: string): string {
  const s = unescape(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return s || fallback;
}

/** The theme's colour scheme, each slot #rrggbb. */
export function themeColours(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const scheme = /<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/.exec(xml)?.[0] ?? '';
  // One element at a time by index, never a pattern built from a name.
  for (const slot of ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']) {
    const open = scheme.indexOf(`<a:${slot}>`);
    const close = open < 0 ? -1 : scheme.indexOf(`</a:${slot}>`, open);
    const body = open < 0 || close < 0 ? '' : scheme.slice(open + slot.length + 4, close);
    const srgb = /<a:srgbClr\b[^>]*>/.exec(body)?.[0];
    const sys = /<a:sysClr\b[^>]*>/.exec(body)?.[0];
    const v = (srgb && attr(srgb, 'val')) || (sys && attr(sys, 'lastClr'));
    if (v && HEX.test(v)) out[slot] = `#${v.toLowerCase()}`;
  }
  return out;
}

/** The theme's heading and body Latin typefaces. */
export function themeFonts(xml: string): { major: string | null; minor: string | null } {
  const face = (which: string) => {
    const open = xml.indexOf(`<a:${which}>`);
    const close = open < 0 ? -1 : xml.indexOf(`</a:${which}>`, open);
    const block = open < 0 || close < 0 ? '' : xml.slice(open + which.length + 4, close);
    const latin = /<a:latin\b[^>]*>/.exec(block)?.[0];
    const t = latin ? attr(latin, 'typeface') : null;
    return t ? cleanName(t, '') || null : null;
  };
  return { major: face('majorFont'), minor: face('minorFont') };
}

const SERIF = /serif|times|georgia|garamond|cambria|book|roman|baskerville|palatino|didot|lora|merriweather|playfair/i;

/** A font of the list: the face itself when offered, otherwise the nearest stand-in. */
export function fontOf(found: string | null, role: 'display' | 'body'): TemplateFont {
  const hit = BRAND_FONTS.find((f) => found && f.toLowerCase() === found.toLowerCase());
  if (hit) return { role, found, use: hit, fallback: false };
  const serif = found ? SERIF.test(found) && !/sans/i.test(found) : false;
  const use: BrandFont = serif ? (role === 'display' ? 'Playfair Display' : 'Source Serif 4') : (role === 'display' ? 'Space Grotesk' : 'Inter');
  return { role, found, use, fallback: true };
}

type Box = { x: number; y: number; w: number; h: number; kind: AreaKind; type: string; idx: string | null };

const SKIP = new Set(['dt', 'ftr', 'sldNum', 'hdr', 'sldImg']);
const KIND: Record<string, AreaKind> = { title: 'heading', ctrTitle: 'heading', subTitle: 'text', body: 'text', obj: 'text', pic: 'image', chart: 'chart', tbl: 'table', dgm: 'graphic', media: 'image', clipArt: 'image' };

/** Every placed shape of a layout or master: its box (EMU), what it holds and its placeholder type. */
export function shapesOf(xml: string): Box[] {
  const out: Box[] = [];
  const tree = /<p:spTree>([\s\S]*)<\/p:spTree>/.exec(xml)?.[1] ?? '';
  for (const m of tree.matchAll(/<p:(sp|pic|graphicFrame)>([\s\S]*?)<\/p:\1>/g)) {
    const [, tag, body] = m;
    const ph = /<p:ph\b[^>]*\/?>/.exec(body)?.[0] ?? null;
    const type = ph ? (attr(ph, 'type') ?? 'body') : (tag === 'pic' ? 'pic' : tag === 'graphicFrame' ? (body.includes('/chart"') ? 'chart' : 'tbl') : 'shape');
    if (SKIP.has(type)) continue;
    if (!ph && tag === 'sp') continue; // a drawn shape is decoration, not a place for content
    const off = /<a:off\b[^>]*>/.exec(body)?.[0];
    const ext = /<a:ext\b[^>]*cx="[^"]*"[^>]*>/.exec(body)?.[0];
    const n = (s: string | null | undefined) => (s != null && /^-?\d+$/.test(s) ? Number(s) : NaN);
    const box = { x: n(off && attr(off, 'x')), y: n(off && attr(off, 'y')), w: n(ext && attr(ext, 'cx')), h: n(ext && attr(ext, 'cy')) };
    out.push({ ...box, kind: KIND[type] ?? 'text', type, idx: ph ? attr(ph, 'idx') : null });
  }
  return out;
}

/** The lines of The Grid along one axis: each cell's start and end, in card pixels. */
function lines(n: number, start: number, cell: number, gutter: number) {
  return { starts: Array.from({ length: n }, (_, i) => start + i * (cell + gutter)), ends: Array.from({ length: n }, (_, i) => start + i * (cell + gutter) + cell) };
}
const COLS = lines(12, FRAME.marginX, CELL.width, FRAME.gutter);
const ROWS = lines(6, FRAME.marginTop, CELL.height, FRAME.gutter);

/** The cell an edge snaps to (1-based), or null when it sits between two lines. A box reaching into a margin snaps to the outer cell. */
function snap(v: number, set: number[], pitch: number, outer: 'first' | 'last'): number | null {
  if (outer === 'first' && v <= set[0]) return 1;
  if (outer === 'last' && v >= set[set.length - 1]) return set.length;
  let best = -1, dist = Infinity;
  set.forEach((s, i) => { const d = Math.abs(v - s); if (d < dist) { dist = d; best = i; } });
  return dist <= SNAP_TOLERANCE * pitch ? best + 1 : null;
}

/** One layout's boxes on The Grid's whole cells, or the reason they cannot be. */
export function placeLayout(name: string, boxes: Box[], slide: { cx: number; cy: number }): TemplateLayout {
  const ok = boxes.filter((b) => [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0 && b.h > 0);
  if (!ok.length) return { name, placed: false, reason: 'empty', why: UNPLACED.empty };
  const sx = SLIDE.width / slide.cx, sy = SLIDE.height / slide.cy;
  const areas: TemplateArea[] = [];
  for (const b of ok) {
    const x1 = b.x * sx, x2 = (b.x + b.w) * sx, y1 = b.y * sy, y2 = (b.y + b.h) * sy;
    const c1 = snap(x1, COLS.starts, CELL.width + FRAME.gutter, 'first');
    const c2 = snap(x2, COLS.ends, CELL.width + FRAME.gutter, 'last');
    if (c1 == null || c2 == null || c2 < c1) return { name, placed: false, reason: 'between_columns', why: UNPLACED.between_columns };
    const r1 = snap(y1, ROWS.starts, CELL.height + FRAME.gutter, 'first');
    const r2 = snap(y2, ROWS.ends, CELL.height + FRAME.gutter, 'last');
    if (r1 == null || r2 == null || r2 < r1) return { name, placed: false, reason: 'between_rows', why: UNPLACED.between_rows };
    areas.push({ kind: b.kind, c1, c2, r1, r2 });
  }
  for (let i = 0; i < areas.length; i += 1) for (let j = i + 1; j < areas.length; j += 1) {
    const a = areas[i], z = areas[j];
    if (a.c1 <= z.c2 && z.c1 <= a.c2 && a.r1 <= z.r2 && z.r1 <= a.r2) return { name, placed: false, reason: 'overlap', why: UNPLACED.overlap };
  }
  return { name, placed: true, areas: areas.sort((a, z) => (a.r1 - z.r1) || (a.c1 - z.c1)) };
}

const numberOf = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);

/** The template's theme and layouts on The Grid (pd30's mapping report). */
export async function parseTemplate(bytes: Uint8Array): Promise<TemplateReport> {
  const parts = readPptxZip(bytes);
  const text = async (name: string) => {
    const p = parts.find((x) => x.name === name);
    return p ? new TextDecoder().decode(await p.read()) : null;
  };
  const pres = (await text('ppt/presentation.xml')) ?? '';
  const sz = /<p:sldSz\b[^>]*>/.exec(pres)?.[0];
  const cx = Number(sz && attr(sz, 'cx')) || 12192000;
  const cy = Number(sz && attr(sz, 'cy')) || 6858000;
  const themeName = parts.map((p) => p.name).filter((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n)).sort((a, z) => numberOf(a) - numberOf(z))[0];
  const theme = themeName ? (await text(themeName)) ?? '' : '';
  const scheme = themeColours(theme);
  const faces = themeFonts(theme);
  const palette: TemplateReport['palette'] = {};
  const roles: Array<[keyof TemplateReport['palette'], string]> = [['ground', 'lt1'], ['ink', 'dk1'], ['accent', 'accent1'], ['secondary', 'accent2'], ['highlight', 'accent3']];
  for (const [role, slot] of roles) if (scheme[slot]) palette[role] = scheme[slot];
  const masterName = parts.map((p) => p.name).filter((n) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(n)).sort((a, z) => numberOf(a) - numberOf(z))[0];
  const master = masterName ? shapesOf((await text(masterName)) ?? '') : [];
  const layoutNames = parts.map((p) => p.name).filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n)).sort((a, z) => numberOf(a) - numberOf(z)).slice(0, LAYOUTS_MAX);
  const layouts: TemplateLayout[] = [];
  for (const ln of layoutNames) {
    const xml = (await text(ln)) ?? '';
    const name = cleanName(attr(/<p:cSld\b[^>]*>/.exec(xml)?.[0] ?? '', 'name'), `Layout ${numberOf(ln)}`);
    // A placeholder the layout does not place takes its master's box of the same type.
    const boxes = shapesOf(xml).map((b) => {
      if ([b.x, b.y, b.w, b.h].every(Number.isFinite)) return b;
      const m = master.find((s) => s.type === b.type) ?? master.find((s) => s.kind === b.kind);
      return m ? { ...m, kind: b.kind, type: b.type, idx: b.idx } : b;
    });
    layouts.push(placeLayout(name, boxes, { cx, cy }));
  }
  const placed = layouts.filter((l) => l.placed).length;
  return {
    palette,
    colours: Object.entries(scheme).map(([role, hex]) => ({ role, hex })),
    fonts: [fontOf(faces.major, 'display'), fontOf(faces.minor, 'body')],
    layouts,
    counts: { found: layouts.length, placed, not_placed: layouts.length - placed },
  };
}

/** A saved layout as a prompt names it: its name is the file's text, so it is framed as untrusted data (D1506). */
export function layoutPromptLine(layout: { name: string; areas: TemplateArea[] }): string {
  return `${untrustedBlock('deck_import', layout.name)}\n${layout.areas.map((a) => `${a.kind} c${a.c1}–${a.c2} × r${a.r1}–${a.r2}`).join('; ')}`;
}
