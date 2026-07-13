// Fund Ops workspace — consolidates Funds administration, LP Reporting and
// Capital Calls into one tabbed workspace backed by the canonical stores.
//   • Funds admin  — the fund-operations view (AdminFundsView). Fund creation,
//     capital calls and distributions are admin-only on the worker, so for
//     non-admins this tab shows a blurred LockedPreview pointing them at
//     My LP Portal for their own positions.
//   • LP Reporting — quarterly fund statements with live-computed TVPI/DPI.
//   • Capital Calls — read-only list from the canonical capital_calls store.
//     Admins get the studio-wide ledger (api.capitalCalls); investors are
//     scoped to their own commitments via the LP-portal source (never the
//     global /legalcap list, which is not filtered per-LP).
import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Banknote, Calculator, FileBarChart, Landmark, PhoneCall, RefreshCw, TrendingUp } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { api } from '../lib/api';
import WorkspaceTabs, { WorkspaceHeader } from '../components/WorkspaceTabs';
import LockedPreview from '../components/LockedPreview';
import { AdminFundsView } from './FundsPage';
import LPReportingPage from './LPReportingPage';
import FundPerformancePage from './FundPerformancePage';
import FundAccountingPage from './FundAccountingPage';

const fmtMoney = (v) => (v == null || v === '' ? '—' : `$${Number(v).toLocaleString()}`);
const fmtDate = (v) => (v ? String(v).slice(0, 10) : '—');

const CALL_STATUS = {
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  overdue: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
};

// Normalize a capital-call row to dollars regardless of backend shape: the
// legalcap/worker store exposes `amount_cents`, while the fund LP-portal store
// (and the dev backend) exposes `amount` in dollars.
const callDollars = (cc) => {
  if (cc?.amount_cents != null) return Number(cc.amount_cents) / 100;
  if (cc?.amount != null && cc.amount !== '') return Number(cc.amount);
  return null;
};

function CapitalCallsPanel({ isAdmin }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setBusy(true);
    // Admins get the studio-wide capital-call ledger; investors are scoped to
    // their own commitments via the same LP-portal source My LP Portal uses —
    // never the global /legalcap list, which is not filtered per-LP.
    const source = isAdmin
      ? api.capitalCalls().then((r) => (Array.isArray(r) ? r : []))
      : api.fundsLpPortal().then((d) => (Array.isArray(d) ? d : d?.capital_calls || []));
    source
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch(() => setRows([]))
      .finally(() => setBusy(false));
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Capital calls ({rows?.length ?? 0})
        </div>
        <button
          onClick={load}
          disabled={busy}
          className="px-3 py-1.5 text-sm bg-white border border-gray-300 hover:bg-gray-50 text-gray-900 rounded-lg flex items-center gap-1.5 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
        >
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {rows == null ? (
        <div className="text-gray-500 dark:text-gray-400 text-center py-16 text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-gray-500 dark:text-gray-400 text-center py-16 text-sm">
          No capital calls on record. Calls issued against your LP commitments appear here.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/60 text-gray-500 dark:text-gray-400">
              <tr>
                <th className="text-left font-medium px-4 py-2.5">Amount</th>
                <th className="text-left font-medium px-4 py-2.5">Status</th>
                <th className="text-left font-medium px-4 py-2.5">Due</th>
                <th className="text-left font-medium px-4 py-2.5">Issued</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((cc) => (
                <tr key={cc.id} className="bg-white dark:bg-gray-900">
                  <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">{fmtMoney(callDollars(cc))}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${CALL_STATUS[cc.status] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
                      {cc.status || 'pending'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{fmtDate(cc.due_date)}</td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{fmtDate(cc.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

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
  const active = pathname.includes('/performance')
    ? 'performance'
    : pathname.includes('/accounting')
    ? 'accounting'
    : pathname.includes('/lp-reports')
    ? 'reports'
    : pathname.includes('/capital-calls')
    ? 'calls'
    : 'funds';

  const tabs = [
    { to: '/funds', label: 'Funds admin', icon: Banknote },
    { to: '/funds/performance', label: 'Performance', icon: TrendingUp },
    { to: '/funds/accounting', label: 'Accounting', icon: Calculator },
    { to: '/lp-reports', label: 'LP Reporting', icon: FileBarChart },
    { to: '/funds/capital-calls', label: 'Capital Calls', icon: PhoneCall },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <WorkspaceHeader
        icon={Landmark}
        title="Fund Ops"
        description="Fund administration, LP reporting, and capital calls — one canonical LP and capital-call store behind them all."
      />
      <WorkspaceTabs tabs={tabs} />

      {active === 'funds' &&
        (isAdmin ? (
          <AdminFundsView />
        ) : (
          <LockedPreview
            icon={Banknote}
            title="Fund administration"
            message="Creating funds, issuing capital calls and running distributions are handled by your studio admin. Track your own commitments and calls in My LP Portal."
          >
            <FundsAdminTeaser />
          </LockedPreview>
        ))}
      {active === 'performance' && <FundPerformancePage embedded />}
      {active === 'accounting' && <FundAccountingPage embedded />}
      {active === 'reports' && <LPReportingPage embedded />}
      {active === 'calls' && <CapitalCallsPanel isAdmin={isAdmin} />}
    </div>
  );
}
