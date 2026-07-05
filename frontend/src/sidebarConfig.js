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
  Globe, Brain, Activity, Shield, ShieldCheck, Share2, Wallet,
  Network, Sparkles, Briefcase, TrendingUp, Layers, Scale, Plug,
  MessageSquare, Package, Lock, Calendar, Heart, Bookmark, Megaphone, Send,
  BookOpen, Settings as SettingsIcon, PieChart as PieIcon, Gamepad2, ShieldAlert,
  Gavel, Inbox, FileBarChart, Radar,
} from 'lucide-react';

// Task #6 — Real subscription-tier check. Bypass roles
// (admin/partner/investor/mentor) always pass; founders are gated by their
// `subscription_tier` column. Mirrors the worker's `userMeetsTier` helper.
const TIER_RANK = { free: 0, growth: 1, studio: 2 };
const BYPASS_ROLES = new Set(['admin', 'partner', 'investor', 'mentor']);
export function hasTier(user, requiredTier) {
  if (!requiredTier || requiredTier === 'free') return true;
  if (!user) return false;
  if (BYPASS_ROLES.has(String(user.role))) return true;
  const have = TIER_RANK[String(user.subscription_tier || 'free').toLowerCase()] ?? 0;
  return have >= (TIER_RANK[requiredTier] ?? 0);
}

// Task #7 (W-2) — Investor tier ladder mirrors the worker's
// `userMeetsInvestorTier`. Bypass roles (admin/partner/mentor) always pass.
// Trialing/active are honoured via the `investor_subscription_status` column;
// past_due/unpaid/cancelled drop the user to free.
const INVESTOR_RANK = { free: 0, professional: 1, institutional: 2 };
const INVESTOR_BYPASS_ROLES = new Set(['admin', 'partner', 'mentor']);
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
// learning curve drops without losing reachability. Mentor is already lean
// and is left unchanged.
export const SIDEBAR_GROUPS = {
  admin: [
    { key: 'home', label: 'Home', items: [
      { to: '/studio', icon: LayoutDashboard, label: 'Studio' },
    ]},
    { key: 'admin', label: 'Admin', items: [
      { to: '/admin', icon: Shield, label: 'Admin Console' },
      { to: '/admin/due-diligence', icon: ShieldCheck, label: 'Due Diligence' },
      { to: '/admin/assessment', icon: Gamepad2, label: 'Assessment Studio' },
      { to: '/admin/best-fit', icon: Sparkles, label: 'Best-Fit Console' },
      { to: '/admin/events', icon: Ticket, label: 'Event Admin' },
      { to: '/admin/jobs', icon: Briefcase, label: 'Job Board Admin' },
      { to: '/monitoring', icon: Activity, label: 'Monitoring' },
      { to: '/admin/telegram', icon: Send, label: 'Telegram Channels' },
      // X (Twitter) broadcaster temporarily hidden — OAuth not provisioned yet.
      // Re-enable once X_CLIENT_ID/SECRET are bound on the prod worker.
      // { to: '/admin/x', icon: Megaphone, label: 'X (Twitter)' },
      { to: '/admin/articles', icon: FileText, label: 'Content Queue' },
    ]},
    { key: 'studio', label: 'Studio', items: [
      { to: '/projects', icon: Zap, label: 'Projects' },
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
      { to: '/payouts', icon: Wallet, label: 'Payouts' },
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
      { to: '/refer', icon: Share2, label: 'Refer & Earn' },
      { to: '/relationships', icon: Handshake, label: 'Relationships' },
      { to: '/network-effects', icon: TrendingUp, label: 'Network Effects' },
      { to: '/calendar', icon: Calendar, label: 'Calendar' },
      { to: '/my/events', icon: Ticket, label: 'Events' },
      { to: '/my/jobs', icon: Briefcase, label: 'Jobs' },
      { to: '/integrations', icon: Plug, label: 'Integrations' },
      { to: '/marketplace', icon: Briefcase, label: 'Marketplace' },
      { to: '/services', icon: Package, label: 'Service Catalogue' },
      { to: '/needs', icon: MessageSquare, label: 'Needs Board' },
      { to: '/partner/insights', icon: TrendingUp, label: 'Demand Insights' },
      { to: '/partner/office-hours', icon: Calendar, label: 'Partner Office Hours' },
      { to: '/comarketing', icon: Megaphone, label: 'Co-Marketing Review' },
    ]},
    { key: 'more', label: 'More', items: [
      { to: '/incorporate/cofounder-agreement', icon: Users, label: 'Co-Founder Agreement' },
      { to: '/incorporate/83b', icon: Calendar, label: '83(b) Tracker' },
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
  //   • "Founder Portal" (/founder) — redundant with Studio/Home; founders
  //     hitting /founder are redirected to /studio in App.jsx. The route stays
  //     registered for admin.
  //   • "Portfolio Health" (/portfolio/health) — folded into Metrics
  //     (/build/metrics) as the founder's own company-health view; the
  //     /portfolio/health route stays registered and reachable for other roles.
  //   • "Network Effects" (/network-effects) is demoted to More while a single
  //     "Network" entry (/relationships) leads Validate; both routes stay live.
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
    ]},
    { key: 'build', label: 'Build', items: [
      // Task #12/#14 — Projects, Pipeline Board and Roadmap are merged into one
      // Execution area (founder persona only). `match` keeps the item active
      // across every Execution view and its legacy deep-linked routes.
      { to: '/execution', icon: Zap, label: 'Execution', match: ['/execution', '/projects', '/pipeline', '/build/roadmap'] },
      { to: '/studio-ops', icon: Briefcase, label: 'Studio Ops' },
      { to: '/signals', icon: Radar, label: 'Signals' },
      { to: '/build/metrics', icon: TrendingUp, label: 'Metrics' },
      { to: '/build/brand', icon: Sparkles, label: 'Brand & Landing' },
      { to: '/spinouts', icon: Rocket, label: 'Spin-Outs' },
    ]},
    { key: 'validate', label: 'Validate', items: [
      { to: '/contacts', icon: Inbox, label: 'Contacts' },
      { to: '/build/discovery', icon: MessageSquare, label: 'Customer Discovery' },
      { to: '/needs', icon: MessageSquare, label: 'Needs Board' },
      { to: '/services', icon: Package, label: 'Service Catalogue' },
      { to: '/build/competitors', icon: Megaphone, label: 'Competitor Analysis' },
      { to: '/advisory', icon: Brain, label: 'AI Advisory Suite' },
      { to: '/mentors', icon: UserCircle, label: 'Find a Mentor', requiredTier: 'growth' },
      { to: '/cofounder', icon: Users, label: 'Find a Co-founder', requiredTier: 'studio' },
      { to: '/relationships', icon: Handshake, label: 'Network' },
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
      { to: '/my/jobs', icon: Briefcase, label: 'Jobs' },
      { to: '/comarketing', icon: Megaphone, label: 'Co-Marketing' },
      { to: '/articles/draft', icon: FileText, label: 'Articles' },
    ]},
    { key: 'more', label: 'More', items: [
      { to: '/refer', icon: Share2, label: 'Refer & Earn' },
      { to: '/wellbeing', icon: Heart, label: 'Founder Wellbeing' },
      { to: '/network-effects', icon: TrendingUp, label: 'Network Effects' },
      { to: '/liquidity', icon: TrendingUp, label: 'Liquidity & Exits', requiredTier: 'studio' },
      { to: '/payouts', icon: Wallet, label: 'Payouts' },
      { to: '/calendar', icon: Calendar, label: 'Calendar' },
    ]},
    { key: 'account', label: 'Account', items: [
      { to: '/trust', icon: Lock, label: 'Trust Center' },
      { to: '/tickets', icon: Ticket, label: 'Support' },
      { to: '/activity', icon: Activity, label: 'Activity Log' },
      { to: '/docs', icon: BookOpen, label: 'Documentation' },
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
  //   • Partners → Relationships (Engage); match keeps the item active on the
  //     legacy /partners route, which stays registered.
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
  //   • /mentors "Find a Mentor" — founder-oriented (a service partner is the
  //     expert, not the mentee); conditional.
  //   • /network-effects "Network Effects" — too abstract to earn a nav slot.
  //   • /articles/draft "Articles" — low-frequency authoring; conditional for
  //     content/press partners.
  partner: [
    { key: 'home', label: 'Home', items: [
      { to: '/studio', icon: LayoutDashboard, label: 'Studio' },
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
      { to: '/relationships', icon: Handshake, label: 'Relationships', match: ['/relationships', '/partners'] },
      { to: '/comarketing', icon: Megaphone, label: 'Co-Marketing' },
      { to: '/my/events', icon: Ticket, label: 'Events' },
      { to: '/my/jobs', icon: Briefcase, label: 'Jobs' },
    ]},
    { key: 'earn', label: 'Earn', items: [
      { to: '/payouts', icon: Wallet, label: 'Payouts' },
      { to: '/refer', icon: Share2, label: 'Refer & Earn' },
    ]},
    { key: 'account', label: 'Account', items: [
      { to: '/trust', icon: Lock, label: 'Trust Center' },
      { to: '/profile', icon: UserCircle, label: 'My Profile' },
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
    ]},
    { key: 'sourcing', label: 'Sourcing', items: [
      { to: '/deals', icon: Handshake, label: 'Deal Flow', requiredInvestorTier: 'professional' },
      { to: '/pipeline', icon: Layers, label: 'Pipeline Board', requiredInvestorTier: 'professional' },
      { to: '/matches', icon: Sparkles, label: 'AI Matches' },
      { to: '/watchlist', icon: Bookmark, label: 'Watchlist & Journal' },
    ]},
    { key: 'diligence', label: 'Diligence', items: [
      { to: '/scoring', icon: Target, label: 'Scoring Engine' },
      { to: '/admin/due-diligence', icon: ShieldCheck, label: 'Due Diligence' },
      { to: '/market-intel', icon: Globe, label: 'Market Intelligence' },
      { to: '/portfolio/risk-matrix', icon: ShieldAlert, label: 'Risk Matrix' },
    ]},
    { key: 'commit', label: 'Commit', items: [
      { to: '/ic', icon: Gavel, label: 'IC Decisions' },
      { to: '/legal-capital', icon: Scale, label: 'Legal & Capital' },
      { to: '/capital', icon: DollarSign, label: 'Capital & Investment' },
    ]},
    { key: 'support', label: 'Support', items: [
      { to: '/portfolio/health', icon: Heart, label: 'Portfolio Health' },
      { to: '/portfolio/updates', icon: Inbox, label: 'Company Updates' },
      { to: '/portfolio/positions', icon: PieIcon, label: 'Cap Table' },
      { to: '/funds', icon: TrendingUp, label: 'Funds' },
      { to: '/lp-reports', icon: FileBarChart, label: 'LP Reporting' },
      { to: '/portfolio/reserves', icon: Layers, label: 'Reserve Allocation' },
      { to: '/portfolio/waterfall', icon: TrendingUp, label: 'Exit Waterfall' },
      { to: '/liquidity', icon: TrendingUp, label: 'Liquidity & Exits' },
    ]},
    { key: 'account', label: 'Account', items: [
      { to: '/trust', icon: Lock, label: 'Trust & Identity' },
      { to: '/mentors', icon: Users, label: 'Mentors' },
      { to: '/partners', icon: Network, label: 'Partners' },
      { to: '/calendar', icon: Calendar, label: 'Calendar' },
      { to: '/my/events', icon: Ticket, label: 'Events' },
      { to: '/my/jobs', icon: Briefcase, label: 'Jobs' },
      { to: '/integrations', icon: Plug, label: 'Integrations' },
      { to: '/articles/draft', icon: FileText, label: 'Articles' },
      { to: '/activity', icon: Activity, label: 'Activity' },
      { to: '/docs', icon: BookOpen, label: 'Docs' },
      { to: '/tickets', icon: MessageSquare, label: 'Support' },
      { to: '/profile', icon: UserCircle, label: 'Profile' },
      { to: '/settings', icon: SettingsIcon, label: 'Settings' },
    ]},
  ],

  mentor: [
    { key: 'home', label: 'Home', items: [
      { to: '/office-hours', icon: Calendar, label: 'Office Hours', highlight: true },
    ]},
    { key: 'engagements', label: 'Engagements', items: [
      { to: '/calendar', icon: Calendar, label: 'Calendar' },
      { to: '/my/events', icon: Ticket, label: 'Events' },
      { to: '/my/jobs', icon: Briefcase, label: 'Jobs' },
      { to: '/mentors', icon: UserCircle, label: 'Mentor Directory' },
      { to: '/signals', icon: Radar, label: 'Signals' },
      { to: '/admin/due-diligence', icon: ShieldCheck, label: 'Due Diligence' },
      { to: '/tickets', icon: Ticket, label: 'Support' },
    ]},
    { key: 'account', label: 'Account', items: [
      { to: '/articles/draft', icon: FileText, label: 'Articles' },
      { to: '/activity', icon: Activity, label: 'Activity Log' },
      { to: '/docs', icon: BookOpen, label: 'Documentation' },
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
