/**
 * D4707 (#4707) — the reasons the licence page asks for before a write, and
 * the one rule that checks them. Replaces six `window.prompt` calls: a prompt
 * cannot be labelled, cannot say how long a reason must be until after it is
 * refused, and throws away what was typed when the server says no.
 */

/**
 * Each ask: its dialog title, its question, the shortest reason the Worker
 * accepts (0 = optional), and optionally `consequence`, the rule the action
 * carries, said before the reason is asked for. D4819 (#4819) moved the
 * suspension rule here from the ledger's header: the ledger states what is
 * true, the action says what it will do. D4819 part 4 (#5927) moved suspend
 * and terminate, with their rules, to the consequence sheet
 * (`licenceConsequenceModel.js`); `REASON_MAX` and `checkReason` serve both.
 */
export const LICENCE_REASONS = Object.freeze({
  demoteAdmin: {
    title: 'Demote this administrator',
    question: 'Why is this administrator being removed? It is recorded.',
    min: 10, confirm: 'Demote', tone: 'warn',
  },
  acceptNotice: {
    title: 'Accept this response',
    question: 'A note on why this is accepted. Optional, and it is recorded.',
    min: 0, confirm: 'Accept', tone: 'ok',
  },
  rejectNotice: {
    title: 'Reject this response',
    question: 'Why is this response not accepted? The account stays frozen, and this is what they read.',
    min: 1, confirm: 'Reject', tone: 'danger',
  },
});

export const REASON_MAX = 1000;

/** `{ ok, message }` for what has been typed so far. */
export function checkReason(text, { min = 0, max = REASON_MAX } = {}) {
  const t = String(text ?? '').trim();
  if (t.length < min) {
    return { ok: false, message: min === 1 ? 'A reason is required.' : `At least ${min} characters (${t.length} so far).` };
  }
  if (t.length > max) return { ok: false, message: `At most ${max} characters (${t.length} so far).` };
  return { ok: true, message: null };
}
