import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Unreadable } from '../../../ui';
import {
  LIST_CLAIM, STATUSES, allRows, analyticsJoin, pageOf, rangeText, readyList, statusFromSearch, tableRow,
} from './eventsDeskModel';
import { CARD, INPUT, StatusPill, SUB } from './parts';

/**
 * D915 (#2368) — All events (EV6): R1 joined to R2's counts under Guard G,
 * searched by title, filtered by the status in the address (`?status=`), in
 * the canvas's default order, 25 rows a page. Each title opens the event's
 * page. The other filters, views, sorts, the CSV and the phone cards are D915
 * part 4; type and format wait for part 1.
 */

const COLS = ['Event', 'Starts', 'Status', 'Visibility', 'Capacity', 'Taken', 'Waitlisted', 'Attended', 'Fill', 'Show-up', 'Price'];
const NUM = 'whitespace-nowrap px-2.5 py-2.5 text-right font-mono tabular-nums';

export default function EventsAll({ reads, now }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const status = statusFromSearch(loc.search);
  const list = readyList(reads.all);
  const join = useMemo(() => analyticsJoin(reads.analytics, list ? list.length : 0), [reads.analytics, list]);
  const rows = list ? allRows(list, { q, status, now }) : [];
  const shown = pageOf(rows, page);

  const pickStatus = (value) => {
    const next = new URLSearchParams(loc.search);
    if (value) next.set('status', value); else next.delete('status');
    const s = next.toString();
    setPage(1);
    navigate({ pathname: loc.pathname, search: s ? `?${s}` : '' }, { replace: true });
  };

  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-label="All events" data-testid="events-all">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-[200px] flex-1 flex-col">
          <span className="sr-only">Search titles</span>
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search titles" className={INPUT} data-testid="events-all-search" />
        </label>
        <label className="flex flex-col">
          <span className="sr-only">Status</span>
          <select value={status || ''} onChange={(e) => pickStatus(e.target.value)} className={INPUT} data-testid="events-all-status">
            <option value="">Status: All</option>
            {STATUSES.map((s) => <option key={s.key} value={s.key}>{`Status: ${s.word}`}</option>)}
          </select>
        </label>
      </div>

      {reads.all.status === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">Reading…</span> : null}
      {reads.all.status === 'error' ? <Unreadable what="The events list" claim={LIST_CLAIM} onRetry={reads.reload} /> : null}
      {list && join.state === 'unreadable' && list.length ? <Unreadable what="Seat counts" claim={join.reason} onRetry={reads.reload} /> : null}

      {list ? (
        <>
          {rows.length ? (
            <div className="-mx-[18px] overflow-x-auto px-[18px]">
              <table className="w-full min-w-[1000px] border-collapse text-[12.5px]" data-testid="events-all-table">
                <caption className="sr-only">Every event, 25 a page</caption>
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
          ) : (
            <p className={`m-0 ${SUB}`} data-testid="events-all-none">{list.length ? 'No event matches.' : 'No events yet.'}</p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid="events-all-range">{rangeText(shown)}</span>
            {shown.pages > 1 ? (
              <span className="flex gap-1.5">
                <button type="button" className={`${INPUT} font-semibold`} disabled={shown.page <= 1} onClick={() => setPage(shown.page - 1)}>Previous</button>
                <button type="button" className={`${INPUT} font-semibold`} disabled={shown.page >= shown.pages} onClick={() => setPage(shown.page + 1)}>Next</button>
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
