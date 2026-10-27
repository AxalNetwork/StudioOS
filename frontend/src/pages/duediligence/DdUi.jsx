/**
 * D1250 (#3265) — the small pieces Due diligence's list tabs share: the
 * classes, an in-page dialog that says what it changes before it is sent, a
 * note, a refusal in the Worker's words, and the send that keeps a refusal
 * in its dialog. Never a browser pop-up.
 */
import React, { useState } from 'react';
import { Lightbox } from '../../ui';
import { refusalText } from './ddListModel.js';

export const inputCls = 'w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[13px] text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
export const btnCls = 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-axal-hairline bg-white px-3 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
export const primaryCls = 'inline-flex h-9 items-center gap-1.5 rounded-lg bg-axal-violet px-3.5 text-[13px] font-bold text-white hover:bg-axal-violet-deep dark:bg-violet-500 dark:hover:bg-violet-400';
export const dangerCls = 'inline-flex h-9 items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 text-[13px] font-bold text-white hover:bg-rose-700 dark:bg-rose-500 dark:hover:bg-rose-400';
export const fieldCls = 'mb-1 block text-[12.5px] font-semibold text-gray-800 dark:text-gray-200';
export const muted = 'text-axal-muted dark:text-gray-400';
export const cardCls = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
export const eyebrowCls = 'font-mono text-[10.5px] font-semibold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';

const noteCls = {
  info: 'rounded-lg border border-axal-hairline bg-[#faf9fc] px-3 py-2 text-[12.5px] text-gray-800 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-200',
  warn: 'rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
};

export function Note({ tone = 'info', children, testId }) {
  return <p className={`m-0 ${noteCls[tone] || noteCls.info}`} data-testid={testId}>{children}</p>;
}

export function Refusal({ text, testId }) {
  return text ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid={testId}>{text}</p> : null;
}

/** Runs a dialog's write; a refusal stays in the dialog, in the Worker's words (423 is the pause). `explain` reads a refusal's code first where a page knows its codes. */
export function useSend(explain = refusalText) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const send = async (fn, fallback) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(explain(e, fallback));
    } finally { setBusy(false); }
  };
  return { busy, error, setError, send };
}

/**
 * One dialog: its title says what it changes, its footer is Cancel and the
 * change. The change is never a disabled button: pressed too early, it says
 * what is missing.
 */
export function Dialog({ title, sub, testId, onClose, onSubmit, action, actionCls = primaryCls, busy, width = 560, children }) {
  const submit = (e) => { e?.preventDefault?.(); if (!busy) onSubmit(); };
  return (
    <Lightbox label={title} title={title} sub={sub} width={width} onClose={onClose} testId={testId}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={btnCls} onClick={onClose}>Cancel</button>
          <button type="button" className={actionCls} onClick={submit} data-testid={`${testId}-submit`}>{busy ? 'Saving…' : action}</button>
        </div>
      )}>
      <form onSubmit={submit} className="space-y-3 px-5 py-4" data-testid={`${testId}-form`}>{children}</form>
    </Lightbox>
  );
}
