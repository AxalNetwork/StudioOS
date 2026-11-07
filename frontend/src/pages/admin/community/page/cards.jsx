/**
 * #4717 package 6 — The Community page's cards: activity, events (Next up, the funnel, events by type), who takes part, jobs, circles and the roster, wellbeing and Needs a decision.
 * Split out of AdminCommunity.jsx; nothing here decides anything.
 */
import React, { useState } from 'react';
import { Bar100, Chart, ChartTable, Columns, HBars, Legend, StackBars } from '../../../../ui';
import { AS_ENTERED_TIP, OVERDUE_HOURS } from '../communityModel';
import { CARD, Card, EYE, Failed, GHOST, H2, LINK, MONO, Opener, OverdueDot, PartState, SUB, TAG, TableToggle } from './parts';
import { Link } from 'react-router-dom';

/** The funnel (Registered → Confirmed → Attended), waitlisted beside it, and events by type with the empty types behind Show all. */
export function FunnelParts({ ev, weeks, onRetry }) {
  const [all, setAll] = useState(false);
  const f = ev.funnel;
  const bt = ev.byType;
  return (<>
    <span className={EYE}>{`Funnel · events that ended in these ${weeks} weeks`}</span>
    {f.state !== 'ready' ? <PartState part={f} onRetry={onRetry} /> : (
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

export function EventsCard({ next, ev, weeks, onRetry, onOpen }) {
  // #4717: the card is drawn whenever the Community read answered. Next up,
  // the funnel and events by type each answer alone, so one that could not be
  // read never hides the others.
  return (
    <Card id="events" title="Events" state="ready" onRetry={onRetry}
      foot={<span className="flex flex-wrap gap-4"><Opener box="events" onOpen={onOpen}>See all events</Opener><Link to="/admin/events" className={LINK}>Open events</Link></span>}>
      {() => (<>
      <FunnelParts ev={ev} weeks={weeks} onRetry={onRetry} />
      <span className={EYE}>Next up</span>
      {next.state !== 'ready' ? <PartState part={next} onRetry={onRetry} /> : next.rows?.length ? (
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
      ) : <span className={SUB}>No published or waiting event starts in the next 30 days.</span>}
      </>)}
    </Card>
  );
}

export function JobsCard({ jobs, onRetry, onOpen }) {
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
                {j.company || j.daysOpen ? <span className={SUB}>{[j.company, j.daysOpen].filter(Boolean).join(' · ')}</span> : null}
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

export function CirclesCard({ circles, roster, onRetry, onOpen }) {
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

export function NeedsCard({ needs, onRetry }) {
  return (
    <Card id="needs" title="Needs a decision" state={needs.state} reason={needs.reason} onRetry={onRetry}
      foot={<Link to="/admin/approvals" className={`${LINK} self-start`}>{needs.state === 'ready' ? `${needs.total} waiting${needs.overdue ? ` · ${needs.overdue} overdue` : ''} · Open Approvals` : 'Open Approvals'}</Link>}>
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
export function ActivityCard({ activity, onRetry, onOpen }) {
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
          <div role="group" aria-label={`Community activity by week: ${activity.chart.series.map((x) => x.label).join(', ')}. ${activity.sentence || ''}`}>
            <Chart chart={activity.chart} onSelect={(key) => { const s = activity.chart.series.find((x) => x.key === key); if (s?.opens) onOpen(s.opens); }} />
          </div>
          <Legend items={[...activity.chart.series.map((x) => ({ label: x.label, tone: x.tone, mark: x.dash ? 'dashed' : 'line' })), { label: 'This week, so far', tone: 'hollow' }]} />
        </>)}
        <span className={SUB}>The current week is not finished, so its point is hollow and its row says so far. A week with no value breaks the line. A point on Event registrations opens the events.</span>
      </>)}
    </Card>
  );
}

/** Who takes part: registrations and applications stacked by profile, and the sentence. */
export function WhoCard({ who, onRetry }) {
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
export function WellbeingCard({ wb, onRetry }) {
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
      <Link to="/admin/wellbeing" className={`${LINK} self-start`}>Open wellbeing</Link>
    </section>
  );
}
