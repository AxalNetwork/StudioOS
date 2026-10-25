/**
 * D1033 (#2874) item 2 — "Subscribe to my events": the per-member token that
 * lets a calendar client fetch the my-events `.ics` feed with no session
 * (migration 603).
 *
 * THE TOKEN IS SHOWN ONCE. `mintFeedToken` returns it, and only its SHA-256 is
 * stored, so no database read can turn back into a working URL.
 *
 * MAKING ONE REPLACES THE OLD ONE, in the same row (UNIQUE (user_id, scope)),
 * so a URL the member thinks has leaked stops working the moment they make a
 * new one, and `revokeFeedToken` stops it without a replacement.
 *
 * THE TOKEN IS A QUERY PARAMETER, NOT A PATH SEGMENT. The observability
 * middleware writes the request's pathname into `api_metrics`, Analytics Engine
 * and the activity log; a token in the path would land in all three. The query
 * string is never recorded there.
 *
 * A TOKEN DIES WITH THE ACCOUNT'S SESSIONS, by `apiKeys.verifyKey`'s rule: an
 * inactive account, one that asked to be deleted, or a "sign out everywhere"
 * (`users.jwt_min_iat`) after the token was made all refuse it. Every refusal
 * reads the same to the caller, so the answer never says whether a token exists.
 */
import type { Env, User } from '../../types';

export const FEED_SCOPE = 'my_events';

/** 32 random bytes in base64url: 43 characters, no padding. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export async function sha256Hex(value: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SQLite's `datetime('now')` text, which `CURRENT_TIMESTAMP` also writes. */
const sqlNow = (now: Date) => now.toISOString().slice(0, 19).replace('T', ' ');
/** That text, or an ISO stamp, as epoch milliseconds (UTC), or NaN. */
const sqlMs = (s: string | null) => (s ? Date.parse(`${s.replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'}`) : NaN);

export type FeedStatus = { subscribed: boolean; created_at: string | null; last_used_at: string | null };

export async function feedStatus(env: Env, userId: number): Promise<FeedStatus> {
  const row = await env.DB.prepare(
    'SELECT created_at, last_used_at FROM calendar_feed_tokens WHERE user_id = ? AND scope = ?',
  ).bind(userId, FEED_SCOPE).first<{ created_at: string; last_used_at: string | null }>();
  return { subscribed: !!row, created_at: row?.created_at ?? null, last_used_at: row?.last_used_at ?? null };
}

/** Make the member's token, replacing any older one. The token is returned once. */
export async function mintFeedToken(env: Env, userId: number, now = new Date()):
  Promise<{ token: string; created_at: string; replaced: boolean }> {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const at = sqlNow(now);
  const before = await env.DB.prepare('SELECT 1 AS x FROM calendar_feed_tokens WHERE user_id = ? AND scope = ?')
    .bind(userId, FEED_SCOPE).first();
  await env.DB.prepare(
    `INSERT INTO calendar_feed_tokens (user_id, scope, token_sha256, created_at, last_used_at)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT (user_id, scope) DO UPDATE
       SET token_sha256 = excluded.token_sha256, created_at = excluded.created_at, last_used_at = NULL`,
  ).bind(userId, FEED_SCOPE, await sha256Hex(token), at).run();
  return { token, created_at: at, replaced: !!before };
}

/** Remove the member's token. True when there was one. */
export async function revokeFeedToken(env: Env, userId: number): Promise<boolean> {
  const r = await env.DB.prepare('DELETE FROM calendar_feed_tokens WHERE user_id = ? AND scope = ?')
    .bind(userId, FEED_SCOPE).run();
  return Number(r?.meta?.changes || 0) > 0;
}

/**
 * The member a presented token names, or null. A malformed token, an unknown
 * one, and one refused by the account's state all answer null.
 */
export async function resolveFeedToken(env: Env, presented: string | null | undefined, now = new Date()):
  Promise<User | null> {
  if (!presented || !TOKEN_RE.test(presented)) return null;
  const row = await env.DB.prepare(
    'SELECT id, user_id, created_at FROM calendar_feed_tokens WHERE token_sha256 = ? AND scope = ?',
  ).bind(await sha256Hex(presented), FEED_SCOPE).first<{ id: number; user_id: number; created_at: string }>();
  if (!row) return null;
  // SELECT * as `getCurrentUser` reads it, so the investor plan columns the
  // paywall rule reads are there whichever bootstrap added them.
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(row.user_id)
    .first<User & { jwt_min_iat?: number | null; deletion_requested_at?: string | null }>();
  if (!user || !user.is_active || user.deletion_requested_at) return null;
  // "Sign out everywhere" ends every feed token made before it.
  const createdSec = Math.floor(sqlMs(row.created_at) / 1000);
  if (user.jwt_min_iat != null && !(createdSec >= Number(user.jwt_min_iat))) return null;
  await touchFeedToken(env, row.id, now);
  return user;
}

/** Record a fetch, at most once a minute per token. A failed write never refuses the feed. */
async function touchFeedToken(env: Env, id: number, now: Date): Promise<void> {
  const at = sqlNow(now);
  try {
    await env.DB.prepare(`UPDATE calendar_feed_tokens SET last_used_at = ?
      WHERE id = ? AND (last_used_at IS NULL OR datetime(last_used_at) <= datetime(?, '-60 seconds'))`).bind(at, id, at).run();
  } catch (e) {
    console.warn('[calendarFeed] last-used write failed', (e as Error)?.message);
  }
}
