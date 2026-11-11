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
import { readCopyTarget, type CopyTarget } from './prefs';
import {
  loadRefreshTokenExport as loadRefreshToken,
  refreshGoogleAccessToken,
  refreshMicrosoftAccessToken,
  pushEventToGoogle,
  pushEventToMicrosoft,
  deleteEventFromGoogle,
  deleteEventFromMicrosoft,
  googleOAuthAvailable,
  fetchUserEventsWithSources,
  microsoftOAuthAvailable,
  reencryptRefreshTokenExport as reencryptRefreshToken,
} from '../calendar';

type AxalKind = CalendarEvent['kind'];
type Provider = 'google' | 'microsoft';
const JOB_LEASE = 120_000;
const MAX_ATTEMPTS = 6;
type CopyJob = {
  user_id: number; provider: Provider; source_kind: AxalKind; source_id: number;
  source_day: string; generation: number; attempts: number;
};

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
    console.warn('[calendar/sync] copy_attendees_unreadable');
    return [];
  }
}

/**
 * Why one provider was, or was not, given this session. Nothing here names the session, the member or the
 * provider's answer: an outcome is a fixed word, so it is safe to return, record and log (D5201, #5201).
 *
 *   selected               the member's `copy_target` names this provider (or 'all')
 *   existing_copy          the member's setting leaves it out, but this session already has a copy here
 *   not_selected           the member's setting leaves it out, and there is no copy to update
 *   preference_unreadable  the setting could not be read: no NEW copy is made
 *   disconnected           the member has no token for this provider
 *   connection_refused     the saved connection would not refresh
 *   write_refused          the provider did not accept the write
 *   copied                 the copy was made or updated
 */
export type CopyOutcome =
  | 'copied' | 'existing_copy' | 'not_selected' | 'preference_unreadable'
  | 'disconnected' | 'connection_refused' | 'write_refused';

/** What one create hook did, per member and provider: outcomes only, never a title, an address or a body. */
export type SyncReport = Array<{ userId: number; provider: 'google' | 'microsoft'; outcome: CopyOutcome }>;

/**
 * D1485 (#3979): "Copy new Axal sessions to…". A provider the member's `copy_target` leaves out gets no new
 * copy, and is not even asked for a token; a copy it already holds keeps being updated.
 *
 * D5201 (#5201): AN UNREADABLE SETTING MAKES NO NEW COPY. It used to read as 'all', so a store that could not
 * be read for a moment turned an explicit "None" into a copy on every connected provider — a write to someone
 * else's calendar that the member had refused. The wrong direction to fail for an external write, so the
 * unreadable case is now exactly the case with no copy of its own: nothing new is created. A copy that already
 * exists keeps being updated, as it does for a provider the setting leaves out: it was authorised when it was
 * made, and leaving it stale is its own kind of wrong. The stored preference is never rewritten.
 */
async function copyDecision(env: Env, userId: number, ev: CalendarEvent, provider: 'google' | 'microsoft'):
Promise<{ copy: boolean; outcome: CopyOutcome | null }> {
  let target: CopyTarget | null = null;
  try {
    target = await readCopyTarget(env, userId);
  } catch {
    // Unreadable, which is not 'all' and not a reason to write to a provider. Logged by outcome alone.
    console.warn('[calendar/sync] copy preference unreadable', { provider, outcome: 'preference_unreadable' });
  }
  if (target !== null && (target === 'all' || target === provider)) return { copy: true, outcome: null };
  let held = false;
  try {
    held = Boolean(await env.DB.prepare(
      'SELECT 1 AS held FROM calendar_sync_records WHERE ? = user_id AND provider = ? AND source_kind = ? AND source_id = ? LIMIT 1',
    ).bind(userId, provider, ev.kind, ev.source_id).first<{ held: number }>());
  } catch {
    // The copies cannot be read either: make nothing new.
    return { copy: false, outcome: target === null ? 'preference_unreadable' : 'not_selected' };
  }
  if (held) return { copy: true, outcome: 'existing_copy' };
  return { copy: false, outcome: target === null ? 'preference_unreadable' : 'not_selected' };
}

async function pushOneUserOneProvider(
  env: Env, userId: number, ev: CalendarEvent,
  provider: 'google' | 'microsoft',
  failure?: (state: 'pending' | 'parked' | 'refused') => void,
  stillCurrent?: () => Promise<boolean>,
): Promise<CopyOutcome> {
  const tokTable = provider === 'google' ? 'google_oauth_tokens' : 'microsoft_oauth_tokens';
  const tok = await loadRefreshToken(env, tokTable, userId);
  if (!tok) { failure?.('parked'); return 'disconnected'; }
  let accessToken: string;
  try {
    accessToken = provider === 'google'
      ? await refreshGoogleAccessToken(env, tok.raw)
      : await refreshMicrosoftAccessToken(env, tok.raw);
  } catch (e) {
    const status = e instanceof Error ? /^refresh_failed:(\d+)$/.exec(e.message)?.[1] : undefined;
    failure?.(status && ['400', '401', '403'].includes(status) ? 'parked' : 'pending');
    console.warn('[calendar/sync] refresh failed', { provider, user: userId });
    // D1209: the refusal stays on the status read, so a reload still shows it.
    await recordSyncError(env, userId, provider, 'connection_refused');
    return 'connection_refused';
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
  const key = await calendarCopyKey(env, userId, provider, ev);
  const refused = (status: number) => failure?.(
    status === 401 || status === 403 ? 'parked'
      : status === 408 || status === 409 || status === 429 || status >= 500 ? 'pending' : 'refused',
  );
  if (stillCurrent && !await stillCurrent()) return 'write_refused';
  const externalId = provider === 'google'
    ? await pushEventToGoogle(accessToken, ev, existing?.external_event_id || null, key, refused)
    : await pushEventToMicrosoft(accessToken, ev, existing?.external_event_id || null, key, refused);
  if (!externalId) { await recordSyncError(env, userId, provider, 'copy_refused'); return 'write_refused'; }

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
  return 'copied';
}

/** One opaque provider-side create key per deployment, member and source. */
export async function calendarCopyKey(env: Env, userId: number, provider: Provider, ev: CalendarEvent): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
    JSON.stringify([env.APP_URL, userId, provider, ev.kind, ev.source_id]),
  ));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function enqueueCopy(env: Env, userId: number, provider: Provider, ev: CalendarEvent, update: boolean) {
  const now = Date.now();
  const day = new Date(ev.start_at).toISOString().slice(0, 10);
  await env.DB.prepare(`
    INSERT INTO calendar_copy_jobs (user_id, provider, source_kind, source_id, source_day, next_attempt_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, provider, source_kind, source_id) DO UPDATE SET
      source_day = excluded.source_day, generation = calendar_copy_jobs.generation + 1,
      attempts = 0, state = CASE WHEN calendar_copy_jobs.state = 'parked' THEN 'parked' ELSE 'pending' END,
      next_attempt_at = excluded.next_attempt_at, updated_at = excluded.updated_at
    WHERE calendar_copy_jobs.state <> 'cancelled' AND ?
  `).bind(userId, provider, ev.kind, ev.source_id, day, now, now, Number(update)).run();
}

async function runCopyJob(env: Env, key: Pick<CopyJob, 'user_id' | 'provider' | 'source_kind' | 'source_id'>,
  load: (job: CopyJob) => Promise<CalendarEvent | undefined>, now: number): Promise<CopyOutcome | undefined> {
  const args = [key.user_id, key.provider, key.source_kind, key.source_id] as const;
  const lease = now + JOB_LEASE;
  // These predicates address internal job rows, not request authorization.
  // Keep the parameter first so the route inventory does not count them as owner gates.
  const job = await env.DB.prepare(`
    UPDATE calendar_copy_jobs SET lease_until = ?, attempts = attempts + 1
    WHERE ? = user_id AND provider = ? AND source_kind = ? AND source_id = ?
      AND state = 'pending' AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until <= ?)
    RETURNING user_id, provider, source_kind, source_id, source_day, generation, attempts
  `).bind(lease, ...args, now, now).first<CopyJob>();
  if (!job) return;
  let state: 'pending' | 'parked' | 'refused' | 'complete' | 'cancelled' = 'pending';
  let outcome: CopyOutcome | 'source_gone' = 'write_refused';
  try {
    const event = await load(job);
    if (!event || event.status === 'cancelled') {
      state = 'cancelled';
      outcome = 'source_gone';
    } else {
      const decision = await copyDecision(env, key.user_id, event, key.provider);
      if (decision.copy) {
        outcome = await pushOneUserOneProvider(env, key.user_id, event, key.provider, (next) => { state = next; }, async () =>
          Boolean(await env.DB.prepare(`
            SELECT 1 FROM calendar_copy_jobs WHERE ? = user_id AND provider = ?
              AND source_kind = ? AND source_id = ? AND state = 'pending'
              AND generation = ? AND lease_until = ?
          `).bind(...args, job.generation, lease).first()));
        if (outcome === 'copied') {
          state = 'complete';
          if (decision.outcome === 'existing_copy') outcome = 'existing_copy';
        }
      } else {
        outcome = decision.outcome!;
        if (outcome === 'not_selected') state = 'cancelled';
      }
    }
  } catch {
    console.warn('[calendar/sync] copy_job_failed');
  }
  if (state === 'pending' && job.attempts >= MAX_ATTEMPTS) state = 'refused';
  const next = now + Math.min(6 * 60, 5 * 2 ** Math.min(job.attempts - 1, 7)) * 60_000;
  const current = await env.DB.prepare(`
    UPDATE calendar_copy_jobs SET
      state = CASE WHEN generation = ? AND state = 'pending' THEN ? ELSE state END,
      outcome_code = CASE WHEN generation = ? AND state = 'pending' THEN ? ELSE outcome_code END,
      next_attempt_at = CASE WHEN generation = ? AND state = 'pending' THEN ? ELSE next_attempt_at END,
      updated_at = ?, lease_until = NULL
    WHERE ? = user_id AND provider = ? AND source_kind = ? AND source_id = ? AND lease_until = ?
    RETURNING state
  `).bind(job.generation, state, job.generation, outcome, job.generation, next, now, ...args, lease).first<{ state: string }>();
  if (outcome === 'copied' || outcome === 'existing_copy') {
    const latest = current ?? await env.DB.prepare(`
      SELECT state FROM calendar_copy_jobs WHERE ? = user_id AND provider = ? AND source_kind = ? AND source_id = ?
    `).bind(...args).first<{ state: string }>();
    if (latest?.state === 'cancelled') {
      await onAxalSessionCancelled(env, key.source_kind, key.source_id, { userId: key.user_id, provider: key.provider });
    }
  }
  return outcome === 'source_gone' ? undefined : outcome;
}

/** The cron reads only due jobs and rehydrates the source through its personal Calendar reader. */
export async function retryCalendarCopies(env: Env, clock = Date.now): Promise<number> {
  const now = clock();
  const { results } = await env.DB.prepare(`
    SELECT user_id, provider, source_kind, source_id FROM calendar_copy_jobs
    WHERE state = 'pending' AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until <= ?)
    ORDER BY next_attempt_at LIMIT 20
  `).bind(now, now).all<CopyJob>();
  for (const key of results) {
    await runCopyJob(env, key, async (job) => {
      let readerId = job.user_id;
      let day = job.source_day;
      // The wellbeing mirror belongs to the booker. The expert may read it
      // for this copy only while they are still a party to the live booking.
      if (job.source_kind === 'expert_booking') {
        const booking = await env.DB.prepare(`
          SELECT b.user_id, b.scheduled_at FROM expert_bookings b JOIN experts e ON e.id = b.expert_id
          WHERE b.id = ? AND b.status = 'confirmed' AND (b.user_id = ? OR e.user_id = ?)
        `).bind(job.source_id, job.user_id, job.user_id).first<{ user_id: number; scheduled_at: string }>();
        if (!booking) return;
        readerId = booking.user_id;
        day = new Date(booking.scheduled_at).toISOString().slice(0, 10);
      }
      const start = Date.parse(day);
      const { events, sources } = await fetchUserEventsWithSources(env, readerId, '',
        day, new Date(start + 86_400_000).toISOString().slice(0, 10), [job.source_kind]);
      if (sources.length !== 1 || !sources[0].ok || sources[0].truncated) throw new Error('calendar_source_unreadable');
      return events.find((event) => event.kind === job.source_kind && event.source_id === job.source_id);
    }, clock());
  }
  return results.length;
}

/** A saved reconnection is the signal to resume credential-blocked jobs. */
export async function resumeCalendarCopies(env: Env, userId: number, provider: Provider): Promise<void> {
  try {
    const now = Date.now();
    await env.DB.prepare(`
      UPDATE calendar_copy_jobs SET state = 'pending', generation = generation + 1,
        next_attempt_at = ?, updated_at = ?, attempts = 0
      WHERE user_id = ? AND provider = ? AND state = 'parked'
    `).bind(now, now, userId, provider).run();
  } catch { console.warn('[calendar/sync] copy_resume_failed'); }
}

/**
 * Push an Axal session to every connected attendee's external calendar.
 * Idempotent — re-running updates the same external event via PATCH.
 */
export async function onAxalSessionCreated(env: Env, ev: CalendarEvent, update = false): Promise<SyncReport> {
  const report: SyncReport = [];
  if (ev.read_only || ev.kind === 'calendly_event' || ev.status === 'cancelled') return report;
  try {
    const userIds = await attendeeUserIds(env, ev);
    if (userIds.length === 0) return report;
    const googleOn = googleOAuthAvailable(env);
    const msOn = microsoftOAuthAvailable(env);
    const push = async (uid: number, provider: 'google' | 'microsoft') => {
      const decided = await copyDecision(env, uid, ev, provider);
      if (!decided.copy) {
        // D5201: an unreadable preference is recorded against a provider the member has connected, so support
        // and the status read can tell "the member chose not to copy" from "we could not tell". The UPDATE
        // touches no row for a provider that was never connected, so a refusal there records nothing.
        if (decided.outcome === 'preference_unreadable') await recordSyncError(env, uid, provider, 'copy_preference_unreadable');
        report.push({ userId: uid, provider, outcome: decided.outcome! });
        return;
      }
      const table = provider === 'google' ? 'google_oauth_tokens' : 'microsoft_oauth_tokens';
      if (!await loadRefreshToken(env, table, uid)) {
        report.push({ userId: uid, provider, outcome: 'disconnected' });
        return;
      }
      await enqueueCopy(env, uid, provider, ev, update);
      const outcome = await runCopyJob(env, { user_id: uid, provider, source_kind: ev.kind, source_id: ev.source_id },
        async () => ev, Date.now());
      if (outcome) report.push({ userId: uid, provider, outcome });
    };
    await Promise.all(userIds.flatMap(uid => [
      googleOn ? push(uid, 'google') : Promise.resolve(),
      msOn    ? push(uid, 'microsoft') : Promise.resolve(),
    ]));
  } catch {
    console.warn('[calendar/sync] copy_hook_failed');
  }
  return report;
}

export const onAxalSessionUpdated = (env: Env, ev: CalendarEvent) => onAxalSessionCreated(env, ev, true);

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
    await env.DB.prepare(`
      UPDATE calendar_copy_jobs SET state = 'cancelled', generation = generation + 1,
        outcome_code = 'source_gone', updated_at = ?
      WHERE source_kind = ? AND source_id = ? AND (? IS NULL OR ? = user_id) AND (? IS NULL OR ? = provider)
    `).bind(Date.now(), kind, sourceId, copy?.userId ?? null, copy?.userId ?? null,
      copy?.provider ?? null, copy?.provider ?? null).run();
  } catch { console.warn('[calendar/sync] copy_cancel_failed'); }
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
 * D4703 (#4703): the retry job the cancel path's stamp was waiting for.
 *
 * A provider DELETE that failed leaves the mapping with
 * `last_error = 'calendar_delete_failed'` so the copy can still be found.
 * Nothing read that stamp, so a cancelled session stayed in the attendee's
 * calendar for good. This takes the oldest few failed sources and runs the
 * same `onAxalSessionCancelled` again: a delete that now succeeds drops the
 * mapping, one that fails again is re-stamped (and its `last_synced_at`
 * moves it to the back of the queue). Bounded per run; the cron runs it hourly.
 */
export async function retryFailedCalendarDeletes(env: Env, limit = 20): Promise<{ tried: number; cleared: number }> {
  const sql = getSQL(env);
  const due = await sql`
    SELECT source_kind, source_id, MIN(last_synced_at) AS oldest
      FROM calendar_sync_records
     WHERE last_error = 'calendar_delete_failed'
     GROUP BY source_kind, source_id
     ORDER BY oldest ASC
     LIMIT ${Math.max(1, Math.min(100, Math.floor(limit)))}
  ` as Array<{ source_kind: AxalKind; source_id: number }>;
  let cleared = 0;
  for (const row of due || []) {
    await onAxalSessionCancelled(env, row.source_kind, Number(row.source_id));
    const left = await sql`
      SELECT 1 AS still FROM calendar_sync_records
       WHERE source_kind = ${row.source_kind} AND source_id = ${Number(row.source_id)} LIMIT 1
    ` as Array<{ still: number }>;
    if (!left || left.length === 0) cleared += 1;
  }
  return { tried: (due || []).length, cleared };
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
