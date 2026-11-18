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
 * Fund Ops (retired by D1160) called `capitalCalls` and `fundsLpPortal`, and
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
 * — but a route one licence may open can be closed to another. "Request an
 * intro" was the example: a working link to `/matches` here and a stated gap
 * on the founder's identical zone. `/matches` has since been removed, so it
 * is a gap on both. That is exactly why the tables are per profile and only
 * the builder is shared.
 *
 * THE CANVAS'S FUND ROUTES ARE NOT THE LIVE ONES. `Pages · Investor Fund` names
 * `/fund/lps`, `/fund/calls`, `/fund/accounting`, `/fund/reporting`. The router
 * mounts `/funds/lps`, `/funds/calls`, `/funds/ledger`, `/funds/reporting`, and
 * `shellConfig.js` agrees with the router. The keys below are the live routes,
 * and `frontend/test/profile_zone_actions.test.mjs` carries the mapping explicitly
 * rather than silently matching a canvas route to a page that is not at it.
 *
 * `primary: true` (D1424, #3700) marks the one row a zone's header draws
 * filled, in indigo: Closing's Record wire, Reports' Chase all overdue,
 * Value-add's Log support, LPs' Add LP, Calls' New call, Reporting's New
 * reporting period (#6230) and Research › Ask's New brief. Screening, Commit,
 * Positions, Accounting and the Network zones have no live first step, so no
 * primary. Deal flow (the Deals
 * root) has no table: its "Set your thesis" primary is drawn by `DealFlow`
 * while no deal matches (owner answer C).
 */

export const INVESTOR_ZONE_ACTIONS = {
  // ── Deals ────────────────────────────────────────────────────────────────
  // D1243 (#3256): `deals/pipeline` is gone with its zone. Its three ops are
  // Deal flow's now, and built: the firm's own stages (D1238), Save view
  // with a name, kept per person or shared with the firm (D1239, D1240), and
  // the table's export. None of them is declared here any more.
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
    // D1260 (#3283): New batch run and Edit rubric were the Lab scorer's. The
    // scorecard scores every venture from its records and recomputes on its
    // own; each investor's weighting is Deal flow's "Your weighting".
    { label: 'New batch run', unbuilt: 'the venture scorecard recomputes each venture from its own records, so there is no run to start; the Lab scorer this desk used to show is practice and its runs are not shown to investors', hover: 'Scorecards recompute on their own. There is nothing to run.' },
    { label: 'Edit rubric', unbuilt: 'the eleven scopes and their weights are the published model, fixed in code; each investor’s own weighting is chosen in Deal flow’s Your weighting dialog', hover: 'The model is fixed. Your own weighting is on Deal flow.' },
    { label: 'Export', kind: 'export' },
  ],
  'deals/commit': [
    // BOTH WENT LIVE WITH D461 (migration 334). Minutes live on the meeting
    // linked to the deal — the export writes what was recorded and the page
    // disables it, with the reason, when nothing has been. A condition is its
    // own row on the decision, and an open one is what Closing blocks on.
    { label: 'Export minutes', kind: 'handler', handler: 'exportMinutes' },
    { label: 'Add condition', kind: 'handler', handler: 'addCondition' },
    // THE SCREEN THIS ROW WAS WAITING FOR. It said, correctly, that closing a
    // vote is served by the API — `PUT /api/ic/:uid` with a `decision` forces
    // `decided` and stamps `decided_at` — and that no screen offered the form.
    // `CommitZone` offers it now, so the op is the page's.
    //
    // IT IS SUPPLIED CONDITIONALLY, WHICH IS THE POINT. The route admits the
    // decision's author and an admin and refuses a colleague with a 403. So
    // the page hands back `{ onClick, disabled, title }` rather than a bare
    // function, and a partner who cannot close this one reads why on hover
    // instead of learning it from a failed request.
    { label: 'Close vote', kind: 'handler', handler: 'closeVote' },
  ],
  'deals/closing': [
    // ALL THREE WENT LIVE WITH D462 (migration 335). The checklist store is
    // what the closing templates were always waiting on; the packet is the
    // index of executed envelopes the page already reads; and deal_transfers
    // records the wire OUT — the direction capital_calls never covered. An
    // open Commit condition refuses the transfer (409), which is the
    // conditions store doing its job.
    { label: 'Apply template', kind: 'handler', handler: 'applyTemplate' },
    { label: 'Export packet', kind: 'handler', handler: 'exportPacket' },
    { label: 'Record wire', kind: 'handler', handler: 'recordWire', primary: true },
  ],

  // ── Fund ─────────────────────────────────────────────────────────────────
  'funds/lps': [
    // Same shape as `Close vote` above, and it was true the same way:
    // `POST /api/funds/:id/lps` inserts a real `limited_partners` row, and the
    // register on this very page reads it straight back. Only the form was
    // missing. `requireFundGp` gates it — institutional tier AND the GP of
    // record for this fund — so the page disables it when no fund is readable
    // rather than posting into a 404.
    { label: 'Add LP', kind: 'handler', handler: 'addLp', primary: true },
    { label: 'Export register', kind: 'export' },
    // #6232: was unbuilt, 'no LP correspondence is stored', false since D553
    // (migration 387): the log is stored, and drawn on this page. The op takes
    // the reader to it.
    { label: 'Comms log', kind: 'handler', handler: 'commsLog' },
  ],
  'funds/calls': [
    // THE GAP MOVED THREE TIMES, AND THE LAST MOVE CLOSED IT (D371).
    //
    // It first said a form was missing, which was wrong: `POST
    // /api/funds/:id/capital-call` enqueued a job that wrote no `capital_calls`
    // row. Task 197 built the ledger rows, which made "a form away from
    // working" true again. Migration 312 then gave a call a header, a number,
    // an exact cents split and receipts, and the Calls page is the form: New
    // call previews the split and issues it.
    { label: 'New call', kind: 'handler', handler: 'newCall', primary: true },
    // D6238 (#6238): live. It opens the call's chase: one Eadwyn reminder
    // draft per line behind (the `funds/calls` surface), each logged as sent
    // only when the GP confirms it on that line. The product sends nothing;
    // the GP sends each reminder themselves.
    { label: 'Send reminders', kind: 'handler', handler: 'sendReminders' },
    // Was "no wire schedule is stored to export" — true until migration 312's
    // receipts. It exports the wire trail the page shows.
    { label: 'Export wires', kind: 'export' },
  ],
  'funds/ledger': [
    { label: 'Export journal', unbuilt: 'journal export is not available on this read-only page' },
    { label: 'Reconcile', unbuilt: 'this read-only page has no reconciliation form' },
    { label: 'Period close', unbuilt: 'periods are not opened or closed from here' },
  ],
  'funds/reporting': [
    // #6230: `Build pack` said packs were not assembled from this desk, while
    // `FundReportPeriodPage` at `/funds/:fundId/reporting/new` drafts and issues
    // one. The page supplies the handler only for a fund the member operates
    // (`can_manage`, the Worker's own `requireFundGp` test); without one the
    // action is absent and the archive says why.
    { canvas: 'Build pack', label: 'New reporting period', kind: 'handler', handler: 'newPeriod', primary: true },
    { label: 'Export archive', kind: 'export' },
    // Was 'per-LP delivery is counted, never itemised'. Nothing counts it: a
    // period records when it was issued, and no delivery row exists.
    { label: 'Delivery log', unbuilt: 'issuing a period records when it was issued, not which LP received it, so there is no delivery to log' },
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
    // REMOVED (D6205, #6205): 'Add follow-on'. Recording a round is an admin
    // write (POST /positions), so on the investor's book the button could
    // never be enabled. The investor's act is to ask: the mark-history Sheet's
    // Ask HQ sends a follow-on request (`routes/mark_requests.ts`), and that is
    // where the book offers it.
  ],
  'portfolio/updates': [
    // LIVE WITH D464 (migration 337). The old reason was right when written —
    // the only outbound on this desk fired when an update ARRIVED — and the
    // chase is the other direction: the page hands the route its own overdue
    // set, the route re-checks the tenancy of each id, logs one row per
    // company, and notifies the founder. The notification type's settings row
    // is Session 4's to add.
    { label: 'Chase all overdue', kind: 'handler', handler: 'chaseOverdue', primary: true },
    // WAS 'no reminder rules are stored', which is true and describes a
    // different object. The rules this desk actually has are the KPI
    // definitions companies are held to, and they ARE stored — firm-wide,
    // with no per-firm write path exposed. The Rules chip shows them; nothing
    // edits them.
    { label: 'Edit rules', unbuilt: 'the KPI set companies are held to is stored firm-wide and read-only here; no per-firm rule is kept for this book to edit' },
    { label: 'Export', kind: 'export' },
  ],
  // THE ONLY ROW IN THIS FILE WHOSE REASONS WERE ALL TRUE. Checked the same way
  // as the five before it — read the schema, not the sentence — and there was
  // genuinely no store: `investor_introductions` is an investor REQUESTING an
  // intro to a founder against a paid quota, and `_investorProjectScope` unions
  // it with dealroom membership to decide what an investor may SEE.
  // `intro_propositions` and `intro_credit_ledger` are the peer matching
  // engine. `engagement_hours` belongs to a partner's PAID delivery. Reading
  // any of them as value-add would relabel access, matching or billed work as
  // support given.
  //
  // So migration 237 builds the ledger, and all three ops become real. The
  // third one is the artboard's own duplicate of the `By company` chip: one
  // view, reachable from either half of the header row.
  'portfolio/value-add': [
    { label: 'Log support', kind: 'handler', handler: 'logSupport', primary: true },
    { label: 'Export', kind: 'export' },
    { label: 'Per-company view', kind: 'handler', handler: 'byCompany' },
  ],

  // ── Network ──────────────────────────────────────────────────────────────
  'network/relationships': [
    // D6636 / D6263 Q7: select an existing shared-resource person; D493 consent still applies.
    { label: 'Add person', kind: 'handler', handler: 'addPerson' },
    // LIVE WITH D465 (migration 338): `partner_reminders` is the store, and a
    // reminder surfaces on the desk when it is due — no notification fan-out.
    { label: 'Set reminders', kind: 'handler', handler: 'setReminders' },
    { label: 'Export', kind: 'export' },
  ],
  'network/introductions': [
    // WAS a link to /matches, whose deal cards carried the only button that
    // called `introductionsRequest`. The AI Matching Engine was removed, the
    // button with it, and nothing else asks for an intro.
    { label: 'Request an intro', unbuilt: 'no screen requests an introduction since the AI Matches page was removed' },
    // D6637 / D6263 Q8: offer between two accepted ties through existing propositions.
    { label: 'Offer one', kind: 'handler', handler: 'offerIntroduction' },
    { label: 'Export', kind: 'export' },
  ],
  // D6258: the list is derived from the relationship book, and since D572
  // part 3 the book carries each counterpart's own company (`other.company`,
  // the company they link on their account). So the list is real, and both
  // ops stay held for what that source is: a company here belongs to the other
  // person's account, so this page cannot add one, and two entries with the
  // same name are already one entry, while two spellings are two companies
  // that only their own members can rename.
  'network/organizations': [
    { label: 'Add org', unbuilt: 'an organisation here is the company the other person links on their own account; nothing on this page can add one for them', hover: 'Each person links their own company on their account.' },
    { label: 'Merge duplicates', unbuilt: 'the list groups ties by the company name each person links, so one name is already one entry; two spellings are two companies, renamed only by their own members', hover: 'Companies with the same name are already one entry.' },
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
  // `Clear history` IS LIVE, AND IT STILL ERASES NOTHING. "No session history
  // is stored to clear" stopped being true with the same migration; the owner
  // then chose hide over delete (D6272, #6274 question 4 B), so the one
  // irreversible act this page declined to offer is still not offered.
  'research/ask': [
    { label: 'New brief', kind: 'handler', handler: 'newSession', primary: true },
    { label: 'Export session', kind: 'export' },
    // D6272: BUILT TO THE OWNER'S ANSWER (#6274, question 4 B). Clearing
    // HIDES the caller's sessions (`cleared_at`) and deletes nothing; the
    // `Show cleared` filter reads them back and offers Restore. The question
    // this row cited to #1023 (closed) is answered, so no note remains.
    { label: 'Clear history', kind: 'handler', handler: 'clearHistory' },
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
    // Data-room requests live on the deal’s Documents tab; this list shows granted rooms.
    { label: 'New request', unbuilt: 'a room is asked for on its deal: open the deal, then Documents, then Ask for access. The founder decides, and you get a notice either way', hover: 'Ask for a data room from the deal’s Documents tab.' },
    // D6266: a room already shows the deals on its company that you may open; there is nothing to attach by hand.
    { label: 'Attach to deal', unbuilt: 'a room shows the deals on its company that you are invited to or committed on, with their stage and a link; there is nothing to attach by hand', hover: 'Each room already shows its deal when you are invited to it.' },
    { label: 'Export', kind: 'export' },
  ],
  'research/benchmarking': [
    { label: 'New benchmark', kind: 'handler', handler: 'newBenchmark' },
    { label: 'Change peer set', unbuilt: 'a peer source is recorded per row, so there is no one set to switch' },
    // Not an export. The zone renders comparisons as rows precisely so each
    // carries the base it rests on; a chart is the shape that detaches a figure
    // from its sample size, which is the thing this zone exists to refuse.
    { label: 'Export chart', unbuilt: 'no chart is drawn here — each comparison is a row carrying the base it rests on' },
    { label: 'Export', kind: 'export' },
  ],
  'research/markets': [
    { label: 'New deep-dive', unbuilt: 'a sector opens its own profile; nothing here starts a separate deep-dive' },
    { label: 'Export', kind: 'export' },
    { label: 'Cite in a memo', unbuilt: 'nothing carries a sector into a memo' },
  ],
  // `Upload` IS THIS LICENCE'S WORD FOR THE SAME OP advisor and partner call
  // `Add document`, and it opens the same file picker. It was
  // `unbuilt: 'the add-document form below takes a file or a link'` — true of
  // the form, never true of the op.
  //
  // D549: New collection opens the owned Library collection form.
  'research/library': [
    { label: 'Upload', kind: 'handler', handler: 'addDocument' },
    { label: 'New collection', kind: 'handler', handler: 'newCollection' },
    { label: 'Export', kind: 'export' },
  ],
};

export const investorZoneActions = makeZoneActions(INVESTOR_ZONE_ACTIONS, 'investor');
