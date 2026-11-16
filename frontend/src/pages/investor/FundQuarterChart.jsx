/**
 * #6234 (D6234) — "Fund size by issued quarter": grouped columns, one group per
 * ISSUED period (`chartGroups` in fundOverviewModel.js already drops drafts),
 * four bars each (Committed, Called, Collected, Deployed). A figure the
 * snapshot lacks is a short HATCHED stub with a dashed outline — it holds the
 * slot without stating a value, so it never reads as a zero bar. Drawn the
 * way `ui/Charts.jsx` draws (plain SVG sized to its box, `aria-hidden`, the
 * sentence on a `role="img"` wrapper, and a table beside it on request).
 */
import { useId, useState } from 'react';
import { useBoxWidth } from '../../ui/Charts';
import { fmtCents } from '../../lib/fundAnalytics';
import { SERIES, money } from './fundOverviewModel';

const FILL = {
  c1: 'fill-[#c7d2fe] dark:fill-[#3730a3]',
  c2: 'fill-[#818cf8] dark:fill-[#6366f1]',
  c3: 'fill-[#4f46e5] dark:fill-[#a5b4fc]',
  c4: 'fill-[#312e81] dark:fill-[#e0e7ff]',
};
const SWATCH = {
  c1: 'bg-[#c7d2fe] dark:bg-[#3730a3]',
  c2: 'bg-[#818cf8] dark:bg-[#6366f1]',
  c3: 'bg-[#4f46e5] dark:bg-[#a5b4fc]',
  c4: 'bg-[#312e81] dark:bg-[#e0e7ff]',
};
const MUTE = 'fill-[#615c6e] dark:fill-gray-400';
const GRID = 'stroke-[#e7e7ed] dark:stroke-gray-700';

/** The sentence the chart says, for the `role="img"` wrapper. */
export function chartSentence(groups) {
  if (!groups.length) return 'No issued quarter to plot.';
  const hatched = groups.flatMap((g) => g.bars.filter((b) => b.hatched).map((b) => `${b.label} in ${g.label}`));
  return `Committed, called, collected and deployed for ${groups.length} issued quarter${groups.length === 1 ? '' : 's'}`
    + (hatched.length ? `; not recorded (hatched): ${hatched.join(', ')}.` : '.');
}

export default function FundQuarterChart({ groups, height = 200, compact = false }) {
  const [ref, W] = useBoxWidth(compact ? 360 : 760);
  const id = `fq-hatch-${useId().replace(/:/g, '')}`;
  const [table, setTable] = useState(false);
  const Lx = 54;
  const B = 34;
  const top = 12;
  const ch = height - B - top;
  const n = Math.max(1, groups.length);
  const k = SERIES.length;
  const gw = (W - Lx - 4) / n;
  const bw = Math.max(4, Math.min(compact ? 16 : 26, (gw * 0.72) / k));
  const max = Math.max(1, ...groups.flatMap((g) => g.bars.map((b) => (b.cents == null ? 0 : b.cents))));
  return (
    <div className="fo-chart" data-testid="fund-quarter-chart">
      <div className="fo-legend">
        {SERIES.map((s) => <span key={s.key}><i className={SWATCH[s.tone]} />{s.label}</span>)}
        <span><i className="fo-hatch-swatch" />Not recorded in that snapshot (hatched, not 0)</span>
        <span className="fo-scroll-hint">Scrolls sideways →</span>
        <button type="button" className="fo-link-btn" onClick={() => setTable((v) => !v)} aria-pressed={table} data-testid="button-chart-table">
          {table ? 'Show as chart' : 'Show as table'}
        </button>
      </div>
      {table ? (
        <div className="fo-table-wrap">
          <table className="fo-table">
            <caption className="sr-only">Fund size by issued quarter</caption>
            <thead><tr><th scope="col">Quarter</th>{SERIES.map((s) => <th key={s.key} scope="col" className="fo-num">{s.label}</th>)}</tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id ?? g.label}>
                  <td><b>{g.label}</b></td>
                  {g.bars.map((b) => <td key={b.key} className="fo-num">{b.cents == null ? <span className="fo-nr" title={b.reason || undefined}>Not recorded</span> : money(b.cents)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} role="img" aria-label={chartSentence(groups)} className="w-full">
          <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="xMinYMin meet" className="block font-mono text-[10px]" aria-hidden="true">
            <defs>
              <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" className="fill-[#f0eff4] dark:fill-gray-800" />
                <line x1="0" y1="0" x2="0" y2="6" strokeWidth="3" className="stroke-[#d4d2dc] dark:stroke-gray-600" />
              </pattern>
            </defs>
            {[0, 0.5, 1].map((f) => {
              const y = top + ch * (1 - f);
              return (
                <g key={f}>
                  <line x1={Lx} x2={W} y1={y} y2={y} className={GRID} />
                  <text x={Lx - 6} y={y + 3} textAnchor="end" className={MUTE}>{fmtCents(Math.round(max * f))}</text>
                </g>
              );
            })}
            {groups.map((g, i) => {
              const x0 = Lx + gw * i + (gw - bw * k - (k - 1) * 2) / 2;
              return (
                <g key={g.id ?? g.label} data-group={g.label}>
                  {g.bars.map((b, j) => {
                    const x = x0 + j * (bw + 2);
                    if (b.hatched) {
                      return <rect key={b.key} x={x} y={top + ch - 10} width={bw} height={10} fill={`url(#${id})`} strokeDasharray="2 2" className="stroke-[#a19cae] dark:stroke-gray-500" data-hatched="true" data-series={b.key} />;
                    }
                    const h = Math.max(b.cents > 0 ? 2 : 1, (ch * b.cents) / max);
                    return <rect key={b.key} x={x} y={top + ch - h} width={bw} height={h} rx={1.5} className={FILL[SERIES[j].tone]} data-series={b.key} data-cents={b.cents} />;
                  })}
                  <text x={x0 + (bw * k) / 2} y={height - 18} textAnchor="middle" className="fill-[#18181b] dark:fill-gray-100 font-semibold">{g.label}</text>
                  {g.issuedOn ? <text x={x0 + (bw * k) / 2} y={height - 5} textAnchor="middle" className={MUTE}>{compact ? 'issued' : `issued ${g.issuedOn}`}</text> : null}
                </g>
              );
            })}
            <line x1={Lx} x2={W} y1={top + ch} y2={top + ch} className="stroke-[#18181b] dark:stroke-gray-300" />
          </svg>
        </div>
      )}
    </div>
  );
}
