import { makeZoneActions } from './zoneActionBuilder';

/**
 * The founder profile's thirty zones, and what each of their canvas actions
 * actually does. `zoneActionBuilder.js` states the four outcomes and the rules
 * they follow; this file is the founder's answers.
 *
 * WHERE THE LABELS COME FROM. Verbatim from the `ops:` array of the zone's
 * artboard in `design/canvases/integrated/Pages · Founder {Validate,Build,Grow,
 * Network,Raise,Research}.dc.html`, in the canvas's own order. Nothing is
 * invented and nothing is dropped: a zone whose canvas asks for three actions
 * lists three here, even when all three are gaps, because the gap is the answer
 * the reader needs. Validate states its ops as `tools:` on a `boards` array
 * rather than `ops:` on a `PAGES` array; `artboardOps` in the guard reads both.
 *
 * `canvas:` IS PROVENANCE AND `label:` IS WHAT RENDERS, the same split the
 * filters table uses, and for the same reason: exactly one op here would
 * otherwise ship a word the product cannot honour. It is used once, and using it
 * twice without the file saying why would be the drift it exists to prevent.
 *
 * EVERY `to` WAS CHECKED AGAINST THE ROUTER, NOT ASSUMED. Each one is a path
 * `App.jsx` mounts with a guard that admits `founder`, and lands on a component
 * that calls the write method the label promises. Four labels lost their link
 * that way: `/matches` (where `introductionsRequest` lives) is admin, partner
 * and investor only; `/contacts` redirects to `/network?tab=contacts`, whose
 * tab a founder's Network desk does not read; `/build/discovery` renders
 * `FounderValidatePage` for a founder, so the waitlist invite panel behind it
 * is not theirs to reach; and `/build/team` renders the Grow desk, not
 * `TeamBuildingPage`. All four are notes below. A link that 404s, or that lands
 * on a page the reader is not allowed to open, is the same broken promise as a
 * button that does nothing — it is just slower to discover.
 *
 * `frontend/test/profile_zone_actions.test.mjs` re-derives the labels from the canvases
 * and re-checks every `to` against `App.jsx`, so this table cannot drift from
 * either without failing the build.
 */

export const FOUNDER_ZONE_ACTIONS = {
  // ── Validate ─────────────────────────────────────────────────────────────
  // THE ZONE SET THAT NEEDED A FOURTH KIND. Every op here is performed by
  // `FounderValidateWorkspace` itself: three open a dialog it owns, and the
  // three exports are server-side CSV downloads with a busy spinner and a shared
  // error line — not `exportView` over rows the page has already loaded. Before
  // `kind: 'handler'` none of that could be said in a table, so the workspace
  // kept its own local `ACTIONS` map and these four zones stayed outside every
  // guard this file is checked by. See `zoneActionBuilder.js` and D67.
  'validate/interviews': [
    { label: 'Log an interview', kind: 'handler', handler: 'logInterview' },
    // THE ONE LABEL HERE THAT IS NOT THE CANVAS'S. The artboard says "Export
    // transcripts" and the file does not contain any: `INTERVIEWS_CSV_HEADER` is
    // id, name, role, company, date, fit, consent, deck_eligible, rating,
    // comment, pains, notes. Migration 215 DID add `transcript` and the
    // recording columns — the two docblocks claiming the table has neither are
    // stale and are corrected — but the export still does not select them, so
    // the canvas's word would promise a column the download has not got.
    { canvas: 'Export transcripts', label: 'Export interviews', kind: 'handler', handler: 'exportInterviews' },
  ],
  // "Send to Problem slide" is drawn on two artboards and performs nothing on
  // either — not because the pipe is missing, but because it already runs
  // without a button: `pain_groups` is curated for the deck's slide 2 (see
  // progress.ts), so a control that "sends" would be theatre over a connection
  // that is already live. What it should become is a link that says so.
  'validate/pain-map': [
    { label: 'Send to Problem slide', unbuilt: 'the curated pain themes already feed the deck’s Problem slide; there is nothing to send, and a button implying otherwise would claim credit for a pipe that runs on its own' },
    { label: 'Export map', kind: 'handler', handler: 'exportPainMap' },
  ],
  'validate/hypotheses': [
    { label: 'New hypothesis', kind: 'handler', handler: 'newHypothesis' },
    { label: 'Link to a pain', kind: 'handler', handler: 'linkPain' },
  ],
  'validate/verdict': [
    { label: 'Export summary', kind: 'handler', handler: 'exportSummary' },
    { label: 'Send to Problem slide', unbuilt: 'the curated pain themes already feed the deck’s Problem slide; there is nothing to send, and a button implying otherwise would claim credit for a pipe that runs on its own' },
  ],
  // ── Build ────────────────────────────────────────────────────────────────
  'build/this-week': [
    { label: 'Export CSV', kind: 'export' },
    { label: 'Configure zone', unbuilt: 'nothing here is configurable — this desk reads the roadmap’s Now column' },
  ],
  'build/board': [
    { label: 'Bulk move', unbuilt: 'no bulk stage change is stored; a deal moves from its own row' },
    { label: 'Automations', unbuilt: 'no automation rules are stored' },
    { label: 'Configure lanes', unbuilt: 'the lanes are the pipeline’s stored stages and are not editable here' },
  ],
  'build/roadmap': [
    { label: 'New scenario', to: '/execution/roadmap', linkNote: 'objectives and key results are edited in Execution' },
    { label: 'Export', kind: 'export' },
    { label: 'Configure', unbuilt: 'no roadmap settings are stored' },
  ],
  'build/cadence': [
    { label: 'New ritual', unbuilt: 'rituals are not a stored record yet' },
    { label: 'Edit templates', unbuilt: 'no cadence templates are stored' },
    { label: 'Export archive', unbuilt: 'no cadence history is stored, so there is no archive to export' },
  ],
  'build/kpi': [
    { label: 'Bulk entry', to: '/build/metrics' },
    { label: 'Import CSV', unbuilt: 'no importer is built; snapshots are entered one at a time' },
    { label: 'Stripe sync', to: '/build/metrics' },
    { label: 'Definitions', unbuilt: 'metric definitions are not stored' },
  ],

  // ── Grow ─────────────────────────────────────────────────────────────────
  'grow/focus': [
    { label: 'New experiment', unbuilt: 'experiments are not a stored record' },
    { label: 'Change metric', to: '/build/metrics' },
    { label: 'Export', kind: 'export' },
  ],
  'grow/talent': [
    { label: 'Post a role', unbuilt: 'no role posting is stored' },
    { label: 'Bulk reject', unbuilt: 'no candidate records exist to act on' },
    { label: 'Export', kind: 'export' },
  ],
  'grow/customers': [
    { label: 'Bulk sequence', unbuilt: 'no sequence store exists — nothing here sends mail' },
    { label: 'New segment', unbuilt: 'segments are not stored' },
    { label: 'Export', kind: 'export' },
  ],
  'grow/partnerships': [
    { label: 'New proposal', to: '/comarketing' },
    { label: 'Export terms', kind: 'export' },
  ],
  'grow/capital-match': [
    { label: 'Draft outreach', unbuilt: 'no outreach drafting runs on this desk' },
    { label: 'Export shortlist', kind: 'export' },
  ],
  'grow/brand': [
    { label: 'New page', to: '/spinout-lab/brand' },
    { label: 'Export leads', kind: 'export' },
    { label: 'Edit templates', unbuilt: 'landing templates are chosen in the brand builder, not edited' },
  ],
  'grow/launch': [
    { label: 'New item', to: '/calendar' },
    { label: 'Export calendar', kind: 'export' },
  ],

  // ── Network ──────────────────────────────────────────────────────────────
  'network/relationships': [
    { label: 'Add person', unbuilt: 'the contact form is not reachable from a founder’s Network desk' },
    { label: 'Set reminders', unbuilt: 'no reminder store exists' },
    { label: 'Export', kind: 'export' },
  ],
  'network/introductions': [
    { label: 'Request an intro', unbuilt: 'the request flow lives on a surface a founder cannot open' },
    { label: 'Offer one', unbuilt: 'offering an introduction is not built' },
    { label: 'Export', kind: 'export' },
  ],
  // BOTH NOTES WERE TOO WEAK, and the filter half of this row is what showed
  // it. `Add org` said the contact form was merely out of reach, and `Merge
  // duplicates` said duplicates "stay as separate rows" — which describes rows
  // this page can never have. A contact carries no organisation field at all,
  // so the roll-up above is empty on every account and there is nothing to
  // have duplicated. The two halves of this row now say the same thing.
  'network/organizations': [
    { label: 'Add org', unbuilt: 'a contact records a person, an email and an audience, and no field on it names an organisation, so there is no org for a form to add' },
    { label: 'Merge duplicates', unbuilt: 'nothing groups people into organisations here, so there are no rows to be duplicates of each other' },
    { label: 'Export', kind: 'export' },
  ],

  // ── Raise ────────────────────────────────────────────────────────────────
  'raise/status': [
    { label: 'Export brief', kind: 'export' },
    { label: 'Share war-room', unbuilt: 'no share link is issued for this view' },
  ],
  'raise/pitch': [
    { label: 'New version', to: '/raise/pitch?mode=workspace' },
    { label: 'Export PDF', to: '/raise/pitch?mode=workspace' },
    { label: 'Revoke a link', unbuilt: 'share links are revoked where they are issued, in the deck builder' },
  ],
  'raise/capital': [
    { label: 'Model a round', to: '/raise/capital/model' },
    { label: 'Export to Carta', to: '/raise/capital/cap-table', linkNote: 'the cap table exports CSV; there is no Carta connection' },
    { label: 'Add instrument', to: '/raise/capital/cap-table' },
  ],
  'raise/legal': [
    { label: 'Send for signature', unbuilt: 'no e-signature provider is connected' },
    { label: 'Add document', to: '/legal' },
    { label: 'Calendar', to: '/raise/legal-engine/compliance' },
  ],
  'raise/data-room': [
    { label: 'Grant access', to: '/raise/data-room?mode=workspace' },
    { label: 'Revoke', to: '/raise/data-room?mode=workspace' },
    { label: 'Export log', kind: 'export' },
  ],
  'raise/liquidity': [
    { label: 'Model an exit', to: '/raise/capital/model' },
    { label: 'Export', kind: 'export' },
  ],

  // ── Research ─────────────────────────────────────────────────────────────
  'research/ask': [
    { label: 'New brief', unbuilt: 'the question box below starts one' },
    { label: 'Export session', kind: 'export' },
    { label: 'Clear history', unbuilt: 'no session history is stored to clear' },
  ],
  'research/markets': [
    { label: 'New deep-dive', unbuilt: 'signals are gathered on a schedule, not started here' },
    { label: 'Export', kind: 'export' },
    { label: 'Cite in deck', unbuilt: 'nothing carries a signal into the deck builder' },
  ],
  'research/companies': [
    { label: 'Add company', unbuilt: 'the analysis form below adds one' },
    { label: 'Compare', unbuilt: 'analyses are read one at a time; no comparison view is stored' },
    { label: 'Export', kind: 'export' },
  ],
  // THIS KEY WAS MISSING AND THE ROW DREW NOTHING. `profile_zone_actions`
  // excluded `research/funds` as "a card in ResearchWorkspace's ZONE_COPY, not
  // a body" — true once, and untrue since `ZONE_COPY` became `{}` and
  // `LIVE_ZONES` gained `funds`. `FundsZone` takes `zoneActions` and renders
  // `zoneActions(visible)`, so three specified ops rendered as nothing at all.
  // The same stale exclusion `research/client-prep` carried on two licences.
  'research/funds': [
    { label: 'Add fund', unbuilt: 'the add-a-fund form below takes one' },
    { label: 'Brief me', unbuilt: 'no per-fund brief is generated; the thesis is quoted in their words and the reading is yours to write' },
    { label: 'Export', kind: 'export' },
  ],
  'research/library': [
    { label: 'Upload', unbuilt: 'the add-document form below takes a file or a link' },
    { label: 'New collection', unbuilt: 'collections are not stored' },
    { label: 'Export', kind: 'export' },
  ],
};

export const founderZoneActions = makeZoneActions(FOUNDER_ZONE_ACTIONS);
