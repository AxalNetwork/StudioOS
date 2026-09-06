/**
 * Which bucket roots the canvas corpus actually composes.
 *
 * Keyed `role:prefix` so the two SHARED roots — `/network` and `/research`,
 * both rendered by one component for four licences — need no per-role fork in
 * the route modules. A root whose key is absent falls through to
 * `BucketOverview`'s card grid automatically, which is how founder and investor
 * keep theirs without a condition anywhere saying so.
 *
 * Each value is a FACTORY OF ROLE, because the two shared boards differ by
 * licence in ways their zone bodies already encode — `ORG_BACKED` decides
 * whether Organizations has a store, `RESEARCH_ZONES[role]` decides which zones
 * exist at all. The factory consults those same sets, so the board cannot
 * disagree with the zone.
 *
 * A factory returns `{ sources, sections }`: `sources` maps a key to a
 * zero-argument fetch, `sections` is one entry per zone of the bucket, in zone
 * order. `bucket_board.test.mjs` enforces that ordering, and enforces that a
 * section declares either a `source` or a `gap` and never both.
 */
const BOARDS = {};

/** The board for a bucket root, already resolved for this role, or null. */
export function boardFor(role, prefix) {
  const make = BOARDS[`${role}:${prefix}`];
  return make ? make(role) : null;
}

export default BOARDS;
