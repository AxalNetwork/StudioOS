/**
 * #4717 package 6 — The Community page's cards: Needs your attention, activity, events (Next up, the funnel, show-up, events by type), who takes part, jobs, Network (circles and the roster) and wellbeing.
 * Split out of AdminCommunity.jsx; nothing here decides anything. D4820: every card collapses to one line when it has nothing to draw, and ends in its domain's View details and Manage … →.
 */
import React, { useState } from 'react';
import { Bar100, Chart, ChartTable, Columns, HBars, Legend, StackBars } from '../../../../ui';
import { AS_ENTERED_TIP, OVERDUE_HOURS, QUEUE_CLEAR, activityEmpty, bookingsEmpty, circlesEmpty, eventsEmpty, expertsEmpty, funnelEmpty, jobsEmpty, rosterEmpty } from '../communityModel';
import { CARD, Card, DomainActions, EYE, H2, LINK, MONO, OverdueDot, PartState, SUB, TAG, TableToggle, Tile } from './parts';
import { Link } from 'react-router-dom';

/** The funnel (Registered → Confirmed → Attended), show-up and waitlisted beside it, and events by type. D4820: no zero funnel, and the event types with no event are not listed. */
export function FunnelParts({ ev, showUp, weeks, onRetry }) {
  const f = ev.funnel;
  const bt = ev.byType;
  const wl = ev.waitlisted;
  const empty = funnelEmpty(f);
  return (<>
    <span className={EYE}>{`Participation · events that ended in these ${weeks} weeks`}</span>
    {f.state !== 'ready' ? <PartState part={f} onRetry={onRetry} /> : empty ? (
      // D4820 CM04b: nothing ended, or nothing ended with a seat taken: one line, never a zero funnel.
      <span className={SUB} data-testid="community-funnel-empty">{f.events ? showUp?.sub : `No event ended in these ${weeks} weeks. Participation and show-up appear after an event ends.`}</span>
    ) : (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start" data-testid="community-funnel">
        <ol className="m-0 flex min-w-0 flex-1 list-none flex-col gap-1.5 p-0"
          aria-label={`Funnel: registered ${f.steps[0].value}, confirmed ${f.steps[1].value ?? 'not in this read'}, attended ${f.steps[2].value}.`}>
          {f.steps.map((st) => (
            <li key={st.key} className="grid grid-cols-[92px_minmax(0,1fr)_auto] items-center gap-2.5 text-[12.5px]" data-testid={`community-funnel-${st.key}`}>
              <span className="font-semibold text-axal-ink dark:text-gray-100">{st.label}</span>
              {st.value === null ? <span className={SUB}>{st.note}</span> : (
                <span className="block h-2 w-full overflow-hidden rounded-full bg-axal-hairline dark:bg-gray-700" aria-hidden="true">
                  <span className="block h-full rounded-full bg-axal-violet dark:bg-[#a78bfa]" style={{ width: `${st.share}%` }} />
                </span>
              )}
              <span className={`${MONO} text-axal-ink dark:text-gray-100`}>{st.value === null ? 'Not recorded' : `${st.value.toLocaleString('en-US')}${st.key !== 'registered' ? ` · ${st.share}%` : ''}`}</span>
            </li>
          ))}
        </ol>
        <div className="flex flex-col gap-2">
          {showUp ? <Tile t={showUp} onRetry={onRetry} figure /> : null}
          <div className="flex flex-col gap-0.5 rounded-[10px] border border-axal-hairline px-3 py-2 dark:border-gray-700" data-testid="community-waitlisted">
            <span className={EYE}>Waitlisted</span>
            {wl.state === 'ready' ? (<>
              <span className={`${MONO} text-[17px] font-medium text-axal-ink dark:text-gray-100`}>{wl.value.toLocaleString('en-US')}</span>
              <span className={SUB}>{`on ${wl.events} upcoming events · not a step`}</span>
            </>) : <PartState part={wl} onRetry={onRetry} />}
          </div>
        </div>
      </div>
    )}
    {/* With no funnel, the waitlist is one line when it has any, and its failure when it could not be read. */}
    {empty && wl.state === 'ready' && wl.value ? (
      <span className={SUB} data-testid="community-waitlisted">{`${wl.value.toLocaleString('en-US')} waitlisted on ${wl.events} upcoming events.`}</span>
    ) : empty && wl.state !== 'ready' ? <PartState part={wl} onRetry={onRetry} /> : null}
    <span className={EYE}>{`Events by type · starting in these ${weeks} weeks`}</span>
    {bt.state !== 'ready' ? <PartState part={bt} onRetry={onRetry} /> : bt.shown.length ? (
      <div role="img" aria-label={`Events by type: ${bt.shown.map((r) => `${r.label} ${r.value}`).join(', ')}.`} data-testid="community-by-type">
        <HBars rows={bt.shown.map((r) => ({ label: r.label, value: r.value }))} />
      </div>
    ) : <span className={SUB}>{`No published or waiting event starts in these ${weeks} weeks.`}</span>}
  </>);
}

function NextUp({ next, onRetry }) {
  if (next.state !== 'ready') return <PartState part={next} onRetry={onRetry} />;
  if (!next.rows?.length) return <span className={SUB}>No published or waiting event starts in the next 30 days.</span>;
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0" data-testid="community-next-up">
      {next.rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">
              {r.title}
              {/* #4717: Next up is the events Upcoming counts, so a waiting one is listed and says so. */}
              {r.waiting ? <span className={`${TAG} ml-2`} data-testid={`community-next-up-waiting-${r.id}`}>Waiting for review</span> : null}
            </span>
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
  );
}

export function EventsCard({ next, ev, showUp, weeks, onRetry, onOpen }) {
  // #4717: the card is drawn whenever the Community read answered. Next up,
  // the funnel and events by type each answer alone, so one that could not be
  // read never hides the others. D4820: with nothing in any of them, one line.
  const empty = eventsEmpty(next, ev);
  return (
    <Card id="events" title="Events" span={7} state="ready" onRetry={onRetry}
      foot={<DomainActions box="events" onOpen={onOpen}><Link to="/admin/events" className={LINK}>Manage events →</Link></DomainActions>}>
      {() => (empty ? (
        <span className={SUB} data-testid="community-events-empty">{`No published or waiting event starts in the next 30 days, and none ended in these ${weeks} weeks.`}</span>
      ) : (<>
        <span className={EYE}>Next up</span>
        <NextUp next={next} onRetry={onRetry} />
        <FunnelParts ev={ev} showUp={showUp} weeks={weeks} onRetry={onRetry} />
      </>))}
    </Card>
  );
}

export function JobsCard({ jobs, onRetry, onOpen }) {
  const [table, setTable] = useState(false);
  const chart = jobs.state === 'ready' ? { type: 'bar100', parts: jobs.parts } : null;
  const empty = jobsEmpty(jobs);
  return (
    <Card id="jobs" title="Opportunities" state={jobs.state} reason={jobs.reason} onRetry={onRetry}
      foot={<DomainActions box={empty ? null : 'jobs'} onOpen={onOpen}><Link to="/admin/jobs" className={LINK}>Manage jobs →</Link></DomainActions>}>
      {() => (empty ? <span className={SUB} data-testid="community-jobs-empty">No job postings yet.</span> : (<>
      <span className="flex items-baseline justify-between gap-2">
        <span className={EYE}>{`Postings by status · ${jobs.total}`}</span>
        <button type="button" className={LINK} aria-pressed={table} onClick={() => setTable((x) => !x)}>{table ? 'View as chart' : 'View as table'}</button>
      </span>
      {table ? <ChartTable chart={chart} caption="Job postings by status" /> : (
        <>
          <div role="img" aria-label={`Job postings by status: ${jobs.parts.map((p) => `${p.label} ${p.value}`).join(', ')}.`} data-testid="community-jobs-status"><Bar100 parts={jobs.parts} /></div>
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
                {j.company || j.daysOpen ? <span className={SUB}>{[j.company, j.daysOpen].filter(Boolean).join(' · ')}</span> : null}
              </span>
              <span className={`${MONO} whitespace-nowrap text-[12px] text-axal-ink dark:text-gray-100`}>{`${j.applications} applications`}</span>
            </li>
          ))}
        </ul>
      ) : <span className={SUB}>No posting has an application yet.</span>}
      </>))}
    </Card>
  );
}

/**
 * D4820 CM01: Network — circles and the advisors and partners roster, with the
 * two figures that left the KPI row (published circles, active on the roster).
 * Members are as entered; the roster is counted, never named.
 */
export function NetworkCard({ circles, roster, figures, onRetry, onOpen }) {
  const noCircles = circlesEmpty(circles);
  const noRoster = rosterEmpty(roster);
  return (
    <section className={`${CARD} col-span-12 lg:col-span-6 flex min-w-0 flex-col gap-3 px-[18px] py-4`} data-testid="community-card-network" aria-labelledby="community-h-network">
      <h2 id="community-h-network" className={H2}>Network</h2>
      {noCircles && noRoster ? <span className={SUB} data-testid="community-network-empty">No circles, advisors or partners have been added yet.</span> : (<>
        <span className={EYE}>Circles</span>
        {noCircles ? <span className={SUB} data-testid="community-circles-empty">No circles yet.</span> : (<>
          <Tile t={figures.circles} onRetry={onRetry} figure />
          {circles.state === 'ready' && (<>
            {circles.byType.length ? (
              <div role="img" aria-label={`Circles by type: ${circles.byType.map((r) => `${r.label} ${r.value}`).join(', ')}.`} data-testid="community-circles-by-type">
                <HBars rows={circles.byType} />
              </div>
            ) : null}
            <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`} data-testid="community-circle-counts">
              {`${circles.published} published · ${circles.draft} draft · ${circles.featured} featured`}
            </span>
            <span className="flex flex-wrap items-baseline gap-2 text-[12.5px] text-axal-ink dark:text-gray-100" title={AS_ENTERED_TIP} data-testid="community-members-entered">
              <span className="font-bold">Members, as entered</span>
              <span className={MONO}>{circles.membersEntered}</span>
              <span className={TAG}>As entered</span>
            </span>
          </>)}
        </>)}
        <span className={EYE}>Advisors &amp; partners</span>
        {noRoster ? <span className={SUB} data-testid="community-roster-empty">No advisors or partners on the roster yet.</span> : (<>
          <Tile t={figures.roster} onRetry={onRetry} figure />
          {roster.state === 'ready' && (
            <div role="img" aria-label={`Advisors and partners by kind: ${roster.rows.map((r) => `${r.label} ${r.active} active, ${r.inactive} inactive`).join('; ')}.`} data-testid="community-roster">
              <HBars rows={roster.rows.map((r) => ({ label: r.label, value: r.active, text: `${r.active} active · ${r.inactive} inactive` }))} />
            </div>
          )}
        </>)}
      </>)}
      <DomainActions box={noCircles ? null : 'circles'} onOpen={onOpen}>
        <Link to="/admin/circles" className={LINK}>Manage circles →</Link>
        <Link to="/admin/advisors-partners" className={LINK}>Manage advisors &amp; partners →</Link>
      </DomainActions>
    </section>
  );
}

/**
 * D4820 CM02 — Needs your attention, directly under the KPIs: Overdue first,
 * each row opening its item in Approvals, and one Review all. When both queues
 * were read and nothing waits it collapses to one line; a queue that could not
 * be read is never called clear.
 */
export function AttentionCard({ needs, onRetry }) {
  if (needs.state === 'ready' && needs.clear) {
    return (
      <section className={`${CARD} col-span-12 flex flex-wrap items-center justify-between gap-3 px-[18px] py-3`} data-testid="community-card-needs" aria-labelledby="community-h-needs">
        <h2 id="community-h-needs" className="sr-only">Needs your attention</h2>
        <span className="flex items-center gap-2 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="community-queue-clear">
          <span aria-hidden="true" className="text-emerald-700 dark:text-emerald-400">✓</span>{QUEUE_CLEAR}
        </span>
        <Link to="/admin/approvals" className={LINK}>Open Approvals →</Link>
      </section>
    );
  }
  return (
    <Card id="needs" title="Needs your attention" span={5} state={needs.state} reason={needs.reason} onRetry={onRetry}
      foot={<span className="flex flex-col gap-1">
        <Link to="/admin/approvals" className={`${LINK} self-start`} data-testid="community-review-all">{needs.state === 'ready' ? `Review all ${needs.total} in Approvals →` : 'Review all in Approvals →'}</Link>
        <span className={SUB}>Opens Approvals. Nothing is decided on this page.</span>
      </span>}>
      {() => (<>
      <span className={SUB} data-testid="community-needs-line">{`${needs.total} waiting · ${needs.overdue ? 'overdue first' : 'oldest first'}. Overdue is more than ${OVERDUE_HOURS} hours.`}</span>
      {needs.partial ? <span className="text-[12.5px] text-axal-destructive dark:text-red-400">{needs.partial}</span> : null}
      {needs.rows?.length ? (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0" data-testid="community-needs">
          {needs.rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span className="whitespace-nowrap rounded-full border border-axal-hairline px-2 text-[11px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-100">{r.kind}</span>
                <span className="min-w-0">
                  {r.kind === 'Event'
                    ? <Link to={`/admin/approvals/items/events-${encodeURIComponent(r.ref)}`} className={`${LINK} text-[13px] text-axal-ink dark:text-gray-100`} data-testid={`community-need-open-${r.id}`}>{r.title}</Link>
                    : <Link to={`/admin/approvals/items/jobs-${encodeURIComponent(r.ref)}`} className={`${LINK} text-[13px] text-axal-ink dark:text-gray-100`} data-testid={`community-need-open-${r.id}`}>{r.title}</Link>}
                  {r.sub ? <span className={`${SUB} block`}>{r.sub}</span> : null}
                  <span className={`${SUB} ${MONO} flex items-center gap-1.5`} data-testid={`community-need-wait-${r.id}`}>
                    {r.overdue ? <><OverdueDot /><span className="font-bold text-axal-ink dark:text-gray-100">Overdue</span><span aria-hidden="true">·</span></> : null}
                    {r.wait}
                  </span>
                </span>
              </span>
              <span aria-hidden="true" className="text-axal-muted">›</span>
            </li>
          ))}
        </ul>
      ) : <span className={SUB}>Nothing is waiting in the queue that could be read.</span>}
      {needs.more ? <span className={SUB} data-testid="community-needs-more">{`+ ${needs.more} more waiting in Approvals`}</span> : null}
      </>)}
    </Card>
  );
}

/** CM1 row 3 and CM7: three series by week, the current week hollow, then the biggest change in one sentence. D4820: no chart when no week has activity. */
export function ActivityCard({ activity, span = 7, onRetry, onOpen }) {
  const [table, setTable] = useState(false);
  const empty = activityEmpty(activity);
  return (
    <Card id="activity" title="Community activity" span={span} state={activity.state} reason={activity.reason} onRetry={onRetry}>
      {() => (<>
        <span className="flex items-baseline justify-between gap-2">
          <span className={SUB} data-testid="community-activity-sentence">{activity.sentence}</span>
          {empty ? null : <TableToggle table={table} onToggle={() => setTable((x) => !x)} testId="community-activity-toggle" />}
        </span>
        {activity.missing ? <span className="text-[12.5px] text-axal-destructive dark:text-red-400" data-testid="community-activity-missing">{activity.missing}</span> : null}
        {empty ? (
          <span className={SUB} data-testid="community-activity-empty">The weekly chart appears once a week has registrations, applications or bookings.</span>
        ) : table ? (
          <div data-testid="community-activity-table"><ChartTable chart={activity.chart} caption="Community activity by week" /></div>
        ) : (<>
          <div role="group" aria-label={`Community activity by week: ${activity.chart.series.map((x) => x.label).join(', ')}. ${activity.sentence || ''}`} data-testid="community-activity-chart">
            <Chart chart={activity.chart} onSelect={(key) => { const s = activity.chart.series.find((x) => x.key === key); if (s?.opens) onOpen(s.opens); }} />
          </div>
          <Legend items={[...activity.chart.series.map((x) => ({ label: x.label, tone: x.tone, mark: x.dash ? 'dashed' : 'line' })), { label: 'This week, so far', tone: 'hollow' }]} />
          <span className={SUB}>The current week is not finished, so its point is hollow and its row says so far. A week with no value breaks the line. A point on Event registrations opens the events.</span>
        </>)}
      </>)}
    </Card>
  );
}

/** Who takes part: registrations and applications stacked by profile, and the sentence. */
export function WhoCard({ who, onRetry }) {
  const [table, setTable] = useState(false);
  const chart = who.state === 'ready' ? { type: 'stackbars', head: 'Profile', rows: who.rows, parts: who.parts } : null;
  return (
    <Card id="who" title="Who takes part" span={5} state={who.state} reason={who.reason} onRetry={onRetry}>
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

/** The Wellbeing card: the experts figure and experts by state, bookings by week, the check-in band. No mood or stress figure. */
export function WellbeingCard({ wb, experts, weeks, onRetry }) {
  const noExperts = expertsEmpty(wb.experts);
  const noBookings = bookingsEmpty(wb.bookings);
  return (
    <section className={`${CARD} col-span-12 lg:col-span-5 flex min-w-0 flex-col gap-3 px-[18px] py-4`} data-testid="community-card-wellbeing" aria-labelledby="community-h-wellbeing">
      <h2 id="community-h-wellbeing" className={H2}>Wellbeing</h2>
      {noExperts && noBookings ? <span className={SUB} data-testid="community-wellbeing-empty">No wellbeing experts or bookings yet.</span> : (<>
        <span className={EYE}>Experts</span>
        {noExperts ? <span className={SUB} data-testid="community-experts-empty">No wellbeing experts yet.</span> : (<>
          <Tile t={experts} onRetry={onRetry} figure />
          {wb.experts.state === 'ready' ? (<>
            <div role="img" aria-label={`Wellbeing experts by state: ${wb.experts.parts.map((p) => `${p.label} ${p.value}`).join(', ')}.`} data-testid="community-experts"><Bar100 parts={wb.experts.parts} /></div>
            <Legend items={wb.experts.parts.map((p) => ({ label: `${p.label} ${p.value}`, tone: p.tone }))} />
          </>) : null}
        </>)}
        <span className={EYE}>{wb.bookings.state === 'ready' ? `Bookings by week · ${wb.bookings.window}` : 'Bookings by week'}</span>
        {wb.bookings.state !== 'ready' ? <PartState part={wb.bookings} onRetry={onRetry} /> : noBookings ? (
          <span className={SUB} data-testid="community-bookings-empty">{`No expert bookings in these ${weeks} weeks.`}</span>
        ) : (
          <div role="img" aria-label={`Expert bookings by week: ${wb.bookings.rows.map((r) => `${r.label} ${r.text}${r.toDate ? ' so far' : ''}`).join(', ')}.`} data-testid="community-bookings">
            <Columns rows={wb.bookings.rows} height={150} />
          </div>
        )}
      </>)}
      <span className={EYE}>Check-ins</span>
      {wb.checkins.state !== 'ready' ? <PartState part={wb.checkins} onRetry={onRetry} /> : (
        <span className={wb.checkins.withheld ? SUB : `${MONO} text-[13px] font-bold text-axal-ink dark:text-gray-100`} data-testid="community-checkins">{wb.checkins.text}</span>
      )}
      <span className={SUB}>Shown as a range, counted without reading anyone’s answers. No mood or stress figure is shown here.</span>
      <DomainActions><Link to="/admin/wellbeing" className={LINK}>Manage wellbeing →</Link></DomainActions>
    </section>
  );
}
