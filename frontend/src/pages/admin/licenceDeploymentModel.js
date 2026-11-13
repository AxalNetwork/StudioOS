/**
 * D4706 (#4706) — what the Deploy step offers next, from the deployment read
 * (`GET /api/admin/licences/:uid/deployment`), and what a status check means.
 *
 * The rule the page lives by: an attempt whose outcome is open is CHECKED,
 * never sent again. Retry appears only for a failed attempt; Check status
 * appears while a run is pending or its dispatch's answer never came; and the
 * page re-checks on its own while that lasts.
 */
import { describeOutcome } from '../../lib/mutationOutcome.js';

/** How often an open attempt is re-checked while the page is open. */
export const DEPLOY_POLL_MS = 30_000;

export function deployActions(view) {
  if (!view) return { canRetry: false, canCheck: false, poll: false, needsDoJurisdiction: false };
  const canRetry = view.retryable === true;
  const canCheck = view.reconcilable === true;
  return {
    canRetry,
    canCheck,
    poll: canCheck,
    // A deployment written before D4706 never stored this write-once value,
    // so the retry asks for it rather than guessing.
    needsDoJurisdiction: canRetry && !view.do_jurisdiction,
  };
}

/** The notice for a status check's answer (`checked`), or null when there is nothing new to say. */
export function noticeForCheck(checked, view) {
  switch (checked) {
    case 'succeeded':
      return describeOutcome('partial', { message: view?.status_note });
    case 'failed':
    case 'no_run':
      return describeOutcome('refused', { message: view?.last_failure?.failure_note || view?.status_note });
    case 'running':
      return describeOutcome('pending', { message: `Attempt ${view?.current_attempt} is running on GitHub.` });
    case 'no_run_yet':
      return describeOutcome('pending', { message: `GitHub has not started a run for attempt ${view?.current_attempt} yet.` });
    default:
      return null;
  }
}

/** The notice for a retry's answer. */
export function noticeForRetry(body) {
  if (body?.replayed) {
    return describeOutcome('committed', { message: `Attempt ${body.attempt} was already asked for, so nothing was sent again. Its state is below.` });
  }
  return describeOutcome('pending', { message: body?.note || `Attempt ${body?.attempt} was asked for.` });
}

/** "Attempt 2 · failed" — one attempt in a line. */
export function attemptLine(a) {
  if (!a) return null;
  return `Attempt ${a.attempt_no} · ${String(a.status).replace(/_/g, ' ')}`;
}
