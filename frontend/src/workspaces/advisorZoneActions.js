import { makeZoneActions } from './zoneActionBuilder';

/**
 * The advisor profile's four Expertise zones, and what each of their canvas
 * actions actually does. `zoneActionBuilder.js` states the three outcomes and
 * the rules they follow; this file is the advisor's answers.
 *
 * FOUR ZONES IS THE WHOLE ADVISOR SCOPE, AND THAT IS A FACT ABOUT THE CANVASES
 * RATHER THAN A SHORTFALL IN THIS PASS. Only one advisor artboard set carries
 * an `ops:` array at all — `design/incoming/Pages · Advisor Expertise.dc.html`.
 * `Advisor Detail · Practice`, `Advisor Canvas` and the backlog
 * `Pages · Advisor Cohorts` are rendered exports with no header actions on any
 * artboard, so Practice's five zones and Cohorts' five have nothing to copy;
 * inventing actions for them is the exact failure this pass exists to avoid.
 * `/network` and `/research` are the shared surfaces every profile defers.
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
    { label: 'New brief', unbuilt: 'a brief exists when a founder opens their record to you; nothing here asks for one' },
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
