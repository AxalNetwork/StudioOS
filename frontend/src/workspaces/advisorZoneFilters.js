import { makeZoneFilters } from './zoneFilterBuilder.js';

/**
 * The advisor profile's filter tables — the left half of the zone header row.
 *
 * THE ADVISOR LICENCE SERVES EIGHT ZONES THAT CARRY A `filters:` ARRAY —
 * `/network/{relationships,introductions,organizations}` and
 * `/research/{ask,client-prep,markets,companies,library}`. All five Research
 * zones are here, and so are `network/relationships` and
 * `network/introductions`; `network/organizations` never will be (below). The
 * four Expertise zones with a body joined on D392. The table
 * fills one surface at a time, and the guard is what keeps that honest: an
 * exclusion cannot grow by accident and a stale one cannot linger.
 *
 * THIS LICENCE GETS THE MOST OUT OF `/research/library` AND THAT IS NOT A
 * COINCIDENCE. One component, one column, one write path serve four licences
 * there, and the answers are not close: every label on this canvas is live,
 * while founder's `Reports` and `Legal` and investor's `Diligence` name values
 * no upload can produce. `research_documents.kind` accepts exactly `document`,
 * `playbook` and `client`, and the advisor and partner artboards happen to ask
 * for the axis it actually holds. Which is the whole argument for four tables
 * rather than one shared table with a role switch.
 *
 * WHERE THE LABELS WILL COME FROM. `design/incoming/Pages · Advisor
 * {Network,Research}.dc.html`, verbatim and in the canvas's own order. Advisor
 * and partner canvases ship from `design/incoming/` rather than
 * `design/canvases/integrated/`, which is why the guard grew a `canvasDirs`
 * hook — `profile_zone_actions.test.mjs` has carried the same one since the
 * advisor Expertise bucket landed there.
 *
 * ONE ZONE WILL NEVER BE HERE, and the reason is not the same as "not yet".
 * `network/organizations` is a dashed card whose entire body is the gap
 * statement — an advisor is 403'd from `/api/contacts` and no other store
 * carries a person-to-organisation edge, so `ORG_BACKED` in
 * `NetworkWorkspace.jsx` is `['founder', 'investor']` and there is nothing for
 * a filter to narrow. A row over that page would be four controls above a
 * sentence saying the page has no rows.
 */
// `ONE_ANSWER_ONLY` and `NO_ANSWER_RECORD` stood here and are gone with the
// entries they explained: migration 221 gave Ask a session store, so "one
// answer is on screen at a time" and "no answer is saved" are both no longer
// true. The partner table, which is one file away and served by the same
// component, lost its word-for-word copy of them in the same change.
// `/research/companies`. `competitor_analyses` is keyed on `user_id` and names
// no company at all, which `ResearchWorkspace` already states on the page: an
// analysis belongs to the person who ran it, so there is no client dimension to
// switch between and nothing to mark as a relationship.
const NO_COMPANY_ON_AN_ANALYSIS =
  'an analysis is stored against the person who ran it and names no company, so nothing marks one as a relationship or as somebody you are pursuing';

// `ONE_SOURCE_ONLY` STOOD HERE AND IS GONE WITH THE ENTRIES IT EXPLAINED. It
// read "every row in a brief comes from the founder's grant and nothing records
// a note of your own against a client, so there is no second source to separate
// out" — exact, and the reason `Mine only` matched nothing while
// `Founder-sourced` matched everything. Migration 222's `research_brief_notes`
// is that second source, so the sentence stopped being true and went with the
// prose it justified. The partner table lost its own copy in the same change.

// `/network/relationships`. The zone's own `StatedLimit` already states the
// first of these in the page's voice — "No last touch, and therefore no 'going
// cold' … there is no interaction date, no interaction count, and the only
// history it keeps is that the row was created and edited" — so the note says
// it once more only because a reader hunting for the canvas's word needs to
// find it on the row.
const NO_INTERACTION_DATE =
  'no interaction date is stored on a relationship, so there is nothing to sort by age; the only history kept is that the row was created and edited';
// The already-scoped kind of reason. `Mine` is not a gap: `partnernet.ts:233`
// loads only rows the reader is one side of, so the chip would select the whole
// list while implying a remainder that is not yours exists somewhere.
const EVERY_ROW_IS_YOURS =
  'every relationship here is already one of yours; the list loads only rows you are a party to, so this would select all of them';
// D6285: `/research/markets` mounts the market directory, which draws no chip
// row; only the deleted, never-mounted `MarketZone` body read these keys.
const MARKETS_DIRECTORY_HAS_NO_CHIPS =
  'the market directory mounted at this route draws no chip row, so nothing narrows its readings by age; only the unmounted MarketZone body did';
const MARKETS_DIRECTORY_HOVER = 'The market directory has no age filter yet.';

// `/network/introductions`. FOUR LIVE CHIPS, the partner panel's four (D392).
// `Gated` was relabelled `Awaiting you` and `Made` was prose, both on the
// premise that the response carried only this side's consent. It carries both
// (`counterpart_status`), so `Gated` is the canvas's double opt-in again —
// Requested or One side — and `Made` is `intro_terms.made_at`, which the zone
// lets an advisor record once both sides have agreed. `Lapsed` has no chip and
// is reachable through `All`, for the reason the partner row gives.

export const ADVISOR_ZONE_FILTERS = {
  // ── Network ──────────────────────────────────────────────────────────────
  // ONE LIVE CHIP OUT OF FOUR, and the three that fail do so for three
  // different reasons — an absent column, a question already answered, and a
  // provenance mark nothing writes. Grouping them into one sentence would tell
  // a reader that the same thing is missing three times, which is not true.
  'network/relationships': [
    { canvas: 'Coldest first', unbuilt: NO_INTERACTION_DATE },
    { canvas: 'All', key: 'all' },
    { canvas: 'Mine', unbuilt: EVERY_ROW_IS_YOURS },
    {
      canvas: 'From the Lab',
      unbuilt: 'nothing marks a relationship as sourced from the Lab; a referral records a name and an organisation as free text, with no link back to an account', hover: 'Nothing marks a relationship as sourced from the Lab; a referral records free text only.',
    },
  ],

  'network/introductions': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Gated', key: 'gated' },
    { canvas: 'Made', key: 'made' },
    { canvas: 'Declined', key: 'declined' },
  ],

  // ── Research ─────────────────────────────────────────────────────────────
  // Nothing is written per question. `research.post('/ask')` searches, answers
  // and returns; the only per-question row anywhere is `ai_usage_logs`, which
  // holds token counts and no question text. The page therefore keeps exactly
  // one result in state and clears it on every submit — so `This session` and
  // `Cited` would select everything on screen, and `All history` and
  // `Unanswered` would select nothing that exists. Two different failures, and
  // the ops half of this row already states the second one in these words.
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
  // The ops half of this row already argues the grant story — "a brief exists
  // when a founder opens their record to you; nothing here asks for one". These
  // name a different absence: no row of your own, and no open/answered state on
  // any row. The canvas's own `Open questions` count comes from a hand-written
  // `state: 'Not done'` in the artboard's mock.
  // ALL FOUR LIVE, AND MIGRATION 222 IS WHY. Three carried `ONE_SOURCE_ONLY`
  // and a fourth its own sentence, and all four were exact: every row this
  // brief produced was the founder's, so `Mine only` matched nothing and
  // `Founder-sourced` matched everything, and no row could be marked open
  // because none was the reader's to settle. `research_brief_notes` is the
  // second source — a row the firm writes against a client it holds a live
  // grant over — and `open` is a flag on those rows only.
  //
  // `Open questions` IS `Mine only` NARROWED, NOT A THIRD AXIS, and that is the honest
  // shape rather than a shortcut: a founder-sourced row is the client's record,
  // quoted, and ticking it off would be editing someone else's fact.
  'research/client-prep': [
    { canvas: 'Full brief', key: 'all' },
    { canvas: 'Mine only', key: 'ours' },
    { canvas: 'Founder-sourced', key: 'client' },
    { canvas: 'Open questions', key: 'open' },
  ],
  // THE ONE PLACE THE SIGNALS FEED ANSWERS THE CANVAS'S QUESTION. Founder and
  // investor ask this zone for a saved deep-dive with a lifecycle, and nothing
  // saves one — their rows are prose. This canvas asks something the page can
  // answer about its own rows: how old is what I am looking at. Every signal
  // carries its evidence with `observed_at`, and the artboard supplies the
  // windows itself — `const STALE_AT = 120, AGE_AT = 30`. A day window is part
  // of a filter's definition, not a claim about this account's records, which
  // is the same ground `Last 6 mo` stands on in the founder table.
  //
  // NOT `updated_at`, WHICH LOOKS RIGHT AND IS NOT. The ingestion job computes
  // one timestamp per run and binds it to every row it touches, so an age
  // predicate over it would put the whole feed in one bucket — a filter that
  // always returns everything or nothing, which is D51 in a new costume.
  //
  // D6285 — NOT LIVE, AND THEY HAD NOT BEEN SINCE D593. The four keys were
  // implemented only by `MarketZone`, a body nothing mounted once the market
  // directory replaced it; `ResearchWorkspace` hands `MarketDirectoryZone` no
  // `zoneFilters`, so no chip was drawn. The test that called them live read
  // the unmounted file. Prose until the directory narrows its readings by age.
  'research/markets': [
    { canvas: 'All', unbuilt: MARKETS_DIRECTORY_HAS_NO_CHIPS, hover: MARKETS_DIRECTORY_HOVER },
    { canvas: 'Current', unbuilt: MARKETS_DIRECTORY_HAS_NO_CHIPS, hover: MARKETS_DIRECTORY_HOVER },
    { canvas: 'Ageing', unbuilt: MARKETS_DIRECTORY_HAS_NO_CHIPS, hover: MARKETS_DIRECTORY_HOVER },
    { canvas: 'Stale', unbuilt: MARKETS_DIRECTORY_HAS_NO_CHIPS, hover: MARKETS_DIRECTORY_HOVER },
  ],
  // The same level mismatch founder's row has, from the other end: this canvas
  // wants a company's standing with you, and the page lists analyses that name
  // no company. `Researching` is the near-miss worth naming separately — an
  // analysis DOES carry a status, and it is the status of the run.
  'research/companies': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Relationships', unbuilt: NO_COMPANY_ON_AN_ANALYSIS },
    { canvas: 'Prospects', unbuilt: NO_COMPANY_ON_AN_ANALYSIS },
    {
      canvas: 'Researching',
      unbuilt: 'the only state an analysis carries is the state of its own run (draft, running, complete or error), which says nothing about your standing with a company', hover: 'An analysis records the state of its own run, which says nothing about your standing.',
    },
  ],
  // ALL FOUR RUN. `kind` carries the artboard's own axis, and `index_state`
  // carries the column this zone exists to show.
  //
  // `Session docs` IS RELABELLED, and the reason is the rule this table keeps
  // running into: a label must not imply a link that does not exist. Nothing
  // attaches a document to a session — `advisor_client_document_shares` has a
  // reader and no writer — so the chip wears the store's own word for the same
  // set. The predicate is exact either way; only the promise changes.
  //
  // `Not indexed` READS `index_state`, NOT `chunk_count`. The passage column
  // beside it correctly tests `chunk_count == null`, but a document that
  // indexed once and later failed a re-index keeps its old count: the failure
  // path updates the state and leaves the number alone. Filtering on the number
  // would silently drop exactly the documents this chip is for.
  // ── Expertise (D392) ─────────────────────────────────────────────────────
  // Four of the five artboards, sixteen chips, twelve live. Every live chip
  // reads a column the zone already loads; the four that are not name what is
  // missing. `expertise/visibility` has no row: its page is the gap card
  // ("Nothing counts profile views"), and four controls above a sentence
  // explaining why there is nothing to count would be a filter over nothing.
  //
  // `Match-critical` IS NOT A JUDGEMENT. It is the fields the completeness
  // meter already counts as "what every match surface reads" — the page's
  // `MATCH_FIELDS`, which both the meter and the chip read, so they cannot
  // disagree. `Gaps
  // only` is those and the rest, empty in the SAVED record, so typing into a
  // field does not make it vanish mid-edit.
  'expertise/profile': [
    { canvas: 'All fields', key: 'all' },
    { canvas: 'Gaps only', key: 'gaps' },
    { canvas: 'Match-critical', key: 'match' },
    { canvas: 'Public preview', unbuilt: 'no public advisor profile page exists; the preview beside the form is what a founder is shown today', hover: 'No public advisor profile page exists to preview.' },
  ],
  // `kind` is a CHECKed column since migration 203, and the form writes it.
  'expertise/services': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Fixed', key: 'fixed' },
    { canvas: 'Package', key: 'package' },
    { canvas: 'Retainer', key: 'retainer' },
  ],
  // The three states the stats strip above the list already counts:
  // `attested` is the worker's (a named person answered through their own
  // link), awaiting is an open request with no answer, self-stated is the rest.
  'expertise/proof': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Attested', key: 'attested' },
    { canvas: 'Awaiting consent', key: 'awaiting' },
    { canvas: 'Self-stated', key: 'self' },
  ],
  // D4826 (#4826): `articles.status` is SEVEN values, not two — draft,
  // submitted, in_review, changes_requested, rejected, approved, published —
  // and an approved piece with a `publish_at` is Scheduled (D484). The note
  // here used to say "draft or published", which was wrong when D4681 gave the
  // shelf a pill per state. These two chips are the canvas's own axis (AX4's
  // `filters: fil(['All','Published','Drafts','Essays'], 0)`), so Drafts stays
  // the coarse "not public yet" narrowing the canvas asks for; the row's pill,
  // its audience line and the export all name the real state
  // (`expertiseModel.articleStage`). Nothing classifies a piece as an essay
  // rather than a note or a post — there is no kind column on articles.
  'expertise/thinking': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Published', key: 'published' },
    { canvas: 'Drafts', key: 'draft' },
    { canvas: 'Essays', unbuilt: 'an article records no kind, so nothing tells an essay from any other piece', hover: 'Articles carry no kind, so an essay cannot be told apart.' },
  ],

  // ── Practice ─────────────────────────────────────────────────────────────
  //
  // ALL FIVE RUN, AND TWO OF THEM ARE DERIVED RATHER THAN STORED. `status` on
  // `advisor_bookings` is pending|confirmed|completed|cancelled|no_show, so
  // Accepted and Declined read a column — but `Expired` does not exist as a
  // status anywhere. A request still `pending` after its SLOT HAS STARTED is
  // one the advisor never answered, and that is the artboard's sharpest point:
  // "a decline preserves the referral, silence spends it". Two stored facts,
  // one honest state.
  //
  // `Declined` EXCLUDES TWO CANCELLATIONS THE WORKER WRITES ITSELF —
  // 'slot_cancelled' and 'capacity_race' (`routes/advisors.ts`). Neither is an
  // answer to a request, and counting them would make the accept rate beside
  // the chips wrong.
  'practice/opportunities': [
    { canvas: 'Awaiting decision', key: 'awaiting' },
    { canvas: 'Accepted', key: 'accepted' },
    { canvas: 'Declined', key: 'declined' },
    { canvas: 'Expired', key: 'expired' },
    { canvas: 'All time', key: 'all' },
  ],

  // #4831 (D4831): THE PRACTICE V2 CANVAS'S ROW (PX-03), which replaced PR2's
  // `All · Signed · Renewal due · Ended · By client`. Each chip narrows the
  // board and carries its count over the whole record (`chipRows` and
  // `chipCounts` in `engagementBoard.js`); `Active` is signed or renewal due,
  // the same set the Active tile counts. `By client` left with the PR2 row: it
  // was a sort, and the v2 board draws none.
  'practice/engagements': [
    { canvas: 'Active', key: 'active', label: 'Active {n}' },
    { canvas: 'Renewal due', key: 'renewal_due', label: 'Renewal due {n}' },
    { canvas: 'Proposed', key: 'proposed', label: 'Proposed {n}' },
    { canvas: 'Ended', key: 'ended', label: 'Ended {n}' },
    { canvas: 'All', key: 'all', label: 'All {n}' },
  ],

  // #4833 (D4833): THE PRACTICE V2 CANVAS'S ROW (`Practice v2 Page.dc.html`,
  // PX-06), which replaced PR3's `All · Unopened · Opened · Draft · By client`.
  // Each chip narrows on the LATEST version's own stamps (`cardStatus` in
  // `deliveryTrail.js`): Draft is a latest version with no `sent_at`, Sent has
  // no receipt yet, Opened has `opened_at`, Accepted has `signed_off_at`. The
  // receipts are written by the client's routes, never an advisor's (D72,
  // D4684).
  //
  // THE CANVAS ALSO DRAWS `Ready`, AND IT IS LEFT OUT, not drawn disabled: the
  // canvas itself marks it "isn't recorded today" and D4874 lists it as backend
  // required. `profile_zone_filters.test.mjs` drops it from the canvas row by
  // name, citing D4874, the way founder's `Cited in deck` is dropped (D549).
  //
  // `By client` left the chip row with the PR3 artboard. Grouping by client is
  // still `?view=by_client` (D571's `/practice/deliverables`), a toggle beside
  // the cards rather than a chip, because it reorders rather than narrows.
  'practice/delivery': [
    { canvas: 'Draft', key: 'draft', label: 'Draft {n}' },
    { canvas: 'Sent', key: 'sent', label: 'Sent {n}' },
    { canvas: 'Opened', key: 'opened', label: 'Opened {n}' },
    { canvas: 'Accepted', key: 'accepted', label: 'Accepted {n}' },
    { canvas: 'All', key: 'all', label: 'All {n}' },
  ],

  // TWO OF THESE CHANGE THE WINDOW AND TWO NARROW IT, which is unusual enough
  // to say out loud. `Two weeks` and `Month` ask the server for a different
  // span — the grid is what came back, and filtering a fortnight down to "a
  // month" would show FEWER slots under the wider name. `Past sessions` and
  // `Unpaid held` narrow what is already loaded.
  //
  // `Unpaid held` earns its place rather than duplicating a tile: the tile
  // counts them, this shows them. Otherwise every held slot is one amber card
  // somewhere in a fortnight, and the artboard's own gate note is about
  // exactly the case where a reader needs to find them all at once.
  'practice/sessions': [
    { canvas: 'Two weeks', key: 'two_weeks' },
    { canvas: 'Month', key: 'month' },
    { canvas: 'Past sessions', key: 'past' },
    { canvas: 'Unpaid held', key: 'unpaid_held' },
  ],

  // #4834 (D4834): THE PRACTICE V2 CANVAS'S PERIOD SELECTOR (`Practice v2
  // Page.dc.html`, PX-07), which replaced D4's `Q3 2026 · Q2 2026 · Year to
  // date · All time`. Five static chips: each asks the Worker for a different
  // window, so a label is the period's kind and the page shows the period's own
  // name beside the row ("November 2026", "Q4 2026"). `Quarter` is the current
  // calendar quarter and `Year` the current calendar year. `Custom` opens two
  // day fields; a custom range has no note key, so it carries no note.
  'practice/earnings': [
    { canvas: 'This month', key: 'this_month' },
    { canvas: 'Last month', key: 'last_month' },
    { canvas: 'Quarter', key: 'quarter' },
    { canvas: 'Year', key: 'year' },
    { canvas: 'Custom', key: 'custom' },
  ],

  'research/library': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Session docs', key: 'client', label: 'About a client' },
    { canvas: 'Reusable', key: 'playbook' },
    { canvas: 'Not indexed', key: 'unindexed' },
  ],
};

export const advisorZoneFilters = makeZoneFilters(ADVISOR_ZONE_FILTERS);
