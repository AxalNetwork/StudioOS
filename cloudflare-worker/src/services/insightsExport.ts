/**
 * D893 (#2661) — the Insights export: the figures of `GET /api/admin/insights`
 * (#2660) as a counts-only CSV or PDF.
 *
 * ONE SOURCE. The file is built from the read's own response, so the export
 * and the page cannot disagree. This module never queries a table.
 *
 * COUNTS ONLY, BY AN ALLOW-LIST. Each block's figures are named one by one
 * below (`pageRows`, `groupRows`). A field the read gains later reaches no
 * file until it is listed here. A label (a profile, a tier, a country, a week,
 * a band, a status) is kept only when it reads as a label; anything else
 * becomes "(other)". Then `refusesCountsOnly` scans the finished file for an
 * email, and the route refuses to hand it out if one is found.
 *
 * UNKNOWN IS NOT ZERO. A block the read could not read, or that nothing
 * records, is one row saying so ("Unreadable: …" or "Not recorded: …"),
 * never a 0.
 */

export type InsightsWhat = 'page' | 'group';
export type InsightsFormat = 'csv' | 'pdf';
export const INSIGHTS_WHAT: readonly InsightsWhat[] = ['page', 'group'];
export const INSIGHTS_FORMATS: readonly InsightsFormat[] = ['csv', 'pdf'];
export const INSIGHTS_RANGES = ['8w', 'quarter', 'year'] as const;

/** One figure: a section, what it counts, an optional label (a profile, a week…), and its value. */
export interface InsightsRow { section: string; figure: string; label: string; value: string }

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A count or a rate: a finite number, else blank. */
const num = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** A label as a label: letters, digits, spaces and light punctuation, at most 60 characters, no "@". */
const LABEL = /^[\p{L}\p{N} .,'()&/:+–_-]{1,60}$/u;
export const label = (v: unknown): string => {
  const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
  return s && LABEL.test(s) && !s.includes('@') ? s : '(other)';
};

/** A block the read could not fill, as one row; null when the block is available. */
function absent(section: string, block: unknown): InsightsRow | null {
  const b = obj(block);
  if (!b) return { section, figure: 'status', label: '', value: 'Not recorded' };
  if (b.unreadable === true) return { section, figure: 'status', label: '', value: `Unreadable: ${reasonOf(b)}` };
  if (b.recorded === false) return { section, figure: 'status', label: '', value: `Not recorded: ${reasonOf(b)}` };
  return null;
}
const reasonOf = (b: Obj) => (typeof b.reason === 'string' ? b.reason.replace(/[\r\n]+/g, ' ').slice(0, 200) : 'no reason given');

function section(rows: InsightsRow[], name: string, block: unknown, fill: (b: Obj, add: (figure: string, value: unknown, lab?: unknown) => void) => void) {
  const missing = absent(name, block);
  if (missing) { rows.push(missing); return; }
  fill(obj(block)!, (figure, value, lab) => rows.push({ section: name, figure, label: lab === undefined ? '' : label(lab), value: num(value) }));
}

/** A sub-figure that may itself be missing (the read's `{ recorded: false }` inside a block). */
function countOrAbsent(rows: InsightsRow[], name: string, figure: string, v: unknown) {
  const o = obj(v);
  if (o) {
    const missing = absent(name, o);
    rows.push(missing ? { ...missing, figure } : { section: name, figure, label: '', value: num(o.count) });
  } else rows.push({ section: name, figure, label: '', value: num(v) });
}

/** "Figures on this page": the KPIs and every block, in the page's order. */
export function pageRows(read: unknown): InsightsRow[] {
  const r = obj(read) ?? {};
  const k = obj(r.kpis) ?? {};
  const b = obj(r.blocks) ?? {};
  const rows: InsightsRow[] = [];
  section(rows, 'Accounts', k.accounts, (x, add) => { add('total', x.total); add('new in 30 days', x.new_30d); add('deactivated', x.deactivated); });
  section(rows, 'New this week', k.new_this_week, (x, add) => { add('count', x.count); add('last week', x.last_week); });
  section(rows, 'Active last week', k.active_last_week, (x, add) => { add('value', x.value); add('week before', x.week_before); });
  section(rows, 'Activated', k.activated, (x, add) => { add('rate %', x.rate_pct); add('cohorts counted', x.cohorts_counted); });
  section(rows, 'Who', b.who, (x, add) => {
    add('total', x.total);
    for (const p of arr(x.by_profile)) add('accounts', obj(p)?.count, obj(p)?.profile);
    add('LPs', x.lps);
  });
  if (obj(b.who)) countOrAbsent(rows, 'Who', 'product testers', obj(b.who)!.product_testers);
  section(rows, 'Plan', b.plan, (x, add) => {
    for (const t of arr(x.by_tier)) add('accounts', obj(t)?.count, obj(t)?.tier);
    add('paid', x.paid); add('paid %', x.paid_pct);
  });
  section(rows, 'Growth', b.growth, (x, add) => {
    for (const w of arr(x.weeks)) {
      const wk = obj(w) ?? {};
      add('sign-ups', wk.total, wk.week); add('to date', wk.to_date, wk.week);
      for (const [p, n] of Object.entries(obj(wk.by_profile) ?? {})) add(`sign-ups · ${label(p)}`, n, wk.week);
    }
  });
  section(rows, 'Activity', b.activity, (x, add) => {
    const weeks = arr(r.weeks);
    arr(x.values).forEach((v, i) => add('active accounts', v, weeks[i] ?? i + 1));
    arr(x.previous).forEach((v, i) => add('active accounts · previous period', v, i + 1));
  });
  section(rows, 'Retention', b.retention, (x, add) => {
    for (const c of arr(x.cohorts)) { const co = obj(c) ?? {}; add('sign-ups', co.signups, co.week); add('retained 30 days', co.retained_30d, co.week); }
  });
  section(rows, 'Countries', b.countries, (x, add) => {
    for (const c of arr(x.rows)) add('accounts', obj(c)?.count, obj(c)?.country);
    add('not stated', x.not_stated);
  });
  section(rows, 'Identity checks', b.identity, (x, add) => {
    add('not started', x.not_started); add('waiting', x.pending); add('approved', x.approved); add('rejected', x.rejected);
  });
  section(rows, 'Profile completeness', b.completeness, (x, add) => { for (const c of arr(x.bands)) add('accounts', obj(c)?.count, obj(c)?.band); });
  section(rows, 'Dormant', b.dormant, (x, add) => { add('count', x.count); add('last month', x.last_month); });
  section(rows, 'Tickets', b.tickets, (x, add) => {
    add('open', x.open);
    const by = x.by_status;
    if (Array.isArray(by)) for (const s of by) add('tickets', obj(s)?.count, obj(s)?.status);
    else for (const [s, n] of Object.entries(obj(by) ?? {})) add('tickets', n, s);
  });
  section(rows, 'AI spend this month', b.spend, (x, add) => {
    add('USD', x.usd); add('calls', x.calls);
    for (const p of arr(x.by_profile)) { const po = obj(p) ?? {}; add('USD', po.usd, po.profile); add('calls', po.calls, po.profile); }
  });
  return rows;
}

/** "This group only": the group lightbox (INS3). Null when the read carries no group. */
export function groupRows(read: unknown): InsightsRow[] | null {
  const g = obj(obj(read)?.group);
  if (!g) return null;
  const rows: InsightsRow[] = [];
  section(rows, 'Group', g, (x, add) => {
    add('accounts', x.count); add('new in 30 days', x.new_30d); add('active last week', x.active_last_week);
    add('activated %', x.activated_pct); add('dormant', x.dormant);
    const weeks = arr(obj(read)!.weeks);
    arr(x.signups_by_week).forEach((v, i) => add('sign-ups', obj(v) ? obj(v)!.count : v, obj(v)?.week ?? weeks[i] ?? i + 1));
    arr(x.active_by_week).forEach((v, i) => add('active accounts', obj(v) ? obj(v)!.count : v, obj(v)?.week ?? weeks[i] ?? i + 1));
    for (const c of arr(x.by_country)) {
      const co = obj(c) ?? {};
      add('accounts', co.accounts, co.country); add('new in 30 days', co.new_30d, co.country); add('active last week', co.active_last_week, co.country);
    }
  });
  return rows;
}

/** What the file's header says: the range and filters, as the dialog shows them. */
export interface InsightsMeta { what: InsightsWhat; rangeLabel: string; asOf: string; scope: string; filters: Record<string, string | null> }

export function metaOf(read: unknown, what: InsightsWhat, filters: Record<string, string | null>): InsightsMeta {
  const r = obj(read) ?? {};
  const weeks = arr(r.weeks).filter((w): w is string => typeof w === 'string');
  const span = weeks.length ? ` · ${label(weeks[0])} to ${label(weeks[weeks.length - 1])}` : '';
  return {
    what,
    rangeLabel: `${label(r.range ?? filters.range ?? '8w')}${span}`,
    asOf: label(r.as_of ?? ''),
    scope: label(obj(r.scope)?.label ?? ''),
    filters: Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, v == null ? null : label(v)])),
  };
}

/**
 * A cell, quoted for CSV, with a leading formula character neutralised. No
 * cell the export builds starts with one today (labels and filters refuse them);
 * this holds if a later field ever does.
 */
export function cell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) && !/^-?\d/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: InsightsRow[], meta: InsightsMeta): string {
  const head = [
    ['Axal Insights', meta.what === 'group' ? 'This group only' : 'Figures on this page'],
    ['Range', meta.rangeLabel], ['As of', meta.asOf], ['Scope', meta.scope],
    ...Object.entries(meta.filters).filter(([, v]) => v != null).map(([k, v]) => [`Filter: ${k}`, v as string]),
    ['Counts only', 'This file holds counts only, never names or emails.'],
    [],
    ['section', 'figure', 'label', 'value'],
  ];
  return [...head, ...rows.map((r) => [r.section, r.figure, r.label, r.value])]
    .map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n';
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** The PDF's HTML: one table per section. Browser Run renders it; without it, the HTML is the artifact. */
export function toHtml(rows: InsightsRow[], meta: InsightsMeta): string {
  const sections = [...new Set(rows.map((r) => r.section))];
  const tables = sections.map((s) => `<h2>${esc(s)}</h2><table><thead><tr><th>Figure</th><th>Label</th><th>Value</th></tr></thead><tbody>${
    rows.filter((r) => r.section === s).map((r) => `<tr><td>${esc(r.figure)}</td><td>${esc(r.label)}</td><td>${esc(r.value)}</td></tr>`).join('')
  }</tbody></table>`).join('');
  const filters = Object.entries(meta.filters).filter(([, v]) => v != null).map(([k, v]) => `${esc(k)}: ${esc(v as string)}`).join(' · ');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Axal Insights</title><style>
body{font-family:system-ui,sans-serif;font-size:11px;color:#111;margin:24px}h1{font-size:18px}h2{font-size:13px;margin:18px 0 6px}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ddd;padding:3px 6px;text-align:left}td:last-child,th:last-child{text-align:right}
.meta{color:#555}</style></head><body><h1>Axal Insights — ${meta.what === 'group' ? 'This group only' : 'Figures on this page'}</h1>
<p class="meta">${esc(meta.rangeLabel)} · as of ${esc(meta.asOf)} · ${esc(meta.scope)}${filters ? ` · ${filters}` : ''}</p>
<p class="meta">This file holds counts only, never names or emails.</p>${tables}</body></html>`;
}

/** True when a finished file still carries an email: the route then refuses it. */
export function refusesCountsOnly(text: string): boolean {
  return /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/u.test(text);
}
