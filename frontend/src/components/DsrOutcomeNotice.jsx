import React from 'react';
import { toUtcInstant } from '../lib/notices';

/**
 * D169 — WHAT WAS DECIDED, on the screen where the subject asked.
 *
 * `users.deletion_requested_at` is the OPEN flag and HQ's close (D168) clears
 * it, so the moment a decision is made the amber "Deletion requested <date>"
 * line above simply DISAPPEARS. The subject asked, waited out a statutory
 * clock, and the screen returns to as if they never asked. The close does
 * write them an `activity_logs` row, so the outcome reaches the Cmd+K recent
 * feed — twenty rows deep, on a surface nobody checks for this. A denial that
 * vanishes silently is the worst of the three outcomes; this is the line that
 * stops it, in the slot the amber one vacates.
 *
 * THE REASON HQ TYPED IS SHOWN VERBATIM. It is written to be read by a
 * regulator and the subject is the person it is about, so withholding it would
 * mean HQ recording a justification the only affected party cannot see.
 * (Cheap to reverse: drop the `close_reason` paragraph and the subject sees
 * the outcome and its date, with the reason staying HQ-side.)
 *
 * UNREADABLE IS NOT "NOTHING WAS DECIDED" (#204). The server hands back its
 * own availability state; rendering silence for it would reproduce the exact
 * defect above for the subject whose request WAS decided.
 */
export default function DsrOutcomeNotice({ outcome }) {
  if (!outcome) return null;
  if (outcome.available === false) {
    return (
      <p
        data-testid="dsr-outcome-unreadable"
        role="status"
        aria-live="polite"
        className="mt-3 text-xs text-gray-600 dark:text-gray-300"
      >
        {outcome.reason}
      </p>
    );
  }
  const last = outcome.last_closed;
  if (!last) return null;

  // `closed_at` is SQL `YYYY-MM-DD HH:MM:SS`. A bare `new Date()` on that
  // reads as the READER'S LOCAL time in V8 and NaN elsewhere, so the one
  // shared normaliser is used rather than a sixth local copy of the fix.
  const on = toUtcInstant(last.closed_at);
  const when = on && !Number.isNaN(new Date(on).getTime())
    ? new Date(on).toLocaleDateString()
    : null;

  // `withdrawn` is the subject's OWN act — HQ's close route cannot write it
  // (`HQ_DSR_OUTCOMES` omits it), so the outcome alone tells the two apart and
  // the copy must not credit HQ with a decision the subject made.
  const mine = last.outcome === 'withdrawn';
  const headline = mine
    ? 'You cancelled your deletion request'
    : last.outcome === 'fulfilled'
      ? 'Axal VC HQ recorded your erasure request as carried out'
      : last.outcome === 'denied'
        ? 'Axal VC HQ declined your erasure request'
        : `Axal VC HQ closed your erasure request as ${last.outcome}`;

  return (
    <div
      data-testid="dsr-outcome"
      data-outcome={last.outcome}
      role="status"
      aria-live="polite"
      className={`mt-3 rounded-lg border px-3 py-2 ${mine
        ? 'border-gray-400 dark:border-gray-600'
        : 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20'}`}>
      <p className="text-xs text-gray-600 dark:text-gray-300">
        {headline}
        {/*
          The NORMALISED INSTANT is emitted, not just the formatted date. It is
          correct `<time>` markup, and it is the only assertion about this that
          can fail on every machine: the formatted date is rendered in the
          READER'S zone, so on a UTC runner the buggy parse and the correct one
          produce the same string and a test comparing them proves nothing.
        */}
        {when ? <> on <time dateTime={on}>{when}</time></> : null}.
      </p>
      {last.close_reason ? (
        <p data-testid="dsr-outcome-reason" className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          Reason given: {last.close_reason}
        </p>
      ) : null}
    </div>
  );
}
