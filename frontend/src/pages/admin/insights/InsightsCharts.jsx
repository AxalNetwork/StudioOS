import React, { useEffect, useId, useRef, useState } from 'react';

/**
 * D893 (#2366) — the chart shapes the Insights canvas draws, as plain SVG:
 * horizontal bars, columns (the current week hatched, an unfinished week
 * dashed), columns stacked by profile (Growth), a weekly line (its last
 * segment dashed to a hollow point, and the period before as a dotted line
 * when Compare is on), a 100% bar and the Plan donut. Each chart sizes to its
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

/** Horizontal bars. A row with `group` is a button: `onSelect(group)` opens its lightbox (INS3). */
export function HBars({ rows, axis = '', onSelect }) {
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
            <g key={r.label} role="button" tabIndex={0} aria-label={`Open the ${r.label} group, ${nf(r.value)} accounts`}
              className="cursor-pointer outline-none focus-visible:[&>rect]:stroke-axal-ink focus-visible:[&>rect]:stroke-2"
              onClick={() => onSelect(r.group)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r.group); } }}
              data-testid={`insights-bar-${r.group}`}>
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

/** The legend under a chart. `tone` is a palette name, or `hatch`, `dash` or `hollow`. */
export function Legend({ items }) {
  const dot = (tone) => {
    if (tone === 'hatch') return 'border border-axal-violet bg-[repeating-linear-gradient(45deg,#7c3aed_0_2px,transparent_2px_4px)]';
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
          <span className={`h-2.5 w-2.5 flex-none rounded-[3px] ${dot(g.tone)}`} />
          {g.label}
        </span>
      ))}
    </div>
  );
}

/** "View as table": the same rows a chart draws, as a table. */
export function ChartTable({ chart, caption }) {
  let rows = [];
  const cell = (v) => (v === null || v === undefined ? 'not recorded' : nf(v));
  if (chart?.type === 'hbar' || chart?.type === 'columns' || chart?.type === 'stack') rows = chart.rows.map((r) => [r.label, r.text ?? nf(r.value)]);
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
          <th scope="col" className="px-3 py-2">Item</th>
          <th scope="col" className="px-3 py-2 text-right">Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={`${k}-${i}`} className="border-t border-axal-hairline dark:border-gray-700">
            <td className="px-3 py-2 font-semibold text-axal-ink dark:text-gray-100">{k}</td>
            <td className="px-3 py-2 text-right font-mono tabular-nums text-axal-ink dark:text-gray-100">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One chart spec from the model, drawn. */
export function Chart({ chart, onSelect }) {
  if (!chart) return null;
  if (chart.type === 'hbar') return <HBars rows={chart.rows} axis={chart.axis} onSelect={chart.clickable ? onSelect : undefined} />;
  if (chart.type === 'columns' || chart.type === 'stack') return <Columns rows={chart.rows} pct={chart.pct} max={chart.max} height={chart.height} />;
  if (chart.type === 'line') return <WeekLine values={chart.values} labels={chart.labels} previous={chart.previous} />;
  if (chart.type === 'bar100') return <Bar100 parts={chart.parts} />;
  if (chart.type === 'donut') return <Donut parts={chart.parts} center={chart.center} centerSub={chart.centerSub} />;
  return null;
}
