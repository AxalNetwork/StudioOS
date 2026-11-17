// D6867 (#6867, canvas D6217 PF-13b to PF-13e): the investor's portfolio
// statement — PDF renderer.
//
// US Letter portrait, vector-drawn with jsPDF on the shared board
// (lib/pdfBoard.js), in the layout of the fund LP report
// (quarterlyReportPdf.js: page head, dotted key/value rows, ruled tables,
// pills, "Page x of y" stamped after layout) and none of its net figures.
// Five sections: Summary, Positions, NAV at quarter-ends, Cohorts,
// Methodology. Positions can run over; the header repeats on the
// continuation page and every footer carries the real total.
//
// Every page head says "Gross of fees and carry". An admin preview carries
// "Preview, not for distribution" across every page. The core PDF faces
// (Helvetica, Courier) have no Σ, − or the pill glyphs, so the text is passed
// through `pdfText` (Σ → "Sum of", − → "-") and each pill is a word in a
// bordered or filled box, which reads in greyscale.
import { BOARD, board } from './pdfBoard.js';
import { statementOf } from '../pages/portfolio/statementModel.js';

const W = BOARD.w;
const H = BOARD.h;
const PAD = 44;
const RIGHT = W - PAD;
const INNER = W - PAD * 2;
/** The lowest y body content may reach; the footer sits below it. */
const FLOOR = 960;

const C = {
  ink: '#18181b',
  body: '#3f3f46',
  muted: '#71717a',
  faint: '#a1a1aa',
  rule: '#ececf1',
  violet: '#6d28d9',
  violetRule: '#ede9fe',
  wash: '#faf9fc',
  white: '#ffffff',
  amber: '#92400e',
  amberBg: '#fffbeb',
  amberRule: '#fcd34d',
  bar: '#7c3aed',
  watermark: '#efeaf9',
};

/** What the core PDF faces can print: Σ and the true minus are not in their encoding. */
export function pdfText(s) {
  return String(s ?? '')
    .replace(/Σ\s*/g, 'Sum of ')
    .replace(/−/g, '-')
    .replace(/[◇⚑▼○⊘◆]/g, '')
    .replace(/\s{2,}/g, ' ');
}

const T = (b, s, x, y, o) => b.text(pdfText(s), x, y, o);

/** Section head at the top of every page, with the basis on the right. */
function pageHead(b, kicker, title, meta) {
  T(b, kicker.toUpperCase(), PAD, 26, { size: 11.4, style: 'bold', color: C.violet, ls: 1.5 });
  const titleEnd = T(b, title, PAD, 44, { size: 22.8, style: 'bold', color: C.ink, maxW: INNER * 0.62 });
  const prepared = meta.prepared ? `Prepared ${meta.prepared} · ` : '';
  T(b, `${prepared}${meta.basis} · ${meta.currency}`, RIGHT, 52, { size: 11.4, mono: true, color: C.muted, align: 'right', maxW: INNER * 0.36 });
  const ruleY = Math.max(titleEnd, 80) + 8;
  b.hline(PAD, RIGHT, ruleY, C.ink, 2);
  return ruleY + 14;
}

function label(b, y, text) {
  T(b, text.toUpperCase(), PAD, y, { size: 11.4, style: 'bold', color: C.violet, ls: 1.2 });
  const ruleY = y + 11.4 * 1.25 + 5;
  b.hline(PAD, RIGHT, ruleY, C.violetRule, 1.5);
  return ruleY + 8;
}

/** An amber note with a "!" — the mismatch note and the Not read line. */
function note(b, y, head, detail) {
  const lines = b.wrap(pdfText(`${head} ${detail || ''}`), INNER - 34, { size: 11.8 });
  const h = lines.length * 11.8 * 1.45 + 14;
  b.rrect(PAD, y, INNER, h, 8, { fill: C.amberBg, stroke: C.amberRule });
  T(b, '!', PAD + 12, y + 7, { size: 12.5, style: 'bold', color: C.amber });
  T(b, `${head} ${detail || ''}`, PAD + 26, y + 7, { size: 11.8, color: C.amber, lineHeight: 1.45, maxW: INNER - 34 });
  return y + h + 10;
}

/** A pill: a word, boxed. Filled for a value-changing state, outlined for at cost. */
function pill(b, x, y, text) {
  const size = 9.4;
  const w = b.width(text, { size, style: 'bold' }) + 10;
  const filled = text === 'Below cost' || text === 'Funded after';
  b.rrect(x, y, w, size * 1.25 + 4, 4, filled ? { fill: C.rule, stroke: C.muted } : { stroke: C.muted });
  T(b, text, x + 5, y + 2, { size, style: 'bold', color: C.ink });
  return y + size * 1.25 + 6;
}

function kv(b, y, rows) {
  let cy = y;
  for (const r of rows) {
    const leftEnd = T(b, r.label, PAD, cy, { size: 12.7, style: 'bold', color: C.ink, maxW: INNER * 0.4 });
    const noteEnd = T(b, r.note || '', PAD + INNER * 0.42, cy + 1, { size: 10.7, color: C.muted, maxW: INNER * 0.3 });
    const valEnd = T(b, r.value, RIGHT, cy, { size: 12.7, style: 'bold', mono: true, color: C.ink, align: 'right', maxW: INNER * 0.26 });
    const bottom = Math.max(leftEnd, noteEnd, valEnd) + 4;
    b.dotted(PAD, RIGHT, bottom, C.rule);
    cy = bottom + 8;
  }
  return cy;
}

function watermark(b) {
  T(b, 'Preview, not for distribution', W / 2, H / 2 - 20, { size: 46, style: 'bold', color: C.watermark, align: 'center' });
}

/* ------------------------------------------------------------------ pages */

function drawSummary(b, m) {
  let y = pageHead(b, 'Portfolio statement', `${m.meta.investor} · as of ${m.meta.label}`, m.meta);
  if (m.cover) {
    const lines = b.wrap(pdfText(m.cover), INNER - 28, { size: 12.1 });
    const h = 22 + lines.length * 12.1 * 1.5 + 12;
    b.rrect(PAD, y, INNER, h, 8, { fill: C.wash, stroke: C.violetRule });
    T(b, `Note from ${m.meta.investor} · the investor’s own words, not Axal’s`, PAD + 14, y + 8, { size: 10.7, style: 'bold', color: C.violet, maxW: INNER - 28 });
    T(b, m.cover, PAD + 14, y + 24, { size: 12.1, color: C.body, lineHeight: 1.5, maxW: INNER - 28 });
    y += h + 14;
  }
  y = label(b, y, `Summary · as of ${m.meta.label}`);
  y = kv(b, y, m.summary);
  y = label(b, y + 8, 'Scope');
  for (const s of m.scope) y = T(b, s, PAD, y, { size: 11.8, color: C.body, lineHeight: 1.45, maxW: INNER }) + 4;
  y = label(b, y + 8, 'Basis');
  y = T(b, m.basis.line, PAD, y, { size: 11.8, style: 'bold', color: C.ink, maxW: INNER });
  y = T(b, m.basis.reason, PAD, y + 2, { size: 11.8, color: C.body, maxW: INNER });
  return y;
}

const POS_COLS = [
  { key: 'name', label: 'Company', w: 140 },
  { key: 'sector', label: 'Sector · stage', w: 100 },
  { key: 'rounds', label: 'Rounds · latest', w: 84 },
  { key: 'invested', label: 'Invested', w: 66, right: true },
  { key: 'ownership', label: 'Ownership', w: 46, right: true },
  { key: 'carrying', label: 'Carrying', w: 74, right: true },
  { key: 'multiple', label: 'Multiple', w: 44, right: true },
  { key: 'markDate', label: 'Mark date', w: 60 },
  { key: 'basis', label: 'Mark basis', w: 70 },
  { key: 'vintage', label: 'Vintage', w: 44, right: true },
];

function posHead(b, y) {
  let x = PAD;
  for (const c of POS_COLS) {
    T(b, c.label.toUpperCase(), c.right ? x + c.w - 2 : x, y, { size: 8.7, style: 'bold', color: C.faint, align: c.right ? 'right' : 'left', maxW: c.w - 4 });
    x += c.w;
  }
  b.hline(PAD, RIGHT, y + 24, C.ink, 1);
  return y + 30;
}

/** Positions: rows that would run under the footer start a continuation page with the header repeated. */
function drawPositions(b, m, newPage) {
  const head = () => pageHead(b, 'Portfolio statement · Positions', `Positions as of ${m.meta.label}`, m.meta);
  let y = head();
  if (m.mismatch) y = note(b, y, m.mismatch.headline, m.mismatch.detail);
  y = T(b, `${m.positions.rows.length} compan${m.positions.rows.length === 1 ? 'y' : 'ies'} · ownership fully diluted, latest round · carrying value is the latest usable mark on or before ${m.meta.label}; without one, a position carries at cost and is marked At cost. Cost is not a valuation.`, PAD, y, { size: 10.7, color: C.muted, maxW: INNER }) + 8;
  y = posHead(b, y);
  const bottoms = [];
  for (const r of m.positions.rows) {
    const cells = POS_COLS.map((c) => b.wrap(pdfText(r[c.key]), c.w - 6, { size: 10.1 }).length);
    const pillH = r.pill ? 18 : 0;
    const whyH = r.why ? b.wrap(pdfText(r.why), INNER - 12, { size: 9.4 }).length * 9.4 * 1.4 + 4 : 0;
    const rowH = Math.max(...cells) * 10.1 * 1.3 + pillH + whyH + 10;
    if (y + rowH > FLOOR) {
      bottoms.push(y);
      newPage();
      y = posHead(b, head());
    }
    let x = PAD;
    for (const c of POS_COLS) {
      const style = c.key === 'name' ? 'bold' : 'normal';
      const color = r.atCost && (c.key === 'carrying' || c.key === 'multiple') ? C.muted : C.ink;
      T(b, r[c.key], c.right ? x + c.w - 2 : x, y, {
        size: 10.1, style, mono: c.right, color, align: c.right ? 'right' : 'left', maxW: c.w - 6, lineHeight: 1.3,
      });
      x += c.w;
    }
    let ry = y + Math.max(...cells) * 10.1 * 1.3 + 2;
    if (r.pill) ry = pill(b, PAD, ry, r.pill);
    if (r.why) ry = T(b, r.why, PAD + 6, ry, { size: 9.4, color: C.muted, lineHeight: 1.4, maxW: INNER - 12 }) + 4;
    b.hline(PAD, RIGHT, ry + 3, C.rule);
    y = ry + 8;
  }
  if (y + 60 > FLOOR) { bottoms.push(y); newPage(); y = posHead(b, head()); }
  T(b, `Total · ${m.positions.total.count} rows`, PAD, y, { size: 11.4, style: 'bold', color: C.ink });
  T(b, m.positions.total.invested, PAD + 140 + 100 + 84 + 66 - 2, y, { size: 11.4, style: 'bold', mono: true, align: 'right', color: C.ink });
  T(b, m.positions.total.carrying, PAD + 140 + 100 + 84 + 66 + 46 + 74 - 2, y, { size: 11.4, style: 'bold', mono: true, align: 'right', color: C.ink });
  y = T(b, m.positions.cut, PAD, y + 20, { size: 10.7, color: C.muted, maxW: INNER });
  bottoms.push(y);
  return bottoms;
}

function drawQuarters(b, m) {
  let y = pageHead(b, 'Portfolio statement · NAV at quarter-ends', `NAV at quarter-ends to ${m.meta.label}`, m.meta);
  const pts = m.quarters.points;
  const chartTop = y + 6;
  const chartH = 200;
  const slot = INNER / Math.max(pts.length, 1);
  const max = m.quarters.max || 1;
  b.hline(PAD, RIGHT, chartTop + chartH, C.ink, 1);
  pts.forEach((p, i) => {
    const x = PAD + i * slot + slot * 0.2;
    const w = slot * 0.6;
    if (p.state === 'ok') {
      const h = Math.max(2, (p.nav / max) * (chartH - 30));
      b.rect(x, chartTop + chartH - h, w, h, C.bar);
      T(b, p.navText, x + w / 2, chartTop + chartH - h - 16, { size: 9.4, mono: true, color: C.ink, align: 'center' });
    } else {
      // A gap: an empty slot with its word, never a bar and never a zero.
      b.rrect(x, chartTop + 40, w, chartH - 40, 4, { stroke: C.faint });
      T(b, p.gap, x + w / 2, chartTop + chartH / 2, { size: 9.4, style: 'bold', color: C.muted, align: 'center', maxW: w });
    }
    T(b, p.label, x + w / 2, chartTop + chartH + 6, { size: 9.4, color: C.muted, align: 'center', maxW: slot });
  });
  y = chartTop + chartH + 30;
  const cols = [['Quarter-end', 0, 130], ['NAV', 130, 130], ['Paid-in', 260, 130], ['Distributed', 390, 130], ['TVPI', 520, 90], ['Coverage', 610, 118]];
  cols.forEach(([t, x, w], i) => T(b, t.toUpperCase(), i === 0 ? PAD + x : PAD + x + w - 2, y, { size: 8.7, style: 'bold', color: C.faint, align: i === 0 ? 'left' : 'right' }));
  y += 16;
  b.hline(PAD, RIGHT, y, C.ink, 1);
  y += 6;
  for (const p of pts) {
    const vals = p.state === 'ok'
      ? [p.label, p.navText, p.paidIn, p.distributed, p.tvpi.value, `${p.coverage} marked`]
      : [p.label, `${p.gap} · ${p.reason}`];
    if (vals.length === 2) {
      T(b, vals[0], PAD, y, { size: 10.7, color: C.ink });
      T(b, vals[1], PAD + 130, y, { size: 10.7, color: C.muted, maxW: INNER - 130 });
    } else {
      cols.forEach(([, x, w], i) => T(b, vals[i], i === 0 ? PAD + x : PAD + x + w - 2, y, { size: 10.7, mono: i > 0, color: C.ink, align: i === 0 ? 'left' : 'right' }));
    }
    y += 18;
    b.hline(PAD, RIGHT, y - 4, C.rule);
  }
  if (m.quarters.notRead.length) y = note(b, y + 6, `${m.quarters.notRead.join(', ')} could not be read.`, 'It is drawn as a Not read gap, not a zero.');
  y = T(b, `Up to ${pts.length} quarter-ends are shown, ending at ${m.meta.label}. Each point counts only cheques, distributions and marks dated on or before its quarter-end. Unmarked positions carry at cost.`, PAD, y + 8, { size: 10.7, color: C.muted, maxW: INNER });
  return y;
}

function drawCohorts(b, m) {
  let y = pageHead(b, 'Portfolio statement · Cohorts', `Vintage cohorts as of ${m.meta.label}`, m.meta);
  y = T(b, `Grouped by the year of the first cheque · as of ${m.meta.label} · gross`, PAD, y, { size: 10.7, color: C.muted }) + 8;
  const cols = [['Vintage', 0, 100], ['Positions', 100, 100], ['At cost', 200, 100], ['Invested', 300, 140], ['Carrying value', 440, 150], ['Carrying ÷ invested', 590, 138]];
  cols.forEach(([t, x, w], i) => T(b, t.toUpperCase(), i === 0 ? PAD + x : PAD + x + w - 2, y, { size: 8.7, style: 'bold', color: C.faint, align: i === 0 ? 'left' : 'right' }));
  y += 16;
  b.hline(PAD, RIGHT, y, C.ink, 1);
  y += 6;
  for (const r of m.cohorts.rows) {
    const vals = [r.vintage, String(r.companies), String(r.atCost), r.invested, r.carrying, r.multiple || 'Not recorded'];
    cols.forEach(([, x, w], i) => T(b, vals[i], i === 0 ? PAD + x : PAD + x + w - 2, y, { size: 11.4, mono: i > 0, color: C.ink, align: i === 0 ? 'left' : 'right' }));
    y += 20;
    b.hline(PAD, RIGHT, y - 5, C.rule);
  }
  T(b, 'Total', PAD, y, { size: 11.4, style: 'bold', color: C.ink });
  T(b, String(m.cohorts.total.companies), PAD + 200 - 2, y, { size: 11.4, style: 'bold', mono: true, align: 'right', color: C.ink });
  T(b, String(m.cohorts.total.atCost), PAD + 300 - 2, y, { size: 11.4, style: 'bold', mono: true, align: 'right', color: C.ink });
  T(b, m.positions.total.invested, PAD + 440 - 2, y, { size: 11.4, style: 'bold', mono: true, align: 'right', color: C.ink });
  T(b, m.positions.total.carrying, PAD + 590 - 2, y, { size: 11.4, style: 'bold', mono: true, align: 'right', color: C.ink });
  y += 26;
  y = T(b, `Distributions are not recorded per company, so carrying ÷ invested is not TVPI. ${m.cohorts.undated} undated position${m.cohorts.undated === 1 ? '' : 's'} sit${m.cohorts.undated === 1 ? 's' : ''} in no cohort.`, PAD, y, { size: 10.7, color: C.muted, maxW: INNER }) + 10;
  if (m.mismatch) {
    const after = m.cohorts.after.length ? ` The cohorts include ${m.cohorts.after.join(', ')}, funded after ${m.meta.label}.` : '';
    y = note(b, y, m.mismatch.headline, after.trim());
  }
  return y;
}

function drawMethodology(b, m) {
  let y = pageHead(b, 'Portfolio statement · Methodology', 'How these figures are made', m.meta);
  for (const [term, text] of m.methodology) {
    T(b, term, PAD, y, { size: 12.1, style: 'bold', color: C.ink, maxW: 150 });
    y = T(b, text, PAD + 160, y, { size: 12.1, color: C.body, lineHeight: 1.45, maxW: INNER - 160 }) + 4;
    b.dotted(PAD, RIGHT, y, C.rule);
    y += 10;
  }
  y = T(b, 'Definitions as on the Performance page (/portfolio/performance). Mark basis names how a recorded mark was arrived at: Priced round, Secondary, GP estimate, Write-down or Cost.', PAD, y + 6, { size: 10.7, color: C.muted, maxW: INNER });
  return y;
}

function drawFooter(b, m, n, total) {
  const last = n === total;
  const line = last
    ? `Produced from Axal VC records${m.meta.prepared ? ` on ${m.meta.prepared}` : ''}; not an audited statement. Gross of fees and carry.`
    : 'Figures are gross of management fees, carry and fund expenses. Unmarked positions carry at cost.';
  b.hline(PAD, RIGHT, H - 62, C.rule);
  T(b, line, PAD, H - 54, { size: 10.1, color: C.faint, maxW: INNER * 0.6, lineHeight: 1.45 });
  T(b, `${m.meta.investor} · as of ${m.meta.label} · Page ${n} of ${total}`, RIGHT, H - 54, { size: 10.1, mono: true, color: C.faint, align: 'right', maxW: INNER * 0.38 });
}

/**
 * Draw the statement onto an already-constructed jsPDF document. Exported so
 * the layout can be exercised against the recording stub in Node.
 *
 * @returns {{ pages: number, bottoms: number[] }}
 */
export function renderPortfolioStatement(doc, m) {
  const b = board(doc);
  const bottoms = [];
  let first = true;
  const start = () => {
    if (!first) doc.addPage();
    first = false;
    b.rect(0, 0, W, H, C.white);
    if (m.meta.preview) watermark(b);
  };
  start();
  bottoms.push(drawSummary(b, m));
  start();
  bottoms.push(...drawPositions(b, m, start));
  start();
  bottoms.push(drawQuarters(b, m));
  start();
  bottoms.push(drawCohorts(b, m));
  start();
  bottoms.push(drawMethodology(b, m));
  const total = bottoms.length;
  for (let i = 1; i <= total; i += 1) {
    if (typeof doc.setPage === 'function') doc.setPage(i);
    drawFooter(b, m, i, total);
  }
  return { pages: total, bottoms };
}

/**
 * Build and download the statement. `input` is `statementOf`'s argument.
 * Nothing is sent and nothing is kept: the file goes to the browser's download.
 *
 * @returns {Promise<{ filename: string, pages: number }>}
 */
export async function exportPortfolioStatementPdf(input) {
  const m = statementOf(input);
  if (!m.ok) throw new Error('The statement could not be made from these reads.');
  const jspdfMod = await import('jspdf');
  const JsPDF = jspdfMod.jsPDF || jspdfMod.default;
  const doc = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
  doc.setProperties({
    title: `Portfolio statement as of ${m.meta.label}`,
    subject: `Portfolio statement for ${m.meta.investor}, gross of fees and carry`,
    author: m.meta.investor,
    creator: 'Axal VC StudioOS',
  });
  const { pages } = renderPortfolioStatement(doc, m);
  doc.save(m.meta.filename);
  return { filename: m.meta.filename, pages };
}
