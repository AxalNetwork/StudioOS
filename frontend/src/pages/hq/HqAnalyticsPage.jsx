import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, LineChart } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { weekLabel } from '../../lib/weeklyChart';
import { useViewAsBranch } from '../../contexts/ViewAsBranchContext';
import WeeklyLineChart from '../../components/WeeklyLineChart';
import { RangePills, KpiTile, NotRecordedCard, rangeLabel, signed } from '../../components/AnalyticsParts';
import { Card, WorkerRail, Unrecorded, Unreadable } from '../../ui';

/**
 * HQ · Analytics — one line per branch, and one for HQ's own deployment (H15,
 * D210).
 *
 * ONE FIGURE IS MEASURED HERE AND THE PAGE SAYS SO. The canvas draws four KPIs
 * and five cards; the platform records what one of them needs. Active accounts
 * per week comes from Analytics Engine, the dataset every Worker writes a row
 * to per metered request, read by `GET /api/admin/hq/analytics` under the SAME
 * definition a branch's own page uses (`services/activeAccounts.ts`). The
 * other four — activation, approval age, token spend, revenue by stream — are
 * named by the server with their reasons, and each is drawn as a stated
 * absence rather than a chart of nothing.
 *
 * A MISSING WEEK IS NEVER A ZERO. The server sends `null` for a week it cannot
 * count and says why (a capped read, a week older than the store, a line with
 * no rows, a week before the line began); `WeeklyLineChart` breaks the line
 * there rather than drawing it to the axis. After a line's first request, a
 * week with nobody in it IS a measured zero, and is drawn as one.
 *
 * A SUSPENDED BRANCH'S LINE CONTINUES, DASHED. The canvas ends Iberia's line at
 * its suspension. Suspension freezes approval writes; it does not stop people
 * signing in, so the store keeps counting them and the line keeps its weeks.
 *
 * NOT SCOPED BY THE VIEW-AS OVERLAY, and the page says so: every branch is
 * already its own line, and narrowing the chart to one would hide the
 * comparison it exists for.
 *
 * REACHED FROM HQ HOME by a literal link on the Accounts tile, and lit under
 * the Home row (H15's own nav): the HQ group is eleven rows by design (D146).
 */

export const UNAVAILABLE = Symbol('unavailable');

/** HQ's own line wears the tier's oxblood; branches take the palette in order. */
const HQ_LINE = 'text-rose-900 dark:text-rose-300';
const BRANCH_LINES = [
  'text-sky-700 dark:text-sky-300',
  'text-emerald-700 dark:text-emerald-300',
  'text-amber-700 dark:text-amber-300',
  'text-violet-700 dark:text-violet-300',
  'text-teal-700 dark:text-teal-300',
  'text-fuchsia-700 dark:text-fuchsia-300',
  'text-indigo-700 dark:text-indigo-300',
  'text-lime-700 dark:text-lime-300',
];

export function seriesColor(series, index) {
  if (series?.kind === 'hq') return HQ_LINE;
  return BRANCH_LINES[Math.max(0, index - 1) % BRANCH_LINES.length];
}

/** Suspension does not end a line (D210); it changes how the line is drawn. */
export function isSuspended(series) {
  return series?.status === 'suspended';
}

/** The one flag a legend row carries, or none. */
export function seriesFlag(series) {
  if (series?.kind === 'unregistered') return 'unregistered';
  if (isSuspended(series)) {
    const since = String(series.suspended_at || '').slice(0, 10);
    return since ? `suspended since ${since}` : 'suspended';
  }
  return null;
}

/**
 * The reason a figure is not recorded, as the SERVER wrote it. While the page
 * loads there is no reason yet, and after a failed read there is none to show.
 */
export function notRecordedReason(data, key) {
  if (data === UNAVAILABLE) return 'The analytics could not be read, so neither could this reason.';
  const hit = data ? (data.not_recorded || []).find((n) => n.key === key) : null;
  return hit ? hit.reason : 'Reading the analytics…';
}

/**
 * What the rail may read back (D126): only what this page loaded, and a read
 * that failed contributes no line rather than a zero.
 */
export function hqAnalyticsCoverage(data) {
  const ready = Boolean(data) && data !== UNAVAILABLE;
  const aa = ready ? data.active_accounts : null;
  const kpi = aa && aa.available ? aa.kpi : null;
  return [
    kpi && kpi.value !== null
      ? `Active accounts, week of ${kpi.week}: ${kpi.value} across ${kpi.counted} of ${kpi.total} lines`
      : null,
    kpi && kpi.value === null ? `Active accounts, week of ${kpi.week}: no line recorded a value` : null,
    aa && aa.available ? `${aa.series.length} lines drawn over ${data.weeks.length} weeks` : null,
    aa && aa.available && aa.sampled ? 'The metrics store sampled this read, so each count is a floor' : null,
    aa && aa.available && !aa.complete ? `The read stopped at its cap of ${aa.row_cap} rows` : null,
    ready && data.registry && data.registry.readable ? `${data.registry.count} branches in the registry` : null,
  ].filter(Boolean);
}

function SectionHead({ title, sub }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-[14px] font-extrabold tracking-tight">{title}</h2>
      {sub && <span className="text-[11px] text-axal-faint">{sub}</span>}
    </div>
  );
}

/**
 * The legend: a line's name, its figure for the last complete week, and one
 * flag. A line with no figure that week says why, in the server's words.
 */
export function SeriesLegend({ series, weeks }) {
  const last = weeks.length - 2;
  return (
    <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2" data-testid="h15-legend">
      {series.map((s, i) => {
        const value = s.values[last];
        const flag = seriesFlag(s);
        const color = seriesColor(s, i);
        return (
          <li key={s.code} className="text-[12px] leading-snug" data-testid="h15-legend-row" data-series={s.code}>
            <div className="flex flex-wrap items-center gap-x-2">
              <span
                aria-hidden="true"
                className={`inline-block w-4 border-t-2 border-current ${isSuspended(s) ? 'border-dashed' : ''} ${color}`}
              />
              <span className="font-semibold text-axal-ink">{s.label}</span>
              <span className="font-mono tabular-nums text-axal-ink">
                {value === null || value === undefined ? <Unrecorded reason={s.gap_reason} /> : value}
              </span>
              {flag && (
                <span
                  className="rounded border border-axal-hairline px-1 text-[10px] font-bold uppercase tracking-[.06em] text-axal-muted"
                  data-testid="h15-legend-flag"
                >
                  {flag}
                </span>
              )}
            </div>
            {s.note && <p className="mt-0.5 text-[11px] text-axal-faint">{s.note}</p>}
            {s.gap_reason && <p className="mt-0.5 text-[11px] text-axal-faint" data-testid="h15-legend-gap">{s.gap_reason}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The KPI row. One figure is measured and three are named absences, each
 * carrying the server's own reason — the same four tiles in every state the
 * payload can be in, so a failed metrics read still says which figure it took.
 */
export function HqKpis({ data }) {
  const aa = data.active_accounts;
  const kpi = aa.available ? aa.kpi : null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="h15-kpis">
      <KpiTile
        label="Active accounts"
        value={kpi ? kpi.value : null}
        reason={kpi ? kpi.reason : aa.reason}
        delta={kpi && kpi.delta !== null ? `${signed(kpi.delta)} vs ${weekLabel(kpi.compare_week)}` : null}
        note={kpi ? (
          <>
            <span>Week of {weekLabel(kpi.week) || kpi.week} · {kpi.counted} of {kpi.total} lines recorded</span>
            {kpi.delta_reason && (
              <span className="mt-0.5 block" data-testid="h15-kpi-delta-reason">{kpi.delta_reason}</span>
            )}
          </>
        ) : 'The metrics store could not be read; its reason is on the chart below.'}
        testId="h15-kpi-active"
      />
      <KpiTile
        label="Activation"
        value={null}
        reason={notRecordedReason(data, 'activation')}
        note="Not recorded. The reason is on its card below."
        testId="h15-kpi-activation"
      />
      <KpiTile
        label="Median approval age"
        value={null}
        reason={notRecordedReason(data, 'approval_age')}
        note="Not recorded. The reason is on its card below."
        testId="h15-kpi-approval-age"
      />
      <KpiTile
        label="Token spend"
        value={null}
        reason={notRecordedReason(data, 'token_spend')}
        note="Not recorded. The reason is on its card below."
        testId="h15-kpi-token-spend"
      />
    </div>
  );
}

/** The chart card, in each of the states the payload can be in. */
export function ActiveAccountsCard({ data }) {
  const aa = data.active_accounts;
  return (
    <Card data-testid="h15-chart">
      <SectionHead
        title="Active accounts · weekly, per branch"
        sub={`${rangeLabel(data.range) || data.range} · the platform's metrics store`}
      />
      {!aa.available && (
        <div data-testid="h15-active-unavailable">
          <Unrecorded reason={aa.reason} />
          <p className="mt-1 text-[11.5px] leading-relaxed text-axal-muted">{aa.reason}</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-axal-muted">
            No line is drawn: a chart of an unread store would show every branch at nobody.
          </p>
        </div>
      )}
      {aa.available && (
        <>
          <WeeklyLineChart
            weeks={data.weeks}
            series={aa.series.map((s, i) => ({
              key: s.code,
              values: s.values,
              dashed: isSuspended(s),
              colorClass: seriesColor(s, i),
            }))}
            ariaLabel={`Active accounts per week for ${aa.series.length} lines, ${rangeLabel(data.range) || data.range}`}
            emptyNote="No line has a recorded week in this range."
            testId="h15-plot"
          />
          <SeriesLegend series={aa.series} weeks={data.weeks} />
          <div className="mt-3 space-y-1 border-t border-axal-hairline pt-2 text-[11px] leading-relaxed text-axal-muted">
            <p data-testid="h15-partial-week">
              The newest point is the week of {weekLabel(data.current_week) || data.current_week}, which has not
              ended: it is a count so far, drawn hollow, and will read low against every finished week.
            </p>
            {aa.sampled && <p data-testid="h15-sampled">{aa.sampled_note}</p>}
            {!aa.complete && (
              <p data-testid="h15-capped">
                The read stopped at its cap of {aa.row_cap} rows before reaching the oldest weeks, so those weeks are
                blank rather than drawn short.
              </p>
            )}
            {data.registry && data.registry.readable === false && (
              <p data-testid="h15-registry-unreadable">{data.registry.reason}</p>
            )}
            <p>{data.basis}</p>
          </div>
        </>
      )}
    </Card>
  );
}

export default function HqAnalyticsPage() {
  const [range, setRange] = useState('8w');
  const [data, setData] = useState(null); // null = reading, UNAVAILABLE = failed
  const [attempt, setAttempt] = useState(0);
  const { branch: viewAs } = useViewAsBranch();

  // ONE READ PER RANGE, AND A SUPERSEDED ONE IS DROPPED. Choosing Quarter then
  // Year quickly would otherwise let the slower quarter answer land last and
  // draw thirteen weeks under the Year pill.
  useEffect(() => {
    let current = true;
    setData(null);
    api.hqAnalytics(range).then(
      (d) => { if (current) setData(d); },
      (e) => {
        if (!current) return;
        reportError('HqAnalyticsPage:load', e);
        setData(UNAVAILABLE);
      },
    );
    return () => { current = false; };
  }, [range, attempt]);
  const retry = () => setAttempt((n) => n + 1);

  const ready = Boolean(data) && data !== UNAVAILABLE;
  const coverage = hqAnalyticsCoverage(data);

  const rail = (
    <WorkerRail
      workspace="Analytics"
      role="super_admin"
      scope="All branches"
      stance="Reads the weekly figures back"
      note="This rail reads back what the page loaded: weekly counts per branch from the platform's metrics store. It reads no account and changes nothing."
      coverage={coverage}
      coverageNote={coverage.length ? undefined
        : (data === null ? 'Reading the analytics…' : 'The analytics could not be read, so there is nothing to read back.')}
      unavailable={[
        ['Activation', notRecordedReason(data, 'activation')],
        ['Median approval age', notRecordedReason(data, 'approval_age')],
        ['Token spend against limit', notRecordedReason(data, 'token_spend')],
        ['Revenue by stream', notRecordedReason(data, 'revenue_by_stream')],
      ]}
      data-testid="hq-analytics-rail"
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6" data-testid="hq-analytics-page">
      <div className="min-w-0 space-y-4">
        <div>
          <Link to="/hq" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-muted hover:text-axal-ink">
            <ArrowLeft size={13} /> Home
          </Link>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
              <LineChart size={18} aria-hidden="true" /> Analytics
            </h1>
            <RangePills value={range} onChange={setRange} tier="hq" testId="h15-range" />
          </div>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            One line per branch, and one for HQ&rsquo;s own deployment: signed-in accounts active each week, read from
            the metrics store every Worker writes to. Counts only &mdash; no account leaves that read.
          </p>
          {viewAs && (
            <p className="mt-1.5 max-w-2xl text-[11.5px] leading-relaxed text-axal-faint" data-testid="hq-analytics-view-as">
              Viewing as {viewAs} does not narrow this page: every branch is already its own line here, and narrowing
              the chart to one would hide the comparison it is for.
            </p>
          )}
        </div>

        {data === null && <p className="text-[12.5px] text-axal-muted">Reading the analytics&hellip;</p>}
        {data === UNAVAILABLE && (
          <Unreadable what="Analytics" claim="This is not a claim that nobody is active." onRetry={retry} />
        )}

        {ready && <HqKpis data={data} />}

        {ready && <ActiveAccountsCard data={data} />}

        {ready && (
          <div className="grid gap-3 md:grid-cols-2" data-testid="h15-not-recorded">
            {(data.not_recorded || []).map((n) => (
              <NotRecordedCard key={n.key} label={n.label} reason={n.reason} testId={`h15-nr-${n.key}`} />
            ))}
          </div>
        )}

        {ready && (
          <p className="text-[11px] leading-relaxed text-axal-faint" data-testid="h15-foot">
            {data.foot} {data.source}
          </p>
        )}
      </div>

      <div className="mt-4 lg:mt-0">{rail}</div>
    </div>
  );
}
