/**
 * D661 (#1474) — the cycle pages' pure rules: the four cycles, the five card
 * states, how a headline figure is written, which chart specs can be drawn,
 * and the records table's query, count and pages. No React and no fetch, so
 * `frontend/test/cycle_pages_d661.test.mjs` holds every rule here.
 *
 * THE READ IS #1469's (D656), one shape for all four cycles:
 *
 *   GET /api/cycles/:cycle/overview?project=:pid
 *   → { cycle, question, figures: [Figure ×4], cards: [Card ×6 or ×7] }
 *   GET /api/cycles/:cycle/modules/:slug?project=:pid&q=&filter=&sort=&page=
 *   → { module, card: Card, records: { cols, rows, total, page, page_size } }
 *
 *   Figure = { key, label, value|null, unit, delta_30d|null, spark, state, source, as_of }
 *   Card   = { slug, name, state, range, caption, series, next|null, reason|null }
 *   state  ∈ ok | empty | too_little | not_recorded | unreadable
 *
 * D656 leaves `Card.series` open. D661 gives it a shape: a list of chart
 * specs drawn top to bottom, one `kind` per helper in the canvas
 * (`CHART_KINDS`). `records.cols` and `records.rows` are given a shape here
 * too. Both are written up in D661.md for the four cycle-read tasks.
 */

/** The four cycles, in the sidebar's order. `question` and `outcome` are the canvas's words. */
export const CYCLES = {
  validate: { key: 'validate', name: 'Validate', question: 'Is this worth building?', outcome: 'Research → Insights → Evidence', action: 'Record a session' },
  build: { key: 'build', name: 'Build', question: 'Can this become a real company?', outcome: 'From Concept → Company', action: 'Connect a tool' },
  raise: { key: 'raise', name: 'Raise', question: 'What resources does this venture need?', outcome: 'From Story → Capital', action: 'Call for Capital' },
  grow: { key: 'grow', name: 'Grow', question: 'How does this venture become larger and more enduring?', outcome: 'From Traction → Impact', action: 'Share an update' },
};

export const CARD_STATES = ['ok', 'empty', 'too_little', 'not_recorded', 'unreadable'];

/** The fewest points a line is drawn through; fewer is `too_little` (D656). */
export const MIN_POINTS = 3;

export function cycleOf(key) {
  return CYCLES[String(key || '').toLowerCase()] || null;
}

/**
 * What a card draws, from its read state. A state the page does not know is
 * treated as unreadable rather than drawn as if it were fine; so is an `ok`
 * card whose series has nothing the page can draw.
 */
export function cardView(card) {
  if (!card) return { state: 'loading' };
  const state = CARD_STATES.includes(card.state) ? card.state : 'unreadable';
  if (state === 'ok') {
    const charts = drawableSeries(card.series);
    if (!charts.length) return { state: 'unreadable', reason: card.reason || 'This card came back with nothing to draw.' };
    return { state, charts };
  }
  const fallback = {
    empty: 'Nothing recorded here yet.',
    too_little: 'Too little data to draw a line yet.',
    not_recorded: 'Not recorded.',
    unreadable: 'This card could not be read.',
  }[state];
  return { state, reason: card.reason || fallback };
}

// ---------- Charts ---------------------------------------------------------

/**
 * Each kind is one helper in `Cycle Overview.dc.html`. A spec names its kind
 * and carries that kind's data; `legend: [{ label, tone }]` is optional on any.
 *
 *   hbar      items: [{ label, value, tone? }], more?: string
 *   vbars     values: number[], labels?: [{ at, label }]
 *   vstack    rows: number[][], tones: string[], labels?: [{ at, label }]
 *   funnel    steps: [{ label, value }]
 *   stack     rows: [{ label, parts: number[] }], tones: string[], bare?: boolean
 *   line      values: number[], target?, target_label?, plan?: number[], mark?: index, mark_label?, labels?: [{ at, label }]
 *   timeline  steps: [{ label, date, done }]
 *   tiles     items: [{ label, state: 'connected' | 'failing' | 'not_connected' }]
 *   dots      values: boolean[], label?
 *   rows      items: [{ label, value, tone? }]
 *   progress  items: [{ label, pct }]
 *   big       value: string, label: string
 *   heat      rows: [{ label, cells: number[] (0–1) }], axis?: string
 *   bands     items: [{ label, value, source? }]   (total, serviceable, obtainable)
 *
 * Tones are names, never colours: v1, v2, v3, grey, ok, warn, bad, muted.
 */
export const CHART_KINDS = ['hbar', 'vbars', 'vstack', 'funnel', 'stack', 'line', 'timeline', 'tiles', 'dots', 'rows', 'progress', 'big', 'heat', 'bands'];

export const TONES = ['v1', 'v2', 'v3', 'grey', 'ok', 'warn', 'bad', 'muted'];

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const arr = (v) => Array.isArray(v) && v.length > 0;

/** Whether a spec carries enough to draw. A line needs MIN_POINTS real values. */
export function drawable(spec) {
  if (!spec || !CHART_KINDS.includes(spec.kind)) return false;
  switch (spec.kind) {
    case 'hbar': case 'rows': return arr(spec.items) && spec.items.some((i) => num(i.value) || (spec.kind === 'rows' && i.value != null));
    case 'funnel': return arr(spec.steps) && num(spec.steps[0]?.value) && spec.steps[0].value > 0;
    case 'vbars': return arr(spec.values) && spec.values.some((v) => num(v) && v > 0);
    case 'vstack': return arr(spec.rows) && spec.rows.some((r) => Array.isArray(r) && r.some((v) => num(v) && v > 0));
    case 'stack': return arr(spec.rows) && spec.rows.some((r) => Array.isArray(r.parts) && r.parts.some((v) => num(v) && v > 0));
    case 'line': return Array.isArray(spec.values) && spec.values.filter(num).length >= MIN_POINTS;
    case 'timeline': return arr(spec.steps) && spec.steps.length >= 2;
    case 'tiles': case 'progress': case 'bands': return arr(spec.items);
    case 'dots': return arr(spec.values);
    case 'big': return spec.value != null && spec.value !== '';
    case 'heat': return arr(spec.rows);
    default: return false;
  }
}

/** The specs in a series the page can draw, in order. */
export function drawableSeries(series) {
  return (Array.isArray(series) ? series : []).filter(drawable);
}

/** The largest value, so a bar's width is a share of it; 0 when there is none. */
export function maxOf(values) {
  const v = (values || []).filter(num);
  return v.length ? Math.max(...v) : 0;
}

/** A width in [min, full] for `value` out of `max`; a missing value draws nothing. */
export function share(value, max, full, min = 0) {
  if (!num(value) || !num(max) || max <= 0) return 0;
  return Math.max(min, (full * value) / max);
}

/**
 * Points for a polyline across `width`, leaving gaps where a value is
 * missing: a missing month is not a zero, so the line breaks there.
 * Returns segments of "x,y" points.
 */
export function lineSegments(values, { x0 = 30, width = 480, y0 = 104, height = 94, max } = {}) {
  const n = (values || []).length;
  if (n < 2) return [];
  const top = max ?? maxOf(values) * 1.1;
  if (!top) return [];
  const segs = [];
  let cur = [];
  values.forEach((v, i) => {
    if (!num(v)) { if (cur.length) segs.push(cur); cur = []; return; }
    const x = x0 + (i * width) / (n - 1);
    const y = y0 - (height * v) / top;
    cur.push(`${round(x)},${round(y)}`);
  });
  if (cur.length) segs.push(cur);
  return segs;
}

const round = (n) => Math.round(n * 10) / 10;

// ---------- Figures --------------------------------------------------------

const compact = (n) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${trim(n / 1e9)}B`;
  if (a >= 1e6) return `${trim(n / 1e6)}M`;
  if (a >= 1e4) return `${trim(n / 1e3)}k`;
  return n.toLocaleString('en-US');
};
const trim = (n) => (Math.round(n * 10) / 10).toString();

/**
 * A figure's value with its unit. `usd` is compact ($38.4k), `pct` a percent,
 * `days`, `months` and `count` plain numbers, and `of` a pair ([11, 18] → "11 of 18").
 * Null is never a number: it is "Not recorded".
 */
export function figureValue(fig) {
  const v = fig?.value;
  if (v == null || fig?.state === 'not_recorded' || fig?.state === 'unreadable') return null;
  const unit = fig.unit || 'count';
  if (unit === 'of' && Array.isArray(v) && v.length === 2 && v.every(num)) return `${v[0].toLocaleString('en-US')} of ${v[1].toLocaleString('en-US')}`;
  if (!num(v)) return null;
  if (unit === 'usd') return `$${compact(v)}`;
  if (unit === 'pct') return `${trim(v)}%`;
  if (unit === 'score') return `${v} / 100`;
  return v.toLocaleString('en-US');
}

/** "▲ 4 in 30 days", "▼ 1 in 30 days", "no change in 30 days"; null when not recorded. */
export function figureDelta(fig) {
  const d = fig?.delta_30d;
  if (!num(d)) return null;
  if (d === 0) return 'no change in 30 days';
  const unit = fig.unit === 'usd' ? `$${compact(Math.abs(d))}` : fig.unit === 'pct' ? `${trim(Math.abs(d))} pts` : Math.abs(d).toLocaleString('en-US');
  return `${d > 0 ? '▲' : '▼'} ${unit} in 30 days`;
}

/** A sparkline is drawn through MIN_POINTS or more real values only. */
export function sparkDrawable(spark) {
  return Array.isArray(spark) && spark.filter(num).length >= MIN_POINTS;
}

// ---------- The module page ------------------------------------------------

export const PAGE_SIZE_DEFAULT = 25;

/** The query a module read takes, from the page's controls. Empty parts are left out. */
export function moduleQuery({ project, q = '', filter = {}, sort = '', page = 1 } = {}) {
  const p = new URLSearchParams();
  if (project != null && project !== '') p.set('project', String(project));
  if (q.trim()) p.set('q', q.trim());
  const f = Object.entries(filter || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}:${v}`);
  if (f.length) p.set('filter', f.join(','));
  if (sort) p.set('sort', sort);
  if (page > 1) p.set('page', String(page));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** "1–25 of 112" and the pages around the current one. */
export function recordsCount(records) {
  const total = num(records?.total) ? records.total : null;
  const size = num(records?.page_size) && records.page_size > 0 ? records.page_size : PAGE_SIZE_DEFAULT;
  const page = num(records?.page) && records.page > 0 ? records.page : 1;
  const shown = Array.isArray(records?.rows) ? records.rows.length : 0;
  if (total === null) return { label: shown ? `${shown} shown · total not recorded` : 'Not recorded', page, pages: page, size };
  const pages = Math.max(1, Math.ceil(total / size));
  if (!total) return { label: '0 of 0', page: 1, pages: 1, size };
  const from = (page - 1) * size + 1;
  const to = Math.min(total, from + shown - 1);
  return { label: `${from}–${Math.max(from, to)} of ${total.toLocaleString('en-US')}`, page, pages, size };
}

/** The page buttons: first, last, and two either side of the current page. */
export function pageButtons(page, pages) {
  const out = [];
  for (let i = 1; i <= pages; i += 1) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 2) out.push(i);
    else if (out[out.length - 1] !== '…') out.push('…');
  }
  return out;
}

/**
 * A cell as the table writes it. Rows are `{ id, cells: { [colKey]: Cell } }`
 * and a Cell is a string, a number, null, or `{ text, tone?, href? }`.
 * Null and a missing key are "Not recorded", never blank and never 0.
 */
export function cellView(cell) {
  if (cell == null || cell === '') return { text: 'Not recorded', nr: true };
  if (typeof cell === 'number') return { text: cell.toLocaleString('en-US') };
  if (typeof cell === 'string') return { text: cell };
  if (cell.text == null || cell.text === '') return { text: 'Not recorded', nr: true };
  return { text: String(cell.text), tone: TONES.includes(cell.tone) ? cell.tone : null, href: safeHref(cell.href) };
}

/** Only in-app paths are linked from a read; anything else is drawn as text. */
export function safeHref(href) {
  return typeof href === 'string' && /^\/(?!\/)/.test(href) ? href : null;
}

/**
 * The overview's tabs: Overview, then each card in the read's order, each with
 * its path. `search` (`?project_id=7`) rides on every path, so moving between
 * tabs keeps the venture a founder chose; anything not starting `?` is dropped.
 */
export function cycleTabs(cycle, cards, active = null, search = '') {
  const base = `/${cycle}`;
  const s = linkSearch(search);
  return [{ key: '', name: 'Overview', href: `${base}${s}`, active: !active }]
    .concat((cards || []).filter((c) => c?.slug).map((c) => ({ key: c.slug, name: c.name || c.slug, href: `${base}/${c.slug}${s}`, active: active === c.slug })));
}

/** A query string a link may carry: `?…`, or nothing. */
export function linkSearch(search) {
  return typeof search === 'string' && /^\?[^#]*$/.test(search) && search.length > 1 ? search : '';
}
