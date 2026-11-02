/**
 * D904 (#2683) — Pitch deck studio part 10: the editable PowerPoint the
 * Google Slides export uploads.
 *
 * The picture-per-card writer (`renderDeckPPTXWithImages`) stays the
 * PowerPoint download. This one puts every D898 block at its own place on the
 * card, the way the print page draws it (D1112: 1920 × 1080, 3% padding, a
 * 24 px gap, 12 columns by 6 rows), so the presentation Google makes is one a
 * founder can edit:
 *
 *   - text and metric blocks are text boxes; a metric with no figure reads
 *     "Not recorded", never 0;
 *   - an image is a picture, when its first bytes are PNG, JPEG or GIF (the
 *     three PowerPoint and Slides both read); one that could not be fetched,
 *     or is WebP, says so in its place;
 *   - a chart is a picture of the chart block as the print page draws it,
 *     when the headless browser can take it (`chartShot`); otherwise its type
 *     and series as text, the way the HTML file writes it (D901). A chart is
 *     never redrawn here, so nothing here can plot a figure the deck does not
 *     hold;
 *   - video, audio and link blocks are their label and address as text;
 *   - a card made of fields (D897), and the Sources appendix, are the text
 *     writer's stacked text frames.
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

/** The print card (D1112) the block geometry is measured on. */
export const CARD_W = 1920;
export const CARD_H = 1080;
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

/** At most this many chart pictures in one file; the rest are written as text. */
export const CHART_SHOTS_MAX = 30;

export type Rect = { x: number; y: number; w: number; h: number };
export type Grid = { c1: number; c2: number; r1: number; r2: number };
export type PlacedImage = { kind: ImageKind; bytes: Uint8Array } | null;
/** One chart block, pictured from the print page: PNG bytes, or null when it could not be taken. */
export type ChartShot = (slideIndex: number, rect: Rect) => Promise<Uint8Array | null>;

/** A block's rectangle on the print card, in card pixels. */
export function blockRect(g: Grid): Rect {
  const x = PAD + (g.c1 - 1) * (COL_W + GAP);
  const y = PAD + (g.r1 - 1) * (ROW_H + GAP);
  const cols = g.c2 - g.c1 + 1;
  const rows = g.r2 - g.r1 + 1;
  return { x, y, w: cols * COL_W + (cols - 1) * GAP, h: rows * ROW_H + (rows - 1) * GAP };
}

const emu = (px: number) => Math.round(px * EMU_PER_PX);
const MEDIA: Partial<Record<ImageKind, string>> = { png: 'png', jpeg: 'jpeg', gif: 'gif' };
const COLOUR = /^#[0-9a-f]{6}$/i;

function textBox(id: number, name: string, r: Rect, paragraphs: string[], anchor: 't' | 'ctr' = 't'): string {
  const body = paragraphs.map((p) => `<a:p>${p}</a:p>`).join('');
  return `<p:sp>
  <p:nvSpPr><p:cNvPr id="${id}" name="${xmlEsc(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
  <p:spPr><a:xfrm><a:off x="${emu(r.x)}" y="${emu(r.y)}"/><a:ext cx="${emu(r.w)}" cy="${emu(r.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
  <p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${body}</p:txBody>
</p:sp>`;
}

function picture(id: number, name: string, r: Rect, rid: string, alt: string): string {
  return `<p:pic>
  <p:nvPicPr><p:cNvPr id="${id}" name="${xmlEsc(name)}" descr="${xmlEsc(alt)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
  <p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
  <p:spPr><a:xfrm><a:off x="${emu(r.x)}" y="${emu(r.y)}"/><a:ext cx="${emu(r.w)}" cy="${emu(r.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>`;
}

const INK = '0F172A';
const MUTED = '64748B';
const run = (t: string, o: { size: number; bold?: boolean; italic?: boolean; color?: string }) => tf(t, { ...o, color: o.color ?? INK });
const bullet = (t: string, size: number) => `<a:pPr marL="342900" indent="-342900"><a:buChar char="•"/></a:pPr>${run(t, { size })}`;

/** A chart as the HTML file writes it: its type, then each series and any typed points. */
export function chartParagraphs(b: any): string[] {
  const out = [run(`${chartLabel(b.chart_type)} chart`, { size: pt(24), bold: true })];
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
  charts: { pictured: number; as_text: number };
  images: { placed: number; not_placed: number };
};

type Media = { name: string; data: Uint8Array };

async function blockSlideXml(slide: any, idx: number, total: number, input: EditableInput, media: Media[], counts: EditableReport['charts'] & { placed: number; not_placed: number }, shots: { left: number }): Promise<{ xml: string; rels: string[] }> {
  const shapes: string[] = [];
  const rels: string[] = [];
  let id = 2;
  const embed = (kind: ImageKind, bytes: Uint8Array) => {
    const ext = MEDIA[kind] as string;
    const name = `s${idx + 1}_${media.length + 1}.${ext}`;
    media.push({ name, data: bytes });
    const rid = `rId${rels.length + 3}`; // rId1 is the layout, rId2 the notes slide
    rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${name}"/>`);
    return rid;
  };
  for (const b of slide.blocks) {
    const r = blockRect(b.grid);
    if (b.kind === 'image') {
      if (!b.image_url) continue;
      const img = input.images.get(b.image_url) ?? null;
      if (img && MEDIA[img.kind]) {
        shapes.push(picture(id++, `Image ${b.id}`, r, embed(img.kind, img.bytes), String(b.alt || '')));
        counts.placed += 1;
      } else {
        shapes.push(textBox(id++, `Image ${b.id}`, r, [run(IMAGE_MISSING, { size: pt(22), italic: true, color: MUTED })], 'ctr'));
        counts.not_placed += 1;
      }
      continue;
    }
    if (b.kind === 'chart' && input.chartShot && shots.left > 0) {
      shots.left -= 1;
      const png = await input.chartShot(idx, r).catch(() => null);
      if (png) {
        shapes.push(picture(id++, `Chart ${b.id}`, r, embed('png', png), `${chartLabel(b.chart_type)} chart`));
        counts.pictured += 1;
        continue;
      }
    }
    const paras = blockParagraphs(b);
    if (!paras) continue;
    if (b.kind === 'chart') counts.as_text += 1;
    shapes.push(textBox(id++, `${b.kind} ${b.id}`, r, input.dir === 'rtl' ? paras.map(rtlParagraph) : paras, b.kind === 'metric' ? 'ctr' : 't'));
  }
  if (input.brand.show_footer) {
    shapes.push(textBox(id++, 'Footer', { x: PAD, y: CARD_H - 44, w: 1200, h: 36 }, [run(input.brand.footer_text, { size: 10, color: '94A3B8' })]));
  }
  shapes.push(textBox(id++, 'PageNo', { x: CARD_W - PAD - 200, y: CARD_H - 44, w: 200, h: 36 }, [`<a:pPr algn="r"/>${run(`${idx + 1} / ${total}`, { size: 10, color: '94A3B8' })}`]));
  // D1546: a projection's footnote and proposed round terms above the footer; Confidential beside the page number.
  const lines = input.compliance?.footnotes[idx] ?? [];
  if (lines.length) shapes.push(textBox(id++, 'Footnote', { x: PAD, y: CARD_H - 52 - 30 * lines.length, w: CARD_W - 2 * PAD, h: 30 * lines.length }, lines.map((l) => run(l, { size: 9, italic: true, color: '64748B' }))));
  if (input.compliance?.confidential) shapes.push(textBox(id++, 'Confidential', { x: CARD_W - PAD - 520, y: CARD_H - 44, w: 300, h: 36 }, [`<a:pPr algn="r"/>${run(CONFIDENTIAL, { size: 10, color: '94A3B8' })}`]));
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

/** The editable PowerPoint, and how many charts and images went in as pictures. */
export async function writeEditableDeck(input: EditableInput): Promise<EditableReport> {
  const enc = new TextEncoder();
  const total = input.renderable.length;
  const media: Media[] = [];
  const counts = { pictured: 0, as_text: 0, placed: 0, not_placed: 0 };
  const shots = { left: CHART_SHOTS_MAX };
  const entries: ZipEntry[] = notesPackageParts(total, [
    '<Default Extension="png" ContentType="image/png"/>',
    '<Default Extension="jpeg" ContentType="image/jpeg"/>',
    '<Default Extension="gif" ContentType="image/gif"/>',
  ]);
  for (let i = 0; i < total; i += 1) {
    const stored = input.slides[i];
    const blocks = Array.isArray(stored?.blocks) && stored.blocks.length ? stored : null;
    let xml: string;
    let rels: string[] = [];
    if (blocks) ({ xml, rels } = await blockSlideXml(blocks, i, total, input, media, counts, shots));
    else xml = buildSlideXml(input.renderable[i], input.brand, i, total);
    entries.push({ name: `ppt/slides/slide${i + 1}.xml`, data: enc.encode(xml) });
    entries.push({
      name: `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${i + 1}.xml"/>
  ${rels.join('\n  ')}
</Relationships>`),
    });
    const said = input.notes ? (String(stored?.notes ?? input.renderable[i]?.notes ?? '').trim() || NO_NOTES) : '';
    entries.push({ name: `ppt/notesSlides/notesSlide${i + 1}.xml`, data: enc.encode(buildNotesSlideXml(i, said)) });
    entries.push({
      name: `ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`,
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${i + 1}.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/>
</Relationships>`),
    });
  }
  for (const m of media) entries.push({ name: `ppt/media/${m.name}`, data: m.data });
  return {
    bytes: buildZip(entries),
    charts: { pictured: counts.pictured, as_text: counts.as_text },
    images: { placed: counts.placed, not_placed: counts.not_placed },
  };
}
