/**
 * D4817 part 1 (#5311, PF-01): the pure model the Portfolio v2 frame and its
 * boards share. No React, no fetch, no clock: every date it compares against
 * comes from a Worker answer (`kpi-compliance`'s `as_of`), never from the
 * browser, so the same reads always draw the same page.
 *
 * A read is one of three things, and the model never folds them together:
 *
 *   { state: 'loading' }               not answered yet
 *   { state: 'ok', value }             answered, in the expected shape
 *   { state: 'unreadable' }            failed, or answered in a shape the page
 *                                      cannot read — never drawn as zero or as
 *                                      an empty book
 *
 * Where a read answered and holds no value, the field says "Not recorded",
 * with the reason. Where it failed, "Unreadable". A measured zero stays 0.
 */

import { NOT_RECORDED, titleCase } from '../../lib/absence';

export { NOT_RECORDED };
export const UNREADABLE = 'Unreadable';
export const UNAVAILABLE = 'Unavailable';

/* ------------------------------------------------------------- formatting */

const isNum = (v) => v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));

/** Whole US dollars, the way the canvas writes them: $1,500,000. Null when there is no number. */
export function money(value) {
  if (!isNum(value)) return null;
  const n = Number(value);
  const cents = Math.round(n * 100) % 100 !== 0;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
}

/** A multiple, two decimals and the × sign: 1.71×. */
export function multiple(value) {
  return isNum(value) ? `${Number(value).toFixed(2)}×` : null;
}

/** A rate stored as a fraction (D4619): 0.213 → 21.3%. */
export function rate(fraction) {
  if (!isNum(fraction)) return null;
  const pct = Math.round(Number(fraction) * 1000) / 10;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

export function percent(value, digits = 1) {
  return isNum(value) ? `${Number(value).toFixed(digits)}%` : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-09-30` (or a full ISO timestamp) → `30 Sep 2026`, read in UTC. Null for anything else. */
export function day(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/** Whole days from `from` to `to`, both ISO dates; null when either is missing. */
export function daysBetween(from, to) {
  const a = Date.parse(`${String(from || '').slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(to || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / 86_400_000);
}

/* ------------------------------------------------------------------ reads */

/** A settled `Promise.allSettled` entry, checked against the shape its board needs. */
export function readOf(settled, shapeOk = () => true) {
  if (!settled) return { state: 'loading' };
  if (settled.status === 'rejected') return { state: 'unreadable' };
  const value = settled.value;
  if (value == null || typeof value !== 'object' || !shapeOk(value)) return { state: 'unreadable' };
  return { state: 'ok', value };
}

/** What each Overview read must carry to be read at all. */
export const SHAPES = {
  positions: (v) => Array.isArray(v.items),
  analytics: (v) => 'nav' in v || 'returns' in v || 'paid_in' in v,
  health: (v) => Array.isArray(v.items),
  updates: (v) => Array.isArray(v.items),
  support: (v) => 'totals' in v,
  compliance: (v) => Array.isArray(v.companies),
  chases: (v) => Array.isArray(v.items),
};

/* ------------------------------------------------------------- performance */

/** D4644's reasons a return is undefined, in words a member can act on. */
export const RETURN_REASONS = {
  no_flows: 'No dated cash flows are recorded yet.',
  single_flow: 'Only one dated cash flow is recorded; a rate needs two.',
  no_contribution: 'Money came back with no capital recorded in.',
  no_paid_in: 'No paid-in capital is recorded.',
  outside_bracket: 'No rate solves between −99.99% and +1000% on these flows.',
  not_a_number: 'A recorded flow has an unusable date or amount.',
};

/** Each figure's definition, as the Worker computes it today (`portfolioMetrics.ts`). */
export const DEFINITIONS = {
  nav: 'Σ latest carrying value of each position; an unmarked position carries at cost',
  tvpi: '(Distributed + NAV) ÷ paid-in',
  dpi: 'Distributed ÷ paid-in',
  rvpi: 'NAV ÷ paid-in',
  irr: 'XIRR on dated flows, NAV as the terminal value',
  unrealised: 'Σ latest marks; an unmarked position at cost',
  paid_in: 'Σ recorded contributions',
  distributed: 'Σ recorded distributions',
};

/**
 * One financial metric: `{ key, label, value, state, note, reason }`.
 * `state` is 'ok' | 'not_recorded' | 'unavailable' | 'unreadable' | 'loading'.
 */
function metric(key, label, read, pick) {
  if (read.state === 'loading') return { key, label, value: null, state: 'loading', note: DEFINITIONS[key] };
  if (read.state === 'unreadable') {
    return { key, label, value: UNREADABLE, state: 'unreadable', note: DEFINITIONS[key], reason: 'Performance could not be read.' };
  }
  return { key, label, note: DEFINITIONS[key], ...pick(read.value) };
}

function ratio(figure, flat, format) {
  if (figure && figure.state === 'unavailable') {
    return { value: UNAVAILABLE, state: 'unavailable', reason: RETURN_REASONS[figure.reason] || 'The recorded inputs do not define this figure.' };
  }
  if (figure && figure.state === 'total_loss') return { value: format(figure.value ?? -1), state: 'ok', reason: 'Total loss: capital deployed and nothing came back.' };
  const v = figure ? figure.value : flat;
  const text = format(v);
  return text == null ? { value: NOT_RECORDED, state: 'not_recorded', reason: 'The performance read returned no figure.' } : { value: text, state: 'ok' };
}

/** The positions read's facts the performance board states beside NAV. */
function markFacts(positions) {
  if (positions.state !== 'ok') return null;
  const items = positions.value.items;
  const dates = items.map((p) => p.mark_as_of).filter(Boolean).sort();
  return { newest: dates.length ? dates[dates.length - 1] : null };
}

/**
 * PF-01's performance summary: NAV with mark coverage, the multiples with
 * their definitions, and the basis strip (gross, as-of, the mark rule and the
 * at-cost rule).
 */
export function performanceOf(analytics, positions) {
  const marks = markFacts(positions);
  const nav = metric('nav', 'Net asset value', analytics, (a) => {
    if (a.position_count === 0) return { value: NOT_RECORDED, state: 'not_recorded', reason: 'No position is recorded in this book.' };
    const text = money(a.nav);
    return text == null ? { value: NOT_RECORDED, state: 'not_recorded', reason: 'The performance read returned no NAV.' } : { value: text, state: 'ok' };
  });
  const multiples = [
    metric('tvpi', 'TVPI', analytics, (a) => ratio(a.returns?.tvpi, a.tvpi, multiple)),
    metric('dpi', 'DPI', analytics, (a) => ratio(a.returns?.dpi, a.dpi, multiple)),
    metric('rvpi', 'RVPI', analytics, (a) => ratio(a.returns?.rvpi, a.rvpi, multiple)),
    metric('irr', 'IRR', analytics, (a) => ratio(a.returns?.irr, a.irr, rate)),
  ];
  const flows = [
    metric('paid_in', 'Invested capital', analytics, (a) => moneyFigure(a.paid_in, a.position_count)),
    metric('unrealised', 'Unrealised value', analytics, (a) => moneyFigure(a.nav, a.position_count)),
    metric('distributed', 'Realised proceeds', analytics, (a) => moneyFigure(a.distributed, a.position_count)),
  ];
  const a = analytics.state === 'ok' ? analytics.value : null;
  const count = a && isNum(a.position_count) ? Number(a.position_count) : null;
  const unmarked = a && isNum(a.unmarked_position_count) ? Number(a.unmarked_position_count) : null;
  const unusable = a && isNum(a.unusable_mark_count) ? Number(a.unusable_mark_count) : 0;
  let coverage = null;
  if (count != null && count > 0 && unmarked != null) {
    const pct = isNum(a.mark_coverage) ? Math.round(Number(a.mark_coverage) * 100) : Math.round(((count - unmarked) / count) * 100);
    coverage = `${count - unmarked} of ${count} position${count === 1 ? '' : 's'} marked (${pct}% mark coverage)`;
  }
  const atCost = [];
  if (unmarked) atCost.push(`${unmarked} position${unmarked === 1 ? '' : 's'} carr${unmarked === 1 ? 'ies' : 'y'} at cost because no mark is recorded`);
  if (unusable) atCost.push(`${unusable} recorded mark${unusable === 1 ? '' : 's'} could not be used and carr${unusable === 1 ? 'ies' : 'y'} at cost`);
  const companies = count == null ? null : {
    value: String(count),
    note: unmarked == null ? null : `${count - unmarked} marked · ${unmarked} unmarked`,
  };
  const asOf = a?.as_of ? `As of ${day(a.as_of)}` : 'As of the latest recorded marks';
  const basis = [
    a ? (a.basis === 'gross' || a.basis == null ? 'Gross of fees and carry' : `Basis: ${a.basis}`) : 'Gross of fees and carry',
    asOf,
    marks?.newest ? `Newest mark ${day(marks.newest)}` : null,
    'Marks: latest per company on or before the as-of date',
    'Unmarked positions carry at cost',
  ].filter(Boolean);
  return { nav, multiples, flows, coverage, atCost, companies, basis, asOf: a ? asOf : null };
}

function moneyFigure(value, count) {
  if (count === 0) return { value: NOT_RECORDED, state: 'not_recorded', reason: 'No position is recorded in this book.' };
  const text = money(value);
  return text == null ? { value: NOT_RECORDED, state: 'not_recorded', reason: 'The performance read returned no figure.' } : { value: text, state: 'ok' };
}

/* ----------------------------------------------------------------- health */

/** The health states, most urgent first; never Healthy from missing evidence. */
export const HEALTH = ['Attention', 'Watch', 'Unreadable', 'Not enough evidence', 'Not recorded', 'Healthy'];
const BADGE = { red: 'Attention', yellow: 'Watch', green: 'Healthy' };

/** One company's health from `/api/portfolio/health`: `{ state, date, stale, reason, intervention }`. */
export function healthFor(position, health) {
  if (health.state === 'loading') return { state: 'loading' };
  if (health.state !== 'ok') return { state: 'Unreadable', reason: 'Health could not be read.' };
  const pid = Number(position.project_id);
  const uid = position.project?.uid;
  const item = health.value.items.find((h) => Number(h.project_id) === pid);
  if (item) {
    const state = BADGE[item.badge];
    if (!state) return { state: 'Not recorded', reason: 'The snapshot carries no badge.' };
    return { state, date: item.snapshot_date || null, stale: item.stale === true, ageDays: isNum(item.age_days) ? Number(item.age_days) : null, intervention: Boolean(item.intervention) };
  }
  const nm = (health.value.not_measured || []).find((n) => uid && n.uid === uid);
  if (nm && /insufficient|not_enough/.test(String(nm.state))) return { state: 'Not enough evidence', reason: nm.reason || 'Not enough evidence to score health.' };
  return { state: 'Not recorded', reason: 'No health snapshot is recorded for this company.' };
}

/* -------------------------------------------------------------- reporting */

/** One company's reporting obligation for the measured period: `{ state, period, last, reason }`. */
export function reportingFor(position, compliance) {
  if (compliance.state === 'loading') return { state: 'loading' };
  if (compliance.state !== 'ok') return { state: 'Unreadable', reason: 'Reporting could not be read.' };
  const c = compliance.value;
  const period = c.population?.period ?? c.period ?? null;
  const row = c.companies.find((x) => Number(x.project_id) === Number(position.project_id));
  if (!row) return { state: 'Not recorded', period, reason: 'This company is not in the reporting population.' };
  const last = row.last_reported_at || null;
  if (row.reported) return { state: 'Received', period, last };
  return { state: c.period_in_progress ? 'Due' : 'Not received', period, last, days: isNum(row.days_since_report) ? Number(row.days_since_report) : null };
}

/** The Reporting summary card. */
export function reportingSummaryOf(compliance, updates) {
  const submissions = updates.state === 'ok'
    ? updates.value.items
      .filter((u) => u.submitted_at || u.updated_at)
      .slice(0, 3)
      .map((u) => ({
        key: u.uid || u.id || `${u.project_id}-${u.period}`,
        date: day(u.submitted_at || u.updated_at),
        text: `${u.project?.name || 'A portfolio company'} submitted ${u.period || 'an update'}`,
      }))
    : null;
  if (compliance.state !== 'ok') return { state: compliance.state, submissions, updatesState: updates.state };
  const c = compliance.value;
  const period = c.population?.period ?? c.period ?? null;
  const total = isNum(c.total_count) ? Number(c.total_count) : c.companies.length;
  const received = isNum(c.reported_count) ? Number(c.reported_count) : c.companies.filter((x) => x.reported).length;
  return {
    state: 'ok',
    period,
    inProgress: c.period_in_progress === true,
    total,
    received,
    outstanding: total - received,
    submissions,
    updatesState: updates.state,
  };
}

/* -------------------------------------------------------------- value-add */

export function valueAddSummaryOf(support) {
  if (support.state !== 'ok') return { state: support.state };
  const s = support.value;
  if (!s.totals) return { state: 'unreadable', reason: 'The support ledger\'s figures could not be read.' };
  const t = s.totals;
  return {
    state: 'ok',
    open: t.promised,
    delivered: t.delivered,
    withdrawn: t.withdrawn,
    supported: t.companies_supported,
    inBook: t.companies_in_book,
    untouched: Array.isArray(s.untouched) ? s.untouched.length : (isNum(t.companies_in_book) && isNum(t.companies_supported) ? t.companies_in_book - t.companies_supported : null),
  };
}

/* -------------------------------------------------------- needs attention */

const RUNWAY_KEYS = ['runway_months', 'runway'];
/** A mark older than this many days is stale: two quarters. */
export const STALE_MARK_DAYS = 183;
export const RUNWAY_FLOOR = 6;

/** The founder's latest reported runway for a company, from `/api/portfolio-updates/latest`. */
export function runwayFor(position, updates) {
  if (updates.state !== 'ok') return null;
  const u = updates.value.items.find((x) => Number(x.project_id) === Number(position.project_id));
  if (!u || !u.kpis) return null;
  for (const k of RUNWAY_KEYS) {
    if (isNum(u.kpis[k])) return { months: Number(u.kpis[k]), period: u.period || null, date: u.submitted_at || null };
  }
  return null;
}

/**
 * The evidence for one company, each line `{ label, text, weight }` with
 * weight 3 urgent, 2 watch, 1 incomplete. A company with no evidence line is
 * not in the queue; a source that failed adds no line, and the board says the
 * queue is partial instead.
 */
export function evidenceFor(position, { health, compliance, updates }, reference) {
  const lines = [];
  const h = healthFor(position, health);
  if (h.state === 'Attention') lines.push({ label: 'Health', text: `Attention in the snapshot of ${day(h.date) || 'an undated day'}${h.intervention ? ' · flagged for intervention' : ''}`, weight: 3 });
  else if (h.state === 'Watch') lines.push({ label: 'Health', text: `Watch in the snapshot of ${day(h.date) || 'an undated day'}${h.intervention ? ' · flagged for intervention' : ''}`, weight: 2 });
  else if (h.state === 'Not enough evidence' || h.state === 'Not recorded') lines.push({ label: 'Health', text: h.reason, weight: 1 });
  if (h.stale && h.date) lines.push({ label: 'Health', text: `Snapshot ${h.ageDays != null ? `${h.ageDays} days old` : 'stale'} · ${day(h.date)}`, weight: 1 });

  const runway = runwayFor(position, updates);
  if (runway && runway.months < RUNWAY_FLOOR) {
    lines.push({ label: 'Runway', text: `${runway.months} month${runway.months === 1 ? '' : 's'} · founder update${runway.period ? ` · ${runway.period}` : ''}`, weight: 3 });
  }

  const r = reportingFor(position, compliance);
  if (r.state === 'Not received') {
    lines.push({ label: 'Report', text: `${r.period || 'Last period'} not received · ${r.last ? `last reported ${day(r.last)}` : 'never reported'}`, weight: 2 });
  }

  const name = 'Mark';
  const mark = markOf(position);
  if (mark.kind === 'unusable') lines.push({ label: name, text: `${mark.reason} · carried at cost`, weight: 2 });
  else if (mark.kind === 'none') lines.push({ label: name, text: `No mark recorded · carried at cost ${money(position.total_invested) || ''}`.trim(), weight: 1 });
  else {
    if (position.marked_down || (isNum(position.multiple) && Number(position.multiple) < 1)) {
      lines.push({ label: name, text: `Latest mark below cost · ${multiple(position.multiple) || 'multiple not recorded'}${position.mark_as_of ? ` · ${day(position.mark_as_of)}` : ''}`, weight: 2 });
    }
    const age = reference && position.mark_as_of ? daysBetween(position.mark_as_of, reference) : null;
    if (age != null && age > STALE_MARK_DAYS) {
      lines.push({ label: name, text: `Latest mark ${day(position.mark_as_of)}, older than two quarters`, weight: 1 });
    }
  }
  return { health: h, lines };
}

const nameOf = (p) => p.project?.name || 'Unnamed company';

/** PF-01's Needs attention queue, most urgent first. */
export function attentionOf(reads) {
  const { positions, health, compliance, updates } = reads;
  if (positions.state !== 'ok') return { state: positions.state, items: [] };
  const reference = compliance.state === 'ok' ? compliance.value.as_of || null : null;
  const items = positions.value.items
    .map((p) => {
      const { health: h, lines } = evidenceFor(p, { health, compliance, updates }, reference);
      return {
        key: String(p.project_id),
        name: nameOf(p),
        uid: p.project?.uid || null,
        health: h,
        lines,
        weight: lines.reduce((m, l) => Math.max(m, l.weight), 0),
        invested: Number(p.total_invested) || 0,
      };
    })
    .filter((x) => x.lines.length > 0)
    .sort((a, b) => b.weight - a.weight
      || HEALTH.indexOf(a.health.state) - HEALTH.indexOf(b.health.state)
      || b.lines.length - a.lines.length
      || b.invested - a.invested
      || a.name.localeCompare(b.name));
  const missing = [
    health.state === 'unreadable' ? 'health' : null,
    compliance.state === 'unreadable' ? 'reporting' : null,
    updates.state === 'unreadable' ? 'founder updates' : null,
  ].filter(Boolean);
  return { state: 'ok', items, missing };
}

/* ----------------------------------------------------------- company table */

/** The dense company table, sorted by health, then invested. */
export function companyRowsOf(reads) {
  const { positions, health, compliance } = reads;
  if (positions.state !== 'ok') return null;
  return positions.value.items
    .map((p) => {
      const h = healthFor(p, health);
      const r = reportingFor(p, compliance);
      const mark = markOf(p);
      return {
        key: String(p.project_id),
        uid: p.project?.uid || null,
        name: nameOf(p),
        sector: p.project?.sector || null,
        stage: p.project?.stage || null,
        invested: money(p.total_invested),
        investedRaw: Number(p.total_invested) || 0,
        // D6208: the sort keys, null where nothing is recorded, so a missing
        // figure sorts last instead of sorting as a zero.
        investedValue: isNum(p.total_invested) ? Number(p.total_invested) : null,
        multipleValue: isNum(p.multiple) ? Number(p.multiple) : null,
        lastValue: r.last ? String(r.last) : null,
        fmv: mark.kind === 'marked' ? money(p.fmv) : null,
        markDate: p.mark_as_of ? day(p.mark_as_of) : null,
        atCost: mark.kind === 'marked' ? null : money(p.total_invested),
        markReason: mark.kind === 'unusable' ? mark.reason : null,
        ownership: percent(p.latest_ownership_pct),
        moic: multiple(p.multiple),
        moicAtCost: mark.kind !== 'marked',
        below: isNum(p.multiple) && Number(p.multiple) < 1,
        reporting: r,
        health: h,
        lastUpdate: r.last ? day(r.last) : null,
      };
    })
    .sort((a, b) => HEALTH.indexOf(a.health.state) - HEALTH.indexOf(b.health.state) || b.investedRaw - a.investedRaw || a.name.localeCompare(b.name));
}

/**
 * The value a Sector or Stage filter uses for a row that records none: the
 * filter offers "Not recorded" as its own choice rather than hiding the row.
 */
export const NONE = '__none';

/** The reporting states a row can carry (`reportingFor`), most urgent first. */
export const REPORTING = ['Not received', 'Due', 'Received', 'Not recorded', 'Unreadable'];

const matches = (want, have) => want === 'all' || (want === NONE ? !have : have === want);

/**
 * Filter the table by a search string and by Sector, Stage, Health and
 * Reporting ('all' for every row). Sector and stage are the project's own
 * (`companyRowsOf`); Reporting is the row's obligation for the measured
 * period (`reportingFor`), the same word the Reporting column shows.
 */
export function filterRows(rows, {
  query = '', health = 'all', sector = 'all', stage = 'all', reporting = 'all',
} = {}) {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => (!q || r.name.toLowerCase().includes(q) || String(r.sector || '').toLowerCase().includes(q))
    && (health === 'all' || r.health.state === health)
    && matches(sector, r.sector)
    && matches(stage, r.stage)
    && (reporting === 'all' || r.reporting.state === reporting));
}

/**
 * The choices each filter offers, from the rows the book holds: a sector or
 * stage nobody carries is not offered, and a row with none is reachable
 * through "Not recorded". Reporting offers only the states present, in
 * REPORTING order.
 */
export function filterOptionsOf(rows) {
  const distinct = (pick) => {
    const seen = new Map();
    let none = false;
    for (const r of rows) {
      const v = pick(r);
      if (v) seen.set(v, titleCase(v) || v); else none = true;
    }
    const list = [...seen].map(([value, text]) => ({ value, label: text })).sort((a, b) => a.label.localeCompare(b.label));
    return none ? [...list, { value: NONE, label: NOT_RECORDED }] : list;
  };
  const present = new Set(rows.map((r) => r.reporting?.state));
  return {
    sector: distinct((r) => r.sector),
    stage: distinct((r) => r.stage),
    reporting: REPORTING.filter((s) => present.has(s)).map((s) => ({ value: s, label: s })),
  };
}

/** The sort control's choices; `health` is the table's own order (`companyRowsOf`). */
export const SORTS = [
  { value: 'health', label: 'Health', words: 'health, then invested' },
  { value: 'invested', label: 'Invested', words: 'invested, largest first' },
  { value: 'multiple', label: 'Multiple', words: 'multiple, highest first' },
  { value: 'updated', label: 'Last update', words: 'last update, newest first' },
];

const SORT_KEY = { invested: 'investedValue', multiple: 'multipleValue', updated: 'lastValue' };

/**
 * Sort the rows. A row with nothing recorded for the key sorts last, never as
 * a zero; ties keep the health order.
 */
export function sortRows(rows, by = 'health') {
  const key = SORT_KEY[by];
  if (!key) return rows.slice();
  const cmp = (a, b) => (typeof a === 'number' ? b - a : String(b).localeCompare(String(a)));
  return rows.slice().sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x == null || y == null) return (x == null) - (y == null);
    return cmp(x, y);
  });
}

/**
 * The words for the filters in force, in the order the controls sit:
 * `['Search: “kit”', 'Sector: Robotics', …]`. Empty when nothing narrows.
 */
export function filterWordsOf(filters, options) {
  const named = (list, value) => (list.find((o) => o.value === value) || {}).label || value;
  const out = [];
  const q = String(filters.query || '').trim();
  if (q) out.push(`Search: “${q}”`);
  if (filters.sector && filters.sector !== 'all') out.push(`Sector: ${named(options.sector, filters.sector)}`);
  if (filters.stage && filters.stage !== 'all') out.push(`Stage: ${named(options.stage, filters.stage)}`);
  if (filters.health && filters.health !== 'all') out.push(`Health: ${filters.health}`);
  if (filters.reporting && filters.reporting !== 'all') out.push(`Reporting: ${filters.reporting}`);
  return out;
}

/** The table's caption: the count, the filters in force, the sort and the basis. */
export function tableCaptionOf(shown, total, filterWords, sort = 'health') {
  const sorted = (SORTS.find((s) => s.value === sort) || SORTS[0]).words;
  return [
    `${shown} of ${total} ${total === 1 ? 'company' : 'companies'}`,
    ...(filterWords.length ? [`filtered by ${filterWords.join(', ')}`] : []),
    `sorted by ${sorted}`,
    'values gross',
  ].join(' · ');
}

/* ----------------------------------------------------------------- exports */

/*
 * D6208: what Export writes. Each builder returns `{ header, rows }` for
 * `exportView` (`lib/csvExport.js`), or `{ reason }` when there is nothing to
 * write yet. A cell never holds a zero, a blank or "Reading…" in place of a
 * figure: a gap is written as the word the screen shows (Not recorded,
 * Unreadable), so the file cannot claim more than the page does.
 */

/** The basis and as-of every exported row carries, from the performance read. */
export function exportBasisOf(analytics) {
  if (!analytics || analytics.state === 'loading') return null;
  if (analytics.state !== 'ok') return { basis: 'Gross of fees and carry', asOf: UNREADABLE };
  const a = analytics.value;
  return {
    basis: a.basis === 'gross' || a.basis == null ? 'Gross of fees and carry' : `Basis: ${a.basis}`,
    asOf: a.as_of ? day(a.as_of) : 'Latest recorded marks',
  };
}

const LOADING_NAMES = { positions: 'Positions', health: 'Health', compliance: 'Reporting', analytics: 'Performance' };

/** The Overview's export: the rows shown, in the order shown, each with its basis and as-of. */
export function companyExportOf(reads, rows, shown) {
  const loading = Object.keys(LOADING_NAMES).filter((k) => !reads[k] || reads[k].state === 'loading');
  if (loading.length) return { reason: `${loading.map((k) => LOADING_NAMES[k]).join(', ')} ${loading.length === 1 ? 'is' : 'are'} still loading, so there is nothing to export yet.` };
  if (reads.positions.state !== 'ok' || !rows) return { reason: 'Positions could not be read, so there is nothing to export.' };
  if (rows.length === 0) return { reason: 'No position is recorded, so there is nothing to export.' };
  if (shown.length === 0) return { reason: 'No company matches these filters, so there is nothing to export.' };
  const { basis, asOf } = exportBasisOf(reads.analytics);
  return {
    header: ['Company', 'Sector', 'Stage', 'Invested', 'Latest FMV', 'Mark date', 'Ownership', 'MOIC', 'Reporting', 'Period', 'Health', 'Last update', 'Basis', 'As of'],
    rows: shown.map((r) => [
      r.name,
      r.sector ? titleCase(r.sector) || r.sector : NOT_RECORDED,
      r.stage ? titleCase(r.stage) || r.stage : NOT_RECORDED,
      r.invested || NOT_RECORDED,
      r.fmv || (r.markReason ? 'Mark not usable' : 'No mark recorded'),
      r.fmv ? (r.markDate || NOT_RECORDED) : (r.atCost ? `Carried at cost ${r.atCost}` : NOT_RECORDED),
      r.ownership || NOT_RECORDED,
      r.moic ? `${r.moic}${r.moicAtCost ? ' at cost' : ''}` : NOT_RECORDED,
      r.reporting.state,
      r.reporting.period || NOT_RECORDED,
      r.health.state,
      r.lastUpdate || (r.reporting.state === UNREADABLE ? UNREADABLE : NOT_RECORDED),
      basis,
      asOf,
    ]),
  };
}

/** Performance's quarter-end export: every quarter-end in the window, a gap written as its word. */
export function quarterExportOf(win, series, analytics) {
  if (!win || win.state === 'loading') return { reason: 'The quarter-end series is still loading, so there is nothing to export yet.' };
  if (win.state === 'unreadable') return { reason: 'The quarter-end series could not be read, so there is nothing to export.' };
  if (win.state !== 'ok') return { reason: `No quarter-end is recorded (${win.reason}), so there is nothing to export.` };
  if (!series || series.points.some((p) => p.state === 'loading')) return { reason: 'Some quarter-ends are still loading, so there is nothing to export yet.' };
  const basis = (exportBasisOf(analytics) || {}).basis || 'Gross of fees and carry';
  return {
    header: ['Quarter-end', 'Quarter', 'NAV', 'Paid-in', 'Distributed', 'TVPI', 'Mark coverage', 'Note', 'Basis'],
    rows: series.points.map((p) => {
      const gap = p.state === 'ok' ? null : pointWords(p);
      return [
        p.date,
        quarterName(p.date) || p.label,
        gap || p.navText,
        gap || p.paidIn,
        gap || p.distributed,
        gap || p.tvpi.value,
        gap || p.coverage,
        p.reason || '',
        basis,
      ];
    }),
  };
}

/**
 * Performance's cohort export: one row per vintage, as the table shows it.
 * A cohort's carrying value is the positions read's latest recorded mark (or
 * cost), not the performance read's as-of, so that is what its As of says.
 */
export function cohortExportOf(cohorts) {
  if (!cohorts || cohorts.state === 'loading') return { reason: 'Positions are still loading, so there is nothing to export yet.' };
  if (cohorts.state === 'unreadable') return { reason: 'Positions could not be read, so there is nothing to export.' };
  if (cohorts.state !== 'ok') return { reason: `${cohorts.reason} There is nothing to export.` };
  if (cohorts.rows.length === 0) return { reason: 'No position records a first-cheque date, so no cohort is drawn and there is nothing to export.' };
  return {
    header: ['Vintage', 'Companies', 'Invested', 'Carrying value', 'Carried at cost', 'Carrying ÷ invested', 'Basis', 'As of'],
    rows: cohorts.rows.map((r) => [r.vintage, r.companies, r.invested, r.carrying, r.atCost, r.multiple || NOT_RECORDED, 'Gross of fees and carry', 'Latest recorded marks']),
  };
}

/* ------------------------------------------------- positions register (PF-02) */

/**
 * D4817 part 2 (PF-02): one position's mark, in one of three kinds the
 * register keeps apart.
 *
 *   { kind: 'marked', date, basis }   a recorded mark is the carrying value
 *   { kind: 'none' }                  no mark is recorded: carried at cost
 *   { kind: 'unusable', reason }      a mark is recorded and cannot be used
 *                                     (two funds disagree, or it is negative):
 *                                     carried at cost, and says why
 *
 * The Worker names the reason (`mark_unavailable_reason`); `no_mark` is the
 * plain "nothing recorded" case and never reads as a mark that failed.
 */
export function markOf(position) {
  const code = position.mark_unavailable_reason || null;
  if (code && code !== 'no_mark') return { kind: 'unusable', reason: position.mark_unavailable || 'The recorded mark cannot be used as a value.' };
  if (!code && position.mark_unavailable) return { kind: 'unusable', reason: position.mark_unavailable };
  if (code === 'no_mark' || position.unmarked || !isNum(position.fmv)) return { kind: 'none' };
  return { kind: 'marked', date: position.mark_as_of || null, basis: position.mark_basis || null };
}

/** `portfolio_marks.basis`, spelled one way everywhere (audit F-24). */
export const MARK_BASIS = {
  round_price: 'Priced round',
  priced_round: 'Priced round',
  secondary: 'Secondary',
  gp_estimate: 'GP estimate',
  write_down: 'Write-down',
  cost: 'Cost',
};

/** A basis in words; null when none is recorded (never the column's default). */
export function basisLabel(basis) {
  if (basis == null || String(basis).trim() === '') return null;
  const key = String(basis).trim().toLowerCase();
  return MARK_BASIS[key] || key.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * The date a mark's age is measured against: the book's own as-of date when
 * one is chosen, else the Worker's `as_of` on the reporting read. Never the
 * browser clock. Null when neither is known, and the page says so.
 */
export function markReference(asOf, compliance) {
  if (asOf) return { date: asOf, state: 'ok', source: 'as_of' };
  if (compliance.state === 'loading') return { date: null, state: 'loading' };
  if (compliance.state !== 'ok') return { date: null, state: 'unreadable' };
  const d = compliance.value.as_of || null;
  return d ? { date: d, state: 'ok', source: 'worker' } : { date: null, state: 'not_recorded' };
}

/** A mark older than two quarters at `reference`; null when either date is missing. */
export function isStale(markDate, reference) {
  const age = daysBetween(markDate, reference);
  return age == null ? null : age > STALE_MARK_DAYS;
}

/**
 * PF-02's register rows, largest cheque first. `attention` is the set of
 * company keys the Overview's Needs attention queue holds, so the register's
 * "Needs attention" filter and the Overview answer from one rule set
 * (audit F-05).
 */
export function registerRowsOf(reads, reference, attention = new Set()) {
  const { positions, health, compliance } = reads;
  if (positions.state !== 'ok') return null;
  return positions.value.items
    .map((p) => {
      const mark = markOf(p);
      const invested = isNum(p.total_invested) ? Number(p.total_invested) : null;
      const carrying = mark.kind === 'marked' ? Number(p.fmv) : invested;
      return {
        key: String(p.project_id),
        uid: p.project?.uid || null,
        name: nameOf(p),
        stage: p.project?.stage || null,
        sector: p.project?.sector || null,
        invested: money(invested),
        investedRaw: invested,
        carryingRaw: carrying,
        ownership: percent(p.latest_ownership_pct),
        round: p.latest_round || null,
        mark,
        fmv: mark.kind === 'marked' ? money(p.fmv) : null,
        atCost: mark.kind === 'marked' ? null : money(invested),
        multiple: multiple(p.multiple),
        below: mark.kind === 'marked' && (p.marked_down === true || (isNum(p.multiple) && Number(p.multiple) < 1)),
        markDate: mark.kind === 'marked' && mark.date ? day(mark.date) : null,
        stale: mark.kind === 'marked' && reference.date ? isStale(mark.date, reference.date) : null,
        ageDays: mark.kind === 'marked' && reference.date ? daysBetween(mark.date, reference.date) : null,
        basis: mark.kind === 'marked' ? basisLabel(mark.basis) : null,
        reporting: reportingFor(p, compliance),
        health: healthFor(p, health),
        attention: attention.has(String(p.project_id)),
      };
    })
    .sort((a, b) => (b.investedRaw ?? -1) - (a.investedRaw ?? -1) || a.name.localeCompare(b.name));
}

const NO_BOOK = 'No position is recorded in this book.';

/**
 * The three counts the canvas sets above the register, kept separate: mark
 * coverage, stale marks, and marks recorded but unusable. Each is a count the
 * platform measured, or it says why it is not.
 */
export function markCountsOf(rows, reference) {
  if (!rows) return null;
  const total = rows.length;
  const marked = rows.filter((r) => r.mark.kind === 'marked');
  const unmarked = rows.filter((r) => r.mark.kind !== 'marked');
  const unusable = rows.filter((r) => r.mark.kind === 'unusable');
  if (total === 0) {
    const none = { state: 'not_recorded', reason: NO_BOOK };
    return { coverage: none, stale: none, unusable: none };
  }
  const coverage = { state: 'ok', marked: marked.length, total, pct: Math.round((marked.length / total) * 100), unmarked: unmarked.map((r) => r.name) };
  let stale;
  if (reference.state === 'loading') stale = { state: 'loading' };
  else if (!reference.date) {
    stale = reference.state === 'unreadable'
      ? { state: 'unreadable', reason: 'Mark age is measured against the reporting read’s date, which could not be read.' }
      : { state: 'not_recorded', reason: 'No reference date was returned to measure mark age against.' };
  } else {
    const hits = marked.filter((r) => r.stale === true);
    stale = { state: 'ok', count: hits.length, items: hits.map((r) => ({ name: r.name, date: r.markDate })), reference: day(reference.date) };
  }
  return { coverage, stale, unusable: { state: 'ok', count: unusable.length, items: unusable.map((r) => r.name) } };
}

/** The register's total row: positions, Σ invested and Σ carrying value, with the at-cost part named. */
export function registerTotalOf(rows) {
  if (!rows || rows.length === 0) return null;
  const known = rows.filter((r) => r.investedRaw != null);
  const invested = known.reduce((s, r) => s + r.investedRaw, 0);
  const carrying = known.reduce((s, r) => s + (r.carryingRaw ?? 0), 0);
  return {
    count: rows.length,
    invested: money(invested),
    carrying: money(carrying),
    multiple: invested > 0 ? multiple(carrying / invested) : null,
    missingCost: rows.length - known.length,
    atCost: rows.filter((r) => r.mark.kind !== 'marked').map((r) => ({ name: r.name, cost: r.atCost })),
  };
}

/** Filter the register by a search string and the toolbar's predicate (the page owns each filter's rule). */
export function filterRegister(rows, { query = '', keep = () => true } = {}) {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => (!q || r.name.toLowerCase().includes(q) || String(r.sector || '').toLowerCase().includes(q)) && keep(r));
}

const byDateDesc = (a, b) => String(b.as_of_date || '').localeCompare(String(a.as_of_date || ''));

/**
 * One company's mark history (PF-02b) from `/api/positions/:uid`, newest
 * first, with the latest mark's age at `reference`.
 */
export function markHistoryOf(detail, reference) {
  const marks = (Array.isArray(detail?.marks) ? detail.marks : []).slice().sort(byDateDesc);
  const rows = marks.map((m, i) => ({
    key: m.uid || `${m.as_of_date}-${i}`,
    date: day(m.as_of_date),
    fmv: money(m.fmv),
    postMoney: money(m.post_money),
    event: m.event || null,
    basis: basisLabel(m.basis),
    source: m.source || m.note || null,
  }));
  const age = marks.length && reference.date ? daysBetween(marks[0].as_of_date, reference.date) : null;
  return { rows, stale: age == null ? null : age > STALE_MARK_DAYS, ageDays: age };
}

/** A day count in words, for "Latest mark 7 months old". */
export function ageWords(days) {
  if (days == null) return null;
  const m = Math.floor(days / 30.44);
  return m < 1 ? `${days} day${days === 1 ? '' : 's'} old` : `${m} month${m === 1 ? '' : 's'} old`;
}

/**
 * The attention rules the addendum maps for Positions (PFA06), each with its
 * hits, or the state of the source it reads. `flips` is
 * `{ [uid]: true | false | 'unreadable' }` from each Attention company's
 * 90-day health history. `overview` says whether the rule also feeds the
 * Overview's queue.
 */
export function attentionRulesOf(reads, rows, flips = {}) {
  const { positions, health, compliance, updates } = reads;
  const list = rows || [];
  const byKey = new Map(list.map((r) => [r.key, r]));
  const items = positions.state === 'ok' ? positions.value.items : [];
  const runway = updates.state !== 'ok' ? { state: updates.state } : {
    state: 'ok',
    hits: items.map((p) => ({ r: byKey.get(String(p.project_id)), w: runwayFor(p, updates) }))
      .filter(({ r, w }) => r && w && w.months < RUNWAY_FLOOR)
      .map(({ r, w }) => ({ key: r.key, name: r.name, text: `${w.months} month${w.months === 1 ? '' : 's'} · founder-reported${w.period ? ` · ${w.period}` : ''}${w.date ? ` · ${day(w.date)}` : ''}` })),
  };
  const staleUpdate = compliance.state !== 'ok' ? { state: compliance.state } : {
    state: 'ok',
    hits: compliance.value.companies
      .filter((c) => byKey.has(String(c.project_id)))
      .filter((c) => !c.last_reported_at || (isNum(c.days_since_report) && Number(c.days_since_report) > 30))
      .map((c) => ({
        key: String(c.project_id),
        name: byKey.get(String(c.project_id)).name,
        text: c.last_reported_at
          ? `Last update received ${day(c.last_reported_at)}${isNum(c.days_since_report) ? ` · ${Number(c.days_since_report)} days` : ''}`
          : 'No update received',
      })),
  };
  const red = list.filter((r) => r.health.state === 'Attention' && r.uid);
  let healthFlip;
  if (health.state !== 'ok') healthFlip = { state: health.state };
  else if (red.some((r) => flips[r.uid] === undefined)) healthFlip = { state: 'loading' };
  else {
    healthFlip = {
      state: 'ok',
      partial: red.filter((r) => flips[r.uid] === 'unreadable').map((r) => r.name),
      hits: red.filter((r) => flips[r.uid] === true)
        .map((r) => ({ key: r.key, name: r.name, text: `Attention in the snapshot of ${day(r.health.date) || 'an undated day'}; an earlier snapshot inside 90 days was not` })),
    };
  }
  const below = positions.state !== 'ok' ? { state: positions.state } : {
    state: 'ok',
    hits: list.filter((r) => r.below).map((r) => ({ key: r.key, name: r.name, text: `${r.multiple || 'Multiple not recorded'} · ${r.basis || 'basis not recorded'}${r.markDate ? ` · ${r.markDate}` : ''}` })),
  };
  const noEvidence = health.state !== 'ok' ? { state: health.state } : {
    state: 'ok',
    hits: list.filter((r) => r.health.state === 'Not recorded' || r.health.state === 'Not enough evidence')
      .map((r) => ({ key: r.key, name: r.name, text: r.health.reason || r.health.state })),
  };
  return [
    { key: 'runway', rule: 'Runway under 6 months', reason: 'Attention · short runway', source: 'Founder updates', retry: 'updates', overview: true, ...runway },
    { key: 'stale-update', rule: 'Update older than 30 days', reason: 'Watch · stale update', source: 'Reporting', retry: 'compliance', overview: false, ...staleUpdate },
    { key: 'health-red', rule: 'Health turned red within 90 days', reason: 'Attention · recent health change', source: 'Health', retry: 'health', overview: false, ...healthFlip },
    { key: 'below-cost', rule: 'Latest mark below cost', reason: 'Watch · marked down', source: 'Positions', retry: 'positions', overview: true, ...below },
    { key: 'no-evidence', rule: 'No positive scoring evidence', reason: 'Not enough evidence', source: 'Health', retry: 'health', overview: true, ...noEvidence },
  ];
}

/* ------------------------------------------- quarter-end series (PF-03) */

/**
 * D4817 part 3 (#5311, canvas PF-03): NAV at each quarter-end, read with
 * `/api/positions/analytics?as_of=<quarter-end>` once per quarter. The chart
 * and the table draw the one list of points this returns, so they cannot
 * disagree. A quarter that was not read, or was read and holds no book, is a
 * gap in words; nothing is interpolated between two reads.
 */

/** How many completed quarter-ends the board reads, newest last (two years). */
export const QUARTER_LIMIT = 8;

const QUARTER_DAYS = ['03-31', '06-30', '09-30', '12-31'];

/** True for an ISO date that is the last day of a calendar quarter. */
export function isQuarterEnd(iso) {
  const m = /^(\d{4})-(\d{2}-\d{2})$/.exec(String(iso || ''));
  return Boolean(m) && QUARTER_DAYS.includes(m[2]);
}

/** Every quarter-end from the first quarter of `firstYear` through `last` (a quarter-end), oldest first. */
export function quarterEndsBetween(firstYear, last) {
  if (!isQuarterEnd(last) || !Number.isInteger(firstYear)) return [];
  const out = [];
  for (let y = firstYear; y <= Number(last.slice(0, 4)); y += 1) {
    for (const d of QUARTER_DAYS) {
      const iso = `${y}-${d}`;
      if (iso > last) return out;
      out.push(iso);
    }
  }
  return out;
}

/**
 * Which quarter-ends to read. The first is the first quarter of the earliest
 * cheque's year (`vintage` on the positions read); the last is the reporting
 * read's last completed quarter (`period_until`, the Worker's own date, never
 * the browser clock). At most `limit`, the newest kept.
 */
export function quarterWindowOf(positions, compliance, limit = QUARTER_LIMIT) {
  if (positions.state === 'loading' || compliance.state === 'loading') return { state: 'loading', dates: [] };
  if (positions.state !== 'ok') {
    return { state: 'unreadable', dates: [], retry: 'positions', reason: 'The quarter-ends start at the first recorded cheque, and the positions could not be read.' };
  }
  const items = positions.value.items;
  if (items.length === 0) return { state: 'not_recorded', dates: [], reason: 'No position is recorded, so there is no quarter-end to read.' };
  const years = items.map((p) => Number(p.vintage)).filter((y) => Number.isInteger(y) && y > 0);
  if (years.length === 0) return { state: 'not_recorded', dates: [], reason: 'No position records the date of its first cheque.' };
  if (compliance.state !== 'ok') {
    return { state: 'unreadable', dates: [], retry: 'compliance', reason: 'The last completed quarter-end comes from the reporting read, which could not be read.' };
  }
  const c = compliance.value;
  const last = c.period_until;
  if (!isQuarterEnd(last) || c.period_complete === false || (c.cadence && c.cadence !== 'quarterly')) {
    return { state: 'not_recorded', dates: [], reason: 'The reporting read names no completed quarter to end the series at.' };
  }
  const all = quarterEndsBetween(Math.min(...years), last);
  if (all.length === 0) return { state: 'not_recorded', dates: [], reason: 'No quarter-end has passed since the first recorded cheque.' };
  const dates = all.slice(-limit);
  return { state: 'ok', dates, earlier: all.length - dates.length, last };
}

/** The analytics read for one quarter-end must answer for that date, or it is not that quarter's read. */
export const quarterShape = (date) => (v) => SHAPES.analytics(v) && v.as_of === date;

/**
 * One quarter-end point: `{ date, label, state, nav, navText, paidIn,
 * distributed, tvpi, coverage, reason }`. `state` is 'ok' (drawn),
 * 'not_recorded' (read, and holds no book or no NAV), 'unreadable' (the read
 * failed or did not answer for this date) or 'loading'. Only 'ok' is drawn.
 */
export function quarterPointOf(date, read) {
  const base = { date, label: day(date) };
  if (!read || read.state === 'loading') return { ...base, state: 'loading' };
  if (read.state !== 'ok') return { ...base, state: 'unreadable', reason: 'This quarter-end could not be read.' };
  const a = read.value;
  if (isNum(a.position_count) && Number(a.position_count) === 0) {
    return { ...base, state: 'not_recorded', reason: 'No position is recorded on or before this date.' };
  }
  if (!isNum(a.nav)) return { ...base, state: 'not_recorded', reason: 'The read returned no NAV for this date.' };
  const count = isNum(a.position_count) ? Number(a.position_count) : null;
  const unmarked = isNum(a.unmarked_position_count) ? Number(a.unmarked_position_count) : null;
  return {
    ...base,
    state: 'ok',
    nav: Number(a.nav),
    navText: money(a.nav),
    paidIn: money(a.paid_in) || NOT_RECORDED,
    distributed: money(a.distributed) || NOT_RECORDED,
    tvpi: ratio(a.returns?.tvpi, a.tvpi, multiple),
    coverage: count != null && unmarked != null ? `${count - unmarked} of ${count}` : NOT_RECORDED,
  };
}

/** `2026-09-30` → `Q3 2026`, the chart's column name. */
export function quarterName(iso) {
  if (!isQuarterEnd(iso)) return null;
  return `Q${QUARTER_DAYS.indexOf(iso.slice(5)) + 1} ${iso.slice(0, 4)}`;
}

/** Millions with one decimal, for a bar's label: $11.1m. */
export function moneyShort(value) {
  if (!isNum(value)) return null;
  const n = Number(value);
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return money(n);
}

/**
 * The series both views draw. `reads` maps each quarter-end to its read.
 * `change` compares the newest point with the quarter before it, only when
 * both were read: never across a gap.
 */
export function quarterSeriesOf(dates, reads = {}) {
  const points = dates.map((d) => quarterPointOf(d, reads[d]));
  const drawn = points.filter((p) => p.state === 'ok');
  const n = points.length;
  let change = null;
  if (n >= 2 && points[n - 1].state === 'ok' && points[n - 2].state === 'ok') {
    const delta = points[n - 1].nav - points[n - 2].nav;
    change = { from: points[n - 2].label, to: points[n - 1].label, text: delta === 0 ? 'unchanged' : `${delta > 0 ? 'up' : 'down'} ${money(Math.abs(delta))}` };
  }
  return {
    points,
    drawn: drawn.length,
    gaps: points.filter((p) => p.state === 'not_recorded' || p.state === 'unreadable').length,
    max: drawn.reduce((m, p) => Math.max(m, p.nav), 0),
    change,
  };
}

/** The rows the chart library draws: a gap's value is null (no bar), never 0. */
export function chartRowsOf(series) {
  return series.points.map((p) => ({ date: p.date, label: p.label, nav: p.state === 'ok' ? p.nav : null }));
}

/** The words a point reads as, the same in the chart and the table. */
export function pointWords(p) {
  if (p.state === 'ok') return p.navText;
  if (p.state === 'unreadable') return UNREADABLE;
  if (p.state === 'not_recorded') return NOT_RECORDED;
  return 'Reading…';
}

/** The chart's text alternative: every point, gaps included, in order. */
export function seriesLabel(series) {
  if (series.points.length === 0) return 'NAV at quarter-ends: no quarter-end to draw.';
  return `NAV at quarter-ends, gross: ${series.points.map((p) => `${p.label}, ${pointWords(p)}`).join('; ')}. Bars only where a quarter-end was read; nothing is drawn between them.`;
}

/* ------------------------------------------------------ vintage cohorts */

/**
 * Vintage cohorts (addendum PFA07: cohorts stay in Performance), grouped by
 * the year of each company's first cheque. Carrying value is the positions
 * read's own (a mark, else cost). Distributions are not on that read per
 * company, so a cohort's multiple is carrying value ÷ invested and is
 * labelled so, never called TVPI.
 */
export function cohortsOf(positions) {
  if (positions.state !== 'ok') return { state: positions.state };
  const items = positions.value.items;
  if (items.length === 0) return { state: 'not_recorded', reason: NO_BOOK };
  const by = new Map();
  let undated = 0;
  for (const p of items) {
    const y = Number(p.vintage);
    if (!Number.isInteger(y) || y <= 0) { undated += 1; continue; }
    const c = by.get(y) || { vintage: y, invested: 0, carrying: 0, count: 0, atCost: 0 };
    const invested = isNum(p.total_invested) ? Number(p.total_invested) : 0;
    c.invested += invested;
    c.carrying += isNum(p.fmv) ? Number(p.fmv) : invested;
    c.count += 1;
    if (markOf(p).kind !== 'marked') c.atCost += 1;
    by.set(y, c);
  }
  const rows = [...by.values()].sort((a, b) => a.vintage - b.vintage).map((c) => ({
    key: String(c.vintage),
    vintage: String(c.vintage),
    companies: c.count,
    invested: money(c.invested),
    carrying: money(c.carrying),
    multiple: c.invested > 0 ? multiple(c.carrying / c.invested) : null,
    atCost: c.atCost,
  }));
  return { state: 'ok', rows, undated };
}

/* ------------------------------------------------------- reports (PF-04) */

const QUARTER_LABEL = /^(\d{4})-Q([1-4])$/;
const MONTH_LABEL = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** A stored period as people say it: `2026-Q3` → Q3 2026, `2026-09` → Sep 2026; anything else as stored, null when none. */
export function periodName(label) {
  const s = String(label ?? '').trim();
  let m = QUARTER_LABEL.exec(s);
  if (m) return `Q${m[2]} ${m[1]}`;
  m = MONTH_LABEL.exec(s);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return s || null;
}

/**
 * Whether an update's stored period speaks for the obligation's period, by
 * the Worker's own rule (`periodCounts`, D1057): the same label, or, at the
 * quarterly cadence, a month inside the quarter.
 */
export function periodCovers(cadence, period, stored) {
  const due = String(period ?? '').trim();
  const s = String(stored ?? '').trim();
  if (!due || !s) return false;
  if (cadence === 'monthly') return MONTH_LABEL.test(s) && s === due;
  if (s === due) return QUARTER_LABEL.test(s);
  const m = MONTH_LABEL.exec(s);
  return Boolean(m) && `${m[1]}-Q${Math.floor((Number(m[2]) - 1) / 3) + 1}` === due;
}

/** Why an obligation shows no due date: the cadence read records none, so no overdue days are counted. */
export const NO_DUE_DATE = 'The reporting cadence records no due date for this period, so no days overdue are counted.';

const blank = (v) => v === undefined || v === null || String(v).trim() === '';
const keyWords = (key) => titleCase(key) || NOT_RECORDED;

/** The required KPIs of the set. `required` is an integer: 1 required, 0 optional, NULL unrecorded (neither). */
export function requiredKpisOf(kpiSet) {
  return (Array.isArray(kpiSet) ? kpiSet : []).filter((r) => r && r.required != null && Number(r.required) === 1);
}

/** Each required KPI against one update: `{ key, name, carried }`. A key present with a blank value is not carried. */
export function requiredAgainst(kpiSet, update) {
  const kpis = update?.kpis && typeof update.kpis === 'object' ? update.kpis : {};
  return requiredKpisOf(kpiSet).map((r) => ({ key: r.kpi_key, name: r.name || keyWords(r.kpi_key), carried: !blank(kpis[r.kpi_key]) }));
}

/**
 * What is missing for one obligation: `{ state, text }`, state 'ok',
 * 'missing', 'not_measured', 'unreadable' or 'loading'. The required set is
 * measured only against an update that speaks for the period: a newer or an
 * older one is not read as this period's.
 */
export function missingFor(reporting, update, compliance, updates) {
  if (reporting.state === 'loading' || updates.state === 'loading') return { state: 'loading' };
  if (reporting.state === 'Unreadable') return { state: 'unreadable', text: UNREADABLE };
  const period = periodName(reporting.period);
  if (reporting.state === 'Not received' || reporting.state === 'Due') {
    return { state: 'missing', text: `The ${period || 'period'} update` };
  }
  if (reporting.state !== 'Received') return { state: 'not_measured', text: NOT_RECORDED };
  if (updates.state !== 'ok') return { state: 'unreadable', text: UNREADABLE };
  const c = compliance.value;
  if (!update || !periodCovers(c.cadence, reporting.period, update.period)) {
    return { state: 'not_measured', text: `Not measured: the latest update readable here is ${update?.period ? `for ${periodName(update.period)}` : 'for no stated period'}` };
  }
  const required = requiredAgainst(c.kpi_set, update);
  if (!required.length) return { state: 'ok', text: 'No KPI is required at this cadence' };
  const gone = required.filter((r) => !r.carried);
  if (!gone.length) return { state: 'ok', text: 'No required KPI missing' };
  return { state: 'missing', text: gone.length === required.length ? `All ${required.length} required KPIs` : gone.map((r) => r.name).join(', ') };
}

/** One company's chases from the chase log, newest first: `{ state, date, count, items }`. */
export function lastChaseOf(projectId, chases) {
  if (chases.state === 'loading') return { state: 'loading' };
  if (chases.state !== 'ok') return { state: 'unreadable' };
  const mine = chases.value.items.filter((x) => Number(x.project_id) === Number(projectId) && x.created_at)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (!mine.length) return { state: 'none', count: 0, items: [] };
  return {
    state: 'ok',
    date: day(mine[0].created_at),
    count: mine.length,
    items: mine.map((x, i) => ({ key: x.uid || `${x.created_at}-${i}`, date: day(x.created_at), by: x.chased_by_name || null })),
  };
}

/**
 * PF-04's obligations inbox: one row per company in the reporting population
 * (`kpi-compliance`'s companies, the caller's book) for the period the Worker
 * measured, companies that have not reported first. A name the reporting read
 * does not carry comes from the positions read. No row carries a due date:
 * the cadence read records none (`NO_DUE_DATE`), so no overdue days are
 * computed.
 */
export function obligationRowsOf(reads) {
  const { compliance, updates, positions, chases } = reads;
  if (compliance.state !== 'ok') return { state: compliance.state, rows: [] };
  const c = compliance.value;
  const posItems = positions.state === 'ok' ? positions.value.items : [];
  const latest = updates.state === 'ok' ? updates.value.items : [];
  const rows = c.companies.map((co) => {
    const pid = Number(co.project_id);
    const pos = posItems.find((p) => Number(p.project_id) === pid) || null;
    const update = latest.find((u) => Number(u.project_id) === pid) || null;
    const reporting = reportingFor({ project_id: pid }, compliance);
    return {
      key: String(pid),
      projectId: pid,
      uid: co.project_uid || pos?.project?.uid || null,
      name: co.name || pos?.project?.name || `Startup ${pid}`,
      period: periodName(reporting.period),
      reporting,
      reported: co.reported === true,
      received: day(co.last_reported_at),
      update,
      missing: missingFor(reporting, update, compliance, updates),
      chase: lastChaseOf(pid, chases),
    };
  }).sort((a, b) => Number(a.reported) - Number(b.reported) || a.name.localeCompare(b.name));
  return {
    state: 'ok',
    rows,
    period: periodName(c.population?.period ?? c.period ?? null),
    cadence: c.cadence || null,
    inProgress: c.period_in_progress === true,
    until: day(c.period_until),
  };
}

/** One recorded figure in its unit (`usd`, `pct`, `months`, `count`); null when there is no number. */
export function figureValue(value, unit) {
  if (!isNum(value)) return null;
  const v = Number(value);
  if (unit === 'usd') return money(v);
  if (unit === 'pct') return `${Math.round(v * 10) / 10}%`;
  if (unit === 'months') return `${Math.round(v * 10) / 10} ${v === 1 ? 'month' : 'months'}`;
  return v.toLocaleString('en-US');
}

const SOURCE_NAMES = { typed: 'Typed by the founder', manual: 'Typed by the founder', stripe: 'Stripe', mercury: 'Mercury' };

/** A figure's stored source in words; null when none is stored. */
export function sourceName(source) {
  const s = String(source ?? '').trim();
  if (!s) return null;
  return SOURCE_NAMES[s.toLowerCase()] || keyWords(s);
}

/**
 * The report detail's fields (PF-04b): each sourced figure the update carries,
 * with its source and date, or the founders' reason it is absent; then each
 * value typed into the update's KPI form that no figure covers, formatted by
 * `format(key, value)`. A blank is Not recorded with its reason, never 0.
 */
export function reportFieldsOf(update, format = (k, v) => String(v)) {
  if (!update) return [];
  const figures = (Array.isArray(update.figures) ? update.figures : []).map((f) => ({
    key: f.key,
    label: f.label || keyWords(f.key),
    value: f.value == null ? null : figureValue(f.value, f.unit),
    reason: f.value == null ? (f.reason || NOT_RECORDED) : null,
    source: f.value == null ? null : sourceName(f.source),
    asOf: f.value == null ? null : day(f.as_of),
  }));
  const covered = new Set(figures.map((f) => f.key));
  const typed = Object.entries(update.kpis && typeof update.kpis === 'object' ? update.kpis : {})
    .filter(([k]) => !covered.has(k))
    .map(([k, v]) => ({
      key: k,
      label: keyWords(k),
      value: blank(v) ? null : format(k, v),
      reason: blank(v) ? 'Left blank in the update' : null,
      source: blank(v) ? null : 'Typed in the update',
      asOf: null,
    }));
  return [...figures, ...typed];
}
