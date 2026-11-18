/**
 * #4843 part 3 (D4843-p3, Offers v2 board OF-02): the Catalog reads as a professional service
 * catalogue. Pure, so `frontend/test/offers_catalog_of02_4843.test.mjs` loads it alone.
 *
 * The listing state is `catalogState` in `ServiceCatalogPage.jsx`, unchanged: no price is a Draft,
 * priced and listed is Live, priced and not listed is Unlisted (the canvas's backend-fit table, OF-10).
 * Requests are the counts `GET /services/offerings` serves per row (`lib/serviceMeasures.js`, #4696):
 * a request is counted, never priced, and a row without the field reads Not recorded, never zero.
 */
import { formatMinor } from '../../../lib/money.js';
import { rowRequests } from '../../../lib/serviceMeasures.js';

/** The three states, in the order the switch lists them. */
export const LISTING_STATES = ['Live', 'Draft', 'Unlisted'];

/** The price with its basis: "$48,000 fixed", "$6,500 / month"; null when no price is set. */
export function priceBasis(o) {
  if (o?.price_cents == null) return null;
  // `service_offerings` prices in USD cents (migration 227); a whole amount drops its zero decimals.
  const amount = formatMinor(o.price_cents, 'USD', { locale: 'en-US', trimWhole: true });
  if (amount === null) return null;
  if (o.engagement_model === 'fixed') return `${amount} fixed`;
  if (o.engagement_model === 'retainer' || o.engagement_model === 'seat') return `${amount} / month`;
  return amount;
}

/** "3 requests", "0 requests"; null when the row carries no counts. */
export function requestsLine(o) {
  const r = rowRequests(o);
  if (!r) return null;
  return `${r.requested} ${r.requested === 1 ? 'request' : 'requests'}`;
}

/** How many rows sit in each state, for the switch's labels. */
export function listingCounts(rows, stateOf) {
  const list = Array.isArray(rows) ? rows : [];
  const out = { All: list.length, Live: 0, Draft: 0, Unlisted: 0 };
  for (const o of list) {
    const s = stateOf(o);
    if (Object.prototype.hasOwnProperty.call(out, s) && s !== 'All') out[s] += 1;
  }
  return out;
}

/** The rows in one state, or all of them. */
export const inListing = (key, stateOf) => (o) => key === 'All' || stateOf(o) === key;

/** The page's footnote, from the canvas. */
export const CATALOG_FOOT = 'Price is today’s listed price, not revenue earned. Draft means no price has been set yet.';
