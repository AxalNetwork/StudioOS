/**
 * D4706 (#4706) — the one way a licence mutation reports how it ended:
 * committed, refused, partial, pending or unknown (`lib/mutationOutcome.js`).
 *
 * A refusal and an unknown outcome are announced (`role="alert"`); the rest
 * are polite (`role="status"`). The sentence is the server's when it gave
 * one. An unknown outcome always says to check before trying again, because
 * the write may have landed.
 */
import React from 'react';
import { outcomeRole } from '../lib/mutationOutcome';

const TONE = {
  committed: 'border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100',
  partial: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100',
  pending: 'border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-100',
  refused: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100',
  unknown: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100',
};

const LABEL = {
  committed: 'Done',
  partial: 'Partly done',
  pending: 'In progress',
  refused: 'Refused',
  unknown: 'Outcome unknown',
};

export default function OutcomeNotice({ notice, testId = 'outcome-notice', onDismiss = null }) {
  if (!notice?.message) return null;
  const outcome = LABEL[notice.outcome] ? notice.outcome : 'unknown';
  return (
    <div
      role={outcomeRole(outcome)}
      data-testid={testId}
      data-outcome={outcome}
      className={`flex items-start justify-between gap-3 rounded-md border p-3 text-sm ${TONE[outcome]}`}
    >
      <div>
        <span className="block text-[11px] font-medium uppercase tracking-wide">{LABEL[outcome]}</span>
        <span className="mt-1 block">{notice.message}</span>
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="text-xs underline" aria-label="Dismiss this message">
          Dismiss
        </button>
      )}
    </div>
  );
}
