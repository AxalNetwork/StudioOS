/**
 * D4607 — a Research detail page answers only the record its route names.
 *
 * A detail page reads its record when the route opens it. When the route moves
 * on (another analysis, another company in the same analysis) or the page
 * leaves, the reads already in flight still answer, and nothing stopped a late
 * one from drawing record A on route B, after which Save sent A's fields to B.
 *
 * `createRecordGate()` hands each read a ticket. `begin()` starts a read and
 * returns `fresh()`, true while that read is still the latest one; any newer
 * read, or `invalidate()` (on unmount), makes every older ticket stale, so a
 * late success, a late failure and the `finally` that clears loading are all
 * dropped together.
 *
 * `recordKey(...parts)` names a record by its route identity, and
 * `sameRecord(loaded, route)` is the write rule: a page writes only when the
 * record it loaded is the one its route names now, and it writes to the
 * loaded record's identity, never to whatever the route says by then.
 */
export function createRecordGate() {
  let generation = 0;
  return {
    begin() {
      const mine = ++generation;
      return () => mine === generation;
    },
    invalidate() { generation += 1; },
  };
}

/** One string per record: the route parameters that name it, in order. */
export function recordKey(...parts) {
  if (parts.some((p) => p === undefined || p === null || String(p) === '')) return null;
  return JSON.stringify(parts.map(String));
}

/** True only when a record is loaded and it is the one the route names. */
export function sameRecord(loadedKey, routeKey) {
  return loadedKey != null && routeKey != null && loadedKey === routeKey;
}
