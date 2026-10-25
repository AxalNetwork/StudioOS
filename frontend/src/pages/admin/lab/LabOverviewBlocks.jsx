import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Chart, Legend } from '../../../ui/Charts.jsx';
import { CARD, EYE, H2, SUB, LINK, Select } from './labParts';
import { POOL_PARTS } from './labOverviewModel';
import { DATES_FIXED } from './labModel';

/**
 * D947 (#2752) — what SL1's Overview and SL5's calendar draw: the cohort
 * calendar timeline, Applications by cohort, Weeks passed, From application
 * to company and Applications per week, each with its Chart ⇄ Table switch,
 * and each in one of its four states (Reading…, Unreadable with Try again,
 * empty with its sentence, or drawn). Built from `labOverviewModel.js`.
 */

const DANGER = 'inline-flex min-h-[36px] self-start items-center justify-center rounded-[9px] border border-axal-destructive-edge bg-white px-3.5 text-[12.5px] font-bold text-axal-destructive dark:border-red-900 dark:bg-gray-900 dark:text-red-400';
const SEG = 'min-h-[30px] px-2.5 text-[11.5px] font-bold';

function Skeleton() {
  return <span className="block h-2.5 w-[70%] rounded-full bg-axal-hairline dark:bg-gray-700" />;
}

/** Chart ⇄ Table, a two-state switch whose state is said, not only shown. */
export function ViewSwitch({ table, onChange, testId }) {
  return (
    <span className="inline-flex overflow-hidden rounded-[8px] border border-axal-hairline dark:border-gray-700" role="group" aria-label="View" data-testid={testId}>
      {['Chart', 'Table'].map((w) => (
        <button key={w} type="button" aria-pressed={(w === 'Table') === table} onClick={() => onChange(w === 'Table')}
          className={`${SEG} ${(w === 'Table') === table ? 'bg-axal-lavender text-axal-violet dark:bg-violet-950/50 dark:text-violet-300' : 'bg-white text-axal-muted dark:bg-gray-900 dark:text-gray-400'}`}>{w}</button>
      ))}
    </span>
  );
}

/** A block's card, drawing its loading, unreadable and empty states itself. */
export function Block({ id, title, block, onRetry, right, wide = false, children, foot }) {
  return (
    <section className={`${CARD} col-span-12 flex min-w-0 flex-col gap-3 px-[18px] py-4 ${wide ? '' : 'lg:col-span-6'}`} aria-labelledby={`lab-h-${id}`} data-testid={`lab-${id}`}>
      <span className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`lab-h-${id}`} className={H2}>{title}</h2>
        {block?.state === 'ready' ? right : null}
      </span>
      {block?.state === 'loading' && <><span className="font-mono text-[13px] text-axal-muted dark:text-gray-400">Reading…</span><Skeleton /><Skeleton /></>}
      {block?.state === 'unreadable' && (
        <div role="alert" className="flex flex-col gap-2.5 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint p-3.5 text-[13px] leading-normal text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <span>{block.reason}</span>
          <button type="button" className={DANGER} onClick={onRetry}>Try again</button>
        </div>
      )}
      {block?.state === 'empty' && <span className={SUB} data-testid={`lab-${id}-empty`}>{block.text}</span>}
      {block?.state === 'ready' ? children : null}
      {block?.state === 'ready' && foot ? <span className={SUB}>{foot}</span> : null}
    </section>
  );
}

/** A plain table from the model's `{ head, rows }`. */
function SimpleTable({ table, caption }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-[#faf9fc] text-left text-[10.5px] font-bold uppercase tracking-[.06em] text-axal-muted dark:bg-gray-800 dark:text-gray-400">
            {table.head.map((t, i) => <th key={t} scope="col" className={`px-3 py-2${i ? ' text-right' : ''}`}>{t}</th>)}
          </tr>
        </thead>
        <tbody>
          {table.rows.map(([k, ...vs]) => (
            <tr key={k} className="border-t border-axal-hairline dark:border-gray-700">
              <th scope="row" className="px-3 py-2 text-left font-semibold text-axal-ink dark:text-gray-100">{k}</th>
              {vs.map((v, j) => <td key={j} className="px-3 py-2 text-right font-mono tabular-nums text-axal-ink dark:text-gray-100">{v}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── the cohort calendar timeline ───────────────────────────────────────────

const LEGEND = (
  <span className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[11.5px] text-axal-muted dark:text-gray-400">
    <span className="flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-[3px] border border-axal-lavender-edge bg-axal-lavender dark:border-violet-800 dark:bg-violet-950/50" />Applications open</span>
    <span className="flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-[3px] bg-[repeating-linear-gradient(45deg,#f59e0b_0_2px,#fef3c7_2px_5px)]" />In review · pool frozen</span>
    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-axal-violet dark:bg-[#a78bfa]" />Weeks 1 to 4</span>
    <span>⚑ Week 4 deadline</span>
    <span>│ Today</span>
  </span>
);

/**
 * The calendar: one lane per cohort, the month grid, the application window,
 * the review window hatched, W1–W4, the Week 4 flag and Today. Every segment
 * is focusable and names itself (its `<title>` is its tooltip); a lane's
 * label opens its cohort, and so does a click anywhere on the lane.
 */
export function Timeline({ tl, detail = false }) {
  const navigate = useNavigate();
  const W = 1080;
  const LW = detail ? 230 : 150;
  const lh = detail ? 46 : 42;
  const top = 28;
  const iw = W - LW - 14;
  const H = top + tl.lanes.length * lh + 4;
  const X = (t) => +(LW + ((Math.min(Math.max(t, tl.range.from), tl.range.to) - tl.range.from) / (tl.range.to - tl.range.from)) * iw).toFixed(1);
  const tip = (lane, part) => lane.tips.find((t) => t.part === part)?.text || lane.label;
  return (
    <div className="overflow-x-auto" data-testid="lab-timeline">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block min-w-[900px] max-w-none font-display lg:w-full" role="img" aria-label={tl.alt}>
        <defs>
          <pattern id="lab-review-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <rect width="6" height="6" className="fill-amber-100 dark:fill-amber-950" />
            <line x1="0" y1="0" x2="0" y2="6" strokeWidth="2" className="stroke-[#f59e0b]" />
          </pattern>
        </defs>
        {tl.months.map((m) => (
          <g key={m.at}>
            <line x1={X(m.at)} x2={X(m.at)} y1={top - 10} y2={H} className="stroke-axal-hairline dark:stroke-gray-700" />
            <text x={X(m.at) + 4} y={12} className="fill-axal-muted font-mono text-[11px] dark:fill-gray-400">{m.label}</text>
          </g>
        ))}
        {tl.lanes.map((l, i) => {
          const y0 = top + i * lh;
          const by = y0 + (detail ? 9 : (lh - 14) / 2);
          const seg = (a, b, part, cls, fill, label) => {
            if (a == null || b == null || b <= tl.range.from || a >= tl.range.to) return null;
            const x1 = X(a);
            const x2 = X(b);
            return (
              <g key={part}>
                <rect x={x1} y={by} width={Math.max(1, x2 - x1 - 1.5)} height={14} rx={3} className={cls} fill={fill} tabIndex={0} data-testid={`lab-seg-${l.key}-${part}`}>
                  <title>{tip(l, part)}</title>
                </rect>
                {label && x2 - x1 > 26 ? <text x={(x1 + x2) / 2} y={by + 10.5} textAnchor="middle" pointerEvents="none" className="fill-white font-mono text-[9.5px] font-bold dark:fill-gray-900">{label}</text> : null}
              </g>
            );
          };
          return (
            <g key={l.key} data-testid={`lab-lane-${l.key}`} className="cursor-pointer" onClick={() => navigate(l.href)}>
              <line x1={0} x2={W} y1={y0 + lh} y2={y0 + lh} className="stroke-axal-hairline dark:stroke-gray-700" />
              <text x={0} y={by + 5} className="fill-axal-ink text-[12.5px] font-bold dark:fill-gray-100">{l.label}</text>
              <text x={0} y={by + 19} className="fill-axal-muted text-[11px] dark:fill-gray-400">{l.word}{l.weeksUnreadable ? ' · weeks unreadable' : l.weeksMissing ? ' · weeks not recorded' : ''}</text>
              {seg(l.open, l.close, 'open', 'fill-axal-lavender stroke-axal-lavender-edge dark:fill-violet-950 dark:stroke-violet-800')}
              {seg(l.close, l.start, 'review', 'stroke-[#f59e0b]', 'url(#lab-review-hatch)')}
              {l.weeks.map((w) => seg(w.from, w.to, `w${w.n}`, 'fill-axal-violet dark:fill-[#a78bfa]', undefined, `W${w.n}`))}
              {l.week4 != null && l.week4 > tl.range.from && l.week4 <= tl.range.to ? (
                <path d={`M${X(l.week4)} ${by - 5}V${by + 17}M${X(l.week4)} ${by - 5}l8 3.5-8 3.5z`} className="fill-axal-ink stroke-axal-ink dark:fill-gray-100 dark:stroke-gray-100" strokeWidth="1.2" tabIndex={0} data-testid={`lab-seg-${l.key}-deadline`}>
                  <title>{tip(l, 'deadline')}</title>
                </path>
              ) : null}
            </g>
          );
        })}
        <line x1={X(tl.today)} x2={X(tl.today)} y1={top - 10} y2={H} strokeWidth="1.5" className="stroke-axal-ink dark:stroke-gray-100" />
        <text x={X(tl.today) + 4} y={top - 2} className="fill-axal-ink text-[10.5px] font-bold dark:fill-gray-100">Today</text>
      </svg>
      <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0" aria-label="Open a cohort">
        {tl.lanes.map((l) => (
          <li key={l.key}><Link to={`/admin/programs/spinout-lab/cohorts/${l.key}`} className={LINK} data-testid={`lab-lane-link-${l.key}`}>{l.label}</Link></li>
        ))}
      </ul>
    </div>
  );
}

/** The calendar as a table: what each lane draws, in words. */
export function TimelineTable({ tl }) {
  return (
    <SimpleTable caption="Cohort calendar" table={{
      head: ['Cohort', 'Status', 'Applications', 'Starts', 'Week 4 deadline'],
      rows: tl.lanes.map((l) => [
        l.label, l.word,
        l.tips.find((t) => t.part === 'open')?.text.replace(`${l.label} · Applications `, '') || 'Not recorded',
        l.tips.find((t) => t.part === 'review')?.text.split('until ')[1] || 'Not recorded',
        l.tips.find((t) => t.part === 'deadline')?.text.split('deadline ')[1] || (l.weeksUnreadable ? 'Unreadable' : 'Not recorded'),
      ]),
    }} />
  );
}

export function CalendarBlock({ tl, onRetry, title = 'Cohort calendar', id = 'calendar', detail = false, right = null, foot }) {
  const [table, setTable] = useState(false);
  return (
    <Block id={id} title={title} block={tl} onRetry={onRetry} wide
      right={<span className="flex items-center gap-2">{right}<ViewSwitch table={table} onChange={setTable} testId={`lab-${id}-view`} /></span>}
      foot={foot || `${DATES_FIXED} Times are ET (America/New_York). Click a lane to open its cohort.`}>
      {LEGEND}
      {table ? <TimelineTable tl={tl} /> : <Timeline tl={tl} detail={detail} />}
    </Block>
  );
}

// ── Applications by cohort ─────────────────────────────────────────────────

export function ByCohortBlock({ block, onRetry }) {
  const [table, setTable] = useState(false);
  return (
    <Block id="by-cohort" title="Applications by cohort" block={block} onRetry={onRetry}
      right={<ViewSwitch table={table} onChange={setTable} testId="lab-by-cohort-view" />}
      foot={block.state === 'ready' ? [block.foot, block.settingsUnreadable ? 'Places and the minimum could not be read, so no line is drawn for them.' : null].filter(Boolean).join(' ') || null : null}>
      {block.state === 'ready' && (
        <>
          <Legend items={POOL_PARTS.map((p) => ({ label: p.label, tone: p.tone }))} />
          {table
            ? <SimpleTable table={block.table} caption="Applications by cohort" />
            : <div role="img" aria-label={block.alt}><Chart chart={block.chart} /></div>}
          {block.unreadCohorts ? <span className="text-[12.5px] text-axal-destructive dark:text-red-400">{block.unreadCohorts === 1 ? 'One cohort’s pool' : `${block.unreadCohorts} cohorts’ pools`} could not be read, so its column is an outline, not a zero.</span> : null}
        </>
      )}
    </Block>
  );
}

// ── Weeks passed, by cohort ────────────────────────────────────────────────

const CELL = 'relative flex min-h-[50px] flex-col items-center justify-center rounded-[8px] px-1 pt-2 text-center font-mono text-[12px] font-bold';

export function HeatBlock({ block, onRetry }) {
  const [table, setTable] = useState(false);
  return (
    <Block id="weeks" title="Weeks passed, by cohort" block={block} onRetry={onRetry}
      right={<ViewSwitch table={table} onChange={setTable} testId="lab-weeks-view" />} foot={block.state === 'ready' ? block.note : null}>
      {block.state === 'ready' && (table ? (
        <SimpleTable caption="Weeks passed, by cohort" table={{
          head: ['Cohort', 'Week 1', 'Week 2', 'Week 3', 'Week 4'],
          rows: block.rows.map((r) => [r.label, ...r.cells.map((c) => (c.kind === 'counts' ? `${c.passed} passed · ${c.failed} failed · ${c.grace} grace` : c.text))]),
        }} />
      ) : (
        <div role="table" aria-label="Weeks passed by cohort" className="grid grid-cols-[96px_repeat(4,minmax(0,1fr))] gap-1">
          <span role="row" className="contents">
            <span role="columnheader" />
            {[1, 2, 3, 4].map((n) => <span key={n} role="columnheader" className={`${EYE} py-1 text-center`}>Week {n}</span>)}
          </span>
          {block.rows.map((r) => (
            <span key={r.key} role="row" className="contents" data-testid={`lab-heat-${r.key}`}>
              <span role="rowheader" className="self-center text-[12.5px] font-bold text-axal-ink dark:text-gray-100">{r.label}</span>
              {r.cells.map((c) => {
                if (c.kind === 'now') return <span key={c.n} role="cell" title={`Running; its deadline is ${c.deadline}.`} className={`${CELL} border-[1.5px] border-axal-violet text-[11px] text-axal-violet dark:border-[#a78bfa] dark:text-violet-300`}>{c.text}</span>;
                if (c.kind !== 'counts') return <span key={c.n} role="cell" className={`${CELL} border border-axal-hairline bg-[repeating-linear-gradient(135deg,#f7f6fa_0_6px,#fff_6px_12px)] font-display text-[11px] font-semibold text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400`}>{c.text}</span>;
                return (
                  <span key={c.n} role="cell" tabIndex={0} title={`${r.label} · Week ${c.n} · ${c.passed} passed, ${c.failed} failed, ${c.grace} in grace, ${c.pending} not decided`}
                    className={`${CELL} bg-axal-lavender text-axal-ink dark:bg-violet-950/60 dark:text-gray-100`}>
                    {c.text}
                    <span className="font-display text-[10.5px] font-semibold text-axal-muted dark:text-gray-400">{c.failed} failed</span>
                    {c.grace ? <span className="absolute right-1 top-0.5 rounded-full bg-white px-1.5 text-[9.5px] text-axal-violet dark:bg-gray-900 dark:text-violet-300">{c.grace} grace</span> : null}
                  </span>
                );
              })}
            </span>
          ))}
        </div>
      ))}
    </Block>
  );
}

// ── From application to company ────────────────────────────────────────────

export function FunnelBlock({ block, onRetry, onChoose }) {
  const [table, setTable] = useState(false);
  return (
    <Block id="funnel" title="From application to company" block={block} onRetry={onRetry} foot={block.state === 'ready' ? block.foot : null}
      right={block.state === 'ready' ? (
        <span className="flex flex-wrap items-center gap-2">
          <Select label="Cohort" value={block.cohort} onChange={onChoose} options={block.options.map((o) => ({ value: o.key, label: `Cohort: ${o.label}` }))} testId="lab-funnel-cohort" />
          <ViewSwitch table={table} onChange={setTable} testId="lab-funnel-view" />
        </span>
      ) : null}>
      {block.state === 'ready' && (table ? (
        <SimpleTable caption={`From application to company, ${block.label}`} table={{ head: ['Step', 'Founders', 'Of applied'], rows: block.rows.map((r) => [r.label, r.text, r.pct == null ? '—' : `${r.pct}%`]) }} />
      ) : (
        <div role="img" aria-label={block.alt} className="grid grid-cols-[136px_minmax(0,1fr)_auto] items-center gap-2.5 text-[12.5px]">
          {block.rows.map((r) => (
            <React.Fragment key={r.key}>
              <span className="font-semibold text-axal-ink dark:text-gray-100">{r.label}</span>
              <span className="block h-[14px] overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800">
                {r.kind === 'value'
                  ? <span className="block h-full rounded-full bg-axal-violet dark:bg-[#a78bfa]" style={{ width: `${Math.round((r.share ?? 0) * 100)}%` }} />
                  : <span className="block h-full rounded-full border-[1.5px] border-dashed border-axal-muted" />}
              </span>
              <span className="font-mono tabular-nums text-axal-ink dark:text-gray-100" title={r.reason || undefined} data-testid={`lab-funnel-${r.key}`}>{r.text}{r.pct != null ? ` · ${r.pct}%` : ''}</span>
            </React.Fragment>
          ))}
        </div>
      ))}
    </Block>
  );
}

// ── Applications per week ──────────────────────────────────────────────────

export function PerWeekBlock({ block, onRetry }) {
  const [table, setTable] = useState(false);
  return (
    <Block id="per-week" title="Applications per week" block={block} onRetry={onRetry} wide
      right={<ViewSwitch table={table} onChange={setTable} testId="lab-per-week-view" />}
      foot="Monday weeks in ET. The hollow point is the current week, so far.">
      {block.state === 'ready' && (table
        ? <SimpleTable table={block.table} caption="Applications per week" />
        : <div role="img" aria-label={block.alt}><Chart chart={block.chart} /></div>)}
    </Block>
  );
}

