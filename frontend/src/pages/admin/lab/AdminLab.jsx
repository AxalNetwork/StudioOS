import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Eye, RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { AdminPageHeader, HeaderTab, useMovedNotice } from '../../../ui';
import { glancesFromStudioGlance, loadStudioGlance } from '../adminStudioOverview';
import AdminSpinoutLab from '../AdminSpinoutLab';
import {
  DATES_FIXED, FACTS, LAB_PATH, LAB_TITLE, MOVED_NOTICES, NOT_YET, PAGE_LINE, PROGRAMS_PATH, TABS, WAITS,
  buildCohorts, buildNeeds, buildTiles, pageFailed, tabOf,
} from './labModel';

/**
 * D937 (#2374) — the Spin-Out Lab's admin page at /admin/programs/spinout-lab,
 * built to the owner's canvas (SL1–SL21) under the shared header (D936, #2375).
 * It replaces two addresses and one Admin Console tab: /admin/spinout-lab, its
 * /preview, and /admin?tab=lab-applications all forward here with the moved
 * notice.
 *
 * THE INTEGRATION, NOT THE WHOLE CANVAS (D937 §3). The header, the tabs whose
 * console exists, and the Overview blocks whose reads exist, each drawn
 * truthfully. Every tab but Overview is today's console, asked for one section
 * through `AdminSpinoutLab`'s `section` prop. Applications is the cycle queue,
 * the one door that decides with a reason; the old list that accepted with
 * none is not reached any more.
 *
 * NO RAIL: D317 keeps Eadwyn out of the Lab, and NO_RAIL_ROUTES says so.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const DANGER = `${BTN} self-start border border-axal-destructive-edge bg-white text-axal-destructive dark:border-red-900 dark:bg-gray-900 dark:text-red-400`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const LINK = 'text-[12px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300';
const TAG = 'self-start rounded-full border border-dashed border-axal-muted px-2 py-0.5 text-[11px] font-semibold text-axal-muted dark:text-gray-400';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';

const idle = { status: 'loading', data: null };

/**
 * The page's reads. The header's two counts (the queue and the hosts) are read
 * on every tab; Overview reads four more. Each settles alone, so a slow or
 * failed read holds back only its own blocks.
 */
function useLabReads(overview) {
  const keys = useMemo(() => (overview
    ? ['glance', 'hosts', 'applications', 'timeline', 'review', 'certificates']
    : ['glance', 'hosts']), [overview]);
  const [reads, setReads] = useState({});
  const [asOf, setAsOf] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setReads(Object.fromEntries(keys.map((k) => [k, idle])));
    const settle = (key, work) => work.then(
      (data) => { if (live) { setReads((r) => ({ ...r, [key]: { status: 'ready', data } })); setAsOf(Date.now()); } },
      (e) => { reportError(`admin-lab:${key}`, e); if (live) setReads((r) => ({ ...r, [key]: { status: 'error', data: null } })); },
    );
    const work = {
      glance: () => loadStudioGlance().then((payload) => {
        const hq = glancesFromStudioGlance(payload, null).hq;
        if (!hq) throw new Error('The glance carried no HQ block');
        return hq;
      }),
      hosts: () => api.adminLabHosts('pending'),
      applications: () => api.adminCohortApplications(),
      timeline: () => api.adminCohortTimeline(),
      review: () => api.adminCohortReview(),
      certificates: () => api.spinoutCertificateList(),
    };
    for (const k of keys) settle(k, work[k]());
    return () => { live = false; };
  }, [keys, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { reads, asOf, reload };
}

/** A tab's count for the header (D936): a number, a dash with its reason, or a loading bar. */
function tabCounts(reads) {
  const out = {};
  const g = reads.glance;
  if (!g || g.status === 'loading') out.applications = { kind: 'load' };
  else {
    const lane = g.status === 'ready' ? (g.data?.approvals?.lanes || []).find((l) => l.key === 'cohort') : null;
    out.applications = lane && typeof lane.count === 'number'
      ? { kind: 'num', value: lane.count.toLocaleString('en-US') }
      : { kind: 'dash', tip: 'Could not be read: the cohort applications lane did not answer.' };
  }
  const h = reads.hosts;
  if (!h || h.status === 'loading') out.hosts = { kind: 'load' };
  else {
    const n = h.status === 'ready' ? Number(h.data?.counts?.pending) : NaN;
    out.hosts = Number.isFinite(n) ? { kind: 'num', value: n.toLocaleString('en-US') } : { kind: 'dash', tip: 'Could not be read: the hosts list did not answer.' };
  }
  out.participants = { kind: 'dash', tip: `${NOT_YET}: this read cannot yet tell a failure from none.` };
  return out;
}

function Skeleton() {
  return <span className="block h-2.5 w-[70%] rounded-full bg-axal-hairline dark:bg-gray-700" />;
}

function Tile({ t, onRetry, children }) {
  return (
    <div className={`${CARD} flex flex-col gap-1.5 px-4 py-3.5`} data-testid={`lab-tile-${t.key}`}>
      <span className={EYE}>{t.label}</span>
      {t.state === 'loading' && <><span className="font-mono text-[15px] text-axal-muted">Reading…</span><Skeleton /></>}
      {t.state === 'ready' && (
        <>
          <span className={`${MONO} text-[26px] font-medium tracking-[-.01em] text-axal-ink dark:text-gray-100`}>{t.value}</span>
          {t.sub ? <span className={`${SUB} ${MONO}`}>{t.sub}</span> : null}
          {t.overdue ? <span className="self-start rounded-full bg-axal-amber px-2 py-0.5 text-[11px] font-bold text-axal-amber-deep">Overdue: the oldest has waited 72 hours or more</span> : null}
        </>
      )}
      {t.state === 'unreadable' && (
        <>
          <span className="text-[13px] font-bold text-axal-destructive dark:text-red-400">Unreadable</span>
          <span className={SUB}>{t.reason}</span>
          <button type="button" className={DANGER} onClick={onRetry}>Try again</button>
        </>
      )}
      {children}
    </div>
  );
}

function Failed({ reason, onRetry }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint p-3.5 text-[13px] leading-normal text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
      <span>{reason || 'Could not be read. That is not the same as none.'}</span>
      <button type="button" className={DANGER} onClick={onRetry}>Try again</button>
    </div>
  );
}

/** A block the canvas draws that waits for a part: its title and what it waits for. Never a zero. */
function WaitCard({ id, title, reason, wide = false }) {
  return (
    <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 ${wide ? '' : 'lg:col-span-6'}`} data-testid={`lab-wait-${id}`}>
      <h2 className={H2}>{title}</h2>
      <span className={TAG}>{NOT_YET}</span>
      <span className={SUB}>{reason}</span>
    </section>
  );
}

function CohortsCard({ cohorts, onRetry }) {
  return (
    <section className={`${CARD} col-span-12 flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="lab-h-cohorts" data-testid="lab-cohorts">
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="lab-h-cohorts" className={H2}>Cohort calendar</h2>
        <Link to={`${LAB_PATH}/cohorts`} className={LINK}>Open Cohorts</Link>
      </span>
      {cohorts.state === 'loading' && <><span className="font-mono text-[13px] text-axal-muted">Reading…</span><Skeleton /></>}
      {cohorts.state === 'unreadable' && <Failed reason={cohorts.reason} onRetry={onRetry} />}
      {cohorts.state === 'ready' && (cohorts.rows.length === 0
        ? <span className={SUB}>The Lab’s calendar holds no cohort yet. The Lab’s clock schedules each one on its own.</span>
        : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-[12.5px]">
              <thead>
                <tr className={EYE}>
                  <th scope="col" className="py-1.5 pr-3 font-bold">Cohort</th>
                  <th scope="col" className="py-1.5 pr-3 font-bold">Status</th>
                  <th scope="col" className="py-1.5 pr-3 font-bold">Applications</th>
                  <th scope="col" className="py-1.5 pr-3 font-bold">Starts</th>
                  <th scope="col" className="py-1.5 pr-3 font-bold">Week 4 deadline</th>
                  <th scope="col" className="py-1.5 pr-3 font-bold">Pool</th>
                  <th scope="col" className="py-1.5 font-bold">Started</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.rows.map((r) => (
                  <tr key={r.id} className="border-t border-axal-hairline align-top dark:border-gray-700" data-testid={`lab-cohort-${r.id}`}>
                    <th scope="row" className="py-2 pr-3 font-bold text-axal-ink dark:text-gray-100">
                      <span className={MONO}>{r.label}</span>{r.now ? <span className="ml-1.5 rounded-full bg-axal-lavender px-1.5 py-0.5 text-[10.5px] font-bold text-axal-violet-deep">now</span> : null}
                    </th>
                    <td className="py-2 pr-3">{r.word}</td>
                    <td className={`py-2 pr-3 ${MONO}`}>{r.window}</td>
                    <td className={`py-2 pr-3 ${MONO}`}>{r.starts}</td>
                    <td className={`py-2 pr-3 ${MONO}`}>{r.week4}</td>
                    <td className={`py-2 pr-3 ${MONO}`}>{r.pool}</td>
                    <td className={`py-2 ${MONO}`}>{r.started}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      {cohorts.state === 'ready' && cohorts.appsUnreadable ? <span className={SUB}>The applications could not be read, so each cohort’s window and pool say so. The rest is from the calendar.</span> : null}
      {cohorts.state === 'ready' && cohorts.capped ? <span className={SUB}>The 12 newest cohorts the calendar holds.</span> : null}
      <span className={SUB}>{DATES_FIXED} Times are ET (America/New_York).</span>
      <span className={SUB}>{WAITS.calendar}</span>
    </section>
  );
}

function NeedsCard({ needs }) {
  return (
    <section className={`${CARD} col-span-12 flex flex-col gap-2.5 px-[18px] py-4 lg:col-span-6`} aria-labelledby="lab-h-needs" data-testid="lab-needs">
      <h2 id="lab-h-needs" className={H2}>Needs you</h2>
      {needs.state === 'loading' && <><span className="font-mono text-[13px] text-axal-muted">Reading…</span><Skeleton /></>}
      {needs.state === 'ready' && (
        <>
          {needs.rows.length === 0 && needs.unread.length === 0 ? <span className={SUB}>Nothing needs you.</span> : null}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {needs.rows.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-3 text-[13px] text-axal-ink dark:text-gray-100" data-testid={`lab-need-${r.key}`}>
                <span>{r.text}</span>
                <Link to={`${LAB_PATH}${r.tab}`} className={GHOST}>{r.action}</Link>
              </li>
            ))}
            {needs.unread.map((u) => (
              <li key={u} className="text-[12.5px] text-axal-destructive dark:text-red-400" data-testid="lab-need-unread">{u}: could not be read, so it may hold something.</li>
            ))}
          </ul>
          <span className={SUB}>Paid formation orders with no packet are on Formation; that list holds every startup’s orders, not only the Lab’s.</span>
        </>
      )}
    </section>
  );
}

function Overview({ reads, reload }) {
  const [now] = useState(() => Date.now());
  const tiles = useMemo(() => buildTiles(reads, now), [reads, now]);
  const cohorts = useMemo(() => buildCohorts(reads, now), [reads, now]);
  const needs = useMemo(() => buildNeeds(reads), [reads]);
  if (pageFailed(reads)) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint px-3.5 py-3 text-[13px] text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" data-testid="lab-unreadable">
        <span>The Lab’s figures could not be read. Nothing here is a zero. Every tab still opens its console.</span>
        <button type="button" className={DANGER} onClick={reload}>Try again</button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3.5" data-testid="lab-overview">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="lab-tiles">
        {tiles.map((t) => (t.key === 'waiting'
          ? <Tile key={t.key} t={t} onRetry={reload}><Link to={`${LAB_PATH}/applications`} className={`${LINK} self-start`}>Review</Link></Tile>
          : <Tile key={t.key} t={t} onRetry={reload} />))}
      </div>
      <div className="grid grid-cols-12 gap-3.5">
        <CohortsCard cohorts={cohorts} onRetry={reload} />
        <WaitCard id="by-cohort" title="Applications by cohort" reason={WAITS.byCohort} />
        <WaitCard id="weeks" title="Weeks passed, by cohort" reason={WAITS.weeks} />
        <WaitCard id="funnel" title="From application to company" reason={WAITS.funnel} />
        <NeedsCard needs={needs} />
        <WaitCard id="per-week" title="Applications per week" reason={WAITS.perWeek} wide />
      </div>
    </div>
  );
}

/** Which console section each tab asks `AdminSpinoutLab` for. */
const SECTIONS = {
  applications: ['cycles'],
  cohorts: ['timing'],
  participants: ['participants'],
  hosts: ['hosts'],
  formation: ['review83b', 'formation'],
  graduation: ['certificates'],
};

export default function AdminLab({ onImpersonate }) {
  const loc = useLocation();
  const tab = tabOf(loc.pathname) || 'overview';
  const { reads, asOf, reload } = useLabReads(tab === 'overview');
  const notice = useMovedNotice(MOVED_NOTICES);
  const counts = tabCounts(reads);
  const current = TABS.find((t) => t.key === tab);
  // Literal doors, one per tab (D936), so the reachability walk finds each.
  const tabs = (
    <>
      <HeaderTab to="/admin/programs/spinout-lab" data-testid="lab-tab-overview">Overview</HeaderTab>
      <HeaderTab to="/admin/programs/spinout-lab/applications" count={counts.applications} data-testid="lab-tab-applications">Applications</HeaderTab>
      <HeaderTab to="/admin/programs/spinout-lab/cohorts" data-testid="lab-tab-cohorts">Cohorts</HeaderTab>
      <HeaderTab to="/admin/programs/spinout-lab/participants" count={counts.participants} data-testid="lab-tab-participants">Participants</HeaderTab>
      <HeaderTab to="/admin/programs/spinout-lab/hosts" count={counts.hosts} data-testid="lab-tab-hosts">Hosts</HeaderTab>
      <HeaderTab to="/admin/programs/spinout-lab/formation" data-testid="lab-tab-formation">Formation</HeaderTab>
      <HeaderTab to="/admin/programs/spinout-lab/graduation" data-testid="lab-tab-graduation">Graduation</HeaderTab>
    </>
  );

  const actions = (
    <>
      <Link to="/admin/programs/spinout-lab/preview" className={GHOST} data-testid="lab-preview"><Eye size={14} aria-hidden="true" /> Preview founder journey</Link>
      {tab === 'overview' && (
        <>
          <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="lab-asof">
            {asOf ? `Updated ${new Date(asOf).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}` : 'Reading…'}
          </span>
          <button type="button" aria-label="Refresh" onClick={reload} className="grid h-9 w-9 place-items-center rounded-[9px] border border-axal-hairline text-axal-muted dark:border-gray-700"><RefreshCw size={16} aria-hidden="true" /></button>
        </>
      )}
    </>
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-8 pb-24 sm:px-6 lg:pb-10" data-testid="admin-lab">
      <AdminPageHeader
        crumb={{ label: 'Programs', to: PROGRAMS_PATH, current: tab === 'overview' ? LAB_TITLE : `${LAB_TITLE} › ${current.label}` }}
        title={LAB_TITLE}
        pills={[
          { label: 'Live', tone: 'live' },
          { label: 'HQ-held', tone: 'held', title: 'No subsidiary studio is deployed yet, so the Lab runs on the accounts HQ holds directly.' },
        ]}
        actions={actions}
        line={PAGE_LINE}
        facts={FACTS}
        scope
        notice={{ text: notice.text, onDismiss: notice.dismiss }}
        tabs={tabs}
        data-testid="lab-header"
      />
      {tab === 'overview'
        ? <Overview reads={reads} reload={reload} />
        : SECTIONS[tab].map((s) => <AdminSpinoutLab key={s} section={s} onImpersonate={onImpersonate} />)}
    </div>
  );
}
