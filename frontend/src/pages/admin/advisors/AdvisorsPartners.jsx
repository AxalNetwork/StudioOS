import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api, adminNetworkProfiles } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { AdminPageHeader, HeaderTab, useMovedNotice } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import AdminNetworkProfiles from '../AdminNetworkProfiles';
import FirmLinks from './FirmLinks';
import People from './People';
import {
  AP_TITLE, COMMUNITY_PATH, MOVED_NOTICES, NOT_YET, PAGE_LINE, RAIL_NOTE, TABS, WAITS,
  buildFirms, buildNeeds, buildTiles, pageFailed, tabOf,
} from './apModel';

/**
 * D972 (#2369) — Advisors & Partners at /admin/advisors-partners, built to the
 * owner's canvas (AP1–AP14) under the shared admin page header (D936). It
 * replaces the Admin Console's "Mentor & partner network" tab: that tab and
 * the bare /admin/network-profiles both forward to the Deck roster tab with
 * the moved notice.
 *
 * THE INTEGRATION, NOT THE WHOLE CANVAS (D972 §3). The header, the tabs whose
 * reads exist, and the Overview and Firms blocks drawn from them, each
 * truthfully. People (D978) is its own read, in `People.jsx`. The Deck roster is today's roster,
 * embedded. Nothing is decided here that is decided elsewhere: attaching a
 * firm, a deal and a host decision each open the page that decides.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const DANGER = `${BTN} self-start border border-axal-destructive-edge bg-white text-axal-destructive dark:border-red-900 dark:bg-gray-900 dark:text-red-400`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const TAG = 'self-start rounded-full border border-dashed border-axal-muted px-2 py-0.5 text-[11px] font-semibold text-axal-muted dark:text-gray-400';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';

const idle = { status: 'loading', data: null };
const READS = {
  overview: ['advisors', 'assignments', 'links', 'directory', 'deals', 'hosts', 'roster'],
  firms: ['links', 'directory', 'deals'],
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
    const settle = (key, work) => work.then(
      (data) => { if (live) { setReads((r) => ({ ...r, [key]: { status: 'ready', data } })); setAsOf(Date.now()); } },
      (e) => { reportError(`advisors-partners:${key}`, e); if (live) setReads((r) => ({ ...r, [key]: { status: 'error', data: null } })); },
    );
    const work = {
      advisors: () => api.adminAssignableAdvisors(),
      assignments: () => api.adminAdvisorCohortAssignments(),
      links: () => api.adminPartners.listFirmLinks(),
      directory: () => api.adminListDirectoryPartners(),
      deals: () => api.adminPartners.listDeals('active'),
      hosts: () => api.adminLabHosts('pending'),
      roster: () => adminNetworkProfiles.list(),
    };
    for (const k of want) settle(k, work[k]());
    return () => { live = false; };
  }, [sig, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { reads, asOf, reload };
}

function Skeleton() {
  return <span className="block h-2.5 w-[70%] rounded-full bg-axal-hairline dark:bg-gray-700" />;
}

function Tile({ t, onRetry }) {
  return (
    <div className={`${CARD} flex flex-col gap-1.5 px-4 py-3.5`} data-testid={`ap-tile-${t.key}`}>
      <span className={EYE}>{t.label}</span>
      {t.state === 'loading' && <><span className="font-mono text-[15px] text-axal-muted">Reading…</span><Skeleton /></>}
      {t.state === 'ready' && (
        <>
          <span className={`${MONO} text-[26px] font-medium tracking-[-.01em] text-axal-ink dark:text-gray-100`}>{t.value}</span>
          {t.sub ? <span className={SUB}>{t.sub}</span> : null}
          {t.warn ? <span className="text-[12px] font-semibold text-axal-amber-deep dark:text-amber-300">{t.warn}</span> : null}
        </>
      )}
      {t.state === 'notyet' && <><span className={TAG}>{NOT_YET}</span><span className={SUB}>{t.reason}</span></>}
      {t.state === 'unreadable' && (
        <>
          <span className="text-[13px] font-bold text-axal-destructive dark:text-red-400">Unreadable</span>
          <span className={SUB}>{t.reason}</span>
          <button type="button" className={DANGER} onClick={onRetry}>Try again</button>
        </>
      )}
    </div>
  );
}

function WaitCard({ id, title, reason }) {
  return (
    <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 lg:col-span-6`} data-testid={`ap-wait-${id}`}>
      <h2 className={H2}>{title}</h2>
      <span className={TAG}>{NOT_YET}</span>
      <span className={SUB}>{reason}</span>
    </section>
  );
}

function NeedsCard({ needs }) {
  return (
    <section className={`${CARD} flex flex-col gap-2.5 px-[18px] py-4`} aria-labelledby="ap-h-needs" data-testid="ap-needs">
      <h2 id="ap-h-needs" className={H2}>Needs you</h2>
      {needs.state === 'loading' && <><span className="font-mono text-[13px] text-axal-muted">Reading…</span><Skeleton /></>}
      {needs.state === 'ready' && (
        <>
          {needs.rows.length === 0 && needs.unread.length === 0 ? <span className={SUB}>Nothing needs you.</span> : null}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {needs.rows.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-3 text-[13px] text-axal-ink dark:text-gray-100" data-testid={`ap-need-${r.key}`}>
                <span>{r.text}</span>
                <Link to={r.to} className={GHOST}>{r.action}</Link>
              </li>
            ))}
            {needs.unread.map((u) => (
              <li key={u} className="text-[12.5px] text-axal-destructive dark:text-red-400" data-testid="ap-need-unread">{u}: could not be read, so it may hold something.</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Overview({ reads, reload }) {
  const [now] = useState(() => Date.now());
  const tiles = useMemo(() => buildTiles(reads, now), [reads, now]);
  const needs = useMemo(() => buildNeeds(reads, now), [reads, now]);
  if (pageFailed(reads)) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint px-3.5 py-3 text-[13px] text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" data-testid="ap-unreadable">
        <span>The network's figures could not be read. Nothing here is a zero.</span>
        <button type="button" className={DANGER} onClick={reload}>Try again</button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3.5" data-testid="ap-overview">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="ap-tiles">
        {tiles.map((t) => <Tile key={t.key} t={t} onRetry={reload} />)}
      </div>
      <NeedsCard needs={needs} />
      <div className="grid grid-cols-12 gap-3.5">
        <WaitCard id="c1" title="Who is in the network" reason={WAITS.c1} />
        <WaitCard id="c2" title="Sessions per week" reason={WAITS.c2} />
        <WaitCard id="c3" title="Skills: who can help, and what founders ask for" reason={WAITS.c3} />
        <WaitCard id="c4" title="Active partner deals by type" reason={WAITS.c4} />
      </div>
    </div>
  );
}

function Firms({ reads, reload }) {
  const [now] = useState(() => Date.now());
  const firms = useMemo(() => buildFirms(reads, now), [reads, now]);
  return (
    <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="ap-h-firms" data-testid="ap-firms">
      <h2 id="ap-h-firms" className={H2}>Firms</h2>
      {firms.state === 'loading' && <><span className="font-mono text-[13px] text-axal-muted">Reading…</span><Skeleton /></>}
      {firms.state === 'unreadable' && (
        <div role="alert" className="flex flex-col gap-2.5 text-[13px] text-axal-destructive dark:text-red-300">
          <span>{firms.reason}</span>
          <button type="button" className={DANGER} onClick={reload}>Try again</button>
        </div>
      )}
      {firms.state === 'ready' && (
        <>
          {firms.unattached > 0 ? (
            <p className="m-0 flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-axal-amber/30 px-3 py-2 text-[13px] text-axal-ink dark:text-gray-100" data-testid="ap-firms-unattached">
              <span>Partner accounts with no firm: <span className={MONO}>{firms.unattached.toLocaleString('en-US')}</span></span>
              <a href="#ap-firm-links" className={GHOST}>Attach below</a>
            </p>
          ) : null}
          {firms.rows.length === 0
            ? <span className={SUB}>No firm is recorded yet. A firm is created when a partner is invited.</span>
            : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left text-[12.5px]">
                  <thead>
                    <tr className={EYE}>
                      <th scope="col" className="py-1.5 pr-3 font-bold">Firm</th>
                      <th scope="col" className="py-1.5 pr-3 font-bold">Accounts</th>
                      <th scope="col" className="py-1.5 pr-3 font-bold">Specialization</th>
                      <th scope="col" className="py-1.5 pr-3 font-bold">Active deal</th>
                      <th scope="col" className="py-1.5 font-bold">Directory</th>
                    </tr>
                  </thead>
                  <tbody>
                    {firms.rows.map((r) => (
                      <tr key={r.id} className="border-t border-axal-hairline align-top dark:border-gray-700" data-testid={`ap-firm-${r.id}`}>
                        <th scope="row" className="py-2 pr-3 font-bold text-axal-ink dark:text-gray-100">{r.name}{r.company ? <span className={`block font-normal ${SUB}`}>{r.company}</span> : null}</th>
                        <td className={`py-2 pr-3 ${MONO}`}>{r.accounts}</td>
                        <td className="py-2 pr-3">{r.specialization}</td>
                        <td className={`py-2 pr-3 ${MONO} ${r.endingSoon ? 'text-axal-amber-deep dark:text-amber-300' : ''}`}>{r.deal}</td>
                        <td className="py-2">{r.directory}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          {firms.capped ? <span className={SUB}>The first 500 firms by name.</span> : null}
          {firms.dealsCapped ? <span className={SUB}>Deals are read from the newest 200 active ones.</span> : null}
          <span className={SUB}>Search, filters, pages and each firm's drawer come with D972's Firms part.</span>
        </>
      )}
    </section>
  );
}

/** The Firms tab: the firms, then attaching an account to one (D952, moved from Partner invitations). */
function FirmsTab({ reads, reload }) {
  return (
    <div className="flex flex-col gap-3.5" data-testid="ap-firms-tab">
      <Firms reads={reads} reload={reload} />
      <FirmLinks reads={{ links: reads.links, reload }} />
    </div>
  );
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
      {tab === 'overview' && <Overview reads={reads} reload={reload} />}
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
