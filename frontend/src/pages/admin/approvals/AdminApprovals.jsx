import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { AdminPageHeader, HeaderTab, HBars, useMovedNotice } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import { useHeldGlance } from '../heldFigures';
import {
  DECIDED_LINE, GROUPS, HQ_LANES, HQ_ONLY_LINE, HQ_ONLY_TITLE, LANES_LINE, LANE_FAILED, LINE, MOVED_KEY, MOVED_NOTICE,
  NOT_A_QUEUE, NOT_YET, RAIL_NOTE, TITLE,
  filtersOf, groupCounts, isHqLane, laneBars, laneViews, oldestLine, tabOf, waitingLanes, waitingTile,
} from './approvalsModel';

/**
 * D1038 (#2390) — Admin › Approvals at /admin/approvals, built to the owner's
 * "Approvals" canvas (APR1–APR16) under the shared admin header (D936).
 * /admin/held/approvals forwards here with the moved notice.
 *
 * THE INTEGRATION, NOT THE WHOLE CANVAS (D1038 §3). The Studio glance counts
 * eleven of the twenty lanes, per lane and never per item, so the Inbox lists
 * the lanes that wait, oldest first, each opening the page that decides it.
 * The items, who holds them, assignment, the weekly series and the decision
 * log say "Not read here yet" until their parts. The nine new lanes are named
 * with what they wait for, never drawn as 0.
 *
 * EVERY DOOR IS A LITERAL LINK (`LaneDoor`, `HqDoor`, the Not-a-queue card),
 * because the reachability walk (admin_route_reachability) reads navigation
 * syntax, and for LP applications, Best-Fit, Due diligence and Spin-Out
 * moderation this page is the HQ-held shell's only way in.
 */

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const LINK = 'text-[12.5px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const TH = 'px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TD = 'px-3 py-2.5 align-top text-[13px] text-axal-ink dark:text-gray-100';
const NEW_PILL = 'ml-1.5 rounded-full border border-axal-lavender-edge bg-axal-lavender px-2 py-0.5 text-[10.5px] font-bold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300';
const CHIP = 'inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-bold';

const PILL = {
  warn: 'border-amber-300 bg-amber-50 text-axal-amber-deep dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  bad: 'border-axal-destructive-edge bg-axal-destructive-tint text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
};

/** The age band's pill; under 24 hours has none (APR1). */
export function BandPill({ band }) {
  if (!band?.tone) return null;
  return <span className={`ml-1.5 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${PILL[band.tone]}`}>{band.label}</span>;
}

/** The page that decides a lane, as a literal link (see the header comment). */
export function LaneDoor({ k }) {
  switch (k) {
    case 'kyc': case 'kyb': return <Link to="/admin/kyc" className={LINK}>KYC & KYB</Link>;
    case 'partner_profiles': return <Link to="/admin/partner-profiles" className={LINK}>Partner profiles</Link>;
    case 'exploring': return <Link to="/admin/exploring" className={LINK}>Exploring board</Link>;
    case 'product_testers': return <Link to="/admin/approvals/product-testers" className={LINK}>Here</Link>;
    case 'lp': return <Link to="/admin/lp-applications" className={LINK}>LP applications</Link>;
    case 'cohort': return <Link to="/admin/programs/spinout-lab/applications" className={LINK}>Spin-Out Lab</Link>;
    case 'lab_hosts': return <Link to="/admin/programs/spinout-lab/hosts" className={LINK}>Spin-Out Lab › Hosts</Link>;
    case 'moderation': return <Link to="/admin/spinout-moderation" className={LINK}>Spin-Out moderation</Link>;
    case 'referrals': return <Link to="/admin/programs/refer-and-earn/queue" className={LINK}>Refer & Earn › Queue</Link>;
    case 'strategic_access': return <Link to="/admin/programs/refer-and-earn" className={LINK}>Refer & Earn</Link>;
    case 'perk_listings': return <Link to="/admin/programs/perks" className={LINK}>Perks</Link>;
    case 'best_fit': return <Link to="/admin/best-fit" className={LINK}>Best-Fit</Link>;
    case 'events': return <Link to="/admin/events/review" className={LINK}>Events › Review</Link>;
    case 'jobs': return <Link to="/admin/jobs" className={LINK}>Jobs</Link>;
    case 'wellbeing_experts': return <Link to="/admin/approvals/wellbeing-experts" className={LINK}>Here</Link>;
    case 'comarketing': return <Link to="/admin/approvals/co-marketing" className={LINK}>Here</Link>;
    case 'articles': return <Link to="/admin/articles" className={LINK}>Content queue</Link>;
    case 'due_diligence': return <Link to="/admin/due-diligence" className={LINK}>Due diligence</Link>;
    case 'score_flags': return <Link to="/monitoring" className={LINK}>Monitoring</Link>;
    default: return <span className={SUB}>Not recorded</span>;
  }
}

/** HQ's own queue pages (APR9), literal; a page not built yet says so. */
export function HqDoor({ lane }) {
  switch (lane.key) {
    case 'testing_programs': return <Link to="/admin/platform/product-testing" className={LINK}>Platform › Product testing</Link>;
    case 'learning': return <Link to="/learning/studio" className={LINK}>Learning studio</Link>;
    case 'tickets': return <Link to="/hq/review" className={LINK}>HQ review</Link>;
    case 'payouts': return <Link to="/admin/commissions" className={LINK}>Commissions</Link>;
    case 'ai_runs': return <Link to="/admin/platform/allowances" className={LINK}>Platform › AI allowances</Link>;
    case 'notices': return <Link to="/admin/licences" className={LINK}>Licences</Link>;
    case 'support': return <Link to="/admin/hq-support" className={LINK}>Support</Link>;
    default: return <span className={SUB}>{lane.waits}</span>;
  }
}

/** A lane's Waiting cell: a number, "Could not be read" with Try again, or not counted yet with why. */
function WaitingCell({ v, onRetry }) {
  if (v.state === 'loading') return <span aria-label="Reading" className="inline-block h-2 w-8 rounded bg-axal-hairline dark:bg-gray-700" />;
  if (v.state === 'unreadable') {
    return (
      <span className="text-axal-destructive dark:text-red-300" data-testid={`approvals-lane-failed-${v.key}`}>
        {LANE_FAILED} <button type="button" className="underline" onClick={onRetry}>Try again</button>
      </span>
    );
  }
  if (v.state === 'unrecorded') return <span title={v.reason} className={`cursor-help ${SUB}`} data-testid={`approvals-lane-unrecorded-${v.key}`}>{NOT_YET}</span>;
  return <span className={MONO} data-testid={`approvals-lane-count-${v.key}`}>{v.count.toLocaleString('en-US')}</span>;
}

function Tile({ label, testId, children, sub }) {
  return (
    <div className={`${CARD} flex min-w-0 flex-col gap-1 px-4 py-3`} data-testid={testId}>
      <span className={EYE}>{label}</span>
      <div className="text-[22px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{children}</div>
      {sub ? <span className={SUB}>{sub}</span> : null}
    </div>
  );
}

const NotYet = ({ why }) => <span title={why} className="cursor-help text-[13px] font-semibold text-axal-muted dark:text-gray-400">{NOT_YET}</span>;

function Tiles({ views }) {
  const waiting = waitingTile(views);
  const oldest = waiting.state === 'ready' ? oldestLine(views) : null;
  return (
    <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="approvals-tiles">
      <Tile label="Waiting" testId="approvals-tile-waiting" sub={waiting.state === 'ready' ? waiting.sub : waiting.state === 'unreadable' ? waiting.reason : null}>
        {waiting.state === 'loading' ? <span className="text-[13px] text-axal-muted">Reading…</span>
          : waiting.state === 'unreadable' ? <span className="text-[13px] text-axal-destructive dark:text-red-300">{LANE_FAILED}</span>
            : <span className={MONO}>{waiting.value}</span>}
      </Tile>
      <Tile label="Over 72 hours" testId="approvals-tile-over72" sub={oldest}>
        <NotYet why="The glance gives each lane's oldest age, not every item's. The inbox read counts them (part 2)." />
      </Tile>
      <Tile label="Assigned to you" testId="approvals-tile-assigned"><NotYet why="Assignment on HQ is part 2." /></Tile>
      <Tile label="Decided this week" testId="approvals-tile-decided"><NotYet why="The decision log is part 6." /></Tile>
    </div>
  );
}

/** The Inbox (APR1, APR11, APR13, APR14). */
function Inbox({ views, glance, superAdmin }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const f = filtersOf(loc.search);
  const setParam = (k, v) => {
    const p = new URLSearchParams(loc.search);
    if (v) p.set(k, v); else p.delete(k);
    const s = p.toString();
    navigate({ pathname: loc.pathname, search: s ? `?${s}` : '' }, { replace: true });
  };
  if (f.lane && isHqLane(f.lane) && !superAdmin) {
    return (
      <div className={`${CARD} flex flex-col items-start gap-2 px-5 py-5`} data-testid="approvals-hq-only">
        <h2 className={H2}>{HQ_ONLY_TITLE}</h2>
        <p className={`m-0 ${SUB}`}>{HQ_ONLY_LINE}</p>
        <button type="button" className={LINK} onClick={() => setParam('lane', null)}>Show my inbox</button>
      </div>
    );
  }
  const counts = groupCounts(views);
  const rows = waitingLanes(views, { group: f.group, q: f.q });
  const bars = laneBars(views);
  const settled = views.every((v) => v.state !== 'loading');
  const allFailed = settled && views.filter((v) => v.glance).every((v) => v.state === 'unreadable');
  const failed = views.filter((v) => v.glance && v.state === 'unreadable');
  const n = (k) => (counts[k] === null ? '—' : counts[k].toLocaleString('en-US'));
  return (
    <div className="flex flex-col gap-5">
      <Tiles views={views} />
      {allFailed ? (
        <div className={`${CARD} flex flex-col items-start gap-2 px-5 py-5`} role="alert" data-testid="approvals-failed">
          <h2 className={H2}>We could not load Approvals.</h2>
          <p className={`m-0 ${SUB}`}>The rest of the admin still works. Try again in a moment.</p>
          <button type="button" className={LINK} onClick={glance.reload}>Try again</button>
        </div>
      ) : (
        <>
          <div className="grid gap-3.5 lg:grid-cols-2">
            <section className={`${CARD} flex flex-col gap-2 px-4 py-3`} data-testid="approvals-chart-lanes">
              <h2 className={H2}>Waiting by lane</h2>
              {bars.length ? <HBars rows={bars} testIdPrefix="approvals-bar" /> : <p className={`m-0 ${SUB}`}>{settled ? 'No counted lane has anything waiting.' : 'Reading…'}</p>}
              <p className={`m-0 ${SUB}`}>Each bar is a lane’s count, coloured by its oldest item’s band. The split by age needs each item’s age (part 2).</p>
            </section>
            <section className={`${CARD} flex flex-col gap-2 px-4 py-3`} data-testid="approvals-chart-weeks">
              <h2 className={H2}>Arrived and decided, last 8 weeks</h2>
              <p className={`m-0 ${SUB}`}>{NOT_YET}: the weekly series is part 6.</p>
            </section>
          </div>

          <div className="flex flex-col gap-2.5" data-testid="approvals-filters">
            <div className="flex flex-wrap gap-[7px]" role="group" aria-label="Group">
              <button type="button" aria-pressed={!f.group} className={`${CHIP} ${!f.group ? 'border-axal-violet bg-axal-lavender text-axal-ink' : 'border-axal-hairline text-axal-muted'}`} onClick={() => setParam('group', null)}>All <span className={MONO}>{n('all')}</span></button>
              {GROUPS.map((g) => (
                <button key={g.key} type="button" aria-pressed={f.group === g.key} data-testid={`approvals-group-${g.key}`}
                  className={`${CHIP} ${f.group === g.key ? 'border-axal-violet bg-axal-lavender text-axal-ink' : 'border-axal-hairline text-axal-muted'}`}
                  onClick={() => setParam('group', g.key)}>{g.label} <span className={MONO}>{n(g.key)}</span></button>
              ))}
            </div>
            <label className="flex max-w-[360px] flex-col gap-1">
              <span className="sr-only">Search lanes</span>
              <input type="search" value={f.q} onChange={(e) => setParam('q', e.target.value)} placeholder="Search lanes"
                className="min-h-[40px] rounded-[7px] border border-axal-hairline bg-white px-3 text-[13px] dark:border-gray-700 dark:bg-gray-900" data-testid="approvals-search" />
            </label>
          </div>

          <div className="grid gap-3.5 lg:grid-cols-[1fr_280px]">
            <section className={`${CARD} overflow-x-auto`} data-testid="approvals-inbox">
              {failed.length ? (
                <p className="m-0 border-b border-axal-hairline px-3 py-2 text-[12.5px] text-axal-destructive dark:border-gray-700 dark:text-red-300" data-testid="approvals-partial">
                  {failed.map((v) => v.label).join(', ')} could not be read, so {failed.length === 1 ? 'its items are' : 'their items are'} missing below.
                </p>
              ) : null}
              <p className={`m-0 border-b border-axal-hairline px-3 py-2 dark:border-gray-700 ${SUB}`}>
                One row per lane that waits, oldest first. Each item, who sent it and who holds it are {NOT_YET.toLowerCase()}: the inbox read lists them (part 2).
              </p>
              {rows.length ? (
                <table className="w-full min-w-[640px]">
                  <thead><tr className="border-b border-axal-hairline dark:border-gray-700"><th className={TH}>Oldest</th><th className={TH}>Lane</th><th className={TH}>Waiting</th><th className={TH}>Decided on</th></tr></thead>
                  <tbody>
                    {rows.map((v) => (
                      <tr key={v.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`approvals-row-${v.key}`}>
                        <td className={TD}><span className={MONO}>{v.age || 'Age not recorded'}</span><BandPill band={v.band} /></td>
                        <td className={TD}>{v.label}<div className={SUB}>{GROUPS.find((g) => g.key === v.group)?.label}</div></td>
                        <td className={TD}><span className={MONO}>{v.count.toLocaleString('en-US')}</span></td>
                        <td className={TD}><LaneDoor k={v.key} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : settled ? (
                <div className="flex flex-col items-start gap-1.5 px-4 py-5" data-testid="approvals-empty">
                  <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{f.group || f.q ? 'No counted lane matches.' : 'Nothing counted is waiting on you.'}</span>
                  <span className={SUB}>New items arrive here as members apply, submit and ask. The lanes not counted yet are listed on Lanes.</span>
                  <Link to="/admin/approvals/lanes" className={LINK}>See every lane</Link>
                </div>
              ) : <p className={`m-0 px-4 py-5 ${SUB}`}>Reading…</p>}
            </section>
            <aside className={`${CARD} flex flex-col gap-1.5 self-start px-4 py-3`} data-testid="approvals-waiting-on-hq">
              <h2 className={H2}>Waiting on HQ</h2>
              <p className={`m-0 ${SUB}`}>{NOT_YET}: what this studio asked HQ (part 7). Your requests stay on</p>
              <Link to="/admin/my-licence/requests" className={LINK}>Licences › Requests</Link>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function LaneTable({ group, views, onRetry }) {
  const rows = views.filter((v) => v.group === group.key);
  return (
    <section className={`${CARD} overflow-x-auto`} data-testid={`approvals-lanes-${group.key}`}>
      <h2 className={`${H2} px-3 pt-3`}>{group.label}</h2>
      <table className="w-full min-w-[640px]">
        <thead><tr className="border-b border-axal-hairline dark:border-gray-700"><th className={TH}>Lane</th><th className={TH}>Waiting</th><th className={TH}>Oldest</th><th className={TH}>Decided on</th><th className={TH}>Who decides</th></tr></thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`approvals-lane-${v.key}`}>
              <td className={TD}>{v.label}{v.isNew ? <span className={NEW_PILL}>New</span> : null}{v.note ? <div className={SUB}>{v.note}</div> : null}</td>
              <td className={TD}><WaitingCell v={v} onRetry={onRetry} /></td>
              <td className={TD}>{v.state === 'ready' && v.count > 0 ? <><span className={MONO}>{v.age || 'Age not recorded'}</span><BandPill band={v.band} /></> : <span className={SUB}>—</span>}</td>
              <td className={TD}><LaneDoor k={v.key} /></td>
              <td className={TD}>Admin and Super Admin</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Lanes (APR2), plus HQ decides for a Super Admin (APR9) and the Not-a-queue card. */
function Lanes({ views, glance, superAdmin }) {
  return (
    <div className="flex flex-col gap-3.5">
      <p className={`m-0 ${SUB}`}>{LANES_LINE} Who each lane notifies is {NOT_YET.toLowerCase()} (part 3).</p>
      {GROUPS.map((g) => <LaneTable key={g.key} group={g} views={views} onRetry={glance.reload} />)}
      {superAdmin ? (
        <section className={`${CARD} overflow-x-auto`} data-testid="approvals-hq-lanes">
          <h2 className={`${H2} px-3 pt-3`}>HQ decides</h2>
          <p className={`m-0 px-3 ${SUB}`}>Only Super Admins see this group. Its counts are {NOT_YET.toLowerCase()} (part 3).</p>
          <table className="w-full min-w-[560px]">
            <thead><tr className="border-b border-axal-hairline dark:border-gray-700"><th className={TH}>Lane</th><th className={TH}>Decided on</th><th className={TH}>Who decides</th></tr></thead>
            <tbody>
              {HQ_LANES.map((l) => (
                <tr key={l.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`approvals-hq-${l.key}`}>
                  <td className={TD}>{l.label}</td><td className={TD}><HqDoor lane={l} /></td><td className={TD}>Super Admin</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      <section className={`${CARD} flex flex-col gap-2 px-4 py-3`} data-testid="approvals-not-a-queue">
        <h2 className={H2}>Not a queue</h2>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          <li className={SUB}><Link to="/admin/directory" className={LINK}>Directory</Link>: {NOT_A_QUEUE[0].reason}</li>
          <li className={SUB}><Link to="/admin/circles" className={LINK}>Circles</Link>: {NOT_A_QUEUE[1].reason}</li>
          <li className={SUB}><Link to="/admin/partner-invitations" className={LINK}>Partner invitations</Link>: {NOT_A_QUEUE[2].reason}</li>
          <li className={SUB}><Link to="/admin/programs/mentor-cohorts/people" className={LINK}>Mentor cohort access</Link>: {NOT_A_QUEUE[3].reason}</li>
          <li className={SUB}><Link to="/admin/programs/spinout-lab/formation" className={LINK}>83(b) follow-ups and formation packets</Link>: {NOT_A_QUEUE[4].reason}</li>
        </ul>
      </section>
    </div>
  );
}

/** Decided (APR10): the decision log is part 5. */
function Decided() {
  return (
    <section className={`${CARD} flex flex-col items-start gap-2 px-5 py-5`} data-testid="approvals-decided">
      <p className={`m-0 ${SUB}`}>{DECIDED_LINE}</p>
      <h2 className={H2}>{NOT_YET}</h2>
      <p className={`m-0 ${SUB}`}>No lane writes its decisions to one log yet, so nothing is drawn as decided. Each lane’s own page keeps its history until part 6.</p>
    </section>
  );
}

/** The page itself; `viewer` stands in for the signed-in account where a caller has one (tests). */
export function ApprovalsPage({ viewer = null }) {
  const loc = useLocation();
  const auth = useAuth();
  const superAdmin = isSuperAdminUser(viewer ?? auth?.user);
  const glance = useHeldGlance();
  const views = laneViews(glance);
  const tab = tabOf(loc.pathname);
  const notice = useMovedNotice({ [MOVED_KEY]: MOVED_NOTICE });
  const counted = views.filter((v) => v.glance);
  const inboxCount = counted.some((v) => v.state === 'loading') ? { kind: 'load' }
    : counted.every((v) => v.state === 'ready') ? { kind: 'num', value: counted.reduce((t, v) => t + v.count, 0).toLocaleString('en-US') }
      : { kind: 'dash', tip: 'A lane could not be read, so there is no total.' };
  const tabs = (
    <>
      <HeaderTab to="/admin/approvals" count={inboxCount} data-testid="approvals-tab-inbox">Inbox</HeaderTab>
      <HeaderTab to="/admin/approvals/lanes" count={{ kind: 'num', value: String(views.length) }} data-testid="approvals-tab-lanes">Lanes</HeaderTab>
      <HeaderTab to="/admin/approvals/decided" count={{ kind: 'dash', tip: 'The decision log is part 6.' }} data-testid="approvals-tab-decided">Decided</HeaderTab>
    </>
  );
  return (
    <div className="flex flex-col gap-5 pb-24 lg:pb-10" data-testid="admin-approvals">
      <AdminPageHeader title={TITLE} line={LINE} scope notice={{ text: notice.text, onDismiss: notice.dismiss }} tabs={tabs} data-testid="approvals-header" />
      {tab === 'inbox' ? <Inbox views={views} glance={glance} superAdmin={superAdmin} /> : null}
      {tab === 'lanes' ? <Lanes views={views} glance={glance} superAdmin={superAdmin} /> : null}
      {tab === 'decided' ? <Decided /> : null}
    </div>
  );
}

/** The page inside its rail frame (D774), the frame the page's outermost element. */
export default function AdminApprovals() {
  return (
    <AdminBoardFrame workspace="Approvals" note={RAIL_NOTE} data-testid="admin-board-approvals">
      <ApprovalsPage />
    </AdminBoardFrame>
  );
}
