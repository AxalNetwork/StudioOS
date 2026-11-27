/**
 * D9025 (#9025): one page of the shared directory for the search and cursor trail the address holds.
 * Shared by People (#9025, `kind=person`) and the Organizations directory (#9071, `kind=organization`).
 *
 * FOUR STATES, NEVER MERGED (D7676 NPD-09): `loading` (no rows, the total reads Counting…), `ready`,
 * `error` (the first read of this search failed: Unavailable with Try again, never an empty list) and
 * a later page that failed: the rows of the last good page stay on screen with its total, and
 * `laterFailed` names the page that could not be read.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { networkDirectoryApi } from '../../../lib/api/networkDirectory.js';
import { PAGE_SIZE, cursorOf, pageOf } from './directoryModel.js';

export function useDirectoryPage({ kind, q, stack, api = networkDirectoryApi }) {
  const [read, setRead] = useState({ state: 'loading', rows: [], total: null, next: null, page: 1, laterFailed: null });
  const [attempt, setAttempt] = useState(0);
  // The last page that read well, for this kind and search: what stays on screen when a later page fails.
  const lastGood = useRef(null);
  const cursor = cursorOf(stack);
  const page = pageOf(stack);
  const searchKey = `${kind}\u0000${q}`;

  useEffect(() => {
    let live = true;
    const good = lastGood.current && lastGood.current.key === searchKey ? lastGood.current : null;
    // A new search starts from nothing; another page of the same search keeps what is shown until it answers.
    if (!good) setRead({ state: 'loading', rows: [], total: null, next: null, page, laterFailed: null });
    api.entries({ kind, q, cursor, limit: PAGE_SIZE }).then((out) => {
      if (!live) return;
      const rows = Array.isArray(out?.entries) ? out.entries : [];
      const total = Number.isFinite(Number(out?.total)) ? Number(out.total) : null;
      const next = out?.next_cursor || null;
      lastGood.current = { key: searchKey, rows, total, next, page, stack };
      setRead({ state: total === null ? 'error' : 'ready', rows, total, next, page, laterFailed: null });
    }, () => {
      if (!live) return;
      if (good && page !== good.page) {
        setRead({ state: 'ready', rows: good.rows, total: good.total, next: good.next, page: good.page, laterFailed: page, shownStack: good.stack });
      } else {
        lastGood.current = null;
        setRead({ state: 'error', rows: [], total: null, next: null, page, laterFailed: null });
      }
    });
    return () => { live = false; };
    // `stack` is read through `cursor` and `page`; `api` is fixed for a mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, q, cursor, page, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...read, retry };
}
