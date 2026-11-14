/**
 * D4817 part 3 (#5311, canvas PF-03 and PF-03b): the investor's Performance,
 * in the shared Portfolio frame (`tab="performance"`), at
 * `/portfolio/performance`.
 *
 * In the canvas's order: the performance summary (the Overview's own part,
 * `PerformanceSummary`), then NAV at each quarter-end as a chart or a table
 * of the same reads, beside the methodology; then vintage cohorts (addendum
 * PFA07) and the doors to company history and Exit Waterfall.
 *
 * Each quarter-end is its own read of `/api/positions/analytics?as_of=`. The
 * series runs from the first quarter of the first cheque's year to the
 * reporting read's last completed quarter (the Worker's date, never the
 * browser's), at most two years. A quarter-end that answers with no book is
 * Not recorded; one that fails is Unreadable with a Retry of its own. Neither
 * is drawn, and nothing is drawn between two reads.
 *
 * D6208 (#6208): the header's Export writes the quarter-end series (a gap
 * written as Not recorded or Unreadable, never 0) or the vintage cohorts,
 * through `exportView`; over nothing loaded it is disabled with its reason.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import { ZoneHeaderTools } from '../../workspaces/ZoneHeader';
import PortfolioFrame from '../portfolio/PortfolioFrame';
import { usePortfolioReads } from '../portfolio/usePortfolioReads';
import { PerformanceSummary, Skeleton, SourceFailure } from '../portfolio/PortfolioParts';
import { QuarterEndPlot, QuarterEndTable } from '../portfolio/QuarterEndChart';
import {
  DEFINITIONS, NOT_RECORDED, SHAPES, cohortExportOf, cohortsOf, performanceOf, quarterExportOf, quarterSeriesOf, quarterShape, quarterWindowOf,
} from '../portfolio/portfolioModel';
import PortfolioExport from '../portfolio/PortfolioExport';

const SOURCES = {
  analytics: { call: () => api.positionsAnalytics(), shape: SHAPES.analytics },
  positions: { call: () => api.positionsList(), shape: SHAPES.positions },
  compliance: { call: () => api.positionsKpiCompliance(), shape: SHAPES.compliance },
};

const SOURCE_NAMES = { analytics: 'Performance', positions: 'Positions', compliance: 'Reporting' };

/** What the platform computes today (`portfolioMetrics.ts`, `/api/positions/analytics`). */
const METHODOLOGY = [
  ['TVPI', DEFINITIONS.tvpi],
  ['DPI', DEFINITIONS.dpi],
  ['RVPI', DEFINITIONS.rvpi],
  ['IRR', 'XIRR on dated contributions and distributions, with NAV as the terminal value. Reads Unavailable, with the reason, when no rate solves; never 0%.'],
  ['NAV', 'Σ the latest mark per company on or before the as-of date; a company with no usable mark carries at cost.'],
  ['Paid-in', 'Σ recorded contributions dated on or before the as-of date.'],
  ['Distributed', 'Σ recorded distributions dated on or before the as-of date.'],
  ['Mark coverage', 'Positions with a usable mark, out of every position held at that date.'],
  ['Quarter-ends', 'Each point is the book read as of that quarter-end. A quarter-end with no book, or one that could not be read, is a gap: no bar, no zero, no line across it.'],
  ['Basis', 'Gross of fees and carry: management fees, carry and fund expenses are not deducted, so these are not net returns.'],
];

/**
 * NAV at each quarter-end: one read per quarter-end, each committed and
 * retried on its own. The series is handed up (`onSeries`) because the
 * header's Export writes it (D6208).
 */
function QuarterEndSeries({ dates, view, onSeries }) {
  const sources = useMemo(
    () => Object.fromEntries(dates.map((d) => [d, { call: () => api.positionsAnalytics(d), shape: quarterShape(d) }])),
    [dates],
  );
  const { reads, retry } = usePortfolioReads(sources);
  const series = useMemo(() => quarterSeriesOf(dates, reads), [dates, reads]);
  useEffect(() => { onSeries(series); }, [series, onSeries]);
  const failed = series.points.filter((p) => p.state === 'unreadable');
  const missing = series.points.filter((p) => p.state === 'not_recorded');
  return (
    <>
      {series.change ? (
        <p className="pf-sm" data-testid="perf-change">NAV {series.change.text} from {series.change.from} to {series.change.to}.</p>
      ) : null}
      {view === 'table' ? <QuarterEndTable series={series} onRetry={retry} /> : <QuarterEndPlot series={series} />}
      {failed.length ? (
        <p className="pf-partial" data-testid="perf-quarters-unreadable">
          {failed.length === 1 ? `${failed[0].label} could not be read` : `${failed.length} quarter-ends could not be read`}; {failed.length === 1 ? 'it is' : 'they are'} a gap, not a zero.
          {' '}<button type="button" className="pf-link-button" onClick={() => failed.forEach((p) => retry(p.date))} data-testid="button-retry-perf-quarters">Retry</button>
        </p>
      ) : null}
      <p className="pf-foot">
        Quarter-end reads only; nothing is drawn between them.
        {missing.length ? ` ${missing.length === 1 ? 'One quarter-end holds' : `${missing.length} quarter-ends hold`} no recorded book and ${missing.length === 1 ? 'reads' : 'read'} ${NOT_RECORDED}.` : ''}
        {view === 'table' ? ' The chart draws these same rows.' : ' Table shows the same figures, row by row.'}
      </p>
    </>
  );
}

function QuarterEnds({ window: win, retry, refresh, onSeries }) {
  const [view, setView] = useState('chart');
  let body;
  if (win.state === 'loading') body = <Skeleton rows={3} />;
  else if (win.state === 'unreadable') {
    body = <SourceFailure what="The quarter-end series" claim={win.reason} onRetry={() => retry(win.retry)} testid="status-perf-quarters-unreadable" retryTestid="button-retry-perf-window" />;
  } else if (win.state !== 'ok') {
    body = <p className="pf-note" data-testid="perf-quarters-not-recorded"><span className="pf-not-recorded">{NOT_RECORDED}</span> · {win.reason}</p>;
  } else {
    body = <QuarterEndSeries key={`${win.dates.join(',')}#${refresh}`} dates={win.dates} view={view} onSeries={onSeries} />;
  }
  return (
    <section className="pf-card" aria-labelledby="pf-quarters-title" data-testid="perf-quarters">
      <div className="pf-card-head">
        <div>
          <h2 id="pf-quarters-title">NAV at each quarter-end</h2>
          {win.state === 'ok' ? (
            <p className="pf-sm">
              {win.dates.length} quarter-end{win.dates.length === 1 ? '' : 's'} through the last completed quarter
              {win.earlier ? ` · ${win.earlier} earlier not shown` : ''}
            </p>
          ) : null}
        </div>
        {win.state === 'ok' ? (
          <div className="pf-seg" role="group" aria-label="View">
            <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')} data-testid="button-perf-view-chart">Chart</button>
            <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')} data-testid="button-perf-view-table">Table</button>
          </div>
        ) : null}
      </div>
      {body}
    </section>
  );
}

function Methodology() {
  return (
    <section className="pf-card" id="portfolio-methodology" tabIndex={-1} aria-labelledby="pf-method-title" data-testid="perf-methodology">
      <div className="pf-card-head"><h2 id="pf-method-title">Methodology</h2></div>
      <dl className="pf-kv">
        {METHODOLOGY.map(([term, text]) => <div key={term}><dt>{term}</dt><dd>{text}</dd></div>)}
      </dl>
      <p className="pf-foot">These definitions describe what the platform computes today, from recorded positions, marks and distributions. No figure is estimated or filled in by a model.</p>
    </section>
  );
}

function Cohorts({ cohorts, onRetry }) {
  let body;
  if (cohorts.state === 'loading') body = <Skeleton rows={2} />;
  else if (cohorts.state === 'unreadable') body = <SourceFailure what="Positions" claim="No cohort or zero is shown in its place." onRetry={onRetry} testid="status-perf-cohorts-unreadable" />;
  else if (cohorts.state !== 'ok') body = <p className="pf-note"><span className="pf-not-recorded">{NOT_RECORDED}</span> · {cohorts.reason}</p>;
  else {
    body = (
      <div className="pf-table-wrap">
        <table className="pf-table" data-testid="perf-cohorts">
          <caption>Grouped by the year of the first cheque · latest recorded marks · gross</caption>
          <thead><tr>
            <th scope="col">Vintage</th><th scope="col" className="n">Companies</th><th scope="col" className="n">Invested</th>
            <th scope="col" className="n">Carrying value</th><th scope="col" className="n">Carrying ÷ invested</th>
          </tr></thead>
          <tbody>
            {cohorts.rows.map((r) => (
              <tr key={r.key} data-testid={`perf-cohort-${r.key}`}>
                <th scope="row" data-label="Vintage">{r.vintage}</th>
                <td className="n" data-label="Companies">{r.companies}</td>
                <td className="n" data-label="Invested">{r.invested}</td>
                <td className="n" data-label="Carrying value">{r.carrying}{r.atCost ? <small>{r.atCost} at cost</small> : null}</td>
                <td className="n" data-label="Carrying ÷ invested">{r.multiple || <span className="pf-not-recorded">{NOT_RECORDED}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <section className="pf-card pf-table-card" aria-labelledby="pf-cohorts-title">
      <div className="pf-card-head"><h2 id="pf-cohorts-title">Vintage cohorts</h2></div>
      {body}
      <p className="pf-foot">
        Distributions are not recorded per company on the positions read, so a cohort shows carrying value ÷ invested, not TVPI.
        {cohorts.undated ? ` ${cohorts.undated} position${cohorts.undated === 1 ? '' : 's'} with no first-cheque date ${cohorts.undated === 1 ? 'is' : 'are'} in no cohort.` : ''}
      </p>
    </section>
  );
}

export default function InvestorPortfolioPerformance() {
  const { reads, retry, reload } = usePortfolioReads(SOURCES);
  const [refresh, setRefresh] = useState(0);
  const perf = useMemo(() => performanceOf(reads.analytics, reads.positions), [reads.analytics, reads.positions]);
  const win = useMemo(() => quarterWindowOf(reads.positions, reads.compliance), [reads.positions, reads.compliance]);
  const cohorts = useMemo(() => cohortsOf(reads.positions), [reads.positions]);
  const failed = Object.entries(SOURCE_NAMES).filter(([k]) => reads[k].state === 'unreadable').map(([, n]) => n);
  const [series, setSeries] = useState(null);
  // A series belongs to the window it was read for; a new window waits for its own.
  const current = series && win.state === 'ok' && series.points.map((p) => p.date).join(',') === win.dates.join(',') ? series : null;
  const exports = [
    { key: 'quarters', label: 'Quarter-end series', zone: 'performance-quarter-ends', plan: quarterExportOf(win, current, reads.analytics) },
    { key: 'cohorts', label: 'Vintage cohorts', zone: 'performance-cohorts', plan: cohortExportOf(cohorts) },
  ];

  return (
    <PortfolioFrame
      tab="performance"
      testid="investor-portfolio-performance"
      description="Returns with their basis, NAV at each quarter-end, and how each figure is computed."
      context={perf.asOf ? `Gross of fees and carry · ${perf.asOf.replace(/^As of/, 'as of')}` : null}
      tools={(
        <ZoneHeaderTools role="investor">
          <PortfolioExport choices={exports} testid="button-export-portfolio-performance" />
          <button type="button" className="pf-icon-button" onClick={() => { reload(); setRefresh((n) => n + 1); }} aria-label="Refresh performance" data-testid="button-refresh-investor-performance"><RefreshCw size={15} aria-hidden="true" /></button>
        </ZoneHeaderTools>
      )}
      notice={failed.length ? (
        <p className="pf-partial" data-testid="status-investor-performance-partial">{failed.join(', ')} could not be read. Each affected panel says so; the others are current.</p>
      ) : null}
      rail={(
        <WorkerRail
          workspace="Portfolio"
          role="investor"
          className="pf-rail"
          data-testid="investor-performance-rail"
          note="Performance is read from your recorded positions, marks and distributions. Nothing here is estimated, and no figure is filled in by a model."
        />
      )}
    >
      <PerformanceSummary perf={perf} loading={reads.analytics.state === 'loading'} onRetry={() => retry('analytics')} methodologyTo="#portfolio-methodology" />
      <div className="pf-perf-grid">
        <QuarterEnds window={win} retry={retry} refresh={refresh} onSeries={setSeries} />
        <Methodology />
      </div>
      <Cohorts cohorts={cohorts} onRetry={() => retry('positions')} />
      <section className="pf-card" aria-labelledby="pf-tools-title">
        <div className="pf-card-head"><h2 id="pf-tools-title">Company history and other tools</h2></div>
        <p className="pf-foot">A company’s marks, with their dates and basis, are on Positions. Exit Waterfall models proceeds at an exit value you choose.</p>
        <div className="pf-tools">
          <Link className="pf-btn" to="/portfolio/positions" data-testid="link-perf-positions">Positions and mark history <ArrowUpRight size={13} aria-hidden="true" /></Link>
          <Link className="pf-btn" to="/portfolio/waterfall" data-testid="link-perf-waterfall">Exit Waterfall <ArrowUpRight size={13} aria-hidden="true" /></Link>
        </div>
      </section>
      <p className="pf-boundary">Investor workspace. Data shown is restricted to this investor’s accessible position book.</p>
    </PortfolioFrame>
  );
}
