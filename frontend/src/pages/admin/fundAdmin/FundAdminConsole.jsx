import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AdminPageHeader, HeaderMenuItem, HeaderTab, actionPrimary, useMovedNotice } from '../../../ui';
import { useAuth } from '../../../hooks/useAuthSync';
import { branchOfUser } from '../../../lib/shellRole';
import { api } from '../../../lib/api';
import { fundAdminApi } from '../../../lib/api/fundAdmin';
import { adminMercuryApi } from '../../../lib/api/adminMercury';
import { fundFeesApi } from '../../../lib/api/fundFees';
import { fundReportingApi } from '../../../lib/api/fundReporting';
import { adminCapitalAttestationsApi } from '../../../lib/api/adminCapitalAttestations';
import { fundPerformanceApi } from '../../../lib/api/fundPerformance';
import { fundNoticesApi } from '../../../lib/api/fundNotices';
import { fundBookletsApi } from '../../../lib/api/fundBooklets';
import { Banner } from '../../account/ConnectorSheet';
import {
  BANKING_PARTS, LEGACY_TABS, LINE, MOVED_NOTICES, NOT_YET, TABS, TITLE, WAITS, administeredFunds, fundFilter, fundsCsv,
  headerPrimary, keepFund, legacyHref, moreItems, pickFund, profilePill, tabCounts, tabOfView, viewFrom, viewHref, withFund,
} from './fundAdminModel';
import { useRead } from './useRead';
import { Refusal } from './Refusal';
import { OverviewTab } from './OverviewTab';
import { BankingTab, ReconciliationTab } from './BankingTabs';
import { CallsTab, DistributionsTab, FeesTab, ReportsTab } from './FundTabs';
import { PerformanceTab } from './PerformanceTab';
import { LpsTab } from './LpsTab';
import { withQuery } from './lpsModel';

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
  // D1164 (#3071): NAV & performance (FND10–FND12): the list, the quarterly history, positions, and the mark and move writes.
  performance: fundPerformanceApi,
  // D1162 (#3069): FND5's roster is `fundAdmin.lps`; FND6's drawer reads and acts per fund.
  notices: fundNoticesApi,
  booklets: fundBookletsApi,
  lps: {
    add: (fundId, body) => api.fundsAddLpV2(fundId, body),
    setType: (fundId, lpId, lpType) => api.fundsSetLpType(fundId, lpId, lpType),
    ledger: (fundId) => api.fundsCallLedger(fundId),
    receipt: (fundId, lineId, body) => api.fundsRecordReceipt(fundId, lineId, body),
    distributions: (fundId) => api.fundsDistributions(fundId),
    contacts: (fundId, lpId) => api.fundsCommsList(fundId, lpId),
    logContact: (fundId, body) => api.fundsLogComm(fundId, body),
  },
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
  const moved = useMovedNotice(MOVED_NOTICES);
  const access = useRead(() => apis.fundAdmin.access(), [apis], { enabled: !branch });
  const overview = useRead(() => apis.fundAdmin.overview(), [apis], { enabled: !branch });

  if (forward) return <Navigate to={forward} replace />;

  // FND20a (D1160): a branch admin sees one centred refusal and the console makes no read.
  if (branch) {
    return (
      <main className="mx-auto max-w-[1440px] px-4 pb-16 sm:px-6" data-testid="fund-admin-console">
        <Refusal kind="branch" testId="fund-admin-branch" />
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
  const counts = tabCounts(overview.status === 'ready' ? overview.data : overview.status === 'unreadable' ? {} : null);
  const keep = keepFund(location.search);
  const asOf = overview.status === 'ready' && overview.data?.as_of ? `As of ${overview.data.as_of}` : null;
  const pill = profilePill(acts);
  const primary = headerPrimary(view, acts, PER_FUND_VIEWS.includes(tab) ? fund : null);
  // D1162: Add LP keeps the roster's filters, so the list under the dialog is the one the admin was reading.
  if (primary && view === 'lps') primary.to = `/admin/fund-admin/lps${withQuery(location.search, 'add', true)}`;
  const filter = fundFilter(funds, location.search, tab);
  const exportCsv = () => downloadCsv(fundsCsv(overview.status === 'ready' ? overview.data : null));

  return (
    <main className="mx-auto max-w-[1440px] pb-16" data-testid="fund-admin-console">
      <div className="px-4 pt-5 sm:px-6">
        <AdminPageHeader
          title={TITLE}
          pills={pill ? [{ ...pill, testId: 'fund-admin-role' }] : []}
          line={LINE}
          actions={primary ? <Link className={actionPrimary} to={primary.to} data-testid="fund-admin-primary">{primary.label}</Link> : null}
          more={moreItems(acts).map((m) => (m.to
            ? <HeaderMenuItem key={m.key} to={m.to} data-testid={`fund-admin-more-${m.key}`}>{m.label}</HeaderMenuItem>
            : <HeaderMenuItem key={m.key} onSelect={exportCsv} data-testid={`fund-admin-more-${m.key}`}>{m.label}</HeaderMenuItem>))}
          chip={asOf ? <span title="Every figure on this page is as of this date." className="inline-flex rounded-full border border-axal-hairline bg-white px-3 py-1 font-mono text-[11.5px] font-medium text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400" data-testid="fund-admin-as-of">{asOf}</span> : null}
          notice={moved}
          tabs={TABS.map((t) => (t.path
            // Literal heads, so the admin route guard reads each tab's door (D1157).
            ? <HeaderTab key={t.key} to={`/admin/fund-admin/${t.path}${keep}`} end={false} count={counts[t.key] || null} data-testid={`fund-admin-tab-${t.key}`}>{t.label}</HeaderTab>
            : <HeaderTab key={t.key} to={`/admin/fund-admin${keep}`} count={null} data-testid={`fund-admin-tab-${t.key}`}>{t.label}</HeaderTab>))}
          data-testid="fund-admin-header"
        />
        {funds.length > 0 && <FundFilter filter={filter} pathname={location.pathname} search={location.search} />}
      </div>
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
          <PerformanceTab apis={apis} access={acts} funds={funds} fundId={filter.pills.find((p) => p.on && p.id != null)?.id ?? null} onChanged={overview.reload} />
        )}
        {view === 'lps' && <LpsTab apis={apis} access={acts} funds={funds} />}
        {(view === 'funds' || view === 'books') && <WaitCard view={view} />}
      </div>
    </main>
  );
}

/** D1157: a tab with no read yet says so where its blocks would be. Never a zero, never "none". */
function WaitCard({ view }) {
  return (
    <section className="mx-4 mt-5 flex flex-col gap-2 rounded-axal-md border border-axal-hairline bg-white px-[18px] py-4 sm:mx-6 dark:border-gray-800 dark:bg-gray-900" data-testid={`fund-admin-wait-${view}`}>
      <span className="w-fit rounded-axal-pill border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className="m-0 text-[13px] text-axal-muted dark:text-gray-400">{WAITS[view]}</p>
    </section>
  );
}
const PER_FUND_VIEWS = ['calls', 'distributions', 'fees', 'reports'];

/** The fund filter (FND2): pills on a desktop, a select on a phone; kept across tabs as `?fund=`. */
function FundFilter({ filter, pathname, search }) {
  const navigate = useNavigate();
  return (
    <div className="mt-3 flex flex-col gap-1.5" data-testid="fund-admin-filter">
      <nav aria-label="Fund" className="hidden w-fit flex-wrap gap-0.5 rounded-full border border-axal-hairline bg-[#faf9fc] p-[3px] sm:flex dark:border-gray-700 dark:bg-gray-800">
        {filter.pills.map((p) => (
          <Link key={p.key} to={withFund(pathname, search, p.id)} aria-current={p.on ? 'true' : undefined} data-testid={`fund-admin-filter-${p.key}`}
            className={`inline-flex min-h-[30px] items-center whitespace-nowrap rounded-full px-[13px] text-[12.5px] ${p.on
              ? 'bg-white font-extrabold text-axal-ink shadow-[0_0_0_1px_theme(colors.axal.hairline)] dark:bg-gray-900 dark:text-gray-100'
              : 'font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}>{p.label}</Link>
        ))}
      </nav>
      <label className="flex min-h-[44px] items-center gap-2.5 rounded-[9px] border border-axal-hairline bg-white px-3 text-[13px] font-semibold text-axal-ink sm:hidden dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">Fund</span>
        <select className="min-w-0 flex-1 bg-transparent" value={filter.pills.find((p) => p.on)?.key || ''} data-testid="fund-admin-filter-select"
          onChange={(e) => { const p = filter.pills.find((x) => x.key === e.target.value); if (p) navigate(withFund(pathname, search, p.id)); }}>
          {filter.pills.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </label>
      {filter.note && <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="fund-admin-filter-note">{filter.note}</p>}
    </div>
  );
}

/** Export (FND1): a file made in the browser from the read on the page; nothing is sent. */
function downloadCsv(text) {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'fund-admin-funds.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function FundAdminConsole() {
  const { user } = useAuth() || {};
  return <FundAdminConsoleView user={user} />;
}
