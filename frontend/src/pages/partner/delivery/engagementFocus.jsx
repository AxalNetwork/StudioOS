// D4822 (#4822, part 2) — one engagement kept selected across Delivery's zones. The engagement Sheet links to each
// zone with `?engagement=<uid>`; each zone reads it here, narrows its rows to that engagement, says so in a bar
// with "Show all", and preselects it in its create form. The parameter is the engagement's uid (its id is accepted
// too), and a value no row carries narrows to nothing and says so — never to a different engagement.
import React, { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

/** True when a row belongs to the focused engagement (or nothing is focused). */
export function matchesFocus(row, key) {
  if (!key) return true;
  return String(row?.engagement_uid ?? '') === key || String(row?.engagement_id ?? '') === key;
}

/** The focused engagement's display name, from the first row that belongs to it. */
export function focusLabel(rows, key) {
  const r = (rows || []).find((x) => matchesFocus(x, key));
  return r ? (r.founder_name || r.client || r.need_title || r.engagement_uid || null) : null;
}

/** The focused engagement's numeric id (for a create form), from the rows or the engagement list. */
export function focusEngagementId(lists, key) {
  if (!key) return '';
  for (const list of lists) {
    const r = (list || []).find((x) => matchesFocus(x, key));
    if (r?.engagement_id != null) return String(r.engagement_id);
  }
  return '';
}

/** The zone's `?engagement=` value and a function that clears it, keeping the rest of the query. */
export function useEngagementFocus() {
  const [params, setParams] = useSearchParams();
  const key = params.get('engagement') || '';
  const clear = useCallback(() => setParams((p) => { const n = new URLSearchParams(p); n.delete('engagement'); return n; }), [setParams]);
  return { key, clear };
}

/**
 * The bar a focused zone draws above its rows: whose rows these are, how many of the zone's total, a way back to the
 * engagement on Board, and Show all. Nothing when no engagement is focused.
 */
export function EngagementFocusBar({ focusKey, label, shown, total, noun = 'records', onClear }) {
  if (!focusKey) return null;
  return (
    <div role="status" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[#ececf1] bg-[#f4f0fe] px-3 py-2 text-[14px] text-[#18181b] dark:border-gray-700 dark:bg-violet-950/30 dark:text-gray-100" data-testid="engagement-focus">
      <span>
        Showing <b>{label || 'an engagement this zone has no records for'}</b>
        {' '}· {shown} of {total} {noun}
      </span>
      <Link to={`/delivery/board?engagement=${encodeURIComponent(focusKey)}`} className="font-semibold text-[#7c3aed] hover:underline dark:text-[#a78bfa]">Back to engagement</Link>
      <button type="button" onClick={onClear} className="font-semibold text-[#7c3aed] hover:underline dark:text-[#a78bfa]">Show all</button>
    </div>
  );
}
