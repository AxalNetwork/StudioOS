import { makeZoneFilters } from './zoneFilterBuilder.js';

/**
 * The partner profile's filter tables — the left half of the zone header row.
 *
 * SEVEN PARTNER ZONES CARRY A `filters:` ARRAY ON A CANVAS. The four Research
 * ones are here and so is `network/relationships`; `network/introductions` is
 * listed in `profile_zone_filters.test.mjs`'s `excluded` set with a reason, and
 * `network/organizations` never will be (below). The table fills one surface at
 * a time.
 *
 * `/research/library` IS THE ONE ZONE WHERE THIS LICENCE GETS EVERYTHING THE
 * CANVAS DREW, out of the same component that gives founder one live chip out
 * of five. `research_documents.kind` is free text with no CHECK, so the column,
 * the write path and the client method all pass for every licence's labels —
 * and then the writer settles it: the upload form offers `Document`, `My
 * playbook` and `About a client`, the worker coerces anything else, and this
 * canvas asked for exactly that axis. Founder's `Reports` and `Legal` did not.
 *
 * WHERE THE LABELS WILL COME FROM. `design/incoming/Pages · Partner
 * {Network,Research}.dc.html`, verbatim and in the canvas's own order. Note
 * that the Research canvas names `/research/market` where the router and
 * `shellConfig.js` both say `markets`; the guard's `live()` hook does that
 * translation and already carries this exact mapping for the ops half.
 *
 * `network/organizations` will never be here. `NetworkPage` catches a slug it
 * has no tab for and suppresses every body, so that route already renders its
 * own heading above a card stating the gap — a filter row would be four
 * controls above a sentence explaining that there is nothing to filter.
 */
// TWO STRINGS THAT USED TO LIVE HERE ARE GONE, and their absence is the point.
// `ONE_ANSWER_ONLY` and `NO_ANSWER_RECORD` explained why all four of Ask's
// chips were prose: one answer on screen and no record of any past one.
// Migration 221 stored both, so the reasons stopped being true and went with
// the entries they justified. A reason kept past the gap it describes is worse
// than no reason at all — it reads as current.

// `ONE_SOURCE_ONLY` STOOD HERE AND IS GONE. It named one fact that cut both
// ways — every brief row was the founder's, so `Ours only` matched nothing and
// `Founder-sourced` matched everything — and migration 222 gave the firm rows
// of its own to separate out. `ClientPrepZone` is one file serving this licence
// and advisor, and both copies of the constant went together.

// `NO_OWNER_ON_A_RELATIONSHIP` AND `NO_INTERACTION_DATE` STOOD HERE AND ARE
// GONE, and the deletion is the whole of what changed on this zone. They said
// "no owner is stored on a relationship, so there is no assignment to bring
// forward and none to filter by" and "no interaction date is stored … the only
// history kept is that the row was created and edited". Both were true of
// `partner_relationships`, which this zone no longer reads: it is a
// partner-to-partner edge carrying a type and a hand-set `strength_score`.
//
// Migration 224 stores the firm's BOOK — `firm_owner_user_id`, nullable and
// unset on creation, and `partner_book_interactions.happened_at`, which is the
// date the touch happened rather than the date it was typed. Three of the four
// labels below narrow on those two columns, so all four now run. The reasons
// went with the gaps they described, because a reason kept past its gap reads
// as current.

// `NO_CONNECTED_STATE` STOOD HERE AND IS GONE, and it is worth recording that
// it was HALF wrong rather than simply out of date. It read: "accepting is
// recorded per side, so this page knows that you accepted and not whether they
// did; no connected state exists to mark an introduction as made". The first
// clause was a fact about the RESPONSE, not about the store — the counterpart's
// consent is the mirror row (`source = 'reciprocal'`, owned by
// `target_user_id`) and has been in `intro_propositions` since migration 150;
// only the DTO omitted it. Returning it made `Gated` mean the canvas's word
// again, so the `label:` override that renamed it `Awaiting you` went too.
//
// The second clause was right, and migration 225 is the answer to it: two
// consents mean an introduction MAY happen, and `intro_terms.made_at` is what
// says it did. Reading `accepted` as `Made` would have been the inference the
// old reason correctly refused.

// `/offers/catalog`. `service_offerings` holds one `price_usd` and nothing
// saying HOW it is charged, so a fixed fee, a monthly retainer and a per-seat
// licence are the same row to this store. The canvas's three pricing chips are
// one absent column between them, so they share one reason.
const NO_PRICING_MODEL =
  'a service stores one price and nothing saying whether it is charged once, monthly or per seat, so these three cannot be told apart';

// `/offers/perk-deals`. Two chips about time on a table that keeps none. The
// second half matters as much as the first: `perk_claims.expires_at` DOES
// exist, so a reader could reasonably assume the listing expires too — it is a
// deadline on one founder's issued code, not on the offer.
const NO_PERK_EXPIRY =
  'a perk listing carries no date at all; the only expiry in this store is on a claim already issued to one founder, which says nothing about the offer';

export const PARTNER_ZONE_FILTERS = {
  // ── Network ──────────────────────────────────────────────────────────────
  // FOUR OF FOUR, WHERE THIS ROW USED TO RUN ONE. `Unassigned first` and `By
  // owner` are the two sides of `firm_owner_user_id` being null or not — and
  // `Unassigned first` is the canvas's own default (`fil([…], 0)`), which is
  // the artboard saying the orphans are what this page opens on.
  //
  // `Going cold` IS SIXTY DAYS, AND THAT NUMBER IS THE ARTBOARD'S. `cold =
  // BOOK.filter(c => c.days !== null && c.days > 60)`, and its `cmpBody` says
  // "going cold past 60 days" in as many words. `MarketZone`'s ninety is a
  // different question about a different object — how stale a price reading may
  // be before a proposal may not carry it — and transcribing one onto the other
  // is how two numbers become one.
  //
  // A CONTACT WITH NO DATED INTERACTION IS NOT COLD. `days` is null there, and
  // the predicate requires a date, so an undated row is excluded rather than
  // swept in as maximally cold. It sorts to the bottom of the list — nobody
  // knows when it was last touched — but "we have no date" is not the same
  // claim as "it has been sixty days", and only one of them is in the store.
  'network/relationships': [
    { canvas: 'Unassigned first', key: 'unassigned' },
    { canvas: 'All', key: 'all' },
    { canvas: 'By owner', key: 'owned' },
    { canvas: 'Going cold', key: 'cold' },
  ],

  // FOUR OF FOUR, AND ALL FOUR NARROW ON A DERIVED STATE RATHER THAN ON
  // `status`. `stateOf` in `IntroductionsPanel` reads the caller's status and
  // the counterpart's together, which is what the artboard's pipeline is:
  // `Gated` is `Requested` or `One side` — a state a recorded consent could
  // still open — and `Made` is `intro_terms.made_at`, the introduction having
  // actually happened rather than merely being permitted.
  //
  // `Lapsed` HAS NO CHIP, DELIBERATELY. An expired proposition is not at a gate
  // (no consent can advance it) and is not declined (nobody refused), so it
  // belongs to none of the three narrow chips and is reachable through `All`.
  // Giving it a fifth chip would add a control the artboard does not draw;
  // folding it into `Gated` would count rows that cannot move as rows waiting
  // to.
  'network/introductions': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Gated', key: 'gated' },
    { canvas: 'Made', key: 'made' },
    { canvas: 'Declined', key: 'declined' },
  ],

  // ── Offers ───────────────────────────────────────────────────────────────
  // Ten of nineteen labels run. The canvas is the same in
  // `design/canvases/integrated/` and `design/incoming/`, checked rather than
  // assumed — both name these nineteen in this order.

  // ONE LIVE CHIP, AND IT IS THE HONEST NUMBER RATHER THAN A THIN ONE. The
  // catalogue's own axis is `is_active`, which the row toggle already writes,
  // but the canvas does not ask for it — it asks how the work is priced. So
  // `All` is what this row can offer, and the other three wait on a column.
  'offers/catalog': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Fixed', unbuilt: NO_PRICING_MODEL },
    { canvas: 'Retainer', unbuilt: NO_PRICING_MODEL },
    { canvas: 'Seat', unbuilt: NO_PRICING_MODEL },
  ],

  // `Live` IS THE STORE'S OWN WORD. `perks.status` is a CHECK over `draft`,
  // `in_review`, `live`, `paused` and `rejected`, so the canvas's chip and the
  // column agree exactly and no relabel is needed.
  'offers/perk-deals': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Live', key: 'live' },
    { canvas: 'Expiring', unbuilt: NO_PERK_EXPIRY },
    { canvas: 'Expired', unbuilt: NO_PERK_EXPIRY },
  ],

  // FOUR ORDERINGS, ONE OF WHICH IS THE ONE THE SERVER ALREADY RETURNS.
  // `GET /partner-offers/surfaces` ends `ORDER BY COUNT(es.id) DESC, s.name`,
  // and the zone's own blurb says so — "ranked by engagements rather than by
  // reach". So this chip names the ordering on screen rather than holding a
  // state, the way `network/relationships`'s lone `All` does.
  //
  // The other three are the two columns the zone's docblock refuses to draw
  // plus a word for something nothing records. Their reasons are separate
  // because the absences are: a ratio with no denominator, a count with no
  // pipeline, and a judgement with no input.
  'offers/visibility': [
    { canvas: 'By engagements', key: 'engagements' },
    {
      canvas: 'By leads',
      unbuilt: 'nothing records which surface a founder arrived through, so the lead half of the ratio has no source and the zone reports it absent rather than partial',
    },
    {
      canvas: 'By views',
      unbuilt: 'a view count needs an impression pipeline rather than a table, and the product records no impressions at all',
    },
    {
      canvas: 'Weak intent',
      unbuilt: 'nothing scores or records intent against a surface; what is stored per surface is engagements and the value they carried',
    },
  ],

  // THE ONE OFFERS ZONE WHERE EVERY LABEL RUNS, out of one array rather than
  // one column: each item carries `consents[]`, and the row already draws the
  // same three states per consenter — `Agreed`, `Withdrawn`, `Not answered`.
  //
  // THERE IS A FOURTH REAL STATE THE CANVAS HAS NO WORD FOR: an unpublished
  // item with NO consent row at all, where nobody has been asked. It falls
  // under `All` and only `All`. Sweeping it into `Awaiting consent` would be
  // the zone claiming a request was made, which is the same class of untruth
  // as a filter that returns an empty set and calls it an answer.
  'offers/proof': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Published', key: 'published' },
    { canvas: 'Awaiting consent', key: 'awaiting' },
    { canvas: 'Blocked', key: 'blocked' },
  ],

  // `Best fit` IS A STORED KIND, not a score. `audience_fit_rules.kind` is a
  // CHECK over `budget_floor`, `sector_declined`, `capability_absent` and
  // `best_fit`, so the chip selects the rules the firm wrote about who it is
  // for. `Qualified` and `Weak` are the other thing entirely — words about a
  // LEAD rather than about a rule — and the worker settles it in its own
  // response: `enforcement: 'none'`, nothing here scores anybody.
  'offers/audience-fit': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Best fit', key: 'best_fit' },
    {
      canvas: 'Qualified',
      unbuilt: 'no lead is scored against these rules — the worker answers `enforcement: \'none\'` — so nothing here is qualified or not',
    },
    {
      canvas: 'Weak',
      unbuilt: 'the same absent score from the other end; a rule records who the firm is for, and no row anywhere marks a lead as weak against one',
    },
  ],

  // ── Research ─────────────────────────────────────────────────────────────
  // ALL FOUR LIVE, AND MIGRATION 222 IS WHY. Three carried `ONE_SOURCE_ONLY`
  // and a fourth its own sentence, and all four were exact: every row this
  // brief produced was the founder's, so `Ours only` matched nothing and
  // `Founder-sourced` matched everything, and no row could be marked open
  // because none was the reader's to settle. `research_brief_notes` is the
  // second source — a row the firm writes against a client it holds a live
  // grant over — and `open` is a flag on those rows only.
  //
  // `Open items` IS `Ours only` NARROWED, NOT A THIRD AXIS, and that is the honest
  // shape rather than a shortcut: a founder-sourced row is the client's record,
  // quoted, and ticking it off would be editing someone else's fact.
  'research/client-prep': [
    { canvas: 'Full brief', key: 'all' },
    { canvas: 'Ours only', key: 'ours' },
    { canvas: 'Founder-sourced', key: 'client' },
    { canvas: 'Open items', key: 'open' },
  ],
  // Three live, one prose. The windows are this canvas's own — `const STALE_AT
  // = 90, AGE_AT = 30`, ninety where advisor's artboard says a hundred and
  // twenty, which is why the number lives in each licence's own table rather
  // than in the shared body. Age comes from each signal's evidence
  // `observed_at`, never from `updated_at`: the ingestion job stamps every row
  // it touches with one run timestamp, so that column cannot tell two signals
  // apart.
  'research/markets': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Current', key: 'current' },
    { canvas: 'Stale', key: 'stale' },
    {
      canvas: 'Attached to proposals',
      unbuilt: 'no row joins a signal to a proposal — the only foreign keys to a signal in the whole schema are its evidence and the companies it names',
    },
  ],
  // ALL FOUR LIVE, AND MIGRATION 221 IS WHY. Both of these entries used to
  // carry prose — `ONE_ANSWER_ONLY` for the two that narrow a thread and
  // `NO_ANSWER_RECORD` for the two that need a past. `POST /api/research/ask`
  // answered and returned without writing anything down, so there was one
  // answer on screen, no history behind it, and four chips that could only
  // have selected everything or nothing. `research_ask_sessions` and
  // `research_ask_answers` store every exchange including the ones that came
  // back with no source, which is exactly what `Unanswered` selects on.
  //
  // TWO SCOPES AND TWO PREDICATES, DELIBERATELY. `This session` and `All
  // history` are different READS — the page asks the worker for a different
  // slice — while `Cited` and `Unanswered` narrow whichever slice came back.
  // Splitting them the other way would make `Cited` mean "cited answers in
  // this session" on one chip and "in all history" on another, which is two
  // chips for one question.
  'research/ask': [
    { canvas: 'This session', key: 'session' },
    { canvas: 'All history', key: 'all' },
    { canvas: 'Cited', key: 'cited' },
    { canvas: 'Unanswered', key: 'unanswered' },
  ],
  // Four labels, four predicates, no prose — the only zone in this pass where
  // that happens. `Client docs` needs no relabel: `About a client` is what the
  // upload form calls the same value, so the canvas's word and the store's word
  // agree for once. Advisor's slot says `Session docs` and is relabelled,
  // because nothing attaches a document to a session.
  //
  // `Not indexed` tests `index_state`, not the passage count beside it: a
  // document that indexed once and later failed a re-index keeps its old count,
  // so filtering on the number would drop exactly the rows this chip is for.
  'research/library': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Client docs', key: 'client' },
    { canvas: 'Reusable', key: 'playbook' },
    { canvas: 'Not indexed', key: 'unindexed' },
  ],
};

export const partnerZoneFilters = makeZoneFilters(PARTNER_ZONE_FILTERS);
