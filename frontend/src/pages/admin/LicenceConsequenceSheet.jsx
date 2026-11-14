/**
 * D4819 part 4 (#5927) — Licences v2 board L17: the consequence sheet a
 * licence's lifecycle action opens, and `useConsequenceSheet`, which resolves
 * with `{ reason }` on confirm or null on cancel.
 *
 * The four questions are its headings, numbered as on the canvas: what will
 * happen, what else it affects, the reason recorded, and whether it can be
 * undone. The words come from `licenceConsequenceModel.js`. Only the final
 * button carries the action's tone, and only a terminate is drawn destructive.
 *
 * Built on `ui/Sheet`, so it is a labelled `role="dialog"`: focus moves in on
 * open, Tab stays inside, Escape and Cancel close it, and focus returns to the
 * control that opened it (More's "⋯", or Activate). There is no browser prompt
 * or confirm. Where the write records a reason it is required, and the confirm
 * button stays disabled until it meets the Worker's rule.
 */
import React, { useCallback, useId, useRef, useState } from 'react';
import Sheet from '../../ui/Sheet';
import { checkReason } from './licenceReasonModel';
import { licenceConsequence } from './licenceConsequenceModel';

const TONE = {
  ok: 'bg-green-700 hover:bg-green-800',
  warn: 'bg-amber-700 hover:bg-amber-800',
  danger: 'bg-red-700 hover:bg-red-800',
};

function Rows({ rows, testId }) {
  return (
    <ul className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.text} className="px-3 py-2 text-[13px]">
          <div className="font-semibold text-gray-900 dark:text-gray-100">{r.text}</div>
          {r.note && <div className="mt-0.5 text-[12px] text-gray-600 dark:text-gray-400">{r.note}</div>}
        </li>
      ))}
    </ul>
  );
}

function Question({ n, title, children, testId }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2" data-testid={testId}>
      <h3 id={id} className="text-[12px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-400">{n} · {title}</h3>
      {children}
    </section>
  );
}

export function LicenceConsequenceSheet({ sheet, onDone }) {
  const [text, setText] = useState('');
  const fieldId = useId();
  const ruleId = useId();
  const field = useRef(null);
  const asks = sheet.reason.min !== null;
  const check = asks ? checkReason(text, { min: sheet.reason.min, max: sheet.reason.max }) : { ok: true, message: null };
  return (
    <Sheet
      label={sheet.title} title={sheet.title} eyebrow="Consequential action" width={560}
      onClose={() => onDone(null)} testId="licence-consequence-sheet" initialFocus={asks ? field : undefined}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => onDone(null)} data-testid="licence-consequence-cancel"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:text-gray-100">
            Cancel
          </button>
          <button
            type="button" data-testid="licence-consequence-confirm" disabled={!check.ok}
            onClick={() => onDone({ reason: asks ? text.trim() : null })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${TONE[sheet.tone] || TONE.warn}`}
          >
            {sheet.confirm}
          </button>
        </div>
      )}
    >
      <div className="flex flex-col gap-4">
        <Question n="1" title="What will happen" testId="licence-consequence-happens">
          <Rows rows={sheet.happens} />
        </Question>
        <Question n="2" title="What else it affects" testId="licence-consequence-affects">
          <Rows rows={sheet.affects} />
        </Question>
        <Question n="3" title="Reason recorded" testId="licence-consequence-reason">
          {asks ? (
            <div>
              <label htmlFor={fieldId} className="block text-sm text-gray-800 dark:text-gray-200">
                {sheet.reason.question} <span className="text-gray-500 dark:text-gray-400">· required</span>
              </label>
              <textarea
                id={fieldId} ref={field} value={text} onChange={(e) => setText(e.target.value)}
                aria-describedby={ruleId} aria-invalid={text.length > 0 && !check.ok ? 'true' : undefined}
                maxLength={sheet.reason.max} rows={3}
                className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                data-testid="licence-consequence-field"
              />
              <p id={ruleId} className="mt-1 text-xs text-gray-600 dark:text-gray-400" aria-live="polite">
                {text.length > 0 && !check.ok ? check.message : 'Required.'}
              </p>
            </div>
          ) : (
            <p className="text-[13px] text-gray-700 dark:text-gray-300">{sheet.reason.statement}</p>
          )}
        </Question>
        <Question n="4" title="Can it be undone?" testId="licence-consequence-undo">
          <p
            className={`rounded-md border px-2.5 py-2 text-[13px] ${sheet.undo.reversible
              ? 'border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200'
              : 'border-red-200 bg-red-50 font-semibold text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200'}`}
            data-reversible={sheet.undo.reversible ? 'true' : 'false'}
          >
            {sheet.undo.text}
          </p>
        </Question>
      </div>
    </Sheet>
  );
}

/**
 * `[sheet, ask]`: render `sheet` once, then `const out = await ask(action, licence, reads)`.
 * `out` is `{ reason }` (the trimmed reason, or null for a write that takes
 * none), or null when the operator cancelled.
 */
export function useConsequenceSheet() {
  const [pending, setPending] = useState(null);
  const ask = useCallback((action, licence, reads) => new Promise((resolve) => {
    const spec = licenceConsequence(action, licence, reads);
    if (!spec) { resolve(null); return; }
    setPending({ key: `${action}:${licence?.uid || ''}`, spec, resolve });
  }), []);
  const sheet = pending
    ? (
      <LicenceConsequenceSheet
        key={pending.key}
        sheet={pending.spec}
        onDone={(value) => { pending.resolve(value); setPending(null); }}
      />
    )
    : null;
  return [sheet, ask];
}
