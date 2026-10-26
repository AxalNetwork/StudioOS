/**
 * D1181 (#2389) — HQ › Platform › Bank accounts' tabs and the words of the
 * tabs that have no read yet, from the canvas "Bank Accounts" (BNK1–BNK12).
 * Pure, so `frontend/test/bank_accounts_d1181.test.mjs` holds each rule.
 *
 * Accounts (`/admin/platform/bank-accounts`) is today's registry panel (D708,
 * D717). Cash (`/cash`) draws Mercury's account balances from the read Fund
 * admin › Banking already makes; its 30-day series and monthly in and out
 * have no read yet. History (`/history`) has no read: the reveal ledger is
 * written and never read. One account's lightbox (`/account/:uid`, BNK2) is
 * part 5's.
 */

export const BASE = '/admin/platform/bank-accounts';

export const TABS = Object.freeze([
  { key: 'accounts', label: 'Accounts', path: BASE },
  { key: 'cash', label: 'Cash', path: `${BASE}/cash` },
  { key: 'history', label: 'History', path: `${BASE}/history` },
]);

/** The tab an address names; anything else under the page is Accounts. */
export function tabOf(pathname = '') {
  const p = String(pathname).replace(/\/+$/, '');
  return TABS.find((t) => t.key !== 'accounts' && t.path === p)?.key || 'accounts';
}

/**
 * D1186 (#3115): Cash and History now read what they draw (D1182, D1183), so
 * their "Not read here yet" blocks are gone. Cash is `BankCashTab.jsx` with
 * `bankCashModel.js`; History is `BankHistoryTab.jsx` with
 * `bankHistoryModel.js`.
 */
