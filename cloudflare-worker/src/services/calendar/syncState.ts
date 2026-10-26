/**
 * D1209 (#3175) — what a Google or Outlook sync leaves behind (migration 610).
 *
 * THE ERROR STATE. A failed sync, or a failed push from a booking's create
 * hook, writes one fixed code and its time on the member's token row
 * (`last_sync_error`, `last_sync_error_at`). The status routes return it, so
 * the failure is still on the page after a reload. Only a code is stored,
 * never the provider's text: a provider error can carry an address or a
 * title. A sync that completes with nothing refused clears it.
 *
 * THE RETAINED COPIES. A disconnect keeps the member's `calendar_sync_records`
 * unless they chose "Remove the copies first", and records which account the
 * copies belong to as an HMAC of the provider's account id. The next connect
 * keeps them for the same account and drops them for another
 * (`takeRetainedMarker`).
 *
 * Every statement is written out per provider, so no table name is ever
 * interpolated. A database without migration 610 answers "not read" rather
 * than throwing: the status routes still answer, and the hooks never break a
 * booking.
 */
import type { Env } from '../../types';

export type SyncProvider = 'google' | 'microsoft';

/** The codes, and the sentence each one shows. Nothing else is ever stored. */
export const SYNC_ERRORS = {
  connection_refused: 'The provider refused the saved connection. Reconnect to sync again.',
  copy_refused: 'Some sessions were not copied to this calendar. Sync again to retry.',
  sync_failed: 'The last sync did not complete. Try again.',
} as const;
export type SyncErrorCode = keyof typeof SYNC_ERRORS;

export type SyncErrorRead =
  | { read: true; error: { code: SyncErrorCode; message: string; at: string | null } | null }
  | { read: false; error: null };

const SET = {
  google: 'UPDATE google_oauth_tokens SET last_sync_error = ?, last_sync_error_at = ? WHERE user_id = ?',
  microsoft: 'UPDATE microsoft_oauth_tokens SET last_sync_error = ?, last_sync_error_at = ? WHERE user_id = ?',
} as const;
const CLEAR = {
  google: 'UPDATE google_oauth_tokens SET last_sync_error = NULL, last_sync_error_at = NULL WHERE user_id = ?',
  microsoft: 'UPDATE microsoft_oauth_tokens SET last_sync_error = NULL, last_sync_error_at = NULL WHERE user_id = ?',
} as const;
const CLEAR_CODE = {
  google: 'UPDATE google_oauth_tokens SET last_sync_error = NULL, last_sync_error_at = NULL WHERE user_id = ? AND last_sync_error = ?',
  microsoft: 'UPDATE microsoft_oauth_tokens SET last_sync_error = NULL, last_sync_error_at = NULL WHERE user_id = ? AND last_sync_error = ?',
} as const;
const READ = {
  google: 'SELECT last_sync_error, last_sync_error_at FROM google_oauth_tokens WHERE user_id = ?',
  microsoft: 'SELECT last_sync_error, last_sync_error_at FROM microsoft_oauth_tokens WHERE user_id = ?',
} as const;

/** Record a failure. Best-effort: a failed write is logged by provider alone. */
export async function recordSyncError(env: Env, userId: number, provider: SyncProvider, code: SyncErrorCode,
  now = new Date()): Promise<void> {
  try {
    await env.DB.prepare(SET[provider]).bind(code, now.toISOString(), userId).run();
  } catch {
    console.warn('[calendar/syncState] error write failed', { provider });
  }
}

/**
 * Clear the state after a sync that completed. With `onlyCode`, clear it only
 * when it holds that code: a create hook that refreshed the token proves the
 * connection works, not that every copy was made.
 */
export async function clearSyncError(env: Env, userId: number, provider: SyncProvider,
  onlyCode?: SyncErrorCode): Promise<void> {
  try {
    if (onlyCode) await env.DB.prepare(CLEAR_CODE[provider]).bind(userId, onlyCode).run();
    else await env.DB.prepare(CLEAR[provider]).bind(userId).run();
  } catch {
    console.warn('[calendar/syncState] error clear failed', { provider });
  }
}

/** The stored state for the status routes. `read: false` when it could not be read. */
export async function readSyncError(env: Env, userId: number, provider: SyncProvider): Promise<SyncErrorRead> {
  try {
    const row = await env.DB.prepare(READ[provider]).bind(userId)
      .first<{ last_sync_error: string | null; last_sync_error_at: string | null }>();
    const code = row?.last_sync_error;
    if (!code) return { read: true, error: null };
    // A code this build does not know still says that the sync failed.
    const known = (Object.keys(SYNC_ERRORS) as SyncErrorCode[]).includes(code as SyncErrorCode)
      ? code as SyncErrorCode : 'sync_failed';
    return { read: true, error: { code: known, message: SYNC_ERRORS[known], at: row?.last_sync_error_at ?? null } };
  } catch {
    return { read: false, error: null };
  }
}

/** Remember which account the kept copies belong to. */
export async function retainCopies(env: Env, userId: number, provider: SyncProvider, marker: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO calendar_sync_retained (user_id, provider, account_marker, retained_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (user_id, provider) DO UPDATE SET account_marker = excluded.account_marker, retained_at = excluded.retained_at`,
  ).bind(userId, provider, marker).run();
}

/** Forget it (the copies were removed, or there were none). */
export async function forgetRetained(env: Env, userId: number, provider: SyncProvider): Promise<void> {
  try {
    await env.DB.prepare('DELETE FROM calendar_sync_retained WHERE user_id = ? AND provider = ?').bind(userId, provider).run();
  } catch (e) {
    if (!/no such table/i.test(String((e as Error)?.message || e))) throw e;
  }
}

/**
 * On a connect: the marker the last disconnect kept, or null when it kept
 * none. The row is removed as it is read, so it decides one connect only.
 */
export async function takeRetainedMarker(env: Env, userId: number, provider: SyncProvider): Promise<string | null> {
  try {
    const row = await env.DB.prepare('SELECT account_marker FROM calendar_sync_retained WHERE user_id = ? AND provider = ?')
      .bind(userId, provider).first<{ account_marker: string }>();
    if (!row) return null;
    await forgetRetained(env, userId, provider);
    return row.account_marker;
  } catch (e) {
    if (/no such table/i.test(String((e as Error)?.message || e))) return null;
    throw e;
  }
}

/** HMAC-SHA256 of the provider's account id, base64url: what `calendar_sync_retained` holds. */
export async function accountMarker(secret: string, provider: SyncProvider, accountId: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`calendar-retained:${provider}:${accountId}`)));
  let s = '';
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
