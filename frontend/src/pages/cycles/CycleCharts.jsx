import { lineSegments, maxOf, share } from './cycleModel';

/**
 * D661 (#1474) — the cycle cards' charts, one component per helper in
 * `Cycle Overview.dc.html` (hbar, vbars, vstack, funnel, stack, line,
 * timeline, tiles, dots, rows, progress, big, heat, bands). Plain SVG and
 * markup, no chart library, and no HTML strings: the canvas built its charts
 * as strings and injected them as raw HTML; these are elements, so a label
 * from a read is always text.
 *
 * Every chart is 520 units wide, as the canvas draws them, and scales to its
 * card. Colours come from tone names (`TONE`), so dark mode is one place.
 */

const TONE = {
  v1: 'fill-axal-violet',
  v2: 'fill-violet-400',
  v3: 'fill-violet-200 dark:fill-violet-900',
  grey: 'fill-gray-200 dark:fill-gray-700',
  ok: 'fill-emerald-600',
  warn: 'fill-amber-500',
  bad: 'fill-red-600',
  muted: 'fill-gray-300 dark:fill-gray-600',
};
const SWATCH = {
  v1: 'bg-axal-violet',
  v2: 'bg-violet-400',
  v3: 'bg-violet-200 dark:bg-violet-900',
  grey: 'bg-gray-200 dark:bg-gray-700',
  ok: 'bg-emerald-600',
  warn: 'bg-amber-500',
  bad: 'bg-red-600',
  muted: 'bg-gray-300 dark:bg-gray-600',
};
const tone = (t, fallback = 'v1') => TONE[t] || TONE[fallback];
const INK = 'fill-axal-ink dark:fill-gray-100';
const MUTED = 'fill-axal-muted dark:fill-gray-400';
const AXIS = 'stroke-axal-hairline dark:stroke-gray-700';

function Svg({ h, label, children }) {
  return (
    <svg viewBox={`0 0 520 ${h}`} width="100%" role="img" aria-label={label} className="block overflow-visible" style={{ maxHeight: h * 1.6 }}>
      {children}
    </svg>
  );
}

function T({ x, y, children, size = 10, cls = MUTED, anchor = 'start', weight = 500 }) {
  return <text x={x} y={y} fontSize={size} textAnchor={anchor} fontWeight={weight} className={cls}>{children}</text>;
}

// A spec may say `unit: 'usd'`: its numbers are dollars and read as $1,440.
const fmt = (v, unit) => (typeof v === 'number'
  ? (unit === 'usd' ? `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : v.toLocaleString('en-US'))
  : String(v ?? ''));

export function Legend({ items }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-3">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-[11px] text-axal-muted dark:text-gray-400">
          <span aria-hidden="true" className={`h-[9px] w-[9px] rounded-[2px] ${SWATCH[it.tone] || SWATCH.v1}`} />{it.label}
        </span>
      ))}
    </div>
  );
}

function HBar({ spec, label }) {
  const items = spec.items || [];
  const mx = maxOf(items.map((i) => i.value));
  const h = items.length * 20 + (spec.more ? 18 : 4);
  return (
    <Svg h={h} label={label}>
      {items.map((it, i) => {
        const y = i * 20;
        const w = share(it.value, mx, 300, typeof it.value === 'number' ? 6 : 0);
        return (
          <g key={`${it.label}-${i}`}>
            <T x={0} y={y + 12} size={10.5} cls={INK}>{it.label}</T>
            {w > 0 && <rect x={170} y={y + 3} width={w} height={12} rx={3} className={tone(it.tone)}><title>{`${it.label}: ${fmt(it.value, spec.unit)}`}</title></rect>}
            <T x={176 + w} y={y + 13}>{typeof it.value === 'number' ? fmt(it.value, spec.unit) : 'Not recorded'}</T>
          </g>
        );
      })}
      {spec.more && <T x={0} y={h - 3} size={10.5} weight={700} cls="fill-axal-violet-deep dark:fill-violet-300">{spec.more}</T>}
    </Svg>
  );
}

function Axis({ labels, bw }) {
  return (labels || []).map((l) => <T key={`${l.at}-${l.label}`} x={24 + l.at * bw} y={114} size={9.5}>{l.label}</T>);
}

function VBars({ spec, label }) {
  const vals = spec.values || [];
  const mx = maxOf(vals);
  const bw = 496 / vals.length;
  return (
    <Svg h={118} label={label}>
      <line x1={20} y1={100} x2={520} y2={100} className={AXIS} />
      {vals.map((v, i) => {
        const hh = share(v, mx, 86);
        return hh > 0 ? <rect key={i} x={24 + i * bw} y={100 - hh} width={Math.max(1, bw - 5)} height={hh} rx={2} className={tone(spec.tone)}><title>{fmt(v, spec.unit)}</title></rect> : null;
      })}
      <Axis labels={spec.labels} bw={bw} />
      <T x={0} y={12} size={9.5}>{fmt(mx, spec.unit)}</T>
      <T x={0} y={100} size={9.5}>0</T>
    </Svg>
  );
}

function VStack({ spec, label }) {
  const rows = spec.rows || [];
  const tots = rows.map((r) => (r || []).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0));
  const mx = maxOf(tots);
  const bw = 496 / rows.length;
  return (
    <Svg h={118} label={label}>
      <line x1={20} y1={100} x2={520} y2={100} className={AXIS} />
      {rows.map((r, i) => {
        let y = 100;
        return (r || []).map((v, j) => {
          const hh = share(v, mx, 86);
          y -= hh;
          return hh > 0 ? <rect key={`${i}-${j}`} x={24 + i * bw} y={y} width={Math.max(1, bw - 5)} height={hh} className={tone(spec.tones?.[j])}><title>{fmt(v, spec.unit)}</title></rect> : null;
        });
      })}
      <Axis labels={spec.labels} bw={bw} />
      <T x={0} y={12} size={9.5}>{fmt(mx, spec.unit)}</T>
      <T x={0} y={100} size={9.5}>0</T>
    </Svg>
  );
}

function Funnel({ spec, label }) {
  const steps = spec.steps || [];
  const mx = steps[0]?.value || 0;
  return (
    <Svg h={steps.length * 24} label={label}>
      {steps.map((s, i) => {
        const w = share(s.value, mx, 340, typeof s.value === 'number' ? 10 : 0);
        const x = 170 + (340 - w) / 2;
        const last = i === steps.length - 1;
        return (
          <g key={`${s.label}-${i}`}>
            <T x={0} y={i * 24 + 14} size={10.5} cls={INK}>{s.label}</T>
            {w > 0 && <rect x={x} y={i * 24 + 3} width={w} height={15} rx={3} className={last ? TONE.v1 : TONE.v2}><title>{`${s.label}: ${fmt(s.value)}`}</title></rect>}
            {typeof s.value !== 'number'
              ? <T x={176} y={i * 24 + 14}>Not recorded</T>
              : w < 40
                ? <T x={x + w + 6} y={i * 24 + 14} weight={700} cls={INK}>{fmt(s.value)}</T>
                : <T x={340} y={i * 24 + 14} anchor="middle" weight={700} cls="fill-white">{fmt(s.value)}</T>}
          </g>
        );
      })}
    </Svg>
  );
}

function Stack({ spec, label }) {
  const rows = spec.rows || [];
  const bare = !!spec.bare;
  const x0 = bare ? 0 : 150;
  const W = bare ? 520 : 360;
  return (
    <Svg h={rows.length * 22} label={label}>
      {rows.map((r, i) => {
        const parts = r.parts || [];
        const tot = parts.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
        let x = x0;
        return (
          <g key={`${r.label}-${i}`}>
            {!bare && <T x={0} y={i * 22 + 13} size={10.5} cls={INK}>{r.label}</T>}
            {tot > 0 && parts.map((p, j) => {
              const w = (W * (typeof p === 'number' ? p : 0)) / tot;
              const at = x;
              x += w;
              if (w <= 0) return null;
              return (
                <g key={j}>
                  <rect x={at} y={i * 22 + 3} width={Math.max(0, w - 1)} height={14} className={tone(spec.tones?.[j])}><title>{`${r.label ? `${r.label} · ` : ''}${fmt(p)}`}</title></rect>
                  {w > 34 && <T x={at + 5} y={i * 22 + 13.5} size={9.5} cls={j === 0 ? 'fill-white' : INK}>{fmt(p)}</T>}
                </g>
              );
            })}
            {tot === 0 && <T x={x0} y={i * 22 + 13}>Not recorded</T>}
          </g>
        );
      })}
    </Svg>
  );
}

function Line({ spec, label }) {
  const vals = spec.values || [];
  const n = vals.length;
  const top = Math.max(maxOf(vals), maxOf(spec.plan || []), typeof spec.target === 'number' ? spec.target : 0) * 1.1;
  const X = (i) => 30 + (i * 480) / (n - 1);
  const Y = (v) => 104 - (94 * v) / top;
  const segs = lineSegments(vals, { max: top });
  const plan = spec.plan ? lineSegments(spec.plan, { max: top }) : [];
  return (
    <Svg h={122} label={label}>
      <line x1={30} y1={104} x2={510} y2={104} className={AXIS} />
      <T x={0} y={14} size={9.5}>{fmt(Math.round(top / 1.1), spec.unit)}</T>
      <T x={0} y={104} size={9.5}>0</T>
      {typeof spec.target === 'number' && (
        <g>
          <line x1={30} y1={Y(spec.target)} x2={510} y2={Y(spec.target)} strokeDasharray="5 4" className="stroke-amber-600" />
          <T x={506} y={Y(spec.target) - 5} size={9.5} anchor="end" cls="fill-amber-700 dark:fill-amber-400">{spec.target_label || `target · ${fmt(spec.target)}`}</T>
        </g>
      )}
      {plan.map((s, i) => <polyline key={`p${i}`} points={s.join(' ')} fill="none" strokeWidth={1.5} strokeDasharray="5 4" className="stroke-axal-muted" />)}
      {segs.map((s, i) => <polyline key={`s${i}`} points={s.join(' ')} fill="none" strokeWidth={2.2} className="stroke-axal-violet" />)}
      {vals.map((v, i) => (typeof v === 'number' ? <circle key={i} cx={X(i)} cy={Y(v)} r={2.6} className={TONE.v1}><title>{fmt(v, spec.unit)}</title></circle> : null))}
      {typeof spec.mark === 'number' && spec.mark >= 0 && spec.mark < n && (
        <g>
          <line x1={X(spec.mark)} y1={8} x2={X(spec.mark)} y2={104} strokeDasharray="3 3" className="stroke-red-600" />
          <T x={X(spec.mark) + (X(spec.mark) > 270 ? -4 : 4)} y={18} size={9.5} anchor={X(spec.mark) > 270 ? 'end' : 'start'} cls="fill-red-700 dark:fill-red-400">{spec.mark_label || ''}</T>
        </g>
      )}
      {(spec.labels || []).map((l) => <T key={`${l.at}-${l.label}`} x={X(l.at)} y={118} size={9.5} anchor="middle">{l.label}</T>)}
    </Svg>
  );
}

function Timeline({ spec, label }) {
  const steps = spec.steps || [];
  const X = (i) => 20 + (i * 480) / (steps.length - 1);
  return (
    <Svg h={56} label={label}>
      <line x1={20} y1={18} x2={500} y2={18} strokeWidth={2} className={AXIS} />
      {steps.map((s, i) => (
        <g key={`${s.label}-${i}`}>
          <circle cx={X(i)} cy={18} r={7} strokeWidth={2} className={s.done ? 'fill-axal-violet stroke-axal-violet' : 'fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-600'}><title>{s.done ? 'Done' : 'Not done'}</title></circle>
          <T x={X(i)} y={40} size={10.5} anchor="middle" weight={600} cls={INK}>{s.label}</T>
          <T x={X(i)} y={53} size={9.5} anchor="middle">{s.date || 'Not recorded'}</T>
        </g>
      ))}
    </Svg>
  );
}

const TILE = {
  connected: ['Connected', 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'],
  failing: ['Failing', 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'],
  not_connected: ['Not connected', 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'],
};

function Tiles({ spec }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
      {(spec.items || []).map((it) => {
        const [word, cls] = TILE[it.state] || TILE.not_connected;
        return (
          <div key={it.label} className={`flex flex-col gap-0.5 rounded-[9px] border p-2 ${cls}`}>
            <span className="text-[11.5px] font-bold text-axal-ink dark:text-gray-100">{it.label}</span>
            <span className="text-[10.5px] font-semibold">{word}</span>
          </div>
        );
      })}
    </div>
  );
}

function Dots({ spec }) {
  return (
    <div className="mt-2.5 flex items-center gap-1.5">
      {(spec.values || []).map((held, i) => (
        <span key={i} title={held ? 'Held' : 'Not held'} aria-label={held ? 'Held' : 'Not held'}
          className={`h-3 w-3 rounded-full border-[1.5px] ${held ? 'border-axal-violet bg-axal-violet' : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-900'}`} />
      ))}
      {spec.label && <span className="ml-1.5 text-[10.5px] text-axal-muted dark:text-gray-400">{spec.label}</span>}
    </div>
  );
}

const ROW_TONE = { ok: 'text-emerald-700 dark:text-emerald-300', warn: 'text-amber-700 dark:text-amber-300', bad: 'text-red-700 dark:text-red-300' };

function Rows({ spec }) {
  return (
    <div className="flex flex-col">
      {(spec.items || []).map((it, i) => (
        <div key={`${it.label}-${i}`} className="flex justify-between gap-2.5 border-b border-axal-ground py-[7px] text-[12px] last:border-b-0 dark:border-gray-800">
          <span className="font-semibold text-axal-ink dark:text-gray-100">{it.label}</span>
          <span className={`text-right ${ROW_TONE[it.tone] || 'text-axal-muted dark:text-gray-400'}`}>{it.value == null ? 'Not recorded' : fmt(it.value, spec.unit)}</span>
        </div>
      ))}
    </div>
  );
}

function Progress({ spec }) {
  return (
    <div className="flex flex-col gap-2">
      {(spec.items || []).map((it) => {
        const known = typeof it.pct === 'number';
        const pct = known ? Math.max(0, Math.min(100, it.pct)) : 0;
        return (
          <div key={it.label} className="grid grid-cols-[130px_minmax(0,1fr)_88px] items-center gap-2 text-[11.5px]">
            <span className="font-semibold text-axal-ink dark:text-gray-100">{it.label}</span>
            <div className="h-2 rounded-full bg-axal-ground dark:bg-gray-800" role="meter" aria-label={it.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? pct : undefined}>
              {known && <div className="h-2 rounded-full bg-axal-violet" style={{ width: `${pct}%` }} />}
            </div>
            <span className="text-right text-axal-muted dark:text-gray-400">{known ? `${Math.round(pct)}%` : 'Not recorded'}</span>
          </div>
        );
      })}
    </div>
  );
}

function Big({ spec }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[26px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{spec.value}</span>
      {spec.label && <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{spec.label}</span>}
    </div>
  );
}

function Heat({ spec, label }) {
  const rows = spec.rows || [];
  return (
    <Svg h={rows.length * 16 + 8 + (spec.axis ? 12 : 0)} label={label}>
      {rows.map((r, ri) => (
        <g key={`${r.label}-${ri}`}>
          <T x={0} y={ri * 16 + 12} size={9.5}>{r.label}</T>
          {(r.cells || []).map((v, c) => (typeof v === 'number'
            ? <rect key={c} x={40 + c * 34} y={ri * 16 + 2} width={32} height={14} rx={2} className={TONE.v1} opacity={Math.max(0.12, Math.min(1, v)).toFixed(2)}><title>{`${Math.round(v * 100)}%`}</title></rect>
            : null))}
        </g>
      ))}
      {spec.axis && <T x={40} y={rows.length * 16 + 14} size={9.5}>{spec.axis}</T>}
    </Svg>
  );
}

function Bands({ spec, label }) {
  const items = spec.items || [];
  const widths = [480, 300, 120];
  const tones = ['v3', 'v2', 'v1'];
  return (
    <Svg h={items.length * 26} label={label}>
      {items.map((it, i) => {
        const w = widths[i] ?? 120;
        // A narrow band cannot hold its words, so they sit beside it.
        const inside = w > 260;
        return (
        <g key={`${it.label}-${i}`}>
          <rect x={0} y={i * 26} width={w} height={20} rx={3} className={tone(tones[i] || 'v1')} />
          <T x={inside ? 8 : w + 8} y={i * 26 + 14} size={10.5} weight={600} cls={INK}>
            {`${it.label} · ${it.value == null ? 'Not recorded' : fmt(it.value)}${it.source ? ` · ${it.source}` : ''}`}
          </T>
        </g>
        );
      })}
    </Svg>
  );
}

const DRAW = { hbar: HBar, vbars: VBars, vstack: VStack, funnel: Funnel, stack: Stack, line: Line, timeline: Timeline, tiles: Tiles, dots: Dots, rows: Rows, progress: Progress, big: Big, heat: Heat, bands: Bands };

/** One chart spec, with its legend. The caller has already kept only drawable specs. */
export function Chart({ spec, label }) {
  const Draw = DRAW[spec.kind];
  if (!Draw) return null;
  return (
    <div data-chart={spec.kind}>
      <Draw spec={spec} label={label} />
      <Legend items={spec.legend} />
    </div>
  );
}

/** A small sparkline for a headline figure; the caller checks it has enough points. */
export function Spark({ values, label }) {
  const segs = lineSegments(values, { x0: 0, width: 90, y0: 22, height: 20, max: maxOf(values) });
  return (
    <svg viewBox="0 0 90 24" width="90" height="24" role="img" aria-label={label} className="block">
      {segs.map((s, i) => <polyline key={i} points={s.join(' ')} fill="none" strokeWidth={1.8} className="stroke-axal-violet" />)}
    </svg>
  );
}
