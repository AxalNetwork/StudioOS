/**
 * The public site's links, in one place (D674, #1548).
 *
 * The nav, the burger menu and the footer all read these lists, so a page
 * appears in all three or in none. They follow the owner's canvas
 * (`design/canvases/integrated/Axal VC Website.dc.html`, NAV and FOOTER), with
 * one rule the canvas cannot know: **a list holds only routes that exist.**
 *
 * The canvas also links pages that are still being built under #1546. Each
 * page's task adds its entry here in the same PR that adds its route:
 *   - Overview `/resources` goes at the top of NETWORK_LINKS (D679, #1553);
 *   - Intelligence `/intelligence` and Methodology `/methodology` go after
 *     Spin-Out Lab in BUILD_LINKS (D678, #1552);
 *   - Administrators `/administrators` goes last in BUILD_LINKS (D677, #1551).
 *
 * `site_links_d674.test.mjs` fails if any entry points at a path that `App.jsx`
 * does not route, so a link can never land on the 404 page.
 */

/** The four doors: the nav's centre, and the footer's "For" column. */
export const DOOR_LINKS = [
  { label: 'Founders', to: '/for-founders' },
  { label: 'Investors', to: '/for-investors' },
  { label: 'Operating Partners', to: '/for-service-partners' },
  { label: 'Advisors', to: '/for-advisors' },
];

/**
 * The Network menu, and the footer's "Network" column. `icon` names a
 * lucide-react icon that `PublicNav` maps to its component.
 */
export const NETWORK_LINKS = [
  { label: 'Articles', to: '/articles', icon: 'articles', blurb: 'Writing on formation and pre-seed underwriting' },
  { label: 'Directory', to: '/directory', icon: 'directory', blurb: 'Verified partners, LPs, founders, operators' },
  { label: 'Programs & Events', to: '/events', icon: 'events', blurb: 'Cohorts, demo days, LP briefings, office hours' },
  { label: 'Communities & Circles', to: '/circles', icon: 'circles', blurb: 'Closed peer groups on a fixed cadence' },
  { label: 'Jobs', to: '/jobs', icon: 'jobs', blurb: 'Open roles across portfolio companies' },
];

/** The footer's "Build With Us" column. */
export const BUILD_LINKS = [
  { label: 'Firm', to: '/about' },
  { label: 'Spin-Out Lab', to: '/spinout-lab' },
];

/**
 * The footer's legal row. "Cookie preferences" is not a page: it opens the
 * consent dialog `lib/cookieConsent.js` already runs.
 */
export const LEGAL_FOOTER_LINKS = [
  { label: 'Terms', to: '/terms' },
  { label: 'Privacy', to: '/privacy' },
  { label: 'Cookie preferences', action: 'cookies' },
  { label: 'Risk Disclosures', to: '/risk-disclosures' },
];

/** Where the shell's buttons go. */
export const SITE_ACTIONS = {
  apply: '/register',
  lpLogin: '/lp-portal',
  lpLabel: 'LP & Investor workspace',
};

/** The social accounts, as the live footer already links them. */
export const SOCIAL_LINKS = [
  { label: 'Facebook', href: 'https://www.facebook.com/axalvc' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/company/axalvc' },
  { label: 'X', href: 'https://twitter.com/axalvc' },
  { label: 'Instagram', href: 'https://www.instagram.com/axalvc' },
  { label: 'YouTube', href: 'https://www.youtube.com/@axalvc' },
  { label: 'Telegram', href: 'https://t.me/axalvc' },
  { label: 'TikTok', href: 'https://www.tiktok.com/@axalvc' },
];

/** Every internal path the shell links, for the route guard. */
export function siteLinkPaths() {
  return [
    ...DOOR_LINKS, ...NETWORK_LINKS, ...BUILD_LINKS, ...LEGAL_FOOTER_LINKS,
  ].filter((l) => l.to).map((l) => l.to).concat([SITE_ACTIONS.apply, SITE_ACTIONS.lpLogin]);
}
