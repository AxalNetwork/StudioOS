import { makeZoneActions } from './zoneActionBuilder';

/**
 * The investor profile's fourteen zones, and what each of their canvas actions
 * actually does. `zoneActionBuilder.js` states the three outcomes and the rules
 * they follow; this file is the investor's answers.
 *
 * WHAT THIS PASS FOUND, AND IT IS THE POINT RATHER THAN AN EMBARRASSMENT. Nine
 * of these forty-two actions run today. Deals and Fund are read-only shells —
 * `InvestorDealsWorkspace` calls `listDeals` and two invitation methods and
 * nothing else; `FundOpsWorkspace` calls `capitalCalls` and `fundsLpPortal` and
 * nothing else; `InvestorFundCalls` and `InvestorFundAccounting` call no API at
 * all. So "New call", "Add LP", "Record wire", "Close vote" and the rest have
 * no flow anywhere to link to, and every one of them says so instead of drawing
 * a button. A header full of working buttons would be a lie about a bucket that
 * cannot yet be operated; this is the map of what to build next.
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
    { label: 'Configure stages', note: 'the columns are the deal record’s stored status and are not editable' },
    { label: 'Save view', note: 'filters reset between visits; no saved view is stored' },
    { label: 'Export', kind: 'export' },
  ],
  'deals/screening': [
    { label: 'New batch run', note: 'no scoring run is stored — this desk reads the deal record' },
    { label: 'Edit rubric', note: 'no rubric is stored' },
    { label: 'Export', kind: 'export' },
  ],
  'deals/commit': [
    { label: 'Export minutes', note: 'no vote minutes are stored to export' },
    { label: 'Add condition', note: 'conditions are not a stored record' },
    { label: 'Close vote', note: 'no vote is opened here, so none can be closed' },
  ],
  'deals/closing': [
    { label: 'Apply template', note: 'no closing templates are stored' },
    { label: 'Export packet', note: 'no closing packet is assembled from these records' },
    { label: 'Record wire', note: 'wires are not a stored record' },
  ],

  // ── Fund ─────────────────────────────────────────────────────────────────
  'funds/lps': [
    { label: 'Add LP', note: 'the fund workspace reads the register; nothing writes an LP' },
    { label: 'Export register', kind: 'export' },
    { label: 'Comms log', note: 'no LP correspondence is stored' },
  ],
  'funds/calls': [
    { label: 'New call', note: 'capital calls are read here, never issued' },
    { label: 'Send reminders', note: 'nothing on this desk sends mail' },
    { label: 'Export wires', note: 'no wire schedule is stored to export' },
  ],
  'funds/ledger': [
    { label: 'Export journal', note: 'no journal source is connected to this desk' },
    { label: 'Reconcile', note: 'no reconciliation state is stored' },
    { label: 'Period close', note: 'periods are not opened or closed from here' },
  ],
  'funds/reporting': [
    { label: 'Build pack', note: 'report packs are not assembled from this desk' },
    { label: 'Export archive', kind: 'export' },
    { label: 'Delivery log', note: 'per-LP delivery is counted, never itemised' },
  ],

  // ── Portfolio ────────────────────────────────────────────────────────────
  'portfolio/positions': [
    { label: 'Export', kind: 'export' },
    { label: 'Mark history', note: 'only the current mark is stored; there is no history to open' },
    { label: 'Add follow-on', note: 'follow-ons are recorded on the deal, not from the ledger' },
  ],
  'portfolio/updates': [
    { label: 'Chase all overdue', note: 'nothing on this desk sends mail' },
    { label: 'Edit rules', note: 'no reminder rules are stored' },
    { label: 'Export', kind: 'export' },
  ],
  'portfolio/value-add': [
    { label: 'Log support', note: 'no support ledger exists to write to' },
    { label: 'Export', note: 'there is no support history to export' },
    { label: 'Per-company view', note: 'a company is never counted as supported from the position book alone' },
  ],

  // ── Network ──────────────────────────────────────────────────────────────
  'network/relationships': [
    { label: 'Add person', note: 'the contact form is not reachable from the investor Network desk' },
    { label: 'Set reminders', note: 'no reminder store exists' },
    { label: 'Export', kind: 'export' },
  ],
  'network/introductions': [
    { label: 'Request an intro', to: '/matches' },
    { label: 'Offer one', note: 'offering an introduction is not built' },
    { label: 'Export', kind: 'export' },
  ],
  'network/organizations': [
    { label: 'Add org', note: 'the contact form is not reachable from the investor Network desk' },
    { label: 'Merge duplicates', note: 'organizations are derived from the relationship book, so there is nothing to merge' },
    { label: 'Export', kind: 'export' },
  ],

  // ── Research ─────────────────────────────────────────────────────────────
  'research/ask': [
    { label: 'New brief', note: 'the question box below starts one' },
    { label: 'Export session', kind: 'export' },
    { label: 'Clear history', note: 'no session history is stored to clear' },
  ],
  'research/markets': [
    { label: 'New deep-dive', note: 'signals are gathered on a schedule, not started here' },
    { label: 'Export', kind: 'export' },
    { label: 'Cite in a memo', note: 'nothing carries a signal into a memo' },
  ],
  'research/library': [
    { label: 'Upload', note: 'the add-document form below takes a file or a link' },
    { label: 'New collection', note: 'collections are not stored' },
    { label: 'Export', kind: 'export' },
  ],
};

export const investorZoneActions = makeZoneActions(INVESTOR_ZONE_ACTIONS);
