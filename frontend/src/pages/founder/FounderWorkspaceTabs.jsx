import React from 'react';
import {
  MessageSquare, Package, Brain, Briefcase, Map, TrendingUp,
  Sparkles, DollarSign, Scale, Shield, Users, Megaphone, Gift, Network, Radar, Globe,
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
 * to Capital to Legal. `ExecutionPage`, `TeamBuildingPage`, `DiscoveryPage`,
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
 *   /market-intel is guarded `labRoles(['admin','partner','investor'])` — it
 *   omits founder from the list outright and admits one only while
 *   `spinout_lab_active === 1`. That predates this shell and the guard is not
 *   changed here, but the tab must not lie about it, so it carries
 *   `labOnlyFor` and disappears for a founder who is not in the Lab. The
 *   Research ROW points at /signals for the same reason: every founder can
 *   open it, so the row is never a bounce.
 */

const SETS = {
  // Canvas has no Validate page, so these are the three rows the group held.
  validate: [
    { to: '/build/discovery', label: 'Discovery', icon: MessageSquare,
      roles: ['admin', 'founder', 'partner', 'investor'] },
    { to: '/build/marketplace', label: 'Marketplace', icon: Package,
      roles: ['admin', 'founder'] },
    { to: '/advisory', label: 'Advisory', icon: Brain,
      roles: ['admin', 'founder'] },
  ],
  // Canvas zones: This week · Board · Roadmap · Cadence · KPI entry.
  // This week + Board are ExecutionPage; Cadence has no route outside the Lab.
  build: [
    { to: '/execution', label: 'Execution', icon: Briefcase,
      roles: ['admin', 'founder'] },
    { to: '/build/roadmap', label: 'Roadmap', icon: Map,
      roles: ['admin', 'founder', 'partner', 'investor'] },
    { to: '/build/metrics', label: 'Metrics', icon: TrendingUp,
      roles: ['admin', 'founder', 'partner', 'investor'] },
  ],
  // Canvas zones: Status · Pitch · Capital · Legal · Data room · Liquidity.
  // Status has no route; the other five are all here.
  raise: [
    { to: '/raise/pitch', label: 'Pitch', icon: Sparkles,
      roles: ['admin', 'founder'] },
    { to: '/raise/capital', label: 'Capital', icon: DollarSign,
      roles: ['admin', 'founder'] },
    { to: '/raise/legal-engine', label: 'Legal', icon: Scale,
      roles: ['admin', 'founder', 'partner'] },
    { to: '/raise/data-room', label: 'Data room', icon: Shield,
      roles: ['admin', 'founder', 'investor'] },
    { to: '/liquidity', label: 'Liquidity', icon: TrendingUp,
      roles: ['admin', 'founder', 'partner', 'investor'], requiredTier: 'studio' },
  ],
  // Canvas zones: Focus · Talent · Customers · Partnerships · Capital match ·
  // Brand · Launch. Only Talent, Brand and Launch have routes today; Perks and
  // Network effects are not canvas zones but are real surfaces that lost their
  // rows here, so they keep a door.
  grow: [
    { to: '/build/team', label: 'Talent', icon: Users,
      roles: ['admin', 'founder'] },
    { to: '/spinout-lab/brand', label: 'Brand', icon: Sparkles,
      roles: ['admin', 'founder'] },
    { to: '/comarketing', label: 'Launch', icon: Megaphone,
      roles: ['admin', 'partner', 'founder', 'investor'] },
    { to: '/perks', label: 'Perks', icon: Gift,
      roles: ['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'] },
    { to: '/network-effects', label: 'Network effects', icon: Network,
      roles: ['admin', 'founder', 'partner', 'investor'] },
  ],
  // Canvas zones: Ask · Markets · Companies · Funds · Library. Only Markets has
  // a route; Signals is the founder's other backed research surface and had no
  // door left. The four unbacked tabs withdrawn in task #172 stay withdrawn.
  research: [
    { to: '/market-intel', label: 'Market', icon: Globe,
      roles: ['admin', 'founder', 'partner', 'investor'], labOnlyFor: ['founder'] },
    { to: '/signals', label: 'Signals', icon: Radar,
      roles: ['admin', 'founder', 'partner', 'investor', 'advisor'] },
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
      {tabs.length > 1 && <WorkspaceTabs tabs={tabs.map(({ to, label, icon }) => ({ to, label, icon }))} />}
      {children}
    </>
  );
}

/** Exported for the test that checks every tab's guard matches its route. */
export const FOUNDER_TAB_SETS = SETS;
