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
 * TWO OF THESE FOUR ZONES WERE ALREADY RIGHT AND ARE NOT BEING CHANGED.
 * `funds/lps` and `funds/reporting` each carry four real predicates over rows
 * they load; their entries here name the keys those pages already use, and not
 * one predicate is touched. The point of the move is the header row's shape,
 * not a rewrite of working code.
 */

// `/funds/calls` and `/funds/ledger` each fail for one reason across several
// filters, so the reason is named once and `groupFilterNotes` collapses them
// into a single sentence naming every label it covers.
const NO_FUND_SCOPED_CALLS =
  'capital calls are recorded, but nothing links one to a fund register, so none can be listed against this fund';
const NO_LEDGER_LINES =
  'the fund analytics contract returns totals, not the journal, fee movements or audit rows behind them';
const NO_EXTRACTION_LAYER =
  'the update feed returns submitted values and narratives, never the extraction proposal behind them or the rules that would produce one';
const NO_SUPPORT_LEDGER =
  'no value-add ledger exists, so no support entry, delivery state, hour or outcome is recorded against any company';
// The third kind of reason, and the founder table never needed one. `Mine` is
// not a gap and it is not live either: the board is ALREADY scoped, so a chip
// would narrow nothing while appearing to, and "no owner is recorded" would be
// flatly false — `lead_partner_id` is a column and `Unassigned` beside it reads
// it. What is true is that the question has already been answered upstream.
const ALREADY_MINE =
  'every deal on this board is already one of yours; it loads only the deals you were invited to, committed to, or are a room member of';
// `/research/ask` and `/research/library` are shared surfaces, so these two
// read the same as founder's — deliberately. One component draws both rows, and
// a reader moving between licences must not find one absence explained two
// ways. The ops half of the Ask row already says "no session history is stored
// to clear"; this is that clause, extended to the views the filters name.
const NO_SESSION_RECORD =
  'no session history is stored, so no past question, kept answer or discarded one exists to look through';
const NO_SUCH_KIND =
  'a document is filed as a document, a playbook or about a client, and no upload can classify one any other way';

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
      note: 'no LP record carries a type yet',
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
  'funds/calls': [
    { canvas: 'Call 3', label: 'Current call', note: NO_FUND_SCOPED_CALLS },
    { canvas: 'All calls', note: NO_FUND_SCOPED_CALLS },
    { canvas: 'Outstanding', note: NO_FUND_SCOPED_CALLS },
    { canvas: 'Notices', note: 'no call notice is stored, sent or tracked anywhere in this product' },
  ],

  // `Summary` is real — it reads the fund analytics totals. The other three
  // reached a panel that told you so only after you clicked.
  'funds/ledger': [
    { canvas: 'Summary', key: 'summary' },
    { canvas: 'Journal', note: NO_LEDGER_LINES },
    { canvas: 'Fees', note: NO_LEDGER_LINES },
    { canvas: 'Audit trail', note: NO_LEDGER_LINES },
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
    { canvas: 'Parse review', note: NO_EXTRACTION_LAYER },
    { canvas: 'Rules', note: NO_EXTRACTION_LAYER },
  ],

  // Four live chips over a page that makes no `api.*` call at all — the same
  // shape as `/funds/calls`, and the same repair. `By company` is not a dynamic
  // group here: the companies exist, but there is nothing to group BY them, so
  // the missing thing is the ledger and not the names.
  'portfolio/value-add': [
    { canvas: 'All', note: NO_SUPPORT_LEDGER },
    { canvas: 'Delivered', note: NO_SUPPORT_LEDGER },
    { canvas: 'Outstanding', note: NO_SUPPORT_LEDGER },
    { canvas: 'By company', note: NO_SUPPORT_LEDGER },
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
  'deals/pipeline': [
    { canvas: 'All stages', key: 'all' },
    { canvas: 'Mine', note: ALREADY_MINE },
    { canvas: 'Unassigned', key: 'unassigned' },
    { canvas: 'Stale', key: 'stale' },
    { canvas: 'Passed', key: 'passed' },
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
  'research/ask': [
    { canvas: 'All sessions', note: NO_SESSION_RECORD },
    { canvas: 'Saved', note: NO_SESSION_RECORD },
    {
      canvas: 'Cited in a memo',
      note: 'a citation names the passage it quoted and carries no document id, and nothing carries one into a memo',
    },
    { canvas: 'Discarded', note: NO_SESSION_RECORD },
  ],
  // `Diligence` looks like the two live chips partner gets from this same
  // column and is not one of them. `research_documents.kind` is free text, so
  // the column check and the write-path check both pass — but the only writer
  // is the upload form, which offers `Document`, `My playbook` and `About a
  // client`, and the worker coerces anything else. No row can carry it.
  'research/library': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Diligence', note: NO_SUCH_KIND },
    {
      canvas: 'Benchmarks',
      note: 'a benchmark is a row in Benchmarking carrying its own source and sample size, not a document in this library',
    },
    {
      canvas: 'Primary',
      note: 'no document records whether it is your own research or a bought report',
    },
    {
      canvas: 'Stale',
      note: 'nothing records a source’s own year, and the date held is when the file was added here, which is a different fact',
    },
  ],
};

export const investorZoneFilters = makeZoneFilters(INVESTOR_ZONE_FILTERS);
