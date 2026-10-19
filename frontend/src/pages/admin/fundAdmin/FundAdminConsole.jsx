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
import { HQ_ONLY, LAYOUT_NOTE, TABS, administeredFunds, pickFund, tabFrom } from './fundAdminModel';
import { useRead } from './useRead';
import { OverviewTab } from './OverviewTab';
import { BankingTab, ReconciliationTab } from './BankingTabs';
import { CallsTab, DistributionsTab, FeesTab, ReportsTab } from './FundTabs';

/**
 * D714 (#1779) PR 4a — the fund administration console at `/admin/fund-admin`,
 * for the Super Admin and every Admin on HQ (decision 7).
 *
 * NO CANVAS COVERS IT YET. It is drawn only from parts already on `main`: the
 * Connectors sheet's `Group`, `Row` and `Banner`, the Account center's buttons
 * and fields, `Unreadable` and `Unrecorded`, and #1834's
 * `MercuryEntityConnections`. The canvas PR lays it out.
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
      <main className="mx-auto max-w-5xl py-6" data-testid="fund-admin-console">
        <h1 className="px-5 text-xl font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">Fund administration</h1>
        <Banner tone="neutral" data-testid="fund-admin-branch">{HQ_ONLY}</Banner>
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

  return (
    <main className="mx-auto max-w-5xl py-6" data-testid="fund-admin-console">
      <header className="px-5">
        <h1 className="text-xl font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">Fund administration</h1>
        <p className="mt-0.5 text-[12.5px] text-axal-muted dark:text-gray-400">
          Capital calls, distributions, management fees, reconciliation, bank accounts and LP reports for Axal’s entities and administered funds.
        </p>
        <p className="mt-1 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="fund-admin-layout-note">{LAYOUT_NOTE}</p>
      </header>
      {access.status === 'unreadable' && (
        <Banner tone="warn" data-testid="fund-admin-access-unreadable">
          Which acts you may take could not be read, so every control is shown. The Worker still refuses an act you may not take.
        </Banner>
      )}
      <nav className="mx-5 mt-4 flex flex-wrap gap-1 border-b border-axal-hairline dark:border-gray-800" aria-label="Fund administration">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => go({ tab: t.key })} aria-current={t.key === tab ? 'page' : undefined}
            data-testid={`fund-admin-tab-${t.key}`}
            className={`-mb-px border-b-2 px-3 py-2 text-[12.5px] font-semibold ${t.key === tab
              ? 'border-axal-violet text-axal-ink dark:text-gray-100'
              : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}>
            {t.label}
          </button>
        ))}
      </nav>
      <section data-testid={`fund-admin-panel-${tab}`}>
        {tab === 'overview' && <OverviewTab overview={overview} />}
        {tab === 'banking' && <BankingTab apis={apis} access={acts} />}
        {tab === 'reconciliation' && <ReconciliationTab apis={apis} access={acts} />}
        {tab === 'calls' && <CallsTab {...fundProps} />}
        {tab === 'distributions' && <DistributionsTab {...fundProps} />}
        {tab === 'fees' && <FeesTab {...fundProps} />}
        {tab === 'reports' && <ReportsTab {...fundProps} />}
      </section>
    </main>
  );
}

export default function FundAdminConsole() {
  const { user } = useAuth() || {};
  return <FundAdminConsoleView user={user} />;
}
