import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ghostButtonClass } from '../kit';

/**
 * #4709 (D4709) — the rest of a Delivery history, a page at a time.
 *
 * The zone's own read (`useZoneRead`) is the first page; `useMorePages` adds
 * the pages after it on request and starts again whenever the first page is
 * read again. The rows are joined by key, so a row that moved between two
 * reads is never shown twice.
 *
 * FOUR STATES, NEVER CONFUSED (the canvas's state copy):
 *   complete     every row is shown — nothing is drawn, or "All N shown" past one page;
 *   paginated    "Showing 300 of 412 deliverables" and Load more;
 *   loading more the rows stay, the button says Loading more…;
 *   partial      a later page failed: the rows shown stay, and the note says the
 *                rest could not be read, with Retry. Never an empty list, never
 *                a total that pretends the shown rows are all of them.
 */
export function useMorePages(first, fetchPage, keyOf) {
  const [extra, setExtra] = useState({ items: [], page: null, loading: false, error: '' });
  const seq = useRef(0);
  useEffect(() => {
    seq.current += 1;
    setExtra({ items: [], page: null, loading: false, error: '' });
  }, [first]);
  const page = extra.page || first?.page || null;
  const loadMore = useCallback(async () => {
    const cursor = page?.next_cursor;
    if (!cursor || extra.loading) return;
    const mine = seq.current;
    setExtra((x) => ({ ...x, loading: true, error: '' }));
    try {
      const r = await fetchPage({ cursor });
      if (mine !== seq.current) return;
      setExtra((x) => ({
        items: [...(Array.isArray(x?.items) ? x.items : []), ...(Array.isArray(r?.items) ? r.items : [])],
        page: r?.page || null, loading: false, error: '',
      }));
    } catch (e) {
      if (mine !== seq.current) return;
      setExtra((x) => ({ ...x, loading: false, error: e?.message || 'not read' }));
    }
  }, [page, extra.loading, fetchPage]);
  const items = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const r of [...(Array.isArray(first?.items) ? first.items : []), ...(Array.isArray(extra?.items) ? extra.items : [])]) {
      const k = keyOf(r);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
    return out;
  }, [first, extra.items, keyOf]);
  return { items, page, loadMore, loadingMore: extra.loading, moreError: extra.error };
}

export function HistoryPager({ page, shown, noun, loadingMore = false, moreError = '', onMore }) {
  if (!page) return null;
  const total = Number(page.total ?? shown);
  if (moreError) {
    return (
      <div role="alert" data-testid="history-pager" data-state="partial"
        className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        <span aria-hidden="true">!</span>
        <div className="min-w-0 flex-1">
          <b>The rest of the {noun} could not be read</b>
          <div>The {shown} shown are current; {Math.max(total - shown, 0)} more are not shown yet.</div>
        </div>
        <button type="button" className={ghostButtonClass} onClick={onMore}>Retry</button>
      </div>
    );
  }
  if (!page.next_cursor) {
    if (total <= Number(page.limit ?? total)) return null;
    return <p data-testid="history-pager" data-state="complete" className="text-[12px] text-axal-muted">All {total} {noun} shown.</p>;
  }
  return (
    <div role="status" data-testid="history-pager" data-state="paginated"
      className="flex flex-wrap items-center gap-3 text-[12.5px] text-axal-muted">
      <span>Showing {shown} of {total} {noun}.</span>
      <button type="button" className={ghostButtonClass} aria-disabled={loadingMore || undefined}
        onClick={() => { if (!loadingMore) onMore(); }}>
        {loadingMore ? 'Loading more…' : 'Load more'}
      </button>
    </div>
  );
}
