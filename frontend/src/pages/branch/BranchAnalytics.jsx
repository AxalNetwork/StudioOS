import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { weekLabel } from '../../lib/weeklyChart';
import { bpsPercent } from '../../lib/bps';
import { titleCase } from '../../lib/absence';
import { toUtcInstant } from '../../lib/notices';
import { inZone } from '../../lib/zoneTime';
import { COHORT_TZ } from '../../lib/spinoutLab';
import { currentCycle, cycleLabel, statusesByWeek, weekOutcome, WEEK_STATUSES } from '../../lib/cohortTimeline';
import WeeklyLineChart from '../../components/WeeklyLineChart';
import { RangePills, KpiTile, NotRecordedCard, rangeLabel, signed } from '../../components/AnalyticsParts';
import { Card, Unrecorded, Unreadable } from '../../ui';
import BranchZone from './BranchZone';

/**
 * Branch · Analytics — this territory over time (S15, D210).
 *
 * EVERY FIGURE IS THIS BRANCH'S OWN, PLUS ONE MEDIAN HQ PUSHED. Active accounts
 * per week come from this branch's request log (`activity_logs`), counted under
 * the definition HQ's page counts every branch by (`services/activeAccounts.ts`
 * — one sentence, both tiers). The median is a copy HQ computed across branches
 * and pushed with its week, its `n_branches` and when it was computed, so the
 * page names all three rather than drawing a line of unknown age.
 *
 * THE MEDIAN IS FOR ONE WEEK, AND THE RULE SAYS WHICH. The canvas draws a
 * dashed median across the chart as though it held every week. HQ publishes it
 * for the last complete week only, so the caption beneath the rule names that
 * week, and the rule sits at its true value on the chart's own scale
 * (`lib/weeklyChart.js`), not at a decorative height.
 *
 * WITHHELD AND UNREADABLE ARE TWO STATES. Below three answering branches HQ
 * publishes no median, because one branch's median is that branch's own figure
 * (D148); a database without the benchmark table cannot read any. Each arrives
 * with its own sentence from the server, and neither is ever drawn as a line at
 * zero.
 *
 * GATES BY WEEK READ THE COHORT TIMELINE, and a week whose deadline has not come
 * is NOT a week everyone failed: "not yet due" is its own state, as is a passed
 * deadline with nobody judged. Counts only — the timeline's participant figure
 * is today's membership, and a rate over it would divide last month's outcomes
 * by it.
 *
 * NOT SUSPENSION-GATED. The freeze guards approval writes; a frozen branch still
 * needs to read where it stands (D130).
 *
 * REACHED FROM INSIGHTS by a literal link, and lit under the Insights row: the
 * branch sidebar is the canvas's eight rows and S15 adds none.
 */

export const UNAVAILABLE = Symbol('unavailable');

/** This branch's line wears the tier's steel. */
const STEEL_LINE = 'text-slate-700 dark:text-slate-300';

/** A median decision age's band: amber above a day, red above two. */
export function ageTone(hours) {
  if (typeof hours !== 'number' || !Number.isFinite(hours)) return null;
  if (hours > 48) return 'late';
  if (hours > 24) return 'slow';
  return null;
}
const AGE_TONE_CLASS = {
  late: 'text-rose-700 dark:text-rose-300',
  slow: 'text-amber-700 dark:text-amber-300',
};

/** When HQ computed a pushed copy, in UTC and said so. Null when unreadable. */
export function pushedLabel(stamp) {
  const norm = toUtcInstant(stamp);
  const ms = norm ? Date.parse(norm) : Number.NaN;
  if (!Number.isFinite(ms)) return null;
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function SectionHead({ title, sub }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-[14px] font-extrabold tracking-tight text-axal-ink">{title}</h2>
      {sub && <span className="text-[11px] text-axal-faint">{sub}</span>}
    </div>
  );
}

/** The four KPI tiles, each in the state the payload is in. */
export function BranchKpis({ data }) {
  const aa = data.active_accounts;
  const kpi = aa.available ? aa.kpi : null;
  const da = data.decision_age;
  const seats = data.seats;
  const noneDecided = da.available && da.median_hours === null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="s15-kpis">
      <KpiTile
        label="Active accounts"
        value={kpi ? kpi.value : null}
        reason={kpi ? kpi.reason : aa.reason}
        delta={kpi && kpi.delta !== null ? `${signed(kpi.delta)} vs ${weekLabel(kpi.compare_week)}` : null}
        note={kpi ? (
          <>
            <span>Week of {weekLabel(kpi.week) || kpi.week}</span>
            {kpi.delta_reason && (
              <span className="mt-0.5 block" data-testid="s15-kpi-delta-reason">{kpi.delta_reason}</span>
            )}
          </>
        ) : 'The request log could not be read; its reason is on the chart below.'}
        testId="s15-kpi-active"
      />
      <KpiTile
        label="Activation"
        value={null}
        reason={data.activation.reason}
        note="Not recorded. The reason is on its card below."
        testId="s15-kpi-activation"
      />
      <KpiTile
        label="Median decision age"
        value={noneDecided ? 'None decided' : (da.available ? `${da.median_hours}h` : null)}
        reason={da.reason}
        note={(
          <>
            <span>
              Referrals only · {da.available ? `${da.n} decided` : 'unread'} in the last {da.window_days} days
            </span>
            {noneDecided && <span className="mt-0.5 block">{da.reason}</span>}
            <span className="mt-0.5 block" data-testid="s15-kpi-decision-hq">Against HQ: {da.hq.reason}</span>
          </>
        )}
        testId="s15-kpi-decision-age"
      />
      <KpiTile
        label="Seat utilisation"
        value={seats.available ? `${seats.used} of ${seats.licensed}` : null}
        reason={seats.reason}
        note={seats.available ? seats.basis : seats.reason}
        testId="s15-kpi-seats"
      />
    </div>
  );
}

/** The chart, and the median rule with the week, n and stamp it carries. */
export function BranchChartCard({ data }) {
  const aa = data.active_accounts;
  const bm = data.benchmark;
  const pushed = bm.available ? pushedLabel(bm.pushed_at) : null;
  return (
    <Card data-testid="s15-chart">
      <SectionHead
        title="Active accounts · weekly"
        sub={`${rangeLabel(data.range) || data.range} · this branch's own request log`}
      />
      {!aa.available && (
        <div data-testid="s15-active-unavailable">
          <Unrecorded reason={aa.reason} />
          <p className="mt-1 text-[11.5px] leading-relaxed text-axal-muted">{aa.reason}</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-axal-muted">
            No line is drawn: a chart of an unread log would show this territory at nobody.
          </p>
        </div>
      )}
      {aa.available && (
        <>
          <WeeklyLineChart
            weeks={data.weeks}
            series={[{ key: data.branch || 'branch', values: aa.values, colorClass: STEEL_LINE }]}
            median={bm.available ? bm.median_value : null}
            ariaLabel={`Active accounts per week, ${rangeLabel(data.range) || data.range}`
              + (bm.available ? `, against HQ's median of ${bm.median_value}` : '')}
            emptyNote="No week in this range has a recorded count."
            testId="s15-plot"
          />
          <div className="mt-3 space-y-1 border-t border-axal-hairline pt-2 text-[11px] leading-relaxed text-axal-muted">
            {bm.available ? (
              <p data-testid="s15-median-note">
                Dashed rule: HQ&rsquo;s median for the week of {weekLabel(bm.week) || bm.week} &mdash;{' '}
                {bm.median_value} across {bm.n_branches} branches, computed {pushed || 'at a time that could not be read'}.
                {' '}It is that week&rsquo;s median, drawn across the chart for comparison, not a median of every week.
                {' '}
                {bm.own_value === null || bm.own_value === undefined
                  ? <span data-testid="s15-median-own">{bm.own_reason}</span>
                  : <span data-testid="s15-median-own">You, that week: {bm.own_value}.</span>}
              </p>
            ) : (
              <p data-testid="s15-median-absent">No median is drawn. {bm.reason}</p>
            )}
            {aa.gap_reason && <p data-testid="s15-gap">{aa.gap_reason}</p>}
            {aa.first_day && <p data-testid="s15-first-day">This branch&rsquo;s log begins on {aa.first_day}.</p>}
            <p data-testid="s15-partial-week">
              The newest point is the week of {weekLabel(data.current_week) || data.current_week}, which has not
              ended: it is a count so far, drawn hollow, and will read low against every finished week.
            </p>
            <p>{data.basis}</p>
            <p data-testid="s15-source">Source: {data.source}</p>
          </div>
        </>
      )}
    </Card>
  );
}

/** Approval age by queue — medians where a decision is an event, reasons where it is not. */
export function ApprovalAgeList({ rows }) {
  return (
    <Card data-testid="s15-approval-age">
      <SectionHead title="Approval age by queue" sub="median hours from submission to decision" />
      <ul className="divide-y divide-axal-hairline">
        {rows.map((q) => {
          const tone = q.available ? ageTone(q.median_hours) : null;
          return (
            <li key={q.key} className="py-2" data-testid="s15-age-row" data-queue={q.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-semibold text-axal-ink">{q.label}</span>
                {!q.available && <span className="text-[12px]"><Unrecorded reason={q.reason} /></span>}
                {q.available && q.median_hours === null && (
                  <span className="text-[12px] text-axal-muted">none decided</span>
                )}
                {q.available && q.median_hours !== null && (
                  <span
                    className={`font-mono text-[12.5px] font-bold tabular-nums ${tone ? AGE_TONE_CLASS[tone] : 'text-axal-ink'}`}
                    data-tone={tone || 'on_time'}
                  >
                    {q.median_hours}h
                  </span>
                )}
              </div>
              {q.available && q.median_hours !== null && (
                <p className="mt-0.5 text-[11px] text-axal-faint">
                  over {q.n} decision{q.n === 1 ? '' : 's'} in the last {q.window_days} days
                </p>
              )}
              {q.reason && <p className="mt-0.5 text-[11px] leading-relaxed text-axal-muted">{q.reason}</p>}
              {q.clock && (
                <p className="mt-0.5 text-[11px] text-axal-faint" data-testid="s15-age-clock">The clock is {q.clock}</p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-axal-faint">Amber above a day, red above two.</p>
    </Card>
  );
}

/** What one week gate says, in the words a reader takes it in. */
function gateSentence(outcome) {
  if (outcome.state === 'not_yet_due') return 'not yet due';
  if (outcome.state === 'no_outcome') return 'no outcome recorded';
  if (outcome.state === 'unreadable') return 'its deadline could not be read';
  const parts = WEEK_STATUSES
    .filter((s) => outcome.counts[s] !== null && outcome.counts[s] !== undefined)
    .map((s) => `${outcome.counts[s]} ${s === 'grace' ? 'in grace' : s}`);
  for (const [k, n] of Object.entries(outcome.other || {})) parts.push(`${n} ${k}`);
  return parts.join(' · ');
}

/** Gates by week for the cycle that has started, read against the SERVER's clock. */
export function WeekGates({ timeline, onRetry }) {
  let body;
  if (timeline === null) {
    body = <p className="text-[12px] text-axal-muted">Reading the cohort timeline&hellip;</p>;
  } else if (timeline === UNAVAILABLE) {
    body = (
      <Unreadable
        what="the cohort timeline"
        claim="This is not a claim that no week has an outcome."
        onRetry={onRetry}
      />
    );
  } else {
    const cycle = currentCycle(timeline.cycles, timeline.server_time);
    if (!cycle) {
      body = (
        <div data-testid="s15-gates-none">
          <Unrecorded reason="No cohort cycle has started by the server's clock." />
          <p className="mt-1 text-[11.5px] text-axal-muted">
            No cohort cycle has started by the server&rsquo;s clock, so there is no week to gate.
          </p>
        </div>
      );
    } else {
      const byWeek = statusesByWeek(cycle.status_counts);
      const windows = [...(cycle.windows || [])].sort((a, b) => Number(a.week_number) - Number(b.week_number));
      body = (
        <>
          <p className="text-[12px] text-axal-muted" data-testid="s15-gates-cycle">
            <span className="font-semibold text-axal-ink">{cycleLabel(cycle.year, cycle.month) || 'The current cycle'}</span>
            {' · '}
            {cycle.participant_count} {cycle.participant_count === 1 ? 'participant' : 'participants'} today
          </p>
          {windows.length ? (
            <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {windows.map((w) => {
                const outcome = weekOutcome(w, byWeek.get(Number(w.week_number)), timeline.server_time);
                return (
                  <li
                    key={w.week_number}
                    className="rounded border border-axal-hairline px-2 py-1.5"
                    data-testid="s15-gate"
                    data-state={outcome.state}
                  >
                    <div className="text-[11px] font-extrabold uppercase tracking-[.07em] text-axal-muted">
                      Week {w.week_number}
                    </div>
                    <div className="text-[11.5px] text-axal-ink">
                      closes {inZone(w.deadline_at, COHORT_TZ) || 'at a time that could not be read'}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-axal-muted">{gateSentence(outcome)}</div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mt-2">
              <Unrecorded reason="This cycle has no week windows on this deployment." />
              <p className="mt-1 text-[11.5px] text-axal-muted">
                This cycle has no week windows on this deployment, so its gates cannot be shown.
              </p>
            </div>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">
            Deadlines are the programme&rsquo;s, in {COHORT_TZ}. Counts, never a rate: the participant figure is
            today&rsquo;s membership, and a rate over it would divide a past week&rsquo;s outcomes by it.
          </p>
        </>
      );
    }
  }
  return (
    <Card data-testid="s15-gates">
      <SectionHead title="Gates by week" sub="the cycle under way, from the cohort timeline" />
      {body}
    </Card>
  );
}

/** Whole cents as a currency figure, for a stream that reports one. */
function cents(n, currency) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'EUR' }).format(n / 100);
  } catch {
    return `${(n / 100).toFixed(2)} ${currency || ''}`.trim();
  }
}

/** Revenue: the rate is on the licence; every stream says why it has no amount. */
export function RevenueCard({ revenue }) {
  if (!revenue.available) {
    return <NotRecordedCard label="Revenue" reason={revenue.reason} testId="s15-revenue" />;
  }
  const share = bpsPercent(revenue.share_bps);
  const keeps = bpsPercent(revenue.keeps_bps);
  return (
    <Card data-testid="s15-revenue">
      <SectionHead title="Revenue" sub={revenue.period ? `period ${revenue.period}` : null} />
      <p className="text-[13px] text-axal-ink" data-testid="s15-revenue-share">
        {share && keeps ? (
          <>HQ&rsquo;s share <strong className="tabular-nums">{share}</strong> · you keep <strong className="tabular-nums">{keeps}</strong></>
        ) : (
          <Unrecorded reason="The licence copy on this branch carries no revenue share." />
        )}
      </p>
      <ul className="mt-2 divide-y divide-axal-hairline">
        {(revenue.streams || []).map((s) => {
          const amount = s.available ? cents(s.gross_cents, s.currency) : null;
          return (
            <li key={s.stream} className="py-2" data-testid="s15-revenue-stream" data-stream={s.stream}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-semibold text-axal-ink">{titleCase(s.stream) || 'Stream'}</span>
                <span className="text-[12px] tabular-nums">
                  {amount || <Unrecorded reason={s.reason} />}
                </span>
              </div>
              {!amount && s.reason && <p className="mt-0.5 text-[11px] leading-relaxed text-axal-muted">{s.reason}</p>}
              {s.is_estimate && s.estimate_basis && (
                <p className="mt-0.5 text-[11px] leading-relaxed text-axal-faint">{s.estimate_basis}</p>
              )}
            </li>
          );
        })}
      </ul>
      {revenue.note && <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">{revenue.note}</p>}
    </Card>
  );
}

export default function BranchAnalytics({ user }) {
  const [range, setRange] = useState('8w');
  const [data, setData] = useState(null); // null = reading, UNAVAILABLE = failed
  const [attempt, setAttempt] = useState(0);
  const [timeline, setTimeline] = useState(null);

  // ONE READ PER RANGE, AND A SUPERSEDED ONE IS DROPPED, so a slow Quarter
  // answer cannot land under the Year pill.
  useEffect(() => {
    let current = true;
    setData(null);
    api.branchAnalytics(range).then(
      (d) => { if (current) setData(d); },
      (e) => {
        if (!current) return;
        reportError('BranchAnalytics:load', e);
        setData(UNAVAILABLE);
      },
    );
    return () => { current = false; };
  }, [range, attempt]);
  const retry = () => setAttempt((n) => n + 1);

  // THE TIMELINE IS ITS OWN READ, WITH ITS OWN STATE: a failed timeline must not
  // take the chart down with it, and the range does not change it.
  const loadTimeline = useCallback(() => {
    setTimeline(null);
    api.adminCohortTimeline().then(setTimeline, (e) => {
      reportError('BranchAnalytics:timeline', e);
      setTimeline(UNAVAILABLE);
    });
  }, []);
  useEffect(() => { loadTimeline(); }, [loadTimeline]);

  const ready = Boolean(data) && data !== UNAVAILABLE;
  const aa = ready ? data.active_accounts : null;
  const kpi = aa && aa.available ? aa.kpi : null;
  const bm = ready ? data.benchmark : null;
  const da = ready ? data.decision_age : null;
  const timelineReady = Boolean(timeline) && timeline !== UNAVAILABLE;
  const cycle = timelineReady ? currentCycle(timeline.cycles, timeline.server_time) : null;

  // WHAT THE RAIL MAY READ BACK (D126, D151): only what this page loaded. A read
  // that failed contributes no line rather than a zero.
  const coverage = [
    kpi && kpi.value !== null ? `Active accounts, week of ${kpi.week}: ${kpi.value}` : null,
    ready && data.seats.available ? `Seats used: ${data.seats.used} of ${data.seats.licensed}` : null,
    da && da.available && da.median_hours !== null
      ? `Referral decisions: median ${da.median_hours}h over ${da.n} in ${da.window_days} days`
      : null,
    bm && bm.available
      ? `HQ's median for the week of ${bm.week}: ${bm.median_value} over ${bm.n_branches} branches, computed ${bm.pushed_at}`
      : null,
    cycle ? `Week gates for ${cycleLabel(cycle.year, cycle.month) || 'the current cycle'}` : null,
  ].filter(Boolean);

  const unavailable = ready
    ? [
      ['Activation', data.activation.reason],
      ...data.approval_age.filter((q) => !q.available).map((q) => [`${q.label} · decision age`, q.reason]),
    ]
    : [];

  return (
    <BranchZone
      workspace="Analytics"
      user={user}
      stance="Reads this territory's weekly figures back"
      coverage={coverage}
      coverageNote={coverage.length ? undefined
        : (data === null
          ? 'Reading this territory\'s analytics…'
          : 'The analytics read did not complete, so there is nothing to read back — this is not a claim that nobody is active.')}
      unavailable={unavailable}
    >
      <div className="space-y-4" data-testid="branch-analytics-page">
        <div>
          <Link to="/branch/insights" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-muted hover:text-axal-ink">
            <ArrowLeft size={13} /> Insights
          </Link>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-semibold text-axal-ink">Analytics</h1>
            <RangePills value={range} onChange={setRange} tier="branch" testId="s15-range" />
          </div>
          <p className="mt-1 max-w-2xl text-sm text-axal-muted">
            This territory over time: who is active each week, how long decisions take, and what each week&rsquo;s
            gate recorded &mdash; read from this branch&rsquo;s own database, plus the one median HQ pushed.
          </p>
        </div>

        {data === null && <p className="text-[12.5px] text-axal-muted">Reading this territory&rsquo;s analytics&hellip;</p>}
        {data === UNAVAILABLE && (
          <Unreadable what="this territory's analytics" claim="This is not a claim that nobody is active." onRetry={retry} />
        )}

        {ready && <BranchKpis data={data} />}
        {ready && <BranchChartCard data={data} />}
        {ready && (
          <NotRecordedCard label="Activation" reason={data.activation.reason} testId="s15-nr-activation" />
        )}
        {ready && <ApprovalAgeList rows={data.approval_age} />}

        <WeekGates timeline={timeline} onRetry={loadTimeline} />

        {ready && <RevenueCard revenue={data.revenue} />}

        {ready && (
          <p className="text-[11px] leading-relaxed text-axal-faint" data-testid="s15-foot">
            {data.footer}
          </p>
        )}
      </div>
    </BranchZone>
  );
}
