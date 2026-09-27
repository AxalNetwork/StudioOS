/**
 * What `/branch/approvals` reads off the query string (D445).
 *
 * Settings rows and any other door that raises an escalation link here with
 * `kind` and `subject` already chosen, so the form is not blank when the
 * person arrives. An unknown kind is ignored: the form keeps its own default
 * rather than sending a kind it cannot name. The subject is trimmed and cut
 * at 300 characters, which is the route's own limit.
 *
 * HqSupportSessionBar.jsx is Session 5's and is not edited here. Its "Raise a
 * concern" link is `/branch/approvals` with no query. The prefill it would
 * use is `?kind=other&subject=`.
 */

export const PREFILL_KINDS = ['moderation', 'content', 'seat_increase', 'other'];
const SUBJECT_MAX = 300;

export function prefillFromSearch(params) {
  const kind = params?.get?.('kind');
  const raw = params?.get?.('subject');
  const subject = typeof raw === 'string' ? raw.trim().slice(0, SUBJECT_MAX) : '';
  return {
    kind: PREFILL_KINDS.includes(kind) ? kind : null,
    subject,
  };
}

export function approvalsHref({ kind, subject } = {}) {
  const q = new URLSearchParams();
  if (PREFILL_KINDS.includes(kind)) q.set('kind', kind);
  const text = typeof subject === 'string' ? subject.trim().slice(0, SUBJECT_MAX) : '';
  if (text) q.set('subject', text);
  const s = q.toString();
  return s ? `/branch/approvals?${s}` : '/branch/approvals';
}
