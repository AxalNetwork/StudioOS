import { useCallback, useRef, useState } from 'react';
import { reportError } from '../../../lib/log';
import { zoneError } from './licenceRefusal';

/**
 * #4689 — one Expertise list, read a page at a time.
 *
 * The Worker answers each list with `page: { offset, limit, total, next_offset }`
 * and, for the figures a zone shows, `counts` over the whole list. A zone keeps
 * the rows it has read so far and asks for `next_offset` when the person wants
 * more, so every row stays reachable. Its tiles and summaries read `counts` or
 * `page.total`, never the length of the rows on screen.
 *
 * Rows are merged by their key, so a row that moved between two reads (a new
 * one was added at the top) is drawn once.
 */

const keyOf = (row, rowKey) => (row && row[rowKey] != null ? String(row[rowKey]) : null);

/** The list part of a page answer, under `key` (`items` for most, `surfaces` for Visibility). */
export function rowsOf(res, key = 'items') {
  return Array.isArray(res?.[key]) ? res[key] : [];
}

/** `prev` rows with the page's rows appended, each row once. */
export function appendRows(prev, next, rowKey = 'id') {
  const seen = new Set();
  const out = [];
  for (const row of [...(prev || []), ...(next || [])]) {
    const k = keyOf(row, rowKey);
    if (k !== null) {
      if (seen.has(k)) continue;
      seen.add(k);
    }
    out.push(row);
  }
  return out;
}

/** Where the next page starts, or null when every row has been read. */
export function nextOffset(page) {
  const n = page?.next_offset;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** "Showing 100 of 101" while rows remain, else null: a whole list needs no such line. */
export function showingLine(shown, page) {
  const total = Number(page?.total);
  if (!Number.isFinite(total) || nextOffset(page) === null) return null;
  return `Showing ${shown} of ${total}`;
}

/**
 * A zone's list, read a page at a time: `load()` reads the first page again
 * (after a write, say), `more()` appends the next one. `res` is the latest
 * answer, so its `counts` are always the freshest whole-list figures. A failed
 * "more" keeps the rows already read and says so beside the button.
 *
 *   fetchPage({ offset })  the zone's api call for one page
 *   key                    where the rows are in an answer ('items', 'surfaces')
 *   pageKey                where the page facts are ('page', or 'links')
 *   rowKey                 the field each row is merged on
 *   counts                 which rows the page's `total` counts (Visibility's
 *                          "Booked without a link" row is not one of its links)
 *   errorText              the sentence for a first page that failed
 *   moreErrorText          the sentence for a "Show more" that failed
 *   surface                'expertise' or 'practice': whose licence sentence
 *                          a 403 `advisor_licence_required` reads as (#5363)
 *
 * A FAILURE READS AS A FIXED SENTENCE (#4697), never the thrown error's text:
 * `errorText` for a first page, `moreErrorText` for a "Show more". A raw
 * message can carry a driver or SQL fragment, and a zone is read by the
 * advisor, not by us. The thrown error goes to `reportError`, so nothing
 * is hidden from the logs.
 */
export function usePagedList(fetchPage, {
  key = 'items', pageKey = 'page', rowKey = 'id', counts = null,
  errorText = 'This list could not be read.',
  moreErrorText = 'The next rows could not be read. Try again.',
  refreshErrorText = 'The list could not be read again, so it may be out of date. Try again.',
  surface = 'expertise',
} = {}) {
  const [state, setState] = useState({ loading: true, error: '', rows: [], res: null, moreBusy: false, moreError: '' });
  const latest = useRef(null);
  // D4711: the newest read wins. Two writes in a row start two re-reads; the
  // older one can answer last, and must not redraw the list as it was.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setState((c) => ({ ...c, loading: true, error: '', moreError: '' }));
    try {
      const res = await fetchPage({});
      if (mine !== seq.current) return;
      latest.current = res;
      setState({ loading: false, error: '', rows: rowsOf(res, key), res, moreBusy: false, moreError: '' });
    } catch (e) {
      reportError('expertise:list', e);
      if (mine !== seq.current) return;
      latest.current = null;
      // #5363: the licence refusal reads as its own sentence (no Try again).
      setState({ loading: false, error: zoneError(e, errorText, surface), rows: [], res: null, moreBusy: false, moreError: '' });
    }
  }, [fetchPage, key, errorText, surface]);
  const more = useCallback(async () => {
    const offset = nextOffset(latest.current?.[pageKey]);
    if (offset === null) return;
    setState((c) => ({ ...c, moreBusy: true, moreError: '' }));
    try {
      const res = await fetchPage({ offset });
      latest.current = res;
      setState((c) => ({ ...c, rows: appendRows(c.rows, rowsOf(res, key), rowKey), res, moreBusy: false }));
    } catch (e) {
      reportError('expertise:list-more', e);
      setState((c) => ({ ...c, moreBusy: false, moreError: moreErrorText }));
    }
  }, [fetchPage, key, pageKey, rowKey, moreErrorText]);
  /**
   * D4711 — re-read after a write, IN PLACE. `load()` is the first read: it
   * draws the loading state, and so unmounts every row (an open consent form
   * and its "Request recorded" line with it) and keeps only the first page.
   * `refresh()` keeps the rows on screen while it reads, and reads as many rows
   * as were shown, page by page, so a row reached through "Show more" is still
   * there after an unrelated edit. A failed re-read keeps the rows it had and
   * says the list may be out of date (`refreshError`); the write itself is
   * already reported by the zone.
   */
  const stateRef = useRef(state);
  stateRef.current = state;
  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    const want = Math.max(stateRef.current.rows.length, 1);
    setState((c) => ({ ...c, refreshError: '' }));
    try {
      let res = await fetchPage({});
      let rows = rowsOf(res, key);
      // Bounded: one page per page already shown, never past the end.
      for (let guard = 0; rows.length < want && nextOffset(res?.[pageKey]) !== null && guard < 50; guard += 1) {
        const page = await fetchPage({ offset: nextOffset(res[pageKey]) });
        rows = appendRows(rows, rowsOf(page, key), rowKey);
        res = page;
      }
      if (mine !== seq.current) return;
      latest.current = res;
      setState((c) => ({ ...c, loading: false, error: '', rows, res, moreError: '', refreshError: '' }));
    } catch (e) {
      reportError('expertise:list-refresh', e);
      if (mine !== seq.current) return;
      setState((c) => ({ ...c, refreshError: refreshErrorText }));
    }
  }, [fetchPage, key, pageKey, rowKey, refreshErrorText]);
  const line = showingLine(counts ? state.rows.filter(counts).length : state.rows.length, state.res?.[pageKey]);
  return { ...state, refreshError: state.refreshError || '', load, more, refresh, line };
}
