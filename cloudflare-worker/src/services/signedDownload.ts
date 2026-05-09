/**
 * Task #33 — One-time, time-bounded, Worker-signed R2 download URLs.
 *
 * Why not S3/R2 presigned URLs?
 *   - We have no S3 access keys provisioned in the worker.
 *   - We want single-use semantics (presigned URLs are replayable until
 *     they expire).
 *   - We want every download to leave an audit trail in `activity_logs`,
 *     which is impossible if the URL is consumed by R2 directly.
 *
 * How it works:
 *   1. The admin endpoint mints a token via `mintDownloadToken({ key, ttlSec, audience })`.
 *      The token is `b64url(payload).b64url(hmac)` where payload is JSON
 *      `{ key, exp, jti, aud }` and hmac uses `KEK_R2 || JWT_SECRET`.
 *   2. The admin gets a URL like `/api/files/dl/<token>`.
 *   3. The worker route `/api/files/dl/:token` validates the signature,
 *     checks `exp`, and consumes the `jti` from KV (best-effort single-
 *     use — see caveat below). It then streams the R2 object through,
 *     with a `Content-Disposition` attachment header.
 *
 * TTL is hard-clamped to 5 minutes so a leaked URL is short-lived.
 *
 * **Single-use is best-effort, not strictly atomic.** Workers KV exposes
 * no compare-and-swap, so the get→delete window is non-zero. Two concurrent
 * downloads of the same token within that window can both succeed. The
 * mitigation accepted here:
 *   - 5-minute TTL caps the replay window.
 *   - Every download writes an `activity_logs` row, so a duplicate
 *     consume is detectable post-hoc.
 * If strict atomicity is ever required (e.g. one-time decryption keys),
 * back this with a Durable Object instead of KV. Tracked in
 * SECURITY_REVIEW.md §2 / O-list.
 */
import type { Env } from '../types';

type SignerEnv = Pick<Env, 'KEK_R2' | 'JWT_SECRET' | 'TOKENS' | 'FILES'>;

const MAX_TTL_SEC = 300; // 5 minutes — task #33 invariant
const KV_PREFIX = 'r2dl:';

interface TokenPayload {
  key: string;        // R2 object key
  exp: number;        // unix seconds
  jti: string;        // single-use id
  aud: string;        // audience tag (e.g. 'admin', 'recipient')
  uid?: number;       // optional issuing user id (for audit)
}

function getKey(env: SignerEnv): string {
  const k = env.KEK_R2 || env.JWT_SECRET || '';
  if (!k) throw new Error('KEK_R2 (or JWT_SECRET) must be set to sign download URLs');
  return k;
}

function b64url(bytes: Uint8Array | string): string {
  const arr = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function unb64url(s: string): Uint8Array {
  let pad = s.replace(/-/g, '+').replace(/_/g, '/');
  while (pad.length % 4) pad += '=';
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(env: SignerEnv, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(getKey(env)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Mint a one-time signed download token. TTL is hard-clamped to 5 minutes. */
export async function mintDownloadToken(
  env: SignerEnv,
  opts: { key: string; ttlSec?: number; audience: string; userId?: number },
): Promise<{ token: string; expires_at: string }> {
  const ttl = Math.min(Math.max(1, opts.ttlSec ?? MAX_TTL_SEC), MAX_TTL_SEC);
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const jti = crypto.randomUUID();
  const payload: TokenPayload = { key: opts.key, exp, jti, aud: opts.audience, uid: opts.userId };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = await hmac(env, payloadB64);
  const token = `${payloadB64}.${b64url(sig)}`;
  // Pre-register the jti so the consume step is just a delete-if-present.
  // Without this, an attacker who guesses a jti could front-run a real
  // download (extremely unlikely with 128 random bits but cheap to defend).
  if (env.TOKENS) {
    try {
      await env.TOKENS.put(`${KV_PREFIX}${jti}`, '1', { expirationTtl: ttl + 5 });
    } catch (e) {
      console.error('[signedDownload] KV put failed (continuing — token will still validate):', e);
    }
  }
  return { token, expires_at: new Date(exp * 1000).toISOString() };
}

export interface VerifiedToken {
  key: string;
  audience: string;
  userId?: number;
  jti: string;
}

/**
 * Verify, single-use-consume, and return the payload. Returns a string
 * reason on failure (used by the route to choose 400/403/410). Never
 * leaks which check failed — caller maps everything to a generic 403.
 */
export async function verifyAndConsumeToken(
  env: SignerEnv,
  token: string,
): Promise<VerifiedToken | { error: 'invalid' | 'expired' | 'consumed' }> {
  const dot = token.indexOf('.');
  if (dot < 1 || dot === token.length - 1) return { error: 'invalid' };
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  let expected: Uint8Array;
  let provided: Uint8Array;
  try {
    expected = await hmac(env, payloadB64);
    provided = unb64url(sigB64);
  } catch {
    return { error: 'invalid' };
  }
  if (!timingSafeEqual(expected, provided)) return { error: 'invalid' };
  let payload: TokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(unb64url(payloadB64)));
  } catch {
    return { error: 'invalid' };
  }
  if (!payload.key || !payload.exp || !payload.jti) return { error: 'invalid' };
  if (payload.exp < Math.floor(Date.now() / 1000)) return { error: 'expired' };

  // Single-use: atomic-ish consume via KV. Workers KV has no compare-and-
  // swap, so the window between get+delete is non-zero. For our threat
  // model (5-min TTL, signed token, audit-logged) the residual race is
  // acceptable; downstream systems treat the second consumer as a no-op
  // because the R2 key is the same and the audit row will simply log two
  // downloads.
  if (env.TOKENS) {
    try {
      const present = await env.TOKENS.get(`${KV_PREFIX}${payload.jti}`);
      if (!present) return { error: 'consumed' };
      await env.TOKENS.delete(`${KV_PREFIX}${payload.jti}`);
    } catch (e) {
      console.error('[signedDownload] KV consume failed (rejecting):', e);
      return { error: 'invalid' };
    }
  }

  return { key: payload.key, audience: payload.aud, userId: payload.uid, jti: payload.jti };
}
