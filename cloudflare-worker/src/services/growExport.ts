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
 */
import { toCsv } from './csv';
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
