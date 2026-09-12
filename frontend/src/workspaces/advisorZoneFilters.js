import { makeZoneFilters } from './zoneFilterBuilder.js';

/**
 * The advisor profile's filter tables — the left half of the zone header row.
 *
 * THE ADVISOR LICENCE SERVES EIGHT ZONES THAT CARRY A `filters:` ARRAY —
 * `/network/{relationships,introductions,organizations}` and
 * `/research/{ask,client-prep,markets,companies,library}`. All five Research
 * zones are here and so is `network/relationships`; `network/introductions` is
 * listed in `profile_zone_filters.test.mjs`'s `excluded` set with the reason it
 * is not yet, and `network/organizations` never will be (below). The table
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
      unbuilt: 'nothing marks a relationship as sourced from the Lab; a referral records a name and an organisation as free text, with no link back to an account',
    },
  ],

  'network/introductions': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Gated', key: 'pending', label: 'Awaiting you' },
    { canvas: 'Made', unbuilt: NO_CONNECTED_STATE },
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
  'research/markets': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Current', key: 'current' },
    { canvas: 'Ageing', key: 'ageing' },
    { canvas: 'Stale', key: 'stale' },
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
      unbuilt: 'the only state an analysis carries is the state of its own run (draft, running, complete or error), which says nothing about your standing with a company',
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

  // ALL FIVE RUN, AND ONE OF THEM REORDERS RATHER THAN NARROWS. Migration 238
  // stores `lane` with five values, so Signed, Renewal due and Ended each read
  // a column directly — `Signed` covers both signed lanes, because
  // `renewal_due` is a state inside Signed on the canvas's own board and a chip
  // that excluded it would hide the contracts most in need of attention.
  //
  // `By client` IS A SORT, and saying so matters. Every other chip in these four
  // tables narrows a set; this one orders the board, the renewal history and the
  // scope cards by client name and drops nothing. A chip called "By client" that
  // filtered rows out would be lying about what it did — and this file's own
  // docblock is about exactly that failure mode, a chip whose empty result reads
  // as an answer.
  'practice/engagements': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Signed', key: 'signed' },
    { canvas: 'Renewal due', key: 'renewal_due' },
    { canvas: 'Ended', key: 'ended' },
    { canvas: 'By client', key: 'by_client' },
  ],

  // ALL FIVE RUN, AND ONE OF THEM ONLY RUNS BECAUSE THE STORE RESOLVED THE
  // CANVAS'S OWN INCONSISTENCY. `Draft` is drawn as a chip and defined as a
  // pill, but no row in the artboard's fixture carries that state — its draft
  // row is `state:'Not started'` with `version:'v2 draft'`, two names for one
  // thing. Clicking the chip as drawn would have returned nothing, which is the
  // exact failure this file's docblock is about: an empty set reading as an
  // answer. Migration 239 makes it a real state — a work product whose latest
  // version has never been sent — so `Draft` is `not_started` and the chip
  // narrows honestly.
  //
  // `Unopened` and `Opened` read the derived state, which comes from whether
  // `opened_at` exists — and that column is written by the FOUNDER side, never
  // by an advisor route (D72). These two chips are the only place in four
  // profiles where a filter reads a fact the signed-in user cannot author.
  //
  // `By client` reorders rather than narrows, as on Engagements.
  'practice/delivery': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Unopened', key: 'unopened' },
    { canvas: 'Opened', key: 'opened' },
    { canvas: 'Draft', key: 'draft' },
    { canvas: 'By client', key: 'by_client' },
  ],

  'research/library': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Session docs', key: 'client', label: 'About a client' },
    { canvas: 'Reusable', key: 'playbook' },
    { canvas: 'Not indexed', key: 'unindexed' },
  ],
};

export const advisorZoneFilters = makeZoneFilters(ADVISOR_ZONE_FILTERS);
