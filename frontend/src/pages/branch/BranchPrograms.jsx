import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Gamepad2, SlidersHorizontal } from 'lucide-react';
import { api, adminAssessment } from '../../lib/api';
import { reportError } from '../../lib/log';
import { COHORT_TZ } from '../../lib/spinoutLab';
import { inZone, dateInZone } from '../../lib/zoneTime';
import { cycleLabel, statusesByWeek, tallyReadable } from '../../lib/cohortTimeline';
import { Card, Unrecorded, Unreadable } from '../../ui';
import BranchZone from './BranchZone';

/**
 * Branch · Programs — canvas S4, the half of it that is true.
 *
 * THE PROMISE THIS DELETES, AND IT IS THE THIRD OF ITS KIND. `/branch/programs`
 * rendered a stated notice promising *"the cohort calendar with **dates you
 * adjust**, and assessment runs whose results are yours."* The first clause is
 * false and the second cannot be built, and finding that out is what shaped
 * this page rather than the artboard.
 *
 * NO ROUTE ANYWHERE LETS AN ADMIN MOVE A CYCLE OR A WEEK. Measured across the
 * whole worker: there is **no `UPDATE week_windows` at all**, and every
 * `UPDATE cohort_cycles` touches `status`, `app_status`, `force_proceed` or the
 * one-shot application window — never `start_at`/`end_at`. The four week
 * windows are pure month arithmetic (`cycleWeekWindows(year, month)`), and both
 * rows are written by `INSERT OR IGNORE`, so re-materialising a cycle cannot
 * move one either. A date picker here would be a control with nothing behind
 * it, which is the `still_an_admin` mistake D134 named: a button the server
 * always rejects teaches the operator that one of its buttons is a lie.
 *
 * WHAT A BRANCH GENUINELY CONTROLS IS THE OUTCOME, NOT THE CALENDAR — per
 * company, per week: `grace` (1–168h, reason mandatory) and `override`, both
 * audited through `applyWeekDecision` into `company_week_status` and
 * `stage_transition_log`. That is a real and defensible reading of "timing is
 * yours"; it is simply not a date picker, and the page says which it is.
 *
 * AND IT LINKS TO THOSE TWO WRITES RATHER THAN RE-IMPLEMENTING THEM. They
 * already have a working console — `AdminCohortTiming`, a tab of
 * `/admin/spinout-lab` rather than a route of its own — and two audited writes
 * drawn twice is how two surfaces come to disagree about what was decided.
 *
 * ASSESSMENT AUTHORING STAYS AT HQ. `admin_assessment.ts` keeps the writes
 * behind `requireHqAuthoring` (D106). Asking a branch admin to press a button
 * that 403s is the same lie as the date picker. This page reads the game list
 * and, since D446, the run list. It does not call per-game analytics.
 *
 * AND ON A BRANCH THE GAME LIST IS EMPTY BY CONSTRUCTION, which is not the
 * same as "HQ has authored nothing". HQ authors the games in HQ's database; a
 * branch's database is built from a baseline with no seed rows, authoring is
 * refused here, and no call sends a game to a branch (D214 measured every RPC
 * method). So the empty state names the branch's own database as what was
 * read. Runs are listed for one cycle: a session has no cycle column, so a
 * run is kept when its start falls inside that cycle. There is still no
 * `GET /results`. A result is the archetype on the run, when one was written.
 *
 * EVERY DEADLINE CARRIES ITS ZONE. The programme runs on `COHORT_TZ` —
 * America/New_York — for every territory, and a branch admin reads this page
 * somewhere else. The constant is imported from `lib/spinoutLab.js` rather than
 * typed a third time, and the test pins it equal to the worker's
 * `services/cohortTiming.ts` so the two cannot drift.
 */

const UNAVAILABLE = Symbol('unavailable');

// The empty state's reason, said once and drawn twice — on hover, and as the
// sentence beside it, because a reason that lives only in a `title` attribute
// is one most readers never see.
export const NO_GAME_HERE = 'The list read is this branch\u2019s own database, and no game is in it. '
  + 'HQ authors the games in its own database, and no call sends one to a branch, so there is none '
  + 'to run here yet.';

export default function BranchPrograms({ user }) {
  const [timeline, setTimeline] = useState(null);
  const [games, setGames] = useState(null);
  const [cyclePick, setCyclePick] = useState('');
  const [runs, setRuns] = useState(null);

  const loadTimeline = useCallback(() => {
    setTimeline(null);
    api.adminCohortTimeline().then(setTimeline, (e) => {
      reportError('BranchPrograms:timeline', e);
      setTimeline(UNAVAILABLE);
    });
  }, []);

  const loadGames = useCallback(() => {
    setGames(null);
    adminAssessment.listGames().then(setGames, (e) => {
      reportError('BranchPrograms:games', e);
      setGames(UNAVAILABLE);
    });
  }, []);

  // TWO READS, TWO STATES, ON PURPOSE. A failed assessment read must not take
  // the calendar down with it, and vice versa — the idiom `BranchAccounts`
  // already uses for its licence and its directory.
  useEffect(() => { loadTimeline(); loadGames(); }, [loadTimeline, loadGames]);

  const timelineReady = timeline && timeline !== UNAVAILABLE;
  const gamesReady = games && games !== UNAVAILABLE;

  const cycles = timelineReady ? (timeline.cycles || []) : [];
  const activeCycle = cyclePick || (cycles[0]?.id != null ? String(cycles[0].id) : '');

  const loadRuns = useCallback((cycle) => {
    setRuns(null);
    adminAssessment.listSessions(cycle || undefined).then(setRuns, (e) => {
      reportError('BranchPrograms:runs', e);
      setRuns(UNAVAILABLE);
    });
  }, []);

  useEffect(() => {
    if (timeline === null) return undefined;
    loadRuns(timelineReady ? (activeCycle || undefined) : undefined);
    return undefined;
  }, [timeline, timelineReady, activeCycle, loadRuns]);
  // `{ games: [...] }` is the shape the route returns. No second key is read:
  // a fallback to a shape the server does not send is a guess that looks
  // like defensiveness and hides the day the payload actually changes.
  const gameRows = gamesReady ? (games.games || []) : [];

  // WHAT THE RAIL MAY SAY (D126): only what this page actually loaded. A failed
  // read contributes no line rather than a zero.
  const coverage = [];
  if (timelineReady) coverage.push(`Cohort cycles: ${cycles.length} most recent`);
  if (gamesReady) coverage.push(`Assessment games: ${gameRows.length}`);
  if (runs && runs !== UNAVAILABLE && runs.available === true && Array.isArray(runs.items)) {
    coverage.push(`${runs.items.length} assessment run${runs.items.length === 1 ? '' : 's'} listed`);
  }

  const unavailable = [
    ['Assessment results as their own list', 'There is no GET /results. A result is the archetype '
      + 'on a run, when one was written. A run with none says so.'],
    ['Cycle and week dates', 'The four week windows are derived from the month and no route '
      + 'changes them, so there is nothing here to adjust. What this branch decides is a '
      + "company's week outcome."],
  ];
  if (timeline === UNAVAILABLE) {
    unavailable.push(['Cohort calendar', 'The timeline could not be read on this deployment.']);
  }
  if (games === UNAVAILABLE) {
    unavailable.push(['Assessment games', 'The game list could not be read on this deployment.']);
  }

  return (
    <BranchZone
      workspace="Programs"
      user={user}
      coverage={coverage}
      coverageNote="Counts are this deployment's own. Nothing here is read from another territory."
      unavailable={unavailable}
    >
      <header data-testid="branch-programs-header">
        <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
          <CalendarDays size={13} /> Branch · Programs
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink">Programme</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
          The cohort calendar as the platform derives it, what this territory decides about a
          company&rsquo;s week, and the assessment games this branch&rsquo;s own database holds.
          Authoring stays at HQ.
        </p>
      </header>

      {/* ── The cohort calendar ────────────────────────────────────────── */}
      <Card className="mt-4 p-4" data-testid="branch-programs-calendar">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-axal-muted" aria-hidden="true" />
          <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Cohort calendar</h2>
        </div>

        <p className="mt-1 text-[11.5px] text-axal-muted">
          {/* THE ZONE IS PRINTED, ALWAYS, and it is not this territory's. */}
          Week deadlines are wall-clock times in{' '}
          <strong data-testid="branch-programs-zone">{COHORT_TZ}</strong>, the same for every
          territory. They are not your local time.
        </p>

        {/* THE SENTENCE THAT REPLACES THE PROMISE. Stated on the calendar
            itself rather than in a footnote, because it is the first thing a
            reader of this block would otherwise assume wrong. */}
        <p className="mt-2 text-[11.5px] text-axal-muted" data-testid="branch-programs-derived">
          A cycle runs the calendar month and its four week windows are derived from it. No route
          moves a cycle or a window, so these dates are read here rather than set &mdash; what this
          branch adjusts is a company&rsquo;s outcome for a week, below.
        </p>

        {timeline === null ? (
          <p className="mt-3 text-[12px] text-axal-muted">Reading the cycles&hellip;</p>
        ) : null}

        {timeline === UNAVAILABLE ? (
          <div className="mt-3" data-testid="branch-programs-calendar-unreadable">
            <Unreadable
              what="the cohort calendar"
              claim="This is not a claim that no cycle exists — the timeline could not be read."
              onRetry={loadTimeline}
            />
          </div>
        ) : null}

        {timelineReady && !cycles.length ? (
          <div className="mt-3">
            <Unrecorded reason="No cohort cycle has been materialised on this deployment yet.">
              No cycle to show
            </Unrecorded>
          </div>
        ) : null}

        {timelineReady && cycles.length ? (
          <ul className="mt-3 space-y-3">
            {cycles.map((cy) => {
              const byWeek = statusesByWeek(cy.status_counts);
              const windows = cy.windows || [];
              return (
                <li
                  key={cy.id}
                  data-testid="branch-programs-cycle"
                  className="rounded-lg border border-axal-hairline p-3"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-[13px] font-extrabold text-axal-ink">
                      {cycleLabel(cy.year, cy.month) || 'Cycle'}
                    </span>
                    <span className="text-[11px] font-extrabold uppercase tracking-[.07em] text-axal-muted">
                      {cy.status || 'status not recorded'}
                    </span>
                    <span className="text-[11.5px] text-axal-muted">
                      {dateInZone(cy.start_at, COHORT_TZ) || 'start not readable'}
                      {' – '}
                      {dateInZone(cy.end_at, COHORT_TZ) || 'end not readable'}
                    </span>
                    <span className="ml-auto text-[11.5px] text-axal-muted">
                      <span className="font-extrabold tabular-nums text-axal-ink">
                        {cy.participant_count}
                      </span>
                      {' '}
                      {cy.participant_count === 1 ? 'participant' : 'participants'}
                    </span>
                  </div>

                  {windows.length ? (
                    <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {windows.map((w) => {
                        const counts = byWeek.get(Number(w.week_number));
                        return (
                          <li
                            key={w.week_number}
                            data-testid="branch-programs-week"
                            className="rounded border border-axal-hairline px-2 py-1.5"
                          >
                            <div className="text-[11px] font-extrabold uppercase tracking-[.07em] text-axal-muted">
                              Week {w.week_number}
                            </div>
                            <div className="text-[11.5px] text-axal-ink">
                              closes {inZone(w.deadline_at, COHORT_TZ) || 'at a time that could not be read'}
                            </div>
                            {/* A WEEK NOBODY HAS BEEN JUDGED IN IS NOT A WEEK
                                EVERYONE PASSED, so it says so rather than
                                printing zeroes. */}
                            {counts && !tallyReadable(counts) && (
                              <div className="mt-0.5 text-[11.5px] text-axal-muted" data-testid="branch-programs-week-unreadable">
                                its outcome could not be read
                              </div>
                            )}
                            {counts && tallyReadable(counts) && (
                              <div className="mt-0.5 text-[11.5px] text-axal-muted">
                                {Object.entries(counts)
                                  .map(([k, n]) => `${n} ${k}`)
                                  .join(' · ')}
                              </div>
                            )}
                            {!counts && (
                              <div className="mt-0.5 text-[11.5px] text-axal-muted">
                                no outcome recorded yet
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="mt-2">
                      <Unrecorded reason="This cycle has no week windows on this deployment, so its four deadlines cannot be shown.">
                        No week windows
                      </Unrecorded>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </Card>

      {/* ── What this branch decides ───────────────────────────────────── */}
      <Card className="mt-4 p-4" data-testid="branch-programs-decides">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-axal-muted" aria-hidden="true" />
          <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">
            What this branch decides
          </h2>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-axal-muted">
          Per company, per week, and both are audited: <strong className="text-axal-ink">grace</strong>{' '}
          extends one company&rsquo;s week by 1&ndash;168 hours and the reason is mandatory, and{' '}
          <strong className="text-axal-ink">override</strong> records an outcome the deliverables did
          not produce. Each writes through the same path into{' '}
          <code className="text-[11px]">company_week_status</code> and the stage transition log, so a
          decision made here reads the same way everywhere it is shown.
        </p>
        <p className="mt-2 text-[11.5px]">
          <Link
            to="/admin/spinout-lab"
            className="font-semibold text-axal-ink underline underline-offset-2"
            data-testid="branch-programs-timing-link"
          >
            Open the timing console
          </Link>
          <span className="text-axal-muted">
            {' '}&mdash; it is a tab of the Spin-Out Lab console rather than a page of its own, and
            it is where both decisions are actually made.
          </span>
        </p>
      </Card>

      {/* ── Assessment ─────────────────────────────────────────────────── */}
      <Card className="mt-4 p-4" data-testid="branch-programs-assessment">
        <div className="flex items-center gap-2">
          <Gamepad2 className="h-4 w-4 text-axal-muted" aria-hidden="true" />
          <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Assessment</h2>
        </div>

        <p className="mt-1 text-[11.5px] text-axal-muted" data-testid="branch-programs-authoring">
          Results are this territory&rsquo;s; the questions are not. Authoring an assessment &mdash;
          games, chapters, items, archetypes, badges &mdash; is refused on a branch and belongs to
          HQ, so changing a question is a Content submission rather than an edit here.
        </p>

        {games === null ? (
          <p className="mt-3 text-[12px] text-axal-muted">Reading the games&hellip;</p>
        ) : null}

        {games === UNAVAILABLE ? (
          <div className="mt-3" data-testid="branch-programs-games-unreadable">
            <Unreadable
              what="the assessment games"
              claim="This is not a claim that no game is published — the list could not be read."
              onRetry={loadGames}
            />
          </div>
        ) : null}

        {gamesReady && !gameRows.length ? (
          <p className="mt-3 text-[11.5px] text-axal-muted" data-testid="branch-programs-no-game">
            <Unrecorded reason={NO_GAME_HERE}>No game on this branch</Unrecorded>
            {' '}&mdash; {NO_GAME_HERE}
          </p>
        ) : null}

        {gamesReady && gameRows.length ? (
          <ul className="mt-3 space-y-2">
            {gameRows.map((g) => (
              <li
                key={g.slug || g.id}
                data-testid="branch-programs-game"
                className="flex flex-wrap items-baseline gap-x-2 rounded border border-axal-hairline px-3 py-2"
              >
                <span className="text-[12.5px] font-extrabold text-axal-ink">
                  {g.title || g.name || g.slug}
                </span>
                <span className="text-[11px] font-extrabold uppercase tracking-[.07em] text-axal-muted">
                  {g.status || 'status not recorded'}
                </span>
                {g.version === null || g.version === undefined ? null : (
                  <span className="text-[11.5px] text-axal-muted">v{g.version}</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-3" data-testid="branch-programs-runs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[12px] font-extrabold text-axal-ink">Runs</h3>
            {cycles.length ? (
              <select
                value={activeCycle}
                onChange={(e) => setCyclePick(e.target.value)}
                aria-label="Cycle"
                data-testid="branch-programs-cycle-filter"
                className="rounded-lg border border-axal-hairline bg-axal-ground px-2 py-1 text-[12px]"
              >
                {cycles.map((cy) => (
                  <option key={cy.id} value={String(cy.id)}>
                    {cycleLabel(cy.year, cy.month) || `Cycle ${cy.id}`}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <p className="mt-1 text-[11.5px] text-axal-muted" data-testid="branch-programs-runs-gap">
            A run is kept in a cycle when its start falls inside that cycle. There is no separate
            list of results.
          </p>
          {timeline === null || runs === null ? (
            <p className="mt-2 text-[12px] text-axal-faint">Reading runs…</p>
          ) : runs === UNAVAILABLE || runs.available === false ? (
            <div className="mt-2" data-testid="branch-programs-runs-unreadable">
              <Unreadable
                what="assessment runs"
                claim={runs && runs !== UNAVAILABLE && runs.reason
                  ? runs.reason
                  : 'This is not a claim that nobody has taken an assessment.'}
                onRetry={() => loadRuns(activeCycle || undefined)}
              />
            </div>
          ) : runs.cycle_found === false || runs.filterable === false ? (
            <p className="mt-2 text-[12px]" data-testid="branch-programs-runs-unfiltered">
              <Unrecorded reason={runs.reason || 'This cycle cannot limit the list.'}>
                Not listed for this cycle
              </Unrecorded>
            </p>
          ) : !runs.items.length ? (
            <p className="mt-2 text-[12px] text-axal-muted" data-testid="branch-programs-runs-empty">
              {runs.filtered
                ? 'No assessment run started inside this cycle. The list was read and it is empty.'
                : 'No assessment run is recorded on this database. The list was read and it is empty.'}
            </p>
          ) : (
            <ul className="mt-2 space-y-2" data-testid="branch-programs-run-rows">
              {runs.items.map((row) => (
                <li
                  key={row.public_id || `${row.game_slug}-${row.started_at}`}
                  className="rounded border border-axal-hairline px-3 py-2 text-[12px]"
                >
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <span className="font-semibold">{row.user_name || row.user_email || 'Name not recorded'}</span>
                    <span>{row.game_slug || 'game not recorded'}</span>
                    <span className="uppercase tracking-[.06em] text-axal-muted">{row.status || 'status not recorded'}</span>
                    <span className="text-axal-muted">{row.started_at || 'start not recorded'}</span>
                  </div>
                  <p className="mt-1 text-[11.5px] text-axal-muted">
                    {row.archetype_label
                      ? row.archetype_label
                      : <Unrecorded reason="No result row was written for this run.">No result</Unrecorded>}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {runs && runs !== UNAVAILABLE && runs.truncated ? (
            <p className="mt-2 text-[10.5px] text-axal-faint">Showing the 200 most recent.</p>
          ) : null}
        </div>
      </Card>
    </BranchZone>
  );
}
