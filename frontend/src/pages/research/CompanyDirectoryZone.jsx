// D534 (#1079) — `/research/companies`, built to `design/incoming/Research ·
// Companies.dc.html`. The directory is searched, filtered, sorted and paged
// on the Worker (`researchCompaniesApi.list`); this page prints the API's
// numbers — `total`, `coverage`, `facets` — and never counts rows itself.
//
// The bundled `data/companyDirectory.json` read is retired: it held a copy of
// the directory as of one export and paged it in the browser.
//
// THE SAVED ANALYSES TAB is the way back into `/research/companies/:id`. A
// founder's competitor analyses lived on this route until the directory took
// it (b9557713c); `/build/competitors` redirects here with `?tab=analyses`,
// carrying `market` and `website` so the company page's "Run competitor
// analysis" button prefills the form instead of landing on the directory.
//
// Departures from the canvas: no public top bar and no "Sign in" (the page is
// signed-in, inside `WorkspaceShell`); the app's type, not Space Grotesk; the
// coverage has no "as of" date because the API reports none (D7045 ◇ freshness).
//
// D5157 part 3 (#5157, RS-04 A): in the founder shell, the one with My
// Research, each row has Add to research and a checkbox; a selection kept
// across pages leads to Add to research or Compare N (`AddToResearch.jsx`).
//
// D7179 (#7179, canvas D7045, boards RS-17-00 to RS-17 F): results first —
// search, sort and rows per page, the filters (their counts say they are the
// whole directory's), active filters, the count line, the results and the
// pager; Directory coverage is a closed disclosure below. Every list parameter
// lives in the URL and "Copy link to these results" copies it; the selection
// and the return point live in this tab's session (`companyDirectoryState.js`),
// so Back, the profile's "Back to results", the breadcrumb and the tab switch
// return to the same investigation. Sorted by funding, the rows are grouped by
// currency under a note. A half-typed or reversed year range sends nothing and
// keeps the last valid results. One native link per company; the checkbox is
// apart. Below 1024px the rows are cards, with a filter sheet and a selection sheet.
//
// D7813 (#7813): the header row's Export is this page's scoped export
// (`companyDirectoryExport.js`, D7172's `view.scoped`): "Export this page · N
// rows", a hover naming the search, filters, sort and page, ten columns with
// the stored attribution, and a file named for the page, row count and day.
// The Directory and Saved analyses tabs take arrow keys, Home and End, with one
// tab stop, and each names its tab panel.
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { Card, PhoneSheet } from '../../ui';
import { StateChip } from '../../ui/Honesty.jsx';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth.js';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { useAuth } from '../../hooks/useAuthSync.jsx';
import { researchCompaniesApi } from '../../lib/api/researchCompanies.js';
import {
  COVERAGE_LABELS, DIRECTORY_SORTS, EMPTY_FILTERS, HAS_OPTIONS, NOT_RECORDED, PAGE_SIZES,
  activeFilters, companyHref, directoryParams, employees, lastRound, latestOnly, listState, pageList, pageWindow, withoutFilter,
} from '../../lib/companyDirectoryView.js';
import {
  FUNDING_SORT_NOTE, countLine, filterCount, filtersFromSearch, foundedLabel, fundingGroups, fundingTotal, isFundingSort,
  readSelection, restoredStatus, resultsHref, resultsSearch, resultsSummary, searchWithFilters, sessionStore, sortLabel,
  takeReturnPoint, writeLastResults, writeReturnPoint, writeSelection, yearMessage, yearRange,
} from './companyDirectoryState.js';
import { canAddToResearch } from './researchComparisons.js';
import { ReviewSelection, SelectionBar, SelectionHint } from './CompanySelection.jsx';
import { exportFileName, exportView } from '../../lib/csvExport.js';
import { COMPANY_CSV_HEADER, companyCsvCells, companyExport } from './companyDirectoryExport.js';

import { CompanyPublisherProvider, SourceDetails, PublisherBoundary } from './CompanySource.jsx';

const CompetitorAnalysis = lazy(() => import('../../components/CompetitorAnalysis'));
const AddToResearch = lazy(() => import('./AddToResearch.jsx'));

const field = 'w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[12.5px] text-axal-ink focus:border-violet-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const bad = 'border-red-600 dark:border-red-500';
const label = 'mb-1 block text-[11px] font-bold text-axal-muted dark:text-gray-400';
const btn = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-axal-hairline bg-white px-3 text-[12px] font-semibold text-axal-ink lg:min-h-[32px] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const primary = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-violet-700 px-3 text-[12px] font-semibold text-white hover:bg-violet-800 disabled:opacity-50 lg:min-h-[32px] dark:bg-violet-600 dark:hover:bg-violet-500';
const linkCls = 'font-semibold text-axal-violet underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-300';

export { companyHref };

/** "What the directory records": each field's filled count, of the whole directory. */
export function CoverageCard({ coverage }) {
  if (!coverage) return null;
  const of = coverage.of ?? 0;
  return (
    <div data-testid="company-coverage" className="space-y-3">
      <span className="block text-[11px] text-axal-faint dark:text-gray-400">Companies with each field filled, of {of.toLocaleString('en-US')} · research_company_directory</span>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {COVERAGE_LABELS.map(({ key, label: name }) => {
          const n = coverage.fields?.[key];
          const pct = of && n != null ? Math.round((n / of) * 100) : 0;
          return (
            <div key={key} className="space-y-1.5">
              <div className="flex items-baseline justify-between text-[12px]">
                <span className="text-axal-muted dark:text-gray-400">{name}</span>
                <span><strong className="text-axal-ink dark:text-gray-100">{n == null ? NOT_RECORDED : n.toLocaleString('en-US')}</strong><span className="text-axal-faint dark:text-gray-500"> / {of.toLocaleString('en-US')}</span></span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-axal-hairline dark:bg-gray-800" aria-hidden="true">
                <div className="h-full rounded-full bg-violet-600" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-axal-faint dark:text-gray-400">
        Source: research_company_directory · <PublisherBoundary />. Last refreshed: not reported by the directory today.
      </p>
    </div>
  );
}

/** RS-17 A: Directory coverage, a closed disclosure below the results. Its counts are of every company, not your results. */
export function CoverageDisclosure({ coverage, initiallyOpen = false }) {
  const [open, setOpen] = useState(initiallyOpen);
  if (!coverage) return null;
  const of = (coverage.of ?? 0).toLocaleString('en-US');
  return (
    <Card data-testid="company-coverage-disclosure" className="space-y-3">
      <button type="button" aria-expanded={open} aria-controls="company-coverage-body" onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full flex-wrap items-center gap-x-3 gap-y-1 text-left lg:min-h-0">
        <b className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">Directory coverage</b>
        <span className="text-[11.5px] text-axal-muted dark:text-gray-400">How many of all {of} companies have each field · not your results</span>
        <ChevronDown size={14} aria-hidden="true" className={`ml-auto text-axal-muted ${open ? 'rotate-180' : ''}`} />
      </button>
      <div id="company-coverage-body" hidden={!open}>{open ? <CoverageCard coverage={coverage} /> : null}</div>
    </Card>
  );
}

/** Search, sort and rows per page: the first row of the page (desktop), or search with the Filters and Sort controls (phone, tablet). */
export function SearchRow({ filters, onChange, compact = false, onOpenFilters, filtersOpener }) {
  const set = (patch) => onChange({ ...filters, ...patch, page: 1 });
  const search = (
    <label className="min-w-0 flex-[1_1_420px]">
      <span className={label}>Search by name or website</span>
      <span className="relative block">
        <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-axal-faint" />
        <input aria-label="Search companies by name or website" type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })}
          placeholder="Company name or website" className={`${field} min-h-[44px] pl-9 lg:min-h-0`} />
      </span>
    </label>
  );
  const sort = (
    <label className={compact ? 'min-w-0 flex-1' : 'min-w-[200px] flex-[0_1_270px]'}>
      <span className={label}>Sort by</span>
      <select aria-label="Sort companies" value={filters.sort} onChange={(e) => set({ sort: e.target.value })} className={`${field} min-h-[44px] lg:min-h-0`}>
        {DIRECTORY_SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
    </label>
  );
  const size = (
    <label className={compact ? 'w-[96px] shrink-0' : 'w-[120px] shrink-0'}>
      <span className={label}>Rows per page</span>
      <select aria-label="Rows per page" value={filters.limit} onChange={(e) => onChange({ ...filters, limit: Number(e.target.value), page: 1 })} className={`${field} min-h-[44px] lg:min-h-0`}>
        {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  );
  if (!compact) return <div data-testid="company-search-row" className="flex flex-wrap items-end gap-3">{search}{sort}{size}</div>;
  const n = filterCount(filters);
  return (
    <div data-testid="company-search-row" className="space-y-2">
      {search}
      <div className="flex items-end gap-2">
        <button type="button" ref={filtersOpener} onClick={onOpenFilters} aria-haspopup="dialog" className={`${btn} shrink-0`}>
          <SlidersHorizontal size={14} aria-hidden="true" /> Filters{n ? <span className="rounded-full bg-violet-700 px-1.5 text-[11px] text-white dark:bg-violet-600">{n}</span> : null}
        </button>
        {sort}
        {size}
      </div>
    </div>
  );
}

/**
 * The filters. Option counts are the API's facets, which count the whole
 * directory — not your results (D7045 ◇ filtered facets) — and the panel says so.
 * `years` is `{ check, message, keep }`: the inline year-range message (RCD01D).
 */
export function DirectoryFilters({ filters, facets, of = null, onChange, years = null, bare = false, onYearFocus }) {
  const set = (patch) => onChange({ ...filters, ...patch, page: 1 });
  const sectors = facets?.sector_labels || [];
  const countries = facets?.countries || [];
  const invalid = years?.message ? { 'aria-invalid': true, 'aria-describedby': 'company-year-error' } : {};
  const scope = Number.isFinite(of) ? `Option counts are of the whole directory (${of.toLocaleString('en-US')}), not of your results` : 'Option counts are of the whole directory, not of your results';
  const body = (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {bare ? null : <b className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">Filters</b>}
        <span data-testid="company-facet-scope" className="text-[11.5px] text-axal-muted dark:text-gray-400">{scope}</span>
        <button type="button" onClick={() => onChange({ ...EMPTY_FILTERS, q: filters.q, sort: filters.sort, limit: filters.limit })}
          className="ml-auto min-h-[44px] rounded-lg px-2 text-[12px] font-semibold text-axal-violet underline lg:min-h-0 dark:text-violet-300">Reset all filters</button>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <label className="min-w-0 flex-[1_1_240px]">
          <span className={label}>Sector label</span>
          <select aria-label="Filter by sector label" value={filters.sector_label} onChange={(e) => set({ sector_label: e.target.value })} className={`${field} min-h-[44px] lg:min-h-0`}>
            <option value="">All sector labels ({sectors.length})</option>
            {sectors.map((s) => <option key={s.label} value={s.label}>{s.label} ({s.count})</option>)}
            {facets?.sector_none ? <option value="none">No sector label ({facets.sector_none})</option> : null}
          </select>
        </label>
        <label className="min-w-0 flex-[1_1_220px]">
          <span className={label}>Country</span>
          <select aria-label="Filter by country" value={filters.country} onChange={(e) => set({ country: e.target.value })} className={`${field} min-h-[44px] lg:min-h-0`}>
            <option value="">All countries ({countries.length})</option>
            {countries.map((c) => <option key={c.country} value={c.country}>{c.country} ({c.count})</option>)}
          </select>
        </label>
        <fieldset className="min-w-0 flex-[1_1_280px]" onFocus={() => onYearFocus?.(true)} onBlur={() => onYearFocus?.(false)}>
          <legend className={label}>Founded between</legend>
          <div className="flex items-center gap-2">
            <input aria-label="Founded in or after" inputMode="numeric" placeholder="From" value={filters.founded_from} {...invalid}
              onChange={(e) => set({ founded_from: e.target.value.replace(/\D/g, '').slice(0, 4) })} className={`${field} min-h-[44px] font-mono lg:min-h-0 ${years?.message ? bad : ''}`} />
            <span className="text-axal-faint" aria-hidden="true">–</span>
            <input aria-label="Founded in or before" inputMode="numeric" placeholder="To" value={filters.founded_to} {...invalid}
              onChange={(e) => set({ founded_to: e.target.value.replace(/\D/g, '').slice(0, 4) })} className={`${field} min-h-[44px] font-mono lg:min-h-0 ${years?.message ? bad : ''}`} />
          </div>
          {years?.message ? (
            <p id="company-year-error" data-testid="company-year-error" className="mt-1.5 flex items-start gap-1.5 text-[11.5px] font-semibold text-red-700 dark:text-red-300">
              <X size={12} aria-hidden="true" className="mt-0.5 shrink-0" />{years.message}
            </p>
          ) : null}
        </fieldset>
        <fieldset className="min-w-0 flex-[1_1_100%]">
          <legend className={label}>Only companies with</legend>
          <div className="flex flex-wrap gap-2">
            {HAS_OPTIONS.map((o) => {
              const on = filters.has.includes(o.value);
              const n = facets?.has?.[o.value];
              return (
                <label key={o.value} className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] lg:min-h-0 ${on ? 'border-violet-500 bg-violet-50 text-violet-900 dark:bg-violet-950/40 dark:text-violet-100' : 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-300'}`}>
                  <input type="checkbox" checked={on} className="accent-violet-700"
                    onChange={() => set({ has: on ? filters.has.filter((h) => h !== o.value) : [...filters.has, o.value] })} />
                  {o.label}{n != null ? <span className="font-mono text-axal-faint dark:text-gray-500">{n}</span> : null}
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>
    </>
  );
  if (bare) return <div data-testid="company-filters" className="space-y-3">{body}</div>;
  return <Card data-testid="company-filters" role="region" aria-label="Filters" className="space-y-3">{body}</Card>;
}

/** The filters in force, each removable (founded as one range), then the sort. */
export function ActiveFilters({ filters, onChange }) {
  const chips = activeFilters(filters).filter((c) => !c.key.startsWith('founded'));
  const founded = foundedLabel(filters.founded_from, filters.founded_to);
  const all = [
    ...(founded ? [{ key: 'founded', label: founded, remove: () => onChange({ ...filters, founded_from: '', founded_to: '', page: 1 }) }] : []),
    ...chips.map((c) => ({ ...c, remove: () => onChange(withoutFilter(filters, c.key)) })),
  ];
  return (
    <div data-testid="company-active-filters" className="flex flex-wrap items-center gap-2 text-[12px]">
      <span className="text-[11px] font-bold text-axal-muted dark:text-gray-400">Active filters</span>
      {all.length ? all.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1 rounded-full border border-axal-hairline pl-2.5 text-axal-ink dark:border-gray-700 dark:text-gray-100">
          {c.label}
          <button type="button" aria-label={`Remove filter: ${c.label}`} onClick={c.remove}
            className="inline-flex h-[44px] w-[36px] items-center justify-center text-axal-faint hover:text-axal-ink lg:h-7 lg:w-7 dark:hover:text-gray-100"><X size={12} /></button>
        </span>
      )) : <span className="text-axal-faint dark:text-gray-500">None</span>}
      <span className="ml-2 text-[11px] font-bold text-axal-muted dark:text-gray-400">Sort</span>
      <span className="text-axal-ink dark:text-gray-100">{sortLabel(filters.sort)}</span>
    </div>
  );
}

function Cell({ children, sub }) {
  return <>{children}{sub ? <div className="mt-0.5 text-[11px] text-axal-faint dark:text-gray-500">{sub}</div> : null}</>;
}

const muted = <StateChip kind="not_recorded" />;

/** One company link: the row's only link. Its `data-company-link` is what the return focuses. */
function CompanyLink({ row, onOpen, links }) {
  return (
    <Link to={companyHref(row.uid)} data-company-link={row.uid} onClick={() => onOpen?.(row)} className={linkCls}
      ref={links ? (node) => { if (node) links.current.set(row.uid, node); else links.current.delete(row.uid); } : undefined}>{row.name}</Link>
  );
}

/** The funding total cell: the amount in its currency, or Not recorded (sorted last under a funding sort). */
function FundingCell({ row, sorted }) {
  const amount = fundingTotal(row);
  if (amount) return <b className="font-mono text-axal-ink dark:text-gray-100">{amount}</b>;
  return <>{muted}{sorted ? <div className="mt-0.5 text-[11px] text-axal-faint dark:text-gray-500">Sorted last</div> : null}</>;
}

/**
 * The results table. A missing value reads "Not recorded", never a dash or a
 * zero. Each row has one native company link (D7045: the row itself is not a
 * focus stop). `pick` (D5157, the founder shell only) adds a checkbox and Add
 * to research to each row: `{ selected: Map(uid → name), toggle(row), onAdd(row) }`.
 * Sorted by funding, the rows sit under one heading row per currency.
 */
export function DirectoryTable({ items, coverage, pick = null, sort = 'name', offset = 0, onOpen, links }) {
  const funding = isFundingSort(sort);
  const cols = 8 + (pick ? 2 : 0);
  const of = coverage?.of != null ? ` of ${coverage.of.toLocaleString('en-US')}` : '';
  const sub = (n) => (coverage ? <div className="font-semibold normal-case tracking-normal">recorded for {n ?? 0}{of}</div> : null);
  const groups = funding ? fundingGroups(items, offset) : [{ key: 'all', rows: (items || []).map((row, i) => ({ row, n: offset + i + 1 })) }];
  const line = (row, n) => {
    const round = lastRound(row);
    const staff = employees(row);
    const on = pick?.selected.has(row.uid);
    return (
      <tr key={row.uid} className={on ? 'bg-violet-50/70 dark:bg-violet-950/20' : ''}>
        {pick ? (
          <td className="px-4 py-3">
            <input type="checkbox" checked={on} onChange={() => pick.toggle(row)} aria-label={`Select ${row.name}`}
              className="h-4 w-4" data-testid={`pick-company-${row.uid}`} />
          </td>
        ) : null}
        <td className="px-2 py-3 font-mono text-axal-faint dark:text-gray-500">{n}</td>
        <td className="px-4 py-3">
          <CompanyLink row={row} onOpen={onOpen} links={links} />
          {row.website ? <div className="mt-0.5 max-w-[320px] truncate text-[11px] text-axal-faint dark:text-gray-500">{row.website}</div> : null}
          <SourceDetails record={row} testId="directory-row-source" />
        </td>
        <td className="px-4 py-3 text-axal-muted dark:text-gray-300">{row.sector || muted}</td>
        <td className="px-4 py-3 text-axal-muted dark:text-gray-300">{row.country || muted}</td>
        <td className="px-4 py-3 font-mono text-axal-muted dark:text-gray-300">{row.founded_year ?? muted}</td>
        <td className={`px-4 py-3 ${funding ? 'bg-violet-50/40 dark:bg-violet-950/10' : ''}`}><FundingCell row={row} sorted={funding} /></td>
        <td className="px-4 py-3 text-axal-ink dark:text-gray-100">{round ? <Cell sub={round.detail}>{round.amount}</Cell> : muted}</td>
        <td className="px-4 py-3 text-axal-ink dark:text-gray-100">{staff ? <Cell sub={staff.growth}>{staff.count}</Cell> : muted}</td>
        {pick ? (
          <td className="px-4 py-3 text-right">
            <button type="button" onClick={() => pick.onAdd(row)} data-testid={`button-add-to-research-${row.uid}`} aria-label={`Add ${row.name} to research`}
              className="whitespace-nowrap rounded-lg px-2 py-1 text-[12px] font-semibold text-axal-violet underline hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/30">Add to research</button>
          </td>
        ) : null}
      </tr>
    );
  };
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-[12px]">
          <caption className="sr-only">Companies matching your filters</caption>
          <thead className="bg-axal-ground text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint dark:bg-gray-950 dark:text-gray-400">
            <tr>
              {pick ? <th className="px-4 py-2.5"><span className="sr-only">Select</span></th> : null}
              <th className="px-2 py-2.5">#</th>
              <th className="px-4 py-2.5">Company</th>
              <th className="px-4 py-2.5">Sector label</th>
              <th className="px-4 py-2.5">Country</th>
              <th className="px-4 py-2.5">Founded</th>
              <th className="px-4 py-2.5" aria-sort={sort === '-funding' ? 'descending' : sort === 'funding' ? 'ascending' : undefined}>Funding total{sub(coverage?.fields?.funding)}</th>
              <th className="px-4 py-2.5">Last round{sub(coverage?.fields?.last_round)}</th>
              <th className="px-4 py-2.5">Employees{sub(coverage?.fields?.headcount)}</th>
              {pick ? <th className="px-4 py-2.5"><span className="sr-only">Research</span></th> : null}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.key} className="divide-y divide-axal-hairline dark:divide-gray-800">
              {funding ? (
                <tr data-testid={`funding-group-${g.key}`} className="bg-axal-ground dark:bg-gray-950">
                  <th colSpan={cols} scope="colgroup" className="px-4 py-2 text-[11.5px] font-semibold text-axal-muted dark:text-gray-300">
                    <span className="mr-2 rounded bg-violet-100 px-1.5 py-0.5 font-mono font-bold text-violet-900 dark:bg-violet-900/40 dark:text-violet-100">{g.code}</span>{g.label}
                  </th>
                </tr>
              ) : null}
              {g.rows.map(({ row, n }) => line(row, n))}
            </tbody>
          ))}
        </table>
      </div>
    </Card>
  );
}

/** Phone and tablet (RCD03, RCD04A): one card per company — the checkbox in its own 44px target beside one link. */
export function DirectoryCards({ items, pick = null, sort = 'name', offset = 0, onOpen, links }) {
  const funding = isFundingSort(sort);
  const groups = funding ? fundingGroups(items, offset) : [{ key: 'all', rows: (items || []).map((row, i) => ({ row, n: offset + i + 1 })) }];
  return (
    <div data-testid="company-cards" className="space-y-2">
      {groups.map((g) => (
        <section key={g.key} aria-label={funding ? `${g.code} · ${g.label}` : undefined} className="space-y-2">
          {funding ? <h3 className="px-1 text-[11.5px] font-bold text-axal-muted dark:text-gray-300"><span className="font-mono text-violet-800 dark:text-violet-200">{g.code}</span> · {g.label}</h3> : null}
          {g.rows.map(({ row, n }) => {
            const on = pick?.selected.has(row.uid);
            const amount = fundingTotal(row);
            return (
              <article key={row.uid} className={`flex items-start gap-1 rounded-xl border border-axal-hairline bg-white p-2 dark:border-gray-800 dark:bg-gray-900 ${on ? 'border-violet-400 bg-violet-50/70 dark:border-violet-700 dark:bg-violet-950/30' : ''}`}>
                {pick ? (
                  <label className="flex h-[44px] w-[44px] shrink-0 items-center justify-center">
                    <input type="checkbox" checked={on} onChange={() => pick.toggle(row)} aria-label={`Select ${row.name}`} className="h-5 w-5" data-testid={`pick-company-${row.uid}`} />
                  </label>
                ) : null}
                <div className="min-w-0 flex-1 py-2 sm:flex sm:items-baseline sm:gap-3">
                  <div className="min-w-0 sm:flex-1">
                    <CompanyLink row={row} onOpen={onOpen} links={links} />
                    <SourceDetails record={row} testId="directory-card-source" />
                    <span className="block truncate text-[12px] text-axal-muted dark:text-gray-400">
                      {row.sector || 'Sector not recorded'} · {row.country || 'Country not recorded'} · <span className="font-mono">{row.founded_year ?? 'Founded not recorded'}</span>
                    </span>
                  </div>
                  <span className="mt-1 block text-[12px] sm:mt-0 sm:text-right">
                    {amount ? <><b className="font-mono text-axal-ink dark:text-gray-100">{amount}</b> <small className="text-axal-faint dark:text-gray-500">funding total</small></> : muted}
                  </span>
                </div>
                <span className="shrink-0 px-1 py-2 font-mono text-[11px] text-axal-faint dark:text-gray-500">{n}</span>
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/** "Page 1 of 12", previous, the page buttons and next. */
export function Pager({ total, limit, offset, onPage }) {
  const w = pageWindow(total, limit, offset);
  if (w.pages <= 1) return null;
  const b = 'min-h-[44px] min-w-[44px] rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-40 lg:min-h-0 lg:min-w-[34px]';
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[12px] text-axal-muted dark:text-gray-400">Page {w.page} of {w.pages}</span>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={`${b} border-axal-hairline dark:border-gray-700 dark:text-gray-100`} disabled={w.page <= 1} onClick={() => onPage(w.page - 1)}>‹ Previous</button>
        {pageList(w.page, w.pages).map((p, k) => p === '…'
          ? <span key={`gap-${k}`} className="px-1.5 py-1.5 text-[12px] text-axal-faint">…</span>
          : <button key={p} type="button" aria-current={p === w.page ? 'page' : undefined} onClick={() => onPage(p)}
              className={`${b} ${p === w.page ? 'border-violet-700 bg-violet-700 text-white' : 'border-axal-hairline dark:border-gray-700 dark:text-gray-100'}`}>{p}</button>)}
        <button type="button" className={`${b} border-axal-hairline dark:border-gray-700 dark:text-gray-100`} disabled={w.page >= w.pages} onClick={() => onPage(w.page + 1)}>Next ›</button>
      </div>
    </nav>
  );
}

function Skeleton({ compact }) {
  const bar = 'block h-3 animate-pulse rounded bg-axal-hairline motion-reduce:animate-none dark:bg-gray-800';
  return (
    <div className="mt-3 space-y-3" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`flex items-center gap-4 ${compact ? 'flex-wrap' : ''}`}>
          <span className={`${bar} w-[18px]`} /><span className={bar} style={{ width: 160 + (i % 3) * 40 }} /><span className={`${bar} w-[120px]`} /><span className={`${bar} w-[90px]`} />
        </div>
      ))}
    </div>
  );
}

/**
 * The results, in every state the canvas draws (RCD05): a first read (a
 * skeleton, no count), a later read that keeps the rows ("Updating…"), a true
 * zero with the filters to relax, Unavailable with Retry, Refused, and the
 * count line, table (or cards) and pager. Search and filters stay usable in
 * every state. `countRef` is the results heading focus moves to on a page change.
 */
export function DirectoryResults({
  state, data, filters, onChange, onRetry, pick = null, compact = false, onOpen, links, countRef, status = null, yearsKept = null, facets = null,
}) {
  if (state === 'loading') {
    return (
      <Card data-testid="company-results-loading" aria-busy="true">
        <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-axal-muted dark:text-gray-400">
          <span className="rounded-full border border-axal-hairline px-2 text-[11px] font-bold dark:border-gray-700">Loading companies…</span>
          No count is shown until the directory answers.
        </p>
        <Skeleton compact={compact} />
      </Card>
    );
  }
  if (state === 'unreadable') {
    return (
      <Card data-testid="company-results-unreadable" role="alert" className="border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20">
        <p className="flex flex-wrap items-center gap-2 text-[13px] font-bold text-red-900 dark:text-red-100"><StateChip kind="unavailable" /> The company directory did not answer</p>
        <p className="mt-1 text-[12.5px] text-red-900 dark:text-red-100">No rows and no count are shown: a failed read is not zero companies. Your search, filters, sort, page and selection are kept.</p>
        <button type="button" onClick={onRetry} className="mt-3 min-h-[44px] rounded-lg border border-red-300 bg-white px-3 text-[12px] font-semibold text-red-900 lg:min-h-[32px] dark:border-red-800 dark:bg-transparent dark:text-red-100">Retry</button>
      </Card>
    );
  }
  if (state === 'refused') {
    return (
      <Card data-testid="company-results-refused" className="space-y-2">
        <p className="flex flex-wrap items-center gap-2 text-[13px] font-bold text-axal-ink dark:text-gray-100"><StateChip kind="refused" /> The directory refused the read</p>
        <p className="text-[12.5px] text-axal-muted dark:text-gray-400">Your session may have ended, or this account may not hold access to Research. Sign in again and these results open from their link.</p>
      </Card>
    );
  }
  if (state === 'empty') {
    const founded = foundedLabel(filters.founded_from, filters.founded_to);
    const chips = [
      ...(founded ? [{ key: 'founded', label: founded, next: { ...filters, founded_from: '', founded_to: '', page: 1 } }] : []),
      ...activeFilters(filters).filter((c) => !c.key.startsWith('founded')).map((c) => ({ ...c, next: withoutFilter(filters, c.key) })),
    ];
    const q = filters.q?.trim();
    const narrowest = (filters.has || []).map((h) => ({ h, n: facets?.has?.[h] })).filter((x) => Number.isFinite(x.n)).sort((a, b) => a.n - b.n)[0];
    return (
      <Card data-testid="company-results-empty" variant="dashed" className="space-y-3">
        <p className="flex flex-wrap items-center gap-2 text-[13px] font-bold text-axal-ink dark:text-gray-100">
          <span className="rounded-full border border-axal-hairline px-2 text-[11px] dark:border-gray-700">No matches</span>
          {q ? <>No company matches “{q}”{chips.length ? ' with these filters' : ''}.</> : 'No company matches these filters.'}
        </p>
        <p className="text-[12.5px] text-axal-muted dark:text-gray-400">This is a true zero: the directory answered and nothing matched. Remove a filter to widen the search{q ? ', or search by website instead of name' : ''}.</p>
        {chips.length ? (
          <div className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1 rounded-full border border-axal-hairline pl-2.5 text-[12px] text-axal-muted dark:border-gray-700 dark:text-gray-300">
                {c.label}
                <button type="button" aria-label={`Remove filter: ${c.label}`} onClick={() => onChange(c.next)} className="inline-flex h-[44px] w-[36px] items-center justify-center text-axal-faint hover:text-axal-ink lg:h-7 lg:w-7 dark:hover:text-gray-100"><X size={12} /></button>
              </span>
            ))}
          </div>
        ) : null}
        <div className={`flex gap-2 ${compact ? 'flex-col' : 'flex-wrap'}`}>
          {q && chips.length ? <button type="button" onClick={() => onChange({ ...EMPTY_FILTERS, q: filters.q, sort: filters.sort, limit: filters.limit })} className={btn}>Search all sectors and countries for “{q}”</button> : null}
          <button type="button" onClick={() => onChange({ ...EMPTY_FILTERS })} className={btn}>Clear all filters</button>
        </div>
        {narrowest ? <p className="text-[11.5px] text-axal-faint dark:text-gray-500">{HAS_OPTIONS.find((o) => o.value === narrowest.h)?.label.replace(' recorded', '')} is recorded for {narrowest.n.toLocaleString('en-US')} companies in the whole directory, so that filter narrows the most.</p> : null}
      </Card>
    );
  }
  const c = countLine(data);
  const funding = isFundingSort(filters.sort);
  const updating = state === 'updating';
  return (
    <section className="space-y-3" aria-busy={updating || undefined}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p data-testid="company-count" ref={countRef} tabIndex={-1} aria-live="polite" className="text-[12.5px] text-axal-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-gray-400">
          <strong className="font-mono text-axal-ink dark:text-gray-100">{c.range}</strong> of <strong className="font-mono text-axal-ink dark:text-gray-100">{c.total}</strong> companies match
          <span className="text-axal-faint dark:text-gray-500"> · {c.page}{c.directory ? ` · ${c.directory}` : ''}{yearsKept ? ` · still ${yearsKept}` : ''}</span>
        </p>
        {yearsKept ? <StateChip kind="stale" label="Last valid results" /> : null}
        {updating ? <span className="text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">Updating…</span> : null}
        {status ? <span role="status" data-testid="company-restored" className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">✓ {status}</span> : null}
      </div>
      {funding ? (
        <p data-testid="company-funding-note" className="rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 text-[12px] text-violet-950 dark:border-violet-900 dark:bg-violet-950/20 dark:text-violet-100">
          <b>Sorted by funding total within each currency.</b> {FUNDING_SORT_NOTE}
        </p>
      ) : null}
      <div className={updating ? 'opacity-60 transition-opacity motion-reduce:transition-none' : ''}>
        {compact
          ? <DirectoryCards items={data.items} pick={pick} sort={filters.sort} offset={data.offset} onOpen={onOpen} links={links} />
          : <DirectoryTable items={data.items} coverage={data.coverage} pick={pick} sort={filters.sort} offset={data.offset} onOpen={onOpen} links={links} />}
      </div>
      <Pager total={data.total} limit={data.limit} offset={data.offset} onPage={(page) => onChange({ ...filters, page }, { push: true })} />
    </section>
  );
}

// D7177: the selection bar and Review selection live in `CompanySelection.jsx`.
export { SelectionBar };

/** Phone and tablet (RCD04A, RCD04C): "N selected" opens the selection sheet, with Remove per company. */
export function PhoneSelection({ chosen, onRemove, onClear, onAdd, onCompare, compareOpener }) {
  const [open, setOpen] = useState(false);
  const opener = useRef(null);
  const n = chosen.length;
  return (
    <>
      <div role="region" aria-label="Selected companies" data-testid="company-selection-phone"
        className="sticky bottom-3 z-10 flex gap-2 rounded-xl border border-axal-hairline bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900">
        <button type="button" ref={opener} aria-haspopup="dialog" onClick={() => setOpen(true)} className={`${btn} flex-1`}><b className="font-mono">{n}</b>&nbsp;selected</button>
        <button type="button" ref={compareOpener} onClick={onCompare} disabled={n < 2} className={`${primary} flex-1`}
          title={n < 2 ? 'Select two or more companies to compare' : undefined}>Compare {n}</button>
      </div>
      {open ? (
        <PhoneSheet title={`${n} selected`} opener={opener} onClose={() => setOpen(false)}>
          <p className="mb-2 text-[12px] text-axal-muted dark:text-gray-400">Kept in this session. Not part of a shared link.</p>
          <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
            {chosen.map((c) => (
              <li key={c.uid} className="flex min-h-[52px] items-center gap-2">
                <b className="min-w-0 flex-1 truncate text-[14px] text-axal-ink dark:text-gray-100">{c.name}</b>
                <button type="button" onClick={() => onRemove(c.uid)} aria-label={`Remove ${c.name} from selection`} className={btn}>Remove</button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-col gap-2">
            <button type="button" onClick={() => { setOpen(false); onAdd(); }} disabled={!n} className={btn}>Add {n} to research</button>
            <div className="flex gap-2">
              <button type="button" onClick={() => { onClear(); setOpen(false); }} className={`${btn} flex-1`}>Clear selection</button>
              <button type="button" onClick={() => { setOpen(false); onCompare(); }} disabled={n < 2} className={`${primary} flex-1`}>Compare {n}</button>
            </div>
          </div>
        </PhoneSheet>
      ) : null}
    </>
  );
}

function Directory({ role, zoneActions, onTotal }) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const search = params.toString();
  const member = useAuth()?.user?.id ?? null;
  const store = useMemo(sessionStore, []);
  const compact = usePhoneWidth();

  // The URL is the investigation (D7045). `filters` is what the controls show,
  // including a half-typed search or year; `applied` is what was asked for.
  const written = useRef(search);
  const [filters, setFilters] = useState(() => filtersFromSearch(params));
  const [q, setQ] = useState(filters.q);
  // `lastValid`: the filters of the last valid year range (RCD01D). While the
  // range is reversed or half-typed, these are what is read and kept in the URL.
  const valid = (f) => (yearRange(f.founded_from, f.founded_to).ok ? f : { ...f, founded_from: '', founded_to: '' });
  const [lastValid, setLastValid] = useState(() => valid(filters));
  const [synced, setSynced] = useState(search);
  if (synced !== search) {
    // Back, forward, the breadcrumb or a pasted link moved the URL: the URL wins.
    setSynced(search);
    if (search !== written.current) {
      const f = filtersFromSearch(search);
      setFilters(f);
      setQ(f.q);
      setLastValid(valid(f));
    }
  }
  useEffect(() => {
    if (filters.q === q) return undefined;
    const t = setTimeout(() => setQ(filters.q), 300);
    return () => clearTimeout(t);
  }, [filters.q, q]);
  const years = yearRange(filters.founded_from, filters.founded_to);
  useEffect(() => { if (years.ok) setLastValid(filters); }, [years.ok, filters]);
  const lastYears = { from: lastValid.founded_from, to: lastValid.founded_to };
  const [yearEditing, setYearEditing] = useState(false);
  const applied = useMemo(() => ({ ...(years.ok ? filters : lastValid), q }), [filters, q, years.ok, lastValid]);
  const yearNote = !years.ok && (years.reason === 'reversed' || !yearEditing) ? yearMessage(years, lastYears) : null;

  // Write the applied parameters back: replaced while typing, pushed on a page change.
  const push = useRef(false);
  const urlKey = resultsSearch(applied);
  const latest = useRef({ params, search });
  latest.current = { params, search };
  useEffect(() => {
    const next = searchWithFilters(latest.current.params, applied);
    const s = next.toString();
    if (s === latest.current.search) { push.current = false; return; }
    written.current = s;
    setParams(next, { replace: !push.current });
    push.current = false;
  }, [urlKey]);

  const params4api = useMemo(() => directoryParams(applied), [applied]);
  const key = JSON.stringify(params4api);
  const [read, setRead] = useState({ loading: true, error: null, data: null });
  const [shape, setShape] = useState(null);
  const [reads] = useState(latestOnly);
  const load = useCallback(async () => {
    const id = reads.next();
    setRead((r) => ({ ...r, loading: true, error: null }));
    try {
      const data = await researchCompaniesApi.list(JSON.parse(key));
      if (!reads.isCurrent(id)) return;
      setRead({ loading: false, error: null, data });
      setShape({ coverage: data.coverage, facets: data.facets });
      onTotal?.(data.coverage?.of ?? null);
    } catch (error) {
      if (!reads.isCurrent(id)) return;
      setRead({ loading: false, error, data: null });
    }
  }, [key, reads, onTotal]);
  useEffect(() => { load(); }, [load]);
  const state = listState(read);

  // D7813: the page's scoped export. The rows are the page on screen, the
  // criteria are the ones that read it (`applied`), and the header row draws
  // this label and runs this click. A new read drops the last Downloaded note.
  const ctl = companyExport({ state, data: read.data, filters: applied });
  const [exportNote, setExportNote] = useState(null);
  useEffect(() => { setExportNote(null); }, [key, state]);
  const runExport = () => {
    if (ctl.disabled) return;
    const rows = (read.data?.items || []).map(companyCsvCells);
    let ok = false;
    try { ok = exportView({ scope: null, zone: ctl.zone, header: COMPANY_CSV_HEADER, rows }); } catch { ok = false; }
    setExportNote(ok
      ? { ok: true, text: `Downloaded ${exportFileName({ scope: null, zone: ctl.zone, count: rows.length })}` }
      : { ok: false, text: 'The file could not be written. The rows are still on screen.' });
  };
  const scoped = { ...ctl, onClick: runExport };

  // D5157: the selection is kept across pages and filters, by uid with its
  // name (D7177: and the page it was ticked on, for Review selection; only Clear
  // and Remove change it). D7179: in this tab's session, keyed by the member
  // (cleared on sign-out).
  const [sel, setSel] = useState(() => ({ member, map: readSelection(store, member) }));
  if (sel.member !== member) setSel({ member, map: readSelection(store, member) });
  const selected = sel.map;
  const setSelected = (fn) => setSel((s) => ({ ...s, map: typeof fn === 'function' ? fn(s.map) : fn }));
  useEffect(() => { writeSelection(store, sel.member, sel.map); }, [store, sel]);
  useEffect(() => { writeLastResults(store, resultsHref(applied), resultsSummary(applied, selected.size)); }, [store, urlKey, selected.size]);

  // The return point (RS-17 B): the link that was opened is focused and scrolled
  // into view when these results come back; the breadcrumb lands on the count line.
  const countRef = useRef(null);
  const links = useRef(new Map());
  const returning = useRef(undefined);
  const focusCount = useRef(false);
  const [status, setStatus] = useState(null);
  useEffect(() => {
    if (returning.current === undefined) {
      const point = takeReturnPoint(store, resultsHref(filtersFromSearch(latest.current.search)));
      returning.current = point ? { ...point, via: location.state?.via || 'back' } : null;
    }
  }, []);
  useEffect(() => {
    if (!read.data || read.loading) return;
    const point = returning.current;
    if (point) {
      returning.current = null;
      const link = point.via === 'breadcrumb' ? null : links.current.get(point.uid);
      if (link) { link.focus({ preventScroll: true }); link.scrollIntoView?.({ block: 'center' }); } else countRef.current?.focus();
      setStatus(restoredStatus(applied, selected.size));
    } else if (focusCount.current) {
      focusCount.current = false;
      countRef.current?.focus();
    }
  }, [read]);
  const onOpen = (row) => writeReturnPoint(store, resultsHref(applied), row.uid);
  const change = (next, opts = {}) => {
    setStatus(null);
    if (opts.push) { push.current = true; focusCount.current = true; }
    setFilters(next);
  };

  const [panel, setPanel] = useState(null);
  const [sheet, setSheet] = useState(false);
  const opener = useRef(null);
  const compareOpener = useRef(null);
  const filtersOpener = useRef(null);
  // D7177: Review selection, opened from the desktop selection bar.
  const [reviewing, setReviewing] = useState(false);
  const reviewOpener = useRef(null);
  const pick = canAddToResearch(role) ? {
    selected,
    toggle: (x) => setSelected((m) => {
      const next = new Map(m);
      if (next.has(x.uid)) next.delete(x.uid);
      else next.set(x.uid, { name: x.name, page: filters.page, sector: x.sector || null, country: x.country || null });
      return next;
    }),
    // A row's own button is the opener the panel returns focus to.
    onAdd: (x) => setPanel({ mode: 'add', items: [{ uid: x.uid, name: x.name }], back: null }),
  } : null;
  const chosen = [...selected].map(([uid, v]) => ({ uid, ...v }));
  const removePick = (uid) => setSelected((m) => { const next = new Map(m); next.delete(uid); return next; });
  const openPanel = (mode, back) => () => { setReviewing(false); setPanel({ mode, items: chosen.map(({ uid, name }) => ({ uid, name })), back: back || (mode === 'compare' ? compareOpener : opener) }); };
  const of = shape?.coverage?.of;
  const filterPanel = (bare) => (
    <DirectoryFilters filters={filters} facets={shape?.facets} of={of} onChange={change} bare={bare}
      years={yearNote ? { message: yearNote } : null} onYearFocus={setYearEditing} />
  );
  return (
    <>
      {zoneActions ? <ZoneToolbar role={role} className="mb-3" actions={zoneActions(scoped)} /> : null}
      <p role="status" data-testid="company-export-note"
        className={!exportNote ? 'sr-only' : `text-[11.5px] font-semibold ${exportNote.ok ? 'text-emerald-800 dark:text-emerald-200' : 'text-red-700 dark:text-red-300'}`}>{exportNote?.text || ''}</p>
      <SearchRow filters={filters} onChange={change} compact={compact} onOpenFilters={() => setSheet(true)} filtersOpener={filtersOpener} />
      {compact ? null : filterPanel(false)}
      {compact && yearNote ? <p className="text-[11.5px] font-semibold text-red-700 dark:text-red-300">{yearNote}</p> : null}
      <ActiveFilters filters={applied} onChange={change} />
      <DirectoryResults state={state} data={read.data} filters={applied} onChange={change} onRetry={load} pick={pick} compact={compact}
        onOpen={onOpen} links={links} countRef={countRef} status={status} facets={shape?.facets}
        yearsKept={!years.ok ? foundedLabel(lastYears.from, lastYears.to) || 'any founding year' : null} />
      {pick && !chosen.length && !compact ? <SelectionHint /> : null}
      {pick && chosen.length && !compact ? <SelectionBar picks={chosen} page={filters.page} opener={opener} compareOpener={compareOpener} reviewOpener={reviewOpener}
        onReview={() => setReviewing(true)} onClear={() => setSelected(new Map())} onAdd={openPanel('add')} onCompare={openPanel('compare')} /> : null}
      {pick && reviewing && !compact ? (
        <ReviewSelection picks={chosen} onRemove={removePick} onClear={() => { setSelected(new Map()); setReviewing(false); }}
          onAdd={openPanel('add')} onCompare={openPanel('compare')} onClose={() => setReviewing(false)} returnFocusTo={reviewOpener} />
      ) : null}
      {pick && chosen.length && compact ? <PhoneSelection chosen={chosen} compareOpener={compareOpener}
        onRemove={removePick} onClear={() => setSelected(new Map())}
        onAdd={openPanel('add', compareOpener)} onCompare={openPanel('compare', compareOpener)} /> : null}
      <CoverageDisclosure coverage={shape?.coverage} />
      {sheet ? (
        <PhoneSheet title="Filters" opener={filtersOpener} onClose={() => setSheet(false)}>
          {filterPanel(true)}
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => change({ ...EMPTY_FILTERS, q: filters.q, sort: filters.sort, limit: filters.limit })} className={`${btn} flex-1`}>Reset all</button>
            <button type="button" onClick={() => setSheet(false)} className={`${primary} flex-1`}>Show results</button>
          </div>
        </PhoneSheet>
      ) : null}
      {panel ? (
        <Suspense fallback={null}>
          <AddToResearch kind="company" items={panel.items} mode={panel.mode} returnFocusTo={panel.back || undefined} onClose={() => setPanel(null)} />
        </Suspense>
      ) : null}
    </>
  );
}

const TABS = [
  { key: 'directory', label: 'Directory' },
  { key: 'analyses', label: 'Saved analyses' },
];

/** D7813: the ids a tab and its panel name each other by. */
export const tabId = (key) => `companies-tab-${key}`;
export const panelId = (key) => `companies-panel-${key}`;

/** D7813 (RS-17 E): the tab a key moves to from tab `i` — arrows wrap, Home and End go to the ends; else null. */
export function tabKeyTarget(key, i, n = TABS.length) {
  const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[key];
  return to == null ? null : to;
}

/**
 * D593 (the C0 board): the Directory tab carries the directory's size, from
 * the API's `coverage.of` — every company, not the filtered page — and no
 * number at all until one has been read. On Saved analyses, where the
 * directory is not mounted, one row is read for it.
 */
export function directoryTabLabel(total) {
  return Number.isFinite(total) ? `Directory (${total.toLocaleString('en-US')})` : 'Directory';
}

/** "Copy link to these results": the list parameters only — never the selection or who you are. */
export function CopyResultsLink({ search }) {
  const [said, setSaid] = useState(null);
  const copy = async () => {
    const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/research/companies${search}`;
    try {
      await navigator.clipboard.writeText(url);
      setSaid('Link copied. It carries the search, filters, sort and page, not your selection.');
    } catch {
      setSaid('Copy failed. The link in the address bar carries these results.');
    }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={copy} data-testid="button-copy-results-link" className={btn}>Copy link to these results</button>
      <span role="status" className="max-w-[320px] text-right text-[11px] text-axal-muted dark:text-gray-400">{said}</span>
    </div>
  );
}

function CompanyDirectoryZoneBody({ role = 'founder', zoneActions = null }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'analyses' ? 'analyses' : 'directory';
  const [total, setTotal] = useState(null);
  const onTotal = useCallback((n) => { if (Number.isFinite(n)) setTotal(n); }, []);
  useEffect(() => {
    if (tab !== 'analyses' || total != null) return undefined;
    let live = true;
    researchCompaniesApi.list({ limit: 1 })
      .then((data) => { if (live) onTotal(data?.coverage?.of ?? null); })
      .catch(() => {});
    return () => { live = false; };
  }, [tab, total, onTotal]);
  // D7179: the directory's parameters stay in the URL while Saved analyses is
  // open, so the Directory tab returns to the same results.
  const pick = (key) => {
    const next = new URLSearchParams(params);
    if (key === 'directory') { next.delete('tab'); next.delete('market'); next.delete('website'); } else next.set('tab', key);
    setParams(next, { replace: true });
  };
  // D7813: one tab stop (the selected tab); arrows, Home and End move and select.
  const tabRefs = useRef([]);
  const onTabKey = (e, i) => {
    const to = tabKeyTarget(e.key, i);
    if (to == null) return;
    e.preventDefault();
    pick(TABS[to].key);
    tabRefs.current[to]?.focus();
  };
  return (
    <div data-testid="company-directory" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Companies</h1>
          <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400">
            Find companies in a market, open a profile and come back to the same results. A public discovery baseline: <PublisherBoundary />.
          </p>
        </div>
        {tab === 'directory' ? <CopyResultsLink search={resultsSearch(filtersFromSearch(params))} /> : null}
      </div>
      <div className="flex flex-wrap items-end gap-x-3 border-b border-axal-hairline dark:border-gray-800">
        <div role="tablist" aria-label="Companies" className="flex gap-1">
          {TABS.map((t, i) => (
            <button key={t.key} type="button" role="tab" id={tabId(t.key)} aria-controls={panelId(t.key)} aria-selected={tab === t.key}
              tabIndex={tab === t.key ? 0 : -1} ref={(node) => { tabRefs.current[i] = node; }}
              onClick={() => pick(t.key)} onKeyDown={(e) => onTabKey(e, i)}
              className={`-mb-px min-h-[44px] border-b-2 px-3 py-2 text-[12.5px] font-semibold lg:min-h-0 ${tab === t.key ? 'border-violet-700 text-violet-800 dark:text-violet-200' : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}>
              {t.key === 'directory' ? directoryTabLabel(total) : t.label}
            </button>
          ))}
        </div>
        {total != null ? <span className="pb-2 text-[11px] text-axal-faint dark:text-gray-500">The tab count is the whole directory, not your results</span> : null}
      </div>
      {/* D7813: each tab names its panel; the panel not shown stays an empty, hidden tabpanel so both names resolve. */}
      {TABS.map((t) => (
        <div key={t.key} role="tabpanel" id={panelId(t.key)} aria-labelledby={tabId(t.key)} hidden={tab !== t.key} className="space-y-4">
          {tab !== t.key ? null : t.key === 'directory' ? (
            <>
              <Directory role={role} zoneActions={zoneActions} onTotal={onTotal} />
              <p className="text-[11px] leading-relaxed text-axal-faint dark:text-gray-500">
                <strong>Source boundary:</strong> <PublisherBoundary attribution />. Website links are references. Funding, revenue, headcount and market share appear only where a named source records them, with that source and its date. What no source holds reads “Not recorded”.
              </p>
            </>
          ) : (
            <Suspense fallback={<Card><p className="text-[12.5px] text-axal-muted">Loading saved analyses…</p></Card>}>
              <CompetitorAnalysis chromeless role={role} linkToDossier />
            </Suspense>
          )}
        </div>
      ))}
    </div>
  );
}

export default function CompanyDirectoryZone(props) { return <CompanyPublisherProvider><CompanyDirectoryZoneBody {...props} /></CompanyPublisherProvider>; }
