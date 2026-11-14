/**
 * D6103 (#6103) — Grow's CSV exports: Product improvement's Feedback table and
 * Revenue and traction's KPIs with their monthly history, built from the rows
 * the module read already shaped (`routes/cycle_grow.ts`
 * `GET /modules/:slug/export`, the same search and filter as the table).
 *
 * WHAT A FILE HOLDS, AND WHAT IT NEVER HOLDS.
 *   · Feedback: the feedback, its source, theme, roadmap item, status and the
 *     day it was logged. The customer's name (`from_name`) is a column only
 *     for a writer, as on the page (decision 9). `from_email` is never a
 *     column, for anyone: the export discloses nothing the page does not
 *     (owner decision, D6103).
 *   · KPIs: one row per KPI per month, the last value that month held
 *     (`growKpis.ts` `kpiMonths`), because that is what a KPI's history keeps;
 *     not every entry. A KPI with no stored month is one row with empty cells
 *     and its reason. A PostHog KPI has no stored months here, so its row is
 *     its current reading.
 *   · Money is whole cents, in a column that says so, beside a Currency
 *     column; a missing value is an empty cell, never 0.
 *   · Every field goes through `csv.ts` `csvSafe`, so a cell a person typed
 *     can never run as a spreadsheet formula.
 *
 * A FILE HAS AT MOST `GROW_EXPORT_ROW_CAP` ROWS. Past it the route refuses
 * with `exportCapSentence`, never a cut-short file that looks complete.
 */
import { toSafeCsv } from './csv';
import type { KpiRow } from './growKpis';

/** The modules with an export. Any other Grow module has none (404). */
export const GROW_EXPORT_SLUGS = ['product-improvement', 'revenue-and-traction'] as const;
export type GrowExportSlug = typeof GROW_EXPORT_SLUGS[number];
export const isGrowExportSlug = (s: string): s is GrowExportSlug => (GROW_EXPORT_SLUGS as readonly string[]).includes(s);

/** The most data rows one file carries. */
export const GROW_EXPORT_ROW_CAP = 5000;

const count = (n: number) => n.toLocaleString('en-US');
export const exportCapSentence = (matched: number, what: string) =>
  `This export holds at most ${count(GROW_EXPORT_ROW_CAP)} rows and ${count(matched)} ${what} match. Narrow the search or a filter, then export again.`;

type Row = Record<string, unknown>;
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
