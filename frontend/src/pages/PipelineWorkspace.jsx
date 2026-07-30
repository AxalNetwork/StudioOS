// Pipeline workspace — consolidates the deal-flow lifecycle (Board, Screening,
// Commit, Transactions) into one tabbed workspace. Each tab deep-links to its
// own route; every one of those routes renders this workspace, which derives
// the active tab from the URL and renders the matching page in `embedded` mode
// so a single workspace title + tab bar governs. Screening/Commit/Transactions
// are role-filtered to the roles whose route guard allows them (admin, investor).
import React from 'react';
import { useLocation } from 'react-router-dom';
import { Layers, ClipboardCheck, Gavel, Receipt } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import WorkspaceTabs, { WorkspaceHeader } from '../components/WorkspaceTabs';
import PipelinePage from './PipelinePage';
import PipelineScreeningPage from './PipelineScreeningPage';
import PipelineCommitPage from './PipelineCommitPage';
import PipelineTransactionsPage from './PipelineTransactionsPage';

export default function PipelineWorkspace() {
  const { pathname } = useLocation();
  const { role } = useAuth();
  const active = pathname.includes('/screening')
    ? 'screening'
    : pathname.includes('/commit')
    ? 'commit'
    : pathname.includes('/transactions')
    ? 'transactions'
    : 'board';

  const tabs = [
    { to: '/pipeline', label: 'Board', icon: Layers, roles: ['admin', 'founder', 'partner', 'investor'] },
    { to: '/pipeline/screening', label: 'Screening', icon: ClipboardCheck, roles: ['admin', 'investor'] },
    { to: '/pipeline/commit', label: 'Commit', icon: Gavel, roles: ['admin', 'investor'] },
    { to: '/pipeline/transactions', label: 'Transactions', icon: Receipt, roles: ['admin', 'investor'] },
  ].filter((t) => !role || t.roles.includes(role));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <WorkspaceHeader
        icon={Layers}
        title="Pipeline"
        description="Deal flow from screening through investment committee to close."
      />
      <WorkspaceTabs tabs={tabs} />
      {active === 'board' && <PipelinePage embedded />}
      {active === 'screening' && <PipelineScreeningPage embedded />}
      {active === 'commit' && <PipelineCommitPage embedded />}
      {active === 'transactions' && <PipelineTransactionsPage embedded />}
    </div>
  );
}
