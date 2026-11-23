/**
 * D6062 (#6062, Pitch Studio v2 PS-08 C) — one analytics figure in one of its
 * states: a value, a plain "none" line, or one of the four kinds of nothing
 * (`slideAnalyticsModel.ABSENCE`), never drawn alike:
 *
 *   Tracking off   its own chip (solid border, pause bars), and the sentence
 *                  that past visits stay untimed. No figure.
 *   Unavailable    the platform's failed-read chip (`StateChip`, D5129) with
 *                  "Not zero: the read failed." and Try again. No figure.
 *   Measured zero  the figure itself in ink ("0", "Not yet") with its own
 *                  chip and what was measured. The only one that shows a 0.
 *   Not recorded   the platform's Not recorded chip with why. No figure.
 *
 * Every state carries its word as text; none relies on colour. The tile's
 * `data-figure-state` names the state, so a test reads it without the look.
 */
import React from 'react';
import { StateChip } from '../../../ui/Honesty.jsx';
import { ABSENCE } from './slideAnalyticsModel.js';

const LABEL = 'text-[11.5px] font-semibold text-axal-muted dark:text-gray-400';
const BIG = 'text-[22px] font-extrabold leading-tight text-axal-ink dark:text-gray-100';
const WHY = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const SUB = 'text-[11.5px] not-italic text-axal-muted dark:text-gray-400';
const TILE = 'flex min-w-0 flex-col gap-1 rounded-[12px] border border-axal-hairline bg-white p-3 dark:border-gray-700 dark:bg-gray-900';
const OFF_CHIP = 'inline-flex w-fit items-center gap-[5px] rounded-full border border-gray-500 bg-gray-50 py-px pl-1.5 pr-2 text-[11px] font-bold leading-[1.6] text-gray-800 dark:border-gray-400 dark:bg-gray-800 dark:text-gray-100';
const ZERO_CHIP = 'inline-flex w-fit items-center rounded-full border border-axal-hairline bg-white px-2 py-px text-[11px] font-bold leading-[1.6] text-axal-ink dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';
const RETRY = 'inline-flex min-h-[32px] w-fit items-center justify-center rounded-[8px] border border-axal-hairline bg-white px-2.5 text-[12px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

/** The Tracking off chip: two bars, then the word. */
export function TrackingOffChip() {
  return (
    <span className={OFF_CHIP} data-absence="tracking_off">
      <svg aria-hidden="true" focusable="false" width="11" height="11" viewBox="0 0 12 12">
        <rect x="3" y="2.5" width="2" height="7" fill="currentColor" /><rect x="7" y="2.5" width="2" height="7" fill="currentColor" />
      </svg>
      {ABSENCE.tracking_off.word}
    </span>
  );
}

/** The body of a figure (no tile around it): what a stat tile and an inline slot both draw. */
export function FigureBody({ fig, onRetry, testId, retryTestId }) {
  const k = fig?.kind || 'not_recorded';
  if (k === 'value') {
    return (
      <span className="flex min-w-0 flex-col gap-0.5" data-figure-state="value" data-testid={testId}>
        <span className={`${BIG} break-words`}>{fig.value}</span>
        {fig.sub ? <em className={SUB}>{fig.sub}</em> : null}
      </span>
    );
  }
  if (k === 'none') {
    return <span className={`${WHY} text-[13px]`} data-figure-state="none" data-testid={testId}>{fig.value}</span>;
  }
  if (k === 'measured_zero') {
    return (
      <span className="flex min-w-0 flex-col gap-1" data-figure-state="measured_zero" data-testid={testId}>
        <span className={BIG}>{fig.value ?? '0'}</span>
        <span className={ZERO_CHIP} data-absence="measured_zero">{ABSENCE.measured_zero.word}</span>
        <span className={WHY}>{fig.why || ABSENCE.measured_zero.line}</span>
      </span>
    );
  }
  if (k === 'tracking_off') {
    return (
      <span className="flex min-w-0 flex-col gap-1" data-figure-state="tracking_off" data-testid={testId}>
        <TrackingOffChip />
        <span className={WHY}>{fig.why || ABSENCE.tracking_off.line}</span>
      </span>
    );
  }
  if (k === 'unreadable') {
    return (
      <span className="flex min-w-0 flex-col gap-1" data-figure-state="unreadable" data-testid={testId}>
        <StateChip kind="unavailable" className="w-fit" data-absence="unreadable" />
        <span className={WHY}>{fig.why || ABSENCE.unreadable.line}</span>
        {onRetry ? <button type="button" className={RETRY} onClick={onRetry} data-testid={retryTestId || (testId ? `${testId}-retry` : undefined)}>Try again</button> : null}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-col gap-1" data-figure-state="not_recorded" data-testid={testId}>
      <StateChip kind="not_recorded" className="w-fit" data-absence="not_recorded" />
      <span className={WHY}>{fig?.why || ABSENCE.not_recorded.line}</span>
    </span>
  );
}

/** One stat tile: its label over the figure. */
export default function FigureTile({ label, fig, onRetry, testId, retryTestId, children }) {
  return (
    <div className={TILE}>
      <small className={LABEL}>{label}</small>
      {children ?? <FigureBody fig={fig} onRetry={onRetry} testId={testId} retryTestId={retryTestId} />}
    </div>
  );
}
