/**
 * D1228 (#2384) — KYC & KYB's tabs, its addresses, its status words and the
 * words of the blocks that have no read yet, from the owner's canvas "KYC &
 * KYB" (KYC1–KYC17). Pure, so `frontend/test/kyc_kyb_d1228.test.mjs` holds
 * each rule.
 *
 * WHAT IS READ TODAY. People and the case read part 1's and part 2's routes
 * (D1233, `peopleModel.js`). No admin route reads a business, a renewal or
 * the audit trail yet, so those tabs say "Not read here yet" with their
 * reason and never draw a zero (D1228 §2).
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

/** The canvas's six status words, the six statuses the store holds since part 1 (D1229 §1). */
export const STATUS_WORD = Object.freeze({
  not_started: 'Not started',
  pending: 'Waiting',
  needs_info: 'Needs information',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
});
export const statusWord = (s) => STATUS_WORD[s] || 'Not recorded';

export const NOT_YET = 'Not read here yet';

/** What the canvas draws that no read carries yet. Never a zero, never "none". */
export const WAITS = Object.freeze({
  businesses: 'No admin read returns a business yet: company records, account entities and imports sit in three stores with no reviewer.',
  renewals: 'What is about to lapse is not read here yet: no admin read returns the checks’ expiry dates or the warnings sent.',
  audit: 'The record of every look and decision is not read here yet on this page: no studio admin read returns the KYC actions.',
});
