/**
 * D710 (#1775) — the boundary between a Mercury response and what is stored.
 *
 * KEEP ONLY WHAT A USE NEEDS (decision 6). Each parser builds a new object
 * from named fields; every other field of the response, the full account and
 * routing numbers and the organization's EIN included, never leaves this
 * file. The last four digits are computed here. In a memo, a run of eight or
 * more digits becomes `••••` and its last four.
 *
 * MONEY. An amount becomes integer cents only when it is a whole number of
 * cents; anything else is refused and counted, never rounded. Only USD is
 * accepted.
 *
 * UNVERIFIED field names (docs.mercury.com unreachable, 2026-10-17; D710.md):
 *  - account: `id`, `accountNumber`, `kind` (`checking` | `savings`; other
 *    kinds are skipped), `nickname` (else `name`), `status`,
 *    `currentBalance`, `availableBalance` (dollars, as JSON numbers);
 *  - organization: `id`, `legalBusinessName` (else `name`), possibly under
 *    an `organization` key;
 *  - transaction: `id`, `amount` (signed dollars), `counterpartyName`,
 *    `createdAt`, `postedAt`, `status`, `kind`, `externalMemo` (the memo),
 *    and `currency` when present;
 *  - lists: `accounts` and `transactions` arrays, and `total`.
 */

export type AccountKind = 'checking' | 'savings';

export interface ParsedAccount {
  mercury_account_id: string;
  kind: AccountKind;
  last_four: string;
  nickname: string | null;
  status: string | null;
  current_cents: number | null;
  available_cents: number | null;
}

export interface ParsedOrganization { id: string | null; legal_name: string | null }

export interface ParsedTransaction {
  mercury_transaction_id: string;
  amount_cents: number;
  created_on: string | null;
  posted_on: string | null;
  counterparty_name: string | null;
  memo: string | null;
  status: string | null;
  kind: string | null;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown, max = 200): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
const id = (v: unknown): string | null =>
  typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v) ? v : null;

/**
 * Dollars to integer cents, only when the value is a whole number of cents.
 * Accepts a JSON number or a plain decimal string; null for anything else.
 */
export function toCents(v: unknown): number | null {
  if (typeof v === 'string') {
    const m = /^(-?)(\d{1,13})(?:\.(\d{1,2}))?$/.exec(v.trim());
    if (!m) return null;
    const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
    return m[1] ? -cents : cents;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const scaled = v * 100;
  const cents = Math.round(scaled);
  if (Math.abs(scaled - cents) > 1e-6 || !Number.isSafeInteger(cents)) return null;
  return cents;
}

/** YYYY-MM-DD from an ISO timestamp or date, else null. */
export function dayOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const d = v.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d ? null : d;
}

/** A memo with every run of eight or more digits reduced to `••••` and its last four. */
export function maskMemo(v: unknown): string | null {
  const s = text(v, 500);
  return s ? s.replace(/\d{8,}/g, (run) => `••••${run.slice(-4)}`) : null;
}

/** The last four digits of an account number, or null when it has fewer than four. */
function lastFour(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const digits = String(v).replace(/\D+/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export function parseAccounts(body: unknown): { accounts: ParsedAccount[]; skipped: number } {
  const root = obj(body);
  const list = Array.isArray(root?.accounts) ? root!.accounts as unknown[] : Array.isArray(body) ? body as unknown[] : [];
  const accounts: ParsedAccount[] = [];
  let skipped = 0;
  for (const raw of list) {
    const a = obj(raw);
    const accountId = id(a?.id);
    const kind = typeof a?.kind === 'string' ? a.kind.toLowerCase() : '';
    const four = lastFour(a?.accountNumber);
    if (!a || !accountId || (kind !== 'checking' && kind !== 'savings') || !four) { skipped += 1; continue; }
    accounts.push({
      mercury_account_id: accountId,
      kind,
      last_four: four,
      nickname: text(a.nickname) ?? text(a.name),
      status: text(a.status, 40),
      current_cents: toCents(a.currentBalance),
      available_cents: toCents(a.availableBalance),
    });
  }
  return { accounts, skipped };
}

export function parseOrganization(body: unknown): ParsedOrganization {
  const root = obj(body);
  const org = obj(root?.organization) ?? root;
  return { id: id(org?.id), legal_name: text(org?.legalBusinessName) ?? text(org?.name) };
}

export function parseTransactions(body: unknown): { transactions: ParsedTransaction[]; refused: number; total: number | null } {
  const root = obj(body);
  const list = Array.isArray(root?.transactions) ? root!.transactions as unknown[] : [];
  const transactions: ParsedTransaction[] = [];
  let refused = 0;
  for (const raw of list) {
    const t = obj(raw);
    const txId = id(t?.id);
    const currency = typeof t?.currency === 'string' ? t.currency.toLowerCase() : 'usd';
    const cents = toCents(t?.amount);
    if (!t || !txId || currency !== 'usd' || cents == null) { refused += 1; continue; }
    transactions.push({
      mercury_transaction_id: txId,
      amount_cents: cents,
      created_on: dayOf(t.createdAt),
      posted_on: dayOf(t.postedAt),
      counterparty_name: text(t.counterpartyName),
      memo: maskMemo(t.externalMemo),
      status: text(t.status, 40),
      kind: text(t.kind, 60),
    });
  }
  const total = typeof root?.total === 'number' && Number.isSafeInteger(root.total) ? root.total : null;
  return { transactions, refused, total };
}
