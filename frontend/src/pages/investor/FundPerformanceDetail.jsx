/** D6253 — read-only quarterly history and marks, admitted by the Worker's can_manage result. */
import React from 'react';
import { Link } from 'react-router-dom';
import { Unreadable, DataState } from '../../ui/Honesty';
import { QuarterLines } from '../../ui/Charts';
import { fundPerformanceApi } from '../../lib/api/fundPerformance';
import { useRead } from '../admin/fundAdmin/useRead';
import { cents, multiple, rate, dayText, positionRows, quarterCharts, shortMoney } from '../admin/fundAdmin/performanceModel';

// The caller passes the server's permission, never a browser guess from tier or GP identity.
export async function readPerformanceDetail(fundId, canManage, reader) {
  if (canManage !== true) return null;
  const value = await reader(fundId);
  if (Number(value?.fund_id) !== Number(fundId) || !Array.isArray(value?.items)) throw new Error('Fund detail could not be read.');
  return value;
}

function Missing({ reason }) {
  return <DataState state="not_recorded" reason={reason || 'No figure is recorded.'} />;
}

/** Each read fails independently; a failed positions read cannot erase a successful history. */
export function PerformanceDetailView({ fund, history, positions }) {
  const charts = history.status === 'ready' ? quarterCharts(history.data) : null;
  const rows = positions.status === 'ready' ? positionRows(positions.data) : [];
  return <section className="space-y-4" aria-label={`${fund.name} detail`} data-testid="fund-performance-detail">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{fund.name} · detail</h2>
      <Link className="inline-flex min-h-11 items-center underline" to={`/funds/${encodeURIComponent(fund.id)}`}>Open fund page</Link>
    </div>
    <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700" aria-label="Quarterly history">
      <h3 className="font-semibold">Quarterly history</h3>
      <p className="text-xs text-gray-600 dark:text-gray-400">Source: fund performance · quarterly history. Figures are at each quarter end; NAV covers investments only.</p>
      {history.status === 'loading' && <p aria-busy="true">Loading quarterly history…</p>}
      {history.status === 'unreadable' && <Unreadable what="Quarterly history" onRetry={history.reload} />}
      {charts?.empty && <p>{charts.reason}</p>}
      {charts && !charts.empty && <>
        <div className="my-4 min-w-0"><QuarterLines series={charts.money.series} labels={charts.labels} format={shortMoney} /></div>
        <p className="text-sm">{charts.money.note} {charts.money.foot}</p>
        <ul className="mt-3 grid gap-3 md:grid-cols-2" aria-label="Quarter-end figures">
          {history.data.items.map(row => <li key={row.quarter_end} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <h4 className="font-semibold">{row.quarter} · {dayText(row.quarter_end)}</h4>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {[
                ['Paid-in', 'paid_in_cents', cents], ['Distributed', 'distributed_cents', cents], ['NAV', 'nav_cents', cents],
                ['RVPI', 'rvpi', multiple], ['DPI', 'dpi', multiple], ['TVPI', 'tvpi', multiple], ['IRR', 'irr', rate],
              ].map(([label, key, format]) => <div key={key}><dt>{label}</dt><dd>{format(row[key]) ?? <Missing reason={row.unavailable?.[key]} />}</dd></div>)}
            </dl>
          </li>)}
        </ul>
        {history.data.truncated && <p role="note">Partial: only the latest {history.data.items.length} quarters were read. Earlier quarters are not shown.</p>}
      </>}
    </section>
    <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700" aria-label="Positions with marks">
      <h3 className="font-semibold">Positions with marks</h3>
      {positions.status === 'loading' && <p aria-busy="true">Loading positions…</p>}
      {positions.status === 'unreadable' && <Unreadable what="Positions with marks" onRetry={positions.reload} />}
      {positions.status === 'ready' && <>
        <p className="text-xs text-gray-600 dark:text-gray-400">Source: fund performance · positions · as of {dayText(positions.data.as_of)}. Cost is the amount invested, never a substitute for a missing mark.</p>
        {rows.length === 0 ? <p>No position is attributed to this fund.</p> : <ul className="mt-3 grid gap-3 md:grid-cols-2" aria-label="Positions">
          {rows.map(row => <li key={row.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <h4 className="font-semibold">{row.company}</h4>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div><dt>Round</dt><dd>{row.round}</dd></div><div><dt>Cost</dt><dd>{row.cost}</dd></div>
              <div><dt>Latest mark</dt><dd>{row.mark ?? <Missing reason={row.markReason} />}</dd></div>
              <div><dt>Mark date</dt><dd>{row.date ?? <Missing reason="No dated mark is recorded." />}</dd></div>
              <div><dt>State</dt><dd>{row.state === 'Stale' ? 'Stale · older than 1 quarter' : row.state || 'No mark'}</dd></div>
              <div><dt>Source</dt><dd className="break-words">{row.source || <Missing reason="No mark source is recorded." />}</dd></div>
            </dl>
          </li>)}
        </ul>}
      </>}
    </section>
  </section>;
}

export default function FundPerformanceDetail({ fund, canManage }) {
  const enabled = canManage === true;
  const history = useRead(() => readPerformanceDetail(fund.id, canManage, fundPerformanceApi.history), [fund.id, canManage], { enabled });
  const positions = useRead(() => readPerformanceDetail(fund.id, canManage, fundPerformanceApi.positions), [fund.id, canManage], { enabled });
  if (!enabled) return <p>Fund summaries are available above. Positions and quarterly history are currently GP and admin reads.</p>;
  return <PerformanceDetailView fund={fund} history={history} positions={positions} />;
}
