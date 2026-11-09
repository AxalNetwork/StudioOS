import React from 'react';
import { StateShape } from '../security/StatusBadge.jsx';
import { COVERAGE_STATES, TEMPORAL, periodLabel, valueState } from './revenueModel.js';

/**
 * D5039 (canvas RV03) — the cockpit's shared vocabulary, drawn: the eight
 * value states, the coverage states and the temporal labels. Every state is a
 * WORD and a SHAPE (Security v2's glyphs, `StateShape`), so none is colour
 * alone; colour is a hint on top, light and dark.
 */

const TONE = {
  positive: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200',
  attention: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
  'attention-soft': 'border-dashed border-amber-400 bg-transparent text-amber-900 dark:border-amber-700 dark:text-amber-200',
  negative: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200',
  progress: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200',
  neutral: 'border-axal-hairline bg-transparent text-axal-muted dark:border-gray-700 dark:text-gray-300',
};

/** One value state as a small mark: shape and word, with the description read out. */
export function StateMark({ state, label, className = '' }) {
  const s = valueState(state);
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[12px] font-semibold leading-none ${TONE[s.tone]} ${className}`}
      data-value-state={s.key}
      title={s.description}
    >
      <StateShape shape={s.shape} />
      {label || s.word}
      <span className="sr-only">{label ? ` (${s.word}: ${s.description})` : `: ${s.description}`}</span>
    </span>
  );
}

/**
 * A figure in its state. A recorded value is drawn as itself; a zero, a floor
 * or a stale value is drawn with its mark beside it; a figure with no value is
 * drawn as its state's word, never as 0 and never as a dash.
 */
export function Figure({ figure, large = false, absentLabel, negative = false }) {
  const f = figure || { state: 'loading', text: null };
  // A loss is toned as one, on top of its sign; never by colour alone.
  const ink = negative ? 'text-red-700 dark:text-red-300' : 'text-axal-ink dark:text-gray-100';
  const valueClass = large
    ? `font-mono text-[24px] font-bold tracking-tight tabular-nums ${ink}`
    : `font-mono font-semibold tabular-nums ${ink}`;
  if (f.state === 'loading') {
    return (
      <span className="inline-flex items-center gap-1.5" aria-busy="true" data-value-state="loading">
        <span aria-hidden="true" className={`inline-block rounded bg-axal-hairline dark:bg-gray-800 ${large ? 'h-6 w-24' : 'h-3.5 w-14'}`} />
        <StateMark state="loading" />
      </span>
    );
  }
  if (!f.text) return <StateMark state={f.state} label={absentLabel} className={large ? 'text-[13px]' : ''} />;
  if (f.state === 'recorded') return <span className={valueClass} data-value-state="recorded">{f.text}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`${valueClass} ${f.state === 'stale' ? 'opacity-70' : ''}`}>{f.text}</span>
      <StateMark state={f.state} />
    </span>
  );
}

/** A coverage state (Complete, Partial, Not recorded …), shape and word. */
export function CoverageMark({ state, label }) {
  const s = COVERAGE_STATES[state] || COVERAGE_STATES.loading;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-semibold leading-none ${TONE[s.tone]}`}
      data-coverage-state={state}
    >
      <StateShape shape={s.shape} />
      {label || s.word}
    </span>
  );
}

/**
 * A temporal label. `period` draws the selected quarter's own label; the rest
 * say they ignore it.
 */
export function When({ kind = 'period', period }) {
  const t = TEMPORAL[kind] || TEMPORAL.period;
  const word = kind === 'period' ? (periodLabel(period) || 'Period') : t.word;
  const style = {
    period: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200',
    live: 'border-emerald-200 text-emerald-800 dark:border-emerald-900 dark:text-emerald-200',
    d30: 'border-dashed border-axal-hairline text-axal-muted dark:border-gray-600 dark:text-gray-300',
    now: 'border-axal-hairline bg-white text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300',
    month: 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-300',
  }[kind] || '';
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-px font-mono text-[12px] font-bold uppercase tracking-[.05em] ${style}`} data-temporal={kind} title={t.description}>
      {kind === 'live' && <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />}
      {word}
      <span className="sr-only"> — {t.description}</span>
    </span>
  );
}

/** "Why?" — every explanation lives in the coverage drawer; this opens it at one source. */
export function Why({ source, onOpen, label = 'Why?' }) {
  return (
    <button
      type="button"
      onClick={() => onOpen?.(source)}
      className="rounded px-0.5 text-[12px] font-semibold text-axal-violet-deep underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-axal-violet dark:text-violet-300"
      aria-label={`${label} Open data coverage for this figure`}
      data-why={source}
    >
      {label}
    </button>
  );
}

/** A cockpit section: heading, its temporal label and a short line, then its body. */
export function Section({ id, title, when, sub, actions = null, children, testId }) {
  const hid = `${id}-h`;
  return (
    <section id={id} aria-labelledby={hid} className="min-w-0 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900 sm:p-5" data-testid={testId}>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 id={hid} className="text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{title}</h2>
        {when}
        {sub && <span className="text-[12.5px] text-axal-muted dark:text-gray-400">{sub}</span>}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Shared table classes: 13.5px cells, 12px headers, every number tabular. */
export const TABLE = 'w-full border-collapse text-left text-[13.5px] text-axal-ink dark:text-gray-100';
export const TH = 'whitespace-nowrap border-b border-axal-hairline px-3 py-2 font-mono text-[12px] font-bold uppercase tracking-[.05em] text-axal-muted dark:border-gray-700 dark:text-gray-400';
export const TD = 'border-b border-axal-hairline/70 px-3 py-2.5 align-middle dark:border-gray-800';
export const NUM = 'text-right tabular-nums whitespace-nowrap';
export const BTN = 'inline-flex min-h-[32px] items-center justify-center gap-1.5 rounded-lg border border-axal-hairline bg-white px-3 text-[13px] font-bold text-axal-ink hover:bg-axal-ground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
