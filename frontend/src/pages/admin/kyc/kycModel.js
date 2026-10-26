/**
 * D1228 (#2384) — KYC & KYB's tabs, its addresses, its status words and the
 * words of the blocks that have no read yet, from the owner's canvas "KYC &
 * KYB" (KYC1–KYC17). Pure, so `frontend/test/kyc_kyb_d1228.test.mjs` holds
 * each rule.
 *
 * WHAT IS READ TODAY. `kyc.ts`'s admin queue (`GET /api/kyc/admin/queue`, one
 * status at a time, each read logged as `kyc_queue_access`) and one person's
 * record (`GET /api/kyc/admin/:userId`, sensitive values masked, logged as
 * `kyc_record_access`). No admin route reads a business, a renewal or the audit
 * trail, and the queue carries no wait, flag, assignee, paging or count, so
 * those blocks say "Not read here yet" with their reason and never draw a zero
 * (D1228 §2).
 */

export const BASE = '/admin/kyc';

export const PAGE_LINE = 'Check who people and businesses are before they sign, invest or get paid. Every look and every decision is recorded.';

/** The canvas's four tabs, in its order, each at its own address. */
export const TABS = Object.freeze([
  { key: 'people', label: 'People', path: BASE },
  { key: 'businesses', label: 'Businesses', path: `${BASE}/businesses` },
  { key: 'renewals', label: 'Renewals', path: `${BASE}/renewals` },
  { key: 'audit', label: 'Audit', path: `${BASE}/audit` },
]);

const ID = /^[1-9][0-9]{0,15}$/;

/** One person's case (KYC3). An id that is not a positive integer opens People. */
export function personHref(id) {
  const s = String(id ?? '');
  return ID.test(s) ? `${BASE}/people/${s}` : BASE;
}

/**
 * What an address names: the tab, and on a person's case their id. Anything
 * unknown under the page is People; a malformed id is People with no case.
 */
export function viewOf(pathname = '') {
  const p = String(pathname).replace(/\/+$/, '');
  if (p !== BASE && !p.startsWith(`${BASE}/`)) return { tab: 'people', person: null };
  const [word, id, extra] = p.slice(BASE.length + 1).split('/');
  if (word === 'people') return { tab: 'people', person: id && extra === undefined && ID.test(id) ? id : null };
  const tab = TABS.find((t) => t.key === word && t.key !== 'people');
  return { tab: tab ? tab.key : 'people', person: null };
}

/**
 * The canvas's status words. The store holds the first four; Needs
 * information and Expired are new statuses (part 1), worded here so the page
 * says them the same way once the Worker writes them.
 */
export const STATUS_WORD = Object.freeze({
  not_started: 'Not started',
  pending: 'Waiting',
  needs_info: 'Needs information',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
});
export const statusWord = (s) => STATUS_WORD[s] || 'Not recorded';

/** The statuses the queue read accepts today, Waiting first (KYC1's default). */
export const QUEUE_FILTERS = Object.freeze(['pending', 'approved', 'rejected', 'not_started']);

const when = (v) => (v ? v : null);

/** KYC3's account facts from the record read. A value the read did not return stays null. */
export function personFacts(r = {}) {
  const d = r.kyc_data || {};
  const name = `${d.legal_first_name || ''} ${d.legal_last_name || ''}`.trim();
  return [
    ['Email', r.email || null],
    ['Profile', r.role || null],
    ['Status', statusWord(r.kyc_status)],
    ['Provider', r.kyc_provider || null],
    ['Submitted', when(r.submitted_at)],
    ['Reviewed', when(r.reviewed_at)],
    ['Legal name', name || null],
    ['Nationality', d.nationality || null],
    ['Country', d.country || null],
    ['ID type', d.id_type || null],
  ];
}

/** A decision is open only on a check that is Waiting or Rejected, as the Worker allows today. */
export const decidable = (status) => status === 'pending' || status === 'rejected';

export const NOT_YET = 'Not read here yet';

/** What the canvas draws that no read carries yet. Never a zero, never "none". */
export const WAITS = Object.freeze({
  figures: 'The counts per status, the wait bands and the decisions per week are not read here yet: the queue read returns one status at a time with no counts.',
  queue: 'Each person’s wait, ID type, country, flags and assignee, with search, sort and paging, are not read here yet.',
  statuses: 'Needs information and Expired are not statuses the store holds yet, so no one is listed under them.',
  documents: 'Several documents per case, each with its kind, and the viewer inside the page are not read here yet. The one stored document opens from People’s Review.',
  checks: 'The automatic checks and their reference are not read here yet as checks; Review still shows the provider’s raw result.',
  sanctions: 'Screening on this case is not read here yet. An unread screening is never a claim of no match.',
  history: 'Who looked and who decided, with when, is not read here yet on the case.',
  assignment: 'Assignment and notes are not stored yet.',
  decide: 'Decisions are made from People’s Review for now; the case page’s own decision bar and its dialogs are part 5’s.',
  hq: 'Sending a case to HQ is not available yet; Approve and Reject stay with any Admin until it is.',
  businesses: 'No admin read returns a business yet: company records, account entities and imports sit in three stores with no reviewer.',
  renewals: 'What is about to lapse is not read here yet: no admin read returns the checks’ expiry dates or the warnings sent.',
  audit: 'The record of every look and decision is not read here yet on this page: no studio admin read returns the KYC actions.',
});
