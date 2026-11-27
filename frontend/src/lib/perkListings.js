/*
 * The firm's perk listings as ONE view model, read by every page that names
 * them (#4696): the Perk deals zone (`PerksPage`, partner side) and the Offers
 * overview board (`workspaces/boards/partnerOffers.js`).
 *
 * THE OVERVIEW USED TO READ A DIFFERENT DATASET. It called `GET /perks/mine`,
 * which is the VIEWER'S CLAIMS on other firms' perks (`perk_claims`), and drew
 * them under "Perk deals" as the firm's submitted listings, reading `title`,
 * `name` and `status === 'live'` off rows that carry `offer`, `partner_name` and
 * a claim status. The destination reads `GET /perks/partner` (the firm's own
 * submissions, with a review state and a lifecycle). Both now start from that
 * response and from the functions below, so a name, a count and a state cannot
 * be spelt two ways.
 *
 * `lifecycle` is SERVED by the worker (`perkLifecycle` in routes/perks.ts) and
 * never recomputed here: a copy of the thirty-day window in a page is how two
 * pages come to disagree about which perks are ending.
 */

/** `live` | `expiring` | `expired` for one listing, as the worker computed it. */
export function perkState(p) {
  const s = String(p?.lifecycle || '');
  return s === 'expiring' || s === 'expired' ? s : 'live';
}

/**
 * Which chip a listing answers to.
 *
 * `Live` IS BOTH THINGS: approved AND not ended. A perk approved in March and
 * ended in June is not accepting anything. A draft with a far-off end date
 * answers to `All` and to nothing else.
 */
export function matchesPerkChip(p, chip) {
  const state = perkState(p);
  if (chip === 'live') return p.status === 'live' && state === 'live';
  if (chip === 'expiring') return state === 'expiring';
  if (chip === 'expired') return state === 'expired';
  return true;
}

export const PERK_STATE_LABEL = { live: 'Live', expiring: 'Expiring', expired: 'Expired' };

/** The review state, in words. `live` is "Approved" here: the lifecycle says whether it still runs. */
export const PERK_REVIEW_LABEL = {
  draft: 'Draft',
  in_review: 'In review',
  live: 'Live',
  paused: 'Paused',
  rejected: 'Rejected',
};

/** The name a listing is known by: the offer, never a claim's partner field. */
export function perkListingName(p) {
  return String(p?.offer || '').trim() || null;
}

/**
 * Rows for a list of listings: the same fields the destination draws.
 * `state` is what the offer is doing now; `review` is what an Axal reviewer
 * decided. They are different questions and both are kept.
 */
export function perkListingRows(items) {
  return (Array.isArray(items) ? items : []).map((p) => ({
    key: p.uid,
    name: perkListingName(p),
    review: p.status,
    reviewLabel: PERK_REVIEW_LABEL[p.status] || String(p.status || '').replace('_', ' '),
    state: perkState(p),
    stateLabel: PERK_STATE_LABEL[perkState(p)],
    // Live means approved AND not ended: the one count both pages print.
    live: matchesPerkChip(p, 'live'),
  }));
}

/**
 * The three lifecycle sets the Perk deals strip counts, over the whole listing
 * book and never a chip-narrowed view. The zone draws its tiles from these
 * arrays and the Offers overview counts them, so the two cannot disagree.
 */
export function perkListingBook(items) {
  const rows = Array.isArray(items) ? items : [];
  return {
    rows,
    live: rows.filter((p) => matchesPerkChip(p, 'live')),
    expiring: rows.filter((p) => perkState(p) === 'expiring'),
    expired: rows.filter((p) => perkState(p) === 'expired'),
  };
}

/** The counts both pages print. */
export function perkListingCounts(items) {
  const book = perkListingBook(items);
  return {
    total: book.rows.length,
    live: book.live.length,
    expiring: book.expiring.length,
    expired: book.expired.length,
    in_review: book.rows.filter((p) => p.status === 'in_review').length,
  };
}
