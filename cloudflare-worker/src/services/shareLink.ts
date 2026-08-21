/**
 * Build queue #120 — HMAC share-link primitives.
 *
 * Extracted from the deck-sharing implementation (routes/decks.ts), which
 * is the established pattern in this codebase for a link you hand to
 * someone outside the platform. Deliberately NOT services/signedDownload.ts:
 * that one clamps TTL to 300 seconds and is single-use against a KV row,
 * which is right for an R2 object download and useless for a link emailed
 * to an investor who opens it next Tuesday.
 *
 * decks.ts keeps its own private copies of these helpers — they were not
 * refactored to import from here, because that file is on the critical
 * path for a shipped feature and a no-op refactor is pure risk. New
 * share surfaces should import from this module.
 *
 * Design notes carried over from the deck flow, all load-bearing:
 *   - The raw token is NEVER stored. The database holds a SHA-256 hex
 *     digest, so a database leak does not hand out working links.
 *   - Redemption is a SINGLE conditional UPDATE (see claimShareToken),
 *     not read-then-write, so concurrent viewers cannot over-consume a
 *     view limit.
 *   - Expired and invalid are distinguished by the caller as 410 vs 403,
 *     so a viewer can be told "this link expired" rather than a flat
 *     "forbidden" that reads like an access problem they can fix.
 */
import type { Env } from '../types';

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = pad + '='.repeat((4 - (pad.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Constant-time-ish comparison — never short-circuit on first mismatch. */
function timingEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function signingKey(env: Env): Promise<CryptoKey> {
  const secret = (env as unknown as Record<string, string>).FILE_TOKEN_SECRET || env.JWT_SECRET || '';
  if (!secret) throw new Error('FILE_TOKEN_SECRET (or JWT_SECRET) must be set');
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export interface SharePayload {
  /** Opaque scope string, e.g. `captable:<uid>:investor`. */
  k: string;
  /** Unix seconds. */
  exp: number;
  /** Optional actor label recorded at mint time. */
  a?: string;
}

export async function mintShareToken(
  env: Env, scope: string, ttlSeconds: number, actor?: string | null,
): Promise<{ token: string; expires_at: string; expires_in_seconds: number }> {
  const ttl = Math.max(1, Math.floor(ttlSeconds));
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const payload: SharePayload = { k: scope, exp };
  if (actor) payload.a = actor;
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await signingKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return {
    token: `${body}.${b64url(sig)}`,
    expires_at: new Date(exp * 1000).toISOString(),
    expires_in_seconds: ttl,
  };
}

export type VerifyFailure = { error: 'malformed' | 'bad_signature' | 'expired' };

/**
 * Verify signature and expiry. Returns a discriminated failure rather
 * than throwing, so the caller can map `expired` → 410 and everything
 * else → 403 without string-matching an exception message.
 */
export async function verifyShareToken(env: Env, token: string): Promise<SharePayload | VerifyFailure> {
  const idx = token.indexOf('.');
  if (idx <= 0) return { error: 'malformed' };
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  let payload: SharePayload;
  try {
    const key = await signingKey(env);
    const expected = b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
    if (!timingEqual(expected, sig)) return { error: 'bad_signature' };
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  } catch {
    return { error: 'malformed' };
  }
  if (!payload?.k) return { error: 'malformed' };
  if (Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) return { error: 'expired' };
  return payload;
}

export type ClaimResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'exhausted_or_expired' };

/**
 * Atomically consume one view of a share token.
 *
 * The limit and expiry checks live in the UPDATE's WHERE clause, so two
 * simultaneous viewers of a one-view link cannot both succeed: exactly
 * one statement reports `changes === 1`. A read-then-write version of
 * this has a race window wide enough to matter on a link that gets
 * forwarded to a group.
 */
export async function claimShareToken(
  env: Env, table: string, tokenHash: string,
): Promise<ClaimResult> {
  // `table` is a hardcoded literal at every call site, never user input.
  const res = await env.DB.prepare(
    `UPDATE ${table}
        SET view_count = view_count + 1,
            last_viewed_at = datetime('now'),
            used_at = CASE WHEN view_count + 1 >= view_limit THEN datetime('now') ELSE used_at END
      WHERE token_hash = ?
        AND view_count < view_limit
        AND expires_at > datetime('now')`,
  ).bind(tokenHash).run();
  if ((res as { meta?: { changes?: number } }).meta?.changes === 1) return { ok: true };
  const row = await env.DB.prepare(
    `SELECT 1 AS present FROM ${table} WHERE token_hash = ? LIMIT 1`,
  ).bind(tokenHash).first<{ present: number }>();
  // Present but unclaimable means the link was real and is now spent or
  // stale — a 410, not a 403.
  return { ok: false, reason: row ? 'exhausted_or_expired' : 'not_found' };
}

/**
 * Pseudonymous viewer fingerprint for share analytics. Keyed by the
 * app secret so the digests cannot be reversed with a rainbow table of
 * candidate IPs, and truncated because 16 hex characters is plenty to
 * distinguish viewers without retaining anything identifying.
 */
export async function hashViewerField(env: Env, value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  const secret = env.JWT_SECRET || '';
  return (await sha256Hex(`${secret}:${value}`)).slice(0, 16);
}
