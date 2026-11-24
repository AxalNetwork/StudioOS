/**
 * D6233 (#6233, FV2): the words and rules of the one locked Fund surface, pure,
 * so a Node test can hold them without rendering.
 *
 * What the add-on includes is not a second catalogue. The list is the Fund
 * bucket's own zones (`shellConfig.js`, the bucket whose `requiredInvestorTier`
 * is 'institutional'), each with a line saying what that zone does today. A
 * zone added to the bucket without a line here fails the test, so the list
 * cannot drift from the zone row an Institutional reader sees.
 *
 * Every line names software that is live on main and nothing else (D4653's
 * availability policy): no price, no extra seat, no human service, no research
 * coverage, and no distribution run by the GP, which no GP page does yet
 * (`DISTRIBUTIONS_TODAY`). FV2 draws "Distributions" as a sixth item; it is left
 * out until that page exists.
 */
import { bucketForPath } from '../../workspaces/shellConfig';
import { AVAILABILITY_SCOPE } from '../../lib/pricingEntitlements';

/** Each Fund zone and the one thing it does today, in the zone row's order after Overview. */
export const FUND_ZONE_LINES = Object.freeze({
  overview: 'Committed, called, collected and deployed for each fund you run, each figure from its record.',
  lps: 'The LP registry: each LP’s commitment, KYC state, documents and comms log.',
  calls: 'Capital calls split and previewed before they are issued, append-only receipts and the wire trail.',
  ledger: 'Capital accounts, fees and expenses for one fund.',
  reporting: 'Reporting periods: start one, edit its draft and read what was issued.',
});

/** The routes that draw this surface and the zone each one names. */
export const LOCKED_ZONE_LABELS = Object.freeze({
  overview: 'Overview',
  history: 'History',
  performance: 'Performance',
});

export const TALK_TO_AXAL = 'Talk to Axal';
// The Contact form's own intents (ContactPage.jsx INTENTS): an Institutional
// agreement is an investing enquiry, as the Institutional plan door sends it
// (siteDoors.js); a missing Investor licence is a licence enquiry.
export const CONTACT_HREF = Object.freeze({
  institutional: '/contact?topic=invest',
  licence: '/contact?topic=licence',
});
export const CONTACT_CAPTION = 'Opens the contact form for the Axal team. Nothing changes on your account until they reply.';
// Checkout's words for the negotiated plan (checkoutModel.js): no price is drawn here.
export const NOT_SOLD_HERE = 'Pricing agreed with Axal VC. Nothing is bought here.';
export const AVAILABILITY_NOTE = AVAILABILITY_SCOPE;

function fundBucket() {
  return bucketForPath('investor', '/funds');
}

/** Overview plus the Fund bucket's zones, each with its label and line; a zone with no line is dropped, never invented. */
export function includedCapabilities() {
  const zones = fundBucket()?.zones || [];
  return [{ slug: 'overview', label: 'Overview' }, ...zones.map((z) => ({ slug: z.slug, label: z.label }))]
    .filter((z) => FUND_ZONE_LINES[z.slug])
    .map((z) => ({ ...z, line: FUND_ZONE_LINES[z.slug] }));
}

/** The zone a path names: '/funds' (or '/funds/') is Overview, '/funds/<slug>' is that zone. */
export function zoneForPath(pathname) {
  return String(pathname || '').split('/')[2] || 'overview';
}

/** The label the heading uses for a zone: the zone row's own label, so Ledger reads Accounting as its pill does. */
export function zoneLabel(slug) {
  const zone = (fundBucket()?.zones || []).find((z) => z.slug === slug);
  if (zone) return zone.label;
  return LOCKED_ZONE_LABELS[slug] || 'Fund';
}

/**
 * The surface's words. `need` is what the reader lacks: 'institutional' (an
 * investor below the tier, on /funds and its zones) or 'licence' (a member with
 * no Investor licence on /funds/performance, which asks the licence and no tier,
 * D6245).
 */
export function lockedCopy({ zone = 'overview', need = 'institutional' } = {}) {
  const label = zoneLabel(zone);
  if (need === 'licence') {
    return {
      label,
      kicker: 'Locked · Investor licence',
      title: `${label} is part of the Investor licence`,
      body: 'It reads the funds you hold an LP record in, and the funds you run as GP of record, with the Investor licence. Your other workspaces are unchanged.',
      includedHeading: 'The Investor licence includes',
      included: [{ slug: 'performance', label: 'Performance', line: 'NAV, paid-in, distributions and returns from recorded valuations and cash flows.' }],
      href: CONTACT_HREF.licence,
      notes: [AVAILABILITY_NOTE],
    };
  }
  return {
    label,
    kicker: 'Locked · Institutional add-on',
    title: `${label} is part of the Institutional add-on`,
    body: 'The Fund section runs your own fund’s back office. Your account is on a lower tier, so it is locked. Your investor tools and any LP seat you hold work as before.',
    includedHeading: 'The Institutional add-on includes',
    included: includedCapabilities(),
    href: CONTACT_HREF.institutional,
    notes: [NOT_SOLD_HERE, AVAILABILITY_NOTE],
  };
}
