/**
 * D1250 (#3265, DDL1) — the list's two charts: open cases by age and
 * decisions in the last 12 months, stacked columns in #2375's palette. A part
 * whose tone is `dash` (a target date not recorded) is a dashed hairline box,
 * and a month before the first recorded decision is a dashed hairline column
 * that says "Not recorded", never an empty column read as zero. Each chart
 * carries its sentence on a `role="img"` wrapper, and "View as table" draws
 * the same rows (`ChartTable`).
 */
import React, { useState } from 'react';
import { ChartTable, Legend, useBoxWidth } from '../../ui/Charts.jsx';
import { cardCls, muted } from './DdUi.jsx';

const FILL = {
  violet: 'fill-axal-violet dark:fill-[#a78bfa]',
  sky: 'fill-[#0ea5e9]',
  amber: 'fill-[#f59e0b]',
  emerald: 'fill-[#10b981]',
  muted: 'fill-[#6b6577] dark:fill-gray-500',
};
const DASH = 'fill-none stroke-axal-muted dark:stroke-gray-400';
const INK = 'fill-axal-ink dark:fill-gray-200';
const MUTE = 'fill-axal-muted dark:fill-gray-400';
const GRID = 'stroke-axal-hairline dark:stroke-gray-700';

/** Stacked columns; `rows` are `{ label, parts, recorded?, toDate? }`. */
export function StackColumns({ rows, height = 220, testId }) {
  const [ref, W] = useBoxWidth();
  const Lx = 30;
  const B = 24;
  const top = 18;
  const n = Math.max(1, rows.length);
  const gw = (W - Lx - 4) / n;
  const bw = Math.min(44, gw * 0.62);
  const ch = height - B - top;
  const totals = rows.map((r) => (r.recorded === false ? 0 : r.parts.reduce((a, p) => a + p.value, 0)));
  const max = Math.max(2, ...totals);
  const step = Math.ceil(max / 2);
  const scale = step * 2;
  return (
    <div ref={ref} className="w-full" data-testid={testId}>
      <svg width={W} height={height} aria-hidden="true" className="block overflow-visible text-[10.5px]">
        {[0, step, scale].map((v) => {
          const y = top + ch - (ch * v) / scale;
          return (
            <g key={v}>
              <line x1={Lx} x2={W} y1={y} y2={y} className={GRID} />
              <text x={Lx - 6} y={y + 3} textAnchor="end" className={MUTE}>{v}</text>
            </g>
          );
        })}
        {rows.map((r, i) => {
          const x = Lx + gw * i + (gw - bw) / 2;
          if (r.recorded === false) {
            return (
              <g key={`${r.label}-${i}`} data-testid={testId ? `${testId}-not-recorded-${i}` : undefined}>
                <rect x={x} y={top} width={bw} height={ch} strokeDasharray="3 3" className={DASH} />
                <text x={x + bw / 2} y={top + ch / 2} textAnchor="middle" transform={`rotate(-90 ${x + bw / 2} ${top + ch / 2})`} className={MUTE}>Not recorded</text>
                <text x={x + bw / 2} y={height - 6} textAnchor="middle" className={MUTE}>{r.label}</text>
              </g>
            );
          }
          let y0 = top + ch;
          const total = totals[i];
          return (
            <g key={`${r.label}-${i}`}>
              {r.parts.map((p) => {
                const h = (ch * p.value) / scale;
                if (!(h > 0)) return null;
                y0 -= h;
                return p.tone === 'dash'
                  ? <rect key={p.key} x={x} y={y0} width={bw} height={h} strokeDasharray="3 3" className={DASH} />
                  : <rect key={p.key} x={x} y={y0} width={bw} height={h} className={FILL[p.tone] || FILL.violet} />;
              })}
              <text x={x + bw / 2} y={top + ch - (ch * total) / scale - 4} textAnchor="middle" className={`${INK} font-semibold`}>{total}</text>
              {r.toDate ? <text x={x + bw / 2} y={top + ch - (ch * total) / scale - 15} textAnchor="middle" className={MUTE}>to date</text> : null}
              <text x={x + bw / 2} y={height - 6} textAnchor="middle" className={MUTE}>{r.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * One chart card: title, "View as table", the sentence, the chart or its
 * table, and the legend. `chart` null with `failed` is Unreadable with Try
 * again; null while reading says "Reading…".
 */
export function ChartCard({ title, chart, state, onRetry, testId }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`${cardCls} flex flex-col gap-2 p-4`} data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="m-0 text-[15px] font-bold text-gray-900 dark:text-gray-100">{title}</h3>
        {chart ? (
          <button type="button" onClick={() => setAsTable((v) => !v)} className="text-[12.5px] font-semibold text-axal-violet hover:underline dark:text-violet-300" data-testid={`${testId}-toggle`}>
            {asTable ? 'View as chart' : 'View as table'}
          </button>
        ) : null}
      </div>
      {state === 'loading' ? <p className={`m-0 text-[12.5px] ${muted}`}>Reading…</p> : null}
      {state === 'failed' ? (
        <div className="flex flex-col items-start gap-2 py-6" data-testid={`${testId}-unreadable`}>
          <p className="m-0 text-[13px] font-semibold text-gray-900 dark:text-gray-100">Unreadable</p>
          <p className={`m-0 text-[12.5px] ${muted}`}>This chart could not be read. Nothing is drawn as zero.</p>
          <button type="button" onClick={onRetry} className="text-[12.5px] font-semibold text-axal-violet hover:underline dark:text-violet-300">Try again</button>
        </div>
      ) : null}
      {chart ? (
        <>
          <p className={`m-0 text-[12.5px] ${muted}`} data-testid={`${testId}-sentence`}>{chart.sentence}</p>
          {asTable
            ? <div className="overflow-x-auto" data-testid={`${testId}-table`}><ChartTable chart={chart} caption={chart.sentence} /></div>
            : <div role="img" aria-label={chart.sentence}><StackColumns rows={chart.rows} testId={`${testId}-svg`} /></div>}
          <Legend items={chart.legend} />
        </>
      ) : null}
    </section>
  );
}
