import { makeZoneActions } from './zoneActionBuilder';

/**
 * The investor profile's nineteen zones, and what each of their canvas actions
 * actually does. `zoneActionBuilder.js` states the three outcomes and the rules
 * they follow; this file is the investor's answers.
 *
 * THE FIGURES IN THIS DOCBLOCK WERE WRONG IN FOUR PLACES AND ARE RECOUNTED FROM
 * THE FILE. It said fourteen zones and forty-two actions when there were
 * seventeen and fifty-one, and "nine run" when thirteen did. Prose that counts
 * something drifts the moment the thing it counts grows, which is why the two
 * figures a reader might act on — how many links, how many exports — are
 * asserted in `profile_zone_actions.test.mjs` rather than left here.
 *
 * WHAT THIS PASS FOUND, AND THE DISTINCTION IT TOOK A SECOND LOOK TO GET RIGHT.
 * Thirteen of these fifty-seven actions run today, and the Deals and Fund gaps
 * are not all the same kind of gap. The SCREENS are read-only —
 * `InvestorDealsWorkspace` calls `listDeals` and two invitation methods,
 * `FundOpsWorkspace` calls `capitalCalls` and `fundsLpPortal`, and
 * `InvestorFundCalls` and `InvestorFundAccounting` call no API at all. But
 * "read-only screen" is not "no such capability", and two of these labels are
 * exactly that difference: `api.fundAddLP` and `api.fundCapitalCall` both exist
 * and both reach a worker route that serves them (`funds.ts` declares
 * `post('/:id/lps')` and `post('/:id/capital-call')`). What is missing there is
 * a form, not a store.
 *
 * The first version of these two notes said "nothing writes an LP" and "never
 * issued", which was read off the page's imports without following the chain to
 * `api.js` — the same one-step-short reading this whole pass exists to catch,
 * committed inside it. They now say where the gap actually is, because a reader
 * deciding what to build next needs to know it is an afternoon of form rather
 * than a migration. `frontend/test/profile_zone_actions.test.mjs` ties both
 * notes to those two API methods, so if either is removed the note stops being
 * true in the other direction and the build says so.
 *
 * The other ten are gaps in the store as well as the screen: no rubric, no
 * minutes, no conditions, no wire record, no journal source, no reconciliation
 * state. "Configure stages" is one of those — `advanceDeal` moves ONE deal
 * between stages, and the label asks to edit the stage SET, which nothing
 * stores.
 *
 * THE SAME LABEL IS NOT THE SAME ANSWER ACROSS PROFILES. `/network/*` serves
 * every licence and the investor artboard's ops are word-for-word the founder's
 * — but `/matches`, where `introductionsRequest` lives, is guarded
 * `['admin', 'partner', 'investor']`. So "Request an intro" is a working link
 * here and a stated gap on the founder's identical zone. That is exactly why
 * the tables are per profile and only the builder is shared.
 *
 * THE CANVAS'S FUND ROUTES ARE NOT THE LIVE ONES. `Pages · Investor Fund` names
 * `/fund/lps`, `/fund/calls`, `/fund/accounting`, `/fund/reporting`. The router
 * mounts `/funds/lps`, `/funds/calls`, `/funds/ledger`, `/funds/reporting`, and
 * `shellConfig.js` agrees with the router. The keys below are the live routes,
 * and `frontend/test/profile_zone_actions.test.mjs` carries the mapping explicitly
 * rather than silently matching a canvas route to a page that is not at it.
 */

export const INVESTOR_ZONE_ACTIONS = {
  // ── Deals ────────────────────────────────────────────────────────────────
  'deals/pipeline': [
    { label: 'Configure stages', unbuilt: 'the columns are the deal record’s stored status and are not editable' },
    { label: 'Save view', unbuilt: 'filters reset between visits; no saved view is stored' },
    { label: 'Export', kind: 'export' },
  ],
  'deals/screening': [
    { label: 'New batch run', unbuilt: 'no scoring run is stored — this desk reads the deal record' },
    { label: 'Edit rubric', unbuilt: 'no rubric is stored' },
    { label: 'Export', kind: 'export' },
  ],
  'deals/commit': [
    { label: 'Export minutes', unbuilt: 'no vote minutes are stored to export' },
    { label: 'Add condition', unbuilt: 'conditions are not a stored record' },
    { label: 'Close vote', unbuilt: 'no vote is opened here, so none can be closed' },
  ],
  'deals/closing': [
    { label: 'Apply template', unbuilt: 'no closing templates are stored' },
    { label: 'Export packet', unbuilt: 'no closing packet is assembled from these records' },
    { label: 'Record wire', unbuilt: 'wires are not a stored record' },
  ],

  // ── Fund ─────────────────────────────────────────────────────────────────
  'funds/lps': [
    { label: 'Add LP', unbuilt: 'adding an LP is served by the API; no screen offers the form yet' },
    { label: 'Export register', kind: 'export' },
    { label: 'Comms log', unbuilt: 'no LP correspondence is stored' },
  ],
  'funds/calls': [
    { label: 'New call', unbuilt: 'issuing a call is served by the API; no screen offers the form yet' },
    { label: 'Send reminders', unbuilt: 'nothing on this desk sends mail' },
    { label: 'Export wires', unbuilt: 'no wire schedule is stored to export' },
  ],
  'funds/ledger': [
    { label: 'Export journal', unbuilt: 'no journal source is connected to this desk' },
    { label: 'Reconcile', unbuilt: 'no reconciliation state is stored' },
    { label: 'Period close', unbuilt: 'periods are not opened or closed from here' },
  ],
  'funds/reporting': [
    { label: 'Build pack', unbuilt: 'report packs are not assembled from this desk' },
    { label: 'Export archive', kind: 'export' },
    { label: 'Delivery log', unbuilt: 'per-LP delivery is counted, never itemised' },
  ],

  // ── Portfolio ────────────────────────────────────────────────────────────
  'portfolio/positions': [
    { label: 'Export', kind: 'export' },
    { label: 'Mark history', unbuilt: 'only the current mark is stored; there is no history to open' },
    { label: 'Add follow-on', unbuilt: 'follow-ons are recorded on the deal, not from the ledger' },
  ],
  'portfolio/updates': [
    { label: 'Chase all overdue', unbuilt: 'nothing on this desk sends mail' },
    { label: 'Edit rules', unbuilt: 'no reminder rules are stored' },
    { label: 'Export', kind: 'export' },
  ],
  'portfolio/value-add': [
    { label: 'Log support', unbuilt: 'no support ledger exists to write to' },
    { label: 'Export', unbuilt: 'there is no support history to export' },
    { label: 'Per-company view', unbuilt: 'a company is never counted as supported from the position book alone' },
  ],

  // ── Network ──────────────────────────────────────────────────────────────
  'network/relationships': [
    { label: 'Add person', unbuilt: 'the contact form is not reachable from the investor Network desk' },
    { label: 'Set reminders', unbuilt: 'no reminder store exists' },
    { label: 'Export', kind: 'export' },
  ],
  'network/introductions': [
    { label: 'Request an intro', to: '/matches' },
    { label: 'Offer one', unbuilt: 'offering an introduction is not built' },
    { label: 'Export', kind: 'export' },
  ],
  // THE DERIVATION NAMED HERE PRODUCES NOTHING, which the filter half of this
  // row establishes: a relationship stores two account ids, a type and a
  // free-text `metadata` blob, and the only writer in the product sends
  // `{partner_id, relationship_type, strength_score}` — no organisation, ever.
  // "Derived from the relationship book" was true and incomplete; the book has
  // no organisation to derive one from.
  'network/organizations': [
    { label: 'Add org', unbuilt: 'a relationship records two accounts, a type and a strength, and nothing on it names a firm, so there is no org for a form to add' },
    { label: 'Merge duplicates', unbuilt: 'no organisation is stored on a relationship, so the list above is empty on every account and has no duplicates to merge' },
    { label: 'Export', kind: 'export' },
  ],

  // ── Research ─────────────────────────────────────────────────────────────
  'research/ask': [
    { label: 'New brief', unbuilt: 'the question box below starts one' },
    { label: 'Export session', kind: 'export' },
    { label: 'Clear history', unbuilt: 'no session history is stored to clear' },
  ],
  // Both of these zones have had a real body since the research stores landed,
  // and both were calling `zoneActionsFor` all along — with no key here, so
  // `makeZoneActions` returned `[]` and `ZoneActions` rendered nothing. Three
  // specified actions each, an empty row on screen, and a test excluding them
  // for a reason that had stopped being true. The gap was shipped, not deferred.
  'research/diligence': [
    // The zone's own StatedLimit argues this one, and the note says the same
    // thing it does: "a request button that wrote nowhere would be worse than
    // the conversation it replaced."
    { label: 'New request', unbuilt: 'a founder opens a room; nothing here asks one to, and a button that wrote nowhere would replace the conversation that does' },
    { label: 'Attach to deal', unbuilt: 'nothing links a room grant to a deal record' },
    { label: 'Export', kind: 'export' },
  ],
  'research/benchmarking': [
    { label: 'New benchmark', unbuilt: 'the add-a-metric form below takes one, with its source and sample size' },
    { label: 'Change peer set', unbuilt: 'a peer source is recorded per row, so there is no one set to switch' },
    // Not an export. The zone renders comparisons as rows precisely so each
    // carries the base it rests on; a chart is the shape that detaches a figure
    // from its sample size, which is the thing this zone exists to refuse.
    { label: 'Export chart', unbuilt: 'no chart is drawn here — each comparison is a row carrying the base it rests on' },
  ],
  'research/markets': [
    { label: 'New deep-dive', unbuilt: 'signals are gathered on a schedule, not started here' },
    { label: 'Export', kind: 'export' },
    { label: 'Cite in a memo', unbuilt: 'nothing carries a signal into a memo' },
  ],
  'research/library': [
    { label: 'Upload', unbuilt: 'the add-document form below takes a file or a link' },
    { label: 'New collection', unbuilt: 'collections are not stored' },
    { label: 'Export', kind: 'export' },
  ],
};

export const investorZoneActions = makeZoneActions(INVESTOR_ZONE_ACTIONS);
