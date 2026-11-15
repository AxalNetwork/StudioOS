import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { LightboxPhoneProvider, AdminPageHeader, HeaderMenuItem, HeaderTab, actionPrimary, useMovedNotice } from '../../../ui';
import { useAuth } from '../../../hooks/useAuthSync';
import { branchOfUser } from '../../../lib/shellRole';
import { api } from '../../../lib/api';
import { fundAdminApi } from '../../../lib/api/fundAdmin';
import { adminMercuryApi } from '../../../lib/api/adminMercury';
import { fundLedgerApi } from '../../../lib/api/fundLedger';
import { BooksTab } from './BooksTab';
import { fundFeesApi } from '../../../lib/api/fundFees';
import { fundReportingApi } from '../../../lib/api/fundReporting';
import { adminCapitalAttestationsApi } from '../../../lib/api/adminCapitalAttestations';
import { fundPerformanceApi } from '../../../lib/api/fundPerformance';
import { fundNoticesApi } from '../../../lib/api/fundNotices';
import { fundBookletsApi } from '../../../lib/api/fundBooklets';
import { Banner } from '../../account/ConnectorSheet';
import {
  LEGACY_TABS, LINE, MOVED_NOTICES, TITLE, administeredFunds, fundFilter, fundsCsv,
  headerPrimary, keepFund, legacyHref, moreItems, pickFund, profilePill, tabOfView, viewFrom, viewHref, withFund,
} from './fundAdminModel';
import { ENTITY_SCOPE, ENTITY_VIEWS, WORKSPACES, primaryAction, updatedText, workspaceFlags, workspaceOf } from './workspaceModel';
import { useRead } from './useRead';
import { Refusal } from './Refusal';
import { OverviewTab } from './OverviewTab';
import { BankingTab, ReconciliationTab } from './BankingTabs';
import { FeesTab, ReportsTab } from './FundTabs';
import { CallsTab } from './CallsTab';
import { DistributionsTab } from './DistributionsTab';
import { PerformanceTab } from './PerformanceTab';
import { LpsTab } from './LpsTab';
import { withQuery } from './lpsModel';
import { FundsTab } from './FundsTab';
import { FundPage } from './FundPage';
import { fundIdFrom } from './fundsModel';
import FundAdminAsk from './FundAdminAsk.jsx';
import AdminBoardFrame from '../AdminBoardFrame.jsx';

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
  // D4812 part 2: a Super Admin money act asks for the authenticator code in its flow (BLOCK-AUTH-03's step-up).
  auth: { stepUp: (code) => api.stepUp(code) },
  mercury: adminMercuryApi,
  fees: fundFeesApi,
  reporting: fundReportingApi,
  ledger: fundLedgerApi,
  reports: { periods: (id) => api.fundsReportPeriods(id) },
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
  // D1163 (#3070): the Calls tab's ledger, the new call's preview and issue, and Record receipt.
  calls: {
    ledger: (fundId) => api.fundsCallLedger(fundId),
    preview: (fundId, cents) => api.fundsCallPreview(fundId, cents),
    issue: (fundId, cents, purpose, due) => api.fundsCapitalCallV2(fundId, cents, purpose, due),
    receipt: (fundId, lineId, body) => api.fundsRecordReceipt(fundId, lineId, body),
  },
  funds: {
    // D1161 (#3068): the Funds tab and the one-fund page.
    list: () => api.fundsList(),
    get: (fundId) => api.fundsGet(fundId),
    create: (body) => api.fundsCreateV2(body),
    update: (fundId, body) => api.fundUpdate(fundId, body),
    regenerateLpa: (fundId) => api.fundsRegenerateLpa(fundId),
    downloadLpa: (fundId) => api.downloadFundLpa(fundId),
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
  // D4812: the Overview's NAV and distributions come from the performance list, read only there.
  const performance = useRead(() => apis.performance.list(), [apis], { enabled: !branch && view === 'overview' && Boolean(apis.performance?.list) });
  // D4812 (FA-01): "Updated 14:30 UTC · Refresh" replaces the page-wide as-of date.
  const [readAt, setReadAt] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { if (overview.status === 'ready') setReadAt(new Date()); }, [overview.status, overview.data]);

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
  const keep = keepFund(location.search);
  const pill = profilePill(acts);
  // D1161: `/admin/fund-admin/funds/:id` is one fund's page; it sits in no workspace (D4812).
  const oneFund = view === 'funds' ? fundIdFrom(location.pathname) : null;
  const filterView = view === 'reports' && !/\/(periods|notices)\/?$/.test(location.pathname) ? 'reportPacks' : tab;
  const filter = fundFilter(funds, location.search, filterView);
  const scopeId = filter.pills.find((p) => p.on && p.id != null)?.id ?? null;
  const ws = workspaceOf(view);
  const overviewData = overview.status === 'ready' ? overview.data : null;
  const flags = workspaceFlags(overviewData, scopeId);
  const fallback = headerPrimary(view, acts, PER_FUND_VIEWS.includes(tab) ? fund : null, oneFund);
  // D1162: Add LP keeps the roster’s filters.
  if (fallback && view === 'lps') fallback.to = `/admin/fund-admin/lps${withQuery(location.search, 'add', true)}`;
  const primary = primaryAction({ view, access: acts, overview: overviewData, fundId: scopeId ?? (PER_FUND_VIEWS.includes(tab) ? fund?.id ?? null : null), fallback });
  const updated = updatedText(readAt);
  const refresh = () => { access.reload(); overview.reload(); performance.reload(); setRefreshKey((k) => k + 1); };
  const current = WORKSPACES.find((w) => w.key === ws);
  const scopeLabel = scopeId != null ? funds.find((f) => f.id === scopeId)?.name || 'One fund' : `All funds · ${funds.length} fund${funds.length === 1 ? '' : 's'}`;

  const exportCsv = () => downloadCsv(fundsCsv(overviewData));

  return (
    <LightboxPhoneProvider phone="sheet">
    <main className="mx-auto max-w-[1440px] pb-16" data-testid="fund-admin-console">
      <FundAdminAsk user={user} api={apis.fundAdmin} fundId={oneFund ?? scopeId ?? (PER_FUND_VIEWS.includes(tab) ? fund?.id ?? null : null)}
        scopeLabel={oneFund ? 'Fund setup' : scopeId != null || PER_FUND_VIEWS.includes(tab) ? fund?.name || 'Chosen fund' : 'All administered funds'} />
      <div className="px-4 pt-5 sm:px-6">
        <AdminPageHeader
          crumb={view === 'funds' ? { label: TITLE, to: `/admin/fund-admin${keep}`, current: oneFund ? 'Fund' : 'Funds' } : null}
          title={TITLE}
          pills={pill ? [{ ...pill, testId: 'fund-admin-role' }] : []}
          line={LINE}
          actions={primary ? <Link className={`${actionPrimary} max-sm:min-h-[44px] max-sm:w-full max-sm:justify-center`} to={primary.to} data-testid="fund-admin-primary">{primary.label}</Link> : null}
          more={moreItems(acts).map((m) => (m.to
            ? <HeaderMenuItem key={m.key} to={m.to} data-testid={`fund-admin-more-${m.key}`}>{m.label}</HeaderMenuItem>
            : <HeaderMenuItem key={m.key} onSelect={exportCsv} data-testid={`fund-admin-more-${m.key}`}>{m.label}</HeaderMenuItem>))}
          chip={(
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="fund-admin-context">
              {funds.length > 0 && view !== 'books' && view !== 'funds' && (ENTITY_VIEWS.includes(view)
                ? <span className="text-[13px] text-axal-muted dark:text-gray-400" data-testid="fund-admin-scope-entities">Scope: {ENTITY_SCOPE}</span>
                : <FundScope filter={filter} pathname={location.pathname} search={location.search} />)}
              {updated && (
                <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid="fund-admin-updated">
                  {updated} ·
                  <button type="button" className="min-h-[44px] font-sans text-[12.5px] font-bold text-axal-violet-deep hover:underline sm:min-h-0 dark:text-violet-300" onClick={refresh} data-testid="fund-admin-refresh">Refresh</button>
                </span>
              )}
            </div>
          )}
          notice={moved}
          tabs={WORKSPACES.map((w) => (w.path
            // Literal heads, so the admin route guard reads each workspace's door (D1157).
            ? <HeaderTab key={w.key} to={`/admin/fund-admin/${w.path}${keep}`} active={ws === w.key} count={flags[w.key] || null} data-testid={`fund-admin-tab-${w.key}`}>{w.label}</HeaderTab>
            : <HeaderTab key={w.key} to={`/admin/fund-admin${keep}`} active={ws === w.key} count={null} data-testid={`fund-admin-tab-${w.key}`}>{w.label}</HeaderTab>))}
          data-testid="fund-admin-header"
        />
      </div>
      {access.status === 'unreadable' && (
        <div className="mx-4 mt-4 sm:mx-6">
          <Banner tone="warn" data-testid="fund-admin-access-unreadable">
            Which acts you may take could not be read, so every control is shown. The Worker still refuses an act you may not take.
            <button type="button" className="ml-2 underline" onClick={access.reload} data-testid="fund-admin-access-retry">Try again</button>
          </Banner>
        </div>
      )}
      {current && current.parts.length > 1 && (
        <nav className="mx-4 mt-4 flex flex-wrap gap-2 sm:mx-6" aria-label={current.label} data-testid={`fund-admin-${current.key}-parts`}>
          {current.parts.map((b) => {
            const props = { 'aria-current': b.key === view ? 'page' : undefined, 'data-testid': `fund-admin-part-${b.key}`,
              className: `inline-flex min-h-[44px] items-center rounded-axal-pill border px-3.5 text-[13px] font-bold sm:min-h-[34px] ${b.key === view
                ? 'border-axal-violet bg-axal-violet/10 text-axal-violet-deep dark:text-violet-300'
                : 'border-axal-hairline text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-100'}` };
            // Literal heads, so the route guard's walk reads Banking's two-segment doors (D1157).
            return b.path.startsWith('banking/')
              ? <Link key={b.key} to={`/admin/fund-admin/banking/${b.key}${keep}`} {...props}>{b.label}</Link>
              : <Link key={b.key} to={`/admin/fund-admin/${b.path}${keep}`} {...props}>{b.label}</Link>;
          })}
        </nav>
      )}
      <div data-testid={`fund-admin-panel-${view}`}>
        {view === 'overview' && <OverviewTab overview={overview} performance={performance} apis={apis} fundId={scopeId} scopeLabel={scopeLabel} readAt={updated ? updated.replace(/^Updated /, '') : null} refreshKey={refreshKey} />}
        {view === 'banking' && <BankingTab apis={apis} access={acts} />}
        {view === 'reconciliation' && <ReconciliationTab apis={apis} access={acts} />}
        {view === 'calls' && <CallsTab {...fundProps} />}
        {view === 'distributions' && <DistributionsTab {...fundProps} />}
        {view === 'fees' && <FeesTab key={fund?.id} {...fundProps} />}
        {view === 'reports' && <ReportsTab key={params.get('fund') || 'all'} {...fundProps} />}
        {view === 'performance' && (
          <PerformanceTab apis={apis} access={acts} funds={funds} fundId={scopeId} onChanged={overview.reload} />
        )}
        {view === 'lps' && <LpsTab apis={apis} access={acts} funds={funds} />}
        {view === 'books' && <BooksTab key={params.get('fund') || 'first'} apis={apis} selectedFund={params.get('fund')} onFund={(id) => go({ fund: id })} />}
        {view === 'funds' && (oneFund
          ? <FundPage key={oneFund} apis={apis} access={acts} overview={overview} fundId={oneFund} />
          : <FundsTab apis={apis} access={acts} overview={overview} />)}

      </div>
    </main>
    </LightboxPhoneProvider>
  );
}

const PER_FUND_VIEWS = ['calls', 'distributions', 'fees', 'reports'];

/**
 * D4812 (FA-08): the one fund-scope control, "Fund scope: All funds ▾". It
 * replaces D1160's pills and the phone select, which drew the same state
 * twice. Each choice is a link, so the scope stays in the address (`?fund=`)
 * and a keyboard or a screen reader opens it like any disclosure. A view that
 * acts on one fund offers no All funds: the fund is chosen explicitly.
 */
function FundScope({ filter, pathname, search }) {
  const ref = useRef(null);
  const on = filter.pills.find((p) => p.on);
  const close = () => { if (ref.current) ref.current.open = false; };
  // D4812 part 8: Escape closes the open list and gives focus back to the control, as ⋯ does.
  const onKeyDown = (e) => {
    if (e.key !== 'Escape' || !ref.current?.open) return;
    e.preventDefault();
    close();
    ref.current.querySelector('summary')?.focus();
  };
  return (
    <details ref={ref} className="relative" onKeyDown={onKeyDown} data-testid="fund-admin-filter">
      <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 rounded-[9px] border border-axal-hairline bg-white px-3 text-[13px] text-axal-ink sm:min-h-[34px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="fund-admin-scope">
        <span className="text-axal-muted dark:text-gray-400">Fund scope:</span>
        <span className="font-bold">{on?.label || 'Choose a fund'}</span>
        <span aria-hidden="true">▾</span>
      </summary>
      <ul aria-label="Fund scope" className="absolute left-0 z-20 mt-1 min-w-[240px] list-none rounded-[10px] border border-axal-hairline bg-white p-1 shadow-sm dark:border-gray-700 dark:bg-gray-900">
        {filter.pills.map((p) => (
          <li key={p.key}>
            <Link to={withFund(pathname, search, p.id)} onClick={close} aria-current={p.on ? 'true' : undefined} data-testid={`fund-admin-filter-${p.key}`}
              className={`flex min-h-[44px] items-center rounded-[7px] px-3 text-[13px] sm:min-h-[36px] ${p.on ? 'bg-axal-lavender font-bold text-axal-ink dark:bg-violet-950/40 dark:text-gray-100' : 'text-zinc-700 hover:bg-[#faf9fc] dark:text-gray-200 dark:hover:bg-gray-800'}`}>
              {p.label}{p.id == null ? <span className="ml-2 text-[12px] font-normal text-axal-muted dark:text-gray-400">every administered fund</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </details>
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
  const content = <FundAdminConsoleView user={user} />;
  return branchOfUser(user) ? content : <AdminBoardFrame workspace="Fund Admin" note="Eadwyn prepares, explains and navigates. It never issues, records or moves money." operations>{content}</AdminBoardFrame>;
}
