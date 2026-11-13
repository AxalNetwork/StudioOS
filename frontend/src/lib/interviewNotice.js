// D756 §1.7 (#1894) — the interviewee recording notice's version, pure.
//
// The Worker's `services/channels/consentNotice.ts` keeps the same number and
// path; `frontend/test/interview_notice_d756.test.mjs` fails when they drift.
// A chat notice links to `/privacy/interviews?n=<version>`, and the page shows
// the version it was sent, if that version was ever published.

export const INTERVIEW_NOTICE_VERSION = 1;
export const INTERVIEW_NOTICE_PATH = '/privacy/interviews';
// OWNER: the address for deletion requests (D756 §1.7). null prints none.
export const INTERVIEW_CONTACT_EMAIL = null;

/**
 * Which version to show for a query string. `asked` is the `n` the link
 * carried, or null when it is absent or not a whole number of one to three
 * digits; `shown` is `asked` when `known` has it, and the current version
 * otherwise. Nothing else in the query is read.
 */
export function noticeVersionFrom(search, known, current = INTERVIEW_NOTICE_VERSION) {
  const raw = new URLSearchParams(search || '').get('n');
  const asked = raw != null && /^\d{1,3}$/.test(raw) ? Number(raw) : null;
  const has = (v) => (known instanceof Set ? known.has(v) : Array.isArray(known) ? known.includes(v) : Object.prototype.hasOwnProperty.call(known || {}, v));
  return { shown: asked != null && has(asked) ? asked : current, asked };
}
