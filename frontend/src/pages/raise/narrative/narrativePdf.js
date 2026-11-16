/**
 * D6070 (#6070) — the narrative's PDF, drawn in the browser on jsPDF from
 * `exportModel.js`'s blocks: the same blocks Copy text puts on the
 * clipboard, on Letter pages, each page carrying the watermark (owner pick A
 * on #6067). The page calls it only after the export log answered 201.
 */
import { exportBlocks, exportFilename, watermark } from './exportModel.js';

const PAGE = { w: 612, h: 792, margin: 56, foot: 40 };
const STYLE = {
  title: { size: 18, style: 'bold', color: '#241d35', after: 4 },
  meta: { size: 10, style: 'normal', color: '#6b6577', after: 14 },
  lead: { size: 12.5, style: 'italic', color: '#241d35', after: 14 },
  heading: { size: 12, style: 'bold', color: '#6d28d9', after: 4 },
  body: { size: 11, style: 'normal', color: '#241d35', after: 8 },
  figures: { size: 9.5, style: 'normal', color: '#4a4553', after: 6 },
  note: { size: 9.5, style: 'italic', color: '#6b6577', after: 6 },
};

/** Lay the blocks out on `doc` (a jsPDF, or a test double with the same calls). Returns the page count. */
export function renderNarrativePdf(doc, model, include) {
  const width = PAGE.w - PAGE.margin * 2;
  let y = PAGE.margin;
  const newPage = () => { doc.addPage(); y = PAGE.margin; };
  for (const block of exportBlocks(model, include)) {
    const st = STYLE[block.kind] || STYLE.body;
    doc.setFont('helvetica', st.style);
    doc.setFontSize(st.size);
    doc.setTextColor(st.color);
    const line = st.size * 1.35;
    for (const text of doc.splitTextToSize(String(block.text), width)) {
      if (y + line > PAGE.h - PAGE.margin - PAGE.foot) newPage();
      doc.text(text, PAGE.margin, y + st.size);
      y += line;
    }
    y += st.after;
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor('#6b6577');
    doc.text(watermark(model, p, pages), PAGE.margin, PAGE.h - PAGE.foot);
  }
  return pages;
}

/** Browser download; jsPDF stays out of the narrative's initial bundle. */
export async function downloadNarrativePdf(model, include) {
  const mod = await import('jspdf');
  const JsPDF = mod.jsPDF || mod.default;
  const doc = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
  doc.setProperties({ title: `Investor narrative v${model.version}`, subject: 'Investor narrative', author: 'Axal VC', creator: 'Axal VC StudioOS' });
  const pages = renderNarrativePdf(doc, model, include);
  const filename = exportFilename(model);
  doc.save(filename);
  return { filename, pages };
}
