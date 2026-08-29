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
  Gavel, Inbox, FileBarChart, Radar, Wallet,
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
    { key: 'account', label: 'Account', items: [
    ]},
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
  founder: [
    { key: 'home', label: 'Home', items: [
      { to: '/studio', icon: LayoutDashboard, label: 'Studio' },
      { to: '/spinout-lab', icon: Rocket, label: 'Spin-Out Lab' },
      { to: '/messages', icon: Mail, label: 'Messages' },
    ]},
    { key: 'build', label: 'Build', items: [
      { to: '/execution', icon: Briefcase, label: 'Execution', match: ['/execution', '/projects', '/build/roadmap'] },
      { to: '/signals', icon: Radar, label: 'Signals' },
      // Team Building — consolidates the former "Find a Advisor" (Validate),
      // "Find a Co-founder" (Validate) and "Jobs" (Launch) items into one
      // workspace at /build/team. `match` keeps this row active when a founder
      // deep-links (or is redirected from) the legacy standalone routes.
      { to: '/build/team', icon: Users, label: 'Team', match: ['/build/team', '/advisors', '/cofounder', '/my/jobs', '/jobs', '/my/applications'] },
      { to: '/build/metrics', icon: TrendingUp, label: 'Metrics' },
      { to: '/spinout-lab/brand', icon: Sparkles, label: 'Brand & Landing', match: ['/spinout-lab/brand', '/build/brand'] },
    ]},
    { key: 'validate', label: 'Validate', items: [
      { to: '/build/discovery', icon: MessageSquare, label: 'Customer Discovery' },
      // Marketplace merges the two halves of the partner-services marketplace —
      // "Needs Board" (/needs, demand) and "Service Catalogue" (/services,
      // supply) — into one tabbed page at /build/marketplace. `match` keeps this
      // row active across every tab and when a founder deep-links (or is
      // redirected from) the legacy /needs and /services routes (see App.jsx).
      { to: '/build/marketplace', icon: Package, label: 'Marketplace', match: ['/build/marketplace', '/needs', '/services'] },
      { to: '/advisory', icon: Brain, label: 'Advisory' },
    ]},
    // Task #7 — Network section mirrors the advisor/partner/investor profiles:
    // three tabs (Introductions, Relationships, Organizations) served by the
    // shared Network workspace under /advisor/network/*. This replaces the old
    // single "Network" link that lived in Validate; the legacy /network,
    // /relationships and /contacts routes keep the Relationships row active.
    { key: 'network', label: 'Network', items: [
      { to: '/network', icon: Handshake, label: 'Network', match: ['/network', '/relationships', '/contacts'] },
    ]},
    // Research — Market, Companies, Funds, AI Research, News, Documents. Reuses
    // the shared Research workspace (also used by advisors/investors/partners).
    { key: 'research', label: 'Research', items: [
      { to: '/market-intel', icon: Radar, label: 'Market' },
    ]},
    // Task #1 — RAISE Workspaces. Ten items collapsed into three workspaces that
    // compose the existing pages (Pitch/Capital/Legal Engine). The Pitch item is
    // ungated so the free reviewer stays reachable — the growth gate on the deck
    // editor and the studio gates on founder agreements / equity elections are
    // preserved inside their workspaces.
    { key: 'raise', label: 'Raise', items: [
      { to: '/raise/pitch', icon: Sparkles, label: 'Pitch' },
      { to: '/raise/capital', icon: DollarSign, label: 'Capital' },
      { to: '/raise/legal-engine', icon: Scale, label: 'Legal Engine' },
      { to: '/raise/data-room', icon: Shield, label: 'Data Room' },
    ]},
    { key: 'launch', label: 'Launch', items: [
      // "Jobs" moved into the Build › Team workspace (/build/team?tab=jobs).
      { to: '/comarketing', icon: Megaphone, label: 'Co-Marketing' },
    ]},
    { key: 'more', label: 'More', items: [
      // Task #4 — "Referrals" moved into Settings (/settings/referrals); the
      // /refer route redirects there. Removed from the founder nav.
      { to: '/network-effects', icon: TrendingUp, label: 'Network Effects' },
      { to: '/liquidity', icon: TrendingUp, label: 'Liquidity & Exits', requiredTier: 'studio' },
      { to: '/perks', icon: Gift, label: 'Perks' },
    ]},
    { key: 'account', label: 'Account', items: [
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
  // /my/jobs KEEPS ITS ROW. It is not a section of Offers — it is the partner's
  // own job listings — and it has four inbound links elsewhere, so it is not at
  // risk either way. Folding it in to reach eight would be arithmetic, not
  // information architecture.
  //
  // Messages is the ninth row for the reason it always was: the canvas's eight
  // have nowhere to put a cross-cutting inbox, and /messages has no other door.
  //
  // Trust is ABSENT, deliberately: trust_center_navigation.test.mjs pins Trust
  // Center to the user dropdown and asserts it appears in no sidebar.
  // Firm Settings is the COMPANY's settings; Account is a different page.
  partner: [
    { key: 'shell', label: 'Workspace', items: [
      { to: '/studio', icon: LayoutDashboard, label: 'Home' },
      { to: '/messages', icon: Mail, label: 'Messages' },
      { to: '/needs', icon: Target, label: 'Pipeline',
        match: ['/needs', '/matches', '/partner/insights', '/partner/operations/engagements'] },
      { to: '/partner/operations/overview', icon: Briefcase, label: 'Delivery',
        match: ['/partner/operations/overview', '/partner/operations/portfolio',
                '/partner/operations/performance'] },
      { to: '/services', icon: Package, label: 'Offers',
        match: ['/services', '/perks', '/comarketing', '/partner/office-hours',
                '/partner/operations/capabilities'] },
      { to: '/my/jobs', icon: Briefcase, label: 'Jobs' },
      { to: '/network', icon: Users, label: 'Network' },
      { to: '/market-intel', icon: Radar, label: 'Research' },
      { to: '/company-settings', icon: UserCircle, label: 'Firm Settings' },
    ]},
  ],

  investor: [
    { key: 'home', label: 'Home', items: [
      { to: '/studio', icon: LayoutDashboard, label: 'Studio' },
      // Same item at the same index as the founder and exploring navs, so the
      // program reads the same way in every profile — but it does NOT resolve
      // to the same page. App.jsx serves /spinout-lab by the role being browsed
      // as: an investor gets the Fund I sales page (SpinoutLabInvestorPage —
      // what founders do inside the Lab, the operating stack, the underwriting
      // edge, studio proof), whose CTAs route into the deeper
      // /spinout-lab/investor-workspace (fund terms, raise status, reporting,
      // allocation, apply). Everyone else gets the founder program. An LP's
      // relationship with the Lab is the fund, not the 4-week curriculum.
      { to: '/spinout-lab', icon: Rocket, label: 'Spin-Out Lab', match: ['/spinout-lab', '/spinout-lab/investor-workspace'] },
      { to: '/messages', icon: Mail, label: 'Messages' },
    ]},
    // Task — investor sidebar restructured around the investment lifecycle IA:
    // Network → Pipeline → Portfolio → Funds → Research. Network & Research
    // reuse the shared workspaces (also used by advisors). Sidebar-level change
    // only: every prior route stays registered and URL-reachable. Surfaces
    // trimmed from the nav (still reachable by direct URL): /pipeline (Pipeline
    // Board), /matches, /watchlist, /scoring, /due-diligence, /market-intel,
    // /portfolio/risk-matrix, /ic, /legal-capital, /portfolio/positions,
    // /lp-portal, /funds/capital-calls, /portfolio/reserves,
    // /portfolio/waterfall, /liquidity.
    { key: 'network', label: 'Network', items: [
      { to: '/network', icon: Handshake, label: 'Network', match: ['/network', '/relationships', '/contacts'] },
    ]},
    { key: 'pipeline', label: 'Pipeline', items: [
      { to: '/deals', icon: Handshake, label: 'Deal Flow', requiredInvestorTier: 'professional' },
      { to: '/pipeline/screening', icon: Target, label: 'Screening' },
      { to: '/pipeline/commit', icon: Gavel, label: 'Commit' },
      { to: '/pipeline/transactions', icon: DollarSign, label: 'Transactions' },
      { to: '/raise/data-room', icon: Shield, label: 'Data Rooms' },
    ]},
    { key: 'portfolio', label: 'Portfolio', items: [
      { to: '/portfolio/health', icon: Briefcase, label: 'Companies' },
      { to: '/portfolio/performance', icon: TrendingUp, label: 'Performance' },
      { to: '/portfolio/updates', icon: FileBarChart, label: 'Reporting' },
      { to: '/portfolio/growth', icon: Rocket, label: 'Growth' },
    ]},
    { key: 'funds', label: 'Funds', items: [
      { to: '/funds', icon: Wallet, label: 'Fund Management' },
      // NOTE: no 'LP Workspace' item here — the investor journey to it runs
      // Home → Spin-Out Lab (sales page) → its CTAs →
      // /spinout-lab/investor-workspace, and a second nav item opening the
      // same content under a fund-ops name is the confusion, not the fix. The
      // /funds/lp-workspace ROUTE stays registered and is still a tab inside
      // Fund Ops, so deep links and the tab strip are unaffected.
      { to: '/lp-reports', icon: UserCircle, label: 'LP Management' },
      { to: '/funds/performance', icon: Activity, label: 'Performance' },
      { to: '/funds/accounting', icon: Scale, label: 'Accounting' },
    ]},
    { key: 'research', label: 'Research', items: [
      { to: '/market-intel', icon: Radar, label: 'Market' },
    ]},
    { key: 'account', label: 'Account', items: [
    ]},
  ],

  advisor: [
    { key: 'shell', label: 'Workspace', items: [
      { to: '/studio', icon: LayoutDashboard, label: 'Home' },
      { to: '/messages', icon: Mail, label: 'Messages' },
      { to: '/office-hours', icon: Calendar, label: 'Office Hours', highlight: true },

      // One row, five destinations, all tabbed by the workspace behind it.
      { to: '/advisor/advisory/opportunities', icon: Briefcase, label: 'Practice',
        match: ['/advisor/advisory'] },

      { to: '/my/jobs', icon: Briefcase, label: 'Jobs' },
      { to: '/advisors', icon: Users, label: 'Advisor Directory' },
      { to: '/network', icon: Users, label: 'Network' },
      { to: '/market-intel', icon: Radar, label: 'Research' },
      { to: '/signals', icon: Radar, label: 'Signals' },
      { to: '/due-diligence', icon: ShieldAlert, label: 'Due Diligence' },
      { to: '/company-settings', icon: UserCircle, label: 'Practice Settings' },
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
