import { makeZoneFilters } from './zoneFilterBuilder.js';

/**
 * The founder profile's twenty-six zone pages, and what each of their canvas
 * filters can honestly do. That is ALL OF THEM: every route on all five
 * artboards has an entry, and `profile_zone_filters.test.mjs`'s `excluded` list
 * for this licence is now empty. The count is pinned in the guard, so a canvas
 * that gains a zone fails here rather than shrinking the covered set quietly.
 *
 * WHERE THE LABELS COME FROM. Verbatim from the `filters: fil([…])` array of
 * the zone's artboard in `design/canvases/integrated/Pages · Founder
 * {Build,Raise,Grow,Network,Research}.dc.html`, in the canvas's own order.
 * Network and Research are shared surfaces — one component serves all four
 * licences — which is why their entries sit in four per-licence tables rather
 * than one common one, and why a zone's four tables land together. `founderZoneActions`
 * is the same table for the `ops:` array on the same row; between them the
 * header row this product ships is the header row the design drew.
 *
 * WHY EACH ENTRY NEEDED A LOOK AT THE STORE, NOT A GUESS. The rule in
 * `zoneFilterBuilder.js` — a filter that cannot run is prose, never a chip —
 * only helps if the live/prose split is true. Every `key` below was checked
 * against the predicate the page can actually write over the records its own
 * `api.*` calls return, and every `note` says what is missing rather than that
 * something is missing. Three of these were shipped the other way round and
 * this table is where they get corrected:
 *
 *   `/grow/customers` drew a live "Stalled" chip whose predicate was
 *   `return []`. Clicking it answered "you have no stalled accounts" when no
 *   store records activity at all.
 *
 *   `/raise/status` drew "Overview / Blockers / Investors" and simply left
 *   "Timeline" out, so a reader looking for the canvas's fourth view found
 *   nothing — not even the reason.
 *
 *   `/build/this-week` drew "Last 4 weeks" and "Carried only" as `disabled`
 *   buttons, which `ZoneActions.jsx` already refuses to do for actions: a
 *   greyed control is still a promise, just one that has given up.
 *
 * SAMPLE FIGURES IN A CANVAS LABEL ARE NOT COPIED. `All 14`, `All 14 mo` and
 * `Aug 2026` are that artboard's mock data. Printing them would state a count
 * this founder's account has not got, so a live entry writes `{n}` and the page
 * supplies the real figure; when it has none the clause is dropped and the chip
 * reads `All`. `Backend`, `GTM`, `Distributed SaaS`, `Agencies` and
 * `Enterprise` are sample names for one-chip-per-record groups, so they are
 * `dynamic` and the page supplies the stored names instead.
 *
 * `frontend/test/profile_zone_filters.test.mjs` re-derives every `canvas`
 * string from the canvases themselves, so this table cannot silently drop one.
 */

// Reasons that cover several filters in the same zone are named once, so the
// grouped rendering in ZoneToolbar collapses them into a single sentence and a
// reworded copy cannot drift from its twin.
const NO_WEEK_STAMP =
  'a key result carries no week, so there is no earlier week to open';
const NO_CADENCE_STORE =
  'no ritual schedule or review archive is stored for this startup';
const NO_LIQUIDITY_LEDGER =
  'no restriction, tender or liquidity-event ledger is connected';
// Research · Ask has no store at all behind it, and the ops half of its own row
// already says so — `Clear history — no session history is stored to clear`.
// This reuses that clause rather than inventing a fourth phrasing of one
// absence: `LibraryZone`'s stat strip is already the third
// ("no question history is stored, here or in Ask").
const NO_SESSION_RECORD =
  'no session history is stored, so no past question, kept answer or discarded one exists to look through';
// `/research/library`. The classification column is real and free text; what is
// missing is a WRITER that could produce these values. `research.ts:64` accepts
// exactly `playbook | client | document` and coerces anything else, and the
// upload form offers exactly those three. Column, write path and client method
// all pass; only the vocabulary check catches it.
const NO_SUCH_KIND =
  'a document is filed as a document, a playbook or about a client, and no upload can classify one any other way';
// `/research/markets`. All four labels are views of a SAVED DEEP-DIVE, which
// the artboard makes plain: its instrument table is `Analysis · Method · Run ·
// State`, and `Sources` in the stat strip counts the indexed documents one
// analysis rests on. The live page is the signals feed — real, useful and a
// different object. The ops half of this row already says where signals come
// from, and this is that sentence from the other side.
const NO_SAVED_DEEP_DIVE =
  'nothing saves a market deep-dive, so there is no analysis to keep, retire, build or list the sources of; this page is the signals feed, gathered on a schedule';
// `/network/introductions`. THE SHARPEST CASE THIS PASS HAS FOUND, and it was
// already on screen: the page filtered on `row.direction`, which
// `propositionDto` has never returned and `intro_propositions` has no column
// for. Every row is `WHERE user_id = ?` — the reader is always the addressee —
// so direction is not merely unreturned, it is not a fact this model holds.
const NO_DIRECTION_RECORDED =
  'nothing records who asked: every proposition here is addressed to you, and the response names the counterpart without a direction';
// `/network/organizations`. THE COLUMN THREE DOCBLOCKS SAID EXISTS DOES NOT.
// `FounderNetworkOrganizations` groups on `row.organization || row.company ||
// row.firm`, and `contacts` carries none of the three: the table is sixteen
// columns (`127_contacts.sql:8-23`), the only three `ALTER TABLE contacts` in
// the repo add `promoted_ref_id`, `utm_json` and `referrer`, and the route
// returns `SELECT c.*` plus two landing-page aliases. So `if (!name) return;`
// skips every row and the group list is permanently empty — which is why `All`
// is prose here and not a chip: it would select an empty set on every account.
const NO_ORG_ON_A_CONTACT =
  'no field on a contact names the organisation that person is in, so this roll-up has nothing to roll up; the audience each of them is filed under is real and narrows the relationship book one zone over, but it classifies people, not companies';
// The sharpest of the four, because the predicate is not the missing part.
// `last_activity_at` is stored, `isDormant` is written and runs, and the page
// already reports a dormant count in its rail. What is missing is the thing it
// would describe.
const NO_GROUP_TO_AGE =
  'sixty days of silence is recorded per person and this page already computes it, but dormancy on this row would describe an organisation, and there is no organisation for it to describe';
// `/research/companies`. Not an absent store — a LEVEL mismatch, which is a
// fourth kind of reason this table has needed. See the zone's entry below.
const CATEGORY_IS_PER_COMPETITOR =
  'each competitor inside an analysis is filed as direct or adjacent, but this row narrows the saved analyses, and an analysis carries no relation of its own';

export const FOUNDER_ZONE_FILTERS = {
  // ── Build ────────────────────────────────────────────────────────────────
  // Reads the Now column of the stored roadmap. Nothing stamps a key result
  // with a week, and nothing records one moving between weeks, which is why the
  // page's own footnote already refuses to report a completion rate.
  'build/this-week': [
    { canvas: 'This week', key: 'now', label: 'This week' },
    { canvas: 'Last 4', unbuilt: NO_WEEK_STAMP },
    { canvas: 'All 14', label: 'All weeks', unbuilt: NO_WEEK_STAMP },
    { canvas: 'Carried only', unbuilt: 'nothing records a commitment moving from one week to the next' },
  ],
  // Cards are pipeline tasks with a stored `status` and `updated_at`. They
  // carry no lane and no assignee this page can compare against the reader, so
  // the canvas's two sample lanes and its "Mine" are stated, not drawn.
  'build/board': [
    { canvas: 'All lanes', key: 'all', label: 'All cards' },
    { canvas: ['Engineering', 'GTM'], label: 'Engineering and GTM', unbuilt: 'a card carries a stage, not a lane, and no lane is stored' },
    { canvas: 'Mine', unbuilt: 'a card records an owner name, which is not the same as the account reading it' },
    { canvas: 'Stale > 7d', key: 'stale' },
  ],
  // Objectives carry a quarter, a kanban column and a dependency field. No
  // scenario is stored anywhere in the roadmap source.
  'build/roadmap': [
    { canvas: 'Timeline', key: 'timeline' },
    { canvas: 'Board', key: 'board' },
    { canvas: 'Dependencies', key: 'dependencies' },
    { canvas: 'Scenarios', unbuilt: 'no roadmap scenario is stored' },
  ],
  // Nothing at all backs this zone: the page loads the project list and no
  // second source. All four filters share the one reason.
  'build/cadence': [
    { canvas: 'All rituals', unbuilt: NO_CADENCE_STORE },
    { canvas: 'Plans', unbuilt: NO_CADENCE_STORE },
    { canvas: 'Retros', unbuilt: NO_CADENCE_STORE },
    { canvas: 'Skipped', unbuilt: NO_CADENCE_STORE },
  ],
  // Metric snapshots are dated and their fields are individually nullable, so
  // every one of these four is a predicate over stored values.
  'build/kpi': [
    { canvas: 'Aug 2026', key: 'latest', label: 'Latest month' },
    { canvas: 'Last 6 mo', key: 'six', label: 'Last 6 mo' },
    { canvas: 'All 14 mo', key: 'all', label: 'All {n} months' },
    { canvas: 'Missing only', key: 'missing' },
  ],

  // ── Raise ────────────────────────────────────────────────────────────────
  // Rows are assembled from the round record, investor prospects and stored
  // documents. Each row's state and source are real; no row carries a date this
  // page could order a timeline by.
  'raise/status': [
    { canvas: 'Overview', key: 'overview' },
    { canvas: 'Blockers', key: 'blockers' },
    { canvas: 'Investors', key: 'investors' },
    { canvas: 'Timeline', unbuilt: 'the assembled rows carry a state but no date, so they cannot be put in order' },
  ],
  // Deck versions are stored and engagement is returned per version. A deck has
  // versions rather than narrative variants, and a share link is minted and
  // revoked in the deck builder, which is where its record lives.
  'raise/pitch': [
    { canvas: 'Versions', key: 'versions' },
    { canvas: 'Variants', unbuilt: 'a deck stores versions; no narrative variant is a separate record' },
    { canvas: 'Shares', unbuilt: 'share links are held by the deck builder and are not returned to this page' },
    { canvas: 'Analytics', key: 'analytics' },
  ],
  // The one zone where the canvas asks for five views and the store has all
  // five: the ledger, the SAFE inputs, the compare variants and the 409A read
  // are separate fulfilled calls, and the waterfall is derived from the first.
  'raise/capital': [
    { canvas: 'Ownership', key: 'ownership' },
    { canvas: 'Instruments', key: 'instruments' },
    { canvas: 'Scenarios', key: 'scenarios' },
    { canvas: '409A', key: '409a' },
    { canvas: 'Waterfall', key: 'waterfall' },
  ],
  'raise/legal': [
    { canvas: 'All documents', key: 'all' },
    { canvas: 'Agreements', key: 'agreements' },
    { canvas: 'Compliance', key: 'compliance' },
    { canvas: 'Signatures', key: 'signatures' },
  ],
  // Grants, files and access events are all project-scoped records, so the
  // matrix, both of its axes and the gap read are each a view over them.
  'raise/data-room': [
    { canvas: 'Matrix', key: 'matrix' },
    { canvas: 'By artifact', key: 'artifacts' },
    { canvas: 'By investor', key: 'investors' },
    { canvas: 'Gaps', key: 'gaps' },
  ],
  // The waterfall is derived from the stored cap table. The other three want a
  // ledger this product has never had, which is also why all four stats on this
  // page read Unavailable rather than zero.
  'raise/liquidity': [
    { canvas: 'Restrictions', unbuilt: NO_LIQUIDITY_LEDGER },
    { canvas: 'Waterfall', key: 'waterfall' },
    { canvas: 'Tender', unbuilt: NO_LIQUIDITY_LEDGER },
    { canvas: 'History', unbuilt: NO_LIQUIDITY_LEDGER },
  ],

  // ── Grow ─────────────────────────────────────────────────────────────────
  // Metric snapshots are dated, so the two period views run. Experiments and
  // targets are the zone's stated gaps and its rail says so already.
  'grow/focus': [
    { canvas: 'August', key: 'latest', label: 'Latest month' },
    { canvas: 'Last 6 mo', key: 'six-months' },
    { canvas: 'Experiments', unbuilt: 'no experiment log is connected, so no effect on the metric is claimed' },
    { canvas: 'Targets', unbuilt: 'no metric target is stored' },
  ],
  // Roles linked to this startup become their own chips — the canvas's two are
  // sample names. An application's stored status is what "shortlisted" reads.
  'grow/talent': [
    { canvas: 'All roles', key: 'all' },
    { canvas: ['Backend', 'GTM'], dynamic: 'roles', label: 'One chip per role', unbuilt: 'no job post is linked to this startup yet' },
    { canvas: 'Shortlisted', key: 'shortlisted' },
  ],
  // The canvas names three market segments. A customer record stores the source
  // it was captured from, which is not the same thing, so the chips are the
  // stored sources and the difference is said rather than papered over.
  'grow/customers': [
    { canvas: 'All', key: 'all' },
    {
      canvas: ['Distributed SaaS', 'Agencies', 'Enterprise'],
      dynamic: 'sources',
      label: 'One chip per segment',
      unbuilt: 'no market segment is stored on a customer record',
    },
    { canvas: 'Stalled', unbuilt: 'no activity timeline is stored, so no account can be called stalled' },
  ],
  'grow/partnerships': [
    { canvas: 'All', key: 'all' },
    { canvas: 'In motion', key: 'in-motion' },
    { canvas: 'Signed', key: 'signed' },
    { canvas: 'Dormant', key: 'dormant' },
  ],
  // Prospects carry a stage, and the stored stages become the chips. Warm paths
  // are the Network relationship book's, and nothing joins the two records.
  'grow/capital-match': [
    { canvas: 'Best fit', key: 'all', label: 'All prospects' },
    { canvas: 'Warm path only', unbuilt: 'nothing joins a prospect to a relationship in the network book' },
    { canvas: 'Right stage', dynamic: 'stages', label: 'One chip per stage', unbuilt: 'no prospect records a stage yet' },
    { canvas: 'Passed', key: 'passed' },
  ],
  'grow/brand': [
    { canvas: 'All pages', key: 'all' },
    { canvas: 'Live', key: 'live' },
    { canvas: 'Draft', key: 'draft' },
    { canvas: 'Leads', key: 'leads' },
  ],
  // Calendar events are dated, so upcoming and the full list both run. Nothing
  // stores an article or a publication state.
  'grow/launch': [
    { canvas: 'Upcoming', key: 'upcoming' },
    { canvas: 'Published', unbuilt: 'a calendar event has no publication state' },
    { canvas: 'Events', key: 'events' },
    { canvas: 'Articles', unbuilt: 'no article or content record is connected to this startup' },
  ],

  // ── Network ──────────────────────────────────────────────────────────────
  // THE ONLY ZONE ON THIS SURFACE WHERE ALL FOUR LABELS RUN, and the reason is
  // which store it reads. Founder relationships are `contacts`, which carries
  // `audience` and `last_activity_at`; the other three licences read
  // `partner_relationships`, which carries neither a role for the counterpart
  // nor any interaction date. One canvas row, one component, and the licence
  // that happens to sit on the right table gets four chips where advisor and
  // partner get one.
  //
  // A MIGRATION, NOT NEW WORK. `.fn-rel-tabs` has rendered these four labels
  // since the page shipped, over the same predicates named here. What moves is
  // where the row lives; not one predicate changes.
  //
  // `Going cold` CARRIES A CAVEAT THIS TABLE CANNOT FIX. `last_activity_at` is
  // stamped at creation, so a signup nobody has touched reads as going cold on
  // its 61st day — which is exactly what the page's own note says it does not
  // do. The predicate is the one that ships today and the chip is honest about
  // what it selects; correcting the column is a write-path change.
  'network/relationships': [
    { canvas: 'Everyone', key: 'everyone' },
    { canvas: 'Investors', key: 'investors' },
    { canvas: 'Advisors', key: 'advisors' },
    { canvas: 'Going cold', key: 'cold' },
  ],

  // Two live, two prose, and the two prose entries replace CHIPS THAT SHIPPED.
  // `Asked` matched zero rows on every account and said so as a fact about the
  // reader's data; `Offered` matched every row. `Stalled` is the one that
  // always worked — `status = 'expired'`, written lazily by the route on every
  // read.
  'network/introductions': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Asked', unbuilt: NO_DIRECTION_RECORDED },
    { canvas: 'Offered', unbuilt: NO_DIRECTION_RECORDED },
    { canvas: 'Stalled', key: 'stalled' },
  ],

  // FOUR LABELS, NO CHIPS, AND `All` IS PROSE TOO. This zone's collection is
  // empty by construction on every account — the grouping key it reads is not
  // a column on `contacts` — so a chip here could only ever say "nothing
  // matches this filter" over a page that has nothing to match, which is D51's
  // canonical failure. Four such chips shipped until this commit, and `Funds`
  // rendered "No funds organizations are recorded", a per-filter claim about
  // this founder's data made by a page that had never looked.
  //
  // WHAT STAYS IS THE PAGE'S OWN PROSE, which was written knowing the field
  // might be absent: "No explicit organizations are recorded… people without
  // an organization are not placed into an inferred row", the stat that reads
  // "No organization fields returned", and the footnote refusing to infer
  // membership from email domains. Those are careful and correct. Only the
  // chip row was dishonest.
  //
  // THE OPS HALF OF THIS ROW NEEDED THE SAME CORRECTION and got it: it said
  // merging was merely unbuilt. The finding is stronger — with no key, there
  // is nothing to merge and nothing to have duplicated.
  'network/organizations': [
    { canvas: 'All', unbuilt: NO_ORG_ON_A_CONTACT },
    { canvas: 'Funds', unbuilt: NO_ORG_ON_A_CONTACT },
    { canvas: 'Customers', unbuilt: NO_ORG_ON_A_CONTACT },
    { canvas: 'Dormant', unbuilt: NO_GROUP_TO_AGE },
  ],

  // ── Research ─────────────────────────────────────────────────────────────
  // SHARED WITH THREE OTHER LICENCES, and that is why these entries exist here
  // rather than in one common table. `ResearchWorkspace` renders `AskZone` and
  // `LibraryZone` for founder, investor, advisor and partner alike, but the
  // artboards do not agree on what the row should say and the store does not
  // agree on what it can answer. `/research/library` is the sharpest case: one
  // column, one write path, one client method, and partner gets four live chips
  // off it while founder gets one — the difference is entirely which values a
  // writer can actually produce.

  // Nothing survives a question. `research.post('/ask')` searches, answers and
  // returns; it writes no row, and the only per-question record anywhere is
  // `ai_usage_logs`, which holds token counts and no question text. So the page
  // has exactly one answer in state at a time and there is nothing to narrow.
  'research/ask': [
    { canvas: 'All sessions', unbuilt: NO_SESSION_RECORD },
    { canvas: 'Saved', unbuilt: NO_SESSION_RECORD },
    {
      canvas: 'Cited in deck',
      unbuilt: 'a citation names the passage it quoted and carries no document id, and nothing carries one into the deck builder',
    },
    { canvas: 'Discarded', unbuilt: NO_SESSION_RECORD },
  ],
  // THREE OF THESE FOUR WERE ALREADY ON SCREEN AND MATCHED NOTHING. The page
  // has held `stage_fit === 'right'`, `path === 'warm'` and `status ===
  // 'passed'` since the zone shipped, over columns the worker validates and a
  // PATCH route accepts — and no surface in this product ever set one. The
  // add-a-fund form sends a name, a thesis and a note; `api.research.fundUpdate`
  // had no callers at all. Three live-looking chips over three empty columns.
  // The repair is the missing writer, not a sentence: each row now carries the
  // three controls, so the predicates that were always right have something to
  // be right about.
  //
  // `Best fit` IS `all`, RELABELLED, exactly as `grow/capital-match` above
  // resolves the same canvas word. No fit score is stored, and the zone's own
  // StatedLimit already refuses to invent one — "nothing here scores a fund for
  // you, ranks your list, or drafts an approach". So the canvas's first slot
  // becomes the unfiltered view rather than a ranking that would be a number
  // with no method behind it.
  'research/funds': [
    { canvas: 'Best fit', key: 'all', label: 'All funds' },
    { canvas: 'Right stage', key: 'right' },
    { canvas: 'Warm path', key: 'warm' },
    { canvas: 'Passed', key: 'passed' },
  ],
  // One reason, four labels. Worth stating precisely because a shorter version
  // would be wrong: signals ARE stored, dated and scored, and this page reads
  // them. What is absent is the object the canvas filters — a saved analysis
  // with a method, a run date and a lifecycle.
  'research/markets': [
    { canvas: 'Saved', unbuilt: NO_SAVED_DEEP_DIVE },
    { canvas: 'Builder', unbuilt: NO_SAVED_DEEP_DIVE },
    { canvas: 'Sources', unbuilt: NO_SAVED_DEEP_DIVE },
    { canvas: 'Retired', unbuilt: NO_SAVED_DEEP_DIVE },
  ],
  // THE CLASSIFICATION IS REAL AND SITS ONE LEVEL DOWN. `competitor_candidates`
  // carries `direct | adjacent`, defended by every writer — the manual form,
  // the row editor, the AI prompt and three server-side coercions. What this
  // header row governs is the saved ANALYSES: its ops half exports them, and
  // the list endpoint deliberately omits candidates. Narrowing the left half by
  // a candidate's category while the right half exports analyses would make one
  // row mean two things, so the reason says which level holds what.
  'research/companies': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Direct', unbuilt: CATEGORY_IS_PER_COMPETITOR },
    { canvas: 'Adjacent', unbuilt: CATEGORY_IS_PER_COMPETITOR },
    {
      canvas: 'Comparables',
      unbuilt: 'no competitor can be filed as a comparable: the form offers direct or adjacent, and every writer coerces anything else to direct',
    },
  ],
  // `All` is the only one of the five this licence can run. Two fail on the
  // vocabulary, and two on columns that were never there — both of which this
  // page's own stat strip already states in words, so the wording is reused.
  'research/library': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Reports', unbuilt: NO_SUCH_KIND },
    {
      canvas: 'Primary',
      unbuilt: 'no document records whether it is your own research or a bought report',
    },
    { canvas: 'Legal', unbuilt: NO_SUCH_KIND },
    {
      canvas: 'Stale',
      unbuilt: 'nothing records a source’s own year, and the date held is when the file was added here, which is a different fact',
    },
  ],
};

export const founderZoneFilters = makeZoneFilters(FOUNDER_ZONE_FILTERS);
