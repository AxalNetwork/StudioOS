import React from 'react';

/**
 * The notification list — ONE rendering, read by the bell and by /inbox (D144).
 *
 * WHY THIS IS A COMPONENT AND NOT A SECOND COPY. `NotificationBell` had the
 * only rendering of a notification row in the SPA, inside a dropdown that has
 * no URL. `notify.ts` builds `${root}/inbox` into the mail it sends, so an
 * email CTA needed an addressable page — and the obvious way to build one is to
 * write the rows again. `frontend/src/lib/README.md` states the rule this
 * follows instead: "If a helper appears in two places, put it here once rather
 * than a third time." Two renderings would drift, and the thing they would
 * drift about is what a person believes they were told.
 *
 * SO THE ROWS ARE IDENTICAL IN BOTH, deliberately, with no `variant` prop. The
 * dropdown is narrow and the page is wide; the same row reads correctly in
 * both, and giving the page its own row shape would re-open exactly the gap
 * this component closes.
 */

/** Compact relative age. Lives here because the rows are its only caller. */
export function timeAgo(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export default function NotificationList({ items, loading, onItemClick, unreadable = false }) {
  if (loading) {
    return <div className="px-4 py-6 text-sm text-gray-500 text-center dark:text-gray-400">Loading…</div>;
  }
  // AN UNREADABLE LIST IS NOT AN EMPTY ONE. "You're all caught up" is a claim
  // about the store; when the read failed, nothing measured it.
  if (unreadable) {
    return (
      <div className="px-4 py-8 text-sm text-gray-500 text-center dark:text-gray-400">
        Your notifications could not be loaded, so this is not a claim that there are none.
      </div>
    );
  }
  if (!items || items.length === 0) {
    return (
      <div className="px-4 py-8 text-sm text-gray-500 text-center dark:text-gray-400">
        You&apos;re all caught up.
      </div>
    );
  }
  return (
    <>
      {items.map((n) => (
        <button
          key={n.id}
          onClick={() => onItemClick(n)}
          className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800 ${n.read_at ? '' : 'bg-violet-50/40 dark:bg-violet-950/20'}`}
        >
          <div className="flex items-start gap-2">
            {!n.read_at && <span className="mt-1.5 w-2 h-2 rounded-full bg-violet-600 flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate dark:text-gray-100">{n.title}</div>
              {n.body && <div className="text-xs text-gray-600 mt-0.5 line-clamp-2 dark:text-gray-400">{n.body}</div>}
              <div className="text-[10px] text-gray-400 mt-1 uppercase tracking-wide dark:text-gray-500">
                {n.type} · {timeAgo(n.created_at)} ago
              </div>
            </div>
          </div>
        </button>
      ))}
    </>
  );
}
