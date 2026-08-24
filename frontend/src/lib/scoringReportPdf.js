// Spin-Out Lab — client-side "Investor-ready report" PDF for the Scoring
// Engine export modal (audit B7). Vector-drawn with jsPDF, same approach as
// coveragePdf.js — no html2canvas: the on-screen cards use dark-mode classes
// and CSS grid that rasterise poorly, and a vector page is sharper and
// smaller.
//
// One A4 portrait page built from the same snapshot the page renders:
// composite + tier, the 6-axis dimension radar, weakest-first dimension bars
// with per-input sub-factor points, a weak-point remediation summary, and
// benchmark bars against the engine's real tier thresholds with a composite
// marker. Nothing is fabricated: founder-profile detail, per-evidence source
// citations, and cohort benchmarks have no client data source yet, and the
// footer states exactly that.

const INK = [26, 32, 44];
const GRAY = [82, 82, 91];
const LIGHT = [161, 161, 170];
const VIOLET = [124, 58, 237];
const VIOLET_WASH = [237, 233, 254];
const TRACK = [240, 240, 243];

// Same Low/Medium/High ramp the page paints (rose/amber/emerald — 500s for
// bars, 600s for text). jsPDF needs numeric triples, not Tailwind classes, so
// these are hand-maintained: keep in sync with LEVEL_TEXT / LEVEL_BG /
// LEVEL_BAR (and levelFor's ≥70 / ≥50 bands) in lib/scoringViewModel.js.
const LEVEL_RGB = {
  Low: { bar: [244, 63, 94], text: [225, 29, 72] },
  Medium: { bar: [245, 158, 11], text: [217, 119, 6] },
  High: { bar: [16, 185, 129], text: [5, 150, 105] },
};

// Closed polygon via jsPDF's relative-segment lines() API.
function polygon(doc, pts, style) {
  const segs = [];
  for (let i = 1; i < pts.length; i += 1) {
    segs.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
  }
  doc.lines(segs, pts[0][0], pts[0][1], [1, 1], style, true);
}

export function scoringReportFilename(projectName, today = new Date()) {
  const slug = String(projectName || '')
    .replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '') || 'project';
  return `scoring-report-${slug}-${today.toISOString().slice(0, 10)}.pdf`;
}

// `dims` is the page's weakest-first buildDimensions() output; `radarKeys`
// restores the canonical engine order for the radar; `tiers` is
// TIER_THRESHOLDS (ascending).
export async function exportScoringReportPdf({
  projectName, isSandbox, lastRunLabel, composite, delta, deltaIsPractice,
  aiAdjustment, dimensionsTotal, tierLabel, dims, radarKeys, tiers,
}) {
  const jspdfMod = await import('jspdf');
  const JsPDF = jspdfMod.jsPDF || jspdfMod.default;

  const doc = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const usableW = pageW - margin * 2;

  const section = (label, y) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(LIGHT[0], LIGHT[1], LIGHT[2]);
    doc.text(label.toUpperCase(), margin, y);
    doc.setDrawColor(236, 236, 241);
    doc.setLineWidth(0.6);
    doc.line(margin, y + 5, margin + usableW, y + 5);
    return y + 18;
  };

  // ---- Title block ---------------------------------------------------------
  let y = margin + 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text('Scoring Engine — Investor-ready report', margin, y);
  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
  doc.text(
    `${projectName || 'Project'} · generated ${new Date().toISOString().slice(0, 10)}${lastRunLabel ? ` · last run ${lastRunLabel}` : ''}`,
    margin, y,
  );
  y += 12;
  if (isSandbox) {
    doc.setTextColor(180, 83, 9); // amber-700
    doc.text('Practice (sandbox) run — never investor-visible in StudioOS.', margin, y);
    y += 12;
  }

  // ---- Composite (left) + radar (right) ------------------------------------
  const blockTop = y + 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(46);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text(String(composite), margin, blockTop + 42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(LIGHT[0], LIGHT[1], LIGHT[2]);
  doc.text('out of 100', margin + 2, blockTop + 56);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text(String(tierLabel || ''), margin, blockTop + 74, { maxWidth: 220 });
  let metaY = blockTop + 92;
  if (delta != null && delta !== 0) {
    const up = delta > 0;
    const c = up ? LEVEL_RGB.High.text : LEVEL_RGB.Low.text;
    doc.setFontSize(9);
    doc.setTextColor(c[0], c[1], c[2]);
    doc.text(
      `${up ? '+' : ''}${delta} since previous run${deltaIsPractice ? ' (practice)' : ''}`,
      margin, metaY,
    );
    metaY += 12;
  }
  // The engine clamps `dimension totals + ai_adjustment` into the composite, so
  // without this line the per-dimension bars below can visibly fail to sum to
  // the number above them.
  if (Number.isFinite(Number(aiAdjustment)) && Number(aiAdjustment) !== 0) {
    const adj = Number(aiAdjustment);
    doc.setFontSize(8.5);
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
    doc.text(
      `Dimensions ${Number(dimensionsTotal) || 0} · AI adjustment ${adj > 0 ? '+' : ''}${adj} · Composite ${composite}`,
      margin, metaY, { maxWidth: 220 },
    );
  }

  // Radar — canonical engine order, each axis = % of the dimension's max.
  const byKey = Object.fromEntries(dims.map((d) => [d.key, d]));
  const ordered = (radarKeys || []).map((k) => byKey[k]).filter(Boolean);
  const n = Math.max(1, ordered.length);
  const cx = pageW - margin - 120;
  const cy = blockTop + 52;
  const R = 56;
  const pt = (i, r) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  doc.setDrawColor(228, 228, 231);
  doc.setLineWidth(0.6);
  [0.25, 0.5, 0.75, 1].forEach((f) => polygon(doc, ordered.map((_, i) => pt(i, R * f)), 'S'));
  ordered.forEach((_, i) => {
    const [ex, ey] = pt(i, R);
    doc.line(cx, cy, ex, ey);
  });
  doc.setFillColor(VIOLET_WASH[0], VIOLET_WASH[1], VIOLET_WASH[2]);
  doc.setDrawColor(VIOLET[0], VIOLET[1], VIOLET[2]);
  doc.setLineWidth(1.2);
  polygon(doc, ordered.map((d, i) => pt(i, (R * d.pct) / 100)), 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
  ordered.forEach((d, i) => {
    const [lx, ly] = pt(i, R + 11);
    doc.text(d.label, lx, ly + 2, { align: 'center' });
  });

  // ---- Dimension bars (weakest first, as on the page) ----------------------
  y = section('Dimensions — weakest first · % of weighted max', blockTop + 132);
  for (const d of dims) {
    const lvl = LEVEL_RGB[d.level] || LEVEL_RGB.Medium;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(d.label, margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(LIGHT[0], LIGHT[1], LIGHT[2]);
    doc.text(`weight ${d.max}%`, margin + 92, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(lvl.text[0], lvl.text[1], lvl.text[2]);
    doc.text(`${d.pct} · ${d.level}`, margin + usableW, y, { align: 'right' });
    doc.setFillColor(TRACK[0], TRACK[1], TRACK[2]);
    doc.roundedRect(margin, y + 5, usableW, 5, 2.5, 2.5, 'F');
    if (d.pct > 0) {
      doc.setFillColor(lvl.bar[0], lvl.bar[1], lvl.bar[2]);
      doc.roundedRect(margin, y + 5, Math.max(5, (usableW * d.pct) / 100), 5, 2.5, 2.5, 'F');
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
    doc.text(d.subs.map((s) => `${s.label} ${s.points}/${s.max}`).join('  ·  '), margin, y + 19);
    y += 33;
  }

  // ---- Weak points & remediation (same <70% rule as the page) --------------
  y = section('Weak points & remediation', y + 4);
  const weak = dims.filter((d) => d.pct < 70).slice(0, 4);
  if (weak.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
    doc.text('Every dimension is at High level — no weak points at the current thresholds.', margin, y);
    y += 16;
  } else {
    weak.forEach((d, i) => {
      const weakest = d.weakestSub
        ? `weakest input: ${d.weakestSub.label.toLowerCase()} at ${d.weakestSub.points}/${d.weakestSub.max}`
        : 'all inputs below their maxima';
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(INK[0], INK[1], INK[2]);
      doc.text(
        `${i + 1}. ${d.label} — ${weakest} · +${d.pointsAvailable} pts on the table`,
        margin, y, { maxWidth: usableW - 160 },
      );
      doc.setTextColor(VIOLET[0], VIOLET[1], VIOLET[2]);
      doc.text(d.fix ? d.fix.label : (d.fixNote || ''), margin + usableW, y, { align: 'right' });
      y += 15;
    });
  }

  // ---- Benchmark vs engine tier thresholds + composite marker --------------
  y = section('Benchmark — engine tier thresholds', y + 6);
  const tierColors = [LEVEL_RGB.High.bar, LIGHT];
  const rows = [
    { label: 'Your composite', value: composite, color: VIOLET },
    ...(tiers || []).map((t, i) => ({ label: t.label, value: t.score, color: tierColors[i] || LIGHT })),
  ];
  for (const r of rows) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
    doc.text(r.label, margin, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(String(r.value), margin + usableW, y, { align: 'right' });
    doc.setFillColor(TRACK[0], TRACK[1], TRACK[2]);
    doc.roundedRect(margin, y + 4, usableW, 5, 2.5, 2.5, 'F');
    if (r.value > 0) {
      doc.setFillColor(r.color[0], r.color[1], r.color[2]);
      doc.roundedRect(margin, y + 4, Math.max(5, (usableW * Math.min(100, r.value)) / 100), 5, 2.5, 2.5, 'F');
    }
    // Composite marker across every bar (audit B36).
    doc.setFillColor(INK[0], INK[1], INK[2]);
    doc.rect(margin + (usableW * Math.min(100, composite)) / 100 - 0.75, y + 1.5, 1.5, 10, 'F');
    y += 24;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(LIGHT[0], LIGHT[1], LIGHT[2]);
  doc.text(`Marker = your composite (${composite}).`, margin, y + 2);

  // ---- Honest footer -------------------------------------------------------
  doc.setFontSize(7.5);
  doc.setTextColor(LIGHT[0], LIGHT[1], LIGHT[2]);
  doc.text(
    'Generated client-side in StudioOS from the latest scoring run — the same snapshot the Scoring Engine page renders. '
    + 'Not yet included (needs backend data): founder-profile detail (skill map, archetype matrix, values heatmap), '
    + 'per-evidence source citations, and cohort benchmark positioning — engine tier thresholds are shown instead.',
    margin, pageH - 64, { maxWidth: usableW },
  );

  doc.save(scoringReportFilename(projectName));
}
