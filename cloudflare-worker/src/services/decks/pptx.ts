/**
 * Task #16 (DE) — Minimal PPTX writer.
 *
 * Produces a valid PowerPoint .pptx (Office Open XML) file from a
 * FilledDeck. We avoid the `pptxgenjs` dependency (bundle bloat +
 * Workers compatibility quirks) by emitting the OOXML parts directly
 * and packaging them as a STORE-mode (uncompressed) zip — PowerPoint,
 * Keynote, and Google Slides all accept stored zips.
 *
 * Layout: every slide is a 13.333" × 7.5" widescreen slide with a title
 * bar, optional subtitle, and one rendered text frame per field. Image
 * + metric_grid fields render as captioned text blocks (we don't embed
 * remote images to keep the writer dependency-free and avoid network).
 */
import type { RenderableDeck, RenderableField, RenderableSlide } from './render';
import type { DeckBrand } from './branding';

// ---------------------------------------------------------------------
// Tiny store-mode zip writer (CRC-32 + central directory).
// ---------------------------------------------------------------------
type ZipEntry = { name: string; data: Uint8Array };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n & 0xFFFF, true);
  return b;
}
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}
function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function buildZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;
    const localHeader = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(name.length), u16(0),
      name, e.data,
    ]);
    local.push(localHeader);
    const centralHeader = concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]);
    central.push(centralHeader);
    offset += localHeader.length;
  }

  const centralBytes = concat(central);
  const eocd = concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(entries.length), u16(entries.length),
    u32(centralBytes.length), u32(offset), u16(0),
  ]);
  return concat([...local, centralBytes, eocd]);
}

// ---------------------------------------------------------------------
// OOXML helpers.
// ---------------------------------------------------------------------
function xmlEsc(s: any): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string));
}

function tf(text: string, opts: { bold?: boolean; size?: number; color?: string; italic?: boolean } = {}): string {
  const sz = opts.size ?? 18;
  const b = opts.bold ? '1' : '0';
  const it = opts.italic ? '1' : '0';
  const col = (opts.color || '111827').replace('#', '');
  // PowerPoint sizes are in hundredths of a point.
  return `<a:r><a:rPr lang="en-US" sz="${sz * 100}" b="${b}" i="${it}"><a:solidFill><a:srgbClr val="${col}"/></a:solidFill></a:rPr><a:t>${xmlEsc(text)}</a:t></a:r>`;
}

function shape(id: number, name: string, x: number, y: number, cx: number, cy: number, paragraphs: string[]): string {
  // EMU = English metric unit = 914400 / inch.
  const emu = (n: number) => Math.round(n * 914400);
  const body = paragraphs.map((p) => `<a:p>${p}</a:p>`).join('');
  return `<p:sp>
  <p:nvSpPr><p:cNvPr id="${id}" name="${xmlEsc(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
  <p:spPr>
    <a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(cx)}" cy="${emu(cy)}"/></a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
  </p:spPr>
  <p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="t"/><a:lstStyle/>${body}</p:txBody>
</p:sp>`;
}

function fieldToParagraphs(f: RenderableField): string[] {
  if (f.kind === 'title') {
    return [tf(String(f.value || ''), { bold: true, size: 36, color: '0F172A' })];
  }
  if (f.kind === 'subtitle') {
    return [tf(String(f.value || ''), { size: 18, color: '7C3AED' })];
  }
  if (f.kind === 'paragraph') {
    return [tf(String(f.value || ''), { size: 16, color: '334155' })];
  }
  if (f.kind === 'quote') {
    return f.value ? [tf(`"${String(f.value)}"`, { size: 18, italic: true, color: '475569' })] : [];
  }
  if (f.kind === 'bullets') {
    const arr = Array.isArray(f.value) ? f.value : [];
    return arr.map((b: any) => `<a:pPr><a:buChar char="▸"/></a:pPr>${tf('  ' + String(b), { size: 16, color: '1F2937' })}`);
  }
  if (f.kind === 'metric_grid') {
    const cells = Array.isArray(f.value) ? f.value : [];
    return cells.map((c: any) => tf(`${c.label}: ${c.value}`, { size: 16, bold: true, color: '0F172A' }));
  }
  if (f.kind === 'image') {
    return f.value ? [tf(`[Image: ${String(f.value).slice(0, 80)}]`, { size: 12, italic: true, color: '94A3B8' })] : [];
  }
  return [];
}

function buildSlideXml(slide: RenderableSlide, brand: DeckBrand, idx: number, total: number): string {
  const shapes: string[] = [];
  let id = 2;
  // Title bar.
  shapes.push(shape(id++, 'Title', 0.5, 0.3, 12.3, 0.8, [
    tf(slide.title || 'Slide', { bold: true, size: 30, color: '0F172A' }),
  ]));
  if (slide.subtitle) {
    shapes.push(shape(id++, 'Subtitle', 0.5, 1.1, 12.3, 0.4, [
      tf(slide.subtitle, { size: 14, color: '7C3AED' }),
    ]));
  }
  // Body — stack each field vertically.
  let y = 1.7;
  for (const f of slide.fields) {
    const paras = fieldToParagraphs(f);
    if (!paras.length) continue;
    const heightPerLine = f.kind === 'title' ? 0.7 : f.kind === 'subtitle' ? 0.5 : 0.45;
    const cy = Math.max(heightPerLine, paras.length * heightPerLine);
    if (y + cy > 6.9) break;
    shapes.push(shape(id++, f.key, 0.5, y, 12.3, cy, paras));
    y += cy + 0.1;
  }
  // Footer.
  if (brand.show_footer) {
    shapes.push(shape(id++, 'Footer', 0.5, 7.0, 9, 0.3, [
      tf(brand.footer_text, { size: 10, color: '94A3B8' }),
    ]));
  }
  shapes.push(shape(id++, 'PageNo', 11.5, 7.0, 1.3, 0.3, [
    tf(`${idx + 1} / ${total}`, { size: 10, color: '94A3B8' }),
  ]));

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    ${shapes.join('\n')}
  </p:spTree></p:cSld>
</p:sld>`;
}

// ---------------------------------------------------------------------
// Build full pptx package.
// ---------------------------------------------------------------------
export function renderDeckPPTX(deck: RenderableDeck, brand: DeckBrand): Uint8Array {
  const enc = new TextEncoder();
  const slideCount = deck.slides.length;
  const entries: ZipEntry[] = [];

  // [Content_Types].xml — must list every part type.
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${deck.slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}
</Types>`;
  entries.push({ name: '[Content_Types].xml', data: enc.encode(contentTypes) });

  // _rels/.rels
  entries.push({
    name: '_rels/.rels',
    data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`),
  });

  // ppt/presentation.xml — references slide ids and master.
  const slideIds = deck.slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('');
  const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                saveSubsetFonts="1">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${slideIds}</p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
  entries.push({ name: 'ppt/presentation.xml', data: enc.encode(presentation) });

  // ppt/_rels/presentation.xml.rels
  const presRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${deck.slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}
</Relationships>`;
  entries.push({ name: 'ppt/_rels/presentation.xml.rels', data: enc.encode(presRels) });

  // Theme + slide master + slide layout — minimal but valid.
  entries.push({
    name: 'ppt/theme/theme1.xml',
    data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2>
      <a:accent1><a:srgbClr val="7C3AED"/></a:accent1><a:accent2><a:srgbClr val="A78BFA"/></a:accent2>
      <a:accent3><a:srgbClr val="C4B5FD"/></a:accent3><a:accent4><a:srgbClr val="EDE9FE"/></a:accent4>
      <a:accent5><a:srgbClr val="6D28D9"/></a:accent5><a:accent6><a:srgbClr val="4C1D95"/></a:accent6>
      <a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="6D28D9"/></a:folHlink></a:clrScheme>
    <a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
    <a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln/><a:ln/><a:ln/></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
  </a:themeElements>
</a:theme>`),
  });

  entries.push({
    name: 'ppt/slideMasters/slideMaster1.xml',
    data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
    <p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`),
  });

  entries.push({
    name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`),
  });

  entries.push({
    name: 'ppt/slideLayouts/slideLayout1.xml',
    data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
  </p:spTree></p:cSld>
</p:sldLayout>`),
  });

  entries.push({
    name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`),
  });

  // Slides + their rels.
  deck.slides.forEach((slide, i) => {
    entries.push({
      name: `ppt/slides/slide${i + 1}.xml`,
      data: enc.encode(buildSlideXml(slide, brand, i, slideCount)),
    });
    entries.push({
      name: `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`),
    });
  });

  return buildZip(entries);
}
