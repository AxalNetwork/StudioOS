/**
 * D6124 (#6124) — the CSV a writer downloads from four Grow module tables:
 * Team expansion's roles, Partner network's partners, Market expansion's
 * markets and Durable company-building's obligations.
 *
 * The file holds the table's own columns, then `Source` (the module's store)
 * and `As of` (the day it was written), over every row the table's search,
 * filters and sort select — not one page of them. A missing value is an empty
 * cell, never 0. No row here carries a person's name beyond what the table
 * shows: a role is counted applicants, never who applied, and a market is its
 * name, without the update-ask replies (and their senders) the page draws
 * beside it.
 *
 * A typed cell a spreadsheet would run as a formula (one starting `=`, `+`,
 * `-`, `@`, a tab or a carriage return, and not a plain number) is prefixed
 * with an apostrophe, as the cap table's export does (D1020).
 *
 * D6103 (#6103) adds two more: Product improvement's Feedback and Revenue and
 * traction's KPIs with their monthly history (`FEEDBACK_KPI_SLUGS`, below).
 * Their files are built from the same shaped rows by `feedbackCsv` and
 * `kpiCsv`, are capped at `GROW_EXPORT_ROW_CAP` rows (past it the route
 * refuses with `exportCapSentence`), and every field goes through `csv.ts`
 * `csvSafe`. The customer's name is a column only for a writer and an email
 * never is (D6103).
 */
import { toCsv, toSafeCsv } from './csv';
import type { KpiRow } from './growKpis';
import { toMajorString } from '../../../frontend/src/lib/money.js';

type Row = Record<string, unknown>;

export const GROW_EXPORT_SLUGS = ['team-expansion', 'partner-network', 'market-expansion', 'durable-company-building'] as const;
export type GrowExportSlug = typeof GROW_EXPORT_SLUGS[number];
export const isGrowExportSlug = (slug: string): slug is GrowExportSlug => (GROW_EXPORT_SLUGS as readonly string[]).includes(slug);

/** `not_set_up` → `Not set up`: the label the table draws for a stored word. */
export function wordOf(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/** A typed value, with a leading formula character neutralised. */
export function text(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
}
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** Partner revenue is stored in USD cents (the table draws it as USD); `lib/money.js` writes the major units. */
const dollars = (cents: unknown): string | null => (typeof cents === 'number' && Number.isSafeInteger(cents) ? toMajorString(cents, 'USD') : null);
const day = (v: unknown): string | null => (typeof v === 'string' && v ? v.slice(0, 10) : null);

const COLUMNS: Record<GrowExportSlug, { header: string[]; cells: (r: Row) => unknown[] }> = {
  'team-expansion': {
    header: ['Role', 'Team', 'Applicants', 'In interview', 'Target start'],
    cells: (r) => [text(r.title), text(r.team), count(r.applicants), count(r.in_interview), day(r.target_start)],
  },
  'partner-network': {
    header: ['Partner', 'Type', 'Stage', 'Terms', 'Revenue sourced (USD)'],
    cells: (r) => [text(r.name), wordOf(r.type), wordOf(r.stage), text(r.terms), dollars(r.revenue_cents)],
  },
  'market-expansion': {
    header: ['Market', 'State', 'Readiness (of 40)', 'Weakest part', 'Decision', 'Decided on'],
    cells: (r) => [text(r.name), wordOf(r.state), count(r.readiness), text(r.weakest_part), wordOf(r.decision), day(r.decided_on)],
  },
  'durable-company-building': {
    header: ['Obligation', 'Kind', 'Due', 'Owner', 'State'],
    cells: (r) => [text(r.title), wordOf(r.kind), day(r.due_at), text(r.owner_name), wordOf(r.status)],
  },
};

/** The file: the table's columns, then `Source` and `As of`, one line per row. */
export function growExportCsv(slug: GrowExportSlug, rows: readonly Row[], source: string, asOf: string): string {
  const { header, cells } = COLUMNS[slug];
  return toCsv([...header, 'Source', 'As of'], rows.map((r) => [...cells(r), source, asOf]));
}

// ---------------------------------------------------------------- D6103: Feedback and KPI history

/** D6103: the modules whose file is Feedback or KPI history, not the table's own columns. */
export const FEEDBACK_KPI_SLUGS = ['product-improvement', 'revenue-and-traction'] as const;
export type FeedbackKpiSlug = typeof FEEDBACK_KPI_SLUGS[number];
export const isFeedbackKpiSlug = (s: string): s is FeedbackKpiSlug => (FEEDBACK_KPI_SLUGS as readonly string[]).includes(s);
/** Every Grow module with an Export: D6124's four tables and D6103's two. */
export const hasGrowExport = (s: string): boolean => isGrowExportSlug(s) || isFeedbackKpiSlug(s);

/** The most data rows one file carries. */
export const GROW_EXPORT_ROW_CAP = 5000;

const thousands = (n: number) => n.toLocaleString('en-US');
export const exportCapSentence = (matched: number, what: string) =>
  `This export holds at most ${thousands(GROW_EXPORT_ROW_CAP)} rows and ${thousands(matched)} ${what} match. Narrow the search or a filter, then export again.`;

type Label = (v: unknown) => unknown;

export const FEEDBACK_HEADER = ['Feedback', 'Source', 'Theme', 'Roadmap item', 'Status', 'Logged on'] as const;

/** The Feedback table as CSV. `writer` decides the From column; no file ever has an email. */
export function feedbackCsv(rows: readonly Row[], writer: boolean, label: Label): string {
  const header = [...FEEDBACK_HEADER, ...(writer ? ['From'] : [])];
  return toSafeCsv(header, rows.map((f) => [
    f.body, label(f.source), f.theme, f.roadmap_item_label, label(f.status),
    typeof f.created_at === 'string' ? f.created_at.slice(0, 10) : null,
    ...(writer ? [f.from_name] : []),
  ]));
}

export const KPI_HEADER = ['KPI', 'Key', 'Month', 'Value', 'Amount (cents)', 'Currency', 'Unit', 'Note'] as const;

export type KpiMonth = { month: string; value: number };

const UNIT_WORD: Record<string, string> = { count: 'count', pct: 'percent', months: 'months' };

/**
 * One line of a KPI's month. A money KPI's value is in Amount (cents) with its
 * currency (`usd` whole dollars become cents here); any other is in Value with
 * its unit. Every KPI's money is US dollars today, as `growKpis.ts` keeps it.
 */
function kpiLine(row: KpiRow, month: string | null, value: number | null, note: string | null): unknown[] {
  const money = row.unit === 'usd' || row.unit === 'usd_cents';
  const cents = value == null || !money ? null : row.unit === 'usd' ? Math.round(value * 100) : Math.round(value);
  return [row.kpi, row.id, month, money ? null : value, cents, money && value != null ? 'USD' : null,
    value == null ? null : money ? 'cents' : (UNIT_WORD[String(row.unit)] ?? row.unit), note];
}

/** Each monthly line says what it is: the month's last value, not one entry of several. */
export const MONTH_NOTE = 'Last value held in this month';

/** The number of data rows `kpiCsv` writes for these KPIs. */
export const kpiLineCount = (rows: readonly { months: readonly KpiMonth[] }[]) =>
  rows.reduce((n, r) => n + Math.max(1, r.months.length), 0);

/** The KPIs as CSV: each KPI's months, newest first; a KPI with none is one line with its reason. */
export function kpiCsv(rows: readonly { row: KpiRow; months: readonly KpiMonth[] }[]): string {
  const lines: unknown[][] = [];
  for (const { row, months } of rows) {
    if (months.length) for (const m of months) lines.push(kpiLine(row, m.month, m.value, MONTH_NOTE));
    else if (row.value != null) lines.push(kpiLine(row, row.period, row.value, 'Current reading; no monthly history is stored for this KPI'));
    else lines.push(kpiLine(row, null, null, row.reason ?? 'Not recorded'));
  }
  return toSafeCsv(KPI_HEADER, lines);
}
