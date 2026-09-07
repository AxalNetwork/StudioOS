import { makeZoneFilters } from './zoneFilterBuilder.js';

/**
 * The founder profile's eighteen zone pages, and what each of their canvas
 * filters can honestly do.
 *
 * WHERE THE LABELS COME FROM. Verbatim from the `filters: fil([…])` array of
 * the zone's artboard in `design/canvases/integrated/Pages · Founder
 * {Build,Raise,Grow}.dc.html`, in the canvas's own order. `founderZoneActions`
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
    { canvas: 'Last 4', note: NO_WEEK_STAMP },
    { canvas: 'All 14', label: 'All weeks', note: NO_WEEK_STAMP },
    { canvas: 'Carried only', note: 'nothing records a commitment moving from one week to the next' },
  ],
  // Cards are pipeline tasks with a stored `status` and `updated_at`. They
  // carry no lane and no assignee this page can compare against the reader, so
  // the canvas's two sample lanes and its "Mine" are stated, not drawn.
  'build/board': [
    { canvas: 'All lanes', key: 'all', label: 'All cards' },
    { canvas: ['Engineering', 'GTM'], label: 'Engineering and GTM', note: 'a card carries a stage, not a lane, and no lane is stored' },
    { canvas: 'Mine', note: 'a card records an owner name, which is not the same as the account reading it' },
    { canvas: 'Stale > 7d', key: 'stale' },
  ],
  // Objectives carry a quarter, a kanban column and a dependency field. No
  // scenario is stored anywhere in the roadmap source.
  'build/roadmap': [
    { canvas: 'Timeline', key: 'timeline' },
    { canvas: 'Board', key: 'board' },
    { canvas: 'Dependencies', key: 'dependencies' },
    { canvas: 'Scenarios', note: 'no roadmap scenario is stored' },
  ],
  // Nothing at all backs this zone: the page loads the project list and no
  // second source. All four filters share the one reason.
  'build/cadence': [
    { canvas: 'All rituals', note: NO_CADENCE_STORE },
    { canvas: 'Plans', note: NO_CADENCE_STORE },
    { canvas: 'Retros', note: NO_CADENCE_STORE },
    { canvas: 'Skipped', note: NO_CADENCE_STORE },
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
    { canvas: 'Timeline', note: 'the assembled rows carry a state but no date, so they cannot be put in order' },
  ],
  // Deck versions are stored and engagement is returned per version. A deck has
  // versions rather than narrative variants, and a share link is minted and
  // revoked in the deck builder, which is where its record lives.
  'raise/pitch': [
    { canvas: 'Versions', key: 'versions' },
    { canvas: 'Variants', note: 'a deck stores versions; no narrative variant is a separate record' },
    { canvas: 'Shares', note: 'share links are held by the deck builder and are not returned to this page' },
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
    { canvas: 'Restrictions', note: NO_LIQUIDITY_LEDGER },
    { canvas: 'Waterfall', key: 'waterfall' },
    { canvas: 'Tender', note: NO_LIQUIDITY_LEDGER },
    { canvas: 'History', note: NO_LIQUIDITY_LEDGER },
  ],

  // ── Grow ─────────────────────────────────────────────────────────────────
  // Metric snapshots are dated, so the two period views run. Experiments and
  // targets are the zone's stated gaps and its rail says so already.
  'grow/focus': [
    { canvas: 'August', key: 'latest', label: 'Latest month' },
    { canvas: 'Last 6 mo', key: 'six-months' },
    { canvas: 'Experiments', note: 'no experiment log is connected, so no effect on the metric is claimed' },
    { canvas: 'Targets', note: 'no metric target is stored' },
  ],
  // Roles linked to this startup become their own chips — the canvas's two are
  // sample names. An application's stored status is what "shortlisted" reads.
  'grow/talent': [
    { canvas: 'All roles', key: 'all' },
    { canvas: ['Backend', 'GTM'], dynamic: 'roles', label: 'One chip per role', note: 'no job post is linked to this startup yet' },
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
      note: 'no market segment is stored on a customer record',
      // Standing, not a fallback: with the source chips showing, this sentence
      // is the only thing stopping them being read as a segment breakdown.
      noteAlways: true,
    },
    { canvas: 'Stalled', note: 'no activity timeline is stored, so no account can be called stalled' },
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
    { canvas: 'Warm path only', note: 'nothing joins a prospect to a relationship in the network book' },
    { canvas: 'Right stage', dynamic: 'stages', label: 'One chip per stage', note: 'no prospect records a stage yet' },
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
    { canvas: 'Published', note: 'a calendar event has no publication state' },
    { canvas: 'Events', key: 'events' },
    { canvas: 'Articles', note: 'no article or content record is connected to this startup' },
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
    { canvas: 'All sessions', note: NO_SESSION_RECORD },
    { canvas: 'Saved', note: NO_SESSION_RECORD },
    {
      canvas: 'Cited in deck',
      note: 'a citation names the passage it quoted and carries no document id, and nothing carries one into the deck builder',
    },
    { canvas: 'Discarded', note: NO_SESSION_RECORD },
  ],
  // One reason, four labels. Worth stating precisely because a shorter version
  // would be wrong: signals ARE stored, dated and scored, and this page reads
  // them. What is absent is the object the canvas filters — a saved analysis
  // with a method, a run date and a lifecycle.
  'research/markets': [
    { canvas: 'Saved', note: NO_SAVED_DEEP_DIVE },
    { canvas: 'Builder', note: NO_SAVED_DEEP_DIVE },
    { canvas: 'Sources', note: NO_SAVED_DEEP_DIVE },
    { canvas: 'Retired', note: NO_SAVED_DEEP_DIVE },
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
    { canvas: 'Direct', note: CATEGORY_IS_PER_COMPETITOR },
    { canvas: 'Adjacent', note: CATEGORY_IS_PER_COMPETITOR },
    {
      canvas: 'Comparables',
      note: 'no competitor can be filed as a comparable: the form offers direct or adjacent, and every writer coerces anything else to direct',
    },
  ],
  // `All` is the only one of the five this licence can run. Two fail on the
  // vocabulary, and two on columns that were never there — both of which this
  // page's own stat strip already states in words, so the wording is reused.
  'research/library': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Reports', note: NO_SUCH_KIND },
    {
      canvas: 'Primary',
      note: 'no document records whether it is your own research or a bought report',
    },
    { canvas: 'Legal', note: NO_SUCH_KIND },
    {
      canvas: 'Stale',
      note: 'nothing records a source’s own year, and the date held is when the file was added here, which is a different fact',
    },
  ],
};

export const founderZoneFilters = makeZoneFilters(FOUNDER_ZONE_FILTERS);
