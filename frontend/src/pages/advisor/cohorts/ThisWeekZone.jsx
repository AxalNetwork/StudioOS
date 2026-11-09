import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import { NothingYet, Unrecorded, ZoneBody, ZoneHeading } from '../expertise/kit';
import { FromTheLab, NoBatch, StatedLimit } from './kit';
import { CohortLoading, useCohortRead, useCohortWorkspace } from './CohortWorkspace';
import { DELIVERABLE_STATES, advisorActions, attentionLine, recentGuidance, sessionsBetween, thisWeek } from './weekModel';
import { calendarEvents, clockTime, dayKey, dayTitle } from './calendarModel';

/**
 * Cohorts · This week — board C7, the week as an action centre.
 *
 * WHOSE WEEK THIS IS. The founders' deliverables are the Lab's record and the
 * founders' responsibility: they are drawn read-only, under the seam, and
 * nothing on them looks like a control. What is the advisor's — questions to
 * answer, sessions to hold — sits in its own block, "Your actions", so the two
 * are never read as one list.
 *
 * `windows_recorded: false` IS RENDERED AS ITSELF. A cycle predating migration
 * 156 has no week windows, so there is no "current week" to state. Showing
 * "week 1" for one would invent the single fact this page exists to report.
 *
 * NOT ASSESSED IS NOT COMPLETE. A founder with no week record, or whose
 * deliverables are all in but whom the Lab has not decided, reads Not yet
 * assessed (`weekModel.deliverableStatus`).
 *
 * PER-DELIVERABLE COLUMNS ARE NOT DRAWN. C7 names each deliverable (Interview
 * log, Problem statement…); the Lab records a count per founder per week, not
 * which items, so the table has one status and the count.
 */

const TONE = {
  danger: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  warn: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  info: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200',
  neutral: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300',
};

/** A deliverable status in words and a shape — a label, not a control. */
export function DeliverableBadge({ status }) {
  const meta = DELIVERABLE_STATES[status] || DELIVERABLE_STATES.not_assessed;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${TONE[meta.tone]}`} data-status={status}>
      <span aria-hidden="true">{meta.glyph}</span>{meta.label}
    </span>
  );
}

function Figure({ label, value, note, testid }) {
  return (
    <Card padding="md" data-testid={testid}>
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{label}</div>
      <div className="mt-1 text-[20px] font-extrabold tabular-nums">{value ?? <Unrecorded />}</div>
      {note && <div className="mt-0.5 text-[11px] leading-relaxed text-axal-faint">{note}</div>}
    </Card>
  );
}

function Block({ title, aside, children, testid }) {
  return (
    <section aria-label={title} data-testid={testid} className="rounded-[10px] border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-extrabold tracking-tight">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** The C7 header figures. */
export function WeekHeader({ week }) {
  const del = week.deliverables;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="this-week-header">
      <Figure
        testid="this-week-week"
        label="Week"
        value={`${week.week} of ${week.total}`}
        note={`${week.range || 'Dates not recorded'} · ${week.timezone}`}
      />
      <Figure
        label="Days remaining"
        value={week.daysRemaining}
        note={week.deadlinePassed ? `Deadline passed ${week.deadlineLabel}` : week.deadlineLabel ? `Due ${week.deadlineLabel}` : 'Deadline not recorded'}
      />
      <Figure
        label="Founders complete"
        value={`${week.complete} of ${week.rows.length}`}
        note={del ? `${del.done} of ${del.required} deliverables in${del.uncounted ? ` · ${del.uncounted} not counted` : ''}` : 'No deliverable counts recorded'}
      />
      <Figure
        label="Need attention"
        value={week.attention.length}
        note={attentionLine(week.tally) || 'None failed, in grace or missing'}
      />
    </div>
  );
}

/** Required deliverables — founder responsibilities, read-only. */
export function DeliverablesTable({ week }) {
  return (
    <>
      <table className="hidden w-full text-[12.5px] sm:table" data-testid="deliverables-table">
        <caption className="sr-only">{`Week ${week.week} required deliverables by founder, from the Spin-Out Lab`}</caption>
        <thead>
          <tr className="border-b border-axal-hairline text-left dark:border-gray-700">
            <th scope="col" className="py-2 pr-3 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Founder</th>
            <th scope="col" className="py-2 pr-3 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Status</th>
            <th scope="col" className="py-2 pr-3 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Deliverables</th>
            <th scope="col" className="py-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Why</th>
          </tr>
        </thead>
        <tbody>
          {week.rows.map((r) => (
            <tr key={r.user_id} className="border-b border-axal-hairline/60 last:border-0 dark:border-gray-800">
              <th scope="row" className="py-2.5 pr-3 text-left font-semibold">{r.name || <Unrecorded>Name not recorded</Unrecorded>}</th>
              <td className="py-2.5 pr-3"><DeliverableBadge status={r.status} /></td>
              <td className="py-2.5 pr-3 tabular-nums">{r.required ? `${r.done ?? '—'}/${r.required}` : <Unrecorded />}</td>
              <td className="py-2.5 text-[11.5px] text-axal-muted">{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="space-y-2 sm:hidden" data-testid="deliverables-cards">
        {week.rows.map((r) => (
          <li key={r.user_id} className="rounded-lg border border-axal-hairline p-3 dark:border-gray-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{r.name || 'Name not recorded'}</span>
              <DeliverableBadge status={r.status} />
            </div>
            <p className="mt-1 text-[11.5px] text-axal-muted">{r.reason}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function ThisWeekZone() {
  // D4813: the cohort is the workspace's (header selector, `?cohort=`), and so
  // is its week record — read once in the provider, so this page and the
  // header's "Week n of 4" cannot disagree about which week it is. The other
  // three reads go through `useCohortRead`, so a late answer for the cohort
  // just left is dropped.
  const ws = useCohortWorkspace();
  const weeks = ws.weeks;
  const load = ws.reloadWeeks;
  const roster = useCohortRead((id) => api.listMyAdvisorCohortFounders(id),
    { fallbackError: 'This cohort’s founders could not be read.' });
  const guidance = useCohortRead((id) => api.listMyAdvisorCohortGuidance(id),
    { fallbackError: 'This cohort’s guidance could not be read.' });
  const calendar = useCohortRead((id) => api.listMyAdvisorCohortCalendar(id),
    { fallbackError: 'This cohort’s calendar could not be read.' });

  const now = Date.now();
  const list = roster.data ? (Array.isArray(roster.data.items) ? roster.data.items : []) : null;
  const week = weeks.data ? thisWeek({ weeks: weeks.data, roster: list, cycleId: ws.cycleId, now }) : null;
  const window = week?.ready ? (weeks.data.weeks || []).find((w) => Number(w.week_number) === week.week) : null;
  const events = calendarEvents(calendar.data);
  const sessions = window
    ? sessionsBetween(events, window.unlock_at, window.deadline_at, now)
    : sessionsBetween(events, null, new Date(now + 7 * 86_400_000).toISOString(), now);
  const actions = advisorActions({ guidance: guidance.data, sessions, cycleId: ws.cycleId, now });
  const recent = recentGuidance(guidance.data);
  const open = guidance.data?.counts?.open;

  return (
    <div className="space-y-4">
      <ZoneHeading
        title="This week"
        blurb="The week the Lab recorded for this cohort, what the founders owe, and what is yours to do."
      />

      <ZoneBody
        loading={ws.assignments.loading}
        error={ws.assignments.error}
        onRetry={ws.reloadAssignments}
        isEmpty={ws.assignments.items.length === 0}
        empty={<NoBatch />}
      >
        {weeks.loading && <CohortLoading what="the week record" />}
        <ZoneBody loading={weeks.loading} error={weeks.error} onRetry={load}
          isEmpty={!weeks.data}
          empty={<NothingYet title="Nothing recorded for this cohort" body="The Lab has no week record against this cycle." />}>
          {week && !week.ready && (
            <Card padding="md" data-testid="this-week-unready">
              <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Week</div>
              <div className="mt-1"><Unrecorded>Not recorded</Unrecorded></div>
              <p className="mt-1 text-[12px] leading-relaxed text-axal-muted">{week.reason}</p>
            </Card>
          )}
          {week?.ready && (
            <div className="space-y-4">
              <WeekHeader week={week} />

              <Block
                testid="this-week-deliverables"
                title="Required deliverables · founder responsibilities"
                aside={<span className="text-[11px] text-axal-faint">Read-only · from the Spin-Out Lab</span>}
              >
                {roster.error && (
                  <p role="status" className="mb-2 text-[11.5px] text-amber-800 dark:text-amber-200">
                    The founder list could not be read, so the founders below are those the Lab’s week record names.
                  </p>
                )}
                {week.rows.length === 0
                  ? <p className="text-[12px] text-axal-muted">No founder is visible to you in this cohort.</p>
                  : <DeliverablesTable week={week} />}
              </Block>

              <Block testid="this-week-attention" title="Needs attention"
                aside={<span className="text-[11px] text-axal-faint">Failed, in grace, or missing at the deadline</span>}>
                {week.attention.length === 0 ? (
                  <p className="text-[12px] text-axal-muted">No founder is failed, in grace or missing this week.</p>
                ) : (
                  <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
                    {week.attention.map((r) => (
                      <li key={r.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span className="min-w-0">
                          <span className="font-semibold">{r.name || 'Founder (name not recorded)'}</span>
                          <span className="block text-[11.5px] text-axal-muted">{r.reason}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <DeliverableBadge status={r.status} />
                          <Link to={r.href} className="inline-flex min-h-[44px] items-center text-[12px] font-semibold text-emerald-700 underline dark:text-emerald-300 lg:min-h-0">
                            Open founder
                          </Link>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-[11px] text-axal-faint">
                  The Lab records a count, not the submitted work, so evidence opens on the founder.
                </p>
              </Block>

              <div className="grid gap-4 lg:grid-cols-2">
                <Block testid="this-week-actions" title="Your actions"
                  aside={<span className="text-[11px] text-axal-faint">Yours, not the founders’</span>}>
                  {guidance.loading || calendar.loading ? <CohortLoading what="your actions" /> : null}
                  {actions.length === 0 && !guidance.loading && !calendar.loading ? (
                    <p className="text-[12px] text-axal-muted">
                      {guidance.error || calendar.error
                        ? 'Some of your actions could not be read; see below.'
                        : 'No unanswered question and no session this week.'}
                    </p>
                  ) : (
                    <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
                      {actions.map((a) => (
                        <li key={a.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                          <span className="min-w-0">
                            <span className="font-semibold">{a.label}</span>
                            <span className="block text-[11.5px] text-axal-muted">{a.detail}{a.when ? ` · ${a.when}` : ''}</span>
                          </span>
                          <Link to={a.to} className="inline-flex min-h-[44px] items-center text-[12px] font-semibold text-emerald-700 underline dark:text-emerald-300 lg:min-h-0">
                            {a.kind === 'question' ? 'Answer' : 'Open calendar'}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Block>

                <Block testid="this-week-guidance" title="Guidance & communication"
                  aside={<Link to={ws.href('/cohorts/guidance')} className="text-[11.5px] font-semibold text-emerald-700 underline dark:text-emerald-300">Open guidance</Link>}>
                  {guidance.error ? (
                    <p role="status" className="text-[12px] text-axal-muted">{`${guidance.error} Unanswered questions are not counted here.`}</p>
                  ) : guidance.data ? (
                    <>
                      <p className="text-[12px]">
                        <span className="font-bold tabular-nums">{Number.isFinite(Number(open)) ? open : 'Not recorded'}</span>
                        {` unanswered question${Number(open) === 1 ? '' : 's'}${guidance.data.truncated ? ' (of the newest 200)' : ''}`}
                      </p>
                      {recent.length === 0 ? (
                        <p className="mt-1 text-[12px] text-axal-muted">You have posted no guidance to this cohort.</p>
                      ) : (
                        <ul className="mt-2 space-y-1.5">
                          {recent.map((g) => (
                            <li key={g.uid} className="text-[12px]">
                              <span className="text-axal-faint">{`${dayTitle(dayKey(g.posted_at)) || 'Date not recorded'} · `}</span>
                              {String(g.body || '').trim().slice(0, 90)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : null}
                </Block>
              </div>

              <Block testid="this-week-sessions" title="Sessions this week"
                aside={<span className="text-[11px] text-axal-faint">{`${week.range} · ${week.timezone}`}</span>}>
                {calendar.error ? (
                  <p role="status" className="text-[12px] text-axal-muted">{calendar.error}</p>
                ) : sessions.length === 0 ? (
                  <p className="text-[12px] text-axal-muted">No booked or group session in this week.</p>
                ) : (
                  <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
                    {sessions.map((s) => (
                      <li key={s.ref} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-[12px]">
                        <span className="font-semibold">{s.title}</span>
                        <span className="tabular-nums text-axal-muted">
                          {`${dayTitle(s.day)} ${clockTime(s.starts_at)}${s.etype === 'group_session' ? ` · group · ${(s.participants || []).length} founders` : ''}${s.ongoing ? ' · in progress' : ''}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Block>
            </div>
          )}

          <div className="mt-3"><FromTheLab /></div>
          <StatedLimit title="This is the batch's week, not yours">
            The deliverables are the founders’ and the Lab decides them; this page reports what
            the Lab recorded and adds no judgement of its own. Your actions are only what the
            product records as yours: questions waiting for an answer and sessions you hold.
          </StatedLimit>
        </ZoneBody>
      </ZoneBody>
    </div>
  );
}
