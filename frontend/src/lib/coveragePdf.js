// Task #33 — Print-ready PDF export of the Portfolio Coverage heatmap.
//
// Renders a branded, colour-coded vector PDF (companies × axes, per-cell
// scores, flagged markers, and the portfolio-average footer row) directly
// with jsPDF — drawing the grid ourselves rather than rasterising the
// on-screen table. The live table uses sticky columns, dark-mode classes,
// and horizontal scroll, all of which html2canvas captures poorly; a vector
// table is sharper, smaller, and matches the LP/partner-meeting use case.
//
// Source of truth is the same GET /portfolio/coverage payload the table
// renders, and the caller passes the already-sorted `companies`, so the PDF
// mirrors the selected fund and current sort order exactly.

// RGB equivalents of the on-screen Tailwind cell ramp (light variants), so a
// printed cell reads the same as the screen. Mirrors cellStyle() in
// PortfolioCoveragePage.jsx: keep the two ramps in sync.
function scoreColors(score) {
  if (score >= 80) return { fill: [209, 250, 229], text: [6, 78, 59] };    // emerald
  if (score >= 60) return { fill: [236, 252, 203], text: [54, 83, 20] };   // lime
  if (score >= 40) return { fill: [254, 243, 199], text: [120, 53, 15] };  // amber
  if (score >= 20) return { fill: [255, 237, 213], text: [124, 45, 18] };  // orange
  return { fill: [255, 228, 230], text: [136, 19, 55] };                   // rose
}

// Format an aggregate value: whole numbers plain, fractions to 1dp (matches
// the table footer + CSV average row).
function fmtAgg(v) {
  const n = v ?? 0;
  return Number.isInteger(n) ? String(n) : Number(n).toFixed(1);
}

// Slug-safe scope token for the filename (fund name or "all-companies").
export function coverageScopeToken(data) {
  return data?.fund
    ? data.fund.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '')
    : 'all-companies';
}

export function coveragePdfFilename(data, today = new Date()) {
  const stamp = today.toISOString().slice(0, 10);
  return `portfolio-coverage-${coverageScopeToken(data)}-${stamp}.pdf`;
}

// Build and trigger download of the coverage PDF. `data` is the /coverage
// payload; `companies` is the already-sorted list shown in the table.
export async function exportCoveragePdf(data, companies) {
  const jspdfMod = await import('jspdf');
  const JsPDF = jspdfMod.jsPDF || jspdfMod.default;

  const axes = data?.axes || [];
  const aggregate = data?.aggregate || {};
  const margin = 36;

  const doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usableW = pageW - margin * 2;

  // Column geometry: company name (left), one per axis, then a Gaps column.
  const nameW = 150;
  const gapsW = 44;
  const axisW = axes.length > 0 ? (usableW - nameW - gapsW) / axes.length : 0;
  const rowH = 20;

  const drawHeaderBand = (y) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setFillColor(241, 245, 249); // slate-100
    doc.rect(margin, y, usableW, rowH, 'F');
    doc.setTextColor(71, 85, 105); // slate-600
    doc.text('COMPANY', margin + 6, y + rowH / 2 + 2.5, { baseline: 'middle' });
    axes.forEach((a, i) => {
      const cx = margin + nameW + i * axisW + axisW / 2;
      // Axis labels can be long ("Marketing / Brand"); shrink to fit the column.
      const label = String(a.label || a.slug);
      doc.text(label, cx, y + rowH / 2 + 2.5, { align: 'center', baseline: 'middle', maxWidth: axisW - 4 });
    });
    doc.text('GAPS', margin + nameW + axes.length * axisW + gapsW / 2, y + rowH / 2 + 2.5, { align: 'center', baseline: 'middle' });
    return y + rowH;
  };

  // ---- Title block ---------------------------------------------------------
  let y = margin;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text('Portfolio Coverage', margin, y + 4);
  y += 20;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const scopeLabel = data?.fund ? data.fund.name : 'All companies';
  const stampLabel = new Date().toISOString().slice(0, 10);
  doc.text(`Scope: ${scopeLabel}    Generated: ${stampLabel}`, margin, y);
  y += 13;
  const threshold = data?.gap_threshold ?? 60;
  doc.text(
    `${data?.company_count ?? companies.length} companies · ${data?.flagged_count ?? 0} flagged (3+ gaps) · cells below ${threshold} are under-covered`,
    margin, y,
  );
  y += 16;

  // ---- Table header --------------------------------------------------------
  y = drawHeaderBand(y);

  // ---- Company rows --------------------------------------------------------
  doc.setFontSize(8);
  for (const co of companies) {
    // Page break: redraw the header band on the new page.
    if (y + rowH > pageH - margin) {
      doc.addPage();
      y = margin;
      y = drawHeaderBand(y);
      doc.setFontSize(8);
    }

    // Flagged rows get a faint rose wash across the whole row.
    if (co.flagged) {
      doc.setFillColor(255, 241, 242); // rose-50
      doc.rect(margin, y, usableW, rowH, 'F');
    }

    // Company name (+ flag marker).
    doc.setFont('helvetica', co.flagged ? 'bold' : 'normal');
    doc.setTextColor(15, 23, 42);
    const namePrefix = co.flagged ? '! ' : '';
    doc.text(`${namePrefix}${String(co.name ?? '')}`, margin + 6, y + rowH / 2 + 2, {
      baseline: 'middle', maxWidth: nameW - 10,
    });

    // Axis cells: filled rectangle + centred score.
    axes.forEach((a, i) => {
      const score = co.axes?.[a.slug] ?? 0;
      const { fill, text } = scoreColors(score);
      const x = margin + nameW + i * axisW;
      doc.setFillColor(fill[0], fill[1], fill[2]);
      doc.rect(x + 1, y + 1.5, axisW - 2, rowH - 3, 'F');
      // Gap axes get a rose outline so they're scannable in print.
      if ((co.gap_axes || []).includes(a.slug)) {
        doc.setDrawColor(244, 63, 94); // rose-500
        doc.setLineWidth(0.8);
        doc.rect(x + 1, y + 1.5, axisW - 2, rowH - 3, 'S');
      }
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(text[0], text[1], text[2]);
      doc.text(String(score), x + axisW / 2, y + rowH / 2 + 2, { align: 'center', baseline: 'middle' });
    });

    // Gap count.
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(co.flagged ? 190 : 71, co.flagged ? 18 : 85, co.flagged ? 60 : 105);
    doc.text(String(co.gap_count ?? 0), margin + nameW + axes.length * axisW + gapsW / 2, y + rowH / 2 + 2, {
      align: 'center', baseline: 'middle',
    });

    y += rowH;
  }

  // ---- Portfolio-average footer row ---------------------------------------
  if (companies.length > 0) {
    if (y + rowH > pageH - margin) {
      doc.addPage();
      y = margin;
      y = drawHeaderBand(y);
    }
    doc.setLineWidth(1);
    doc.setDrawColor(148, 163, 184); // slate-400
    doc.line(margin, y, margin + usableW, y);
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y, usableW, rowH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text('PORTFOLIO AVERAGE', margin + 6, y + rowH / 2 + 2.5, { baseline: 'middle' });
    doc.setFontSize(8);
    axes.forEach((a, i) => {
      const v = aggregate[a.slug] ?? 0;
      const { fill, text } = scoreColors(v);
      const x = margin + nameW + i * axisW;
      doc.setFillColor(fill[0], fill[1], fill[2]);
      doc.rect(x + 1, y + 1.5, axisW - 2, rowH - 3, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(text[0], text[1], text[2]);
      doc.text(fmtAgg(v), x + axisW / 2, y + rowH / 2 + 2, { align: 'center', baseline: 'middle' });
    });
    y += rowH;
  }

  doc.save(coveragePdfFilename(data));
}
