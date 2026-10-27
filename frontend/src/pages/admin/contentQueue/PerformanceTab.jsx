import React, { useCallback, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { adminArticles } from '../../../lib/api';
import { Tiles, useRead } from './AuthorsTab';
import { NOT_RECORDED, NOT_RECORDED_LINE, PERIODS, performanceView, rangeFor } from './statsModel';

/**
 * D1297 (#3393) — Content queue › Performance at `/admin/articles/performance`
 * (ART11, ART12), with the phone (ART18), from D1294's
 * `GET /api/admin/articles/performance?from=&to=`.
 *
 *   - A period (the Worker's twelve weeks, or 30 days, 90 days, 12 months).
 *   - Four tiles: Published, Views, Median time to a decision, Followers told.
 *   - Charts per week, each with "View as table" and a sentence that says it:
 *     published; submitted and decided; views. Views by sector and the top
 *     articles come from the daily count.
 *   - What is not recorded yet is listed as such, never drawn as a zero.
 *
 * Before the daily count starts, views say Not recorded with the Worker's own
 * reason. `load` is the client's, so a test can answer it.
 */

const CARD = 'rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900';
const MUTED = 'text-slate-500 dark:text-slate-400';
const LINK = 'inline-flex min-h-[44px] items-center text-sm font-semibold text-violet-700 hover:underline dark:text-violet-300 md:min-h-0';
const TICK = { fontSize: 10, fill: '#64748b' };

const SERIES = {
  published: [{ key: 'published', label: 'Published', color: '#7c3aed' }],
  decided: [
    { key: 'submitted', label: 'Submitted', color: '#94a3b8' },
    { key: 'approved', label: 'Approved', color: '#059669' },
    { key: 'changes', label: 'Changes requested', color: '#d97706' },
    { key: 'rejected', label: 'Rejected', color: '#e11d48' },
  ],
  views: [{ key: 'views', label: 'Views', color: '#2563eb' }],
};

/** One chart with its sentence and a table of the same numbers. */
function ChartBlock({ id, title, summary, rows, series, xKey = 'label', xLabel = 'Week' }) {
  const [table, setTable] = useState(false);
  return (
    <section className={CARD} data-testid={`perf-chart-${id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        <button type="button" className={LINK} aria-pressed={table} onClick={() => setTable((t) => !t)} data-testid={`perf-table-toggle-${id}`}>
          {table ? 'View as chart' : 'View as table'}
        </button>
      </div>
      {summary && <p className={`m-0 mt-1 text-xs ${MUTED}`} data-testid={`perf-summary-${id}`}>{summary}</p>}
      {table ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid={`perf-table-${id}`}>
            <thead>
              <tr className={`text-xs font-semibold ${MUTED}`}>
                <th className="px-2 py-1">{xLabel}</th>
                {series.map((s) => <th key={s.key} className="px-2 py-1 text-right">{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r[xKey]} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="whitespace-nowrap px-2 py-1 text-slate-800 dark:text-slate-100">{r[xKey]}{r.partial ? ' (counted from mid-week)' : ''}</td>
                  {series.map((s) => <td key={s.key} className="px-2 py-1 text-right tabular-nums text-slate-800 dark:text-slate-100">{r[s.key] == null ? NOT_RECORDED : r[s.key].toLocaleString('en-US')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-3" style={{ width: '100%', height: 200 }} aria-hidden="true">
          <ResponsiveContainer>
            <BarChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey={xKey} tick={TICK} />
              <YAxis tick={TICK} allowDecimals={false} width={32} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

/** A block whose figures are not recorded yet: the reason, never an empty chart. */
function NotYet({ id, title, line }) {
  return (
    <section className={CARD} data-testid={`perf-chart-${id}`}>
      <h3 className="m-0 text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      <p className={`m-0 mt-2 text-sm ${MUTED}`} data-testid={`perf-nr-${id}`}>{line}</p>
    </section>
  );
}

export default function PerformanceTab({ load = adminArticles.performance, today }) {
  const [period, setPeriod] = useState('12w');
  const ask = useCallback(() => load(rangeFor(period, today || new Date())), [load, period, today]);
  const read = useRead(ask);
  const view = performanceView(read);

  const periods = (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Period" data-testid="perf-periods">
      {PERIODS.map((p) => (
        <button key={p.key} type="button" aria-pressed={period === p.key} onClick={() => setPeriod(p.key)} data-testid={`perf-period-${p.key}`}
          className={`min-h-[44px] rounded-full border px-3 text-sm font-semibold md:min-h-[32px] ${period === p.key
            ? 'border-violet-700 bg-violet-700 text-white'
            : 'border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>{p.label}</button>
      ))}
    </div>
  );

  if (view.status === 'loading') {
    return <section className="mt-4 flex flex-col gap-4">{periods}<div className={`${CARD} h-40 animate-pulse`} aria-busy="true" data-testid="perf-loading" /></section>;
  }
  if (view.status === 'unreadable') {
    return (
      <section className="mt-4 flex flex-col gap-4">
        {periods}
        <div className={CARD} role="alert" data-testid="perf-unreadable">
          <p className="m-0 text-sm text-slate-800 dark:text-slate-100">Could not be read. This is not a claim that nothing happened.</p>
          <button type="button" className={LINK} onClick={read.retry}>Try again</button>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-4 flex flex-col gap-4" data-testid="content-queue-performance">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {periods}
        <span className={`text-sm ${MUTED}`} data-testid="perf-range">{view.range}</span>
      </div>
      <Tiles tiles={view.tiles} testId="perf-tiles" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartBlock id="published" title="Published per week" summary={view.summaries.published} rows={view.weeks} series={SERIES.published} />
        <ChartBlock id="decided" title="Submitted and decided per week" summary={view.summaries.decided} rows={view.weeks} series={SERIES.decided} />
        {view.viewsKnown
          ? <ChartBlock id="views" title="Views per week" summary={view.summaries.views} rows={view.weeks} series={SERIES.views} />
          : <NotYet id="views" title="Views per week" line={view.viewsReason} />}
        {view.sectors
          ? <ChartBlock id="sectors" title="Views by sector" rows={view.sectors} series={SERIES.views} xKey="sector" xLabel="Sector" />
          : <NotYet id="sectors" title="Views by sector" line={view.viewsReason} />}
      </div>

      <section className={CARD} data-testid="perf-top">
        <h3 className="m-0 text-sm font-semibold text-slate-900 dark:text-slate-100">Top articles</h3>
        {view.top == null ? (
          <p className={`m-0 mt-2 text-sm ${MUTED}`} data-testid="perf-nr-top">{view.viewsReason}</p>
        ) : view.top.length === 0 ? (
          <p className={`m-0 mt-2 text-sm ${MUTED}`} data-testid="perf-top-none">No article was read in this period.</p>
        ) : (
          <>
            <div className="mt-3 hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm" data-testid="perf-top-table">
                <thead>
                  <tr className={`text-xs font-semibold ${MUTED}`}>
                    {['Rank', 'Title', 'Author', 'Published', 'Views', 'Read time'].map((h) => <th key={h} className="whitespace-nowrap px-2 py-1">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {view.top.map((t) => (
                    <tr key={t.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-2 py-1 tabular-nums">{t.rank}</td>
                      <td className="px-2 py-1 font-semibold text-slate-900 dark:text-slate-100">{t.title}</td>
                      <td className={`px-2 py-1 ${MUTED}`}>{t.author}</td>
                      <td className="whitespace-nowrap px-2 py-1">{t.published}</td>
                      <td className="px-2 py-1 tabular-nums">{t.views}</td>
                      <td className="px-2 py-1">{t.read}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ol className="m-0 mt-3 flex list-none flex-col gap-2 p-0 md:hidden" data-testid="perf-top-cards">
              {view.top.map((t) => (
                <li key={t.id} className="border-t border-slate-100 pt-2 text-sm dark:border-slate-800">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{`${t.rank}. ${t.title}`}</span>
                  <span className={`block text-xs ${MUTED}`}>{`${t.author} · ${t.views} views · ${t.read}`}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      {(view.decisionNote || view.reachNote) && (
        <div className={`flex flex-col gap-1 text-xs ${MUTED}`} data-testid="perf-notes">
          {view.decisionNote && <p className="m-0">{view.decisionNote}</p>}
          {view.reachNote && <p className="m-0">{view.reachNote}</p>}
        </div>
      )}

      {view.notRecorded.length > 0 && (
        <section className={`${CARD} border-dashed`} data-testid="perf-not-recorded">
          <h3 className="m-0 text-sm font-semibold text-slate-900 dark:text-slate-100">Not recorded yet</h3>
          <p className={`m-0 mt-1 text-xs ${MUTED}`}>{NOT_RECORDED_LINE}</p>
          <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
            {view.notRecorded.map((n) => (
              <li key={n.key} className="text-sm" data-testid={`perf-nr-item-${n.key}`}>
                <span className="font-semibold text-slate-900 dark:text-slate-100">{n.title}</span>
                <span className={`block text-xs ${MUTED}`}>{n.line}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
