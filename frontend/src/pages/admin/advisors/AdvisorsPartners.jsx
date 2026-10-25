import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { adminNetworkApi } from '../../../lib/api/adminNetwork';
import { reportError } from '../../../lib/log';
import { AdminPageHeader, HeaderTab, useMovedNotice } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import AdminNetworkProfiles from '../AdminNetworkProfiles';
import FirmsTab from './Firms';
import ApOverview from './ApOverview';
import {
  AP_TITLE, COMMUNITY_PATH, MOVED_NOTICES, PAGE_LINE, PAUSED, PAUSE_EVENTS, RAIL_NOTE, TABS,
  tabCountOf, tabOf,
} from './apModel';

/**
 * D972 (#2369) — Advisors & Partners at /admin/advisors-partners, built to the
 * owner's canvas (AP1–AP14) under the shared admin page header (D936). It
 * replaces the Admin Console's "Mentor & partner network" tab: that tab and
 * the bare /admin/network-profiles both forward to the Deck roster tab with
 * the moved notice.
 *
 * D977 completes Overview from D973's summary read. Firms keeps its own
 * reads and the Deck roster is embedded; People is a separate UI part. Nothing is decided here that is decided elsewhere: a deal
 * and a host decision each open the page that decides. The Firms tab (D952, D979, `Firms.jsx`) makes its own two, each behind
 * a dialog: an account's firm and a firm's directory switches.
 */

const idle = { status: 'loading', data: null };
const READS = {
  overview: ['overview'],
  // D979: the firms list is Firms.jsx's own read; the strip and the attach table read `links`.
  firms: ['links'],
  deck: [],
};

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const GHOST = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] border border-axal-hairline bg-white px-3.5 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

/** D1125: the header tabs' counts, one read for all four, reloaded with the page's refresh. */
function useTabCounts(tick) {
  const [read, setRead] = useState(idle);
  useEffect(() => {
    let live = true;
    setRead(idle);
    adminNetworkApi.tabs().then(
      (data) => { if (live) setRead({ status: 'ready', data }); },
      (e) => { reportError('advisors-partners:tabs', e); if (live) setRead({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  }, [tick]);
  return read;
}

/** D1125 (AP12b): a write on this page was refused because HQ paused this studio's admin access. */
function usePausedByHq() {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const on = () => setPaused(true);
    for (const name of PAUSE_EVENTS) window.addEventListener(name, on);
    return () => { for (const name of PAUSE_EVENTS) window.removeEventListener(name, on); };
  }, []);
  return paused;
}

function PausedNotice() {
  return (
    <div role="alert" className={`${CARD} mx-auto flex w-full max-w-[560px] flex-col items-center gap-2 px-6 py-6 text-center`} data-testid="ap-paused">
      <span aria-hidden="true" className="text-[20px] text-axal-muted">‖</span>
      <h2 className={H2}>{PAUSED.title}</h2>
      <p className={`m-0 ${SUB}`}>{PAUSED.line}</p>
      <Link to={PAUSED.to} className={GHOST}>{PAUSED.action}</Link>
    </div>
  );
}

/** The tab's reads. Each settles alone, so a slow or failed read holds back only its blocks. */
function useApReads(tab) {
  const keys = READS[tab] || READS.deck;
  const [reads, setReads] = useState({});
  const [asOf, setAsOf] = useState(null);
  const [tick, setTick] = useState(0);
  const sig = keys.join(',');

  useEffect(() => {
    let live = true;
    const want = sig ? sig.split(',') : [];
    setReads(Object.fromEntries(want.map((k) => [k, idle])));
    setAsOf(null);
    const settle = (key, work) => work.then(
      (data) => { if (live) { setReads((r) => ({ ...r, [key]: { status: 'ready', data } })); setAsOf(Date.now()); } },
      (e) => { reportError(`advisors-partners:${key}`, e); if (live) setReads((r) => ({ ...r, [key]: { status: 'error', data: null } })); },
    );
    const work = {
      overview: () => adminNetworkApi.overview(),
      links: () => api.adminPartners.listFirmLinks(),
      directory: () => api.adminListDirectoryPartners(),
      deals: () => api.adminPartners.listDeals('active'),
    };
    for (const k of want) settle(k, work[k]());
    return () => { live = false; };
  }, [sig, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { reads, asOf, reload };
}

function AdvisorsPartnersPage() {
  const loc = useLocation();
  const tab = tabOf(loc.pathname) || 'overview';
  const { reads, asOf, reload } = useApReads(tab);
  const [countTick, setCountTick] = useState(0);
  const counts = useTabCounts(countTick);
  const paused = usePausedByHq();
  const refresh = useCallback(() => { reload(); setCountTick((t) => t + 1); }, [reload]);
  const notice = useMovedNotice(MOVED_NOTICES);
  const current = TABS.find((t) => t.key === tab);

  // Literal doors, one per tab (D936), so the reachability walk finds each.
  const tabs = (
    <>
      <HeaderTab to="/admin/advisors-partners" count={tabCountOf(counts, 'overview')} data-testid="ap-tab-overview">Overview</HeaderTab>
      <HeaderTab to="/admin/advisors-partners/firms" count={tabCountOf(counts, 'firms')} data-testid="ap-tab-firms">Firms</HeaderTab>
      <HeaderTab to="/admin/advisors-partners/deck" count={tabCountOf(counts, 'deck')} data-testid="ap-tab-deck">Deck roster</HeaderTab>
    </>
  );
  const actions = tab === 'deck' ? null : (
    <>
      <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="ap-asof">
        {asOf ? `Updated ${new Date(asOf).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}` : 'Reading…'}
      </span>
      <button type="button" aria-label="Refresh" onClick={refresh} className="grid h-9 w-9 place-items-center rounded-[9px] border border-axal-hairline text-axal-muted dark:border-gray-700"><RefreshCw size={16} aria-hidden="true" /></button>
    </>
  );

  return (
    <div className="flex flex-col gap-5 pb-24 lg:pb-10" data-testid="advisors-partners">
      <AdminPageHeader
        crumb={{ label: 'Community', to: COMMUNITY_PATH, current: tab === 'overview' ? AP_TITLE : `${AP_TITLE} › ${current.label}` }}
        title={AP_TITLE}
        actions={actions}
        line={PAGE_LINE}
        scope
        notice={{ text: notice.text, onDismiss: notice.dismiss }}
        tabs={tabs}
        data-testid="ap-header"
      />
      {paused ? <PausedNotice /> : null}
      {tab === 'overview' && <ApOverview read={reads.overview} reload={reload} />}
      {tab === 'firms' && <FirmsTab reads={reads} reload={reload} />}
      {tab === 'deck' && <AdminNetworkProfiles embedded />}
    </div>
  );
}

/** The page inside its rail frame (D774), the frame the page's outermost element. */
export default function AdvisorsPartners() {
  return (
    <AdminBoardFrame workspace="Advisors and partners" note={RAIL_NOTE} data-testid="admin-board-advisors-partners">
      <AdvisorsPartnersPage />
    </AdminBoardFrame>
  );
}
