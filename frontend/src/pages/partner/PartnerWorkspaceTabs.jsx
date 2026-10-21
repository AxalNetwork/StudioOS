import React from 'react';
import { Target, TrendingUp, Layers, Package, Gift, Megaphone, Award } from 'lucide-react';
import WorkspaceTabs from '../../components/WorkspaceTabs';
import { RailFrame, WorkerRail } from '../../ui';
import PartnerWorkspaceShell from './PartnerWorkspaceShell';

/**
 * The tab bars that let the Partner shell's Pipeline and Offers rows actually
 * own their sections.
 *
 * WHY A WRAPPER AND NOT AN EDIT. `PartnerOperationsWorkspace` puts its tab bar
 * inside one page that renders all five of its children with an `embedded`
 * prop. The pages these rows point at — NeedsBoardPage, ServiceCatalogPage,
 * and the rest — are 500–1000 line files that take no such prop and
 * share no shell. Wrapping them at the route is additive: no page changes, no
 * new props, and reverting is deleting one element from App.jsx.
 *
 * THE ROLE FILTER IS THE POINT, and it is why this could not be a static array.
 * The tab targets do not share a guard:
 *
 *   /needs, /services                 admin founder partner investor
 *   /partner/insights                 admin partner investor
 *   /perks                            admin founder partner investor advisor exploring
 *   /comarketing                      admin partner founder investor
 *   /partner/office-hours             admin partner
 *   /pipeline/*, /offers/* zones      admin partner
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
 *
 * D773 (#2099) — THE RAIL. For a partner, the pages this wraps (Leads, Demand,
 * Catalog, Office hours, Visibility) draw the operating partner's rail, one per
 * page, in the shared frame. Its page key and crumbs come from the shell's
 * `RailPageProvider` (D768's page map), so the rail needs only its section's
 * name. The shell's static "AI assist" card, which stood where the rail now
 * docks, is turned off here (`rail={false}`), so there is one right column.
 */

/** The rail's section name per tab set, as the canvas names the partner's rows. */
const RAIL = {
  pipeline: { workspace: 'Pipeline', note: 'Eadwyn reads the leads and demand on this page. Nothing is sent until you send it.' },
  offers: { workspace: 'Offers', note: 'Eadwyn reads the offers on this page. Nothing is published until you publish it.' },
};

const SETS = {
  pipeline: [
    { to: '/needs', label: 'Leads', icon: Target, match: ['/needs', '/partner/needs'],
      roles: ['admin', 'founder', 'partner', 'investor'] },
    { to: '/partner/insights', label: 'Demand', icon: TrendingUp,
      roles: ['admin', 'partner', 'investor'] },
    { to: '/pipeline/retainers', label: 'Retainers', icon: Layers,
      roles: ['admin', 'partner'] },
  ],
  offers: [
    { to: '/services', label: 'Catalog', icon: Package,
      roles: ['admin', 'founder', 'partner', 'investor'] },
    { to: '/perks', label: 'Perk deals', icon: Gift,
      roles: ['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'] },
    { to: '/comarketing', label: 'Visibility', icon: Megaphone,
      roles: ['admin', 'partner', 'founder', 'investor'] },
    { to: '/offers/proof', label: 'Proof', icon: Award,
      roles: ['admin', 'partner'] },
  ],
};

export default function PartnerWorkspaceTabs({ set, user, children }) {
  const tabs = (SETS[set] || []).filter((t) => t.roles.includes(user?.role));
  const visibleTabs = tabs.map(({ to, label, icon, match }) => ({ to, label, icon, ...(match ? { match } : {}) }));
  if (user?.role !== 'partner') {
    return (
      <>
        {visibleTabs.length > 1 && <WorkspaceTabs tabs={visibleTabs} />}
        {children}
      </>
    );
  }
  const meta = set === 'offers'
    ? { workspace: 'offers', icon: Package }
    : { workspace: 'pipeline', icon: Target };
  const railMeta = RAIL[set] || RAIL.pipeline;
  const rail = <WorkerRail workspace={railMeta.workspace} role="partner" note={railMeta.note} />;
  return (
    <RailFrame rail={rail}>
      <PartnerWorkspaceShell
        {...meta}
        tabs={visibleTabs}
        rail={false}
      >
        {children}
      </PartnerWorkspaceShell>
    </RailFrame>
  );
}

/** Exported for the test that checks every tab's guard matches its route. */
export const PARTNER_TAB_SETS = SETS;
