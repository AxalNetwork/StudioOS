import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { DataState, PartialBanner, StateChip, Unreadable } from '../../ui/Honesty';
import { api } from '../../lib/api';
import { researchMarketsApi } from '../../lib/api/researchMarkets.js';
import {
  FRESH_OPTIONS, MARKET_SORTS, MARKET_VIEWS, PAGE_SIZE, SRC_OPTIONS, STALE_DAYS,
  countryName, filterChips, isFiltered, marketListParams, patchMarketQuery, readMarketQuery,
  sectorHref, thesisFrom, thesisMatch, thesisMatchCount, writeMarketQuery,
} from './marketDirectoryQuery.js';
import { THESIS_EDIT } from './marketDirectoryExport.js';
import { FiltersSheet, ThesisStrip } from './MarketDirectoryPhone.jsx';

/**
 * Research › Markets, the Market directory tab (D7171, #7171), to the canvas
 * `design/incoming/Research Markets Directory and Investor View Page.dc.html`
 * (D7036, boards RMD-01 to RMD-12).
 *
 * ONE PAGE OF THE WHOLE DIRECTORY. The Worker searches (market name or tracked
 * sector), filters by country, source freshness and source type, sorts and
 * pages; this file asks for one page and prints the totals and the counts per
 * option it answers with. It never re-filters or re-sorts the rows, so nothing
 * here goes silently wrong past 100 markets.
 *
 * FIVE COLUMNS, ONE ROW (RMD-00 "The row"): the market and its tracked sector,
 * the taxonomy company count (labelled "not market size"), the countries its
 * directory companies are based in, its distinct sources (sector-level and
 * those naming it, told apart), and its latest source with its age. A value no
 * source holds reads Not recorded with the Worker's reason. Table, Cards and
 * Analysis carry the same facts; Analysis is dated coverage, no size or growth.
 *
 * THE INVESTOR'S THESIS (RMD-08) sits beside the results, read from the
 * investor profile. "Matches your thesis sectors" is drawn only for a real
 * sector match through the published crosswalk; no thesis and an unreadable
 * thesis are their own states and the directory stays usable.
 */

const fmt = (n) => (n == null ? null : Number(n).toLocaleString('en-US'));
const DAY = 86_400_000;
const utc = (d) => {
  const k = String(d || '').replace(' ', 'T');
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(k) || !k.includes('T') ? k : `${k}Z`);
  return Number.isFinite(ms) ? ms : null;
};
/** Whole days from `d` to the read time, or null. */
export function ageAt(d, readAt) {
  const a = utc(d); const b = utc(readAt);
  return a == null || b == null ? null : Math.max(0, Math.floor((b - a) / DAY));
}
const day = (d) => String(d || '').slice(0, 10);

const CTRL = 'min-h-[40px] rounded-lg border border-axal-hairline bg-white px-3 text-[13px] text-axal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const BTN = 'inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-axal-hairline bg-white px-3 text-[12.5px] font-semibold text-axal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const LINK = 'font-semibold text-axal-violet hover:underline dark:text-violet-300';

function NotRecorded({ reason }) {
  return <DataState state="not_recorded" reason={reason} />;
}

// ---- One market's facts --------------------------------------------------------

/** The kind the newest source came from: sector-level, names this market, or both on the same date. */
export function newestKind(m) {
  const k = m?.sources_by_kind;
  const a = k?.market_intel?.newest?.value; const b = k?.signal_evidence?.newest?.value;
  if (!a && !b) return null;
  if (a && b) return utc(a) === utc(b) ? 'both kinds' : (utc(a) > utc(b) ? 'sector-level' : 'names this market');
  return a ? 'sector-level' : 'names this market';
}

function MarketName({ m, view }) {
  return (
    <span className="block min-w-0">
      <Link to={sectorHref(m, view)} className="block truncate text-[13px] font-semibold text-axal-ink hover:text-axal-violet dark:text-gray-100">{m.name}</Link>
      <span className="block text-[11.5px] text-axal-muted dark:text-gray-400">
        {m.mi_sector ? `Tracked sector ${m.mi_sector}` : 'Not mapped yet · no tracked sector'}
      </span>
    </span>
  );
}

function Countries({ m, full = false }) {
  if (m.countries?.status !== 'recorded') return <NotRecorded reason={m.countries?.reason} />;
  const list = m.countries.value;
  return (
    <span className="block">
      <span className="block text-[12.5px] text-axal-ink dark:text-gray-100">{list.map((c) => `${full ? countryName(c.code) : c.code} ${c.count}`).join(' · ')}</span>
      <span className="block text-[11px] text-axal-muted dark:text-gray-400">{list.length} {list.length === 1 ? 'country' : 'countries'}</span>
    </span>
  );
}

function Sources({ m }) {
  if (m.source_count?.status !== 'recorded') return <NotRecorded reason="No live source yet" />;
  const sec = m.sources_by_kind?.market_intel?.count ?? 0;
  const named = m.sources_by_kind?.signal_evidence?.count ?? 0;
  return (
    <span className="block">
      <span className="block font-mono text-[12.5px] text-axal-ink dark:text-gray-100">{fmt(m.source_count.value)}</span>
      <span className="block text-[11px] text-axal-muted dark:text-gray-400">{sec} sector-level · {named} {named === 1 ? 'names' : 'name'} it</span>
    </span>
  );
}

function Latest({ m, readAt }) {
  const n = m.newest_source_at;
  if (n?.status !== 'recorded') {
    return <NotRecorded reason={m.source_count?.status === 'recorded' ? 'No source row records a date' : 'No source to date'} />;
  }
  const age = ageAt(n.value, readAt);
  const kind = newestKind(m);
  return (
    <span className="block">
      <span className="block text-[12.5px] text-axal-ink dark:text-gray-100">{day(n.value)}</span>
      <span className="block text-[11px] text-axal-muted dark:text-gray-400">
        {age == null ? 'Age not recorded' : `${age} ${age === 1 ? 'day' : 'days'} ago`}{kind ? ` · ${kind}` : ''}
      </span>
      {age != null && age > STALE_DAYS ? <StateChip kind="stale" age={`${age} days`} className="mt-1" /> : null}
    </span>
  );
}

function ThesisCell({ m, thesis }) {
  const t = thesisMatch(m, thesis);
  if (t.kind === 'match') {
    return (
      <span className="block text-[12px] font-semibold text-emerald-800 dark:text-emerald-300" data-testid="thesis-match">
        ✓ Matches your thesis sectors
        <span className="block text-[11px] font-normal text-axal-muted dark:text-gray-400">via {t.through.join(', ')}</span>
      </span>
    );
  }
  return (
    <span className="block text-[11.5px] text-axal-muted dark:text-gray-400">
      {t.kind === 'no_sector' ? 'No tracked sector · no match is possible' : 'Not a thesis sector'}
    </span>
  );
}

/** The expanded row (RMD-04): where, which sources of which kind, and what the count is not. */
export function MarketDetails({ m, view, asOf }) {
  const listed = m.sources || [];
  const sector = listed.filter((s) => s.kind === 'market_intel');
  const named = listed.filter((s) => s.kind === 'signal_evidence');
  const secN = m.sources_by_kind?.market_intel?.count ?? sector.length;
  const namedN = m.sources_by_kind?.signal_evidence?.count ?? named.length;
  const total = m.source_count?.status === 'recorded' ? m.source_count.value : 0;
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try {
      const url = typeof window !== 'undefined' ? window.location.href : '';
      Promise.resolve(navigator?.clipboard?.writeText?.(url)).then(() => setCopied(true), () => setCopied(false));
    } catch { setCopied(false); }
  };
  const list = (rows) => (
    <ul className="mt-1 space-y-0.5">
      {rows.map((s) => (
        <li key={`${s.kind}:${s.key}`} className="flex justify-between gap-3 text-[12px]">
          <span className="truncate text-axal-ink dark:text-gray-100">{s.key}</span>
          <span className="shrink-0 font-mono text-axal-muted dark:text-gray-400">{s.newest ? day(s.newest) : 'Date not recorded'}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="grid gap-4 rounded-xl bg-violet-50/50 p-4 text-[12.5px] dark:bg-violet-950/20 md:grid-cols-3" data-testid="market-details">
      <div>
        <p className="text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-faint">Countries represented</p>
        {m.countries?.status === 'recorded' ? (
          <ul className="mt-1 space-y-0.5">
            {m.countries.value.map((c) => (
              <li key={c.code} className="flex justify-between gap-3">
                <Link to={`/research/geographies/${c.code}`} className="text-axal-ink hover:text-axal-violet dark:text-gray-100">{countryName(c.code)}</Link>
                <span className="text-axal-muted dark:text-gray-400">{c.count} {c.count === 1 ? 'company' : 'companies'}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-1"><NotRecorded reason={m.countries?.reason} /></p>}
        <p className="mt-2 text-[11.5px] text-axal-muted dark:text-gray-400">
          {fmt(m.company_count)} {m.company_count === 1 ? 'company' : 'companies'} in the company directory {m.company_count === 1 ? 'is' : 'are'} placed in this market.
        </p>
      </div>
      <div>
        <p className="text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-faint">Sources · {total ? `${fmt(total)} distinct` : 'none'}</p>
        {total ? (
          <>
            <p className="mt-1 font-semibold text-axal-ink dark:text-gray-100">Sector-level {secN}</p>
            {sector.length ? list(sector) : null}
            <p className="mt-2 font-semibold text-axal-ink dark:text-gray-100">Names this market {namedN}</p>
            {named.length ? list(named) : null}
            <p className="mt-2 text-[11.5px] text-axal-muted dark:text-gray-400">
              {m.mi_sector ? `Sector-level sources describe the whole tracked sector ${m.mi_sector} and are shared by its markets. ` : ''}
              Evidence that names a market comes from active signals tagged with it.
              {total > listed.length ? ' Sources are listed up to 20; the count includes all of them.' : ''}
            </p>
          </>
        ) : <p className="mt-1"><NotRecorded reason={m.source_count?.reason} /></p>}
      </div>
      <div>
        <p className="text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-faint">Taxonomy company count</p>
        <p className="mt-1 font-mono text-[13px] text-axal-ink dark:text-gray-100">{fmt(m.supplied_count)}</p>
        <p className="mt-1 text-[11.5px] text-axal-muted dark:text-gray-400">
          Companies the Axal sector taxonomy lists in this market, supplied for discovery and not independently verified. It is a count of companies, not the size of the market.{asOf ? ` Taxonomy as of ${asOf}.` : ''}
        </p>
        <p className="mt-2 text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-faint">Market size and growth</p>
        <p className="mt-1"><NotRecorded reason="No source we hold records market size or growth" /></p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Link to={sectorHref(m, view)} className={LINK}>{m.mi_sector ? `Open sector ${m.mi_sector} →` : 'Open market page →'}</Link>
          <button type="button" onClick={copy} className="text-[12px] font-semibold text-axal-ink underline dark:text-gray-200">{copied ? 'Link copied' : 'Copy link to this view'}</button>
        </div>
      </div>
    </div>
  );
}

// ---- Views -----------------------------------------------------------------------

const ROW_ID = (slug) => `market-row-${slug}`;
const DETAIL_ID = (slug) => `market-details-${slug}`;

function Expander({ m, open, onToggle }) {
  return (
    <button type="button" id={ROW_ID(m.slug)} aria-expanded={open} aria-controls={DETAIL_ID(m.slug)} onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) onToggle(); }}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-axal-muted hover:bg-violet-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-gray-300 dark:hover:bg-violet-950">
      <span aria-hidden="true">{open ? '▾' : '▸'}</span><span className="sr-only">{open ? 'Collapse' : 'Expand'} {m.name}</span>
    </button>
  );
}

/** Group a page by tracked sector (owner answer Q2 A: a toggle, `group=1`); the unmapped last. */
export function groupPage(items) {
  const groups = new Map();
  for (const m of items) {
    const k = m.mi_sector || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  return [...groups.entries()].sort((a, b) => Number(a[0] === '') - Number(b[0] === '') || a[0].localeCompare(b[0]))
    .map(([sector, markets]) => ({ sector: sector || null, markets }));
}

function TableView({ items, view, onPatch, readAt, thesis, asOf }) {
  const cols = thesis ? 7 : 6;
  const sortKey = view.sort.split(':')[0];
  const rows = (list) => list.map((m) => {
    const open = view.open === m.slug;
    return (
      <React.Fragment key={m.slug}>
        <tr className="border-b border-axal-hairline/70 align-top dark:border-gray-800">
          <td className="py-2 pr-2"><Expander m={m} open={open} onToggle={() => onPatch({ open: open ? '' : m.slug })} /></td>
          <td className="max-w-[280px] py-2 pr-3"><MarketName m={m} view={view} /></td>
          <td className="py-2 pr-3 text-right font-mono text-[12.5px] text-axal-ink dark:text-gray-100">{fmt(m.supplied_count)}</td>
          <td className="py-2 pr-3"><Countries m={m} /></td>
          <td className="py-2 pr-3"><Sources m={m} /></td>
          <td className="py-2 pr-3"><Latest m={m} readAt={readAt} /></td>
          {thesis ? <td className="py-2"><ThesisCell m={m} thesis={thesis} /></td> : null}
        </tr>
        {open ? <tr id={DETAIL_ID(m.slug)}><td colSpan={cols} className="pb-3"><MarketDetails m={m} view={view} asOf={asOf} /></td></tr> : null}
      </React.Fragment>
    );
  });
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-[12.5px]" data-testid="markets-table">
        <thead>
          <tr className="border-b border-axal-hairline text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-faint dark:border-gray-800">
            <th className="w-10 py-2"><span className="sr-only">Expand</span></th>
            <th className="py-2 pr-3" aria-sort={sortKey === 'name' ? 'ascending' : 'none'}>Market and tracked sector</th>
            <th className="py-2 pr-3 text-right" aria-sort={sortKey === 'supplied_count' ? (view.sort.endsWith('asc') ? 'ascending' : 'descending') : 'none'}>
              Taxonomy company count<span className="block font-medium normal-case tracking-normal">not market size</span>
            </th>
            <th className="py-2 pr-3">Countries represented</th>
            <th className="py-2 pr-3">Distinct sources</th>
            <th className="py-2 pr-3" aria-sort={sortKey === 'newest_source' ? 'descending' : 'none'}>Latest source</th>
            {thesis ? <th className="py-2">Your thesis</th> : null}
          </tr>
        </thead>
        <tbody>
          {view.grouped ? groupPage(items).map((g) => (
            <React.Fragment key={g.sector || 'unmapped'}>
              <tr><th colSpan={cols} scope="colgroup" className="pt-3 text-left text-[12.5px] font-bold text-axal-ink dark:text-gray-100">
                {g.sector || 'Not mapped yet'} <span className="font-normal text-axal-muted dark:text-gray-400">· {g.markets.length} on this page</span>
              </th></tr>
              {rows(g.markets)}
            </React.Fragment>
          )) : rows(items)}
        </tbody>
      </table>
    </div>
  );
}

function CardsView({ items, view, onPatch, readAt, thesis, asOf }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="markets-cards">
      {items.map((m) => {
        const open = view.open === m.slug;
        return (
          <li key={m.slug} className={`rounded-xl border border-axal-hairline p-3 dark:border-gray-800 ${open ? 'sm:col-span-2 xl:col-span-3' : ''}`}>
            <div className="flex items-start justify-between gap-2"><MarketName m={m} view={view} /><Expander m={m} open={open} onToggle={() => onPatch({ open: open ? '' : m.slug })} /></div>
            {thesis ? <div className="mt-1"><ThesisCell m={m} thesis={thesis} /></div> : null}
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
              <div><dt className="text-[10.5px] font-semibold text-axal-faint">Taxonomy count · not market size</dt><dd className="font-mono text-axal-ink dark:text-gray-100">{fmt(m.supplied_count)}</dd></div>
              <div><dt className="text-[10.5px] font-semibold text-axal-faint">Countries</dt><dd><Countries m={m} /></dd></div>
              <div><dt className="text-[10.5px] font-semibold text-axal-faint">Distinct sources</dt><dd><Sources m={m} /></dd></div>
              <div><dt className="text-[10.5px] font-semibold text-axal-faint">Latest source</dt><dd><Latest m={m} readAt={readAt} /></dd></div>
            </dl>
            {open ? <div id={DETAIL_ID(m.slug)} className="mt-3"><MarketDetails m={m} view={view} asOf={asOf} /></div> : null}
          </li>
        );
      })}
    </ul>
  );
}

function Bar({ label, n, of, notRecorded = false }) {
  const w = of > 0 ? Math.round((n / of) * 100) : 0;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_120px_48px] items-center gap-3 py-1 text-[12.5px]">
      <span className="text-axal-ink dark:text-gray-100">{label}{notRecorded ? <span className="ml-1 text-[11px] text-axal-muted dark:text-gray-400">(Not recorded)</span> : null}</span>
      <span className="block h-1.5 rounded-full bg-violet-100 dark:bg-violet-950"><span className={`block h-1.5 rounded-full ${notRecorded ? 'bg-gray-400 dark:bg-gray-500' : 'bg-violet-500'}`} style={{ width: `${w}%` }} /></span>
      <span className="text-right font-mono text-axal-ink dark:text-gray-100">{fmt(n)}</span>
    </li>
  );
}

/** Analysis (RMD-06B): documented coverage of the markets the filters leave, never size or growth. */
export function AnalysisView({ summary, readAt, asOf }) {
  if (!summary) return <NotRecorded reason="The Worker sent no coverage summary." />;
  const n = summary.markets;
  const f = summary.fresh || {};
  const c = summary.countries || {};
  const t = summary.tracked || {};
  const stale = summary.stale_days ?? STALE_DAYS;
  return (
    <div className="space-y-4" data-testid="markets-analysis">
      <p className="text-[12px] text-axal-muted dark:text-gray-400">
        Documented coverage of the {fmt(n)} markets · read {day(readAt)}{asOf ? ` · taxonomy as of ${asOf}` : ''} · counts, not market size or growth
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-axal-hairline p-3 dark:border-gray-800">
          <h3 className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Newest source</h3>
          <ul className="mt-1">
            <Bar label="Last 30 days" n={f['30'] || 0} of={n} />
            <Bar label="31 to 90 days" n={f['90'] || 0} of={n} />
            <Bar label={`Older than ${stale} days · Stale`} n={f.older || 0} of={n} />
            <Bar label="No source recorded" n={f.none || 0} of={n} notRecorded />
          </ul>
          <p className="mt-1 text-[11px] text-axal-muted dark:text-gray-400">{fmt(n - (f.none || 0))} markets have at least one dated source.</p>
        </section>
        <section className="rounded-xl border border-axal-hairline p-3 dark:border-gray-800">
          <h3 className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Countries represented</h3>
          <ul className="mt-1">
            <Bar label="At least one country" n={c.recorded || 0} of={n} />
            <Bar label="No company placed" n={c.no_company || 0} of={n} notRecorded />
            <Bar label="No placeable country" n={c.no_placeable_country || 0} of={n} notRecorded />
          </ul>
          <p className="mt-1 text-[11px] text-axal-muted dark:text-gray-400">{fmt(c.distinct || 0)} countries appear across them. The two Not recorded reasons are kept apart.</p>
        </section>
        <section className="rounded-xl border border-axal-hairline p-3 dark:border-gray-800">
          <h3 className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Tracked sector</h3>
          <ul className="mt-1">
            <Bar label="Mapped to a tracked sector" n={t.mapped || 0} of={n} />
            <Bar label="Not mapped yet" n={t.unmapped || 0} of={n} notRecorded />
          </ul>
          <p className="mt-1 text-[11px] text-axal-muted dark:text-gray-400">Unmapped markets stay in the directory with their own counts, countries and sources.</p>
        </section>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[12.5px]">
          <caption className="pb-2 text-left text-[13px] font-bold text-axal-ink dark:text-gray-100">By tracked sector <span className="font-normal text-axal-muted dark:text-gray-400">· sector-level sources apply to every market in the sector</span></caption>
          <thead>
            <tr className="border-b border-axal-hairline text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-faint dark:border-gray-800">
              <th className="py-2 pr-3">Tracked sector</th><th className="py-2 pr-3 text-right">Markets</th><th className="py-2 pr-3">Sector-level sources</th>
              <th className="py-2 pr-3">Newest sector-level source</th><th className="py-2 text-right">Markets named by evidence</th>
            </tr>
          </thead>
          <tbody>
            {(summary.by_sector || []).map((s) => {
              const age = s.newest_sector_source?.status === 'recorded' ? ageAt(s.newest_sector_source.value, readAt) : null;
              return (
                <tr key={s.sector} className="border-b border-axal-hairline/70 dark:border-gray-800">
                  <td className="py-2 pr-3 font-semibold text-axal-ink dark:text-gray-100">{s.sector}</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmt(s.markets)}</td>
                  <td className="py-2 pr-3">{s.sector_sources ? fmt(s.sector_sources) : <NotRecorded reason="No live source yet" />}</td>
                  <td className="py-2 pr-3">{s.newest_sector_source?.status === 'recorded'
                    ? <>{day(s.newest_sector_source.value)}{age != null && age > stale ? <StateChip kind="stale" age={`${age} days`} className="ml-2" /> : null}</>
                    : <NotRecorded reason={s.newest_sector_source?.reason} />}</td>
                  <td className="py-2 text-right font-mono">{fmt(s.named_markets)}</td>
                </tr>
              );
            })}
            {summary.unmapped?.markets ? (
              <tr className="border-b border-axal-hairline/70 dark:border-gray-800">
                <td className="py-2 pr-3 font-semibold text-axal-ink dark:text-gray-100">Not mapped yet</td>
                <td className="py-2 pr-3 text-right font-mono">{fmt(summary.unmapped.markets)}</td>
                <td className="py-2 pr-3"><StateChip kind="not_applicable" /></td>
                <td className="py-2 pr-3"><StateChip kind="not_applicable" /></td>
                <td className="py-2 text-right font-mono">{fmt(summary.unmapped.named_markets)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Filters ---------------------------------------------------------------------

/**
 * A filter button and its menu (RMD-03). The choice is a draft until Apply;
 * Reset clears it; Escape closes and returns focus to the button. Each option
 * carries the Worker's count over what the other filters leave.
 */
function FilterMenu({ label, current, options, multi = false, selected, onApply, note = null, testid }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(selected);
  const btn = useRef(null);
  const close = () => { setOpen(false); btn.current?.focus?.(); };
  const toggle = (v) => setDraft((d) => (multi ? (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]) : (d === v ? '' : v)));
  const on = multi ? selected.length > 0 : !!selected;
  return (
    <div className="relative" onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); close(); } }}>
      <span className="mb-1 block text-[11.5px] font-semibold text-axal-ink dark:text-gray-200">{label}</span>
      <button ref={btn} type="button" aria-haspopup="dialog" aria-expanded={open} data-testid={testid}
        onClick={() => { setDraft(selected); setOpen((o) => !o); }}
        className={`${CTRL} inline-flex w-full items-center justify-between gap-2 ${on ? 'border-violet-300 text-violet-700 dark:border-violet-700 dark:text-violet-300' : ''}`}>
        <span className="truncate">{current}</span><span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div role="dialog" aria-label={label}
          className="fixed inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-y-auto rounded-t-2xl border border-axal-hairline bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-900 md:absolute md:inset-x-auto md:bottom-auto md:left-0 md:top-full md:mt-1 md:w-72 md:rounded-xl">
          <p className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{label}</p>
          <ul className="mt-2 space-y-0.5">
            {options.map((o) => {
              const checked = multi ? draft.includes(o.value) : draft === o.value;
              return (
                <li key={o.value}>
                  <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-lg px-2 text-[12.5px] text-axal-ink hover:bg-violet-50 dark:text-gray-100 dark:hover:bg-violet-950 md:min-h-[36px]">
                    <span className="flex items-center gap-2">
                      <input type={multi ? 'checkbox' : 'radio'} name={label} checked={checked} onChange={() => toggle(o.value)} className="accent-violet-600" />
                      {o.label}
                    </span>
                    <span className="font-mono text-axal-muted dark:text-gray-400">{o.count == null ? '' : fmt(o.count)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {note ? <p className="mt-2 text-[11px] leading-relaxed text-axal-muted dark:text-gray-400">{note}</p> : null}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className={BTN} onClick={() => setDraft(multi ? [] : '')}>Reset</button>
            <button type="button" className={`${BTN} border-violet-600 bg-violet-600 text-white dark:border-violet-500 dark:bg-violet-600 dark:text-white`}
              onClick={() => { onApply(draft); close(); }}>Apply</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const countOf = (facet, value) => facet?.options?.find((o) => (o.value ?? o.code) === value)?.count ?? 0;

function Toolbar({ view, onPatch, facets, sectors = [] }) {
  const [q, setQ] = useState(view.q);
  useEffect(() => { setQ(view.q); }, [view.q]);
  const countryOptions = (facets?.country?.options || []).map((o) => ({ value: o.code, label: countryName(o.code), count: o.count }));
  for (const c of view.country) if (!countryOptions.some((o) => o.value === c)) countryOptions.push({ value: c, label: countryName(c), count: 0 });
  const freshLabel = FRESH_OPTIONS.find((o) => o.value === view.fresh)?.label || 'Any date';
  const srcLabel = SRC_OPTIONS.find((o) => o.value === view.src)?.label || 'Any source';
  const countryLabel = view.country.length ? view.country.map(countryName).join(', ') : 'Any country';
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(220px,1.4fr)_repeat(4,minmax(0,1fr))] md:items-end" data-testid="markets-toolbar">
      <form role="search" onSubmit={(e) => { e.preventDefault(); onPatch({ q: q.trim().slice(0, 120) }); }}>
        <label htmlFor="markets-search" className="mb-1 block text-[11.5px] font-semibold text-axal-ink dark:text-gray-200">Search markets or sectors</label>
        <span className="relative block">
          <Search size={14} className="pointer-events-none absolute left-3 top-3 text-axal-faint" />
          <input id="markets-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => { if (q.trim() !== view.q) onPatch({ q: q.trim().slice(0, 120) }); }}
            placeholder="Energy storage, robotics, logistics…" className={`${CTRL} w-full pl-9`} />
        </span>
      </form>
      {/* RMD-11B (part 2): below md, one Filters sheet and the sort, side by side. */}
      <div className="grid grid-cols-2 gap-2 md:hidden" data-testid="markets-phone-tools">
        <FiltersSheet view={view} facets={facets} onPatch={onPatch} sectors={sectors} />
        <select value={view.sort} onChange={(e) => onPatch({ sort: e.target.value })} aria-label="Sort markets by"
          className={`${CTRL} min-h-[44px] w-full font-semibold`}>
          {MARKET_SORTS.map((s) => <option key={s.value} value={s.value}>Sort · {s.label}</option>)}
        </select>
      </div>
      <div className="hidden md:block"><FilterMenu label="Country" testid="filter-country" multi current={countryLabel} selected={view.country}
        options={countryOptions} onApply={(country) => onPatch({ country })}
        note={`Markets with a directory company there.${facets?.country?.not_recorded ? ` Countries not recorded: ${fmt(facets.country.not_recorded)}. ` : ' '}A market with no recorded country is never listed under a country.`} /></div>
      <div className="hidden md:block"><FilterMenu label="Source freshness" testid="filter-fresh" current={freshLabel} selected={view.fresh}
        options={FRESH_OPTIONS.map((o) => ({ ...o, count: countOf(facets?.fresh, o.value) }))} onApply={(fresh) => onPatch({ fresh })}
        note="By the newest source of any kind." /></div>
      <div className="hidden md:block"><FilterMenu label="Source type" testid="filter-src" current={srcLabel} selected={view.src}
        options={SRC_OPTIONS.map((o) => ({ ...o, count: countOf(facets?.src, o.value) }))} onApply={(src) => onPatch({ src })}
        note="Sector-level sources describe the tracked sector as a whole. Evidence that names the market is from signals tagged with it." /></div>
      <label className="hidden md:block">
        <span className="mb-1 block text-[11.5px] font-semibold text-axal-ink dark:text-gray-200">Sort</span>
        <select value={view.sort} onChange={(e) => onPatch({ sort: e.target.value })} className={`${CTRL} w-full`} aria-label="Sort markets by">
          {MARKET_SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-3 md:col-span-5">
        <div role="radiogroup" aria-label="View" className="inline-flex rounded-lg border border-axal-hairline p-0.5 dark:border-gray-700">
          {MARKET_VIEWS.map((v) => (
            <button key={v.key} type="button" role="radio" aria-checked={view.view === v.key} onClick={() => onPatch({ view: v.key })}
              className={`min-h-[36px] rounded-md px-3 text-[12.5px] font-semibold ${view.view === v.key ? 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300' : 'text-axal-ink dark:text-gray-200'}`}>
              {v.label}
            </button>
          ))}
        </div>
        {view.view !== 'analysis' ? (
          <label className="inline-flex min-h-[36px] items-center gap-2 text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">
            <input type="checkbox" checked={view.grouped} onChange={(e) => onPatch({ grouped: e.target.checked })} className="accent-violet-600" /> Group by tracked sector
          </label>
        ) : null}
      </div>
    </div>
  );
}

// ---- The thesis (RMD-08) -------------------------------------------------------

/** The investor's thesis beside the results: loading, unreadable, none, or set. */
export function ThesisSection({ read, matchCount = 0, total = 0, onlyMatches = false, onOnlyMatches, onRetry }) {
  let body;
  if (!read || read.status === 'loading') body = <p className="text-[12.5px] text-axal-muted dark:text-gray-400" role="status">Reading your thesis…</p>;
  else if (read.status !== 'ready') {
    body = (
      <div data-testid="thesis-unreadable">
        <StateChip kind="unavailable" />
        <p className="mt-2 text-[12.5px] text-axal-muted dark:text-gray-400">Your investor profile could not be read, so no thesis matches are shown. This is not a claim that nothing matches.</p>
        <button type="button" onClick={onRetry} className={`${BTN} mt-2`}>Retry</button>
      </div>
    );
  } else if (read.thesis.kind === 'none') {
    body = (
      <div data-testid="thesis-none">
        <p className="text-[12.5px] text-axal-muted dark:text-gray-400">No thesis on your profile yet. The directory works without one; matches appear once your profile names sectors.</p>
        <Link to={THESIS_EDIT} className={`${LINK} mt-2 inline-block text-[12.5px]`}>Add a thesis in Settings</Link>
      </div>
    );
  } else {
    const t = read.thesis;
    const mapped = t.via.filter((v) => v.tracked.length);
    body = (
      <div data-testid="thesis-set" className="space-y-2 text-[12.5px]">
        {t.text ? <p className="leading-relaxed text-axal-ink dark:text-gray-100">{t.text}</p> : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          {t.sectors.length ? <><dt className="font-semibold text-axal-faint">Sectors</dt><dd className="text-axal-ink dark:text-gray-100">{t.sectors.join(' · ')}</dd></> : null}
          {t.stages.length ? <><dt className="font-semibold text-axal-faint">Stages</dt><dd className="text-axal-ink dark:text-gray-100">{t.stages.join(' · ')}</dd></> : null}
          {t.geos.length ? <><dt className="font-semibold text-axal-faint">Geographies</dt><dd className="text-axal-ink dark:text-gray-100">{t.geos.join(' · ')}</dd></> : null}
          {t.anti.length ? <><dt className="font-semibold text-axal-faint">Anti-thesis</dt><dd className="text-axal-ink dark:text-gray-100">{t.anti.join(' · ')}</dd></> : null}
        </dl>
        <div className="rounded-lg bg-violet-50/60 p-2 dark:bg-violet-950/30">
          <p className="font-semibold text-axal-ink dark:text-gray-100">How a match is made</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-axal-muted dark:text-gray-400">
            A market matches only when its tracked sector is one of your profile sectors
            {mapped.length ? `: ${mapped.map((v) => `${v.sector} → ${v.tracked.join(', ')}`).join('; ')}` : ''}. Keywords and geographies never make a match.
            {t.via.length > mapped.length ? ` ${t.via.filter((v) => !v.tracked.length).map((v) => v.sector).join(', ')} ${t.via.length - mapped.length === 1 ? 'maps' : 'map'} to no tracked sector.` : ''}
          </p>
        </div>
        {t.tracked.length ? (
          <>
            <p className="text-[12px] text-axal-ink dark:text-gray-100" data-testid="thesis-count">
              {onlyMatches ? `${fmt(total)} markets match your thesis sectors` : `${fmt(matchCount)} of ${fmt(total)} markets match your thesis sectors`}
            </p>
            <label className="inline-flex min-h-[40px] items-center gap-2 font-semibold text-axal-ink dark:text-gray-200">
              <input type="checkbox" checked={onlyMatches} onChange={(e) => onOnlyMatches?.(e.target.checked)} className="accent-violet-600" /> Show only markets that match
            </label>
          </>
        ) : <p className="text-[12px] text-axal-muted dark:text-gray-400">None of your profile sectors maps to a tracked sector, so no market can match yet.</p>}
        <Link to={THESIS_EDIT} className={`${LINK} inline-block text-[12px]`}>Edit thesis</Link>
      </div>
    );
  }
  return (
    <section aria-labelledby="markets-thesis-h" className="rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-950" data-testid="markets-thesis">
      <h2 id="markets-thesis-h" className="text-[14px] font-bold text-axal-ink dark:text-gray-100">Your thesis</h2>
      <p className="text-[11px] text-axal-faint">From your investor profile · one thesis</p>
      <div className="mt-2">{body}</div>
      <p className="mt-3 text-[11px] leading-relaxed text-axal-faint">Market readings price an advisor’s service line and are not shown to an investor.</p>
    </section>
  );
}

// ---- The body: states, summary, view, pager ------------------------------------

/**
 * Everything below the toolbar, drawn from one read. Pure: `markets` is the
 * read (`{ status, data, reload }`), `view` the URL's view.
 */
export function DirectoryBody({ markets, view, onPatch, thesis = null, onClear }) {
  const data = markets?.data;
  if (markets?.status === 'loading' && !data) {
    return (
      <div role="status" data-testid="markets-loading">
        <p className="text-[12.5px] text-axal-muted dark:text-gray-400">Reading the markets…</p>
        <div className="mt-3 space-y-2" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-10 rounded-lg bg-axal-hairline/60 dark:bg-gray-800" />)}</div>
      </div>
    );
  }
  if (markets?.status === 'unreadable' || markets?.status === 'not_found') {
    return <Unreadable what="The markets" claim="This is not a sign there are none. Your search and filters are kept." onRetry={markets.reload} />;
  }
  const items = data?.items || [];
  const total = Number(data?.total) || 0;
  const all = Number(data?.directory_total ?? total) || 0;
  if (!all) {
    return (
      <div data-testid="markets-empty" className="rounded-xl border border-dashed border-axal-hairline p-4 dark:border-gray-700">
        <p className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">No markets are in the directory yet.</p>
        <p className="mt-1 text-[12.5px] text-axal-muted dark:text-gray-400">Markets arrive with the Axal sector taxonomy. Listed companies are on their own tab.</p>
        <button type="button" className={`${BTN} mt-2`} onClick={() => onPatch({ tab: 'listed' })}>Open Listed companies</button>
      </div>
    );
  }
  if (!total) {
    const where = [view.q ? `“${view.q}”` : null, view.country.length ? `in ${view.country.map(countryName).join(', ')}` : null].filter(Boolean).join(' ');
    return (
      <div data-testid="markets-no-match" className="rounded-xl border border-axal-hairline px-4 py-3 dark:border-gray-800">
        <p className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">No market matches {where || 'these filters'}.</p>
        <p className="mt-0.5 text-[12px] text-axal-muted dark:text-gray-400">A market whose countries are Not recorded cannot match a country. Check the spelling, or widen the filters.</p>
        <button type="button" data-testid="markets-clear-filters" onClick={onClear} className={`${BTN} mt-2`}>Clear filters</button>
      </div>
    );
  }
  const offset = Number(data.offset) || 0;
  const from = offset + 1;
  const to = offset + items.length;
  const asOf = items[0]?.as_of || null;
  const props = { items, view, onPatch, readAt: data.read_at, thesis, asOf };
  return (
    <div>
      {view.view === 'analysis' ? <AnalysisView summary={data.summary} readAt={data.read_at} asOf={asOf} /> : (
        <>
          {view.view === 'cards' ? <CardsView {...props} /> : (
            <>
              <div className="hidden md:block"><TableView {...props} /></div>
              <div className="md:hidden"><CardsView {...props} /></div>
            </>
          )}
          {total > items.length || offset > 0 ? (
            <nav aria-label="Markets pages" data-testid="markets-pager" className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400">
              <span>{fmt(from)}–{fmt(to)} of {fmt(total)}</span>
              <button type="button" className={BTN} disabled={view.page <= 1} onClick={() => onPatch({ page: view.page - 1, open: '' })}>Previous</button>
              <button type="button" className={BTN} disabled={to >= total} onClick={() => onPatch({ page: view.page + 1, open: '' })}>Next</button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

/** The result line (a polite live region): what matched, over what. */
export function ResultLine({ data, view }) {
  if (!data) return null;
  const total = Number(data.total) || 0;
  const all = Number(data.directory_total ?? total) || 0;
  const held = data.summary?.supplied_total;
  let lead; let tail;
  if (view.q && data.matched_on) {
    lead = `${fmt(total)} ${total === 1 ? 'market matches' : 'markets match'} “${view.q}”`;
    tail = `Matched on the market name (${fmt(data.matched_on.name)}) or its tracked sector (${fmt(data.matched_on.sector)})`;
  } else if (isFiltered(view)) {
    lead = `${fmt(total)} ${total === 1 ? 'market matches' : 'markets match'}`;
    tail = `of ${fmt(all)} in the directory`;
  } else {
    lead = `${fmt(total)} markets${held != null ? ` · ${fmt(held)} companies as the taxonomy counts them` : ''}`;
    tail = `Count and sort cover all ${fmt(total)} markets, then the page shows ${PAGE_SIZE}`;
  }
  return (
    <p aria-live="polite" className="text-[12.5px]" data-testid="markets-result">
      <span className="font-semibold text-axal-ink dark:text-gray-100">{lead}</span>
      <span className="text-axal-muted dark:text-gray-400"> · {tail}</span>
    </p>
  );
}

/** The coverage note (RMD-01): where each fact comes from, and why government ownership is not here. */
export function CoverageNote({ asOf }) {
  return (
    <div data-testid="markets-coverage" className="flex gap-2 rounded-xl border border-axal-hairline bg-axal-ground/60 px-3 py-2 text-[12px] leading-relaxed text-axal-muted dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
      <span aria-hidden="true" className="font-bold text-axal-violet dark:text-violet-300">i</span>
      <p>
        <strong className="text-axal-ink dark:text-gray-100">Coverage.</strong> Markets and their company counts come from the Axal sector taxonomy{asOf ? ` (as of ${asOf})` : ''}; the counts are not market size. Countries come from the company directory; sources from live market-intelligence rows and signal evidence. Government ownership is not available: no source we hold records who owns a company, so StudioOS cannot count or name government-owned companies. <StateChip kind="not_recorded" />
      </p>
    </div>
  );
}

// ---- The container --------------------------------------------------------------

/** One read keyed by `key`: `{ status, data }` and a reload. Keeps the last rows while a new page loads. */
function useKeyedRead(fn, key, enabled = true) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [state, setState] = useState({ status: enabled ? 'loading' : 'idle', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setState((s) => ({ status: 'loading', data: s.data }));
    Promise.resolve().then(() => fnRef.current()).then((data) => { if (live) setState({ status: 'ready', data }); })
      .catch((e) => { if (live) setState({ status: e?.status === 404 ? 'not_found' : 'unreadable', data: null }); });
    return () => { live = false; };
  }, [key, tick, enabled]);
  return [state, () => setTick((n) => n + 1)];
}

/**
 * Part 2 (D7171-p2): what the thesis switch does while the profile it rests on
 * is not in hand. `waiting`: the profile is still being read and the view asks
 * for thesis matches, so the list waits rather than answer the whole directory
 * under a "Matches your thesis sectors" chip. `notApplied`: the profile could
 * not be read; the list is the markets the other filters leave and a Partial
 * banner says so. `impossible`: the profile is read and names no sector the
 * crosswalk maps, so no market can match.
 */
export function thesisGate({ investor, view, profileStatus, thesisRead }) {
  if (!investor) return { waiting: false, notApplied: false, impossible: false, failed: false };
  const failed = profileStatus !== 'ready' && profileStatus !== 'loading' && profileStatus !== 'idle';
  const loading = profileStatus === 'loading' || profileStatus === 'idle';
  const ready = thesisRead?.status === 'ready';
  const tracked = ready && thesisRead.thesis.kind === 'set' ? thesisRead.thesis.tracked : [];
  return {
    failed,
    waiting: !!view.thesis && loading,
    notApplied: !!view.thesis && failed,
    impossible: !!view.thesis && ready && !tracked.length,
  };
}

/**
 * The Partial state (RMD-09B, part 2): the markets were read and the investor
 * profile was not. The directory is listed; the thesis column, the match
 * marker and the matches-only switch wait for the profile.
 */
export function ThesisPartial({ notApplied = false, onRetry }) {
  return (
    <PartialBanner data-testid="markets-partial" of={2} sources={[{ name: 'your investor profile', state: 'unavailable' }]}
      rest={`Markets are listed; the Your thesis column and its matches wait for that read.${notApplied ? ' “Show only markets that match” is not applied: these are the markets the other filters leave.' : ''}`}
      onRetry={onRetry} />
  );
}

/** The view asks for thesis matches and none is possible: said, with the way out. */
export function ThesisImpossible({ thesis, onShowAll }) {
  return (
    <div data-testid="markets-thesis-impossible" className="rounded-xl border border-axal-hairline px-4 py-3 dark:border-gray-800">
      <p className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">No market can match your thesis sectors.</p>
      <p className="mt-0.5 text-[12px] text-axal-muted dark:text-gray-400">
        {thesis?.kind === 'set' ? 'None of your profile sectors maps to a tracked sector.' : 'Your profile names no sector yet.'} A market matches only through its tracked sector.
      </p>
      <button type="button" onClick={onShowAll} className={`${BTN} mt-2`}>Show all markets</button>
    </div>
  );
}

/**
 * The Market directory tab: the URL's view, the investor's thesis when the
 * reader is an investor, and one read of the Worker's page. `onData` hands the
 * page it shows to the zone (the tab's count). `onRead` hands it the read's
 * state with its exact request and the thesis, which is what Export view pages
 * through (part 2), so the file is the view and never the 25 rows on screen.
 */
export default function MarketDirectoryPanel({ role = 'founder', onData = null, onRead = null }) {
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => readMarketQuery(params), [params]);
  const onPatch = (patch) => setParams((prev) => writeMarketQuery(prev, patchMarketQuery(readMarketQuery(prev), patch)), { replace: false });
  const investor = role === 'investor';
  const [profile, reloadProfile] = useKeyedRead(() => api.getInvestorProfile(), 'profile', investor);
  const thesisRead = profile.status === 'ready' ? { status: 'ready', thesis: thesisFrom(profile.data?.profile) } : profile;
  const thesis = thesisRead.status === 'ready' && thesisRead.thesis.kind === 'set' ? thesisRead.thesis : null;
  const gate = thesisGate({ investor, view, profileStatus: profile.status, thesisRead });
  const listParams = marketListParams(view, thesis?.tracked || []);
  const listKey = JSON.stringify(listParams);
  const [read, reload] = useKeyedRead(() => researchMarketsApi.list(listParams), listKey, !gate.waiting);
  const markets = gate.waiting ? { status: 'loading', data: null } : read;
  const data = markets.status === 'ready' ? markets.data : (markets.status === 'loading' ? markets.data : null);

  useEffect(() => { if (markets.status === 'ready') onData?.(markets.data); }, [markets.status, markets.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // Export view (part 2): the read, the request that made it and the thesis it is matched against.
  const exportThesis = gate.notApplied || gate.impossible ? null : thesis;
  useEffect(() => {
    onRead?.(gate.impossible
      ? { status: 'ready', data: { total: 0 }, request: listParams, thesis: null }
      : { status: markets.status, data: markets.data, request: listParams, thesis: exportThesis });
  }, [markets.status, markets.data, listKey, gate.impossible, exportThesis]); // eslint-disable-line react-hooks/exhaustive-deps

  // RMD-05B: back from a sector page, the open row's expand button takes focus.
  const focused = useRef('');
  useEffect(() => {
    if (markets.status !== 'ready' || !view.open || focused.current === view.open) return;
    focused.current = view.open;
    const el = typeof document !== 'undefined' ? document.getElementById(ROW_ID(view.open)) : null;
    el?.focus?.();
    el?.scrollIntoView?.({ block: 'center' });
  }, [markets.status, view.open]);

  const clear = () => onPatch({ q: '', country: [], fresh: '', src: '', thesis: false });
  // A thesis switch the profile cannot back is shown as not applied, not as a filter.
  const shownView = gate.notApplied ? { ...view, thesis: false } : view;
  const chips = filterChips(view).map((c) => (c.key === 'thesis' && gate.notApplied ? { ...c, label: `${c.label} · not applied` } : c));
  const partial = gate.failed && markets.status === 'ready' ? <ThesisPartial notApplied={gate.notApplied} onRetry={reloadProfile} /> : null;
  const body = (
    <div className="min-w-0 space-y-3">
      {partial}
      {gate.impossible ? <ThesisImpossible thesis={thesisRead.thesis} onShowAll={() => onPatch({ thesis: false })} /> : (
        <>
          <ResultLine data={data} view={shownView} />
          <DirectoryBody markets={{ ...markets, data, reload }} view={view} onPatch={onPatch} thesis={thesis} onClear={clear} />
        </>
      )}
    </div>
  );
  const thesisProps = {
    read: thesisRead, onRetry: reloadProfile, total: data?.total,
    matchCount: thesisMatchCount(data?.summary, thesis), onlyMatches: view.thesis,
    onOnlyMatches: (on) => onPatch({ thesis: on }),
  };
  return (
    <div data-testid="markets-directory" className="space-y-4">
      <Toolbar view={view} onPatch={onPatch} facets={data?.facets} sectors={view.thesis ? (thesis?.tracked || []) : []} />
      {chips.length ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="markets-chips">
          {chips.map((c) => (
            <button key={c.key} type="button" onClick={() => onPatch(c.patch)}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-3 text-[12px] font-semibold text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300 md:min-h-[32px]">
              {c.label} <span aria-hidden="true">✕</span><span className="sr-only">Remove</span>
            </button>
          ))}
          <button type="button" onClick={clear} className="min-h-[44px] text-[12px] font-semibold text-axal-ink underline dark:text-gray-200 md:min-h-0">Clear filters</button>
          {data ? <span className="text-[12px] text-axal-muted dark:text-gray-400">{fmt(data.total)} of {fmt(data.directory_total)} markets</span> : null}
        </div>
      ) : null}
      {investor ? (
        <div className="grid gap-4 lg:grid-cols-[296px_minmax(0,1fr)] lg:items-start">
          {/* RMD-11D (part 2): below md the thesis is one line that opens. */}
          <div className="md:hidden"><ThesisStrip {...thesisProps} /></div>
          <div className="hidden md:block"><ThesisSection {...thesisProps} /></div>
          {body}
        </div>
      ) : body}
    </div>
  );
}
