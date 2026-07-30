// Portfolio workspace — consolidates Portfolio Health, Company Updates and
// Cap Table (positions) into one tabbed workspace. Each former sidebar row
// still deep-links to its own route (/portfolio/health|updates|positions);
// every one of those routes renders this workspace, which derives the active
// tab from the URL and renders the matching page in `embedded` mode so a single
// workspace title + tab bar governs. The Cap Table tab is role-filtered to the
// roles whose route guard allows /portfolio/positions (admin, investor).
import React from 'react';
import { useLocation } from 'react-router-dom';
import { Briefcase, Heart, Inbox, PieChart, TrendingUp, Rocket } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import WorkspaceTabs, { WorkspaceHeader } from '../components/WorkspaceTabs';
import PortfolioHealthPage from './PortfolioHealthPage';
import PortfolioUpdatesPage from './PortfolioUpdatesPage';
import PortfolioPositionsPage from './PortfolioPositionsPage';
import PortfolioPerformancePage from './PortfolioPerformancePage';
import PortfolioGrowthPage from './PortfolioGrowthPage';

export default function PortfolioWorkspace() {
  const { pathname } = useLocation();
  const { role } = useAuth();
  const active = pathname.includes('/updates')
    ? 'updates'
    : pathname.includes('/positions')
      ? 'positions'
      : pathname.includes('/performance')
        ? 'performance'
        : pathname.includes('/growth')
          ? 'growth'
          : 'health';

  const tabs = [
    { to: '/portfolio/health', label: 'Health', icon: Heart, roles: ['admin', 'founder', 'partner', 'investor'] },
    { to: '/portfolio/updates', label: 'Updates', icon: Inbox, roles: ['admin', 'founder', 'partner', 'investor'] },
    { to: '/portfolio/positions', label: 'Cap Table', icon: PieChart, roles: ['admin', 'investor'] },
    { to: '/portfolio/performance', label: 'Performance', icon: TrendingUp, roles: ['admin', 'investor'] },
    { to: '/portfolio/growth', label: 'Growth', icon: Rocket, roles: ['admin', 'investor'] },
  ].filter((t) => !role || t.roles.includes(role));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <WorkspaceHeader
        icon={Briefcase}
        title="Portfolio"
        description="Company health, founder-submitted updates, and your cap-table positions in one place."
      />
      <WorkspaceTabs tabs={tabs} />
      {active === 'health' && <PortfolioHealthPage embedded />}
      {active === 'updates' && <PortfolioUpdatesPage embedded />}
      {active === 'positions' && <PortfolioPositionsPage embedded />}
      {active === 'performance' && <PortfolioPerformancePage embedded />}
      {active === 'growth' && <PortfolioGrowthPage embedded />}
    </div>
  );
}
