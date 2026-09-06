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
    { label: 'Edit profile', note: 'every field below is editable and saves in place' },
    { label: 'Preview as founder', note: 'no public profile page exists to preview' },
    { label: 'Export', kind: 'export' },
  ],
  'expertise/services': [
    { label: 'New service', note: 'the form below adds one' },
    { label: 'Price history', note: 'only the current price is stored; there is no history to open' },
    { label: 'Export', kind: 'export' },
  ],
  'expertise/proof': [
    { label: 'Ask for consent', note: 'consent is requested from each proof’s own row' },
    { label: 'Public preview', note: 'no public profile page exists to preview' },
    { label: 'Export', kind: 'export' },
  ],
  'expertise/thinking': [
    { label: 'New piece', to: '/articles/draft' },
    { label: 'Drafting history', note: 'only the current draft is stored; there is no revision history' },
    { label: 'Export', kind: 'export' },
  ],
};

export const advisorZoneActions = makeZoneActions(ADVISOR_ZONE_ACTIONS);
