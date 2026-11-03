/**
 * D904 (#2683) — Pitch deck studio part 10: the editable PowerPoint. Since
 * D1574 (#3821, deck v2 E1) it is both the PowerPoint download and the file
 * the Google Slides export uploads; the picture-per-card writer
 * (`renderDeckPPTXWithImages`) is no longer used for either.
 *
 * D1574: every D898 block sits at The Grid's own box (`designSystem.boxOf`,
 * the editor's and the .odp writer's placement), so a zero-edit deck opens in
 * PowerPoint as the editor shows it, its blocks in reading order:
 *
 *   - text and metric blocks are text boxes, set to fit their area
 *     (`fitParagraphs`); a metric with no figure reads "Not recorded",
 *     never 0;
 *   - an image is a picture, when its first bytes are PNG, JPEG or GIF (the
 *     three PowerPoint and Slides both read); one that could not be fetched,
 *     or is WebP, says so in its place;
 *   - a chart is a native chart (`pptxChart.ts`) from the points the deck
 *     holds; a type with no native chart is a picture of the chart block as
 *     the print page draws it, when the headless browser can take it
 *     (`chartShot`), otherwise its type and series as text (D901). Nothing
 *     here plots a figure the deck does not hold;
 *   - video, audio and link blocks are their label and address as text;
 *   - D903 §11 (#3660): a typed diagram (timeline, flow, cycle, matrix) is
 *     one group of native shapes from `diagramLayout`: each item a rounded
 *     box with its words as editable text, each connector a line (an arrow
 *     where the layout says so), each timeline marker a dot;
 *   - a card made of fields (D897), and the Sources appendix, are the text
 *     writer's stacked text frames.
 *
 * D1533 (#3777): a card's decor is drawn first, under the blocks, in its
 * layer order (`arrange.decorPlan`), as the native shape its kind and ref name
 * (`EXPORT_GEOMETRY`); D1574 writes an item with no native shape (an icon, a
 * texture) as its SVG with a PNG fallback. A pinned block or decor item
 * (the Arrange set's Lock) is written with PowerPoint's move and resize locks,
 * and the members of a group are one group shape.
 *
 * D1534 (#3778): an image is drawn as the browser draws it — its cover fit at
 * its focus point and its zoom window as the picture's `<a:srcRect>`, its
 * filter as the picture's own effects and its colour wash as a filled
 * rectangle over it (`imageLook.ts`, one table for every renderer).
 *
 * Speaker notes are each card's notes when they were asked for, and empty
 * otherwise. Nothing here logs a title, a figure or a URL.
 */
import { CONFIDENTIAL, type DeckCompliance } from './compliance';
import type { RenderableSlide } from './render';
import type { DeckBrand } from './branding';
import { buildNotesSlideXml, buildSlideXml, buildZip, notesPackageParts, tf, xmlEsc, type ZipEntry } from './pptx';
import { IMAGE_MISSING, NOT_RECORDED, NO_NOTES, chartLabel, type ImageKind } from './offlineHtml';
import { tableLines } from './slideModel';
import { decorPlan, type DecorDraw } from './arrange';
import { FILTER_SPECS, blipEffectsXml, filterOf, srcRectXml, visibleSource, washColour } from './imageLook';
import { imageSize } from './imageBytes';
import { DEFAULT_INK } from './images';
import { diagramLayout, diagramName, type DiagramLayout } from './diagramLayout';
import { SLIDE, boxOf } from './designSystem';
import { decorSvg } from './elements';
import { chartFrameXml, chartHeading, chartPartXml, chartPlan, chartWorkbook, type ResolvedSeries } from './pptxChart';

/** The card the block geometry is measured on: 1920 × 1080 slide pixels. */
export const CARD_W = SLIDE.width;
export const CARD_H = SLIDE.height;
/** The print page (D1112): 3% padding, a 24 px gap, 12 columns by 6 rows; only a chart picture's clip is measured there. */
const PAD = 0.03 * CARD_W; // CSS padding in % is of the width, on every side
const GAP = 24;
const COLS = 12;
const ROWS = 6;
const COL_W = (CARD_W - 2 * PAD - (COLS - 1) * GAP) / COLS;
const ROW_H = (CARD_H - 2 * PAD - (ROWS - 1) * GAP) / ROWS;
/** 13.333 in × 7.5 in = 12192000 × 6858000 EMU, so one card pixel is 6350 EMU. */
const EMU_PER_PX = 12192000 / CARD_W;
/** A card pixel is half a point (1920 px across 960 pt). */
const pt = (px: number) => Math.round(px / 2);
/** Where the footer line sits: the .odp writer's (`odp.ts`), inside The Grid's bottom margin. */
const FOOT_Y = CARD_H - 64;

/** At most this many chart pictures in one file; the rest are written as text. */
export const CHART_SHOTS_MAX = 30;

export type Rect = { x: number; y: number; w: number; h: number };
export type Grid = { c1: number; c2: number; r1: number; r2: number };
export type PlacedImage = { kind: ImageKind; bytes: Uint8Array } | null;
/** One chart block, pictured from the print page: PNG bytes, or null when it could not be taken. */
export type ChartShot = (slideIndex: number, rect: Rect) => Promise<Uint8Array | null>;

/**
 * D1574 (#3821): a block's rectangle on the card, in slide pixels — The
 * Grid's own placement (`designSystem.boxOf`: margins 112 / 96 / 88 and the
 * 24 px gutter), the one the editor draws and the .odp writer uses, so a
 * zero-edit deck opens in PowerPoint laid out as the editor shows it.
 */
export function blockRect(g: Grid): Rect {
  return boxOf(g);
}

/** The same range on the print page (D1112), where a chart picture is clipped from. */
export function printRect(g: Grid): Rect {
  const x = PAD + (g.c1 - 1) * (COL_W + GAP);
  const y = PAD + (g.r1 - 1) * (ROW_H + GAP);
  const cols = g.c2 - g.c1 + 1;
  const rows = g.r2 - g.r1 + 1;
  return { x, y, w: cols * COL_W + (cols - 1) * GAP, h: rows * ROW_H + (rows - 1) * GAP };
}

const emu = (px: number) => Math.round(px * EMU_PER_PX);
const MEDIA: Partial<Record<ImageKind, string>> = { png: 'png', jpeg: 'jpeg', gif: 'gif' };
const COLOUR = /^#[0-9a-f]{6}$/i;

/** D1533: the Arrange set's Lock, as PowerPoint's own: the shape cannot be moved or resized. */
const LOCKS = 'noMove="1" noResize="1"';

/** Text box insets, in points: PowerPoint's defaults (0.1 in left and right, 0.05 in top and bottom). */
const INSET = { x: 7.2, y: 3.6 };
/** A glyph's average advance as a share of its size, for a sans face: generous, so an estimate never under-counts. */
const ADVANCE = 0.55;
const LEADING = 1.2;
/** The smallest share of its size a run is set at to fit (D1574: text stays inside its area). */
export const FIT_FLOOR = 0.4;

const unescape = (t: string) => t.replace(/&(amp|lt|gt|quot|apos);/g, 'x');

/** How tall a box's paragraphs set, in points, at `scale` of their sizes, in a box `widthPt` wide. */
export function setHeight(paragraphs: string[], widthPt: number, scale = 1): number {
  let h = 0;
  for (const p of paragraphs) {
    const indent = /marL="(\d+)"/.exec(p);
    const avail = Math.max(1, widthPt - 2 * INSET.x - (indent ? Number(indent[1]) / 12700 : 0));
    const runs = [...p.matchAll(/sz="(\d+)"[^>]*>(?:(?!<a:t>)[\s\S])*<a:t>([\s\S]*?)<\/a:t>/g)];
    const size = Math.max(...runs.map((m) => Number(m[1]) / 100 * scale), 10 * scale);
    const width = runs.reduce((w, m) => w + unescape(m[2]).length * ADVANCE * (Number(m[1]) / 100) * scale, 0);
    h += Math.max(1, Math.ceil(width / avail)) * size * LEADING;
  }
  return h + 2 * INSET.y;
}

/**
 * D1574: the paragraphs at the largest share of their sizes (down to
 * FIT_FLOOR) that sets them inside the box, so no area overflows in
 * PowerPoint. The sizes are written, not left to autofit, which PowerPoint
 * only applies once the text is edited.
 */
export function fitParagraphs(paragraphs: string[], r: Rect): string[] {
  const w = r.w / 2, h = r.h / 2; // card pixels to points
  let scale = 1;
  while (scale > FIT_FLOOR && setHeight(paragraphs, w, scale) > h) scale = Math.round((scale - 0.05) * 100) / 100;
  if (scale >= 1) return paragraphs;
  return paragraphs.map((p) => p.replace(/ sz="(\d+)"/g, (_, n) => ` sz="${Math.max(600, Math.floor(Number(n) * scale))}"`));
}

function textBox(id: number, name: string, r: Rect, paragraphs: string[], anchor: 't' | 'ctr' = 't', pinned = false): string {
  const body = fitParagraphs(paragraphs, r).map((p) => `<a:p>${p}</a:p>`).join('');
  return `<p:sp>
  <p:nvSpPr><p:cNvPr id="${id}" name="${xmlEsc(name)}"/>${pinned ? `<p:cNvSpPr txBox="1"><a:spLocks ${LOCKS}/></p:cNvSpPr>` : '<p:cNvSpPr txBox="1"/>'}<p:nvPr/></p:nvSpPr>
  <p:spPr><a:xfrm><a:off x="${emu(r.x)}" y="${emu(r.y)}"/><a:ext cx="${emu(r.w)}" cy="${emu(r.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
  <p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${body}</p:txBody>
</p:sp>`;
}

function picture(id: number, name: string, r: Rect, rid: string, alt: string, pinned = false, look: { src?: string; effects?: string } = {}): string {
  const blip = look.effects ? `<a:blip r:embed="${rid}">${look.effects}</a:blip>` : `<a:blip r:embed="${rid}"/>`;
  return `<p:pic>
  <p:nvPicPr><p:cNvPr id="${id}" name="${xmlEsc(name)}" descr="${xmlEsc(alt)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"${pinned ? ` ${LOCKS}` : ''}/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
  <p:blipFill>${blip}${look.src ?? ''}<a:stretch><a:fillRect/></a:stretch></p:blipFill>
  <p:spPr><a:xfrm><a:off x="${emu(r.x)}" y="${emu(r.y)}"/><a:ext cx="${emu(r.w)}" cy="${emu(r.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>`;
}

/** D1534 (#3778): a filter's colour wash, a filled rectangle over the picture at the preset's alpha (`imageLook.ts`). */
function wash(id: number, name: string, r: Rect, colour: string, alpha: number): string {
  return `<p:sp>
  <p:nvSpPr><p:cNvPr id="${id}" name="${xmlEsc(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
  <p:spPr><a:xfrm><a:off x="${emu(r.x)}" y="${emu(r.y)}"/><a:ext cx="${emu(r.w)}" cy="${emu(r.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${colour.slice(1).toUpperCase()}"><a:alpha val="${Math.round(alpha * 100_000)}"/></a:srgbClr></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>
</p:sp>`;
}

/** D1534: an embedded picture's pixel size, from its own header; null when it cannot be read. */
export function pixelSize(kind: ImageKind, bytes: Uint8Array): { w: number; h: number } | null {
  if (kind === 'gif') return bytes.length >= 10 ? { w: bytes[6] | (bytes[7] << 8), h: bytes[8] | (bytes[9] << 8) } : null;
  const s = imageSize(bytes, kind === 'png' ? 'image/png' : 'image/jpeg');
  return s ? { w: s.width, h: s.height } : null;
}

/**
 * D1534: the picture's look as the browser draws it — the cover fit at its
 * focus point and its zoom window (as `<a:srcRect>`), its filter (as blip
 * effects) — and its wash, when its filter has one.
 */
export function imageLookParts(b: any, r: Rect, img: { kind: ImageKind; bytes: Uint8Array }, ink: string = DEFAULT_INK) {
  const size = pixelSize(img.kind, img.bytes);
  const src = size ? srcRectXml(visibleSource(b.crop ?? null, b.fit ?? null, { w: r.w, h: r.h }, size)) : '';
  const filter = filterOf(b.filter);
  const spec = FILTER_SPECS[filter ?? 'original'];
  const colour = washColour(spec, ink);
  return { src, effects: blipEffectsXml(filter), wash: colour && spec.wash ? { colour, alpha: spec.wash.alpha } : null };
}

/** D1533: a decor item's box on the card: its 8 px `at` (slide pixels), else its cell range, else the whole card. */
export function decorRect(d: DecorDraw): Rect {
  if (d.at) return { x: d.at.x, y: d.at.y, w: d.at.w, h: d.at.h };
  return d.grid ? blockRect(d.grid) : { x: 0, y: 0, w: CARD_W, h: CARD_H };
}

/** D1533: one decor item as a native shape (a line for a divider), filled with its tone; null for an item with no native shape. */
export function decorShape(id: number, d: DecorDraw): string | null {
  if (!d.geometry) return null;
  const r = decorRect(d);
  const fill = `<a:solidFill><a:srgbClr val="${d.colour.slice(1).toUpperCase()}"/></a:solidFill>`;
  const name = xmlEsc(`Decor ${d.id}`);
  if (d.geometry === 'line') {
    const y = r.y + r.h / 2;
    return `<p:cxnSp>
  <p:nvCxnSpPr><p:cNvPr id="${id}" name="${name}"/>${d.pinned ? `<p:cNvCxnSpPr><a:cxnSpLocks ${LOCKS}/></p:cNvCxnSpPr>` : '<p:cNvCxnSpPr/>'}<p:nvPr/></p:nvCxnSpPr>
  <p:spPr><a:xfrm><a:off x="${emu(r.x)}" y="${emu(y)}"/><a:ext cx="${emu(r.w)}" cy="0"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${emu(4)}">${fill}</a:ln></p:spPr>
</p:cxnSp>`;
  }
  return `<p:sp>
  <p:nvSpPr><p:cNvPr id="${id}" name="${name}"/>${d.pinned ? `<p:cNvSpPr><a:spLocks ${LOCKS}/></p:cNvSpPr>` : '<p:cNvSpPr/>'}<p:nvPr/></p:nvSpPr>
  <p:spPr><a:xfrm><a:off x="${emu(r.x)}" y="${emu(r.y)}"/><a:ext cx="${emu(r.w)}" cy="${emu(r.h)}"/></a:xfrm><a:prstGeom prst="${d.geometry}"><a:avLst/></a:prstGeom>${fill}<a:ln><a:noFill/></a:ln></p:spPr>
</p:sp>`;
}

/**
 * D903 §11 (#3660): a diagram as one group shape of native, editable shapes,
 * laid out in the block's rectangle. Every word stays a text run.
 */
export function diagramGroup(nextId: () => number, name: string, r: Rect, layout: DiagramLayout, pinned = false, rtl = false): string {
  const X = (f: number) => r.x + f * r.w;
  const Y = (f: number) => r.y + f * r.h;
  const fill = (hex: string) => `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
  const kids: string[] = [];
  for (const s of layout.shapes) {
    const id = nextId();
    if (s.kind === 'line') {
      const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
      const flip = `${s.x2 < s.x1 ? ' flipH="1"' : ''}${s.y2 < s.y1 ? ' flipV="1"' : ''}`;
      kids.push(`<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="Connector ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>`
        + `<p:spPr><a:xfrm${flip}><a:off x="${emu(X(x))}" y="${emu(Y(y))}"/><a:ext cx="${emu(Math.abs(s.x2 - s.x1) * r.w)}" cy="${emu(Math.abs(s.y2 - s.y1) * r.h)}"/></a:xfrm>`
        + `<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${emu(3)}">${fill('94A3B8')}${s.arrow ? '<a:tailEnd type="triangle" w="med" len="med"/>' : ''}</a:ln></p:spPr></p:cxnSp>`);
      continue;
    }
    const box = `<a:xfrm><a:off x="${emu(X(s.x))}" y="${emu(Y(s.y))}"/><a:ext cx="${emu(s.w * r.w)}" cy="${emu(s.h * r.h)}"/></a:xfrm>`;
    if (s.kind === 'dot') {
      kids.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Marker ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${box}<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>${fill('64748B')}<a:ln><a:noFill/></a:ln></p:spPr></p:sp>`);
      continue;
    }
    const paras = s.role === 'axis'
      ? [`<a:pPr algn="ctr"/>${run(s.label, { size: pt(22), color: MUTED })}`]
      : [
        ...(s.date ? [run(s.date, { size: pt(18), bold: true, color: MUTED })] : []),
        run(s.label, { size: pt(26), bold: true }),
        ...(s.detail ? [run(s.detail, { size: pt(20), color: MUTED })] : []),
      ];
    const body = (rtl ? paras.map(rtlParagraph) : paras).map((p) => `<a:p>${p}</a:p>`).join('');
    const look = s.role === 'axis' ? '<a:noFill/><a:ln><a:noFill/></a:ln>' : `${fill('F8FAFC')}<a:ln w="${emu(2)}">${fill('E5E7EB')}</a:ln>`;
    kids.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${s.role === 'axis' ? 'Axis' : 'Item'} ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
      + `<p:spPr>${box}<a:prstGeom prst="${s.role === 'axis' ? 'rect' : 'roundRect'}"><a:avLst/></a:prstGeom>${look}</p:spPr>`
      + `<p:txBody><a:bodyPr wrap="square" lIns="${emu(10)}" rIns="${emu(10)}" tIns="${emu(6)}" bIns="${emu(6)}" anchor="ctr"${s.vertical ? ' vert="vert270"' : ''}><a:normAutofit/></a:bodyPr><a:lstStyle/>${body}</p:txBody></p:sp>`);
  }
  const at = `<a:off x="${emu(r.x)}" y="${emu(r.y)}"/><a:ext cx="${emu(r.w)}" cy="${emu(r.h)}"/>`;
  return `<p:grpSp>
  <p:nvGrpSpPr><p:cNvPr id="${nextId()}" name="${xmlEsc(name)}" descr="${xmlEsc(`${diagramName(layout.type)} diagram`)}"/>${pinned ? `<p:cNvGrpSpPr><a:grpSpLocks ${LOCKS}/></p:cNvGrpSpPr>` : '<p:cNvGrpSpPr/>'}<p:nvPr/></p:nvGrpSpPr>
  <p:grpSpPr><a:xfrm>${at}${at.replace('a:off', 'a:chOff').replace('a:ext', 'a:chExt')}</a:xfrm></p:grpSpPr>
  ${kids.join('\n  ')}
</p:grpSp>`;
}

type Placed = { xml: string; rect: Rect; group: string | null; pinned: boolean };

/**
 * D1533: the shapes in their order, each group's members gathered into one
 * group shape where its first member stood. Decor and areas are grouped
 * apart (a group never mixes the two layers), so a group never lifts decor
 * over an area. A group whose members are all pinned is locked as a whole.
 */
export function withGroups(placed: Placed[], nextId: () => number): string[] {
  const out: string[] = [];
  const done = new Set<string>();
  for (const p of placed) {
    if (!p.group) { out.push(p.xml); continue; }
    if (done.has(p.group)) continue;
    done.add(p.group);
    const members = placed.filter((q) => q.group === p.group);
    if (members.length < 2) { out.push(p.xml); continue; }
    const x = Math.min(...members.map((m) => m.rect.x));
    const y = Math.min(...members.map((m) => m.rect.y));
    const w = Math.max(...members.map((m) => m.rect.x + m.rect.w)) - x;
    const h = Math.max(...members.map((m) => m.rect.y + m.rect.h)) - y;
    const box = `<a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/>`;
    const locked = members.every((m) => m.pinned);
    out.push(`<p:grpSp>
  <p:nvGrpSpPr><p:cNvPr id="${nextId()}" name="${xmlEsc(`Group ${p.group}`)}"/>${locked ? `<p:cNvGrpSpPr><a:grpSpLocks ${LOCKS}/></p:cNvGrpSpPr>` : '<p:cNvGrpSpPr/>'}<p:nvPr/></p:nvGrpSpPr>
  <p:grpSpPr><a:xfrm>${box}${box.replace('a:off', 'a:chOff').replace('a:ext', 'a:chExt')}</a:xfrm></p:grpSpPr>
  ${members.map((m) => m.xml).join('\n')}
</p:grpSp>`);
  }
  return out;
}

const INK = '0F172A';
const MUTED = '64748B';
const run = (t: string, o: { size: number; bold?: boolean; italic?: boolean; color?: string }) => tf(t, { ...o, color: o.color ?? INK });
const bullet = (t: string, size: number) => `<a:pPr marL="342900" indent="-342900"><a:buChar char="•"/></a:pPr>${run(t, { size })}`;

const todayOf = () => new Date().toISOString().slice(0, 10);

/**
 * D1574 (pd8b: "A projection keeps its label in every format"): a chart's
 * heading, "Projection · Line chart" when it reaches past today's month.
 */
export function chartTitle(b: any, today: string = todayOf(), resolved: ResolvedSeries | null = null): string {
  return chartHeading(`${chartLabel(b?.chart_type)} chart`, b, today, resolved);
}

/** A chart as the HTML file writes it: its type, then each series and any typed points. */
export function chartParagraphs(b: any, today: string = todayOf()): string[] {
  const out = [run(chartTitle(b, today), { size: pt(24), bold: true })];
  const series = Array.isArray(b.series) ? b.series : [];
  if (!series.length) out.push(run(NOT_RECORDED, { size: pt(24), italic: true, color: MUTED }));
  for (const sr of series) {
    const label = String(sr?.label || sr?.binding?.source_key || 'Series');
    const pts = Array.isArray(sr?.points) ? sr.points : [];
    out.push(run(pts.length ? `${label}: ${pts.map((p: any) => `${p?.x} ${p?.y}`).join(' · ')}` : label, { size: pt(24), color: MUTED }));
  }
  return out;
}

/** One block's text, or null when the block draws nothing (an empty text block). */
export function blockParagraphs(b: any): string[] | null {
  switch (b?.kind) {
    case 'text': {
      const t = String(b.text ?? '').trim();
      if (!t) return null;
      if (b.style === 'heading') return [run(t, { size: pt(64), bold: true })];
      if (b.style === 'list') return t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => bullet(l, pt(30)));
      return t.split(/\r?\n/).map((l) => run(l, { size: pt(30) }));
    }
    case 'metric': {
      const v = String(b.value ?? '').trim();
      return [
        run(String(b.label || 'Metric').toUpperCase(), { size: pt(22), bold: true, color: MUTED }),
        v ? run(v, { size: pt(60), bold: true }) : run(NOT_RECORDED, { size: pt(26), italic: true }),
      ];
    }
    case 'chart': return chartParagraphs(b);
    case 'graphic': return [run(`Graphic · ${b.graphic || 'none chosen'}`, { size: pt(24), color: MUTED })];
    // D1538: a typed table, one row per line; the header row in bold.
    case 'table': {
      const lines = tableLines(b);
      return lines.length ? lines.map((l, i) => run(l, { size: pt(24), bold: i === 0 && b.header !== false })) : null;
    }
    case 'video': return [run(`▶ ${b.title || (b.provider === 'vimeo' ? 'Vimeo video' : 'YouTube video')}`, { size: pt(30), bold: true }), run(String(b.url || ''), { size: pt(22), color: MUTED })];
    case 'audio':
    case 'link': return [run(b.label || (b.kind === 'audio' ? 'Audio clip' : 'Open'), { size: pt(30), bold: true }), run(String(b.url || ''), { size: pt(22), color: MUTED })];
    default: return null;
  }
}

export type EditableInput = {
  /** The stored slides, already sanitized; a slide with `blocks` is drawn from them. */
  slides: any[];
  /** The same deck in the text writer's shape, one per slide plus the Sources appendix when asked for. */
  renderable: RenderableSlide[];
  brand: DeckBrand;
  notes: boolean;
  /** Every image URL the blocks name, fetched once (`fetchImages`). */
  images: Map<string, PlacedImage>;
  chartShot?: ChartShot | null;
  /** D1546: Confidential and each card's footnotes (`compliance.ts`). */
  compliance?: DeckCompliance;
  /** D1571 (#3818): the deck's direction (`designSystem.dirOf` of its theme); 'rtl' writes each block's paragraphs right to left. */
  dir?: 'ltr' | 'rtl';
  /** D1574: each bound series' points as its store reads them now (`chartSeries.readSeries`), by source key. */
  series?: ResolvedSeries | null;
  /** D1574: today's date (YYYY-MM-DD), which decides what is a projection; today when not given. */
  today?: string;
};

/**
 * D1571 (#3818): a paragraph written right to left, aligned to its start (the
 * right). The layout keeps its boxes where the founder put them; only the
 * words mirror, as they do on The Grid, in Present and in print.
 */
export function rtlParagraph(p: string): string {
  if (p.startsWith('<a:pPr ')) return p.replace('<a:pPr ', '<a:pPr rtl="1" algn="r" ');
  if (p.startsWith('<a:pPr>')) return p.replace('<a:pPr>', '<a:pPr rtl="1" algn="r">');
  if (p.startsWith('<a:pPr/>')) return p.replace('<a:pPr/>', '<a:pPr rtl="1" algn="r"/>');
  return `<a:pPr rtl="1" algn="r"/>${p}`;
}
export type EditableReport = {
  bytes: Uint8Array;
  /** D1574: a chart is a native chart when its type has one and it holds a point; else its picture; else its words. */
  charts: { native: number; pictured: number; as_text: number };
  images: { placed: number; not_placed: number };
  /** D1574: decor drawn as a native shape, and as SVG (with a PNG fallback for readers without SVG). */
  decor: { shapes: number; svg: number };
};

type Media = { name: string; data: Uint8Array };
type ChartPart = { xml: string; workbook: Uint8Array };
type Counts = { native: number; pictured: number; as_text: number; placed: number; not_placed: number; shapes: number; svg: number };

/** A 1 × 1 transparent PNG: the fallback picture an SVG decor item carries for a reader that cannot draw SVG. */
export const CLEAR_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
const SVG_EXT = '{96DAC541-7B7A-43D3-8B79-37D633B846F1}';

/** D1574: a decor item's SVG with its tone written as a colour (PowerPoint reads no CSS variables). */
export function decorSvgFor(d: DecorDraw): string | null {
  const svg = decorSvg({ kind: d.kind, ref: d.ref ?? undefined, tone: d.tone });
  return svg ? svg.replace(/var\(--deck-[a-z]+\)/g, d.colour) : null;
}

/** D1574: an SVG picture, with the PNG every reader without SVG draws instead (Office's `asvg:svgBlip` extension). */
function svgPicture(id: number, name: string, r: Rect, pngRid: string, svgRid: string, pinned = false): string {
  return `<p:pic>
  <p:nvPicPr><p:cNvPr id="${id}" name="${xmlEsc(name)}" descr=""/><p:cNvPicPr><a:picLocks noChangeAspect="1"${pinned ? ` ${LOCKS}` : ''}/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
  <p:blipFill><a:blip r:embed="${pngRid}"><a:extLst><a:ext uri="${SVG_EXT}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${svgRid}"/></a:ext></a:extLst></a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill>
  <p:spPr><a:xfrm><a:off x="${emu(r.x)}" y="${emu(r.y)}"/><a:ext cx="${emu(r.w)}" cy="${emu(r.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>`;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * D1574: the blocks in reading order — top to bottom, then start to end —
 * which is the order a screen reader takes a slide's shapes in. Shape order
 * is also stacking order, so a card whose areas overlap keeps its own order.
 */
export function readingOrder(blocks: any[]): any[] {
  const placed = blocks.filter((b) => b?.grid && [b.grid.c1, b.grid.c2, b.grid.r1, b.grid.r2].every(Number.isInteger));
  const rects = placed.map((b) => blockRect(b.grid));
  for (let i = 0; i < rects.length; i += 1) for (let j = i + 1; j < rects.length; j += 1) if (overlaps(rects[i], rects[j])) return placed;
  return placed.map((b, i) => ({ b, i })).sort((a, z) => (a.b.grid.r1 - z.b.grid.r1) || (a.b.grid.c1 - z.b.grid.c1) || (a.i - z.i)).map((o) => o.b);
}

async function blockSlideXml(slide: any, idx: number, total: number, input: EditableInput, media: Media[], charts: ChartPart[], counts: Counts, shots: { left: number }): Promise<{ xml: string; rels: string[] }> {
  const shapes: string[] = [];
  const rels: string[] = [];
  const today = input.today ?? todayOf();
  let id = 2;
  const rel = (type: string, target: string) => {
    const rid = `rId${rels.length + 3}`; // rId1 is the layout, rId2 the notes slide
    rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`);
    return rid;
  };
  const embed = (ext: string, bytes: Uint8Array) => {
    const name = `s${idx + 1}_${media.length + 1}.${ext}`;
    media.push({ name, data: bytes });
    return rel('image', `../media/${name}`);
  };
  // D1533: decor first, bottom layer first, then the blocks; each tier gathers its own groups.
  const decor: Placed[] = [];
  for (const d of decorPlan(slide)) {
    const xml = decorShape(id, d);
    if (xml) {
      id += 1;
      counts.shapes += 1;
      decor.push({ xml, rect: decorRect(d), group: d.group, pinned: d.pinned });
      continue;
    }
    // D1574: an icon, texture or other drawn item as its SVG, the art the editor shows.
    const svg = decorSvgFor(d);
    if (!svg) continue;
    const r = decorRect(d);
    const png = embed('png', CLEAR_PNG);
    decor.push({ xml: svgPicture(id++, `Decor ${d.id}`, r, png, embed('svg', new TextEncoder().encode(svg)), d.pinned), rect: r, group: d.group, pinned: d.pinned });
    counts.svg += 1;
  }
  const placed: Placed[] = [];
  const put = (b: any, r: Rect, xml: string) => placed.push({ xml, rect: r, group: typeof b.group === 'string' ? b.group : null, pinned: b.pinned === true });
  for (const b of readingOrder(slide.blocks)) {
    const r = blockRect(b.grid);
    if (b.kind === 'image') {
      if (!b.image_url) continue;
      const img = input.images.get(b.image_url) ?? null;
      if (img && MEDIA[img.kind]) {
        const look = imageLookParts(b, r, img);
        put(b, r, picture(id++, `Image ${b.id}`, r, embed(MEDIA[img.kind] as string, img.bytes), String(b.alt || ''), b.pinned === true, look));
        if (look.wash) put(b, r, wash(id++, `Image ${b.id} filter`, r, look.wash.colour, look.wash.alpha));
        counts.placed += 1;
      } else {
        put(b, r, textBox(id++, `Image ${b.id}`, r, [run(IMAGE_MISSING, { size: pt(22), italic: true, color: MUTED })], 'ctr', b.pinned === true));
        counts.not_placed += 1;
      }
      continue;
    }
    if (b.kind === 'chart') {
      // D1574: a native chart, its numbers editable in PowerPoint.
      const plan = chartPlan(b, input.series, today);
      if (plan) {
        charts.push({ xml: chartPartXml(plan, 'rId1'), workbook: chartWorkbook(plan) });
        const rid = rel('chart', `../charts/chart${charts.length}.xml`);
        put(b, r, chartFrameXml(id++, `Chart ${b.id}`, chartTitle(b, today, input.series ?? null), { x: emu(r.x), y: emu(r.y), w: emu(r.w), h: emu(r.h) }, rid, b.pinned === true));
        counts.native += 1;
        continue;
      }
      if (input.chartShot && shots.left > 0) {
        shots.left -= 1;
        const png = await input.chartShot(idx, printRect(b.grid)).catch(() => null);
        if (png) {
          put(b, r, picture(id++, `Chart ${b.id}`, r, embed('png', png), chartTitle(b, today, input.series ?? null), b.pinned === true));
          counts.pictured += 1;
          continue;
        }
      }
    }
    if (b.kind === 'graphic') {
      const layout = diagramLayout(b.diagram);
      if (layout) {
        put(b, r, diagramGroup(() => id++, `Diagram ${b.id}`, r, layout, b.pinned === true, input.dir === 'rtl'));
        continue;
      }
    }
    const paras = b.kind === 'chart' ? chartParagraphs(b, today) : blockParagraphs(b);
    if (!paras) continue;
    if (b.kind === 'chart') counts.as_text += 1;
    put(b, r, textBox(id++, `${b.kind} ${b.id}`, r, input.dir === 'rtl' ? paras.map(rtlParagraph) : paras, b.kind === 'metric' ? 'ctr' : 't', b.pinned === true));
  }
  shapes.push(...withGroups(decor, () => id++), ...withGroups(placed, () => id++));
  if (input.brand.show_footer) {
    shapes.push(textBox(id++, 'Footer', { x: 112, y: FOOT_Y, w: 1200, h: 40 }, [run(input.brand.footer_text, { size: 10, color: '94A3B8' })]));
  }
  shapes.push(textBox(id++, 'PageNo', { x: CARD_W - 112 - 200, y: FOOT_Y, w: 200, h: 40 }, [`<a:pPr algn="r"/>${run(`${idx + 1} / ${total}`, { size: 10, color: '94A3B8' })}`]));
  // D1546: a projection's footnote and proposed round terms above the footer; Confidential beside the page number.
  const lines = input.compliance?.footnotes[idx] ?? [];
  if (lines.length) shapes.push(textBox(id++, 'Footnote', { x: 112, y: FOOT_Y - 8 - 30 * lines.length, w: CARD_W - 224, h: 30 * lines.length }, lines.map((l) => run(l, { size: 9, italic: true, color: '64748B' }))));
  if (input.compliance?.confidential) shapes.push(textBox(id++, 'Confidential', { x: CARD_W - 112 - 520, y: FOOT_Y, w: 300, h: 40 }, [`<a:pPr algn="r"/>${run(CONFIDENTIAL, { size: 10, color: '94A3B8' })}`]));
  const colour = COLOUR.test(String(slide?.background?.color || '')) ? String(slide.background.color).slice(1).toUpperCase() : null;
  const bg = colour ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${colour}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` : '';
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>${bg}<p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    ${shapes.join('\n')}
  </p:spTree></p:cSld>
</p:sld>`;
  return { xml, rels };
}

/**
 * The editable PowerPoint — the PowerPoint download (D1574) and the file the
 * Google Slides export uploads (D904) — and what went in natively, as
 * pictures and as words.
 */
export async function writeEditableDeck(input: EditableInput): Promise<EditableReport> {
  const enc = new TextEncoder();
  const total = input.renderable.length;
  const media: Media[] = [];
  const charts: ChartPart[] = [];
  const counts: Counts = { native: 0, pictured: 0, as_text: 0, placed: 0, not_placed: 0, shapes: 0, svg: 0 };
  const shots = { left: CHART_SHOTS_MAX };
  const parts: ZipEntry[] = [];
  for (let i = 0; i < total; i += 1) {
    const stored = input.slides[i];
    const blocks = Array.isArray(stored?.blocks) && stored.blocks.length ? stored : null;
    let xml: string;
    let rels: string[] = [];
    if (blocks) ({ xml, rels } = await blockSlideXml(blocks, i, total, input, media, charts, counts, shots));
    else xml = buildSlideXml(input.renderable[i], input.brand, i, total);
    parts.push({ name: `ppt/slides/slide${i + 1}.xml`, data: enc.encode(xml) });
    parts.push({
      name: `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${i + 1}.xml"/>
  ${rels.join('\n  ')}
</Relationships>`),
    });
    const said = input.notes ? (String(stored?.notes ?? input.renderable[i]?.notes ?? '').trim() || NO_NOTES) : '';
    parts.push({ name: `ppt/notesSlides/notesSlide${i + 1}.xml`, data: enc.encode(buildNotesSlideXml(i, said)) });
    parts.push({
      name: `ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`,
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${i + 1}.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/>
</Relationships>`),
    });
  }
  for (const m of media) parts.push({ name: `ppt/media/${m.name}`, data: m.data });
  charts.forEach((ch, i) => {
    const n = i + 1;
    parts.push({ name: `ppt/charts/chart${n}.xml`, data: enc.encode(ch.xml) });
    parts.push({
      name: `ppt/charts/_rels/chart${n}.xml.rels`,
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/chart${n}.xlsx"/>
</Relationships>`),
    });
    parts.push({ name: `ppt/embeddings/chart${n}.xlsx`, data: ch.workbook });
  });
  const entries: ZipEntry[] = [...notesPackageParts(total, [
    '<Default Extension="png" ContentType="image/png"/>',
    '<Default Extension="jpeg" ContentType="image/jpeg"/>',
    '<Default Extension="gif" ContentType="image/gif"/>',
    '<Default Extension="svg" ContentType="image/svg+xml"/>',
    '<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>',
    ...charts.map((_, i) => `<Override PartName="/ppt/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`),
  ]), ...parts];
  return {
    bytes: buildZip(entries),
    charts: { native: counts.native, pictured: counts.pictured, as_text: counts.as_text },
    images: { placed: counts.placed, not_placed: counts.not_placed },
    decor: { shapes: counts.shapes, svg: counts.svg },
  };
}
