// Partner Operations workspace — tabbed shell for the partner's operations
// surface. Each tab deep-links to its own route
// (/partner/operations/{overview,capabilities,portfolio,engagements,performance});
// every one of those routes renders this workspace, which derives the active tab
// from the URL and renders the matching feature page in `embedded` mode so a
// single header + tab bar governs. Feature pages are stubs the Partner
// Operations feature-pages task replaces with real content.
import React from 'react';
import { useLocation } from 'react-router-dom';
import { Briefcase, LayoutDashboard, Package, Layers, Handshake, TrendingUp } from 'lucide-react';
import WorkspaceTabs, { WorkspaceHeader } from '../../../components/WorkspaceTabs';
import OverviewPage from './OverviewPage';
import CapabilitiesPage from './CapabilitiesPage';
import PortfolioPage from './PortfolioPage';
import EngagementsPage from './EngagementsPage';
import PerformancePage from './PerformancePage';

export default function PartnerOperationsWorkspace() {
  const { pathname } = useLocation();
  const active = pathname.includes('/capabilities')
    ? 'capabilities'
    : pathname.includes('/portfolio')
      ? 'portfolio'
      : pathname.includes('/engagements')
        ? 'engagements'
        : pathname.includes('/performance')
          ? 'performance'
          : 'overview';

  const tabs = [
    { to: '/partner/operations/overview', label: 'Overview', icon: LayoutDashboard },
    { to: '/partner/operations/capabilities', label: 'Capabilities', icon: Package },
    { to: '/partner/operations/portfolio', label: 'Portfolio', icon: Layers },
    { to: '/partner/operations/engagements', label: 'Engagements', icon: Handshake },
    { to: '/partner/operations/performance', label: 'Performance', icon: TrendingUp },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <WorkspaceHeader
        icon={Briefcase}
        title="Operations"
        description="Capabilities, portfolio, engagements, and performance for your partner practice in one place."
      />
      <WorkspaceTabs tabs={tabs} />
      {active === 'overview' && <OverviewPage embedded />}
      {active === 'capabilities' && <CapabilitiesPage embedded />}
      {active === 'portfolio' && <PortfolioPage embedded />}
      {active === 'engagements' && <EngagementsPage embedded />}
      {active === 'performance' && <PerformancePage embedded />}
    </div>
  );
}
