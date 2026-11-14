import React, { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { periodTitle } from '../founder/ShareUpdateSheet';

/**
 * D686 §5.8 item 11 (#1599) — Durable company building's Updates section
 * (`id="updates"`), Grow's history: the venture's shared updates, newest
 * first, from the module read's `parts.updates` (S19-B, #1595).
 *
 *   "Update · October 2026 · Sent 1 Nov · 3 investors, 2 team · opened 4 · 1 reply"
 *
 * A row links only when the Worker gives an `href` (the author, or an admin);
 * a legacy submission is unlinked with its label. An amber "Ask again" pill
 * marks an update with an ask unanswered after 14 days. `updates: null` is
 * Unreadable, never "none yet"; an empty list offers Share an update.
 * `rowAction(u)` draws beside a sent row (D1321: the desk's Publish to…).
 */
const day = (v) => {
  const d = v ? new Date(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) || String(v).length <= 10 ? '' : 'Z')) : null;
  return d && !Number.isNaN(d.valueOf()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null;
};
const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;

/** The row's title: "Update · October 2026", else its stored period or title. */
export function updateTitle(u) {
  if (u.kind === 'report') return u.title || 'Report';
  if (u.period_start && u.period_end) return `Update · ${periodTitle(u.period_start, u.period_end)}`;
  return u.period ? `Update · ${u.period}` : (u.title || 'Update');
}

/** The row's line, from the Worker's counts; a legacy row has its label instead. */
export function updateLine(u) {
  if (!u.sent_at) return u.label || 'Not sent';
  const s = u.sent_to || {};
  const to = [s.investors > 0 && n(s.investors, 'investor', 'investors'), s.team > 0 && `${s.team} team`, s.network > 0 && `${s.network} in the network`].filter(Boolean).join(', ');
  return [`Sent ${day(u.sent_at) || String(u.sent_at).slice(0, 10)}`, to || null,
    u.opened != null && `opened ${u.opened}`, u.replies != null && n(u.replies, 'reply', 'replies')].filter(Boolean).join(' · ');
}

const AMBER = 'whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200';

const FILTER = 'min-h-[36px] min-w-0 w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const yearOf = (row) => /^(\d{4})-/.exec(row.sent_at || row.submitted_at || '')?.[1];

export default function UpdatesHistory({ updates, reason = null, onShare, rowAction = null, filterable = false }) {
  const filterId = useId();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [year, setYear] = useState('');
  const rows = updates ?? [];
  const years = filterable ? [...new Set(rows.map(yearOf).filter(Boolean))].sort().reverse() : [];
  const search = query.trim().toLowerCase();
  const shown = filterable ? rows.filter((row) =>
    (!kind || (row.kind || 'update') === kind) &&
    (!year || yearOf(row) === year) &&
    (!search || [updateTitle(row), row.title].some((title) => title?.toLowerCase().includes(search)))
  ) : rows;
  if (updates === undefined) return null;
  let body;
  if (updates === null) body = <p role="alert" className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="updates-unreadable">{reason || 'Unreadable: Updates history could not be read'}</p>;
  else if (!updates.length) body = (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid="updates-none">
      <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">{filterable ? 'No reports or updates shared yet' : 'No update shared yet'}</p>
      {onShare && <button type="button" onClick={onShare} className="rounded-[9px] bg-violet-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400">Share an update</button>}
    </div>
  );
  else if (!shown.length) body = <p className="m-0 py-2 text-[12.5px] text-axal-muted dark:text-gray-400">No reports or updates match these filters.</p>;
  else body = (
    <ul className="m-0 list-none p-0">
      {shown.map((u) => (
        <li key={u.uid} className="flex flex-wrap items-start justify-between gap-2 border-b border-axal-ground py-2 text-[12.5px] last:border-b-0 dark:border-gray-800" data-testid="updates-row">
          <div className="min-w-0 flex-1 break-words">
            {u.href ? <Link to={u.href} className="font-semibold text-axal-ink hover:underline dark:text-gray-100">{updateTitle(u)}</Link>
              : <span className="font-semibold text-axal-ink dark:text-gray-100">{updateTitle(u)}</span>}
            <div className="text-axal-muted dark:text-gray-400">{updateLine(u)}</div>
          </div>
          <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
            {u.asks_to_ask_again > 0 && <span className={AMBER}>Ask again</span>}
            {/* D1321 (#3482): Publish to… on a sent update, when the page gives one. */}
            {rowAction && u.sent_at ? rowAction(u) : null}
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <section id="updates" className="flex min-w-0 scroll-mt-4 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-part-updates" aria-labelledby="updates-title">
      <h2 id="updates-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">{filterable ? 'History' : 'Updates'}</h2>
      {filterable && rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <label className="col-span-2 flex min-w-0 flex-col gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-100 sm:col-span-1">
              Search by title
              <input className={FILTER} type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <div className="flex min-w-0 flex-col gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-100">
              <label htmlFor={`${filterId}-kind`}>Kind</label>
              <select id={`${filterId}-kind`} className={FILTER} value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="">All kinds</option>
                <option value="report">Reports</option>
                <option value="update">Updates</option>
              </select>
            </div>
            <div className="flex min-w-0 flex-col gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-100">
              <label htmlFor={`${filterId}-year`}>Year</label>
              <select id={`${filterId}-year`} className={FILTER} value={year} onChange={(event) => setYear(event.target.value)}>
                <option value="">All years</option>
                {years.map((value) => <option key={value}>{value}</option>)}
              </select>
            </div>
          </div>
          <p role="status" className="m-0 text-[12px] text-axal-muted dark:text-gray-400">
            Showing {shown.length} of {rows.length}{rows.length >= 100 ? ' most recent entries' : ' entries'}
          </p>
        </>
      )}
      {body}
    </section>
  );
}
