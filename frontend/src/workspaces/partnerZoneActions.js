import { makeZoneActions } from './zoneActionBuilder';

/**
 * The partner profile's ten Delivery and Offers zones, and what each of their
 * canvas actions actually does. `zoneActionBuilder.js` states the three
 * outcomes and the rules they follow; this file is the partner's answers.
 *
 * THREE BUCKETS ARE ABSENT FROM THIS TABLE AND NONE OF THEM IS AN OVERSIGHT.
 *
 *   `/network` — its three zones render `NetworkPage`, whose bodies are three
 *     further shared components (`RelationshipsPanel`, `IntroductionsPanel`,
 *     `ContactsPanel`) used by more than one licence. Threading a partner-only
 *     row through four files that four licences render is the shared-surface
 *     pass, not this one. `network/organizations` is excluded for a different
 *     reason: `NetworkPage` renders that zone as a stated gap, not
 *     as another tab's list: `unservedZone` catches a slug it has no tab for
 *     and `unservedAlone` suppresses every body, so the reader gets the
 *     Organizations heading above a card explaining the roll-up needs an edge
 *     from a person to an organisation that nothing stores. That is already the
 *     honest answer, and a header row would add nothing to it.
 *
 *   `/research` — same shared surface as every other profile's.
 *
 * WHAT THE TEN THAT ARE HERE LOOK LIKE. Ten of thirty run. Every zone can
 * export what it is showing, because migrations 208 and 209 gave these zones
 * real stores — this is the first profile in the pass where the exports are the
 * rule rather than the exception. The writes are the gaps, and they are gaps for
 * a reason worth reading in each zone's own docblock: `opened_at` and
 * `signed_off_at` are the CLIENT'S to set, so "Chase unopened" would be the firm
 * writing a metric about itself; there is no cadence store, so "Draft all" has
 * nothing to schedule; consent is recorded per proof, so "Ask for consent" needs
 * a founder-side surface that does not exist.
 */

export const PARTNER_ZONE_ACTIONS = {
  // ── Delivery ─────────────────────────────────────────────────────────────
  'delivery/board': [
    { label: 'Bulk status update', unbuilt: 'status moves one engagement at a time, from its own row' },
    { label: 'Saved views', unbuilt: 'filters reset between visits; no saved view is stored' },
    { label: 'Export', kind: 'export' },
  ],
  'delivery/deliverables': [
    { label: 'Chase unopened', unbuilt: 'nothing here sends mail, and an unopened deliverable means “we do not know”' },
    { label: 'Version history', unbuilt: 'only the current version number is stored, so there is no history to open' },
    { label: 'Export', kind: 'export' },
  ],
  'delivery/capacity': [
    { label: 'Reallocate', unbuilt: 'seats are granted and revoked on the engagement, not moved from here' },
    { label: 'Seat register', unbuilt: 'the seats below are the register; there is no second view of it' },
    { label: 'Export', kind: 'export' },
  ],
  'delivery/status-reports': [
    { label: 'Draft all', unbuilt: 'no cadence is stored, so there is no set of reports to draft' },
    { label: 'Cadence rules', unbuilt: 'report cadence is not a stored record' },
    { label: 'Export', kind: 'export' },
  ],
  'delivery/health': [
    { label: 'Change order', unbuilt: 'change orders are not a stored record' },
    { label: 'Renewal watch', unbuilt: 'no renewal date is stored to watch' },
    { label: 'Export', kind: 'export' },
  ],

  // ── Offers ───────────────────────────────────────────────────────────────
  'offers/catalog': [
    { label: 'New service', unbuilt: 'services are added from the catalogue’s own form below' },
    { label: 'Pricing history', unbuilt: 'only the current price is stored; there is no history to open' },
    { label: 'Export', kind: 'export' },
  ],
  'offers/perk-deals': [
    { label: 'New perk', unbuilt: 'perks are added from the form below' },
    { label: 'Extend', unbuilt: 'an expiry is edited on the perk itself, not extended in bulk' },
    { label: 'Export', kind: 'export' },
  ],
  'offers/visibility': [
    { label: 'Adjust placements', unbuilt: 'placement is not a stored setting' },
    { label: 'Attribution rules', unbuilt: 'attribution is counted from engagements, never configured' },
    { label: 'Export', kind: 'export' },
  ],
  'offers/proof': [
    { label: 'Ask for consent', unbuilt: 'consent is given by the founder, and no founder-side surface exists to ask from here' },
    { label: 'Preview public page', unbuilt: 'no public proof page is published yet' },
    { label: 'Export', kind: 'export' },
  ],
  'offers/audience-fit': [
    { label: 'Edit fit rules', unbuilt: 'rules are edited on the rule itself, below' },
    { label: 'Pass reasons', unbuilt: 'a pass reason is not a stored field on a fit rule' },
    { label: 'Export', kind: 'export' },
  ],

  // ── Pipeline ─────────────────────────────────────────────────────────────
  // THE PARAGRAPH THAT USED TO STAND HERE WAS WRONG, and it is worth saying how
  // rather than just deleting it. It read: "`/pipeline` — `Pages · Partner
  // Pipeline` specifies NO zone-header actions … Adding actions to those five
  // zones would mean inventing them", and it was believed for long enough that
  // five zones shipped with no header row at all.
  //
  // The canvas specifies seven. It always has. `design/canvases/integrated/
  // Pages · Partner Pipeline.dc.html` carries every one as `class="vm"`, and
  // the newer export in `design/incoming/` is byte-identical on that point. The
  // canvas is simply in a different shape from the others — no `PAGES` array,
  // no `route:'…'`, no `ops:[…]` — and `canvasOps` in
  // `frontend/test/profile_zone_actions.test.mjs` could only read the first
  // shape. A guard that could not parse a file reported the file as empty, and
  // this docblock repeated the guard back as if it were a fact about design.
  // The reader now understands both shapes, so these five rows are held to the
  // artboard exactly like every other zone's.
  //
  // Three of the seven run today; all three are exports, and every one of these
  // zones already loads the rows an export would write. The other four each
  // need a store that does not exist, named per entry.
  'pipeline/leads': [
    // Scoring a lead against what this firm can do needs a weight per
    // capability and a capability register to hang it on. Neither is stored: a
    // lead's fit is judged by the person reading it.
    { label: 'Edit capability weights', unbuilt: 'no capability register is stored, and no weight against one, so there is nothing to edit' },
  ],
  'pipeline/proposals': [
    // `opened_at` is the CLIENT'S column to set and no surface lets them, so
    // "unopened" here means "we do not know" — the reading
    // `delivery/deliverables` already documents. Nothing in this product sends
    // mail either, so a bulk nudge has neither a trigger nor a set to act on.
    { label: 'Bulk: nudge unopened', unbuilt: 'nothing here sends mail, and an unopened proposal means “we do not know” rather than “they ignored it”' },
    { label: 'Export win/loss CSV', kind: 'export' },
  ],
  'pipeline/negotiations': [
    // The canvas draws each lane as "n / 5". That 5 is the canvas's own sample
    // figure, and adopting it would be inventing this firm's limit and then
    // policing the board with it — the same call `delivery/capacity` makes
    // about the hardcoded 40 it refuses to treat as a cap.
    { label: 'WIP limit: 5 per stage', unbuilt: 'no per-stage limit is stored, and the canvas’s 5 is its own sample rather than this firm’s' },
  ],
  'pipeline/retainers': [
    { label: 'Export MRR schedule', kind: 'export' },
  ],
  'pipeline/analytics': [
    { label: 'Export chart', kind: 'export' },
    // `research_benchmarks` (216/217) is owner-scoped and exists precisely to
    // hold a figure WITH the source and sample the reader entered. Writing this
    // firm's own win rate into it would put an unsourced number in a register
    // built to refuse them.
    { label: 'Save benchmark', unbuilt: 'the benchmark register stores a figure with the source and sample you entered, and this page has neither to give it' },
  ],

  // ── Network ──────────────────────────────────────────────────────────────
  'network/relationships': [
    { label: 'Assign owner', unbuilt: 'no owner field is stored on a relationship' },
    { label: 'Log interaction', unbuilt: 'no interaction log is stored' },
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
  // Excluded as "a card, not a body" until now, and it is a body — see the
  // note on the advisor table's copy of this zone. `Attach to proposal` states
  // the missing EDGE rather than denying that proposals exist: this row is
  // about a brief, where `research/markets` below is about a signal, and both
  // fail for the want of a link rather than the want of a proposal.
  'research/client-prep': [
    // `New brief` STAYS PROSE, AND THE REASON IS SHARPER THAN IT WAS. It read
    // "a brief exists when a founder opens their record to you; nothing here
    // asks for one" — still true of the BRIEF, and migration 222 did not change
    // it: what the firm can now write is a ROW of its own inside a brief that
    // already exists, which is a different act and has its own form on the page.
    // A control called `New brief` that added a row would name the wrong thing.
    { label: 'New brief', unbuilt: 'a brief exists because a founder opened their record to you, and nothing here can ask for one — what the firm can add is a row inside a brief it already holds, which the form below takes' },
    // LIVE, AND IT WAS NEVER THE PROPOSAL THAT WAS MISSING. The note said
    // "nothing links a brief to a proposal record"; `quotes` (migration 034) is
    // live and `api.myQuotes()` reads it, so what was missing was the EDGE, and
    // migration 222's `research_attachments` is it. D67.
    { label: 'Attach to proposal', kind: 'handler', handler: 'attachToProposal' },
    { label: 'Export', kind: 'export' },
  ],
  'research/markets': [
    { label: 'Re-run stale', unbuilt: 'signals are gathered on a schedule; nothing re-runs one' },
    { label: 'Attach to proposal', unbuilt: 'nothing carries a signal onto a proposal' },
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

export const partnerZoneActions = makeZoneActions(PARTNER_ZONE_ACTIONS);
