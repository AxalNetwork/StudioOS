import React from 'react';
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
 */
const day = (v) => {
  const d = v ? new Date(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) || String(v).length <= 10 ? '' : 'Z')) : null;
  return d && !Number.isNaN(d.valueOf()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null;
};
const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;

/** The row's title: "Update · October 2026", else its stored period or title. */
export function updateTitle(u) {
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

export default function UpdatesHistory({ updates, reason = null, onShare }) {
  if (updates === undefined) return null;
  let body;
  if (updates === null) body = <p role="alert" className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="updates-unreadable">{reason || 'Unreadable: Updates history could not be read'}</p>;
  else if (!updates.length) body = (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid="updates-none">
      <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">No update shared yet</p>
      {onShare && <button type="button" onClick={onShare} className="rounded-[9px] bg-violet-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400">Share an update</button>}
    </div>
  );
  else body = (
    <ul className="m-0 list-none p-0">
      {updates.map((u) => (
        <li key={u.uid} className="flex items-start justify-between gap-3 border-b border-axal-ground py-2 text-[12.5px] last:border-b-0 dark:border-gray-800" data-testid="updates-row">
          <div className="min-w-0">
            {u.href ? <Link to={u.href} className="font-semibold text-axal-ink hover:underline dark:text-gray-100">{updateTitle(u)}</Link>
              : <span className="font-semibold text-axal-ink dark:text-gray-100">{updateTitle(u)}</span>}
            <div className="text-axal-muted dark:text-gray-400">{updateLine(u)}</div>
          </div>
          {u.asks_to_ask_again > 0 && <span className={AMBER}>Ask again</span>}
        </li>
      ))}
    </ul>
  );
  return (
    <section id="updates" className="flex min-w-0 scroll-mt-4 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-part-updates" aria-labelledby="updates-title">
      <h2 id="updates-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">Updates</h2>
      {body}
    </section>
  );
}
