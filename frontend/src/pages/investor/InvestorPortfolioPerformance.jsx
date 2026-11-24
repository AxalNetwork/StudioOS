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
 *
 * D6867 (#6867, canvas D6217 PF-13): the Statement action opens the
 * statement sheet, and `?as_of=` (a quarter-end) reads the summary as of that
 * date, so the sheet's "Open Performance as of …" lands on the figures its
 * page 1 printed. The methodology is `METHODOLOGY`, the one list the
 * statement prints word for word.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, FileText, RefreshCw } from 'lucide-react';
import { useAuth } from '../../hooks/useAuthSync';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import { ZoneHeaderTools } from '../../workspaces/ZoneHeader';
import ZoneDraft from '../../workspaces/ZoneDraft';
import PortfolioFrame from '../portfolio/PortfolioFrame';
import { usePortfolioReads } from '../portfolio/usePortfolioReads';
import { PerformanceSummary, Skeleton, SourceFailure } from '../portfolio/PortfolioParts';
import { QuarterEndPlot, QuarterEndTable } from '../portfolio/QuarterEndChart';
import StatementSheet from '../portfolio/StatementSheet';
import { METHODOLOGY } from '../portfolio/statementModel';
import {
  NOT_RECORDED, SHAPES, UNAVAILABLE, cohortExportOf, cohortsOf, day, isQuarterEnd, performanceOf, quarterExportOf, quarterSeriesOf, quarterShape, quarterWindowOf,
} from '../portfolio/portfolioModel';
import PortfolioExport from '../portfolio/PortfolioExport';

/** The page's reads; the summary is cut at `asOf` when the address names a quarter-end. */
const sourcesFor = (asOf) => ({
  analytics: asOf
    ? { call: () => api.positionsAnalytics(asOf), shape: quarterShape(asOf) }
    : { call: () => api.positionsAnalytics(), shape: SHAPES.analytics },
  positions: { call: () => api.positionsList(), shape: SHAPES.positions },
  compliance: { call: () => api.positionsKpiCompliance(), shape: SHAPES.compliance },
});

const SOURCE_NAMES = { analytics: 'Performance', positions: 'Positions', compliance: 'Reporting' };


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

/** D6206: one Distributed, DPI or TVPI cell: a figure, or the word that says why there is none. */
function ReturnCell({ cell, label }) {
  if (cell.state === 'ok') return <td className="n" data-label={label}>{cell.value}</td>;
  const cls = cell.state === 'unavailable' ? 'pf-unavailable' : 'pf-not-recorded';
  return <td className="n" data-label={label}><span className={cls} title={cell.reason}>{cell.value}</span></td>;
}

function Cohorts({ cohorts, onRetry }) {
  let body;
  if (cohorts.state === 'loading') body = <Skeleton rows={2} />;
  else if (cohorts.state === 'unreadable') body = <SourceFailure what="Positions" claim="No cohort or zero is shown in its place." onRetry={onRetry} testid="status-perf-cohorts-unreadable" />;
  else if (cohorts.state !== 'ok') body = <p className="pf-note"><span className="pf-not-recorded">{NOT_RECORDED}</span> · {cohorts.reason}</p>;
  else {
    const t = cohorts.total;
    body = (
      <div className="pf-table-wrap">
        <table className="pf-table" data-testid="perf-cohorts">
          <caption>Grouped by the year of the first cheque · latest recorded marks · gross</caption>
          <thead><tr>
            <th scope="col">Vintage</th><th scope="col" className="n">Companies</th><th scope="col" className="n">Invested</th>
            <th scope="col" className="n">Distributed</th><th scope="col" className="n">Carrying value</th>
            <th scope="col" className="n">DPI</th><th scope="col" className="n">TVPI</th>
          </tr></thead>
          <tbody>
            {cohorts.rows.map((r) => (
              <tr key={r.key} data-testid={`perf-cohort-${r.key}`}>
                <th scope="row" data-label="Vintage">{r.vintage}</th>
                <td className="n" data-label="Companies">{r.companies}</td>
                <td className="n" data-label="Invested">{r.invested}</td>
                <ReturnCell cell={r.distributed} label="Distributed" />
                <td className="n" data-label="Carrying value">{r.carrying}{r.atCost ? <small>{r.atCost} at cost</small> : null}</td>
                <ReturnCell cell={r.dpi} label="DPI" />
                <ReturnCell cell={r.tvpi} label="TVPI" />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-testid="perf-cohort-total">
              <th scope="row" data-label="Vintage">Book</th>
              <td className="n" data-label="Companies">{t.companies}</td>
              <td className="n" data-label="Invested">{t.invested}</td>
              <ReturnCell cell={t.distributed} label="Distributed" />
              <td className="n" data-label="Carrying value">{t.carrying}</td>
              <ReturnCell cell={t.dpi} label="DPI" />
              <ReturnCell cell={t.tvpi} label="TVPI" />
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }
  const dist = cohorts.state === 'ok' ? cohorts.distributions : null;
  return (
    <section className="pf-card pf-table-card" aria-labelledby="pf-cohorts-title">
      <div className="pf-card-head"><h2 id="pf-cohorts-title">Vintage cohorts</h2></div>
      {body}
      {dist && dist.state === 'unavailable' ? (
        <p className="pf-partial" data-testid="perf-cohorts-distributions-unavailable">
          {dist.reason} Distributed, DPI and TVPI are {UNAVAILABLE}; invested and carrying value are current.
          {' '}<button type="button" className="pf-link-button" onClick={onRetry} data-testid="button-retry-perf-cohorts-distributions">Retry</button>
        </p>
      ) : null}
      <p className="pf-foot" data-testid="perf-cohorts-foot">
        DPI is distributed ÷ invested; TVPI is (distributed + carrying value) ÷ invested. A cohort with nothing distributed shows $0.
        {' '}The Book row is every listed position{cohorts.undated ? `, including ${cohorts.undated} with no first-cheque date that ${cohorts.undated === 1 ? 'is' : 'are'} in no cohort` : ''}
        {cohorts.unlisted ? `, and ${cohorts.unlisted} distributed by companies with no listed position` : ''}.
      </p>
    </section>
  );
}

/** `?as_of=` names a quarter-end the statement was made for; anything else reads the latest book. */
export default function InvestorPortfolioPerformance() {
  const [params] = useSearchParams();
  const raw = params.get('as_of');
  const asOf = isQuarterEnd(raw) ? raw : null;
  return <PerformanceBody key={asOf || 'latest'} asOf={asOf} />;
}

function PerformanceBody({ asOf }) {
  const sources = useMemo(() => sourcesFor(asOf), [asOf]);
  const { reads, retry, reload } = usePortfolioReads(sources);
  const { user } = useAuth() || {};
  const [refresh, setRefresh] = useState(0);
  const [statement, setStatement] = useState(false);
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
          <button type="button" className="pf-btn" onClick={() => setStatement(true)} data-testid="button-open-statement"><FileText size={14} aria-hidden="true" /> Statement</button>
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
      {asOf ? (
        <p className="pf-partial" data-testid="perf-as-of">
          The summary is the book as of {day(asOf)}, the date of a statement. <Link to="/portfolio/performance" data-testid="link-perf-latest">Show the latest book</Link>
        </p>
      ) : null}
      <PerformanceSummary perf={perf} loading={reads.analytics.state === 'loading'} onRetry={() => retry('analytics')} methodologyTo="#portfolio-methodology" />
      <div className="pf-perf-grid">
        <QuarterEnds window={win} retry={retry} refresh={refresh} onSeries={setSeries} />
        <Methodology />
      </div>
      <Cohorts cohorts={cohorts} onRetry={() => retry('positions')} />
      {/* D6212 (#6212): a departure from D4817's PFA17, which draws no band here. */}
      <ZoneDraft
        surface="portfolio/performance"
        railOption="draft:performance-note"
        label="Proposal · what moved across the quarter-ends"
        accept="Accept note"
        run="Draft the note"
        foot="Built from the quarter-end reads above and the marks, distributions and cheques dated in each quarter. Accepting keeps the note here; nothing is sent."
        empty="A short note on what moved, citing each quarter-end and event by its date. A quarter-end with no recorded book, or a quarter with nothing recorded, is named as a gap."
        nothingToDraft="No position is recorded at a completed quarter-end, so there is nothing to explain."
      />
      <section className="pf-card" aria-labelledby="pf-tools-title">
        <div className="pf-card-head"><h2 id="pf-tools-title">Company history and other tools</h2></div>
        <p className="pf-foot">A company’s marks, with their dates and basis, are on Positions. Exit Waterfall models proceeds at an exit value you choose.</p>
        <div className="pf-tools">
          <Link className="pf-btn" to="/portfolio/positions" data-testid="link-perf-positions">Positions and mark history <ArrowUpRight size={13} aria-hidden="true" /></Link>
          <Link className="pf-btn" to="/portfolio/waterfall" data-testid="link-perf-waterfall">Exit Waterfall <ArrowUpRight size={13} aria-hidden="true" /></Link>
        </div>
      </section>
      <p className="pf-boundary">Investor workspace. Data shown is restricted to this investor’s accessible position book.</p>
      {statement ? (
        <StatementSheet
          positions={reads.positions}
          compliance={reads.compliance}
          investor={user?.name || null}
          from="Performance"
          onClose={() => setStatement(false)}
          onRetry={retry}
        />
      ) : null}
    </PortfolioFrame>
  );
}
