import { makeZoneFilters } from './zoneFilterBuilder.js';

/**
 * The investor profile's filter tables — the left half of the zone header row.
 *
 * `investorZoneFilters.js` is to `investorZoneActions.js` what
 * `founderZoneFilters.js` is to `founderZoneActions.js`: the same builder, the
 * same three outcomes, a different licence's answers. `zoneFilterBuilder.js`
 * states the rules and argues why a dead FILTER costs more than a dead button —
 * an action that performs nothing does nothing visible, but a filter that
 * cannot run returns an empty set, and an empty set reads as an answer.
 *
 * WHERE THE LABELS COME FROM. Verbatim from the `filters:` array of the zone's
 * artboard in `design/canvases/integrated/Pages · Investor {…}.dc.html`, in the
 * canvas's own order. Nineteen zones and eighty labels across five canvases;
 * this file grows one bucket at a time and `profile_zone_filters.test.mjs`
 * holds the rest in `excluded` so a deferral is recorded rather than silent.
 *
 * THE FUND CANVAS ROUTES ARE NOT THE LIVE ONES, and the keys here are the live
 * ones. `Pages · Investor Fund` names `/fund/lps`, `/fund/calls`,
 * `/fund/accounting`, `/fund/reporting`; the router mounts `/funds/lps`,
 * `/funds/calls`, `/funds/ledger`, `/funds/reporting`. The guard's `live()` map
 * does the translation, exactly as `investorZoneActions.js` describes for the
 * ops half.
 *
 * ALL NINETEEN ARE HERE. The three Deals decision zones were the last to
 * arrive: each rendered a single-record panel, and filtering one record
 * narrows nothing — so they waited for the lists their canvases draw, which
 * ID2–ID4 built. `profile_zone_filters.test.mjs`'s `excluded` list for this
 * profile is empty, and it stays that way by construction: a zone without a
 * row fails the exact-set check there.
 *
 * SOME ZONES WERE ALREADY RIGHT AND ARE NOT BEING CHANGED. `funds/lps` and
 * `funds/reporting` each carry four real predicates over rows they load; their
 * entries here name the keys those pages already use, and not one predicate is
 * touched. The point of the move is the header row's shape, not a rewrite of
 * working code.
 */

// `/funds/ledger` fails for one reason across several filters, so the reason
// is written once and shared by every entry it covers rather than restated per
// label. (`/funds/calls` shared one too, until D371 built its ledger.)
const NO_LEDGER_LINES =
  'the fund analytics contract returns totals, not the journal, fee movements or audit rows behind them';
const NO_EXTRACTION_LAYER =
  'the update feed returns submitted values and narratives, never the extraction proposal behind them or the rules that would produce one';
// The third kind of reason, and the founder table never needed one. `Mine` is
// not a gap and it is not live either: the board is ALREADY scoped, so a chip
// would narrow nothing while appearing to, and "no owner is recorded" would be
// flatly false — `lead_partner_id` is a column and `Unassigned` beside it reads
// it. What is true is that the question has already been answered upstream.
const ALREADY_MINE =
  'every deal on this board is already one of yours; it loads only the deals you were invited to, committed to, or are a room member of';
// `/network/relationships`. `partner_relationships` is `partner_a_id,
// partner_b_id, relationship_type, strength_score, metadata` and nothing else
// — no interaction date and no fund tie, so `Going cold` and `LPs` keep their
// reasons. The third gap this comment used to name is closed: the counterpart's
// role was missing from the payload, and `/partnernet/relationships` now
// returns it, which is what the `Founders` chip narrows on.
const NO_LP_RELATIONSHIP =
  'an LP register is kept against a fund rather than as a relationship, and this page never reads it';
// `Going cold` went live with D465: `partner_interactions` (migration 338) is
// the interaction log, and the relationship's last touch is its MAX.
// `/network/introductions`. NOT word for word what the founder table says, and
// the difference is a store: the founder desk reads `intro_propositions` alone,
// where every row is addressed to the reader, but an investor's own asks live
// in `investor_introductions` (`GET /api/introductions`) — so `Asked` is a live
// chip here and stays prose there. `Offered` keeps a reason of its own: an
// introduction you gave is value-add support (the ledger the Portfolio desk
// keeps), not a row on this desk. Note the canvas order differs from
// founder's — `Offered` before `Asked` — which is exactly why these are four
// tables and not one.
const NO_OFFER_ON_THIS_DESK =
  'an introduction you offered is logged as value-add support, not on this desk — every row here is one addressed to you, or one you asked for';
// `/network/organizations`, AND THE FOUR-STEP CHECK ENDS AT STEP FOUR HERE.
// `metadata` is a real column on `partner_relationships` and it is free-text
// JSON, so `metadata.organization_name` is a shape the store could physically
// hold — which is exactly the trap D52 was written about. The write path exists
// (`POST /partnernet/relationships`) and the client method exists
// (`api.createRelationship`). What it no longer has is a CALLER: this note used
// to cite `RelationshipsPage.jsx:154` sending `{partner_id, relationship_type,
// strength_score}` and no metadata, and that page has since been rebuilt onto
// the firm book (migration 224) and calls neither. So the count of writers went
// from one-that-omits-it to none, which makes the conclusion stronger rather
// than stale. The string `organization_name` appears nowhere in the worker or
// the backend. Nothing has ever written one.
//
// AND THE BOOK'S `organization` COLUMN IS NOT AN ANSWER HERE. Migration 224
// gives a contact an employer as text, which is what `pn3`'s intended-shape
// table would group by — but that table is the PARTNER licence's book, read
// through `/api/partnernet/book`, and an investor's Organizations zone rolls up
// `partner_relationships`. A column on a table this zone does not read is not a
// column this zone has.
const NO_ORG_ON_A_RELATIONSHIP =
  'a relationship records two accounts, a type and a strength, and nothing on it names the firm either of them is at, so there are no organisations here to select between';
// The other two name records that are real and are kept somewhere this page
// never opens: it loads the relationship book, the network summary and the
// introductions desk, and nothing else. `limited_partners` is keyed on
// `fund_id` and belongs to the Fund bucket; `deals.pass_reason` is a CHECKed
// taxonomy on a deal, which the pipeline zone reads and this one does not.
const KEPT_IN_ANOTHER_STORE =
  'both name records this page never loads: an LP belongs to a fund’s own register, and a pass is a reason stamped on a deal';
// `/research/library` is a shared surface, so its reasons read the same as
// founder's — deliberately. One component draws both rows, and a reader moving
// between licences must not find one absence explained two ways. Ask's
// `NO_SESSION_RECORD` was the other half of that pairing and is gone from both
// files together: migration 221 stored the session history it denied.
const NO_SUCH_KIND =
  'a document is filed as a document, a playbook or about a client, and no upload can classify one any other way';
// `/research/markets`. The same absence founder's row states, in this licence's
// words: all four labels are lifecycle states of a SAVED DEEP-DIVE, which the
// artboard shows as `Analysis · Method · Run · State`. Two of them look nearly
// live and are not — `signals.status` exists, but the feed's own query is
// `WHERE status = 'active'` and the row mapper never sends `status` to the
// browser, so `Active` selects everything and nothing writes `parked` or
// `archived` at all.
const NO_SAVED_DEEP_DIVE =
  'nothing saves a market deep-dive, so there is no analysis to hold active, park, retire or build; this page is the signals feed, gathered on a schedule';

export const INVESTOR_ZONE_FILTERS = {
  // ── Fund ─────────────────────────────────────────────────────────────────
  // Four real predicates over `api.fundsLpsList`, all already written. `By
  // type` is the canvas's name for one chip per stored LP type, which is what
  // the page already renders from its own `types` memo — the same dynamic
  // group founder's `grow/talent` uses for job posts.
  'funds/lps': [
    { canvas: 'All LPs', key: 'all' },
    { canvas: 'Behind', key: 'behind' },
    { canvas: 'KYC pending', key: 'kyc' },
    {
      canvas: 'By type',
      dynamic: 'types',
      label: 'One chip per LP type',
      unbuilt: 'no LP record carries a type yet',
    },
  ],

  // THE ONE THAT WOULD HAVE BEEN EASY TO GET WRONG. `api.capitalCalls()` exists
  // (`api.js`, `/legalcap/capital/calls`), so "no call schedule is stored" would
  // be FALSE — in exactly the way "nothing writes an LP" was false on the zone
  // above, which `profile_zone_actions.test.mjs` already has a test for. The
  // page's own empty state names the real gap in one word: "**Fund-scoped**
  // call ledger unavailable". Calls exist; the link to a fund register does not.
  //
  // `Call 3` is that artboard's sample datum — one specific call, not a count
  // welded onto a filter, so `{n}` is not the repair. It renders as the
  // positional filter it actually is.
  // D371: the call ledger exists, so three of the four run. `Current call` is
  // the newest numbered call's lines, `All calls` every numbered call's, and
  // `Outstanding` every line — numbered or from before numbering — that still
  // owes something. `Notices` keeps a reason, corrected: a notice IS logged per
  // LP account when a call is issued, but no letter is kept and no delivery is
  // tracked, so there is no notice state to filter lines by.
  'funds/calls': [
    { canvas: 'Call 3', label: 'Current call', key: 'latest' },
    { canvas: 'All calls', key: 'all' },
    { canvas: 'Outstanding', key: 'outstanding' },
    { canvas: 'Notices', unbuilt: 'an in-app notice is logged for each LP account when a call is issued, but no letter is kept and no delivery is tracked, so there is no notice state to filter by', hover: 'Call notices are logged, but their delivery is not tracked, so there is nothing to filter.' },
  ],

  // `Summary` is real — it reads the fund analytics totals. The other three
  // reached a panel that told you so only after you clicked.
  'funds/ledger': [
    { canvas: 'Summary', key: 'summary' },
    { canvas: 'Journal', unbuilt: NO_LEDGER_LINES },
    { canvas: 'Fees', unbuilt: NO_LEDGER_LINES },
    { canvas: 'Audit trail', unbuilt: NO_LEDGER_LINES },
  ],

  // Four real predicates over `api.lpReportsList` / `api.fundsReportPeriods`.
  // `Delivery` narrows on optional fields, which is honest: a period with no
  // delivery record simply does not match, and the zone's ops half already
  // notes that delivery is counted and never itemised.
  'funds/reporting': [
    { canvas: 'All periods', key: 'all' },
    { canvas: 'Published', key: 'published' },
    { canvas: 'Drafted', key: 'drafted' },
    { canvas: 'Delivery', key: 'delivery' },
  ],

  // ── Portfolio ────────────────────────────────────────────────────────────
  // All four are real, and `By stage` is the one that needs saying: it is a
  // live chip that REVEALS a control rather than applying one. The page has
  // always kept a `<select>` of the stages its own rows carry, shown only when
  // this filter is chosen. That select does not move here — narrowing to a
  // stage is still two clicks, because there is no single stage the chip could
  // pick for you.
  'portfolio/positions': [
    { canvas: 'Needs attention', key: 'attention' },
    { canvas: 'All', key: 'all' },
    { canvas: 'By stage', key: 'stage' },
    { canvas: 'Marked down', key: 'marked' },
  ],

  // `if (filter === 'parse') return false; if (filter === 'rules') return false;`
  // — the `/grow/customers` "Stalled" defect, twice, on one page. Both chips
  // emptied the inbox, and an empty inbox reads as "every update is clean"
  // rather than "nothing here was ever parsed". The page's own panel below has
  // said the true thing all along; it just said it after the click.
  //
  // ONE REASON, NOT TWO, and the ops half is why the wording is specific: that
  // row already carries `Edit rules — no reminder rules are stored`. The rules
  // this filter means are the EXTRACTION rules, a different absent thing, so
  // the sentence names which kind rather than leaving two "rules" notes inches
  // apart appearing to contradict each other.
  'portfolio/updates': [
    { canvas: 'This period', key: 'period' },
    { canvas: 'Overdue', key: 'overdue' },
    { canvas: 'Parse review', unbuilt: NO_EXTRACTION_LAYER },
    // `Rules` WAS `NO_EXTRACTION_LAYER` TOO, and that reason is true about the
    // rules which would produce an extraction — but it is not the only rule set
    // in play. `portfolio_kpi_definitions` stores the KPIs companies are held
    // to, with the wording, the cadence and whether each is required, and
    // `GET /positions/kpi-compliance` has been returning it as `kpi_set` on
    // every load of this page. The chip was marked unbuilt over data already in
    // hand. Editing them is still unoffered — see the ops row.
    { canvas: 'Rules', key: 'rules' },
  ],

  // Four live chips over a page that makes no `api.*` call at all — the same
  // shape as `/funds/calls`, and the same repair. `By company` is not a dynamic
  // group here: the companies exist, but there is nothing to group BY them, so
  // the missing thing is the ledger and not the names.
  // ALL FOUR WERE DARK BEHIND `NO_SUPPORT_LEDGER`, AND THAT REASON WAS TRUE.
  // It is the only one in this series that survived the schema check: every
  // table joining an investor to a company records the investor gaining ACCESS
  // to one, never doing work for one (migration 237's header lists them, and
  // why each fails). So this zone was not corrected, it was built — the ledger
  // now exists, and `state` is what these three predicates read.
  //
  // `By company` is the fourth and it is a VIEW, like `portfolio/updates`'s
  // `Rules`: a rollup per company rather than a narrower row set. The ops row's
  // `Per-company view` selects the same thing, which is how the artboard draws
  // it — one view, reachable from either half of the header.
  'portfolio/value-add': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Delivered', key: 'delivered' },
    { canvas: 'Outstanding', key: 'outstanding' },
    { canvas: 'By company', key: 'company' },
  ],

  // ── Deals ────────────────────────────────────────────────────────────────
  // FOUR OF THESE FIVE ARE LIVE, AND THREE OF THEM ARE NEW — which is the
  // point. The board had no filter row at all, so the easy move was to call
  // the whole thing unavailable. Reading the deal record instead:
  // `lead_partner_id` is a column the list already selects, `days_in_stage` is
  // computed and returned on every row, and a pass is `status = 'rejected'`
  // written through `POST /api/deals/:id/pass` with a reason from a CHECKed
  // enum. Three sentences saying "nothing is stored" would have been three
  // false statements over data the page had already loaded.
  //
  // `Stale` reuses `slaBand` from `lib/dealFlow.js` rather than picking a
  // number here: the thresholds are the canvas's own SLA presets, and one
  // definition of "sat too long" for the whole product beats two.
  // ── Screening ────────────────────────────────────────────────────────────
  // FOUR LIVE CHIPS OUT OF FOUR, and the reason this row could be written at
  // all is that the store was there the whole time. This zone was deliberately
  // excluded while it rendered a one-record panel — filtering one record
  // narrows nothing — and canvas ID2 is the body work that deferral named.
  //
  // Each key narrows a real collection: `scored` and `flags` come from
  // `score_snapshots` (six dimensions, `admin_review_status`, `anomaly_flags`),
  // `rubric` shows the six dimensions the scorer writes, and `passes` is the
  // CHECKed pass taxonomy `GET /api/deals/pass-analytics` already served.
  'deals/screening': [
    { canvas: 'Scored', key: 'scored', label: 'Scored {n}' },
    { canvas: 'Rubric', key: 'rubric' },
    { canvas: 'Red flags', key: 'flags', label: 'Red flags {n}' },
    { canvas: 'Pass reasons', key: 'passes' },
  ],

  // `Blocking` went live with D461: a blocking item is a Commit condition, and
  // `ic_conditions` (migration 334) is the store the hand-off runs on — the
  // chip narrows to the deals at closing with an open condition. `Wires` went
  // live with D462: `deal_transfers` (migration 335) records a transfer out to
  // a company — the direction `capital_calls` never covered.
  'deals/closing': [
    { canvas: 'This close', key: 'close', label: 'This close {n}' },
    { canvas: 'Blocking', key: 'blocking', label: 'Blocking {n}' },
    { canvas: 'Documents', key: 'documents', label: 'Documents {n}' },
    { canvas: 'Wires', key: 'wires', label: 'Wires {n}' },
  ],

  // `Conditions` and `Minutes` went live with D461: conditions are their own
  // table (migration 334) and minutes live on the meeting record. Both were
  // `unbuilt` with reasons that were true when written — the memo and terms
  // were free text, and ic_meetings carried only its agenda.
  'deals/commit': [
    { canvas: 'This deal', key: 'current' },
    { canvas: 'All decisions', key: 'decisions' },
    { canvas: 'Conditions', key: 'conditions', label: 'Conditions {n}' },
    { canvas: 'Minutes', key: 'minutes' },
  ],

  'deals/pipeline': [
    { canvas: 'All stages', key: 'all', label: 'All stages {n}' },
    { canvas: 'Mine', unbuilt: ALREADY_MINE },
    { canvas: 'Unassigned', key: 'unassigned', label: 'Unassigned {n}' },
    { canvas: 'Stale', key: 'stale', label: 'Stale {n}' },
    { canvas: 'Passed', key: 'passed', label: 'Passed {n}' },
  ],

  // ── Network ──────────────────────────────────────────────────────────────
  // ONE LIVE CHIP OUT OF FIVE, from the same component that gives founder four
  // out of four. Founder relationships read `contacts`; this licence reads
  // `partner_relationships`, and the difference is the whole row.
  //
  // `Everyone` is the reset view rather than a claim — it selects what the page
  // loaded, which is what the word means here. `Co-investors` is the one real
  // narrowing: `relationship_type` is a CHECKed set and `co_investor` is a
  // member of it.
  'network/relationships': [
    { canvas: 'Everyone', key: 'all' },
    { canvas: 'Founders', key: 'founders' },
    { canvas: 'Co-investors', key: 'coinvestors' },
    { canvas: 'LPs', unbuilt: NO_LP_RELATIONSHIP },
    { canvas: 'Going cold', key: 'cold', label: 'Going cold {n}' },
  ],

  'network/introductions': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Offered', unbuilt: NO_OFFER_ON_THIS_DESK },
    { canvas: 'Asked', key: 'asked' },
    { canvas: 'Stalled', key: 'stalled' },
  ],

  // FIVE LABELS, NO CHIPS. The section this row sits over is honest already —
  // "No organization identity is recorded on your relationship records yet" —
  // and it is honest because it has always been empty: `orgIdentity` tries six
  // paths and the last of them, `metadata.organization_name`, is a key nothing
  // in this product writes. `All` is prose for the same reason it is on the
  // founder row: there is no collection for it to select.
  //
  // `Co-investors` IS THE ONE WORTH READING TWICE. It is a live chip one zone
  // up, where `relationship_type = 'co_investor'` selects people. Here the same
  // word would have to select firms, and the store holds none. Same label, same
  // table, two zones apart, live in one and dead in the other — which is the
  // clearest statement this workstream has of why a filter's verdict belongs to
  // the row it sits on and not to the word.
  'network/organizations': [
    { canvas: 'All', unbuilt: NO_ORG_ON_A_RELATIONSHIP },
    { canvas: 'Portfolio', unbuilt: NO_ORG_ON_A_RELATIONSHIP },
    { canvas: 'Co-investors', unbuilt: NO_ORG_ON_A_RELATIONSHIP },
    { canvas: 'LPs', unbuilt: KEPT_IN_ANOTHER_STORE },
    { canvas: 'Passed', unbuilt: KEPT_IN_ANOTHER_STORE },
  ],

  // ── Research ─────────────────────────────────────────────────────────────
  // TWO ZONES SHARED WITH THREE OTHER LICENCES. `ResearchWorkspace` renders one
  // `AskZone` and one `LibraryZone` for all four, so these entries land beside
  // founder's, advisor's and partner's rather than after them — a header row
  // that appears on one licence and not another, out of the same file, reads as
  // a bug. What the entries say is not shared: on `/research/library` the same
  // column answers four of partner's labels and one of these five.

  // The same absence founder's row states, in this licence's words. Nothing is
  // written per question — `research.post('/ask')` searches, answers and
  // returns — so there is no session, kept answer or outcome to narrow. The ops
  // half of this row already says "no session history is stored to clear".
  // TWO LIVE, TWO STILL PROSE, AND THE SPLIT IS NOT THE ONE THIS TABLE
  // EXPECTED. Migration 221 gave Ask a session store, so `All sessions` and
  // `Saved` both select something now — the same store that turned advisor's
  // and partner's rows fully live. `Cited in a memo` and `Discarded` do not
  // follow it: a citation names the passage it quoted and carries no document
  // id, and nothing discards an answer — the ops row offers save, not throw
  // away. Two of these four were never about the session store at all, which
  // is why `NO_SESSION_RECORD` covering all four was hiding a distinction.
  'research/ask': [
    { canvas: 'All sessions', key: 'all' },
    { canvas: 'Saved', key: 'saved' },
    {
      canvas: 'Cited in a memo',
      unbuilt: 'a citation names the passage it quoted and carries no document id, and nothing carries one into a memo',
    },
    { canvas: 'Discarded', unbuilt: 'nothing discards an answer — the ops row offers keeping one, and an answer not kept is simply not kept' },
  ],
  // ROOM ACCESS, AND THE CANVAS MEANS SOMETHING DIFFERENT BY `Requested` THAN
  // THE WORD SUGGESTS. Its own artboard code reads
  // `PULLS.filter(p => p.state === 'Requested')` into a variable called
  // `partial`, and its `Requested` row is `6 of 11 files · IP folder withheld`.
  // It is a partly-staged room, which this page can see — `withheld_behind_nda`
  // is on every row and the route already returns the count as `partial_count`.
  // So the chip is live and wears the store's own word: keeping `Requested`
  // would promise a request record, and the ops half of this same row spends a
  // sentence explaining that none exists.
  //
  // `Granted` is the ALREADY-SCOPED kind of reason, like `Mine` on the pipeline
  // board: the query selects only active grants, so `granted_count` is
  // literally `items.length` and a chip would narrow nothing while looking like
  // it might.
  'research/diligence': [
    { canvas: 'All', key: 'all' },
    {
      canvas: 'Granted',
      unbuilt: 'every room here is one you have been granted; the list loads active grants only, so this would select all of them',
    },
    { canvas: 'Requested', key: 'partial', label: 'Partly staged' },
    {
      canvas: 'Not staged',
      unbuilt: 'a company that never opened a room is not on this list at all, because the grant is what puts a room here and an unstaged one leaves no row to find', hover: 'A company that never opened a room leaves no row here to find.',
    },
  ],
  // `Peer set` IS RELABELLED BECAUSE THE OPS HALF WOULD CONTRADICT IT. That
  // half says "a peer source is recorded per row, so there is no one set to
  // switch" — and it is right: `research_benchmarks` carries `peer_source` and
  // `peer_sample_size` per row under a CHECK, with no shared peer set anywhere.
  // What the page can tell apart is which rows are comparisons at all, which it
  // already labels `Tracked, not compared` and counts in its own subtitle.
  'research/benchmarking': [
    { canvas: 'Peer set', key: 'comparison', label: 'Compared' },
    { canvas: 'Metrics', key: 'all' },
    {
      canvas: 'Saved',
      unbuilt: 'a benchmark row has no draft state; the form writes a finished row on submit, so every metric on this page is saved',
    },
    {
      canvas: 'Export',
      unbuilt: 'an export is an action rather than a view; the ops half of this row is where it belongs, and it says there why no chart is drawn', hover: 'Export is an action, not a view — it sits in the other half of this row.',
    },
  ],
  'research/markets': [
    { canvas: 'Active', unbuilt: NO_SAVED_DEEP_DIVE },
    { canvas: 'Parked', unbuilt: NO_SAVED_DEEP_DIVE },
    { canvas: 'Retired', unbuilt: NO_SAVED_DEEP_DIVE },
    { canvas: 'Builder', unbuilt: NO_SAVED_DEEP_DIVE },
  ],
  // `Diligence` looks like the two live chips partner gets from this same
  // column and is not one of them. `research_documents.kind` is free text, so
  // the column check and the write-path check both pass — but the only writer
  // is the upload form, which offers `Document`, `My playbook` and `About a
  // client`, and the worker coerces anything else. No row can carry it.
  'research/library': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Diligence', unbuilt: NO_SUCH_KIND },
    {
      canvas: 'Benchmarks',
      unbuilt: 'a benchmark is a row in Benchmarking carrying its own source and sample size, not a document in this library',
    },
    {
      canvas: 'Primary',
      unbuilt: 'no document records whether it is your own research or a bought report',
    },
    {
      canvas: 'Stale',
      unbuilt: 'nothing records a source’s own year, and the date held is when the file was added here, which is a different fact',
    },
  ],
};

export const investorZoneFilters = makeZoneFilters(INVESTOR_ZONE_FILTERS);
