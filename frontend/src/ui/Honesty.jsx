/**
 * The two ways a page says it does not know something.
 *
 * WHY THESE ARE ONE FILE AND NOT FIVE COPIES. `Unrecorded` was written twice
 * (`lib/fundAnalytics.js` for the investor pages, `pages/advisor/expertise/kit`
 * for everything else) and `Unreadable` twice more, locally inside
 * `HqHomePage` and `SecurityPage` — with copy that had already drifted apart:
 * one closed "This is not a claim that none exist", the other "…that nothing
 * happened". Each new HQ page added another pair, and the distinction these
 * components exist to hold is precisely the one that drifts:
 *
 *   **Unrecorded** — the store was read and holds no value for this. The
 *   product may not collect it yet, or this row may simply not have it.
 *
 *   **Unreadable** — the read FAILED. Nothing is known either way, and a
 *   page that shows an empty state here is asserting something it cannot
 *   support. This is the one that silently becomes "there is nothing there"
 *   when it is rewritten from memory, which is the defect the whole HQ pass
 *   was reported for.
 *
 * Neither ever renders a zero, and neither renders a bare em-dash: a dash is
 * indistinguishable from a real value a designer chose, and "0" is a claim.
 * See D56/D68.
 */
import React from 'react';
import { CircleAlert, RefreshCw } from 'lucide-react';

/**
 * A value the store does not have.
 *
 * `reason` is the server's own explanation, where it sends one — the
 * `unavailable` map on the HQ and licence endpoints — surfaced on hover so
 * someone asking "why is this blank" gets the answer from the page rather
 * than from support. `children` overrides the words for the cases that are
 * not literally "not recorded" ("Unavailable", "Not yet measured").
 */
export function Unrecorded({ children = 'Not recorded', reason }) {
  // Real Tailwind greys, and deliberately not the `axal-ink-3` ink the
  // page-level copies of this component reach for. That token is on U11's
  // undeclared list: Tailwind v4 tree-shakes a theme token nothing declares
  // and does not warn, so a utility naming one silently produces no style at
  // all — those copies are not actually muted, they just inherit. `ui/`
  // holds the stricter rule ("the number can only go down"), and the guard
  // reads this file as plain text, so the prefixed spelling is not written
  // here even in a comment.
  return (
    <span className="italic text-gray-500 dark:text-gray-400" title={reason || undefined}>
      {children}
    </span>
  );
}

/**
 * A read that failed.
 *
 * `claim` is the sentence that says what this is NOT evidence of, and it
 * differs by zone — an unreadable licence list is not a claim that no
 * licences exist; an unreadable audit feed is not a claim that nothing
 * happened. It is a required prop rather than a default because the generic
 * version is the one that reads as boilerplate and gets skipped.
 */
export function Unreadable({ what, claim, onRetry }) {
  return (
    <p className="flex items-center gap-2 text-[12px] text-red-700 dark:text-red-300" role="alert">
      <CircleAlert size={13} /> {what} could not be read. {claim}
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-1 inline-flex items-center gap-1 underline">
          <RefreshCw size={11} /> Retry
        </button>
      )}
    </p>
  );
}
