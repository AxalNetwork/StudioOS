/**
 * D4707 (#4707) — the licence page's reason dialog, and `useReasonDialog`,
 * which asks for a reason and resolves with it (or null when cancelled).
 *
 * Built on `ui/Lightbox`, so it is a labelled `role="dialog"` that takes
 * focus, keeps Tab inside, closes on Escape and returns focus to the button
 * that opened it. The field is labelled, its rule is said before anything is
 * refused (`aria-describedby`), and the confirm button stays disabled until
 * the reason meets it. What was typed survives a server refusal: the caller
 * decides what happens next, and the page shows the outcome.
 */
import React, { useCallback, useId, useRef, useState } from 'react';
import Lightbox from '../../ui/Lightbox';
import { REASON_MAX, checkReason } from './licenceReasonModel';

const TONE = {
  ok: 'bg-green-700 hover:bg-green-800',
  warn: 'bg-amber-700 hover:bg-amber-800',
  danger: 'bg-red-700 hover:bg-red-800',
};

export function LicenceReasonDialog({ ask, onDone }) {
  const [text, setText] = useState('');
  const fieldId = useId();
  const ruleId = useId();
  const field = useRef(null);
  const check = checkReason(text, { min: ask.min, max: REASON_MAX });
  const rule = ask.min === 0
    ? 'Optional.'
    : ask.min === 1 ? 'Required.' : `Required, at least ${ask.min} characters.`;
  return (
    <Lightbox
      label={ask.title} title={ask.title} onClose={() => onDone(null)} width={480}
      testId="licence-reason-dialog" initialFocus={field}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => onDone(null)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700">
            Cancel
          </button>
          <button
            type="button" data-testid="licence-reason-confirm" disabled={!check.ok}
            onClick={() => onDone(text.trim())}
            className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${TONE[ask.tone] || TONE.warn}`}
          >
            {ask.confirm}
          </button>
        </div>
      )}
    >
      <label htmlFor={fieldId} className="block text-sm text-gray-800 dark:text-gray-200">{ask.question}</label>
      <textarea
        id={fieldId} ref={field} value={text} onChange={(e) => setText(e.target.value)}
        aria-describedby={ruleId} aria-invalid={text.length > 0 && !check.ok ? 'true' : undefined}
        maxLength={REASON_MAX} rows={4}
        className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
      />
      <p id={ruleId} className="mt-1 text-xs text-gray-600 dark:text-gray-400" aria-live="polite">
        {text.length > 0 && !check.ok ? check.message : rule}
      </p>
    </Lightbox>
  );
}

/**
 * `[dialog, ask]`: render `dialog` once, then `const why = await ask(spec)`.
 * `why` is the trimmed reason, or null when the operator cancelled.
 */
export function useReasonDialog() {
  const [pending, setPending] = useState(null);
  const ask = useCallback((spec) => new Promise((resolve) => setPending({ spec, resolve })), []);
  const dialog = pending
    ? (
      <LicenceReasonDialog
        key={pending.spec.title}
        ask={pending.spec}
        onDone={(value) => { pending.resolve(value); setPending(null); }}
      />
    )
    : null;
  return [dialog, ask];
}
