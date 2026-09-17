import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Gamepad2, SlidersHorizontal } from 'lucide-react';
import { api, adminAssessment } from '../../lib/api';
import { reportError } from '../../lib/log';
import { COHORT_TZ } from '../../lib/spinoutLab';
import { inZone, dateInZone } from '../../lib/zoneTime';
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
 * ASSESSMENT SHIPS AS ANALYTICS, NOT AS RUNS, AND THE DIFFERENCE IS STATED.
 * `admin_assessment.ts` has 23 routes and **17 of them are behind
 * `requireHqAuthoring`** (D106) — authoring is HQ's, and asking a branch admin
 * to press a button that 403s is the same lie as the date picker. Of the six
 * that are not, this page uses two: the game list and per-game analytics. What
 * it cannot draw is the artboard's "assessment **runs**": there is **no
 * `GET /sessions` and no `GET /results`** anywhere in that file, and the one
 * session-shaped route, `POST /sessions/:id/rescore`, needs a `public_id` no
 * console surfaces — so a table of runs would have nothing to read.
 *
 * EVERY DEADLINE CARRIES ITS ZONE. The programme runs on `COHORT_TZ` —
 * America/New_York — for every territory, and a branch admin reads this page
 * somewhere else. The constant is imported from `lib/spinoutLab.js` rather than
 * typed a third time, and the test pins it equal to the worker's
 * `services/cohortTiming.ts` so the two cannot drift.
 */

const UNAVAILABLE = Symbol('unavailable');

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * A cycle's human name. `month` is 1-based in `cohort_cycles`.
 *
 * THE EMPTY VALUES ARE REJECTED BEFORE THE NUMERIC CHECK, and that ordering is
 * the whole guard: `Number(null)` is `0` and `Number('')` is `0`, both finite,
 * so a `Number.isFinite` test alone lets a missing year through and the page
 * renders "October null". Caught by its own test before it shipped.
 */
export function cycleLabel(year, month) {
  if (year === null || year === undefined || year === '') return null;
  const y = Number(year);
  const m = Number(month);
  if (!Number.isFinite(y) || !Number.isInteger(m)) return null;
  const name = MONTHS[m - 1];
  if (!name) return null;
  return `${name} ${y}`;
}

/**
 * The per-week status counts, folded from the payload's flat rows.
 *
 * EXPORTED so the test reads the fold rather than restating it. `status_counts`
 * arrives as `[{week_number, status, n}]` — one row per (week, status) pair —
 * and a week with no rows at all is a week nobody has been judged in, which is
 * different from a week where everyone passed. It returns `null` for that week
 * rather than an object of zeroes.
 */
export function statusesByWeek(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const wk = Number(r.week_number);
    if (!Number.isFinite(wk)) continue;
    const bucket = out.get(wk) || {};
    bucket[String(r.status)] = Number(r.n) || 0;
    out.set(wk, bucket);
  }
  return out;
}

export default function BranchPrograms({ user }) {
  const [timeline, setTimeline] = useState(null);
  const [games, setGames] = useState(null);

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
  // `{ games: [...] }` is the shape the route returns. No second key is read:
  // a fallback to a shape the server does not send is a guess that looks
  // like defensiveness and hides the day the payload actually changes.
  const gameRows = gamesReady ? (games.games || []) : [];

  // WHAT THE RAIL MAY SAY (D126): only what this page actually loaded. A failed
  // read contributes no line rather than a zero.
  const coverage = [];
  if (timelineReady) coverage.push(['Cohort cycles', `${cycles.length} most recent`]);
  if (gamesReady) coverage.push(['Assessment games', String(gameRows.length)]);

  const unavailable = [
    ['Assessment runs', 'No admin route lists assessment sessions or results — there is no '
      + 'GET /sessions and no GET /results on the worker, so a table of runs would have nothing '
      + 'to read. Per-game analytics is what exists.'],
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
          company&rsquo;s week, and the assessment games running under it. Authoring stays at HQ.
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
                            {counts ? (
                              <div className="mt-0.5 text-[11.5px] text-axal-muted">
                                {Object.entries(counts)
                                  .map(([k, n]) => `${n} ${k}`)
                                  .join(' · ')}
                              </div>
                            ) : (
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
          <div className="mt-3">
            <Unrecorded reason="No assessment game has been authored at HQ yet, so there is none to run here.">
              No game to show
            </Unrecorded>
          </div>
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

        {/* THE GAP, NAMED WHERE A READER MEETS IT rather than in the rail
            alone — the artboard draws a table of runs and there is no route
            that lists one. */}
        <p className="mt-3 text-[11.5px] text-axal-muted" data-testid="branch-programs-runs-gap">
          Individual assessment runs are not listed: no admin route returns sessions or results, so
          a table of them here would have nothing behind it. Per-game analytics is what the worker
          can answer.
        </p>
      </Card>
    </BranchZone>
  );
}
