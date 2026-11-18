/**
 * D4819 part 21 (#5928) — Licences v2 board L18: one licence write's outcome,
 * drawn in its own state (`licenceOutcomeModel.js`). Each state has a word
 * and a shape as well as a colour. A partial outcome is amber and dashed,
 * never green, and offers Retry branch sync rather than the write again. An
 * unknown outcome offers only Re-read licence. A refusal shows the Worker's
 * words. Refused and unknown are announced (`role="alert"`); the rest are polite.
 */
import React, { useCallback, useState } from 'react';
import { OUTCOME_STATES, licenceWriteOutcome } from './licenceOutcomeModel';
import { outcomeOfError } from '../../lib/mutationOutcome';
import { reportError } from '../../lib/log';

const TONE = {
  pending: 'border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100',
  completed: 'border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-100',
  partial: 'border-2 border-dashed border-amber-500 bg-amber-50 text-amber-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-100',
  refused: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100',
  unknown: 'border-gray-400 bg-gray-50 text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100',
};

export default function LicenceOutcomeCard({ outcome, busy = false, onRetrySync = null, onReread = null, onDismiss = null, testId = 'licence-outcome' }) {
  if (!outcome) return null;
  const meta = OUTCOME_STATES[outcome.state] || OUTCOME_STATES.unknown;
  const loud = outcome.state === 'refused' || outcome.state === 'unknown';
  const button = 'min-h-[36px] rounded-md border border-current px-3 py-1 text-sm font-medium disabled:opacity-50';
  return (
    <div
      role={loud ? 'alert' : 'status'} aria-live={loud ? 'assertive' : 'polite'}
      data-testid={testId} data-outcome={outcome.state}
      className={`mt-3 flex flex-wrap items-start justify-between gap-3 rounded-md border p-3 text-sm ${TONE[outcome.state] || TONE.unknown}`}
    >
      <div className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide" data-testid={`${testId}-state`}>
          <span aria-hidden="true" className="text-[13px] leading-none">{meta.shape}</span>{meta.label}
        </span>
        <p className="mt-1 font-semibold" data-testid={`${testId}-title`}>{outcome.title}</p>
        {outcome.detail && <p className="mt-0.5" data-testid={`${testId}-detail`}>{outcome.detail}</p>}
        {outcome.lines?.length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-[13px]" data-testid={`${testId}-lines`}>
            {outcome.lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {outcome.next === 'retrySync' && onRetrySync && (
          <button type="button" className={button} disabled={busy} onClick={onRetrySync} data-testid={`${testId}-retry-sync`}>Retry branch sync</button>
        )}
        {outcome.next === 'reread' && onReread && (
          <button type="button" className={button} disabled={busy} onClick={onReread} data-testid={`${testId}-reread`}>Re-read licence</button>
        )}
        {onDismiss && outcome.state !== 'pending' && (
          <button type="button" onClick={onDismiss} className="text-xs underline" aria-label="Dismiss this outcome">Dismiss</button>
        )}
      </div>
    </div>
  );
}

/**
 * One editor's writes: `run(action, fn)` shows Pending, awaits `fn`, then keeps
 * the answer (or the error) for the card. `onSettled` runs after an answer or
 * an unknown outcome, so the editor re-reads what the server holds; it is not
 * run after a refusal, where nothing changed. Returns the answer, or null.
 */
export function useLicenceWrite({ onSettled = null, sync = null, tag = 'licence_write' } = {}) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (action, fn) => {
    setBusy(true); setState({ action, phase: 'pending' });
    try {
      const result = await fn();
      setState({ action, phase: 'done', result });
      onSettled?.();
      return result ?? true;
    } catch (e) {
      reportError(`${tag}:${action}`, e);
      setState({ action, phase: 'failed', error: e });
      if (outcomeOfError(e) === 'unknown') onSettled?.();
      return null;
    } finally { setBusy(false); }
  }, [onSettled, tag]);
  const outcome = state ? licenceWriteOutcome({ ...state, sync }) : null;
  const clear = useCallback(() => setState(null), []);
  return { outcome, busy, run, clear };
}
