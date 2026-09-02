/**
 * frontend/src/workspaces/shellConfig.js — the four workspace shells, as data.
 *
 * WHAT THIS IS. Every route the Founder, Investor/LP, Advisor and
 * Partner/Operator canvases propose, in one place, in canvas order. The
 * sidebar reads it, the router reads it, and a guard test asserts that every
 * zone named here is actually registered in App.jsx — so a row can never
 * advertise a door that does not open.
 *
 * WHY IT IS DATA AND NOT COMPONENTS. Each shell is the same shape: eight
 * sidebar rows, of which five or six are buckets, and each bucket is a short
 * list of zones. The canvases differ in their content, not their structure.
 * Encoding the structure once means adding a zone is a line here plus a route,
 * rather than a new tab bar per bucket — which is how the app ended up with
 * FounderWorkspaceTabs, PartnerWorkspaceTabs, WorkspaceTabs and three bespoke
 * investor workspaces all solving the same problem four ways.
 *
 * THE ARCHETYPES are the canvases' own taxonomy and they are load-bearing, not
 * decoration: a zone's archetype says what kind of surface it is, and the six
 * badge colours are identical across all eighteen canvas files. They are
 * carried here so a page cannot drift from the canvas that specifies it.
 *
 * WHAT IS DELIBERATELY ABSENT. Spin-Out Lab keeps its own route tree and is
 * referenced only as a sidebar row target — no Lab route is defined, renamed
 * or re-bucketed here. Axal VC Fund is the same: one row, one target, no
 * zones. Both are read-only as far as this file is concerned.
 *
 * ROUTE OWNERSHIP. `/network/*` and `/research/*` are shared paths whose zone
 * list differs per role — the same arrangement `/network` already has today,
 * where one route role-branches its element. Every other bucket prefix belongs
 * to exactly one shell.
 */

// The six archetypes, with the badge palette every canvas file uses verbatim:
// [background, ink, border]. Do not re-derive these per surface.
export const ARCHETYPE = {
  WORK_BOARD:   { label: 'WORK BOARD',   colors: ['#eff6ff', '#1d4ed8', '#dbeafe'] },
  LEDGER:       { label: 'LEDGER',       colors: ['#f5f5ff', '#3730a3', '#c7d2fe'] },
  COLLECTION:   { label: 'COLLECTION',   colors: ['#f0fdf6', '#065f46', '#a7f3d0'] },
  FEED:         { label: 'FEED',         colors: ['#fffbeb', '#92400e', '#fde68a'] },
  MATCH_ENGINE: { label: 'MATCH ENGINE', colors: ['#fdf4ff', '#86198f', '#f5d0fe'] },
  ANALYTICS:    { label: 'ANALYTICS',    colors: ['#f0fdff', '#0e7490', '#a5edf5'] },
};

// Per-role accent. Cyan (#0e7490) is NOT in this map and never will be: it is
// reserved system-wide for founder-sourced objects — the seam — so a product
// accent can never be mistaken for provenance. ANALYTICS owns that hue as an
// archetype badge only, which is why that badge never carries a seam legend.
//
// `deepDark`/`tintDark` are the same accent on a dark ground, and they are not
// a lightness flip of the light pair. The Investor canvas states the reason:
// "Indigo lifts to indigo-400 on dark. Violet-600 and indigo-600 are
// indistinguishable at low luminance, so the accent has to move for the two
// licences to stay legible apart." Each is the 400 weight of its own hue, which
// is what `ui/workerRail.css` and every investor page's `.dark` block already
// use independently — this table is now the single place they come from.
export const ACCENT = {
  founder:  { ink: '#7c3aed', deep: '#6d28d9', tint: '#f5f3ff', border: '#ddd6fe', deepDark: '#a78bfa', tintDark: '#241d38' },
  investor: { ink: '#4f46e5', deep: '#4338ca', tint: '#eef2ff', border: '#c7d2fe', deepDark: '#818cf8', tintDark: '#211f3d' },
  advisor:  { ink: '#047857', deep: '#065f46', tint: '#f0fdf6', border: '#a7f3d0', deepDark: '#34d399', tintDark: '#0d2b22' },
  partner:  { ink: '#b45309', deep: '#92400e', tint: '#fffbf2', border: '#fde68a', deepDark: '#fbbf24', tintDark: '#2b210d' },
};

export const SEAM = { ink: '#0e7490', tint: '#f0fdff', border: '#a5edf5' };

const A = ARCHETYPE;

/**
 * Zones shared by more than one shell.
 *
 * `/network/*` is identical in all four: a relationship book, a double-opt-in
 * introduction pipeline, and an organizations roll-up. The three canvases that
 * specify it (Investor, Advisor, Partner) agree on the zone names, the
 * archetypes and the consent-gate semantics, so it is defined once.
 */
const NETWORK_ZONES = [
  { slug: 'relationships', label: 'Relationships', archetype: A.COLLECTION },
  { slug: 'introductions', label: 'Introductions', archetype: A.MATCH_ENGINE },
  { slug: 'organizations', label: 'Organizations', archetype: A.COLLECTION },
];

/**
 * `/research/*` is shared but its zone list is genuinely per-role — each
 * license researches a different world. Ask and Library are common to all four
 * and are one system in every canvas: what is indexed in Library is exactly
 * what Ask can answer over.
 *
 * NOTE on `markets`: the Partner canvas named this zone `market` (singular)
 * while Founder, Investor and Advisor all use `markets`. One path, one
 * spelling — normalised to the plural the other three already share.
 */
const RESEARCH_ZONES = {
  founder: [
    { slug: 'ask', label: 'Ask', archetype: A.FEED },
    { slug: 'markets', label: 'Markets', archetype: A.ANALYTICS },
    { slug: 'companies', label: 'Companies', archetype: A.COLLECTION },
    { slug: 'funds', label: 'Funds', archetype: A.COLLECTION },
    { slug: 'library', label: 'Library', archetype: A.COLLECTION },
  ],
  investor: [
    { slug: 'ask', label: 'Ask', archetype: A.FEED },
    { slug: 'diligence', label: 'Diligence', archetype: A.COLLECTION },
    { slug: 'benchmarking', label: 'Benchmarking', archetype: A.ANALYTICS },
    { slug: 'markets', label: 'Markets', archetype: A.ANALYTICS },
    { slug: 'library', label: 'Library', archetype: A.COLLECTION },
  ],
  advisor: [
    { slug: 'ask', label: 'Ask', archetype: A.FEED },
    { slug: 'client-prep', label: 'Client prep', archetype: A.WORK_BOARD },
    { slug: 'markets', label: 'Markets', archetype: A.ANALYTICS },
    { slug: 'companies', label: 'Companies', archetype: A.COLLECTION },
    { slug: 'library', label: 'Library', archetype: A.COLLECTION },
  ],
  partner: [
    { slug: 'ask', label: 'Ask', archetype: A.FEED },
    { slug: 'client-prep', label: 'Client prep', archetype: A.WORK_BOARD },
    { slug: 'markets', label: 'Markets', archetype: A.ANALYTICS },
    { slug: 'library', label: 'Library', archetype: A.COLLECTION },
  ],
};

/**
 * SHELLS — eight rows per role, in canvas order.
 *
 * A row is either a BUCKET (has `zones`, owns a route prefix) or a LINK (one
 * destination, no zones — Home, Spin-Out Lab, Axal VC Fund, Trust, Settings).
 *
 * `legacy` on a zone names the live route that answers this concept today, so
 * the router can redirect the old URL instead of stranding every inbound link
 * in the app. A zone with no `legacy` is new ground.
 */
export const SHELLS = {
  founder: {
    accent: 'founder',
    rows: [
      { kind: 'link', label: 'Home', to: '/studio' },
      // Spin-Out Lab keeps its own tree. One row, one target, nothing below it.
      { kind: 'link', label: 'Spin-Out Lab', to: '/spinout-lab', untouched: true },
      { kind: 'bucket', label: 'Validate', prefix: '/validate', tagline: 'Know it is real',
        zones: [
          { slug: 'interviews', label: 'Interviews', archetype: A.COLLECTION, legacy: '/build/discovery?tab=interviews' },
          { slug: 'pain-map', label: 'Pain map', archetype: A.ANALYTICS, legacy: '/build/discovery?tab=insights' },
          { slug: 'hypotheses', label: 'Hypotheses', archetype: A.WORK_BOARD },
          { slug: 'verdict', label: 'Verdict', archetype: A.LEDGER },
        ] },
      { kind: 'bucket', label: 'Build', prefix: '/build', tagline: 'Ship it',
        zones: [
          { slug: 'this-week', label: 'This week', archetype: A.WORK_BOARD },
          { slug: 'board', label: 'Board', archetype: A.WORK_BOARD },
          { slug: 'roadmap', label: 'Roadmap', archetype: A.WORK_BOARD },
          { slug: 'cadence', label: 'Cadence', archetype: A.FEED },
          { slug: 'metrics', label: 'Metrics', archetype: A.ANALYTICS },
        ] },
      { kind: 'bucket', label: 'Raise', prefix: '/raise', tagline: 'Fund it',
        zones: [
          { slug: 'pitch', label: 'Pitch', archetype: A.COLLECTION },
          { slug: 'data-room', label: 'Data room', archetype: A.COLLECTION },
          { slug: 'capital', label: 'Capital', archetype: A.LEDGER },
          { slug: 'legal', label: 'Legal', archetype: A.LEDGER, legacy: '/raise/legal-engine' },
          { slug: 'status', label: 'Status', archetype: A.ANALYTICS },
        ] },
      { kind: 'bucket', label: 'Grow', prefix: '/grow', tagline: 'Compound it',
        zones: [
          { slug: 'focus', label: 'Focus', archetype: A.WORK_BOARD },
          { slug: 'customers', label: 'Customers', archetype: A.MATCH_ENGINE },
          { slug: 'talent', label: 'Talent', archetype: A.MATCH_ENGINE },
          { slug: 'partnerships', label: 'Partnerships', archetype: A.MATCH_ENGINE },
          { slug: 'brand', label: 'Brand', archetype: A.COLLECTION },
        ] },
      { kind: 'bucket', label: 'Network', prefix: '/network', tagline: 'Work the room',
        zones: NETWORK_ZONES },
      { kind: 'bucket', label: 'Research', prefix: '/research', tagline: 'Know the field',
        zones: RESEARCH_ZONES.founder },
    ],
  },

  investor: {
    accent: 'investor',
    rows: [
      { kind: 'link', label: 'Home', to: '/studio' },
      { kind: 'bucket', label: 'Deals', prefix: '/deals', tagline: 'Find and decide',
        zones: [
          { slug: 'pipeline', label: 'Pipeline', archetype: A.WORK_BOARD, legacy: '/pipeline' },
          { slug: 'screening', label: 'Screening', archetype: A.MATCH_ENGINE, legacy: '/pipeline/screening' },
          { slug: 'commit', label: 'Commit', archetype: A.WORK_BOARD, legacy: '/pipeline/commit' },
          // The route said "transactions"; InvestorDealsWorkspace's own nav has
          // always said "Closing". The component wins — it is what renders.
          { slug: 'closing', label: 'Closing', archetype: A.LEDGER, legacy: '/pipeline/transactions' },
        ] },
      { kind: 'bucket', label: 'Portfolio', prefix: '/portfolio', tagline: 'Hold and help',
        zones: [
          // Three names still point at two pages — "Positions" (canvas),
          // "Health" (route) and "Cap Table" (the generic tab bar) — and
          // settling that vocabulary is a content decision. What is settled:
          // `/portfolio` is the OVERVIEW, `/portfolio/positions` is the book,
          // and `/portfolio/health` is the overview's legacy alias. So
          // `positions` carries no `legacy` — it used to name
          // `/portfolio/health`, which is the overview, not this zone.
          { slug: 'positions', label: 'Positions', archetype: A.LEDGER },
          { slug: 'updates', label: 'Updates', archetype: A.FEED },
          { slug: 'value-add', label: 'Value-add', archetype: A.WORK_BOARD, legacy: '/portfolio/growth' },
        ] },
      // Axal VC Fund — LP participation in Axal's own fund. Not the GP add-on
      // below it, and not touched by this migration.
      { kind: 'link', label: 'Axal VC Fund', to: '/spinout-lab/investor-workspace', untouched: true },
      // PLURAL, and deliberately. This bucket was declared at `/fund`, which
      // documentation/architecture/ROUTE_MAP.md rules out: singular and plural
      // route correctly but sit one letter apart, so a misread lands somewhere
      // real. That stopped being hypothetical once `/fund/accounting` and
      // `/funds/accounting` were both live and rendered different components.
      //
      // The zones are the fund OVERVIEW; `/funds/*` already holds the
      // operations tool (FundOpsWorkspace and its six tabs) and keeps it. The
      // two are not rivals — InvestorFundAccounting says so itself: "IF3 does
      // not reconcile, close periods, export a journal… Open the existing Fund
      // Ops accounting workspace for authorized operations." So `accounting`
      // is `ledger` here — the page's own section heading — leaving
      // `/funds/accounting` to the tool it hands off to, which is what the
      // zone's `legacy` names.
      { kind: 'bucket', label: 'Fund', prefix: '/funds', tagline: 'Run the fund',
        requiredInvestorTier: 'institutional',
        zones: [
          { slug: 'lps', label: 'LPs', archetype: A.COLLECTION },
          { slug: 'calls', label: 'Calls', archetype: A.LEDGER, legacy: '/funds/capital-calls' },
          { slug: 'ledger', label: 'Accounting', archetype: A.LEDGER, legacy: '/funds/accounting' },
          { slug: 'reporting', label: 'Reporting', archetype: A.FEED, legacy: '/lp-reports' },
        ] },
      { kind: 'bucket', label: 'Network', prefix: '/network', zones: NETWORK_ZONES },
      { kind: 'bucket', label: 'Research', prefix: '/research', zones: RESEARCH_ZONES.investor },
      { kind: 'link', label: 'Trust', to: '/trust' },
      { kind: 'link', label: 'Firm Settings', to: '/company-settings' },
    ],
  },

  advisor: {
    accent: 'advisor',
    // The leanest shell by design: no tier gating, no locked row, nothing to
    // upsell. Eight rows — the canvas said seven and listed eight once Cohorts
    // was reconciled against its own depth files.
    rows: [
      { kind: 'link', label: 'Home', to: '/studio' },
      { kind: 'bucket', label: 'Practice', prefix: '/practice', tagline: 'Win and deliver',
        zones: [
          { slug: 'opportunities', label: 'Opportunities', archetype: A.MATCH_ENGINE, legacy: '/advisor/advisory/opportunities' },
          { slug: 'engagements', label: 'Engagements', archetype: A.WORK_BOARD, legacy: '/advisor/advisory/engagements' },
          { slug: 'delivery', label: 'Delivery', archetype: A.WORK_BOARD, legacy: '/advisor/advisory/delivery' },
          { slug: 'sessions', label: 'Sessions', archetype: A.WORK_BOARD },
          { slug: 'earnings', label: 'Earnings', archetype: A.LEDGER },
        ] },
      // Cohorts reads Spin-Out Lab data. Read-only: it owns no Lab route and
      // writes nothing back.
      { kind: 'bucket', label: 'Cohorts', prefix: '/cohorts', tagline: 'Guide the batch',
        readsLab: true,
        zones: [
          { slug: 'founders', label: 'Founders', archetype: A.COLLECTION },
          { slug: 'guidance', label: 'Guidance', archetype: A.WORK_BOARD },
          { slug: 'this-week', label: 'This week', archetype: A.WORK_BOARD },
          { slug: 'calendar', label: 'Calendar', archetype: A.WORK_BOARD },
          { slug: 'outcomes', label: 'Outcomes', archetype: A.ANALYTICS },
        ] },
      { kind: 'bucket', label: 'Expertise', prefix: '/expertise', tagline: 'Be findable',
        zones: [
          { slug: 'profile', label: 'Profile', archetype: A.COLLECTION },
          { slug: 'services', label: 'Services', archetype: A.LEDGER },
          { slug: 'proof', label: 'Proof', archetype: A.COLLECTION },
          { slug: 'thinking', label: 'Thinking', archetype: A.FEED },
          { slug: 'visibility', label: 'Visibility', archetype: A.ANALYTICS },
        ] },
      { kind: 'bucket', label: 'Network', prefix: '/network', zones: NETWORK_ZONES },
      { kind: 'bucket', label: 'Research', prefix: '/research', zones: RESEARCH_ZONES.advisor },
      { kind: 'link', label: 'Trust', to: '/trust' },
      { kind: 'link', label: 'Practice Settings', to: '/company-settings' },
    ],
  },

  partner: {
    accent: 'partner',
    // One license, two delivery modes: a firm that ships projects and an
    // operator who embeds inside the client. Both modes share every page —
    // which is why there is no tier gate anywhere in this shell.
    rows: [
      { kind: 'link', label: 'Home', to: '/studio' },
      { kind: 'bucket', label: 'Pipeline', prefix: '/pipeline', tagline: 'Win the work',
        zones: [
          { slug: 'leads', label: 'Leads', archetype: A.MATCH_ENGINE, legacy: '/needs' },
          { slug: 'proposals', label: 'Proposals', archetype: A.COLLECTION, legacy: '/partner/operations/engagements' },
          { slug: 'negotiations', label: 'Negotiations', archetype: A.WORK_BOARD },
          { slug: 'retainers', label: 'Retainers', archetype: A.LEDGER, legacy: '/partner/operations/portfolio' },
          { slug: 'analytics', label: 'Analytics', archetype: A.ANALYTICS, legacy: '/partner/insights' },
        ] },
      { kind: 'bucket', label: 'Delivery', prefix: '/delivery', tagline: 'Ship the work',
        zones: [
          { slug: 'board', label: 'Board', archetype: A.WORK_BOARD, legacy: '/partner/operations/overview' },
          { slug: 'deliverables', label: 'Deliverables', archetype: A.COLLECTION },
          { slug: 'capacity', label: 'Capacity', archetype: A.ANALYTICS },
          { slug: 'status-reports', label: 'Status reports', archetype: A.FEED },
          { slug: 'health', label: 'Health', archetype: A.WORK_BOARD, legacy: '/partner/operations/performance' },
        ] },
      { kind: 'bucket', label: 'Offers', prefix: '/offers', tagline: 'Package what we sell',
        zones: [
          { slug: 'catalog', label: 'Catalog', archetype: A.LEDGER, legacy: '/services' },
          { slug: 'perk-deals', label: 'Perk deals', archetype: A.LEDGER, legacy: '/perks' },
          { slug: 'visibility', label: 'Visibility', archetype: A.ANALYTICS },
          { slug: 'proof', label: 'Proof', archetype: A.COLLECTION },
          { slug: 'audience-fit', label: 'Audience fit', archetype: A.MATCH_ENGINE },
        ] },
      { kind: 'bucket', label: 'Network', prefix: '/network', zones: NETWORK_ZONES },
      { kind: 'bucket', label: 'Research', prefix: '/research', zones: RESEARCH_ZONES.partner },
      { kind: 'link', label: 'Trust', to: '/trust' },
      { kind: 'link', label: 'Firm Settings', to: '/company-settings' },
    ],
  },
};

/** Every bucket row for a role, in shell order. */
export function bucketsFor(role) {
  const shell = SHELLS[role];
  if (!shell) return [];
  return shell.rows.filter((r) => r.kind === 'bucket');
}

/** The bucket a pathname belongs to, or null. Longest prefix wins. */
export function bucketForPath(role, pathname) {
  const path = String(pathname || '');
  return bucketsFor(role)
    .filter((b) => path === b.prefix || path.startsWith(`${b.prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0] || null;
}

/** The zone within a bucket that a pathname resolves to. Defaults to the first. */
export function zoneForPath(bucket, pathname) {
  if (!bucket) return null;
  const rest = String(pathname || '').slice(bucket.prefix.length).replace(/^\//, '');
  return bucket.zones.find((z) => z.slug === rest) || bucket.zones[0];
}

/** `/prefix/slug` for a zone. The one place a workspace URL is composed. */
export const zonePath = (bucket, zone) => `${bucket.prefix}/${zone.slug}`;

/**
 * Every canonical route this config claims, as flat strings. The guard test
 * reads this and asserts each one is registered in App.jsx — a row that
 * advertises a door the router does not open is the failure this prevents.
 */
export function allZoneRoutes(role) {
  return bucketsFor(role).flatMap((b) => b.zones.map((z) => zonePath(b, z)));
}

/** Legacy → canonical, for the redirects that keep old inbound links alive. */
export function legacyRedirects(role) {
  return bucketsFor(role).flatMap((b) =>
    b.zones
      .filter((z) => z.legacy && !z.legacy.includes('?'))
      .map((z) => ({ from: z.legacy, to: zonePath(b, z) })));
}

export const ROLES_WITH_SHELL = Object.keys(SHELLS);
