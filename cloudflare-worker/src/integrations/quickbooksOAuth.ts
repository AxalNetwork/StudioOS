/**
 * D5834 part 2 (#5834) — Intuit's OAuth 2.0 requests for QuickBooks Online,
 * against Intuit's documented hosts only: the authorize page, the token
 * endpoint and the revoke endpoint. Report reads stay in
 * `services/financialStatements/quickbooksClient.ts`.
 *
 * The one scope is `com.intuit.quickbooks.accounting`. Intuit has no
 * report-only scope, so the server-side allowlist of D5834 §1 is the limit.
 * The token answer carries no `scope`; the granted set is the requested one.
 *
 * Intuit rotates the refresh token: a refresh may answer a new one, and the
 * old one stops working once the new one is used. A refresh that answers none
 * keeps the old one. The client id and secret go in an HTTP Basic header,
 * never in a URL.
 */
export const QUICKBOOKS_SCOPES = ['com.intuit.quickbooks.accounting'] as const;

export const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
export const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
export const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

export interface QuickBooksApp { id: string; secret: string }
export interface QuickBooksTokens { access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number | null }

/** An Intuit answer this module refuses to read past. `status` is Intuit's, 0 for a malformed body. */
export class QuickBooksAuthError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 0) { super(code); this.code = code; this.status = status; }
}

const basic = (app: QuickBooksApp) => `Basic ${btoa(`${app.id}:${app.secret}`)}`;

export function quickbooksAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: QUICKBOOKS_SCOPES.join(' '),
    redirect_uri: redirectUri,
    state,
  }).toString();
  return url.toString();
}

const positive = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

async function tokenPost(f: typeof fetch, app: QuickBooksApp, fields: Record<string, string>, refused: string): Promise<QuickBooksTokens> {
  const response = await f(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basic(app), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(fields),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new QuickBooksAuthError(response.status === 400 || response.status === 401 ? refused : 'quickbooks_token_failed', response.status);
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!data || typeof data.access_token !== 'string' || !data.access_token || !positive(data.expires_in) ||
      typeof data.refresh_token !== 'string' || !data.refresh_token ||
      (data.x_refresh_token_expires_in !== undefined && !positive(data.x_refresh_token_expires_in))) {
    throw new QuickBooksAuthError('quickbooks_token_invalid');
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in as number,
    refresh_expires_in: (data.x_refresh_token_expires_in as number | undefined) ?? null,
  };
}

export function exchangeQuickBooksCode(f: typeof fetch, app: QuickBooksApp, code: string, redirectUri: string) {
  return tokenPost(f, app, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }, 'quickbooks_code_refused');
}

export function refreshQuickBooksToken(f: typeof fetch, app: QuickBooksApp, refreshToken: string) {
  return tokenPost(f, app, { grant_type: 'refresh_token', refresh_token: refreshToken }, 'quickbooks_grant_revoked');
}

/**
 * Revoke the grant at Intuit. Revoking the refresh token ends the whole grant.
 * A 400 means Intuit no longer knows the token (already revoked or expired),
 * which is the end this asks for, so it counts as revoked.
 */
export async function revokeQuickBooksToken(f: typeof fetch, app: QuickBooksApp, token: string): Promise<void> {
  const response = await f(REVOKE_URL, {
    method: 'POST',
    headers: { Authorization: basic(app), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ token }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok || response.status === 400) return;
  throw new QuickBooksAuthError('quickbooks_revoke_failed', response.status);
}
