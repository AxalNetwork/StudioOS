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
// Both Ask filters fail for reasons that are not the same reason, so they are
// named separately and `groupFilterNotes` renders two sentences rather than one
// that would cover a label it does not explain.
const ONE_ANSWER_ONLY =
  'one answer is on screen at a time and the citations under it are the whole of it, so neither of these narrows anything';
const NO_ANSWER_RECORD =
  'no answer is saved, so nothing records a past question or whether one went unanswered';
// `/research/companies`. `competitor_analyses` is keyed on `user_id` and names
// no company at all, which `ResearchWorkspace` already states on the page: an
// analysis belongs to the person who ran it, so there is no client dimension to
// switch between and nothing to mark as a relationship.
const NO_COMPANY_ON_AN_ANALYSIS =
  'an analysis is stored against the person who ran it and names no company, so nothing marks one as a relationship or as somebody you are pursuing';

// `/research/client-prep`. TWO LABELS, ONE FACT, AND THE FACT CUTS BOTH WAYS:
// every row a brief produces carries `source: 'client'` and nothing else can,
// so `Mine only` matches nothing and `Founder-sourced` matches everything.
// Neither narrows, and the page shipped the first of them as a live chip until
// this commit — clicking it said "nothing matches this filter" over a full
// brief, which is exactly the failure D51 was written about.
const ONE_SOURCE_ONLY =
  'every row in a brief comes from the founder’s grant and nothing records a note of your own against a client, so there is no second source to separate out';

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

export const ADVISOR_ZONE_FILTERS = {
  // ── Network ──────────────────────────────────────────────────────────────
  // ONE LIVE CHIP OUT OF FOUR, and the three that fail do so for three
  // different reasons — an absent column, a question already answered, and a
  // provenance mark nothing writes. Grouping them into one sentence would tell
  // a reader that the same thing is missing three times, which is not true.
  'network/relationships': [
    { canvas: 'Coldest first', note: NO_INTERACTION_DATE },
    { canvas: 'All', key: 'all' },
    { canvas: 'Mine', note: EVERY_ROW_IS_YOURS },
    {
      canvas: 'From the Lab',
      note: 'nothing marks a relationship as sourced from the Lab; a referral records a name and an organisation as free text, with no link back to an account',
    },
  ],

  // ── Research ─────────────────────────────────────────────────────────────
  // Nothing is written per question. `research.post('/ask')` searches, answers
  // and returns; the only per-question row anywhere is `ai_usage_logs`, which
  // holds token counts and no question text. The page therefore keeps exactly
  // one result in state and clears it on every submit — so `This session` and
  // `Cited` would select everything on screen, and `All history` and
  // `Unanswered` would select nothing that exists. Two different failures, and
  // the ops half of this row already states the second one in these words.
  'research/ask': [
    { canvas: 'This session', note: ONE_ANSWER_ONLY },
    { canvas: 'All history', note: NO_ANSWER_RECORD },
    { canvas: 'Cited', note: ONE_ANSWER_ONLY },
    { canvas: 'Unanswered', note: NO_ANSWER_RECORD },
  ],
  // The ops half of this row already argues the grant story — "a brief exists
  // when a founder opens their record to you; nothing here asks for one". These
  // name a different absence: no row of your own, and no open/answered state on
  // any row. The canvas's own `Open questions` count comes from a hand-written
  // `state: 'Not done'` in the artboard's mock.
  'research/client-prep': [
    { canvas: 'Full brief', key: 'all' },
    { canvas: 'Mine only', note: ONE_SOURCE_ONLY },
    { canvas: 'Founder-sourced', note: ONE_SOURCE_ONLY },
    {
      canvas: 'Open questions',
      note: 'nothing records a brief row as open or answered; these rows are what the founder opened to you, not a checklist you work through',
    },
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
    { canvas: 'Relationships', note: NO_COMPANY_ON_AN_ANALYSIS },
    { canvas: 'Prospects', note: NO_COMPANY_ON_AN_ANALYSIS },
    {
      canvas: 'Researching',
      note: 'the only state an analysis carries is the state of its own run (draft, running, complete or error), which says nothing about your standing with a company',
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
  'research/library': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Session docs', key: 'client', label: 'About a client' },
    { canvas: 'Reusable', key: 'playbook' },
    { canvas: 'Not indexed', key: 'unindexed' },
  ],
};

export const advisorZoneFilters = makeZoneFilters(ADVISOR_ZONE_FILTERS);
