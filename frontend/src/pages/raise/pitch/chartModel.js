/**
 * D898 group C (#2676) — the bound charts' pure rules (PD9, PD9b, PD9c). No
 * React here, so `node --test` loads it alone.
 *
 * A CHART PLOTS BOUND SERIES ONLY: each series is one of
 * `GET /api/decks/chart-series`'s, stored on the block as its binding (D896's
 * five fields). Nothing is typed into the deck: "To chart a new figure, record
 * it in its module first."
 *
 * WHAT IS DRAWN. A bound series draws its points up to the binding's `as_of`,
 * never a later month: that is Keep as of, and it is also what a saved version
 * shows. Refresh moves the binding to the store's newest snapshot (the chip
 * changes with it), and Save writes it. The range then keeps 3, 6 or 12 months
 * back from today's month, or everything. A month with no point is left out,
 * never drawn as 0.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';

export { NOT_RECORDED };

export const RANGE_LABELS = { '3m': 'Last 3 months', '6m': 'Last 6 months', '12m': 'Last 12 months', all: 'Since first record' };
export const RANGES = ['12m', '6m', '3m', 'all'];
export const ONLY_BOUND = 'Only bound series. To chart a new figure, record it in its module first.';
export const TYPE_NOTE = 'Types your series cannot fill are greyed. The source chip stays under whichever type you pick.';
export const NO_SERIES = 'Nothing is recorded that a chart can plot yet. Record a figure in Grow or Validate first.';
export const SERIES_FAILED = 'The series a chart can plot could not be read.';
export const OTHER_UNIT = 'A different unit from the series already chosen.';
export const UNBOUND = 'Not a dated series: shown as it was placed.';
export const CADENCE_WORD = { monthly: 'monthly', weekly: 'weekly' };

/** The series by key, from the chart-series read; an empty map while it loads or when it failed. */
export function seriesIndex(read) {
  const list = read?.status === 'ok' && Array.isArray(read.data?.series) ? read.data.series : [];
  return new Map(list.map((s) => [s.key, s]));
}

/** The library's types, from the read, each with its fit and reason; null while it loads or when it failed. */
export const typesOf = (read) => (read?.status === 'ok' && Array.isArray(read.data?.types) ? read.data.types : null);

/** A series' binding: D896's five fields. */
export const bindingOf = (s) => ({ source_key: s.key, record_ref: s.record_ref ?? null, as_of: s.as_of ?? null, grade: s.grade ?? null, snapshot_hash: s.snapshot_hash ?? null });

/** The first month a range keeps, as `YYYY-MM-01`, counted back from `today`'s month; null for everything. */
export function rangeStart(range, today) {
  const months = range === '3m' ? 3 : range === '6m' ? 6 : range === '12m' ? 12 : null;
  if (!months) return null;
  const t = new Date(`${String(today).slice(0, 10)}T00:00:00Z`);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - months + 1, 1)).toISOString().slice(0, 10);
}

/**
 * One bound series' points as the chart draws them: up to the binding's
 * `as_of` (Keep as of), in the range. A monthly point is `YYYY-MM`, a weekly
 * one `YYYY-MM-DD`; each is compared at its own length.
 */
export function pointsFor(series, binding, range, today) {
  const pts = Array.isArray(series?.points) ? series.points : [];
  const asOf = typeof binding?.as_of === 'string' ? binding.as_of.slice(0, 10) : null;
  const from = rangeStart(range, today);
  return pts.filter((p) => (!asOf || p.x <= asOf.slice(0, p.x.length)) && (!from || p.x >= from.slice(0, p.x.length)));
}

/** "Changed since 30 Sep": the store has a newer snapshot than the binding. */
export function seriesChanged(series, binding) {
  if (!series || series.state !== 'recorded' || !binding) return false;
  return (binding.snapshot_hash ?? null) !== (series.snapshot_hash ?? null);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-09" → "Sep 2026"; "2026-10-05" → "5 Oct". */
export function pointLabel(x) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(x || ''));
  if (!m) return String(x || '');
  return m[3] ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
export const dayWord = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : null;
};

const money = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
/** A value in its unit; a missing one is Not recorded, never 0. */
export function valueWord(v, unit) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return NOT_RECORDED;
  if (unit === 'usd') return money(v);
  if (unit === 'cents') return money(v / 100);
  if (unit === 'percent') return `${Math.round(v * 10) / 10}%`;
  if (unit === 'months') return `${Math.round(v * 10) / 10} months`;
  return Math.round(v).toLocaleString('en-US');
}

/** The chip under a chart, one per series: its source, module, as of and grade (always on). */
export function chipOf(series, binding) {
  const asOf = dayWord(binding?.as_of) || 'date not recorded';
  return {
    key: binding?.source_key || series?.key,
    text: `${series?.source || NOT_RECORDED} · ${series?.module || binding?.source_key || ''} · ${asOf} · ${binding?.grade || series?.grade || NOT_RECORDED}`,
    typed: series?.source === 'Typed',
  };
}

/**
 * What a chart block draws, in `ui/Charts.jsx`'s shapes: `{ state, chart,
 * alt, chips, rows }`. `state` is `ready`, `empty` (no point in its range),
 * `unbound` (a series the catalogue does not plot, from before this group)
 * or `loading`/`unreadable` from the read.
 */
export function chartView(block, read, today) {
  if (read?.status === 'loading' || read?.status === 'idle' || !read) return { state: 'loading' };
  if (read.status === 'error') return { state: 'unreadable' };
  const index = seriesIndex(read);
  const bound = (Array.isArray(block?.series) ? block.series : []).map((s) => ({ s, cur: index.get(s?.binding?.source_key) || null }));
  if (!bound.length || bound.some((b) => !b.cur)) return { state: 'unbound' };
  const lines = bound.map(({ s, cur }) => ({ label: s.label || cur.label, unit: cur.unit, points: pointsFor(cur, s.binding, block.range || 'all', today), chip: chipOf(cur, s.binding) }));
  const chips = lines.map((l) => l.chip);
  if (lines.every((l) => !l.points.length)) return { state: 'empty', chips };
  const xs = [...new Set(lines.flatMap((l) => l.points.map((p) => p.x)))].sort();
  const at = (l, x) => { const p = l.points.find((q) => q.x === x); return p ? p.y : null; };
  const labels = xs.map(pointLabel);
  const unit = lines[0].unit;
  const last = (l) => (l.points.length ? l.points[l.points.length - 1].y : null);
  const alt = `${lines.map((l) => `${l.label}: ${l.points.map((p) => `${pointLabel(p.x)} ${valueWord(p.y, l.unit)}`).join(', ')}`).join('. ')}.`;
  const rows = xs.map((x) => [pointLabel(x), ...lines.map((l) => valueWord(at(l, x), l.unit))]);
  const type = block.chart_type || 'line';
  let chart;
  if (type === 'line') {
    chart = lines.length === 1
      ? { type: 'line', values: xs.map((x) => at(lines[0], x)), labels, previous: block.previous ? previousOf(index.get(bound[0].s.binding.source_key), bound[0].s.binding, block.range, today, xs.length) : null }
      : { type: 'lines', labels, series: lines.map((l) => ({ label: l.label, values: xs.map((x) => at(l, x)) })) };
  } else if (type === 'columns') {
    chart = lines.length === 1
      ? { type: 'columns', rows: lines[0].points.map((p) => ({ label: pointLabel(p.x), value: p.y, text: valueWord(p.y, unit) })) }
      : { type: 'grouped', rows: xs.map((x, i) => ({ label: labels[i], values: lines.map((l) => at(l, x)) })), series: lines.map((l) => ({ label: l.label })) };
  } else if (type === 'stacked') {
    // Only the periods every series has: a missing part is never drawn as 0.
    const both = xs.filter((x) => lines.every((l) => at(l, x) != null));
    if (!both.length) return { state: 'empty', chips };
    chart = { type: 'columns', rows: both.map((x) => ({ label: pointLabel(x), parts: lines.map((l, k) => ({ label: l.label, value: at(l, x), tone: TONES[k % TONES.length] })) })) };
  } else if (type === 'percent_bar') {
    chart = { type: 'bar100', parts: lines.filter((l) => last(l) != null).map((l, k) => ({ label: l.label, value: last(l), tone: TONES[k % TONES.length] })) };
  } else if (type === 'waterfall') {
    const pts = lines[0].points;
    chart = { type: 'columns', rows: pts.slice(1).map((p, i) => { const d = p.y - pts[i].y; return { label: pointLabel(p.x), value: Math.max(d, 0), below: Math.max(-d, 0) }; }) };
  } else if (type === 'metric_tiles') {
    chart = { type: 'tiles', tiles: lines.map((l) => ({ label: l.label, value: valueWord(last(l), l.unit), chip: l.chip })) };
  } else {
    return { state: 'unfit', chips };
  }
  return { state: 'ready', chart, alt, chips, rows, head: ['', ...lines.map((l) => l.label)], labelLast: block.labels !== false ? lines.map((l) => `${l.label} ${valueWord(last(l), l.unit)}`) : [] };
}
const TONES = ['violet', 'sky', 'amber', 'emerald', 'muted'];

/** The period before the range, as many points as the range, dotted under a single line. */
function previousOf(series, binding, range, today, n) {
  const from = rangeStart(range, today);
  if (!from) return null;
  const before = (series?.points || []).filter((p) => p.x < from.slice(0, p.x.length) && (!binding?.as_of || p.x <= binding.as_of.slice(0, p.x.length)));
  if (!before.length) return null;
  const tail = before.slice(-n).map((p) => p.y);
  return [...Array(Math.max(0, n - tail.length)).fill(null), ...tail];
}

/** The series the library offers: recorded ones, each with whether it can join the ones already chosen. */
export function seriesChoices(read, chosenKeys = []) {
  const index = seriesIndex(read);
  const unit = chosenKeys.length ? index.get(chosenKeys[0])?.unit : null;
  return [...index.values()].filter((s) => s.state === 'recorded' && s.points?.length).map((s) => ({
    ...s, chosen: chosenKeys.includes(s.key), blocked: !chosenKeys.includes(s.key) && unit != null && s.unit !== unit ? OTHER_UNIT : null,
  }));
}

/**
 * Which types the chosen series can draw (PD9c's popover): the catalogue's
 * reason for a type no series fills, else the chosen series' own limits.
 */
export function typeChoices(read, chosenKeys = []) {
  const types = typesOf(read) || [];
  const index = seriesIndex(read);
  const chosen = chosenKeys.map((k) => index.get(k)).filter(Boolean);
  const trend = chosen.length > 0 && chosen.every((s) => (s.points?.length || 0) >= 2);
  return types.map((t) => {
    let reason = t.fits ? null : t.reason;
    if (!reason && chosen.length) {
      if ((t.type === 'line' || t.type === 'columns' || t.type === 'waterfall') && !trend) reason = 'Needs a series with two or more points.';
      if ((t.type === 'stacked' || t.type === 'percent_bar') && chosen.length < 2) reason = 'Needs two series in the same unit.';
      if (t.type === 'waterfall' && chosen.length > 1) reason = 'Draws one series.';
    }
    return { ...t, disabled: Boolean(reason), reason };
  });
}

/** A new chart block's body, bound to the chosen series. */
export function chartBlock({ type, keys, range = '12m', previous = false, labels = true }, read) {
  const index = seriesIndex(read);
  const series = keys.map((k) => index.get(k)).filter(Boolean).map((s) => ({ label: s.label, binding: bindingOf(s) }));
  return { kind: 'chart', chart_type: type, series, range, previous: Boolean(previous) && series.length === 1 && type === 'line', labels: labels !== false };
}

/** Refresh one series: its binding moves to the store's newest snapshot. */
export function refreshSeries(block, i, read) {
  const s = seriesIndex(read).get(block?.series?.[i]?.binding?.source_key);
  if (!s || s.state !== 'recorded') return block;
  return { ...block, series: block.series.map((x, j) => (j === i ? { ...x, binding: bindingOf(s) } : x)) };
}

/** The other chart blocks in the deck, to reuse (PD9b): card, block id and type. */
export function chartsInDeck(cards) {
  const out = [];
  (Array.isArray(cards) ? cards : []).forEach((c, i) => (Array.isArray(c?.blocks) ? c.blocks : []).forEach((b) => {
    if (b?.kind === 'chart' && Array.isArray(b.series) && b.series.length) out.push({ card: i, id: b.id, type: b.chart_type, block: b, label: `Card ${i + 1} · ${b.series.map((s) => s.label).filter(Boolean).join(', ') || b.chart_type}` });
  }));
  return out;
}
