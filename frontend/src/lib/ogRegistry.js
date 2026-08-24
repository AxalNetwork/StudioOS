/**
 * Canonical Open Graph / social-preview metadata for every public route.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * axal.vc is a Vite SPA. Every route is served by the *same* `index.html`
 * (worker static assets, `not_found_handling = "single-page-application"`), so
 * every route used to advertise the same `og:title` and the same `og:image`.
 * Link-preview crawlers — WhatsApp, iMessage, Facebook, LinkedIn, Slack — do
 * not execute JavaScript, so the client-side `usePageMeta()` updates in
 * `seo.js` were invisible to them: they only ever read the static shell.
 *
 * This module is the single source of truth for what each route should
 * advertise. Three consumers read it, which is what keeps them in agreement:
 *
 *   1. `scripts/prerender-og.mjs`  — bakes the tags into per-route HTML at
 *      build time, so crawlers get correct tags in the raw HTTP response.
 *   2. `usePageMeta()` in `seo.js` — applies the same values client-side, so
 *      in-app navigation and the browser tab stay consistent.
 *   3. `scripts/validate-og-tags.mjs` — asserts the built output actually
 *      carries them, and fails CI when a route drifts.
 *
 * Copy here is deliberately grounded in what the pages actually say. When you
 * add a route, add its entry here — do not inline meta tags anywhere else.
 */
// NB: the `.js` extension is required — plain Node ESM (the build scripts) does
// not resolve extensionless specifiers the way Vite does.
import { OG_MANIFEST } from './ogManifest.js';

/*
 * DEPENDENCY NOTE — this module imports nothing but the generated manifest, on
 * purpose. Build scripts (`prerender-og.mjs`, `validate-og-tags.mjs`) import it
 * from plain Node with no `node_modules` present, so it must not reach into the
 * React tree. That is also why the four audience-page descriptions below are
 * inlined rather than imported from `../data/productPages`: that module pulls
 * `./pricing` → `../components/PaywallModal`, which drags in React.
 *
 * The copy is therefore duplicated, and duplicated copy drifts — so
 * `validate-og-tags.mjs` re-reads `productPages.js` as *source text* and fails
 * the build if the two ever disagree.
 */

export const SITE_URL = 'https://axal.vc';

/**
 * NOTE — the codebase disagrees with itself about the site name: the static
 * `frontend/index.html` shipped `og:site_name = "Global Venture Partner
 * Network"` while `seo.js` used "Axal VC StudioOS". We standardise on the
 * `seo.js` value because that is what the running app applies today; changing
 * the public brand string is a product decision, not a metadata fix.
 */
export const SITE_NAME = 'Axal VC StudioOS';

/** Where generated cards live, relative to the site root. */
export const OG_IMAGE_DIR = '/og';

/** Last-resort sitewide card. Should rarely be the resolved image. */
export const DEFAULT_OG_KEY = 'default';

/**
 * Section defaults. A route that has no card of its own resolves to its
 * section's card rather than to one sitewide image — so /articles/<slug> looks
 * like an article, not like the homepage.
 */
export const SECTION_OG_KEYS = {
  home: 'home',
  'spinout-lab': 'spinout-lab',
  product: 'product',
  content: 'content',
  company: 'company',
};

/**
 * Public routes, in sitemap order.
 *
 * - `path`        exact pathname (no trailing slash except the root)
 * - `title`       page-specific, WITHOUT the site-name suffix
 * - `description` page-specific, 1–2 sentences
 * - `key`         card image key → `/og/<key>.png`; omit to inherit the section
 * - `type`        og:type
 * - `section`     drives the fallback card and prefix matching
 * - `prefix`      when true, sub-paths (`/articles/whatever`) inherit this entry
 */
const ROUTES = [
  {
    path: '/',
    title: 'From idea to funded company',
    description:
      'One network connecting partners, capital, and founders. Spin-Out Lab takes companies from idea to funded in 28 days.',
    key: 'home',
    type: 'website',
    section: 'home',
  },
  {
    path: '/spinout-lab',
    title: 'Spin-Out Lab',
    description:
      'A structured sprint that takes a company from idea to incorporated and funded — customer discovery, venture-readiness scoring, entity formation, and demo day.',
    key: 'spinout-lab',
    type: 'website',
    section: 'spinout-lab',
    prefix: true,
  },

  // ---- Audience product pages -------------------------------------------
  // Mirrors PRODUCT_PAGES[*].meta in `../data/productPages.js` verbatim.
  // Kept in sync by the cross-check in `scripts/validate-og-tags.mjs`.
  {
    path: '/for-founders',
    title: 'For Founders',
    description:
      'Everything you need to go from idea to funded — a startup workspace, pitch deck builder, venture-readiness scoring, and warm investor intros on the Axal VC network.',
    key: 'product-founders',
    type: 'website',
    section: 'product',
  },
  {
    path: '/for-investors',
    title: 'For Investors & LPs',
    description:
      'Source, screen and diligence better deals in less time. AI scoring, a built-in CRM, warm founder intros and portfolio visibility for angels, funds and LPs.',
    key: 'product-investors',
    type: 'website',
    section: 'product',
  },
  {
    path: '/for-service-partners',
    title: 'For Service Partners',
    description:
      'List your services in the Axal VC marketplace, get in front of funded founders, and turn network trust into inbound leads. Distribution for legal, design, GTM and technical partners.',
    key: 'product-service-partners',
    type: 'website',
    section: 'product',
  },
  {
    path: '/for-advisors',
    title: 'For Advisors',
    description:
      'Build a credible advisor profile, get matched with founders who need your expertise, and run sessions through structured office hours on the Axal VC network.',
    key: 'product-advisors',
    type: 'website',
    section: 'product',
  },

  // ---- Company / conversion ---------------------------------------------
  {
    path: '/pricing',
    title: 'Pricing',
    description:
      'Simple, transparent pricing for founders and investors. Start free, upgrade when you raise.',
    key: 'pricing',
    type: 'website',
    section: 'company',
  },
  {
    path: '/demo',
    title: 'Book a demo',
    description:
      'See Axal VC StudioOS live — pick a product demo, investor brief, or partnership intro.',
    type: 'website',
    section: 'company',
  },
  {
    path: '/about',
    title: 'About',
    description:
      'Who we are, how the studio operates, and why we build companies alongside the founders we back.',
    type: 'website',
    section: 'company',
  },
  {
    path: '/contact',
    title: 'Contact',
    description: 'Talk to the Axal VC team — founders, investors, advisors, and service partners.',
    type: 'website',
    section: 'company',
  },

  // ---- Content surfaces --------------------------------------------------
  {
    path: '/articles',
    title: 'Articles',
    description:
      'Long-form writing from Axal VC founders, investors, partners, and the studio.',
    key: 'articles',
    type: 'website',
    section: 'content',
    prefix: true,
  },
  {
    path: '/insights',
    title: 'Insights',
    description: 'Data and analysis from across the Axal VC network.',
    type: 'website',
    section: 'content',
    prefix: true,
  },
  {
    path: '/jobs',
    title: 'Jobs',
    description: 'Open roles across Axal VC portfolio companies and the studio.',
    key: 'jobs',
    type: 'website',
    section: 'content',
    prefix: true,
  },
  {
    path: '/events',
    title: 'Events',
    description: 'Demo days, office hours, and community sessions across the Axal VC network.',
    type: 'website',
    section: 'content',
    prefix: true,
  },
  {
    path: '/circles',
    title: 'Circles',
    description: 'Focused communities inside the Axal VC network.',
    type: 'website',
    section: 'content',
    prefix: true,
  },
  {
    path: '/directory',
    title: 'Directory',
    description: 'Browse founders, investors, advisors, and service partners in the network.',
    type: 'website',
    section: 'content',
    prefix: true,
  },
  {
    path: '/authors',
    title: 'Authors',
    description: 'Writers publishing on Axal VC.',
    type: 'profile',
    section: 'content',
    prefix: true,
  },

  // ---- Product transparency ---------------------------------------------
  {
    path: '/changelog',
    title: 'Changelog',
    description: "What's new in Axal VC StudioOS — every shipped change, tagged by audience.",
    type: 'website',
    section: 'company',
  },
  {
    path: '/roadmap',
    title: 'Roadmap',
    description: "What we're building next — vote on the features that matter to you.",
    type: 'website',
    section: 'company',
  },
  {
    path: '/status',
    title: 'System status',
    description: 'Real-time health of Axal VC StudioOS services, plus a 90-day uptime history.',
    type: 'website',
    section: 'company',
  },

  // ---- Legal & compliance -------------------------------------------------
  // Footer-linked from every public page, so after the marketing pages these
  // are the most-crawled URLs on the site — and the ones most often pasted
  // into a chat when someone asks what the terms are.
  {
    path: '/terms',
    title: 'Terms of Service',
    description:
      'The agreement governing use of the Axal VC platform — definitions and parties, acceptance and acknowledgments, and the scope of what the platform does.',
    type: 'website',
    section: 'company',
  },
  {
    path: '/privacy',
    title: 'Privacy Policy',
    description:
      'How Axal VC collects, uses, and protects Non-Public Personal Information, and the privacy role each of the three operating entities plays.',
    type: 'website',
    section: 'company',
  },
  {
    path: '/risk-disclosures',
    title: 'Risk Disclosures & Disclaimers',
    description:
      'Investing in private, early-stage companies carries a high degree of risk and suits only sophisticated investors who can afford to lose their entire investment.',
    type: 'website',
    section: 'company',
  },
  {
    path: '/pricing/investor',
    title: 'Investor plans',
    description:
      'Plans for investors and LPs, and what each tier includes. The investor-side counterpart to the main pricing page.',
    type: 'website',
    section: 'company',
  },

  // ---- Auth entry points --------------------------------------------------
  // /register is a genuinely shared link rather than just a form: referral
  // landings arrive as /register?ref=… (see the apex routing notes in
  // wrangler.toml), so it gets previewed in chat clients far more often than
  // its place in the nav suggests.
  {
    path: '/register',
    title: 'Create your account',
    description:
      'Join the Axal VC network as a founder, investor, advisor, or service partner.',
    type: 'website',
    section: 'company',
  },
  {
    path: '/login',
    title: 'Sign in',
    description: 'Sign in to Axal VC StudioOS.',
    type: 'website',
    section: 'company',
  },

  // ---- Audience landing pages (/lp/*) ------------------------------------
  // Full public marketing pages — PublicNav, PublicFooter, hero, metrics
  // strip, FAQ — not app surfaces that happen to be ungated. They are built
  // to be shared, and until now every one of them previewed as the homepage.
  // Copy below is taken from each page's own hero.
  {
    path: '/lp/investor',
    title: 'The most disciplined dealflow in frontier tech',
    description:
      'Every company scored, verified, and sanctions-screened before it reaches your desk. We screen everything so you see only what matters.',
    type: 'website',
    section: 'product',
  },
  {
    path: '/lp/founder',
    title: 'Build something worth funding',
    description:
      'From idea to investor-ready in 28 days. One platform covering everything — legal, product, team, and capital.',
    type: 'website',
    section: 'product',
  },
  {
    path: '/lp/partner',
    title: 'Join the network that builds',
    description:
      "Axal VC's Global Venture Partner Network connects service providers, investors, advisors, and operators with the best early-stage companies in frontier technology.",
    type: 'website',
    section: 'product',
  },
  {
    path: '/lp/customer-discovery',
    title: "We're building what you need",
    description:
      "Customer discovery for Axal VC's next product cycle. If you're a founder, operator, or investor, we want 20 minutes of your time.",
    type: 'website',
    section: 'product',
  },
  {
    path: '/lp/spinout-demo-day',
    title: 'Spin-Out Lab Demo Day',
    description:
      'Evidence-led and founder-honest — no polished pitches, just real companies showing real work at the end of a 28-day sprint.',
    type: 'website',
    section: 'spinout-lab',
  },
];

export const OG_ROUTES = ROUTES;

/** Every distinct card key the generator must render. */
export function ogImageKeys() {
  const keys = new Set([DEFAULT_OG_KEY, ...Object.values(SECTION_OG_KEYS)]);
  for (const r of ROUTES) if (r.key) keys.add(r.key);
  return [...keys];
}

/** Normalise a pathname: strip query/hash and any trailing slash (except root). */
export function normalisePath(pathname) {
  if (!pathname || typeof pathname !== 'string') return '/';
  let p = pathname.split('?')[0].split('#')[0];
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '') || '/';
  return p;
}

/**
 * Resolve the registry entry for a pathname.
 *
 * Exact match wins; otherwise the longest `prefix: true` entry whose path is a
 * true path-segment prefix (so `/jobs-board` never matches `/jobs`). Returns
 * null when nothing matches — callers fall back to the sitewide default.
 */
export function ogEntryFor(pathname) {
  const p = normalisePath(pathname);
  const exact = ROUTES.find((r) => r.path === p);
  if (exact) return exact;

  let best = null;
  for (const r of ROUTES) {
    if (!r.prefix || r.path === '/') continue;
    if (p === r.path || p.startsWith(`${r.path}/`)) {
      if (!best || r.path.length > best.path.length) best = r;
    }
  }
  return best;
}

/**
 * Fallback hierarchy for the card image, highest priority first:
 *
 *   1. an explicit absolute/rooted image passed by the caller (a curated card
 *      for one specific page or post)
 *   2. the page's own generated card          (`entry.key`)
 *   3. the section's generated card           (`SECTION_OG_KEYS[entry.section]`)
 *   4. the sitewide brand card                (`DEFAULT_OG_KEY`)
 *
 * Levels 2–4 are all real files produced by `scripts/generate-og-images.mjs`,
 * so level 4 should be rare in practice rather than the universal answer it
 * used to be.
 */
export function ogImageKeyFor(entry) {
  if (entry?.key) return entry.key;
  const sectionKey = entry?.section ? SECTION_OG_KEYS[entry.section] : null;
  return sectionKey || DEFAULT_OG_KEY;
}

/** Absolute, cache-busted URL for a card key. */
export function ogImageUrl(key) {
  const version = OG_MANIFEST[key];
  const q = version ? `?v=${version}` : '';
  return `${SITE_URL}${OG_IMAGE_DIR}/${key}.png${q}`;
}

/** Absolute URL for a site path. */
export function absoluteUrl(pathname) {
  return `${SITE_URL}${normalisePath(pathname)}`;
}

/**
 * The complete tag set for a route — the one function every consumer calls, so
 * prerendered HTML, the client-side hook, and the validator cannot disagree.
 *
 * `overrides.image` accepts a rooted path or absolute URL and takes priority
 * over every generated card (fallback level 1). That is the hook a CMS entry or
 * a hand-curated post card uses.
 */
export function ogTagsFor(pathname, overrides = {}) {
  const path = normalisePath(pathname);
  const entry = ogEntryFor(path);

  const title = overrides.title || entry?.title || SITE_NAME;
  const fullTitle = title === SITE_NAME ? SITE_NAME : `${title} — ${SITE_NAME}`;
  const description = overrides.description || entry?.description || '';
  const type = overrides.type || entry?.type || 'website';

  let image;
  if (overrides.image) {
    image = /^https?:\/\//i.test(overrides.image)
      ? overrides.image
      : `${SITE_URL}${overrides.image.startsWith('/') ? '' : '/'}${overrides.image}`;
  } else {
    image = ogImageUrl(ogImageKeyFor(entry));
  }

  return {
    path,
    title: fullTitle,
    description,
    url: absoluteUrl(path),
    image,
    type,
    siteName: SITE_NAME,
    card: 'summary_large_image',
    imageAlt: title,
  };
}
