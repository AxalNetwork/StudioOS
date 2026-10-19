import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuthSync';
import { branchOfUser } from '../../../lib/shellRole';
import { api } from '../../../lib/api';
import { fundAdminApi } from '../../../lib/api/fundAdmin';
import { adminMercuryApi } from '../../../lib/api/adminMercury';
import { fundFeesApi } from '../../../lib/api/fundFees';
import { fundReportingApi } from '../../../lib/api/fundReporting';
import { adminCapitalAttestationsApi } from '../../../lib/api/adminCapitalAttestations';
import { Banner } from '../../account/ConnectorSheet';
import { Landmark, LayoutDashboard, Scale, HandCoins, ArrowRightLeft, Percent, FileText } from 'lucide-react';
import { HQ_ONLY, TABS, administeredFunds, pickFund, tabFlags, tabFrom } from './fundAdminModel';
import { useRead } from './useRead';
import { OverviewTab } from './OverviewTab';
import { BankingTab, ReconciliationTab } from './BankingTabs';
import { CallsTab, DistributionsTab, FeesTab, ReportsTab } from './FundTabs';

/**
 * D714 (#1779) PR 4a — the fund administration console at `/admin/fund-admin`,
 * for the Super Admin and every Admin on HQ (decision 7).
 *
 * THE CANVAS PR lays it out to S1's brief for "Fund Administration · Admin"
 * (2026-10-18), in the August canvas "Fund Administration"'s visual system:
 * its chrome (the violet mark, the title, the as-of chip and the icon tabs
 * with their amber count flags), and the parts in `parts.jsx`. Every read,
 * act and sentence is PR 4a's; only the layout changed.
 *
 * THE WORKER DECIDES. `GET /api/fund-admin/access` names each act this viewer
 * may take; an act it may not take is one sentence, never a disabled button
 * (decision 6). A failed read keeps the controls, and the Worker refuses there.
 *
 * ON A BRANCH it says so and makes no read: fund administration is HQ's.
 */
export const DEFAULT_APIS = {
  fundAdmin: fundAdminApi,
  mercury: adminMercuryApi,
  fees: fundFeesApi,
  reporting: fundReportingApi,
  // D752 (#1890): the Calls tab's proofs of funds, read only on Show.
  capitalAttestations: adminCapitalAttestationsApi,
  funds: {
    distributions: (fundId) => api.fundsDistributions(fundId),
    execute: (body) => api.fundsExecuteDistribution(body),
    markPaid: (id) => api.fundsMarkDistributionPaid(id),
  },
};

export function FundAdminConsoleView({ user, apis = DEFAULT_APIS }) {
  const [params, setParams] = useSearchParams();
  const branch = branchOfUser(user);
  const tab = tabFrom(params.get('tab'));
  const access = useRead(() => apis.fundAdmin.access(), [apis], { enabled: !branch });
  const overview = useRead(() => apis.fundAdmin.overview(), [apis], { enabled: !branch });

  if (branch) {
    return (
      <main className="mx-auto max-w-[1440px] pb-16" data-testid="fund-admin-console">
        <Chrome sub="Axal’s entities and administered funds" />
        <div className="mx-4 mt-5 sm:mx-6"><Banner tone="neutral" data-testid="fund-admin-branch">{HQ_ONLY}</Banner></div>
      </main>
    );
  }

  const acts = access.status === 'ready' ? access.data : null;
  const funds = administeredFunds(overview.data);
  const fund = pickFund(funds, params.get('fund'));
  const go = (next) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) p.set(k, String(v));
    setParams(p, { replace: true });
  };
  const fundProps = { apis, access: acts, funds, fund, overview, onFund: (id) => go({ fund: id }) };
  const flags = tabFlags(overview.status === 'ready' ? overview.data : null);
  const asOf = overview.status === 'ready' && overview.data?.as_of ? `As of ${overview.data.as_of}` : null;
  const role = acts ? (acts.super_admin === true ? 'Super Admin' : 'Admin') : null;

  return (
    <main className="mx-auto max-w-[1440px] pb-16" data-testid="fund-admin-console">
      <Chrome sub="Capital calls, distributions, management fees, reconciliation, bank accounts and LP reports for Axal’s entities and administered funds."
        chips={<>
          {role && <span className={CHIP} data-testid="fund-admin-role">{role}</span>}
          {asOf && <span className={CHIP} data-testid="fund-admin-as-of">{asOf}</span>}
        </>}>
        <nav className="-mb-px mt-3.5 flex gap-5 overflow-x-auto" aria-label="Fund administration">
          {TABS.map((t) => {
            const Icon = ICONS[t.key];
            const on = t.key === tab;
            return (
              <button key={t.key} type="button" onClick={() => go({ tab: t.key })} aria-current={on ? 'page' : undefined}
                data-testid={`fund-admin-tab-${t.key}`}
                className={`flex shrink-0 items-center gap-[7px] border-b-2 pb-[11px] text-[13px] ${on
                  ? 'border-axal-violet font-bold text-axal-violet-deep dark:text-violet-300'
                  : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}>
                <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                <span>{t.label}</span>
                {flags[t.key] > 0 && (
                  <span data-testid={`fund-admin-flag-${t.key}`} className={`inline-flex h-4 min-w-4 items-center justify-center rounded-axal-pill px-1 text-[9px] font-extrabold ${on
                    ? 'bg-axal-violet text-white' : 'bg-amber-700/15 text-amber-700 dark:text-amber-300'}`}>{flags[t.key]}</span>
                )}
              </button>
            );
          })}
        </nav>
      </Chrome>
      {access.status === 'unreadable' && (
        <div className="mx-4 mt-4 sm:mx-6">
          <Banner tone="warn" data-testid="fund-admin-access-unreadable">
            Which acts you may take could not be read, so every control is shown. The Worker still refuses an act you may not take.
          </Banner>
        </div>
      )}
      <div data-testid={`fund-admin-panel-${tab}`}>
        {tab === 'overview' && <OverviewTab overview={overview} onOpen={(next) => go(next)} />}
        {tab === 'banking' && <BankingTab apis={apis} access={acts} />}
        {tab === 'reconciliation' && <ReconciliationTab apis={apis} access={acts} />}
        {tab === 'calls' && <CallsTab {...fundProps} />}
        {tab === 'distributions' && <DistributionsTab {...fundProps} />}
        {tab === 'fees' && <FeesTab {...fundProps} />}
        {tab === 'reports' && <ReportsTab {...fundProps} />}
      </div>
    </main>
  );
}

const ICONS = { overview: LayoutDashboard, banking: Landmark, reconciliation: Scale, calls: HandCoins, distributions: ArrowRightLeft, fees: Percent, reports: FileText };
const CHIP = 'inline-flex items-center rounded-axal-sm border border-axal-hairline px-2.5 py-1.5 text-[11.5px] font-semibold text-axal-muted dark:border-gray-700 dark:text-gray-400';

/** The canvas's chrome: the violet mark, the title and its sub, the chips, then the tabs. */
function Chrome({ sub, chips = null, children = null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-axal-hairline bg-white px-4 pt-3.5 sm:px-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-center justify-between gap-3.5 pb-px">
        <div className="flex min-w-0 items-center gap-[11px]">
          <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-axal-sm bg-axal-violet text-white"><Landmark aria-hidden="true" className="h-[15px] w-[15px]" /></span>
          <div className="min-w-0">
            <h1 className="text-[15.5px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">Fund Administration</h1>
            <p className="mt-px text-[11.5px] text-axal-muted dark:text-gray-400">{sub}</p>
          </div>
        </div>
        {chips && <div className="flex flex-wrap items-center gap-2">{chips}</div>}
      </div>
      {children || <div className="h-3.5" />}
    </header>
  );
}

export default function FundAdminConsole() {
  const { user } = useAuth() || {};
  return <FundAdminConsoleView user={user} />;
}
