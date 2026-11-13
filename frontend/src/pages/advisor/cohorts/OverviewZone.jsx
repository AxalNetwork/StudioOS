import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import { NothingYet, Unrecorded, ZoneBody } from '../expertise/kit';
import { FromTheLab, NoBatch } from './kit';
import { CohortLoading, StatusBadge, useCohortRead, useCohortWorkspace } from './CohortWorkspace';
import {
  CELL_STATES, attentionItems, cohortLabel, dayLabel, dayTime, founderRows, guidanceActivity,
  progressGrid, shortDate, summaryFigures, upcomingDays,
} from './cohortModel';

/**
 * D4813 (#4813, package 1) — Cohorts › Overview, the command centre (board C1).
 *
 * `/cohorts` used to be a directory of five cards labelled WORK BOARD, FEED and
 * COLLECTION. It is now what the advisor opens the workspace FOR: who needs
 * them, where the batch is across its four weeks, what is coming in the next
 * seven days, and what was recorded lately — for the one cohort selected in
 * the header.
 *
 * FOUR READS, ALL EXISTING: the roster (`/founders`), the week record (shared,
 * from the provider), guidance (`/guidance`) and the calendar (`/calendar`).
 * Each can fail on its own. A failed read empties only its own section and
 * says so; it never turns into a zero in a figure, and the attention list
 * says it is partial.
 *
 * RECENT ACTIVITY IS GUIDANCE ONLY. What the guidance store records — what you
 * posted, what you answered, which founders acted on it — is shown. Founder
 * submissions, sessions held and Lab decisions have no activity feed (D4813:
 * new backend), so the section says they are not recorded rather than
 * inventing them.
 */

const TILE = 'text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint';

function Figure({ label, figure, note }) {
  return (
    <Card className="px-3 py-2.5">
      <div className={TILE}>{label}</div>
      {figure.value == null
        ? <div className="mt-1.5"><Unrecorded /></div>
        : <div className="mt-1 text-base font-extrabold tabular-nums tracking-tight">{figure.value}{figure.capped ? '+' : ''}</div>}
      <div className="mt-1 text-[10px] leading-snug text-axal-faint">{figure.capped ? 'the read stopped at its cap; not a total' : note}</div>
    </Card>
  );
}

function SectionHead({ title, aside, id }) {
  return (
    <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={id} className="text-sm font-extrabold tracking-tight">{title}</h2>
      {aside}
    </div>
  );
}

function SectionError({ children, onRetry }) {
  return (
    <div role="alert" className="rounded-lg border border-dashed border-red-200 px-3 py-2.5 text-[12px] text-red-800 dark:border-red-900 dark:text-red-300">
      {children}{' '}
      {onRetry && (
        <button type="button" onClick={onRetry} className="min-h-[44px] font-bold underline lg:min-h-0">Retry</button>
      )}
    </div>
  );
}

/** One cell of the four-week grid: a shape and a word, never a colour alone. */
export function ProgressCell({ state }) {
  const c = CELL_STATES[state] || CELL_STATES.missing;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px]" data-cell={state}>
      <span aria-hidden="true" className="font-bold">{c.glyph}</span>{c.label}
    </span>
  );
}

export function AttentionList({ items, unknown }) {
  return (
    <>
      {unknown.length > 0 && (
        <p className="mb-2 text-[11.5px] text-amber-900 dark:text-amber-200" data-testid="attention-partial">
          {`Partial: ${unknown.join(', ')} could not be read, so anything there is not listed.`}
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-[12px] text-axal-muted">
          {unknown.length ? 'Nothing needs you in what did load.' : 'Nothing needs you right now: no failed or grace founder, no one at risk, no open question and nothing due in the next three days.'}
        </p>
      ) : (
        <ul className="divide-y divide-axal-hairline dark:divide-gray-800" data-testid="attention-list">
          {items.map((it) => (
            <li key={it.key} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-extrabold">{it.who}</span>
                  <StatusBadge state={it.state} />
                </div>
                <div className="mt-0.5 text-[12px] text-axal-muted">{it.reason}</div>
                <div className="mt-0.5 text-[11px] text-axal-faint">{it.date ? dayTime(it.date) : 'No date recorded'}</div>
              </div>
              <Link to={it.action.to}
                className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg border border-axal-hairline px-3 text-[12px] font-bold text-emerald-800 hover:bg-axal-ground dark:border-gray-700 dark:text-emerald-300 dark:hover:bg-gray-800 lg:min-h-[32px]">
                {it.action.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function ProgressTable({ grid, label }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]" data-testid="progress-grid">
        <caption className="sr-only">{`Week status per founder in ${label}`}</caption>
        <thead>
          <tr className="border-b border-axal-hairline text-left dark:border-gray-700">
            <th scope="col" className={`px-2 py-1.5 ${TILE}`}>Founder</th>
            {grid.columns.map((n) => (
              <th key={n} scope="col" className={`px-2 py-1.5 ${TILE}`}>{`Week ${n}${n === grid.current ? ' · now' : ''}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((r) => (
            <tr key={r.user_id} className="border-b border-axal-hairline/60 last:border-0 dark:border-gray-800">
              <th scope="row" className="px-2 py-2 text-left font-semibold">{r.name || <Unrecorded>Name not recorded</Unrecorded>}</th>
              {r.cells.map((c, i) => <td key={grid.columns[i]} className="px-2 py-2"><ProgressCell state={c} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** C18 — the structure with neutral states, and no founder anywhere. */
export function OverviewPreview() {
  return (
    <div className="space-y-4" data-testid="cohorts-overview-preview">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {['Founders visible', 'Needing attention', 'Guidance awaiting response', 'Upcoming sessions'].map((l) => (
          <Figure key={l} label={l} figure={{ value: null }} note="no cohort in preview" />
        ))}
      </div>
      <Card className="p-4">
        <SectionHead title="Needs your attention" />
        <p className="text-[12px] text-axal-muted">Appears here for an assigned advisor: failed and grace founders, deadlines, questions and sessions.</p>
      </Card>
      <Card className="p-4">
        <SectionHead title="Cohort progress" />
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <caption className="sr-only">Week status per founder — no cohort in preview</caption>
            <thead>
              <tr className="text-left">
                <th scope="col" className={`px-2 py-1.5 ${TILE}`}>Founder</th>
                {[1, 2, 3, 4].map((n) => <th key={n} scope="col" className={`px-2 py-1.5 ${TILE}`}>{`Week ${n}`}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" className="px-2 py-2 text-left font-normal italic text-axal-faint">No founders in preview</th>
                {[1, 2, 3, 4].map((n) => <td key={n} className="px-2 py-2"><ProgressCell state="missing" /></td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4"><SectionHead title="Next 7 days" /><p className="text-[12px] text-axal-muted">No cohort selected.</p></Card>
        <Card className="p-4"><SectionHead title="Recent activity" /><p className="text-[12px] text-axal-muted">No cohort selected.</p></Card>
      </div>
    </div>
  );
}

export default function OverviewZone() {
  const ws = useCohortWorkspace();
  const roster = useCohortRead((id) => api.listMyAdvisorCohortFounders(id),
    { fallbackError: 'This cohort’s founders could not be read.' });
  const guidance = useCohortRead((id) => api.listMyAdvisorCohortGuidance(id),
    { fallbackError: 'This cohort’s guidance could not be read.' });
  const calendar = useCohortRead((id) => api.listMyAdvisorCohortCalendar(id),
    { fallbackError: 'This cohort’s calendar could not be read.' });

  if (ws.preview) return <OverviewPreview />;

  const label = ws.label || cohortLabel(null);
  const weeks = ws.weeks;
  const now = Date.now();
  const list = roster.data ? (Array.isArray(roster.data.items) ? roster.data.items : []) : null;
  const weeksReadable = Boolean(weeks.data) && !weeks.error;
  const rows = list ? founderRows(list, weeksReadable ? weeks.data : null, now) : null;
  const attention = attentionItems({
    cycleId: ws.cycleId, cohortName: label,
    rows: rows && weeksReadable ? rows : null,
    guidance: guidance.data, calendar: calendar.data, now,
  });
  const figures = summaryFigures({
    roster: list, rosterTruncated: roster.data?.truncated, rows, weeksReadable,
    guidance: guidance.data, calendar: calendar.data, now,
  });
  const grid = list && weeksReadable ? progressGrid(list, weeks.data, now) : null;
  const agenda = upcomingDays(calendar.data, now, 7);
  const activity = guidanceActivity(guidance.data);
  const notStarted = weeksReadable && weeks.data.windows_recorded && weeks.data.current_week == null;
  const firstOpen = notStarted ? weeks.data.weeks?.[0]?.unlock_at : null;

  return (
    <div className="space-y-4" data-testid="cohorts-overview">
      <ZoneBody
        loading={ws.assignments.loading}
        error={ws.assignments.error}
        onRetry={ws.reloadAssignments}
        isEmpty={ws.assignments.items.length === 0}
        empty={<NoBatch />}
      >
        {(roster.loading || weeks.loading) && <CohortLoading />}
        <ZoneBody
          loading={roster.loading}
          error={roster.error}
          onRetry={roster.reload}
          isEmpty={Boolean(list) && list.length === 0}
          empty={(
            <NothingYet
              title="No founders are visible to you"
              body={`You are assigned to ${label}, and no founder in it is visible to you: none is recorded yet, or those who are have not shared their progress with advisors. That is the Lab’s record, not a failed read.`}
            />
          )}
        >
          {notStarted && (
            <Card className="mb-4 p-4">
              <h2 className="text-sm font-extrabold tracking-tight">{`${label} has not started`}</h2>
              <p className="mt-1 text-[12px] text-axal-muted">
                {firstOpen ? `Week 1 opens ${dayTime(firstOpen)}. Progress appears once it does.` : 'No week has opened yet.'}
              </p>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4" data-testid="overview-figures">
            <Figure label="Founders visible" figure={figures.founders} note={`in ${label}, read from the Lab`} />
            <Figure label="Needing attention" figure={figures.attention} note="failed, in grace or at risk" />
            <Figure label="Guidance awaiting response" figure={figures.questions} note="founder questions with no answer" />
            <Figure label="Upcoming sessions" figure={figures.sessions} note="booked, next 7 days" />
          </div>

          <Card className="mt-4 p-4" aria-labelledby="ov-attention">
            <SectionHead id="ov-attention" title="Needs your attention"
              aside={<span className="text-[11px] text-axal-faint">{`${attention.items.length} · most urgent first`}</span>} />
            {weeks.error && (
              <SectionError onRetry={ws.reloadWeeks}>{`${weeks.error} Founder states cannot be judged without it.`}</SectionError>
            )}
            <AttentionList items={attention.items} unknown={attention.unknown} />
          </Card>

          <Card className="mt-4 p-4" aria-labelledby="ov-progress">
            <SectionHead id="ov-progress" title="Cohort progress"
              aside={grid ? <span className="text-[11px] text-axal-faint">{`${grid.rows.length} founders · ${grid.columns.length} weeks`}</span> : null} />
            {weeks.error ? (
              <SectionError onRetry={ws.reloadWeeks}>{weeks.error}</SectionError>
            ) : !grid ? (
              <p className="text-[12px] text-axal-muted">Waiting for the week record.</p>
            ) : grid.missing ? (
              <p className="text-[12px] text-axal-muted">No week windows are recorded for this cohort, so its weeks cannot be drawn. That is missing data, not zero progress.</p>
            ) : (
              <ProgressTable grid={grid} label={label} />
            )}
            <div className="mt-2"><FromTheLab>read from the Spin-Out Lab’s week status. Not assessed is not zero; a week that is not open opens on its date.</FromTheLab></div>
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card className="p-4" aria-labelledby="ov-upcoming">
              <SectionHead id="ov-upcoming" title="Next 7 days"
                aside={<Link to={ws.href('/cohorts/calendar')} className="inline-flex min-h-[44px] items-center text-[12px] font-bold text-emerald-800 underline dark:text-emerald-300 lg:min-h-0">Calendar →</Link>} />
              {calendar.loading ? <CohortLoading what="the calendar" />
                : calendar.error ? <SectionError onRetry={calendar.reload}>{calendar.error}</SectionError>
                : (
                  <>
                    {calendar.data?.windows_recorded === false && (
                      <p className="mb-2 text-[11.5px] text-amber-900 dark:text-amber-200">Partial: the Lab has no week windows for this cohort, so only your booked sessions are listed.</p>
                    )}
                    {agenda && agenda.length ? (
                      <ul className="space-y-2" data-testid="overview-agenda">
                        {agenda.map((d) => (
                          <li key={d.day}>
                            <div className={TILE}>{d.day}</div>
                            <ul className="mt-1 space-y-1">
                              {d.items.map((it) => (
                                <li key={it.ref} className="flex items-baseline justify-between gap-3 text-[12px]">
                                  <span className="min-w-0 truncate">{it.title}</span>
                                  <span className="shrink-0 tabular-nums text-axal-faint">{dayTime(it.starts_at)?.split(', ').pop()}</span>
                                </li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-[12px] text-axal-muted">Nothing in the next seven days: no cohort date and no booked session.</p>}
                  </>
                )}
            </Card>

            <Card className="p-4" aria-labelledby="ov-activity">
              <SectionHead id="ov-activity" title="Recent activity" />
              {guidance.loading ? <CohortLoading what="guidance" />
                : guidance.error ? <SectionError onRetry={guidance.reload}>{guidance.error}</SectionError>
                : activity && activity.length ? (
                  <ul className="space-y-1.5" data-testid="overview-activity">
                    {activity.map((a, i) => (
                      <li key={`${a.at}-${i}`} className="flex items-baseline justify-between gap-3 text-[12px]">
                        <span className="min-w-0">{a.text}</span>
                        <span className="shrink-0 text-[11px] text-axal-faint">{shortDate(a.at) || dayLabel(a.at)}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-[12px] text-axal-muted">No guidance activity recorded yet.</p>}
              <p className="mt-2 text-[11px] leading-relaxed text-axal-faint" data-testid="activity-not-recorded">
                Only guidance is recorded here: what you posted and answered, and who acted on it. Founder submissions, sessions held and Lab decisions are not recorded as activity yet.
              </p>
            </Card>
          </div>
        </ZoneBody>
      </ZoneBody>
    </div>
  );
}
