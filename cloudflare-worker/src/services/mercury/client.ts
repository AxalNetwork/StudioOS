/**
 * D710 (#1775) — the Mercury API client. READ-ONLY BY CONSTRUCTION.
 *
 * This is the only file in the Worker that names Mercury's API host. Every
 * request it makes:
 *  - is a GET. There is no other method in this file, and no request body;
 *  - goes to one of `READ_PATHS`, a frozen allowlist of read endpoints. A path
 *    off the list is refused before any request is made;
 *  - is sent with `redirect: 'manual'`. A 3xx is an error and is never
 *    followed, so the token is never sent to another host;
 *  - has a 10-second deadline (`withDeadline`).
 *
 * An error carries the HTTP status and a code, never a response body: a body
 * may echo account data, and `util/refusal.ts` would log and return it.
 *
 * Nothing here sends, transfers or requests money, approves a request, or
 * edits a transaction, note or category. Mercury's own MCP server exposes
 * those acts; none has a counterpart here, and the guard test
 * (`mercury_read_only_d710.test.mjs`) holds this file to that.
 *
 * UNVERIFIED against docs.mercury.com (unreachable from the building session,
 * 2026-10-17; D710.md lists each fact): the base URL, the Bearer header, the
 * three read paths, and the `limit` / `offset` / `start` / `order` query
 * parameters. The owner's first connect is the live check.
 */
import { DeadlineExceeded, withDeadline } from '../../util/deadline';

/** UNVERIFIED: Mercury's API base URL, as recalled. */
export const MERCURY_API_BASE = 'https://api.mercury.com/api/v1';

export const MERCURY_DEADLINE_MS = 10_000;

/**
 * The read endpoints, and the only paths a request may take. UNVERIFIED:
 * `/accounts` lists the organization's accounts, `/organization` returns its
 * legal name, `/account/:id/transactions` lists one account's lines, and
 * `/account/:id/transaction/:txId` reads one line by id (D713, #1778: a
 * member's import and match re-read the line they picked).
 */
export const READ_PATHS: readonly RegExp[] = Object.freeze([
  /^\/accounts$/,
  /^\/organization$/,
  /^\/account\/[A-Za-z0-9-]{1,64}\/transactions$/,
  /^\/account\/[A-Za-z0-9-]{1,64}\/transaction\/[A-Za-z0-9-]{1,64}$/,
]);

/** The query parameters a read may carry; anything else is dropped. */
const QUERY_KEYS = new Set(['limit', 'offset', 'start', 'end', 'order']);

export type MercuryErrorCode =
  | 'path_not_allowed' | 'redirect_refused' | 'unauthorized' | 'rate_limited'
  | 'timeout' | 'network_error' | 'http_error' | 'bad_json';

/** A failed read: the status and a code, never the response body. */
export class MercuryClientError extends Error {
  readonly status: number | null;
  readonly code: MercuryErrorCode;
  constructor(code: MercuryErrorCode, status: number | null = null) {
    super(`mercury_${code}${status == null ? '' : `_${status}`}`);
    this.name = 'MercuryClientError';
    this.code = code;
    this.status = status;
  }
}

export type MercuryFetch = (url: string, init: RequestInit) => Promise<Response>;

export function isReadPath(path: string): boolean {
  return READ_PATHS.some((re) => re.test(path));
}

/** One GET to an allowlisted path. The only request this file can make. */
async function read(token: string, path: string, query: Record<string, string | number> = {}, fetcher: MercuryFetch = fetch): Promise<unknown> {
  if (!isReadPath(path)) throw new MercuryClientError('path_not_allowed');
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (QUERY_KEYS.has(k)) params.set(k, String(v));
  const qs = params.toString();
  const url = `${MERCURY_API_BASE}${path}${qs ? `?${qs}` : ''}`;
  let res: Response;
  try {
    res = await withDeadline(fetcher(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }), MERCURY_DEADLINE_MS, 'mercury');
  } catch (e) {
    throw new MercuryClientError(e instanceof DeadlineExceeded ? 'timeout' : 'network_error');
  }
  // A redirect is refused, never followed: the token stays with this host.
  // A browser-style opaque redirect reports status 0; treat it the same.
  if (res.status === 0 || (res.status >= 300 && res.status < 400)) throw new MercuryClientError('redirect_refused', res.status || null);
  if (res.status === 401 || res.status === 403) throw new MercuryClientError('unauthorized', res.status);
  if (res.status === 429) throw new MercuryClientError('rate_limited', 429);
  if (!res.ok) throw new MercuryClientError('http_error', res.status);
  try { return await res.json(); } catch { throw new MercuryClientError('bad_json', res.status); }
}

/** The organization's accounts. */
export function listAccounts(token: string, fetcher?: MercuryFetch): Promise<unknown> {
  return read(token, '/accounts', {}, fetcher);
}

/** The organization itself: its id and legal name are all that is kept (`parse.ts`). */
export function getOrganization(token: string, fetcher?: MercuryFetch): Promise<unknown> {
  return read(token, '/organization', {}, fetcher);
}

/** One page of an account's transactions, oldest first, from `start` (YYYY-MM-DD). */
export function listTransactions(
  token: string,
  accountId: string,
  page: { start: string; limit: number; offset: number },
  fetcher?: MercuryFetch,
): Promise<unknown> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(accountId)) return Promise.reject(new MercuryClientError('path_not_allowed'));
  return read(token, `/account/${accountId}/transactions`, { start: page.start, limit: page.limit, offset: page.offset, order: 'asc' }, fetcher);
}

/**
 * D713 (#1778): one line of an account, by id. UNVERIFIED: the path and that
 * the body is the transaction itself (or under a `transaction` key). A 404
 * reads as `http_error` 404, so a caller can try the organization's next account.
 */
export function getTransaction(token: string, accountId: string, transactionId: string, fetcher?: MercuryFetch): Promise<unknown> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(accountId) || !/^[A-Za-z0-9-]{1,64}$/.test(transactionId)) {
    return Promise.reject(new MercuryClientError('path_not_allowed'));
  }
  return read(token, `/account/${accountId}/transaction/${transactionId}`, {}, fetcher);
}
