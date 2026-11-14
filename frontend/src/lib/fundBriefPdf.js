// Fund Brief One-Pager — PDF renderer.
//
// Letter portrait, one page, vector-drawn with jsPDF. Same approach as
// graduationCertificatePdf.js / scoringReportPdf.js: no html2canvas, so the
// download is sharp at any zoom, small enough to email, and prints correctly.
//
// GEOMETRY lives in lib/pdfBoard.js, shared with the quarterly report: the
// design is authored on a letter page box (816 × 1056 CSS px at 96dpi), letter
// at 72dpi is 612 × 792 pt, so every length maps to points by ×0.75. This module
// works in the design's own px throughout and converts at the drawing call.
// Design numbers can be transcribed here verbatim and compared by eye.
//
// DELIBERATELY NOT REPRODUCED from the export, each for the same reason the
// certificate PDF gives — a raster would defeat a vector document:
//   - the masthead photograph (`uploads/axal-vc-future-*.png`). The design lays
//     a near-opaque violet gradient over it; that gradient is drawn here as
//     banded slices, which is what the photo mostly resolves to anyway.
//   - the logo bitmap (`uploads/axal01colourvar2.png`), replaced by the drawn
//     monogram the wordmark sits next to.
// Fonts fall back to the PDF core faces: Helvetica for Inter, Courier for the
// tabular Roboto Mono figures.
import { fundBriefModel, fundBriefFilename } from './fundBriefViewModel.js';
import { BOARD, board } from './pdfBoard.js';

const BOARD_W = BOARD.w;
const BOARD_H = BOARD.h;
const PAD = 42;
const COL_GAP = 26;
const COL_W = (BOARD_W - PAD * 2 - COL_GAP) / 2; // 353
const RIGHT_X = PAD + COL_W + COL_GAP;           // 421
const RIGHT_EDGE = BOARD_W - PAD;                // 774

const C = {
  ink: '#18181b',
  body: '#3f3f46',
  muted: '#71717a',
  faint: '#a1a1aa',
  rule: '#ececf1',
  ruleSoft: '#f1f0f5',
  ruleFaint: '#f4f4f5',
  violet: '#6d28d9',
  violetRule: '#ede9fe',
  violetFaint: '#c4b5fd',
  wash: '#faf9fc',
  tierWash: '#faf7ff',
  tierEdge: '#e9e4fb',
  white: '#ffffff',
  // Masthead: the export's overlay stops, which is what the photo resolves to
  // under a .84–.94 alpha violet wash.
  mast: ['#140c26', '#1c1236', '#26164a'],
};

/**
 * Section heading: violet uppercase label over a 1.5px violet rule, as used
 * down both columns of the design. Returns the y content should start at.
 */
function sectionLabel(b, x, w, y, label, right) {
  b.text(label.toUpperCase(), x, y, { size: 9, style: 'bold', color: C.violet, ls: 0.99 });
  if (right) b.text(right, x + w, y + 0.5, { size: 8.5, color: C.faint, align: 'right' });
  const ruleY = y + 9 + 6;
  b.hline(x, x + w, ruleY, C.violetRule, 1.5);
  return ruleY + 9;
}

/* ------------------------------------------------------------------ masthead */

function drawMasthead(b, m) {
  // The band has to be painted before the text sits on it, and it has to stop
  // exactly where the masthead ends — a fixed height would either clip the
  // thesis or leave a dark stripe running down behind the body. So measure the
  // block first, then paint, then draw.
  const TITLE_W = 420;
  const THESIS_W = 600;
  const lines = (s, w, o) => b.wrap(s, w, o).length;

  const kickerBottom = 60 + 9 * 1.25;
  const titleTop = kickerBottom + 5;
  const titleBottom = titleTop + lines(m.fundName, TITLE_W, { size: 23, style: 'bold' }) * 23 * 1.25;
  const subTop = titleBottom + 3;
  const leftBottom = subTop + 11.5 * 1.25;

  const stampTop = 50;
  const stampBottom = stampTop + 9.5 * 1.25;
  const preparedTop = stampBottom + 3;
  const rightBottom = m.preparedFor
    ? preparedTop + lines(m.preparedFor, 300, { size: 9 }) * 9 * 1.25
    : stampBottom;

  const thesisTop = Math.max(leftBottom, rightBottom) + 14;
  const thesisBottom = thesisTop + lines(m.thesis, THESIS_W, { size: 13 }) * 13 * 1.6;
  const height = thesisBottom + 22;

  // 100deg in the export is close enough to horizontal at this aspect ratio.
  b.gradientBand(0, 0, BOARD_W, height, C.mast, 0.42);

  // --- monogram + wordmark
  b.rrect(PAD, 22, 26, 26, 7, { fill: '#7c3aed' });
  b.text('A', PAD + 13, 27, { size: 15, style: 'bold', color: C.white, align: 'center' });
  b.text(m.issuer, PAD + 35, 27, { size: 16, style: 'bold', color: C.white });

  b.text(m.kicker.toUpperCase(), PAD, 60, { size: 9, style: 'bold', color: '#8b8496', ls: 1.44 });
  b.text(m.fundName, PAD, titleTop, { size: 23, style: 'bold', color: C.white, maxW: TITLE_W });
  b.text(m.subtitle, PAD, subTop, { size: 11.5, color: '#b9b3c6' });

  // --- status pill + generation stamp, right-aligned
  const pillW = b.width(m.status, { size: 9.5, style: 'bold' }) + 22;
  b.rrect(RIGHT_EDGE - pillW, 22, pillW, 20, 10, { fill: '#25402f' });
  b.text(m.status, RIGHT_EDGE - pillW / 2, 27, { size: 9.5, style: 'bold', color: '#86efac', align: 'center' });
  b.text(m.generated, RIGHT_EDGE, stampTop, { size: 9.5, mono: true, color: '#d2cedb', align: 'right' });
  if (m.preparedFor) {
    b.text(m.preparedFor, RIGHT_EDGE, preparedTop, { size: 9, color: '#a9a2b8', align: 'right', maxW: 300 });
  }

  b.text(m.thesis, PAD, thesisTop, { size: 13, color: '#dcd8e4', lineHeight: 1.6, maxW: THESIS_W });
  return height;
}

/* --------------------------------------------------------------- raise strip */

function drawRaiseStrip(b, raise, y) {
  const colW = BOARD_W / raise.length;
  const w = colW - 32;
  const NOTE_TOP = 46;
  // Cells share one height so labels, figures and notes stay on a grid; that
  // height follows the longest note, since a two-line note in a fixed 70px cell
  // would run under the strip's bottom rule.
  const noteLines = Math.max(...raise.map((r) => b.wrap(r.note, w, { size: 9.5 }).length));
  const h = NOTE_TOP + noteLines * 9.5 * 1.4 + 11;

  b.rect(0, y, BOARD_W, h, C.wash);
  raise.forEach((r, i) => {
    const x = i * colW + 16;
    b.text(r.k.toUpperCase(), x, y + 13, { size: 8.5, style: 'bold', color: C.faint, ls: 0.77, maxW: w });
    b.text(r.v, x, y + 26, { size: 15, style: 'bold', mono: true, color: r.tone, maxW: w });
    b.text(r.note, x, y + NOTE_TOP, { size: 9.5, color: C.muted, lineHeight: 1.4, maxW: w });
    if (i > 0) b.rect(i * colW, y, 1, h, C.ruleSoft); // cell divider
  });
  b.hline(0, BOARD_W, y + h, C.rule);
  return y + h;
}

/* ------------------------------------------------------------- left column */

function drawThesis(b, y, body) {
  let cy = sectionLabel(b, PAD, COL_W, y, 'Thesis');
  cy = b.text(body, PAD, cy, { size: 11, color: C.body, lineHeight: 1.65, maxW: COL_W });
  return cy + 14;
}

function drawStructure(b, y, terms) {
  let cy = sectionLabel(b, PAD, COL_W, y, 'Fund structure');
  const cellW = (COL_W - 18) / 2;
  const rows = Math.ceil(terms.length / 2);
  const rowH = 17;
  terms.forEach((t, i) => {
    const col = i < rows ? 0 : 1;
    const row = i % rows;
    const x = PAD + col * (cellW + 18);
    const ty = cy + row * rowH;
    b.text(t.k, x, ty, { size: 10, color: C.muted });
    b.text(t.v, x + cellW, ty, { size: 10, style: 'bold', mono: true, color: C.ink, align: 'right' });
    b.dotted(x, x + cellW, ty + 14, C.rule);
  });
  return cy + rows * rowH + 12;
}

function drawTiers(b, y, tiers) {
  let cy = sectionLabel(b, PAD, COL_W, y, 'Participation tiers');
  tiers.forEach((t, i) => {
    const innerW = COL_W - 20;
    const rightsLines = b.wrap(t.rights, innerW, { size: 9.5 }).length;
    const h = 8 + 13 + 2 + rightsLines * 9.5 * 1.45 + 8;
    if (t.hl) b.rrect(PAD, cy, COL_W, h, 8, { fill: C.tierWash, stroke: C.tierEdge });
    const nameW = b.width(t.name, { size: 10.5, style: 'bold' });
    b.text(t.name, PAD + 10, cy + 8, { size: 10.5, style: 'bold', color: C.ink });
    b.text(t.amount, PAD + 10 + nameW + 7, cy + 8.5, { size: 10, style: 'bold', mono: true, color: C.violet });
    b.text(t.rights, PAD + 10, cy + 23, { size: 9.5, color: C.muted, lineHeight: 1.45, maxW: innerW });
    cy += h + (i < tiers.length - 1 ? 4 : 0);
  });
  return cy + 14;
}

/* ------------------------------------------------------------ right column */

function drawRecord(b, y, record) {
  let cy = sectionLabel(b, RIGHT_X, COL_W, y, 'Track record');
  const gap = 8;
  const tileW = (COL_W - gap * 2) / 3;
  const tileH = 58;
  record.forEach((r, i) => {
    const x = RIGHT_X + (i % 3) * (tileW + gap);
    const ty = cy + Math.floor(i / 3) * (tileH + gap);
    b.rrect(x, ty, tileW, tileH, 9, { fill: C.wash, stroke: C.ruleSoft });
    b.text(r.v, x + 10, ty + 9, { size: 14, style: 'bold', mono: true, color: C.ink, maxW: tileW - 20 });
    b.text(r.k.toUpperCase(), x + 10, ty + 29, { size: 8.5, style: 'bold', color: C.faint, ls: 0.51, lineHeight: 1.35, maxW: tileW - 20 });
  });
  const rows = Math.ceil(record.length / 3);
  return cy + rows * tileH + (rows - 1) * gap + 14;
}

function drawPipeline(b, y, vm) {
  let cy = sectionLabel(b, RIGHT_X, COL_W, y, vm.pipelineHeading, vm.pipelineNote);

  const icRight = RIGHT_EDGE;
  const revRight = icRight - 54;
  const scoreRight = revRight - 50;
  const companyW = scoreRight - 36 - RIGHT_X;

  const head = (label, xRight) =>
    b.text(label.toUpperCase(), xRight, cy, { size: 8, style: 'bold', color: C.faint, ls: 0.56, align: 'right' });
  b.text('COMPANY', RIGHT_X, cy, { size: 8, style: 'bold', color: C.faint, ls: 0.56 });
  head('Ready', scoreRight);
  head('Revenue', revRight);
  head('IC', icRight);
  cy += 13;

  vm.pipeline.forEach((p) => {
    b.hline(RIGHT_X, RIGHT_EDGE, cy, C.ruleFaint);
    const rowTop = cy + 5;
    b.text(p.company, RIGHT_X, rowTop, { size: 10, style: 'bold', color: C.ink, maxW: companyW });
    b.text(p.sector, RIGHT_X, rowTop + 12, { size: 8.5, color: C.faint, maxW: companyW });
    b.text(p.score, scoreRight, rowTop + 2, { size: 10, style: 'bold', mono: true, color: p.scoreTone, align: 'right' });
    b.text(p.revenue, revRight, rowTop + 2, { size: 10, mono: true, color: C.body, align: 'right' });
    const pillW = b.width(p.ic, { size: 8.5, style: 'bold' }) + 14;
    b.rrect(icRight - pillW, rowTop, pillW, 15, 7.5, { fill: p.icPill.bg });
    b.text(p.ic, icRight - pillW / 2, rowTop + 3.5, { size: 8.5, style: 'bold', color: p.icPill.fg, align: 'center' });
    cy += 33;
  });
  return cy + 14;
}

function drawProviders(b, y, providers) {
  let cy = sectionLabel(b, RIGHT_X, COL_W, y, 'Governance & service providers');
  providers.forEach((p) => {
    b.text(p.k, RIGHT_X, cy, { size: 9.5, color: C.muted });
    b.text(p.v, RIGHT_EDGE, cy, { size: 9.5, style: 'bold', color: C.ink, align: 'right' });
    cy += 17;
  });
  return cy;
}

/* ------------------------------------------------------- process + footer */

function drawProcess(b, y, steps) {
  const cy = sectionLabel(b, PAD, BOARD_W - PAD * 2, y, 'Commitment process') - 2;
  const gap = 5;
  const w = (BOARD_W - PAD * 2 - gap * (steps.length - 1)) / steps.length;
  const h = 36;
  steps.forEach((s, i) => {
    const x = PAD + i * (w + gap);
    b.rrect(x, cy, w, h, 7, { fill: C.white, stroke: C.rule });
    b.text(s.n, x + 8, cy + 7, { size: 8, style: 'bold', mono: true, color: C.violetFaint });
    b.text(s.label, x + 8, cy + 18, { size: 9, style: 'bold', color: C.ink, lineHeight: 1.25, maxW: w - 14 });
  });
  return cy + h;
}

function drawFooter(b, footer) {
  const top = BOARD_H - 16;
  const gpTop = top - 26;
  b.text(footer.gpName, RIGHT_EDGE, gpTop, { size: 10, style: 'bold', color: C.ink, align: 'right' });
  b.text(footer.gpContact, RIGHT_EDGE, gpTop + 14, { size: 9, color: C.muted, align: 'right' });

  const legalW = 470;
  const legal = `${footer.legal} ${footer.provenance}`;
  const lines = b.wrap(legal, legalW, { size: 8 });
  const legalTop = top - lines.length * 8 * 1.55;
  b.text(legal, PAD, legalTop, { size: 8, color: C.faint, lineHeight: 1.55, maxW: legalW });
  const ruleY = Math.min(legalTop, gpTop) - 10;
  b.hline(PAD, RIGHT_EDGE, ruleY, C.rule);
  return ruleY;
}

/* -------------------------------------------------------------------- main */

/**
 * Draw the whole page onto an already-constructed jsPDF document.
 *
 * Separated from the download so the layout can be exercised in Node against a
 * recording stub — `fund_brief_layout.test.mjs` uses it to prove the document
 * still fits on one sheet, which is the failure mode a one-pager has (content
 * past the page box is silently clipped, not paginated).
 *
 * @returns {{ bottom: number, footerTop: number, columns: { left: number, right: number } }}
 *          the process block's lower edge, the footer rule, and each column's
 *          end — all in design px.
 */
export function renderFundBrief(doc, vm) {
  const b = board(doc);

  // White page under everything — the export's page is #fff and jsPDF's is
  // transparent, which some viewers render dark.
  b.rect(0, 0, BOARD_W, BOARD_H, C.white);

  let y = drawMasthead(b, vm.meta);
  y = drawRaiseStrip(b, vm.raise, y);

  const bodyTop = y + 14;
  let ly = drawThesis(b, bodyTop, vm.thesisBody);
  ly = drawStructure(b, ly, vm.terms);
  ly = drawTiers(b, ly, vm.tiers);

  let ry = drawRecord(b, bodyTop, vm.record);
  ry = drawPipeline(b, ry, vm);
  ry = drawProviders(b, ry, vm.providers);

  const bottom = drawProcess(b, Math.max(ly, ry) + 6, vm.steps);
  const footerTop = drawFooter(b, vm.footer);
  return { bottom, footerTop, columns: { left: ly, right: ry } };
}

/** The page box, in the design px this module lays out in. */
export const BRIEF_BOARD = { w: BOARD_W, h: BOARD_H };

/**
 * Render and download the one-pager.
 *
 * @param {object} [opts]
 * @param {Date}   [opts.generatedAt]  stamped on the masthead; defaults to now
 * @param {object} [opts.recipient]    { name, email, standing }
 * @param {string} [opts.filename]
 * @returns {Promise<{ filename: string }>}
 */
export async function exportFundBriefPdf({ generatedAt, recipient, filename } = {}) {
  const stamp = generatedAt instanceof Date && !Number.isNaN(generatedAt.getTime()) ? generatedAt : new Date();
  const vm = fundBriefModel({ generatedAt: stamp, recipient });

  const jspdfMod = await import('jspdf');
  const JsPDF = jspdfMod.jsPDF || jspdfMod.default;
  const doc = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });

  doc.setProperties({
    title: `${vm.meta.fundName} — fund brief`,
    subject: 'Confidential fund brief',
    author: 'Axal VC',
    creator: 'Axal VC StudioOS',
  });

  renderFundBrief(doc, vm);

  const name = filename || fundBriefFilename(stamp);
  doc.save(name);
  return { filename: name };
}
