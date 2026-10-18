// D711 (#1776) — a template's Word export, with no new dependency.
//
// `buildLegalDocx(model, { pageSize })` writes the paper model as a .docx:
// the eight parts below, packed by the store-mode zip writer (util/zip.ts;
// text entries only, which is all an image-free Word file needs). Blocks
// become styles (Title, Article, Section, Body, Recital, a bordered Legend
// and Warning), tables get a repeating header and a totals row, checkboxes
// are ☐ and ☒, and the page state is a header line. A cover slug gets the
// light cover, a TOC field, and two sections numbered lower-roman, then from
// 1. The file names the brand faces and embeds none; it has no external
// relationship, macro or image, and its core properties name "Axal VC" as
// creator and no person. Templates only: a signed envelope's record is its
// PDF (decision 5).

import { buildZip } from '../util/zip';
import type { Block, Run } from './legalPaperBlocks';
import type { PaperModel, PaperParty } from './legalPaper';
import { stateLabel } from './legalPaper';
import type { PaperPageSize } from './legalPaperCss';

export const DOCX_PAGE_TWIPS: Record<PaperPageSize, [number, number]> = {
  letter: [12240, 15840],
  a4: [11906, 16838],
};
const MARGIN_TWIPS = 1080;

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Escape text for XML, dropping characters XML 1.0 cannot carry. */
export function xmlText(s: string): string {
  return String(s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function t(text: string): string {
  return `<w:t xml:space="preserve">${xmlText(text)}</w:t>`;
}

function run(text: string, props = ''): string {
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${t(text)}</w:r>`;
}

function runsXml(runs: Run[]): string {
  return runs.map((r) => {
    switch (r.k) {
      case 'bold': case 'term': return run(r.text, '<w:b/>');
      case 'em': return run(r.text, '<w:i/>');
      case 'merge': return run(r.text, '<w:shd w:val="clear" w:color="auto" w:fill="EDE9FE"/>');
      case 'fill': return run('________________');
      case 'box': return run(r.checked ? '☒' : '☐');
      default: return run(r.text);
    }
  }).join('');
}

function p(style: string, inner: string, extra = ''): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr>${inner}</w:p>`;
}

function blockXml(b: Block): string {
  switch (b.t) {
    case 'title':
    case 'recitals': return p('Article', runsXml(b.runs));
    case 'article': return p('Article', runsXml(b.runs));
    case 'section': return p('Section', runsXml(b.runs));
    case 'recital': return p('Recital', runsXml(b.runs));
    case 'schedule':
      return p('Schedule', runsXml(b.runs)) + (b.dateline ? p('Dateline', runsXml(b.dateline)) : '');
    case 'para': {
      const runIn = b.runIn ? runsXml(b.runIn.map((r) => ('text' in r ? { k: 'bold', text: r.text } as Run : r))) + run('. ', '<w:b/>') : '';
      if (b.num) {
        const left = 480 * b.depth;
        return p('Body', run(b.num, '<w:b/><w:color w:val="6D28D9"/>') + run('\t') + runIn + runsXml(b.runs),
          `<w:tabs><w:tab w:val="left" w:pos="${left}"/></w:tabs><w:ind w:left="${left}" w:hanging="480"/>`);
      }
      return p('Body', runIn + runsXml(b.runs));
    }
    case 'bullets':
      return b.items.map((i) => p('Body', run('•\t') + runsXml(i), '<w:ind w:left="480" w:hanging="240"/>')).join('');
    case 'table': {
      const n = Math.max(1, b.head.length);
      const width = Math.floor((DOCX_PAGE_TWIPS.letter[0] - 2 * MARGIN_TWIPS) / n);
      const jc = (c: number) => (b.align[c] === 'right' ? '<w:jc w:val="right"/>' : b.align[c] === 'center' ? '<w:jc w:val="center"/>' : '');
      const cell = (runs: Run[], c: number, props: string, rPr: string) =>
        `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${props}</w:tcPr><w:p><w:pPr><w:pStyle w:val="TableText"/>${jc(c)}</w:pPr>`
        + runs.map((r) => ('text' in r ? run(r.text, rPr + (b.mono[c] ? '<w:rFonts w:ascii="Roboto Mono" w:hAnsi="Roboto Mono"/>' : '')) : runsXml([r]))).join('')
        + '</w:p></w:tc>';
      const head = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${b.head.map((h, c) => cell(h, c,
        '<w:tcBorders><w:bottom w:val="single" w:sz="6" w:color="1F1D2B"/></w:tcBorders>', '<w:b/><w:caps/><w:color w:val="6D28D9"/>')).join('')}</w:tr>`;
      const rows = b.rows.map((r, i) => {
        const total = b.total && i === b.rows.length - 1;
        const border = total
          ? '<w:tcBorders><w:top w:val="single" w:sz="10" w:color="1F1D2B"/></w:tcBorders>'
          : '<w:tcBorders><w:bottom w:val="single" w:sz="4" w:color="D4D2DC"/></w:tcBorders>';
        return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((cellRuns, c) => cell(cellRuns, c, border, total ? '<w:b/>' : '')).join('')}</w:tr>`;
      }).join('');
      return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/></w:tblPr>`
        + `<w:tblGrid>${Array.from({ length: n }, () => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${head}${rows}</w:tbl>`
        + p('Body', '');
    }
    case 'legend':
      return b.paras.map((para) => p(b.warning ? 'Warning' : 'Legend', runsXml(para))).join('');
    case 'check': return p('Body', run(b.checked ? '☒ ' : '☐ ') + runsXml(b.runs));
    case 'rule': return p('Body', '', '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="D4D2DC"/></w:pBdr>');
  }
}

function partyXml(party: PaperParty): string {
  const ind = party.through ? '<w:ind w:left="240"/>' : '';
  return p('PartyHeading', run(party.heading, '<w:b/>'))
    + (party.through ? p('Body', run(party.through)) : '')
    + [party.by, party.name, party.title, party.date].map((l) => p('Body', run(l), ind)).join('')
    + p('Body', '');
}

function sectPr(pageSize: PaperPageSize, fmt: 'lowerRoman' | 'decimal', withRefs: boolean): string {
  const [w, h] = DOCX_PAGE_TWIPS[pageSize];
  return '<w:sectPr>'
    + (withRefs ? '<w:headerReference w:type="default" r:id="rIdHeader1"/><w:footerReference w:type="default" r:id="rIdFooter1"/>' : '')
    + `<w:pgSz w:w="${w}" w:h="${h}"/>`
    + `<w:pgMar w:top="${MARGIN_TWIPS}" w:right="${MARGIN_TWIPS}" w:bottom="${MARGIN_TWIPS}" w:left="${MARGIN_TWIPS}" w:header="540" w:footer="540" w:gutter="0"/>`
    + `<w:pgNumType w:fmt="${fmt}" w:start="1"/>`
    + '</w:sectPr>';
}

function documentXml(m: PaperModel, pageSize: PaperPageSize): string {
  const parts: string[] = [];
  if (m.cover) {
    const c = m.cover;
    parts.push(p('CoverFund', run(c.fund)));
    parts.push(p('CoverTitle', run(c.name)));
    parts.push(p('Eyebrow', run('Confidential')));
    parts.push(p('Body', run('Copy No.: ', '<w:b/>') + run(c.copyNumber || '________________')));
    parts.push(p('Body', run('Prepared for: ', '<w:b/>') + run(c.preparedFor || '________________')));
    parts.push(p('Body', run('Date: ', '<w:b/>') + run(c.date || '________________')));
    for (const l of c.legends) parts.push(blockXml(l));
    parts.push(p('Body', '<w:r><w:br w:type="page"/></w:r>'));
    parts.push(p('Eyebrow', run('Contents')));
    parts.push(`<w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr><w:fldSimple w:instr=" TOC \\o &quot;1-1&quot; \\h \\z \\u "><w:r>${t('Update this field to list the articles and their pages.')}</w:r></w:fldSimple></w:p>`);
    // Section 1 (front matter) ends here, numbered i, ii, …
    parts.push(`<w:p><w:pPr>${sectPr(pageSize, 'lowerRoman', true)}</w:pPr></w:p>`);
  }
  if (m.restricted) parts.push(p('Eyebrow', run('Confidential — GP and LPAC only')));
  parts.push(p('Title', run(m.title)));
  if (m.preamble) parts.push(p('Body', run(m.preamble)));
  for (const b of m.blocks) parts.push(blockXml(b));
  if (m.execution) {
    parts.push(p('Body', run('[Signature page follows]', '<w:i/>'), '<w:jc w:val="center"/>'));
    parts.push(p('Eyebrow', run('Execution'), '<w:pageBreakBefore/>'));
    parts.push(p('Recital', run(m.execution.recital, '<w:i/>')));
    for (const party of m.execution.parties) parts.push(partyXml(party));
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${parts.join('')}${sectPr(pageSize, 'decimal', true)}</w:body></w:document>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Public Sans" w:hAnsi="Public Sans" w:cs="Public Sans" w:eastAsia="Public Sans"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:color w:val="1F1D2B"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="280" w:lineRule="exact"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Body"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240" w:line="360" w:lineRule="auto"/><w:keepNext/></w:pPr><w:rPr><w:rFonts w:ascii="Bricolage Grotesque" w:hAnsi="Bricolage Grotesque"/><w:b/><w:caps/><w:sz w:val="30"/><w:color w:val="111018"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Article"><w:name w:val="Article"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="120" w:line="300" w:lineRule="auto"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Bricolage Grotesque" w:hAnsi="Bricolage Grotesque"/><w:b/><w:sz w:val="23"/><w:color w:val="111018"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Section"><w:name w:val="Section"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Recital"><w:name w:val="Recital"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="480"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Schedule"><w:name w:val="Schedule"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:keepNext/><w:spacing w:before="280" w:after="40"/></w:pPr><w:rPr><w:rFonts w:ascii="Bricolage Grotesque" w:hAnsi="Bricolage Grotesque"/><w:b/><w:caps/><w:sz w:val="23"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Dateline"><w:name w:val="Dateline"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="6B6577"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Legend"><w:name w:val="Legend"/><w:basedOn w:val="Normal"/><w:pPr><w:keepLines/><w:pBdr><w:top w:val="single" w:sz="6" w:space="4" w:color="1F1D2B"/><w:left w:val="single" w:sz="6" w:space="4" w:color="1F1D2B"/><w:bottom w:val="single" w:sz="6" w:space="4" w:color="1F1D2B"/><w:right w:val="single" w:sz="6" w:space="4" w:color="1F1D2B"/></w:pBdr></w:pPr><w:rPr><w:caps/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Warning"><w:name w:val="Warning"/><w:basedOn w:val="Legend"/><w:pPr><w:pBdr><w:top w:val="single" w:sz="10" w:space="4" w:color="1F1D2B"/><w:left w:val="single" w:sz="10" w:space="4" w:color="1F1D2B"/><w:bottom w:val="single" w:sz="10" w:space="4" w:color="1F1D2B"/><w:right w:val="single" w:sz="10" w:space="4" w:color="1F1D2B"/></w:pBdr></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Eyebrow"><w:name w:val="Eyebrow"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:caps/><w:spacing w:val="20"/><w:sz w:val="16"/><w:color w:val="6D28D9"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="PartyHeading"><w:name w:val="Party Heading"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="40"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="CoverFund"><w:name w:val="Cover Fund"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="2400"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="CoverTitle"><w:name w:val="Cover Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="360" w:line="600" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Bricolage Grotesque" w:hAnsi="Bricolage Grotesque"/><w:b/><w:caps/><w:sz w:val="52"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="HeaderLine"><w:name w:val="Header Line"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="16"/><w:color w:val="6B6577"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="FooterLine"><w:name w:val="Footer Line"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="16"/><w:color w:val="6B6577"/></w:rPr></w:style>
</w:styles>`;

function headerXml(m: PaperModel, pageSize: PaperPageSize): string {
  const right = DOCX_PAGE_TWIPS[pageSize][0] - 2 * MARGIN_TWIPS;
  const state = m.state.kind === 'draft' ? 'DRAFT — for counsel review' : stateLabel(m.state);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${W_NS}" xmlns:r="${R_NS}">`
    + `<w:p><w:pPr><w:pStyle w:val="HeaderLine"/><w:tabs><w:tab w:val="right" w:pos="${right}"/></w:tabs>`
    + '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="D4D2DC"/></w:pBdr></w:pPr>'
    + run('AXAL VC', '<w:rFonts w:ascii="Space Grotesk" w:hAnsi="Space Grotesk"/><w:b/><w:color w:val="6D28D9"/><w:sz w:val="20"/>')
    + run('\tCONFIDENTIAL', '<w:b/><w:color w:val="6D28D9"/><w:spacing w:val="20"/>') + '</w:p>'
    + `<w:p><w:pPr><w:pStyle w:val="HeaderLine"/></w:pPr>${run(state, '<w:b/>')}</w:p>`
    + '</w:hdr>';
}

function footerXml(m: PaperModel, pageSize: PaperPageSize): string {
  const right = DOCX_PAGE_TWIPS[pageSize][0] - 2 * MARGIN_TWIPS;
  const fld = (instr: string) => `<w:fldSimple w:instr=" ${instr} "><w:r>${t('1')}</w:r></w:fldSimple>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${W_NS}" xmlns:r="${R_NS}">`
    + `<w:p><w:pPr><w:pStyle w:val="FooterLine"/><w:tabs><w:tab w:val="right" w:pos="${right}"/></w:tabs></w:pPr>`
    + run(m.footerLeft) + run('\tPage ') + fld('PAGE') + run(' of ') + fld('NUMPAGES') + '</w:p>'
    + `<w:p><w:pPr><w:pStyle w:val="FooterLine"/></w:pPr>${run(m.auditLine, '<w:rFonts w:ascii="Roboto Mono" w:hAnsi="Roboto Mono"/><w:sz w:val="13"/>')}</w:p>`
    + '</w:ftr>';
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`;

function coreXml(m: PaperModel, now: Date): string {
  const at = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${xmlText(m.title)}</dc:title><dc:creator>Axal VC</dc:creator><cp:lastModifiedBy>Axal VC</cp:lastModifiedBy>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${at}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${at}</dcterms:modified>`
    + '</cp:coreProperties>';
}

export interface DocxOptions {
  pageSize: PaperPageSize;
  now?: Date;
}

export function buildLegalDocx(model: PaperModel, opts: DocxOptions): Uint8Array {
  const pageSize = opts.pageSize === 'a4' ? 'a4' : 'letter';
  return buildZip([
    { name: '[Content_Types].xml', content: CONTENT_TYPES },
    { name: '_rels/.rels', content: ROOT_RELS },
    { name: 'word/document.xml', content: documentXml(model, pageSize) },
    { name: 'word/styles.xml', content: STYLES },
    { name: 'word/header1.xml', content: headerXml(model, pageSize) },
    { name: 'word/footer1.xml', content: footerXml(model, pageSize) },
    { name: 'word/_rels/document.xml.rels', content: DOCUMENT_RELS },
    { name: 'docProps/core.xml', content: coreXml(model, opts.now || new Date()) },
  ]);
}

/** `<slug>-v<N>.docx`, each slug character outside [A-Za-z0-9_-] as `-`. */
export function docxFilename(slug: string, version: number | null): string {
  const safe = String(slug || 'template').replace(/[^A-Za-z0-9_-]/g, '-');
  return version ? `${safe}-v${version}.docx` : `${safe}.docx`;
}
