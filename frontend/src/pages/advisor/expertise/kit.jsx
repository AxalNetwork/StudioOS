import React from 'react';
import { Card, Pill, Skeleton } from '../../../ui';
import ZoneActions from '../../../workspaces/ZoneActions';

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
export function ZoneBody({ loading, error, isEmpty, empty, onRetry, actions, children }) {
  // `actions` renders ABOVE all four states, on purpose. A zone's header row is
  // as true while the store is loading, or failed, or empty, as it is when rows
  // are on screen — "no cadence is stored, so there is no set of reports to
  // draft" does not become false because the fetch is in flight. An export with
  // nothing loaded says so itself (see `zoneActionBuilder.js`), so the row can
  // sit here without ever offering a file that does not exist.
  const row = actions?.length ? <ZoneActions className="mb-3" items={actions} /> : null;
  const wrap = (body) => (row ? <>{row}{body}</> : body);
  if (loading) {
    return wrap(<div className="space-y-3" aria-busy="true"><Skeleton className="h-9" /><Skeleton className="h-28" /></div>);
  }
  if (error) {
    return wrap(
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
      </Card>,
    );
  }
  if (isEmpty) return wrap(empty);
  return wrap(children);
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

/**
 * What a zone cannot answer, said on the zone rather than left as a blank.
 *
 * Every advisor zone built on this kit can answer less than its canvas asked
 * for, and in each case the gap is a missing store rather than an oversight.
 * A reader who is not told that reads the blank as their own data being empty,
 * which is the same absent-is-not-empty failure `ZoneBody` exists to prevent —
 * one level up, about the shape of the page instead of the state of a fetch.
 */
export function StatedLimit({ title, children }) {
  return (
    <Card variant="sunken" padding="md" className="mt-3">
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
        {title}
      </div>
      {/*
        A DIV, NOT A `<p>`, and the difference is not cosmetic. This wrapper was
        a `<p>` while every caller passed bare text, which worked — until
        `pages/partner/pipeline/AnalyticsZone.jsx` passed two `<p>` elements into
        it. A `<p>` inside a `<p>` is invalid, the browser auto-closes the outer
        one at the first inner tag, and the typography classes below then applied
        to nothing while React logged `validateDOMNesting`. Seven of the eight
        call sites render identically under a div carrying the same classes; the
        eighth simply starts working.

        Worth fixing here rather than at the call sites: a zone that can answer
        less than its canvas asked for usually has more than one thing to say,
        and "never pass a paragraph" is a rule the next author will not know.
      */}
      <div className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-axal-ink-2">{children}</div>
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

/**
 * THESE THREE ARE THE ADVISOR ACCENT. The emerald is not a neutral default —
 * it is `ACCENT.advisor` from `workspaces/shellConfig.js`, and it is correct in
 * all eleven files that import it. A partner zone must NOT reuse them: partner
 * is amber, and `pages/partner/kit.jsx` carries the amber pair for that reason.
 * Parameterising this file by accent would edit eleven advisor files to solve a
 * problem that belongs to one licence.
 */
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
