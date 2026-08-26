import React from 'react';
import SectionLabel from './SectionLabel';

/**
 * The stat / KPI tile — 93 of 107 canvases use one, and 138 files under
 * frontend/src hand-roll their own version today. That duplication is what
 * this replaces.
 *
 *   <Stat label="Committed" value="$4.2M" delta="+12%" trend="up" />
 *   <Stat label="TVPI" value="1.34x" note="Since inception" align="right" />
 *
 * `value` renders in the mono face with tabular figures, because these are
 * numbers people scan down a column and compare — proportional digits make
 * that measurably harder. Non-numeric values are fine; pass mono={false} to
 * opt a text value out.
 *
 * `trend` only colours the delta. It deliberately does NOT decide direction
 * from the sign: for burn rate or time-to-close, down is good. The caller
 * knows which way is up; this component does not guess.
 */
const TRENDS = {
  up: 'text-emerald-700 dark:text-emerald-400',
  down: 'text-red-700 dark:text-red-400',
  flat: 'text-axal-muted dark:text-gray-400',
};

export function Stat({
  label,
  value,
  delta,
  trend = 'flat',
  note,
  align = 'left',
  mono = true,
  className = '',
  'data-testid': testId,
}) {
  const alignment = align === 'right' ? 'text-right items-end' : 'text-left items-start';
  return (
    <div
      data-testid={testId || 'stat'}
      className={`flex flex-col gap-1 ${alignment} ${className}`}
    >
      {label && <SectionLabel>{label}</SectionLabel>}
      <div className="flex items-baseline gap-2">
        <span
          className={`text-xl font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100 ${
            mono ? 'font-mono tabular-nums' : ''
          }`}
        >
          {value ?? '—'}
        </span>
        {delta != null && (
          <span className={`text-xs font-semibold font-mono tabular-nums ${TRENDS[trend] ?? TRENDS.flat}`}>
            {delta}
          </span>
        )}
      </div>
      {note && <span className="text-xs text-axal-muted dark:text-gray-400">{note}</span>}
    </div>
  );
}

/**
 * The row/grid these sit in. Defaults to 4 across on desktop, collapsing to 2
 * and then 1 — the arrangement the canvases use most.
 */
const COLS = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
};

export function StatGrid({ children, cols = 4, className = '', 'data-testid': testId }) {
  return (
    <div
      data-testid={testId || 'stat-grid'}
      className={`grid gap-4 ${COLS[cols] ?? COLS[4]} ${className}`}
    >
      {children}
    </div>
  );
}

export default Stat;
