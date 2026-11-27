import type { Env } from '../types';

/**
 * D630 (#1388) — every deal-room write records its actor in `activity_logs`.
 *
 * Joining or leaving a room, recording a transfer, writing a reference check,
 * inviting investors and closing a syndicate are not all admin actions, so
 * they do not go through `logAdminAction` (which also writes the admin audit
 * log). This is the same `activity_logs` row shape, with the deal it was
 * about in `entity_type` / `entity_id`.
 *
 * A failed audit write never undoes the action it describes: the action has
 * already happened, and the warning names it.
 */
export async function logDealRoomAction(
  env: Env,
  user: { id: number },
  action: string,
  entityId: number | null,
  details: Record<string, unknown> = {},
  entityType = 'deal',
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, user_id, entity_type, entity_id) VALUES (?, ?, ?, ?, ?)`,
    ).bind(action, JSON.stringify(details), user.id, entityType, entityId != null ? String(entityId) : null).run();
  } catch (e) {
    console.warn('[dealRoomAudit] activity_logs write failed', action, (e as Error).message);
  }
}
