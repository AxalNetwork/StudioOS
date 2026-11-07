import React from 'react';
import { readFigure, securityState } from './securityStates.js';

/**
 * D4800 (#4800, canvas SE02 and SEB "StatusBadge") — one state from the
 * shared vocabulary, drawn as WORD + SHAPE, with its description repeated as
 * visually hidden text (SEC: "tooltips repeat as visually hidden text, not
 * only `title`"). Never colour alone: every shape differs in greyscale, and
 * Stale, Unknown and Not instrumented carry dashed or dotted outlines.
 *
 *   <StatusBadge state="failed" />                    → ✕ Failed
 *   <StatusBadge state="measured_zero" label="0 live impersonations" />
 *
 * With a `label`, the label is drawn in place of the word and the word is
 * still read out ("Measured zero: Read successfully; the count is 0.").
 */

// The canvas's twelve glyphs (SE02 `SHAPE`), 11 px, inheriting the ink.
const PATHS = {
  check: <path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" strokeWidth="2" />,
  triangle: <path d="M6 1l5 9.5H1z" fill="currentColor" />,
  cross: <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="2.2" />,
  clock: (
    <>
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 3.5V6l1.8 1.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </>
  ),
  'dashed-ring': <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2 1.6" />,
  question: (
    <>
      <path d="M4.2 4.3a1.9 1.9 0 1 1 2.4 1.8c-.4.2-.6.5-.6 1V8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="6" cy="10" r=".9" fill="currentColor" />
    </>
  ),
  'struck-square': (
    <>
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M1.5 10.5l9-9" stroke="currentColor" strokeWidth="1.6" />
    </>
  ),
  'dotted-ring': <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="1 1.8" />,
  'struck-ring': (
    <>
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2.8 9.2l6.4-6.4" stroke="currentColor" strokeWidth="1.6" />
    </>
  ),
  dash: <path d="M2.5 6h7" stroke="currentColor" strokeWidth="2" />,
  zero: <text x="6" y="9.5" textAnchor="middle" fontSize="9.5" fontWeight="700" fontFamily="monospace" fill="currentColor">0</text>,
  ring: <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />,
};

export function StateShape({ shape }) {
  return (
    <svg aria-hidden="true" width="11" height="11" viewBox="0 0 12 12" className="shrink-0" data-shape={shape}>
      {PATHS[shape]}
    </svg>
  );
}

// Colour is a hint on top of word and shape, light and dark.
const TONE = {
  positive: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200',
  attention: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
  'attention-soft': 'border-dashed border-amber-300 bg-transparent text-amber-900 dark:border-amber-800 dark:text-amber-200',
  negative: 'border-red-700 bg-red-700 text-white dark:border-red-600 dark:bg-red-600 dark:text-white',
  progress: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200',
  neutral: 'border-axal-hairline bg-transparent text-axal-muted dark:border-gray-700 dark:text-gray-300',
};

export default function StatusBadge({ state, label, className = '', 'data-testid': testId }) {
  const s = securityState(state);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-bold leading-none ${TONE[s.tone]} ${className}`}
      data-state={s.key}
      title={s.description}
      data-testid={testId}
    >
      <StateShape shape={s.shape} />
      <span>{label || s.word}</span>
      <span className="sr-only">{label ? ` (${s.word}: ${s.description})` : ` — ${s.description}`}</span>
    </span>
  );
}

/**
 * A count, or the badge that stands in for it (SE10i: "Unavailable is
 * explicitly not a pass"). An unreadable value is never drawn as 0 and
 * offers Retry when the caller can re-read it.
 */
export function ReadValue({ value, readable = true, what, onRetry, className = '' }) {
  const f = readFigure(value, { readable });
  if (f.text === null) {
    return (
      <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`} data-testid="security-read-unavailable">
        <StatusBadge state="unavailable" />
        {what && <span className="text-[11px] text-axal-faint">{what} could not be read</span>}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-axal-hairline bg-white px-2 py-0.5 text-[11px] font-semibold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            Retry
          </button>
        )}
      </span>
    );
  }
  return <span className={`tabular-nums ${className}`}>{f.text}</span>;
}
