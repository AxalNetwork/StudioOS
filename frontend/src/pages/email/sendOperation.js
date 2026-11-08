// D4665 (#4665) — the composer's side of a send operation.
//
// One composition has one operation key, kept across retries, so a press that failed in transit (no answer
// reached us) is recovered by the server instead of sent again. A changed message is a different operation
// and gets a new key. A definite answer from the server ends the operation: the next press starts a new one.
// Pure: no React, no network.

export function newOperationKey() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `op${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function makeSendOperation() {
  let fingerprint = null;
  let key = null;
  return {
    /** The key for this exact message: the same one while nothing changes, a new one when anything does. */
    keyFor(parts) {
      const next = JSON.stringify(parts);
      if (next !== fingerprint) { fingerprint = next; key = newOperationKey(); }
      return key;
    },
    forget() { fingerprint = null; key = null; },
  };
}

/** What the server recorded: `accepted`, `uncertain` or `pending`. A reply that names neither an operation nor a sent row is not recorded, never read as sent. */
export function readOutcome(reply) {
  const operation = reply?.operation ?? null;
  const state = operation?.state;
  if (state === 'accepted' && reply?.sent) return { state, operation, sent: reply.sent };
  if (!operation && reply?.sent) return { state: 'accepted', operation, sent: reply.sent }; // the reply before operations existed
  if (state === 'uncertain' || state === 'pending') return { state, operation, sent: null };
  return { state: 'unrecorded', operation, sent: null };
}

export const PENDING_LINE = 'This email is still being sent. Wait a moment, then press Send again to check.';
export const NOT_RECORDED_LINE = 'The send was not confirmed. Press Send again to check; it will not send twice.';
export const UNSURE_LINE = 'The mail server may or may not have taken this email. Look in your Sent folder, then tell us which.';

/**
 * The line for a send that threw. A server answer carries its own sentence and ends the operation (`ended`).
 * A request that got no answer says the truth: the outcome is unknown, and pressing Send again checks.
 */
export function sendFailure(e) {
  const answered = typeof e?.status === 'number' && e.status > 0;
  if (!answered) return { ended: false, line: 'The send was not confirmed, so we cannot say whether the email went. Press Send again to check; it will not send twice.' };
  return { ended: true, line: e?.message || 'The mail server refused it. Nothing was sent.' };
}
