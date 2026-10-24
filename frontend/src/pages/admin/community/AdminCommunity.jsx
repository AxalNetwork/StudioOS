import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { adminCircles, adminEvents, adminJobs, adminNetworkProfiles } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { RailFrame, WorkerRail } from '../../../ui';
import { glancesFromStudioGlance, loadStudioGlance } from '../adminStudioOverview';
import { Bar100, ChartTable, HBars, Legend } from '../insights/InsightsCharts';
import {
  AS_ENTERED_TIP, EMPTY_LINE, MOVED_KEY, MOVED_NOTICE, NOT_RECORDED, NOT_YET, PAGE_LINE, PAGE_UNREADABLE,
  PERIOD_WAITS, PERIODS, SCOPE_LABEL, SCOPE_TITLE, WAITED_UNRECORDED, WAITS,
  asOfLabel, buildCircles, buildConsoles, buildJobs, buildNeeds, buildNextUp, buildTiles,
  isEmptyCommunity, pageFailed, readAllPages,
} from './communityModel';

/**
 * D930 (#2367) — Admin › Community at /admin/community, built to the owner's
 * "Community overview" canvas (CM1–CM13). /admin/held/community redirects
 * here through `HeldCommunityRedirect` (CM13's notice).
 *
 * THE INTEGRATION, NOT THE WHOLE CANVAS. This page draws the shell and the
 * blocks whose Worker reads exist, each truthfully (D930 §3): the queue, the
 * next 30 days, Next up, the job board, circles and the roster, Needs a
 * decision, the two figures nothing records, and the consoles strip. Every
 * other block says "Not read here yet" and which part brings it (D930 §6).
 *
 * EACH READ ANSWERS ALONE. A failed read costs only the blocks it feeds and
 * says so; Try again reads everything again. When every read fails, the banner
 * says nothing here is a zero, and the consoles strip still opens every console
 * (CM10). Nothing on this page names a member, and nothing is decided here:
 * Review opens the console that decides.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const DANGER = `${BTN} self-start border border-axal-destructive-edge bg-white text-axal-destructive dark:border-red-900 dark:bg-gray-900 dark:text-red-400`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const LINK = 'text-[12px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300';
const TAG = 'self-start rounded-full border border-dashed border-axal-muted px-2 py-0.5 text-[11px] font-semibold text-axal-muted dark:text-gray-400';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';

const idle = { status: 'loading', data: null };
const PAGE = 200;

/**
 * The page's six reads. Each sets its own state, so a slow or failed read
 * holds back only its blocks. `reload()` makes them all again.
 */
function useCommunityReads() {
  const [reads, setReads] = useState({ glance: idle, events: idle, analytics: idle, jobs: idle, circles: idle, roster: idle });
  const [asOf, setAsOf] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setReads({ glance: idle, events: idle, analytics: idle, jobs: idle, circles: idle, roster: idle });
    const settle = (key, work) => work.then(
      (data) => { if (live) { setReads((r) => ({ ...r, [key]: { status: 'ready', data } })); setAsOf(Date.now()); } },
      (e) => { reportError(`admin-community:${key}`, e); if (live) setReads((r) => ({ ...r, [key]: { status: 'error', data: null } })); },
    );
    settle('glance', loadStudioGlance().then((payload) => {
      const hq = glancesFromStudioGlance(payload, null).hq;
      if (!hq) throw new Error('The glance carried no HQ block');
      return hq;
    }));
    settle('events', Promise.all(['published', 'pending_review'].map((status) => readAllPages(
      (offset) => adminEvents.list({ status, limit: PAGE, offset }), 'events',
    ))).then(([published, waiting]) => [...published, ...waiting]));
    settle('analytics', adminEvents.analytics());
    settle('jobs', readAllPages((offset) => adminJobs.list({ limit: PAGE, offset }), 'jobs'));
    settle('circles', adminCircles.list().then((a) => {
      if (!Array.isArray(a?.circles)) throw new Error('The circles were not returned');
      return a.circles;
    }));
    settle('roster', adminNetworkProfiles.list().then((a) => {
      if (!Array.isArray(a?.profiles)) throw new Error('The roster was not returned');
      // Counts only: the kind and whether the row is active. No name leaves this read.
      return a.profiles.map((p) => ({ kind: p.kind, is_active: Boolean(p.is_active) }));
    }));
    return () => { live = false; };
  }, [tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { reads, asOf, reload };
}

function Skeleton() {
  return <span className="block h-2.5 w-[70%] rounded-full bg-axal-hairline dark:bg-gray-700" />;
}

/** "Not read here yet", with the part that brings it. Never a zero. */
function NotYet({ reason }) {
  return <><span className={TAG}>{NOT_YET}</span><span className={SUB}>{reason}</span></>;
}

function Failed({ reason, onRetry }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint p-3.5 text-[13px] leading-normal text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
      <span>{reason || 'Could not be read. That is not the same as none.'}</span>
      <button type="button" className={DANGER} onClick={onRetry}>Try again</button>
    </div>
  );
}

export function Tile({ t, onRetry, children }) {
  return (
    <div className={`${CARD} flex flex-col gap-1.5 px-4 py-3.5`} data-testid={`community-tile-${t.key}`}>
      <span className={EYE}>{t.label}</span>
      {t.state === 'loading' && <><span className="font-mono text-[15px] text-axal-muted">Reading…</span><Skeleton /></>}
      {t.state === 'ready' && (
        <>
          <span className={`${MONO} text-[26px] font-medium tracking-[-.01em] text-axal-ink dark:text-gray-100`}>{t.value}</span>
          {t.sub ? <span className={`${SUB} ${MONO}`}>{t.sub}</span> : null}
          {t.note ? <span className={SUB}>{t.note}</span> : null}
        </>
      )}
      {children}
      {t.state === 'notyet' && <NotYet reason={t.reason} />}
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

/**
 * A card: title, then one body per state. `span` is the desktop column span
 * out of 12. `children` is a function, called only when the card is ready, so
 * a body never reads a block that has not answered.
 */
function Card({ id, title, span = 6, state, reason, onRetry, children, foot }) {
  const cls = { 6: 'col-span-12 lg:col-span-6', 12: 'col-span-12' }[span];
  return (
    <section className={`${CARD} ${cls} flex min-w-0 flex-col gap-3 px-[18px] py-4`} data-testid={`community-card-${id}`} aria-labelledby={`community-h-${id}`}>
      <h2 id={`community-h-${id}`} className={H2}>{title}</h2>
      {state === 'loading' && <><span className="font-mono text-[12px] text-axal-muted">Reading…</span><Skeleton /></>}
      {state === 'unreadable' && <Failed reason={reason} onRetry={onRetry} />}
      {state === 'notyet' && <NotYet reason={reason} />}
      {state === 'ready' && children ? children() : null}
      {foot}
    </section>
  );
}

/** A block of the canvas that waits for a part: drawn where the canvas puts it, and says why. */
function WaitCard({ id, title, reason, span = 6 }) {
  return <Card id={id} title={title} span={span} state="notyet" reason={reason} />;
}

function EventsCard({ next, onRetry }) {
  return (
    <Card id="events" title="Events" state={next.state} reason={next.reason} onRetry={onRetry}
      foot={<Link to="/admin/events" className={`${LINK} self-start`}>Open events</Link>}>
      {() => (<>
      <span className={EYE}>Funnel</span>
      <NotYet reason={WAITS.funnel} />
      <span className={EYE}>Events by type</span>
      <NotYet reason={WAITS.byType} />
      <span className={EYE}>Next up</span>
      {next.rows?.length ? (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0" data-testid="community-next-up">
          {next.rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.title}</span>
                <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`}>{r.day}</span>
              </span>
              {typeof r.seats.fill === 'number' ? (
                <span className="block h-1.5 w-full overflow-hidden rounded-full bg-axal-hairline dark:bg-gray-700" aria-hidden="true">
                  <span className="block h-full rounded-full bg-axal-violet dark:bg-[#a78bfa]" style={{ width: `${Math.round(r.seats.fill * 100)}%` }} />
                </span>
              ) : null}
              <span className={`${MONO} text-[12px] ${r.seats.unreadable || r.seats.missing ? 'text-axal-muted' : 'text-axal-ink dark:text-gray-100'}`}>{r.seats.text}</span>
            </li>
          ))}
        </ul>
      ) : <span className={SUB}>No published event starts in the next 30 days.</span>}
      </>)}
    </Card>
  );
}

function JobsCard({ jobs, onRetry }) {
  const [table, setTable] = useState(false);
  const chart = jobs.state === 'ready' ? { type: 'bar100', parts: jobs.parts } : null;
  return (
    <Card id="jobs" title="Jobs" state={jobs.state} reason={jobs.reason} onRetry={onRetry}
      foot={<Link to="/admin/jobs" className={`${LINK} self-start`}>Open job board</Link>}>
      {() => (<>
      <span className="flex items-baseline justify-between gap-2">
        <span className={EYE}>{`Postings by status · ${jobs.total}`}</span>
        <button type="button" className={LINK} aria-pressed={table} onClick={() => setTable((x) => !x)}>{table ? 'View as chart' : 'View as table'}</button>
      </span>
      {table ? <ChartTable chart={chart} caption="Job postings by status" /> : (
        <>
          <div role="img" aria-label={`Job postings by status: ${jobs.parts.map((p) => `${p.label} ${p.value}`).join(', ')}.`}><Bar100 parts={jobs.parts} /></div>
          <Legend items={jobs.parts.map((p) => ({ label: `${p.label} ${p.value}`, tone: p.tone }))} />
        </>
      )}
      <span className={EYE}>Most applications · since posted</span>
      {jobs.most.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="community-most-applications">
          {jobs.most.map((j) => (
            <li key={j.id} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-axal-ink dark:text-gray-100">{j.title}</span>
                {j.company ? <span className={SUB}>{j.company}</span> : null}
              </span>
              <span className={`${MONO} whitespace-nowrap text-[12px] text-axal-ink dark:text-gray-100`}>{`${j.applications} applications`}</span>
            </li>
          ))}
        </ul>
      ) : <span className={SUB}>No posting has an application yet.</span>}
      </>)}
    </Card>
  );
}

function CirclesCard({ circles, roster, onRetry }) {
  return (
    <section className={`${CARD} col-span-12 lg:col-span-6 flex min-w-0 flex-col gap-3 px-[18px] py-4`} data-testid="community-card-circles" aria-labelledby="community-h-circles">
      <h2 id="community-h-circles" className={H2}>Circles and roster</h2>
      <span className={EYE}>Circles by type</span>
      {circles.state === 'loading' && <span className="font-mono text-[12px] text-axal-muted">Reading…</span>}
      {circles.state === 'unreadable' && <Failed reason={circles.reason} onRetry={onRetry} />}
      {circles.state === 'ready' && (
        <>
          {circles.byType.length ? (
            <div role="img" aria-label={`Circles by type: ${circles.byType.map((r) => `${r.label} ${r.value}`).join(', ')}.`}>
              <HBars rows={circles.byType} />
            </div>
          ) : <span className={SUB}>No circle yet.</span>}
          <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`} data-testid="community-circle-counts">
            {`${circles.published} published · ${circles.draft} draft · ${circles.featured} featured`}
          </span>
          <span className="flex flex-wrap items-baseline gap-2 text-[12.5px] text-axal-ink dark:text-gray-100" title={AS_ENTERED_TIP} data-testid="community-members-entered">
            <span className="font-bold">Members, as entered</span>
            <span className={MONO}>{circles.membersEntered}</span>
            <span className={TAG}>As entered</span>
          </span>
        </>
      )}
      <span className={EYE}>Advisors &amp; partners</span>
      {roster.state === 'loading' && <span className="font-mono text-[12px] text-axal-muted">Reading…</span>}
      {roster.state === 'unreadable' && <Failed reason={roster.reason} onRetry={onRetry} />}
      {roster.state === 'ready' && (
        <div role="img" aria-label={`Advisors and partners by kind: ${roster.rows.map((r) => `${r.label} ${r.active} active, ${r.inactive} inactive`).join('; ')}.`}>
          <HBars rows={roster.rows.map((r) => ({ label: r.label, value: r.active, text: `${r.active} active · ${r.inactive} inactive` }))} />
        </div>
      )}
      <span className="flex flex-wrap gap-4">
        <Link to="/admin/circles" className={LINK}>Open circles</Link>
        <Link to="/admin?tab=network-profiles" className={LINK}>Open advisors &amp; partners</Link>
      </span>
    </section>
  );
}

function NeedsCard({ needs, onRetry }) {
  return (
    <Card id="needs" title="Needs a decision" state={needs.state} reason={needs.reason} onRetry={onRetry}
      foot={<Link to="/admin/held/approvals" className={`${LINK} self-start`}>{needs.state === 'ready' ? `${needs.total} waiting · Open Approvals` : 'Open Approvals'}</Link>}>
      {() => (<>
      <span className={SUB}>{`Oldest first, by when each was created. ${WAITED_UNRECORDED}`}</span>
      {needs.partial ? <span className="text-[12.5px] text-axal-destructive dark:text-red-400">{needs.partial}</span> : null}
      {needs.rows?.length ? (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0" data-testid="community-needs">
          {needs.rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span className="whitespace-nowrap rounded-full border border-axal-hairline px-2 text-[11px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-100">{r.kind}</span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.title}</span>
                  {r.sub ? <span className={SUB}>{r.sub}</span> : null}
                </span>
              </span>
              {r.kind === 'Event'
                ? <Link to="/admin/events" className={`${GHOST} min-h-[32px]`}>Review</Link>
                : <Link to="/admin/jobs" className={`${GHOST} min-h-[32px]`}>Review</Link>}
            </li>
          ))}
        </ul>
      ) : <span className={SUB}>Nothing is waiting.</span>}
      <span className={SUB}>Review opens the item in its console. Nothing is approved from this page.</span>
      </>)}
    </Card>
  );
}

/** One console door. The text is the canvas's; the figure is read, or says why not. */
function Console({ testId, name, what, figure, children }) {
  let fig;
  if (figure.state === 'loading') fig = <span className="font-mono text-[13px] text-axal-muted">Reading…</span>;
  else if (figure.state === 'unreadable') fig = <span className="text-[12.5px] font-bold text-axal-destructive dark:text-red-400">Unreadable</span>;
  else if (figure.state === 'notyet') fig = <span className={TAG}>{NOT_YET}</span>;
  else fig = <span className={`${MONO} text-[15px] font-bold text-axal-ink dark:text-gray-100`}>{figure.text}</span>;
  return (
    <li className={`${CARD} flex flex-col gap-1.5 px-4 py-3.5`} data-testid={testId}>
      <span className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">{name}</span>
      {fig}
      <span className={SUB}>{what}</span>
      {children}
    </li>
  );
}

export default function AdminCommunity() {
  const loc = useLocation();
  const navigate = useNavigate();
  const { reads, asOf, reload } = useCommunityReads();
  const moved = new URLSearchParams(loc.search).get('moved') === MOVED_KEY;
  const [now] = useState(() => Date.now());

  const dismissMoved = useCallback(() => {
    const next = new URLSearchParams(loc.search);
    next.delete('moved');
    const q = next.toString();
    navigate({ pathname: loc.pathname, search: q ? `?${q}` : '', hash: loc.hash }, { replace: true });
  }, [loc.search, loc.pathname, loc.hash, navigate]);

  const tiles = useMemo(() => buildTiles(reads, now), [reads, now]);
  const next = useMemo(() => buildNextUp(reads, now), [reads, now]);
  const jobs = useMemo(() => buildJobs(reads), [reads]);
  const circ = useMemo(() => buildCircles(reads), [reads]);
  const needs = useMemo(() => buildNeeds(reads), [reads]);
  const doors = useMemo(() => buildConsoles(reads), [reads]);
  const failed = pageFailed(reads);
  const empty = isEmptyCommunity(reads);

  const rail = (
    <WorkerRail
      workspace="Community"
      role="admin"
      stance="What members did in Community, as counts"
      note="This rail reads HQ’s own database, the accounts HQ holds on axal.vc, and no other."
      coverage={['Approvals waiting, events in the next 30 days and their seats, job postings by status, circles by type and the advisors and partners roster, from the consoles’ own reads']}
      coverageNote="Each figure is read alone; one that cannot be read says so and the others still answer."
      unavailable={[
        ['Registrations, applications and bookings by week', 'They arrive with the Community read.'],
        ['A community figure for a branch', 'No branch is deployed, and these consoles read HQ’s own rows.'],
      ]}
      data-testid="community-rail"
    />
  );

  return (
    <RailFrame rail={rail} data-testid="admin-community">
      <div className="flex flex-col gap-5 pb-24 lg:pb-10" data-testid="admin-community-page">
        <header className="flex flex-col gap-[7px]">
          <h1 className="m-0 text-[24px] font-extrabold leading-tight tracking-[-.02em] text-axal-ink dark:text-gray-100">Community</h1>
          <p className="m-0 text-[13.5px] leading-normal text-axal-muted dark:text-gray-400">{PAGE_LINE}</p>
          {moved && (
            <div role="status" className="flex items-center justify-between gap-3 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3 py-2 text-[13px] text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid="community-moved">
              <span>{MOVED_NOTICE}</span>
              <button type="button" aria-label="Dismiss" className="flex h-8 w-8 items-center justify-center text-[16px] leading-none" onClick={dismissMoved}>×</button>
            </div>
          )}
          {empty && (
            <div className="flex flex-wrap items-center gap-3" data-testid="community-empty">
              <span className="text-[13.5px] text-axal-ink dark:text-gray-100">{EMPTY_LINE}</span>
              <Link to="/admin/circles" className={PRIMARY}>Create a circle</Link>
              <Link to="/admin/events" className={GHOST}>See events</Link>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
            <span title={SCOPE_TITLE} className="cursor-help rounded-full border border-axal-hairline bg-white px-3 py-1 font-mono text-[11.5px] font-medium text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="community-scope-chip">{SCOPE_LABEL}</span>
            <div role="radiogroup" aria-label="Period" aria-disabled="true" title={PERIOD_WAITS} className="flex gap-[3px] rounded-[9px] bg-axal-ground p-[3px] dark:bg-gray-800" data-testid="community-period">
              {PERIODS.map((p) => (
                <span key={p.key} role="radio" aria-checked={p.key === '12w'} aria-disabled="true"
                  className={`whitespace-nowrap rounded-[7px] px-2.5 py-1.5 text-[12px] font-bold ${p.key === '12w' ? 'bg-white text-axal-faint dark:bg-gray-900' : 'text-axal-faint'}`}>{p.label}</span>
              ))}
            </div>
            <span className="ml-auto flex items-center gap-2.5">
              <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="community-asof">{asOf ? `Updated ${asOfLabel(asOf)}` : 'Reading…'}</span>
              <button type="button" aria-label="Refresh" onClick={reload} className="grid h-8 w-8 place-items-center rounded-[9px] border border-axal-hairline text-axal-muted dark:border-gray-700"><RefreshCw size={16} aria-hidden="true" /></button>
            </span>
          </div>
          <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400">{PERIOD_WAITS}</p>
        </header>

        {failed && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint px-3.5 py-3 text-[13px] text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" data-testid="community-unreadable">
            <span>{PAGE_UNREADABLE}</span>
            <button type="button" className={DANGER} onClick={reload}>Try again</button>
          </div>
        )}

        {!failed && (
          <>
            <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="community-tiles">
              {tiles.map((t) => (t.key === 'waiting'
                ? <Tile key={t.key} t={t} onRetry={reload}><Link to="/admin/held/approvals" className={`${LINK} self-start`}>Open Approvals</Link></Tile>
                : <Tile key={t.key} t={t} onRetry={reload} />))}
            </div>
            <div className="grid grid-cols-12 gap-3.5">
              <WaitCard id="activity" title="Community activity by week" reason={WAITS.activity} span={12} />
              <EventsCard next={next} onRetry={reload} />
              <WaitCard id="who" title="Who takes part" reason={WAITS.who} />
              <JobsCard jobs={jobs} onRetry={reload} />
              <CirclesCard circles={circ.circles} roster={circ.roster} onRetry={reload} />
              <WaitCard id="wellbeing" title="Wellbeing" reason={WAITS.wellbeing} />
              <NeedsCard needs={needs} onRetry={reload} />
              <WaitCard id="recent" title="Recent activity" reason={WAITS.recent} span={12} />
              {NOT_RECORDED.map((n) => (
                <section key={n.key} className="col-span-12 flex flex-col gap-2 rounded-[12px] border border-dashed border-axal-hairline px-[18px] py-4 dark:border-gray-700 lg:col-span-6" data-testid={`community-unrecorded-${n.key}`}>
                  <span className="flex items-baseline justify-between gap-2">
                    <h2 className={H2}>{n.title}</h2>
                    <span className={EYE}>Not recorded</span>
                  </span>
                  <span className={SUB}>{n.reason}</span>
                </section>
              ))}
            </div>
          </>
        )}

        <section aria-labelledby="community-h-consoles" className="flex flex-col gap-2.5">
          <h2 id="community-h-consoles" className={H2}>Consoles</h2>
          <ul className="m-0 grid list-none grid-cols-1 gap-3.5 p-0 sm:grid-cols-2 lg:grid-cols-3" data-testid="community-consoles">
            <Console testId="community-console-events" name="Events" what="Review, publish and run events" figure={doors.events}>
              <Link to="/admin/events" className={LINK}>Open events</Link>
            </Console>
            <Console testId="community-console-jobs" name="Job board" what="Approve or reject postings members write" figure={doors.jobs}>
              <Link to="/admin/jobs" className={LINK}>Open job board</Link>
            </Console>
            <Console testId="community-console-circles" name="Circles" what="Create, publish and feature circles" figure={doors.circles}>
              <Link to="/admin/circles" className={LINK}>Open circles</Link>
            </Console>
            <Console testId="community-console-roster" name="Advisors & Partners" what="The roster shown on decks and pages" figure={doors.roster}>
              <Link to="/admin?tab=network-profiles" className={LINK}>Open advisors &amp; partners</Link>
            </Console>
            <Console testId="community-console-wellbeing" name="Wellbeing" what="Verify experts and keep the library" figure={doors.wellbeing}>
              <Link to="/admin?tab=wellbeing" className={LINK}>Open wellbeing</Link>
            </Console>
            <Console testId="community-console-partner-invitations" name="Partner invitations" what="Bring operating partners in and keep their deals healthy" figure={{ state: 'unrecorded', text: 'Not recorded · Partner invitations have no pending queue.' }}>
              <Link to="/admin/partner-invitations" className={LINK}>Open partner invitations</Link>
            </Console>
          </ul>
        </section>
      </div>
    </RailFrame>
  );
}
