import React from 'react';
import { weeklyChartGeometry } from '../lib/weeklyChart';

/**
 * A weekly line chart — H15's one line per branch, S15's one line against
 * HQ's median (D210). Every coordinate comes from `weeklyChartGeometry()` in
 * `lib/weeklyChart.js`; this file draws and holds no arithmetic, on the
 * precedent of `components/scoring/TrajectoryChart.jsx`.
 *
 * WHAT IT WILL NOT DRAW, BECAUSE THE GEOMETRY DOES NOT HAND IT OVER: a point
 * for a week with no value, or a segment joining the two sides of a gap. A
 * line breaks where the series has nothing, and a single measured week is a
 * dot rather than a line to nowhere.
 *
 * THE LABELS ARE HTML, NOT SVG `<text>` — the canvases' own comment says why:
 * the SVG scales with the column, and HTML text stays legible at any width.
 * The y column is positioned by percentage over the SVG's own box, which
 * scales uniformly (`h-auto`, no `preserveAspectRatio="none"`), so a label
 * sits on its gridline at every width and a dot stays round.
 *
 * COLOUR BY CLASS, NOT BY HEX. Each series carries a `text-* dark:text-*`
 * pair and strokes with `currentColor`, so the line follows the theme and the
 * legend beside it can use the same class and cannot disagree with the line.
 *
 * THE CURRENT WEEK'S POINT IS HOLLOW. That week has not ended, so its count is
 * a count so far and will read as a drop against every finished week; the
 * hollow point and its title say so rather than letting the line imply it.
 */
function xLabelShift(pct) {
  if (pct < 6) return 'translate-x-0';
  if (pct > 94) return '-translate-x-full';
  return '-translate-x-1/2';
}

export default function WeeklyLineChart({
  weeks,
  series = [],
  median = null,
  ariaLabel,
  emptyNote,
  testId = 'weekly-line-chart',
}) {
  const geo = weeklyChartGeometry({ weeks, series, median });
  const classOf = new Map(series.map((s) => [s.key, s.colorClass]));

  return (
    <div data-testid={testId}>
      <div className="relative pl-9">
        <div className="pointer-events-none absolute inset-y-0 left-0 w-8" aria-hidden="true">
          {geo.ticks.map((t) => (
            <span
              key={t.value}
              className="absolute right-1 -translate-y-1/2 font-mono text-[9.5px] tabular-nums text-axal-faint"
              style={{ top: `${t.pct}%` }}
            >
              {t.value}
            </span>
          ))}
        </div>
        <svg viewBox={geo.viewBox} className="block h-auto w-full" role="img" aria-label={ariaLabel}>
          <g className="text-gray-200 dark:text-gray-700">
            {geo.ticks.map((t) => (
              <line key={t.value} x1={geo.plot.left} x2={geo.plot.right} y1={t.y} y2={t.y} stroke="currentColor" strokeWidth="1" />
            ))}
          </g>
          {geo.median && (
            <line
              x1={geo.plot.left}
              x2={geo.plot.right}
              y1={geo.median.y}
              y2={geo.median.y}
              className="text-gray-400 dark:text-gray-500"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeDasharray="4 4"
              data-testid={`${testId}-median`}
            />
          )}
          {geo.series.map((s) => (
            <g
              key={s.key}
              className={classOf.get(s.key) || 'text-slate-700 dark:text-slate-300'}
              data-testid={`${testId}-series`}
              data-series={s.key}
              data-dashed={s.dashed ? 'true' : 'false'}
            >
              {s.lines.map((points, i) => (
                <polyline
                  key={`l${i}`}
                  points={points}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={s.dashed ? '5 4' : undefined}
                />
              ))}
              {s.dots.map((d) => (
                <circle key={`d${d.i}`} cx={d.x} cy={d.y} r="3" fill="currentColor">
                  <title>{`${d.value} · week of ${weeks[d.i]}`}</title>
                </circle>
              ))}
              {s.last && (
                <circle
                  cx={s.last.x}
                  cy={s.last.y}
                  r="3.5"
                  fill={s.last.partial ? 'none' : 'currentColor'}
                  stroke="currentColor"
                  strokeWidth="1.8"
                  data-partial={s.last.partial ? 'true' : 'false'}
                >
                  <title>
                    {`${s.last.value} · week of ${s.last.week}${s.last.partial ? ' · so far — this week has not ended' : ''}`}
                  </title>
                </circle>
              )}
            </g>
          ))}
        </svg>
        {geo.empty && emptyNote && (
          <p
            className="absolute inset-0 left-9 flex items-center justify-center px-6 text-center text-[11.5px] leading-relaxed text-axal-muted"
            data-testid={`${testId}-empty`}
          >
            {emptyNote}
          </p>
        )}
      </div>
      <div className="relative ml-9 mt-1 h-4" aria-hidden="true">
        {geo.labels.map((l) => (
          <span
            key={l.week}
            className={`absolute top-0 font-mono text-[9.5px] tabular-nums text-axal-faint ${xLabelShift(l.pct)}`}
            style={{ left: `${l.pct}%` }}
          >
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
