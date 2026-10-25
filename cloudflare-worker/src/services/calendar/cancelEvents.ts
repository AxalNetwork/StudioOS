/** D1131: bounded immediate cleanup, with durable continuation and retry. */
import type { Env } from '../../types';
import { enqueueJob } from '../queue';
import { onAxalSessionCancelled } from './sync';

type Target = { kind: 'ticket' | 'event'; id: number };
type Copy = { id: number; user_id: number; provider: 'google' | 'microsoft'; source_kind: 'event_ticket' | 'event_hosted'; source_id: number };
const BATCH = 5;

/** Recheck source state on delivery: a newly registered seat must keep its copy. */
async function copies(env: Env, target: Target, after: number, limit: number, exact: number | null = null): Promise<Copy[]> {
  const rows = await env.DB.prepare(
    `SELECT s.id, s.user_id, s.provider, s.source_kind, s.source_id
       FROM calendar_sync_records s
       LEFT JOIN event_registrations r ON s.source_kind = 'event_ticket' AND r.id = s.source_id
       LEFT JOIN events e ON e.id = CASE WHEN s.source_kind = 'event_hosted' THEN s.source_id ELSE r.event_id END
      WHERE s.id > ? AND (? IS NULL OR s.id = ?)
        AND ((? = 'ticket' AND s.source_kind = 'event_ticket' AND r.id = ?)
          OR (? = 'event' AND e.id = ? AND s.source_kind IN ('event_ticket','event_hosted')))
        AND (e.status = 'cancelled' OR (s.source_kind = 'event_ticket' AND r.status = 'cancelled'))
      ORDER BY s.id LIMIT ?`,
  ).bind(after, exact, exact, target.kind, target.id, target.kind, target.id, limit).all<Copy>();
  return rows.results || [];
}
async function enqueue(env: Env, payload: Target & { after?: number; mapping_id?: number }): Promise<void> {
  try { await enqueueJob(env, 'event_calendar_cleanup', payload, { max_retries: 5 }); }
  catch { throw new Error('calendar_cleanup_enqueue_failed'); }
}
async function remove(env: Env, row: Copy): Promise<void> {
  await onAxalSessionCancelled(env, row.source_kind, row.source_id, { userId: row.user_id, provider: row.provider });
}

export async function cancelEventCalendarCopies(env: Env, target: Target): Promise<void> {
  // Persist continuation before provider work, so waitUntil expiry cannot lose it.
  try { await enqueue(env, { ...target, after: 0 }); }
  catch { console.warn('[events/calendar] cancellation_enqueue_failed'); }
  // At most two concurrent refresh/delete chains in the cancellation request.
  await Promise.all((await copies(env, target, 0, 2)).map(row => remove(env, row)));
}

/** Existing CF/D1 queue transport owns retries and dead-letter handling. */
export async function runEventCalendarCleanup(env: Env, payload: any): Promise<void> {
  if (!['ticket', 'event'].includes(payload?.kind) || !Number.isSafeInteger(payload?.id) || payload.id <= 0)
    throw new Error('calendar_cleanup_payload_invalid');
  const target: Target = { kind: payload.kind, id: payload.id };
  if (payload.mapping_id !== undefined) {
    if (!Number.isSafeInteger(payload.mapping_id) || payload.mapping_id <= 0) throw new Error('calendar_cleanup_payload_invalid');
    const row = (await copies(env, target, 0, 1, payload.mapping_id))[0];
    if (!row) return; // Already removed, or the source is active again.
    await remove(env, row);
    if ((await copies(env, target, 0, 1, row.id)).length) throw new Error('calendar_delete_failed');
    return;
  }
  const after = payload.after ?? 0;
  if (!Number.isSafeInteger(after) || after < 0) throw new Error('calendar_cleanup_payload_invalid');
  const rows = await copies(env, target, after, BATCH + 1);
  // A scan job only dispatches bounded work; each provider job handles one copy.
  // Failed deletions retry independently and cannot block later attendees.
  for (const row of rows.slice(0, BATCH)) await enqueue(env, { ...target, mapping_id: row.id });
  if (rows.length > BATCH) await enqueue(env, { ...target, after: rows[BATCH - 1].id });
}
