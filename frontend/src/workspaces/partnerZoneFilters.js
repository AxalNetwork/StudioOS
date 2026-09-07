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
// Word for word what the advisor table says, because `AskZone` is one file
// serving both and the two canvases ask for the same four views. Two different
// failures, so two sentences: the first pair would select everything on screen,
// the second pair would select something that was never written down.
const ONE_ANSWER_ONLY =
  'one answer is on screen at a time and the citations under it are the whole of it, so neither of these narrows anything';
const NO_ANSWER_RECORD =
  'no answer is saved, so nothing records a past question or whether one went unanswered';

// `/research/client-prep`, and the same single fact the advisor table names:
// every row a brief produces carries `source: 'client'`, so `Ours only` matches
// nothing and `Founder-sourced` matches everything. The dead chip was live on
// this licence too — `ClientPrepZone` is one file, and its hand-rolled row was
// hardcoded to the ADVISOR accent, so a partner clicking it got a green chip
// and an empty brief.
const ONE_SOURCE_ONLY =
  'every row in a brief comes from the founder’s grant and nothing records a note of the firm’s own against a client, so there is no second source to separate out';

// `/network/relationships`. Two labels, one absent column, and the ops half of
// this very row already names it — "no owner field is stored on a relationship".
// These are the same sentence from the other side, so they share one string.
const NO_OWNER_ON_A_RELATIONSHIP =
  'no owner is stored on a relationship, so there is no assignment to bring forward and none to filter by';
const NO_INTERACTION_DATE =
  'no interaction date is stored on a relationship, so nothing can be called cold; the only history kept is that the row was created and edited';

// `/network/introductions`. `Gated` IS RELABELLED because the canvas's word
// means the double opt-in and this page can only see one side of it: the
// counterpart's consent is a separate `intro_propositions` row owned by
// `target_user_id`, which the response never returns. What `status = 'pending'`
// actually means is that YOU have not answered, so the chip says that.
//
// `Made` is the same asymmetry, and the zone's own docblock already argues it:
// `accepted` means you accepted and "cannot distinguish 'waiting on them' from
// 'you are already connected'". No `connected` value exists — the CHECK on
// `status` would reject one.
const NO_CONNECTED_STATE =
  'accepting is recorded per side, so this page knows that you accepted and not whether they did; no connected state exists to mark an introduction as made';

export const PARTNER_ZONE_FILTERS = {
  // ── Network ──────────────────────────────────────────────────────────────
  // One live chip out of four, the same as advisor's and for the same reason:
  // this licence reads `partner_relationships`, which carries a type and a
  // strength score and nothing else. Founder's row on this zone runs all four,
  // because founder relationships are `contacts`.
  'network/relationships': [
    { canvas: 'Unassigned first', unbuilt: NO_OWNER_ON_A_RELATIONSHIP },
    { canvas: 'All', key: 'all' },
    { canvas: 'By owner', unbuilt: NO_OWNER_ON_A_RELATIONSHIP },
    { canvas: 'Going cold', unbuilt: NO_INTERACTION_DATE },
  ],

  'network/introductions': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Gated', key: 'pending', label: 'Awaiting you' },
    { canvas: 'Made', unbuilt: NO_CONNECTED_STATE },
    { canvas: 'Declined', key: 'declined' },
  ],

  // ── Research ─────────────────────────────────────────────────────────────
  'research/client-prep': [
    { canvas: 'Full brief', key: 'all' },
    { canvas: 'Ours only', unbuilt: ONE_SOURCE_ONLY },
    { canvas: 'Founder-sourced', unbuilt: ONE_SOURCE_ONLY },
    {
      canvas: 'Open items',
      unbuilt: 'nothing records a brief row as open or closed; these rows are what the founder opened to you, not a checklist the firm works through',
    },
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
  'research/ask': [
    { canvas: 'This session', unbuilt: ONE_ANSWER_ONLY },
    { canvas: 'All history', unbuilt: NO_ANSWER_RECORD },
    { canvas: 'Cited', unbuilt: ONE_ANSWER_ONLY },
    { canvas: 'Unanswered', unbuilt: NO_ANSWER_RECORD },
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
