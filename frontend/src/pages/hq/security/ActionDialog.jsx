import React, { useEffect, useRef } from 'react';
import StatusBadge from './StatusBadge.jsx';
import { MIN_REASON } from './accessModel.js';

/**
 * D4801 (#4801, canvas SE05, SE11c, SEB "ActionDialog", SEC) — the one shell
 * every destructive act in Security uses: Scope → Review → Result, in the
 * page (never `window.confirm`), a bottom sheet on phone with 48 px buttons.
 *
 * KEYBOARD AND FOCUS (SEC):
 *   - focus moves into the dialog when it opens, to the step's heading, so
 *     the scope is read before any control; on the Result step it moves to
 *     the result message;
 *   - Tab and Shift+Tab wrap inside the dialog (a trap), so nothing behind it
 *     can be reached while it is open;
 *   - Esc closes it, except while a request is in flight: closing then would
 *     hide the answer the operator is waiting for;
 *   - on close, focus returns to the control that opened it, or to
 *     `fallbackFocus` (the table caption) when that control is gone.
 *
 * The trap reads the dialog's focusable controls where the platform offers
 * `querySelectorAll`, and otherwise the two it always holds: the close
 * button first and the last footer control.
 */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function StepIndicator({ step }) {
  return (
    <ol className="flex flex-wrap items-center gap-3 text-[11.5px] font-semibold" aria-label={`Step ${step} of 3`} data-testid="action-steps">
      {['Scope', 'Review', 'Result'].map((s, i) => {
        const n = i + 1;
        const done = n < step;
        const on = n === step;
        return (
          <li
            key={s}
            aria-current={on ? 'step' : undefined}
            className={`flex items-center gap-1.5 ${on ? 'text-axal-ink dark:text-white' : done ? 'text-emerald-700 dark:text-emerald-300' : 'text-axal-muted dark:text-gray-500'}`}
          >
            <span
              aria-hidden="true"
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10.5px] ${on ? 'border-violet-700 bg-violet-700 text-white dark:border-violet-500 dark:bg-violet-600' : 'border-axal-hairline dark:border-gray-700'}`}
            >
              {done ? '✓' : n}
            </span>
            {s}
            {done && <span className="sr-only"> (done)</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** SEB "ScopeBox": exactly what the act reaches, as a list of plain lines. */
export function ScopeBox({ title, items, danger = false, testid }) {
  return (
    <div
      className={`rounded-lg border p-3 ${danger ? 'border-red-300 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20' : 'border-axal-hairline bg-axal-ground dark:border-gray-700 dark:bg-gray-950'}`}
      data-testid={testid}
    >
      <b className="text-[13px] text-axal-ink dark:text-white">{title}</b>
      <ul className="mt-1.5 space-y-1 text-[12.5px] text-axal-muted dark:text-gray-300">
        {items.filter(Boolean).map((it) => (
          <li key={typeof it === 'string' ? it : it.text} className="flex gap-2">
            <span aria-hidden="true">{typeof it === 'string' ? '•' : it.mark || '•'}</span>
            <span>{typeof it === 'string' ? it : it.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A fact no store holds (SE10j): the badge, then why, in plain words. */
export function NotInstrumented({ children }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusBadge state="not_instrumented" />
      <span className="text-axal-muted dark:text-gray-400">{children}</span>
    </span>
  );
}

/** SEB "YouAffected": whether the current admin is reached, said once, plainly. */
export function YouAffected({ affected, text }) {
  return (
    <p
      className={`flex gap-2 rounded-lg border px-3 py-2 text-[12.5px] ${affected ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200' : 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-300'}`}
      data-testid="action-you"
      data-affected={affected ? 'true' : 'false'}
    >
      <span aria-hidden="true">{affected ? '▲' : '✓'}</span>
      <span>{text}</span>
    </p>
  );
}

/**
 * The reason, inside the dialog it belongs to (#4801: "collected inside each
 * action confirmation flow rather than ambiguous page-level fields"). Its
 * error is linked by `aria-describedby` and announced.
 */
export function ReasonField({ id, value, onChange, error, placeholder }) {
  const hint = `${id}-hint`;
  const err = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-bold text-axal-ink dark:text-white">
        Reason <span className="font-normal text-axal-muted dark:text-gray-400">· required</span>
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder={placeholder || 'Why are you doing this?'}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${hint} ${err}` : hint}
        className={`w-full rounded-md border bg-white px-2.5 py-1.5 text-[13px] text-axal-ink dark:bg-gray-900 dark:text-gray-100 ${error ? 'border-red-700 dark:border-red-500' : 'border-axal-hairline dark:border-gray-700'}`}
        data-testid="action-reason"
      />
      <span id={hint} className="text-[11px] text-axal-muted dark:text-gray-400">
        At least {MIN_REASON} characters. Saved to the admin audit log with this act.
      </span>
      {error && <span id={err} role="alert" className="text-[12px] font-semibold text-red-700 dark:text-red-300">✕ {error}</span>}
    </div>
  );
}

export const BTN = 'inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px] font-bold sm:min-h-[36px] sm:w-auto disabled:cursor-not-allowed disabled:opacity-50';
export const BTN_PLAIN = `${BTN} border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
export const BTN_DANGER = `${BTN} border-red-700 bg-red-700 text-white hover:bg-red-800 dark:border-red-600 dark:bg-red-600 dark:hover:bg-red-700`;
export const BTN_PRIMARY = `${BTN} border-violet-700 bg-violet-700 text-white hover:bg-violet-800 dark:border-violet-500 dark:bg-violet-600 dark:hover:bg-violet-700`;

export default function ActionDialog({
  id, title, step, busy = false, onClose, returnFocus, fallbackFocus, footer, children, testid,
}) {
  const box = useRef(null);
  const heading = useRef(null);
  const first = useRef(null);
  const last = useRef(null);
  const opener = useRef(returnFocus ?? (typeof document !== 'undefined' ? document.activeElement : null));

  // Each step starts at its heading; the Result step's heading is the result.
  useEffect(() => { heading.current?.focus?.(); }, [step]);

  // Focus goes back where it came from — or to the caption when that is gone.
  useEffect(() => () => {
    const back = opener.current;
    if (back && back.isConnected !== false && typeof back.focus === 'function') back.focus();
    else fallbackFocus?.current?.focus?.();
  }, [fallbackFocus]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault?.();
      if (!busy) onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const node = box.current;
    const list = node?.querySelectorAll
      ? [...node.querySelectorAll(FOCUSABLE)]
      : [first.current, last.current].filter(Boolean);
    if (!list.length) return;
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    const head = list[0];
    const tail = list[list.length - 1];
    if (e.shiftKey && (active === head || active === heading.current || !node?.contains?.(active))) {
      e.preventDefault?.();
      tail.focus();
    } else if (!e.shiftKey && (active === tail || !node?.contains?.(active))) {
      e.preventDefault?.();
      head.focus();
    }
  };

  // The footer's last control carries `last`: the caller passes its buttons
  // as an array so the shell can hold the end of the trap.
  const buttons = React.Children.toArray(footer).filter(Boolean);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" data-testid={testid}>
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" aria-hidden="true" />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onKeyDown={onKeyDown}
        className="relative flex max-h-[92vh] w-full flex-col overflow-y-auto rounded-t-2xl border border-axal-hairline bg-white shadow-2xl sm:max-w-[600px] sm:rounded-2xl dark:border-gray-700 dark:bg-gray-900"
        data-step={step}
      >
        <div className="flex items-start justify-between gap-3 border-b border-axal-hairline px-5 py-4 dark:border-gray-800">
          <div className="flex min-w-0 flex-col gap-2">
            <h2
              id={`${id}-title`}
              ref={heading}
              tabIndex={-1}
              className="text-[17px] font-extrabold tracking-tight text-axal-ink outline-none dark:text-white"
            >
              {title}
            </h2>
            <StepIndicator step={step} />
          </div>
          <button
            type="button"
            ref={first}
            onClick={onClose}
            disabled={busy}
            aria-label="Cancel and close"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-axal-hairline text-axal-muted hover:bg-axal-ground sm:h-8 sm:w-8 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            data-testid="action-close"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">{children}</div>
        <div className="flex flex-col-reverse gap-2 border-t border-axal-hairline px-5 py-3 sm:flex-row sm:justify-end dark:border-gray-800">
          {buttons.map((b, i) => (i === buttons.length - 1 ? React.cloneElement(b, { ref: last }) : b))}
        </div>
      </div>
    </div>
  );
}
