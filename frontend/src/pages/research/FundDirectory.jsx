import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Search, SlidersHorizontal, X } from 'lucide-react';
import { Card, Skeleton, Unrecorded } from '../../ui';
import { researchFundsApi } from '../../lib/api/researchFunds.js';
import {
  EMPTY_QUERY, PAGE_SIZES, SIZE_BANDS, SORT_OPTIONS, STAGE_REASON,
  activeFilters, backingOf, coverageRows, directoryLine, directoryTotalOf, formatCount, pageInfo, pageList,
  rangeLabel, recorded, sizeOf, toParams,
} from './fundDirectoryRead';

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
 */

const SELECT = 'w-full rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const LABEL = 'mb-1 block text-[11px] font-semibold text-axal-muted';
const DT = 'text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint';
const TH = 'px-3 py-2.5 text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint';
const GHOST = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-axal-hairline px-3 py-2 text-[12px] font-semibold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';
const CHIP = 'inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200';

const safeHref = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);

/** The canvas's red "Unreadable" badge. */
export function UnreadableBadge() {
  return (
    <span className="inline-flex items-center rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      Unreadable
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
 * One fund's facts, as the drawer and the profile page both show them. Each
 * absent field reads "Not recorded" with its reason; nothing is inferred.
 */
export function FundDetails({ item, reports = null, reportsState = 'ok' }) {
  const size = sizeOf(item);
  const website = safeHref(item.website);
  const linkedin = safeHref(item.linkedin);
  const source = safeHref(item.source_url);
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[minmax(96px,auto)_minmax(0,1fr)] items-baseline gap-x-4 gap-y-3 text-[12.5px]">
        <dt className={DT}>Size</dt>
        <dd className="m-0">
          {size.text
            ? <><span className="font-mono text-[15px] font-semibold text-axal-ink dark:text-gray-100">{size.text}</span>
              {recorded(item.fund_date) ? <span className="block text-[11.5px] text-axal-faint">as reported on {item.fund_date}</span> : null}</>
            : <NotRecorded reason={size.reason === 'Not recorded' ? 'The source lists no size for this fund.' : size.reason} />}
        </dd>
        <dt className={DT}>Stage</dt>
        <dd className="m-0"><NotRecorded reason={STAGE_REASON} /></dd>
        <dt className={DT}>Vintage</dt>
        <dd className="m-0">{item.fund_year != null ? <span className="font-mono">{item.fund_year}</span> : <NotRecorded reason="The source lists no vintage for this fund." />}</dd>
        <dt className={DT}>HQ</dt>
        <dd className="m-0">{recorded(item.hq) ? item.hq : <NotRecorded reason="The source lists no HQ for this fund." />}</dd>
        <dt className={DT}>Stated focus</dt>
        <dd className="m-0">{recorded(item.sector_focus) ? item.sector_focus : <NotRecorded reason="The source states no focus for this fund." />}</dd>
        <dt className={DT}>Notable LPs</dt>
        <dd className="m-0">{recorded(item.notable_lps) ? item.notable_lps : <NotRecorded reason="With no LPs listed, EIF and EIFO backing is unknown, not absent." />}</dd>
        <dt className={DT}>EIF / EIFO</dt>
        <dd className="m-0"><Backing item={item} long /></dd>
        <dt className={DT}>Fund</dt>
        <dd className="m-0">{recorded(item.fund_number) ? `Fund ${item.fund_number}` : <NotRecorded />}</dd>
        <dt className={DT}>Website</dt>
        <dd className="m-0">{website ? <a href={website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-axal-violet dark:text-violet-300">{website.replace(/^https?:\/\//i, '')} <ExternalLink size={12} /></a> : <NotRecorded />}</dd>
        <dt className={DT}>LinkedIn</dt>
        <dd className="m-0">{linkedin ? <a href={linkedin} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-axal-violet dark:text-violet-300">LinkedIn page <ExternalLink size={12} /></a> : <NotRecorded />}</dd>
      </dl>

      <div className="border-t border-axal-hairline pt-3 dark:border-gray-800">
        <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Reported size over time</div>
        {reportsState === 'loading' && <p className="mt-2 text-[12px] text-axal-muted">Loading reported periods…</p>}
        {reportsState === 'unreadable' && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-axal-muted">
            <UnreadableBadge /> The reports could not be read. This is not a fund with no reports.
          </p>
        )}
        {reportsState === 'ok' && Array.isArray(reports) && !reports.length && (
          <p className="mt-2 text-[12px] text-axal-muted"><Unrecorded>No reported period is recorded for this fund.</Unrecorded></p>
        )}
        {reportsState === 'ok' && Array.isArray(reports) && reports.length > 0 && (
          <ul className="mt-2 space-y-1">
            {reports.map((p) => {
              const s = sizeOf(p);
              return (
                <li key={p.period} className="flex justify-between gap-3 text-[12.5px]">
                  <span className="font-mono text-axal-muted">{p.period}</span>
                  {s.text ? <span className="font-mono text-axal-ink dark:text-gray-100">{s.text}</span> : <Unrecorded reason="No size in a known currency">Not recorded</Unrecorded>}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-axal-faint"><span className="font-mono">research_fund_directory_reports</span> · one row per reported period</p>
      </div>

      <div className="rounded-lg border border-axal-hairline bg-axal-ground p-3 dark:border-gray-800 dark:bg-gray-900">
        <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Source</div>
        <div className="mt-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{item.source_name}</div>
        <div className="text-[11.5px] text-axal-faint">as of {item.as_of || 'an unrecorded date'}</div>
        {source && <a href={source} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-axal-violet dark:text-violet-300">View the source <ExternalLink size={12} /></a>}
      </div>
    </div>
  );
}

function Select({ id, label, value, onChange, children }) {
  return (
    <div className="min-w-0 flex-1 basis-[200px]">
      <label htmlFor={id} className={LABEL}>{label}</label>
      <select id={id} className={SELECT} value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
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

function Filters({ search, onSearch, query, onQuery, facets, open, onToggle }) {
  const active = activeFilters(query, facets);
  const band = (v) => (facets?.size_band || []).find((x) => x.value === v)?.count;
  return (
    <Card padding="md">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-[1_1_320px]">
          <label htmlFor="fd-q" className={LABEL}>Search</label>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-2.5 text-axal-faint" aria-hidden="true" />
            <input id="fd-q" type="search" placeholder="Fund name" value={search} onChange={(e) => onSearch(e.target.value)}
              className={`${SELECT} pl-9`} />
          </div>
        </div>
        <div className="min-w-[200px] flex-[0_1_260px]">
          <label htmlFor="fd-sort" className={LABEL}>Sort by</label>
          <select id="fd-sort" className={SELECT} value={query.sort} onChange={(e) => onQuery({ sort: e.target.value })}>
            {SORT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <button type="button" className={`${GHOST} w-full justify-between sm:hidden`} onClick={onToggle}
          aria-expanded={open ? 'true' : 'false'} aria-controls="fd-filters">
          <span className="inline-flex items-center gap-2"><SlidersHorizontal size={14} aria-hidden="true" /> Filters</span>
          <span className="text-[12px] font-medium text-axal-muted">{active.length ? `${active.length} active` : 'None active'}</span>
        </button>
      </div>
      <div id="fd-filters" className={`${open ? 'flex' : 'hidden'} mt-3 flex-wrap items-end gap-3 sm:flex`}>
        <Select id="fd-hq" label="HQ country" value={query.hq_country} onChange={(v) => onQuery({ hq_country: v })}>
          <option value="">All HQs</option>
          {facetOptions(facets?.hq_country, query.hq_country)}
        </Select>
        <Select id="fd-focus" label="Stated focus" value={query.focus} onChange={(v) => onQuery({ focus: v })}>
          <option value="">Any focus</option>
          {facetOptions(facets?.focus, query.focus)}
        </Select>
        <Select id="fd-size" label="Fund size, in euros" value={query.size_band} onChange={(v) => onQuery({ size_band: v })}>
          <option value="">Any size</option>
          {SIZE_BANDS.map(([v, l]) => <option key={v} value={v}>{band(v) == null ? l : `${l} (${formatCount(band(v))})`}</option>)}
        </Select>
        <Select id="fd-vint" label="Vintage" value={query.vintage} onChange={(v) => onQuery({ vintage: v })}>
          <option value="">Any vintage</option>
          {facetOptions(facets?.vintage, query.vintage)}
        </Select>
        <fieldset className="m-0 min-w-0 basis-full border-0 p-0">
          <legend className={LABEL}>Backed by, as named in notable LPs</legend>
          <div className="flex flex-wrap gap-2">
            {[['eif', 'EIF (European Investment Fund)'], ['eifo', 'EIFO (Denmark’s Export and Investment Fund)']].map(([k, l]) => (
              <label key={k} className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-axal-hairline px-3 py-1.5 text-[12px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100">
                <input type="checkbox" className="accent-violet-700" checked={!!query[k]} onChange={(e) => onQuery({ [k]: e.target.checked })} />
                {l}{facets?.[k] ? <span className="font-normal text-axal-faint">({formatCount(facets[k].backed)})</span> : null}
              </label>
            ))}
          </div>
        </fieldset>
        {facets && (
          <p className="basis-full text-[11px] text-axal-faint">
            Size bands count euro sizes only: {formatCount(facets.size_not_comparable || 0)} matching funds have no size in a known currency and sit in no band.
            {facets.eif ? ` ${formatCount(facets.eif.unknown)} list no notable LPs, so their EIF backing is unknown.` : ''}
          </p>
        )}
      </div>
    </Card>
  );
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
          const href = safeHref(s.url);
          return (
            <li key={s.name}>
              {href ? <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-axal-violet dark:text-violet-300">{s.name}</a> : s.name}
              {` · ${formatCount(s.rows)} funds · as of ${s.as_of || 'an unrecorded date'} · `}
              {s.size_currency ? `sizes in ${s.size_currency}` : 'size currency not recorded, so no size is shown'}
            </li>
          );
        })}
      </ul>
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
 * D593 — "Add to my funds" puts a directory fund on the founder's own list,
 * and the founder's row is the way into its dossier: once there is one, the
 * button's place holds "Open your dossier →" to `/research/funds/:uid`, as
 * the catalog profile already did. `dossier` is that row's uid, or null.
 *
 * `listState` is the founder's own list read, as the catalog profile reads
 * it: while it has not answered, or after it failed, nothing here can tell
 * whether the fund is already on it, so no add is offered that could
 * duplicate a row.
 */
function AddOrOpen({ item, dossier, added, busy, onAdd, listState }) {
  if (dossier) {
    return (
      <Link to={`/research/funds/${encodeURIComponent(dossier)}`} data-testid="fund-directory-open-dossier"
        className="inline-flex items-center justify-center rounded-lg bg-violet-700 px-3 py-2 text-[12px] font-semibold text-white hover:bg-violet-800 dark:bg-violet-600 dark:hover:bg-violet-500">
        Open your dossier →
      </Link>
    );
  }
  if (listState === 'unreadable') {
    return (
      <span className="flex basis-full flex-wrap items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400">
        <UnreadableBadge /> Your list could not be read, so this cannot tell whether the fund is on it.
      </span>
    );
  }
  if (listState === 'loading') {
    return <button type="button" className={GHOST} disabled>Checking your list…</button>;
  }
  return (
    <button type="button" className={GHOST} disabled={added || !!busy || !onAdd} onClick={() => onAdd && onAdd(item)}>
      {added ? 'In My funds' : busy === item.uid ? 'Adding…' : 'Add to my funds'}
    </button>
  );
}

function Drawer({ item, drawer, onClose, onAdd, busy, isAdded, dossierOf, notice, listState }) {
  const added = isAdded(item);
  const dossier = dossierOf(item);
  const note = notice && notice.uid === item.uid ? notice : null;
  const reportsState = drawer.loading ? 'loading' : (drawer.error || drawer.data?.reports_status === 'unreadable') ? 'unreadable' : 'ok';
  return (
    <aside id="fd-drawer" aria-labelledby="fd-d-title"
      className="fixed inset-x-0 bottom-0 z-30 max-h-[85vh] overflow-auto rounded-t-2xl border border-axal-hairline bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-950 md:static md:z-auto md:max-h-none md:w-full md:max-w-[410px] md:flex-[1_1_340px] md:rounded-xl md:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Fund details</div>
          <h3 id="fd-d-title" className="mt-1 text-[18px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{item.name}</h3>
        </div>
        <button type="button" className={GHOST} onClick={onClose} aria-label="Close fund details"><X size={16} aria-hidden="true" /></button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <AddOrOpen item={item} dossier={dossier} added={added} busy={busy} onAdd={onAdd} listState={listState} />
        <Link to={`/research/funds/catalog/${encodeURIComponent(item.uid)}`} className={GHOST}>Open full profile</Link>
      </div>
      {/* The add's outcome, beside the control that made it. Always in the
          tree, so a screen reader hears the sentence when it arrives. */}
      <p role="status" className={note ? `mt-2 text-[12px] font-semibold ${note.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}` : 'sr-only'}>
        {note ? note.text : ''}
      </p>
      <div className="mt-4">
        <FundDetails item={item} reports={drawer.data?.reports || null} reportsState={reportsState} />
      </div>
    </aside>
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
  filtersOpen = false, onToggleFilters = () => {},
  onRetry = () => {}, onClear = () => {},
}) {
  const { loading, error, data } = result;
  const active = activeFilters(query, facets);
  const reasons = data ? [...new Set(data.items.map((x) => sizeOf(x)).filter((s) => !s.text).map((s) => s.reason))] : [];
  return (
    <section data-testid="fund-directory" className="space-y-4">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Fund directory</h2>
        <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-axal-muted">
          {data ? `${directoryLine(data.coverage, data.sources)}. ` : ''}
          HQ, focus and notable LPs are shown as the sources wrote them. A size is shown only where its currency is recorded; what no source holds reads “Not recorded”.
        </p>
      </div>

      {data?.coverage && <CoverageCard coverage={data.coverage} sources={data.sources} />}

      {band}

      <Filters search={search} onSearch={onSearch} query={query} onQuery={onQuery} facets={facets}
        open={filtersOpen} onToggle={onToggleFilters} />

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
              ? `No fund matches${query.q ? ` “${query.q}”` : ''}${active.length ? ' with these filters' : ''}.`
              : 'The fund directory holds no funds.'}
          </p>
          {active.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {active.map((f) => (
                <button key={f.key} type="button" className={`${CHIP} gap-1.5 py-1.5`} onClick={() => onQuery({ [f.key]: f.key === 'eif' || f.key === 'eifo' ? false : '' })}>
                  {f.label}<span aria-hidden="true">×</span><span className="sr-only">Remove filter</span>
                </button>
              ))}
            </div>
          )}
          <p className="mt-2 text-[12px] text-axal-muted">About half the funds have no vintage or focus recorded, so those filters narrow fast.</p>
          {(query.q || active.length > 0) && <button type="button" className={`${GHOST} mt-3`} onClick={onClear}>Clear all filters</button>}
        </Card>
      )}

      {!loading && !error && data && data.total > 0 && (
        <div className="space-y-3" data-testid="fund-directory-results">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="fd-results" className="text-[14px] font-extrabold">
              <span className="font-mono">{rangeLabel(data.offset, data.items.length, data.total)}</span> funds
            </h3>
            <div className="flex items-center gap-2">
              <label htmlFor="fd-rows" className="text-[12px] font-semibold text-axal-muted">Rows per page</label>
              <select id="fd-rows" className={`${SELECT} w-20`} value={query.limit} onChange={(e) => onQuery({ limit: Number(e.target.value) })}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-start gap-4">
            <Card padding="none" className="min-w-0 flex-[999_1_600px] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-[12.5px]" aria-labelledby="fd-results">
                  <thead className="bg-axal-ground dark:bg-gray-950">
                    <tr>
                      <th scope="col" className={TH}>Fund</th>
                      <th scope="col" className={TH}>HQ</th>
                      <th scope="col" className={`${TH} text-right`}>Size</th>
                      <th scope="col" className={`${TH} text-right`}>Vintage</th>
                      <th scope="col" className={TH}>Stated focus</th>
                      <th scope="col" className={TH}>EIF / EIFO</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-axal-hairline dark:divide-gray-800">
                    {data.items.map((x) => {
                      const s = sizeOf(x);
                      const on = selected?.uid === x.uid;
                      return (
                        <tr key={x.uid} className={on ? 'bg-violet-50/70 dark:bg-violet-950/20' : 'hover:bg-violet-50/40 dark:hover:bg-violet-950/10'}>
                          <td className="px-3 py-2.5">
                            <button type="button" className="text-left text-[13px] font-semibold text-axal-ink hover:text-axal-violet hover:underline dark:text-gray-100"
                              onClick={() => onSelect(x)} aria-expanded={on ? 'true' : 'false'} aria-controls="fd-drawer">{x.name}</button>
                            {recorded(x.website) && <div className="max-w-[280px] truncate text-[11px] text-axal-faint">{String(x.website).replace(/^https?:\/\//i, '')}</div>}
                            {isAdded(x) && <div className="text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300">In My funds</div>}
                          </td>
                          <td className="px-3 py-2.5 text-axal-muted">{recorded(x.hq) ? x.hq : <Unrecorded>Not recorded</Unrecorded>}</td>
                          <td className="px-3 py-2.5 text-right">{s.text ? <span className="font-mono text-axal-ink dark:text-gray-100">{s.text}</span> : <Unrecorded reason={s.reason}>Not recorded</Unrecorded>}</td>
                          <td className="px-3 py-2.5 text-right">{x.fund_year != null ? <span className="font-mono">{x.fund_year}</span> : <Unrecorded>Not recorded</Unrecorded>}</td>
                          <td className="px-3 py-2.5 text-axal-muted">{recorded(x.sector_focus) ? x.sector_focus : <Unrecorded>Not recorded</Unrecorded>}</td>
                          <td className="px-3 py-2.5"><Backing item={x} /></td>
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
            {selected && (
              <Drawer item={selected} drawer={drawer} onClose={onClose}
                onAdd={onAdd} busy={busy} isAdded={isAdded} dossierOf={dossierOf} notice={notice} listState={listState} />
            )}
          </div>
          <Pager data={data} onQuery={onQuery} />
        </div>
      )}

      {data && <SourcesList data={data} />}
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
  onTotal = null, band = null,
}) {
  const [query, setQuery] = useState(EMPTY_QUERY);
  const [search, setSearch] = useState('');
  const [result, setResult] = useState({ loading: true, error: null, data: null });
  const [facets, setFacets] = useState(null);
  const [selected, setSelected] = useState(null);
  const [drawer, setDrawer] = useState({ loading: false, error: null, data: null });
  const [filtersOpen, setFiltersOpen] = useState(false);
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
      if (mine === pickSeq.current) setDrawer({ loading: false, error: e?.message || 'Unreadable', data: null });
    }
  };

  return (
    <FundDirectoryView
      query={query} onQuery={change} search={search} onSearch={setSearch}
      result={result} facets={facets} selected={selected} onSelect={pick}
      onClose={() => { pickSeq.current += 1; setSelected(null); }} drawer={drawer}
      onAdd={onAdd} busy={busy}
      isAdded={(x) => researchedNames.has(normalize(x.name))}
      dossierOf={dossierOf || (() => null)} listState={listState} notice={notice} band={band}
      filtersOpen={filtersOpen} onToggleFilters={() => setFiltersOpen((o) => !o)}
      onRetry={load} onClear={clear}
    />
  );
}
