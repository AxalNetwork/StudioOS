// Quarterly LP report — PDF renderer.
//
// Letter portrait, vector-drawn with jsPDF on the shared board (lib/pdfBoard.js),
// same approach as fundBriefPdf.js and graduationCertificatePdf.js.
//
// PAGE COUNT IS DYNAMIC. The design is four fixed pages, but page 1 carries the
// GP's letter, which is authored prose of unknown length. Rather than clip a
// fiduciary's own words at a page boundary — the failure a fixed-page document
// makes silently — paragraphs that do not fit page 1 spill onto a continuation
// page, and every footer is stamped with the real total after the whole document
// is laid out.
//
// The masthead photograph and logo bitmap from the export are not reproduced,
// for the reason the certificate PDF gives: a raster would defeat a vector
// document. Fonts fall back to the PDF core faces (Helvetica for Inter, Courier
// for the tabular Roboto Mono figures).
import { BOARD, board } from './pdfBoard.js';
import { quarterlyReportModel, quarterlyReportFilename } from './quarterlyReportViewModel.js';

const W = BOARD.w;
const H = BOARD.h;
const PAD = 44;
const RIGHT = W - PAD;
const INNER = W - PAD * 2;

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
  white: '#ffffff',
  red: '#b91c1c',
  green: '#15803d',
  amber: '#92400e',
  mast: ['#140c26', '#1c1236', '#26164a'],
};

/* ------------------------------------------------------------------ pieces */

/** Violet uppercase label over a 1.5px rule. Returns the content top. */
function label(b, x, w, y, text, right) {
  b.text(String(text).toUpperCase(), x, y, { size: 12.1, style: 'bold', color: C.violet, ls: 1.33 });
  if (right) b.text(right, x + w, y + 1, { size: 11.4, color: C.faint, align: 'right' });
  const ruleY = y + 12.1 + 6;
  b.hline(x, x + w, ruleY, C.violetRule, 1.5);
  return ruleY + 9;
}

/** Section banner used at the top of pages 2 onward. */
function pageHead(b, y, section, title, right) {
  b.text(section.toUpperCase(), PAD, y, { size: 12.1, style: 'bold', color: C.faint, ls: 1.69 });
  b.text(title, PAD, y + 18, { size: 24.1, style: 'bold', color: C.ink });
  if (right) b.text(right, RIGHT, y + 26, { size: 12.7, mono: true, color: C.faint, align: 'right' });
  const ruleY = y + 18 + 24.1 * 1.25 + 8;
  b.hline(PAD, RIGHT, ruleY, C.ink, 2);
  return ruleY + 13;
}

/** Key/value rows over dotted rules — the report's workhorse block. */
function kvRows(b, x, w, y, rows, { size = 13.4, gap = 20, dotted = true } = {}) {
  let cy = y;
  for (const r of rows) {
    b.text(r.k, x, cy, {
      size, color: r.strong ? C.ink : C.muted, style: r.strong ? 'bold' : 'normal', maxW: w * 0.62,
    });
    b.text(r.v, x + w, cy, {
      size, style: 'bold', mono: true, align: 'right',
      color: r.accent ? C.violet : r.negative ? C.red : C.ink,
    });
    if (dotted) b.dotted(x, x + w, cy + size * 1.25 + 3, C.rule);
    cy += gap;
  }
  return cy;
}

function tableHead(b, y, cols) {
  for (const col of cols) {
    b.text(col.label.toUpperCase(), col.align === 'right' ? col.x + col.w : col.x, y, {
      size: 11, style: 'bold', color: C.faint, ls: 0.77, align: col.align === 'right' ? 'right' : 'left',
    });
  }
  return y + 16;
}

function pill(b, xRight, y, text, tone, size = 11.4) {
  const w = b.width(text, { size, style: 'bold' }) + 14;
  b.rrect(xRight - w, y, w, size * 1.25 + 6, (size * 1.25 + 6) / 2, { fill: tone.bg });
  b.text(text, xRight - w / 2, y + 3, { size, style: 'bold', color: tone.fg, align: 'center' });
  return w;
}

/* --------------------------------------------------------------- page one */

/** The y the page-1 body must stay above, so nothing runs under the footer. */
const COVER_FLOOR = 962;

const COVER_DISCLOSURE =
  'Record lines are your own; allocated lines are your pro-rata share of GP-maintained fund figures.';

function drawCover(b, vm) {
  const m = vm.meta;
  // Measure the masthead before painting the band, so it stops where the block
  // ends instead of striping down behind the metrics strip.
  const logoBottom = 24 + 26 + 14;
  const kickerBottom = logoBottom + 12.1 * 1.25;
  const titleTop = kickerBottom + 7;
  const titleLines = b.wrap(`${m.period} · ${m.fundName}`, 470, { size: 32.2, style: 'bold' }).length;
  const titleBottom = titleTop + titleLines * 32.2 * 1.25;
  const subTop = titleBottom + 4;
  const height = subTop + 15.4 * 1.25 + 20;

  b.gradientBand(0, 0, W, height, C.mast, 0.44);

  b.rrect(PAD, 24, 26, 26, 7, { fill: '#7c3aed' });
  b.text('A', PAD + 13, 29, { size: 15, style: 'bold', color: C.white, align: 'center' });
  b.text('Axal VC', PAD + 35, 27, { size: 21.4, style: 'bold', color: C.white });

  b.text('Quarterly LP report · confidential', PAD, logoBottom, {
    size: 12.1, style: 'bold', color: '#8b8496', ls: 1.94,
  });
  b.text(`${m.period} · ${m.fundName}`, PAD, titleTop, {
    size: 32.2, style: 'bold', color: C.white, maxW: 470,
  });
  b.text(`Reporting period ${m.range} · issued ${m.issued}`, PAD, subTop, {
    size: 15.4, color: '#b9b3c6', maxW: 470,
  });

  // Status pill + recipient. A draft says so in amber, on the cover, where an
  // LP cannot miss it.
  const tone = m.draft ? { bg: '#3a2f14', fg: '#fcd34d' } : { bg: '#2f2a52', fg: '#ddd6fe' };
  pill(b, RIGHT, 24, m.status, tone, 12.7);
  b.text(`Prepared for ${m.lp}`, RIGHT, 24 + 12.7 * 1.25 + 14, {
    size: 12.7, mono: true, color: '#d2cedb', align: 'right', maxW: 300,
  });

  /* ---- headline metrics strip ---- */
  let y = height;
  const colW = W / vm.headline.length;
  const cellW = colW - 32;
  const noteLines = Math.max(...vm.headline.map((h) => b.wrap(h.note, cellW, { size: 12.7 }).length));
  const stripH = 52 + noteLines * 12.7 * 1.4 + 11;
  b.rect(0, y, W, stripH, C.wash);
  vm.headline.forEach((h, i) => {
    const x = i * colW + 16;
    b.text(h.k.toUpperCase(), x, y + 13, { size: 11.4, style: 'bold', color: C.faint, ls: 1.03, maxW: cellW });
    b.text(h.v, x, y + 29, { size: 20.1, style: 'bold', mono: true, color: h.tone, maxW: cellW });
    b.text(h.note, x, y + 52, { size: 12.7, color: C.muted, lineHeight: 1.4, maxW: cellW });
    if (i > 0) b.rect(i * colW, y, 1, stripH, C.ruleSoft);
  });
  b.hline(0, W, y + stripH, C.rule);
  y += stripH + 16;

  /* ---- GP letter, if the whole of it fits ----
   *
   * The letter is authored prose of unknown length, and everything below it on
   * this page is fixed. So measure what the page still owes — the capital
   * account, its disclosure, and the deployment chart — and give the letter
   * whatever is left. A letter that does not fit whole moves to its own page
   * rather than being split after an arbitrary line or, worse, run under the
   * footer. A short letter (and the draft placeholder) stays on the cover
   * exactly as the design has it. */
  const half = (INNER - 24) / 2;
  const accountRows = Math.max(vm.capitalAccount.length, vm.fundSummary.length);
  const disclosureLines = b.wrap(COVER_DISCLOSURE, half, { size: 10.5 }).length;
  const accountH = 31 + accountRows * 20 + disclosureLines * 10.5 * 1.45 + 2
    + (vm.reconciliation.ties ? 0 : 3 * 10.5 * 1.45 + 4);
  // Deployment by quarter used to sit here, as it does in the design. It moved
  // to the portfolio page: this cover's capital account carries two rows and a
  // disclosure the design's did not, and something had to give. A chart of what
  // the fund deployed reads perfectly well beneath the positions it bought,
  // whereas squeezing the GP's letter onto its own near-empty page — the only
  // other way to find the room — looks like a layout fault every quarter.
  const letterAvail = COVER_FLOOR - y - accountH - 20 - 31; // 31 = the letter's own label

  let letterH = 0;
  for (const para of vm.letter.paragraphs) {
    letterH += b.wrap(para, INNER, { size: 14.1 }).length * 14.1 * 1.62 + 6;
  }
  const inlineLetter = !vm.letter.authored || letterH <= letterAvail;

  let cy = label(b, PAD, INNER, y, 'Letter from the General Partner');
  if (!vm.letter.authored) {
    const ph = b.wrap(vm.letter.placeholder, INNER - 28, { size: 12.7 }).length * 12.7 * 1.5 + 24;
    b.rrect(PAD, cy, INNER, ph, 10, { fill: '#fffbeb', stroke: '#fde68a' });
    cy = b.text(vm.letter.placeholder, PAD + 14, cy + 12, {
      size: 12.7, color: C.amber, lineHeight: 1.5, maxW: INNER - 28,
    }) + 16;
  } else if (inlineLetter) {
    for (const para of vm.letter.paragraphs) {
      cy = b.text(para, PAD, cy, { size: 14.1, color: C.body, lineHeight: 1.62, maxW: INNER }) + 6;
    }
  } else {
    cy = b.text(
      `The General Partner's letter for ${vm.meta.period} follows on the next page.`,
      PAD, cy, { size: 13.4, color: C.muted, maxW: INNER },
    ) + 6;
  }
  y = cy + 6;

  /* ---- capital account + fund summary ---- */
  let ly = label(b, PAD, half, y, `Capital account · ${vm.meta.lp}`);
  ly = kvRows(b, PAD, half, ly, vm.capitalAccount);
  // The two-kinds-of-number disclosure, right under the account it applies to.
  ly = b.text(COVER_DISCLOSURE, PAD, ly + 2, { size: 10.5, color: C.faint, lineHeight: 1.45, maxW: half });
  if (!vm.reconciliation.ties) {
    ly = b.text(
      `Capital call history totals ${vm.calls[vm.calls.length - 1]?.v || '—'} paid against a paid-in balance of `
      + `${vm.capitalAccount.find((r) => r.k === 'Paid-in capital')?.v || '—'}. The difference is unreconciled.`,
      PAD, ly + 4, { size: 10.5, color: C.red, lineHeight: 1.45, maxW: half },
    );
  }

  const rx = PAD + half + 24;
  let ry = label(b, rx, half, y, 'Fund-level summary');
  ry = kvRows(b, rx, half, ry, vm.fundSummary);

  return { bottom: Math.max(ly, ry), letterOverflowed: vm.letter.authored && !inlineLetter };
}

/* ------------------------------------------------------------ pages 2 – 4 */

function drawPortfolio(b, vm) {
  let y = pageHead(b, 22, 'Section II', 'Portfolio review', `${vm.meta.period} · ${vm.meta.range}`);

  y = label(b, PAD, INNER, y, 'Active positions');
  const cols = [
    { label: 'Company', x: PAD, w: 210 },
    { label: 'Cohort', x: PAD + 220, w: 50 },
    { label: 'Invested', x: PAD + 280, w: 80, align: 'right' },
    { label: 'Held value', x: PAD + 370, w: 90, align: 'right' },
    { label: 'MOIC', x: PAD + 470, w: 60, align: 'right' },
    { label: 'Status', x: PAD + 545, w: INNER - 545 },
  ];
  y = tableHead(b, y, cols);
  for (const p of vm.portfolio) {
    b.hline(PAD, RIGHT, y, C.ruleFaint);
    const ty = y + 4;
    b.text(p.company, cols[0].x, ty, { size: 13.4, style: 'bold', color: C.ink, maxW: cols[0].w });
    b.text(p.sector, cols[0].x, ty + 16, { size: 11.4, color: C.faint, maxW: cols[0].w });
    b.text(p.cohort, cols[1].x, ty + 4, { size: 12.7, mono: true, color: C.muted });
    b.text(p.invested, cols[2].x + cols[2].w, ty + 4, { size: 12.7, mono: true, color: C.body, align: 'right' });
    b.text(p.held, cols[3].x + cols[3].w, ty + 4, { size: 12.7, style: 'bold', mono: true, color: C.ink, align: 'right' });
    b.text(p.moic, cols[4].x + cols[4].w, ty + 4, { size: 12.7, style: 'bold', mono: true, color: p.moicTone, align: 'right' });
    pill(b, RIGHT, ty + 1, p.status, p.pill);
    y += 34;
  }
  b.hline(PAD, RIGHT, y, C.ink, 1.5);
  b.rect(PAD, y, INNER, 24, C.wash);
  b.text(`Total · ${vm.portfolioTotals.count} positions`, PAD, y + 5, { size: 12.7, style: 'bold', color: C.ink });
  b.text(vm.portfolioTotals.invested, cols[2].x + cols[2].w, y + 5, { size: 12.7, style: 'bold', mono: true, color: C.ink, align: 'right' });
  b.text(vm.portfolioTotals.held, cols[3].x + cols[3].w, y + 5, { size: 12.7, style: 'bold', mono: true, color: C.ink, align: 'right' });
  b.text(vm.portfolioTotals.moic, cols[4].x + cols[4].w, y + 5, { size: 12.7, style: 'bold', mono: true, color: C.green, align: 'right' });
  y += 24 + 20;

  /* ---- developments + exposure ---- */
  const devW = (INNER - 22) * 0.55;
  const expX = PAD + devW + 22;
  const expW = INNER - devW - 22;

  let ly = label(b, PAD, devW, y, 'Material developments');
  if (vm.developments.length) {
    for (const d of vm.developments) {
      b.text(d.date, PAD, ly + 1, { size: 11.4, style: 'bold', mono: true, color: C.violetFaint, maxW: 44 });
      const bodyX = PAD + 53;
      const bodyW = devW - 53;
      b.text(d.title, bodyX, ly, { size: 13.4, style: 'bold', color: C.ink, maxW: bodyW });
      ly = b.text(d.body, bodyX, ly + 17, { size: 12.7, color: C.muted, lineHeight: 1.5, maxW: bodyW }) + 8;
    }
  } else {
    ly = b.text(
      'No material developments have been recorded for this period. This section is authored by the General Partner before the report is issued.',
      PAD, ly, { size: 12.7, color: C.faint, lineHeight: 1.55, maxW: devW },
    );
  }

  let ry = label(b, expX, expW, y, 'Sector exposure');
  for (const e of vm.exposure) {
    b.text(e.label, expX, ry, { size: 12.7, color: C.body, maxW: expW - 50 });
    b.text(e.pct, expX + expW, ry, { size: 12.7, style: 'bold', mono: true, color: C.ink, align: 'right' });
    const barY = ry + 12.7 * 1.25 + 3;
    b.rrect(expX, barY, expW, 6, 3, { fill: C.ruleSoft });
    if (e.frac > 0) b.rrect(expX, barY, expW * e.frac, 6, 3, { fill: e.bar });
    ry = barY + 6 + 9;
  }
  y = Math.max(ly, ry) + 18;

  /* ---- deployment by quarter (see the cover's note on why it lives here) ---- */
  let dy = label(b, PAD, INNER, y, 'Deployment by quarter', 'Cumulative, from the position list');
  const barsTop = dy + 4;
  const barMax = 72;
  const slot = INNER / vm.deployBars.length;
  vm.deployBars.forEach((bar, i) => {
    const cx = PAD + i * slot + slot / 2;
    const h = Math.round(14 + bar.frac * (barMax - 14));
    const top = barsTop + 18 + (barMax - h);
    b.text(bar.label, cx, barsTop, {
      size: 12.7, style: 'bold', mono: true, align: 'center',
      color: bar.accent ? C.violet : C.muted,
    });
    b.rrect(PAD + i * slot + 10, top, slot - 20, h, 5, {
      fill: bar.accent ? '#7c3aed' : i === vm.deployBars.length - 2 ? '#a78bfa' : '#ddd6fe',
    });
    b.text(bar.q, cx, top + h + 5, { size: 12.1, color: C.muted, align: 'center' });
  });
  return barsTop + 18 + barMax + 5 + 12.1 * 1.25;
}

function drawProgram(b, vm) {
  let y = pageHead(b, 16, 'Section III', 'Program telemetry & outlook', 'Sourcing pipeline · Spin-Out Lab');

  y = label(b, PAD, INNER, y, 'Cohort performance');
  const cols = [
    { label: 'Cohort', x: PAD, w: 120 },
    { label: 'Started', x: PAD + 130, w: 80, align: 'right' },
    { label: 'Graduated', x: PAD + 220, w: 90, align: 'right' },
    { label: 'Median readiness', x: PAD + 320, w: 130, align: 'right' },
    { label: 'Invested', x: PAD + 460, w: 90, align: 'right' },
    { label: 'Follow-on', x: PAD + 560, w: INNER - 560, align: 'right' },
  ];
  y = tableHead(b, y, cols);
  for (const c of vm.cohorts) {
    b.hline(PAD, RIGHT, y, C.ruleFaint);
    if (c.current) b.rect(PAD, y, INNER, 24, C.wash);
    const ty = y + 5;
    b.text(c.name, cols[0].x, ty, { size: 13.4, style: 'bold', color: C.ink });
    b.text(c.started, cols[1].x + cols[1].w, ty, { size: 12.7, mono: true, color: C.muted, align: 'right' });
    b.text(c.graduated, cols[2].x + cols[2].w, ty, { size: 12.7, mono: true, color: C.body, align: 'right' });
    b.text(c.readiness, cols[3].x + cols[3].w, ty, { size: 12.7, style: 'bold', mono: true, color: c.readyTone, align: 'right' });
    b.text(c.invested, cols[4].x + cols[4].w, ty, { size: 12.7, mono: true, color: C.body, align: 'right' });
    b.text(c.followOn, cols[5].x + cols[5].w, ty, { size: 12.7, mono: true, color: C.body, align: 'right' });
    y += 24;
  }
  y += 18;

  /* ---- outlook | administration | reserve ---- */
  const third = (INNER - 40) / 3;
  const xs = [PAD, PAD + third + 20, PAD + (third + 20) * 2];

  let c1 = label(b, xs[0], third, y, 'Next quarter · planned activity');
  if (vm.outlook.length) {
    for (const o of vm.outlook) {
      b.rrect(xs[0], c1 + 5, 5, 5, 2.5, { fill: '#7c3aed' });
      c1 = b.text(o, xs[0] + 13, c1, { size: 13.4, color: C.body, lineHeight: 1.55, maxW: third - 13 }) + 7;
    }
  } else {
    c1 = b.text('Not yet authored for this period.', xs[0], c1, { size: 12.7, color: C.faint, maxW: third });
  }

  let c2 = label(b, xs[1], third, y, 'Fund administration');
  c2 = kvRows(b, xs[1], third, c2, vm.admin.map((a) => ({
    ...a, v: a.v, k: a.k,
  })), { size: 12.7, gap: 21 });

  let c3 = label(b, xs[2], third, y, 'Reserve position');
  c3 = kvRows(b, xs[2], third, c3, vm.reserve, { size: 12.7, gap: 21 });

  y = Math.max(c1, c2, c3) + 18;

  /* ---- valuation notes ---- */
  let ny = label(b, PAD, INNER, y, 'Valuation basis & notes');
  const noteW = (INNER - 44) / 3;
  let noteBottom = ny;
  vm.notes.forEach((n, i) => {
    const nx = PAD + i * (noteW + 22);
    b.text(n.title, nx, ny, { size: 13.4, style: 'bold', color: C.ink, maxW: noteW });
    const end = b.text(n.body, nx, ny + 19, { size: 12.7, color: C.muted, lineHeight: 1.6, maxW: noteW });
    if (end > noteBottom) noteBottom = end;
  });
  y = noteBottom + 16;

  /* ---- key dates ---- */
  const kdH = 62;
  b.rrect(PAD, y, INNER, kdH, 10, { fill: C.wash, stroke: C.rule });
  b.text('KEY DATES', PAD + 18, y + 11, { size: 12.1, style: 'bold', color: C.violet, ls: 1.33 });
  const kdW = (INNER - 36) / vm.keyDates.length;
  vm.keyDates.forEach((d, i) => {
    const x = PAD + 18 + i * kdW;
    b.text(d.date, x, y + 29, { size: 14.1, style: 'bold', mono: true, color: C.ink, maxW: kdW - 12 });
    b.text(d.label, x, y + 46, { size: 12.1, color: C.muted, lineHeight: 1.4, maxW: kdW - 12 });
  });
  return y + kdH;
}

function drawStatements(b, vm) {
  let y = pageHead(b, 16, 'Section IV', 'Financial statements & disclosures', 'Unaudited · prepared by the GP');

  y = label(b, PAD, INNER, y, 'Performance progression · since inception');
  const w = INNER / 7;
  const cols = ['Quarter', 'Called', 'Fund NAV', 'TVPI', 'DPI', 'RVPI', 'Net IRR'].map((l, i) => ({
    label: l, x: PAD + i * w, w, align: i === 0 ? 'left' : 'right',
  }));
  y = tableHead(b, y, cols);
  for (const r of vm.progression) {
    b.hline(PAD, RIGHT, y, C.ruleFaint);
    const ty = y + 6;
    b.text(r.q, cols[0].x, ty, { size: 12.7, style: 'bold', mono: true, color: C.ink, maxW: w });
    [r.called, r.nav, r.tvpi, r.dpi, r.rvpi, r.irr].forEach((v, i) => {
      const col = cols[i + 1];
      b.text(v, col.x + col.w, ty, {
        size: 12.7, mono: true, align: 'right',
        style: i >= 2 ? 'bold' : 'normal',
        color: i === 5 ? r.tone : i === 3 ? C.muted : C.body,
      });
    });
    y += 26;
  }
  y = b.text(
    'Net IRR is calculated on quarterly LP cash flows after management fees and fund expenses, with no carried interest '
    + 'accrued to date. Early-stage IRR over short holding periods is not a reliable indicator of eventual returns and is '
    + 'presented for completeness only.',
    PAD, y + 6, { size: 11, color: C.faint, lineHeight: 1.5, maxW: INNER },
  ) + 18;

  /* ---- fees | call history ---- */
  const half = (INNER - 22) / 2;
  let ly = label(b, PAD, half, y, 'Fees & expenses');
  ly = kvRows(b, PAD, half, ly, vm.fees, { size: 12.7, gap: 21, dotted: false });

  let ry = label(b, PAD + half + 22, half, y, `Capital call history · ${vm.meta.lp}`);
  const callRows = vm.calls.length > 1
    ? vm.calls
    : [{ k: 'No capital calls recorded on or before the period end', v: '—' }];
  ry = kvRows(b, PAD + half + 22, half, ry, callRows, { size: 12.7, gap: 21, dotted: false });
  y = Math.max(ly, ry) + 16;

  /* ---- concentration ---- */
  let cy = label(b, PAD, INNER, y, 'Concentration & risk disclosure');
  const cw = (INNER - 48) / 4;
  let cBottom = cy;
  vm.concentration.forEach((cn, i) => {
    const x = PAD + i * (cw + 16);
    b.text(cn.v, x, cy, { size: 15.4, style: 'bold', mono: true, color: cn.tone });
    const end = b.text(cn.k, x, cy + 22, { size: 11.4, color: C.muted, lineHeight: 1.45, maxW: cw });
    if (end > cBottom) cBottom = end;
  });
  y = cBottom + 16;

  /* ---- subsequent events ---- */
  let sy = label(b, PAD, INNER, y, 'Subsequent events');
  if (vm.subsequent.length) {
    for (const s of vm.subsequent) {
      b.text(s.d, PAD, sy, { size: 12.1, style: 'bold', mono: true, color: C.faint, maxW: 52 });
      sy = b.text(s.e, PAD + 61, sy, { size: 12.7, color: C.body, lineHeight: 1.55, maxW: INNER - 61 }) + 7;
    }
  } else {
    sy = b.text(
      'No subsequent events have been recorded for this period. This section is authored by the General Partner before the report is issued.',
      PAD, sy, { size: 12.7, color: C.faint, lineHeight: 1.55, maxW: INNER },
    );
  }
  y = sy + 14;

  /* ---- basis of preparation ---- */
  const basis = 'These statements are unaudited and prepared by the General Partner on a fair-value basis. '
    + (vm.meta.marksNote ? `${vm.meta.marksNote} ` : '')
    + 'The annual audited financial statements supersede the figures presented here. Percentages may not sum precisely due to rounding.';
  const lines = b.wrap(basis, INNER - 36, { size: 11.4 }).length;
  const boxH = 20 + 16 + lines * 11.4 * 1.6 + 12;
  b.rrect(PAD, y, INNER, boxH, 10, { fill: C.wash, stroke: C.rule });
  b.text('BASIS OF PREPARATION', PAD + 18, y + 11, { size: 12.1, style: 'bold', color: C.violet, ls: 1.33 });
  b.text(basis, PAD + 18, y + 32, { size: 11.4, color: C.muted, lineHeight: 1.6, maxW: INNER - 36 });
  return y + boxH;
}

/* -------------------------------------------------------- footer + stamps */

function drawFooter(b, vm, pageNo, total, { legal, signature }) {
  const bottom = H - 20;
  let sigBottom = bottom;
  if (signature) {
    const s = vm.signer;
    const name = s.recorded
      ? `${s.name}${s.title ? ` · ${s.title}` : ''}`
      : 'General Partner not recorded on this fund';
    b.text(name, RIGHT, bottom - 46, {
      size: 13.4, style: 'bold', color: s.recorded ? C.ink : C.red, align: 'right', maxW: 300,
    });
    b.text(s.recorded ? (s.email || s.entity || '') : 'Set a GP of record before issuing this report', RIGHT, bottom - 29, {
      size: 12.1, color: s.recorded ? C.muted : C.red, align: 'right', maxW: 320,
    });
    sigBottom = bottom - 46;
  }
  b.text(`Page ${pageNo} of ${total}`, RIGHT, bottom - 12, {
    size: 11.4, mono: true, color: C.faint, align: 'right',
  });
  const lines = b.wrap(legal, INNER * 0.62, { size: 11 });
  const legalTop = bottom - lines.length * 11 * 1.55;
  b.text(legal, PAD, legalTop, { size: 11, color: C.faint, lineHeight: 1.55, maxW: INNER * 0.62 });
  b.hline(PAD, RIGHT, Math.min(legalTop, sigBottom) - 11, C.rule);
}

/** Diagonal DRAFT wash across an unissued report. */
function drawDraftStamp(b) {
  b.text('DRAFT', W / 2, H / 2 - 60, { size: 96, style: 'bold', color: '#f4f1fb', align: 'center' });
  b.text('NOT ISSUED', W / 2, H / 2 + 50, { size: 30, style: 'bold', color: '#f4f1fb', align: 'center', ls: 6 });
}

/* -------------------------------------------------------------------- main */

const LEGAL_COVER = 'Confidential — prepared solely for the named limited partner. Unaudited figures except '
  + "where stated. Valuations reflect the GP's good-faith estimate under the fund's valuation policy and are subject "
  + 'to revision. Past performance is not indicative of future results.';
const LEGAL_CLOSE = 'This report is confidential and provided solely for the use of the named limited partner. It is '
  + 'not an offer to sell or a solicitation to buy any security. Past performance is not indicative of future results.';

/**
 * Draw the whole report onto an already-constructed jsPDF document.
 * Exported so the layout can be exercised against a recording stub in Node.
 *
 * @returns {{ pages: number, bottoms: number[] }} page count and each page's
 *          lowest content edge, in design px.
 */
export function renderQuarterlyReport(doc, vm) {
  const b = board(doc);
  const bottoms = [];

  const startPage = (first) => {
    if (!first) doc.addPage();
    b.rect(0, 0, W, H, C.white);
    if (vm.meta.draft) drawDraftStamp(b);
  };

  startPage(true);
  const cover = drawCover(b, vm);
  bottoms.push(cover.bottom);

  // The cover gives the letter whatever room it has left; a letter too long for
  // that gets its own page rather than being split or clipped.
  if (cover.letterOverflowed) {
    startPage(false);
    let y = pageHead(b, 22, 'Section I', 'Letter from the General Partner', `${vm.meta.period} · ${vm.meta.range}`);
    for (const para of vm.letter.paragraphs) {
      y = b.text(para, PAD, y, { size: 14.1, color: C.body, lineHeight: 1.7, maxW: INNER }) + 10;
    }
    bottoms.push(y);
  }

  startPage(false);
  bottoms.push(drawPortfolio(b, vm));
  startPage(false);
  bottoms.push(drawProgram(b, vm));
  startPage(false);
  bottoms.push(drawStatements(b, vm));

  // Footers last: the page count is only known once every page exists.
  const total = bottoms.length;
  for (let i = 1; i <= total; i++) {
    if (typeof doc.setPage === 'function') doc.setPage(i);
    drawFooter(b, vm, i, total, {
      legal: i === 1 ? LEGAL_COVER : i === total ? LEGAL_CLOSE
        : `${vm.meta.fundName} · ${vm.meta.period} quarterly report · confidential`,
      signature: i === total || i === total - 1,
    });
  }
  return { pages: total, bottoms };
}

/**
 * Build and download an LP's quarterly report.
 *
 * @param {object} opts  forwarded to quarterlyReportModel, plus `filename`
 * @returns {Promise<{ filename: string, pages: number, draft: boolean }>}
 */
export async function exportQuarterlyReportPdf(opts = {}) {
  const vm = quarterlyReportModel(opts);
  if (!vm.ok) {
    throw new Error(vm.reason === 'no-holding'
      ? 'No limited-partner position was found in this fund for that account.'
      : 'The report could not be built from this account.');
  }

  const jspdfMod = await import('jspdf');
  const JsPDF = jspdfMod.jsPDF || jspdfMod.default;
  const doc = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
  doc.setProperties({
    title: `${vm.meta.fundName} — ${vm.meta.period} LP report`,
    subject: `Quarterly LP report prepared for ${vm.meta.lp}`,
    author: vm.signer.name || 'Axal VC',
    creator: 'Axal VC StudioOS',
  });

  const { pages } = renderQuarterlyReport(doc, vm);
  const name = opts.filename || quarterlyReportFilename(vm);
  doc.save(name);
  return { filename: name, pages, draft: vm.meta.draft };
}
