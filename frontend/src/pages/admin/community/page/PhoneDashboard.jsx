/**
 * D4820 (#4820) part 2 — the phone dashboard (CM09): its own hierarchy rather than the desktop stacked.
 * The 2 × 2 KPIs, the queue at three rows, the next event, an activity summary with View chart in place of a chart,
 * More analytics as disclosure rows, and four recent rows. Manage Community and Additional insights follow it in
 * AdminCommunity.jsx. Every figure is the desktop's own builders' output; nothing here decides anything.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { KPI_KEYS, activityEmpty, activitySummary, moreRows, needsOnPhone } from '../communityModel';
import { RecentCard } from './RecentCard';
import { ActivityChart, AttentionCard, FunnelParts, JobsCard, NetworkCard, WellbeingCard, WhoCard } from './cards';
import { CARD, Card, DomainActions, EYE, H2, LINK, MONO, PartState, SUB, TAG, Tile } from './parts';

/** CM09: four recent rows on a phone. */
export const PHONE_RECENT_ROWS = 4;

/** The next event: the first of Next up, with View details opening the events lightbox. */
function NextEvent({ next, upcoming, onRetry, onOpen }) {
  const first = next.state === 'ready' ? next.rows[0] : null;
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-4 py-4`} data-testid="community-phone-next" aria-labelledby="community-h-phone-next">
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="community-h-phone-next" className={H2}>Next event</h2>
        {upcoming?.state === 'ready' ? <span className={`${SUB} ${MONO}`}>{`${upcoming.value} upcoming · next 30 days`}</span> : null}
      </span>
      {next.state !== 'ready' ? <PartState part={next} onRetry={onRetry} /> : first ? (
        <span className="flex flex-col gap-1" data-testid="community-phone-next-row">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{first.title}</span>
            <span className={`${MONO} whitespace-nowrap text-[12px] text-axal-muted dark:text-gray-400`}>{first.day}</span>
          </span>
          {first.waiting ? <span className={TAG}>Waiting for review</span> : null}
          <span className={`${MONO} text-[12px] ${first.seats.unreadable || first.seats.missing ? 'text-axal-muted' : 'text-axal-ink dark:text-gray-100'}`}>{first.seats.text}</span>
        </span>
      ) : <span className={SUB} data-testid="community-phone-next-empty">No published or waiting event starts in the next 30 days.</span>}
      <DomainActions box={first ? 'events' : null} onOpen={onOpen}><Link to="/admin/events" className={LINK}>Manage events →</Link></DomainActions>
    </section>
  );
}

/** CM09: the activity sentence and the three totals; View chart opens the chart in place, Hide chart closes it. */
function ActivitySummary({ activity, summary, onRetry, onOpen }) {
  const [open, setOpen] = useState(false);
  const empty = activityEmpty(activity);
  return (
    <Card id="activity" title="Community activity" span={12} state={activity.state} reason={activity.reason} onRetry={onRetry}>
      {() => (<>
        {activity.insight ? <span className="text-[14px] font-semibold leading-[1.45] text-axal-ink dark:text-gray-100" data-testid="community-activity-insight">{activity.insight.text}</span> : null}
        <span className="text-[13px] leading-[1.45] text-axal-muted dark:text-gray-400" data-testid="community-activity-sentence">{activity.sentence}</span>
        {activity.missing ? <span className="text-[12.5px] text-axal-destructive dark:text-red-400" data-testid="community-activity-missing">{activity.missing}</span> : null}
        <dl className="m-0 grid grid-cols-3 gap-2" data-testid="community-phone-activity">
          {summary.map((s) => (
            <div key={s.key} className="flex min-w-0 flex-col gap-0.5 rounded-[10px] border border-axal-hairline px-2.5 py-2 dark:border-gray-700" data-testid={`community-phone-activity-${s.key}`}>
              <dt className={EYE}>{s.label}</dt>
              {s.state === 'ready' ? (<>
                <dd className={`m-0 ${MONO} text-[17px] font-medium text-axal-ink dark:text-gray-100`}>{s.value}</dd>
                {s.sub ? <dd className={`m-0 ${SUB} ${MONO}`}>{s.sub}</dd> : null}
              </>) : <dd className={`m-0 text-[12.5px] ${s.state === 'loading' ? 'font-mono text-axal-muted' : 'font-bold text-axal-destructive dark:text-red-400'}`}>{s.state === 'loading' ? 'Reading…' : 'Unreadable'}</dd>}
            </div>
          ))}
        </dl>
        {empty ? (
          <span className={SUB} data-testid="community-activity-empty">The weekly chart appears once a week has registrations, applications or bookings.</span>
        ) : (<>
          <button type="button" aria-expanded={open} aria-controls="community-phone-chart" onClick={() => setOpen((x) => !x)}
            className="inline-flex min-h-[44px] items-center justify-center rounded-[9px] border border-axal-hairline px-3.5 text-[13px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-100"
            data-testid="community-phone-view-chart">{open ? 'Hide chart' : 'View chart'}</button>
          {open ? <div id="community-phone-chart" className="flex flex-col gap-3"><ActivityChart activity={activity} onOpen={onOpen} /></div> : null}
        </>)}
      </>)}
    </Card>
  );
}

/** CM09: More analytics, one disclosure row per secondary card, each with its line while closed. */
function MoreAnalytics({ rows, render }) {
  const [open, setOpen] = useState({});
  return (
    <section className={`${CARD} flex min-w-0 flex-col px-4 pb-1 pt-3.5`} aria-labelledby="community-h-more" data-testid="community-phone-more">
      <h2 id="community-h-more" className={`${EYE} m-0 pb-1.5`}>More analytics</h2>
      {rows.map((r) => (
        <div key={r.key} className="border-t border-axal-hairline dark:border-gray-800">
          <button type="button" aria-expanded={Boolean(open[r.key])} aria-controls={`community-more-${r.key}`}
            onClick={() => setOpen((o) => ({ ...o, [r.key]: !o[r.key] }))}
            className="flex min-h-[48px] w-full items-center justify-between gap-3 py-2 text-left" data-testid={`community-more-${r.key}`}>
            <span className="flex min-w-0 flex-col">
              <span className="text-[13.5px] font-bold text-axal-ink dark:text-gray-100">{r.title}</span>
              <span className={`${SUB} ${r.state === 'unreadable' ? 'font-bold text-axal-destructive dark:text-red-400' : ''}`} data-testid={`community-more-${r.key}-line`}>{r.line}</span>
            </span>
            <span aria-hidden="true" className="text-axal-muted">{open[r.key] ? '▴' : '▾'}</span>
          </button>
          {open[r.key] ? <div id={`community-more-${r.key}`} className="flex flex-col gap-3 pb-3.5">{render(r.key)}</div> : null}
        </div>
      ))}
    </section>
  );
}

export function PhoneDashboard({ reads, fig, needs, next, activity, ev, who, jobs, circ, wb, weeks, tick, onRetry, onOpen }) {
  const summary = activitySummary(reads);
  const rows = moreRows({ ev, showUp: fig['show-up'], who, jobs, applications: fig.applications, circles: circ.circles, roster: circ.roster, wb, weeks });
  const render = (key) => {
    if (key === 'events') {
      return (<>
        <FunnelParts ev={ev} showUp={fig['show-up']} weeks={weeks} onRetry={onRetry} />
        <DomainActions box="events" onOpen={onOpen}><Link to="/admin/events" className={LINK}>Manage events →</Link></DomainActions>
      </>);
    }
    if (key === 'who') return <WhoCard who={who} onRetry={onRetry} />;
    if (key === 'jobs') return <JobsCard jobs={jobs} onRetry={onRetry} onOpen={onOpen} />;
    if (key === 'network') return <NetworkCard circles={circ.circles} roster={circ.roster} figures={fig} onRetry={onRetry} onOpen={onOpen} />;
    return <WellbeingCard wb={wb} experts={fig.experts} weeks={weeks} onRetry={onRetry} />;
  };
  return (
    <div className="flex flex-col gap-3.5" data-testid="community-phone">
      <div className="grid grid-cols-2 gap-2.5" data-testid="community-tiles">
        {KPI_KEYS.map((k) => <Tile key={k} t={fig[k]} onRetry={onRetry} />)}
      </div>
      <AttentionCard needs={needsOnPhone(needs)} onRetry={onRetry} />
      <NextEvent next={next} upcoming={fig.upcoming} onRetry={onRetry} onOpen={onOpen} />
      <ActivitySummary activity={activity} summary={summary} onRetry={onRetry} onOpen={onOpen} />
      <MoreAnalytics rows={rows} render={render} />
      <RecentCard refresh={tick} onOpen={onOpen} span={12} rows={PHONE_RECENT_ROWS} />
    </div>
  );
}

