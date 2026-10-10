import React from 'react';
import {
  MessageSquare, Package, Brain, Briefcase, Map, TrendingUp,
  Sparkles, DollarSign, Scale, Shield, Users, Megaphone, Gift, Network,
} from 'lucide-react';
import WorkspaceTabs from '../../components/WorkspaceTabs';
import { hasTier } from '../../sidebarConfig';

/**
 * The tab bars that let the Founder shell's five workspace rows actually own
 * their sections.
 *
 * WHY A WRAPPER AND NOT AN EDIT — the same reason it was one for Partner.
 * `PitchWorkspacePage`, `CapitalWorkspacePage` and `LegalEnginePage` each
 * render a tab bar, but only across their OWN sub-routes; nothing links Pitch
 * to Capital to Legal. `ExecutionPage`, `FounderTeamPage`, `DiscoveryPage`,
 * `FounderMarketplacePage` and the rest have no bar at all and take no
 * `embedded` prop. Wrapping at the route is additive: no page changes, and
 * reverting is deleting one element from App.jsx.
 *
 * The audit this replaces. Searching every `to=`, `to:`, `navigate(` and
 * `link=` in frontend/src outside sidebarConfig.js, seven founder destinations
 * had ZERO inbound links — their sidebar row was the only door:
 *
 *     /messages  /execution  /signals  /build/team
 *     /build/metrics  /network-effects  /raise/capital
 *
 * (/signals and /market-intel were retired by D670 and redirect to
 * /research, so the Research set they made up is gone.)
 *
 * Collapsing twenty-one rows to ten without these bars would have stranded six
 * of them (/messages keeps a row of its own).
 *
 * THE ROLE AND TIER FILTERS. As with Partner, each tab carries the guard its
 * route carries in App.jsx, so the bar renders only what this viewer can
 * actually open. Two extra notes:
 *
 *   /liquidity carried `requiredTier: 'studio'` as a sidebar row. The ROUTE has
 *   no tier gate — the nav was the whole gate — so the tab reproduces it with
 *   `hasTier` rather than silently widening who sees the surface.
 *
 *   A tab whose route is wrapped in `labRoles()` for some role carries
 *   `labOnlyFor` with that role, so it disappears for anyone outside the Lab
 *   instead of opening a bounce. No tab needs it since /market-intel's tab
 *   left with the page (D670); the check stays for the next one.
 */

// WHERE THIS BAR STILL DRAWS (#1447). The canvas zone pages — /validate/*,
// /build/this-week and the other Build sections, /raise/status … /raise/liquidity,
// /grow/* and /research/* — each draw their own section row, so none of them
// is wrapped in this bar. It is drawn only on the older editor pages those
// zones hand off to (`?mode=workspace`, /execution, /raise/legal-engine,
// /build/metrics, /comarketing, …), which have no section row of their own.
const SETS = {
  // The editors behind Validate's stage pages (/validate/interviews, …).
  validate: [
    { to: '/build/discovery', label: 'Discovery', icon: MessageSquare,
      roles: ['admin', 'founder', 'partner', 'investor'] },
    { to: '/build/marketplace', label: 'Marketplace', icon: Package,
      roles: ['admin', 'founder'] },
    { to: '/advisory', label: 'Advisory', icon: Brain,
      roles: ['admin', 'founder'] },
  ],
  // Canvas zones: This week · Board · Roadmap · Cadence · KPI entry, each its
  // own page now. These are the editors behind them.
  build: [
    { to: '/execution', label: 'Execution', icon: Briefcase,
      roles: ['admin', 'founder'] },
    // FOUNDER-ONLY, BECAUSE THE PAGE IS. `FounderBuildRoadmap` takes no `role`
    // and draws the founder "Build sections" nav, so a partner or investor
    // admitted here got the founder's body and the founder's navigation. The
    // route narrowed to match the shell (`route_role_zone_contract.test.mjs`);
    // this row narrows with it, because a tab whose route bounces the viewer is
    // worse than an absent one.
    { to: '/build/roadmap', label: 'Roadmap', icon: Map,
      roles: ['admin', 'founder'] },
    { to: '/build/metrics', label: 'Metrics', icon: TrendingUp,
      roles: ['admin', 'founder', 'partner', 'investor'] },
  ],
  // Canvas zones: Status · Pitch · Capital · Legal · Data room · Liquidity, each
  // its own page at /raise/<zone>. These are the editors behind five of them;
  // Status is a read with no editor.
  raise: [
    { to: '/raise/pitch', label: 'Pitch', icon: Sparkles,
      roles: ['admin', 'founder'] },
    { to: '/raise/capital', label: 'Capital', icon: DollarSign,
      roles: ['admin', 'founder'] },
    { to: '/raise/legal-engine', label: 'Legal', icon: Scale,
      roles: ['admin', 'founder', 'partner'] },
    { to: '/raise/data-room', label: 'Data room', icon: Shield,
      roles: ['admin', 'founder', 'investor'] },
    // A founder's /liquidity redirects to /raise/liquidity?mode=workspace
    // (D563), so the tab lights on both addresses.
    { to: '/liquidity', label: 'Liquidity', icon: TrendingUp, match: ['/liquidity', '/raise/liquidity'],
      roles: ['admin', 'founder', 'partner', 'investor'], requiredTier: 'studio' },
  ],
  // Canvas zones: Focus · Talent · Customers · Partnerships · Capital match ·
  // Brand · Launch, each its own page at /grow/<zone>. These are the editors
  // behind them; Perks and Network effects are not canvas zones but are real
  // surfaces that lost their rows here, so they keep a door.
  grow: [
    { to: '/build/team', label: 'Talent', icon: Users,
      roles: ['admin', 'founder'] },
    { to: '/grow/brand', label: 'Brand', icon: Sparkles,
      roles: ['admin', 'founder'] },
    { to: '/comarketing', label: 'Launch', icon: Megaphone,
      roles: ['admin', 'partner', 'founder', 'investor'] },
    { to: '/perks', label: 'Perks', icon: Gift,
      roles: ['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'] },
    { to: '/network-effects', label: 'Network effects', icon: Network,
      roles: ['admin', 'founder', 'partner', 'investor'] },
  ],
};

// A tab is offered only when this viewer could actually open its route: the
// role is on the route's guard list, any `labRoles` widening actually applies,
// and any tier the nav used to gate on is met.
const admits = (t, user) => {
  if (!t.roles.includes(user?.role)) return false;
  if (t.labOnlyFor?.includes(user?.role) && Number(user?.spinout_lab_active) !== 1) return false;
  return hasTier(user, t.requiredTier);
};

export default function FounderWorkspaceTabs({ set, user, children }) {
  const tabs = (SETS[set] || []).filter((t) => admits(t, user));
  // One visible tab is a bar that says nothing. Render the page alone.
  return (
    <>
      {tabs.length > 1 && <WorkspaceTabs tabs={tabs.map(({ to, label, icon, match }) => ({ to, label, icon, match }))} />}
      {children}
    </>
  );
}

/** Exported for the test that checks every tab's guard matches its route. */
export const FOUNDER_TAB_SETS = SETS;
