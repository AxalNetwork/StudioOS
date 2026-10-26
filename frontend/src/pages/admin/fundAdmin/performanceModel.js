/**
 * D1164 (#3071, part 7 of #2388) — NAV & performance (FND10–FND12), as pure
 * functions: the seven tiles, the three charts with their tables, the
 * positions, "Funds side by side", and the two dialogs' checks. No React, so
 * `node --test` loads it.
 *
 * The reads (all on the Worker, `routes/fund_performance.ts`):
 *   - `list`       GET /api/fund-performance → every fund's figures as of
 *                  today, each missing one null with its reason in
 *                  `unavailable` (D627);
 *   - `history`    GET /api/fund-performance/:id/history?step=quarter → one
 *                  row per quarter end since the first call, point in time
 *                  (D1158);
 *   - `positions`  GET /api/fund-performance/:id/positions → each position
 *                  with its latest mark, or `marked: false` and a reason (D1158).
 *
 * NEVER A ZERO FOR A MISSING VALUE. A figure the Worker could not compute is
 * null and reads "Not recorded" with the Worker's reason. A quarter with no
 * NAV is a dashed bridge in the line, never a dip to 0. A position with no
 * mark is a dashed "No mark" bar, never its cost.
 */
import { formatCents } from '../../investor/fundCallsModel.js';
import { NOT_RECORDED } from '../../../lib/absence.js';

export { NOT_RECORDED };
export const NAV_LINE = 'NAV is investments only: the latest dated mark of each position. Cash, liabilities, fees and carry are not included. Paid-in means capital called.';
export const MARK_INFO = 'Marks are dated and kept. A new mark does not change an old one. LPs see NAV in issued reports only.';
export const MOVE_INFO = 'Changes which fund’s NAV this position counts in.';
export const PICK_FUND = 'Pick a fund above to see its quarters, its positions and its marks.';
export const FIRM_LEVEL = 'Firm-level (no fund)';

const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
export const multiple = (v) => (isNum(v) ? `${Number(v).toFixed(2)}x` : null);
export const rate = (v) => (isNum(v) ? `${(Number(v) * 100).toFixed(1)}%` : null);
export const cents = (v) => (isNum(v) ? formatCents(Math.round(Number(v))) : null);
/** `invested_amount` is dollars on `portfolio_positions`; shown as money, never as a mark. */
export const dollars = (v) => (isNum(v) ? formatCents(Math.round(Number(v) * 100)) : null);
/** A short axis label: $6.9M, $250K, $900. */
export function shortMoney(d) {
  const n = Number(d) || 0;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1)}K`;
  return `$${Math.round(n)}`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `2025-03-14` → `14 Mar 2025`; anything else as it is. */
export function dayText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : (iso || null);
}

/** One figure: its text, or null with the Worker's reason. */
const figure = (row, field, format) => {
  const text = row ? format(row[field]) : null;
  return text == null
    ? { text: null, reason: (row?.unavailable || {})[field] || 'No figure is recorded.' }
    : { text, reason: null };
};

/**
 * The seven tiles (FND10): NAV, Paid-in, Distributed, DPI, RVPI, TVPI, IRR,
 * from the fund's row of the list read. NAV's note counts the marked
 * positions when the positions read answered; IRR's names the first call.
 */
export function navTiles(perf, { positions = null, history = null } = {}) {
  const marked = Array.isArray(positions?.items) ? positions.items.filter((p) => p.marked).length : null;
  const since = history?.first_call ? `since ${dayText(history.first_call)}` : null;
  const tile = (key, label, field, format, note = null) => ({ key, label, ...figure(perf, field, format), note });
  return [
    tile('nav', 'NAV', 'nav_cents', cents, marked == null ? 'investments only' : `latest marks of ${marked} position${marked === 1 ? '' : 's'}`),
    tile('paid', 'Paid-in', 'paid_in_cents', cents, 'capital called'),
    tile('dist', 'Distributed', 'distributed_cents', cents),
    tile('dpi', 'DPI', 'dpi', multiple),
    tile('rvpi', 'RVPI', 'rvpi', multiple),
    tile('tvpi', 'TVPI', 'tvpi', multiple),
    tile('irr', 'IRR', 'irr', rate, since),
  ];
}

const centsToDollars = (v) => (isNum(v) ? Number(v) / 100 : null);
const lastNumber = (values) => { for (let i = values.length - 1; i >= 0; i -= 1) if (values[i] !== null) return { v: values[i], i }; return null; };
const firstNumber = (values) => { for (let i = 0; i < values.length; i += 1) if (values[i] !== null) return { v: values[i], i }; return null; };

/**
 * The two quarterly charts (FND10) from the history read. A quarter with no
 * NAV (or no TVPI, which needs one) keeps null, so the line bridges it.
 */
export function quarterCharts(history) {
  const items = Array.isArray(history?.items) ? history.items : [];
  if (!items.length) return { empty: true, reason: history?.reason || 'No quarter has ended since the first capital call.' };
  const labels = items.map((q) => q.quarter);
  const paid = items.map((q) => centsToDollars(q.paid_in_cents));
  const dist = items.map((q) => centsToDollars(q.distributed_cents));
  const nav = items.map((q) => centsToDollars(q.nav_cents));
  const tvpi = items.map((q) => (isNum(q.tvpi) ? Number(q.tvpi) : null));
  const dpi = items.map((q) => (isNum(q.dpi) ? Number(q.dpi) : null));
  const gaps = items.filter((q) => !isNum(q.nav_cents)).map((q) => ({ quarter: q.quarter, reason: (q.unavailable || {}).nav_cents || 'No complete NAV that quarter.' }));
  const passed = items.findIndex((q) => isNum(q.nav_cents) && isNum(q.paid_in_cents) && Number(q.nav_cents) > Number(q.paid_in_cents));
  const navLast = lastNumber(nav);
  const navNote = [
    passed >= 0 ? `NAV passed paid-in in ${labels[passed]}` : null,
    navLast ? `NAV stands at ${dollars(navLast.v)} in ${labels[navLast.i]}` : 'No quarter has a complete NAV yet',
  ].filter(Boolean).join(' and ').concat('.');
  const t0 = firstNumber(tvpi); const t1 = lastNumber(tvpi);
  const multNote = t0 && t1 && t0.i !== t1.i ? `TVPI went from ${multiple(t0.v)} to ${multiple(t1.v)}.`
    : t1 ? `TVPI is ${multiple(t1.v)} in ${labels[t1.i]}.` : 'No quarter has a TVPI yet: it needs a complete NAV.';
  const gapFoot = gaps.length
    ? `${gaps.map((g) => g.quarter).join(', ')} ${gaps.length === 1 ? 'has' : 'have'} no complete NAV: a position had no mark. The dashed line bridges it; it is not a dip to zero.`
    : null;
  const cell = (v, fmt) => (v === null ? NOT_RECORDED : fmt(v));
  return {
    empty: false,
    labels,
    money: {
      series: [{ label: 'Paid-in', tone: 'violet', values: paid }, { label: 'Distributed', tone: 'sky', values: dist }, { label: 'NAV', tone: 'amber', values: nav }],
      note: navNote,
      foot: gapFoot,
      alt: `By quarter: ${labels.map((l, i) => `${l} paid-in ${cell(paid[i], dollars)}, distributed ${cell(dist[i], dollars)}, NAV ${cell(nav[i], dollars)}`).join('; ')}.`,
      table: { head: ['Quarter', 'Paid-in', 'Distributed', 'NAV'], rows: labels.map((l, i) => [l, cell(paid[i], dollars), cell(dist[i], dollars), cell(nav[i], dollars)]) },
    },
    multiples: {
      series: [{ label: 'TVPI', tone: 'violet', values: tvpi }, { label: 'DPI', tone: 'sky', values: dpi }],
      note: multNote,
      foot: gaps.length ? 'TVPI needs a complete NAV, so a quarter without one is bridged. DPI does not.' : null,
      alt: `By quarter: ${labels.map((l, i) => `${l} TVPI ${cell(tvpi[i], multiple)}, DPI ${cell(dpi[i], multiple)}`).join('; ')}.`,
      table: { head: ['Quarter', 'TVPI', 'DPI'], rows: labels.map((l, i) => [l, cell(tvpi[i], multiple), cell(dpi[i], multiple)]) },
    },
    gaps,
    truncated: Boolean(history?.truncated),
  };
}

/** A position's name: its company, else its round. */
const nameOf = (p) => p.company_name || p.round_name || `Position ${p.id}`;

/** "Positions: cost and latest mark" (FND10): one pair of bars per position, and its table. */
export function positionsChart(positions) {
  const items = Array.isArray(positions?.items) ? positions.items : [];
  if (!items.length) return { empty: true };
  const rows = items.map((p) => ({
    key: p.id,
    label: nameOf(p),
    a: { value: isNum(p.invested_amount) ? Number(p.invested_amount) : null, tone: 'sky', text: dollars(p.invested_amount) || NOT_RECORDED },
    b: { value: p.marked ? Number(p.value_cents) / 100 : null, tone: 'violet', text: p.marked ? cents(p.value_cents) : null },
  }));
  const unmarked = items.filter((p) => !p.marked).length;
  const ratios = items.filter((p) => p.marked && isNum(p.invested_amount) && Number(p.invested_amount) > 0)
    .map((p) => ({ p, r: Number(p.value_cents) / 100 / Number(p.invested_amount) }))
    .sort((x, y) => y.r - x.r);
  const note = unmarked === items.length
    ? `${unmarked} position${unmarked === 1 ? ' has' : 's have'} only a cost. Record a mark for each to show NAV.`
    : unmarked > 0
      ? `${unmarked} of ${items.length} positions have no mark, so NAV is not complete.`
      : ratios.length ? `${nameOf(ratios[0].p)}’s latest mark is ${multiple(ratios[0].r)} its cost.` : null;
  return {
    empty: false,
    rows,
    note,
    unmarked,
    alt: `Positions, cost and latest mark: ${rows.map((r) => `${r.label} ${r.a.text} and ${r.b.text || 'no mark'}`).join('; ')}.`,
    table: { head: ['Company', 'Cost', 'Latest mark'], rows: rows.map((r) => [r.label, r.a.text, r.b.text || 'No mark']) },
  };
}

/** The positions table's rows, searched by company or round, newest mark first (FND10). */
export function positionRows(positions, { q = '' } = {}) {
  const items = Array.isArray(positions?.items) ? positions.items : [];
  const s = String(q || '').trim().toLowerCase();
  return items
    .filter((p) => !s || [p.company_name, p.round_name].some((x) => String(x || '').toLowerCase().includes(s)))
    .map((p) => ({
      id: p.id,
      company: nameOf(p),
      round: p.round_name || NOT_RECORDED,
      cost: dollars(p.invested_amount) || NOT_RECORDED,
      mark: p.marked ? cents(p.value_cents) : null,
      markReason: p.marked ? null : (p.unavailable || {}).value_cents || 'No valuation is recorded for this position.',
      date: p.marked ? dayText(p.valuation_date) : null,
      source: p.marked ? p.source : null,
      recordedBy: p.marked ? (p.recorded_by?.name || NOT_RECORDED) : null,
      raw: p,
    }))
    .sort((a, b) => String(b.raw.valuation_date || '').localeCompare(String(a.raw.valuation_date || '')) || a.id - b.id);
}

/** "Funds side by side" (FND10), from the list read: every figure, or Not recorded with its reason. */
export function sideBySide(list) {
  const items = Array.isArray(list?.items) ? list.items : [];
  return items.map((f) => ({
    id: f.id,
    name: f.name,
    cells: [
      ['NAV', figure(f, 'nav_cents', cents)],
      ['Paid-in', figure(f, 'paid_in_cents', cents)],
      ['Distributed', figure(f, 'distributed_cents', cents)],
      ['DPI', figure(f, 'dpi', multiple)],
      ['RVPI', figure(f, 'rvpi', multiple)],
      ['TVPI', figure(f, 'tvpi', multiple)],
      ['IRR', figure(f, 'irr', rate)],
    ],
  }));
}

/** Dollars typed as `150000`, `150,000.00` or `$150000.5`, as integer cents; 0 is a mark (a write-off). */
export function dollarsToCents(raw) {
  const s = String(raw ?? '').trim().replace(/^\$/, '').replace(/,/g, '');
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const c = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(c) ? c : null;
}

export const SOURCE_MAX = 500;
/**
 * FND12's Record a mark, checked before the call: a real date not in the
 * future, a value in dollars (0 allowed), a source of 1 to 500 characters.
 * The Worker checks the same, so this only saves a round trip.
 */
export function checkMark({ date, value, source }, today) {
  const errors = {};
  const d = String(date || '').trim();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
  if (!valid) errors.date = 'Enter the valuation date.';
  else if (d > today) errors.date = 'The valuation date cannot be in the future.';
  const c = dollarsToCents(value);
  if (c === null) errors.value = 'Enter the value in dollars, for example 150000.00.';
  const src = String(source || '').trim();
  if (!src) errors.source = 'Say where this value comes from.';
  else if (src.length > SOURCE_MAX) errors.source = `The source is at most ${SOURCE_MAX} characters.`;
  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, body: { valuation_date: d, value_cents: c, source: src } };
}

/** FND12's Move to another fund: each administered fund and firm-level, the current one marked. */
export function moveOptions(funds, currentFundId) {
  return [
    ...(Array.isArray(funds) ? funds : []).map((f) => ({ key: `f-${f.id}`, id: f.id, label: f.name, current: String(f.id) === String(currentFundId) })),
    { key: 'firm', id: null, label: FIRM_LEVEL, current: currentFundId == null },
  ];
}
