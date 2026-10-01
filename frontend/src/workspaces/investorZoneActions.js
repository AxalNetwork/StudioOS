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
    { label: 'Record wire', kind: 'handler', handler: 'recordWire' },
  ],

  // ── Fund ─────────────────────────────────────────────────────────────────
  'funds/lps': [
    // Same shape as `Close vote` above, and it was true the same way:
    // `POST /api/funds/:id/lps` inserts a real `limited_partners` row, and the
    // register on this very page reads it straight back. Only the form was
    // missing. `requireFundGp` gates it — institutional tier AND the GP of
    // record for this fund — so the page disables it when no fund is readable
    // rather than posting into a 404.
    { label: 'Add LP', kind: 'handler', handler: 'addLp' },
    { label: 'Export register', kind: 'export' },
    { label: 'Comms log', unbuilt: 'no LP correspondence is stored' },
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
    { label: 'New call', kind: 'handler', handler: 'newCall' },
    // A reason still, and a narrower one than "nothing on this desk sends
    // mail": a notice is logged per LP account when a call is issued, and the
    // overdue lines are listed on the page. What nobody builds is the chase.
    { label: 'Send reminders', unbuilt: 'a notice is logged per LP account when a call is issued, but no reminder is drafted or sent for an overdue line from this desk', hover: 'Overdue lines are listed here; sending a reminder is not built yet.' },
    // Was "no wire schedule is stored to export" — true until migration 312's
    // receipts. It exports the wire trail the page shows.
    { label: 'Export wires', kind: 'export' },
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
    { label: 'Add follow-on', unbuilt: 'a follow-on is a round on the position itself, and recording one is an admin write — this book is the investor’s read of it', hover: 'A follow-on is recorded as an admin write; this book is the investor’s read of it.' },
  ],
  'portfolio/updates': [
    // LIVE WITH D464 (migration 337). The old reason was right when written —
    // the only outbound on this desk fired when an update ARRIVED — and the
    // chase is the other direction: the page hands the route its own overdue
    // set, the route re-checks the tenancy of each id, logs one row per
    // company, and notifies the founder. The notification type's settings row
    // is Session 4's to add.
    { label: 'Chase all overdue', kind: 'handler', handler: 'chaseOverdue' },
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
    { label: 'Log support', kind: 'handler', handler: 'logSupport' },
    { label: 'Export', kind: 'export' },
    { label: 'Per-company view', kind: 'handler', handler: 'byCompany' },
  ],

  // ── Network ──────────────────────────────────────────────────────────────
  'network/relationships': [
    { label: 'Add person', unbuilt: 'the contact form is not reachable from the investor Network desk' },
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
    { label: 'Add org', unbuilt: 'a relationship records two accounts, a type and a strength, and nothing on it names a firm, so there is no org for a form to add', hover: 'A relationship records two accounts, a type and a strength — nothing on it names a firm.' },
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
    { label: 'Clear history', unbuilt: 'the history is stored now and nothing deletes from it — an answer is kept or not kept, and erasing a reader’s own questions is the one irreversible act this page declines to offer', hover: 'Nothing deletes from the history; an answer is kept or it is not.' },
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
    { label: 'New request', unbuilt: 'a founder opens a room; nothing here asks one to, and a button that wrote nowhere would replace the conversation that does', hover: 'A founder opens a data room; nothing here can ask one to.' },
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
    { label: 'New deep-dive', unbuilt: 'a sector opens its own profile; nothing here starts a separate deep-dive' },
    { label: 'Export', kind: 'export' },
    { label: 'Cite in a memo', unbuilt: 'nothing carries a sector into a memo' },
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
