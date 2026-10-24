import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Unreadable } from '../../../ui';
import {
  LIST_CLAIM, NO_CAP, analyticsJoin, eventHref, pageOf, rangeText, readyList, statusWord, tableRow,
} from './eventsDeskModel';
import {
  ATTENTION_NOTE, COUNTS_NEEDED, CSV_NOTE, LIST_VIEWS, PAGE_SIZES, SORTS, csvFor, csvName, filterCount, filteredRows,
  readQuery, reasonsFor, writeQuery,
} from './allEventsModel';
import EventFilters, { CONTROL } from './EventFilters';
import { CARD, INPUT, Pill, StatusPill, SUB } from './parts';

/**
 * D915 (#2368) — All events (EV6), made complete by D919 (#2702): R1 joined to
 * R2's counts under Guard G, searched by title, with the filters (Status, any
 * of several; Visibility; When; Price; Featured), the views (This week, Full,
 * Needs attention), the sorts (Starts, Created, Seats taken, Fill, Show-up),
 * 25, 50 or 100 rows a page, the CSV of the rows on screen, and phone cards
 * (EV17d). The address holds every choice but the search (`allEventsModel`).
 * Type and Format wait for part 1; the host column, host search, the Host
 * filter and "Cancelled with paid tickets" wait for part 3.
 */

const COLS = ['Event', 'Starts', 'Status', 'Visibility', 'Capacity', 'Taken', 'Waitlisted', 'Attended', 'Fill', 'Show-up', 'Price'];
const NUM = 'whitespace-nowrap px-2.5 py-2.5 text-right font-mono tabular-nums';

/** The CSV, made in the browser from the rows on screen; nothing is uploaded and no Worker is asked. */
function download(text, name) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function Reasons({ list, testId }) {
  if (!list?.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1" data-testid={testId}>
      {list.map((r) => <Pill key={r.key} tone="amber">{r.word}</Pill>)}
    </span>
  );
}

export default function EventsAll({ reads, now }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const query = readQuery(loc.search);
  useEffect(() => { setPage(1); }, [loc.search]);
  const list = readyList(reads.all);
  const join = useMemo(() => analyticsJoin(reads.analytics, list ? list.length : 0), [reads.analytics, list]);
  const rows = list ? filteredRows(list, { q, query, join, now }) : [];
  const shown = pageOf(rows, page, query.per);
  const reasons = query.view === 'attention' && list ? reasonsFor(shown.rows, list, join, now) : null;
  const counted = join.state === 'ready';

  const set = (patch) => navigate({ pathname: loc.pathname, search: writeQuery(loc.search, patch) }, { replace: true });
  const filters = filterCount(query);

  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-label="All events" data-testid="events-all">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-[200px] flex-1 flex-col">
          <span className="sr-only">Search titles</span>
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search titles" className={CONTROL} data-testid="events-all-search" />
        </label>
        <label className="flex flex-col">
          <span className="sr-only">Sort</span>
          <select value={query.sort} onChange={(e) => set({ sort: e.target.value })} className={CONTROL} data-testid="events-all-sort">
            {SORTS.map((s) => <option key={s.key} value={s.key}>{`Sort: ${s.label}`}</option>)}
          </select>
        </label>
      </div>

      {/* EV17d: on a phone the filters fold behind "Filters · [n]"; wider, they are always shown. */}
      <button type="button" aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)} className={`${CONTROL} self-start font-semibold sm:hidden`} data-testid="events-all-filters-toggle">{`Filters · ${filters}`}</button>
      <div className={showFilters ? '' : 'max-sm:hidden'} data-testid="events-all-filter-box"><EventFilters query={query} onChange={set} /></div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Views" data-testid="events-all-views">
        {LIST_VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            aria-pressed={query.view === v.key}
            onClick={() => set({ view: query.view === v.key ? null : v.key })}
            className={`min-h-[32px] rounded-full border px-3 text-[12.5px] font-semibold max-sm:min-h-[44px] ${query.view === v.key
              ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300'
              : 'border-axal-hairline bg-white text-axal-ink hover:border-axal-violet dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}
            data-testid={`events-all-view-${v.key}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {query.view === 'attention' ? <p className={`m-0 ${SUB}`} data-testid="events-all-attention-note">{counted ? ATTENTION_NOTE : COUNTS_NEEDED}</p> : null}
      {query.view === 'full' && list && !counted && join.state !== 'loading' ? <p className={`m-0 ${SUB}`} data-testid="events-all-full-note">Full needs seat counts, which could not be read.</p> : null}

      {reads.all.status === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">Reading…</span> : null}
      {reads.all.status === 'error' ? <Unreadable what="The events list" claim={LIST_CLAIM} onRetry={reads.reload} /> : null}
      {list && join.state === 'unreadable' && list.length ? <Unreadable what="Seat counts" claim={join.reason} onRetry={reads.reload} /> : null}

      {list ? (
        <>
          {rows.length ? (
            <>
              <div className="-mx-[18px] overflow-x-auto px-[18px] max-sm:hidden">
                <table className="w-full min-w-[1000px] border-collapse text-[12.5px]" data-testid="events-all-table">
                  <caption className="sr-only">{`Events, ${query.per} a page`}</caption>
                  <thead>
                    <tr className="border-b border-axal-hairline text-left text-[10.5px] font-bold uppercase tracking-[.06em] text-axal-muted dark:border-gray-700 dark:text-gray-400">
                      {COLS.map((c, i) => <th key={c} scope="col" className={`px-2.5 py-2 ${i >= 4 && i <= 9 ? 'text-right' : ''}`}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.rows.map((ev) => {
                      const r = tableRow(ev, join, now);
                      return (
                        <tr key={r.id} className="border-b border-axal-hairline align-top text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid={`events-all-row-${r.id}`}>
                          <td className="px-2.5 py-2.5">
                            <Link to={`/admin/events/${r.id}`} className="font-bold leading-snug text-axal-ink hover:text-axal-violet dark:text-gray-100 dark:hover:text-violet-300">{r.title}</Link>
                            {r.featured ? <span className="mt-0.5 block text-[10.5px] font-bold text-axal-violet dark:text-violet-300">★ Featured</span> : null}
                            <Reasons list={reasons?.get(String(r.id))} testId={`events-all-reasons-${r.id}`} />
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-2.5 font-mono text-[11.5px] font-semibold">
                            {r.starts.text}
                            {r.starts.zone ? <span className={`block font-sans font-normal ${SUB}`}>{r.starts.zone}</span> : null}
                          </td>
                          <td className="px-2.5 py-2.5"><StatusPill status={r.status} /></td>
                          <td className="px-2.5 py-2.5">{r.visibility}</td>
                          <td className={NUM}>{r.capacity}</td>
                          <td className={NUM}>{r.taken}</td>
                          <td className={NUM}>{r.waitlisted}</td>
                          <td className={NUM}>{r.attended}</td>
                          <td className={NUM}>{r.fill}</td>
                          <td className={NUM}>{r.showUp}</td>
                          <td className="whitespace-nowrap px-2.5 py-2.5 font-mono">{r.price}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 sm:hidden" data-testid="events-all-cards">
                {shown.rows.map((ev) => {
                  const r = tableRow(ev, join, now);
                  return (
                    <li key={r.id}>
                      <Link to={eventHref(r.id)} className="flex min-h-[44px] flex-col gap-1 rounded-[10px] border border-axal-hairline px-3 py-2.5 text-axal-ink hover:border-axal-violet dark:border-gray-700 dark:text-gray-100 dark:hover:border-violet-400" data-testid={`events-all-card-${r.id}`}>
                        <span className="text-[13.5px] font-bold leading-snug">{r.title}{r.featured ? <span className="ml-1.5 text-[10.5px] text-axal-violet dark:text-violet-300">★ Featured</span> : null}</span>
                        <span className="font-mono text-[11.5px] font-medium text-axal-muted dark:text-gray-400">{r.starts.zone ? `${r.starts.text} ${r.starts.zone}` : r.starts.text}</span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <StatusPill status={r.status} />
                          <span className="font-mono text-[11.5px] font-semibold">{r.capacity === NO_CAP ? `${r.taken} taken · ${NO_CAP}` : `${r.taken} / ${r.capacity}`}</span>
                        </span>
                        <Reasons list={reasons?.get(String(r.id))} testId={`events-all-card-reasons-${r.id}`} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className={`m-0 ${SUB}`} data-testid="events-all-none">{list.length ? 'No event matches.' : 'No events yet.'}</p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid="events-all-range">{rangeText(shown)}</span>
              <label className="flex items-center gap-1.5 text-[12px] text-axal-muted dark:text-gray-400">
                Rows
                <select value={query.per} onChange={(e) => set({ per: Number(e.target.value) })} className={CONTROL} data-testid="events-all-per">
                  {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </span>
            {shown.pages > 1 ? (
              <span className="flex gap-1.5">
                <button type="button" className={`${INPUT} font-semibold max-sm:min-h-[44px]`} disabled={shown.page <= 1} onClick={() => setPage(shown.page - 1)}>Previous</button>
                <button type="button" className={`${INPUT} font-semibold max-sm:min-h-[44px]`} disabled={shown.page >= shown.pages} onClick={() => setPage(shown.page + 1)}>Next</button>
              </span>
            ) : null}
          </div>
          {shown.rows.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => download(csvFor(shown.rows, join, now, { statusWord }), csvName(now))} className={`${CONTROL} font-semibold`} data-testid="events-all-csv">Download table (CSV)</button>
              <span className={SUB}>{`The ${shown.rows.length.toLocaleString('en-US')} rows on screen. ${CSV_NOTE}`}</span>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
