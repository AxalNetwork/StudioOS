/**
 * D7813 (#7813) — the Companies directory's scoped export: the page of results
 * on screen, as the page states it.
 *
 * THE CONTROL SAYS WHAT THE FILE IS BEFORE THE CLICK. "Export this page · 25
 * rows", and its hover names the search, the filters, the sort and the page the
 * rows came from. The zone header runs it through `zoneActionBuilder`'s
 * `view.scoped` (D7172), the shape Markets already uses; `CompanyDirectoryZone`
 * builds it because the criteria live there, and `ResearchWorkspace` passes it
 * through, so the Founder and Advisor shells write the same file.
 *
 * TEN COLUMNS, ALL FROM THE LIST RESPONSE. The record uid, the four facts the
 * row prints, the sector label, and the stored attribution D7812 put on every
 * row: publisher (`source_name`), source link (`source_url`, https only, as
 * `companySource` admits it), licence (`source_license`) and as-of date
 * (`as_of`). Nothing is looked up or inferred; an unknown value is written
 * "Not recorded", never a blank (D7811 convention 2).
 *
 * FORMULA-SAFE THROUGH THE SHARED RULE. Each cell is checked with `csvSafe`
 * (D7811), the one formula rule the Worker and the frontend share, and written
 * through `exportView`, whose `csvCell` quotes it — so the file is byte for
 * byte what `toSafeCsv` would write, and no second copy of the rule exists here.
 *
 * The file name carries the page, the row count and the day:
 * `companies-page-2-25-rows-2026-11-25.csv`. Selection and all-matches scopes
 * are #7831 and #7848.
 */
import { csvCell, csvSafe } from '../../lib/csvExport.js';
import { NOT_RECORDED, activeFilters, pageWindow } from '../../lib/companyDirectoryView.js';
import { foundedLabel, sortLabel } from './companyDirectoryState.js';
import { companySource } from './companySource.js';

export const COMPANY_CSV_HEADER = [
  'Record uid', 'Company', 'Country', 'Founded', 'Website', 'Sector label',
  'Publisher', 'Source link', 'Licence', 'As of',
];

const known = (v) => v != null && String(v).trim() !== '';
const or = (v) => (known(v) ? v : NOT_RECORDED);

/**
 * A value a spreadsheet will not run: the shared `csvSafe` rule decides, and
 * where it would prefix the cell, the apostrophe is added here and `csvCell`
 * does the quoting. A plain number (a founding year) is left a number.
 */
export function formulaSafe(v) {
  if (v == null) return v;
  const s = String(v);
  return csvSafe(s) === csvCell(s) ? v : `'${s}`;
}

/** One directory row → its ten cells, in `COMPANY_CSV_HEADER` order. */
export function companyCsvCells(row = {}) {
  const source = companySource(row);
  return [
    or(row.uid), or(row.name), or(row.country), or(row.founded_year), or(row.website), or(row.sector),
    or(row.source_name), or(source.sourceLink), or(row.source_license), or(row.as_of),
  ].map(formulaSafe);
}

/** The criteria the rows came from: search, filters, sort and page — each named, "none" when unset. */
export function exportScope(filters = {}, data = {}) {
  const w = pageWindow(data?.total, data?.limit, data?.offset);
  const q = String(filters.q || '').trim();
  const founded = foundedLabel(filters.founded_from, filters.founded_to);
  const rest = activeFilters(filters).filter((c) => !c.key.startsWith('founded')).map((c) => c.label);
  const all = [...(founded ? [founded] : []), ...rest];
  return [
    `Page ${w.page} of ${w.pages}, rows ${w.from}–${w.to} of ${w.total.toLocaleString('en-US')}`,
    q ? `search “${q}”` : 'no search',
    all.length ? `filters: ${all.join(', ')}` : 'no filters',
    `sorted by ${sortLabel(filters.sort).replace(/^./, (c) => c.toLowerCase())}`,
  ].join(' · ');
}

/**
 * The export control in each list state (`listState`): only a settled page with
 * rows offers a file. A failed or refused read says not available, a read in
 * flight says so (the rows on screen are about to change), and a true zero says
 * 0 rows — never a file of headers only.
 */
export function companyExport({ state, data, filters }) {
  if (state === 'unreadable' || state === 'refused') {
    return { label: 'Export · not available', scope: 'The company directory could not be read, so there is no page to export', disabled: true };
  }
  if (state === 'loading' || state === 'updating' || !data) {
    return { label: 'Export this page · loading', scope: 'Waits for the results; no file of headers only', disabled: true };
  }
  const items = data.items || [];
  if (state === 'empty' || !items.length) {
    return { label: 'Export this page · 0 rows', scope: 'No company matches, so there is nothing to export', disabled: true };
  }
  const w = pageWindow(data.total, data.limit, data.offset);
  return {
    label: `Export this page · ${items.length} ${items.length === 1 ? 'row' : 'rows'}`,
    scope: exportScope(filters, data),
    disabled: false,
    zone: `companies-page-${w.page}`,
    count: items.length,
  };
}
