/**
 * D6897 part 2 (#6897, canvas D6054 RA-28 C, RA-30 B, and RA-31 C in part 4): the A4 PDF copy of an evidence pack,
 * a readiness snapshot or a Raise status page, drawn in the browser on `pdfBoard.js` from the models in
 * `pages/cycles/evidence/sharePdfModel.js` and `statusPageModel.js`. There is no Worker PDF route: the Worker returns the frozen content and records that a copy left; this draws and saves it.
 *
 * A4 portrait is 595.28 × 841.89 pt, which in the board's design px (÷ 0.75) is 794 × 1123. Tables flow down the
 * page and continue on a new one, with their header row repeated, so a long pack is never clipped. Every page
 * carries the same footer: what it is, the day it was made, "Page n of m", and that it does not update.
 */
import { board } from './pdfBoard.js';
import { readinessPdfModel, packPdfModel } from '../pages/cycles/evidence/sharePdfModel.js';
import { statusPdfModel } from '../pages/cycles/evidence/statusPageModel.js';

export const A4 = Object.freeze({ w: 794, h: 1123 });
const M = 48;
const W = A4.w - 2 * M;
const BOTTOM = A4.h - 72;
const INK = '#241d35';
const MUTED = '#6b6577';
const VIOLET = '#6d28d9';
const EDGE = '#e4e1ea';
const SIZE = { eyebrow: 9, title: 22, body: 11, cell: 9.5, head: 8.5, h2: 12, foot: 8.5 };

/** Draws `model` onto a jsPDF document (A4 portrait, pt). Returns the number of pages. */
export function renderSharePdf(doc, model) {
  const b = board(doc);
  let y = M;
  let pages = 1;
  const newPage = () => { doc.addPage(); pages += 1; y = M; };
  const room = (h) => { if (y + h > BOTTOM) newPage(); };
  const para = (text, opts = {}) => {
    const o = { size: SIZE.body, color: INK, lineHeight: 1.35, ...opts };
    const lines = b.wrap(text, W, o);
    for (const ln of lines) { room(o.size * o.lineHeight); y = b.text(ln, M, y, o); }
  };

  para(model.eyebrow, { size: SIZE.eyebrow, style: 'bold', color: VIOLET });
  y += 4;
  para(model.title, { size: SIZE.title, style: 'bold' });
  y += 4;
  para(model.dated, { size: SIZE.body, color: INK });
  if (model.shared) para(model.shared, { size: SIZE.body, color: MUTED });
  if (model.partial) para(model.partial, { size: SIZE.body, color: '#92400e' });
  if (model.line) {
    y += 8;
    para('The founder’s covering line', { size: SIZE.eyebrow, style: 'bold', color: MUTED });
    para(model.line, { size: SIZE.body + 1 });
  }
  y += 10;
  b.hline(M, M + W, y, EDGE);
  y += 14;

  for (const section of model.sections) {
    room(SIZE.h2 * 1.4 + 40);
    y = b.text(section.heading, M, y, { size: SIZE.h2, style: 'bold', color: INK });
    y += 6;
    if (section.empty) { para(section.empty, { color: MUTED }); y += 12; continue; }
    const xs = [];
    let x = M;
    for (const f of section.widths) { xs.push(x); x += f * W; }
    const colW = section.widths.map((f) => f * W - 8);
    const header = () => {
      section.columns.forEach((c, i) => b.text(c.toUpperCase(), xs[i], y, { size: SIZE.head, style: 'bold', color: MUTED }));
      y += SIZE.head * 1.4 + 4;
      b.hline(M, M + W, y - 2, EDGE);
      y += 4;
    };
    header();
    for (const row of section.rows) {
      const cells = row.map((v, i) => b.wrap(String(v), colW[i], { size: SIZE.cell, style: i === 0 ? 'bold' : 'normal' }));
      const h = Math.max(...cells.map((l) => l.length)) * SIZE.cell * 1.3 + 8;
      if (y + h > BOTTOM) { newPage(); header(); }
      cells.forEach((lines, i) => {
        let ly = y;
        for (const ln of lines) ly = b.text(ln, xs[i], ly, { size: SIZE.cell, style: i === 0 ? 'bold' : 'normal', color: INK, lineHeight: 1.3 });
      });
      y += h;
      b.hline(M, M + W, y - 4, EDGE);
    }
    y += 14;
  }
  para(model.foot, { size: SIZE.foot, color: MUTED });

  for (let p = 1; p <= pages; p += 1) {
    if (typeof doc.setPage === 'function') doc.setPage(p);
    b.hline(M, M + W, A4.h - 52, EDGE);
    b.text(`${model.title} · ${model.made || ''} · Page ${p} of ${pages} · a copy: it does not update`, M, A4.h - 44, { size: SIZE.foot, color: MUTED });
  }
  return pages;
}

async function save(model, title) {
  const jspdfMod = await import('jspdf');
  const JsPDF = jspdfMod.jsPDF || jspdfMod.default;
  const doc = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
  doc.setProperties({ title, subject: title, author: 'Axal VC', creator: 'Axal VC StudioOS' });
  const pages = renderSharePdf(doc, model);
  doc.save(model.filename);
  return { filename: model.filename, pages };
}

/** RA-30 B: the readiness snapshot the Worker returned, as an A4 PDF download. */
export function downloadReadinessPdf(snapshot) {
  const model = readinessPdfModel(snapshot);
  return save(model, 'Readiness snapshot');
}

/** RA-28 C: the evidence pack the Worker returned, as an A4 PDF download. */
export function downloadPackPdf(pack) {
  const model = packPdfModel(pack);
  return save(model, 'Evidence pack');
}

/** RA-31 C: the Raise status page the Worker returned, as an A4 PDF download. */
export function downloadStatusPdf(page) {
  const model = statusPdfModel(page);
  return save(model, 'Raise status');
}
