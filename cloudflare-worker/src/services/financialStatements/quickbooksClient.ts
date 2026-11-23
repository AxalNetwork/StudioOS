/**
 * D5834 (#5834): the only way the Worker reads from QuickBooks Online. It can
 * fetch two reports for one company and nothing else.
 *
 * Intuit's `com.intuit.quickbooks.accounting` scope reads and writes the whole
 * ledger, and Intuit offers no report-only scope (D5832 §2). So the limit is
 * enforced here, on the server:
 *   · only `reports/ProfitAndLoss` and `reports/BalanceSheet` (`REPORT_PATHS`);
 *   · GET only, with no request body;
 *   · only the realm the connection is bound to, which the caller cannot
 *     choose;
 *   · sandbox and production on their own hosts, chosen by the connection,
 *     never by the request.
 * No transaction, invoice, payment, payroll or query endpoint can be named.
 *
 * Pure apart from the injected `fetch`. A failure carries a code and, for
 * 429, the wait in seconds. It never carries the response body, because a
 * statement or an identifier must not reach an operator log.
 */
import type { Basis, Period, Report } from './contract';

export const HOSTS = Object.freeze({
  sandbox: 'https://sandbox-quickbooks.api.intuit.com',
  production: 'https://quickbooks.api.intuit.com',
});
export type QuickBooksEnvironment = keyof typeof HOSTS;

/** The allowlist: the report path each statement may read, and nothing else. */
export const REPORT_PATHS: Readonly<Record<Report, string>> = Object.freeze({
  profit_and_loss: 'reports/ProfitAndLoss',
  balance_sheet: 'reports/BalanceSheet',
});

/** Intuit's API minor version these reports are read at. */
export const MINOR_VERSION = '75';
/** A larger response is refused unread; a pilot venture's two reports are a few tens of kilobytes. */
export const MAX_REPORT_BYTES = 2_000_000;

export class QuickBooksFailure extends Error {
  code: string;
  retry_after_s: number | null;
  constructor(code: string, retryAfter: number | null = null) { super(code); this.code = code; this.retry_after_s = retryAfter; }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (d: unknown): d is string => typeof d === 'string' && DATE.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
/** A realm id is Intuit's numeric company id. */
export const isRealmId = (v: unknown): v is string => typeof v === 'string' && /^\d{1,20}$/.test(v);

/**
 * The request URL for one allowed report. A P&L needs a `{start, end}` period;
 * a balance sheet needs `{as_of}`. A basis of `unknown` leaves the company's own
 * default in force, and the report's header then says which it used.
 */
export function reportUrl(environment: QuickBooksEnvironment, realmId: string, report: Report, period: Period, basis: Basis): string {
  const host = Object.prototype.hasOwnProperty.call(HOSTS, environment) ? HOSTS[environment] : null;
  if (!host) throw new QuickBooksFailure('environment_invalid');
  if (!isRealmId(realmId)) throw new QuickBooksFailure('realm_invalid');
  const path = Object.prototype.hasOwnProperty.call(REPORT_PATHS, report) ? REPORT_PATHS[report] : null;
  if (!path) throw new QuickBooksFailure('report_not_allowed');
  const q = new URLSearchParams();
  if (report === 'profit_and_loss') {
    const p = period as { start?: unknown; end?: unknown };
    if (!realDate(p?.start) || !realDate(p?.end) || p.start > p.end) throw new QuickBooksFailure('period_invalid');
    q.set('start_date', p.start); q.set('end_date', p.end);
  } else {
    const p = period as { as_of?: unknown };
    if (!realDate(p?.as_of)) throw new QuickBooksFailure('period_invalid');
    q.set('start_date', p.as_of); q.set('end_date', p.as_of);
  }
  if (basis === 'cash') q.set('accounting_method', 'Cash');
  else if (basis === 'accrual') q.set('accounting_method', 'Accrual');
  else if (basis !== 'unknown') throw new QuickBooksFailure('basis_invalid');
  q.set('minorversion', MINOR_VERSION);
  return `${host}/v3/company/${realmId}/${path}?${q}`;
}

const retryAfter = (h: string | null) => {
  if (h == null || !/^\s*\d+(\.\d+)?\s*$/.test(h)) return null;
  const n = Number(h);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.ceil(n), 3600) : null;
};

export type ClientDeps = { fetch: typeof fetch; accessToken: string; environment: QuickBooksEnvironment };

/** One allowed report, parsed. Refuses on any status but 200, on a fault body, or on a body over the limit. */
export async function fetchReport(deps: ClientDeps, realmId: string, report: Report, period: Period, basis: Basis): Promise<any> {
  const url = reportUrl(deps.environment, realmId, report, period, basis);
  if (typeof deps.accessToken !== 'string' || !deps.accessToken) throw new QuickBooksFailure('quickbooks_unauthorized');
  let res: Response;
  try {
    res = await deps.fetch(url, { method: 'GET', redirect: 'error', headers: { Accept: 'application/json', Authorization: `Bearer ${deps.accessToken}` } });
  } catch {
    throw new QuickBooksFailure('quickbooks_unreachable');
  }
  if (res.status === 401) throw new QuickBooksFailure('quickbooks_unauthorized');
  if (res.status === 403) throw new QuickBooksFailure('quickbooks_scope_denied');
  if (res.status === 429) throw new QuickBooksFailure('quickbooks_rate_limited', retryAfter(res.headers.get('Retry-After')));
  if (res.status >= 500) throw new QuickBooksFailure('quickbooks_unavailable', retryAfter(res.headers.get('Retry-After')));
  if (res.status !== 200) throw new QuickBooksFailure('quickbooks_refused');
  const declared = Number(res.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_REPORT_BYTES) throw new QuickBooksFailure('report_too_large');
  const text = await res.text();
  if (new TextEncoder().encode(text).length > MAX_REPORT_BYTES) throw new QuickBooksFailure('report_too_large');
  let body: any;
  try { body = JSON.parse(text); } catch { throw new QuickBooksFailure('report_invalid'); }
  if (body && typeof body === 'object' && body.Fault) throw new QuickBooksFailure('quickbooks_fault');
  return body;
}
