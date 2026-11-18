import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowUpDown, ExternalLink, Search, SlidersHorizontal } from 'lucide-react';
import { Card, Skeleton, Unrecorded } from '../../ui';
import Sheet from '../../ui/Sheet.jsx';
import { researchFundsApi } from '../../lib/api/researchFunds.js';
import {
  EMPTY_QUERY, GEOGRAPHY_REASON, PAGE_SIZES, SIZE_CURRENCIES, SORT_OPTIONS, STAGE_REASON, VERDICT_LABELS,
  activeFilters, backingOf, citationOf, coverageRows, directoryLine, directoryTotalOf, formatCount, matchLine, pageInfo, pageList,
  queryFromSearch, recorded, removeFilter, restoredLine, searchFromQuery, showUnsized, showUnsizedLabel, sizeExclusion, sizeOf,
  sortLabel, sortShort, toParams, vehicleLabel, zeroHint,
} from './fundDirectoryRead';
import { FUNDS_FILTERS_DROPPED, consumeFundsReturn } from '../../lib/pendingNext.js';
import { canAddToResearch } from './researchComparisons.js';
import { ACTIONS, UNAVAILABLE, WITHDRAWN, day, reportedSize, rereadBeforeAction } from './fundProfileRead.js';
import { ProposedFields, SourceChip, SourceDatesCard, StateChip } from './FundProvenance.jsx';
import ResearchActions from './ResearchActions.jsx';

const AddToResearch = lazy(() => import('./AddToResearch.jsx'));

/**
 * Research · Funds — the fund directory, to `design/incoming/Research · Funds.dc.html`
 * (D535, #1081 steps 4–5).
 *
 * THE SERVER DOES THE WORK. Search, the five filters, the sort and the page
 * all go to `GET /api/research/fund-directory`; this file never filters a
 * list itself. The count line prints the API's `total`, the header its
 * `coverage.total`, and the footer its `sources` — the canvas's "2,032 funds
 * from two lists" was a figure frozen into a picture, and it went stale the
 * day migration 378 landed.
 *
 * A SIZE ONLY IN A KNOWN CURRENCY. The Worker marks a size `EUR` only on the
 * list whose currency is recorded; every other row reads "Not recorded" with
 * the API's reason, and is never banded, sorted or summed with the euro rows.
 * Stage has no store at all, so it reads "Not recorded" with that reason.
 *
 * FOUR STATES, and only the results swap between them: search and filters
 * stay usable while the read is loading, failed or empty. A failed read reads
 * "Unreadable" and shows no rows and no count — a failed read is not zero
 * funds.
 *
 * SIGNED IN. The canvas draws a public top bar with "Sign in"; this page sits
 * inside the app's WorkspaceShell instead, whose zone row is the section tabs.
 *
 * THE FUNDS PAGE'S DIRECTORY TAB (D593, `?view=directory`). "Add to my funds"
 * puts a fund on the founder's own list, and the drawer then holds "Open your
 * dossier →" where the button was. FundsZone draws "Where the money is" in
 * the `band` slot and hears `coverage.total` for the tab's count.
 *
 * EVERY FUND CITES ITS LIST (D597, #1232). The row, the drawer and the profile
 * name the list, its publisher and its terms verdict, linked to where the
 * list is published. A list taken down for its terms is never served; the
 * footer names it and says why (`removed_sources`).
 *
 * D7167 (#7167, FND-P01, FND-P07): the detail Sheet starts with the vehicle,
 * its manager, vintage and dated, native-currency reported size, cites one
 * provenance object with its three dates, and offers the three action names.
 * It shows only what its own read answered: while loading, no facts and no
 * action; on a failed read, Unavailable with Retry; on a 410, or a 410 met
 * when Save, Add or Compare re-reads the fund, the facts are cleared and the
 * actions removed.
 *
 * RESULTS FIRST, ONE ROW PER VEHICLE (D7166, #7166, boards RFD-00 to RFD-05).
 * Search, filters, sort, the active chips and the count come first: "N fund
 * vehicles match" beside the unfiltered total, announced politely. Coverage,
 * the lists and "Where the money is" sit in a closed disclosure below the
 * results. A row names the vehicle from `fund_number` and its manager under
 * it; a size reads in its list's own currency, and the size filter works in
 * one currency and says how many funds it leaves out. On a phone the rows are
 * cards and nothing scrolls sideways. "Save to shortlist" is the add's name.
 * A link opened with filters says so; Back to results from a full profile
 * returns to the same query with the row selected and focused.
 *
 * PART 2 (D7166-p2). On a phone, Sort and Filters sit in a bar in thumb reach
 * (RFD-03A); Filters opens a full-height sheet holding every filter, the size
 * in one currency at a time, Clear all, and "Show N fund vehicles" (RFD-03B).
 * Filters apply as they change, as on desktop, so N is the live answer. The
 * size filter's line ends in "Show them" (RFD-02), the matches it leaves out
 * (`size_band=none`). Arriving signed in at the Directory link the sign-in
 * guard kept, the page says once, politely, "Signed in. This is the search you
 * opened." and focus lands on the results heading (RFD-04B, RFD-06).
 */

const SELECT = 'w-full rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const LABEL = 'mb-1 block text-[11px] font-semibold text-axal-muted';
const DT = 'text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint';
const TH = 'px-3 py-2.5 text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint';
const GHOST = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-axal-hairline px-3 py-2 text-[12px] font-semibold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';
const CHIP = 'inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200';

const safeHref = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);

/** The red read-failed badge. D7167: the Platform States word is "Unavailable" (D5129). */
export function UnreadableBadge() {
  return (
    <span className="inline-flex items-center rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      {UNAVAILABLE}
    </span>
  );
}

/** "Not recorded", with the reason printed beneath it. */
export function NotRecorded({ reason }) {
  return (
    <span className="block">
      <span className="inline-flex items-center rounded-md border border-axal-hairline bg-axal-ground px-2 py-0.5 text-[11px] font-semibold text-axal-muted dark:border-gray-700 dark:bg-gray-900">
        Not recorded
      </span>
      {reason ? <span className="mt-1 block text-[11.5px] text-axal-faint">{reason}</span> : null}
    </span>
  );
}

function Backing({ item, long = false }) {
  const b = backingOf(item);
  if (b.kind === 'named') {
    return (
      <span className="flex flex-wrap gap-1">
        {b.named.map((n) => <span key={n} className={CHIP}>{long ? `${n} named in notable LPs` : n}</span>)}
      </span>
    );
  }
  if (b.kind === 'neither') return <span className="text-[12px] text-axal-muted">Neither named{long ? ' in the notable LPs' : ''}</span>;
  return long
    ? <NotRecorded reason="With no LPs listed, EIF and EIFO backing is unknown, not absent." />
    : <Unrecorded reason="No notable LPs are recorded, so EIF and EIFO backing is unknown">Not recorded</Unrecorded>;
}

/**
 * One vehicle's facts, as the Sheet shows them (FND-P01): the dated reported
 * size in its own currency with its source chip first, then vintage, manager
 * HQ (where the manager is based, not where it invests), stated focus and the
 * proposed fields, each absent one "Not recorded" with its reason. The
 * reported-size history is the profile's (FND-P02), drawn per vehicle there;
 * the old per-manager report list mixed vehicles and is not shown here.
 */
export function FundDetails({ item }) {
  const size = reportedSize(item);
  const website = safeHref(item.website);
  const linkedin = safeHref(item.linkedin);
  const reported = day(item.provenance?.reported_on || item.fund_date);
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[minmax(110px,auto)_minmax(0,1fr)] items-baseline gap-x-4 gap-y-3 text-[12.5px]">
        <dt className={DT}>Reported size</dt>
        <dd className="m-0">
          {size.text
            ? <><span className="font-mono text-[15px] font-semibold text-axal-ink dark:text-gray-100">{size.text} <span className="text-[11px] text-axal-muted">{size.currency}</span></span>
              <span className="block text-[11.5px] text-axal-faint">{reported ? `Reported ${reported}` : 'Reported date not recorded'}{recorded(item.quarter) ? ` · ${item.quarter}` : ''}</span>
              {item.provenance ? <span className="mt-1 block"><SourceChip provenance={item.provenance} /></span> : null}</>
            : <NotRecorded reason={size.reason === 'Not recorded' ? 'The list records no size for this vehicle.' : size.reason} />}
        </dd>
        <dt className={DT}>Vintage</dt>
        <dd className="m-0">{item.fund_year != null ? <span className="font-mono">{item.fund_year}</span> : <NotRecorded reason="The list records no vintage for this vehicle." />}</dd>
        <dt className={DT}>Manager HQ</dt>
        <dd className="m-0">{recorded(item.hq) ? <>{item.hq}<span className="block text-[11.5px] text-axal-faint">Where the manager is based, not where it invests</span></> : <NotRecorded reason="The list records no HQ for this manager." />}</dd>
        <dt className={DT}>Stated focus</dt>
        <dd className="m-0">{recorded(item.sector_focus) ? item.sector_focus : <NotRecorded reason="The list states no focus for this vehicle." />}</dd>
      </dl>
      {item.proposed
        ? <ProposedFields proposed={item.proposed} />
        : <dl className="grid grid-cols-[minmax(110px,auto)_minmax(0,1fr)] items-baseline gap-x-4 gap-y-3 text-[12.5px]">
          <dt className={DT}>Investment stage</dt><dd className="m-0"><NotRecorded reason={STAGE_REASON} /></dd>
          {/* D7166: no list records where a fund invests. */}
          <dt className={DT}>Investment geography</dt><dd className="m-0"><NotRecorded reason={GEOGRAPHY_REASON} /></dd>
        </dl>}
      <dl className="grid grid-cols-[minmax(110px,auto)_minmax(0,1fr)] items-baseline gap-x-4 gap-y-3 text-[12.5px]">
        <dt className={DT}>Notable LPs</dt>
        <dd className="m-0">{recorded(item.notable_lps) ? item.notable_lps : <NotRecorded reason="The list names no LPs for this vehicle." />}</dd>
        <dt className={DT}>EIF / EIFO</dt>
        <dd className="m-0"><Backing item={item} long /></dd>
        <dt className={DT}>Vehicle</dt>
        <dd className="m-0">{recorded(item.fund_number) ? `${vehicleLabel(item).vehicle} · managed by ${item.name}` : <NotRecorded reason="The source names no fund number, so this row is the manager's." />}</dd>
        <dt className={DT}>Label in the list</dt>
        <dd className="m-0">{recorded(item.fund_number) ? item.fund_number : <NotRecorded />}</dd>
        <dt className={DT}>Website</dt>
        <dd className="m-0">{website ? <a href={website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-axal-violet dark:text-violet-300">{website.replace(/^https?:\/\//i, '')} <ExternalLink size={12} /></a> : <NotRecorded />}</dd>
        <dt className={DT}>LinkedIn</dt>
        <dd className="m-0">{linkedin ? <a href={linkedin} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-axal-violet dark:text-violet-300">LinkedIn page <ExternalLink size={12} /></a> : <NotRecorded />}</dd>
      </dl>
      {item.provenance ? <SourceDatesCard provenance={item.provenance} reason={item.source?.reason} /> : <SourceCard item={item} />}
    </div>
  );
}

/**
 * D597 — the drawer's and the profile's source: the list, its publisher, its
 * terms verdict with the reason, and a link to where it is published.
 */
export function SourceCard({ item }) {
  const c = citationOf(item);
  return (
    <div data-testid="fund-source-card" className="rounded-lg border border-axal-hairline bg-axal-ground p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Source</div>
      <div className="mt-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{c.name || <NotRecorded reason="The directory names no list for this fund." />}</div>
      <div className="text-[11.5px] text-axal-muted">Published by {c.publisher || <Unrecorded>Not recorded</Unrecorded>}</div>
      <div className="text-[11.5px] text-axal-muted">Terms: <span className="font-semibold">{c.terms}</span>{c.reason ? <span className="block text-axal-faint">{c.reason}</span> : null}</div>
      <div className="text-[11.5px] text-axal-faint">as of {item.as_of || 'an unrecorded date'}</div>
      {c.href && <a href={c.href} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-axal-violet dark:text-violet-300">View the list <ExternalLink size={12} /></a>}
    </div>
  );
}

/** D597 — the row's source line: the list, linked, its publisher and terms verdict. */
export function SourceLine({ item }) {
  const c = citationOf(item);
  return (
    <div data-testid="fund-source-line" className="max-w-[320px] truncate text-[11px] text-axal-faint">
      Source: {c.href
        ? <a href={c.href} target="_blank" rel="noreferrer" className="font-semibold text-axal-violet dark:text-violet-300">{c.name || 'the list'}</a>
        : (c.name || 'Not recorded')}
      {` · ${c.publisher || 'publisher not recorded'} · ${c.terms === 'Not recorded' ? 'terms not recorded' : c.terms.toLowerCase()}`}
    </div>
  );
}

/** A facet's options, "label (count)", with "not recorded" last; a chosen value stays listed. */
function facetOptions(list, value) {
  const items = list ? [...list] : [];
  if (value && !items.some((x) => x.value === value)) items.push({ value, label: value === 'none' ? 'Not recorded' : value, count: null });
  return items.map((x) => (
    <option key={x.value} value={x.value}>{x.count == null ? x.label : `${x.label} (${formatCount(x.count)})`}</option>
  ));
}

/**
 * The five filters, from the facets the API answered. `idp` prefixes every id, so the desktop row and the phone's
 * sheet can both be in the page. `stacked` is the sheet's layout (RFD-03B): one filter a row, the size currency as
 * two radio buttons, EIF and EIFO as checkboxes with 44px targets.
 */
function FilterFields({ idp, query, onQuery, facets, stacked = false }) {
  const ccy = query.size_currency || 'EUR';
  const box = stacked ? 'min-w-0 basis-full' : 'min-w-0 flex-1 basis-[200px]';
  const tall = stacked ? ' min-h-[44px]' : '';
  const select = (id, label, value, key, any, list) => (
    <div className={box}>
      <label htmlFor={`${idp}-${id}`} className={LABEL}>{label}</label>
      <select id={`${idp}-${id}`} className={`${SELECT}${tall}`} value={value} onChange={(e) => onQuery({ [key]: e.target.value })}>
        <option value="">{any}</option>
        {facetOptions(list, value)}
      </select>
    </div>
  );
  return (
    <>
      {select('hq', 'Manager HQ', query.hq_country, 'hq_country', 'All HQs', facets?.hq_country)}
      {select('focus', 'Stated focus', query.focus, 'focus', 'Any focus', facets?.focus)}
      {/* D7166: the size filter works in one currency (the existing size_min and size_max, in millions). */}
      <fieldset className={`m-0 min-w-0 border-0 p-0 ${stacked ? 'basis-full' : 'flex-1 basis-[260px]'}`}>
        <legend className={LABEL}>{stacked ? 'Size · one currency at a time' : `Size · ${ccy} only`}</legend>
        {stacked ? (
          <div className="mb-2 inline-flex rounded-lg border border-axal-hairline p-0.5 dark:border-gray-700" role="radiogroup" aria-label="Size currency">
            {SIZE_CURRENCIES.map(([v, l]) => (
              <label key={v} title={l}
                className={`inline-flex min-h-[40px] min-w-[64px] cursor-pointer items-center justify-center rounded-md px-3 text-[12.5px] font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-violet-600 dark:has-[:focus-visible]:ring-violet-400 ${ccy === v ? 'bg-violet-700 text-white dark:bg-violet-600 dark:text-white' : 'text-axal-ink dark:text-gray-100'}`}>
                <input type="radio" className="sr-only" name={`${idp}-size-currency`} value={v} checked={ccy === v}
                  onChange={() => onQuery({ size_currency: v })} />
                {v}
              </label>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          {stacked ? null : (
            <select aria-label="Size currency" className={`${SELECT.replace('w-full ', '')} w-[88px] shrink-0`} value={ccy}
              onChange={(e) => onQuery({ size_currency: e.target.value })}>
              {SIZE_CURRENCIES.map(([v, l]) => <option key={v} value={v} title={l}>{v}</option>)}
            </select>
          )}
          <input id={`${idp}-size-min`} type="text" inputMode="decimal" aria-label={`Size from, in millions of ${ccy}`} placeholder="From (M)"
            className={`${SELECT} min-w-0${tall}`} value={query.size_min} onChange={(e) => onQuery({ size_min: e.target.value.replace(/[^\d.]/g, ''), size_band: '' })} />
          <input id={`${idp}-size-max`} type="text" inputMode="decimal" aria-label={`Size to, in millions of ${ccy}`} placeholder="To (M)"
            className={`${SELECT} min-w-0${tall}`} value={query.size_max} onChange={(e) => onQuery({ size_max: e.target.value.replace(/[^\d.]/g, ''), size_band: '' })} />
        </div>
      </fieldset>
      {select('vint', 'Vintage', query.vintage, 'vintage', 'Any vintage', facets?.vintage)}
      <fieldset className="m-0 min-w-0 basis-full border-0 p-0">
        <legend className={LABEL}>Backed by, as named in notable LPs</legend>
        <div className={stacked ? 'flex flex-col items-start gap-2' : 'flex flex-wrap gap-2'}>
          {[['eif', 'EIF (European Investment Fund)'], ['eifo', 'EIFO (Denmark’s Export and Investment Fund)']].map(([k, l]) => (
            <label key={k} className={`inline-flex cursor-pointer items-center gap-2 rounded-full border border-axal-hairline px-3 py-1.5 text-[12px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100${tall}`}>
              <input type="checkbox" className="accent-violet-700" checked={!!query[k]} onChange={(e) => onQuery({ [k]: e.target.checked })} />
              {l}{facets?.[k] ? <span className="font-normal text-axal-faint">({formatCount(facets[k].backed)})</span> : null}
            </label>
          ))}
        </div>
      </fieldset>
      {facets && (
        <p className="basis-full text-[11px] text-axal-faint">
          {`Sizes compare in ${ccy} only: ${formatCount(facets.size_not_comparable || 0)} matching ${Number(facets.size_not_comparable) === 1 ? 'fund has' : 'funds have'} no size in ${ccy === 'USD' ? 'US dollars' : 'euros'} and sit outside the size filter.`}
          {facets.eif ? ` ${formatCount(facets.eif.unknown)} list no notable LPs, so their EIF backing is unknown.` : ''}
        </p>
      )}
    </>
  );
}

/**
 * Search, sort and the filters. On a phone only the search is here: Sort and Filters move to the thumb bar
 * (`PhoneBar`) and the filters to their sheet (`FilterSheet`), RFD-03.
 */
function Filters({ search, onSearch, query, onQuery, facets }) {
  return (
    <Card padding="md">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-[1_1_320px]">
          <label htmlFor="fd-q" className={LABEL}>Search fund vehicles or managers</label>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-2.5 text-axal-faint" aria-hidden="true" />
            <input id="fd-q" type="search" placeholder="e.g. Dawn Capital" value={search} onChange={(e) => onSearch(e.target.value)}
              className={`${SELECT} pl-9`} />
          </div>
        </div>
        <div className="hidden min-w-[200px] flex-[0_1_260px] sm:block">
          <label htmlFor="fd-sort" className={LABEL}>Sort by</label>
          <select id="fd-sort" className={SELECT} value={query.sort} onChange={(e) => onQuery({ sort: e.target.value })}>
            {SORT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <div id="fd-filters" className="mt-3 hidden flex-wrap items-end gap-3 sm:flex">
        <FilterFields idp="fd" query={query} onQuery={onQuery} facets={facets} />
      </div>
    </Card>
  );
}

/**
 * D7166 part 2 (RFD-03A): Sort and Filters in thumb reach on a phone. The bar sticks to the bottom of the screen,
 * above the phone tab bar (`--mobile-tabbar-h`), while the Directory scrolls under it; at 640px and up the desktop
 * row holds both and the bar is not drawn.
 */
function PhoneBar({ query, active, onSort, onFilters }) {
  return (
    <div data-testid="fund-directory-phone-bar"
      className="sticky bottom-[calc(var(--mobile-tabbar-h,0px)+12px)] z-20 flex gap-2 rounded-2xl border border-axal-hairline bg-white/95 p-2 shadow-[0_8px_30px_rgba(24,24,27,.18)] sm:hidden dark:border-gray-700 dark:bg-gray-900/95">
      <button type="button" aria-haspopup="dialog" onClick={onSort} aria-label={`Sort · ${sortShort(query.sort)}: ${sortLabel(query.sort)}`}
        className={`${GHOST} min-h-[48px] flex-1 bg-white dark:bg-gray-900`}>
        <ArrowUpDown size={14} aria-hidden="true" /> {`Sort · ${sortShort(query.sort)}`}
      </button>
      <button type="button" aria-haspopup="dialog" onClick={onFilters}
        className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-700 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-violet-800 dark:bg-violet-600 dark:text-white dark:hover:bg-violet-500">
        <SlidersHorizontal size={14} aria-hidden="true" /> {active ? `Filters · ${formatCount(active)}` : 'Filters'}
      </button>
    </div>
  );
}

/** "Show 11 fund vehicles", from the live answer; no number while the read is out or failed. */
export function showLabel(result) {
  const n = result?.data?.total;
  if (result?.loading || result?.error || typeof n !== 'number') return 'Show results';
  return `Show ${formatCount(n)} fund ${n === 1 ? 'vehicle' : 'vehicles'}`;
}

/**
 * D7166 part 2 (RFD-03B): the phone's full-height filter sheet. A full-screen page below 640px (`Sheet`'s
 * phone="full"), named "Filters", with Clear all in its head and "Show N fund vehicles" in thumb reach. Filters
 * apply as they change, so N is the API's answer; the count is also said politely inside the sheet, since the page
 * behind it is inert. Escape, × or Show close it, and focus returns to the Filters button.
 */
function FilterSheet({ query, onQuery, facets, result, active, onClear, onClose }) {
  const total = result?.data?.total;
  const answered = !result?.loading && !result?.error && typeof total === 'number';
  return (
    <Sheet title="Filters" onClose={onClose} width={480} phone="full" testId="fd-filter-sheet"
      headerActions={active > 0 ? <button type="button" onClick={onClear}
        className="min-h-[36px] rounded-lg px-2 text-[12.5px] font-semibold text-axal-violet underline hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/30">Clear all</button> : null}
      footer={<button type="button" onClick={onClose} data-testid="fd-filter-sheet-show"
        className="inline-flex min-h-[48px] w-full items-center justify-center rounded-lg bg-violet-700 px-3 py-2 text-[13px] font-semibold text-white hover:bg-violet-800 dark:bg-violet-600 dark:text-white dark:hover:bg-violet-500">{showLabel(result)}</button>}>
      <div className="flex flex-col gap-4 px-5 pb-5 pt-4">
        <p role="status" className="sr-only">{answered ? `${matchLine(result.data).match}, ${matchLine(result.data).of}.` : ''}</p>
        <FilterFields idp="fds" query={query} onQuery={onQuery} facets={facets} stacked />
      </div>
    </Sheet>
  );
}

/** D7166 part 2 (RFD-03A): the phone's Sort, a bottom sheet of the six orders. A choice applies at once. */
function SortSheet({ query, onQuery, onClose }) {
  return (
    <Sheet title="Sort" onClose={onClose} width={480} phone="sheet" testId="fd-sort-sheet"
      footer={<button type="button" onClick={onClose} className={`${GHOST} min-h-[48px] w-full`}>Done</button>}>
      <fieldset className="m-0 border-0 px-5 py-3">
        <legend className="sr-only">Sort results by</legend>
        {SORT_OPTIONS.map(([v, l]) => (
          <label key={v} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-2 text-[13px] text-axal-ink hover:bg-violet-50 dark:text-gray-100 dark:hover:bg-violet-950/30">
            <input type="radio" name="fd-sort-phone" className="accent-violet-700" value={v} checked={query.sort === v} onChange={() => onQuery({ sort: v })} />
            {l}
          </label>
        ))}
      </fieldset>
    </Sheet>
  );
}

/**
 * D7166 part 2 (RFD-06 row 5): a removed chip hands focus to the chip that took its place, else Clear all, else the
 * search, once the page has drawn the shorter row.
 */
export function focusAfterChip(index) {
  if (typeof document === 'undefined') return;
  setTimeout(() => {
    const row = document.querySelector('[data-testid="fund-directory-chips"]');
    const buttons = row ? [...row.querySelectorAll('button')] : [];
    (buttons[Math.min(index, buttons.length - 1)] || document.getElementById('fd-q'))?.focus();
  }, 0);
}

function CoverageCard({ coverage, sources }) {
  const rows = coverageRows(coverage);
  const total = coverage?.total || 0;
  const unknown = coverage?.fields?.size_unknown_currency || 0;
  return (
    <Card padding="md" data-testid="fund-directory-coverage">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-extrabold tracking-tight">What the fund lists record</h3>
        <p className="text-[11.5px] text-axal-faint">
          Funds with each field filled, of {formatCount(total)} · <span className="font-mono">research_fund_directory</span> · as of {coverage?.as_of || 'an unrecorded date'}
        </p>
      </div>
      <div className="mt-3 grid gap-x-7 gap-y-3 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex justify-between gap-3 text-[12.5px]">
              <span className="text-axal-muted">{r.label}</span>
              <span className="font-mono text-axal-ink dark:text-gray-100">{formatCount(r.n)}<span className="text-axal-faint"> / {formatCount(total)}</span></span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded bg-axal-ground dark:bg-gray-800">
              <div className="h-full min-w-[2px] rounded bg-violet-600" style={{ width: `${total ? (r.n / total) * 100 : 0}%` }} />
            </div>
          </div>
        ))}
        <div>
          <div className="flex justify-between gap-3 text-[12.5px]">
            <span className="text-axal-muted">Stage</span>
            <Unrecorded reason={STAGE_REASON}>Not recorded</Unrecorded>
          </div>
          <p className="mt-1 text-[11px] text-axal-faint">{STAGE_REASON}</p>
        </div>
        {/* D7166 part 2 (RFD-02D): no list records where a fund invests, so it is no bar and no filter. */}
        <div data-testid="fund-directory-geography">
          <div className="flex justify-between gap-3 text-[12.5px]">
            <span className="text-axal-muted">Investment geography</span>
            <Unrecorded reason={GEOGRAPHY_REASON}>Not recorded</Unrecorded>
          </div>
          <p className="mt-1 text-[11px] text-axal-faint">No list records it, so it is not offered as a filter.</p>
        </div>
      </div>
      {unknown > 0 && (
        <p className="mt-3 text-[11.5px] text-axal-muted">
          {formatCount(unknown)} more {unknown === 1 ? 'fund holds' : 'funds hold'} a size from {(sources || []).filter((s) => !s.size_currency).length === 1 ? 'a list' : 'lists'} whose currency is not recorded. Those sizes are not shown, banded or sorted until the currency is known.
        </p>
      )}
    </Card>
  );
}

function SourcesList({ data }) {
  return (
    <div data-testid="fund-directory-sources" className="text-[11.5px] leading-relaxed text-axal-faint">
      <p className="font-semibold text-axal-muted">Sources ({formatCount(data.sources?.length || 0)})</p>
      <ul className="mt-1 space-y-0.5">
        {(data.sources || []).map((s) => {
          const href = safeHref(s.published_url) || safeHref(s.url);
          return (
            <li key={s.name}>
              {href ? <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-axal-violet dark:text-violet-300">{s.title || s.name}</a> : (s.title || s.name)}
              {` · ${formatCount(s.rows)} funds · as of ${s.as_of || 'an unrecorded date'} · `}
              {s.size_currency ? `sizes in ${s.size_currency}` : 'size currency not recorded, so no size is shown'}
              {` · ${s.publisher ? `published by ${s.publisher}` : 'publisher not recorded'} · terms: ${VERDICT_LABELS[s.verdict] || 'Not recorded'}`}
              {s.reason ? <span className="block">{s.reason}</span> : null}
            </li>
          );
        })}
      </ul>
      {(data.removed_sources || []).length > 0 && (
        <div data-testid="fund-directory-removed" className="mt-2">
          <p className="font-semibold text-axal-muted">Removed ({formatCount(data.removed_sources.length)})</p>
          <ul className="mt-1 space-y-0.5">
            {data.removed_sources.map((s) => {
              const href = safeHref(s.published_url);
              return (
                <li key={s.name}>
                  {href ? <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-axal-violet dark:text-violet-300">{s.title || s.name}</a> : (s.title || s.name)}
                  {` was removed, with its ${formatCount(s.funds_withheld)} ${s.funds_withheld === 1 ? 'fund' : 'funds'}: ${s.reason}`}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {data.size_basis && <p className="mt-1">{data.size_basis}</p>}
      {data.source_boundary && <p>{data.source_boundary}</p>}
    </div>
  );
}

function Pager({ data, onQuery }) {
  const { page, pages } = pageInfo(data.offset, data.limit, data.total);
  const go = (p) => onQuery({ offset: (p - 1) * data.limit });
  return (
    <nav aria-label="Pages of funds" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[12px] text-axal-muted">Page <span className="font-mono text-axal-ink dark:text-gray-100">{formatCount(page)}</span> of <span className="font-mono text-axal-ink dark:text-gray-100">{formatCount(pages)}</span></p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={GHOST} disabled={page <= 1} onClick={() => go(page - 1)}>‹ Previous</button>
        {pageList(page, pages).map((p, i) => (p === '…'
          ? <span key={`gap${i}`} aria-hidden="true" className="px-1 py-2 text-axal-faint">…</span>
          : <button key={p} type="button" aria-current={p === page ? 'page' : undefined} onClick={() => go(p)}
            className={p === page ? `${GHOST} border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200` : GHOST}>{p}</button>))}
        <button type="button" className={GHOST} disabled={page >= pages} onClick={() => go(page + 1)}>Next ›</button>
      </div>
    </nav>
  );
}

/**
 * D593 — the shortlist action. D7167 names it "Save to shortlist" (FND-P04);
 * once the founder's own row exists, its place holds "Open dossier →" to
 * `/research/funds/:uid`. `dossier` is that row's uid, or null.
 *
 * `listState` is the founder's own list read: while it has not answered, or
 * after it failed, nothing here can tell whether the fund is already on it,
 * so no save is offered that could duplicate a row.
 */
function AddOrOpen({ item, dossier, added, busy, onAdd, listState }) {
  if (dossier) {
    return (
      <Link to={`/research/funds/${encodeURIComponent(dossier)}`} data-testid="fund-directory-open-dossier"
        className="inline-flex items-center justify-center rounded-lg bg-violet-700 px-3 py-2 text-[12px] font-semibold text-white hover:bg-violet-800 dark:bg-violet-600 dark:hover:bg-violet-500">
        {ACTIONS.open}
      </Link>
    );
  }
  if (listState === 'unreadable') {
    return (
      <span className="flex basis-full flex-wrap items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400">
        <UnreadableBadge /> Your shortlist could not be read, so this cannot tell whether the fund is on it.
      </span>
    );
  }
  if (listState === 'loading') {
    return <button type="button" className={GHOST} disabled>Checking your shortlist…</button>;
  }
  return (
    <button type="button" disabled={added || !!busy || !onAdd} onClick={() => onAdd && onAdd(item)} aria-busy={busy === item.uid || undefined}
      className="inline-flex items-center justify-center rounded-lg bg-violet-700 px-3 py-2 text-[12px] font-semibold text-white hover:bg-violet-800 disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500">
      {added ? 'Saved to shortlist' : busy === item.uid ? ACTIONS.saving : ACTIONS.save}
    </button>
  );
}

/** FND-P07 B: the source list was withdrawn; the facts are gone and no action is offered. */
export function WithdrawnPanel({ removed, during = false, reason = null }) {
  const href = safeHref(removed?.url);
  return (
    <div role="alert" data-testid="fd-drawer-withdrawn" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12.5px] dark:border-amber-800 dark:bg-amber-950/30">
      <StateChip kind="rf" />
      <p className="font-extrabold text-axal-ink dark:text-gray-100">{during ? WITHDRAWN.title : WITHDRAWN.read}</p>
      {during ? <p className="text-axal-muted dark:text-gray-300">{WITHDRAWN.body}</p> : <p className="text-axal-muted dark:text-gray-300">None of the fund’s own fields are shown.</p>}
      {(removed?.reason || reason) ? <p className="text-axal-muted dark:text-gray-300">{removed?.reason || reason}</p> : null}
      <p className="text-[11.5px] text-axal-faint">
        {removed?.title || removed?.name || 'The list'}{removed?.publisher ? ` · ${removed.publisher}` : ''} · Not allowed{removed?.reviewed_on ? ` · reviewed ${day(removed.reviewed_on)}` : ''}
      </p>
      {href ? <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-violet dark:text-violet-300">View the list <ExternalLink size={12} /></a> : null}
    </div>
  );
}

function Drawer({ item, drawer, onClose, onAdd, busy, isAdded, dossierOf, notice, listState, onRetry = () => {}, research = null, backTo = null }) {
  const fresh = drawer.data?.item || null;
  const added = isAdded(item);
  const v = vehicleLabel(item);
  const dossier = dossierOf(item);
  const note = notice && notice.uid === item.uid ? notice : null;
  const withdrawn = drawer.status === 410;
  const failed = !drawer.loading && !withdrawn && !!drawer.error;
  const sub = fresh ? [fresh.proposed?.manager_name?.status === 'recorded' ? `Managed by ${fresh.proposed.manager_name.value}` : v.manager !== v.vehicle ? `Managed by ${v.manager}` : null, fresh.fund_year != null ? `vintage ${fresh.fund_year}` : null].filter(Boolean).join(' · ') : null;
  const footer = fresh && !withdrawn && !failed ? (
    <div className="flex flex-wrap items-center gap-2">
      <AddOrOpen item={item} dossier={dossier} added={added} busy={busy} onAdd={onAdd} listState={listState} />
      {research ? research(fresh) : null}
      <Link to={`/research/funds/catalog/${encodeURIComponent(item.uid)}`} state={{ back: backTo, selected: item.uid }} className={GHOST}>{ACTIONS.profile}</Link>
    </div>
  ) : null;
  return (
    <Sheet label={`${v.vehicle} details`} eyebrow="Fund vehicle" title={v.vehicle} sub={sub || undefined} onClose={onClose} width={480} phone="sheet" testId="fd-drawer-sheet" footer={footer}>
      <div id="fd-drawer" className="px-5 pb-5 pt-1">
        {/* The save's outcome, beside the control that made it. Always in the
            tree, so a screen reader hears the sentence when it arrives. */}
        <p role="status" className={note ? `mt-2 text-[12px] font-semibold ${note.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}` : 'sr-only'}>
          {note ? note.text : ''}
        </p>
        <div className="mt-3">
          {drawer.loading && <p className="text-[12.5px] text-axal-muted" aria-busy="true">Loading this fund… No action is offered until the read answers.</p>}
          {withdrawn && <WithdrawnPanel removed={drawer.removed} reason={drawer.reason} during={!!drawer.during} />}
          {failed && (
            <div role="alert" data-testid="fd-drawer-unavailable" className="space-y-2">
              <StateChip kind="un" />
              <p className="text-[12.5px] text-axal-muted">This fund could not be read. Nothing is shown in its place, because an old copy would pass for the directory’s answer.</p>
              <button type="button" className={GHOST} onClick={onRetry}>Retry</button>
            </div>
          )}
          {fresh && !withdrawn && !failed && <FundDetails item={fresh} />}
        </div>
      </div>
    </Sheet>
  );
}

/**
 * The page, from props alone (the tests render it with react-dom/server).
 * `result` is { loading, error, data }: data is the API's answer.
 * `dossierOf(item)` is the uid of the founder's own row for that fund, or
 * null; `listState` is that list's read, 'ok', 'loading' or 'unreadable';
 * `notice` is the last add's outcome, `{ uid, ok, text }`, shown in that
 * fund's drawer; `band` is drawn under the coverage card, above the search
 * and the list (D593: "Where the money is").
 */
export function FundDirectoryView({
  query, onQuery, search, onSearch, result, facets, selected, onSelect, onClose, drawer = { loading: false, error: null, data: null },
  onAdd = null, busy = null, isAdded = () => false, dossierOf = () => null, listState = 'ok', notice = null, band = null,
  filtersOpen = false, onToggleFilters = () => {}, sortOpen = false, onToggleSort = () => {}, onShowUnsized = null,
  onRetry = () => {}, onClear = () => {}, onResearch = null,
  onRetryDrawer = () => {}, sheetResearch = null, backHref = null,
  opened = null, backTo = backHref || '/research/funds?view=directory',
}) {
  const { loading, error, data } = result;
  const active = activeFilters(query, facets);
  const reasons = data ? [...new Set(data.items.map((x) => sizeOf(x)).filter((s) => !s.text).map((s) => s.reason))] : [];
  const excluded = sizeExclusion(query, facets);
  const hint = data && data.total === 0 ? zeroHint(query, facets) : null;
  return (
    <section data-testid="fund-directory" className="space-y-4">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Fund directory</h2>
        <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-axal-muted">
          Find venture fund vehicles, check where each fact came from, and keep a shortlist. HQ, focus and notable LPs are shown as the sources wrote them; what no source holds reads “Not recorded”.
        </p>
        {/* D7166 (RFD-01B, RFD-04): how this list was opened. */}
        {/* D7166 part 2 (RFD-04B): arriving signed in at the link the guard kept. The region is in the tree from
            the first render and filled once the list answers, so it is announced once, politely. */}
        {opened === 'restored' && (
          <div role="status" data-testid="fund-directory-restored"
            className={data ? 'mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200' : 'sr-only'}>
            {data ? <><b>Signed in. This is the search you opened.</b>
              <span className="block text-[12px] text-emerald-800 dark:text-emerald-300">{restoredLine(query, facets, data)}</span></> : null}
          </div>
        )}
        {opened === 'link' && active.length > 0 && (
          <p data-testid="fund-directory-opened" className="mt-1 text-[12px] text-axal-muted">
            Opened from a link, with {formatCount(active.length)} {active.length === 1 ? 'filter' : 'filters'} applied.
          </p>
        )}
        {opened === 'dropped' && (
          <p data-testid="fund-directory-dropped" role="status" className="mt-1 text-[12px] text-axal-muted">
            Signed in. The link was too long to keep its filters, so this is the Directory without them.
          </p>
        )}
      </div>

      <Filters search={search} onSearch={onSearch} query={query} onQuery={onQuery} facets={facets} />

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="fund-directory-chips">
          <span className="text-[11px] font-semibold text-axal-muted">Active filters</span>
          {active.map((f, i) => (
            <button key={f.key} type="button" className={`${CHIP} gap-1.5 py-1.5`} onClick={() => { onQuery(removeFilter(f.key)); focusAfterChip(i); }}
              aria-label={`Remove filter ${f.label}`}>
              {f.label}<span aria-hidden="true">×</span>
            </button>
          ))}
          <button type="button" className="px-2 text-[12px] font-semibold text-axal-violet underline dark:text-violet-300" onClick={onClear}>Clear all</button>
        </div>
      )}

      {loading && (
        <Card padding="md" aria-busy="true" data-testid="fund-directory-loading">
          <p className="text-[13px] font-semibold">Loading funds…</p>
          <div className="mt-3 space-y-2" aria-hidden="true">{[0, 1, 2, 3].map((k) => <Skeleton key={k} className="h-3" />)}</div>
          <p className="mt-3 text-[11.5px] text-axal-faint">No count is shown until the read answers.</p>
        </Card>
      )}

      {!loading && error && (
        <Card padding="md" className="border-red-200 dark:border-red-900" data-testid="fund-directory-unreadable">
          <div className="flex items-center gap-2"><UnreadableBadge /><span className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Read failed</span></div>
          <p className="mt-2 text-[13px] font-semibold">The fund directory did not answer.</p>
          <p className="mt-1 text-[12.5px] text-axal-muted">{error} No rows and no count are shown, because a failed read is not zero funds.</p>
          <button type="button" className={`${GHOST} mt-3`} onClick={onRetry}>Try again</button>
        </Card>
      )}

      {!loading && !error && data && data.total === 0 && (
        <Card padding="md" data-testid="fund-directory-empty">
          <p className="text-[13px] font-semibold">
            {query.q || active.length
              ? `No fund vehicle matches${query.q ? ` “${query.q}”` : ''}${active.length ? ` with ${active.length === 1 ? 'this filter' : `these ${formatCount(active.length)} filters`}` : ''}.`
              : 'The fund directory holds no funds.'}
          </p>
          {hint
            ? <p className="mt-2 text-[12px] text-axal-muted" data-testid="fund-directory-hint">{hint.text}{' '}
              <button type="button" className="font-semibold text-axal-violet underline dark:text-violet-300" onClick={() => onQuery(removeFilter(hint.key))}>Remove it</button></p>
            : <p className="mt-2 text-[12px] text-axal-muted">About half the funds have no vintage or focus recorded, so those filters narrow fast.</p>}
          {(query.q || active.length > 0) && <button type="button" className={`${GHOST} mt-3`} onClick={onClear}>Clear all</button>}
        </Card>
      )}

      {!loading && !error && data && data.total > 0 && (
        <div className="space-y-3" data-testid="fund-directory-results">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h3 id="fd-results" tabIndex={-1} className="text-[14px] font-extrabold outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2 dark:focus-visible:ring-violet-400 dark:focus-visible:ring-offset-gray-950" aria-live="polite">{matchLine(data).match}</h3>
              <span className="text-[12px] text-axal-muted">{matchLine(data).of}</span>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="fd-rows" className="text-[12px] font-semibold text-axal-muted">Rows per page</label>
              <select id="fd-rows" className={`${SELECT} w-20`} value={query.limit} onChange={(e) => onQuery({ limit: Number(e.target.value) })}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          {/* D7166 part 2 (RFD-02): "Show them" swaps the size filter for its other side, the funds it left out. */}
          {excluded && (
            <p data-testid="fund-directory-excluded" className="text-[12px] text-axal-muted">
              {excluded}{' '}
              <button type="button" data-testid="fund-directory-show-unsized" aria-label={showUnsizedLabel(query, facets)}
                onClick={() => (onShowUnsized ? onShowUnsized() : onQuery(showUnsized()))}
                className="inline-flex min-h-[44px] items-center font-semibold text-axal-violet underline sm:min-h-0 dark:text-violet-300">Show them</button>
            </p>
          )}
          <div className="flex flex-wrap items-start gap-4">
            <Card padding="none" className="min-w-0 flex-[999_1_600px] overflow-hidden">
              {/* D7166 (RFD-03): on a phone the rows are cards; nothing scrolls sideways. */}
              <ul className="divide-y divide-axal-hairline sm:hidden dark:divide-gray-800" aria-labelledby="fd-results" data-testid="fund-directory-cards">
                {data.items.map((x) => {
                  const s = sizeOf(x);
                  const v = vehicleLabel(x);
                  const on = selected?.uid === x.uid;
                  return (
                    <li key={x.uid} className={`px-4 py-3 ${on ? 'bg-violet-50/70 dark:bg-violet-950/20' : ''}`}>
                      <button type="button" data-fund-uid={x.uid} className="min-h-[44px] w-full text-left" onClick={() => onSelect(x)}
                        aria-expanded={on ? 'true' : 'false'} aria-controls="fd-drawer">
                        <span className="block text-[14px] font-semibold text-axal-ink dark:text-gray-100">{v.vehicle}</span>
                        {v.manager !== v.vehicle && <span className="block text-[12px] text-axal-muted">{v.manager}</span>}
                        <span className="mt-1 block text-[12px] text-axal-muted">
                          {s.text ? <span className="font-mono text-axal-ink dark:text-gray-100">{s.text} {s.currency}</span> : 'Size not recorded'}
                          {` · ${x.fund_year != null ? x.fund_year : 'vintage not recorded'} · ${recorded(x.hq) ? x.hq : 'HQ not recorded'}`}
                        </span>
                      </button>
                      {isAdded(x) && <div className="text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300">Saved to shortlist</div>}
                      <SourceLine item={x} />
                    </li>
                  );
                })}
              </ul>
              <div className="hidden sm:block">
                <table className="w-full table-fixed text-left text-[12.5px]" aria-labelledby="fd-results">
                  <thead className="bg-axal-ground dark:bg-gray-950">
                    <tr>
                      <th scope="col" className={`${TH} w-[30%]`}>Fund vehicle · manager</th>
                      <th scope="col" className={`${TH} text-right`}>Reported size</th>
                      <th scope="col" className={`${TH} text-right`}>Vintage</th>
                      <th scope="col" className={TH}>Manager HQ</th>
                      <th scope="col" className={TH}>Stated focus</th>
                      <th scope="col" className={TH}>EIF / EIFO</th>
                      {onResearch ? <th scope="col" className={TH}><span className="sr-only">Research</span></th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-axal-hairline dark:divide-gray-800">
                    {data.items.map((x) => {
                      const s = sizeOf(x);
                      const v = vehicleLabel(x);
                      const on = selected?.uid === x.uid;
                      return (
                        <tr key={x.uid} className={on ? 'bg-violet-50/70 dark:bg-violet-950/20' : 'hover:bg-violet-50/40 dark:hover:bg-violet-950/10'}>
                          <td className="px-3 py-2.5 align-top">
                            <button type="button" data-fund-uid={x.uid} className="text-left text-[13px] font-semibold text-axal-ink hover:text-axal-violet hover:underline dark:text-gray-100"
                              onClick={() => onSelect(x)} aria-expanded={on ? 'true' : 'false'} aria-controls="fd-drawer">{v.vehicle}</button>
                            {v.manager !== v.vehicle && <div className="truncate text-[11.5px] text-axal-muted">{v.manager}</div>}
                            {isAdded(x) && <div className="text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300">Saved to shortlist</div>}
                            <SourceLine item={x} />
                          </td>
                          <td className="px-3 py-2.5 text-right align-top">{s.text
                            ? <span className="font-mono text-axal-ink dark:text-gray-100">{s.text}<span className="block text-[10.5px] text-axal-faint">{s.currency}</span></span>
                            : <Unrecorded reason={s.reason}>Not recorded</Unrecorded>}</td>
                          <td className="px-3 py-2.5 text-right align-top">{x.fund_year != null ? <span className="font-mono">{x.fund_year}</span> : <Unrecorded>Not recorded</Unrecorded>}</td>
                          <td className="break-words px-3 py-2.5 align-top text-axal-muted">{recorded(x.hq) ? x.hq : <Unrecorded>Not recorded</Unrecorded>}</td>
                          <td className="break-words px-3 py-2.5 align-top text-axal-muted">{recorded(x.sector_focus) ? x.sector_focus : <Unrecorded>Not recorded</Unrecorded>}</td>
                          <td className="px-3 py-2.5 align-top"><Backing item={x} /></td>
                          {/* D5157 part 3 (RS-05 A): the row's Add to my research, in the founder shell. */}
                          {onResearch ? (
                            <td className="px-3 py-2.5 text-right">
                              <button type="button" onClick={(e) => onResearch(x, e.currentTarget)} data-testid={`button-fund-research-${x.uid}`}
                                className="whitespace-nowrap rounded-lg px-2 py-1 text-[12px] font-semibold text-axal-violet underline hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/30">Add to my research</button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {reasons.length > 0 && (
                <div className="border-t border-axal-hairline px-3 py-2 text-[11px] text-axal-faint dark:border-gray-800">
                  {reasons.map((r) => <p key={r}>Size “Not recorded”: {r === 'Not recorded' ? 'the source lists no size for these funds.' : r.replace(/^Not recorded: /, '')}</p>)}
                </div>
              )}
            </Card>
          </div>
          <Pager data={data} onQuery={onQuery} />
        </div>
      )}

      <PhoneBar query={query} active={active.length} onSort={onToggleSort} onFilters={onToggleFilters} />
      {filtersOpen && (
        <FilterSheet query={query} onQuery={onQuery} facets={facets} result={result} active={active.length}
          onClear={onClear} onClose={onToggleFilters} />
      )}
      {sortOpen && <SortSheet query={query} onQuery={onQuery} onClose={onToggleSort} />}

      {/* D7166 (RFD-02): coverage, the lists and "Where the money is" below the results, closed until asked for. */}
      <details data-testid="fund-directory-disclosure" className="rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900">
        <summary className="flex min-h-[44px] cursor-pointer list-none flex-wrap items-baseline justify-between gap-2 px-4 py-3">
          <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">Source coverage and where the money is</span>
          {data ? <span className="text-[12px] text-axal-muted">{directoryLine(data.coverage, data.sources)} · what each field covers</span> : null}
        </summary>
        <div className="space-y-4 px-4 pb-4">
          {data?.coverage && <CoverageCard coverage={data.coverage} sources={data.sources} />}
          {band}
          {data && <SourcesList data={data} />}
        </div>
      </details>

      {/* D1317: the fund's details, the shared right-side Sheet over the list;
          a bottom sheet on a phone, as it was. */}
      {data && selected && (
        <Drawer item={selected} drawer={drawer} onClose={onClose} backTo={backTo}
          onAdd={onAdd} busy={busy} isAdded={isAdded} dossierOf={dossierOf} notice={notice} listState={listState}
          onRetry={onRetryDrawer} research={sheetResearch} />
      )}
    </section>
  );
}

const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * The live directory. `researchedNames` (normalized names on the founder's own
 * list), `onAdd`, `dossierOf`, `listState` and `notice` come from FundsZone,
 * which owns the shortlist. `onTotal` hears the whole directory's size
 * (`coverage.total`, or null) for the "Directory (N)" tab; `band` is drawn
 * above the list.
 */
export default function FundDirectory({
  researchedNames = new Set(), onAdd = null, busy = null, dossierOf = null, listState = 'ok', notice = null,
  onTotal = null, band = null, role = null,
}) {
  // D5157 part 3: Add to my research opens one panel, returning focus to its row's button.
  const [researching, setResearching] = useState(null);
  const researchOpener = useRef(null);
  // D4612: the list on screen is the one the address names, and every change
  // is written back (replacing the entry, so Back leaves the directory rather
  // than stepping through each filter).
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  // D7166 (RFD-01B, RFD-04): how the list was opened, read once — a link that
  // carried filters, or a sign-in return whose filters were too long to keep.
  const [opened, setOpened] = useState(() => (params.get(FUNDS_FILTERS_DROPPED) === '1' ? 'dropped'
    : activeFilters(queryFromSearch(params), null).length > 0 && !location.state?.selected ? 'link' : null));
  // D7166 part 2 (RFD-04B): the Directory link the sign-in guard kept, opened now signed in. Read once, as the page
  // first mounts; set only on a match, so a second run (StrictMode) cannot undo it. The too-long link keeps its own line.
  const [arrival] = useState(() => `${location.pathname}${location.search}`);
  // Set when the next answer should take focus to the results heading (the sign-in return, "Show them").
  const focusResults = useRef(false);
  useEffect(() => {
    if (location.state?.selected) return;
    if (consumeFundsReturn(arrival) && opened !== 'dropped') { setOpened('restored'); focusResults.current = true; }
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [query, setQuery] = useState(() => queryFromSearch(params));
  const [search, setSearch] = useState(() => queryFromSearch(params).q);
  useEffect(() => {
    const next = searchFromQuery(query, params);
    next.delete(FUNDS_FILTERS_DROPPED);
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
    // `params` is read, not followed: following it would undo a change before it is written.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  const [result, setResult] = useState({ loading: true, error: null, data: null });
  const [facets, setFacets] = useState(null);
  const [selected, setSelected] = useState(null);
  const [drawer, setDrawer] = useState({ loading: false, error: null, data: null });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const seq = useRef(0);
  const pickSeq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setResult((r) => ({ ...r, loading: true, error: null }));
    try {
      const data = await researchFundsApi.list(toParams(query));
      if (mine !== seq.current) return;
      setResult({ loading: false, error: null, data });
      setFacets(data.facets || null);
    } catch (e) {
      if (mine !== seq.current) return;
      setResult({ loading: false, error: e?.message || 'Unreadable.', data: null });
    }
  }, [query]);
  useEffect(() => { load(); }, [load]);

  // D7166 (RFD-04C): Back to results from a full profile names the row that was
  // open. Once the same list has answered, focus returns to that row.
  const [restore, setRestore] = useState(() => location.state?.selected || null);
  useEffect(() => {
    if (!restore || !result.data) return;
    setRestore(null);
    if (!result.data.items.some((x) => x.uid === restore)) return;
    const el = [...document.querySelectorAll('[data-fund-uid]')].find((b) => b.getAttribute('data-fund-uid') === restore && b.offsetParent !== null);
    el?.focus();
  }, [restore, result.data]);

  // D7166 part 2 (RFD-04B, RFD-06): after the sign-in return, or after "Show them" swapped the list, focus lands on
  // the results heading once the list answers; with no results, on the search.
  useEffect(() => {
    if (!focusResults.current || result.loading) return;
    focusResults.current = false;
    (document.getElementById('fd-results') || document.getElementById('fd-q'))?.focus();
  }, [result]);

  // The tab's N: the directory's own total from the read on screen, never a
  // filtered page's count, and nothing at all until a read has answered.
  const total = directoryTotalOf(result);
  useEffect(() => { if (onTotal) onTotal(total); }, [onTotal, total]);

  // The search box answers as you type, a beat after you stop.
  useEffect(() => {
    const t = setTimeout(() => setQuery((q) => (q.q === search ? q : { ...q, q: search, offset: 0 })), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Any change but a page turn goes back to the first page.
  const change = (patch) => setQuery((q) => ({ ...q, ...patch, offset: 'offset' in patch ? patch.offset : 0 }));
  const clear = () => { setSearch(''); setQuery({ ...EMPTY_QUERY, sort: query.sort, limit: query.limit }); };

  const pick = async (item) => {
    const mine = ++pickSeq.current;
    setSelected(item);
    setDrawer({ loading: true, error: null, data: null });
    try {
      const data = await researchFundsApi.get(item.uid);
      if (mine === pickSeq.current) setDrawer({ loading: false, error: null, data });
    } catch (e) {
      if (mine === pickSeq.current) {
        setDrawer({ loading: false, error: e?.message || UNAVAILABLE, status: e?.status ?? null, data: null,
          ...(e?.status === 410 ? { removed: e?.data?.removed || null, reason: e?.data?.reason || null } : {}) });
      }
    }
  };

  // D7167 (FND-P07 B): Save, Add and Compare re-read the fund first. A 410
  // clears the Sheet's facts and removes its actions; nothing is saved.
  const [checkNote, setCheckNote] = useState(null);
  const reread = async (uid) => {
    const r = await rereadBeforeAction(researchFundsApi.get, uid);
    if (r.withdrawn) {
      setDrawer({ loading: false, error: WITHDRAWN.read, status: 410, data: null, removed: r.removed, reason: r.reason, during: true });
      return false;
    }
    if (!r.ok) { setCheckNote({ uid, ok: false, text: r.message }); return false; }
    setCheckNote(null);
    return true;
  };
  const save = onAdd ? async (item) => { if (await reread(item.uid)) onAdd(item); } : null;

  return (
    <>
      <FundDirectoryView
        query={query} onQuery={change} search={search} onSearch={setSearch}
        result={result} facets={facets} selected={selected} onSelect={pick}
        onClose={() => { pickSeq.current += 1; setSelected(null); setCheckNote(null); }} drawer={drawer}
        onAdd={save} busy={busy}
        onRetryDrawer={() => selected && pick(selected)}
        sheetResearch={canAddToResearch(role) ? (x) => (
          <ResearchActions kind="fund" item={{ uid: x.uid, name: x.name }} addLabel={ACTIONS.add} compareLabel={ACTIONS.compare} beforeOpen={() => reread(x.uid)} />
        ) : null}
        isAdded={(x) => researchedNames.has(normalize(x.name))}
        dossierOf={dossierOf || (() => null)} listState={listState} notice={checkNote || notice} band={band}
        filtersOpen={filtersOpen} onToggleFilters={() => setFiltersOpen((o) => !o)}
        sortOpen={sortOpen} onToggleSort={() => setSortOpen((o) => !o)}
        onShowUnsized={() => { focusResults.current = true; change(showUnsized()); }}
        onRetry={load} onClear={clear}
        onResearch={canAddToResearch(role) ? (x, el) => { researchOpener.current = el; setResearching({ uid: x.uid, name: x.name }); } : null}
        opened={opened} backTo={`${location.pathname}${location.search}`}
      />
      {researching ? (
        <Suspense fallback={null}>
          <AddToResearch kind="fund" items={[researching]} mode="add" returnFocusTo={researchOpener} onClose={() => setResearching(null)} />
        </Suspense>
      ) : null}
    </>
  );
}
