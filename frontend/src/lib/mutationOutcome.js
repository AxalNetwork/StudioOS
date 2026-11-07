/**
 * D4706 (#4706) — what happened to a write, in five words every licence
 * mutation shares.
 *
 *   pending    sent, no answer yet
 *   committed  the server said it is done
 *   refused    the server answered and said no, with its own sentence
 *   partial    the server did part of it: HQ's write is done, the branch's is not
 *   unknown    no answer arrived (a timeout, a dropped connection, a gateway
 *              error), so the write may or may not have landed
 *
 * UNKNOWN IS NOT REFUSED. A page that reads a timeout as a refusal offers the
 * same button again, and the second press is the duplicate. An unknown outcome
 * is answered by READING the state first (`reconcile`), never by sending the
 * write again.
 */

export const OUTCOMES = Object.freeze(['pending', 'committed', 'refused', 'partial', 'unknown']);

/** A failed write's outcome, from the error `request()` throws. */
export function outcomeOfError(e) {
  if (!e) return 'unknown';
  // The Worker's own "I could not tell" (D4706's 504 `outcome_unknown`).
  if (e.code === 'outcome_unknown' || e.data?.outcome === 'unknown') return 'unknown';
  // No HTTP status: the request timed out (`code: 'timeout'`) or never got an
  // answer at all. Either way the server may have done it.
  if (!e.status) return 'unknown';
  // A gateway error is the edge speaking, not the route: the route may have run.
  if (e.status === 502 && !e.code) return 'unknown';
  if (e.status === 503 || e.status === 504) return 'unknown';
  if (e.data?.partial === true) return 'partial';
  return 'refused';
}

/** A successful write's outcome, from the body it answered with. */
export function outcomeOfResult(body) {
  if (body?.partial === true) return 'partial';
  return 'committed';
}

/**
 * `{ outcome, message }` for a page to render. `message` is the server's own
 * sentence when it gave one; the fallbacks say what to do next, because an
 * outcome without a next step is the bug this file exists to close.
 */
export function describeOutcome(outcome, { message, fallback } = {}) {
  const text = message && String(message).trim();
  switch (outcome) {
    case 'committed': return { outcome, message: text || fallback || 'Saved.' };
    case 'partial': return { outcome, message: text || fallback || 'Part of this was done. The rest is still pending — check its status before doing it again.' };
    case 'refused': return { outcome, message: text || fallback || 'This was refused. Nothing was changed.' };
    case 'pending': return { outcome, message: text || fallback || 'Working…' };
    default:
      return {
        outcome: 'unknown',
        message: (text ? `${text} ` : '')
          + 'No answer came back, so this may or may not have been done. Check its status before trying again.',
      };
  }
}

/** The ARIA role an outcome is announced with: a refusal or an unknown interrupts; the rest is polite. */
export function outcomeRole(outcome) {
  return outcome === 'refused' || outcome === 'unknown' ? 'alert' : 'status';
}

/** `describeOutcome` for a caught error, in one call. */
export function outcomeFromError(e, fallback) {
  const outcome = outcomeOfError(e);
  return describeOutcome(outcome, { message: outcome === 'unknown' && !e?.status ? null : e?.message, fallback });
}
