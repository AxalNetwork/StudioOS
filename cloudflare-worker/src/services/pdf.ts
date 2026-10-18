/**
 * The pdf-lib fallback for the legal paper (D711, #1776).
 *
 * Every legal PDF is the HTML paper (services/legalPaper.ts) printed by
 * Browser Run (services/legalPaperRender.ts). When Browser Run is unbound,
 * down, slow or answers something that is not a PDF, this file draws the same
 * model so signing never fails because a render service is down (decision 3):
 *
 *   - the header: the lockup (the mark, then "AXAL VC" in violet) left and
 *     CONFIDENTIAL right, over a rule, on every page;
 *   - the state: the Draft banner and diagonal, the Specimen diagonal, or the
 *     Superseded / Issued stamp;
 *   - the body as the paper's typed blocks — headings, numbered clauses with a
 *     hanging indent, tables, legend and warning boxes, drawn checkboxes and
 *     fill-in rules;
 *   - "[Signature page follows]", then the execution block on its own page,
 *     parties stacked;
 *   - the certificate of completion on a signed copy;
 *   - a cover slug's light cover and contents, numbered from this layout;
 *   - the footer: "<title> — v<N>" (or the title alone), "Page X of Y", and
 *     the audit line.
 *
 * Helvetica is WinAnsi only, so `winAnsiSafe` still downgrades characters
 * outside it here; the Browser Run paper prints them as typed. No IP address
 * and no email reaches paper. Letter is 612 × 792, A4 595.28 × 841.89.
 */
import { PDFDocument, StandardFonts, rgb, degrees, PDFFont, PDFPage, PDFImage } from 'pdf-lib';
import type { RGB } from 'pdf-lib';
import {
  winAnsiSafe,
  type AxalEntityKey,
  type DocumentKind,
} from './legalDocFormat';
import type { Block, Run } from './legalPaperBlocks';
import { paperModel, type PaperModel, type PaperParty } from './legalPaper';
import { LEGAL_MARK_PNG, type PaperPageSize } from './legalPaperCss';

export const PAGE_SIZES_PT: Record<PaperPageSize, [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};

const MARGIN_X = 54;
const HEADER_GAP = 74;   // first content baseline below the page top
const CONTENT_BOTTOM = 72;

const BODY_FONT_SIZE = 10.5;
const BODY_LINE_HEIGHT = 14;
const TITLE_FONT_SIZE = 15;
const HANG = 24;

const INK = rgb(0.12, 0.114, 0.169);
const INK_STRONG = rgb(0.067, 0.063, 0.094);
const VIOLET = rgb(0.427, 0.157, 0.851);   // #6d28d9
const MUTED = rgb(0.42, 0.396, 0.467);
const FAINT = rgb(0.63, 0.63, 0.667);
const LINE = rgb(0.83, 0.824, 0.863);

interface Fonts { regular: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont }
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
          let chunk = '';
          for (const ch of word) {
            if (font.widthOfTextAtSize(chunk + ch, fontSize) > maxWidth) { lines.push(chunk); chunk = ch; }
            else chunk += ch;
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

/** One drawable piece of a rich line: a word in a font, a fill-in rule or a box. */
type Piece =
  | { k: 'word'; text: string; font: FontName; space: boolean }
  | { k: 'fill'; space: boolean }
  | { k: 'box'; checked: boolean; space: boolean };

const FILL_WIDTH = 110;
const BOX = 8;

function runsToPieces(runs: Run[]): Piece[] {
  const out: Piece[] = [];
  let pendingSpace = false;
  for (const r of runs) {
    if (r.k === 'fill') { out.push({ k: 'fill', space: pendingSpace || out.length > 0 }); pendingSpace = true; continue; }
    if (r.k === 'box') { out.push({ k: 'box', checked: r.checked, space: pendingSpace }); pendingSpace = true; continue; }
    const font: FontName = r.k === 'bold' || r.k === 'term' ? 'bold' : r.k === 'em' ? 'italic' : 'regular';
    const text = winAnsiSafe(r.text);
    const parts = text.split(/(\s+)/);
    for (const p of parts) {
      if (p === '') continue;
      if (/^\s+$/.test(p)) { pendingSpace = true; continue; }
      const glue = out.length > 0 && !pendingSpace;
      out.push({ k: 'word', text: p, font, space: pendingSpace && out.length > 0 });
      if (glue) out[out.length - 1].space = false;
      pendingSpace = false;
    }
  }
  return out;
}

/** Procedural layout cursor: draws top-to-bottom, opening new pages as needed. */
class Cursor {
  doc: PDFDocument;
  f: Fonts;
  size: [number, number];
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;

  constructor(doc: PDFDocument, f: Fonts, size: [number, number]) {
    this.doc = doc;
    this.f = f;
    this.size = size;
    this.newPage();
  }

  get width() { return this.size[0] - 2 * MARGIN_X; }

  newPage() {
    this.page = this.doc.addPage(this.size);
    this.pages.push(this.page);
    this.y = this.size[1] - HEADER_GAP;
  }

  need(h: number) { if (this.y - h < CONTENT_BOTTOM) this.newPage(); }
  gap(h: number) { this.y -= h; }

  font(name: FontName): PDFFont {
    return name === 'bold' ? this.f.bold : name === 'italic' ? this.f.italic : this.f.regular;
  }

  /** Wrap plain text in one font and draw it. */
  paragraph(text: string, opts: { size?: number; font?: FontName; align?: 'left' | 'center'; color?: RGB; lineHeight?: number; indent?: number } = {}) {
    const size = opts.size ?? BODY_FONT_SIZE;
    const lh = opts.lineHeight ?? BODY_LINE_HEIGHT;
    const font = this.font(opts.font || 'regular');
    const indent = opts.indent || 0;
    for (const line of wrapTextToWidth(winAnsiSafe(text), font, size, this.width - indent)) {
      this.need(lh);
      if (line) {
        const x = opts.align === 'center' ? (this.size[0] - font.widthOfTextAtSize(line, size)) / 2 : MARGIN_X + indent;
        this.page.drawText(line, { x, y: this.y, size, font, color: opts.color || INK });
      }
      this.y -= lh;
    }
  }

  /** Wrap rich runs (mixed fonts, fill-in rules, boxes) and draw them. */
  rich(runs: Run[], opts: { size?: number; lineHeight?: number; indent?: number; firstIndent?: number; color?: RGB; upper?: boolean } = {}) {
    const size = opts.size ?? BODY_FONT_SIZE;
    const lh = opts.lineHeight ?? BODY_LINE_HEIGHT;
    const indent = opts.indent || 0;
    const pieces = runsToPieces(opts.upper ? runs.map((r) => ('text' in r ? { ...r, text: r.text.toUpperCase() } : r)) as Run[] : runs);
    const space = this.f.regular.widthOfTextAtSize(' ', size);
    const widthOf = (p: Piece) => (p.k === 'word' ? this.font(p.font).widthOfTextAtSize(p.text, size) : p.k === 'fill' ? FILL_WIDTH : BOX);
    const lines: Piece[][] = [];
    let cur: Piece[] = [];
    let w = 0;
    let max = this.width - (opts.firstIndent ?? indent);
    for (const p of pieces) {
      const add = widthOf(p) + (cur.length && p.space ? space : 0);
      if (cur.length && w + add > max) { lines.push(cur); cur = []; w = 0; max = this.width - indent; }
      cur.push(p);
      w += cur.length === 1 ? widthOf(p) : add;
    }
    if (cur.length || !lines.length) lines.push(cur);
    lines.forEach((line, li) => {
      this.need(lh);
      let x = MARGIN_X + (li === 0 ? (opts.firstIndent ?? indent) : indent);
      line.forEach((p, pi) => {
        if (pi > 0 && p.space) x += space;
        if (p.k === 'word') {
          this.page.drawText(p.text, { x, y: this.y, size, font: this.font(p.font), color: opts.color || INK });
        } else if (p.k === 'fill') {
          this.page.drawLine({ start: { x, y: this.y - 1.5 }, end: { x: x + FILL_WIDTH, y: this.y - 1.5 }, thickness: 0.5, color: INK });
        } else {
          drawBox(this.page, x, this.y - 1, p.checked);
        }
        x += widthOf(p);
      });
      this.y -= lh;
    });
  }

  rule(opts: { gapBefore?: number; gapAfter?: number; color?: RGB; thickness?: number } = {}) {
    this.gap(opts.gapBefore ?? 0);
    this.need(2);
    this.page.drawLine({
      start: { x: MARGIN_X, y: this.y }, end: { x: MARGIN_X + this.width, y: this.y },
      thickness: opts.thickness ?? 0.5, color: opts.color || LINE,
    });
    this.gap(opts.gapAfter ?? 0);
  }

  image(img: PDFImage, w: number, h: number) {
    this.need(h);
    this.page.drawImage(img, { x: MARGIN_X, y: this.y - h, width: w, height: h });
    this.y -= h;
  }
}

function drawBox(page: PDFPage, x: number, y: number, checked: boolean) {
  page.drawRectangle({ x, y, width: BOX, height: BOX, borderColor: INK, borderWidth: 0.75 });
  if (checked) {
    page.drawLine({ start: { x: x + 1.5, y: y + 1.5 }, end: { x: x + BOX - 1.5, y: y + BOX - 1.5 }, thickness: 0.9, color: INK });
    page.drawLine({ start: { x: x + 1.5, y: y + BOX - 1.5 }, end: { x: x + BOX - 1.5, y: y + 1.5 }, thickness: 0.9, color: INK });
  }
}

function dataUriToBytes(dataUri: string): Uint8Array {
  const comma = dataUri.indexOf(',');
  if (comma < 0) throw new Error('Invalid data URI');
  const bin = atob(dataUri.slice(comma + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// --- header / footer / state (painted once per page, post-layout) ----------

function drawHeader(page: PDFPage, f: Fonts, mark: PDFImage | null) {
  const { width: W, height: H } = page.getSize();
  let x = MARGIN_X;
  if (mark) {
    page.drawImage(mark, { x, y: H - 41, width: 11, height: 11 });
    x += 15;
  }
  page.drawText('AXAL VC', { x, y: H - 39, size: 10, font: f.bold, color: VIOLET });
  const conf = 'CONFIDENTIAL';
  page.drawText(conf, { x: W - MARGIN_X - f.bold.widthOfTextAtSize(conf, 8.5), y: H - 39, size: 8.5, font: f.bold, color: VIOLET });
  page.drawLine({ start: { x: MARGIN_X, y: H - 50 }, end: { x: W - MARGIN_X, y: H - 50 }, thickness: 0.5, color: LINE });
}

function drawFooter(page: PDFPage, f: Fonts, pageLabel: string, model: PaperModel) {
  const { width: W } = page.getSize();
  const contentWidth = W - 2 * MARGIN_X;
  const left = winAnsiSafe(model.footerLeft);
  let leftFit = left;
  while (leftFit.length > 8 && f.regular.widthOfTextAtSize(leftFit, 8) > contentWidth * 0.62) leftFit = leftFit.slice(0, -2);
  if (leftFit !== left) leftFit = leftFit.replace(/[\s—-]+$/, '') + '…';
  page.drawText(leftFit, { x: MARGIN_X, y: 44, size: 8, font: f.regular, color: MUTED });
  page.drawText(pageLabel, { x: W - MARGIN_X - f.regular.widthOfTextAtSize(pageLabel, 8), y: 44, size: 8, font: f.regular, color: MUTED });
  page.drawText(winAnsiSafe(model.auditLine), { x: MARGIN_X, y: 33, size: 6.5, font: f.regular, color: FAINT });
}

function drawDiagonal(page: PDFPage, font: PDFFont, text: string, color: RGB) {
  const { width: W, height: H } = page.getSize();
  page.drawText(text, {
    x: W / 2 - font.widthOfTextAtSize(text, 48) / 2 * Math.SQRT1_2, y: H / 2 - font.widthOfTextAtSize(text, 48) / 2 * Math.SQRT1_2,
    size: 48, font, color, opacity: 0.2, rotate: degrees(45),
  });
}

function paintChrome(pages: PDFPage[], f: Fonts, mark: PDFImage | null, model: PaperModel, label: (i: number, n: number) => string, skip: (i: number) => boolean = () => false) {
  pages.forEach((p, i) => {
    if (!skip(i)) {
      drawHeader(p, f, mark);
      drawFooter(p, f, label(i, pages.length), model);
    }
    if (model.state.kind === 'draft') drawDiagonal(p, f.bold, 'DRAFT', LINE);
    if (model.state.kind === 'specimen') drawDiagonal(p, f.bold, 'SPECIMEN', FAINT);
  });
}

function roman(n: number): string {
  const map: [number, string][] = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = '';
  for (const [v, r] of map) while (n >= v) { s += r; n -= v; }
  return s;
}

// --- the body ---------------------------------------------------------------

function drawState(cur: Cursor, model: PaperModel) {
  const s = model.state;
  const label = s.kind === 'draft' ? 'DRAFT — FOR COUNSEL REVIEW'
    : s.kind === 'superseded' ? `SUPERSEDED BY V${s.by}`
    : s.kind === 'issued' ? 'ISSUED' : null;
  if (label) {
    cur.paragraph(label, { size: 8, font: 'bold', color: s.kind === 'draft' ? MUTED : VIOLET, lineHeight: 12 });
    cur.gap(4);
  }
  if (model.restricted) {
    cur.paragraph('CONFIDENTIAL — GP AND LPAC ONLY', { size: 8, font: 'bold', color: VIOLET, lineHeight: 12 });
    cur.gap(4);
  }
}

function drawLegend(cur: Cursor, b: Extract<Block, { t: 'legend' }>) {
  const pad = 8;
  const size = 9;
  const lh = 12.6;
  const lines = b.paras.reduce((n, p) => n + wrapTextToWidth(winAnsiSafe(p.map((r) => ('text' in r ? r.text : '____')).join('').toUpperCase()), cur.f.regular, size, cur.width - 2 * pad).length, 0);
  const h = lines * lh + 2 * pad + (b.paras.length - 1) * 4;
  cur.need(Math.min(h, cur.size[1] - HEADER_GAP - CONTENT_BOTTOM));
  const top = cur.y + lh - 2;
  const startPage = cur.page;
  cur.gap(pad);
  b.paras.forEach((p, i) => {
    if (i) cur.gap(4);
    cur.rich(p, { size, lineHeight: lh, indent: pad, upper: true });
  });
  cur.gap(pad - lh + 4);
  if (cur.page === startPage) {
    cur.page.drawRectangle({
      x: MARGIN_X, y: cur.y, width: cur.width, height: top - cur.y,
      borderColor: INK, borderWidth: b.warning ? 1.25 : 0.75,
    });
  }
  cur.gap(14);
}

function drawTable(cur: Cursor, b: Extract<Block, { t: 'table' }>) {
  const n = Math.max(1, b.head.length);
  const colW = cur.width / n;
  const size = 9.5;
  const lh = 13;
  const cellText = (cell: Run[]) => winAnsiSafe(cell.map((r) => ('text' in r ? r.text : '____')).join(''));
  const drawRow = (cells: Run[][], font: PDFFont, color: RGB, upper: boolean) => {
    const wrapped = cells.map((c) => wrapTextToWidth(upper ? cellText(c).toUpperCase() : cellText(c), font, size, colW - 8));
    const rows = Math.max(1, ...wrapped.map((w) => w.length));
    cur.need(rows * lh + 4);
    for (let i = 0; i < rows; i++) {
      wrapped.forEach((lines, c) => {
        const t = lines[i];
        if (!t) return;
        const tw = font.widthOfTextAtSize(t, size);
        const x0 = MARGIN_X + c * colW + 4;
        const x = b.align[c] === 'right' ? MARGIN_X + (c + 1) * colW - 4 - tw : b.align[c] === 'center' ? x0 + (colW - 8 - tw) / 2 : x0;
        cur.page.drawText(t, { x, y: cur.y, size, font, color });
      });
      cur.y -= lh;
    }
  };
  cur.gap(4);
  drawRow(b.head, cur.f.bold, VIOLET, true);
  cur.rule({ gapBefore: -9, gapAfter: 13, color: INK, thickness: 0.75 });
  b.rows.forEach((r, i) => {
    const total = b.total && i === b.rows.length - 1;
    if (total) cur.rule({ gapBefore: -9, gapAfter: 13, color: INK, thickness: 1.25 });
    drawRow(r, total ? cur.f.bold : cur.f.regular, INK, false);
    if (!total) cur.rule({ gapBefore: -9, gapAfter: 13 });
  });
  cur.gap(6);
}

/** D717 — the fallback's Structure of the Fund page: the heading, then one line per fact. */
function drawStructureList(cur: Cursor, lines: string[]) {
  cur.newPage();
  cur.paragraph('STRUCTURE OF THE FUND', { size: 9, font: 'bold', color: VIOLET, lineHeight: 14 });
  cur.paragraph('Structure of the Fund', { size: 11.5, font: 'bold', color: INK_STRONG, lineHeight: 15 });
  cur.gap(6);
  for (const l of lines) { cur.need(BODY_LINE_HEIGHT * 2); cur.paragraph(l, { size: 9 }); cur.gap(3); }
  cur.newPage();
}

function drawBlocks(cur: Cursor, blocks: Block[], articlePages: Map<string, number>) {
  for (const b of blocks) {
    switch (b.t) {
      case 'title':
      case 'recitals':
        cur.gap(6); cur.need(BODY_LINE_HEIGHT * 3);
        cur.rich(b.runs, { size: 11.5, lineHeight: 15 }); cur.gap(4);
        break;
      case 'article':
        cur.gap(8); cur.need(BODY_LINE_HEIGHT * 3);
        articlePages.set(b.id, cur.pages.length);
        cur.paragraph(b.text, { size: 11.5, font: 'bold', color: INK_STRONG, lineHeight: 15 }); cur.gap(4);
        break;
      case 'section':
        cur.need(BODY_LINE_HEIGHT * 3);
        cur.paragraph(b.runs.map((r) => ('text' in r ? r.text : '')).join(''), { font: 'bold' }); cur.gap(2);
        break;
      case 'schedule':
        cur.gap(8); cur.need(BODY_LINE_HEIGHT * 3);
        cur.paragraph(b.runs.map((r) => ('text' in r ? r.text : '')).join('').toUpperCase(), { size: 11.5, font: 'bold', align: 'center', color: INK_STRONG, lineHeight: 15 });
        if (b.dateline) cur.paragraph(b.dateline.map((r) => ('text' in r ? r.text : '')).join(''), { align: 'center', color: MUTED });
        cur.gap(6);
        break;
      case 'recital':
        cur.rich(b.runs, { indent: HANG }); cur.gap(6);
        break;
      case 'para': {
        const runs: Run[] = b.runIn ? [...b.runIn.map((r) => ({ k: 'bold', text: 'text' in r ? r.text : '' } as Run)), { k: 'bold', text: '. ' }, ...b.runs] : b.runs;
        if (b.num) {
          const indent = HANG * b.depth;
          cur.need(BODY_LINE_HEIGHT * 2);
          cur.page.drawText(winAnsiSafe(b.num), { x: MARGIN_X + indent - HANG, y: cur.y, size: BODY_FONT_SIZE, font: cur.f.bold, color: VIOLET });
          cur.rich(runs, { indent });
        } else {
          cur.rich(runs);
        }
        cur.gap(6);
        break;
      }
      case 'bullets':
        for (const item of b.items) {
          cur.need(BODY_LINE_HEIGHT);
          cur.page.drawText('•', { x: MARGIN_X + 8, y: cur.y, size: BODY_FONT_SIZE, font: cur.f.regular, color: INK });
          cur.rich(item, { indent: HANG }); cur.gap(2);
        }
        cur.gap(4);
        break;
      case 'table': drawTable(cur, b); break;
      case 'legend': drawLegend(cur, b); break;
      case 'check':
        cur.rich([{ k: 'box', checked: b.checked }, { k: 'text', text: ' ' }, ...b.runs]); cur.gap(3);
        break;
      case 'rule': cur.rule({ gapBefore: 4, gapAfter: 10 }); break;
    }
  }
}

async function drawExecution(cur: Cursor, model: PaperModel, doc: PDFDocument) {
  const exec = model.execution!;
  // D716 — a block with no parties (the booklet's packet) draws nothing, not
  // even the signature-page line and its new page.
  if (!exec.parties.length) return;
  cur.gap(10);
  cur.paragraph('[Signature page follows]', { font: 'italic', align: 'center', color: MUTED });
  cur.newPage();
  cur.paragraph('EXECUTION', { size: 9, font: 'bold', color: VIOLET, lineHeight: 14 });
  cur.gap(2);
  // D716 — a notice's block has no recital.
  if (exec.recital) cur.paragraph(exec.recital, { size: 8.5, font: 'italic', color: MUTED, lineHeight: 12 });
  cur.gap(14);
  for (const party of exec.parties) await drawParty(cur, party, doc);
}

async function drawParty(cur: Cursor, party: PaperParty, doc: PDFDocument) {
  const signatureDataUrl = party.image;
  let sig: { img: PDFImage; w: number; h: number } | null = null;
  if (signatureDataUrl) {
    try {
      const img = await doc.embedPng(dataUriToBytes(signatureDataUrl));
      const d = img.scale(1);
      const ratio = Math.min(200 / d.width, 56 / d.height, 1);
      sig = { img, w: d.width * ratio, h: d.height * ratio };
    } catch { /* fall through to the blank "By:" line */ }
  }
  // D716 — a notice's sender has no By line, so it neither prints nor counts.
  const byLines = party.by ? 1 : 0;
  cur.need((4 + byLines) * 13 + 30 + (sig ? sig.h : 0) + (party.through ? 13 : 0) + (party.signedLine ? 11 : 0));
  cur.paragraph(party.heading, { size: 10, font: 'bold', color: INK_STRONG, lineHeight: 14 });
  const indent = party.through ? 12 : 0;
  if (party.through) cur.paragraph(party.through, { size: 9.5, lineHeight: 13 });
  cur.gap(2);
  if (sig) {
    cur.page.drawImage(sig.img, { x: MARGIN_X + indent, y: cur.y - sig.h, width: sig.w, height: sig.h });
    cur.y -= sig.h + 4;
  }
  if (party.by) cur.paragraph(party.by, { size: 9.5, lineHeight: 13, indent });
  if (party.signedLine) cur.paragraph(party.signedLine, { size: 7, color: MUTED, lineHeight: 11, indent });
  cur.paragraph(party.name, { size: 9.5, lineHeight: 13, indent });
  cur.paragraph(party.title, { size: 9.5, lineHeight: 13, indent });
  cur.paragraph(party.date, { size: 9.5, lineHeight: 13, indent });
  cur.gap(16);
}

function drawCertificate(cur: Cursor, model: PaperModel) {
  const c = model.certificate!;
  cur.newPage();
  cur.paragraph('CERTIFICATE OF COMPLETION', { size: 9, font: 'bold', color: VIOLET, lineHeight: 14 });
  cur.paragraph(c.title.toUpperCase(), { size: TITLE_FONT_SIZE, font: 'bold', align: 'center', color: INK_STRONG, lineHeight: TITLE_FONT_SIZE + 5 });
  cur.gap(8);
  cur.paragraph(`Envelope: ${c.envelopeUuid}`, { size: 9.5 });
  cur.paragraph(`Version: ${c.version ? `v${c.version}` : 'not recorded'}`, { size: 9.5 });
  cur.paragraph(`Body SHA-256: ${c.bodySha256}`, { size: 8.5 });
  cur.gap(10);
  for (const r of c.rows) cur.paragraph(`${r.label}   ${r.name}   ${r.status}   ${r.at}`, { size: 9.5 });
}

async function loadFonts(doc: PDFDocument): Promise<Fonts> {
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };
}

async function embedMark(doc: PDFDocument): Promise<PDFImage | null> {
  try { return await doc.embedPng(new Uint8Array(LEGAL_MARK_PNG)); } catch { return null; }
}

function setMeta(doc: PDFDocument, model: PaperModel) {
  doc.setTitle(winAnsiSafe(model.title));
  doc.setAuthor('Axal VC');
  doc.setSubject(model.envelopeUuid ? `Envelope ${model.envelopeUuid}` : 'Preview');
  doc.setProducer('Axal StudioOS');
  doc.setCreator('Axal StudioOS');
}

// --- public API -------------------------------------------------------------

export interface FallbackOptions {
  pageSize: PaperPageSize;
  /** Fixed creation date (signing passes the signature time). */
  createdAt?: Date;
}

/** Draw the paper model with pdf-lib in Helvetica (the fallback renderer). */
export async function renderPaperFallbackPdf(model: PaperModel, opts: FallbackOptions): Promise<Uint8Array> {
  const size = PAGE_SIZES_PT[opts.pageSize];
  if (!size) throw new Error('page_size_invalid');
  const bodyDoc = await PDFDocument.create();
  const f = await loadFonts(bodyDoc);
  const mark = await embedMark(bodyDoc);
  const cur = new Cursor(bodyDoc, f, size);
  const articlePages = new Map<string, number>();

  drawState(cur, model);
  cur.paragraph(model.title.toUpperCase(), { size: TITLE_FONT_SIZE, font: 'bold', align: 'center', color: INK_STRONG, lineHeight: TITLE_FONT_SIZE + 5 });
  cur.gap(8);
  if (model.preamble) { cur.paragraph(model.preamble); cur.gap(10); }
  if (model.structure) {
    // D717 — the Structure of the Fund page, as its list (no arrow character).
    const at = Math.min(model.structure.at, model.blocks.length);
    drawBlocks(cur, model.blocks.slice(0, at), articlePages);
    drawStructureList(cur, model.structure.lines);
    drawBlocks(cur, model.blocks.slice(at), articlePages);
  } else {
    drawBlocks(cur, model.blocks, articlePages);
  }
  if (model.execution) await drawExecution(cur, model, bodyDoc);
  if (model.certificate) drawCertificate(cur, model);
  paintChrome(cur.pages, f, mark, model, (i, n) => `Page ${i + 1} of ${n}`);

  if (!model.cover) {
    setMeta(bodyDoc, model);
    if (opts.createdAt) bodyDoc.setCreationDate(opts.createdAt);
    return await bodyDoc.save();
  }

  // A cover slug: the light cover and the contents, numbered from this layout.
  const doc = await PDFDocument.create();
  const ff = await loadFonts(doc);
  const fmark = await embedMark(doc);
  const front = new Cursor(doc, ff, size);
  const c = model.cover;
  front.gap(90);
  front.paragraph(c.fund, { size: 11, font: 'bold', color: INK_STRONG });
  front.gap(6);
  front.paragraph(c.name.toUpperCase(), { size: 22, font: 'bold', color: INK_STRONG, lineHeight: 26 });
  front.gap(12);
  front.paragraph('CONFIDENTIAL', { size: 8, font: 'bold', color: VIOLET });
  front.gap(4);
  for (const [label, v] of [['Copy No.', c.copyNumber], ['Prepared for', c.preparedFor], ['Date', c.date]] as const) {
    front.rich([{ k: 'bold', text: `${label}: ` }, v ? { k: 'text', text: v } : { k: 'fill' }], { size: 9.5 });
    front.gap(4);
  }
  front.gap(30);
  for (const l of c.legends) if (l.t === 'legend') drawLegend(front, l);
  front.newPage();
  front.paragraph('CONTENTS', { size: 9, font: 'bold', color: VIOLET, lineHeight: 14 });
  front.paragraph(model.title.toUpperCase(), { size: TITLE_FONT_SIZE, font: 'bold', align: 'center', color: INK_STRONG, lineHeight: TITLE_FONT_SIZE + 5 });
  front.gap(8);
  for (const a of model.articles) {
    const pg = String(articlePages.get(a.id) ?? '');
    const text = winAnsiSafe(a.text);
    front.need(BODY_LINE_HEIGHT);
    front.page.drawText(text, { x: MARGIN_X, y: front.y, size: BODY_FONT_SIZE, font: ff.regular, color: INK });
    const tw = ff.regular.widthOfTextAtSize(text, BODY_FONT_SIZE);
    const pw = ff.regular.widthOfTextAtSize(pg, BODY_FONT_SIZE);
    front.page.drawLine({
      start: { x: MARGIN_X + tw + 4, y: front.y }, end: { x: MARGIN_X + front.width - pw - 4, y: front.y },
      thickness: 0.8, color: FAINT, dashArray: [1, 2],
    });
    front.page.drawText(pg, { x: MARGIN_X + front.width - pw, y: front.y, size: BODY_FONT_SIZE, font: ff.regular, color: INK });
    front.y -= BODY_LINE_HEIGHT + 3;
  }
  paintChrome(front.pages, ff, fmark, model, (i) => `Page ${roman(i + 1)}`, (i) => i === 0);
  const body = await doc.copyPages(bodyDoc, bodyDoc.getPageIndices());
  for (const p of body) doc.addPage(p);
  setMeta(doc, model);
  if (opts.createdAt) doc.setCreationDate(opts.createdAt);
  return await doc.save();
}

export interface RenderOptions {
  envelopeUuid: string;
  documentTitle: string;
  documentBody: string;
  signerName: string;
  signerEmail: string;
  /** Kept for callers; the paper never prints an IP (D711 decision 13). */
  signerIp: string;
  signedAt: string;          // ISO timestamp
  signatureDataUrl: string;  // data:image/png;base64,...
  bodySha256: string;
  documentVersion?: number;
  documentType?: string;
  documentKind?: DocumentKind;
  axalEntityKey?: AxalEntityKey;
  axalEntityName?: string;
  category?: string | null;
  preserveBody?: boolean;
  suppressExecutionBlock?: boolean;
  pageSize?: PaperPageSize;
}

/** A single-signer signed copy, drawn by the fallback. */
export async function renderAgreementPdf(opts: RenderOptions): Promise<Uint8Array> {
  const model = paperModel({
    title: opts.documentTitle,
    body: opts.documentBody,
    slug: opts.documentType || opts.documentTitle,
    category: opts.category,
    version: opts.documentVersion ?? null,
    bodySha256: opts.bodySha256,
    envelopeUuid: opts.envelopeUuid,
    effectiveDate: new Date(opts.signedAt).toISOString().slice(0, 10),
    state: { kind: 'issued' },
    recipients: [{ name: opts.signerName || null, status: 'signed', signedAt: opts.signedAt }],
    signature: opts.signatureDataUrl ? { recipientIndex: 0, imageDataUrl: opts.signatureDataUrl, signedAt: opts.signedAt } : null,
    certificate: !opts.suppressExecutionBlock,
    documentKind: opts.documentKind,
    axalEntityKey: opts.axalEntityKey,
    preserveBody: opts.preserveBody,
    suppressExecutionBlock: opts.suppressExecutionBlock,
  });
  return renderPaperFallbackPdf(model, { pageSize: opts.pageSize || 'letter', createdAt: new Date(opts.signedAt) });
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
  pageSize?: PaperPageSize;
}

/** A Draft preview of a template, drawn by the fallback. */
export async function renderTemplatePreviewPdf(opts: PreviewRenderOptions): Promise<Uint8Array> {
  const model = paperModel({
    title: opts.documentTitle,
    body: opts.documentBody,
    slug: opts.documentType || opts.documentTitle,
    category: opts.category,
    version: opts.documentVersion ?? null,
    bodySha256: opts.bodySha256 || await sha256Hex(opts.documentBody),
    counterpartyName: opts.counterpartyName || null,
    effectiveDate: opts.effectiveDate || null,
    state: { kind: 'draft' },
    documentKind: opts.documentKind,
    axalEntityKey: opts.axalEntityKey,
  });
  return renderPaperFallbackPdf(model, { pageSize: opts.pageSize || 'letter' });
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
