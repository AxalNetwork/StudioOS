import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Eye, RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { adminLabApi } from '../../../lib/api/adminLab.js';
import { reportError } from '../../../lib/log';
import { AdminPageHeader, HeaderTab, useMovedNotice } from '../../../ui';
import { glancesFromStudioGlance, loadStudioGlance } from '../adminStudioOverview';
import AdminSpinoutLab from '../AdminSpinoutLab';
import LabFormation from './LabFormation';
import LabGraduation from './LabGraduation';
import LabApplications from './LabApplications';
import LabHosts from './LabHosts';
import LabHowItRuns from './LabHowItRuns';
import LabSettings from './LabSettings';
import LabActivity from './LabActivity';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import LabParticipants from './LabParticipants';
import { participantsCount } from './participantsModel';
import LabCohorts from './LabCohorts';
import { ByCohortBlock, CalendarBlock, FunnelBlock, HeatBlock, PerWeekBlock } from './LabOverviewBlocks';
import { buildByCohort, buildFunnel, buildHeat, buildPerWeek, buildTimeline, cohortOf } from './labOverviewModel';
import {
  FACTS, LAB_PATH, LAB_TITLE, MOVED_NOTICES, PAGE_LINE, PROGRAMS_PATH, TABS,
  buildNeeds, buildTiles, pageFailed, tabOf,
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
 * truthfully. D948 (#2753) draws Applications: SL2's queue, SL3's drawer at
 * `/applications/:id` and SL4's dialogs (`LabApplications.jsx`); Hosts, Formation and
 * Graduation are drawn to the canvas by D970 (#2755). D947 (#2752) draws the
 * Overview's calendar, charts and funnel from part 2's read (D944), and the
 * Cohorts tab: SL5 at /cohorts and one cohort, SL6, at /cohorts/:ym
 * (`LabCohorts.jsx`). D949 (#2754) draws Participants and one founder at
 * `/participants/:uid` (`LabParticipants.jsx`), with its three decision dialogs.
 * Applications decides every application with a reason, in a dialog; the old
 * list that accepted with none is not reached any more.
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
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';

const idle = { status: 'loading', data: null };

/**
 * The page's reads. The header's queue, hosts and participants counts are read
 * on every tab; Overview reads five more. Each settles alone, so a slow or
 * failed read holds back only its own blocks.
 */
function useLabReads(overview) {
  const keys = useMemo(() => (overview
    ? ['glance', 'hosts', 'people', 'applications', 'timeline', 'review', 'certificates', 'overview']
    : ['glance', 'hosts', 'people']), [overview]);
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
      // D949: the Participants tab's count, everyone D946's read lists (one row asked for).
      people: () => adminLabApi.participants({ limit: 1 }),
      applications: () => api.adminCohortApplications(),
      timeline: () => api.adminCohortTimeline(),
      review: () => api.adminCohortReview(),
      certificates: () => api.spinoutCertificateList(),
      // D947: part 2's read (D944) feeds the calendar, the four charts and the funnel.
      overview: () => adminLabApi.overview(),
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
  out.participants = participantsCount(reads.people);
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
  const [chosen, setChosen] = useState(null);
  const tiles = useMemo(() => buildTiles(reads, now), [reads, now]);
  const needs = useMemo(() => buildNeeds(reads), [reads]);
  const tl = useMemo(() => buildTimeline(reads.overview, now, 'overview'), [reads.overview, now]);
  const byCohort = useMemo(() => buildByCohort(reads.overview, reads.applications, now), [reads.overview, reads.applications, now]);
  const heat = useMemo(() => buildHeat(reads.overview, now), [reads.overview, now]);
  const funnel = useMemo(() => buildFunnel(reads.overview, chosen), [reads.overview, chosen]);
  const perWeek = useMemo(() => buildPerWeek(reads.overview), [reads.overview]);
  if (pageFailed(reads) && reads.overview?.status === 'error') {
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
        <CalendarBlock tl={tl} onRetry={reload} right={<Link to={`${LAB_PATH}/cohorts`} className={LINK}>Open Cohorts</Link>} />
        <ByCohortBlock block={byCohort} onRetry={reload} />
        <HeatBlock block={heat} onRetry={reload} />
        <FunnelBlock block={funnel} onRetry={reload} onChoose={setChosen} />
        <NeedsCard needs={needs} />
        <PerWeekBlock block={perWeek} onRetry={reload} />
      </div>
    </div>
  );
}

/**
 * Which console section each tab still asks `AdminSpinoutLab` for. D948: under
 * Applications' queue, the old Cycles console keeps only Settings' minimum and
 * places and the two logs. D971's Settings and Activity now repeat them;
 * retiring this mount is its own change (D948 §5).
 */
const SECTIONS = {
  applications: ['cycles'],
};

/** D970: the tabs drawn to the canvas (SL9–SL11), each its own file. */
const DESKS = { hosts: LabHosts, formation: LabFormation, graduation: LabGraduation, 'how-it-runs': LabHowItRuns, settings: LabSettings, activity: LabActivity };

export default function AdminLab({ onImpersonate }) {
  const { user } = useAuth();
  const superAdmin = isSuperAdminUser(user);
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
      <HeaderTab to="/admin/programs/spinout-lab/how-it-runs" data-testid="lab-tab-how-it-runs">How it runs</HeaderTab>
      <HeaderTab to="/admin/programs/spinout-lab/settings" data-testid="lab-tab-settings">Settings</HeaderTab>
      <HeaderTab to="/admin/programs/spinout-lab/activity" data-testid="lab-tab-activity">Activity</HeaderTab>
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
      {tab === 'overview' ? <Overview reads={reads} reload={reload} /> : null}
      {DESKS[tab] ? React.createElement(DESKS[tab], { superAdmin }) : null}
      {tab === 'applications' ? <LabApplications /> : null}
      {tab === 'participants' ? <LabParticipants onImpersonate={onImpersonate} /> : null}
      {tab === 'cohorts' ? <LabCohorts ym={cohortOf(loc.pathname)} /> : null}
      {SECTIONS[tab] ? SECTIONS[tab].map((s) => <AdminSpinoutLab key={s} section={s} onImpersonate={onImpersonate} />) : null}
    </div>
  );
}
