/**
 * D5839 (#5839) — Google Search Console's read-only OAuth requests and the
 * property list, against Google's own hosts only.
 *
 * Search Console signs in through its own Google OAuth client, never the
 * Workspace or Calendar one: Google revokes a whole grant per client, so a
 * Search Console disconnect then revokes only this grant, and an existing
 * Calendar, Drive or Meet grant can never stand in for a Search Console read.
 * The consent asks for `webmasters.readonly` alone, without
 * `include_granted_scopes`, so Google returns nothing broader.
 */
export const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const SEARCH_CONSOLE_READ_SCOPES = [SEARCH_CONSOLE_SCOPE] as const;
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const SITES = 'https://www.googleapis.com/webmasters/v3/sites';

/** The levels that can read Search Console data. `siteUnverifiedUser` cannot. */
export const USABLE_PERMISSION_LEVELS = ['siteOwner', 'siteFullUser', 'siteRestrictedUser'] as const;
export type UsablePermissionLevel = typeof USABLE_PERMISSION_LEVELS[number];

export interface SearchConsoleApp { id: string; secret: string }

export interface SearchConsoleTokens {
  access_token: string;
  /** Google returns one on a first consent with `access_type=offline`; a refresh returns none. */
  refresh_token: string | null;
  expires_in: number;
  scope: string;
}

export interface SearchConsoleSite { site_url: string; permission_level: string; usable: boolean }

/** A Google answer this module refuses to read past. `status` is Google's, 0 for a malformed body. */
export class SearchConsoleError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 0) { super(code); this.code = code; this.status = status; }
}

/**
 * A property identifier exactly as Google writes it: a domain property
 * (`sc-domain:example.com`) or a URL-prefix property (`https://example.com/`).
 * Nothing is normalised, so the stored id is the one Google returned.
 */
export function isPropertyId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || value !== value.trim()) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith('sc-domain:')) return /^sc-domain:[a-z0-9.-]+\.[a-z0-9-]+$/i.test(value);
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && value.endsWith('/') && url.href === value;
  } catch { return false; }
}

export const isUsable = (level: unknown): level is UsablePermissionLevel =>
  typeof level === 'string' && (USABLE_PERMISSION_LEVELS as readonly string[]).includes(level);

async function tokenPost(app: SearchConsoleApp, fields: Record<string, string>, refused: string): Promise<SearchConsoleTokens> {
  const response = await fetch(TOKEN, {
    method: 'POST',
    body: new URLSearchParams({ ...fields, client_id: app.id, client_secret: app.secret }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new SearchConsoleError(response.status === 400 ? refused : 'search_console_token_failed', response.status);
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!data || typeof data.access_token !== 'string' || !data.access_token ||
      typeof data.scope !== 'string' || !data.scope ||
      typeof data.expires_in !== 'number' || !Number.isSafeInteger(data.expires_in) || data.expires_in <= 0 ||
      (data.refresh_token !== undefined && (typeof data.refresh_token !== 'string' || !data.refresh_token))) {
    throw new SearchConsoleError('search_console_token_invalid');
  }
  return {
    access_token: data.access_token,
    refresh_token: (data.refresh_token as string | undefined) ?? null,
    expires_in: data.expires_in,
    scope: data.scope,
  };
}

export function exchangeSearchConsoleCode(app: SearchConsoleApp, code: string, redirectUri: string) {
  return tokenPost(app, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }, 'search_console_code_refused');
}

export function refreshSearchConsoleToken(app: SearchConsoleApp, refreshToken: string) {
  return tokenPost(app, { grant_type: 'refresh_token', refresh_token: refreshToken }, 'search_console_grant_revoked');
}

/** Revoking either token revokes this client's whole grant, and only this client's (D5839). */
export async function revokeSearchConsoleToken(token: string): Promise<void> {
  const response = await fetch(REVOKE, {
    method: 'POST',
    body: new URLSearchParams({ token }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  // 400 `invalid_token`: the grant is already gone, which is what a revoke asks for.
  if (!response.ok && response.status !== 400) throw new SearchConsoleError('search_console_revoke_failed', response.status);
}

export function searchConsoleAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    scope: SEARCH_CONSOLE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
  }).toString();
  return url.toString();
}

async function sitesGet(accessToken: string, path: string): Promise<unknown> {
  const response = await fetch(`${SITES}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401) throw new SearchConsoleError('search_console_grant_revoked', 401);
  if (response.status === 403 || response.status === 404) throw new SearchConsoleError('property_not_accessible', response.status);
  if (!response.ok) throw new SearchConsoleError('search_console_unreachable', response.status);
  return response.json().catch(() => { throw new SearchConsoleError('search_console_malformed'); });
}

function siteOf(entry: unknown): SearchConsoleSite | null {
  const e = entry as { siteUrl?: unknown; permissionLevel?: unknown } | null;
  if (!e || !isPropertyId(e.siteUrl) || typeof e.permissionLevel !== 'string') return null;
  return { site_url: e.siteUrl, permission_level: e.permissionLevel, usable: isUsable(e.permissionLevel) };
}

/** `sites.list`: every property the signed-in Google principal can see, unusable ones marked. */
export async function listSearchConsoleSites(accessToken: string): Promise<SearchConsoleSite[]> {
  const data = await sitesGet(accessToken, '') as { siteEntry?: unknown } | null;
  if (!data || typeof data !== 'object') throw new SearchConsoleError('search_console_malformed');
  if (data.siteEntry === undefined) return [];
  if (!Array.isArray(data.siteEntry)) throw new SearchConsoleError('search_console_malformed');
  return data.siteEntry.map(siteOf).filter((s): s is SearchConsoleSite => s !== null);
}

/** `sites.get` on the exact identifier: the principal's level on that one property now. */
export async function getSearchConsoleSite(accessToken: string, siteUrl: string): Promise<SearchConsoleSite> {
  if (!isPropertyId(siteUrl)) throw new SearchConsoleError('property_malformed');
  const site = siteOf(await sitesGet(accessToken, `/${encodeURIComponent(siteUrl)}`));
  if (!site) throw new SearchConsoleError('search_console_malformed');
  if (site.site_url !== siteUrl) throw new SearchConsoleError('property_mismatch');
  return site;
}
