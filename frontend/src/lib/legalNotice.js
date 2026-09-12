// The company's ownership notice, in one place.
//
// WHY THIS IS A MODULE AND NOT A STRING IN EACH FOOTER. Two surfaces carry
// it today — `components/PublicFooter.jsx` on every marketing page and the
// onboarding licence picker at `/onboarding`, which is the first signed-in
// screen a new member sees — and the two say different things the moment
// anyone edits one. An ownership line that reads one way on the public site
// and another way on the page where somebody picks a licence is worse than
// having only one of them, because a reader cannot tell which is current.
//
// The split between OPERATOR and IP_OWNER is real and load-bearing: the
// entity that runs the platform and the entity that owns the brand are
// different companies, and collapsing them into "© Axal VC" would misstate
// which one a member is contracting with.

/** The year the notice asserts. Bump deliberately — see NOTICE below. */
export const NOTICE_YEAR = 2026;

/** The entity that operates the platform members sign in to. */
export const OPERATOR = 'Axal VC Management LLC';

/** The entity that owns the brand and the platform IP. */
export const IP_OWNER = 'Axal VC Holdings LLC';

/**
 * The full ownership line, as both footers render it.
 *
 * Kept as one pre-composed string rather than assembled at the call site so
 * the two surfaces cannot drift in punctuation or ordering while still
 * agreeing on the entity names.
 */
export const OWNERSHIP_NOTICE =
  `© ${NOTICE_YEAR} Axal VC. Platform operated by ${OPERATOR}. `
  + `Brand and platform IP owned by ${IP_OWNER}. All rights reserved.`;

/**
 * The two agreements a member is accepting by continuing, in the order the
 * onboarding footer lists them. `to` values are live SPA routes — both are
 * public, so they resolve for a signed-out reader too.
 */
export const LEGAL_LINKS = [
  { to: '/terms', label: 'Terms of Service' },
  { to: '/privacy', label: 'Privacy Policy' },
];
