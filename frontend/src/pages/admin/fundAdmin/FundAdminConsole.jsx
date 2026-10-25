import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuthSync';
import { branchOfUser } from '../../../lib/shellRole';
import { api } from '../../../lib/api';
import { fundAdminApi } from '../../../lib/api/fundAdmin';
import { adminMercuryApi } from '../../../lib/api/adminMercury';
import { fundFeesApi } from '../../../lib/api/fundFees';
import { fundReportingApi } from '../../../lib/api/fundReporting';
import { adminCapitalAttestationsApi } from '../../../lib/api/adminCapitalAttestations';
import { fundPerformanceApi } from '../../../lib/api/fundPerformance';
import { FundPerformanceView } from '../../FundPerformancePage';
import { Banner } from '../../account/ConnectorSheet';
import { Landmark, LayoutDashboard, HandCoins, ArrowRightLeft, Percent, FileText, Briefcase, Users, TrendingUp } from 'lucide-react';
import { BANKING_PARTS, HQ_ONLY, LEGACY_TABS, NOT_YET, TABS, WAITS, administeredFunds, keepFund, legacyHref, pickFund, tabFlags, tabOfView, viewFrom, viewHref } from './fundAdminModel';
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
  // D1157 (#2388): NAV & performance draws today's performance read until FND10 lands.
  performance: fundPerformanceApi,
  funds: {
    distributions: (fundId) => api.fundsDistributions(fundId),
    execute: (body) => api.fundsExecuteDistribution(body),
    markPaid: (id) => api.fundsMarkDistributionPaid(id),
  },
};

export function FundAdminConsoleView({ user, apis = DEFAULT_APIS }) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const branch = branchOfUser(user);
  // D1157 (#2388): each tab is its own address; D714's `?tab=` links forward there.
  const forward = legacyHref(location.search);
  const view = viewFrom(location.pathname);
  const tab = tabOfView(view);
  const access = useRead(() => apis.fundAdmin.access(), [apis], { enabled: !branch });
  const overview = useRead(() => apis.fundAdmin.overview(), [apis], { enabled: !branch });
  const performance = useRead(() => apis.performance.list(), [apis], { enabled: !branch && !forward && view === 'performance' });

  if (forward) return <Navigate to={forward} replace />;

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
    for (const [k, v] of Object.entries(next)) if (k !== 'tab') p.set(k, String(v));
    if (next.tab != null) navigate(viewHref(LEGACY_TABS[next.tab] ?? '', `?${p}`));
    else setParams(p, { replace: true });
  };
  const fundProps = { apis, access: acts, funds, fund, overview, onFund: (id) => go({ fund: id }) };
  const flags = tabFlags(overview.status === 'ready' ? overview.data : null);
  const keep = keepFund(location.search);
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
            const flag = t.key === 'banking' ? flags.reconciliation : flags[t.key];
            const props = { 'aria-current': on ? 'page' : undefined, 'data-testid': `fund-admin-tab-${t.key}`,
              className: `flex shrink-0 items-center gap-[7px] border-b-2 pb-[11px] text-[13px] ${on
                ? 'border-axal-violet font-bold text-axal-violet-deep dark:text-violet-300'
                : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}` };
            const inner = (<>
              <Icon aria-hidden="true" className="h-3.5 w-3.5" />
              <span>{t.label}</span>
              {flag > 0 && (
                <span data-testid={`fund-admin-flag-${t.key}`} className={`inline-flex h-4 min-w-4 items-center justify-center rounded-axal-pill px-1 text-[9px] font-extrabold ${on
                  ? 'bg-axal-violet text-white' : 'bg-amber-700/15 text-amber-700 dark:text-amber-300'}`}>{flag}</span>
              )}
            </>);
            // Literal heads, so the admin route guard reads each tab's door (D1157).
            return t.path
              ? <Link key={t.key} to={`/admin/fund-admin/${t.path}${keep}`} {...props}>{inner}</Link>
              : <Link key={t.key} to={`/admin/fund-admin${keep}`} {...props}>{inner}</Link>;
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
      {tab === 'banking' && (
        <nav className="mx-4 mt-4 flex flex-wrap gap-2 sm:mx-6" aria-label="Banking" data-testid="fund-admin-banking-parts">
          {BANKING_PARTS.map((b) => {
            const props = { 'aria-current': b.key === view ? 'page' : undefined, 'data-testid': `fund-admin-part-${b.key}`,
              className: `rounded-axal-pill border px-3 py-1 text-[12px] font-bold ${b.key === view
                ? 'border-axal-violet bg-axal-violet/10 text-axal-violet-deep dark:text-violet-300'
                : 'border-axal-hairline text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-100'}` };
            return b.key === 'banking'
              ? <Link key={b.key} to={`/admin/fund-admin/banking${keep}`} {...props}>{b.label}</Link>
              : <Link key={b.key} to={`/admin/fund-admin/banking/${b.key}${keep}`} {...props}>{b.label}</Link>;
          })}
        </nav>
      )}
      <div data-testid={`fund-admin-panel-${view}`}>
        {view === 'overview' && <OverviewTab overview={overview} onOpen={(next) => go(next)} />}
        {view === 'banking' && <BankingTab apis={apis} access={acts} />}
        {view === 'reconciliation' && <ReconciliationTab apis={apis} access={acts} />}
        {view === 'calls' && <CallsTab {...fundProps} />}
        {view === 'distributions' && <DistributionsTab {...fundProps} />}
        {view === 'fees' && <FeesTab {...fundProps} />}
        {view === 'reports' && <ReportsTab {...fundProps} />}
        {view === 'performance' && (
          <div className="mx-4 mt-5 sm:mx-6">
            <FundPerformanceView items={performance.data?.items || []} loading={performance.status === 'loading'}
              error={performance.status === 'unreadable' ? (performance.error?.message || 'Fund performance could not be read.') : null} reload={performance.reload} />
          </div>
        )}
        {(view === 'funds' || view === 'lps' || view === 'books') && <WaitCard view={view} />}
      </div>
    </main>
  );
}

const ICONS = { overview: LayoutDashboard, funds: Briefcase, lps: Users, calls: HandCoins, distributions: ArrowRightLeft, performance: TrendingUp, fees: Percent, reports: FileText, banking: Landmark };

/** D1157: a tab with no read yet says so where its blocks would be. Never a zero, never "none". */
function WaitCard({ view }) {
  return (
    <section className="mx-4 mt-5 flex flex-col gap-2 rounded-axal-md border border-axal-hairline bg-white px-[18px] py-4 sm:mx-6 dark:border-gray-800 dark:bg-gray-900" data-testid={`fund-admin-wait-${view}`}>
      <span className="w-fit rounded-axal-pill border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className="m-0 text-[13px] text-axal-muted dark:text-gray-400">{WAITS[view]}</p>
    </section>
  );
}
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
