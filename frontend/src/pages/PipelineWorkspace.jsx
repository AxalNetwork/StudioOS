// Pipeline workspace — consolidates the deal-flow lifecycle (Board, Screening,
// Commit, Transactions) into one tabbed workspace. Each tab deep-links to its
// own route; every one of those routes renders this workspace, which derives
// the active tab from the URL and renders the matching page in `embedded` mode
// so a single workspace title + tab bar governs. Screening/Commit/Transactions
// are role-filtered to the roles whose route guard allows them (admin, investor).
// The last two tabs (Deal Flow, Data Room) are cross-route links, not tabs this
// workspace renders — see the comment on them below.
import React from 'react';
import { useLocation } from 'react-router-dom';
import { Layers, ClipboardCheck, Gavel, Receipt, Handshake, Shield } from 'lucide-react';
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
    // Two cross-route tabs. Neither /deals nor /raise/data-room renders this
    // workspace, so arriving there drops the tab bar — they are doors, not
    // sub-tabs. They are here because the investor shell collapsed both former
    // sidebar rows into the one "Deals" row that lands on /pipeline, and this
    // tab bar is the only inbound link an investor has left to them. Roles
    // mirror each route's own guard in App.jsx: /deals is admin+partner+
    // investor, /raise/data-room is admin+founder+investor — minus founder,
    // who keeps a Data Room row of their own in the founder nav.
    { to: '/deals', label: 'Deal Flow', icon: Handshake, roles: ['admin', 'partner', 'investor'] },
    { to: '/raise/data-room', label: 'Data Room', icon: Shield, roles: ['admin', 'investor'] },
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
