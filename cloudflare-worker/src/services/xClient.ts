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
const MEDIA_UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';
// X v2 has its own media-upload endpoint behind the v2 user-context too —
// the v1.1 endpoint above stays the more universally available path under
// the current developer-portal tiers.

// In-isolate circuit breaker — same shape as telegramClient.ts.
const BREAKER_THRESHOLD = 5;
const RECOVERY_MS = 60_000;
let _consecutiveFailures = 0;
let _openedAt = 0;

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

function breakerOpen(): boolean {
  if (_consecutiveFailures < BREAKER_THRESHOLD) return false;
  if (Date.now() - _openedAt > RECOVERY_MS) {
    _consecutiveFailures = BREAKER_THRESHOLD - 1;
    return false;
  }
  return true;
}
function recordSuccess() { _consecutiveFailures = 0; _openedAt = 0; }
function recordFailure() {
  _consecutiveFailures += 1;
  if (_consecutiveFailures === BREAKER_THRESHOLD) _openedAt = Date.now();
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
    : ['tweet.read', 'tweet.write', 'users.read', 'offline.access']
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
  json?: unknown;
}): Promise<T> {
  if (breakerOpen()) throw new XError('x_breaker_open', 'X API circuit breaker is open after repeated failures.');
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
    recordFailure();
    throw new XError('x_network', `X network error: ${(e as Error).message}`);
  }
  if (res.status === 429) {
    recordFailure();
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
    recordFailure();
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
  recordSuccess();
  return (await res.json()) as T;
}

export interface XCreateTweetResponse {
  data: { id: string; text: string };
}

export async function createTweet(opts: {
  accessToken: string;
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
    json: body,
  });
}

export async function deleteTweet(opts: { accessToken: string; tweetId: string }): Promise<void> {
  await authJsonCall<{ data: { deleted: boolean } }>({
    method: 'DELETE',
    url: `${API_BASE}/tweets/${encodeURIComponent(opts.tweetId)}`,
    accessToken: opts.accessToken,
  });
}

export interface XMeResponse {
  data: { id: string; name: string; username: string };
}

export async function getMe(accessToken: string): Promise<XMeResponse> {
  return authJsonCall<XMeResponse>({
    method: 'GET',
    url: `${API_BASE}/users/me`,
    accessToken,
  });
}

// ---------- Media upload (v1.1 simple upload) ----------

export interface MediaUploadResult {
  media_id_string: string;
  size: number;
}

export async function uploadMedia(opts: {
  accessToken: string;
  bytes: Uint8Array;
  mimeType: string;
}): Promise<MediaUploadResult> {
  if (breakerOpen()) throw new XError('x_breaker_open', 'X API circuit breaker is open.');
  const form = new FormData();
  form.append('media', new Blob([opts.bytes], { type: opts.mimeType }));
  form.append('media_category', opts.mimeType.startsWith('video/') ? 'tweet_video' : 'tweet_image');
  let res: Response;
  try {
    res = await fetch(MEDIA_UPLOAD_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${opts.accessToken}` },
      body: form,
    });
  } catch (e) {
    recordFailure();
    throw new XError('x_network', `X media network error: ${(e as Error).message}`);
  }
  if (res.status === 429) {
    recordFailure();
    throw new XError('rate_limited', 'X media rate-limited', { status: 429, retryAfter: parseRetryAfter(res) });
  }
  if (res.status === 401) throw new XError('x_unauthorized', 'X media upload unauthorized.', { status: 401 });
  if (res.status >= 500) {
    recordFailure();
    throw new XError('x_upstream', `X media upstream ${res.status}`, { status: res.status });
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new XError('x_media_error', `X media upload failed: ${res.status} ${t.slice(0, 200)}`, { status: res.status });
  }
  recordSuccess();
  return (await res.json()) as MediaUploadResult;
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
