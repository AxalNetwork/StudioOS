// #4701 — read a cursor-paged list to the end, and say so when it could not.
//
// A capped list that stops at its first page and says nothing reads as "that
// is all of them". The Pipeline lists (leads, proposals, negotiations,
// retainers, the Build desk) return `{ items, next_cursor, has_more }`; this
// follows `next_cursor` until it runs out and returns ONE envelope: the first
// page's totals and notes, every item read, and two flags.
//
//   complete          every page was read
//   remainder_error   the first page answered and a later one did not. The
//                     items are real and are kept; the screen says the rest
//                     could not be read rather than showing a short list as
//                     the whole of it.
//
// A first page that fails THROWS: nothing was read, so there is nothing to
// show but the unreadable state.
//
// Pure: no React and no API import, so a Node test drives it with a stub.

export const MAX_PAGES = 200;

/**
 * @param {(cursor: string|null) => Promise<any>} fetchPage
 * @param {{maxPages?: number}} [opts]
 */
export async function readAllPages(fetchPage, { maxPages = MAX_PAGES } = {}) {
  const first = await fetchPage(null);
  // A legacy array body (the FastAPI dev mirror) is one complete page.
  if (Array.isArray(first)) {
    return { items: first, total: first.length, has_more: false, next_cursor: null, complete: true, remainder_error: false };
  }
  const items = [...(first?.items || [])];
  let cursor = first?.next_cursor || null;
  let remainderError = false;
  for (let page = 1; cursor && page < maxPages; page += 1) {
    let next;
    try { next = await fetchPage(cursor); } catch { remainderError = true; break; }
    const rows = next?.items || [];
    items.push(...rows);
    cursor = next?.next_cursor || null;
    if (!rows.length && cursor) { remainderError = true; break; } // a cursor that moves nowhere is not progress
  }
  const complete = !cursor && !remainderError;
  return {
    ...first,
    items,
    next_cursor: cursor,
    has_more: Boolean(cursor),
    complete,
    remainder_error: !complete,
  };
}

/**
 * The Leads zone pages two lists at once: the open leads (`cursor` →
 * `next_cursor`) and the passes (`passed_cursor` → `passed_next_cursor`). Every
 * request can answer both, so each list ignores the other's repeat once it has
 * its own first page.
 *
 * @param {(cursor: string|null, passedCursor: string|null) => Promise<any>} fetchPage
 */
export async function readAllLeadPages(fetchPage, { maxPages = MAX_PAGES } = {}) {
  const first = await fetchPage(null, null);
  if (Array.isArray(first)) return { items: first, passed: [], complete: true, remainder_error: false };
  const items = [...(first?.items || [])];
  const passed = [...(first?.passed || [])];
  let cursor = first?.next_cursor || null;
  let passedCursor = first?.passed_next_cursor || null;
  let remainderError = false;
  for (let page = 1; (cursor || passedCursor) && page < maxPages; page += 1) {
    let next;
    try { next = await fetchPage(cursor, passedCursor); } catch { remainderError = true; break; }
    if (cursor) {
      const rows = next?.items || [];
      items.push(...rows);
      cursor = next?.next_cursor || null;
      if (!rows.length && cursor) { remainderError = true; break; }
    }
    if (passedCursor) {
      const rows = next?.passed || [];
      passed.push(...rows);
      passedCursor = next?.passed_next_cursor || null;
      if (!rows.length && passedCursor) { remainderError = true; break; }
    }
  }
  const complete = !cursor && !passedCursor && !remainderError;
  return {
    ...first, items, passed,
    next_cursor: cursor, has_more: Boolean(cursor),
    passed_next_cursor: passedCursor, passed_has_more: Boolean(passedCursor),
    complete, remainder_error: !complete,
  };
}
