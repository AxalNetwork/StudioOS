/**
 * The public site's links, in one place (D674, #1548).
 *
 * The nav, the burger menu and the footer all read these lists, so a page
 * appears in all three or in none. They follow the owner's canvas
 * (`design/canvases/integrated/Axal VC Website.dc.html`, NAV and FOOTER), with
 * one rule the canvas cannot know: **a list holds only routes that exist.**
 *
 * Every page the canvas's nav and footer link now exists (D675–D680, #1546):
 * Overview `/resources` heads NETWORK_LINKS (D679); Intelligence, Methodology
 * and Administrators complete BUILD_LINKS (D677, D678). A page added later
 * adds its entry here in the same PR that adds its route.
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
 * The Network menu, the footer's "Network" column and the Network pages'
 * sub-nav (`components/site/NetworkSubNav.jsx`). `icon` names a lucide-react
 * icon that `PublicNav` and `NetworkSubNav` map to their components.
 */
export const NETWORK_LINKS = [
  { label: 'Overview', to: '/resources', icon: 'overview', blurb: 'The network at a glance' },
  { label: 'Articles', to: '/articles', icon: 'articles', blurb: 'Writing on formation and pre-seed underwriting' },
  { label: 'Directory', to: '/directory', icon: 'directory', blurb: 'Operating partners listed in the network' },
  { label: 'Programs & Events', to: '/events', icon: 'events', blurb: 'Cohorts, demo days, LP briefings, office hours' },
  { label: 'Communities & Circles', to: '/circles', icon: 'circles', blurb: 'Closed peer groups on a fixed cadence' },
  { label: 'Jobs', to: '/jobs', icon: 'jobs', blurb: 'Open roles across portfolio companies' },
];

/** The footer's "Build With Us" column. */
export const BUILD_LINKS = [
  { label: 'Firm', to: '/about' },
  { label: 'Spin-Out Lab', to: '/spinout-lab' },
  { label: 'Intelligence', to: '/intelligence' },
  { label: 'Methodology', to: '/methodology' },
  { label: 'Administrators', to: '/administrators' },
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

/** The social accounts, as the live footer already links them. `key` is the BrandIcon key (D687): the footer looks up by it, never by label. */
export const SOCIAL_LINKS = [
  { key: 'facebook', label: 'Facebook', href: 'https://www.facebook.com/axalvc' },
  { key: 'linkedin', label: 'LinkedIn', href: 'https://www.linkedin.com/company/axalvc' },
  { key: 'x', label: 'X', href: 'https://twitter.com/axalvc' },
  { key: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/axalvc' },
  { key: 'youtube', label: 'YouTube', href: 'https://www.youtube.com/@axalvc' },
  { key: 'telegram', label: 'Telegram', href: 'https://t.me/axalvc' },
  { key: 'tiktok', label: 'TikTok', href: 'https://www.tiktok.com/@axalvc' },
];

/** Every internal path the shell links, for the route guard. */
export function siteLinkPaths() {
  return [
    ...DOOR_LINKS, ...NETWORK_LINKS, ...BUILD_LINKS, ...LEGAL_FOOTER_LINKS,
  ].filter((l) => l.to).map((l) => l.to).concat([SITE_ACTIONS.apply, SITE_ACTIONS.lpLogin]);
}
