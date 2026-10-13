/**
 * D684 — every webhook event once.
 *
 * `claimEvent` is the idempotency boundary for all four providers: an
 * `INSERT OR IGNORE` on UNIQUE(provider, external_event_id). The first delivery
 * gets the row id and does the work; a retry gets null and must answer 200 and
 * do nothing. If the work fails BEFORE anything was stored, `releaseEvent`
 * deletes the claim so the provider's retry processes it again (the GitHub
 * receiver's claim-then-release, `services/githubSync.ts`). Rows carry ids,
 * kind and outcome — never message text.
 */
import type { Env } from '../../types';
import type { ChannelProvider } from './types';

export type EventKind =
  | 'message' | 'voice' | 'echo' | 'edit' | 'command' | 'link' | 'connection'
  | 'status' | 'meeting' | 'transcript' | 'ignored';
export type EventStatus = 'accepted' | 'stored' | 'done' | 'ignored' | 'failed';

/** The new claim's id, or null when this event was already claimed. */
export async function claimEvent(env: Env, provider: ChannelProvider, externalEventId: string, kind: EventKind): Promise<number | null> {
  const id = String(externalEventId ?? '').slice(0, 200);
  if (!id) return null;
  const row = await env.DB.prepare(
    `INSERT OR IGNORE INTO channel_events (uid, provider, external_event_id, kind) VALUES (?, ?, ?, ?) RETURNING id`,
  ).bind(crypto.randomUUID(), provider, id, kind).first<{ id: number }>();
  return row ? Number(row.id) : null;
}

/** Record how a claimed event ended. `error` is a machine code, never text from the payload. */
export async function finishEvent(
  env: Env, eventId: number, status: EventStatus,
  fields: { userId?: number | null; threadId?: number | null; sessionId?: number | null; error?: string | null } = {},
): Promise<void> {
  await env.DB.prepare(
    `UPDATE channel_events
        SET status = ?, user_id = COALESCE(?, user_id), thread_id = COALESCE(?, thread_id),
            session_id = COALESCE(?, session_id), error = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(status, fields.userId ?? null, fields.threadId ?? null, fields.sessionId ?? null,
    fields.error ? String(fields.error).slice(0, 80) : null, eventId).run();
}

/** Drop a claim so the provider's retry is processed. Only before anything was stored. */
export async function releaseEvent(env: Env, eventId: number): Promise<void> {
  await env.DB.prepare('DELETE FROM channel_events WHERE id = ?').bind(eventId).run();
}
