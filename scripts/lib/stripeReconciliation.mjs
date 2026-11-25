/**
 * D8512 (#8512) — the rules of the Stripe line in the post-deploy smoke
 * (`scripts/check-stripe-reconciliation.mjs`), kept here so they are tested
 * without the network. `judgeReconciliation` takes the body of
 * `GET /api/admin/stripe/reconciliation` and answers one line and a level:
 *   - `ok`    no_events_expected or reconciled;
 *   - `warn`  delivery_failed_or_absent, accepted_state_missing, unreadable,
 *             a body that is not the reconciliation, or no read at all.
 * The smoke only warns: nothing here fails a release until the owner records
 * the state as known-good (#8512). The line carries the state and counts,
 * never an id, a payload or a key, whatever the body holds.
 */

export const RECONCILIATION_PATH = '/api/admin/stripe/reconciliation';
export const STATES = Object.freeze(['no_events_expected', 'reconciled', 'delivery_failed_or_absent', 'accepted_state_missing', 'unreadable']);
const OK = new Set(['no_events_expected', 'reconciled']);
const COUNTS = ['stripe_events', 'receipted', 'not_received', 'unfinished', 'paying_subscriptions'];

const countText = (v) => (Number.isSafeInteger(v) && v >= 0 ? String(v) : 'unknown');

/** The line for a body read from the route. */
export function judgeReconciliation(body) {
  if (!body || typeof body !== 'object' || !STATES.includes(body.state)) {
    return { level: 'warn', line: 'Stripe: could not be read (the answer is not the reconciliation).' };
  }
  const counts = COUNTS.map((k) => `${k}=${countText(body[k])}`).join(' ');
  const window = Number.isSafeInteger(body.window_hours) ? `${body.window_hours}h` : 'unknown window';
  const truncated = body.truncated === true ? ' (first page only)' : '';
  return { level: OK.has(body.state) ? 'ok' : 'warn', line: `Stripe: ${body.state} over ${window}${truncated}: ${counts}` };
}

/** The line when no read was made: the smoke holds no read credential. */
export function notRead(reason) {
  return { level: 'warn', line: `Stripe: not read (${reason}).` };
}
