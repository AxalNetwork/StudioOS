/**
 * D7169 (#7169) — the quarterly reports chart (FND-Q1, FND-Q6, FND-Q9): each
 * quarter at its own position, a quarter with no report or no value drawn as
 * a dashed gap with its word, never joined to its neighbours. A measured zero
 * is a hollow point on the zero line. One tab stop; ← → step through every
 * quarter, gaps included, and the step is announced; Enter opens that row.
 * The table under it carries the same values.
 */
import React, { useId, useState } from 'react';
import { FIELD, fmtValue, periodLabel } from './fundReportsModel.js';

const AXIS = 'fill-gray-500 dark:fill-gray-400';

/** Round tick steps that cover [lo, hi] with zero on the axis. */
function ticks(lo, hi) {
  const span = Math.max(hi - lo, 1);
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const a = Math.floor(lo / step) * step; const b = Math.ceil(hi / step) * step;
  const out = [];
  for (let v = a; v <= b + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

export function pointWords(q, metric) {
  const label = periodLabel(q.period);
  if (!q.report) return `${label}, no report`;
  const v = q.report[metric];
  if (v === null || v === undefined) return `${label}, not recorded`;
  const words = fmtValue(metric, v).replace('%', ' percent').replace('×', ' times').replace('−', 'minus ');
  return `${label}, ${words}${v === 0 ? ', measured' : ''}`;
}

export default function FundReportsChart({ timeline, metric, onOpen, compact = false }) {
  const id = useId();
  const [cursor, setCursor] = useState(-1);
  const W = compact ? 330 : 760; const H = compact ? 170 : 230;
  const L = compact ? 40 : 52; const R = 12; const T = 18; const B = 46; const pad = compact ? 22 : 40;
  const values = timeline.map((q) => (q.report && typeof q.report[metric] === 'number' ? q.report[metric] : null));
  const present = values.filter((v) => v !== null);
  const ts = ticks(Math.min(0, ...present), Math.max(0, ...present));
  const scale = { ts, lo: ts[0], hi: ts[ts.length - 1] };
  const n = timeline.length;
  const step = (W - L - R - 2 * pad) / Math.max(n - 1, 1);
  const x = (i) => L + pad + (n === 1 ? (W - L - R - 2 * pad) / 2 : i * step);
  const y = (v) => T + ((scale.hi - v) / ((scale.hi - scale.lo) || 1)) * (H - T - B);
  const fmtTick = (v) => (FIELD[metric]?.kind === 'usd' ? fmtValue(metric, v)?.replace('US$', '$') : fmtValue(metric, v)) || '';
  const title = `${FIELD[metric]?.label || ''} by quarter. ${timeline.map((q) => pointWords(q, metric)).join('; ')}. The table below has the same values.`;
  const gapW = Math.min(52, Math.max(step - 6, 18));

  const onKey = (e) => {
    if (!n) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setCursor((c) => {
        const from = c < 0 ? (e.key === 'ArrowRight' ? -1 : n) : c;
        return Math.min(n - 1, Math.max(0, from + (e.key === 'ArrowRight' ? 1 : -1)));
      });
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault(); setCursor(e.key === 'Home' ? 0 : n - 1);
    } else if (e.key === 'Enter' && cursor >= 0) {
      e.preventDefault(); onOpen?.(timeline[cursor]);
    } else if (e.key === 'Escape') {
      setCursor(-1);
    }
  };

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
        role="img"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-k`}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setCursor(-1)}
        data-testid="fund-reports-chart"
        focusable="true"
      >
        <title id={`${id}-t`}>{title}</title>
        {scale.ts.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth={t === 0 ? 1.6 : 1} strokeDasharray={t === 0 ? undefined : '2 3'} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10" className={AXIS}>{fmtTick(t)}</text>
          </g>
        ))}
        {timeline.map((q, i) => {
          const gap = values[i] === null;
          return (
            <g key={q.period}>
              <text x={x(i)} y={H - B + 18} textAnchor="middle" fontSize="10" className={AXIS}>{periodLabel(q.period)}</text>
              {gap && (
                <>
                  <rect x={x(i) - gapW / 2} y={T} width={gapW} height={H - T - B} rx="4" fill="none" className="stroke-gray-300 dark:stroke-gray-600" strokeDasharray="3 3" />
                  <text x={x(i)} y={H - B + 33} textAnchor="middle" fontSize="9.5" fontWeight="700" className={AXIS}>{q.report ? 'Not recorded' : 'No report'}</text>
                </>
              )}
            </g>
          );
        })}
        {timeline.slice(0, -1).map((q, i) => (values[i] !== null && values[i + 1] !== null
          ? <line key={`l${q.period}`} x1={x(i)} y1={y(values[i])} x2={x(i + 1)} y2={y(values[i + 1])} className="stroke-violet-600 dark:stroke-violet-400" strokeWidth="2" />
          : null))}
        {timeline.map((q, i) => {
          const v = values[i];
          if (v === null) return null;
          return (
            <g key={`p${q.period}`}>
              {cursor === i && <circle cx={x(i)} cy={y(v)} r="9" fill="none" className="stroke-violet-600 dark:stroke-violet-400" strokeWidth="2" />}
              <circle cx={x(i)} cy={y(v)} r="4.5" strokeWidth="2" className={v === 0 ? 'fill-white stroke-violet-600 dark:fill-gray-900 dark:stroke-violet-400' : 'fill-violet-600 stroke-violet-600 dark:fill-violet-400 dark:stroke-violet-400'} />
              {!compact && <text x={x(i)} y={y(v) + (v < 0 ? 18 : -10)} textAnchor="middle" fontSize="10.5" fontWeight="700" className="fill-gray-900 dark:fill-gray-100">{fmtValue(metric, v)}</text>}
            </g>
          );
        })}
        {cursor >= 0 && values[cursor] === null && (
          <rect x={x(cursor) - gapW / 2 - 3} y={T - 3} width={gapW + 6} height={H - T - B + 6} rx="6" fill="none" className="stroke-violet-600 dark:stroke-violet-400" strokeWidth="2" />
        )}
      </svg>
      <p id={`${id}-k`} className="sr-only">Use the left and right arrow keys to step through every quarter, Enter to open it.</p>
      <p className="sr-only" role="status" aria-live="polite">{cursor >= 0 ? pointWords(timeline[cursor], metric) : ''}</p>
    </div>
  );
}
