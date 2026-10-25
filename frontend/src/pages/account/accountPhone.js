/**
 * D700 (#1662) — the account menu's ten pages on a phone, and `/account` as a
 * tappable index of its sections. The canvases are `Account Menu · Mobile.dc.html`
 * (AM) and `Account Mobile Page.dc.html` (AMP), boards A1m–A10m.
 *
 * This file is the pure half: each board's title, sub and section titles, the
 * A1m index rows, the plan and Following lines those rows read, and the
 * `/account` address rules. Nothing here fetches or renders, so each rule is
 * proved on its own in `frontend/test/account_phone_d700.test.mjs`.
 *
 * The breakpoint is not decided here. A page asks `usePhoneWidth()`
 * (`ui/phone/usePhoneWidth.js`, D699), the one hook over `PHONE_QUERY`, and
 * hands the answer to these functions as `phone`.
 */
import { TIER_PLANS } from '../../components/PaywallModal';
import { planSummary } from './accountCenterModel';
import { codeWord } from './connectorsModel.js';
import { usagePathFor } from './limitsModel.js';

/**
 * Each board's title, sub and section titles, byte for byte from AMP's
 * `PAGES` table. Where a page departs from its board (D700 decision 10), the
 * page says so beside the departure; the copy here stays the canvas's, and
 * the D700 test parses the canvas to hold it.
 */
export const ACCOUNT_PHONE_PAGES = {
  account: {
    route: '/account', title: 'Account', sub: 'Settings you manage for yourself.',
    sections: ['Settings', 'Developer'],
  },
  usage: {
    route: '/account/usage', title: 'Usage', sub: 'What you have used across all your companies.',
    sections: ['AI allowance', 'Models this month', 'Storage'],
  },
  connectors: {
    route: '/account/connectors', title: 'Connectors', sub: 'Bring your tools in, and send your work back to them.',
    sections: ['Yours', 'Suggested for you'],
  },
  trust: {
    route: '/trust/me', title: 'Trust Center', sub: 'Your obligations and verification, for your role.',
    sections: ['Trust score', 'Obligations'],
  },
  perks: {
    route: '/perks', title: 'Perks', sub: 'Claim offers with credits, or by your plan.',
    sections: ['Credits', 'Live perks', 'My perks'],
  },
  calendar: {
    route: '/calendar', title: 'Calendar', sub: 'Your sessions, office hours and events.',
    sections: ['Today', 'This week', 'Sources'],
  },
  events: {
    route: '/my/events', title: 'Events', sub: 'Workshops, office hours, LP briefings and Demo Day.',
    sections: ['Upcoming', 'Past'],
  },
  learning: {
    route: '/learning', title: 'Learning', sub: 'Courses, videos, webinars and articles.',
    sections: ['Continue learning', 'My programs', 'Upcoming webinars', 'Browse'],
  },
  help: {
    route: '/help', title: 'Help Center', sub: 'Guides for what you are working on.',
    sections: ['For you now', 'Guides', 'Contact'],
  },
  pricing: {
    route: '/pricing', title: 'Plans & Pricing', sub: 'Pay for the cycles you are in. Each step keeps everything below it.',
    sections: ['Plans', 'Tokens'],
  },
};

/** The section A1m adds below the canvas's two (decision 6): the three panes the board does not draw. */
export const MORE_SECTION = 'More';

/**
 * Row copy the boards write as facts, not placeholders, used where a page
 * draws the same row.
 */
export const ACCOUNT_PHONE_COPY = {
  heldTitle: 'Held by runs in progress',
  heldDescription: 'Returned if a run does not finish in 5 minutes',
  topUpTitle: 'Top-up balance',
  topUpDescription: 'Runs use your allowance first, then your top-up',
  addTokens: 'Add tokens',
  modelsNote: 'Estimated from the run log. Runs still in progress are not in these yet.',
  allFiles: 'All your files',
  noSizeFiles: 'Files with no size recorded',
  browseConnectors: 'Browse connectors',
};

// ---------------------------------------------------------------------------
// The `/account` addresses (decision 7)
// ---------------------------------------------------------------------------

/**
 * Map a deep-link URL path → preselected section id. The page is mounted
 * at both `/account` (top-level) and `/account/:section` so the bell can
 * land users directly on the notification matrix. Moved here from
 * `SettingsPage.jsx` unchanged (D700), so the map and the rules are tested
 * together.
 */
export const PATH_TO_SECTION = {
  notifications: 'notifications',
  onboarding: 'onboarding',
  profile: 'account',
  account: 'account',
  // D1134 (#2422) — Companies and projects.
  companies: 'companies',
  security: 'security-privacy',
  privacy: 'security-privacy',
  'security-privacy': 'security-privacy',
  // D651 — the old name still resolves; App.jsx redirects it first, with
  // the once-only "Integrations are now Connectors" notice.
  integrations: 'connectors',
  connectors: 'connectors',
  billing: 'billing',
  appearance: 'appearance',
  // D568 — the two new sections, the canvas's own anchors for the renamed
  // ones (`/account#sign-in`, `#billing` in ops-data.js), and Activity Log,
  // which the nav could open but a reload of its URL could not.
  following: 'following',
  developer: 'developer',
  usage: 'usage',
  'sign-in': 'security-privacy',
  orders: 'billing',
  activity: 'activity',
  // Back-compat: old deep links still resolve to a sensible new tab.
  jurisdictions: 'account',
  email: 'account',
  auth: 'security-privacy',
  role: 'account',
};

/**
 * What the address opens: `'index'` (a phone's bare `/account`) or a section
 * id. Read on every path or hash change, never once at mount: `/account` and
 * `/account/:section` render the same component, so React keeps the page
 * mounted when the path moves between them.
 *
 * Both prefixes: `/settings/:section` still renders the page for one hop via
 * App.jsx's redirect, and a deep link must resolve its section on that render.
 * Account recovery sends the reader to `/account#security-recovery-codes`
 * (auth_recover.ts); that card is on the sign-in pane, so the anchor opens it.
 */
export function accountViewFor({ pathname = '', hash = '', phone = false } = {}) {
  const m = String(pathname).match(/^\/(?:account|settings)\/([^/]+)/);
  if (m && PATH_TO_SECTION[m[1]]) return PATH_TO_SECTION[m[1]];
  if (hash === '#security-recovery-codes') return 'security-privacy';
  return phone ? 'index' : 'account';
}

/**
 * D753 — the connector key in `/account/connectors/<key>`: the segment
 * lowercased, when it is a code word of 1 to 40 characters (the Worker's
 * `CONNECTOR_KEY_RE` cap); null for anything else, which canonicalises to the
 * hub.
 */
export function connectorKeyFor(pathname = '') {
  const m = String(pathname).match(/^\/account\/connectors\/([^/]+)\/?$/);
  if (!m) return null;
  // D756 §1.11: Telegram's page is `telegram`; the decision's first slug lands there (replace, by the canonicalising effect).
  if (m[1].toLowerCase() === 'telegram-business') return 'telegram';
  const k = codeWord(m[1].toLowerCase());
  return k && k.length <= 40 ? k : null;
}

/**
 * The canonical path for a view. On desktop the profile pane IS the page, so
 * it has no segment of its own (`/account`, never `/account/account`). On a
 * phone bare `/account` is the index, so the profile pane is `/account/profile`.
 * D753 — Connectors with a valid `key` is that connector's page.
 * D807 — Usage with `usagePage` is that Usage page (`/account/usage/limits`).
 */
export function accountPathFor({ section, phone = false, key = null, usagePage = null } = {}) {
  if (section === 'connectors' && key && connectorKeyFor(`/account/connectors/${key}`) === key) return `/account/connectors/${key}`;
  if (section === 'usage' && usagePage) return usagePathFor(usagePage);
  if (section === 'index') return '/account';
  if (section === 'account' || section === 'profile') return phone ? '/account/profile' : '/account';
  return `/account/${section}`;
}

// ---------------------------------------------------------------------------
// The A1m index (decisions 6 and 11)
// ---------------------------------------------------------------------------

export const FOLLOWING_FALLBACK = 'People and companies you follow';
export const PLAN_FALLBACK = 'Your plan, orders and invoices';
export const NO_PLAN = 'No subscription plan applies';
/** `GET /follows/mine` reads at most this many follow rows (`follows.ts`, `LIMIT 500`). */
export const FOLLOWS_LIMIT = 500;

/**
 * The Following row's description from `GET /follows/mine` ({ users, projects }).
 * No number while the read loads or fails. At the route's limit the read has
 * stopped counting, so the row says "500+".
 */
export function followingLine(follows) {
  const d = follows?.status === 'ready' ? follows.data : null;
  if (!d || !Array.isArray(d.users) || !Array.isArray(d.projects)) return FOLLOWING_FALLBACK;
  const n = d.users.length + d.projects.length;
  if (n >= FOLLOWS_LIMIT) return `${FOLLOWS_LIMIT}+ people and companies`;
  return n === 1 ? '1 person or company' : `${n} people and companies`;
}

/**
 * The Billing row's description. A founder's paid tier reads by D683's name
 * (`TIER_PLANS`); the free tier reads "Free". Every other role reads
 * `planSummary`'s plan and tier, or the Billing pane's own words when no plan
 * applies. D1050 (#2901): no row here carries a price; the Billing pane reads
 * it from the plans read.
 */
export function planLine(role, billing) {
  if (billing?.status !== 'ready' || !billing.data || typeof billing.data !== 'object') return PLAN_FALLBACK;
  const r = String(role || '').toLowerCase();
  if (r === 'founder') {
    const tier = String(billing.data.tier || 'free').toLowerCase();
    if (tier === 'free') return 'Free';
    const plan = TIER_PLANS[tier];
    if (plan) return plan.label;
  }
  const s = planSummary(r, billing.data);
  if (!s) return PLAN_FALLBACK;
  if (!s.plan) return NO_PLAN;
  return s.tier ? `${s.plan} · ${s.tier}` : s.plan;
}

/**
 * A1m's rows: the canvas's Settings section, Developer for the one role
 * `SECTIONS` admits, and More for the three panes the board does not draw.
 * Usage and Connectors are not repeated: they are A2m and A3m, opened from
 * the account sheet (founders) or the user menu (everyone else).
 */
export function accountIndexGroups({ role, follows, billing } = {}) {
  const groups = [
    {
      label: 'Settings',
      rows: [
        { title: 'Profile and identity', description: 'Personal details, identity, company profile', to: accountPathFor({ section: 'account', phone: true }) },
        { title: 'Companies and projects', description: 'Your companies, projects and invitations', to: '/account/companies' },
        { title: 'Notifications', description: 'Each type, in-app, email and push', to: '/account/notifications' },
        { title: 'Sign-in and security', description: 'Password, authenticator app, SMS', to: '/account/security-privacy' },
        { title: 'Billing and orders', description: planLine(role, billing), to: '/account/billing' },
        { title: 'Following', description: followingLine(follows), to: '/account/following' },
      ],
    },
  ];
  if (String(role || '').toLowerCase() === 'admin') {
    groups.push({
      label: 'Developer',
      // Reworded (decision 10): the board's "Shown when developer mode is on"
      // names a switch that does not exist. The admin role is the switch.
      rows: [{ title: 'API and search indexes', description: 'Feature flags, account fields and the search indexes', to: '/account/developer' }],
    });
  }
  groups.push({
    label: MORE_SECTION,
    rows: [
      { title: 'Onboarding', to: '/account/onboarding' },
      { title: 'Appearance', to: '/account/appearance' },
      { title: 'Activity Log', to: '/account/activity' },
    ],
  });
  return groups;
}
