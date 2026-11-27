/**
 * #4714 (D4714) — every page of a Practice list, read in order.
 *
 * The Practice lists answer one page at a time (`?limit=&offset=`, with
 * `page: { total, next_offset }`) and carry their totals over the whole set.
 * A page whose figures are computed from its rows (accept rate, lanes,
 * delivery state) needs all of them, so this follows `next_offset` to the end.
 * It is bounded: past `maxPages` it stops and says `complete: false`, and the
 * page says "showing N of total" rather than presenting a part as the whole.
 * The first page's other fields (`totals`, `total`) are kept as returned.
 *
 * @param {(page: {offset: number}) => Promise<any>} fetchPage
 * @param {{maxPages?: number}} [opts]
 * @returns {Promise<{items: any[], total: number|null, complete: boolean, first: any}>}
 */
export async function readEveryPage(fetchPage, { maxPages = 25 } = {}) {
  const first = await fetchPage({ offset: 0 });
  const items = Array.isArray(first?.items) ? [...first.items] : [];
  let next = first?.page?.next_offset ?? null;
  let pages = 1;
  while (next != null && pages < maxPages) {
    const res = await fetchPage({ offset: next });
    const rows = Array.isArray(res?.items) ? res.items : [];
    items.push(...rows);
    pages += 1;
    const after = res?.page?.next_offset ?? null;
    // A page that returns nothing, or does not move forward, ends the walk:
    // a server that repeats an offset must not loop the page.
    next = rows.length && after != null && after > next ? after : null;
  }
  const total = first?.page?.total ?? first?.total ?? null;
  return { items, total, complete: next == null, first };
}

/** "Showing 400 of 1,240" when the list stopped short; null when it is whole. */
export function partialLine(read) {
  if (!read || read.complete !== false) return null;
  const n = (v) => Number(v).toLocaleString('en-US');
  return read.total != null
    ? `Showing the ${n(read.items.length)} most recent of ${n(read.total)}. The figures above are over all ${n(read.total)}.`
    : `Showing the ${n(read.items.length)} most recent.`;
}
