/**
 * D1248 (#3263) — the one rule both `routes/dd.ts` and `routes/data_room.ts`
 * apply when a subject answers a due-diligence request with a data-room file:
 * an open request becomes "received", and the case's audit log says so.
 *
 * Only a request still waiting (`requested`, not withdrawn) moves; a request
 * already answered keeps its first `responded_at`, and a reviewed or withdrawn
 * one is never touched. The audit row names the request, never the file's
 * name or contents.
 */
import type { Env } from '../types';

export async function markRequestAnsweredByFile(env: Env, requestId: number, actorUserId: number | null): Promise<boolean> {
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    `UPDATE dd_requests
        SET state = 'received', responded_at = COALESCE(responded_at, ?), updated_at = ?
      WHERE id = ? AND withdrawn_at IS NULL AND state IN ('requested', 'received')`,
  ).bind(now, now, requestId).run();
  if (!res.meta?.changes) return false;
  const req = await env.DB.prepare('SELECT case_id FROM dd_requests WHERE id = ?').bind(requestId).first<{ case_id: number }>();
  if (req) {
    await env.DB.prepare(
      `INSERT INTO dd_audit_log (case_id, actor_user_id, action, target_type, target_id) VALUES (?, ?, 'request_answered_by_file', 'dd_request', ?)`,
    ).bind(req.case_id, actorUserId, requestId).run().catch(() => null);
  }
  return true;
}

/** A calendar day (YYYY-MM-DD) that exists, today (UTC) or later; null otherwise. */
export function dueDateOf(value: unknown, now = new Date()): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  return value >= now.toISOString().slice(0, 10) ? value : null;
}

/** How long after one reminder the next may be sent. */
export const REMINDER_GAP_MS = 24 * 60 * 60 * 1000;
/** How long a document link lives. */
export const DOWNLOAD_TTL_MS = 2 * 60 * 1000;

/** SHA-256 of a download token, hex. The token itself is never stored. */
export async function tokenHash(token: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(d).map((b) => b.toString(16).padStart(2, '0')).join('');
}
