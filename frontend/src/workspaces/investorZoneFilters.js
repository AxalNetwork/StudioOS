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
};

export const investorZoneFilters = makeZoneFilters(INVESTOR_ZONE_FILTERS);
