import React from 'react';
import { Card, Pill, Skeleton } from '../../../ui';

/**
 * Shared pieces for the five Expertise zones.
 *
 * WHY A KIT AND NOT FIVE COPIES. The three backed zones each read one store,
 * and each has to distinguish the same four states — loading, unreadable,
 * empty, and populated. Written five times that distinction drifts, and the
 * one it always drifts into is treating "we could not read it" as "there is
 * nothing there". That is the defect this whole pass was reported for:
 * "it does show anything, it looks blank, probably not connected to anything".
 */

/** Absent renders as absent. Never a zero, never an em-dash pretending to be one. */
export function Unrecorded({ children = 'Not recorded' }) {
  return <span className="text-axal-ink-3 italic">{children}</span>;
}

/**
 * Cents to a readable amount.
 *
 * `null` is NOT zero and must never render as `$0.00` — an advisor who has not
 * priced a service has not said it is free. Whole dollars drop the cents
 * because a price list reads better without `.00` on every row; a price with
 * real cents keeps them.
 */
export function money(cents, currency = 'USD') {
  if (cents == null) return null;
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  const whole = n / 100;
  return `${symbol}${whole.toLocaleString(undefined, {
    minimumFractionDigits: n % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Dollars typed by a person into whole cents, or an error a person can act on. */
export function dollarsToCents(input) {
  const raw = String(input ?? '').trim().replace(/[$,\s]/g, '');
  if (!raw) return { cents: null };
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return { error: 'Enter an amount like 1500 or 1500.50' };
  }
  return { cents: Math.round(Number(raw) * 100) };
}

export function ZoneHeading({ title, blurb, action }) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-2xl">
        <h2 className="text-sm font-extrabold tracking-tight">{title}</h2>
        {blurb && <p className="mt-1 text-[12px] leading-relaxed text-axal-ink-2">{blurb}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * The four states, in one place.
 *
 * `error` beats `items` beats `empty`. The ordering is the whole point: a
 * failed read that fell through to an empty list would render the empty copy,
 * which asserts that nothing exists. Reading the error first means the page
 * can only ever claim a store is empty when it actually read the store.
 */
export function ZoneBody({ loading, error, isEmpty, empty, onRetry, children }) {
  if (loading) {
    return <div className="space-y-3" aria-busy="true"><Skeleton className="h-9" /><Skeleton className="h-28" /></div>;
  }
  if (error) {
    return (
      <Card variant="dashed" padding="lg">
        <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
          Source unavailable
        </div>
        <h3 className="mt-2 text-sm font-extrabold tracking-tight">This did not load</h3>
        <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-axal-ink-2">
          {error} Nothing is shown rather than an empty list, because an empty list here would
          say you have no records — and that is not something this page can currently know.
        </p>
        {onRetry && (
          <button type="button" onClick={onRetry}
            className="mt-3 rounded-lg border border-axal-hairline px-3 py-1.5 text-[12px] font-semibold hover:bg-axal-ground dark:border-gray-700 dark:hover:bg-gray-800">
            Try again
          </button>
        )}
      </Card>
    );
  }
  if (isEmpty) return empty;
  return children;
}

/** An empty store the page genuinely read — different from one it could not. */
export function NothingYet({ title, body, action }) {
  return (
    <Card variant="dashed" padding="lg">
      <h3 className="text-sm font-extrabold tracking-tight">{title}</h3>
      <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-axal-ink-2">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </Card>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-relaxed text-axal-ink-3">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'mt-1 w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] '
  + 'focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 '
  + 'dark:border-gray-700 dark:bg-gray-900';

export const buttonClass =
  'rounded-lg bg-emerald-700 px-3 py-1.5 text-[12px] font-semibold text-white '
  + 'hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50';

export const ghostButtonClass =
  'rounded-lg border border-axal-hairline px-3 py-1.5 text-[12px] font-semibold '
  + 'hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800';

/** Saved / failed, said once, above the thing that was saved. */
export function SaveNote({ note }) {
  if (!note) return null;
  return (
    <p className={`mt-2 text-[12px] font-semibold ${note.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
      {note.text}
    </p>
  );
}

export { Pill };
