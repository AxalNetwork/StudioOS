/** D1131: start removing the copies we created when a place or event is cancelled. */
import type { Env } from '../../types';
import { onAxalSessionCancelled } from './sync';

export async function cancelEventCalendarCopies(env: Env, target: { kind: 'ticket' | 'event'; id: number }): Promise<void> {
  if (target.kind === 'ticket') {
    await onAxalSessionCancelled(env, 'event_ticket', target.id);
    return;
  }
  // A ticket source id is a registration id, not an event id. Include failed
  // earlier cancellations too; never restrict this to currently active seats.
  const rows = await env.DB.prepare(
    `SELECT DISTINCT r.id FROM event_registrations r
       JOIN calendar_sync_records s ON s.source_kind = 'event_ticket' AND s.source_id = r.id
      WHERE r.event_id = ?`,
  ).bind(target.id).all<{ id: number }>();
  await Promise.all([
    onAxalSessionCancelled(env, 'event_hosted', target.id),
    ...(rows.results || []).map(r => onAxalSessionCancelled(env, 'event_ticket', r.id)),
  ]);
}
