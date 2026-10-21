/**
 * D840 (#2346) — typed reads of a member's own Mercury. THE INTERFACE D840's
 * PARTS USE: parts 2–4 (#2347, #2348, #2349) read Mercury through this file
 * alone, and nothing but this file imports `mcp.ts`.
 *
 * TWO SHAPES.
 *  - `openMercuryReads` opens one MCP session for a member who signed in with
 *    Mercury (`oauth_mcp`) and gives one function per tool on
 *    `MERCURY_READ_TOOLS`, each returning parsed, typed data.
 *  - `MercuryBankReader` is what the existing feeds read (D713's revenue
 *    import and matching, D752's proof of funds and spend): the organization,
 *    its accounts and their transactions, the same on both paths. A member who
 *    pasted a Read Only API token reads through `tokenBankReader` (D710's
 *    GET-only `client.ts`); one who signed in reads through `mcpBankReader`.
 *
 * KEEP ONLY WHAT A USE NEEDS (D710 decision 6). Accounts, the organization and
 * transactions go through `parse.ts`, which keeps the last four and drops
 * account and routing numbers and the EIN. The parsers here build new objects
 * from named fields in the same way: no account number, no address, no email.
 * Money becomes integer cents only when it is a whole number of cents.
 *
 * UNVERIFIED (D840.md): the field names of each tool's data. Mercury's MCP
 * server wraps its banking API, so accounts, transactions and the organization
 * are read with D710's field names; the others are named in each parser.
 * A page's next cursor is `page.nextPage` (as the server's `listTransactions`
 * describes it).
 */
import { getOrganization as apiOrganization, getTransaction as apiTransaction, listAccounts as apiAccounts, listTransactions as apiTransactions, MercuryClientError, type MercuryFetch } from './client';
import { openMercuryMcp, type MercuryMcpSession } from './mcp';

export { MERCURY_MCP_URL, MERCURY_READ_TOOLS } from './mcp';
import { dayOf, parseAccounts, parseOrganization, parseTokenPermission, parseTransaction, parseTransactions, toCents, type ParsedAccount, type ParsedOrganization, type ParsedTransaction, type TokenPermission } from './parse';

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown, max = 200): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
const ident = (v: unknown): string | null =>
  typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v) ? v : null;
const wholeCents = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) ? v : null;
const listOf = (body: unknown, key: string): unknown[] => {
  const root = obj(body);
  return Array.isArray(root?.[key]) ? root![key] as unknown[] : Array.isArray(body) ? body as unknown[] : [];
};
const nextPage = (body: unknown): string | null => ident(obj(obj(body)?.page)?.nextPage);

/** The most pages one list read follows. */
export const MAX_PAGES = 5;
const PAGE_LIMIT = 500;

// ─────────────────────────────────────────────────────────── the typed data

export interface McpTransaction extends ParsedTransaction {
  /** The account the line is on, when Mercury names it. */
  mercury_account_id: string | null;
}
export interface CashflowMonth { month: string; incoming_cents: number; outgoing_cents: number; cashflow_cents: number }
export interface CashflowSummary { months: CashflowMonth[]; truncated: boolean }
export interface TreasuryAccount { id: string; status: string | null; current_cents: number | null; available_cents: number | null }
export interface Statement { id: string; account_id: string; period_start: string | null; period_end: string | null; ending_balance_cents: number | null; transaction_count: number | null }
export interface Invoice { id: string; number: string | null; customer_id: string | null; amount_cents: number | null; status: string | null; issued_on: string | null; due_on: string | null }
export interface Customer { id: string; name: string | null }
export interface Recipient { id: string; name: string | null; status: string | null; last_paid_on: string | null }
export interface SafeRequest { id: string; investor_name: string | null; amount_cents: number | null; valuation_cap_cents: number | null; status: string | null; created_on: string | null }
export interface Category { id: string; name: string | null }

function toMcpTransaction(raw: unknown): McpTransaction | null {
  const t = parseTransaction(raw);
  return t ? { ...t, mercury_account_id: ident(obj(obj(raw)?.transaction ?? raw)?.accountId) } : null;
}

/** UNVERIFIED: `month` (YYYY-MM), `incomingCents`, `outgoingCents` (negative), `cashflowCents`, `truncated`. */
export function parseCashflow(body: unknown): CashflowSummary {
  const months: CashflowMonth[] = [];
  for (const raw of listOf(body, 'months')) {
    const m = obj(raw);
    const month = typeof m?.month === 'string' && /^\d{4}-\d{2}/.test(m.month) ? m.month.slice(0, 7) : null;
    const incoming = wholeCents(m?.incomingCents), outgoing = wholeCents(m?.outgoingCents), net = wholeCents(m?.cashflowCents);
    if (!month || incoming == null || outgoing == null || net == null) continue;
    months.push({ month, incoming_cents: incoming, outgoing_cents: outgoing, cashflow_cents: net });
  }
  return { months, truncated: obj(body)?.truncated === true };
}

/** UNVERIFIED: `accounts[]` with `id`, `status`, `currentBalance`, `availableBalance` (dollars). */
export function parseTreasury(body: unknown): TreasuryAccount[] {
  return listOf(body, 'accounts').map(obj).flatMap((a) => {
    const id = ident(a?.id);
    return id ? [{ id, status: text(a!.status, 40), current_cents: toCents(a!.currentBalance), available_cents: toCents(a!.availableBalance) }] : [];
  });
}

/** UNVERIFIED: `statements[]` with `id`, `startDate`, `endDate`, `endingBalance` (dollars), `transactionCount`. No download link is kept. */
export function parseStatements(body: unknown, accountId: string): Statement[] {
  return listOf(body, 'statements').map(obj).flatMap((s) => {
    const id = ident(s?.id);
    const count = s?.transactionCount;
    return id ? [{
      id, account_id: accountId, period_start: dayOf(s!.startDate), period_end: dayOf(s!.endDate),
      ending_balance_cents: toCents(s!.endingBalance), transaction_count: typeof count === 'number' && Number.isSafeInteger(count) ? count : null,
    }] : [];
  });
}

/** UNVERIFIED: `invoices[]` with `id`, `invoiceNumber`, `customerId`, `amount` (dollars), `status`, `invoiceDate`, `dueDate`. */
export function parseInvoices(body: unknown): Invoice[] {
  return listOf(body, 'invoices').map(obj).flatMap((i) => {
    const id = ident(i?.id);
    return id ? [{
      id, number: text(i!.invoiceNumber, 60), customer_id: ident(i!.customerId), amount_cents: toCents(i!.amount),
      status: text(i!.status, 40), issued_on: dayOf(i!.invoiceDate), due_on: dayOf(i!.dueDate),
    }] : [];
  });
}

/** UNVERIFIED: `customers[]` with `id` and `name`. No email or address is kept. */
export function parseCustomers(body: unknown): Customer[] {
  return listOf(body, 'customers').map(obj).flatMap((c) => {
    const id = ident(c?.id);
    return id ? [{ id, name: text(c!.name) }] : [];
  });
}

/** UNVERIFIED: `recipients[]` with `id`, `name`, `status`, `lastPaidDate`. No payment method or account number is kept. */
export function parseRecipients(body: unknown): Recipient[] {
  return listOf(body, 'recipients').map(obj).flatMap((r) => {
    const id = ident(r?.id);
    return id ? [{ id, name: text(r!.name), status: text(r!.status, 40), last_paid_on: dayOf(r!.lastPaidDate) }] : [];
  });
}

/** UNVERIFIED: a list (or `safeRequests[]`) with `id`, `investorName`, `purchaseAmount`, `postMoneyValuationCap` (dollars), `status`, `createdAt`. */
export function parseSafeRequests(body: unknown): SafeRequest[] {
  return listOf(body, 'safeRequests').map(obj).flatMap((s) => {
    const id = ident(s?.id);
    return id ? [{
      id, investor_name: text(s!.investorName), amount_cents: toCents(s!.purchaseAmount),
      valuation_cap_cents: toCents(s!.postMoneyValuationCap), status: text(s!.status, 40), created_on: dayOf(s!.createdAt),
    }] : [];
  });
}

/** UNVERIFIED: `categories[]` with `id` and `name`. */
export function parseCategories(body: unknown): Category[] {
  return listOf(body, 'categories').map(obj).flatMap((c) => {
    const id = ident(c?.id);
    return id ? [{ id, name: text(c!.name, 80) }] : [];
  });
}

// ─────────────────────────────────────────────────────────── one MCP session

/**
 * A member's MCP access: their access token, and `refresh` to try once when
 * the server answers 401 (`oauth.ts` gives it; it stores the new tokens).
 */
export interface McpAccess {
  accessToken: string;
  refresh?: () => Promise<string | null>;
  fetcher?: MercuryFetch;
}

export interface TransactionsQuery {
  accountIds?: string[];
  /** `postedAt` bounds, YYYY-MM-DD. */
  postedStart?: string;
  postedEnd?: string;
  /** `createdAt` lower bound, YYYY-MM-DD (D713's window reads by it). */
  start?: string;
  limit?: number;
  startAfter?: string | null;
}

/** One function per tool on `MERCURY_READ_TOOLS`. */
export interface MercuryReads {
  readonly offered: readonly string[];
  organization(): Promise<ParsedOrganization>;
  accounts(): Promise<ParsedAccount[]>;
  account(accountId: string): Promise<ParsedAccount | null>;
  transactions(q?: TransactionsQuery): Promise<{ transactions: McpTransaction[]; refused: number; next: string | null }>;
  transaction(transactionId: string): Promise<McpTransaction | null>;
  cashflowSummary(q?: { monthsBack?: number; accountIds?: string[] }): Promise<CashflowSummary>;
  treasury(): Promise<TreasuryAccount[]>;
  statements(accountId: string, q?: { start?: string; end?: string }): Promise<Statement[]>;
  invoices(): Promise<Invoice[]>;
  customers(): Promise<Customer[]>;
  recipients(): Promise<Recipient[]>;
  safeRequests(): Promise<SafeRequest[]>;
  categories(): Promise<Category[]>;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ids = (v: string[] | undefined) => (v ?? []).filter((x) => ident(x));
const day = (v: string | undefined) => (v && DAY_RE.test(v) ? v : undefined);

/** Open one session as the member; a 401 at open tries `refresh` once. */
export async function openMercuryReads(access: McpAccess): Promise<MercuryReads> {
  let session: MercuryMcpSession;
  try {
    session = await openMercuryMcp({ accessToken: access.accessToken, fetcher: access.fetcher });
  } catch (e) {
    if (!(e instanceof MercuryClientError && e.code === 'unauthorized') || !access.refresh) throw e;
    const fresh = await access.refresh();
    if (!fresh) throw e;
    session = await openMercuryMcp({ accessToken: fresh, fetcher: access.fetcher });
  }
  const call = (name: string, args: Record<string, unknown> = {}) => session.callTool(name, args);

  /** Every page of a cursor list, up to `MAX_PAGES`. */
  async function all<T>(name: string, args: Record<string, unknown>, parse: (body: unknown) => T[]): Promise<T[]> {
    const out: T[] = [];
    let after: string | null = null;
    for (let p = 0; p < MAX_PAGES; p++) {
      const body = await call(name, { ...args, limit: PAGE_LIMIT, ...(after ? { start_after: after } : {}) });
      out.push(...parse(body));
      after = nextPage(body);
      if (!after) break;
    }
    return out;
  }

  return {
    offered: session.offered,
    async organization() { return parseOrganization(await call('getOrganization')); },
    async accounts() { return all('getAccounts', {}, (b) => parseAccounts(b).accounts); },
    async account(accountId) {
      if (!ident(accountId)) throw new MercuryClientError('path_not_allowed');
      const body = await call('getAccount', { accountId });
      return parseAccounts({ accounts: [obj(obj(body)?.account) ?? body] }).accounts[0] ?? null;
    },
    async transactions(q = {}) {
      const args: Record<string, unknown> = { order: 'asc', limit: Math.max(1, Math.min(1000, Math.trunc(q.limit ?? PAGE_LIMIT))) };
      const accountIds = ids(q.accountIds);
      if (accountIds.length) args.accountId = accountIds;
      if (day(q.postedStart)) args.postedStart = q.postedStart;
      if (day(q.postedEnd)) args.postedEnd = q.postedEnd;
      if (day(q.start)) args.start = q.start;
      if (q.startAfter && ident(q.startAfter)) args.start_after = q.startAfter;
      const body = await call('listTransactions', args);
      const parsed = parseTransactions(body);
      const raw = listOf(body, 'transactions');
      const byId = new Map(raw.map(obj).filter(Boolean).map((t) => [t!.id, ident(t!.accountId)]));
      return {
        transactions: parsed.transactions.map((t) => ({ ...t, mercury_account_id: byId.get(t.mercury_transaction_id) ?? null })),
        refused: parsed.refused,
        next: nextPage(body),
      };
    },
    async transaction(transactionId) {
      if (!ident(transactionId)) throw new MercuryClientError('path_not_allowed');
      try {
        return toMcpTransaction(await call('getTransactionById', { transactionId }));
      } catch (e) {
        // The tool's own error on one id (a JSON-RPC error or `isError`, both on
        // an HTTP 200) reads as not found, as a 404 does on the token path.
        if (e instanceof MercuryClientError && e.code === 'http_error' && (e.status == null || e.status === 200)) return null;
        throw e;
      }
    },
    async cashflowSummary(q = {}) {
      const args: Record<string, unknown> = {};
      if (q.monthsBack != null) args.monthsBack = Math.max(1, Math.min(12, Math.trunc(q.monthsBack)));
      const accountIds = ids(q.accountIds);
      if (accountIds.length) args.accountIds = accountIds;
      return parseCashflow(await call('getCashflowSummary', args));
    },
    async treasury() { return all('getTreasury', {}, parseTreasury); },
    async statements(accountId, q = {}) {
      if (!ident(accountId)) throw new MercuryClientError('path_not_allowed');
      const args: Record<string, unknown> = { accountId };
      if (day(q.start)) args.start = q.start;
      if (day(q.end)) args.end = q.end;
      return all('getAccountStatements', args, (b) => parseStatements(b, accountId));
    },
    async invoices() { return all('listInvoices', {}, parseInvoices); },
    async customers() { return all('listCustomers', {}, parseCustomers); },
    async recipients() { return all('getRecipients', {}, parseRecipients); },
    async safeRequests() { return parseSafeRequests(await call('getSafeRequests')); },
    async categories() { return all('listCategories', {}, parseCategories); },
  };
}

// ─────────────────────────────────────────────────────────── the feeds' reader, both paths

/** The organization and its checking and savings accounts, and what the credential reports of its permission. */
export interface OrganizationRead {
  org: ParsedOrganization;
  accounts: ParsedAccount[];
  permission: TokenPermission;
}

export interface TransactionsPage { transactions: ParsedTransaction[]; refused: number; next: string | null }

/** What D713's and D752's feeds read, whichever way the member connected. */
export interface MercuryBankReader {
  readonly via: 'api_token' | 'oauth_mcp';
  readOrganization(): Promise<OrganizationRead>;
  /** One page of an account's lines, oldest first, created on or after `start`. `cursor` null is the first page. */
  transactionsPage(accountId: string, page: { start: string; limit: number; cursor: string | null }): Promise<TransactionsPage>;
  /** One line of that account by id, or null when the account does not hold it. */
  transaction(accountId: string, transactionId: string): Promise<ParsedTransaction | null>;
}

/** A pasted Read Only API token, through D710's GET-only client. */
export function tokenBankReader(token: string, fetcher?: MercuryFetch): MercuryBankReader {
  return {
    via: 'api_token',
    async readOrganization() {
      const orgBody = await apiOrganization(token, fetcher);
      const accountsBody = await apiAccounts(token, fetcher);
      const permission = parseTokenPermission(orgBody);
      return {
        org: parseOrganization(orgBody),
        accounts: parseAccounts(accountsBody).accounts,
        permission: permission === 'not_reported' ? parseTokenPermission(accountsBody) : permission,
      };
    },
    async transactionsPage(accountId, page) {
      const offset = page.cursor ? Number(page.cursor) : 0;
      const parsed = parseTransactions(await apiTransactions(token, accountId, { start: page.start, limit: page.limit, offset }, fetcher));
      const full = parsed.transactions.length + parsed.refused >= page.limit;
      return { transactions: parsed.transactions, refused: parsed.refused, next: full ? String(offset + page.limit) : null };
    },
    async transaction(accountId, transactionId) {
      try {
        return parseTransaction(await apiTransaction(token, accountId, transactionId, fetcher));
      } catch (e) {
        if (e instanceof MercuryClientError && e.code === 'http_error' && e.status === 404) return null;
        throw e;
      }
    },
  };
}

/** The scopes a sign-in may hold: `read`, and `offline_access` for the refresh token. */
export const MCP_READ_SCOPES: readonly string[] = Object.freeze(['read', 'offline_access']);

/** Read-only when every granted scope is one of `MCP_READ_SCOPES` and `read` is among them. */
export function scopePermission(scopes: readonly string[]): TokenPermission {
  if (!scopes.length) return 'not_reported';
  return scopes.every((s) => MCP_READ_SCOPES.includes(s)) && scopes.includes('read') ? 'read_only' : 'above_read_only';
}

/** A member signed in with Mercury: one MCP session, opened on the first read. */
export function mcpBankReader(access: McpAccess & { scopes: readonly string[] }): MercuryBankReader {
  let opened: Promise<MercuryReads> | null = null;
  const reads = () => (opened ??= openMercuryReads(access));
  const byId = new Map<string, McpTransaction | null>();
  return {
    via: 'oauth_mcp',
    async readOrganization() {
      const r = await reads();
      return { org: await r.organization(), accounts: await r.accounts(), permission: scopePermission(access.scopes) };
    },
    async transactionsPage(accountId, page) {
      const r = await reads();
      const out = await r.transactions({ accountIds: [accountId], start: page.start, limit: page.limit, startAfter: page.cursor });
      // A line Mercury places on another account is not this account's.
      const transactions = out.transactions.filter((t) => t.mercury_account_id == null || t.mercury_account_id === accountId);
      return { transactions: transactions.map(({ mercury_account_id: _a, ...t }) => t), refused: out.refused, next: out.next };
    },
    async transaction(accountId, transactionId) {
      if (!byId.has(transactionId)) byId.set(transactionId, await (await reads()).transaction(transactionId));
      const t = byId.get(transactionId);
      // Strict: a line whose account Mercury does not name is not given a last four it may not have.
      if (!t || t.mercury_account_id !== accountId) return null;
      const { mercury_account_id: _a, ...line } = t;
      return line;
    },
  };
}
