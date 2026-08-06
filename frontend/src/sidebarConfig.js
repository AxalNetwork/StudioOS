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
  Network, Sparkles, Briefcase, TrendingUp, Layers, Scale, LayoutGrid,
  MessageSquare, Package, Lock, Calendar, Heart, Bookmark, Megaphone, Send,
  BookOpen, Settings as SettingsIcon, PieChart as PieIcon, Gamepad2, ShieldAlert,
  Gavel, Inbox, FileBarChart, Radar, Wallet, PhoneCall,
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
      { to: '/products', icon: Package, label: 'Products' },
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
    ]},
    { key: 'studio', label: 'Studio', items: [
      { to: '/projects', icon: Zap, label: 'Startups' },
      { to: '/pipeline', icon: Layers, label: 'Pipeline Board' },
      { to: '/studio-ops', icon: Briefcase, label: 'Studio Ops' },
      { to: '/spinouts', icon: Rocket, label: 'Spin-Outs' },
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
      { to: '/trust', icon: Lock, label: 'Trust Center' },
    ]},
    { key: 'network', label: 'Network & Growth', items: [
      { to: '/partners', icon: Users, label: 'Partners' },
      // Task #4 — "Referrals" moved into Settings (/settings/referrals); the
      // /refer route redirects there. Removed from the admin nav.
      // Task #1 — "Contacts" merged into this "Network" page (Contacts +
      // Relationships tabs); /contacts and /relationships redirect to /network.
      { to: '/network', icon: Handshake, label: 'Network', match: ['/network', '/relationships', '/contacts'] },
      { to: '/network-effects', icon: TrendingUp, label: 'Network Effects' },
      { to: '/calendar', icon: Calendar, label: 'Calendar' },
      { to: '/my/events', icon: Ticket, label: 'Events' },
      { to: '/my/jobs', icon: Briefcase, label: 'Jobs' },
      // "Integrations" merged into Settings (/settings/integrations); the
      // /integrations route redirects there. Removed from the admin nav.
      { to: '/marketplace', icon: Briefcase, label: 'Marketplace' },
      { to: '/services', icon: Package, label: 'Service Catalogue' },
      { to: '/needs', icon: MessageSquare, label: 'Needs Board' },
      { to: '/partner/insights', icon: TrendingUp, label: 'Demand Insights' },
      { to: '/partner/office-hours', icon: Calendar, label: 'Partner Office Hours' },
      { to: '/comarketing', icon: Megaphone, label: 'Co-Marketing Review' },
    ]},
    // Research — Market, Companies, Funds, AI Research, News, Documents. Reuses
    // the shared Research workspace (also used by advisors/investors/partners).
    { key: 'research', label: 'Research', items: [
      { to: '/advisor/research/market', icon: Radar, label: 'Market' },
      { to: '/advisor/research/companies', icon: Globe, label: 'Companies' },
      { to: '/advisor/research/funds', icon: Wallet, label: 'Funds' },
      { to: '/advisor/research/ai', icon: Brain, label: 'AI Research' },
      { to: '/advisor/research/news', icon: Send, label: 'News' },
      { to: '/advisor/research/documents', icon: FileText, label: 'Documents' },
    ]},
    { key: 'more', label: 'More', items: [
      { to: '/incorporate/cofounder-agreement', icon: Users, label: 'Co-Founder Agreement' },
      { to: '/spinout-lab/83b', icon: Calendar, label: '83(b) Tracker' },
      { to: '/wellbeing', icon: Heart, label: 'Founder Wellbeing' },
      { to: '/founder', icon: Rocket, label: 'Founder Portal' },
      { to: '/partner-portal', icon: UserCircle, label: 'Partner / Investor Portal' },
    ]},
    { key: 'account', label: 'Account', items: [
      { to: '/articles/draft', icon: FileText, label: 'Articles' },
      { to: '/activity', icon: Activity, label: 'Activity Log' },
      { to: '/tickets', icon: Ticket, label: 'Support' },
      { to: '/docs', icon: BookOpen, label: 'Documentation' },
      { to: '/settings', icon: SettingsIcon, label: 'Settings' },
    ]},
  ],

  // Task #19 — regroup the founder sidebar around the venture lifecycle:
  // Home → Build → Validate → Raise → Launch → More → Account. This replaces the
  // former 8-group layout (which crammed execution + validation + fundraising
  // into one "Build" bucket and duplicated Home via a parallel "Founder Portal")
  // so every feature has exactly one home and founders face far fewer top-level
  // choices. Sidebar-level only: every surviving route/icon/tier-gate is
  // preserved; no pages are merged. Mirrors the Task #17 investor reorg.
  //
  // Intentional removals (documented so a nav-integrity guard treats them as
  // deliberate, not silent drops):
  //   • "Founder Portal" (/founder), "Execution" (/execution + board/roadmap),
  //     "Studio Ops" (/studio-ops) and "Spin-Outs" (/spinouts) are merged into
  //     one "Command Center" workspace (/build/command-center). Each is now a
  //     deep-linkable tab (?tab=founder-portal|execution|studio-ops|spin-outs);
  //     founders hitting the legacy routes are redirected into the matching tab
  //     in App.jsx. Every route stays registered and reachable for admin/other
  //     personas.
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
      { to: '/products', icon: Package, label: 'Products' },
    ]},
    { key: 'build', label: 'Build', items: [
      // Command Center merges four founder Build destinations — Founder Portal
      // (/founder), Execution (/execution + board/roadmap), Studio Ops
      // (/studio-ops) and Spin-Outs (/spinouts, + the /spin-outs alias) — into
      // one tabbed page at /build/command-center. `match` keeps the row active
      // across every tab and every legacy deep-linked route (founders are
      // redirected from those routes into the matching ?tab= in App.jsx).
      // '/founder' is intentionally NOT in `match`: it would prefix-match the
      // new /founder/growth/* routes and double-highlight this row. The bare
      // /founder route redirects founders to /build/command-center anyway, so
      // it never rests in the URL.
      { to: '/build/command-center', icon: LayoutGrid, label: 'Command Center', match: ['/build/command-center', '/execution', '/studio-ops', '/spinouts', '/spin-outs', '/projects', '/pipeline', '/build/roadmap'] },
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
      { to: '/advisor/network/introductions', icon: Sparkles, label: 'Introductions' },
      { to: '/advisor/network/relationships', icon: Users, label: 'Relationships', match: ['/advisor/network/relationships', '/network', '/relationships', '/contacts'] },
      { to: '/advisor/network/organizations', icon: Globe, label: 'Organizations' },
    ]},
    // Task #7 — Growth section mirrors the advisor/partner profiles: five tabs
    // (Talent, Customers, Partnerships, Capital, Experts) served by the shared
    // GrowthWorkspace under /founder/growth/*.
    //
    // Founder-journey audit — these five tabs are UI shell only (mock data,
    // see src/data/growth.js), and sat unlocked next to the REAL Raise/Team
    // workspaces with a colliding label: two sidebar items both read "Capital"
    // — one live (/raise/capital), one sample data. `requiredTier: 'growth'`
    // gives them the same lock-icon + PaywallModal treatment every other
    // tier-gated item already gets (see `/liquidity` below), which at minimum
    // stops a free founder from being shown counterfeit data as a working
    // feature. It does NOT fully resolve the label collision on its own: Lab
    // -active founders bypass this gate too (`hasTier`'s existing rule for
    // REQUIRED lab tooling, e.g. the deck builder) and would still see an
    // unlocked "Capital" here beside the real one — hence also renaming this
    // one to "Capital Match" below, which stays true regardless of lock state.
    { key: 'growth', label: 'Growth', items: [
      { to: '/founder/growth/talent', icon: Users, label: 'Talent', requiredTier: 'growth' },
      { to: '/founder/growth/customers', icon: Briefcase, label: 'Customers', requiredTier: 'growth' },
      { to: '/founder/growth/partnerships', icon: Handshake, label: 'Partnerships', requiredTier: 'growth' },
      { to: '/founder/growth/capital', icon: DollarSign, label: 'Capital Match', requiredTier: 'growth' },
      { to: '/founder/growth/experts', icon: Brain, label: 'Experts', requiredTier: 'growth' },
    ]},
    // Research — Market, Companies, Funds, AI Research, News, Documents. Reuses
    // the shared Research workspace (also used by advisors/investors/partners).
    { key: 'research', label: 'Research', items: [
      { to: '/advisor/research/market', icon: Radar, label: 'Market' },
      { to: '/advisor/research/companies', icon: Globe, label: 'Companies' },
      { to: '/advisor/research/funds', icon: Wallet, label: 'Funds' },
      { to: '/advisor/research/ai', icon: Brain, label: 'AI Research' },
      { to: '/advisor/research/news', icon: Send, label: 'News' },
      { to: '/advisor/research/documents', icon: FileText, label: 'Documents' },
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
    ]},
    { key: 'launch', label: 'Launch', items: [
      { to: '/my/events', icon: Ticket, label: 'Events' },
      // "Jobs" moved into the Build › Team workspace (/build/team?tab=jobs).
      { to: '/comarketing', icon: Megaphone, label: 'Co-Marketing' },
      { to: '/articles/draft', icon: FileText, label: 'Articles' },
    ]},
    { key: 'more', label: 'More', items: [
      // Task #4 — "Referrals" moved into Settings (/settings/referrals); the
      // /refer route redirects there. Removed from the founder nav.
      { to: '/wellbeing', icon: Heart, label: 'Founder Wellbeing' },
      { to: '/network-effects', icon: TrendingUp, label: 'Network Effects' },
      { to: '/liquidity', icon: TrendingUp, label: 'Liquidity & Exits', requiredTier: 'studio' },
      { to: '/calendar', icon: Calendar, label: 'Calendar' },
    ]},
    { key: 'account', label: 'Account', items: [
      { to: '/trust', icon: Lock, label: 'Trust Center' },
      { to: '/tickets', icon: Ticket, label: 'Support' },
      { to: '/activity', icon: Activity, label: 'Activity Log' },
      { to: '/docs', icon: BookOpen, label: 'Docs' },
      { to: '/settings', icon: SettingsIcon, label: 'Settings' },
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
  partner: [
    { key: 'home', label: 'Home', items: [
      { to: '/studio', icon: LayoutDashboard, label: 'Studio' },
      { to: '/products', icon: Package, label: 'Products' },
    ]},
    { key: 'sourcing', label: 'Sourcing', items: [
      { to: '/services', icon: Package, label: 'My Services' },
      { to: '/matches', icon: Sparkles, label: 'AI Matches' },
      { to: '/needs', icon: MessageSquare, label: 'Needs Board' },
      { to: '/marketplace', icon: Briefcase, label: 'Marketplace' },
      { to: '/partner/insights', icon: TrendingUp, label: 'Demand Insights' },
    ]},
    { key: 'engage', label: 'Engage', items: [
      { to: '/partner/office-hours', icon: Calendar, label: 'My Office Hours' },
      { to: '/calendar', icon: Calendar, label: 'Calendar' },
      { to: '/comarketing', icon: Megaphone, label: 'Co-Marketing' },
      { to: '/my/events', icon: Ticket, label: 'Events' },
      { to: '/my/jobs', icon: Briefcase, label: 'Jobs' },
    ]},
    // Network — Introductions, Relationships, Organizations. Reuses the shared
    // Network workspace (also used by advisors); the standalone "Network" link
    // that used to live in Engage is folded into this group's three tabs.
    { key: 'network', label: 'Network', items: [
      { to: '/advisor/network/introductions', icon: Sparkles, label: 'Introductions' },
      { to: '/advisor/network/relationships', icon: Users, label: 'Relationships', match: ['/advisor/network/relationships', '/network', '/relationships', '/partners'] },
      { to: '/advisor/network/organizations', icon: Globe, label: 'Organizations' },
    ]},
    // Partner Operations workspace. Each item deep-links to its own tab route;
    // `match` keeps the row active across the tab and its sub-route.
    { key: 'operations', label: 'Operations', items: [
      { to: '/partner/operations/overview', icon: LayoutDashboard, label: 'Overview', match: ['/partner/operations/overview'] },
      { to: '/partner/operations/capabilities', icon: Package, label: 'Capabilities', match: ['/partner/operations/capabilities'] },
      { to: '/partner/operations/portfolio', icon: Layers, label: 'Portfolio', match: ['/partner/operations/portfolio'] },
      { to: '/partner/operations/engagements', icon: Handshake, label: 'Engagements', match: ['/partner/operations/engagements'] },
      { to: '/partner/operations/performance', icon: TrendingUp, label: 'Performance', match: ['/partner/operations/performance'] },
    ]},
    // Growth — market-matching workspace surfaced as five tabs (Talent,
    // Customers, Partnerships, Capital, Experts). Each row deep-links to its tab.
    { key: 'growth', label: 'Growth', items: [
      { to: '/partner/growth/talent', icon: Users, label: 'Talent' },
      { to: '/partner/growth/customers', icon: Briefcase, label: 'Customers' },
      { to: '/partner/growth/partnerships', icon: Handshake, label: 'Partnerships' },
      { to: '/partner/growth/capital', icon: DollarSign, label: 'Capital' },
      { to: '/partner/growth/experts', icon: Brain, label: 'Experts' },
    ]},
    // Research — Market, Companies, Funds, AI Research, News, Documents. Reuses
    // the shared Research workspace (also used by advisors).
    { key: 'research', label: 'Research', items: [
      { to: '/advisor/research/market', icon: Radar, label: 'Market' },
      { to: '/advisor/research/companies', icon: Globe, label: 'Companies' },
      { to: '/advisor/research/funds', icon: Wallet, label: 'Funds' },
      { to: '/advisor/research/ai', icon: Brain, label: 'AI Research' },
      { to: '/advisor/research/news', icon: Send, label: 'News' },
      { to: '/advisor/research/documents', icon: FileText, label: 'Documents' },
    ]},
    // Task #4 — the former "Earn" group held only "Referrals" (/refer), which
    // has moved into Settings (/settings/referrals); /refer redirects there.
    // The whole single-item group is removed from the partner nav.
    { key: 'account', label: 'Account', items: [
      { to: '/trust', icon: Lock, label: 'Trust Center' },
      { to: '/activity', icon: Activity, label: 'Activity Log' },
      { to: '/tickets', icon: Ticket, label: 'Support' },
      { to: '/docs', icon: BookOpen, label: 'Documentation' },
      { to: '/settings', icon: SettingsIcon, label: 'Settings' },
    ]},
  ],

  // Task #17 — regroup the investor sidebar around the investment lifecycle:
  // Home → Sourcing → Diligence → Commit → Support → Account. This replaces the
  // former ~12-group layout (which had a parallel "Investor Portal" and
  // duplicate deal surfaces) so every feature has exactly one home and
  // investors face far fewer top-level choices. Sidebar-level only: every
  // surviving route/icon/tier-gate is preserved; no pages are merged.
  //
  // Deliberate deviations from the PR #119 reference: Home stays at /studio
  // (labeled "Studio", NOT renamed to /dashboard), and the overflow group is
  // named "Account" (NOT "More").
  //
  // Intentional removals (documented so a nav-integrity guard treats them as
  // deliberate, not silent drops):
  //   • "Investor Portal" (/partner-portal) — redundant with Studio; investors
  //     hitting /partner-portal are redirected to /studio in App.jsx. The route
  //     stays registered for admin/partner.
  //   • "Projects" (/projects) — moved off the investor surface; route stays
  //     registered for other roles / deep links.
  //   • standalone "Identity Verification" (/kyc) — folded into "Trust &
  //     Identity" (/trust) as a single nav entry; the /kyc route stays
  //     registered and reachable.
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
      { to: '/products', icon: Package, label: 'Products' },
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
      { to: '/advisor/network/introductions', icon: Sparkles, label: 'Introductions' },
      { to: '/advisor/network/relationships', icon: Users, label: 'Relationships', match: ['/advisor/network/relationships', '/network', '/relationships', '/contacts'] },
      { to: '/advisor/network/organizations', icon: Globe, label: 'Organizations' },
    ]},
    { key: 'pipeline', label: 'Pipeline', items: [
      { to: '/deals', icon: Handshake, label: 'Deal Flow', requiredInvestorTier: 'professional' },
      { to: '/pipeline/screening', icon: Target, label: 'Screening' },
      { to: '/pipeline/commit', icon: Gavel, label: 'Commit' },
      { to: '/pipeline/transactions', icon: DollarSign, label: 'Transactions' },
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
      { to: '/advisor/research/market', icon: Radar, label: 'Market' },
      { to: '/advisor/research/companies', icon: Globe, label: 'Companies' },
      { to: '/advisor/research/funds', icon: Wallet, label: 'Funds' },
      { to: '/advisor/research/ai', icon: Brain, label: 'AI Research' },
      { to: '/advisor/research/news', icon: Send, label: 'News' },
      { to: '/advisor/research/documents', icon: FileText, label: 'Documents' },
    ]},
    { key: 'account', label: 'Account', items: [
      { to: '/trust', icon: Lock, label: 'Trust & Identity' },
      { to: '/calendar', icon: Calendar, label: 'Calendar' },
      { to: '/my/events', icon: Ticket, label: 'Events' },
      // "Integrations" merged into Settings (/settings/integrations); the
      // /integrations route redirects there. Removed from the investor nav.
      // Advisors, Partners, Jobs and Articles were trimmed from the investor
      // Account group — they remain reachable by URL for other roles.
      { to: '/activity', icon: Activity, label: 'Activity' },
      { to: '/docs', icon: BookOpen, label: 'Docs' },
      { to: '/tickets', icon: MessageSquare, label: 'Support' },
      { to: '/settings', icon: SettingsIcon, label: 'Settings' },
    ]},
  ],

  advisor: [
    { key: 'home', label: 'Home', items: [
      { to: '/office-hours', icon: Calendar, label: 'Office Hours', highlight: true },
      { to: '/products', icon: Package, label: 'Products' },
    ]},
    // Task #23 — each Advisor workspace is its own sidebar group so its
    // sub-sections are visible directly (mirrors the founder/partner/investor
    // profiles). This replaces the old single "Workspaces" group that collapsed
    // each workspace into one link. Every route these single links pointed at is
    // preserved as a sub-entry; `match` keeps the correct row active across the
    // tab, its sub-routes, and legacy aliases.
    { key: 'network', label: 'Network', items: [
      { to: '/advisor/network/introductions', icon: Sparkles, label: 'Introductions' },
      { to: '/advisor/network/relationships', icon: Users, label: 'Relationships', match: ['/advisor/network/relationships', '/network', '/relationships', '/contacts'] },
      { to: '/advisor/network/organizations', icon: Globe, label: 'Organizations' },
    ]},
    { key: 'advisory', label: 'Advisory', items: [
      { to: '/advisor/advisory/opportunities', icon: Target, label: 'Opportunities' },
      { to: '/advisor/advisory/clients', icon: Users, label: 'Clients' },
      { to: '/advisor/advisory/engagements', icon: Layers, label: 'Engagements' },
      { to: '/advisor/advisory/delivery', icon: Package, label: 'Delivery' },
      { to: '/advisor/advisory/contracts', icon: FileText, label: 'Contracts' },
    ]},
    { key: 'growth', label: 'Growth', items: [
      { to: '/advisor/growth/talent', icon: Users, label: 'Talent' },
      { to: '/advisor/growth/customers', icon: Briefcase, label: 'Customers' },
      { to: '/advisor/growth/partnerships', icon: Handshake, label: 'Partnerships' },
      { to: '/advisor/growth/capital', icon: DollarSign, label: 'Capital' },
      { to: '/advisor/growth/experts', icon: Brain, label: 'Experts' },
    ]},
    { key: 'research', label: 'Research', items: [
      { to: '/advisor/research/market', icon: Radar, label: 'Market' },
      { to: '/advisor/research/companies', icon: Globe, label: 'Companies' },
      { to: '/advisor/research/funds', icon: Wallet, label: 'Funds' },
      { to: '/advisor/research/ai', icon: Brain, label: 'AI Research' },
      { to: '/advisor/research/news', icon: Send, label: 'News' },
      { to: '/advisor/research/documents', icon: FileText, label: 'Documents' },
    ]},
    { key: 'engagements', label: 'Engagements', items: [
      { to: '/calendar', icon: Calendar, label: 'Calendar' },
      { to: '/my/events', icon: Ticket, label: 'Events' },
      { to: '/my/jobs', icon: Briefcase, label: 'Jobs' },
      { to: '/advisors', icon: UserCircle, label: 'Advisor Directory' },
      { to: '/signals', icon: Radar, label: 'Signals' },
      { to: '/due-diligence', icon: ShieldCheck, label: 'Due Diligence' },
      { to: '/tickets', icon: Ticket, label: 'Support' },
    ]},
    { key: 'account', label: 'Account', items: [
      { to: '/articles/draft', icon: FileText, label: 'Articles' },
      { to: '/activity', icon: Activity, label: 'Activity Log' },
      { to: '/docs', icon: BookOpen, label: 'Documentation' },
      { to: '/settings', icon: SettingsIcon, label: 'Settings' },
    ]},
  ],

  // Task #9 — 'exploring' holding state: chat-onboarded users awaiting the
  // binding agreement + admin role assignment. Deliberately lean — the
  // Studio (Personal Advisor + Profile & Fit) plus account basics only.
  // An explicit group is REQUIRED here: the sidebar falls back to the
  // founder nav for unknown roles, which exploring users must never see.
  exploring: [
    { key: 'home', label: 'Home', items: [
      { to: '/exploring', icon: LayoutDashboard, label: 'Studio', highlight: true },
      // Task #13 — surface the Spin-Out Lab program to explorers so they can
      // see the full 28-day pipeline before committing.
      { to: '/spinout-lab', icon: Rocket, label: 'Spin-Out Lab' },
      // Explorer completion incentive — where the one-time 30-day-license
      // promo code from the Personal Advisor gets redeemed.
      { to: '/products', icon: Package, label: 'Products' },
    ]},
    { key: 'account', label: 'Account', items: [
      { to: '/profile', icon: UserCircle, label: 'My Profile' },
      { to: '/docs', icon: BookOpen, label: 'Documentation' },
      { to: '/trust', icon: Lock, label: 'Trust Center' },
      { to: '/activity', icon: Activity, label: 'Activity Log' },
      { to: '/tickets', icon: MessageSquare, label: 'Support' },
      { to: '/settings', icon: SettingsIcon, label: 'Settings' },
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
