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
  // TWO OF THESE REASONS WERE FALSE, and canvas ID2 is what found it. They
  // said no scoring run and no rubric were stored. `score_snapshots` is a
  // stored scoring run with SIX dimensions — market, team, product, capital,
  // fit, distribution — each with its sub-scores and a total, plus
  // `anomaly_flags` and `admin_review_status`, which is a red-flag store under
  // another name. `POST /api/scoring/score` writes one and locks it.
  //
  // What is actually missing is narrower and is now said accurately: a run is
  // started against ONE project and nothing batches it, and the WEIGHTS are
  // fixed in code with no per-firm store to edit. An unbuilt reason that
  // overstates the gap is as misleading as a control that does nothing — it
  // tells the next reader not to look.
  'deals/screening': [
    { label: 'New batch run', unbuilt: 'scoring runs are stored, but a run is started against one project — nothing batches them' },
    { label: 'Edit rubric', unbuilt: 'the six dimensions are real and their weights are fixed in code; no per-firm rubric is stored to edit' },
    { label: 'Export', kind: 'export' },
  ],
  'deals/commit': [
    { label: 'Export minutes', unbuilt: 'no minutes are stored to export; ic_meetings carries an agenda, written before the room rather than after it' },
    { label: 'Add condition', unbuilt: 'conditions are not a stored record — the memo and terms are free text, and neither can block a later stage' },
    // WAS: 'no vote is opened here, so none can be closed'. False — a vote
    // opens when the first one is cast (POST /api/ic/:uid/vote moves draft →
    // voting) and closes when a decision is set (PUT /api/ic/:uid forces
    // decided and stamps decided_at). What is missing is the screen, which is
    // the same shape as the LP row below: served, not offered.
    { label: 'Close vote', unbuilt: 'closing a vote is served by the API — recording a decision against it moves it to decided — but no screen offers the form yet' },
  ],
  'deals/closing': [
    // WAS: 'no closing templates are stored'. False — legal_templates ships the
    // SAFE, stock-purchase and subscription agreements with merge fields and
    // versions. The gap is one layer above them: nothing stores a closing
    // CHECKLIST for a template to be applied to.
    { label: 'Apply template', unbuilt: 'the SAFE, stock-purchase and subscription templates are stored; what is missing is a closing checklist for one to be applied to' },
    { label: 'Export packet', unbuilt: 'the documents and signature envelopes are stored, but nothing assembles them into a packet' },
    // WAS: 'wires are not a stored record'. True, and imprecise enough to cost
    // the next reader a lookup — capital_calls DOES carry an amount and a paid
    // date. It is the other direction.
    { label: 'Record wire', unbuilt: 'no transfer OUT to a company is recorded; capital_calls is an LP paying into the fund, which is the other direction' },
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
    // WAS: 'only the current mark is stored; there is no history to open'.
    // False twice. `portfolio_marks` is a history table — one row per marking
    // event with the date it speaks for, the event behind it, the basis it was
    // arrived at on and its provenance — and `GET /positions/:projectUid` was
    // ALREADY returning that history to the same readers looking at this
    // disabled button. It opens now.
    { label: 'Mark history', kind: 'handler', handler: 'markHistory' },
    // WAS: 'follow-ons are recorded on the deal, not from the ledger', which
    // has the modelling backwards — a follow-on IS a ledger row
    // (`portfolio_positions.round_name`, one per round) and POST /positions
    // creates it. What is true is that the write is admin-only, so an
    // investor's book does not offer it.
    { label: 'Add follow-on', unbuilt: 'a follow-on is a round on the position itself, and recording one is an admin write — this book is the investor’s read of it' },
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
  // `New brief` STARTS A THREAD, and the label is the artboard's own. A brief
  // on this licence is what a line of questions produces — the closing band is
  // `Draft · session brief` — so beginning a new one is beginning a new
  // session, which is the act migration 221 made possible. It was
  // `unbuilt: 'the question box below starts one'`: true of the box, and never
  // true of the op, since a box that always appends to one thread cannot start
  // a second.
  //
  // `Clear history` KEEPS A NOTE, AND IT IS A DIFFERENT NOTE. "No session
  // history is stored to clear" stopped being true with the same migration —
  // but what replaced it is not a clear button. Nothing deletes an answer,
  // deliberately: kept-or-not-kept is the only bit the ops row writes, and
  // erasing a reader's own questions is the one irreversible act on this page.
  // The reason is now about the refusal rather than about an absent store.
  'research/ask': [
    { label: 'New brief', kind: 'handler', handler: 'newSession' },
    { label: 'Export session', kind: 'export' },
    { label: 'Clear history', unbuilt: 'the history is stored now and nothing deletes from it — an answer is kept or not kept, and erasing a reader’s own questions is the one irreversible act this page declines to offer' },
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
  // `Upload` IS THIS LICENCE'S WORD FOR THE SAME OP advisor and partner call
  // `Add document`, and it opens the same file picker. It was
  // `unbuilt: 'the add-document form below takes a file or a link'` — true of
  // the form, never true of the op.
  //
  // `New collection` KEEPS ITS NOTE. Collections are still not stored, and
  // nothing in migration 221 or the library's own store changed that: a
  // collection is a grouping of documents and there is no table for one.
  'research/library': [
    { label: 'Upload', kind: 'handler', handler: 'addDocument' },
    { label: 'New collection', unbuilt: 'collections are not stored' },
    { label: 'Export', kind: 'export' },
  ],
};

export const investorZoneActions = makeZoneActions(INVESTOR_ZONE_ACTIONS);
