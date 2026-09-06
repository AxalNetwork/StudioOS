import { makeZoneActions } from './zoneActionBuilder';

/**
 * The partner profile's ten Delivery and Offers zones, and what each of their
 * canvas actions actually does. `zoneActionBuilder.js` states the three
 * outcomes and the rules they follow; this file is the partner's answers.
 *
 * THREE BUCKETS ARE ABSENT FROM THIS TABLE AND NONE OF THEM IS AN OVERSIGHT.
 *
 *   `/pipeline` — `Pages · Partner Pipeline` specifies NO zone-header actions.
 *     It is a rendered export rather than a data canvas: five artboards, five
 *     headings, and its only `.gho` elements are inline card buttons ("Pass",
 *     "Edit terms", "See the hours") that sit in rows, not in a header. Adding
 *     actions to those five zones would mean inventing them, which is the exact
 *     failure the rest of this pass exists to avoid. Recorded in `ROUTE_MAP.md`
 *     and left alone until the canvas gains an `ops:` array.
 *
 *   `/network` — its three zones render `NetworkPage`, whose bodies are three
 *     further shared components (`RelationshipsPanel`, `IntroductionsPanel`,
 *     `ContactsPanel`) used by more than one licence. Threading a partner-only
 *     row through four files that four licences render is the shared-surface
 *     pass, not this one. Worth knowing while it waits: `NetworkPage` has no
 *     organizations tab at all, so a partner opening `/network/organizations`
 *     lands on contacts.
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
    { label: 'Bulk status update', note: 'status moves one engagement at a time, from its own row' },
    { label: 'Saved views', note: 'filters reset between visits; no saved view is stored' },
    { label: 'Export', kind: 'export' },
  ],
  'delivery/deliverables': [
    { label: 'Chase unopened', note: 'nothing here sends mail, and an unopened deliverable means “we do not know”' },
    { label: 'Version history', note: 'only the current version number is stored, so there is no history to open' },
    { label: 'Export', kind: 'export' },
  ],
  'delivery/capacity': [
    { label: 'Reallocate', note: 'seats are granted and revoked on the engagement, not moved from here' },
    { label: 'Seat register', note: 'the seats below are the register; there is no second view of it' },
    { label: 'Export', kind: 'export' },
  ],
  'delivery/status-reports': [
    { label: 'Draft all', note: 'no cadence is stored, so there is no set of reports to draft' },
    { label: 'Cadence rules', note: 'report cadence is not a stored record' },
    { label: 'Export', kind: 'export' },
  ],
  'delivery/health': [
    { label: 'Change order', note: 'change orders are not a stored record' },
    { label: 'Renewal watch', note: 'no renewal date is stored to watch' },
    { label: 'Export', kind: 'export' },
  ],

  // ── Offers ───────────────────────────────────────────────────────────────
  'offers/catalog': [
    { label: 'New service', note: 'services are added from the catalogue’s own form below' },
    { label: 'Pricing history', note: 'only the current price is stored; there is no history to open' },
    { label: 'Export', kind: 'export' },
  ],
  'offers/perk-deals': [
    { label: 'New perk', note: 'perks are added from the form below' },
    { label: 'Extend', note: 'an expiry is edited on the perk itself, not extended in bulk' },
    { label: 'Export', kind: 'export' },
  ],
  'offers/visibility': [
    { label: 'Adjust placements', note: 'placement is not a stored setting' },
    { label: 'Attribution rules', note: 'attribution is counted from engagements, never configured' },
    { label: 'Export', kind: 'export' },
  ],
  'offers/proof': [
    { label: 'Ask for consent', note: 'consent is given by the founder, and no founder-side surface exists to ask from here' },
    { label: 'Preview public page', note: 'no public proof page is published yet' },
    { label: 'Export', kind: 'export' },
  ],
  'offers/audience-fit': [
    { label: 'Edit fit rules', note: 'rules are edited on the rule itself, below' },
    { label: 'Pass reasons', note: 'a pass reason is not a stored field on a fit rule' },
    { label: 'Export', kind: 'export' },
  ],
};

export const partnerZoneActions = makeZoneActions(PARTNER_ZONE_ACTIONS);
