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
 * A factory of `(role, api)` returns `{ sources, sections }`: `sources` maps a
 * key to a zero-argument fetch, `sections` is one entry per zone of the bucket, in zone
 * order. `bucket_board.test.mjs` enforces that ordering, and enforces that a
 * section declares either a `source` or a `gap` and never both.
 */
import partnerPipelineBoard from './partnerPipeline.js';
import partnerDeliveryBoard from './partnerDelivery.js';
import partnerOffersBoard from './partnerOffers.js';
import advisorPracticeBoard from './advisorPractice.js';
import advisorExpertiseBoard from './advisorExpertise.js';
import networkBoard from './network.js';
import researchBoard from './research.js';

const BOARDS = {
  'partner:/pipeline': partnerPipelineBoard,
  'partner:/delivery': partnerDeliveryBoard,
  'partner:/offers':   partnerOffersBoard,
  'advisor:/practice':  advisorPracticeBoard,
  'advisor:/expertise': advisorExpertiseBoard,
  // Both shared roots, both licences. One factory each: the role decides only
  // what the stores already decide — whether Organizations has one, and which
  // Research zones exist.
  'partner:/network':  networkBoard,
  'advisor:/network':  networkBoard,
  'partner:/research': researchBoard,
  'advisor:/research': researchBoard,
};

/**
 * The board for a bucket root, already resolved for this role, or null.
 *
 * `api` is passed in rather than imported by the registries, so a registry is a
 * pure module the guard can load in Node and assert over directly.
 */
export function boardFor(role, prefix, api) {
  const make = BOARDS[`${role}:${prefix}`];
  return make ? make(role, api) : null;
}

export default BOARDS;
