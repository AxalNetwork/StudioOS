// Shared Portfolio routes select the board from the URL. The Investor shell
// renders its own frame; Admin, Founder and Partner use the embedded tabs.
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Briefcase, Heart, Inbox, PieChart, TrendingUp, Rocket } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import WorkspaceTabs, { WorkspaceHeader } from '../components/WorkspaceTabs';
import PortfolioHealthPage from './PortfolioHealthPage';
import PortfolioUpdatesPage from './PortfolioUpdatesPage';
import PortfolioPositionsPage from './PortfolioPositionsPage';
import PortfolioPerformancePage from './PortfolioPerformancePage';
import PortfolioGrowthPage from './PortfolioGrowthPage';
import InvestorPortfolioCanvas from './investor/InvestorPortfolioCanvas';
import InvestorPortfolioPositions from './investor/InvestorPortfolioPositions';
import InvestorPortfolioUpdates from './investor/InvestorPortfolioUpdates';
import InvestorPortfolioValueAdd from './investor/InvestorPortfolioValueAdd';
import InvestorPortfolioPerformance from './investor/InvestorPortfolioPerformance';
import PortfolioPreview from './portfolio/PortfolioPreview';
import { isInvestorPreview, previewBoardOf } from './portfolio/previewModel';
import { useViewMode } from '../contexts/ViewModeContext';
import RailFrame from '../ui/RailFrame';
import WorkerRail from '../ui/WorkerRail';

export default function PortfolioWorkspace({ activeRole }) {
  const { pathname, search, hash } = useLocation();
  const { role } = useAuth();
  const view = useViewMode();
  const viewer = activeRole || role;
  // The Admin preview keeps the withheld board at its existing addresses.
  const previewBoard = viewer === 'investor' && isInvestorPreview(view) ? previewBoardOf(pathname) : null;
  if (previewBoard) return <PortfolioPreview board={previewBoard} />;
  if (viewer === 'investor' && pathname.replace(/\/+$/, '').toLowerCase() === '/portfolio/health') {
    return <Navigate replace to={{ pathname: '/portfolio', search, hash }} />;
  }
  const active = pathname.includes('/updates')
    ? 'updates'
    : pathname.includes('/positions')
      ? 'positions'
      : pathname.includes('/performance')
        ? 'performance'
        : pathname.includes('/value-add')
          ? 'growth'
          : 'health';

  const tabs = [
    { to: '/portfolio/health', label: viewer === 'admin' ? 'Overview' : 'Health', icon: Heart, roles: ['admin', 'founder', 'partner', 'investor'] },
    // The tab's roles are the route's guard (App.jsx): a role listed here but
    // refused there clicks into a redirect. The founder composes in Grow ·
    // Share an update (D654; D463's card left with /build/metrics, #2336), so
    // the tab no longer offers the founder a route their shell has no zone for.
    // D1056 (#2427): Updates is Reports, at the same address.
    { to: '/portfolio/updates', label: 'Reports', icon: Inbox, roles: ['admin', 'investor'] },
    { to: '/portfolio/positions', label: viewer === 'admin' ? 'Positions' : 'Cap Table', icon: PieChart, roles: ['admin', 'investor'] },
    { to: '/portfolio/performance', label: 'Performance', icon: TrendingUp, roles: ['admin', 'investor'] },
    { to: '/portfolio/value-add', label: 'Value-add', icon: Rocket, roles: ['admin', 'investor'] },
  ].filter((t) => !role || t.roles.includes(role));

  if (viewer === 'investor' && active === 'health') {
    return <InvestorPortfolioCanvas />;
  }
  if (viewer === 'investor' && active === 'positions') {
    return <InvestorPortfolioPositions />;
  }
  if (viewer === 'investor' && active === 'updates') {
    return <InvestorPortfolioUpdates />;
  }
  if (viewer === 'investor' && active === 'growth') {
    return <InvestorPortfolioValueAdd />;
  }
  // D4817 part 3 (#5311, PF-03): the investor's Performance draws in the
  // Portfolio frame with its own rail, as every other investor board does.
  if (viewer === 'investor' && active === 'performance') {
    return <InvestorPortfolioPerformance />;
  }

  const body = (
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
  // D772 (#2098) drew the investor's Performance here in a rail frame; since
  // D4817 part 3 every investor board returns above, so only the partner's
  // rail remains.
  // D773 (#2099): an operating partner reaches /portfolio from Delivery's "Also
  // in" list (PAGE_HOMES), and the page map gives it Delivery's key, so it
  // draws the partner's rail the same way. Any other viewer's page is unchanged.
  if (viewer === 'partner') {
    return (
      <RailFrame data-testid="portfolio-partner-frame" rail={(
        <WorkerRail workspace="Delivery" role="partner"
          note="Eadwyn reads the portfolio companies on this page. Nothing is sent to a founder until you send it." />
      )}>{body}</RailFrame>
    );
  }
  return body;
}
