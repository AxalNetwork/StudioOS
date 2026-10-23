/**
 * Task #4 — X (Twitter) API v2 client.
 *
 * Covers the surface we use:
 *   - OAuth 2.0 PKCE authorise URL + token-exchange + refresh helpers
 *   - POST /2/tweets   (incl. reply.in_reply_to_tweet_id for threads)
 *   - DELETE /2/tweets/:id (retract)
 *   - POST /2/media/upload  (simple-upload, single-shot — ≤5MB images)
 *   - GET  /2/users/me  (account verification)
 *
 * Rate-limit handling: X returns `x-rate-limit-remaining` + `x-rate-limit-reset`
 * (unix epoch seconds) on every successful call, and a 429 with the same
 * headers when exhausted. We surface 429s as the typed XError code
 * `rate_limited` carrying `retry_after`, NEVER a silent 500.
 *
 * Token encryption: callers pass plaintext tokens (we never persist them).
 * Persistence lives in routes/admin_x.ts which wraps cryptoBox around the
 * `access_token_ct` / `refresh_token_ct` columns.
 */
import type { Env } from '../types';

const AUTH_BASE = 'https://twitter.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const API_BASE = 'https://api.twitter.com/2';
const MEDIA_UPLOAD_URL = 'https://api.x.com/2/media/upload';

// In-isolate circuit breakers are isolated by the account whose token is in use.
const BREAKER_THRESHOLD = 5;
const RECOVERY_MS = 60_000;
const breakers = new Map<string, { consecutiveFailures: number; openedAt: number }>();

export class XError extends Error {
  code: string;
  status?: number;
  retryAfter?: number;
  constructor(code: string, message: string, opts: { status?: number; retryAfter?: number } = {}) {
    super(message);
    this.name = 'XError';
    this.code = code;
    this.status = opts.status;
    this.retryAfter = opts.retryAfter;
  }
}

export class XConfigMissing extends XError {
  constructor() {
    super('x_config_missing', 'X_CLIENT_ID / X_CLIENT_SECRET not configured.');
  }
}

/**
 * Whether this deployment can speak OAuth to X at all: both halves of the
 * client credential are set. The accounts console, the OAuth start and HQ
 * Platform's Broadcast console all ask this, so they cannot disagree about
 * whether X is provisioned (D202). Neither value is ever returned.
 */
export function xClientConfigured(env: Env): boolean {
  return !!(env.X_CLIENT_ID && env.X_CLIENT_SECRET);
}

function breakerState(accountId: string | number) {
  const key = String(accountId);
  let state = breakers.get(key);
  if (!state) {
    state = { consecutiveFailures: 0, openedAt: 0 };
    breakers.set(key, state);
  }
  return state;
}
function breakerOpen(accountId: string | number): boolean {
  const state = breakerState(accountId);
  if (state.consecutiveFailures < BREAKER_THRESHOLD) return false;
  if (Date.now() - state.openedAt > RECOVERY_MS) {
    state.consecutiveFailures = BREAKER_THRESHOLD - 1;
    state.openedAt = 0;
    return false;
  }
  return true;
}
function recordSuccess(accountId: string | number) {
  const state = breakerState(accountId);
  state.consecutiveFailures = 0;
  state.openedAt = 0;
}
function recordFailure(accountId: string | number) {
  const state = breakerState(accountId);
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures === BREAKER_THRESHOLD) state.openedAt = Date.now();
}

// ---------- PKCE helpers ----------

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generatePkcePair(): { verifier: string; challenge: Promise<string> } {
  // Verifier: 43-128 chars from [A-Z a-z 0-9 - . _ ~]. Use 32 random bytes
  // -> 43-char b64url string, well within range.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = b64url(bytes);
  const challenge = (async () => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return b64url(new Uint8Array(buf));
  })();
  return { verifier, challenge };
}

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: string[];
}): string {
  const scope = (opts.scopes && opts.scopes.length
    ? opts.scopes
    : ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access']
  ).join(' ');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

// ---------- OAuth token exchange / refresh ----------

export interface XTokenResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
  refresh_token?: string;
  scope: string;
}

function basicAuth(clientId: string, clientSecret: string): string {
  return 'Basic ' + btoa(`${clientId}:${clientSecret}`);
}

export async function exchangeCodeForToken(env: Env, opts: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<XTokenResponse> {
  const clientId = env.X_CLIENT_ID;
  const clientSecret = env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new XConfigMissing();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
    client_id: clientId,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(clientId, clientSecret),
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new XError('x_oauth_exchange_failed', `Token exchange failed: ${res.status} ${t.slice(0, 200)}`, {
      status: res.status,
    });
  }
  return (await res.json()) as XTokenResponse;
}

export async function refreshAccessToken(env: Env, refreshToken: string): Promise<XTokenResponse> {
  const clientId = env.X_CLIENT_ID;
  const clientSecret = env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new XConfigMissing();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(clientId, clientSecret),
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new XError('x_oauth_refresh_failed', `Token refresh failed: ${res.status} ${t.slice(0, 200)}`, {
      status: res.status,
    });
  }
  return (await res.json()) as XTokenResponse;
}

// ---------- Authenticated API helpers ----------

function parseRetryAfter(res: Response): number {
  // Prefer the explicit `retry-after` header (seconds); fall back to the
  // X-specific `x-rate-limit-reset` (epoch seconds).
  const ra = res.headers.get('retry-after');
  if (ra && /^\d+$/.test(ra)) return Number(ra);
  const reset = res.headers.get('x-rate-limit-reset');
  if (reset && /^\d+$/.test(reset)) {
    const secs = Number(reset) - Math.floor(Date.now() / 1000);
    return Math.max(1, secs);
  }
  return 60;
}

async function authJsonCall<T>(opts: {
  method: 'GET' | 'POST' | 'DELETE';
  url: string;
  accessToken: string;
  accountId: string | number;
  json?: unknown;
}): Promise<T> {
  if (breakerOpen(opts.accountId)) throw new XError('x_breaker_open', 'X API circuit breaker is open after repeated failures.');
  let res: Response;
  try {
    res = await fetch(opts.url, {
      method: opts.method,
      headers: {
        authorization: `Bearer ${opts.accessToken}`,
        ...(opts.json ? { 'content-type': 'application/json' } : {}),
      },
      body: opts.json ? JSON.stringify(opts.json) : undefined,
    });
  } catch (e) {
    recordFailure(opts.accountId);
    throw new XError('x_network', `X network error: ${(e as Error).message}`);
  }
  if (res.status === 429) {
    recordFailure(opts.accountId);
    const retryAfter = parseRetryAfter(res);
    throw new XError('rate_limited', `X rate-limited; retry in ${retryAfter}s`, {
      status: 429,
      retryAfter,
    });
  }
  if (res.status === 401) {
    // Deterministic — don't trip the breaker (token may just need refresh).
    throw new XError('x_unauthorized', 'X access token unauthorized (refresh needed).', { status: 401 });
  }
  if (res.status >= 500) {
    recordFailure(opts.accountId);
    throw new XError('x_upstream', `X upstream ${res.status}`, { status: res.status });
  }
  if (!res.ok) {
    // 4xx other than 401/429: content / validation problem — caller error.
    const t = await res.text().catch(() => '');
    let code = 'x_api_error';
    if (/duplicate/i.test(t)) code = 'x_duplicate_content';
    else if (/forbidden/i.test(t)) code = 'x_forbidden';
    throw new XError(code, `X ${res.status}: ${t.slice(0, 200)}`, { status: res.status });
  }
  recordSuccess(opts.accountId);
  return (await res.json()) as T;
}

export interface XCreateTweetResponse {
  data: { id: string; text: string };
}

export async function createTweet(opts: {
  accessToken: string;
  accountId: string | number;
  text: string;
  inReplyToTweetId?: string;
  mediaIds?: string[];
}): Promise<XCreateTweetResponse> {
  const body: Record<string, unknown> = { text: opts.text };
  if (opts.inReplyToTweetId) body.reply = { in_reply_to_tweet_id: opts.inReplyToTweetId };
  if (opts.mediaIds && opts.mediaIds.length) body.media = { media_ids: opts.mediaIds };
  return authJsonCall<XCreateTweetResponse>({
    method: 'POST',
    url: `${API_BASE}/tweets`,
    accessToken: opts.accessToken,
    accountId: opts.accountId,
    json: body,
  });
}

export async function deleteTweet(opts: { accessToken: string; accountId: string | number; tweetId: string }): Promise<void> {
  await authJsonCall<{ data: { deleted: boolean } }>({
    method: 'DELETE',
    url: `${API_BASE}/tweets/${encodeURIComponent(opts.tweetId)}`,
    accessToken: opts.accessToken,
    accountId: opts.accountId,
  });
}

export interface XMeResponse {
  data: { id: string; name: string; username: string };
}

export async function getMe(accessToken: string, accountId: string | number): Promise<XMeResponse> {
  return authJsonCall<XMeResponse>({
    method: 'GET',
    url: `${API_BASE}/users/me`,
    accessToken,
    accountId,
  });
}

// ---------- Media upload (v2 simple upload) ----------

export interface MediaUploadResult {
  media_id_string: string;
  size: number;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function uploadMedia(opts: {
  accessToken: string;
  accountId: string | number;
  bytes: Uint8Array;
}): Promise<MediaUploadResult> {
  if (breakerOpen(opts.accountId)) throw new XError('x_breaker_open', 'X API circuit breaker is open.');
  let res: Response;
  try {
    res = await fetch(MEDIA_UPLOAD_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${opts.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ media: base64(opts.bytes), media_category: 'tweet_image' }),
    });
  } catch (e) {
    recordFailure(opts.accountId);
    throw new XError('x_network', `X media network error: ${(e as Error).message}`);
  }
  if (res.status === 429) {
    recordFailure(opts.accountId);
    throw new XError('rate_limited', 'X media rate-limited', { status: 429, retryAfter: parseRetryAfter(res) });
  }
  if (res.status === 401) throw new XError('x_unauthorized', 'X media upload unauthorized.', { status: 401 });
  if (res.status >= 500) {
    recordFailure(opts.accountId);
    throw new XError('x_upstream', `X media upstream ${res.status}`, { status: res.status });
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new XError('x_media_error', `X media upload failed: ${res.status} ${t.slice(0, 200)}`, { status: res.status });
  }
  recordSuccess(opts.accountId);
  const body = await res.json() as { data?: { id?: string; size?: number }; media_id_string?: string; size?: number };
  const mediaId = body.data?.id ?? body.media_id_string;
  if (!mediaId) throw new XError('x_media_error', 'X media upload response did not include a media id.');
  return { media_id_string: mediaId, size: Number(body.data?.size ?? body.size ?? opts.bytes.length) };
}

// ---------- Char counting ----------

/**
 * X counts most code-points as 1, with emoji and CJK weighted differently.
 * The exact "weighted" length needs the public twitter-text library; we
 * use a conservative code-point count which is always ≥ the weighted count,
 * so 280 here will never undercount the real X limit.
 */
export function tweetLength(text: string): number {
  // Count by code-points, not UTF-16 units, so 4-byte emoji aren't double-counted.
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/**
 * Split a long body into ≤280-char tweets, breaking on whitespace where
 * possible. Appends ` (n/N)` index markers when more than one tweet is
 * produced. Hashtags should already be appended to the source body before
 * calling this.
 */
export function splitIntoThread(body: string, maxLen = 280): string[] {
  const trimmed = body.trim();
  if (tweetLength(trimmed) <= maxLen) return [trimmed];
  const words = trimmed.split(/\s+/);
  const chunks: string[] = [];
  let current = '';
  for (const w of words) {
    if (!current) { current = w; continue; }
    // Reserve 8 chars for ` (NN/NN)` suffix worst case.
    const candidate = `${current} ${w}`;
    if (tweetLength(candidate) > maxLen - 8) {
      chunks.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  const total = chunks.length;
  return chunks.map((c, i) => `${c} (${i + 1}/${total})`);
}
