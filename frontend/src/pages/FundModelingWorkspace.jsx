// Fund Modeling workspace — merges the former standalone Reserve Allocation
// (/portfolio/reserves) and Exit Waterfall (/portfolio/waterfall) pages into a
// single tabbed workspace over the *same* shared simulator + scenarios engine.
// Both sidebar rows stay and deep-link to their tab; each page renders in
// `embedded` mode so this workspace's title + tab bar govern.
import React from 'react';
import { useLocation } from 'react-router-dom';
import { Calculator, Layers, Waves } from 'lucide-react';
import WorkspaceTabs, { WorkspaceHeader } from '../components/WorkspaceTabs';
import ReservesPage from './ReservesPage';
import WaterfallPage from './WaterfallPage';

export default function FundModelingWorkspace() {
  const { pathname } = useLocation();
  const active = pathname.includes('/waterfall') ? 'waterfall' : 'reserves';

  const tabs = [
    { to: '/portfolio/reserves', label: 'Reserve Allocation', icon: Layers },
    { to: '/portfolio/waterfall', label: 'Exit Waterfall', icon: Waves },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <WorkspaceHeader
        icon={Calculator}
        title="Fund Modeling"
        description="Plan follow-on reserves and model exit waterfalls over the same fund scenarios."
      />
      <WorkspaceTabs tabs={tabs} />
      {active === 'reserves' && <ReservesPage embedded />}
      {active === 'waterfall' && <WaterfallPage embedded />}
    </div>
  );
}
