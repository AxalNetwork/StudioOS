// Fund Ops workspace — Funds administration and fund performance in one
// tabbed workspace backed by the canonical stores.
//   • Funds admin  — the fund-operations view (AdminFundsView). Fund creation,
//     capital calls and distributions are admin-only on the worker, so for
//     non-admins this tab shows a blurred LockedPreview pointing them at
//     their own position in the LP workspace.
//   • LP Reporting and Accounting — REMOVED on the owner's instruction
//     (2026-10-20): `/lp-reports` and `/funds/accounting` no longer exist. An
//     investor's fund reports stay in the fund shell's Reporting zone
//     (`/funds/reporting`) and its ledger in the Ledger zone (`/funds/ledger`).
//   • Capital Calls — RETIRED (D371). `/funds/capital-calls` redirects to the
//     Calls zone at `/funds/calls`, the fund's call ledger with writes. An
//     investor's own calls are in the LP workspace's My-commitment section.
//   • LP Workspace — RETIRED (D372). `/funds/lp-workspace` redirects to
//     `/spinout-lab/investor-workspace`, the same component standalone.
import React from 'react';
import { useLocation } from 'react-router-dom';
import { Banknote, Landmark, TrendingUp } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import WorkspaceTabs, { WorkspaceHeader } from '../components/WorkspaceTabs';
import LockedPreview from '../components/LockedPreview';
import { AdminFundsView } from './FundsPage';
import FundPerformancePage from './FundPerformancePage';

// Inert teaser rendered under the blur for the non-admin "Funds admin" tab.
function FundsAdminTeaser() {
  return (
    <div className="space-y-5">
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">All funds (3)</div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {['Seed Fund I', 'Opportunity Fund', 'Growth Fund II'].map((name, i) => (
          <div key={name} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 text-left">
            <div className="font-semibold text-gray-900 dark:text-gray-100">{name}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Vintage 202{i + 3} · Active</div>
            <div className="mt-3 text-2xl font-bold text-gray-900 dark:text-gray-100">${(i + 2) * 25}M</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Committed · {(i + 1) * 8} LPs</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FundOpsWorkspace() {
  const { pathname } = useLocation();
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const active = pathname.includes('/performance') ? 'performance' : 'funds';

  const tabs = [
    { to: '/funds', label: 'Funds admin', icon: Banknote },
    { to: '/funds/performance', label: 'Performance', icon: TrendingUp },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <WorkspaceHeader
        icon={Landmark}
        title="Fund Ops"
        description="Fund administration and fund performance — one canonical LP and capital-call store behind them."
      />
      <WorkspaceTabs tabs={tabs} />

      {active === 'funds' &&
        (isAdmin ? (
          <AdminFundsView />
        ) : (
          <LockedPreview
            icon={Banknote}
            title="Fund administration"
            message="Creating funds, issuing capital calls and running distributions are handled by your studio admin. Track your own commitments and calls under My commitment, on the LP workspace."
          >
            <FundsAdminTeaser />
          </LockedPreview>
        ))}
      {active === 'performance' && <FundPerformancePage embedded />}
    </div>
  );
}
