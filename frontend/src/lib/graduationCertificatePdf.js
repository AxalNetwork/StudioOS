// Spin-Out Lab — Graduation Certificate PDF.
//
// A4 LANDSCAPE, matching the design's "Certificate preview · A4 landscape"
// (spin-out-lab-pipeline/project/Graduation Certificate.dc.html, a 840×594
// artboard — the same 1.414 ratio, so the layout maps 1:1 onto A4 landscape).
//
// Vector-drawn with jsPDF, the same approach as scoringReportPdf.js and
// coveragePdf.js: no html2canvas. The on-screen certificate uses dark-mode
// classes, a container-query transform scale and a background photograph,
// all of which rasterise badly; a vector page is sharper, smaller, and
// prints correctly.
//
// Deliberately NOT reproduced from the design's artboard:
//   - the background artwork + white scrim. Embedding a full-bleed raster
//     would defeat the vector approach and bloat every download; the frame
//     and rule carry the same structure.
//   - the signatory's photograph (the design's uploads/photo-1.png is not in
//     this repo) and the Mrs-Saint-Delafield script face (a Google font the
//     app does not bundle; jsPDF has no access to it either). The signature
//     block renders in the document's own italic serif over the same rule.
//   - the QR block, which in the design is a decorative pseudo-QR generated
//     from a hash pattern — it encodes nothing. A real QR would need a
//     verification URL that resolves, which is part of the credential
//     registry this page deliberately does not fake.
// Every one of those is stated in the PDF's own footer, so the artifact is
// self-describing rather than silently different from the preview.

const INK = [18, 16, 26];
const GRAY = [107, 107, 120];
const LIGHT = [161, 161, 170];
const VIOLET = [124, 58, 237];
const RULE = [235, 232, 242];
const FRAME = [224, 220, 234];

export async function exportCertificatePdf({ cert, pillars, filename }) {
  const jspdfMod = await import('jspdf');
  const JsPDF = jspdfMod.jsPDF || jspdfMod.default;

  const doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
  const pageW = doc.internal.pageSize.getWidth();   // 842pt
  const pageH = doc.internal.pageSize.getHeight();  // 595pt

  const setColor = (c) => doc.setTextColor(c[0], c[1], c[2]);
  const centered = (text, y, { font = 'helvetica', style = 'normal', size = 12, color = INK, spacing } = {}) => {
    doc.setFont(font, style);
    doc.setFontSize(size);
    setColor(color);
    if (spacing != null && typeof doc.setCharSpace === 'function') doc.setCharSpace(spacing);
    doc.text(String(text), pageW / 2, y, { align: 'center' });
    if (spacing != null && typeof doc.setCharSpace === 'function') doc.setCharSpace(0);
  };

  // ---- top accent bar (design: violet → teal gradient; flat violet here,
  // since jsPDF has no gradient primitive and a faked band would band badly)
  doc.setFillColor(VIOLET[0], VIOLET[1], VIOLET[2]);
  doc.rect(0, 0, pageW, 5, 'F');

  // ---- ornamental double frame (design: inset 22 / 28 on an 840pt board)
  doc.setDrawColor(FRAME[0], FRAME[1], FRAME[2]);
  doc.setLineWidth(0.8);
  doc.rect(22, 22, pageW - 44, pageH - 44, 'S');
  doc.setDrawColor(244, 242, 249);
  doc.setLineWidth(0.6);
  doc.rect(29, 29, pageW - 58, pageH - 58, 'S');

  const marginX = 74;

  // ---- wordmark row
  let y = 62;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  setColor(INK);
  doc.text(String(cert.issuer || 'Axal VC'), marginX, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  setColor([78, 78, 90]);
  if (typeof doc.setCharSpace === 'function') doc.setCharSpace(1.6);
  doc.text(String(cert.program || 'Spin-Out Lab').toUpperCase(), marginX, y + 13);
  if (typeof doc.setCharSpace === 'function') doc.setCharSpace(0);

  if (cert.ref) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    setColor([90, 90, 102]);
    if (typeof doc.setCharSpace === 'function') doc.setCharSpace(1.4);
    doc.text('CREDENTIAL', pageW - marginX, y - 2, { align: 'right' });
    if (typeof doc.setCharSpace === 'function') doc.setCharSpace(0);
    doc.setFont('courier', 'normal');
    doc.setFontSize(9);
    setColor([82, 82, 91]);
    doc.text(String(cert.ref), pageW - marginX, y + 11, { align: 'right' });
  }

  doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
  doc.setLineWidth(0.7);
  doc.line(marginX, y + 30, pageW - marginX, y + 30);

  // ---- body
  y = 168;
  centered('CERTIFICATE OF GRADUATION', y, { style: 'bold', size: 9, color: VIOLET, spacing: 2.6 });

  y += 52;
  // Founder name — the design sets this in Instrument Serif at 62px on an
  // 840pt board; times at ~40pt is the closest core-font equivalent.
  const name = String(cert.founder || '—');
  doc.setFont('times', 'normal');
  doc.setFontSize(name.length > 30 ? 30 : 40);
  setColor(INK);
  doc.text(name, pageW / 2, y, { align: 'center' });

  // ---- citation
  y += 34;
  const dayPhrase = cert.days ? `${cert.days}-day` : '';
  const parts = [
    `has completed the ${dayPhrase} ${cert.issuer} ${cert.program}`.replace(/\s+/g, ' '),
    cert.company ? `as founder of ${cert.company},` : '',
    cert.cohortLabel ? `satisfying every venture-readiness milestone of ${cert.cohortLabel}` : 'satisfying every venture-readiness milestone',
    '— from validated customer demand and a scored diligence package to an incorporated entity and an executed cap table.',
  ].filter(Boolean).join(' ');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  setColor(GRAY);
  const lines = doc.splitTextToSize(parts, 440);
  doc.text(lines, pageW / 2, y, { align: 'center', lineHeightFactor: 1.7 });
  y += lines.length * 17;

  // ---- pillars (only the ones that resolved to real values)
  const cols = (pillars || []).filter((p) => p && p.v);
  if (cols.length) {
    y += 22;
    const colW = 118;
    const totalW = colW * cols.length;
    let x = (pageW - totalW) / 2;
    cols.forEach((p, i) => {
      if (i > 0) {
        doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
        doc.setLineWidth(0.7);
        doc.line(x, y - 12, x, y + 14);
      }
      doc.setFont('courier', 'normal');
      doc.setFontSize(13);
      setColor(INK);
      doc.text(String(p.v), x + colW / 2, y, { align: 'center' });
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      setColor([90, 90, 102]);
      if (typeof doc.setCharSpace === 'function') doc.setCharSpace(1.2);
      doc.text(String(p.k).toUpperCase(), x + colW / 2, y + 13, { align: 'center' });
      if (typeof doc.setCharSpace === 'function') doc.setCharSpace(0);
      x += colW;
    });
  }

  // ---- signature block + seal
  const sigY = pageH - 128;
  doc.setFont('times', 'italic');
  doc.setFontSize(24);
  setColor([29, 23, 48]);
  doc.text(String(cert.signer || ''), marginX, sigY);
  doc.setDrawColor(216, 212, 226);
  doc.setLineWidth(0.7);
  doc.line(marginX, sigY + 9, marginX + 260, sigY + 9);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  setColor(GRAY);
  doc.text(String(cert.signerRole || ''), marginX, sigY + 22);

  // seal
  const sealR = 42;
  const sealX = pageW - marginX - sealR;
  const sealY = sigY - 4;
  doc.setDrawColor(216, 207, 240);
  doc.setLineWidth(1.1);
  doc.circle(sealX, sealY, sealR, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  setColor(VIOLET);
  if (typeof doc.setCharSpace === 'function') doc.setCharSpace(1.2);
  doc.text(String(cert.issuer || 'AXAL VC').toUpperCase(), sealX, sealY - 12, { align: 'center' });
  if (typeof doc.setCharSpace === 'function') doc.setCharSpace(0);
  if (cert.cohortNum) {
    doc.setFont('times', 'normal');
    doc.setFontSize(22);
    setColor(INK);
    doc.text(String(cert.cohortNum), sealX, sealY + 8, { align: 'center' });
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  setColor([78, 78, 90]);
  if (typeof doc.setCharSpace === 'function') doc.setCharSpace(1.1);
  doc.text('GRADUATE', sealX, sealY + 24, { align: 'center' });
  if (typeof doc.setCharSpace === 'function') doc.setCharSpace(0);

  // ---- footer
  const footY = pageH - 52;
  doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
  doc.setLineWidth(0.7);
  doc.line(marginX, footY - 14, pageW - marginX, footY - 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  setColor([90, 90, 102]);
  const conferredLine = [
    cert.conferred ? `Conferred ${cert.conferred}` : null,
    cert.jurisdiction,
  ].filter(Boolean).join(' · ');
  if (conferredLine) doc.text(conferredLine, marginX, footY);
  doc.setFontSize(6.5);
  setColor(LIGHT);
  doc.text(
    'Generated from platform records. The credential reference is derived from the graduation record, not allocated '
    + 'from an issuance registry; there is no third-party verification endpoint yet.',
    marginX, footY + 11,
  );

  doc.save(filename || 'graduation-certificate.pdf');
}
