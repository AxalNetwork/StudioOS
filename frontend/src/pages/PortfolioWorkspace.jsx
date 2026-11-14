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
  const { pathname } = useLocation();
  const { role } = useAuth();
  const view = useViewMode();
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
    { to: '/portfolio/health', label: 'Health', icon: Heart, roles: ['admin', 'founder', 'partner', 'investor'] },
    // The tab's roles are the route's guard (App.jsx): a role listed here but
    // refused there clicks into a redirect. The founder composes in Grow ·
    // Share an update (D654; D463's card left with /build/metrics, #2336), so
    // the tab no longer offers the founder a route their shell has no zone for.
    // D1056 (#2427): Updates is Reports, at the same address.
    { to: '/portfolio/updates', label: 'Reports', icon: Inbox, roles: ['admin', 'investor'] },
    { to: '/portfolio/positions', label: 'Cap Table', icon: PieChart, roles: ['admin', 'investor'] },
    { to: '/portfolio/performance', label: 'Performance', icon: TrendingUp, roles: ['admin', 'investor'] },
    { to: '/portfolio/value-add', label: 'Value-add', icon: Rocket, roles: ['admin', 'investor'] },
  ].filter((t) => !role || t.roles.includes(role));

  // D4817 part 8 (#5311, PF-08): an administrator previewing the Investor
  // shell sees each board with its investor records withheld, reading none.
  const previewBoard = (activeRole || role) === 'investor' && isInvestorPreview(view) ? previewBoardOf(pathname) : null;
  if (previewBoard) return <PortfolioPreview board={previewBoard} />;
  if ((activeRole || role) === 'investor' && active === 'health') {
    return <InvestorPortfolioCanvas />;
  }
  if ((activeRole || role) === 'investor' && active === 'positions') {
    return <InvestorPortfolioPositions />;
  }
  if ((activeRole || role) === 'investor' && active === 'updates') {
    return <InvestorPortfolioUpdates />;
  }
  if ((activeRole || role) === 'investor' && active === 'growth') {
    return <InvestorPortfolioValueAdd />;
  }
  // D4817 part 3 (#5311, PF-03): the investor's Performance draws in the
  // Portfolio frame with its own rail, as every other investor board does.
  if ((activeRole || role) === 'investor' && active === 'performance') {
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
  const viewer = activeRole || role;
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
