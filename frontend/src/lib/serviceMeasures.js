/*
 * The catalogue's request counts, read once for every page that prints them
 * (#4696). `GET /services/offerings` serves `requests` on each row, counts by
 * status from `service_engagements`, and the Offers overview and the catalogue
 * zone both total them here so the tile and the table cannot disagree.
 *
 * NO MONEY IS DERIVED FROM THESE. A request stores no amount, so a count times
 * the entry's CURRENT price states a sale nobody made (a pending request is not
 * one) and is restated by every reprice. The historical booked value is
 * therefore not stated at all (`booked_value_cents` is null on the response),
 * and this file has no function that multiplies a price by a count.
 */
const KEYS = ['requested', 'pending', 'booked', 'delivered', 'invoiced', 'paid', 'cancelled'];

/** One row's counts; a row that predates the field reads as unrecorded (null), never as zero. */
export function rowRequests(o) {
  const r = o?.requests;
  if (!r || typeof r !== 'object') return null;
  const out = {};
  for (const k of KEYS) out[k] = Number(r[k]) || 0;
  return out;
}

/** The whole catalogue's counts, summed from the rows served. */
export function requestTotals(rows) {
  const out = Object.fromEntries(KEYS.map((k) => [k, 0]));
  for (const o of Array.isArray(rows) ? rows : []) {
    const r = rowRequests(o);
    if (r) for (const k of KEYS) out[k] += r[k];
  }
  return out;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The note under the Requested tile: what became of the requests, and what is not stated. */
export function requestedNote(t) {
  return `${plural(t.booked, 'booked', 'booked')} · ${t.pending} pending · booked value not recorded`;
}
