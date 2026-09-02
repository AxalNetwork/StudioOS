// Phase B · Prompt 5 — Single source of truth for the role-scoped sidebar.
//
// Each role lists collapsible groups; groups list items. Items keep the
// same { to, icon, label } shape the old App.jsx nav array used so the
// accordion render path is a thin layer on top of the existing routing.
//
// `requiredTier` is forward-looking — Phase C / Prompt 4 will swap the
// `hasTier()` stub for a real subscription-tier check. The call sites in
// App.jsx already gate on it, so the wiring won't change in Phase C.
//
// Conventions:
//   - First group of every role is the "Home" group (always default-open).
//   - Second content group is also default-open on first load.
//   - The trailing "Account" group always carries Activity / Settings /
//     Documentation so users can find them in a predictable place.
//   - Items must not appear in more than one group within a role.

import {
  LayoutDashboard, Target, FileText, Users, DollarSign,
  Ticket, Zap, Handshake, Rocket, UserCircle,
  Globe, Brain, Activity, Shield, ShieldCheck,
  Network, Sparkles, Briefcase, TrendingUp, Layers, Scale,
  MessageSquare, Package, Calendar, Heart, Bookmark, Megaphone, Send,
  Gamepad2, ShieldAlert,
  Inbox, Radar, Wallet, Landmark,
  Mail, Gift, Map,
} from 'lucide-react';

// Task #6 — Real subscription-tier check. Bypass roles
// (admin/partner/investor/advisor) always pass; founders are gated by their
// `subscription_tier` column. Mirrors the worker's `userMeetsTier` helper.
const TIER_RANK = { free: 0, growth: 1, studio: 2 };
const BYPASS_ROLES = new Set(['admin', 'partner', 'investor', 'advisor']);
export function hasTier(user, requiredTier) {
  if (!requiredTier || requiredTier === 'free') return true;
  if (!user) return false;
  if (BYPASS_ROLES.has(String(user.role))) return true;
  // Active Spin-Out Lab members get the Growth-tier tooling their program
  // requires (the Pitch Deck Builder is a REQUIRED week-2 lab deliverable) —
  // capped at 'growth' so the lab does NOT unlock Studio-tier features.
  if (Number(user.spinout_lab_active) === 1 && (TIER_RANK[requiredTier] ?? 0) <= TIER_RANK.growth) return true;
  const have = TIER_RANK[String(user.subscription_tier || 'free').toLowerCase()] ?? 0;
  return have >= (TIER_RANK[requiredTier] ?? 0);
}

// Task #7 (W-2) — Investor tier ladder mirrors the worker's
// `userMeetsInvestorTier`. Bypass roles (admin/partner/advisor) always pass.
// Trialing/active are honoured via the `investor_subscription_status` column;
// past_due/unpaid/cancelled drop the user to free.
const INVESTOR_RANK = { free: 0, professional: 1, institutional: 2 };
const INVESTOR_BYPASS_ROLES = new Set(['admin', 'partner', 'advisor']);
export function hasInvestorTier(user, required) {
  if (!required || required === 'free') return true;
  if (!user) return false;
  if (INVESTOR_BYPASS_ROLES.has(String(user.role))) return true;
  if (String(user.role) !== 'investor') return true; // gate is investor-specific
  const status = String(user.investor_subscription_status || 'free').toLowerCase();
  if (status === 'past_due' || status === 'unpaid' || status === 'cancelled') return false;
  const have = INVESTOR_RANK[String(user.investor_tier || 'free').toLowerCase()] ?? 0;
  return have >= (INVESTOR_RANK[required] ?? 0);
}

// Phase D · sidebar slim-down — fewer, broader groups per role plus a
// collapsed "More" bucket for advanced/occasional destinations. No routes
// were removed: every item that used to live here still does, so the
// learning curve drops without losing reachability. Advisor is already lean
// and is left unchanged.
export const SIDEBAR_GROUPS = {
  // ── Super Admin ──────────────────────────────────────────────────────────
  //
  // The franchisor's shell. Same product as `admin` — a super admin IS an
  // admin (migration 199 makes it an elevation, not a separate role), so every
  // admin destination stays reachable; this group is the eight-row HQ canvas
  // laid over the top, and `resolveShellRole` picks it when the flag is set.
  //
  // ROWS ARE ADDED AS THEIR PAGES LAND. The approved canvas has eight rows —
  // Home, Licences, Funds, Contracts, Team, Support, Security, Settings — and
  // four of them have no page yet. A row pointing at a route that does not
  // exist is worse than a missing row: it looks shipped and 404s. So the four
  // whose destinations resolve today are here, the rest arrive with their
  // pages, and `super_admin_shell.test.mjs` fails if a row is added whose
  // route is not registered in App.jsx.
  super_admin: [
    { key: 'hq', label: 'HQ', items: [
      { to: '/admin', icon: Shield, label: 'Home' },
      // The one row this tier exists for. Every route behind it is
      // super-admin-only server-side (routes/admin_licences.ts).
      { to: '/admin/licences', icon: Map, label: 'Licences' },
      { to: '/admin/team', icon: Users, label: 'Team' },
      { to: '/tickets', icon: Inbox, label: 'Support' },
    ]},
  ],

  admin: [
    { key: 'home', label: 'Home', items: [
      { to: '/studio', icon: LayoutDashboard, label: 'Studio' },
      { to: '/messages', icon: Mail, label: 'Messages' },
    ]},
    { key: 'admin', label: 'Admin', items: [
      { to: '/admin', icon: Shield, label: 'Admin Console' },
      { to: '/admin/due-diligence', icon: ShieldCheck, label: 'Due Diligence' },
      { to: '/admin/assessment', icon: Gamepad2, label: 'Assessment Studio' },
      { to: '/admin/best-fit', icon: Sparkles, label: 'Best-Fit Console' },
      { to: '/admin/events', icon: Ticket, label: 'Event Admin' },
      { to: '/admin/jobs', icon: Briefcase, label: 'Job Board Admin' },
      { to: '/admin/circles', icon: Network, label: 'Communities Admin' },
      // Task #9 — chat-onboarded users awaiting binding agreement + role assignment.
      { to: '/admin/exploring', icon: UserCircle, label: 'Exploring Users' },
      // GP review queue for Spin-Out Fund I LP applications (migration 165).
      { to: '/admin/lp-applications', icon: Inbox, label: 'LP Applications' },
      { to: '/monitoring', icon: Activity, label: 'Monitoring' },
      { to: '/admin/telegram', icon: Send, label: 'Telegram Channels' },
      // X (Twitter) broadcaster temporarily hidden — OAuth not provisioned yet.
      // Re-enable once X_CLIENT_ID/SECRET are bound on the prod worker.
      // { to: '/admin/x', icon: Megaphone, label: 'X (Twitter)' },
      { to: '/admin/articles', icon: FileText, label: 'Content Queue' },
      { to: '/admin/licences', icon: Map, label: 'Territory Licences' },
      // A subsidiary administrator's read of their OWN licence — terms,
      // territories, seats licensed, history. /admin/licences above is HQ's
      // ledger of every licence; this is one, read-only. Both rows are here
      // because the same nav serves HQ and a subsidiary admin today, and
      // GET /licence/mine 404s for anyone who administers none.
      { to: '/admin/my-licence', icon: Map, label: 'My Licence' },
    ]},
    { key: 'studio', label: 'Studio', items: [
      { to: '/projects', icon: Zap, label: 'Startups' },
      { to: '/pipeline', icon: Layers, label: 'Pipeline Board' },
      { to: '/scoring', icon: Target, label: 'Scoring Engine' },
      { to: '/portfolio/risk-matrix', icon: ShieldAlert, label: 'Risk Matrix' },
      { to: '/market-intel', icon: Globe, label: 'Market Intelligence' },
      { to: '/signals', icon: Radar, label: 'Signals' },
      { to: '/advisory', icon: Brain, label: 'AI Advisory Suite' },
      { to: '/matches', icon: Sparkles, label: 'AI Matches' },
      { to: '/deals', icon: Handshake, label: 'Deal Flow' },
    ]},
    { key: 'capital', label: 'Capital & Legal', items: [
      { to: '/capital', icon: DollarSign, label: 'Capital & Investment' },
      { to: '/liquidity', icon: TrendingUp, label: 'Liquidity & Exits' },
      { to: '/portfolio/health', icon: Heart, label: 'Portfolio Health' },
      { to: '/portfolio/coverage', icon: Network, label: 'Portfolio Coverage' },
      { to: '/portfolio/reserves', icon: Layers, label: 'Reserve Allocation' },
      { to: '/portfolio/waterfall', icon: TrendingUp, label: 'Exit Waterfall' },
      { to: '/watchlist', icon: Bookmark, label: 'Watchlist & Journal' },
      { to: '/legal-capital', icon: Scale, label: 'Legal & Capital' },
      { to: '/incorporate', icon: Scale, label: 'Incorporate' },
      { to: '/compliance', icon: Calendar, label: 'Compliance Calendar' },
    ]},
    { key: 'network', label: 'Network & Growth', items: [
      { to: '/partners', icon: Users, label: 'Partners' },
      // Task #4 — "Referrals" moved into Settings (/settings/referrals); the
      // /refer route redirects there. Removed from the admin nav.
      // Task #1 — "Contacts" merged into this "Network" page (Contacts +
      // Relationships tabs); /contacts and /relationships redirect to /network.
      { to: '/network', icon: Handshake, label: 'Network', match: ['/network', '/relationships', '/contacts'] },
      { to: '/network-effects', icon: TrendingUp, label: 'Network Effects' },
      { to: '/my/jobs', icon: Briefcase, label: 'Jobs' },
      // "Integrations" merged into Settings (/settings/integrations); the
      // /integrations route redirects there. Removed from the admin nav.
      { to: '/services', icon: Package, label: 'Service Catalogue' },
      { to: '/needs', icon: MessageSquare, label: 'Needs Board' },
      { to: '/partner/insights', icon: TrendingUp, label: 'Demand Insights' },
      { to: '/partner/office-hours', icon: Calendar, label: 'Partner Office Hours' },
      { to: '/comarketing', icon: Megaphone, label: 'Co-Marketing Review' },
    ]},
    { key: 'more', label: 'More', items: [
      { to: '/incorporate/cofounder-agreement', icon: Users, label: 'Co-Founder Agreement' },
      { to: '/spinout-lab/83b', icon: Calendar, label: '83(b) Tracker' },
      { to: '/partner-portal', icon: UserCircle, label: 'Partner / Investor Portal' },
      { to: '/perks', icon: Gift, label: 'Perks' },
    ]},
    // No 'account' group here on purpose. It once held Articles / Activity Log
    // / Support / Documentation; those moved to the user menu (7c93b83e and
    // 7481ca51) and Company Settings lives in the pinned footer for every role
    // (task #216). The empty declaration outlived its items and rendered an
    // ACCOUNT header over nothing — frontend/test/sidebar_empty_group.test.mjs
    // fails if any role grows a group with no destinations again.
  ],

  // Task #19 — regroup the founder sidebar around the venture lifecycle:
  // Home → Build → Validate → Raise → Launch → More → Account. This replaces the
  // former 8-group layout (which crammed execution + validation + fundraising
  // into one "Build" bucket and duplicated Home via a parallel portal)
  // so every feature has exactly one home and founders face far fewer top-level
  // choices. Sidebar-level only: every surviving route/icon/tier-gate is
  // preserved; no pages are merged. Mirrors the Task #17 investor reorg.
  //
  // Intentional removals (documented so a nav-integrity guard treats them as
  // deliberate, not silent drops):
  //   • The legacy founder landing page and standalone Spin-Outs page were
  //     retired. Execution remains a first-class row.
  //   • "Portfolio Health" (/portfolio/health) — folded into Metrics
  //     (/build/metrics) as the founder's own company-health view; the
  //     /portfolio/health route stays registered and reachable for other roles.
  //   • "Network Effects" (/network-effects) is demoted to More while a single
  //     "Network" entry (/network) leads Validate; both routes stay live.
  //   • Task #1 — "Contacts" (/contacts) is merged into the Network page as its
  //     default "Contacts" tab; /contacts redirects to /network?tab=contacts and
  //     /relationships redirects to /network?tab=relationships.
  //   • "My Profile" (/profile) — the full Profile editor lives inside Settings
  //     (/settings) as the first tab, so a separate sidebar item is redundant.
  //   • standalone "Identity / KYC" (/kyc) — folded into "Trust Center" (/trust)
  //     as a single nav entry; the Identity Verification form now renders on the
  //     Trust Center "Identity" tab (Task #25). The /kyc route stays registered
  //     and reachable (the onboarding KYC gate still redirects there).
  //
  // Newly surfaced (routes already existed and are founder-accessible, they just
  // weren't in the founder nav): Co-Marketing (/comarketing, Launch).
  // Founder shell — the canvas declares nine rows (Home · Validate · Build ·
  // Raise · Grow · Network · Research · Trust · Company Settings). Eight land
  // here; Trust is deliberately absent, pinned out of every sidebar by
  // trust_center_navigation.test.mjs — it is reached from the user dropdown.
  // Spin-Out Lab and Messages keep rows of their own on top of that, so ten.
  //
  // The twenty-one items this replaces all keep a door. Five rows own their
  // sections through FounderWorkspaceTabs, which wraps each route in App.jsx:
  //
  //   Validate → Discovery · Marketplace · Advisory
  //   Build    → Execution · Roadmap · Metrics      (canvas: This week ·
  //              Board · Roadmap · Cadence · KPI entry)
  //   Raise    → Pitch · Capital · Legal · Data room · Liquidity
  //   Grow     → Talent · Brand · Launch · Perks · Network effects
  //   Research → Market · Signals
  //
  // Seven destinations had ZERO inbound links anywhere outside this file —
  // /messages, /execution, /signals, /build/team, /build/metrics,
  // /network-effects and /raise/capital. Six of them are now reachable only
  // because those bars exist; /messages keeps a row.
  //
  // /liquidity's `requiredTier: 'studio'` moved onto its tab rather than being
  // dropped: the route itself has no tier gate, so the nav was the whole gate.
  //
  // As in the investor shell, the Spin-Out Lab row ships verbatim — it is not
  // a modification target, and the canvas folds it into Home without saying
  // what Home would then be.
  // Rebuilt from the Founder canvas. Every row now lands on its bucket's FIRST
  // ZONE rather than on whichever legacy page happened to be that section's
  // door — so the zone row under the heading is populated on arrival and the
  // URL says which section you are in. The IA itself lives in
  // src/workspaces/shellConfig.js; this array is the render of it, and
  // test/workspace_shell_routes.test.mjs asserts the two agree.
  //
  // `match` keeps every legacy path highlighting the right row, because those
  // URLs are still live and still linked from inside pages. A migration that
  // leaves old links pointing at a row that no longer lights up has moved the
  // problem rather than fixed it.
  founder: [
    { key: 'home', label: 'Home', items: [
      { to: '/studio', icon: LayoutDashboard, label: 'Studio' },
      // Spin-Out Lab keeps its own tree, untouched by the shell migration.
      { to: '/spinout-lab', icon: Rocket, label: 'Spin-Out Lab' },
      // Each row points at the workspace ROOT, which renders that workspace's
      // overview. Pointing a row at a section page is how the overviews were
      // lost: a rebuild took the desk's slot, the desk was re-mounted on
      // whatever path was free, and the row was never pointed back. `match`
      // keeps every legacy and section URL highlighting the right row.
      { to: '/validate', icon: MessageSquare, label: 'Validate',
        match: ['/validate', '/build/discovery', '/build/marketplace', '/needs', '/services', '/advisory'] },
      { to: '/build', icon: Briefcase, label: 'Build',
        match: ['/build/this-week', '/build/board', '/build/roadmap', '/build/cadence', '/build/kpi', '/build/metrics', '/execution', '/projects'] },
      { to: '/raise', icon: Sparkles, label: 'Raise', match: ['/raise', '/liquidity'] },
      { to: '/grow', icon: TrendingUp, label: 'Grow',
        match: ['/grow', '/build/team', '/advisors', '/cofounder', '/my/jobs', '/jobs', '/my/applications', '/spinout-lab/brand', '/build/brand', '/comarketing', '/perks', '/network-effects'] },
      // Points at /network, not at the first zone: /network is the one route
      // that role-branches its element, so it is the landing every license can
      // open, and it forwards to the zone. The three /network/* zone routes are
      // still founder-guarded — widening them is the Network half of this
      // migration and has not landed yet.
      { to: '/network', icon: Handshake, label: 'Network',
        match: ['/network', '/relationships', '/contacts'] },
      { to: '/research', icon: Radar, label: 'Research',
        match: ['/research', '/signals', '/market-intel'] },
    ]},
  ],

  // Service-partner sidebar audit — regroup around the partner lifecycle but
  // collapse it into FIVE fuller groups so no section is a header over a single
  // item and the nav stays short: Home → Sourcing → Engage → Earn → Account.
  // The lifecycle stages still map cleanly — Offer + Match + (demand) signal
  // live in "Sourcing"; Deliver + relationships live in "Engage" — they're
  // just no longer separate one-line sections. "Sourcing" is the partner
  // lane's own verb ("Source thesis-aligned companies; monetise services",
  // brand/gvpn.ts) — this is a venture partner network, not a job board, so
  // the label is deliberately venture-native rather than gig-marketplace. This
  // replaces the former
  // investor-shaped layout (Sourcing / Insights / Capital & Legal / Network)
  // that carried founder-, investor-, and studio-internal surfaces a service
  // partner never acts on. Sidebar-level only: every surviving route/icon is
  // preserved and no pages are merged. Mirrors the investor (Task #17) and
  // founder (Task #19) reorgs.
  //
  // Merges (each feature has exactly one home):
  //   • Partners → Network (Engage); match keeps the item active on the legacy
  //     /partners and /relationships routes, which stay registered.
  //   • "My Service Catalogue" → "My Services" (Sourcing).
  //   • Demand Insights folds into Sourcing (the one partner-native signal)
  //     so the standalone Insights section is gone.
  //
  // Intentional removals from the partner nav (documented so a nav-integrity
  // guard treats them as deliberate, not silent drops — every route below
  // stays registered and reachable for other roles or via deep link):
  //   • /partner-portal "Partner Portal" — Studio is the home now, so the
  //     duplicate portal tile is dropped (route stays for admin / deep links).
  //   • /projects "Projects" and /pipeline "Pipeline Board" — studio/investor
  //     execution + deal-pipeline surfaces, not partner-facing.
  //   • /deals "Deal Flow" — only relevant to investor-type partners
  //     (GP / angel / scout / corporate-VC personas); conditional, to be
  //     re-surfaced when the sidebar supports persona gating.
  //   • /scoring "Scoring Engine", /portfolio/risk-matrix "Risk Matrix",
  //     /admin/due-diligence "Due Diligence" — investor/studio diligence tools.
  //   • /market-intel "Market Intelligence" — investor-flavoured intel dropped
  //     to keep the partner UX lean; Demand Insights is the kept signal.
  //   • /portfolio/health "Portfolio Health", /portfolio/coverage
  //     "Portfolio Coverage", /watchlist "Watchlist & Journal",
  //     /liquidity "Liquidity & Exits", /legal-capital "Legal & Capital" —
  //     investor/founder capital surfaces; conditional for equity-holding
  //     partners only.
  //   • /advisors "Find a Advisor" — founder-oriented (a service partner is the
  //     expert, not the mentee); conditional.
  //   • /network-effects "Network Effects" — too abstract to earn a nav slot.
  //   • /articles/draft "Articles" — low-frequency authoring; conditional for
  //     content/press partners.
  // ── Partner / Operator — the canonical shell from the Partner canvas ────────
  // The canvas declares it outright: `const ROWS = ['Home','Pipeline','Delivery',
  // 'Offers','Network','Research','Trust','Firm Settings']`, commented "CANONICAL
  // Partner shell — 8 rows, no tier gating in v1". That is a FLAT list, not a set
  // of groups, so this role is one group of rows rather than seven groups of
  // seventeen items. Each row is a workspace; the sections the canvas draws
  // inside it (Pipeline → Leads · Negotiations · Proposals · Retainers ·
  // Analytics) belong in the page, not the sidebar.
  //
  // NOTHING BECAME UNREACHABLE. All seventeen previous destinations still
  // resolve; each is listed in the `match` of the row that now owns it, so a
  // deep link or a bookmark still highlights the right row. `match` is
  // exact-or-subtree (`SidebarNav.jsx`: `pathname === p || startsWith(p + '/')`),
  // which is why `/partner/operations/engagements` can sit under Pipeline while
  // its siblings sit under Delivery without the two colliding.
  //
  // TWO DEPARTURES FROM THE CANVAS, both deliberate:
  //   Home → /studio, not a new /home. Per the product owner, and it keeps
  //     /partner from becoming a root.
  //   Messages is a ninth row. The canvas's eight rows have nowhere to put it,
  //     and deleting the entry would leave a live surface reachable only by
  //     typing the URL — the Wave 4 mistake in reverse. It stays until the
  //     canvas says where a cross-cutting inbox lives.
  // ── Partner / Operator — the canonical shell, now complete ─────────────────
  // Canvas ROWS: Home · Pipeline · Delivery · Offers · Network · Research ·
  // Trust · Firm Settings. "CANONICAL Partner shell — 8 rows, no tier gating
  // in v1." Flat, and now actually eight.
  //
  // THE SIX PENDING ROWS ARE GONE because their workspaces absorbed them.
  // `PartnerWorkspaceTabs` wraps the Pipeline and Offers pages at the route,
  // so every section is one click from its row:
  //   Pipeline → Leads · Matches · Demand · Retainers
  //   Delivery → the /partner/operations subtree, tabbed by
  //              PartnerOperationsWorkspace since Wave 1a
  //   Offers   → Catalog · Perk deals · Visibility · Proof · Office hours
  // The tabs are role-filtered against the same guards App.jsx applies, because
  // those routes do not share one: an investor on /services must not be shown
  // an Office Hours tab that bounces them.
  //
  // Trust is ABSENT, deliberately: trust_center_navigation.test.mjs pins Trust
  // Center to the user dropdown and asserts it appears in no sidebar.
  // Firm Settings is the COMPANY's settings; Account is a different page.
  partner: [
    { key: 'shell', label: '', items: [
      { to: '/studio', icon: LayoutDashboard, label: 'Studio' },
      { to: '/spinout-lab', icon: Rocket, label: 'Spin-Out Lab' },
      { to: '/needs', icon: Target, label: 'Pipeline',
        match: ['/needs', '/matches', '/partner/insights', '/partner/operations/engagements'] },
      { to: '/partner/operations/overview', icon: Briefcase, label: 'Delivery',
        match: ['/partner/operations/overview', '/partner/operations/portfolio',
                '/partner/operations/performance'] },
      { to: '/services', icon: Package, label: 'Offers',
        match: ['/services', '/perks', '/comarketing', '/partner/office-hours',
                '/partner/operations/capabilities'] },
      { to: '/network', icon: Users, label: 'Network',
        match: ['/network', '/relationships', '/contacts'] },
      { to: '/signals', icon: Radar, label: 'Research', match: ['/signals', '/market-intel'] },
    ]},
  ],

  // Investor/LP shell — a single headerless group, matching the approved
  // Investor LP Canvas. Each row is a complete investor workspace; legacy
  // deep links remain matched to their owning row.
  investor: [
    { key: 'home', label: 'Home', items: [
      { to: '/studio', icon: LayoutDashboard, label: 'Studio' },
      { to: '/spinout-lab', icon: Rocket, label: 'Spin-Out Lab' },
      { to: '/deals/pipeline', icon: Handshake, label: 'Deals',
        match: ['/deals', '/pipeline', '/raise/data-room'] },
      // Positions is the canvas's word for the holdings view, which is
      // /portfolio/health today. The literal route /portfolio/positions also
      // exists and the generic tab bar labels it "Cap Table" — three names
      // across two pages. Until that is settled the row keeps pointing at the
      // page that works; the zone row above it carries the canvas's naming.
      { to: '/portfolio/health', icon: Briefcase, label: 'Portfolio', match: ['/portfolio'] },
      { to: '/spinout-lab/investor-workspace', icon: Landmark, label: 'Axal VC Fund' },
      { to: '/funds', icon: Wallet, label: 'Fund', match: ['/funds', '/lp-reports'], requiredInvestorTier: 'institutional' },
      { to: '/network', icon: Handshake, label: 'Network', match: ['/network', '/relationships', '/contacts'] },
      { to: '/research/ask', icon: Radar, label: 'Research', match: ['/research', '/market-intel'] },
      { to: '/trust', icon: ShieldCheck, label: 'Trust' },
      // NO Company Settings row. The canvas asks for one; the shipped decision
      // is that /company-settings is the sidebar's PINNED FOOTER for every
      // role, because it used to be a row as well and rendered twice. The
      // footer carries no role gate, so dropping the row strands nobody. The
      // canvas and that decision disagree, and the decision holds until
      // somebody overturns it deliberately.
    ]},
  ],

  // Advisor Canvas contract: six workspace rows only. Existing concrete
  // routes remain reachable through deep links and are grouped under the
  // owning workspace rather than promoted to separate sidebar destinations.
  advisor: [
    { key: 'home', label: 'Home', items: [
      { to: '/studio', icon: LayoutDashboard, label: 'Studio' },
      { to: '/spinout-lab', icon: Rocket, label: 'Spin-Out Lab' },
      // Practice and Expertise keep their shipped destinations. The canvas
      // moves them to /practice/* and /expertise/*, and those routes now exist
      // and work — but two decisions already point these rows elsewhere:
      // Practice owns the whole /advisor/advisory subtree, and Expertise is
      // the canonical advisor profile destination at /office-hours. Retargeting
      // a row against a decision is not this migration's call to make alone.
      { to: '/advisor/advisory/opportunities', icon: Briefcase, label: 'Practice',
        match: ['/advisor/advisory'] },
      // Cohorts is the one new row that conflicts with nothing: the canvas asks
      // for it, no decision speaks against it, and it reads Spin-Out Lab data
      // read-only rather than owning any of it.
      { to: '/cohorts/founders', icon: Users, label: 'Cohorts', match: ['/cohorts'] },
      { to: '/office-hours', icon: UserCircle, label: 'Expertise',
        match: ['/office-hours', '/advisors'] },
      { to: '/network', icon: Users, label: 'Network',
        match: ['/network', '/relationships', '/contacts', '/advisor/network'] },
      { to: '/signals', icon: Radar, label: 'Research',
        match: ['/signals', '/market-intel'] },
      // NO Trust row (it belongs to the user dropdown) and NO Practice Settings
      // row (the pinned footer is the single entry point). The canvas asks for
      // both; both are decisions already made against it.
    ]},
  ],

  exploring: [
    { key: 'home', label: 'Home', items: [
      { to: '/exploring', icon: LayoutDashboard, label: 'Studio', highlight: true },
      // Task #13 — surface the Spin-Out Lab program to explorers so they can
      // see the full 28-day pipeline before committing.
      { to: '/spinout-lab', icon: Rocket, label: 'Spin-Out Lab' },
      { to: '/messages', icon: Mail, label: 'Messages' },
    ]},
    { key: 'account', label: 'Account', items: [
      { to: '/profile', icon: UserCircle, label: 'My Profile' },
    ]},
  ],
};

// Decide which group keys should start expanded on a fresh visit:
// Home + the first non-Home group with items. Returns a Set<string>.
export function defaultOpenGroups(role) {
  const groups = SIDEBAR_GROUPS[role] || [];
  const open = new Set();
  if (groups[0]) open.add(groups[0].key);
  const firstContent = groups.find((g, i) => i > 0 && (g.items || []).length > 0);
  if (firstContent) open.add(firstContent.key);
  return open;
}

// Task #6 — Items with a `requiredTier` the user lacks STAY in the list (so
// they remain discoverable) but render with a lock icon and route through
// PaywallModal on click. App.jsx reads `requiredTier` directly to render the
// lock + intercept; this helper is kept for legacy callers but no longer
// hides items.
export function filterItemsByTier(items /* , user */) {
  return items || [];
}


/**
 * Founder surfaces that own the full dashboard: no `max-w-7xl mx-auto`, no
 * `p-4 md:p-6`. Every page here draws its own full-bleed canvas and sets its
 * own `min-height: 100dvh`, so the shell's centred column and padding would
 * put a card inside a card and push the page past the viewport.
 *
 * THIS WAS TWO ARRAYS. `App.jsx` held `fullWidthSurface` and `flushSurface` as
 * separate hand-typed lists of the same 16 paths, matched with an exact
 * `.includes(location.pathname)` — no prefix matching, so every new route had
 * to be added to both by hand. `/grow/focus` was the one `/grow/*` route
 * missing from both, and it was the whole of "Grow doesn't fit full width and
 * height". One list makes that omission impossible rather than fixed once;
 * `frontend/test/founder_shell.test.mjs` asserts every founder desk and
 * section route is in it.
 */
export const FOUNDER_FULL_BLEED = [
  // The six workspace roots — each renders that workspace's overview.
  '/validate', '/build', '/raise', '/grow', '/network', '/research',
  // The legacy paths the overviews were rescued onto. Still live, still linked
  // from inside pages, so they keep rendering the same desk at the same width.
  '/build/discovery', '/execution', '/build/team', '/signals',
  // Section pages, one group per workspace.
  '/build/this-week', '/build/board', '/build/roadmap', '/build/cadence', '/build/kpi',
  '/raise/pitch',
  '/grow/focus', '/grow/talent', '/grow/customers', '/grow/partnerships',
  '/grow/capital-match', '/grow/brand', '/grow/launch',
  '/network/relationships', '/network/introductions', '/network/organizations',
];
