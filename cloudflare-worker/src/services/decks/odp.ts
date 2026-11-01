/**
 * D1603 (#3882): the deck as an OpenDocument Presentation (.odp, ODF 1.3), for
 * LibreOffice Impress and the other open suites.
 *
 * The package is the stored zip `buildZip` writes (pptx.ts), with `mimetype`
 * first, stored and without an extra field, as ODF requires; then
 * `META-INF/manifest.xml`, `content.xml`, `styles.xml`, `meta.xml` and
 * `Pictures/*`. One master page at 16:9 (28cm × 15.75cm).
 *
 * - **Text stays text.** Every block is a `draw:frame` > `draw:text-box` with
 *   real paragraphs, placed by `boxOf` on the 12 × 6 grid (designSystem.ts). A
 *   metric with no figure reads "Not recorded", never 0. A card made of fields
 *   (D897), and the Sources appendix, are stacked text frames.
 * - **Images** are the export's fetched, byte-capped, sniffed set (PNG, JPEG,
 *   GIF, WebP; never SVG). One that could not be fetched says so in its frame.
 * - **Charts** are pictured from the print page when the headless browser can
 *   take them (`chartShot`, as the Google Slides export does), and otherwise
 *   written as their type and series. Either way a text frame under the chart
 *   carries its label and source line. A series with no recorded points reads
 *   "Not recorded", never a 0 bar. Nothing here redraws a chart, so nothing
 *   here can plot a figure the deck does not hold.
 * - **Speaker notes** are each page's `presentation:notes`, only when asked for.
 * - **Brand**: the venture owner's footer and watermark (`ventureBrand`).
 *
 * Every text node goes through `xmlEsc`. Nothing here logs a title, a figure or
 * a URL.
 */
import type { RenderableSlide } from './render';
import type { DeckBrand } from './branding';
import { buildZip, xmlEsc, type ZipEntry } from './pptx';
import { boxOf, SLIDE } from './designSystem';
import { IMAGE_MISSING, NOT_RECORDED, NO_NOTES, chartLabel, type ImageKind } from './offlineHtml';
import type { ChartShot, PlacedImage } from './pptxEditable';
import { tableLines } from './slideModel';

export const ODP_MIMETYPE = 'application/vnd.oasis.opendocument.presentation';
/** The page, at 16:9. */
export const PAGE_CM = Object.freeze({ width: 28, height: 15.75 });
/** At most this many chart pictures in one file; the rest are written as text. */
export const ODP_CHART_SHOTS_MAX = 30;

const CM_PER_PX = PAGE_CM.width / SLIDE.width;
const cm = (px: number) => `${(px * CM_PER_PX).toFixed(3)}cm`;
/** A slide pixel in points, at this page size (28cm = 793.7pt across 1920px). */
const pt = (px: number) => `${Math.max(6, Math.round(px * CM_PER_PX * 28.3465 * 10) / 10)}pt`;
const MEDIA_TYPE: Record<ImageKind, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const EXT: Record<ImageKind, string> = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' };
const COLOUR = /^#[0-9a-f]{6}$/i;

type Box = { x: number; y: number; w: number; h: number };
/** A paragraph: its style and its text, escaped when written. */
type Para = { style: 'H' | 'B' | 'M' | 'L' | 'V' | 'N' | 'S'; text: string };

/** Paragraph styles, in slide pixels: heading, body, muted, list item, metric value, not recorded, small. */
const PARA: Record<Para['style'], { size: number; bold?: boolean; italic?: boolean; color: string }> = {
  H: { size: 64, bold: true, color: '#0F172A' },
  B: { size: 30, color: '#0F172A' },
  M: { size: 22, bold: true, color: '#64748B' },
  L: { size: 30, color: '#0F172A' },
  V: { size: 60, bold: true, color: '#0F172A' },
  N: { size: 26, italic: true, color: '#64748B' },
  S: { size: 20, color: '#94A3B8' },
};

const para = (style: Para['style'], text: unknown): Para => ({ style, text: String(text ?? '') });
const paraXml = (p: Para) => `<text:p text:style-name="P${p.style}">${xmlEsc(p.text)}</text:p>`;

function frame(id: string, b: Box, inner: string, extra = ''): string {
  return `<draw:frame draw:name="${xmlEsc(id)}" svg:x="${cm(b.x)}" svg:y="${cm(b.y)}" svg:width="${cm(b.w)}" svg:height="${cm(b.h)}"${extra}>${inner}</draw:frame>`;
}
const textFrame = (id: string, b: Box, paras: Para[]) =>
  frame(id, b, `<draw:text-box>${paras.map(paraXml).join('')}</draw:text-box>`, ' draw:style-name="gr1"');

/** A chart's type and series as paragraphs; a series with no points is named, an empty chart is "Not recorded". */
export function chartParas(b: any): Para[] {
  const series = Array.isArray(b?.series) ? b.series : [];
  if (!series.length) return [para('N', NOT_RECORDED)];
  return series.map((sr: any) => {
    const label = String(sr?.label || sr?.binding?.source_key || 'Series');
    const pts = Array.isArray(sr?.points) ? sr.points : [];
    return pts.length ? para('B', `${label}: ${pts.map((p: any) => `${p?.x} ${p?.y}`).join(' · ')}`) : para('N', `${label}: ${NOT_RECORDED}`);
  });
}

/** The line under a chart: its label, then where its series come from. */
export function chartCaption(b: any): Para[] {
  const series = Array.isArray(b?.series) ? b.series : [];
  const sources = [...new Set(series.map((sr: any) => {
    const k = sr?.binding?.source_key;
    const at = sr?.binding?.as_of;
    return typeof k === 'string' && k ? `${k}${typeof at === 'string' && at ? `, as of ${at}` : ''}` : null;
  }).filter(Boolean))] as string[];
  return [para('M', `${chartLabel(b?.chart_type)} chart`), para('S', sources.length ? `Source: ${sources.join(' · ')}` : `Source: ${NOT_RECORDED}`)];
}

/** One block's paragraphs, or null when it draws nothing (an empty text block). */
export function blockParas(b: any): Para[] | null {
  switch (b?.kind) {
    case 'text': {
      const t = String(b.text ?? '').trim();
      if (!t) return null;
      if (b.style === 'heading') return [para('H', t)];
      if (b.style === 'list') return t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => para('L', `• ${l}`));
      return t.split(/\r?\n/).map((l) => para('B', l));
    }
    case 'metric': {
      const v = String(b.value ?? '').trim();
      return [para('M', String(b.label || 'Metric').toUpperCase()), v ? para('V', v) : para('N', NOT_RECORDED)];
    }
    case 'graphic': return [para('M', `Graphic · ${b.graphic || 'none chosen'}`)];
    // D1538: a typed table, one row per line; the header row as a label.
    case 'table': {
      const lines = tableLines(b);
      return lines.length ? lines.map((l, i) => para(i === 0 && b.header !== false ? 'M' : 'B', l)) : null;
    }
    case 'video': return [para('B', `▶ ${b.title || (b.provider === 'vimeo' ? 'Vimeo video' : 'YouTube video')}`), para('S', String(b.url || ''))];
    case 'audio':
    case 'link': return [para('B', b.label || (b.kind === 'audio' ? 'Audio clip' : 'Open')), para('S', String(b.url || ''))];
    default: return null;
  }
}

/** A card made of fields (D897), or the Sources appendix, as paragraphs. */
export function fieldParas(s: RenderableSlide): Para[] {
  const out: Para[] = [];
  for (const f of s.fields || []) {
    if (f.kind === 'title') continue;
    if (f.kind === 'subtitle') { if (String(f.value ?? '').trim()) out.push(para('M', f.value)); continue; }
    if (f.kind === 'bullets') { for (const v of Array.isArray(f.value) ? f.value : []) if (String(v ?? '').trim()) out.push(para('L', `• ${v}`)); continue; }
    if (f.kind === 'metric_grid') {
      for (const m of Array.isArray(f.value) ? f.value : []) {
        const v = String(m?.value ?? '').trim();
        out.push(para('M', String(m?.label || 'Metric').toUpperCase()), v ? para('V', v) : para('N', NOT_RECORDED));
      }
      continue;
    }
    if (f.kind === 'image') continue;
    const v = String(f.value ?? '').trim();
    out.push(v ? para('B', f.kind === 'quote' ? `“${v}”` : v) : para('N', `${f.label || 'Text'}: ${NOT_RECORDED}`));
  }
  return out;
}

export type OdpInput = {
  title: string;
  version: number | null;
  /** The stored slides, already sanitized; a slide with `blocks` is drawn from them. */
  slides: any[];
  /** The same deck in the text writer's shape, one per slide plus the Sources appendix when asked for. */
  renderable: RenderableSlide[];
  images: Map<string, PlacedImage>;
  brand: DeckBrand;
  notes: boolean;
  chartShot?: ChartShot | null;
};
export type OdpReport = { bytes: Uint8Array; charts: { pictured: number; as_text: number }; images: { placed: number; not_placed: number } };

/** The card's area below the title, in slide pixels, for a card without blocks. */
const TITLE_BOX = boxOf({ c1: 1, c2: 12, r1: 1, r2: 1 });
const BODY_BOX = boxOf({ c1: 1, c2: 12, r1: 2, r2: 6 });
const FOOT_Y = SLIDE.height - 64;

export async function writeOdp(input: OdpInput): Promise<OdpReport> {
  const enc = new TextEncoder();
  const pictures: Array<{ name: string; kind: ImageKind; data: Uint8Array }> = [];
  const counts = { pictured: 0, as_text: 0, placed: 0, not_placed: 0 };
  let shotsLeft = ODP_CHART_SHOTS_MAX;
  const picture = (kind: ImageKind, data: Uint8Array) => {
    const name = `Pictures/p${pictures.length + 1}.${EXT[kind]}`;
    pictures.push({ name, kind, data });
    return name;
  };
  const imageFrame = (id: string, b: Box, href: string, alt: string) =>
    frame(id, b, `<draw:image xlink:href="${xmlEsc(href)}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"><text:p/></draw:image>${alt ? `<svg:desc>${xmlEsc(alt)}</svg:desc>` : ''}`);
  const watermark = input.brand.watermark_url ? input.images.get(input.brand.watermark_url) ?? null : null;
  const watermarkHref = watermark ? picture(watermark.kind, watermark.bytes) : null;
  const total = input.renderable.length;
  const pages: string[] = [];
  const pageStyles: string[] = [];

  for (let i = 0; i < total; i += 1) {
    const stored = input.slides[i];
    const r = input.renderable[i];
    const shapes: string[] = [];
    let n = 0;
    const id = (kind: string) => `${kind} ${i + 1}.${++n}`;
    if (Array.isArray(stored?.blocks) && stored.blocks.length) {
      for (const b of stored.blocks) {
        const g = b?.grid || {};
        if (![g.c1, g.c2, g.r1, g.r2].every((v) => Number.isInteger(v))) continue;
        const box = boxOf(g);
        if (b.kind === 'image') {
          if (!b.image_url) continue;
          const img = input.images.get(b.image_url) ?? null;
          if (img) { shapes.push(imageFrame(id('Image'), box, picture(img.kind, img.bytes), String(b.alt || ''))); counts.placed += 1; }
          else { shapes.push(textFrame(id('Image'), box, [para('N', IMAGE_MISSING)])); counts.not_placed += 1; }
          continue;
        }
        if (b.kind === 'chart') {
          // The chart above, its label and source line in the frame under it.
          const capH = Math.min(96, Math.round(box.h * 0.3));
          const chartBox = { ...box, h: box.h - capH };
          const capBox = { ...box, y: box.y + box.h - capH, h: capH };
          let png: Uint8Array | null = null;
          if (input.chartShot && shotsLeft > 0) { shotsLeft -= 1; png = await input.chartShot(i, chartBox).catch(() => null); }
          if (png) { shapes.push(imageFrame(id('Chart'), chartBox, picture('png', png), `${chartLabel(b.chart_type)} chart`)); counts.pictured += 1; }
          else { shapes.push(textFrame(id('Chart'), chartBox, chartParas(b))); counts.as_text += 1; }
          shapes.push(textFrame(id('Chart caption'), capBox, chartCaption(b)));
          continue;
        }
        const paras = blockParas(b);
        if (paras) shapes.push(textFrame(id(String(b.kind)), box, paras));
      }
    } else if (r) {
      shapes.push(textFrame(id('Title'), TITLE_BOX, [para('H', r.title || 'Slide')]));
      const body = fieldParas(r);
      if (body.length) shapes.push(textFrame(id('Body'), BODY_BOX, body));
    }
    if (watermarkHref) shapes.push(imageFrame(id('Watermark'), { x: SLIDE.width - 112 - 160, y: FOOT_Y - 8, w: 160, h: 48 }, watermarkHref, ''));
    if (input.brand.show_footer) shapes.push(textFrame(id('Footer'), { x: 112, y: FOOT_Y, w: 1200, h: 40 }, [para('S', input.brand.footer_text)]));
    shapes.push(textFrame(id('Page number'), { x: SLIDE.width - 112 - 400, y: FOOT_Y + 32, w: 400, h: 32 }, [para('S', `${i + 1} / ${total}`)]));
    const bg = String(stored?.background?.color || '');
    const style = COLOUR.test(bg) ? `dp${i + 2}` : 'dp1';
    if (style !== 'dp1') pageStyles.push(`<style:style style:name="${style}" style:family="drawing-page"><style:drawing-page-properties draw:fill="solid" draw:fill-color="${bg.toUpperCase()}"/></style:style>`);
    const said = input.notes ? (String(stored?.notes ?? r?.notes ?? '').trim() || NO_NOTES) : '';
    const notes = input.notes
      ? `<presentation:notes><draw:page-thumbnail draw:page-number="${i + 1}" svg:x="2cm" svg:y="1cm" svg:width="17cm" svg:height="9.56cm"/>${frame('Notes', { x: 0, y: 1300, w: 1920, h: 800 }, `<draw:text-box>${said.split(/\r?\n/).map((l) => paraXml(para('B', l))).join('')}</draw:text-box>`, ' presentation:class="notes"')}</presentation:notes>`
      : '';
    pages.push(`<draw:page draw:name="${xmlEsc(`Slide ${i + 1}`)}" draw:style-name="${style}" draw:master-page-name="Default">${shapes.join('')}${notes}</draw:page>`);
  }

  const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"';
  const paraStyles = (Object.keys(PARA) as Para['style'][]).map((k) => {
    const s = PARA[k];
    return `<style:style style:name="P${k}" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.1cm"/><style:text-properties fo:font-size="${pt(s.size)}" fo:color="${s.color}"${s.bold ? ' fo:font-weight="bold"' : ''}${s.italic ? ' fo:font-style="italic"' : ''}/></style:style>`;
  }).join('');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS} office:version="1.3"><office:automatic-styles>${paraStyles}<style:style style:name="dp1" style:family="drawing-page"/>${pageStyles.join('')}<style:style style:name="gr1" style:family="graphic"><style:graphic-properties draw:stroke="none" draw:fill="none" draw:textarea-vertical-align="top" draw:auto-grow-height="false" fo:padding="0cm"/></style:style></office:automatic-styles><office:body><office:presentation>${pages.join('')}</office:presentation></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NS} office:version="1.3"><office:styles><style:default-style style:family="graphic"><style:text-properties fo:font-family="Inter, Helvetica, Arial, sans-serif"/></style:default-style></office:styles><office:automatic-styles><style:page-layout style:name="PM1"><style:page-layout-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:margin-left="0cm" fo:margin-right="0cm" fo:page-width="${PAGE_CM.width}cm" fo:page-height="${PAGE_CM.height}cm" style:print-orientation="landscape"/></style:page-layout><style:style style:name="Mdp1" style:family="drawing-page"><style:drawing-page-properties draw:fill="solid" draw:fill-color="#FFFFFF"/></style:style></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="PM1" draw:style-name="Mdp1"/></office:master-styles></office:document-styles>`;
  const meta = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta ${NS} office:version="1.3"><office:meta><meta:generator>StudioOS</meta:generator><dc:title>${xmlEsc(input.version == null ? input.title : `${input.title} · v${input.version}`)}</dc:title></office:meta></office:document-meta>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${ODP_MIMETYPE}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${pictures.map((p) => `<manifest:file-entry manifest:full-path="${p.name}" manifest:media-type="${MEDIA_TYPE[p.kind]}"/>`).join('')}</manifest:manifest>`;

  const entries: ZipEntry[] = [
    // ODF: the first entry, stored, with no extra field (buildZip writes none).
    { name: 'mimetype', data: enc.encode(ODP_MIMETYPE) },
    { name: 'META-INF/manifest.xml', data: enc.encode(manifest) },
    { name: 'content.xml', data: enc.encode(content) },
    { name: 'styles.xml', data: enc.encode(styles) },
    { name: 'meta.xml', data: enc.encode(meta) },
    ...pictures.map((p) => ({ name: p.name, data: p.data })),
  ];
  return {
    bytes: buildZip(entries),
    charts: { pictured: counts.pictured, as_text: counts.as_text },
    images: { placed: counts.placed, not_placed: counts.not_placed },
  };
}
