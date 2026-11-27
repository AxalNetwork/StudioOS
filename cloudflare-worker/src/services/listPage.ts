/**
 * #4689 (Expertise P2) — one page of an owner's list, and the facts about the
 * whole list beside it.
 *
 * The Expertise reads used to stop at a bare `LIMIT` (200 services or proof
 * items, 100 articles or booking links), so row 201 could not be reached and
 * any count taken from the returned rows described only the first page while
 * looking like the whole. A list read now takes `?limit=&offset=` and answers
 * `page: { offset, limit, total, next_offset }`:
 *
 *   total        the COUNT(*) of the full set, read by its own query
 *   next_offset  where the next page starts, or null on the last page
 *
 * Every figure a screen shows as "your N …" comes from a query over the full
 * set, never from the length or the sum of a page. The ordering behind a page
 * ends in a unique column, so a row cannot repeat or fall between two pages.
 */

export interface PageWindow { offset: number; limit: number }
export interface PageFacts extends PageWindow { total: number; next_offset: number | null }

/**
 * `?limit=` and `?offset=` read off a query, `limit` clamped to 1–`max`
 * (`max` when absent or not a whole number), `offset` 0 or more.
 */
export function pageWindow(query: { limit?: unknown; offset?: unknown }, max: number): PageWindow {
  const whole = (v: unknown) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
  };
  const l = whole(query.limit);
  const o = whole(query.offset);
  return { limit: l === null ? max : Math.min(max, Math.max(1, l)), offset: o === null ? 0 : Math.max(0, o) };
}

/** The page facts, given the full set's total and how many rows this page returned. */
export function pageFacts(w: PageWindow, total: number, returned: number): PageFacts {
  const t = Number(total) || 0;
  const end = w.offset + returned;
  return { offset: w.offset, limit: w.limit, total: t, next_offset: returned > 0 && end < t ? end : null };
}
