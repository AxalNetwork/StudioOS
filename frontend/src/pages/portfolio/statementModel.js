/**
 * D6867 (#6867, canvas D6217 PF-13): the pure model of the investor's
 * shareable statement — one gross PDF of the book as of a chosen completed
 * quarter-end. No React, no fetch, no clock: the quarter-ends come from
 * `quarterWindowOf` (the first cheque's year to the reporting read's
 * `period_until`), the prepared date is the reporting read's `as_of`, and
 * every figure is a Worker read cut at the chosen date.
 *
 * Reads it is given (each `{ state, value }`, see `readOf`):
 *   analytics  `/api/positions/analytics?as_of=DATE` — paid-in,
 *              distributions and marks cut at the date;
 *   positions  `/api/positions?as_of=DATE` — marks cut at the date, but
 *              cheques, rounds and the company list are NOT (D6217
 *              "Backend required"), so a company funded after the date is
 *              listed and the invested total can exceed paid-in. The
 *              mismatch note says so whenever the two differ;
 *   quarters   one analytics read per quarter-end on page 3.
 *
 * What it never does: compute a net figure (none is recorded, D4817-p3), send
 * or keep the statement, or fill a value a read did not return. A read that
 * failed produces no statement (`ok: false`, naming the failed reads), except
 * a single failed quarter-end, which page 3 draws as a Not read gap.
 */
import {
  DEFINITIONS, NOT_RECORDED, RETURN_REASONS, UNAVAILABLE, basisLabel, cohortsOf, day, isQuarterEnd, markOf,
  money, multiple, percent, quarterEndsBetween, quarterPointOf, quarterWindowOf, rate,
} from './portfolioModel.js';

export const STATEMENT_BASIS = 'Gross of fees and carry';
export const NET_RETURNS = 'Net returns: Not recorded';
export const NET_REASON = 'No fee, carry or expense is recorded for this book, so no net figure is shown.';
export const OWN_FILE = 'This file is for you to share. Axal does not send it or keep a copy.';
export const STATEMENT_FOOT = 'Figures are gross of management fees, carry and fund expenses. Unmarked positions carry at cost.';
export const PREVIEW_WATERMARK = 'Preview, not for distribution';
export const ALL_POSITIONS = 'Every position the studio recorded.';
export const COVER_OWN = 'the investor’s own words, not Axal’s';
export const NO_POSITIONS = 'No position is recorded in your book yet, so there is no statement to produce. Statements start from the first recorded cheque.';
export const NO_QUARTER_YET = 'No completed quarter-end yet';
export const STATEMENT_PAGES = ['Summary', 'Positions', 'NAV at quarter-ends', 'Cohorts', 'Methodology'];
/** Page 3 shows at most this many quarter-ends, ending at the chosen date (as Performance does). */
export const STATEMENT_QUARTERS = 8;

/**
 * The Performance page's ten definitions, printed word for word on page 5 of
 * the statement. One list: `InvestorPortfolioPerformance.jsx` draws its
 * Methodology card from this same array.
 */
export const METHODOLOGY = [
  ['TVPI', DEFINITIONS.tvpi],
  ['DPI', DEFINITIONS.dpi],
  ['RVPI', DEFINITIONS.rvpi],
  ['IRR', 'XIRR on dated contributions and distributions, with NAV as the terminal value. Reads Unavailable, with the reason, when no rate solves; never 0%.'],
  ['NAV', 'Σ the latest mark per company on or before the as-of date; a company with no usable mark carries at cost.'],
  ['Paid-in', 'Σ recorded contributions dated on or before the as-of date.'],
  ['Distributed', 'Σ recorded distributions dated on or before the as-of date.'],
  ['Mark coverage', 'Positions with a usable mark, out of every position held at that date.'],
  ['Quarter-ends', 'Each point is the book read as of that quarter-end. A quarter-end with no book, or one that could not be read, is a gap: no bar, no zero, no line across it.'],
  ['Basis', 'Gross of fees and carry: management fees, carry and fund expenses are not deducted, so these are not net returns.'],
];

const isNum = (v) => v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));

/** `2026-09-30` → `Portfolio statement 2026-09-30.pdf`. */
export const statementFilename = (date) => `Portfolio statement ${date}.pdf`;

/**
 * The chooser: every completed quarter-end from the first cheque's year to
 * the reporting read's last completed quarter, newest first. Whether a date
 * holds a book is known only once its read answers (the first cheque's date
 * is not on any read yet), so `noBook` is set by the caller from that read.
 */
export function statementDatesOf(positions, compliance) {
  const win = quarterWindowOf(positions, compliance, Number.MAX_SAFE_INTEGER);
  if (win.state !== 'ok') return { ...win, dates: [] };
  const dates = [...win.dates].reverse().map((date, i) => ({ date, label: day(date), latest: i === 0 }));
  return { state: 'ok', dates, from: win.dates[0], to: win.last, firstYear: Number(win.dates[0].slice(0, 4)) };
}

/** A read cut at a date that answered with no position on or before it. */
export function noBookAt(read) {
  return read?.state === 'ok' && isNum(read.value.position_count) && Number(read.value.position_count) === 0;
}

/** One return figure in words: a value, −100% Total loss, or Unavailable with its reason. Never 0 for nothing. */
export function returnText(figure, flat, format) {
  if (figure && figure.state === 'unavailable') {
    return { value: UNAVAILABLE, state: 'unavailable', reason: RETURN_REASONS[figure.reason] || 'The recorded inputs do not define this figure.' };
  }
  if (figure && figure.state === 'total_loss') {
    return { value: format(figure.value ?? -1), state: 'ok', reason: 'Total loss: capital deployed and nothing came back.' };
  }
  const text = format(figure ? figure.value : flat);
  return text == null ? { value: NOT_RECORDED, state: 'not_recorded', reason: 'The read returned no figure.' } : { value: text, state: 'ok' };
}

/**
 * A company the positions read lists but the chosen date does not hold: its
 * first cheque's year is after the date's year, or its only cheque is dated
 * after the date. The read does not return the first cheque's date (D6217
 * "Backend required"), so a company with an earlier cheque and a later one is
 * not caught here; the mismatch note covers it.
 */
export function fundedAfter(p, date) {
  const year = Number(String(date).slice(0, 4));
  if (Number.isInteger(Number(p.vintage)) && Number(p.vintage) > year) return true;
  return Number(p.rounds) === 1 && typeof p.latest_date === 'string' && p.latest_date.slice(0, 10) > date;
}

const nameOf = (p) => (p.project && p.project.name) || `Company ${p.project_id}`;

/**
 * The mismatch note (PF-13, ◇ positions cut at the date): whenever the
 * positions' invested total differs from paid-in at the date. Null when they
 * agree or either figure is missing.
 */
export function mismatchOf(date, analytics, positions) {
  if (!analytics || !positions || !isNum(analytics.paid_in)) return null;
  const items = Array.isArray(positions.items) ? positions.items : [];
  const listed = items.reduce((s, p) => s + (isNum(p.total_invested) ? Number(p.total_invested) : 0), 0);
  const paidIn = Number(analytics.paid_in);
  // Equal to the cent: the two sums are of the same recorded dollar amounts.
  if (Math.abs(listed - paidIn) < 0.005) return null;
  const after = items.filter((p) => fundedAfter(p, date)).map((p) => ({ name: nameOf(p), invested: Number(p.total_invested) || 0 }));
  const accounted = after.reduce((s, r) => s + r.invested, 0);
  const label = day(date);
  return {
    listed,
    paidIn,
    diff: listed - paidIn,
    after,
    accounted,
    headline: `Positions include cheques dated after ${label}; the summary does not.`,
    detail: `The rows list ${money(listed)} invested; paid-in to ${label} on page 1 is ${money(paidIn)}. The difference is ${money(Math.abs(listed - paidIn))}`
      + (after.length ? `; the row${after.length === 1 ? '' : 's'} marked “Funded after ${label}” account${after.length === 1 ? 's' : ''} for ${money(accounted)} of it.` : '.'),
    short: `Positions list ${money(listed)} invested against ${money(paidIn)} paid-in.`,
  };
}

/** The preview strip: four figures for the date with their basis, or why there are none. */
export function previewOf(date, analytics, positions) {
  if (!analytics || analytics.state === 'loading') return { state: 'loading' };
  if (analytics.state !== 'ok') return { state: 'unreadable', failed: [`Performance as of ${day(date)}`] };
  if (noBookAt(analytics)) return { state: 'no_book', reason: 'No position is recorded on or before this date.' };
  const a = analytics.value;
  const label = day(date);
  const count = isNum(a.position_count) ? Number(a.position_count) : null;
  const unmarked = isNum(a.unmarked_position_count) ? Number(a.unmarked_position_count) : null;
  const cards = [
    { key: 'nav', label: `NAV as of ${label}`, value: money(a.nav) || NOT_RECORDED, note: 'unmarked at cost' },
    { key: 'paid_in', label: `Paid-in to ${label}`, value: money(a.paid_in) || NOT_RECORDED, note: 'Σ contributions' },
    { key: 'tvpi', label: 'TVPI', value: returnText(a.returns?.tvpi, a.tvpi, multiple).value, note: '(dist. + NAV) ÷ paid-in' },
    {
      key: 'coverage',
      label: 'Coverage',
      value: count != null && unmarked != null ? `${count - unmarked} of ${count} marked` : NOT_RECORDED,
      note: unmarked != null ? `${unmarked} at cost` : null,
    },
  ];
  const mismatch = positions && positions.state === 'ok' ? mismatchOf(date, a, positions.value) : null;
  return { state: 'ok', cards, mismatch, positionsState: positions ? positions.state : 'loading' };
}

/** Page 1's eleven rows: label naming what it counts and for which date, the value, the definition. */
export function summaryRowsOf(date, a) {
  const label = day(date);
  const count = isNum(a.position_count) ? Number(a.position_count) : null;
  const unmarked = isNum(a.unmarked_position_count) ? Number(a.unmarked_position_count) : null;
  const unusable = isNum(a.unusable_mark_count) ? Number(a.unusable_mark_count) : null;
  const total = isNum(a.nav) && isNum(a.distributed) ? Number(a.nav) + Number(a.distributed) : null;
  const ret = (key, fmt) => returnText(a.returns?.[key], a[key], fmt);
  const withReason = (r) => (r.state === 'unavailable' || r.reason ? `${r.value} · ${r.reason}` : r.value);
  const noMark = unmarked != null && unusable != null ? unmarked - unusable : null;
  return [
    { label: `NAV as of ${label}`, value: money(a.nav) || NOT_RECORDED, note: DEFINITIONS.nav },
    { label: `Paid-in to ${label}`, value: money(a.paid_in) || NOT_RECORDED, note: DEFINITIONS.paid_in },
    { label: `Distributed to ${label}`, value: money(a.distributed) || NOT_RECORDED, note: DEFINITIONS.distributed },
    { label: `Total value as of ${label}`, value: money(total) || NOT_RECORDED, note: 'Distributed + NAV' },
    { label: `TVPI as of ${label}`, value: withReason(ret('tvpi', multiple)), note: DEFINITIONS.tvpi },
    { label: `DPI as of ${label}`, value: withReason(ret('dpi', multiple)), note: DEFINITIONS.dpi },
    { label: `RVPI as of ${label}`, value: withReason(ret('rvpi', multiple)), note: DEFINITIONS.rvpi },
    { label: `IRR to ${label}`, value: withReason(ret('irr', rate)), note: DEFINITIONS.irr },
    {
      label: 'Mark coverage',
      value: count != null && unmarked != null ? `${count - unmarked} of ${count} marked` : NOT_RECORDED,
      note: count != null ? `Positions with a usable mark, of the ${count} held at ${label}` : 'Positions with a usable mark',
    },
    {
      label: 'Positions at cost',
      value: unmarked != null ? String(unmarked) : NOT_RECORDED,
      note: noMark != null ? `${noMark} with no mark · ${unusable} whose recorded mark cannot be used` : 'Positions with no usable mark carry at cost',
    },
    { label: 'Unusable marks', value: unusable != null ? String(unusable) : NOT_RECORDED, note: unusable ? 'See page 2 for the reason on each row' : 'Recorded marks that cannot be used as a value' },
  ];
}

/** Page 2's rows, largest cheque first; at-cost and unusable rows carry the API's own sentence. */
export function positionRowsOf(date, positions) {
  const label = day(date);
  return positions.items
    .map((p) => {
      const mark = markOf(p);
      const after = fundedAfter(p, date);
      const invested = isNum(p.total_invested) ? Number(p.total_invested) : null;
      const marked = mark.kind === 'marked';
      const carrying = marked ? Number(p.fmv) : invested;
      let pill = null;
      if (after) pill = 'Funded after';
      else if (mark.kind === 'unusable') pill = 'Mark unusable';
      else if (!marked) pill = 'At cost';
      else if (p.marked_down === true || (isNum(p.multiple) && Number(p.multiple) < 1)) pill = 'Below cost';
      const why = [];
      if (after) why.push(`Funded after ${label}: the summary on page 1 does not count it.`);
      if (mark.kind === 'unusable') why.push(`${mark.reason} Carried at cost.`);
      else if (!marked) why.push(p.mark_unavailable || 'No valuation is recorded for this position as of this date; invested cost is not its value.');
      return {
        name: nameOf(p),
        sector: [p.project?.sector, p.project?.stage].filter(Boolean).join(' · ') || NOT_RECORDED,
        rounds: `${Number(p.rounds) || 0}${p.latest_round ? ` · ${p.latest_round}` : ''}`,
        invested: money(invested) || NOT_RECORDED,
        investedRaw: invested ?? 0,
        ownership: percent(p.latest_ownership_pct) || NOT_RECORDED,
        carrying: money(carrying) || NOT_RECORDED,
        carryingRaw: carrying ?? 0,
        atCost: !marked,
        multiple: multiple(p.multiple) || NOT_RECORDED,
        markDate: marked && mark.date ? day(mark.date) : '—',
        basis: marked ? (basisLabel(mark.basis) || NOT_RECORDED) : 'No usable mark',
        vintage: Number.isInteger(Number(p.vintage)) && Number(p.vintage) > 0 ? String(p.vintage) : NOT_RECORDED,
        pill,
        after,
        why: why.join(' ') || null,
      };
    })
    .sort((a, b) => b.investedRaw - a.investedRaw || a.name.localeCompare(b.name));
}

/** Page 3: up to eight quarter-ends ending at the chosen date; a failed or empty one is a gap with its word. */
export function quarterPointsOf(date, firstYear, reads = {}) {
  const dates = quarterEndsBetween(firstYear, date).slice(-STATEMENT_QUARTERS);
  return dates.map((d) => {
    const p = quarterPointOf(d, reads[d]);
    if (p.state === 'not_recorded') return { ...p, gap: 'No book' };
    if (p.state === 'unreadable') return { ...p, gap: 'Not read' };
    return p;
  });
}

/**
 * The whole statement, or why there is none. `ok: false` carries `failed`,
 * the reads that did not answer, so the sheet can name them and retry only
 * those.
 */
export function statementOf({
  date, analytics, positions, quarters = {}, compliance, investor, coverNote = null, preview = false, firstYear,
}) {
  if (!isQuarterEnd(date)) return { ok: false, failed: [], reason: 'Choose a completed quarter-end.' };
  const failed = [];
  if (!positions || positions.state !== 'ok') failed.push(`Positions as of ${day(date)}`);
  if (!analytics || analytics.state !== 'ok') failed.push(`Performance as of ${day(date)}`);
  const points = quarterPointsOf(date, firstYear, quarters);
  const notRead = points.filter((p) => p.state === 'unreadable');
  if (points.some((p) => p.state === 'loading')) return { ok: false, loading: true, failed };
  if (notRead.length > 1) failed.push(`${notRead.length} quarter-ends on page 3`);
  if (failed.length) return { ok: false, failed };
  if (noBookAt(analytics)) return { ok: false, failed: [], noBook: true, reason: 'No position is recorded on or before this date.' };
  const a = analytics.value;
  const pv = positions.value;
  const label = day(date);
  const prepared = compliance?.state === 'ok' ? day(compliance.value.as_of) : null;
  const scope = [preview ? ALL_POSITIONS : (pv.scope?.text || ALL_POSITIONS), pv.fund_scope?.text || null].filter(Boolean);
  const rows = positionRowsOf(date, pv);
  const cohorts = cohortsOf(positions);
  const mismatch = mismatchOf(date, a, pv);
  const cover = typeof coverNote === 'string' && coverNote.trim() ? coverNote.trim() : null;
  return {
    ok: true,
    meta: {
      date,
      label,
      prepared,
      investor: investor || 'Investor',
      basis: STATEMENT_BASIS,
      currency: 'USD',
      preview: Boolean(preview),
      filename: statementFilename(date),
    },
    cover,
    summary: summaryRowsOf(date, a),
    scope,
    basis: { line: `${STATEMENT_BASIS}. ${NET_RETURNS}.`, reason: NET_REASON },
    positions: {
      rows,
      total: { count: rows.length, invested: money(rows.reduce((s, r) => s + r.investedRaw, 0)), carrying: money(rows.reduce((s, r) => s + r.carryingRaw, 0)) },
      cut: `Summary, cut at ${label}: paid-in ${money(a.paid_in) || NOT_RECORDED} · NAV ${money(a.nav) || NOT_RECORDED} · ${isNum(a.position_count) ? a.position_count : NOT_RECORDED} positions`,
    },
    quarters: {
      points,
      max: points.reduce((m, p) => (p.state === 'ok' ? Math.max(m, p.nav) : m), 0),
      notRead: notRead.map((p) => p.label),
    },
    cohorts: cohorts.state === 'ok'
      ? {
        rows: cohorts.rows,
        undated: cohorts.undated,
        total: {
          companies: cohorts.rows.reduce((s, r) => s + r.companies, 0),
          atCost: cohorts.rows.reduce((s, r) => s + r.atCost, 0),
        },
        after: rows.filter((r) => r.after).map((r) => r.name),
      }
      : { rows: [], undated: 0, total: { companies: 0, atCost: 0 }, after: [] },
    mismatch,
    methodology: METHODOLOGY,
  };
}

/** The confirmation after the download: what was made, and that Axal kept nothing. */
export function downloadedOf(date, pages) {
  return {
    title: `Statement as of ${day(date)} downloaded`,
    line: `${statementFilename(date)} · ${pages} pages · gross of fees and carry · USD. Axal sent nothing and kept no copy. It is yours to pass on.`,
    performance: `/portfolio/performance?as_of=${date}`,
  };
}
