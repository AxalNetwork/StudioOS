// My LP Portal workspace — surfaces the canonical LP self-view (commitments,
// capital calls, distributions and live-computed performance) as its own
// investor workspace. The view (LPPortalView) reads only from the canonical
// stores via GET /api/funds/lp-portal; this page just gives it a workspace
// header so it reads as a first-class destination rather than a tab inside Funds.
import React from 'react';
import { Wallet } from 'lucide-react';
import { WorkspaceHeader } from '../components/WorkspaceTabs';
import { LPPortalView } from './FundsPage';

export default function LPPortalPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <WorkspaceHeader
        icon={Wallet}
        title="My LP Portal"
        description="Your commitments, capital calls, distributions and performance — read straight from the canonical LP store."
      />
      <LPPortalView />
    </div>
  );
}
