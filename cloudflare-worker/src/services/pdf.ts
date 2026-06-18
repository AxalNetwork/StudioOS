/**
 * PDF generation for the legal-document + eSignature pipeline.
 *
 * Every legal PDF is assembled from four static components wrapped around the
 * dynamic clause body (see `legalDocFormat.ts`):
 *
 *   1. Header   — "AXAL VC" (brand, left) + "CONFIDENTIAL" (right) + rule, on
 *                 every page, followed on page 1 by the centred, bold,
 *                 UPPERCASE document title.
 *   2. Preamble — the standardized "made and entered into as of … by and
 *                 between <Axal entity> … and <Counterparty>" paragraph
 *                 (agreements only).
 *   3. Body     — the substantive clauses, Markdown-normalised to clean legal
 *                 text with hierarchical numbering preserved.
 *   4. Footer   — "<Title> — v<N>" (left) + "Page X of Y" (right) on every
 *                 page, over a tamper-evident audit sub-line (SHA-256 +
 *                 envelope id).
 *   + Execution — the dual signature block (Axal + Counterparty) at the very
 *                 bottom; the signer's signature image is embedded for signed
 *                 agreements.
 *
 * Renderer is pdf-lib (~120KB gzipped, pure JS, runs on Workers). Word-wrap is
 * character-width estimation against StandardFonts.Helvetica's per-glyph
 * widths — good enough for legal text without a full text-shaping engine.
 */
import { PDFDocument, StandardFonts, rgb, degrees, PDFFont, PDFPage, PDFImage } from 'pdf-lib';
import type { RGB } from 'pdf-lib';
import {
  normalizeLegalBody,
  stripTrailingSignatureBlock,
  buildPreamble,
  buildExecutionBlock,
  classifyDocument,
  axalEntityKeyForDoc,
  AXAL_ENTITIES,
  AXAL_LEGAL_EMAIL,
  winAnsiSafe,
  type AxalEntityKey,
  type DocumentKind,
  type ExecutionBlock,
} from './legalDocFormat';

const PAGE_WIDTH = 612;   // US Letter
const PAGE_HEIGHT = 792;
const MARGIN_X = 54;
const CONTENT_TOP = PAGE_HEIGHT - 74;   // first content baseline (below header rule)
const CONTENT_BOTTOM = 66;              // lowest content baseline (above footer)
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN_X;

const BODY_FONT_SIZE = 10.5;
const BODY_LINE_HEIGHT = 14;
const TITLE_FONT_SIZE = 15;

const INK = rgb(0.13, 0.17, 0.22);
const INK_STRONG = rgb(0.07, 0.09, 0.15);
const BRAND = rgb(0.486, 0.227, 0.929);
const MUTED = rgb(0.55, 0.55, 0.58);
const LINE = rgb(0.85, 0.85, 0.85);
const CONFIDENTIAL = rgb(0.62, 0.2, 0.22);

interface Fonts { regular: PDFFont; bold: PDFFont; italic: PDFFont }
type FontName = 'regular' | 'bold' | 'italic';

// --- low-level text helpers -------------------------------------------------

function wrapTextToWidth(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (rawLine.trim() === '') { lines.push(''); continue; }
    const words = rawLine.split(/\s+/);
    let cur = '';
    for (const word of words) {
      const trial = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(trial, fontSize) <= maxWidth) {
        cur = trial;
      } else {
        if (cur) lines.push(cur);
        if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
          // Hard-break a single over-long token (e.g. a long URL or blank run).
          let chunk = '';
          for (const ch of word) {
            if (font.widthOfTextAtSize(chunk + ch, fontSize) > maxWidth) {
              lines.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          cur = chunk;
        } else {
          cur = word;
        }
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

/**
 * Procedural layout cursor: draws top-to-bottom, opening new pages as needed.
 * Header/footer/watermark are painted afterwards (they need the final page
 * count), so the cursor only tracks body content and page breaks.
 */
class Cursor {
  doc: PDFDocument;
  f: Fonts;
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;

  constructor(doc: PDFDocument, f: Fonts) {
    this.doc = doc;
    this.f = f;
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.page);
    this.y = CONTENT_TOP;
  }

  /** Ensure `h` points of vertical space remain, else break to a new page. */
  need(h: number) {
    if (this.y - h < CONTENT_BOTTOM) this.newPage();
  }

  gap(h: number) { this.y -= h; }

  private fontFor(name: FontName): PDFFont {
    return name === 'bold' ? this.f.bold : name === 'italic' ? this.f.italic : this.f.regular;
  }

  /** Draw one already-wrapped line at the current cursor (no wrapping). */
  private drawRaw(text: string, opts: { size: number; font: FontName; align?: 'left' | 'center'; color?: RGB; indent?: number }) {
    const font = this.fontFor(opts.font);
    const safe = winAnsiSafe(text);
    let x = MARGIN_X + (opts.indent || 0);
    if (opts.align === 'center') {
      x = (PAGE_WIDTH - font.widthOfTextAtSize(safe, opts.size)) / 2;
    }
    this.page.drawText(safe, { x, y: this.y, size: opts.size, font, color: opts.color || INK });
  }

  /** Wrap `text` and draw it, advancing the cursor and paginating per line. */
  paragraph(text: string, opts: { size?: number; font?: FontName; align?: 'left' | 'center'; color?: RGB; lineHeight?: number; indent?: number } = {}) {
    const size = opts.size ?? BODY_FONT_SIZE;
    const lh = opts.lineHeight ?? BODY_LINE_HEIGHT;
    const font = this.fontFor(opts.font || 'regular');
    const indent = opts.indent || 0;
    const lines = wrapTextToWidth(text, font, size, CONTENT_WIDTH - indent);
    for (const line of lines) {
      this.need(lh);
      if (line) this.drawRaw(line, { size, font: opts.font || 'regular', align: opts.align, color: opts.color, indent });
      this.y -= lh;
    }
  }

  rule(opts: { gapBefore?: number; gapAfter?: number; color?: RGB; width?: number } = {}) {
    this.gap(opts.gapBefore ?? 0);
    this.need(2);
    const w = opts.width ?? CONTENT_WIDTH;
    this.page.drawLine({
      start: { x: MARGIN_X, y: this.y },
      end: { x: MARGIN_X + w, y: this.y },
      thickness: 0.5, color: opts.color || LINE,
    });
    this.gap(opts.gapAfter ?? 0);
  }

  image(img: PDFImage, w: number, h: number) {
    this.need(h);
    this.page.drawImage(img, { x: MARGIN_X, y: this.y - h, width: w, height: h });
    this.y -= h;
  }
}

// --- header / footer / watermark (painted once per page, post-layout) -------

function drawHeader(page: PDFPage, f: Fonts) {
  page.drawText('AXAL VC', { x: MARGIN_X, y: PAGE_HEIGHT - 38, size: 10, font: f.bold, color: BRAND });
  const conf = 'CONFIDENTIAL';
  page.drawText(conf, {
    x: PAGE_WIDTH - MARGIN_X - f.bold.widthOfTextAtSize(conf, 8.5),
    y: PAGE_HEIGHT - 38, size: 8.5, font: f.bold, color: CONFIDENTIAL,
  });
  page.drawLine({
    start: { x: MARGIN_X, y: PAGE_HEIGHT - 50 }, end: { x: PAGE_WIDTH - MARGIN_X, y: PAGE_HEIGHT - 50 },
    thickness: 0.5, color: LINE,
  });
}

function drawFooter(
  page: PDFPage, f: Fonts, pageNum: number, totalPages: number,
  title: string, version: number, bodySha: string, envelopeUuid: string,
) {
  page.drawLine({
    start: { x: MARGIN_X, y: 52 }, end: { x: PAGE_WIDTH - MARGIN_X, y: 52 },
    thickness: 0.5, color: LINE,
  });
  // Required footer line: "<Title> — v<N>"  /  "Page X of Y".
  const left = winAnsiSafe(`${title} — v${version}`);
  let leftFit = left;
  while (leftFit.length > 8 && f.regular.widthOfTextAtSize(leftFit, 8) > CONTENT_WIDTH * 0.62) {
    leftFit = leftFit.slice(0, -2);
  }
  if (leftFit !== left) leftFit = leftFit.replace(/[\s—-]+$/, '') + '…';
  page.drawText(leftFit, { x: MARGIN_X, y: 40, size: 8, font: f.regular, color: MUTED });
  const pageStr = `Page ${pageNum} of ${totalPages}`;
  page.drawText(pageStr, {
    x: PAGE_WIDTH - MARGIN_X - f.regular.widthOfTextAtSize(pageStr, 8), y: 40, size: 8, font: f.regular, color: MUTED,
  });
  // Audit sub-line: SHA-256 (tamper-evidence) + envelope id.
  page.drawText(`SHA-256: ${bodySha.slice(0, 32)}…`, { x: MARGIN_X, y: 30, size: 6.5, font: f.regular, color: rgb(0.6, 0.6, 0.62) });
  const env = winAnsiSafe(`${AXAL_LEGAL_EMAIL} · ${envelopeUuid}`);
  page.drawText(env, {
    x: PAGE_WIDTH - MARGIN_X - f.regular.widthOfTextAtSize(env, 6.5), y: 30, size: 6.5, font: f.regular, color: rgb(0.6, 0.6, 0.62),
  });
}

function drawWatermark(page: PDFPage, font: PDFFont, text: string) {
  page.drawText(text, {
    x: PAGE_WIDTH / 2 - font.widthOfTextAtSize(text, 48) / 2,
    y: PAGE_HEIGHT / 2, size: 48, font, color: rgb(0.85, 0.85, 0.85), opacity: 0.2, rotate: degrees(45),
  });
}

// --- shared assembly --------------------------------------------------------

function dataUriToBytes(dataUri: string): Uint8Array {
  const comma = dataUri.indexOf(',');
  if (comma < 0) throw new Error('Invalid data URI');
  const bin = atob(dataUri.slice(comma + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function drawTitleAndPreamble(cur: Cursor, title: string, preamble: string | null) {
  // Centred, bold, UPPERCASE title (the header component).
  cur.paragraph(title.toUpperCase(), { size: TITLE_FONT_SIZE, font: 'bold', align: 'center', color: INK_STRONG, lineHeight: TITLE_FONT_SIZE + 5 });
  cur.gap(6);
  cur.rule({ gapAfter: 14, width: CONTENT_WIDTH });
  if (preamble) {
    cur.paragraph(preamble, { size: BODY_FONT_SIZE, lineHeight: BODY_LINE_HEIGHT });
    cur.gap(10);
  }
}

function drawBody(cur: Cursor, body: string) {
  const normalized = normalizeLegalBody(body);
  for (const line of normalized.split('\n')) {
    if (line.trim() === '') { cur.gap(BODY_LINE_HEIGHT * 0.55); continue; }
    // Preserve a single level of indentation (e.g. nested "(a)" sub-clauses).
    const lead = line.match(/^(\s+)/);
    const indent = lead ? Math.min(lead[1].replace(/\t/g, '    ').length, 12) * 3 : 0;
    cur.paragraph(line.replace(/^\s+/, ''), { size: BODY_FONT_SIZE, lineHeight: BODY_LINE_HEIGHT, indent });
  }
}

/** Estimate the height of the execution block so it is kept on one page. */
function executionBlockHeight(block: ExecutionBlock, f: Fonts): number {
  const recitalLines = wrapTextToWidth(block.recital, f.italic, 8.5, CONTENT_WIDTH).length;
  const partyHeight = 5 * 13 + 16; // heading + By/Name/Title/Date + spacing
  return 22 + recitalLines * 12 + 14 + block.parties.length * partyHeight + 20;
}

function drawSignatureParty(
  cur: Cursor, f: Fonts, party: { heading: string; by: string; name: string; title: string; date: string },
  sigImg: PDFImage | null, sigDims: { w: number; h: number } | null,
) {
  cur.paragraph(party.heading, { size: 10, font: 'bold', color: INK_STRONG, lineHeight: 14 });
  cur.gap(2);
  if (sigImg && sigDims) {
    cur.image(sigImg, sigDims.w, sigDims.h);
    cur.gap(4);
  }
  cur.paragraph(party.by, { size: 9.5, lineHeight: 13 });
  cur.paragraph(party.name, { size: 9.5, lineHeight: 13 });
  cur.paragraph(party.title, { size: 9.5, lineHeight: 13 });
  cur.paragraph(party.date, { size: 9.5, lineHeight: 13 });
  cur.gap(14);
}

async function drawExecutionBlock(
  cur: Cursor, f: Fonts, block: ExecutionBlock, doc: PDFDocument, signatureDataUrl?: string,
) {
  cur.need(executionBlockHeight(block, f));
  cur.rule({ gapBefore: 10, gapAfter: 14, width: CONTENT_WIDTH });
  cur.paragraph('EXECUTION', { size: 9, font: 'bold', color: BRAND, lineHeight: 14 });
  cur.gap(2);
  cur.paragraph(block.recital, { size: 8.5, font: 'italic', color: MUTED, lineHeight: 12 });
  cur.gap(14);

  // Embed the captured signature image into whichever party is the signer.
  let sigImg: PDFImage | null = null;
  let sigDims: { w: number; h: number } | null = null;
  if (signatureDataUrl) {
    try {
      const img = await doc.embedPng(dataUriToBytes(signatureDataUrl));
      const d = img.scale(1);
      const ratio = Math.min(200 / d.width, 56 / d.height, 1);
      sigImg = img;
      sigDims = { w: d.width * ratio, h: d.height * ratio };
    } catch { /* fall through to the blank "By:" line */ }
  }

  for (const party of block.parties) {
    const isSigner = party.isSigner && !!sigImg;
    drawSignatureParty(cur, f, party, isSigner ? sigImg : null, isSigner ? sigDims : null);
  }
}

async function loadFonts(doc: PDFDocument): Promise<Fonts> {
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
}

function paintChrome(
  pages: PDFPage[], f: Fonts, title: string, version: number, bodySha: string, envelopeUuid: string, watermark?: string,
) {
  const total = pages.length;
  pages.forEach((p, i) => {
    drawHeader(p, f);
    drawFooter(p, f, i + 1, total, title, version, bodySha, envelopeUuid);
    if (watermark) drawWatermark(p, f.regular, watermark);
  });
}

// --- public API -------------------------------------------------------------

export interface RenderOptions {
  envelopeUuid: string;
  documentTitle: string;
  documentBody: string;
  signerName: string;
  signerEmail: string;
  signerIp: string;
  signedAt: string;          // ISO timestamp
  signatureDataUrl: string;  // data:image/png;base64,...
  bodySha256: string;
  // Optional architecture context (sensible defaults derived from the title).
  documentVersion?: number;
  documentType?: string;     // slug / doc_type (entity + kind routing)
  documentKind?: DocumentKind;
  axalEntityKey?: AxalEntityKey;
  axalEntityName?: string;
  category?: string | null;
  /** Skip trailing-signature stripping (e.g. DocuSign anchor text must survive). */
  preserveBody?: boolean;
  /** Do not append the assembled execution block (provider draws its own). */
  suppressExecutionBlock?: boolean;
}

export async function renderAgreementPdf(opts: RenderOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(opts.documentTitle);
  doc.setAuthor('Axal VC');
  doc.setSubject(`Envelope ${opts.envelopeUuid}`);
  doc.setProducer('Axal StudioOS eSign');
  doc.setCreator('Axal StudioOS');
  doc.setCreationDate(new Date(opts.signedAt));

  const f = await loadFonts(doc);
  const slug = opts.documentType || opts.documentTitle;
  const kind = opts.documentKind || classifyDocument(slug);
  const entityKey = opts.axalEntityKey || axalEntityKeyForDoc(slug, opts.category);
  const entityName = opts.axalEntityName || AXAL_ENTITIES[entityKey].name;
  const version = opts.documentVersion ?? 1;
  const signedDate = new Date(opts.signedAt).toISOString().slice(0, 10);

  const cur = new Cursor(doc, f);

  const preamble = kind === 'agreement'
    ? buildPreamble({
        documentTitle: opts.documentTitle,
        effectiveDate: signedDate,
        axalEntityKey: entityKey,
        axalEntityName: entityName,
        counterpartyName: opts.signerName || opts.signerEmail,
      })
    : null;
  drawTitleAndPreamble(cur, opts.documentTitle, preamble);

  drawBody(cur, opts.preserveBody ? opts.documentBody : stripTrailingSignatureBlock(opts.documentBody));

  if (kind !== 'policy' && !opts.suppressExecutionBlock) {
    const block = buildExecutionBlock({
      kind,
      axalEntityName: entityName,
      counterpartyName: opts.signerName || opts.signerEmail,
      signedDate,
    });
    await drawExecutionBlock(cur, f, block, doc, opts.signatureDataUrl);
    // Signed-by audit detail under the counterparty block.
    cur.paragraph(`Signed: ${new Date(opts.signedAt).toUTCString()}   ·   IP: ${opts.signerIp}`,
      { size: 7.5, color: MUTED, lineHeight: 11 });
  }

  paintChrome(cur.pages, f, opts.documentTitle, version, opts.bodySha256, opts.envelopeUuid);
  return await doc.save();
}

export interface PreviewRenderOptions {
  documentTitle: string;
  documentBody: string;
  bodySha256?: string;
  envelopeUuid?: string;
  documentVersion?: number;
  documentType?: string;
  documentKind?: DocumentKind;
  axalEntityKey?: AxalEntityKey;
  axalEntityName?: string;
  counterpartyName?: string;
  effectiveDate?: string;
  category?: string | null;
}

/**
 * Render a watermarked preview PDF for a template (no embedded signature, but
 * the full execution block with blank signature lines). Diagonal "PREVIEW"
 * watermark on every page.
 */
export async function renderTemplatePreviewPdf(opts: PreviewRenderOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(opts.documentTitle);
  doc.setAuthor('Axal VC');
  doc.setSubject('Preview');
  doc.setProducer('Axal StudioOS');
  doc.setCreator('Axal StudioOS');
  doc.setCreationDate(new Date());

  const f = await loadFonts(doc);
  const slug = opts.documentType || opts.documentTitle;
  const kind = opts.documentKind || classifyDocument(slug);
  const entityKey = opts.axalEntityKey || axalEntityKeyForDoc(slug, opts.category);
  const entityName = opts.axalEntityName || AXAL_ENTITIES[entityKey].name;
  const version = opts.documentVersion ?? 1;

  const bodySha = opts.bodySha256 || await sha256Hex(opts.documentBody);
  const envelopeId = opts.envelopeUuid || 'PREVIEW-NOT-YET-SENT';

  const cur = new Cursor(doc, f);

  const preamble = kind === 'agreement'
    ? buildPreamble({
        documentTitle: opts.documentTitle,
        effectiveDate: opts.effectiveDate || null,
        axalEntityKey: entityKey,
        axalEntityName: entityName,
        counterpartyName: opts.counterpartyName || null,
      })
    : null;
  drawTitleAndPreamble(cur, opts.documentTitle, preamble);

  drawBody(cur, stripTrailingSignatureBlock(opts.documentBody));

  if (kind !== 'policy') {
    const block = buildExecutionBlock({ kind, axalEntityName: entityName, counterpartyName: opts.counterpartyName || null });
    await drawExecutionBlock(cur, f, block, doc);
  }

  paintChrome(cur.pages, f, opts.documentTitle, version, bodySha, envelopeId, 'PREVIEW');
  return await doc.save();
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
