import React, { useEffect, useId, useRef, useState } from 'react';

/**
 * D893 (#2366), moved from pages/admin/insights/ by D929 (#2725) — the chart shapes the Insights canvas draws, as plain SVG:
 * horizontal bars, columns (the current week hatched, an unfinished week
 * dashed), columns stacked by profile (Growth), a weekly line (its last
 * segment dashed to a hollow point, and the period before as a dotted line
 * when Compare is on), a 100% bar and the Plan donut. D929 adds three for
 * Partner invitations: columns grouped by series (each series hatched in its
 * own colour for the current week), absolute stacked bars whose segments can
 * open a filtered list, and a weekly line with several series, where a dash
 * says which series it is and the current week is only a hollow point. Each chart sizes to its
 * box, so a phone gets readable text rather than a scaled-down desktop drawing.
 *
 * COLOUR IS #2375's ONE PALETTE: violet, sky, amber, emerald, muted. Only
 * violet changes in dark mode (#a78bfa), as INS6 says.
 *
 * Every chart is `aria-hidden`; the block that holds it carries the `alt`
 * sentence on a `role="img"` wrapper, and "View as table" draws `ChartTable`.
 */

const FILL = {
  violet: 'fill-axal-violet dark:fill-[#a78bfa]',
  sky: 'fill-[#0ea5e9]',
  amber: 'fill-[#f59e0b]',
  emerald: 'fill-[#10b981]',
  muted: 'fill-axal-muted',
};
const INK = 'fill-axal-ink dark:fill-gray-200';
const MUTE = 'fill-axal-muted dark:fill-gray-400';
const GRID = 'stroke-axal-hairline dark:stroke-gray-700';
const STROKE_V = 'stroke-axal-violet dark:stroke-[#a78bfa]';
const STROKE = {
  violet: STROKE_V,
  sky: 'stroke-[#0ea5e9]',
  amber: 'stroke-[#f59e0b]',
  emerald: 'stroke-[#10b981]',
  muted: 'stroke-axal-muted',
};

const nf = (n) => Number(n).toLocaleString('en-US');

/** The width of a box, followed as it resizes. `fallback` is used before the first measure and in tests. */
export function useBoxWidth(fallback = 760) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect?.width || 0);
      if (next > 0) setW(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function Svg({ width, height, children }) {
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="xMinYMin meet"
      className="block font-mono text-[10px]" aria-hidden="true">
      {children}
    </svg>
  );
}

/**
 * Horizontal bars. A row with `group` is a button: `onSelect(group)` opens its
 * lightbox (INS3) or, on Partner invitations, a filtered list. `r.aria` names
 * what the button opens; `testIdPrefix` keys each button.
 */
export function HBars({ rows, axis = '', onSelect, testIdPrefix = 'insights-bar' }) {
  const [ref, W] = useBoxWidth();
  const LW = W < 420 ? 112 : 150;
  const RW = 92;
  const rh = 26;
  const H = rows.length * rh + 20;
  const bw = Math.max(40, W - LW - RW);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div ref={ref} className="w-full">
      <Svg width={W} height={H}>
        {[0.5, 1].map((f) => <line key={f} x1={LW + bw * f} x2={LW + bw * f} y1={0} y2={H - 16} className={GRID} />)}
        {rows.map((r, i) => {
          const y = i * rh + 3;
          const w = r.value > 0 ? Math.max(2, (bw * r.value) / max) : 0;
          const bar = r.dash
            ? <rect x={LW} y={y + 3} width={Math.max(w, 24)} height={15} rx={2} fill="none" strokeDasharray="3 3" className="stroke-axal-muted" />
            : <rect x={LW} y={y + 3} width={w} height={15} rx={2} className={FILL[r.tone] || FILL.violet} />;
          const body = (
            <>
              <text x={LW - 8} y={y + 14} textAnchor="end" className={`${INK} font-display text-[11px]`}>{r.label}</text>
              {bar}
              <text x={LW + Math.max(w, r.dash ? 24 : 0) + 6} y={y + 14} className={INK}>{r.text ?? nf(r.value)}</text>
            </>
          );
          if (!r.group || !onSelect) return <g key={r.label}>{body}</g>;
          return (
            <g key={r.label} role="button" tabIndex={0} aria-label={r.aria || `Open the ${r.label} group, ${nf(r.value)} accounts`}
              className="cursor-pointer outline-none focus-visible:[&>rect]:stroke-axal-ink focus-visible:[&>rect]:stroke-2"
              onClick={() => onSelect(r.group)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r.group); } }}
              data-testid={`${testIdPrefix}-${r.group}`}>
              <rect x={0} y={y} width={W} height={rh - 2} fill="transparent" />
              {body}
            </g>
          );
        })}
        <text x={LW} y={H - 3} className={MUTE}>0</text>
        <text x={LW + bw} y={H - 3} textAnchor="end" className={MUTE}>{axis}</text>
      </Svg>
    </div>
  );
}

/** Columns. `toDate` hatches the current week; `open` draws a dashed outline for a week not finished. */
export function Columns({ rows, height = 220, pct = false, max: maxIn }) {
  const [ref, W] = useBoxWidth();
  const hatch = `ins-hatch-${useId().replace(/:/g, '')}`;
  const Lx = 34;
  const B = 22;
  const top = 16;
  const n = Math.max(1, rows.length);
  const gw = (W - Lx - 4) / n;
  const bw = Math.min(34, gw * 0.62);
  const ch = height - B - top;
  const max = Math.max(1, maxIn || Math.max(...rows.map((r) => r.value)));
  return (
    <div ref={ref} className="w-full">
      <Svg width={W} height={height}>
        <defs>
          <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" className="fill-white dark:fill-gray-900" />
            <line x1="0" y1="0" x2="0" y2="5" strokeWidth="2" className={STROKE_V} />
          </pattern>
        </defs>
        {[0, 0.5, 1].map((f) => {
          const y = top + ch * (1 - f);
          return (
            <g key={f}>
              <line x1={Lx} x2={W} y1={y} y2={y} className={GRID} />
              <text x={Lx - 5} y={y + 3} textAnchor="end" className={MUTE}>{Math.round(max * f)}{pct ? '%' : ''}</text>
            </g>
          );
        })}
        {rows.map((r, i) => {
          const x = Lx + gw * i + (gw - bw) / 2;
          let h = (ch * r.value) / max;
          let bar;
          if (r.open) {
            h = ch * 0.5;
            bar = <rect x={x} y={top + ch - h} width={bw} height={h} fill="none" strokeDasharray="3 3" className="stroke-axal-muted" />;
          } else if (r.toDate) {
            bar = <rect x={x} y={top + ch - h} width={bw} height={h} fill={`url(#${hatch})`} className={STROKE_V} />;
          } else if (r.parts?.length) {
            // Stacked by profile, bottom up, in the legend's order.
            let y0 = top + ch;
            bar = (
              <>
                {r.parts.map((p, k) => {
                  const ph = (ch * p.value) / max;
                  y0 -= ph;
                  return ph > 0 ? <rect key={k} x={x} y={y0} width={bw} height={ph} className={FILL[p.tone] || FILL.violet} /> : null;
                })}
              </>
            );
          } else {
            bar = <rect x={x} y={top + ch - h} width={bw} height={h} className={FILL[r.tone] || FILL.violet} />;
          }
          return (
            <g key={`${r.label}-${i}`}>
              {bar}
              <text x={x + bw / 2} y={top + ch - h - 4} textAnchor="middle" className={INK}>{r.text ?? nf(r.value)}</text>
              <text x={x + bw / 2} y={height - 6} textAnchor="middle" className={MUTE}>{r.label}</text>
            </g>
          );
        })}
      </Svg>
    </div>
  );
}

/** A weekly line: the last segment dashed to a hollow point, which is the current week to date. */
export function WeekLine({ values, labels, previous = null, height = 220 }) {
  const [ref, W] = useBoxWidth();
  const pts = values.map((v, i) => ({ v, i })).filter((p) => p.v !== null && p.v !== undefined);
  // The period before, drawn dotted under the line; its blanks stay blank.
  const prev = (previous || []).map((v, i) => ({ v, i })).filter((p) => p.v !== null && p.v !== undefined);
  const Lx = 36;
  const R = 34;
  const B = 22;
  const top = 16;
  const ch = height - B - top;
  const n = Math.max(2, values.length);
  const vs = [...pts, ...prev].map((p) => p.v);
  const lo = vs.length ? Math.min(...vs) : 0;
  const hi = vs.length ? Math.max(...vs) : 1;
  const pad = Math.max(1, Math.round((hi - lo) * 0.25));
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  const X = (i) => Lx + ((W - Lx - R) * i) / (n - 1);
  const Y = (v) => top + ch * (1 - (v - min) / Math.max(1, max - min));
  const last = values.length - 1;
  const solid = pts.filter((p) => p.i < last);
  const end = pts.find((p) => p.i === last);
  const prevEnd = solid[solid.length - 1];
  const every = W < 420 ? Math.ceil(values.length / 4) : 1;
  return (
    <div ref={ref} className="w-full">
      <Svg width={W} height={height}>
        {[0, 0.5, 1].map((f) => {
          const v = min + (max - min) * f;
          return (
            <g key={f}>
              <line x1={Lx} x2={W - R} y1={Y(v)} y2={Y(v)} className={GRID} />
              <text x={Lx - 5} y={Y(v) + 3} textAnchor="end" className={MUTE}>{Math.round(v)}</text>
            </g>
          );
        })}
        {prev.length > 1 && (
          <polyline points={prev.map((p) => `${X(p.i)},${Y(p.v)}`).join(' ')} fill="none" strokeWidth="1.6" strokeDasharray="1.5 3.5" strokeLinecap="round" className="stroke-axal-muted dark:stroke-gray-400" data-testid="insights-previous-line" />
        )}
        {solid.length > 1 && (
          <polyline points={solid.map((p) => `${X(p.i)},${Y(p.v)}`).join(' ')} fill="none" strokeWidth="2.2" className={STROKE_V} />
        )}
        {end && prevEnd && (
          <line x1={X(prevEnd.i)} y1={Y(prevEnd.v)} x2={X(end.i)} y2={Y(end.v)} strokeWidth="2" strokeDasharray="4 3" className={STROKE_V} />
        )}
        {solid.map((p) => <circle key={p.i} cx={X(p.i)} cy={Y(p.v)} r="3.5" className={FILL.violet} />)}
        {end && <circle cx={X(end.i)} cy={Y(end.v)} r="4.5" strokeWidth="2" className={`fill-white dark:fill-gray-900 ${STROKE_V}`} />}
        {prevEnd && <text x={X(prevEnd.i)} y={Y(prevEnd.v) - 9} textAnchor="middle" fontWeight="500" className={INK}>{nf(prevEnd.v)}</text>}
        {end && <text x={X(end.i)} y={Y(end.v) + 16} textAnchor="middle" className={MUTE}>{nf(end.v)} to date</text>}
        {labels.map((l, i) => (i % every === 0 || i === last
          ? <text key={`${l}-${i}`} x={X(i)} y={height - 5} textAnchor="middle" className={MUTE}>{l}</text>
          : null))}
      </Svg>
    </div>
  );
}

/**
 * Columns grouped by series, one group per week: `rows` are
 * `{ label, values: [n, …], toDate }` and `series` `{ label, tone }`. The
 * current week (`toDate`) is hatched in each series' own colour, so the
 * hatch never takes a series' colour away.
 */
export function GroupedColumns({ rows, series, height = 220 }) {
  const [ref, W] = useBoxWidth();
  const id = `grp-hatch-${useId().replace(/:/g, '')}`;
  const Lx = 30;
  const B = 22;
  const top = 16;
  const n = Math.max(1, rows.length);
  const k = Math.max(1, series.length);
  const gw = (W - Lx - 4) / n;
  const bw = Math.max(3, Math.min(14, (gw * 0.7) / k));
  const ch = height - B - top;
  const max = Math.max(1, ...rows.flatMap((r) => r.values));
  const every = W < 420 ? Math.ceil(rows.length / 4) : 1;
  return (
    <div ref={ref} className="w-full">
      <Svg width={W} height={height}>
        <defs>
          {series.map((s, j) => (
            <pattern key={s.label} id={`${id}-${j}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" className="fill-white dark:fill-gray-900" />
              <line x1="0" y1="0" x2="0" y2="5" strokeWidth="2" className={STROKE[s.tone] || STROKE_V} />
            </pattern>
          ))}
        </defs>
        {[0, 0.5, 1].map((f) => {
          const y = top + ch * (1 - f);
          return (
            <g key={f}>
              <line x1={Lx} x2={W} y1={y} y2={y} className={GRID} />
              <text x={Lx - 5} y={y + 3} textAnchor="end" className={MUTE}>{Math.round(max * f)}</text>
            </g>
          );
        })}
        {rows.map((r, i) => {
          const x0 = Lx + gw * i + (gw - bw * k) / 2;
          return (
            <g key={`${r.label}-${i}`}>
              {series.map((s, j) => {
                const v = r.values[j] || 0;
                const h = (ch * v) / max;
                const x = x0 + bw * j;
                return r.toDate
                  ? <rect key={s.label} x={x} y={top + ch - h} width={bw} height={h} fill={`url(#${id}-${j})`} className={STROKE[s.tone] || STROKE_V} />
                  : <rect key={s.label} x={x} y={top + ch - h} width={bw} height={h} className={FILL[s.tone] || FILL.violet} />;
              })}
              {i % every === 0 || i === rows.length - 1
                ? <text x={x0 + (bw * k) / 2} y={height - 6} textAnchor="middle" className={MUTE}>{r.label}</text>
                : null}
            </g>
          );
        })}
      </Svg>
    </div>
  );
}

/**
 * Absolute stacked bars, one row per group: `rows` are
 * `{ key, label, total, parts: [{ key, label, value, tone }] }`, drawn to one
 * scale so rows compare. With `onSelect`, each segment is a button that calls
 * `onSelect(row, part)`; its `aria` names what it opens.
 */
export function StackBars({ rows, onSelect, testIdPrefix = 'stack' }) {
  const [ref, W] = useBoxWidth();
  const LW = W < 420 ? 118 : 196;
  const RW = 40;
  const rh = 28;
  const H = rows.length * rh + 4;
  const bw = Math.max(40, W - LW - RW);
  const max = Math.max(1, ...rows.map((r) => r.parts.reduce((t, p) => t + p.value, 0)));
  return (
    <div ref={ref} className="w-full">
      <Svg width={W} height={H}>
        {rows.map((r, i) => {
          const y = i * rh + 4;
          let x = LW;
          const sum = r.parts.reduce((t, p) => t + p.value, 0);
          return (
            <g key={r.key}>
              <text x={LW - 8} y={y + 13} textAnchor="end" className={`${INK} font-display text-[11px]`}>{r.label}</text>
              {r.parts.map((p) => {
                if (!(p.value > 0)) return null;
                const w = Math.max(3, (bw * p.value) / max);
                const seg = <rect x={x} y={y + 2} width={w} height={16} className={FILL[p.tone] || FILL.violet} />;
                const at = x;
                x += w;
                if (!onSelect) return <g key={p.key}>{seg}</g>;
                return (
                  <g key={p.key} role="button" tabIndex={0} aria-label={p.aria || `${r.label}, ${p.label}: ${nf(p.value)}`}
                    className="cursor-pointer outline-none focus-visible:[&>rect]:stroke-axal-ink focus-visible:[&>rect]:stroke-2 dark:focus-visible:[&>rect]:stroke-white"
                    onClick={() => onSelect(r, p)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r, p); } }}
                    data-testid={`${testIdPrefix}-${r.key}-${p.key}`}>
                    {seg}
                    <rect x={at} y={y} width={w} height={20} fill="transparent" />
                  </g>
                );
              })}
              <text x={LW + (bw * sum) / max + 6} y={y + 13} className={INK}>{r.total ?? nf(sum)}</text>
            </g>
          );
        })}
      </Svg>
    </div>
  );
}

/**
 * A weekly line with several series: `series` are `{ label, tone, dash,
 * values }`. A dash says which series a line is, so it is never used for
 * time: the last value is the current week to date, drawn as a hollow point
 * on the same line. A null value breaks its line.
 */
export function WeekLines({ series, labels, height = 220 }) {
  const [ref, W] = useBoxWidth();
  const Lx = 30;
  const R = 18;
  const B = 22;
  const top = 16;
  const ch = height - B - top;
  const n = Math.max(2, labels.length);
  const max = Math.max(1, ...series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined)));
  const X = (i) => Lx + ((W - Lx - R) * i) / (n - 1);
  const Y = (v) => top + ch * (1 - v / max);
  const last = labels.length - 1;
  const every = W < 420 ? Math.ceil(labels.length / 4) : 1;
  const runs = (values) => {
    const out = [];
    let run = [];
    values.forEach((v, i) => {
      if (v === null || v === undefined) { if (run.length) out.push(run); run = []; } else run.push({ v, i });
    });
    if (run.length) out.push(run);
    return out;
  };
  return (
    <div ref={ref} className="w-full">
      <Svg width={W} height={height}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={Lx} x2={W - R} y1={Y(max * f)} y2={Y(max * f)} className={GRID} />
            <text x={Lx - 5} y={Y(max * f) + 3} textAnchor="end" className={MUTE}>{Math.round(max * f)}</text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.label}>
            {runs(s.values).map((run) => (run.length > 1
              ? <polyline key={run[0].i} points={run.map((p) => `${X(p.i)},${Y(p.v)}`).join(' ')} fill="none" strokeWidth="2.2"
                  strokeDasharray={s.dash ? '5 4' : undefined} className={STROKE[s.tone] || STROKE_V} />
              : null))}
            {s.values.map((v, i) => (v === null || v === undefined ? null : i === last
              ? <circle key={i} cx={X(i)} cy={Y(v)} r="4.5" strokeWidth="2" className={`fill-white dark:fill-gray-900 ${STROKE[s.tone] || STROKE_V}`} />
              : <circle key={i} cx={X(i)} cy={Y(v)} r="3" className={FILL[s.tone] || FILL.violet} />))}
          </g>
        ))}
        {labels.map((l, i) => (i % every === 0 || i === last
          ? <text key={`${l}-${i}`} x={X(i)} y={height - 5} textAnchor="middle" className={MUTE}>{l}</text>
          : null))}
      </Svg>
    </div>
  );
}

/**
 * D922 (#2705): a running total by day, as the Events desk's "Seats taken over
 * time" draws it. The line steps up on each day; `capacity` is a dashed line
 * across the chart, and `today` (an index into `points`, or `after` for a day
 * past the last point) a dashed amber marker. In the palette above.
 */
export function RunningTotal({ points, capacity = null, today = null, height = 200 }) {
  const [ref, W] = useBoxWidth();
  const Lx = 36;
  const R = 70;
  const B = 22;
  const top = 14;
  const ch = height - B - top;
  const n = Math.max(2, points.length + (today === 'after' ? 1 : 0));
  const hi = Math.max(1, capacity || 0, ...points.map((p) => p.value));
  const X = (i) => Lx + ((W - Lx - R) * i) / (n - 1);
  const Y = (v) => top + ch - (ch * v) / hi;
  let d = '';
  points.forEach((p, i) => {
    d += i === 0 ? `M ${X(0)} ${Y(0)} L ${X(0)} ${Y(p.value)}` : ` L ${X(i)} ${Y(points[i - 1].value)} L ${X(i)} ${Y(p.value)}`;
  });
  if (today === 'after' && points.length) d += ` L ${X(points.length)} ${Y(points[points.length - 1].value)}`;
  const todayX = today === 'after' ? X(points.length) : Number.isInteger(today) ? X(today) : null;
  const every = Math.max(1, Math.ceil(points.length / 6));
  return (
    <div ref={ref} className="w-full">
      <Svg width={W} height={height}>
        <line x1={Lx} x2={W - R} y1={top + ch} y2={top + ch} className={GRID} />
        <text x={Lx - 6} y={top + ch} textAnchor="end" className={MUTE}>0</text>
        <text x={Lx - 6} y={top + 8} textAnchor="end" className={MUTE}>{nf(hi)}</text>
        {capacity !== null ? (
          <g>
            <line x1={Lx} x2={W - R} y1={Y(capacity)} y2={Y(capacity)} strokeDasharray="5 4" className="stroke-axal-muted" />
            <text x={W - R + 6} y={Y(capacity) + 4} className={MUTE}>{`Capacity ${nf(capacity)}`}</text>
          </g>
        ) : null}
        {todayX !== null ? (
          <g>
            <line x1={todayX} x2={todayX} y1={top} y2={top + ch} strokeDasharray="3 3" className="stroke-[#f59e0b]" />
            <text x={todayX} y={top - 3} textAnchor="middle" className="fill-[#b45309] dark:fill-amber-300">Today</text>
          </g>
        ) : null}
        {points.length ? <path d={d} fill="none" strokeWidth="2.25" className={STROKE_V} /> : null}
        {points.length ? <text x={X(points.length - 1) + 6} y={Y(points[points.length - 1].value) - 6} className={INK}>{nf(points[points.length - 1].value)}</text> : null}
        {points.map((p, i) => (i % every === 0 || i === points.length - 1
          ? <text key={p.label} x={X(i)} y={height - 5} textAnchor="middle" className={MUTE}>{p.label}</text>
          : null))}
      </Svg>
    </div>
  );
}

/** A 100% bar, one part per slice. */
export function Bar100({ parts }) {
  const [ref, W] = useBoxWidth(380);
  const tot = parts.reduce((t, p) => t + p.value, 0) || 1;
  let x = 0;
  return (
    <div ref={ref} className="w-full">
      <Svg width={W} height={20}>
        {parts.map((p) => {
          const w = (W * p.value) / tot;
          const r = <rect key={p.label} x={x} y={0} width={p.value > 0 ? Math.max(1.5, w) : 0} height={20} className={FILL[p.tone] || FILL.violet} />;
          x += w;
          return r;
        })}
      </Svg>
    </div>
  );
}

/** The Plan donut: one arc per tier, the paid share in the middle. */
export function Donut({ parts, center = '', centerSub = '' }) {
  const size = 168;
  const r = 62;
  const sw = 22;
  const c = 2 * Math.PI * r;
  const tot = parts.reduce((t, p) => t + p.value, 0);
  let off = 0;
  return (
    <div className="flex w-full justify-center">
      <Svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={sw} className={GRID} />
        {tot > 0 && parts.map((p) => {
          const len = (c * p.value) / tot;
          const arc = (
            <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={sw}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off}
              transform={`rotate(-90 ${size / 2} ${size / 2})`} className={STROKE[p.tone] || STROKE.violet} />
          );
          off += len;
          return arc;
        })}
        <text x={size / 2} y={size / 2 + 4} textAnchor="middle" className={`${INK} text-[22px]`} fontWeight="600">{center}</text>
        <text x={size / 2} y={size / 2 + 22} textAnchor="middle" className={MUTE}>{centerSub}</text>
      </Svg>
    </div>
  );
}

const BORDER = {
  violet: 'border-axal-violet dark:border-[#a78bfa]', sky: 'border-[#0ea5e9]', amber: 'border-[#f59e0b]', emerald: 'border-[#10b981]', muted: 'border-axal-muted',
};

/**
 * The legend under a chart. `tone` is a palette name, or `hatch`, `dash` or
 * `hollow`. `mark: 'line'` or `'dashed'` draws a line swatch in the tone, for
 * a line chart whose series differ by dash as well as colour.
 */
export function Legend({ items }) {
  const dot = (tone, mark) => {
    if (mark === 'line' || mark === 'dashed') return `h-0 w-4 rounded-none border-t-2 ${mark === 'dashed' ? 'border-dashed' : 'border-solid'} ${BORDER[tone] || BORDER.violet}`;
    if (tone === 'hatch') return 'border border-axal-violet dark:border-[#a78bfa] bg-[repeating-linear-gradient(45deg,#7c3aed_0_2px,transparent_2px_4px)] dark:bg-[repeating-linear-gradient(45deg,#a78bfa_0_2px,transparent_2px_4px)]';
    if (tone === 'dash') return 'border-[1.5px] border-dashed border-axal-muted';
    if (tone === 'hollow') return 'rounded-full border-2 border-axal-violet dark:border-[#a78bfa]';
    if (tone === 'dotted') return 'h-0 rounded-none border-t-2 border-dotted border-axal-muted';
    return {
      violet: 'bg-axal-violet dark:bg-[#a78bfa]', sky: 'bg-[#0ea5e9]', amber: 'bg-[#f59e0b]', emerald: 'bg-[#10b981]', muted: 'bg-axal-muted',
    }[tone] || 'bg-axal-violet';
  };
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1.5">
      {items.map((g) => (
        <span key={g.label} className="flex items-center gap-1.5 text-[11.5px] text-axal-muted dark:text-gray-400">
          <span className={`h-2.5 w-2.5 flex-none rounded-[3px] ${dot(g.tone, g.mark)}`} />
          {g.label}
        </span>
      ))}
    </div>
  );
}

/** "View as table": the same rows a chart draws, as a table. */
export function ChartTable({ chart, caption }) {
  let rows = [];
  let head = ['Item', 'Value'];
  const cell = (v) => (v === null || v === undefined ? 'not recorded' : nf(v));
  if (chart?.type === 'grouped') {
    head = ['Week', ...chart.series.map((s) => s.label)];
    rows = chart.rows.map((r) => [r.toDate ? `${r.label} (so far)` : r.label, ...chart.series.map((_, j) => cell(r.values[j]))]);
  } else if (chart?.type === 'lines') {
    head = ['Week', ...chart.series.map((s) => s.label)];
    rows = chart.labels.map((l, i) => [i === chart.labels.length - 1 ? `${l} (so far)` : l, ...chart.series.map((s) => cell(s.values[i]))]);
  } else if (chart?.type === 'stackbars') {
    head = [chart.head || 'Item', ...chart.parts.map((p) => p.label), 'Total'];
    rows = chart.rows.map((r) => [r.label, ...chart.parts.map((p) => nf(r.parts.find((x) => x.key === p.key)?.value || 0)), r.total ?? nf(r.parts.reduce((t, p) => t + p.value, 0))]);
  } else if (chart?.type === 'hbar' || chart?.type === 'columns' || chart?.type === 'stack') rows = chart.rows.map((r) => [r.label, r.text ?? nf(r.value)]);
  else if (chart?.type === 'line') {
    rows = chart.values.map((v, i) => [
      chart.labels[i] || String(i + 1),
      chart.previous ? `${cell(v)} · period before ${cell(chart.previous[i])}` : cell(v),
    ]);
  } else if (chart?.type === 'bar100' || chart?.type === 'donut') rows = chart.parts.map((p) => [p.label, nf(p.value)]);
  return (
    <table className="w-full border-collapse text-[12.5px]">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="bg-[#faf9fc] text-left text-[10.5px] font-bold uppercase tracking-[.06em] text-axal-muted dark:bg-gray-800 dark:text-gray-400">
          {head.map((t, i) => <th key={t} scope="col" className={`px-3 py-2${i ? ' text-right' : ''}`}>{t}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, ...vs], i) => (
          <tr key={`${k}-${i}`} className="border-t border-axal-hairline dark:border-gray-700">
            <td className="px-3 py-2 font-semibold text-axal-ink dark:text-gray-100">{k}</td>
            {vs.map((v, j) => <td key={j} className="px-3 py-2 text-right font-mono tabular-nums text-axal-ink dark:text-gray-100">{v}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One chart spec from the model, drawn. */
export function Chart({ chart, onSelect }) {
  if (!chart) return null;
  if (chart.type === 'hbar') return <HBars rows={chart.rows} axis={chart.axis} onSelect={chart.clickable ? onSelect : undefined} testIdPrefix={chart.testIdPrefix} />;
  if (chart.type === 'grouped') return <GroupedColumns rows={chart.rows} series={chart.series} height={chart.height} />;
  if (chart.type === 'stackbars') return <StackBars rows={chart.rows} onSelect={chart.clickable ? onSelect : undefined} testIdPrefix={chart.testIdPrefix} />;
  if (chart.type === 'lines') return <WeekLines series={chart.series} labels={chart.labels} height={chart.height} />;
  if (chart.type === 'columns' || chart.type === 'stack') return <Columns rows={chart.rows} pct={chart.pct} max={chart.max} height={chart.height} />;
  if (chart.type === 'line') return <WeekLine values={chart.values} labels={chart.labels} previous={chart.previous} />;
  if (chart.type === 'bar100') return <Bar100 parts={chart.parts} />;
  if (chart.type === 'donut') return <Donut parts={chart.parts} center={chart.center} centerSub={chart.centerSub} />;
  return null;
}
