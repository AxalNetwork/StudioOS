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
 * D1185's, drawn over Accounts, so that address is Accounts too.
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

export const NOT_YET = 'Not read here yet';

/** Why a block draws nothing today. Never a zero, never "none". */
export const WAITS = Object.freeze({
  series: 'Each account’s daily balance over 30 days, 90 days or 12 months is not read yet. The sync keeps a daily snapshot; nothing reads it for this page.',
  monthly: 'Money in and out per entity and month is not read yet. Transfers between Axal’s own accounts will be left out.',
  history: 'The history of reveals and changes is not read yet. Every reveal is written to the ledger before a number is shown; the read that lists them comes next.',
});

/** An Admin's line on Cash and History: balances are on Fund admin, for every Admin on HQ. */
export const ADMIN_CASH_LINE = 'Balances and transactions for every Admin on HQ are on Fund admin › Banking.';
