/**
 * Branch · Home — canvas S1, the half of it that has a source (D131).
 *
 * WHAT THIS REPLACES AND WHY THAT MATTERS. `/branch` rendered a stated notice
 * promising all six of S1's blocks as "PR 12" work. Three of the six have no
 * source, and one of those three cannot get one without inventing data — so
 * leaving the notice would have kept promising four things for as long as the
 * page existed. The notice is gone; the three real blocks ship; the three that
 * cannot be drawn are named in the rail, each with its own reason, where a
 * reader meets them instead of a promise.
 *
 * QUEUE PRESSURE IS ORDERED BY THE OLDEST ITEM, NOT BY COUNT, and the canvas is
 * explicit that these are different orders. A lane holding forty things opened
 * this morning is not more urgent than one holding a single thing nobody has
 * touched in a week, and ordering by count would put it first every time.
 *
 * AND IT READS THE **COUNT** QUERY, NOT THE BOARD'S ROWS. `approvalBoard`
 * returns a per-lane figure too, but that one counts the rows a lane RETURNED,
 * so it is `min(open, limit)` — a flooded lane would show exactly the cap,
 * every time, looking like a measurement. `laneCounts` is the unbounded read,
 * and `backlogOf` now sums the same call, so the number here and the number on
 * HQ's Home are one measurement rather than two that happen to agree.
 *
 * EVERY DEADLINE CARRIES ITS ZONE, AND THAT IS THE DEFECT THIS BLOCK AVOIDS.
 * The programme runs on America/New_York wall-clock time platform-wide, and a
 * branch admin reads the page in a territory that is not there. "Closes 23 Sep
 * 00:00" with no zone is six hours wrong for a French admin deciding whether
 * their founders still have tonight. The server names the zone; the page prints
 * it and formats in it.
 *
 * `inZone` MOVED TO `lib/zoneTime.js` IN D140 and is imported rather than
 * declared. S4's cohort calendar is its second caller, and importing one
 * page's export from another page is what `lib/README.md`'s rule forbids.
 * Nothing about the behaviour changed — the zone stays a required argument.
 *
 * THE REVENUE BLOCK SHOWS A RATE AND REFUSES AN AMOUNT. The share is a licence
 * term HQ pushed, so it is real and dated. The base it applies to is not
 * totalled anywhere on a branch — `branchRevenueSummary` establishes that for
 * all three streams — so no euro figure and no sparkline are drawn. Multiplying
 * a real rate by a missing base is how a page invents a number that looks
 * audited.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Gauge, PieChart } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { inZone } from '../../lib/zoneTime';
import { Card, Unrecorded, Unreadable } from '../../ui';
import BranchZone from './BranchZone';

const UNAVAILABLE = Symbol('unavailable');

/** The bands the server derived. Never recomputed here — one definition. */
const SLA_LABEL = { ok: null, due_soon: 'oldest due within 24h', past: 'oldest past SLA' };

const LANE_TONE = {
  past: 'border-red-300 bg-red-50/60 dark:border-red-500/40 dark:bg-red-500/5',
  due_soon: 'border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/5',
  ok: 'border-axal-hairline',
  unknown: 'border-axal-hairline',
};

/**
 * A rate held in BASIS POINTS, rendered as a percentage.
 *
 * EXPORTED so the test reads the conversion rather than restating it. 3500 bps
 * is 35%, and the ledger stores bps precisely because a rate held as a float
 * cannot be compared for equality — the page must not reintroduce that by
 * rounding to a whole number here.
 */
export function pctFromBps(bps) {
  if (bps === null || bps === undefined || !Number.isFinite(Number(bps))) return null;
  return Number(bps) / 100;
}


export default function BranchHome() {
  const [home, setHome] = useState(null);   // null = loading, UNAVAILABLE = failed

  const load = useCallback(() => {
    setHome(null);
    api.branchHome().then(setHome, (e) => {
      reportError('BranchHome:load', e);
      setHome(UNAVAILABLE);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const ready = home && home !== UNAVAILABLE;
  const lanes = ready ? (home.queue_pressure || []) : [];
  const prog = ready ? home.programme : null;
  const rev = ready ? home.revenue : null;

  /**
   * COVERAGE IS WHAT THE RAIL CAN ACTUALLY SEE, so it is derived from what
   * loaded rather than typed out. Lines only exist for lanes that ANSWERED —
   * a measured total over three of four lanes would read as the whole
   * territory's backlog, which is the claim `coverageNote` exists to refuse.
   */
  const measured = lanes.filter((l) => l.count !== null);
  const coverage = ready
    ? [
      `${measured.reduce((n, l) => n + l.count, 0)} open across ${measured.length} of ${lanes.length} local queues`,
      ...(prog && prog.open_week !== null ? [`cohort week ${prog.open_week} is open`] : []),
      ...(rev && rev.share_bps !== null ? [`revenue share ${pctFromBps(rev.share_bps)}% on your licence`] : []),
    ]
    : [];

  return (
    <BranchZone
      workspace="Home"
      stance="Read-only digest"
      coverage={coverage}
      coverageNote={coverage.length
        ? undefined
        : (home === UNAVAILABLE
          ? 'The digest could not be read, so there is nothing to read back — this is not a claim that nothing is waiting.'
          : 'Reading this territory’s digest…')}
      unavailable={(ready ? (home.unavailable || []) : []).map((u) => [u.block, u.reason])}
    >
      <header className="mb-4">
        <h1 className="text-xl font-extrabold tracking-tight text-axal-ink">Home</h1>
        <p className="mt-1 text-[12.5px] text-axal-muted">
          The territory&rsquo;s operating digest — what is waiting, what closes next, and what your
          share of it is.
        </p>
      </header>

      {home === UNAVAILABLE ? (
        <Card className="p-4">
          <Unreadable
            what="the digest"
            claim="This is not a claim that nothing is waiting — it is that the digest could not be read."
            onRetry={load}
          />
        </Card>
      ) : null}

      {/* ── Queue pressure ─────────────────────────────────────────────── */}
      <Card className="p-4" data-testid="branch-home-queue">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-axal-muted" aria-hidden="true" />
          <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Queue pressure</h2>
        </div>
        <p className="mt-1 text-[11.5px] text-axal-muted">
          Worst first, and worst means <strong>oldest</strong> — not busiest. A lane of new work is
          not more urgent than one thing nobody has answered in a week.
        </p>

        {home === null ? (
          <p className="mt-3 text-[12px] text-axal-muted">Reading the four queues&hellip;</p>
        ) : null}

        {ready && lanes.length ? (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {lanes.map((l) => (
              <li
                key={l.key}
                data-testid={`branch-home-lane-${l.key}`}
                className={`rounded-lg border p-3 ${LANE_TONE[l.sla] || LANE_TONE.ok}`}
              >
                <div className="text-[11px] font-extrabold uppercase tracking-[.07em] text-axal-muted">
                  {l.label}
                </div>
                {l.count === null ? (
                  <div className="mt-1">
                    <Unrecorded reason="This queue could not be read, so its pressure is unknown rather than nil.">
                      Not readable
                    </Unrecorded>
                  </div>
                ) : (
                  <>
                    <div className="mt-0.5 text-[20px] font-extrabold tabular-nums text-axal-ink">
                      {l.count}
                    </div>
                    <div className="text-[11.5px] text-axal-muted">
                      {l.count === 0
                        ? 'nothing waiting'
                        : l.oldest_age_hours === null
                          ? 'oldest item has no readable date'
                          : `oldest ${Math.round(l.oldest_age_hours)}h`}
                      {SLA_LABEL[l.sla] ? ` · ${SLA_LABEL[l.sla]}` : ''}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {ready && home.unreadable && home.unreadable.length ? (
          <p className="mt-3 text-[11.5px] text-axal-muted" data-testid="branch-home-queue-gap">
            {home.unreadable.join(', ')} could not be read, so {home.unreadable.length === 1 ? 'it shows' : 'they show'}
            {' '}no count rather than a zero.
          </p>
        ) : null}

        {ready ? (
          <p className="mt-3 text-[11.5px]">
            <Link to="/branch/approvals" className="font-semibold text-axal-ink underline underline-offset-2">
              Open the board
            </Link>
            <span className="text-axal-muted"> — the same four queues, item by item.</span>
          </p>
        ) : null}
      </Card>

      {/* ── Programme clock ────────────────────────────────────────────── */}
      <Card className="mt-4 p-4" data-testid="branch-home-programme">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-axal-muted" aria-hidden="true" />
          <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Programme clock</h2>
        </div>

        {home === null ? (
          <p className="mt-2 text-[12px] text-axal-muted">Reading the cycle&hellip;</p>
        ) : null}

        {ready && prog ? (
          <>
            <p className="mt-1 text-[11.5px] text-axal-muted">
              {/* THE ZONE IS PRINTED, ALWAYS. It is not the territory's, and a
                  deadline shown without it is the wrong hour rather than a
                  missing detail. */}
              Week deadlines are wall-clock times in <strong data-testid="branch-home-zone">{prog.zone}</strong>,
              the same for every territory. They are not your local time.
            </p>
            {prog.open_week === null ? (
              <div className="mt-2">
                <Unrecorded reason={prog.reason}>No week is open</Unrecorded>
              </div>
            ) : (
              <div className="mt-2">
                <div className="text-[20px] font-extrabold tabular-nums text-axal-ink">
                  Week {prog.open_week}
                </div>
                <div className="text-[11.5px] text-axal-muted">
                  closes {inZone(prog.week_closes_at, prog.zone) || 'at a time that could not be read'}
                  {prog.hours_to_close === null ? '' : ` · ${Math.round(prog.hours_to_close)}h left`}
                </div>
                <div className="mt-2 text-[12px] text-axal-ink">
                  {prog.pending_accounts === null ? (
                    <Unrecorded reason={prog.reason}>Accounts still pending unknown</Unrecorded>
                  ) : (
                    <>
                      <span className="font-extrabold tabular-nums">{prog.pending_accounts}</span>
                      {' '}
                      <span className="text-axal-muted">
                        {prog.pending_accounts === 1 ? 'account has' : 'accounts have'} not finished this week
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        ) : null}
      </Card>

      {/* ── Revenue share ──────────────────────────────────────────────── */}
      <Card className="mt-4 p-4" data-testid="branch-home-revenue">
        <div className="flex items-center gap-2">
          <PieChart className="h-4 w-4 text-axal-muted" aria-hidden="true" />
          <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Revenue share</h2>
        </div>

        {home === null ? (
          <p className="mt-2 text-[12px] text-axal-muted">Reading your licence&hellip;</p>
        ) : null}

        {ready && rev ? (
          <div className="mt-2">
            {pctFromBps(rev.share_bps) === null ? (
              <Unrecorded reason="The licence copy could not be read, so the rate on it is unknown.">
                Rate not readable
              </Unrecorded>
            ) : (
              <>
                <div className="text-[20px] font-extrabold tabular-nums text-axal-ink">
                  {pctFromBps(rev.share_bps)}%
                </div>
                <div className="text-[11.5px] text-axal-muted">
                  your share of this territory
                  {rev.as_of ? ` · as HQ pushed it ${String(rev.as_of).slice(0, 10)}` : ''}
                </div>
              </>
            )}
            {/* THE AMOUNT IS ABSENT ON PURPOSE AND SAYS SO. A month-to-date
                figure and a twelve-month sparkline are what S1 draws; neither
                has a base to compute from, and a chart of a number nobody
                measured is the most convincing wrong thing a page can show. */}
            <div className="mt-2" data-testid="branch-home-revenue-amount">
              <Unrecorded reason={rev.reason}>Month-to-date amount</Unrecorded>
            </div>
          </div>
        ) : null}
      </Card>
    </BranchZone>
  );
}
