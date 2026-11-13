import React from 'react';
import { X } from 'lucide-react';

/**
 * The one way to draw what `useToast` holds (#1437).
 *
 * `useToast().toast` is data, not an element: `null`, a string, or
 * `{ kind, msg }` (the hook's `success`/`error` write `kind: 'success' |
 * 'error'`; older call sites write `'ok' | 'err'`). Rendered raw as
 * `{toast}`, an object throws inside React and takes the page to its error
 * screen on the first message, which is what Payments and Billing did.
 */

const ERROR_KINDS = new Set(['error', 'err', 'danger', 'fail', 'failed']);

/** The text a toast carries, whichever shape it was written in. */
export function toastText(toast) {
  if (toast == null || toast === false) return '';
  if (typeof toast === 'string' || typeof toast === 'number') return String(toast);
  if (typeof toast === 'object') return String(toast.msg ?? toast.message ?? '');
  return '';
}

/** True when the toast reports a failure. */
export function toastIsError(toast) {
  return !!toast && typeof toast === 'object' && ERROR_KINDS.has(String(toast.kind || '').toLowerCase());
}

export default function ToastMessage({ toast, onDismiss }) {
  const text = toastText(toast);
  if (!text) return null;
  const bad = toastIsError(toast);
  return (
    <div className="fixed bottom-4 right-4 z-[60] max-w-sm" data-testid="toast-message">
      <div
        role={bad ? 'alert' : 'status'}
        className={`flex items-start gap-2 rounded-lg px-4 py-3 text-sm text-white shadow-lg ${bad ? 'bg-red-600' : 'bg-emerald-600'}`}
      >
        <span className="flex-1">{text}</span>
        {onDismiss ? (
          <button type="button" onClick={onDismiss} aria-label="Dismiss" className="opacity-80 hover:opacity-100 dark:hover:opacity-100">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
