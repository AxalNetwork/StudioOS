import { makeZoneActions } from './zoneActionBuilder';

/**
 * The advisor profile's four Expertise zones, and what each of their canvas
 * actions actually does. `zoneActionBuilder.js` states the three outcomes and
 * the rules they follow; this file is the advisor's answers.
 *
 * FOUR ZONES WAS THE WHOLE ADVISOR SCOPE WHEN THIS WAS WRITTEN, and the
 * paragraph that stood here said Practice could never grow any — that
 * `Advisor Detail · Practice` was "a rendered export with no header actions on
 * any artboard". That was true of the `ops:` ARRAY the Expertise canvas
 * carries and false of the artboards themselves: PR1 through PR4 each draw
 * their operations as `<span class="bulk">` in the frame, which is the same
 * instruction in different markup. Four of the five Practice zones have
 * entries below because their artboards ask for them.
 *
 * `Advisor Canvas` and the backlog `Pages · Advisor Cohorts` still carry
 * nothing to copy, and inventing actions for them is the failure this pass
 * exists to avoid. `/network` and `/research` are the shared surfaces every
 * profile defers.
 *
 * `expertise/visibility` IS THE FIFTH ARTBOARD AND IS DELIBERATELY ABSENT. That
 * zone is not a body at all — it is the one card left in
 * `AdvisorBucketRoutes`' `COPY`, and its entire page is already a statement of
 * the gap: nothing in this product counts a profile view, for anyone, and that
 * needs an impression pipeline rather than a table. Three more "not stored"
 * lines above a page whose heading is *"Nothing counts profile views"* would be
 * noise, not honesty. The exclusion is listed in
 * `frontend/test/profile_zone_actions.test.mjs` so it cannot quietly grow.
 *
 * WHAT THE FOUR LOOK LIKE. One link, four exports, seven gaps. Three of those
 * gaps are the good kind: the thing the label asks for is on the page already —
 * every profile field is editable in place, a service is added from the form
 * below, consent is requested from each proof's own row — so the note points
 * down rather than apologising.
 */

export const ADVISOR_ZONE_ACTIONS = {
  'expertise/profile': [
    { label: 'Edit profile', unbuilt: 'every field below is editable and saves in place' },
    { label: 'Preview as founder', unbuilt: 'no public profile page exists to preview' },
    { label: 'Export', kind: 'export' },
  ],
  'expertise/services': [
    { label: 'New service', unbuilt: 'the form below adds one' },
    { label: 'Price history', unbuilt: 'only the current price is stored; there is no history to open' },
    { label: 'Export', kind: 'export' },
  ],
  'expertise/proof': [
    { label: 'Ask for consent', unbuilt: 'consent is requested from each proof’s own row' },
    { label: 'Public preview', unbuilt: 'no public profile page exists to preview' },
    { label: 'Export', kind: 'export' },
  ],
  'expertise/thinking': [
    { label: 'New piece', to: '/articles/draft' },
    { label: 'Drafting history', unbuilt: 'only the current draft is stored; there is no revision history' },
    { label: 'Export', kind: 'export' },
  ],

  // ── Practice ─────────────────────────────────────────────────────────────
  //
  // `Bulk: decline with template` IS TWO MISSING THINGS, NOT ONE, and the
  // reason names the one that actually blocks it. There is no store of decline
  // wordings to pick from — `advisor_services` holds what an advisor SELLS, not
  // what they say when refusing — and `POST /advisors/bookings/:id/cancel`
  // takes one booking at a time, so a bulk action would be a loop the reader
  // cannot see the failure modes of. Either alone would be enough.
  // `canvas:` IS PROVENANCE AND `label:` IS WHAT RENDERS — the split
  // `founderZoneActions.js:56` already uses, and its docblock asks that each
  // use say why. Here: the canvas string is 27 characters against a cap of 24
  // (`zone_label_contract.test.mjs`), and shortening it in place is not
  // available because the canvas-order guard deep-equals the canvas verbatim.
  // The rendered label keeps both ideas the canvas carries, bulk and template.
  'practice/opportunities': [
    { canvas: 'Bulk: decline with template', label: 'Bulk: templated decline', unbuilt: 'no decline wording is stored to pick from, and a cancellation is written one request at a time' },
    { label: 'Export decision log', kind: 'export' },
  ],

  // `Bulk: send renewal notice` IS THE SPLIT'S THIRD USE, for the same reason
  // as PR1's above and the one `founderZoneActions.js:56` established: the
  // canvas string is 25 characters against a cap of 24
  // (`zone_label_contract.test.mjs`), and shortening it in place is not
  // available because the canvas-order guard deep-equals the canvas ops
  // verbatim. The rendered label keeps both ideas the canvas carries — bulk,
  // and a renewal notice.
  //
  // THE REASON IS THE ADDRESS, NOT THE CHANNEL — and the first draft of this
  // entry said the opposite, which is exactly the failure this pass keeps
  // catching. It claimed "nothing sends a message from you to a client".
  // Something does: `routes/messages.ts` (migration 185) is a person-to-person
  // inbox, `POST /api/messages` opens a thread with any existing account, and
  // its `SUBJECT_TYPES` already includes `'engagement'`. Writing a gap that is
  // not there is the same defect as hiding one that is.
  //
  // What actually blocks it is WHO to send to. That POST keys the recipient on
  // `to_email` against an existing account, and migration 238 keeps the client
  // as a NAME with `founder_user_id` nullable on purpose — the artboard's
  // clients are companies, and a retainer may predate the client joining. So
  // the engagement payload carries no address at all today, and for an unlinked
  // client there is none to carry. A bulk send over a mixed set would deliver
  // to some rows and silently skip the rest, which is worse than no button.
  //
  // Two small pieces close it and neither belongs in a page PR: the client's
  // address on the read, and a rule for the rows that have none.
  'practice/engagements': [
    { canvas: 'Bulk: send renewal notice', label: 'Bulk: renewal notice', unbuilt: 'a notice needs an addressable client, and an engagement keeps its client as a name — only a linked account has an address, so a bulk send would reach some clients and silently skip the rest' },
    { label: 'Export contract pack', kind: 'export' },
  ],

  // NEITHER OF THESE NEEDS THE `canvas:`/`label:` SPLIT, which is worth saying
  // because the two artboards before it both did. `Bulk: nudge unopened` is 20
  // characters and `Export as client pack` is 21, against a cap of 24
  // (`zone_label_contract.test.mjs`), so both render the canvas's own string.
  //
  // `Bulk: nudge unopened` IS THE FIRST ADVISOR→CLIENT SEND IN THIS PRODUCT,
  // and it is built rather than deferred because migration 239's send rule
  // removes the blocker that stopped its sibling on Engagements. That one is
  // `unbuilt` because a renewal notice may target a client with no account and
  // a bulk send would silently skip them. Here it cannot: a deliverable version
  // can only BE sent to a client who has an account, so every row that could
  // possibly be unopened is addressable by construction. The channel already
  // existed — `routes/messages.ts` (migration 185) opens a thread with any
  // account and its `SUBJECT_TYPES` already carries `'engagement'`.
  //
  // `kind: 'handler'` RATHER THAN A DESTINATION, per D67: it acts on rows this
  // page has already loaded, and the page confirms the recipients on screen
  // before anything is sent. The one case the send rule cannot prevent — an
  // engagement unlinked after a send — is reported as a count of rows the nudge
  // will NOT reach, never skipped quietly.
  'practice/delivery': [
    { label: 'Bulk: nudge unopened', kind: 'handler', handler: 'nudgeUnopened' },
    { label: 'Export as client pack', kind: 'export' },
  ],

  // BOTH BUILT, AND THE FIRST ONE IS THE CAREFUL ONE. `Block a date range`
  // withdraws hours that were never taken, which is NOT what cancelling does:
  // cancelling undoes a booking and tells whoever held it. Conflating them
  // would send a cancellation notice for an hour nobody had, so migration 240
  // gives a blocked slot its own column rather than reusing `is_cancelled`.
  // The route refuses to block a slot someone already holds and reports those
  // back by count, so the advisor learns the range was not wholly applied
  // instead of assuming it was — the same shape as Delivery's nudge, which
  // names the rows it will not reach.
  //
  // `Export to calendar` is a HANDLER and not `kind: 'export'`, which is the
  // one thing worth pausing on. The builder's export kind emits the CSV every
  // other zone wants, through `exportView` — and a calendar is an .ics file, a
  // different format for a different consumer. Labelling it `export` would
  // have produced "Export to calendar · this view" and handed the advisor a
  // spreadsheet. It stays client-side either way: the file is built from rows
  // already on screen, so there is no endpoint and nothing leaves the browser.
  'practice/sessions': [
    { label: 'Block a date range', kind: 'handler', handler: 'blockRange' },
    { label: 'Export to calendar', kind: 'handler', handler: 'exportCalendar' },
  ],

  // ── Network ──────────────────────────────────────────────────────────────
  'network/relationships': [
    { label: 'Log interaction', unbuilt: 'no interaction log is stored' },
    { label: 'Add person', unbuilt: 'an advisor’s book is built from accepted introductions, not typed in' },
    { label: 'Export', kind: 'export' },
  ],
  'network/introductions': [
    { label: 'New introduction', unbuilt: 'introductions arrive as propositions; none is composed here' },
    { label: 'Consent log', unbuilt: 'consent is recorded per introduction, not as a log' },
    { label: 'Export', kind: 'export' },
  ],

  // ── Research ─────────────────────────────────────────────────────────────
  // TWO OPS THAT WERE `unbuilt:` AND ARE NOW THE PAGE'S OWN. `New session` said
  // "the question box below starts one" — true of the box and not of the op: a
  // box that always appends to the same thread cannot start a second one, and
  // migration 221 is what made a second one a thing that exists. `Saved
  // answers` said no answer is saved; one bit on `research_ask_answers` and the
  // ops row now keeps them.
  //
  // BOTH ARE `kind: 'handler'` RATHER THAN `to:`, because neither is a
  // destination: starting a session and switching the view to the kept ones
  // both act on state this page owns. D67.
  'research/ask': [
    { label: 'New session', kind: 'handler', handler: 'newSession' },
    { label: 'Saved answers', kind: 'handler', handler: 'savedAnswers' },
    { label: 'Export', kind: 'export' },
  ],
  // THIS ZONE WAS EXCLUDED AS "A CARD, NOT A BODY" AND IT IS A BODY.
  // `ClientPrepZone` has taken `zoneActions` and rendered a row from it since
  // the advisor grant landed; with no key here `makeZoneActions` returned `[]`
  // and the row drew nothing, over an artboard specifying three ops. Same
  // shape, and the same stale reason, as the two investor Research zones.
  //
  // `Attach to session` is a LINKAGE gap, not an absent store: a grant carries
  // a `scope_sessions` flag, so a client's sessions can be opened to you — what
  // nothing records is a brief against one of them.
  'research/client-prep': [
    // BOTH STAY PROSE, and migration 222 sharpened the first rather than
    // closing it. What the reader can now write is a ROW inside a brief that
    // already exists — the form on the page takes one — and that is a different
    // act from asking a founder to open their record. A control called `New
    // brief` that added a row would name the wrong thing.
    { label: 'New brief', unbuilt: 'a brief exists because a founder opened their record to you, and nothing here can ask for one — what you can add is a row inside a brief you already hold, which the form below takes' },
    // NOT THE PARTNER'S `Attach to proposal`, and not the same edge. Partner's
    // is brief→`quotes`, which migration 222 built; an advisor holds no quotes,
    // and this artboard asks for brief→session, which nothing records.
    { label: 'Attach to session', unbuilt: 'a grant can open a client’s sessions to you, but nothing records a brief against one' },
    { label: 'Export', kind: 'export' },
  ],
  'research/markets': [
    { label: 'Re-run stale', unbuilt: 'signals are gathered on a schedule; nothing re-runs one' },
    { label: 'Add source', unbuilt: 'sources are not configurable' },
    { label: 'Export', kind: 'export' },
  ],
  'research/companies': [
    { label: 'Add company', unbuilt: 'the analysis form below adds one' },
    { label: 'Open in Ask', unbuilt: 'Ask answers from the library, and an analysis is not a library document' },
    { label: 'Export', kind: 'export' },
  ],
  // BOTH OPS ARE THE PAGE'S OWN NOW. `Add document` said "the add-document form
  // below takes a file or a link" — true of the form and not of the op, which
  // is what a reader looking at the ops row reaches for; it opens the file
  // picker on that same form rather than being a second uploader. `Re-index`
  // said "indexing runs on upload; there is no re-run control", which was the
  // gap this artboard's whole composition turns on: its Thornfield row is a
  // document the firm added and never indexed, so it answers nothing in Ask and
  // there was no way to act on it from the page reporting it. There is now —
  // `POST /api/research/documents/:uid/reindex`, over the same `embed_entity`
  // job the upload path enqueues. D67.
  'research/library': [
    { label: 'Add document', kind: 'handler', handler: 'addDocument' },
    { label: 'Re-index', kind: 'handler', handler: 'reindex' },
    { label: 'Export', kind: 'export' },
  ],
};

export const advisorZoneActions = makeZoneActions(ADVISOR_ZONE_ACTIONS);
