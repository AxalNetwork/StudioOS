import React from 'react';
import { Target, Handshake, TrendingUp, Layers, Package, Gift, Megaphone, Calendar, Award } from 'lucide-react';
import WorkspaceTabs from '../../components/WorkspaceTabs';

/**
 * The tab bars that let the Partner shell's Pipeline and Offers rows actually
 * own their sections.
 *
 * WHY A WRAPPER AND NOT AN EDIT. `PartnerOperationsWorkspace` puts its tab bar
 * inside one page that renders all five of its children with an `embedded`
 * prop. The pages these rows point at — NeedsBoardPage, ServiceCatalogPage,
 * MatchesPage and the rest — are 500–1000 line files that take no such prop and
 * share no shell. Wrapping them at the route is additive: no page changes, no
 * new props, and reverting is deleting one element from App.jsx.
 *
 * THE ROLE FILTER IS THE POINT, and it is why this could not be a static array.
 * The tab targets do not share a guard:
 *
 *   /needs, /services                 admin founder partner investor
 *   /matches, /partner/insights       admin partner investor
 *   /perks                            admin founder partner investor advisor exploring
 *   /comarketing                      admin partner founder investor
 *   /partner/office-hours             admin partner
 *   /partner/operations/*             admin partner
 *
 * An investor on /services would otherwise see Office Hours and Capabilities
 * tabs that bounce them off the guard. A tab that cannot be opened is worse
 * than an absent one: the absent one costs a click-path this shell already
 * accounts for, the dead one costs trust in the whole bar. So each tab carries
 * the guard its route carries, copied from App.jsx, and the bar renders only
 * what this viewer can open.
 *
 * When a bar covers every section of a row, that row's siblings come out of
 * `sidebarConfig.js` AND out of the PENDING list in `partner_shell.test.mjs`,
 * in the same commit — the test enforces it.
 */

const SETS = {
  pipeline: [
    { to: '/needs', label: 'Leads', icon: Target,
      roles: ['admin', 'founder', 'partner', 'investor'] },
    { to: '/matches', label: 'Matches', icon: Handshake,
      roles: ['admin', 'partner', 'investor'] },
    { to: '/partner/insights', label: 'Demand', icon: TrendingUp,
      roles: ['admin', 'partner', 'investor'] },
    { to: '/partner/operations/engagements', label: 'Retainers', icon: Layers,
      roles: ['admin', 'partner'] },
  ],
  offers: [
    { to: '/services', label: 'Catalog', icon: Package,
      roles: ['admin', 'founder', 'partner', 'investor'] },
    { to: '/perks', label: 'Perk deals', icon: Gift,
      roles: ['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'] },
    { to: '/comarketing', label: 'Visibility', icon: Megaphone,
      roles: ['admin', 'partner', 'founder', 'investor'] },
    { to: '/partner/operations/capabilities', label: 'Proof', icon: Award,
      roles: ['admin', 'partner'] },
    { to: '/partner/office-hours', label: 'Office hours', icon: Calendar,
      roles: ['admin', 'partner'] },
  ],
};

export default function PartnerWorkspaceTabs({ set, user, children }) {
  const tabs = (SETS[set] || []).filter((t) => t.roles.includes(user?.role));
  // One visible tab is a bar that says nothing. Render the page alone.
  return (
    <>
      {tabs.length > 1 && <WorkspaceTabs tabs={tabs.map(({ to, label, icon }) => ({ to, label, icon }))} />}
      {children}
    </>
  );
}

/** Exported for the test that checks every tab's guard matches its route. */
export const PARTNER_TAB_SETS = SETS;
