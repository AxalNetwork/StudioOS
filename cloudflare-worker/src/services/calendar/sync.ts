/**
 * Task #52 — Two-way sync hooks for Axal-booked sessions.
 *
 * Sessions booked on the platform (advisor sessions, IC meetings, founder
 * check-ins) need to appear on the Axal /calendar feed AND on the user's
 * connected external calendars (Google / Outlook) within ~30 seconds.
 *
 * `onAxalSessionCreated` / `onAxalSessionUpdated` push a single
 * CalendarEvent to every connected user (organizer + attendees) and stamp
 * `calendar_sync_records` so subsequent updates PATCH the same external
 * event id. `onAxalSessionCancelled` deletes from the provider and clears
 * the sync row.
 *
 * All paths are best-effort: a provider 5xx must NEVER break the
 * underlying booking. Callers wrap with `c.executionCtx.waitUntil(...)`
 * so the booking response returns immediately and sync happens after.
 */
import type { Env } from '../../types';
import { getSQL } from '../../db';
import type { CalendarEvent } from '../calendar';
import { clearSyncError, recordSyncError } from './syncState';
import {
  loadRefreshTokenExport as loadRefreshToken,
  refreshGoogleAccessToken,
  refreshMicrosoftAccessToken,
  pushEventToGoogle,
  pushEventToMicrosoft,
  deleteEventFromGoogle,
  deleteEventFromMicrosoft,
  googleOAuthAvailable,
  microsoftOAuthAvailable,
  reencryptRefreshTokenExport as reencryptRefreshToken,
} from '../calendar';

type AxalKind = CalendarEvent['kind'];

interface SyncRow {
  user_id: number;
  provider: 'google' | 'microsoft';
  external_event_id: string;
}

/**
 * Return the set of distinct user_ids that should see this event in their
 * external calendar. For most kinds that's organizer + attendees by email.
 * We resolve emails back to users.id so each user can push to THEIR own
 * connected calendar (each user has their own google_oauth_tokens row).
 */
async function attendeeUserIds(env: Env, ev: CalendarEvent): Promise<number[]> {
  const emails = new Set<string>();
  if (ev.organizer_email) emails.add(ev.organizer_email.toLowerCase());
  for (const a of ev.attendees) if (a.email) emails.add(a.email.toLowerCase());
  if (emails.size === 0) return [];
  const placeholders = Array.from(emails).map(() => '?').join(',');
  try {
    const rows = await env.DB.prepare(
      `SELECT id FROM users WHERE LOWER(email) IN (${placeholders})`,
    ).bind(...Array.from(emails)).all<{ id: number }>();
    return (rows.results || []).map(r => r.id);
  } catch (e) {
    console.warn('[calendar/sync] attendeeUserIds failed', e);
    return [];
  }
}

async function pushOneUserOneProvider(
  env: Env, userId: number, ev: CalendarEvent,
  provider: 'google' | 'microsoft',
): Promise<void> {
  const tokTable = provider === 'google' ? 'google_oauth_tokens' : 'microsoft_oauth_tokens';
  const tok = await loadRefreshToken(env, tokTable, userId);
  if (!tok) return; // user not connected to this provider — no-op
  let accessToken: string;
  try {
    accessToken = provider === 'google'
      ? await refreshGoogleAccessToken(env, tok.raw)
      : await refreshMicrosoftAccessToken(env, tok.raw);
  } catch (e) {
    console.warn('[calendar/sync] refresh failed', { provider, user: userId });
    // D1209: the refusal stays on the status read, so a reload still shows it.
    await recordSyncError(env, userId, provider, 'connection_refused');
    return;
  }
  if (tok.wasPlaintext) await reencryptRefreshToken(env, tokTable, userId, tok.raw);
  // A refresh that worked proves the connection, not that every copy was made.
  await clearSyncError(env, userId, provider, 'connection_refused');

  const sql = getSQL(env);
  const existing = (await sql`
    SELECT external_event_id FROM calendar_sync_records
    WHERE user_id = ${userId} AND provider = ${provider}
      AND source_kind = ${ev.kind} AND source_id = ${ev.source_id}
  ` as any[])[0];
  const externalId = provider === 'google'
    ? await pushEventToGoogle(accessToken, ev, existing?.external_event_id || null)
    : await pushEventToMicrosoft(accessToken, ev, existing?.external_event_id || null);
  if (!externalId) { await recordSyncError(env, userId, provider, 'copy_refused'); return; }

  const nowIso = new Date().toISOString();
  if (existing) {
    await sql`
      UPDATE calendar_sync_records
         SET external_event_id = ${externalId}, last_synced_at = ${nowIso}
       WHERE user_id = ${userId} AND provider = ${provider}
         AND source_kind = ${ev.kind} AND source_id = ${ev.source_id}
    `;
  } else {
    try {
      await sql`
        INSERT INTO calendar_sync_records
          (user_id, provider, source_kind, source_id, external_event_id, last_synced_at)
        VALUES (${userId}, ${provider}, ${ev.kind}, ${ev.source_id}, ${externalId}, ${nowIso})
      `;
    } catch (e) {
      // race — another waitUntil already inserted; UPDATE.
      await sql`
        UPDATE calendar_sync_records
           SET external_event_id = ${externalId}, last_synced_at = ${nowIso}
         WHERE user_id = ${userId} AND provider = ${provider}
           AND source_kind = ${ev.kind} AND source_id = ${ev.source_id}
      `;
    }
  }
}

/**
 * Push an Axal session to every connected attendee's external calendar.
 * Idempotent — re-running updates the same external event via PATCH.
 */
export async function onAxalSessionCreated(env: Env, ev: CalendarEvent): Promise<void> {
  try {
    const userIds = await attendeeUserIds(env, ev);
    if (userIds.length === 0) return;
    const googleOn = googleOAuthAvailable(env);
    const msOn = microsoftOAuthAvailable(env);
    await Promise.all(userIds.flatMap(uid => [
      googleOn ? pushOneUserOneProvider(env, uid, ev, 'google') : Promise.resolve(),
      msOn    ? pushOneUserOneProvider(env, uid, ev, 'microsoft') : Promise.resolve(),
    ]));
  } catch (e) {
    console.warn('[calendar/sync] onAxalSessionCreated failed', e);
  }
}

export const onAxalSessionUpdated = onAxalSessionCreated;

/**
 * Remove an Axal session from every external calendar it was pushed to.
 * Reads `calendar_sync_records` so we only call DELETE for events we
 * actually created upstream.
 */
export async function onAxalSessionCancelled(
  env: Env, kind: AxalKind, sourceId: number,
  copy?: { userId: number; provider: 'google' | 'microsoft' },
): Promise<void> {
  try {
    const sql = getSQL(env);
    const rows = await sql`
      SELECT user_id, provider, external_event_id FROM calendar_sync_records
      WHERE source_kind = ${kind} AND source_id = ${sourceId}
        AND (${copy?.userId ?? null} IS NULL OR user_id = ${copy?.userId ?? null})
        AND (${copy?.provider ?? null} IS NULL OR provider = ${copy?.provider ?? null})
    ` as SyncRow[];
    if (!rows || rows.length === 0) return;
    // Task #52 follow-up — only DELETE the calendar_sync_records row
    // when the upstream provider DELETE actually succeeded (or the
    // upstream returned 404 — already gone). Rows where the delete
    // throws are left in place so a future retry / disconnect cleanup
    // can finish the job; otherwise a transient 5xx would permanently
    // orphan the external event with no mapping back to Axal.
    await Promise.all(rows.map(async (r) => {
      const tokTable = r.provider === 'google' ? 'google_oauth_tokens' : 'microsoft_oauth_tokens';
      const tok = await loadRefreshToken(env, tokTable, r.user_id);
      // No refresh token = user disconnected. D1209: a disconnect now keeps
      // the mappings, but this copy can no longer be reached to delete it,
      // and a mapping to a cancelled session would never be used again, so
      // it is dropped. The copy stays on the external calendar (D1209 §4).
      if (!tok) {
        await sql`
          DELETE FROM calendar_sync_records
          WHERE user_id = ${r.user_id} AND provider = ${r.provider}
            AND source_kind = ${kind} AND source_id = ${sourceId}
        `;
        return;
      }
      try {
        const accessToken = r.provider === 'google'
          ? await refreshGoogleAccessToken(env, tok.raw)
          : await refreshMicrosoftAccessToken(env, tok.raw);
        const removed = r.provider === 'google'
          ? await deleteEventFromGoogle(accessToken, r.external_event_id)
          : await deleteEventFromMicrosoft(accessToken, r.external_event_id);
        if (!removed) throw new Error('calendar_delete_failed');
        // Provider DELETE succeeded — safe to drop the mapping.
        await sql`
          DELETE FROM calendar_sync_records
          WHERE user_id = ${r.user_id} AND provider = ${r.provider}
            AND source_kind = ${kind} AND source_id = ${sourceId}
        `;
      } catch (e) {
        // Stamp the row with an error so an admin / future retry job
        // can see it failed; do NOT delete the mapping.
        console.warn('[calendar/sync] cancellation_delete_failed', { provider: r.provider });
        await recordSyncError(env, r.user_id, r.provider, 'copy_refused');
        try {
          await sql`
            UPDATE calendar_sync_records
               SET last_error = ${'calendar_delete_failed'},
                   last_synced_at = ${new Date().toISOString()}
             WHERE user_id = ${r.user_id} AND provider = ${r.provider}
               AND source_kind = ${kind} AND source_id = ${sourceId}
          `;
        } catch { /* mapping row may already be gone — the cancel is best-effort */ }
      }
    }));
  } catch (e) {
    console.warn('[calendar/sync] cancellation_cleanup_failed');
  }
}

/**
 * Push a single user's single event to their own connected calendar(s).
 * Powers the "Add to my external calendar" button on the /calendar UI for
 * events that pre-date the user's OAuth connection. Returns the set of
 * providers that successfully pushed.
 */
export async function pushOneEventForUser(
  env: Env, userId: number, ev: CalendarEvent,
): Promise<{ google: boolean; microsoft: boolean }> {
  const out = { google: false, microsoft: false };
  if (googleOAuthAvailable(env)) {
    const before = Date.now();
    await pushOneUserOneProvider(env, userId, ev, 'google');
    const sql = getSQL(env);
    const r = (await sql`
      SELECT last_synced_at FROM calendar_sync_records
      WHERE user_id = ${userId} AND provider = 'google'
        AND source_kind = ${ev.kind} AND source_id = ${ev.source_id}
    ` as any[])[0];
    if (r?.last_synced_at && new Date(r.last_synced_at).getTime() >= before) out.google = true;
  }
  if (microsoftOAuthAvailable(env)) {
    const before = Date.now();
    await pushOneUserOneProvider(env, userId, ev, 'microsoft');
    const sql = getSQL(env);
    const r = (await sql`
      SELECT last_synced_at FROM calendar_sync_records
      WHERE user_id = ${userId} AND provider = 'microsoft'
        AND source_kind = ${ev.kind} AND source_id = ${ev.source_id}
    ` as any[])[0];
    if (r?.last_synced_at && new Date(r.last_synced_at).getTime() >= before) out.microsoft = true;
  }
  return out;
}

/**
 * D1209 — "Remove the copies first": delete every copy this member's sessions
 * have on the provider, before a disconnect. A copy whose delete is confirmed
 * (or already gone) loses its mapping; a refused one keeps it, with its
 * error, as a cancellation does. `ok` is true only when none is left, and the
 * disconnect goes ahead only then.
 */
export async function removeProviderCopies(
  env: Env, userId: number, provider: 'google' | 'microsoft',
): Promise<{ ok: boolean; removed: number }> {
  const sql = getSQL(env);
  const rows = await sql`
    SELECT source_kind, source_id, external_event_id FROM calendar_sync_records
    WHERE user_id = ${userId} AND provider = ${provider}
  ` as Array<{ source_kind: string; source_id: number; external_event_id: string }>;
  if (!rows.length) return { ok: true, removed: 0 };
  const tokTable = provider === 'google' ? 'google_oauth_tokens' : 'microsoft_oauth_tokens';
  const tok = await loadRefreshToken(env, tokTable, userId);
  if (!tok) return { ok: false, removed: 0 };
  let accessToken: string;
  try {
    accessToken = provider === 'google'
      ? await refreshGoogleAccessToken(env, tok.raw)
      : await refreshMicrosoftAccessToken(env, tok.raw);
  } catch {
    await recordSyncError(env, userId, provider, 'connection_refused');
    return { ok: false, removed: 0 };
  }
  let removed = 0;
  for (const r of rows) {
    const gone = provider === 'google'
      ? await deleteEventFromGoogle(accessToken, r.external_event_id)
      : await deleteEventFromMicrosoft(accessToken, r.external_event_id);
    if (gone) {
      await sql`
        DELETE FROM calendar_sync_records
        WHERE user_id = ${userId} AND provider = ${provider}
          AND source_kind = ${r.source_kind} AND source_id = ${r.source_id}
      `;
      removed++;
    } else {
      await sql`
        UPDATE calendar_sync_records SET last_error = ${'calendar_delete_failed'}
        WHERE user_id = ${userId} AND provider = ${provider}
          AND source_kind = ${r.source_kind} AND source_id = ${r.source_id}
      `;
    }
  }
  return { ok: removed === rows.length, removed };
}
