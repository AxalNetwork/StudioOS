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
  Globe, Brain, Activity, Shield, Code, ShieldCheck, Share2, Wallet,
  Network, Sparkles, Briefcase, TrendingUp, Layers, Scale, Plug,
  MessageSquare, Package, Lock, Calendar, Heart, Bookmark, Megaphone,
  BookOpen, Settings as SettingsIcon, PieChart as PieIcon,
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

export const SIDEBAR_GROUPS = {
  admin: [
    { key: 'home', label: 'Home', items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    ]},
    { key: 'admin', label: 'Admin', items: [
      { to: '/admin', icon: Shield, label: 'Admin Console' },
      { to: '/admin/due-diligence', icon: ShieldCheck, label: 'Due Diligence' },
      { to: '/monitoring', icon: Activity, label: 'Monitoring' },
    ]},
    { key: 'core', label: 'Core', items: [
      { to: '/projects', icon: Zap, label: 'Projects' },
      { to: '/pipeline', icon: Layers, label: 'Pipeline Board' },
      { to: '/studio-ops', icon: Briefcase, label: 'Studio Ops' },
      { to: '/spinouts', icon: Rocket, label: 'Spin-Outs' },
    ]},
    { key: 'intelligence', label: 'Intelligence', items: [
      { to: '/scoring', icon: Target, label: 'Scoring Engine' },
      { to: '/market-intel', icon: Globe, label: 'Market Intelligence' },
      { to: '/advisory', icon: Brain, label: 'AI Advisory Suite' },
      { to: '/matches', icon: Sparkles, label: 'AI Matches' },
      { to: '/deals', icon: Handshake, label: 'Deal Flow' },
    ]},
    { key: 'network', label: 'Network', items: [
      { to: '/partners', icon: Users, label: 'Partners' },
      { to: '/refer', icon: Share2, label: 'Refer & Earn' },
      { to: '/relationships', icon: Handshake, label: 'Relationships' },
      { to: '/network-effects', icon: TrendingUp, label: 'Network Effects' },
    ]},
    { key: 'capital', label: 'Capital & Liquidity', items: [
      { to: '/capital', icon: DollarSign, label: 'Capital & Investment' },
      { to: '/liquidity', icon: TrendingUp, label: 'Liquidity & Exits' },
      { to: '/payouts', icon: Wallet, label: 'Payouts' },
      { to: '/portfolio/health', icon: Heart, label: 'Portfolio Health' },
      { to: '/portfolio/reserves', icon: Layers, label: 'Reserve Allocation' },
      { to: '/portfolio/waterfall', icon: TrendingUp, label: 'Exit Waterfall' },
      { to: '/watchlist', icon: Bookmark, label: 'Watchlist & Journal' },
    ]},
    { key: 'legal', label: 'Legal & Compliance', items: [
      { to: '/legal-capital', icon: Scale, label: 'Legal & Capital' },
      { to: '/incorporate', icon: Scale, label: 'Incorporate' },
      { to: '/incorporate/cofounder-agreement', icon: Users, label: 'Co-Founder Agreement' },
      { to: '/incorporate/83b', icon: Calendar, label: '83(b) Tracker' },
      { to: '/compliance', icon: Calendar, label: 'Compliance Calendar' },
      { to: '/trust', icon: Lock, label: 'Trust Center' },
      { to: '/wellbeing', icon: Heart, label: 'Founder Wellbeing' },
    ]},
    { key: 'advanced', label: 'Advanced', items: [
      { to: '/integrations', icon: Plug, label: 'Integrations' },
      { to: '/marketplace', icon: Briefcase, label: 'Marketplace' },
      { to: '/services', icon: Package, label: 'Service Catalogue' },
      { to: '/needs', icon: MessageSquare, label: 'Needs Board' },
      { to: '/partner/insights', icon: TrendingUp, label: 'Demand Insights' },
      { to: '/partner/office-hours', icon: Calendar, label: 'Partner Office Hours' },
      { to: '/comarketing', icon: Megaphone, label: 'Co-Marketing Review' },
    ]},
    { key: 'portals', label: 'Portals', items: [
      { to: '/founder', icon: Rocket, label: 'Founder Portal' },
      { to: '/partner-portal', icon: UserCircle, label: 'Partner / Investor Portal' },
    ]},
    { key: 'account', label: 'Account', items: [
      { to: '/activity', icon: Activity, label: 'Activity Log' },
      { to: '/tickets', icon: Ticket, label: 'Support' },
      { to: '/docs', icon: BookOpen, label: 'Documentation' },
      { to: '/settings', icon: SettingsIcon, label: 'Settings' },
    ]},
  ],

  founder: [
    { key: 'home', label: 'Home', items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/founder', icon: Rocket, label: 'Founder Portal', highlight: true },
    ]},
    { key: 'build', label: 'Build', items: [
      { to: '/projects', icon: Zap, label: 'Projects' },
      { to: '/pipeline', icon: Layers, label: 'Pipeline Board' },
      { to: '/studio-ops', icon: Briefcase, label: 'Studio Ops' },
      { to: '/spinouts', icon: Rocket, label: 'Spin-Outs' },
      { to: '/build/brand', icon: Sparkles, label: 'Brand & Landing' },
      { to: '/build/deck', icon: Sparkles, label: 'Pitch Deck', requiredTier: 'growth' },
      { to: '/build/financials', icon: DollarSign, label: 'Financial Model' },
      { to: '/build/discovery', icon: MessageSquare, label: 'Customer Discovery' },
      { to: '/build/roadmap', icon: Layers, label: 'Roadmap' },
      { to: '/build/metrics', icon: TrendingUp, label: 'Metrics' },
      { to: '/build/captable', icon: PieIcon, label: 'Cap Table' },
    ]},
    { key: 'validate', label: 'Validate', items: [
      { to: '/advisory', icon: Brain, label: 'AI Advisory Suite' },
      { to: '/mentors', icon: UserCircle, label: 'Find a Mentor', requiredTier: 'growth' },
      { to: '/cofounder', icon: Users, label: 'Find a Co-founder', requiredTier: 'studio' },
    ]},
    { key: 'capital', label: 'Capital & Liquidity', items: [
      { to: '/liquidity', icon: TrendingUp, label: 'Liquidity & Exits', requiredTier: 'studio' },
      { to: '/payouts', icon: Wallet, label: 'Payouts' },
      { to: '/portfolio/health', icon: Heart, label: 'Portfolio Health', requiredTier: 'studio' },
    ]},
    { key: 'legal', label: 'Legal & Compliance', items: [
      { to: '/legal-capital', icon: Scale, label: 'Legal & Capital', requiredTier: 'studio' },
      { to: '/incorporate', icon: Scale, label: 'Incorporate' },
      { to: '/incorporate/cofounder-agreement', icon: Users, label: 'Co-Founder Agreement', requiredTier: 'studio' },
      { to: '/incorporate/83b', icon: Calendar, label: '83(b) Tracker', requiredTier: 'studio' },
      { to: '/compliance', icon: Calendar, label: 'Compliance Calendar' },
      { to: '/trust', icon: Lock, label: 'Trust Center' },
    ]},
    { key: 'wellbeing', label: 'Wellbeing', items: [
      { to: '/wellbeing', icon: Heart, label: 'Founder Wellbeing' },
    ]},
    { key: 'network', label: 'Network & Growth', items: [
      { to: '/services', icon: Package, label: 'Service Catalogue' },
      { to: '/needs', icon: MessageSquare, label: 'Needs Board' },
      { to: '/refer', icon: Share2, label: 'Refer & Earn' },
      { to: '/relationships', icon: Handshake, label: 'Relationships' },
      { to: '/network-effects', icon: TrendingUp, label: 'Network Effects' },
      { to: '/calendar', icon: Calendar, label: 'Calendar' },
    ]},
    { key: 'account', label: 'Account', items: [
      { to: '/activity', icon: Activity, label: 'Activity Log' },
      { to: '/tickets', icon: Ticket, label: 'Support' },
      { to: '/docs', icon: BookOpen, label: 'Documentation' },
      { to: '/settings', icon: SettingsIcon, label: 'Settings' },
    ]},
  ],

  partner: [
    { key: 'home', label: 'Home', items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/partner-portal', icon: UserCircle, label: 'Partner Portal', highlight: true },
    ]},
    { key: 'sourcing', label: 'Sourcing', items: [
      { to: '/projects', icon: Zap, label: 'Projects' },
      { to: '/pipeline', icon: Layers, label: 'Pipeline Board' },
      { to: '/deals', icon: Handshake, label: 'Deal Flow' },
      { to: '/matches', icon: Sparkles, label: 'AI Matches' },
      { to: '/marketplace', icon: Briefcase, label: 'Marketplace' },
      { to: '/partner/office-hours', icon: Calendar, label: 'My Office Hours' },
      { to: '/network-effects', icon: TrendingUp, label: 'Network Effects' },
    ]},
    { key: 'insights', label: 'Insights', items: [
      { to: '/scoring', icon: Target, label: 'Scoring Engine' },
      { to: '/market-intel', icon: Globe, label: 'Market Intelligence' },
      { to: '/partner/insights', icon: TrendingUp, label: 'Demand Insights' },
    ]},
    { key: 'network', label: 'Network', items: [
      { to: '/services', icon: Package, label: 'My Service Catalogue' },
      { to: '/needs', icon: MessageSquare, label: 'Needs Board' },
      { to: '/partners', icon: Users, label: 'Partners' },
      { to: '/comarketing', icon: Megaphone, label: 'Co-Marketing' },
      { to: '/refer', icon: Share2, label: 'Refer & Earn' },
      { to: '/relationships', icon: Handshake, label: 'Relationships' },
      { to: '/mentors', icon: UserCircle, label: 'Find a Mentor' },
      { to: '/calendar', icon: Calendar, label: 'Calendar' },
    ]},
    { key: 'capital', label: 'Capital & Liquidity', items: [
      { to: '/liquidity', icon: TrendingUp, label: 'Liquidity & Exits' },
      { to: '/payouts', icon: Wallet, label: 'Payouts' },
      { to: '/portfolio/health', icon: Heart, label: 'Portfolio Health' },
      { to: '/watchlist', icon: Bookmark, label: 'Watchlist & Journal' },
    ]},
    { key: 'legal', label: 'Legal & Compliance', items: [
      { to: '/legal-capital', icon: Scale, label: 'Legal & Capital' },
      { to: '/admin/due-diligence', icon: ShieldCheck, label: 'Due Diligence' },
      { to: '/kyc', icon: ShieldCheck, label: 'Identity Verification' },
      { to: '/trust', icon: Lock, label: 'Trust Center' },
    ]},
    { key: 'account', label: 'Account', items: [
      { to: '/activity', icon: Activity, label: 'Activity Log' },
      { to: '/tickets', icon: Ticket, label: 'Support' },
      { to: '/docs', icon: BookOpen, label: 'Documentation' },
      { to: '/settings', icon: SettingsIcon, label: 'Settings' },
    ]},
  ],

  investor: [
    { key: 'home', label: 'Home', items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/partner-portal', icon: UserCircle, label: 'Investor Portal', highlight: true },
    ]},
    { key: 'pipeline', label: 'Pipeline', items: [
      { to: '/projects', icon: Zap, label: 'Projects' },
      { to: '/pipeline', icon: Layers, label: 'Pipeline Board' },
      { to: '/deals', icon: Handshake, label: 'Deal Flow' },
      { to: '/matches', icon: Sparkles, label: 'AI Matches' },
      { to: '/watchlist', icon: Bookmark, label: 'Watchlist & Journal' },
    ]},
    { key: 'intelligence', label: 'Intelligence', items: [
      { to: '/scoring', icon: Target, label: 'Scoring Engine' },
      { to: '/market-intel', icon: Globe, label: 'Market Intelligence' },
    ]},
    { key: 'portfolio', label: 'Portfolio', items: [
      { to: '/capital', icon: DollarSign, label: 'Capital & Investment' },
      { to: '/funds', icon: TrendingUp, label: 'Funds' },
      { to: '/liquidity', icon: TrendingUp, label: 'Liquidity & Exits' },
      { to: '/portfolio/health', icon: Heart, label: 'Portfolio Health' },
      { to: '/portfolio/reserves', icon: Layers, label: 'Reserve Allocation' },
      { to: '/portfolio/waterfall', icon: TrendingUp, label: 'Exit Waterfall' },
    ]},
    { key: 'network', label: 'Network', items: [
      { to: '/mentors', icon: UserCircle, label: 'Find a Mentor' },
      { to: '/calendar', icon: Calendar, label: 'Calendar' },
    ]},
    { key: 'legal', label: 'Legal & Compliance', items: [
      { to: '/legal-capital', icon: Scale, label: 'Legal & Capital' },
      { to: '/admin/due-diligence', icon: ShieldCheck, label: 'Due Diligence' },
      { to: '/kyc', icon: ShieldCheck, label: 'Identity Verification' },
      { to: '/trust', icon: Lock, label: 'Trust Center' },
    ]},
    { key: 'account', label: 'Account', items: [
      { to: '/activity', icon: Activity, label: 'Activity Log' },
      { to: '/tickets', icon: Ticket, label: 'Support' },
      { to: '/docs', icon: BookOpen, label: 'Documentation' },
      { to: '/settings', icon: SettingsIcon, label: 'Settings' },
    ]},
  ],

  mentor: [
    { key: 'home', label: 'Home', items: [
      { to: '/office-hours', icon: Calendar, label: 'Office Hours', highlight: true },
    ]},
    { key: 'engagements', label: 'Engagements', items: [
      { to: '/calendar', icon: Calendar, label: 'Calendar' },
      { to: '/mentors', icon: UserCircle, label: 'Mentor Directory' },
      { to: '/admin/due-diligence', icon: ShieldCheck, label: 'Due Diligence' },
      { to: '/tickets', icon: Ticket, label: 'Support' },
    ]},
    { key: 'account', label: 'Account', items: [
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
