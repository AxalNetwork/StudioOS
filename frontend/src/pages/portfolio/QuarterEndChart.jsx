/**
 * D4817 part 3 (#5311, canvas PF-03): NAV at each quarter-end as a chart or a
 * table of the same series (`quarterSeriesOf`), so the two can never show
 * different points.
 *
 *   - The chart is one image with a text alternative that names every point,
 *     gaps included. Under the plot, each quarter-end has a column with its
 *     value or the word for its gap (Not recorded, Unreadable): a gap is never
 *     a bar, a zero or a line drawn across it.
 *   - The table is the accessible equivalent: one row per quarter-end, with
 *     NAV, paid-in, distributed, TVPI and mark coverage. A gap row says why,
 *     and an unreadable one carries a Retry for that quarter-end alone.
 *
 * The bars come from `QuarterEndBars` (recharts), loaded once the plot has a
 * measured width.
 */
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { MetricValue } from './PortfolioParts';
import { chartRowsOf, moneyShort, pointWords, quarterName, seriesLabel } from './portfolioModel';

const QuarterEndBars = lazy(() => import('./QuarterEndBars.jsx'));
const PLOT_HEIGHT = 168;

/** The plot's width, measured; 0 where there is no layout (and nothing is drawn). */
function useBoxWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => setWidth(Math.floor(entries[0]?.contentRect?.width || 0)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export function QuarterEndPlot({ series }) {
  const [ref, width] = useBoxWidth();
  const n = series.points.length;
  const columns = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` };
  return (
    <div className="pf-qscroll">
      <figure className="pf-qchart" role="img" aria-label={seriesLabel(series)} data-testid="perf-chart" style={{ minWidth: `${n * 44}px` }}>
        <div className="pf-qplot" ref={ref} style={{ height: PLOT_HEIGHT }}>
          <div className="pf-qslots" style={columns}>
            {series.points.map((p) => <i key={p.date} className={p.state === 'ok' ? '' : `is-gap is-${p.state}`} />)}
          </div>
          {width > 0 && series.drawn > 0 ? (
            <Suspense fallback={null}><QuarterEndBars rows={chartRowsOf(series)} width={width} height={PLOT_HEIGHT} /></Suspense>
          ) : null}
        </div>
        <ol className="pf-qaxis" style={columns}>
          {series.points.map((p) => (
            <li key={p.date} className={`is-${p.state}`} data-testid={`perf-chart-point-${p.date}`} data-state={p.state}>
              <b title={p.state === 'ok' ? p.navText : p.reason}>{p.state === 'ok' ? moneyShort(p.nav) : pointWords(p)}</b>
              <span>{quarterName(p.date)}</span>
            </li>
          ))}
        </ol>
      </figure>
    </div>
  );
}

export function QuarterEndTable({ series, onRetry }) {
  return (
    <div className="pf-table-wrap">
      <table className="pf-table pf-qtable" data-testid="perf-table">
        <caption>Each row is the book read as of that quarter-end · gross of fees and carry</caption>
        <thead><tr>
          <th scope="col">Quarter-end</th><th scope="col" className="n">NAV</th><th scope="col" className="n">Paid-in</th>
          <th scope="col" className="n">Distributed</th><th scope="col" className="n">TVPI</th><th scope="col">Mark coverage</th>
        </tr></thead>
        <tbody>
          {series.points.map((p) => (
            <tr key={p.date} data-testid={`perf-row-${p.date}`} data-state={p.state}>
              <th scope="row" data-label="Quarter-end">{p.label}</th>
              {p.state === 'ok' ? (
                <>
                  <td className="n" data-label="NAV">{p.navText}</td>
                  <td className="n" data-label="Paid-in">{p.paidIn}</td>
                  <td className="n" data-label="Distributed">{p.distributed}</td>
                  <td className="n" data-label="TVPI"><MetricValue metric={p.tvpi} />{p.tvpi.reason ? <small>{p.tvpi.reason}</small> : null}</td>
                  <td data-label="Mark coverage">{p.coverage}</td>
                </>
              ) : (
                <td colSpan={5} data-label="NAV" className="pf-qgap">
                  <span className={{ unreadable: 'pf-unreadable', loading: 'pf-muted' }[p.state] || 'pf-not-recorded'}>{pointWords(p)}</span>
                  {p.reason ? <span className="pf-muted"> · {p.reason}{p.state === 'unreadable' ? ' No figure is shown in its place.' : ''}</span> : null}
                  {p.state === 'unreadable' ? (
                    <> <button type="button" className="pf-link-button" onClick={() => onRetry(p.date)} data-testid={`button-retry-perf-${p.date}`}>Retry</button></>
                  ) : null}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
