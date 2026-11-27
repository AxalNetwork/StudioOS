import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Unrecorded } from '../../ui';
import { sparkPath } from './wellbeingModel';

/**
 * D570 — the pieces the four Wellbeing screens share: the page header, the
 * card header, the 1–5 score dots, the sparkline, the step chips and the
 * "Not recorded, and why" line. Tokens only (`axal-*`, from index.css), never
 * a font: the type face is the app's own.
 */

/** Button looks, matching the canvas's primary, ghost, danger and link buttons. */
export const BTN = {
  primary: 'inline-flex items-center justify-center gap-1.5 rounded-axal-sm bg-axal-violet px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-axal-violet/50',
  ghost: 'inline-flex items-center justify-center gap-1.5 rounded-axal-sm border border-axal-hairline bg-white px-3 py-2 text-[12.5px] font-semibold text-axal-ink transition-colors hover:border-axal-violet/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
  danger: 'inline-flex items-center justify-center gap-1.5 rounded-axal-sm border border-red-200 px-3 py-2 text-[12.5px] font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40',
  link: 'inline-flex items-center gap-1 text-[12.5px] font-semibold text-axal-violet-deep hover:text-axal-violet disabled:opacity-50 dark:text-violet-300',
  dangerLink: 'inline-flex items-center gap-1 text-[12.5px] font-semibold text-red-700 hover:text-red-800 disabled:opacity-50 dark:text-red-300',
};

/** Inputs, labels and the one-line notes under them. */
export const FIELD = {
  input: 'w-full rounded-axal-sm border border-axal-hairline bg-white px-3 py-2 text-sm text-axal-ink placeholder:text-axal-faint focus:outline-none focus:ring-2 focus:ring-axal-violet/30 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
  label: 'mb-1 block text-xs font-semibold text-axal-ink dark:text-gray-200',
  note: 'text-xs text-axal-muted dark:text-gray-400',
  error: 'mt-1 text-xs text-red-700 dark:text-red-300',
};

/** The canvas's page head: an optional back link, the h1, one muted line, and an optional action. */
export function PageHeader({ back, title, sub, action }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2.5">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className={`${BTN.link} mb-1.5`} data-testid="link-wellbeing-back">
            <ChevronLeft size={14} aria-hidden="true" /> {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-extrabold leading-tight tracking-axal-heading text-axal-ink dark:text-gray-100">{title}</h1>
        {sub && <p className="mt-1 max-w-3xl text-[13.5px] leading-relaxed text-axal-muted dark:text-gray-400">{sub}</p>}
      </div>
      {action}
    </header>
  );
}

/** A card's own heading row. */
export function CardHead({ title, meta, children, as: Tag = 'h2' }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <Tag className="text-[15px] font-bold tracking-axal-heading text-axal-ink dark:text-gray-100">{title}</Tag>
      {meta && <span className="text-xs tabular-nums text-axal-muted dark:text-gray-400">{meta}</span>}
      {children}
    </div>
  );
}

/**
 * "Not recorded" with its reason in words, not only on hover: a phone has no
 * hover, and the reason is the part a reader needs.
 */
export function NotRecorded({ reason, label = 'Not recorded', testId }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 text-xs" data-testid={testId}>
      <Unrecorded reason={reason}>{label}</Unrecorded>
      {reason && <span className="text-axal-muted dark:text-gray-400">{reason}</span>}
    </span>
  );
}

/**
 * The canvas's five dots for one 1–5 score. Dots up to the answer fill, as
 * drawn. A radio group: one answer, or none. Pressing the chosen dot again
 * clears it, so a slip is not a recorded answer.
 */
export function ScoreDots({ name, label, value, onChange, low, high, disabled = false }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
      <span id={`score-${name}`} className="min-w-[5.5rem] text-[13px] font-semibold text-axal-ink dark:text-gray-100">{label}</span>
      <div className="flex items-center gap-1.5" role="radiogroup" aria-labelledby={`score-${name}`} data-testid={`score-${name}`}>
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = value != null && n <= value;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${label} ${n} of 5${n === 1 && low ? ` (${low})` : ''}${n === 5 && high ? ` (${high})` : ''}`}
              disabled={disabled}
              onClick={() => onChange?.(value === n ? null : n)}
              className={`grid h-8 w-8 place-items-center rounded-full text-xs font-medium tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-axal-violet/50 disabled:cursor-not-allowed ${
                filled
                  ? 'bg-axal-violet text-white'
                  : 'border border-axal-hairline bg-white text-axal-muted hover:border-axal-violet/40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400'
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
      {(low || high) && (
        <span className="w-full text-[11px] text-axal-faint dark:text-gray-500">1 · {low} — 5 · {high}</span>
      )}
    </div>
  );
}

/**
 * One score across the weeks. A week with no value breaks the line; it is
 * never drawn at zero. The label reads the values out for a screen reader.
 */
export function Sparkline({ series, label, testId }) {
  const { d, dots } = sparkPath(series);
  const spoken = series.map((v) => (v == null ? 'no check-in' : String(v))).join(', ');
  return (
    <svg
      viewBox="0 0 126 26"
      preserveAspectRatio="none"
      className="h-[26px] w-full max-w-[160px] text-axal-violet dark:text-violet-300"
      role="img"
      aria-label={`${label}, oldest week first: ${spoken}`}
      data-testid={testId}
    >
      {d && <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
      {dots.map((p) => <circle key={`${p.x}-${p.y}`} cx={p.x} cy={p.y} r="1.8" fill="currentColor" />)}
    </svg>
  );
}

/** The step chips across the top of the booking page: done, current, to come. */
export function StepChips({ steps, current }) {
  return (
    <ol className="flex flex-nowrap gap-1.5 overflow-x-auto pb-1" aria-label="Booking steps" data-testid="booking-steps">
      {steps.map((step, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        const look = {
          done: 'bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300',
          current: 'bg-axal-violet text-white',
          todo: 'border border-axal-hairline bg-white text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400',
        }[state];
        return (
          <li
            key={step}
            aria-current={state === 'current' ? 'step' : undefined}
            className={`whitespace-nowrap rounded-axal-pill px-3 py-1.5 text-xs font-semibold ${look}`}
            data-testid={`step-${i + 1}-${state}`}
          >
            {i + 1} · {step}
          </li>
        );
      })}
    </ol>
  );
}

/** A write's outcome, success or the route's own refusal. */
export function Outcome({ ok, error, testId }) {
  if (error) {
    return <p role="alert" className="text-xs text-red-700 dark:text-red-300" data-testid={testId ? `${testId}-error` : undefined}>{error}</p>;
  }
  if (ok) {
    return <p role="status" className="text-xs font-medium text-emerald-700 dark:text-emerald-300" data-testid={testId ? `${testId}-ok` : undefined}>{ok}</p>;
  }
  return null;
}
