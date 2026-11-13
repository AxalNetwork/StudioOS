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

import { NOT_RECORDED } from '../../lib/absence';

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
const STALE_MARK_DAYS = 183; // two quarters
const RUNWAY_FLOOR = 6;

/** The founder's latest reported runway for a company, from `/api/portfolio-updates/latest`. */
function runwayFor(position, updates) {
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
  if (position.mark_unavailable) lines.push({ label: name, text: `${position.mark_unavailable} · carried at cost`, weight: 2 });
  else if (position.unmarked) lines.push({ label: name, text: `No mark recorded · carried at cost ${money(position.total_invested) || ''}`.trim(), weight: 1 });
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
      return {
        key: String(p.project_id),
        uid: p.project?.uid || null,
        name: nameOf(p),
        sector: p.project?.sector || null,
        stage: p.project?.stage || null,
        invested: money(p.total_invested),
        investedRaw: Number(p.total_invested) || 0,
        fmv: p.unmarked || p.mark_unavailable ? null : money(p.fmv),
        markDate: p.mark_as_of ? day(p.mark_as_of) : null,
        atCost: p.unmarked || p.mark_unavailable ? money(p.total_invested) : null,
        markReason: p.mark_unavailable || null,
        ownership: percent(p.latest_ownership_pct),
        moic: multiple(p.multiple),
        moicAtCost: Boolean(p.unmarked || p.mark_unavailable),
        below: isNum(p.multiple) && Number(p.multiple) < 1,
        reporting: r,
        health: h,
        lastUpdate: r.last ? day(r.last) : null,
      };
    })
    .sort((a, b) => HEALTH.indexOf(a.health.state) - HEALTH.indexOf(b.health.state) || b.investedRaw - a.investedRaw || a.name.localeCompare(b.name));
}

/** Filter the table by a search string and a health state ('all' for every row). */
export function filterRows(rows, { query = '', health = 'all' } = {}) {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => (!q || r.name.toLowerCase().includes(q) || String(r.sector || '').toLowerCase().includes(q))
    && (health === 'all' || r.health.state === health));
}
