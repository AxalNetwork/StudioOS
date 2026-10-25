import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { adminNetworkApi } from '../../../lib/api/adminNetwork';
import { reportError } from '../../../lib/log';
import { AdminPageHeader, HeaderTab, useMovedNotice } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import AdminNetworkProfiles from '../AdminNetworkProfiles';
import FirmsTab from './Firms';
import ApOverview from './ApOverview';
import People from './People';
import {
  AP_TITLE, COMMUNITY_PATH, MOVED_NOTICES, PAGE_LINE, RAIL_NOTE, TABS,
  tabOf,
} from './apModel';

/**
 * D972 (#2369) — Advisors & Partners at /admin/advisors-partners, built to the
 * owner's canvas (AP1–AP14) under the shared admin page header (D936). It
 * replaces the Admin Console's "Mentor & partner network" tab: that tab and
 * the bare /admin/network-profiles both forward to the Deck roster tab with
 * the moved notice.
 *
 * D977 completes Overview from D973's summary read. Firms keeps its own
 * reads and the Deck roster is embedded; People (D978) is its own read, in
 * `People.jsx`. Nothing is decided here that is decided elsewhere: a deal
 * and a host decision each open the page that decides. The Firms tab (D952, D979, `Firms.jsx`) makes its own two, each behind
 * a dialog: an account's firm and a firm's directory switches.
 */

const idle = { status: 'loading', data: null };
const READS = {
  overview: ['overview'],
  // D979: the firms list is Firms.jsx's own read; the strip and the attach table read `links`.
  firms: ['links'],
  people: [],
  deck: [],
};

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
  const notice = useMovedNotice(MOVED_NOTICES);
  const current = TABS.find((t) => t.key === tab);

  // Literal doors, one per tab (D936), so the reachability walk finds each.
  const tabs = (
    <>
      <HeaderTab to="/admin/advisors-partners" data-testid="ap-tab-overview">Overview</HeaderTab>
      <HeaderTab to="/admin/advisors-partners/people" data-testid="ap-tab-people">People</HeaderTab>
      <HeaderTab to="/admin/advisors-partners/firms" data-testid="ap-tab-firms">Firms</HeaderTab>
      <HeaderTab to="/admin/advisors-partners/deck" data-testid="ap-tab-deck">Deck roster</HeaderTab>
    </>
  );
  const actions = tab === 'deck' || tab === 'people' ? null : (
    <>
      <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="ap-asof">
        {asOf ? `Updated ${new Date(asOf).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}` : 'Reading…'}
      </span>
      <button type="button" aria-label="Refresh" onClick={reload} className="grid h-9 w-9 place-items-center rounded-[9px] border border-axal-hairline text-axal-muted dark:border-gray-700"><RefreshCw size={16} aria-hidden="true" /></button>
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
      {tab === 'overview' && <ApOverview read={reads.overview} reload={reload} />}
      {tab === 'people' && <People />}
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
