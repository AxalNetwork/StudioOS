import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { adminCircles, adminEvents, adminJobs, adminNetworkProfiles } from '../../../lib/api';
import { communityApi } from '../../../lib/api/community';
import { reportError } from '../../../lib/log';
import {
  AdminPageHeader, Bar100, Chart, ChartTable, Columns, HBars, Legend, RailFrame, StackBars, WorkerRail,
} from '../../../ui';
import { usePhoneWidth } from '../../../ui/phone/usePhoneWidth.js';
import { glancesFromStudioGlance, loadStudioGlance } from '../adminStudioOverview';
import {
  AS_ENTERED_TIP, EMPTY_LINE, MOVED_KEY, MOVED_NOTICE, NOT_RECORDED, OVERDUE_HOURS, PAGE_LINE, PAGE_UNREADABLE,
  PERIODS, RECENT_ROWS, SCOPE_LABEL, SCOPE_TITLE,
  asOfLabel, buildActivity, buildCircles, buildConsoles, buildEventsFunnel, buildJobs, buildNeeds, buildNextUp, buildTiles,
  buildWellbeing, buildWho, isEmptyCommunity, pageFailed, readAllPages, searchWithWeeks, weeksFrom,
} from './communityModel';
import { ACTIVITY_KINDS, activityPage, openFrom, searchWith } from './lightboxModel';
import ActivityLightbox from './ActivityLightbox';
import CirclesLightbox from './CirclesLightbox';
import EventsLightbox from './EventsLightbox';
import JobsLightbox from './JobsLightbox';

/**
 * D930 (#2367) — Admin › Community at /admin/community, built to the owner's
 * "Community overview" canvas (CM1–CM13). /admin/held/community redirects
 * here through `HeldCommunityRedirect` (CM13's notice).
 *
 * D930 drew the shell and the blocks whose reads existed. D933 (#2717)
 * draws the rest on D931's Community read and D932's activity read: the
 * period control (`?weeks=4|12|52`, 12 by default), every tile and delta,
 * the weekly chart and its table, the funnel and events by type, who takes
 * part, wellbeing, the waits in Needs a decision, and Recent activity.
 *
 * EACH READ ANSWERS ALONE. A failed read costs only the blocks it feeds and
 * says so; Try again reads everything again. When every read fails, the banner
 * says nothing here is a zero, and the consoles strip still opens every console
 * (CM10). Nothing on this page names a member, and nothing is decided here:
 * Review opens the console that decides.
 *
 * D934 (#2718): the four lightboxes, CM3–CM6. `?open=events|jobs|circles|
 * activity` opens one, so a link can; Esc or Close takes it off the address,
 * and focus goes back to the opener. Below 1024px a lightbox is the page.
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

const BOXES = { events: EventsLightbox, jobs: JobsLightbox, circles: CirclesLightbox, activity: ActivityLightbox };

/** A card's lightbox opener. */
function Opener({ box, onOpen, children }) {
  return <button type="button" className={`${LINK} self-start`} onClick={() => onOpen(box)} data-testid={`community-open-${box}`}>{children}</button>;
}

const idle = { status: 'loading', data: null };
const PAGE = 200;

/**
 * The page's six reads. Each sets its own state, so a slow or failed read
 * holds back only its blocks. `reload()` makes them all again.
 */
function useCommunityReads(weeks) {
  const [reads, setReads] = useState({ glance: idle, events: idle, analytics: idle, jobs: idle, circles: idle, roster: idle, overview: idle });
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

  // D931's Community read: the period figures. A new period reads it alone again.
  useEffect(() => {
    let live = true;
    setReads((r) => ({ ...r, overview: idle }));
    communityApi.overview({ weeks }).then(
      (data) => {
        if (!live) return;
        if (!data || !data.blocks || Number(data.weeks) !== weeks) {
          reportError('admin-community:overview', new Error('The Community read answered another shape or period'));
          setReads((r) => ({ ...r, overview: { status: 'error', data: null } }));
          return;
        }
        setReads((r) => ({ ...r, overview: { status: 'ready', data } }));
        setAsOf(Date.now());
      },
      (e) => { reportError('admin-community:overview', e); if (live) setReads((r) => ({ ...r, overview: { status: 'error', data: null } })); },
    );
    return () => { live = false; };
  }, [tick, weeks]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { reads, asOf, reload, tick };
}

function Skeleton() {
  return <span className="block h-2.5 w-[70%] rounded-full bg-axal-hairline dark:bg-gray-700" />;
}

/** A figure no store records, in a sentence. Never a zero. */
function Unrecorded({ reason }) {
  return <><span className={TAG}>Not recorded</span><span className={SUB}>{reason}</span></>;
}

/** The amber dot past 72 hours (D915). */
function OverdueDot({ label = `Overdue: waiting more than ${OVERDUE_HOURS} hours`, testId }) {
  return <span role="img" aria-label={label} title={label} className="inline-block h-2 w-2 flex-none rounded-full bg-[#f59e0b]" data-testid={testId} />;
}

/** A part of a card in its state: Reading…, the reason it could not be read, or not recorded. */
function PartState({ part, onRetry }) {
  if (part.state === 'loading') return <span className="font-mono text-[12px] text-axal-muted">Reading…</span>;
  if (part.state === 'unreadable') return <Failed reason={part.reason} onRetry={onRetry} />;
  if (part.state === 'unrecorded') return <Unrecorded reason={part.reason} />;
  return null;
}

/** "View as chart" / "View as table", for the chart beside it. */
function TableToggle({ table, onToggle, testId }) {
  return <button type="button" className={LINK} aria-pressed={table} onClick={onToggle} data-testid={testId}>{table ? 'View as chart' : 'View as table'}</button>;
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
          <span className="flex items-center gap-2">
            <span className={`${MONO} text-[26px] font-medium tracking-[-.01em] text-axal-ink dark:text-gray-100`}>{t.value}</span>
            {t.overdue ? <OverdueDot label={`Something has waited more than ${OVERDUE_HOURS} hours`} testId={`community-tile-${t.key}-overdue`} /> : null}
          </span>
          {t.sub ? <span className={`${SUB} ${MONO}`}>{t.sub}</span> : null}
          {t.note ? <span className={SUB}>{t.note}</span> : null}
        </>
      )}
      {children}
      {t.state === 'unrecorded' && <Unrecorded reason={t.reason} />}
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
      {state === 'unrecorded' && <Unrecorded reason={reason} />}
      {state === 'ready' && children ? children() : null}
      {foot}
    </section>
  );
}

/** The funnel (Registered → Confirmed → Attended), waitlisted beside it, and events by type with the empty types behind Show all. */
function FunnelParts({ ev, weeks, onRetry }) {
  const [all, setAll] = useState(false);
  const f = ev.funnel;
  const bt = ev.byType;
  return (<>
    <span className={EYE}>{`Funnel · events that ended in these ${weeks} weeks`}</span>
    {f.state !== 'ready' ? <PartState part={f} onRetry={onRetry} /> : (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start" data-testid="community-funnel">
        <ol className="m-0 flex min-w-0 flex-1 list-none flex-col gap-1.5 p-0"
          aria-label={`Funnel: registered ${f.steps[0].value}, confirmed not counted on its own, attended ${f.steps[2].value}.`}>
          {f.steps.map((st) => (
            <li key={st.key} className="grid grid-cols-[92px_minmax(0,1fr)_auto] items-center gap-2.5 text-[12.5px]" data-testid={`community-funnel-${st.key}`}>
              <span className="font-semibold text-axal-ink dark:text-gray-100">{st.label}</span>
              {st.value === null ? <span className={SUB}>{st.note}</span> : (
                <span className="block h-2 w-full overflow-hidden rounded-full bg-axal-hairline dark:bg-gray-700" aria-hidden="true">
                  <span className="block h-full rounded-full bg-axal-violet dark:bg-[#a78bfa]" style={{ width: `${st.share}%` }} />
                </span>
              )}
              <span className={`${MONO} text-axal-ink dark:text-gray-100`}>{st.value === null ? 'Not recorded' : `${st.value.toLocaleString('en-US')}${st.key === 'attended' ? ` · ${st.share}%` : ''}`}</span>
            </li>
          ))}
        </ol>
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-axal-hairline px-3 py-2 dark:border-gray-700" data-testid="community-waitlisted">
          <span className={EYE}>Waitlisted</span>
          {ev.waitlisted.state === 'ready' ? (<>
            <span className={`${MONO} text-[17px] font-medium text-axal-ink dark:text-gray-100`}>{ev.waitlisted.value.toLocaleString('en-US')}</span>
            <span className={SUB}>{`on ${ev.waitlisted.events} upcoming events · not a step`}</span>
          </>) : <PartState part={ev.waitlisted} onRetry={onRetry} />}
        </div>
      </div>
    )}
    {f.state === 'ready' && !f.events ? <span className={SUB}>{`No event ended in these ${weeks} weeks.`}</span> : null}
    <span className={EYE}>{`Events by type · starting in these ${weeks} weeks`}</span>
    {bt.state !== 'ready' ? <PartState part={bt} onRetry={onRetry} /> : (<>
      {bt.shown.length ? (
        <div role="img" aria-label={`Events by type: ${bt.shown.map((r) => `${r.label} ${r.value}`).join(', ')}.`} data-testid="community-by-type">
          <HBars rows={(all ? [...bt.shown, ...bt.none] : bt.shown).map((r) => ({ label: r.label, value: r.value }))} />
        </div>
      ) : <span className={SUB}>{`No published or waiting event starts in these ${weeks} weeks.`}</span>}
      {bt.none.length ? (
        <button type="button" className={`${LINK} self-start`} aria-expanded={all} onClick={() => setAll((x) => !x)} data-testid="community-by-type-all">
          {all ? 'Show fewer' : `Show all · ${bt.none.length} types with none`}
        </button>
      ) : null}
    </>)}
  </>);
}

function EventsCard({ next, ev, weeks, onRetry, onOpen }) {
  return (
    <Card id="events" title="Events" state={next.state} reason={next.reason} onRetry={onRetry}
      foot={<span className="flex flex-wrap gap-4"><Opener box="events" onOpen={onOpen}>See all events</Opener><Link to="/admin/events" className={LINK}>Open events</Link></span>}>
      {() => (<>
      <FunnelParts ev={ev} weeks={weeks} onRetry={onRetry} />
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

function JobsCard({ jobs, onRetry, onOpen }) {
  const [table, setTable] = useState(false);
  const chart = jobs.state === 'ready' ? { type: 'bar100', parts: jobs.parts } : null;
  return (
    <Card id="jobs" title="Jobs" state={jobs.state} reason={jobs.reason} onRetry={onRetry}
      foot={<span className="flex flex-wrap gap-4"><Opener box="jobs" onOpen={onOpen}>See all postings</Opener><Link to="/admin/jobs" className={LINK}>Open job board</Link></span>}>
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

function CirclesCard({ circles, roster, onRetry, onOpen }) {
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
        <Opener box="circles" onOpen={onOpen}>See all circles</Opener>
        <Link to="/admin/circles" className={LINK}>Open circles</Link>
        <Link to="/admin/advisors-partners" className={LINK}>Open advisors &amp; partners</Link>
      </span>
    </section>
  );
}

function NeedsCard({ needs, onRetry }) {
  return (
    <Card id="needs" title="Needs a decision" state={needs.state} reason={needs.reason} onRetry={onRetry}
      foot={<Link to="/admin/held/approvals" className={`${LINK} self-start`}>{needs.state === 'ready' ? `${needs.total} waiting${needs.overdue ? ` · ${needs.overdue} overdue` : ''} · Open Approvals` : 'Open Approvals'}</Link>}>
      {() => (<>
      <span className={SUB}>{`Oldest first, by when each was submitted. Overdue is more than ${OVERDUE_HOURS} hours.`}</span>
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
                  <span className={`${SUB} ${MONO} flex items-center gap-1.5`} data-testid={`community-need-wait-${r.id}`}>
                    {r.overdue ? <><OverdueDot /><span className="font-bold text-axal-ink dark:text-gray-100">Overdue</span><span aria-hidden="true">·</span></> : null}
                    {r.wait}
                  </span>
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

/** CM1 row 3 and CM7: three series by week, the current week hollow, then the biggest change in one sentence. */
function ActivityCard({ activity, onRetry }) {
  const [table, setTable] = useState(false);
  return (
    <Card id="activity" title="Community activity by week" span={12} state={activity.state} reason={activity.reason} onRetry={onRetry}>
      {() => (<>
        <span className="flex items-baseline justify-between gap-2">
          <span className={SUB} data-testid="community-activity-sentence">{activity.sentence}</span>
          <TableToggle table={table} onToggle={() => setTable((x) => !x)} testId="community-activity-toggle" />
        </span>
        {activity.missing ? <span className="text-[12.5px] text-axal-destructive dark:text-red-400" data-testid="community-activity-missing">{activity.missing}</span> : null}
        {table ? (
          <div data-testid="community-activity-table"><ChartTable chart={activity.chart} caption="Community activity by week" /></div>
        ) : (<>
          <div role="img" aria-label={`Community activity by week: ${activity.chart.series.map((x) => x.label).join(', ')}. ${activity.sentence || ''}`}>
            <Chart chart={activity.chart} />
          </div>
          <Legend items={[...activity.chart.series.map((x) => ({ label: x.label, tone: x.tone, mark: x.dash ? 'dashed' : 'line' })), { label: 'This week, so far', tone: 'hollow' }]} />
        </>)}
        <span className={SUB}>The current week is not finished, so its point is hollow and its row says so far. A week with no value breaks the line.</span>
      </>)}
    </Card>
  );
}

/** Who takes part: registrations and applications stacked by profile, and the sentence. */
function WhoCard({ who, onRetry }) {
  const [table, setTable] = useState(false);
  const chart = who.state === 'ready' ? { type: 'stackbars', head: 'Profile', rows: who.rows, parts: who.parts } : null;
  return (
    <Card id="who" title="Who takes part" state={who.state} reason={who.reason} onRetry={onRetry}>
      {() => (<>
        <span className="flex items-baseline justify-between gap-2">
          <span className={SUB} data-testid="community-who-sentence">{who.sentence}</span>
          {who.rows.length ? <TableToggle table={table} onToggle={() => setTable((x) => !x)} /> : null}
        </span>
        {who.missing ? <span className="text-[12.5px] text-axal-destructive dark:text-red-400">{who.missing}</span> : null}
        {who.rows.length ? (table ? <ChartTable chart={chart} caption="Who takes part, by profile" /> : (<>
          <div role="img" aria-label={`Who takes part: ${who.rows.map((r) => `${r.label} ${r.parts.map((p) => `${p.value} ${p.label.toLowerCase()}`).join(', ')}`).join('; ')}.`} data-testid="community-who">
            <StackBars rows={who.rows} />
          </div>
          <Legend items={who.parts.map((p) => ({ label: p.label, tone: p.tone }))} />
        </>)) : null}
        {who.gone ? <span className={SUB}>{who.gone}</span> : null}
      </>)}
    </Card>
  );
}

/** The Wellbeing card: experts by state, bookings by week, the check-in band. No mood or stress figure. */
function WellbeingCard({ wb, onRetry }) {
  return (
    <section className={`${CARD} col-span-12 lg:col-span-6 flex min-w-0 flex-col gap-3 px-[18px] py-4`} data-testid="community-card-wellbeing" aria-labelledby="community-h-wellbeing">
      <h2 id="community-h-wellbeing" className={H2}>Wellbeing</h2>
      <span className={EYE}>{wb.experts.state === 'ready' ? `Experts · ${wb.experts.total}` : 'Experts'}</span>
      {wb.experts.state !== 'ready' ? <PartState part={wb.experts} onRetry={onRetry} /> : (<>
        <div role="img" aria-label={`Wellbeing experts by state: ${wb.experts.parts.map((p) => `${p.label} ${p.value}`).join(', ')}.`} data-testid="community-experts"><Bar100 parts={wb.experts.parts} /></div>
        <Legend items={wb.experts.parts.map((p) => ({ label: `${p.label} ${p.value}`, tone: p.tone }))} />
      </>)}
      <span className={EYE}>{wb.bookings.state === 'ready' ? `Bookings by week · ${wb.bookings.window}` : 'Bookings by week'}</span>
      {wb.bookings.state !== 'ready' ? <PartState part={wb.bookings} onRetry={onRetry} /> : (
        <div role="img" aria-label={`Expert bookings by week: ${wb.bookings.rows.map((r) => `${r.label} ${r.text}${r.toDate ? ' so far' : ''}`).join(', ')}.`} data-testid="community-bookings">
          <Columns rows={wb.bookings.rows} height={150} />
        </div>
      )}
      <span className={EYE}>Check-ins</span>
      {wb.checkins.state !== 'ready' ? <PartState part={wb.checkins} onRetry={onRetry} /> : (
        <span className={wb.checkins.withheld ? SUB : `${MONO} text-[13px] font-bold text-axal-ink dark:text-gray-100`} data-testid="community-checkins">{wb.checkins.text}</span>
      )}
      <span className={SUB}>Shown as a range, counted without reading anyone’s answers. No mood or stress figure is shown here.</span>
      <Link to="/admin?tab=wellbeing" className={`${LINK} self-start`}>Open wellbeing</Link>
    </section>
  );
}

const CHIPS = [{ value: '', label: 'All' }, ...ACTIVITY_KINDS];

/** CM1 row 7: the ten newest, with the filter chips. Its own read, so a chip reads again only this card. */
function RecentCard({ refresh, onOpen }) {
  const [kind, setKind] = useState('');
  const [tick, setTick] = useState(0);
  const [read, setRead] = useState(idle);
  useEffect(() => {
    let live = true;
    setRead(idle);
    communityApi.activity({ limit: RECENT_ROWS, ...(kind ? { kind } : {}) }).then(
      (data) => { if (live) setRead({ status: 'ready', data }); },
      (e) => { reportError('admin-community:recent', e); if (live) setRead({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  }, [kind, tick, refresh]);
  const view = read.status === 'ready' ? activityPage(read.data, 1) : null;
  const state = read.status === 'loading' ? 'loading' : (read.status === 'error' || view?.state !== 'ready') ? 'unreadable' : 'ready';
  return (
    <Card id="recent" title="Recent activity" span={12} state={state} onRetry={() => setTick((t) => t + 1)}
      reason="Community activity could not be read. That is not the same as nothing happening."
      foot={<Opener box="activity" onOpen={onOpen}>See all activity</Opener>}>
      {() => (<>
        <div role="group" aria-label="Kind" className="flex flex-wrap gap-1.5" data-testid="community-recent-chips">
          {CHIPS.map((c) => (
            <button key={c.value || 'all'} type="button" aria-pressed={kind === c.value} onClick={() => setKind(c.value)}
              className={`rounded-full border px-2.5 py-1 text-[12px] font-bold ${kind === c.value ? 'border-axal-violet bg-axal-lavender text-axal-violet dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-300' : 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400'}`}
              data-testid={`community-recent-chip-${c.value || 'all'}`}>{c.label}</button>
          ))}
        </div>
        {view.partial ? <span className="text-[12.5px] text-axal-destructive dark:text-red-400" role="status">{view.partial}</span> : null}
        {view.rows.length ? (
          <ul className="m-0 flex list-none flex-col p-0" data-testid="community-recent">
            {view.rows.slice(0, RECENT_ROWS).map((r) => (
              <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-800">
                <span className="flex min-w-0 items-baseline gap-2.5">
                  <span aria-hidden="true" className="font-bold text-axal-violet dark:text-violet-300">{r.icon}</span>
                  {r.href ? <Link to={r.href} className={`${LINK} text-[13px] font-medium leading-[1.45]`}>{r.sentence}</Link> : <span className="text-[13px] font-medium leading-[1.45] text-axal-ink dark:text-gray-100">{r.sentence}</span>}
                </span>
                <span className={`${MONO} whitespace-nowrap text-[12px] text-axal-muted dark:text-gray-400`}>{r.when}</span>
              </li>
            ))}
          </ul>
        ) : <span className={SUB}>{kind ? 'Nothing of this kind has happened yet.' : 'Nothing has happened yet.'}</span>}
      </>)}
    </Card>
  );
}

/** One console door. The text is the canvas's; the figure is read, or says why not. */
function Console({ testId, name, what, figure, children }) {
  let fig;
  if (figure.state === 'loading') fig = <span className="font-mono text-[13px] text-axal-muted">Reading…</span>;
  else if (figure.state === 'unreadable') fig = <span className="text-[12.5px] font-bold text-axal-destructive dark:text-red-400">Unreadable</span>;
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
  const weeks = weeksFrom(loc.search);
  const { reads, asOf, reload, tick } = useCommunityReads(weeks);
  const moved = new URLSearchParams(loc.search).get('moved') === MOVED_KEY;
  const [now] = useState(() => Date.now());
  const phone = usePhoneWidth();
  const box = openFrom(loc.search);
  const Box = box ? BOXES[box] : null;
  // Opening pushes, so Back closes it too; closing replaces, so it is not reopened by Back.
  const openBox = useCallback((b) => {
    navigate({ pathname: loc.pathname, search: searchWith(loc.search, b), hash: loc.hash }, { replace: !b });
  }, [loc.search, loc.pathname, loc.hash, navigate]);
  const closeBox = useCallback(() => openBox(null), [openBox]);

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
  const needs = useMemo(() => buildNeeds(reads, now), [reads, now]);
  const activity = useMemo(() => buildActivity(reads), [reads]);
  const ev = useMemo(() => buildEventsFunnel(reads), [reads]);
  const who = useMemo(() => buildWho(reads), [reads]);
  const wb = useMemo(() => buildWellbeing(reads), [reads]);
  const setWeeks = useCallback((w) => {
    navigate({ pathname: loc.pathname, search: searchWithWeeks(loc.search, w), hash: loc.hash }, { replace: true });
  }, [loc.search, loc.pathname, loc.hash, navigate]);
  const doors = useMemo(() => buildConsoles(reads), [reads]);
  const failed = pageFailed(reads);
  const empty = isEmptyCommunity(reads);

  const rail = (
    <WorkerRail
      workspace="Community"
      role="admin"
      stance="What members did in Community, as counts"
      note="This rail reads HQ’s own database, the accounts HQ holds on axal.vc, and no other."
      coverage={[
        'Approvals waiting, events in the next 30 days and their seats, job postings by status, circles by type and the advisors and partners roster, from the consoles’ own reads',
        'Registrations, applications and expert bookings by week, show-up, events by type, who takes part, experts by state and the check-in band, as counts, from the Community read',
        'The ten newest community items, with no member named, from the activity read',
      ]}
      coverageNote="Each figure is read alone; one that cannot be read says so and the others still answer."
      unavailable={[
        ['Confirmed registrations on their own', 'Events count every seat taken together, so the funnel says so.'],
        ['A community figure for a branch', 'No branch is deployed, and these consoles read HQ’s own rows.'],
      ]}
      data-testid="community-rail"
    />
  );

  return (
    <RailFrame rail={rail} data-testid="admin-community">
      {Box && phone ? <Box onClose={closeBox} /> : (
      <div className="flex flex-col gap-5 pb-24 lg:pb-10" data-testid="admin-community-page">
        <AdminPageHeader
          title="Community"
          line={PAGE_LINE}
          notice={{ text: moved ? MOVED_NOTICE : null, onDismiss: dismissMoved }}
        />
        <div className="flex flex-col gap-[7px]" data-testid="community-toolbar">
          {empty && (
            <div className="flex flex-wrap items-center gap-3" data-testid="community-empty">
              <span className="text-[13.5px] text-axal-ink dark:text-gray-100">{EMPTY_LINE}</span>
              <Link to="/admin/circles" className={PRIMARY}>Create a circle</Link>
              <Link to="/admin/events" className={GHOST}>See events</Link>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
            <span title={SCOPE_TITLE} className="cursor-help rounded-full border border-axal-hairline bg-white px-3 py-1 font-mono text-[11.5px] font-medium text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="community-scope-chip">{SCOPE_LABEL}</span>
            <div role="radiogroup" aria-label="Period" className="flex gap-[3px] rounded-[9px] bg-axal-ground p-[3px] dark:bg-gray-800" data-testid="community-period"
              onKeyDown={(e) => {
                const i = PERIODS.findIndex((p) => p.weeks === weeks);
                const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                setWeeks(PERIODS[(i + step + PERIODS.length) % PERIODS.length].weeks);
              }}>
              {PERIODS.map((p) => (
                <button key={p.weeks} type="button" role="radio" aria-checked={p.weeks === weeks} tabIndex={p.weeks === weeks ? 0 : -1}
                  onClick={() => setWeeks(p.weeks)} data-testid={`community-period-${p.weeks}`}
                  className={`whitespace-nowrap rounded-[7px] px-2.5 py-1.5 text-[12px] font-bold ${p.weeks === weeks ? 'bg-white text-axal-ink shadow-sm dark:bg-gray-900 dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}>{p.label}</button>
              ))}
            </div>
            <span className="ml-auto flex items-center gap-2.5">
              <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="community-asof">{asOf ? `Updated ${asOfLabel(asOf)}` : 'Reading…'}</span>
              <button type="button" aria-label="Refresh" onClick={reload} className="grid h-8 w-8 place-items-center rounded-[9px] border border-axal-hairline text-axal-muted dark:border-gray-700"><RefreshCw size={16} aria-hidden="true" /></button>
            </span>
          </div>
          <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="community-period-line">{`Period figures cover the last ${weeks} weeks, Monday weeks in UTC, this week so far. Deltas compare with the ${weeks} weeks before.`}</p>
        </div>

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
              <ActivityCard activity={activity} onRetry={reload} />
              <EventsCard next={next} ev={ev} weeks={weeks} onRetry={reload} onOpen={openBox} />
              <WhoCard who={who} onRetry={reload} />
              <JobsCard jobs={jobs} onRetry={reload} onOpen={openBox} />
              <CirclesCard circles={circ.circles} roster={circ.roster} onRetry={reload} onOpen={openBox} />
              <WellbeingCard wb={wb} onRetry={reload} />
              <NeedsCard needs={needs} onRetry={reload} />
              <RecentCard refresh={tick} onOpen={openBox} />
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
              <Link to="/admin/advisors-partners" className={LINK}>Open advisors &amp; partners</Link>
            </Console>
            <Console testId="community-console-wellbeing" name="Wellbeing" what="Verify experts and keep the library" figure={doors.wellbeing}>
              <Link to="/admin/wellbeing" className={LINK}>Open wellbeing</Link>
            </Console>
            <Console testId="community-console-partner-invitations" name="Partner invitations" what="Bring operating partners in and keep their deals healthy" figure={{ state: 'unrecorded', text: 'Not recorded · Partner invitations have no pending queue.' }}>
              <Link to="/admin/partner-invitations" className={LINK}>Open partner invitations</Link>
            </Console>
          </ul>
        </section>
      </div>
      )}
      {Box && !phone ? <Box onClose={closeBox} /> : null}
    </RailFrame>
  );
}
