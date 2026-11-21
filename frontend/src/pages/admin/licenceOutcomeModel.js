/**
 * D4819 part 21 (#5928) — Licences v2 board L18: how a licence write ended, in
 * five states, each drawn differently (`LicenceOutcomeCard.jsx`).
 *
 *   pending    sent, no answer yet: "Suspending… Waiting for HQ to confirm."
 *   completed  HQ did it, and the branch (where there is one) acknowledged it
 *   partial    HQ did it; the branch has not yet acknowledged the revision.
 *              NEVER drawn as success. It says what HQ holds, what the branch
 *              has not taken, and offers Retry branch sync, not the write
 *   refused    HQ answered no, in the Worker's own words
 *   unknown    no answer arrived: do not repeat the write; re-read first
 *
 * `outcomeOfError` (lib/mutationOutcome.js, D4706) decides refused from
 * unknown; this file adds what the push answer (`pushed`, D4686) and the
 * licence's `sync` (`licence_push_pending`, and D5925's `branch_report`) say.
 * Pure: no React, no request.
 */
import { outcomeOfError } from '../../lib/mutationOutcome';

/** Each state's word and shape: never colour alone. */
export const OUTCOME_STATES = Object.freeze({
  pending: { label: 'Pending', shape: '◌' },
  completed: { label: 'Completed', shape: '✓' },
  partial: { label: 'Partially completed', shape: '◐' },
  refused: { label: 'Refused', shape: '✕' },
  unknown: { label: 'Outcome unknown', shape: '?' },
});

/** What each write is called while it runs, once done, and when it was not done. */
export const ACTION_WORDS = Object.freeze({
  activate: { doing: 'Activating…', done: 'Licence activated', not: 'Not activated', noun: 'activation' },
  reinstate: { doing: 'Reinstating…', done: 'Licence reinstated', not: 'Not reinstated', noun: 'reinstatement' },
  renew: { doing: 'Renewing…', done: 'Licence renewed', not: 'Not renewed', noun: 'renewal' },
  suspend: { doing: 'Suspending…', done: 'Licence suspended', not: 'Not suspended', noun: 'suspension' },
  terminate: { doing: 'Terminating…', done: 'Licence terminated', not: 'Not terminated', noun: 'termination' },
  addAdmin: { doing: 'Adding the administrator…', done: 'Administrator added', not: 'Administrator not added', noun: 'appointment' },
  detachAdmin: { doing: 'Detaching the account…', done: 'Account detached', not: 'Account not detached', noun: 'detach' },
  removeAdmin: { doing: 'Removing the administrator…', done: 'Administrator removed', not: 'Administrator not removed', noun: 'removal' },
  issueInvoice: { doing: 'Issuing the invoice…', done: 'Invoice issued', not: 'Invoice not issued', noun: 'invoice' },
  voidInvoice: { doing: 'Voiding the invoice…', done: 'Invoice voided', not: 'Invoice not voided', noun: 'void' },
  sendAgreement: { doing: 'Sending the agreement…', done: 'Agreement sent', not: 'Agreement not sent', noun: 'send' },
  deploy: { doing: 'Starting the deployment…', done: 'Deployment started', not: 'Deployment not started', noun: 'deployment' },
  retryDeploy: { doing: 'Retrying the deployment…', done: 'Deployment retried', not: 'Deployment not retried', noun: 'retry' },
  reconcileDeploy: { doing: 'Reconciling…', done: 'Deployment reconciled', not: 'Not reconciled', noun: 'reconcile' },
  syncRetry: { doing: 'Syncing the branch…', done: 'Branch sync retried', not: 'Branch sync not retried', noun: 'sync' },
});

const words = (action) => ACTION_WORDS[action] || { doing: 'Working…', done: 'Done', not: 'Not done', noun: 'change' };

/** The Worker's own sentence for a refusal, or null (a database string is never shown: only `message`/`error` words). */
export function refusalWords(error) {
  const data = error?.data || {};
  const text = [data.message, data.detail, typeof data.error === 'string' && /\s/.test(data.error) ? data.error : null]
    .find((v) => typeof v === 'string' && v.trim());
  return text ? String(text).trim() : null;
}

/** The branch's name for a sentence: its deployment code, or "The branch". */
const branchName = (pushed) => (pushed?.code ? String(pushed.code).toUpperCase() : 'The branch');

/** What D5925's read of the branch adds, or null. */
function branchReportLine(sync) {
  const report = sync?.branch_report;
  if (!report || typeof report !== 'object') return null;
  if (report.state === 'reported') {
    return Number.isSafeInteger(report.revision)
      ? `The branch reports it holds revision ${report.revision}.`
      : 'The branch reports it holds no numbered copy yet.';
  }
  if (report.state === 'unreadable') return 'What the branch holds could not be read just now.';
  if (report.state === 'older_build') return 'The branch runs an older build that does not say what it holds; redeploy it to read that.';
  return null;
}

/** HQ's own scheduled retry, from `licence_push_pending`. */
function pendingLine(sync) {
  const p = sync?.pending;
  if (!p || typeof p !== 'object') return null;
  const n = Number(p.attempts);
  return Number.isSafeInteger(n) && n > 0
    ? `HQ retries on its own as well (attempt ${n} so far).`
    : 'HQ retries on its own as well.';
}

/**
 * `{ state, title, detail, lines, next }` for one write.
 *   phase   'pending' | 'done' | 'failed'
 *   result  the write's answer (may carry `pushed`)
 *   error   what `request()` threw
 *   sync    the licence's `sync`, re-read after the write, when there is one
 * `next` is `'retrySync'`, `'reread'` or null: the one thing to do now.
 */
export function licenceWriteOutcome({ action, phase, result = null, error = null, sync = null }) {
  const w = words(action);
  if (phase === 'pending') return { state: 'pending', title: w.doing, detail: 'Waiting for HQ to confirm.', lines: [], next: null };
  if (phase === 'failed' || error) {
    const kind = outcomeOfError(error);
    if (kind === 'unknown') {
      return {
        state: 'unknown', title: 'No response from HQ',
        detail: `Re-read the licence before trying again. The ${w.noun} may or may not have been made, so repeating it blindly could make it twice.`,
        lines: [], next: 'reread',
      };
    }
    if (kind === 'partial') return partial(w, error?.data?.pushed || null, sync);
    return {
      state: 'refused', title: w.not,
      detail: refusalWords(error) || 'HQ refused it and changed nothing.',
      lines: [], next: null,
    };
  }
  const pushed = result?.pushed;
  if (result?.partial === true) return partial(w, pushed || null, sync);
  if (!pushed || typeof pushed !== 'object') return { state: 'completed', title: w.done, detail: null, lines: [], next: null };
  if (pushed.no_deployment) {
    return { state: 'completed', title: w.done, detail: 'This licence has no branch deployment yet, so there is nothing to sync.', lines: [], next: null };
  }
  if (pushed.ok === true && !pushed.partial) {
    const rev = Number.isSafeInteger(pushed.revision) ? ` revision ${pushed.revision}` : ' the change';
    return { state: 'completed', title: w.done, detail: `HQ and ${branchName(pushed)} confirmed${rev}.`, lines: [], next: null };
  }
  return partial(w, pushed, sync);
}

function partial(w, pushed, sync) {
  const rev = Number.isSafeInteger(pushed?.revision) ? `revision ${pushed.revision}` : 'the latest revision';
  const lines = [];
  if (pushed?.partial && Array.isArray(pushed.failed_sections) && pushed.failed_sections.length) {
    lines.push(`It took the copy but not: ${pushed.failed_sections.join(', ')}.`);
  }
  if (pushed?.reason) lines.push(String(pushed.reason));
  const report = branchReportLine(sync); if (report) lines.push(report);
  const pending = pendingLine(sync); if (pending) lines.push(pending);
  return {
    state: 'partial', title: `${w.done} at HQ`,
    detail: `${branchName(pushed)} has not yet acknowledged ${rev}. Retrying the ${w.noun} itself is not necessary.`,
    lines, next: 'retrySync',
  };
}
